import type { SearchList } from "../contracts";
import { splitIdentifier } from "../index/identifiers";

/**
 * The ranking half of search (RAG_PIPELINE.md §6): query words, names, and Reciprocal Rank Fusion. Pure, and safe for
 * the browser: it imports nothing that opens a database or reads a disk, so the static demo ranks with the same code
 * the server does (ADR-049). The lists themselves come from search.ts (the server) or staticSearch.ts (the demo).
 */

/** RRF's k (ADR-027): rank 1 scores 1/61 and rank 50 scores 1/110, so no single list dominates. */
export const RRF_K = 60;
/**
 * Each list's weight in the fusion. A folder named like the query is strong evidence it's what the user means, but on
 * its own it scored like one code hit and fell past the results' cut-off (VS Code's main debug folder for "debugger");
 * counting it double puts it among the hits two lists agree on (owner review, 2026-10-13). A file named like the query,
 * or declaring what it names, is strong evidence too (V1.5, ADR-052).
 */
export const LIST_WEIGHTS: Record<SearchList, number> = { code: 1, summary: 1, vector: 1, name: 2, file: 2 };
/** How many files or folders each list contributes to the fusion. */
export const LIST_DEPTH = 50;

/** Words that only make a natural-language question longer. */
const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "if", "in",
    "is", "it", "its", "me", "my", "not", "of", "on", "or", "should", "so", "that", "the", "their", "then", "there",
    "these", "this", "those", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

/**
 * The words a query searches for: its words, lowercased, without stopwords and single letters, each identifier
 * followed by its parts ("openEditor" adds "open" and "editor").
 */
export function queryTerms(query: string): string[] {
    const terms: string[] = [];
    const add = (term: string): void => {
        if (term.length > 1 && !STOPWORDS.has(term) && !terms.includes(term)) terms.push(term);
    };
    for (const token of query.match(/[\p{L}\p{N}_]+/gu) ?? []){
        add(token.toLowerCase());
        for (const part of splitIdentifier(token).split(" ")) add(part);
    }
    return terms;
}

/**
 * Turns free text into a safe FTS5 query. Every word is quoted, so nothing the user types is read as FTS5 syntax, and
 * the words are ORed: bm25 ranks documents matching more and rarer words higher. Null when nothing searchable is left.
 */
export function toFtsQuery(query: string): string | null {
    const terms = queryTerms(query);
    return terms.length === 0 ? null : terms.map((t) => `"${t}"`).join(" OR ");
}

/**
 * The query without the repo's own name, when other meaningful words remain: every file is in the repo, so the word
 * says nothing, and in VS Code it mostly matched extension code that imports the `vscode` API (the owner's three-task
 * test: "vscode terminal" found an extension's terminal folder, not VS Code's). Only a whole word goes ("vscode-dts"
 * stays), and a query with nothing else left is kept as it is.
 */
export function dropRepoName(query: string, repoName: string): string {
    const name = repoName.toLowerCase();
    const terms = query.trim().split(/\s+/);
    const kept = terms.filter((term) => term.toLowerCase() !== name);
    return kept.length < terms.length && toFtsQuery(kept.join(" ")) !== null ? kept.join(" ") : query;
}

/** The query's words for matching folder names: lowercased, common words dropped. */
export function nameWords(query: string): string[] {
    const words = (query.match(/[\p{L}\p{N}_]+/gu) ?? []).map((w) => w.toLowerCase());
    return [...new Set(words.filter((w) => w.length > 1 && !STOPWORDS.has(w)))];
}

/** Endings this short make two words the same word: "debug"/"debugger", "extension"/"extensions", "test"/"testing". */
const MAX_ENDING = 3;

