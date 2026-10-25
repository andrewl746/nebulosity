/**
 * The seam every language plugs into (ADR-065, the E4 design §6.1). Two layers:
 * - LanguageRules: pure facts about a language (extensions, test files, manifests, the folders its manifests leave
 *   out). Discovery, the watcher and the engine read only these (rules.ts), so the MCP server never loads a parser.
 * - LanguageAdapter: the rules plus one parse (five products) and one resolver per run. The full run and the
 *   incremental update call these through the registry (registry.ts).
 */
import type { CodeChunk } from "../../contracts";
import type { CallFacts, SymbolRow } from "../../db/schema";

/** How a code file is read (discover.ts readingFor, ADR-053): in full; over 1 MB parsed for imports and declares only; over 5 MB scanned for imports only. */
export type Reading = "full" | "parse" | "scan";

/** One parse's five products (ADR-026, ADR-059, ADR-065). */
export type ParsedFile = {
    chunks: CodeChunk[];
    symbols: SymbolRow[];
    /** References in source order, each once, in the adapter's own specifier syntax. */
    imports: string[];
    /** Facts other files' resolution reads from this one, sorted, each once; [] when the language resolves by paths alone. */
    declares: string[];
    calls: CallFacts;
    lineCount: number;
};

/** What discovery, the watcher and the engine need of a language: pure, no parser loaded. */
export type LanguageRules = {
    /** Lowercase letters. The registry's are typescript, python, go, java, csharp, rust; tests use their own. */
    id: string;
    /** Claimed extensions with the dot, matched case-sensitively at the end of a path; [] for a stub. */
    extensions: readonly string[];
    /** files.language for one of its paths. */
    languageOf(path: string): string;
    /** This language's test files, on top of the shared folder rule (a test/, tests/ or __tests__/ folder). */
    isTest(path: string): boolean;
    /** Repo-relative paths that change what its references resolve to, or which of its files are left out. */
    manifest: RegExp;
    /** The files it leaves out in both discovery modes, given every manifest discovery found (sorted). */
    excluded(manifests: readonly string[]): (path: string) => boolean;
};

/** What a resolver sees of one indexed file. */
export type StoredFacts = { importSpecifiers: readonly string[]; declares: readonly string[] };

export type ResolveContext = {
    /** The repo root, absolute. */
    root: string;
    /** Every indexed file of every language, repo-relative with forward slashes. */
    fileSet: ReadonlySet<string>;
    /** This adapter's files and their stored facts. */
    files: ReadonlyMap<string, StoredFacts>;
    /** Every manifest discovery found, of every language, sorted. */
    manifests: readonly string[];
    /** A repo file's text (a manifest), or null when it can't be read. */
    readText(rel: string): string | null;
    /**
     * Kept across a worker's incremental updates and emptied whenever a manifest or the file set changes: what an adapter
     * read from the manifests (TypeScript keeps its Workspace here, ADR-053 amended). Keys start with the adapter's id.
     */
    cache: Map<string, unknown>;
};

/**
 * internal: the language's rules put the target in the repo, resolved or not (the resolution report's denominator).
 * external: outside the repo. context: a lookup aid that never makes an edge by itself (a Java wildcard import, a C# using).
 */
export type ReferenceKind = "internal" | "external" | "context";

export type LanguageResolver = {
    /**
     * The files one specifier of `importer` refers to, sorted by path. `[importer]` means placed but with no edge of its own:
     * the reference names the importer's own file, or another specifier of the same file carries its edges. `edgesOf`
     * drops it, and the report counts it resolved. `[]` means it can't be placed.
     */
    resolve(importer: string, specifier: string): string[];
    kindOf(importer: string, specifier: string): ReferenceKind;
    /** The class the resolution report counts it under (each L3 bar is per class); without it, the specifier's text before its first ":". */
    classOf?(importer: string, specifier: string): string;
    /** The files the language's build tool or runtime starts from, sorted by path, each once. */
    entryPoints(): { path: string; declaredBy: string }[];
};

export type LanguageAdapter = LanguageRules & {
    /** Bump on any change that gives an unchanged file different products: a full run re-parses this adapter's files once. */
    version: number;
    /** The grammar's file name in lib/index/languages/grammars/, or null (TypeScript's compiler API; test adapters). */
    grammar: string | null;
    /** One file's products. A syntax error is parsed around; it throws only when the file can't be read at all. */
    parse(path: string, text: string, reading: Reading): ParsedFile;
    createResolver(context: ResolveContext): LanguageResolver;
};
