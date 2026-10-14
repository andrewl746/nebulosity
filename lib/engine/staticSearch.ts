import type { DemoSearchIndex, SearchHit, SearchResult } from "../contracts";
import { splitIdentifier } from "../index/identifiers";
import { dampTests, dropRepoName, fuseRankings, LIST_DEPTH, queryTerms, rankFileNames, rankFolderNames, testOnlyFolders, type Declared, type FileFact } from "./rank";

/**
 * Search in the static demo (ADR-049), with no server: BM25 over the exported summaries, plus folder names and file
 * names, fused by the server's own ranking code (rank.ts). There's no code-text list (its index is hundreds of MB)
 * and no meaning list (it needs the model), and every result says so.
 */
export const STATIC_NOTE = "This demo searches names and summaries; the app also searches code and meaning.";

/** BM25's constants, as FTS5 sets them. */
const K1 = 1.2;
const B = 0.75;
/** Field weights for [path, tagline, summary], as the server's summary index ranks them (RAG_PIPELINE.md §6). */
const WEIGHTS = [1, 4, 2] as const;
/** A query word this long or longer also matches words it begins ("render" finds "rendered"); shorter ones match whole words. */
const MIN_PREFIX = 3;

/** A text's words: lowercased, each identifier followed by its parts, the way queryTerms splits a query. */
export function tokenize(text: string): string[] {
    const tokens: string[] = [];
    for (const word of text.match(/[\p{L}\p{N}_]+/gu) ?? []){
        tokens.push(word.toLowerCase());
        const parts = splitIdentifier(word).split(" ");
        if (parts.length > 1) tokens.push(...parts);
    }
    return tokens;
}

type Doc = { key: string; tagline: string; summary: string; counts: Map<string, number>[]; lengths: number[] };
export type StaticSearch = {
    docs: Doc[];
    /** Every word in any field, sorted, for prefix lookups. */
    vocabulary: string[];
    /** Which documents hold each word. */
    postings: Map<string, number[]>;
    averages: number[];
    folders: { path: string; name: string; fileCount: number }[];
    files: FileFact[];
    declared: Declared[];
    tests: Set<string>;
};

export function buildStaticSearch(index: DemoSearchIndex): StaticSearch {
    const postings = new Map<string, number[]>();
    const docs = index.summaries.map(([kind, docPath, tagline, summary], d): Doc => {
        const fields = [docPath, tagline, summary].map(tokenize);
        const counts = fields.map((tokens) => {
            const count = new Map<string, number>();
            for (const token of tokens) count.set(token, (count.get(token) ?? 0) + 1);
            return count;
        });
        for (const word of new Set(fields.flat())) postings.set(word, [...(postings.get(word) ?? []), d]);
        return { key: `${kind === 1 ? "folder" : "file"}:${docPath}`, tagline, summary, counts, lengths: fields.map((f) => f.length) };
    });
    const averages = WEIGHTS.map((_, f) => docs.reduce((sum, doc) => sum + doc.lengths[f], 0) / Math.max(1, docs.length) || 1);
    const files = index.files.map(([filePath, importedBy]) => ({ path: filePath, importedBy }));
    const testFolders = testOnlyFolders(index.files.map(([filePath, , isTest]) => ({ path: filePath, isTest: isTest === 1 })));
    return {
        docs,
        vocabulary: [...postings.keys()].sort(),
        postings,
        averages,
        folders: index.folders.map(([folderPath, fileCount]) => ({ path: folderPath, name: folderPath.slice(folderPath.lastIndexOf("/") + 1), fileCount })),
        files,
        declared: index.declarations.map(([name, file]) => ({ name, path: index.files[file][0] })),
        tests: new Set([
            ...index.files.filter(([, , isTest]) => isTest === 1).map(([filePath]) => `file:${filePath}`),
            ...[...testFolders].map((folder) => `folder:${folder}`),
        ]),
    };
}

/** The vocabulary's words a query term matches: itself, plus every word it begins when it's 3+ letters long. */
function matching(vocabulary: readonly string[], term: string): string[] {
    if (term.length < MIN_PREFIX) return vocabulary.includes(term) ? [term] : [];
    let low = 0;
    let high = vocabulary.length;
    while (low < high){
        const mid = (low + high) >> 1;
        if (vocabulary[mid] < term) low = mid + 1;
        else high = mid;
    }
    const found: string[] = [];
    for (let i = low; i < vocabulary.length && vocabulary[i].startsWith(term); i++) found.push(vocabulary[i]);
    return found;
}

/** BM25 per document key, over the terms given; a term matching several words counts all their occurrences. */
export function bm25Scores(s: StaticSearch, terms: readonly string[]): Map<string, number> {
    const scores = new Map<string, number>();
    for (const term of terms){
        const words = matching(s.vocabulary, term);
        const holding = new Set(words.flatMap((w) => s.postings.get(w) ?? []));
        if (holding.size === 0) continue;
        const idf = Math.log(1 + (s.docs.length - holding.size + 0.5) / (holding.size + 0.5));
        for (const d of holding){
            const doc = s.docs[d];
            let sum = 0;
            WEIGHTS.forEach((weight, f) => {
                const tf = words.reduce((n, w) => n + (doc.counts[f].get(w) ?? 0), 0);
                if (tf > 0) sum += (weight * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.lengths[f]) / s.averages[f]));
            });
            scores.set(doc.key, (scores.get(doc.key) ?? 0) + idf * sum);
        }
    }
    return scores;
}

export function bm25Rank(s: StaticSearch, terms: readonly string[]): string[] {
    return [...bm25Scores(s, terms).entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([key]) => key);
}

export function searchStatic(s: StaticSearch, typed: string, options: { limit?: number; repoName: string }): SearchResult {
    const query = dropRepoName(typed, options.repoName);
    const summary = bm25Rank(s, queryTerms(query)).slice(0, LIST_DEPTH);
    const name = rankFolderNames(s.folders, query).slice(0, LIST_DEPTH).map((p) => `folder:${p}`);
    const file = rankFileNames(s.files, s.declared, query).slice(0, LIST_DEPTH).map((p) => `file:${p}`);
    const texts = new Map(s.docs.map((doc) => [doc.key, doc]));

    const hits: SearchHit[] = dampTests(fuseRankings({ summary, name, file }), (key) => s.tests.has(key), query)
        .slice(0, options.limit ?? 10)
        .map(({ key, score, matchedBy }) => {
            const kind = key.startsWith("folder:") ? "folder" : "file";
            const text = texts.get(key);
            return { path: key.slice(kind.length + 1), kind, score, matchedBy, ...(text ? { tagline: text.tagline, summary: text.summary } : {}) };
        });
    return { query: typed, hits, lists: { code: 0, summary: summary.length, vector: 0, name: name.length, file: file.length }, note: STATIC_NOTE };
}
