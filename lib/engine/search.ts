import path from "path";
import type { SearchHit, SearchList, SearchResult } from "../contracts";
import { getDb, type Db } from "../db/client";
import { loadSummaryText, searchCode, searchSummaries, type CodeMatch } from "../db/store/search";
import { requireRepository } from "../db/store/structure";
import { targetKey } from "../db/store/summaries";
import { countEmbeddable, loadSummaryVectors, summaryVectorStamp } from "../db/store/summary-vectors";
import { decodeVector, embedTexts } from "../embed";
import type { EmbedFn } from "../index/embed";
import { splitIdentifier } from "../index/identifiers";
import { repoKey } from "../index/paths";

/** RRF's k (ADR-027): rank 1 scores 1/61 and rank 50 scores 1/110, so no single list dominates. */
export const RRF_K = 60;
/** How many files or folders each list contributes to the fusion. */
export const LIST_DEPTH = 50;
/** Cosine similarity below this is noise for MiniLM (the threshold Phase 4 measured). */
export const MIN_SIMILARITY = 0.25;
/** Chunks fetched from code search before they're grouped by file. */
const CODE_CHUNKS = 200;

/** Words that only make a natural-language question longer. */
const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "if", "in",
    "is", "it", "its", "me", "my", "not", "of", "on", "or", "should", "so", "that", "the", "their", "then", "there",
    "these", "this", "those", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

type Target = { kind: "file" | "folder"; path: string };

export type SearchOptions = { limit?: number; embed?: EmbedFn };

/**
 * Turns free text into a safe FTS5 query. Every word is quoted, so nothing the user types
 * is read as FTS5 syntax. Identifiers also contribute their parts ("openEditor" adds "open"
 * and "editor"). The words are ORed, and bm25 ranks documents matching more and rarer
 * words higher. Null when nothing searchable is left.
 */
export function toFtsQuery(query: string): string | null {
    const terms: string[] = [];
    const add = (term: string): void => {
        if (term.length > 1 && !STOPWORDS.has(term) && !terms.includes(term)) terms.push(term);
    };

    for (const token of query.match(/[\p{L}\p{N}_]+/gu) ?? []){
        add(token.toLowerCase());
        for (const part of splitIdentifier(token).split(" ")) add(part);
    }

    return terms.length === 0 ? null : terms.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Reciprocal Rank Fusion (ADR-027): score(d) = Σ 1 / (k + rank), rank 1-based, over every
 * list that contains d. It combines lists whose own scores (bm25, cosine) aren't comparable,
 * using only positions. Ties break by key, so the order is deterministic.
 */
export function fuseRankings(lists: Partial<Record<SearchList, readonly string[]>>, k: number = RRF_K): { key: string; score: number; matchedBy: SearchList[] }[] {
    const fused = new Map<string, { key: string; score: number; matchedBy: SearchList[] }>();

    for (const list of ["code", "summary", "vector"] as const){
        (lists[list] ?? []).forEach((key, i) => {
            const entry = fused.get(key) ?? { key, score: 0, matchedBy: [] };
            entry.score += 1 / (k + i + 1);
            entry.matchedBy.push(list);
            fused.set(key, entry);
        });
    }

    return [...fused.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Hybrid search (PIVOT_SPEC.md §6.1, RAG_PIPELINE.md §6). Three ranked lists of files
 * and folders are fused with RRF:
 * 1. bm25 over code, grouped by file;
 * 2. bm25 over summaries;
 * 3. cosine similarity between the query and every summary vector.
 */
export async function search(repoRoot: string, query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
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

    if (countEmbeddable(db, repoId) === 0) notes.unshift("Summaries aren't ready yet, so results come from code keywords only.");
    else if (index.targets.length === 0) notes.unshift("Summaries aren't embedded yet, so results come from keywords only.");

    const hits: SearchHit[] = fuseRankings({ code, summary, vector }).slice(0, limit).map(({ key, score, matchedBy }) => {
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
        query,
        hits,
        lists: { code: code.length, summary: summary.length, vector: vector.length },
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