/**
 * How well a folder's name matches one word of the query, best 0, or null for no match:
 * - 0: the name is the word ("terminal"), or one is the other plus an ending of up to 3 letters, both 4+ letters long
 *   ("debug" for "debugger"), so the main debug folder isn't outranked by a tiny one literally named "debugger";
 * - 1: the name starts with the word ("terminalContrib", "terminal-suggest");
 * - 2: the name contains it ("externalTerminal", for words of 3+ letters);
 * - 3: the word starts with the name ("term" for "terminal", for names of 4+ letters).
 * The length floors keep "ui" from matching inside "build" and "ab" from matching "abc".
 */
export function nameMatch(name: string, word: string): number | null {
    if (name === word) return 0;
    const [shorter, longer] = name.length <= word.length ? [name, word] : [word, name];
    if (shorter.length >= 4 && longer.length - shorter.length <= MAX_ENDING && longer.startsWith(shorter)) return 0;
    if (name.startsWith(word)) return 1;
    if (word.length >= 3 && name.includes(word)) return 2;
    if (name.length >= 4 && word.startsWith(name)) return 3;
    return null;
}

/**
 * Folders whose names match the query, best first (owner review, 2026-10-13): searching "terminal" found files about
 * terminals but not the terminal folders, which only competed through their summaries (VS Code's main one ranked 57th).
 * A folder takes its best match over the query's words; ties go to the folder with more files, then the path. The
 * repo root has no name and never matches.
 */
