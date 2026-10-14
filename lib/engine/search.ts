import path from "path";
import type { SearchHit, SearchResult } from "../contracts";
import { getDb, type Db } from "../db/client";
import { isCodeSearchDeferred, loadSummaryText, searchCode, searchSummaries, type CodeMatch } from "../db/store/search";
import { requireRepository } from "../db/store/structure";
import { loadFolderFacts, targetKey } from "../db/store/summaries";
import { countEmbeddable, loadSummaryVectors, summaryVectorStamp } from "../db/store/summary-vectors";
import { decodeVector, embedTexts } from "../embed";
import type { EmbedFn } from "../index/embed";
import { repoKey } from "../index/paths";
import { dropRepoName, fuseRankings, LIST_DEPTH, rankFolderNames, toFtsQuery } from "./rank";

// The pure ranking lives in rank.ts so the browser can bundle it (ADR-049); the old public names stay importable from here.
export { dropRepoName, fuseRankings, LIST_DEPTH, LIST_WEIGHTS, rankFolderNames, RRF_K, toFtsQuery } from "./rank";

/** Cosine similarity below this is noise for MiniLM (the threshold Phase 4 measured). */
export const MIN_SIMILARITY = 0.25;
/** Chunks fetched from code search before they're grouped by file. */
const CODE_CHUNKS = 200;

type Target = { kind: "file" | "folder"; path: string };

export type SearchOptions = {
    limit?: number;
    embed?: EmbedFn;
    /** No API key (ADR-043): the note says summaries are off rather than not ready. */
    summariesOff?: boolean;
};

/**
 * Hybrid search (PIVOT_SPEC.md §6.1, RAG_PIPELINE.md §6). Four ranked lists of files
 * and folders are fused with RRF:
 * 1. bm25 over code, grouped by file;
 * 2. bm25 over summaries;
 * 3. cosine similarity between the query and every summary vector;
 * 4. folders whose names match the query (rankFolderNames).
 */
export async function search(repoRoot: string, typed: string, options: SearchOptions = {}): Promise<SearchResult> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    // every list searches without the repo's own name; the answer still carries the query as typed
    const query = dropRepoName(typed, path.basename(path.resolve(repoRoot)));
    const limit = options.limit ?? 10;
    const embed = options.embed ?? ((texts: string[]) => embedTexts(texts));
    const notes: string[] = [];
    const targets = new Map<string, Target>();
    const remember = (target: Target): string => {
        const key = targetKey(target.kind, target.path);
        targets.set(key, target);
        return key;
    };

    // 1. keywords in code: the best chunk of each file stands for the file
    const fts = toFtsQuery(query);
    const bestChunk = new Map<string, CodeMatch>();
    for (const match of fts ? searchCode(db, repoId, fts, CODE_CHUNKS) : []){
        if (!bestChunk.has(match.path)) bestChunk.set(match.path, match);
    }
    const code = [...bestChunk.keys()].slice(0, LIST_DEPTH).map((p) => remember({ kind: "file", path: p }));

    // 2. keywords in summaries
    const summary = (fts ? searchSummaries(db, repoId, fts, LIST_DEPTH) : [])
        .map((m) => remember({ kind: m.kind === "folder" ? "folder" : "file", path: m.path }));

    // 3. meaning (the model only loads when there are vectors to compare against)
    let vector: string[] = [];
    const index = vectorsFor(db, repoId);
    if (index.targets.length > 0){
        try{
            const [queryVector] = await embed([query]);
            vector = rankByCosine(queryVector, index).slice(0, LIST_DEPTH).map(remember);
        } catch (err){
            notes.push(`Meaning search is unavailable (${err instanceof Error ? err.message : String(err)}), so results come from keywords only.`);
        }
    }

    // 4. folders named like the query
    const name = rankFolderNames(loadFolderFacts(db, repoId), query).slice(0, LIST_DEPTH).map((p) => remember({ kind: "folder", path: p }));

    if (isCodeSearchDeferred(db)) notes.push("Code search is still being built after a large index run, so code results may be missing.");
    if (countEmbeddable(db, repoId) === 0){
        notes.unshift(options.summariesOff
            ? "Summaries are off (no ANTHROPIC_API_KEY), so results come from code and folder names only."
            : "Summaries aren't ready yet, so results come from code and folder names only.");
    } else if (index.targets.length === 0) notes.unshift("Summaries aren't embedded yet, so results come from keywords only.");

    const hits: SearchHit[] = fuseRankings({ code, summary, vector, name }).slice(0, limit).map(({ key, score, matchedBy }) => {
        const target = targets.get(key)!;
        const text = loadSummaryText(db, repoId, target.kind, target.path);
        const chunk = target.kind === "file" ? bestChunk.get(target.path) : undefined;
        return {
            path: target.path,
            kind: target.kind,
            score,
            matchedBy,
            ...(text ? { tagline: text.tagline, summary: text.summary } : {}),
            ...(chunk ? { code: { symbol: chunk.symbol, startLine: chunk.startLine, endLine: chunk.endLine, snippet: chunk.snippet.replace(/\s+/g, " ").trim() } } : {}),
        };
    });

    if (fts === null && hits.length === 0) notes.push("The query has only very common words; try more specific ones.");

    return {
        query: typed,
        hits,
        lists: { code: code.length, summary: summary.length, vector: vector.length, name: name.length },
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
}

/** Every summary vector of a repo in one flat matrix, reloaded only when the set of vectors changes. */
type VectorIndex = { stamp: string; targets: Target[]; dims: number; matrix: Float32Array };
const vectorCache = new Map<number, VectorIndex>();

function vectorsFor(db: Db, repoId: number): VectorIndex {
    const stamp = summaryVectorStamp(db, repoId);
    const cached = vectorCache.get(repoId);
    if (cached?.stamp === stamp) return cached;

    const rows = loadSummaryVectors(db, repoId);
    const vectors = rows.map((r) => decodeVector(r.embedding));
    const dims = vectors[0]?.length ?? 0;
    const matrix = new Float32Array(rows.length * dims);
    vectors.forEach((v, i) => matrix.set(v, i * dims));

    const index: VectorIndex = {
        stamp,
        dims,
        matrix,
        targets: rows.map((r): Target => ({ kind: r.kind === "folder" ? "folder" : "file", path: r.path })),
    };
    vectorCache.set(repoId, index);
    return index;
}

/** Targets by cosine similarity to the query, best first, noise dropped. Vectors are unit length, so cosine is a dot product. */
function rankByCosine(query: Float32Array, index: VectorIndex): Target[] {
    const scored: { target: Target; key: string; score: number }[] = [];

    for (let row = 0; row < index.targets.length; row++){
        let dot = 0;
        for (let d = 0; d < index.dims; d++) dot += query[d] * index.matrix[row * index.dims + d];
        if (dot >= MIN_SIMILARITY){
            const target = index.targets[row];
            scored.push({ target, key: targetKey(target.kind, target.path), score: dot });
        }
    }

    return scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((s) => s.target);
}
