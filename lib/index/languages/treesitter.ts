/**
 * tree-sitter through WebAssembly (web-tree-sitter 0.27.1, ADR-065): the one place the runtime is loaded.
 *
 * WebAssembly can't start synchronously, so the runtime and the grammars load once per process, asynchronously, in
 * loadGrammars (prepareLanguages() in registry.ts calls it). After that every parse is synchronous, which keeps
 * indexRepository and applyFileChanges synchronous. web-tree-sitter is imported only inside loadGrammars, with a
 * dynamic import(), so a process that never indexes (the MCP server, the Next server) never loads it; the types below
 * are type-only imports and vanish at compile time.
 *
 * WebAssembly memory isn't garbage-collected: a tree must be deleted by hand. parseTree is the only way to get one, and
 * it always deletes it.
 */
import fs from "fs";
import type { Language, Node, Parser, Query } from "web-tree-sitter";
import { nebulosityPath } from "../../home";

type TreeSitter = typeof import("web-tree-sitter");
type Loaded = { language: Language; parser: Parser };

/** The runtime, started once. */
let runtime: Promise<TreeSitter> | null = null;
/** Grammars by language id, ready to parse with. */
const loaded = new Map<string, Loaded>();
/** Grammars on their way, so two callers loading one id at once share the load. */
const loading = new Map<string, Promise<void>>();
/** Compiled queries by id and source (a query lives as long as its grammar: for the process). */
const queries = new Map<string, Query>();
let QueryClass: TreeSitter["Query"] | null = null;

/** A parse asked of a grammar this process hasn't loaded: someone forgot `await prepareLanguages()`. */
export class GrammarNotLoadedError extends Error {
    constructor(ids: readonly string[]){
        super(`The tree-sitter grammar for ${ids.join(", ")} isn't loaded: await prepareLanguages() (lib/index/languages/registry.ts) before indexing.`);
        this.name = "GrammarNotLoadedError";
    }
}

function startRuntime(): Promise<TreeSitter> {
    runtime ??= (async () => {
        const treeSitter = await import("web-tree-sitter");
        await treeSitter.Parser.init();
        QueryClass = treeSitter.Query;
        return treeSitter;
    })();
    return runtime;
}

/**
 * Loads the runtime once, then each listed grammar once, from lib/index/languages/grammars/ (the committed .wasm files,
 * scripts/copy-grammars.mjs). Idempotent: an id already loaded is skipped. A grammar that fails to load rejects the
 * whole call and can be tried again.
 */
export async function loadGrammars(list: readonly { id: string; grammar: string }[]): Promise<void> {
    const treeSitter = await startRuntime();
    await Promise.all(list.map(({ id, grammar }) => {
        if (loaded.has(id)) return undefined;
        let pending = loading.get(id);
        if (pending === undefined){
            pending = (async () => {
                // read the bytes here rather than hand Language.load a path: one file read, the same on every system
                const bytes = await fs.promises.readFile(nebulosityPath("lib", "index", "languages", "grammars", grammar));
                const language = await treeSitter.Language.load(new Uint8Array(bytes));
                const parser = new treeSitter.Parser();
                parser.setLanguage(language);
                loaded.set(id, { language, parser });
            })().finally(() => loading.delete(id));
            loading.set(id, pending);
        }
        return pending;
    }));
}

/** Whether this process can parse `id` now. */
export function isPrepared(id: string): boolean {
    return loaded.has(id);
}

/** The text without one leading byte-order mark (U+FEFF, which Visual Studio writes on C# files). */
export function withoutBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses `text` with `id`'s grammar, hands the root to the callback (the plan's `use`; named `read` here, since React's
 * lint rule takes any call of `use` for its hook), and deletes the tree whatever the callback does. Nothing of the tree
 * may outlive the callback: copy out strings and numbers, never nodes. One leading U+FEFF is dropped first, so a
 * byte-order mark moves no column and no node. A syntax error doesn't throw: tree-sitter parses around it (ERROR nodes).
 */
export function parseTree<T>(id: string, text: string, read: (root: Node) => T): T {
    const grammar = loaded.get(id);
    if (grammar === undefined) throw new GrammarNotLoadedError([id]);
    const tree = grammar.parser.parse(withoutBom(text));
    if (tree === null) throw new Error(`tree-sitter returned no tree for a ${id} text`);
    try{
        return read(tree.rootNode);
    } finally{
        tree.delete();
    }
}

/**
 * A tree-sitter query over `id`'s grammar, compiled once per id and source, so an adapter can run queries without
 * importing web-tree-sitter itself. Throws GrammarNotLoadedError like parseTree, and the runtime's own error for a
 * query the grammar can't compile.
 */
export function compileQuery(id: string, source: string): Query {
    const grammar = loaded.get(id);
    if (grammar === undefined || QueryClass === null) throw new GrammarNotLoadedError([id]);
    const key = `${id}\0${source}`;
    let query = queries.get(key);
    if (query === undefined){
        query = new QueryClass(grammar.language, source);
        queries.set(key, query);
    }
    return query;
}

/** A node's first line, 1-based. */
export function startLineOf(node: Node): number {
    return node.startPosition.row + 1;
}

/**
 * A node's last line, 1-based: the line holding its last character. A node whose text ends with its line's newline
 * (some grammars' comments do) ends at column 0 of the next row, which isn't its line.
 */
export function endLineOf(node: Node): number {
    const end = node.endPosition;
    return end.column === 0 && end.row > node.startPosition.row ? end.row : end.row + 1;
}

/**
 * A declaration's lines with what is attached above it: the node's own range, extended up over the previous siblings
 * `attached` accepts (comments, decorators, attributes) for as long as each one ends on the line just above the span so
 * far, or on its first line (no blank line between). The first sibling refused, or a blank line, stops it.
 */
export function leadingSpan(node: Node, attached: (previous: Node) => boolean): { startLine: number; endLine: number } {
    let startLine = startLineOf(node);
    for (let previous = node.previousSibling; previous !== null && attached(previous); previous = previous.previousSibling){
        if (endLineOf(previous) < startLine - 1) break;
        startLine = Math.min(startLine, startLineOf(previous));
    }
    return { startLine, endLine: endLineOf(node) };
}