export function rankFolderNames(folders: readonly { path: string; name: string; fileCount: number }[], query: string): string[] {
    const words = nameWords(query);
    const ranked: { path: string; tier: number; fileCount: number }[] = [];
    for (const folder of folders){
        if (folder.path === "") continue;
        const name = folder.name.toLowerCase();
        const tiers = words.map((w) => nameMatch(name, w)).filter((t): t is number => t !== null);
        if (tiers.length > 0) ranked.push({ path: folder.path, tier: Math.min(...tiers), fileCount: folder.fileCount });
    }
    return ranked
        .sort((a, b) => a.tier - b.tier || b.fileCount - a.fileCount || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((r) => r.path);
}

/** A file for the file-name list: its path and how many files import it (its importance, ADR-010). */
export type FileFact = { path: string; importedBy: number };
/** An exported top-level declaration and the file declaring it. */
export type Declared = { name: string; path: string };

/**
 * A file's name as a word: no folder, no extension, no .test/.spec marker ("lifecycle" for lifecycle.ts, "Order" for
 * Order.java, "views" for views.pyi). The extension is whatever follows the last dot, in every language (the E4 final
 * review's A-I2: a TypeScript-only list left "Order.java" as the stem, so "order" never found it). Only files with a
 * claimed extension are indexed, so every TypeScript file keeps the stem the old list gave it; and this module, which
 * the browser bundles, needs no copy of the languages' rules.
 */
export function fileStem(filePath: string): string {
    const base = filePath.slice(filePath.lastIndexOf("/") + 1);
    return base.replace(/\.(test|spec)(?=\.[cm]?[jt]sx?$)/, "").replace(/\.[^.]+$/, "");
}

/**
 * Files named like the query or declaring what it names, most imported first, then by path (ADR-052). A file counts
 * when its name is a query word, or that word plus an ending of up to 3 letters with both 4+ letters long (nameMatch's
 * first tier: "lifecycle" finds lifecycle.ts, "debugger" finds debug.ts), or when it exports a top-level declaration
 * named exactly like a query word ("registerSingleton" finds the file defining it). Partial matches stay with the
 * code list: thousands of files contain a common word. Importance breaks ties, so VS Code's own lifecycle.ts comes
 * before an extension's copy of it.
 */
export function rankFileNames(files: readonly FileFact[], declared: readonly Declared[], query: string): string[] {
    const words = nameWords(query);
    if (words.length === 0) return [];
    const exact = new Set(words);
    const found = new Set<string>();
    for (const file of files){
        const stem = fileStem(file.path).toLowerCase();
        if (words.some((w) => nameMatch(stem, w) === 0)) found.add(file.path);
    }
    for (const d of declared) if (exact.has(d.name.toLowerCase())) found.add(d.path);

    const importedBy = new Map(files.map((f) => [f.path, f.importedBy]));
    return [...found].sort((a, b) => (importedBy.get(b) ?? 0) - (importedBy.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Weighted Reciprocal Rank Fusion (ADR-027): score(d) = Σ w / (k + rank), rank 1-based, over every
 * list that contains d, w its list's weight (LIST_WEIGHTS). It combines lists whose own scores (bm25,
 * cosine) aren't comparable, using only positions. Ties break by key, so the order is deterministic.
 */
export function fuseRankings(lists: Partial<Record<SearchList, readonly string[]>>, k: number = RRF_K): { key: string; score: number; matchedBy: SearchList[] }[] {
    const fused = new Map<string, { key: string; score: number; matchedBy: SearchList[] }>();

    for (const list of ["code", "summary", "vector", "name", "file"] as const){
        (lists[list] ?? []).forEach((key, i) => {
            const entry = fused.get(key) ?? { key, score: 0, matchedBy: [] };
            entry.score += LIST_WEIGHTS[list] / (k + i + 1);
            entry.matchedBy.push(list);
            fused.set(key, entry);
        });
    }

    return [...fused.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Query words that mean the user is after tests: test targets then keep their whole score. */
const TEST_WORDS = new Set(["test", "tests", "testing", "spec", "specs", "smoke", "e2e", "fixture", "fixtures", "mock", "mocks"]);
/** A test target's share of its fused score when the query isn't about tests (ADR-052). */
export const TEST_DAMPING = 0.5;

export function wantsTests(query: string): boolean {
    return nameWords(query).some((w) => TEST_WORDS.has(w));
}

/** Folders with at least one file below them and no file that isn't a test, the root never counted (like summaries' rule). */
export function testOnlyFolders(files: readonly { path: string; isTest: boolean }[]): Set<string> {
    const hasTest = new Set<string>();
    const hasOther = new Set<string>();
    for (const file of files){
        for (let at = file.path.lastIndexOf("/"); at > 0; at = file.path.lastIndexOf("/", at - 1)){
            (file.isTest ? hasTest : hasOther).add(file.path.slice(0, at));
        }
    }
    return new Set([...hasTest].filter((folder) => !hasOther.has(folder)));
}

/**
 * Halves the fused score of test files and test-only folders unless the query asks for tests, then sorts again (ties by
 * key): searching "terminal" shouldn't lead with a smoke-test folder, and "terminal smoke test" still finds it.
 */
export function dampTests<T extends { key: string; score: number }>(fused: readonly T[], isTest: (key: string) => boolean, query: string): T[] {
    if (wantsTests(query)) return [...fused];
    return fused
        .map((f) => (isTest(f.key) ? { ...f, score: f.score * TEST_DAMPING } : f))
        .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The name of a file's imports-and-exports listing chunk (lib/chunks.ts). */
export const FILE_CHUNK = "(file)";

/**
 * The listing's path: a word ending in a claimed extension, one alternative per language (TypeScript and JavaScript,
 * Python, Go, Java, C#, Rust; rank.test.ts holds it to the rules' claimed extensions). A list rather than any extension,
 * so a snippet cut just before an import's last word ("…os.path Exports:") keeps that word.
 */
const LISTING_PATH = /(^|…)\s*(?:File:\s*)?[^\s…]+\.(?:[cm]?[jt]sx?|pyi?|go|java|cs|rs)\s+(?=Imports:|Exports:)/;

/**
 * An imports listing's snippet without the listing's scaffolding: the "File: <path>" line and the "Imports:" and
 * "Exports:" labels (ADR-052), for a file of any indexed language (the E4 final review's A-I2). The snippet is already
 * on one line.
 */
export function cleanFileChunkSnippet(snippet: string): string {
    return snippet
        .replace(LISTING_PATH, "$1")   // a path never holds "…", so a leading one survives
        .replace(/\b(?:Imports|Exports):\s*/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
