# E4: Python, Go, Java, C# and Rust — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index Python, Go, Java, C# and Rust repos (files, imports resolved by each language's own rules, declarations, code search, test flags and entry points) through tree-sitter adapters behind one seam, while TypeScript's index stays exactly as it is.

**Architecture:** A pure `LanguageRules` layer (extensions, test rule, manifests, exclusions) is what discovery, the watcher and the engine import. A `LanguageAdapter` layer (one parse, five products; one resolver per run) is what the pipeline and the incremental update call, through a registry. `web-tree-sitter` 0.27.1 parses the five languages from committed grammar `.wasm` files, loaded once per process by `prepareLanguages()`, so indexing stays synchronous. A new `files.declares` column carries the cross-file facts that name-based resolution needs (Go packages, Java packages, C# namespaces, Rust's `mod` tree).

**Tech Stack:** TypeScript run by tsx, web-tree-sitter 0.27.1, smol-toml 1.9.1, better-sqlite3 with Drizzle (migration 0010), Vitest.

**Models (the owner's rule, 2026-10-24, verbatim: "only use opus 5.5 max for planning. for implementation use opus 5.5 xhigh"):**
- Every implementation subagent, implementers and their reviewers alike, runs Opus 5.5 at xhigh effort (`model: "opus"`, `effort: "xhigh"`).
- Planning, and any review of this plan, runs Opus 5.5 at max.

**Spec:** the design, `.superpowers/sdd/2026-10-24-e4-languages/design.md` in the main checkout (from a sibling worktree, `../Nebulosity/.superpowers/sdd/2026-10-24-e4-languages/design.md`; gitignored and kept), and ADR-065 (proposed) in `docs/ENGINEERING_DECISIONS.md`. Every decision there is a call made for the owner overnight; don't reopen one unless the code or the data contradicts it, and then stop and write the evidence in your progress file.

## How this plan runs

- **Task F** runs alone, on `pivot/e4` in the worktree `../Nebulosity-e4`.
- **Tasks P, G, J, C and R** (Python, Go, Java, C#, Rust) then run at once. Each starts from `pivot/e4` at Task F's last commit, on its own branch in its own worktree, for example `git worktree add ../Nebulosity-e4-python -b pivot/e4-python pivot/e4`, then `npm ci` there. The ids are `python`, `go`, `java`, `csharp`, `rust`.
- **Task I** (integration) runs on `pivot/e4` once the language tasks are done or stopped.
- **The ledger** is `.superpowers/sdd/2026-10-24-e4-languages/` in the main checkout (`../Nebulosity/.superpowers/sdd/2026-10-24-e4-languages/` from a sibling worktree). Each task writes only its own file there: `progress-F.md`, `progress-python.md`, `progress-go.md`, `progress-java.md`, `progress-csharp.md`, `progress-rust.md`, `progress-integration.md`. Record every commit, every choice the plan left open, and every measurement.
- **A language task touches only the files its task lists.** When it needs a change to a shared file, it writes the change down in its progress file for Task I and works around it meanwhile.
- **The gate** is `npx tsc --noEmit && npm run lint && npx vitest run`, all clean (lint's 4 existing warnings stay 4). Run it before every push, and commit and push after every step that leaves it green.

## Global Constraints

- Node ≥ 24 (package.json `engines`). No native dependency is added, and nothing runs at a user's install.
- Exact pins: `web-tree-sitter` `0.27.1` and `smol-toml` `1.9.1` in `dependencies`; `tree-sitter-python` `0.25.0`, `tree-sitter-go` `0.25.0`, `tree-sitter-java` `0.23.5`, `tree-sitter-c-sharp` `0.23.5` and `tree-sitter-rust` `0.24.0` in `devDependencies`, where they serve only as the source of the committed `.wasm` files.
- TypeScript's products don't change: `ADAPTER_VERSION` stays `7` under the meta key `adapterVersion:<repoId>`, and every existing test passes with its expectations unchanged.
- `CONTRACTS_VERSION` stays `3`. Contract changes are additive only: the symbol kinds `struct` and `trait`, and the `language` values `python`, `go`, `java`, `csharp`, `rust`.
- Layering (ARCHITECTURE.md §3): `lib/` never imports `app/`, and the UI imports only the pure modules rule 3 names. `web-tree-sitter` is imported only inside `prepareLanguages()` (a dynamic `import()`), so the MCP server and the Next server never load it.
- Free mode: no model call anywhere in E4. No spending, no `npm publish`, no merge into `main`, and no pull request; those are the owner's.
- Git: commit and push every step. No `Co-Authored-By` or any attribution. Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`. Never switch the main checkout's branch.
- Tests transcribe hand-derived truth: a fixture's truth file is written by reading the fixture's files, before the adapter's code, never by running the code.
- Don't start the Map (`npm run dev`, `next start`, `nebulosity map`): port 3000 is the owner's.
- Never index into the owner's database. Every index run of a real repo either sets `NEBULOSITY_DATA` to a scratch folder or runs from a worktree, whose own `.nebulosity/` is its data folder.
- The benchmark repos are shallow clones the owner approved on 2026-10-24 ("Yes: shallow-clone django/django, prometheus/prometheus, spring-projects/spring-boot, jellyfin/jellyfin and rust-lang/rust-analyzer next to ../vscode for E4's benchmarks"). They're read-only: index them, never modify them. `git -C <repo> rev-parse HEAD` must print these before any measurement:
  - `../django` `0e128d524d0a7c55a955570d6e5da983ac6ce6c7`;
  - `../prometheus` `a2fda0ef4638518a6a6fb27fc48be88fbd732f4b`;
  - `../spring-boot` `11778bdc24f72f208f532eba8185311473908019` (checked out with `core.longpaths=true`, set in that repo only);
  - `../jellyfin` `07866611e9d83db50aab03fe0aa15714fccc3fe0`;
  - `../rust-analyzer` `0c4d74686b21f2b3bd8872b6d3cf36ad2e740d49`.

  `../vscode` is at `cc3fec88` and `../affine` at `0b69a6da`.

## Review Focus

1. **CRLF checkouts** (Windows with `core.autocrlf`): a fixture file converted to `\r\n` line endings gives the same specifiers, declares, symbols and line numbers. Pinned by the conformance kit's check K13 (Task F).
2. **A UTF-8 byte-order mark** (Visual Studio writes one on C# files): a leading U+FEFF changes no product. `parseTree` and `assembleChunks` drop it; pinned by K13 (Task F) and a real BOM file in the C# fixture (Task C).
3. **Mixed-language repos** (VS Code's Rust `cli/`, AFFiNE's Rust): TypeScript's stored facts are identical before and after. Pinned by Task F's dump comparison (F1, F14) and Task I's L5.
4. **Two files declaring one name** (Go build-tag twins, Java duplicate qualified names across modules, C# partial types, two Python packages called `app`): each language's rule below, and a fixture case for each in its task.
5. **Generated files over the size caps** (a 3 MB `*.pb.go`, a 6 MB C# designer file): the `parse` and `scan` readings. Pinned by K7 with lowered caps (Task F) and each language's scan rule.

---

## File structure

```
lib/index/languages/
  adapter.ts              F  the types (below)
  typescript-rules.ts     F  TypeScript's pure rules; TYPESCRIPT_EXTENSIONS and languageOf move here, re-exported by typescript.ts
  typescript-adapter.ts   F  typescriptAdapter: typescript.ts behind the seam (typescript.ts's products untouched)
  rules.ts                F  RULES and the pure helpers over them
  registry.ts             F  ADAPTERS, adapterFor, adapterById, prepareLanguages
  treesitter.ts           F  loadGrammars, isPrepared, parseTree, line and span helpers
  chunking.ts             F  assembleChunks (lib/chunks.ts's invariants for tree-sitter adapters)
  resolution.ts           F  edgesOf, createResolvers, entryPointsOf, ResolutionState
  grammars/               F  the five .wasm, grammars.json, NOTICE.md
  python/ go/ java/ csharp/ rust/
    rules.ts              F stub → its language task
    index.ts              F stub → its language task (the adapter)
    *.ts, *.test.ts       its language task only
test/helpers/
  fixture-truth.ts        F  the FixtureTruth type
  adapter-conformance.ts  F  describeAdapterConformance (checks K1–K13)
  toy-adapter.ts, toy-repo-truth.ts, adapter-conformance.test.ts   F
  <language>-repo-truth.ts  its language task
test/fixtures/toy-repo/   F
test/fixtures/<language>-repo/   its language task
lib/db/migrations/0010_e4_declares.sql   F
scripts/copy-grammars.mjs, scripts/dump-index.ts, scripts/sample-edges.ts   F
scripts/bench-languages.ts   I
```

Modified by Task F: `package.json`, `package-lock.json`, `lib/chunks.ts` (two exports, no behavior change), `lib/index/languages/typescript.ts` (re-exports only), `lib/index/discover.ts`, `lib/index/pipeline.ts`, `lib/index/update.ts`, `lib/index/watch.ts`, `lib/db/schema.ts`, `lib/db/store/structure.ts`, `lib/db/store/version.ts`, `lib/background/service.ts`, `scripts/background.ts`, `scripts/commands/index-command.ts`, `scripts/cli.ts`, `scripts/index.ts`, `scripts/report-resolution.ts`, `scripts/resolution.ts`, `lib/tools/answers.ts`, `lib/engine/impact.ts`, `lib/engine/architecture.ts`, and the docs named in F14. Modified by Task I: `app/map/syntax.ts`, `app/map/paths.ts`, `lib/engine/source.ts`, `lib/index/summarize/prompts.ts`, the `calls` answer, and the docs named in I6.

---

## Task F: the shared foundation

**Files:** the F entries above.

**Interfaces — Produces** (every language task builds on these exactly):

`lib/index/languages/adapter.ts`:

```ts
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
```

`rules.ts` (pure): `RULES: readonly LanguageRules[]` in the order typescript, python, go, java, csharp, rust; `rulesFor(path: string, rules?: readonly LanguageRules[]): LanguageRules | null` (the longest claimed extension `path` ends with); `claimedExtensions(rules?): string[]` (registry order, each once); `isManifestPath(path: string, rules?): boolean`; `exclusionFor(manifests: readonly string[], rules?): (path: string) => boolean`. The default for `rules` is `RULES` everywhere.

`registry.ts`: `ADAPTERS: readonly LanguageAdapter[]` (same order; each adapter's rules are the `RULES` entry's own object fields); `adapterFor(path, adapters = ADAPTERS): LanguageAdapter | null`; `adapterById(id, adapters = ADAPTERS): LanguageAdapter | null`; `prepareLanguages(adapters = ADAPTERS): Promise<void>`, which calls `loadGrammars` for every adapter whose `grammar` isn't null (stubs included).

`treesitter.ts`: `loadGrammars(list: readonly { id: string; grammar: string }[]): Promise<void>` (idempotent; loads the runtime once, then each grammar from `nebulosityPath("lib", "index", "languages", "grammars", grammar)`); `isPrepared(id: string): boolean`; `parseTree<T>(id: string, text: string, use: (root: Node) => T): T`, which drops one leading U+FEFF, parses, calls `use` and deletes the tree in a `finally`, and throws `GrammarNotLoadedError` when `id` isn't loaded; `class GrammarNotLoadedError extends Error` (its message names the ids and says to await `prepareLanguages()` first); `compileQuery(id: string, source: string): Query` (cached per id and source; it throws `GrammarNotLoadedError` like `parseTree`), so adapters can use tree-sitter queries without importing `web-tree-sitter` themselves (`Query` as a type import); `startLineOf(node: Node): number` and `endLineOf(node: Node): number` (1-based rows); `leadingSpan(node: Node, attached: (previous: Node) => boolean): { startLine: number; endLine: number }`, which extends the node's line range up over the previous siblings `attached` accepts while each ends on the line just above (no blank line). `Node` is `import type { Node } from "web-tree-sitter"`.

`chunking.ts`: `type Declaration = { kind: ChunkKind; name: string; startLine: number; endLine: number; exported: boolean }`; `assembleChunks(filePath: string, text: string, declarations: readonly Declaration[], summary: { imports: readonly string[]; exports: readonly string[] }): CodeChunk[]`. One leading U+FEFF is dropped first. Each declaration becomes a chunk whose text is exactly its whole lines `startLine..endLine` joined by `\n`, in the given order. Then comes the file-summary chunk, with text `File: <path>`, blank line, `Imports:`, the imports one per line or `  (none)`, blank line, `Exports:`, the exports one per line or `  (none)`, plus `name "(file)"`, `kind "file-summary"`, lines `1..max(1, countLines(text))`, `exported false` (the format of `lib/chunks.ts`'s `createFileSummaryChunk`). `fileHash` is the sha256 hex of the text. Finally `disambiguateIds` and then `splitOversizedChunks`, both exported unchanged from `lib/chunks.ts`. An export line reads `<name> (<kind>)`.

`resolution.ts`: `edgesOf(resolver: LanguageResolver, source: string, specifiers: readonly string[]): ImportEdge[]` (one edge per target file, in specifier order and then `resolve`'s order, named by the first specifier that reaches it, never `source` itself); `createResolvers(adapters: readonly LanguageAdapter[], base: Omit<ResolveContext, "files">, files: ReadonlyMap<string, StoredFacts>): Map<string, LanguageResolver>` (keyed by adapter id, each adapter given the files `adapterFor` maps to it, only adapters with at least one file); `entryPointsOf(resolvers: ReadonlyMap<string, LanguageResolver>): { path: string; declaredBy: string }[]` (registry order; one entry per path, the first one met winning, within one adapter too, since `entry_points` has a unique index; sorted by path); `type ResolutionState = { manifests: readonly string[]; cache: Map<string, unknown> }`.

Elsewhere:
- `IndexOptions.adapters?: readonly LanguageAdapter[]` (tests only, like `maxFileBytes`; default `ADAPTERS`).
- `applyFileChanges(repoRoot, changedPaths, options: { maxFileBytes?; parseMaxFileBytes?; hardMaxFileBytes?; resolution?: ResolutionState; adapters?: readonly LanguageAdapter[] })`, whose `FileChangeResult` carries `resolution: ResolutionState` in place of `workspace`.
- `discoverFiles(repoRoot, opts: { extensions?: readonly string[]; rules?: readonly LanguageRules[]; maxBytes?; parseMaxBytes?; hardMaxBytes? })`, where `extensions` defaults to `claimedExtensions(rules)`.
- `listManifests(repoRoot, rules?)`, `isTestPath(relPath, rules?)`, and `isExcludedPath(rel, { extensions, usedGit, exclude? })`.
- `FileRecord.declares: string[]` and `StoredFile.declares: string[]`.
- `readAdapterVersion(db, repoId, adapterId = "typescript")` and `recordAdapterVersion(db, repoId, version, unparsed, adapterId = "typescript")`, with the meta key `adapterVersion:<repoId>` for typescript and `adapterVersion:<repoId>:<adapterId>` for every other adapter.
- `SYMBOL_KINDS` gains `"struct"` and `"trait"`, appended.
- `runIndex(args): Promise<number>`.

`test/helpers/fixture-truth.ts`:

```ts
import type { ChunkKind } from "../../lib/contracts";
import type { SymbolRow } from "../../lib/db/schema";
import type { ReferenceKind } from "../../lib/index/languages/adapter";

export type TruthEdge = { source: string; target: string };

/** A language fixture's ground truth, written by hand from its files before the adapter's code (CLAUDE.md). */
export type FixtureTruth = {
    /** Every file of the adapter's language in the fixture that a full run indexes, sorted by path. */
    files: { path: string; language: string; isTest: boolean; lineCount: number }[];
    /** Files of the language that discovery must leave out (an excluded folder's), sorted. */
    excluded: string[];
    /** Each indexed file's specifiers from the full reading, in source order. */
    specifiers: Record<string, string[]>;
    /** Each indexed file's declares, sorted. */
    declares: Record<string, string[]>;
    /** Each indexed file's symbols, in source order. */
    symbols: Record<string, SymbolRow[]>;
    /** What kindOf returns for each specifier of each file. */
    kinds: Record<string, Record<string, ReferenceKind>>;
    /** Every import edge between the fixture's files after a full run, sorted by source, then target. */
    edges: TruthEdge[];
    /** Entry points, sorted by path. */
    entryPoints: { path: string; declaredBy: string }[];
    /** The fixture's file with a syntax error, and the specifiers still read from it. */
    broken: { path: string; specifiers: string[] };
    /** Where the scan reading differs from the full reading's imports, per file (deliberate differences only). */
    scan?: Record<string, string[]>;
    /** Chunks of the listed files, in order. Their text is checked against those lines. */
    chunks: Record<string, { kind: ChunkKind; name: string; startLine: number; endLine: number }[]>;
    /**
     * Edits applied one at a time to a fresh, indexed copy, each with every edge afterwards (sorted). Name-based languages
     * include one that changes a file's declares; every language includes one that changes the file set and one that
     * changes a manifest. A null write deletes the file.
     */
    edits: { description: string; writes: Record<string, string | null>; edgesAfter: TruthEdge[] }[];
};
```

`test/helpers/adapter-conformance.ts`: `describeAdapterConformance(adapter: LanguageAdapter, fixture: { name: string; truth: FixtureTruth }): void`. It registers one `describe(\`${adapter.id} adapter conformance\`)` that awaits `prepareLanguages([typescriptAdapter, adapter])` in `beforeAll`, indexes copies of `test/fixtures/<name>` with `adapters: [typescriptAdapter, adapter]`, and checks:
- K1 each claimed extension maps to the adapter (`adapterFor("x" + ext, [typescriptAdapter, adapter])`);
- K2 every truth file parses without throwing, twice, to deep-equal products;
- K3 `specifiers`;
- K4 `declares`;
- K5 `symbols`;
- K6 `chunks` for the listed files, and for every file: ids unique, the last chunk the `(file)` summary, each chunk's text equal to its lines, ranges inside the file;
- K7 the `parse` reading gives no chunks or symbols and the full reading's imports and declares; the `scan` reading gives no chunks, symbols or declares, and `truth.scan[path]` (else the full reading's imports); one file indexed with `maxFileBytes` and `parseMaxFileBytes` lowered under its size is stored imports-only;
- K8 the broken file's specifiers;
- K9 a full run's files (path, language, isTest, lineCount), no `excluded` file indexed, `edges`, `entryPoints`;
- K10 `kindOf` for every specifier equals `kinds`;
- K11 a second full run changes nothing (changed 0, the same edges);
- K12 each edit, applied through `applyFileChanges` passed the `resolution` a previous update returned (a warmed cache), gives `edgesAfter`. A fresh full run on the edited copy gives the same edges and the same entry points;
- K13 every truth file converted to CRLF gives the same specifiers, declares and symbols in all three readings, and with a leading U+FEFF the same products, chunk text included.

- [ ] **F1. The before-dumps.** Write `scripts/dump-index.ts <repo> --out <file> [--languages <a,b>]` (npm script `dump-index`; read-only through `useReadOnlyDatabase()`). It writes sorted, tab-separated lines in five sections:
  - `file` path language isTest lineCount contentHash specifiers-JSON declares-JSON (`declares` printed as `[]` while the column doesn't exist);
  - `edge` source target specifier;
  - `symbol` path qualifiedName kind startLine endLine exported;
  - `chunk` path chunkId startLine endLine sha256(text);
  - `entry` path declaredBy.

  It prints each section's line count and sha256. With `--languages`, only files of those `files.language` values, and only edges whose ends are both such files.

  Test it on the mini-repo (`scripts/dump-index.test.ts`, its lines from the V1.1 plan's ground truth). Commit and push. Then, before any other change, index `../vscode` and `../affine` with this commit's code, each into its own fresh `NEBULOSITY_DATA` scratch folder, dump them, and record each section's count and sha256 in `progress-F.md`. Keep the dump files in the scratch folders for diffing.
- [ ] **F2. Dependencies and grammars.**
  - Add the Global Constraints' exact pins and `npm install`.
  - Write `scripts/copy-grammars.mjs` (npm script `grammars`). It copies `tree-sitter-python.wasm`, `tree-sitter-go.wasm`, `tree-sitter-java.wasm`, `tree-sitter-c_sharp.wasm` and `tree-sitter-rust.wasm` from their packages into `lib/index/languages/grammars/`, and writes `grammars.json` (`[{ "id", "package", "version", "file", "sha256" }]`, ids python, go, java, csharp, rust) and `NOTICE.md` (each grammar's package, version, license MIT and copyright line from its `LICENSE`, plus web-tree-sitter's and smol-toml's).
  - Run it and commit the files.
  - Test (`lib/index/languages/grammars.test.ts`): every `grammars.json` entry's file exists and hashes to its `sha256`, and when `node_modules/<package>` exists the committed file is byte-equal to the package's.
  - Commit and push.
- [ ] **F3. Types and pure rules.**
  - Write `adapter.ts` as above.
  - Write `typescript-rules.ts`: `typescriptRules` has id `typescript`, `TYPESCRIPT_EXTENSIONS` and `languageOf` moved here from `typescript.ts` (which re-exports both, so no importer changes), `isTest` = `/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)`, `manifest` = today's `MANIFEST` (`discover.ts` re-exports it as `MANIFEST`), and `excluded` = `() => () => false`.
  - Write the five stub `rules.ts` files: `<id>Rules` with `extensions: []`, `languageOf: () => "<id>"`, `isTest: () => false`, `manifest: /(?!)/`, `excluded: () => () => false`.
  - Write `rules.ts`.
  - Test (`rules.test.ts`): the order of `RULES`; `rulesFor("src/a.tsx")?.id` is `"typescript"`; `claimedExtensions()` starts with `TYPESCRIPT_EXTENSIONS`, in order; no two rules share an extension; `isManifestPath("packages/x/package.json")` is true.
  - **No Task F test may assert anything about a stub's emptiness** (that `.py` is unclaimed, that `go.mod` isn't a manifest). Every Task F test must still hold after the language tasks fill in their own rules, so no language task ever edits a Task F test.
  - Commit and push.
- [ ] **F4. Tree-sitter, the registry and the stubs.**
  - Write `treesitter.ts` and `registry.ts`.
  - Write `typescript-adapter.ts`:
    - `version` is `ADAPTER_VERSION`, `grammar` null;
    - `parse` maps `full`, `parse` and `scan` to `parseTypeScriptFile`, `parseTypeScriptImportsOnly` and `scanTypeScriptImports`, plus `declares: []`;
    - `createResolver` reads its `Workspace` from `ctx.cache.get("typescript:workspace")`, else `readWorkspace(ctx.root, ctx.manifests.filter((m) => MANIFEST.test(m)))`, stored back. **Only its own manifests:** `readWorkspace` treats every non-package.json manifest as a tsconfig, so a `go.mod` would become a module-id root;
    - `resolve` wraps today's `createResolver` as `[t]` or `[]`;
    - `kindOf` is `"internal"` for a relative specifier or one that resolves, else `"external"`;
    - `entryPoints` is `declaredEntries(workspace, createSourceFinder(fileSet, workspace))`.
  - Write the five stub `index.ts` files: `<id>Adapter` with the stub rules, `version: 0`, and `grammar` set to its file name (`tree-sitter-python.wasm`, `tree-sitter-go.wasm`, `tree-sitter-java.wasm`, `tree-sitter-c_sharp.wasm`, `tree-sitter-rust.wasm`); `parse` and `createResolver` throw `new Error("<id> adapter not built yet")`.
  - Tests (`treesitter.test.ts`, `registry.test.ts`):
    - after `prepareLanguages()`, `isPrepared` holds for all five;
    - `parseTree` gives root types `module` for `import os\n` (python), `source_file` for `package main\n` (go), `program` for `class A {}` (java), `compilation_unit` for `class A {}` (csharp), and `source_file` for `fn main() {}` (rust), with `hasError` false;
    - a text starting with the byte-order mark U+FEFF (built in the test with `String.fromCharCode(0xfeff)` before `import os` and a newline) parses with `hasError` false;
    - `parseTree("nope", …)` throws `GrammarNotLoadedError`;
    - `parseTree` deletes the tree when `use` throws (spy on the tree's `delete`);
    - `typescriptAdapter.parse` deep-equals `parseTypeScriptFile` plus `declares: []` on a mini-repo file.
  - Commit and push.
- [ ] **F5. Chunking.** Export `disambiguateIds` and `splitOversizedChunks` from `lib/chunks.ts` (no other change), then write `chunking.ts`. Tests (`chunking.test.ts`, values worked out by hand):
  - a 12-line text with declarations at lines 1–3 and 5–12 gives two chunks with exactly those lines, then the summary `File: a.py\n\nImports:\nimport os\n\nExports:\nf (function)` with lines 1–12;
  - two declarations named `f` get ids `a.py#f#0` and `a.py#f~2#0`;
  - a 450-line declaration splits into parts at lines 1–200, 198–397 and 395–450;
  - an empty text gives only the summary, at lines 1–1, with `  (none)` twice;
  - a leading U+FEFF gives the same chunks as without it.
  - Commit and push.
- [ ] **F6. The store.**
  - `files.declares` (`text("declares").notNull().default("[]")`) and `"struct"` and `"trait"` appended to `SYMBOL_KINDS`, in `lib/db/schema.ts`.
  - `npx drizzle-kit generate --name e4_declares` writes `lib/db/migrations/0010_e4_declares.sql` (one `ALTER TABLE \`files\` ADD \`declares\` text DEFAULT '[]' NOT NULL;`) with its snapshot and journal entry.
  - `FileRecord.declares` written and `StoredFile.declares` read (JSON); `scripts/dump-index.ts` reads the column from here on.
  - The version store's adapter id parameter.
  - Tests:
    - a record with `declares: ["package:x"]` reads back equal;
    - a database at migration 0009 migrates with every file's `declares` `[]`;
    - `readAdapterVersion(db, 1, "python")` reads key `adapterVersion:1:python`;
    - the typescript default key is unchanged (`adapterVersion:1`);
    - `recordAdapterVersion(…, "go")` clears only the hashes it's given.
  - Commit and push.
- [ ] **F7. Discovery.**
  - `discoverFiles` takes `rules`. A path is a manifest when any rules' `manifest` matches it, and it's still a code file when an adapter claims its extension (`setup.py` is both). Code files that `exclusionFor(manifests, rules)` rejects are dropped silently, in both modes.
  - `isTestPath(relPath, rules = RULES)` is the shared folder rule, or `rulesFor(relPath, rules)?.isTest(relPath)`.
  - `listManifests(root, rules)` matches the same patterns.
  - `isExcludedPath` takes `exclude`.
  - Tests use a test rules object `toy` (`extensions [".toy"]`, `manifest /(^|\/)(toy\.json|setup\.toy)$/`, `excluded`: files under `<dir of a toy.json>/deps/`, `isTest`: `/_test\.toy$/`):
    - a `toy.json` lands in `manifests`, and `setup.toy` lands in both `manifests` and `files`, as `setup.py` will;
    - `deps/x.toy` beside a `toy.json` is absent in git and walk mode, and a `deps/x.ts` (TypeScript's) is present;
    - `isTestPath("lib/a_test.toy", [typescriptRules, toy])` is true and `isTestPath("lib/a_test.toy")` false;
    - every existing discover test passes unchanged.
  - Commit and push.
- [ ] **F8. Resolution and the full run.**
  - Write `resolution.ts`.
  - In `pipeline.ts`:
    - discovery with `rules: adapters`;
    - **the guard:** after discovery, if any adapter with a grammar has a discovered file and `!isPrepared(id)`, throw `GrammarNotLoadedError` with those ids;
    - re-parse per adapter: a file is parsed whatever its hash when its adapter's stored version differs from `adapter.version`;
    - `toFileRecord(filePath, text, contentHash, sizeBytes, opts: { importsOnly?: "parse" | "scan"; adapters? })` calls `adapter.parse(path, text, opts.importsOnly ?? "full")`. `kind` is `component` only for TypeScript's `.tsx`/`.jsx`, else `module`. `language` comes from `adapter.languageOf` and `isTest` from `isTestPath(path, adapters)`;
    - resolution through `createResolvers` with `{ root, fileSet, manifests: discovered.manifests, readText, cache: new Map() }`, `edgesOf` per file, `entryPointsOf` into `replaceEntryPoints`;
    - `recordAdapterVersion` for every adapter in `adapters`, each with its own files' unparsed list.
  - The toy *adapter* (`test/helpers/toy-adapter.ts`, the toy rules plus):
    - `version` 1, `grammar` null;
    - `parse` is line-based: `use <p>` → specifier `use:<p>`, `name <N>` → `name:<N>`, `def <N>` → declare `def:<N>` and a function symbol and declaration on that line, a `main` line → declare `main`; `parse` keeps imports and declares; `scan` keeps only `use:` lines; a leading U+FEFF is dropped;
    - its resolver: `use:<p>` → `<p>.toy` when indexed; `name:<N>` → the other files in the importer's folder declaring `def:<N>`; `kindOf` `internal` for both; entry points are files declaring `main`, declared by `toy main`.
  - Tests with `adapters: [typescriptAdapter, toyAdapter]` on small temp repos:
    - edges of both kinds;
    - a toy file whose `use` names its own path gets no self edge: `edgesOf` drops the `[importer]` result;
    - entry points;
    - bumping the toy version to 2 re-parses only `.toy` files (TypeScript's counted unchanged);
    - an unprepared grammar adapter (a toy with `grammar: "missing.wasm"`) makes `indexRepository` throw `GrammarNotLoadedError`;
    - a `go.mod`-like toy manifest beside TypeScript files leaves TypeScript's edges as they were;
    - **long paths:** a copy of the mini-repo under a folder deep enough that every absolute path passes 260 characters (Windows' MAX_PATH; spring-boot has 14 such paths), indexed by walking, gives the same files and edges as a plain copy;
    - every existing pipeline test passes unchanged.
  - Commit and push.
- [ ] **F9. The incremental update, the worker and the watcher.**
  - In `applyFileChanges`:
    - `excluded` uses `claimedExtensions(adapters)` and `exclusionFor(state.manifests, adapters)`;
    - the guard as in F8, for the files about to be parsed;
    - `resolvedAll` (the file set changed, or a path matches `resolvesEverything`, now TypeScript's `RESOLUTION_INPUT` or `isManifestPath`) starts a new state `{ manifests: listManifests(root, adapters), cache: new Map() }`, else `options.resolution` is reused;
    - **the declares rule:** when a changed file's new `declares` differ from its stored ones, every file of that adapter is re-resolved (its sources added to the diffed set), and the entry points are computed again;
    - a manifest added or deleted re-applies the exclusions both ways: files newly excluded leave the index, and files no longer excluded are found by listing the repo's files again, as a full run would;
    - it returns `resolution`.
  - `lib/background/service.ts` keeps `resolution` where it kept `workspace`, with the same lifetime.
  - `watch.ts`'s `isWatchedFile` also accepts a claimed extension or `isManifestPath`.
  - Tests with the toy adapter:
    - moving `def x` from `b.toy` to `c.toy` (same folder) moves `a.toy`'s edge from `b` to `c` incrementally, as a full run does;
    - a new `toy.json` beside a `deps/` folder removes `deps/*.toy` from the index;
    - an update without a manifest change reuses `resolution` (the same `cache` object);
    - the service passes it back (its existing tests, renamed from workspace);
    - `isWatchedFile` accepts a path for every extension in `claimedExtensions()` and every path `isManifestPath` accepts. The test iterates over `RULES`, so it holds as the languages land.
  - Commit and push.
- [ ] **F10. Entry-point wording.**
  - `lib/engine/impact.ts`'s `Roots` and `lib/engine/architecture.ts`'s `Unused` gain `manifestOnly: boolean`: true when every path in `declared` has a `declaredBy` containing `package.json`. The engine reads `declaredBy` from `entry_points`.
  - In `lib/tools/answers.ts`, when `manifestOnly` is false the three phrases become:
    - `Entry points that load it (N):` for `Entry points a package.json names that load it (N):`;
    - `Entry points (N):` for `Named as entry points by a package.json (N):`;
    - `(N entry point(s))` for `(N entry point(s) named by a package.json)`, through the same `plural`.
  - When it's true, they're unchanged.
  - Update API_CONTRACTS.md §17's text.
  - Tests: one entry declared by `Cargo.toml [lib]` gives the new phrase in each of the three places; every existing answers test passes unchanged.
  - Commit and push.
- [ ] **F11. Where the grammars load.**
  - `runIndex` becomes async and awaits `prepareLanguages()` before `indexRepository`; `scripts/cli.ts` and `scripts/index.ts` await it.
  - `scripts/background.ts` awaits `prepareLanguages()` before `createBackgroundService` (inside an async start, since the script is CommonJS).
  - Every other script that calls `indexRepository` or `applyFileChanges` (grep `scripts/`) awaits it first.
  - Tests: `runIndex` on the mini-repo resolves to 0; the existing cli tests pass with `await`.
  - Commit and push.
- [ ] **F12. The conformance kit, on the toy.**
  - Write `fixture-truth.ts` and `adapter-conformance.ts` as above.
  - Design `test/fixtures/toy-repo/` (about 8 files: a `toy.json` with a `deps/` folder, a test file, a broken file with an unknown line kind, an entry point, a `name` lookup across two files) and write `test/helpers/toy-repo-truth.ts` **by hand from those files**.
  - `test/helpers/adapter-conformance.test.ts` runs `describeAdapterConformance(toyAdapter, { name: "toy-repo", truth })`, all of K1–K13 green.
  - Commit and push.
- [ ] **F13. The resolution report and the sample.**
  - `scripts/report-resolution.ts` keeps TypeScript's lines exactly. Then, for each other adapter with files, it prints:
    - `[resolution] <id>: internal <resolved>/<total> (<pct>) · external <n> · context <n>`;
    - one line per class (`classOf`, else the text before the specifier's first `:`): `[resolution] <id> <class>: internal <resolved>/<total> (<pct>)`;
    - up to 20 lines `[resolution] <id> miss <importer> <specifier>`, the misses in a fixed order (path, then specifier).

    A reference is resolved when `resolve` returns any path, the importer itself included.
  - `scripts/sample-edges.ts <repo> --language <files.language> [--count 30] [--seed 1] [--unresolved 20]` (npm script `sample-edges`) draws with `mulberry32` (`scripts/eval/stats.ts`) the stored edges whose source has that language. It prints `<source> -> <target>  (<specifier>)`, then the unresolved internal references, re-resolved from the stored specifiers.
  - Tests: the report on the toy repo (hand-counted); the sample's order for seed 1 on the toy repo.
  - Commit and push.
- [ ] **F14. The after-dumps, docs, push.**
  - Index `../vscode` and `../affine` again with this code into fresh scratch folders and dump them: **every section's count and sha256 must equal F1's**, and `file` lines differ only in `declares`, which F1 printed as `[]` too. Record it in `progress-F.md`. On any difference, stop and diff.
  - Docs:
    - ARCHITECTURE.md §5 (the `languages/` layout and the two layers) and §3 rule 3, unchanged except a note that `rules.ts` is pure but not imported by the UI;
    - DATABASE_DESIGN.md (`files.declares`);
    - ADR-065, a line "Task F built (2026-10-24 or 25): <commit>; the TypeScript dumps of VS Code and AFFiNE unchanged".
  - The gate. Push `pivot/e4`. `progress-F.md` lists the commits, the suite count and the dumps' equality. The language tasks start from this commit.

---

## The language tasks (P, G, J, C, R): what every one does

**Files: only these.**
- `lib/index/languages/<id>/**` (the stub `rules.ts` and `index.ts` become real; add `parse.ts`, `resolve.ts`, `scan.ts` and so on as you like, plus their `*.test.ts` and `conformance.test.ts`);
- `test/fixtures/<id>-repo/**`;
- `test/helpers/<id>-repo-truth.ts`;
- `progress-<id>.md` in the ledger.

**Interfaces.**
- Consumes Task F's `adapter.ts`, `treesitter.ts` (`parseTree`, `compileQuery`, `startLineOf`, `endLineOf`, `leadingSpan`), `chunking.ts` (`assembleChunks`), `fixture-truth.ts`, `describeAdapterConformance`, `smol-toml` (`parse`), `lib/index/paths.ts`'s path helpers and `typescript.ts`'s `countLines`.
- Produces `<id>Rules: LanguageRules` from `rules.ts` and `<id>Adapter: LanguageAdapter` from `index.ts`, with `version: 1` and the grammar file Task F set. Nothing outside the folder imports anything else from it.

**Steps.**
- [ ] **1. The fixture and its truth, by hand.** Build `test/fixtures/<id>-repo/` to the task's fixture list: about 20–30 small files, every case present. Then write `test/helpers/<id>-repo-truth.ts` (a `FixtureTruth`) **by reading those files**, before any adapter code. Put a comment on each edge naming the rule that makes it, and a header saying it was derived by hand. Commit (`test(<id>): the <id>-repo fixture and its hand-derived truth`) and push. The reviewer of this task re-derives the truth independently from the fixture's files before approving the task.
- [ ] **2. Rules.** `rules.ts` to the task's table. Tests (`rules.test.ts`): each test-file rule with a positive and a negative path; the manifest pattern; the exclusion on a manifest list. Commit, push.
- [ ] **3. Parse.** `parse` for the three readings: specifiers, declares, symbols, chunks (through `assembleChunks`), line count, `calls: emptyCallFacts()` (from `typescript-calls.ts`). Tests (`parse.test.ts`) transcribe the truth for at least five files, including the broken one. Commit, push.
- [ ] **4. Resolve.** `createResolver` with `resolve`, `kindOf` and `entryPoints`. Tests (`resolve.test.ts`) transcribe the truth's edges, kinds and entry points, one test per rule. Commit, push.
- [ ] **5. Conformance.** `conformance.test.ts`: `describeAdapterConformance(<id>Adapter, { name: "<id>-repo", truth })`, all of K1–K13 green. Commit, push.
- [ ] **6. The real repo** (L2–L4; L1's timing is Task I's). From this worktree, with `NEBULOSITY_DATA` set to a fresh scratch folder:
  - `npm run index -- <repo>`;
  - `npm run report-resolution -- <repo>`;
  - `npm run sample-edges -- <repo> --language <language> --count 30 --seed 1 --unresolved 20`.

  Record in `progress-<id>.md`: files indexed by language, failures, the report's shares against the task's L3 bars, and the 30 edges and 20 misses for the reviewer to read (L4: at least 29 of the 30 correct, each of the 20 explained).

  Under a bar, read the misses, add a fixture case and its truth for each class you fix (truth first), fix, and re-run. At most three rounds. Then stop and record the shortfall: Task I leaves that language out.
- [ ] **7. Gate and push** the branch `pivot/e4-<id>`. `progress-<id>.md` ends with the last commit, the suite count, L2–L4 as measured, and every choice this plan left open.

**Common rules.**
- Every tree goes through `parseTree` (it deletes the tree). Read the grammar's `node-types.json` in its devDependency for node and field names.
- **Symbols:** the top-level declarations, plus the members of top-level types (one level, including nested types as members), in source order. `qualifiedName` is `parent.name`, and `parentQualifiedName` is the parent's qualifiedName or null. Lines run from the declaration's first line to its last: its decorators, annotations or attributes included, as TypeScript's `getStart` includes decorators, and its comments left out. Python's `decorated_definition` starts at its first decorator, Rust's attached `#[…]` items before an item count, and Java's and C#'s sit inside the declaration already.
- **Placed, no edge:** a reference whose target is the importer's own file (Rust's `use super::*` inside an inline `mod tests`), or whose edges another specifier of the same file carries (a Go import whose uses resolve), resolves to `[importer]`, never to `[]`.
- **Chunks:** one per top-level declaration. The span is `leadingSpan` over attached comments, decorators or attributes. The summary's imports are each import statement's text trimmed, one per line; its exports are the exported top-level declarations as `<name> (<kind>)`.
- **The `scan` reading** is a line scan of the import forms below, with no tree. Its known differences from `full` go in `truth.scan`.
- **Specifiers** are written exactly as each task's table says. A malformed construct gives no specifier rather than a guess.
- **`kindOf`** is `internal` for every specifier that resolves to a file, whatever the task's own table says.
- **Chunk kinds** (the controller's ruling of 2026-10-25, after Task F's review M1, made for the owner overnight). `ChunkKind` (`lib/contracts.ts`) has no `struct` or `trait`, and it doesn't gain them (`CONTRACTS_VERSION` 3, no contract change). So the five languages map their declarations the same way:
  - a struct (Go's `type T struct`, C#'s `struct` and `record struct`, Rust's `struct`) is `"class"`, as are Java's and C#'s `record`;
  - a trait (Rust) is `"interface"`, like Go's, Java's and C#'s interfaces;
  - an enum is `"enum"`;
  - a named type that is neither a struct nor an interface (Go's `type X int`, Rust's and C#'s aliases) is `"type"`;
  - a constant or static is `"const"`;
  - a module or namespace declaration, where one is chunked, is `"namespace"`.
  Symbols keep the precise kinds (`struct`, `trait`, …): only chunks take this coarse mapping.
- **Manifests in excluded folders** (Task F's review M10): `ResolveContext.manifests` holds every manifest discovery found, including those under folders your own `excluded()` leaves out (a vendored `go.mod` under `vendor/`, a `Cargo.toml` under `target/`). Your resolver ignores those.
- **Report classes** (Task F's review M11): without `classOf`, the resolution report's class is the text before a specifier's first `:`. So prefix every specifier with `<class>:`, as the task tables do, or implement `classOf`.

---

## Task P: Python

`pythonRules`:
- extensions `[".py", ".pyi"]`, `languageOf` → `"python"`;
- `isTest`: the basename matches `^test_.*\.pyi?$`, `^.*_test\.pyi?$`, `^tests\.py$` or `^conftest\.py$`;
- `manifest`: `/(^|\/)(pyproject\.toml|setup\.cfg|setup\.py|pyvenv\.cfg)$/`;
- `excluded`: every file under the folder of a `pyvenv.cfg` (a virtual environment).

**Specifiers** (source order, each once):
- `import a.b.c` and `import a.b.c as d` → `a.b.c`;
- `from a.b import c, d` → `a.b:c`, `a.b:d`; `from a.b import *` → `a.b:*`;
- relative: `from . import c` → `.:c`; `from .m import c` → `.m:c`; `from ..m.n import c` → `..m.n:c`;
- `__import__("a.b")`, `importlib.import_module("a.b")` and `import_module("a.b")` (when `import_module` was imported from `importlib`), with one plain string literal → `a.b`;
- nothing for `from __future__ import …`, for a non-literal argument, or for an f-string;
- imports inside functions, `try` blocks and `if TYPE_CHECKING:` count.

**Declares:** `["__main__"]` when the module has a top-level `if __name__ == "__main__":` (either quote style, either operand order), else `[]`.

**Resolution.**
- **Packages and roots.** A package is a folder holding `__init__.py` or `__init__.pyi`; a top-level package is one whose parent folder isn't a package, and its parent folder is a root. The roots are:
  - those parents;
  - `""` (the repo root);
  - each manifest's folder and its `src/` when it holds indexed files;
  - and the folders a `pyproject.toml` names, relative to it: `[tool.setuptools.packages.find] where`, `[tool.setuptools] package-dir` values, `[tool.poetry] packages[].from`, the folder part of each `[tool.hatch.build.targets.wheel] packages` entry, and `[tool.pytest.ini_options] pythonpath`.
- **A module path `a.b.c` under a root `r`** is the first indexed one of `r/a/b/c.py`, `r/a/b/c/__init__.py`, `r/a/b/c.pyi`, `r/a/b/c/__init__.pyi`.
- **Absolute `a.b.c` from file F:**
  - first the roots that contain F, deepest first (`""` contains every file, so it's last of them): the first hit wins;
  - else among all other roots: exactly one hit resolves, and two or more resolve to nothing.
- **`X:name`** tries the submodule `X.name` first, then the module `X`. `X:*` and plain `X` are the module `X`.
- **Relative:** the base is F's folder, up one folder per dot after the first (past the repo root resolves to nothing); then `.:c` is `base/c` as a module, else the package `base/__init__`, and `.m:c` is `base/m/c`, else `base/m`. No edge goes to the `__init__.py` files above the named module.
- **`kindOf`:**
  - relative → internal;
  - absolute → internal when it resolves, or when its first segment is a top-level package's name or a module `<root>/<segment>.py(i)` under any root;
  - else external. (A namespace package's import is internal only when it resolves, so a stdlib name like `email` beside a stray `email/` folder isn't counted as a miss.)
- **Entry points** (`declaredBy` exactly):
  - `<manifest path> [project.scripts] <name>`, `… [project.gui-scripts] <name>`, `… [project.entry-points.<group>] <name>` and `… [tool.poetry.scripts] <name>`, for targets `pkg.mod:attr`, resolved as absolute modules with the manifest's folder and its `src/` tried first;
  - `<setup.cfg path> [options.entry_points] console_scripts <name>`;
  - `__main__.py` for every `__main__.py`;
  - `if __name__ == "__main__"` for a file declaring `__main__`.

**Symbols:**
- top-level `def` and `async def` → function, `class` → class;
- a module-level assignment's targets (each name in a tuple target; annotated assignments too) → const; `type X = …` → type;
- in a top-level class: methods → method, `__init__` → constructor, a method decorated `@property` or `@<x>.setter`/`.deleter` → accessor, class-level assignments and annotations → property, nested classes → class.
- **Exported:** when the module assigns `__all__` a list or tuple of string literals at top level, exactly those names; otherwise names not starting with `_`. A member is exported when its class is and its name doesn't start with `_`, or it's a dunder (`__x__`).

**Chunks:** top-level functions and classes (the span includes decorators, and comments directly above) → function, class; top-level assignments → const.

**Scan:** lines starting at column 0 with `import ` or `from … import` (a parenthesized list continued over several lines is read to its `)`).

**Fixture list** (`test/fixtures/python-repo/`):
1. a src-layout package (`pyproject.toml` with `[tool.setuptools.packages.find] where = ["src"]`, `src/shop/…`) and a flat top-level package beside it;
2. relative imports at one and two dots, `from . import x` and `from .m import n`, one written in an `__init__.py`;
3. `from pkg import submodule` (→ the submodule) and `from pkg import name` (→ `pkg/__init__.py`);
4. `import a.b.c` and `import a.b as ab`; `from x import *`;
5. a namespace package (a folder without `__init__.py` under a root) imported absolutely;
6. two top-level packages named `app` under two roots: resolved from inside each, nothing from a file outside both;
7. a Django-style `tests/` root (no `__init__.py`; test packages that import each other absolutely);
8. external imports (`os`, `typing`, `requests`);
9. `importlib.import_module("shop.plugins.x")` and a non-literal call;
10. `from __future__ import annotations`;
11. a `.pyi` beside its `.py`;
12. an `if TYPE_CHECKING:` import and an import inside a function;
13. one test file per name rule;
14. entry points of each kind;
15. `.venv/pyvenv.cfg` with `.venv/lib/site.py` (excluded);
16. a broken file with imports above the error;
17. an empty `__init__.py`;
18. `__all__`;
19. a decorated function and class, `@property`, `__init__`, a class attribute, a module constant, `async def`.

Edits:
- (a) add `pkg/name.py`, so `from pkg import name` moves to the new file;
- (b) change pyproject's `where`;
- (c) delete a module.

**`classOf`:** `relative` (a specifier starting with `.`), else `absolute`.

**L3 bars** (django `0e128d5`): internal `relative` ≥ 99%; internal `absolute` (their first segment a repo top-level name) ≥ 99%.

---

## Task G: Go

`goRules`:
- extensions `[".go"]`, `languageOf` → `"go"`;
- `isTest`: basename ends `_test.go`;
- `manifest`: `/(^|\/)go\.(mod|work)$/`;
- `excluded`: every file under `<folder of a go.mod>/vendor/`.

**Specifiers** (first occurrence order, each once):
- an import: `import:<path>` for each import spec, with ` as <alias>` when it has an alias (including `_` and `.`), e.g. `import:example.com/shop/internal/store as st`;
- a qualified use: `use:<x>.<Name>` for every selector or qualified type `x.Name` whose operand `x` is a plain identifier that's neither bound in the enclosing function nor declared at the file's top level. Bound means by a parameter, result, receiver, `:=`, `var`, `const`, `range`, type switch, type parameter or label anywhere in that function: a function-level approximation. The enclosing function is the outermost function or method declaration, or top-level function literal, that holds the identifier;
- an unqualified name: `name:<N>` for every identifier in an expression or type position that is:
  - not bound as above, and not declared at the file's top level;
  - not the operand of a `use:` selector (that one is read through its `use:`);
  - not a key in a keyed composite-literal element, not a label;
  - not one of Go's predeclared identifiers: `any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr true false iota nil append cap clear close complex copy delete imag len make max min new panic print println real recover`.

**Declares** (sorted): `package:<name>`, then each package-level name the file declares: funcs (not methods), types, vars, consts. Leave out `_` and `init`.

**Resolution.**
- **Modules:** each `go.mod`'s `module` path names its folder; `go.work`'s `use` folders' `go.mod` files count too, and a `replace <module> => <./ or ../ path>` in a `go.mod` or `go.work` names that folder.
- **An import path** names the folder under the module whose path is its longest prefix, plus the rest. It counts only if that folder holds an indexed non-test `.go` file.
- **A package's name** is its non-test files' `package:` declare. A file's import aliases are the explicit alias, else the imported repo package's name, else the path's last element with a `/v<N>` suffix dropped.
- **`use:x.N`:** when `x` is one of the file's import aliases, the files of that package declaring `N`. Otherwise it's read as `name:x`.
- **`name:N`:** the other files in the importer's folder with the same `package:` declaring `N`. A non-test importer never reaches a `_test.go` file. Dot-imported packages' files declaring `N` are tried too.
- **Several files declaring one name** (build-tag twins) all get the edge.
- **`import:` itself:**
  - with ` as _` or ` as .`: every non-test file of the package;
  - with no alias or any other alias: when at least one of the file's uses of that import resolves (worked out from the importer's own specifiers in `ctx.files`), `[importer]` (placed: its uses carry the edges); when none does, every non-test file of the package;
  - an import outside the repo's modules: `[]`.
- **`kindOf`:**
  - `import:` → internal when under a repo module, else external;
  - `use:x.N` → internal when `x` is an internal import's alias, or `x` reads as `name:x`; external when `x` is an external import's alias;
  - `name:` → internal.
- **Entry points:** files declaring both `package:main` and `main`: `package main, func main`.

**Symbols:**
- `func` → function; methods → method, parent the receiver's type name without `*` or type parameters;
- `type X struct` → struct, with its fields → property (parent X); `type X interface` → interface, with its methods → method; any other type spec or alias → type;
- `const` and `var` specs → const.
- **Exported:** an upper-case first letter.

**Chunks:**
- a function or method declaration → function, named `Name` or `Type.Name`;
- a type declaration → class (struct), interface or type, names joined by `, ` when grouped;
- `const`/`var` declarations → const.

**Scan:** `import "x"`, `import name "x"`, and each line of an `import ( … )` block.

**Fixture list** (`test/fixtures/go-repo/`):
1. `go.mod` `module example.com/shop` at the root, and a nested `tools/go.mod` `module example.com/shop/tools` (the longest prefix wins);
2. `internal/store` in two files: `store.go` (`type Store`, `func New`) and `extra.go` (`var DefaultSize`, a method on Store);
3. `internal/api` using `store.New` and `store.DefaultSize`;
4. `cmd/shop/main.go` (an entry point);
5. a folder `pkg/go-colors` with `package colors`, used as `colors.Red`;
6. `pkg/widgets/v2` with `package widgets`;
7. an aliased import, a blank import (`plugins`), a dot import;
8. same-package references across files;
9. a local shadowing a package-level name in one function and the name used elsewhere;
10. build-tag twins `sep_windows.go` and `sep_linux.go` declaring `func sep()`;
11. `store_test.go` (`package store`) and `api_test.go` (`package api_test`, importing api);
12. external imports (`fmt`, `github.com/other/lib`);
13. `vendor/github.com/x/y/y.go` beside `go.mod` (excluded);
14. an import whose only use names something undeclared (the package fallback);
15. a broken file;
16. a struct with fields, an interface, a const block, a type alias.

Edits:
- (a) move `DefaultSize` into `store.go` (declares change);
- (b) change `go.mod`'s module path;
- (c) add a file to `internal/api`.

**L3 bars** (prometheus `a2fda0e`): internal `import:` ≥ 99%; internal `use:` and `name:` ≥ 95%, with the miss classes named.

---

## Task J: Java

`javaRules`:
- extensions `[".java"]`, `languageOf` → `"java"`;
- `isTest`: basename matches `^.*(Test|Tests|IT|TestCase)\.java$`. The folder rule already covers `src/test/`;
- `manifest`: `/(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/`;
- `excluded`: files under `<folder of a pom.xml>/target/`, `<folder of a build.gradle(.kts)>/build/`, and `.gradle/` beside a gradle file.

**Specifiers:**
- single-type import → `import:a.b.C`;
- on-demand import → `import:a.b.*`;
- static import (single or `*`) → `static:a.b.C`, its class;
- `type:C` for each simple type name used: type identifiers in types, `new C(…)`, annotations, `C.class`, `C::m`, and the object of a method call or field access when it's an identifier starting with an upper-case letter that isn't a local, parameter or field of the file. Leave out names imported by a single-type import, names the file declares (all its types, at any depth) and type parameters;
- `qualified:a.b.C` for a fully qualified type name in code.

**Declares:** `package:<a.b>` (`package:` for the default package), `type:<a.b.C>` per top-level type, and `main:<a.b.C>` per top-level type declaring `public static void main(String[] …)` or `(String… …)`.

**Resolution.**
- **Qualified names** come from every file's `type:` declares. `import:` and `static:` resolve to the file(s) declaring the name; when none does, the last segment is dropped while the rest names a declared type (a nested type's import reaches its outer type's file). `import:a.b.*` makes no edge.
- **`type:C`**, in Java's own order: the importer's package `p.C`, then each on-demand import `w.C` (where `w` may be a type, for nested types); the first level with a hit wins.
- **`qualified:`** resolves like `import:`.
- **A name several files declare** goes to the one in the importer's source root (its folder minus its package path), else the one sharing the longest folder prefix with the importer; a tie resolves to nothing.
- **`kindOf`:**
  - `import:`, `static:` and `qualified:` → internal when their package (after dropping) is some file's `package:`;
  - `import:a.b.*` → context;
  - `type:C` → internal when some repo file declares a type whose simple name is `C`, else external.
- **Entry points:** `main:` → `public static void main`.

**Symbols:**
- class and record → class; interface and annotation type → interface; enum → enum;
- in a top-level type: methods → method, constructors → constructor, fields and enum constants → property, nested types → their kind.
- **Exported:** the `public` modifier (interface members: when the interface is public).

**Chunks:** top-level type declarations → class, interface, enum.

**Scan:** `package …;` and `import …;` lines.

**Fixture list** (`test/fixtures/java-repo/`):
1. a root `pom.xml` and modules `app/` and `lib/` with `pom.xml`, `src/main/java/com/example/…` and `src/test/java/…`;
2. a single-type import, a static member import, a static `*` import, a wildcard import with a simple name used;
3. a same-package reference without an import;
4. a nested type import (`com.example.lib.Outer.Inner`);
5. a qualified name in code;
6. an annotation the repo declares;
7. `new X()`, `X.class`, `X::m`, generics, extends and implements;
8. external imports (`java.util.List`, `org.junit.jupiter.api.Test`);
9. the duplicate qualified name `com.example.Sample` in `app/src/test` and `lib/src/test`, resolved within each module and to nothing from elsewhere;
10. a default-package file;
11. test files by name and by folder;
12. a `main` method;
13. `app/target/…/X.java` (excluded);
14. a broken file;
15. a record, an enum, an interface, an annotation type, a nested class with members.

Edits:
- (a) change a class's `package` line (declares change);
- (b) edit `pom.xml`;
- (c) add a same-package class that a simple name now resolves to.

**L3 bars** (spring-boot `11778bdc`): internal `import:`, `static:` and `qualified:` ≥ 99%; internal `type:` ≥ 95%.

**Long paths (L2):** spring-boot has 6 tracked `.java` files whose absolute paths pass 260 characters (14 tracked files in all). Step 6 lists them (`git -C ../spring-boot ls-files`, with the root's length added) and shows each one indexed: none failed, none missing. Node 24 read one such file correctly on 2026-10-24 (a 275-character path). If one fails, it's a shared fix: record it for Task I.

---

## Task C: C#

`csharpRules`:
- extensions `[".cs"]`, `languageOf` → `"csharp"`;
- `isTest`: a folder segment matching `/\.(Tests?|UnitTests|IntegrationTests|FunctionalTests)$/`, or a basename `*Tests.cs` or `*Test.cs`;
- `manifest`: `/(\.csproj|(^|\/)Directory\.Build\.props)$/`;
- `excluded`: files under `<folder of a .csproj>/bin/` and `<folder of a .csproj>/obj/`.

**Specifiers:**
- the file's usings: `using:A.B`; global using → `global:A.B`; `using static` → `static:A.B.C`, and `global using static` → `gstatic:A.B.C`; an alias → `alias:X=A.B.C`, and a global alias → `galias:X=A.B.C`;
- the file's namespaces, outermost first: `ns:A.B`, nested blocks giving `ns:A` and `ns:A.B`;
- `type:N` for each simple type name used: in types, base lists, `new N(…)`, generic `N<…>`, `typeof(N)`, `nameof(N)`, `is`/`as`/casts, catch types, attributes (`[N]` gives `type:N` and `type:NAttribute`), and static access `N.Member` when `N` starts upper-case and isn't a local, parameter, field or property of the file. Leave out names the file declares and type parameters;
- `qtype:A.B.N` for a qualified type name;
- `ext:M` for each invoked member name `x.M(…)` starting upper-case.

**Declares:**
- `type:A.B.C` for each type, nested ones as `A.B.C.D`, generic arity dropped;
- `ext:A.B.C.M` for each extension method: a static method whose first parameter has the `this` modifier, in a static class `C` in namespace `A.B`;
- `main:static` for a `static … Main(` method;
- `main:top-level` for top-level statements;
- the file's project-wide usings, exactly as its specifiers write them: every `global:`, `gstatic:` and `galias:` string. They change how every file of the project resolves, so a change to one must re-resolve them all (F9's declares rule).

**Resolution.**
- **A file's project** is the folder of the nearest `.csproj` above it (else the repo root). The project's usings are the `global:`, `gstatic:` and `galias:` declares of its files, plus the `.csproj`'s and `Directory.Build.props`' `<Using Include="X" />` items. A file-scoped `using:`, `static:` or `alias:` applies to its own file only.
- **`type:N`:**
  1. each enclosing namespace from the innermost out (`A.B.C`, `A.B`, `A`): the first one that holds `ns.N` wins;
  2. else every visible using's `u.N`, together (the file's `using:` and the project's);
  3. an alias `N` names its target;
  4. types nested in `static:` and the project's `gstatic:` types count too.
- **Every file declaring the chosen name** gets the edge (partial types). When the name is declared in several projects, the importer's project's files win.
- **`qtype:A.B.N`** is tried as written and under each enclosing namespace.
- **`ext:M`:** every extension method `M` whose namespace is enclosing or visible.
- **`static:` and `gstatic:`** name their type's file(s).
- **No edges** from `using:`, `global:`, `alias:`, `galias:` or `ns:`.
- **`kindOf`:**
  - `type:N` → internal when some repo type's simple name is `N`, else external;
  - `qtype:` → internal when its namespace part is declared in the repo;
  - `ext:M` → internal when some repo extension method is named `M`, else external;
  - `static:` and `gstatic:` → internal when its type is declared;
  - the other kinds → context.
- **Entry points:** `main:static` → `static Main`; `main:top-level` → `top-level statements`.

**Symbols:**
- class and record → class; struct and record struct → struct; interface → interface; enum → enum; delegate → type;
- in a top-level type: methods → method, constructors → constructor, properties, fields and events → property, indexers → accessor, nested types → their kind.
- No namespace symbols.
- **Exported:** the `public` modifier (interface members: when the interface is public).

**Chunks:** each type declaration at file or namespace level → class, interface, enum or type (struct → class).

**Scan:** `using …;` and `namespace …` lines.

**Fixture list** (`test/fixtures/csharp-repo/`):
1. projects `src/Shop.Core/Shop.Core.csproj` and `src/Shop.Web/Shop.Web.csproj`, and `tests/Shop.Core.Tests/Shop.Core.Tests.csproj`;
2. file-scoped and block namespaces, and a nested block;
3. `using`, `using static`, an alias, a `global using` in one Shop.Web file, and a `<Using Include="Shop.Core.Models" />` in Shop.Web.csproj;
4. a same-namespace reference, a parent-namespace reference and a qualified name;
5. a partial class across two files;
6. an extension method `AddShop(this IServiceCollection s)` in `Shop.Web.Extensions`, called with and without its using;
7. an attribute `[Audited]` (class `AuditedAttribute`);
8. generics, `typeof`, `nameof`, a base list;
9. external names (`System`, `Microsoft.Extensions.DependencyInjection`);
10. `Item` in two namespaces, told apart by the usings;
11. one qualified name declared in two projects;
12. test files by folder and by name;
13. `Program.cs` with top-level statements, and a `static void Main`;
14. `bin/` and `obj/` beside a `.csproj` (excluded);
15. a file that starts with a UTF-8 BOM;
16. a broken file;
17. a record, a struct, an enum, a delegate, properties, fields, an event, a constructor.

Edits:
- (a) rename a type (declares change);
- (b) add a `<Using Include>` to a `.csproj`;
- (c) delete one part of the partial class;
- (d) add a `global using` to one Shop.Web file, so another Shop.Web file's simple name now resolves (declares change through a project-wide using).

**L3 bars** (jellyfin `0786661`): internal `type:`, `qtype:`, `static:` and `gstatic:` ≥ 95%; internal `ext:` ≥ 95%, with the miss classes named.

**Watch in L4:** `ext:` can over-link on common names (`Add`, `Get`) when a repo extension method shares one with an instance method. If the sample shows it, narrow `ext:` to the names that no repo type also declares as an instance method, with a fixture case and its truth first.

---

## Task R: Rust

`rustRules`:
- extensions `[".rs"]`, `languageOf` → `"rust"`;
- `isTest`: basename `tests.rs`, `*_test.rs` or `*_tests.rs` (the folder rule covers `tests/`);
- `manifest`: `/(^|\/)Cargo\.toml$/`;
- `excluded`: files under `<folder of a Cargo.toml>/target/`.

**Specifiers.** Each carries the inline-module path it sits in, before a `|` (empty at file level; `tests` inside `mod tests { … }`; `a::b` for nesting), for example `use:|crate::a::Thing`, `use:tests|super::*` and `mod:|a`:
- `mod:<inline>|<name>` for `mod x;`, with `@<path>` when it has `#[path = "…"]`;
- `use:<inline>|<path>` for each leaf of a use tree:
  - groups expanded;
  - `self` in a group → its prefix;
  - a glob → `<prefix>::*`;
  - a rename → `<path> as <name>`;
- `extern:<name>` for `extern crate`;
- `path:<inline>|<a::b::c>` for each path of two or more segments in code (expressions, types, macro paths) whose first segment isn't `std`, `core` or `alloc`.

**Declares:** the file's `mod:` specifiers, the same strings, sorted.

**Resolution.**
- **Crates:** every `Cargo.toml` with a `[package]` (read with smol-toml). Its library name is `[lib] name`, else the package name with `-` replaced by `_`. Its roots, each a module tree's `crate`:
  - `[lib] path`, else `src/lib.rs`;
  - `src/main.rs`; `[[bin]]` paths; `src/bin/*.rs` and `src/bin/*/main.rs`;
  - `build.rs` (or `package.build`);
  - `tests/*.rs`, `examples/*.rs` and `benches/*.rs`, plus `[[test]]`, `[[example]]` and `[[bench]]` paths.
- **The module tree:**
  - a root's and a `mod.rs`'s children sit in its own folder; another file `x.rs`'s children sit in `<folder>/x/`;
  - an inline module adds its name as a folder;
  - `mod:…|y` is `y.rs`, else `y/mod.rs`, there; `@path` is relative to the declaring file's folder (and its inline folders);
  - a file reached from no root is an **orphan**.
- **Visible crate names:** every repo crate's library name, plus the importer's crate's dependency renames (`foo = { package = "bar", … }` → `foo`).
- **A path from module m** (the file's module plus the inline part):
  - `crate::` starts at m's crate root; `self::` at m; `super::` at m's parent (repeatable); `::x` names a crate;
  - a leading identifier `x` is, in turn: a child module of m; a name the same file's `use` (at the same inline level) binds, substituted; a visible crate name; else external.
  - The remaining segments walk down the module tree as far as they name modules. The target is the file of the deepest module reached; when that's the importer's own file (an inline module, or the file's own module, as with `use super::*` in an inline `mod tests`), the path resolves to `[importer]`. A glob is the module's file.
- **`mod:`** is the child's file. **`extern:x`** is crate `x`'s library root.
- **`kindOf`:** `mod:` → internal; `use:` and `path:` → internal when their start resolves by the rules above (crate, self, super, a child module, a binding to an internal path, a repo crate), else external. References from orphans are counted on their own report line and are left out of the L3 shares (rust-analyzer's `test_data`).
- **Entry points** (`declaredBy` exactly): `<Cargo.toml path> [lib]`, `<Cargo.toml path> src/main.rs`, `<Cargo.toml path> [[bin]] <name>`, `<Cargo.toml path> build`, `<Cargo.toml path> tests`, `<Cargo.toml path> examples` and `<Cargo.toml path> benches`, each for its root files.

**Symbols:**
- `fn` → function; struct and union → struct (named fields → property); enum → enum; trait → trait (its fns → method); type → type; const and static → const; inline `mod` → namespace; `macro_rules!` → function;
- fns in `impl` blocks → method, parent the self type's base name (`impl<T> Foo<T>` and `impl Tr for Foo` both give `Foo`).
- **Exported:** a visibility modifier that is exactly `pub`.

**Chunks:** function → function; struct and union → class; enum → enum; trait → interface; impl → class, named `impl Foo` or `impl Tr for Foo`; type → type; const and static → const; inline mod → namespace; macro → function. Attributes and `///` comments are attached.

**Scan:** `mod x;`, single-line `use …;`, `extern crate x;`.

**Fixture list** (`test/fixtures/rust-repo/`):
1. a workspace `Cargo.toml` (`members = ["crates/*"]`) with `crates/core` (`shop-core`, a lib), `crates/store` (`shop-store`) and `crates/cli` (a bin depending on `shop-core`, plus `store = { package = "shop-store", path = "../store" }`);
2. `mod a;` → `a.rs`, `mod b;` → `b/mod.rs`, `a/inner.rs` from `a.rs`, `#[path = "custom.rs"] mod renamed;`, `mod nested { mod deep; }`;
3. an inline `mod tests { use super::*; }` (placed, no edge: `[importer]`);
4. `use crate::a::Thing`, `use crate::b`, `use super::x`, `use self::inner::Y`, a grouped use, a glob, a rename;
5. `use shop_core::model::Order`, and `use store::Db` through the rename;
6. a `pub use` re-export in `lib.rs`, reached by another crate;
7. `crate::util::helper()` with no use;
8. external paths (`std::collections::HashMap`, `serde::Serialize`);
9. `mod missing;` with no file (an internal miss);
10. test, example, bench and build roots;
11. `target/` beside a `Cargo.toml` (excluded);
12. an orphan `.rs` in a `test_data/` folder;
13. a broken file;
14. fn, struct with fields, enum, trait with methods, impl blocks, a type alias, const, static, `macro_rules!`, a union.

Edits:
- (a) remove a `mod` line (declares change);
- (b) rename `shop-core`'s package in its `Cargo.toml`;
- (c) add `b/extra.rs` with its `mod` line.

**`classOf`:** `orphan` for every reference from an orphan file; else `mod` for `mod:`, `relative` for a `use:` or `path:` starting with `crate`, `self` or `super`, and `other` for the rest.

**L3 bars** (rust-analyzer `0c4d746`; the `orphan` class is reported, not barred): internal `mod` and `relative` ≥ 99%; internal `other` ≥ 95%.

---

## Task I: integration

**Files:** the merges; `app/map/syntax.ts`, `app/map/paths.ts`, `lib/engine/source.ts` and their tests; `lib/index/summarize/prompts.ts`; the `calls` answer in `lib/tools/answers.ts` and `lib/engine/calls.ts`; `scripts/bench-languages.ts`; the docs in I6.

- [ ] **I1. Merge** each language branch whose task finished with its bars met and its reviews passed, in the order python, go, java, csharp, rust: `git merge --no-ff pivot/e4-<id>`, then the gate after each. They touch disjoint files, so a conflict means a task broke its file list: stop and record it. A language that missed is left on its branch, with the reason in `progress-integration.md`.
- [ ] **I2. The Map's colors (C10).**
  - `app/map/syntax.ts` registers highlight.js's `python`, `go`, `java`, `csharp` and `rust` (`highlight.js/lib/languages/<name>`).
  - `app/map/paths.ts`'s `languageFor` and `lib/engine/source.ts`'s `languageOf` map `.py`/`.pyi` → python, `.go` → go, `.java` → java, `.cs` → csharp and `.rs` → rust, only for the merged languages.
  - Tests: a keyword of each gets `hljs-keyword`; the source answer for a `.py` file says `python`.
  - API_CONTRACTS §16's language list.
  - Commit and push.
- [ ] **I3. Words for the new languages.**
  - `calls` with a `path` of a non-TypeScript, non-JavaScript file answers `Calls are indexed for TypeScript and JavaScript only; <path> is <Language>.` (Language: Python, Go, Java, C#, Rust).
  - `testFileSummary`'s subject drops each merged language's test markers and extension (`test_views.py` → `views`, `server_test.go` → `server`, `OrderTests.cs` → `Order`, `OrderIT.java` → `Order`, `db_tests.rs` → `db`), with TypeScript's unchanged.
  - Tests for both. API_CONTRACTS §17 for the first.
  - Commit and push.
- [ ] **I4. L1 timings** (one repo at a time, nothing else running). `scripts/bench-languages.ts <repo>… [--runs 3]` indexes each repo cold into a fresh `NEBULOSITY_DATA` folder per run, in one process after one `prepareLanguages()`. It prints each run's stage timings and the process's rss after each. Run it on the merged languages' repos: L1 is ≤ 60 s at worst of three. Record Language Benchmark #1 in `docs/BENCHMARKS.md` with L1–L4 per repo (L2–L4 from the language tasks' progress files and the reviewers' verdicts), plus rss after all of them. Commit and push.
- [ ] **I5. L5 and S1.**
  - Index `../vscode` and `../affine` with the merged code into fresh folders, and dump them with `--languages typescript,javascript`: every section equals Task F's F1 dumps, which were TypeScript and JavaScript only, since nothing else was indexed then.
  - S1 on VS Code: worst of three cold runs ≤ 60 s (Index Benchmark #8).
  - Report the files each new language adds (counts by language; VS Code's `cli/` and AFFiNE's Rust).
  - `npm pack --dry-run --json` for the packed and unpacked sizes against ADR-058's 6.6 MB and 25.0 MB.
  - Record it all in BENCHMARKS.md. Commit and push.
- [ ] **I6. Docs, in one commit:**
  - ADR-065: built; the measured numbers; amendments noted in ADR-026, ADR-053 (R8 widened, the caps per language) and ADR-062;
  - PIVOT_SPEC.md: §2 S15 (L1–L4 per language, with the results) and S1's note (L5); §5.1 (discovery per adapter, the exclusions); §5.2 (parsing through adapters, `declares`); §10 E4 as built; §12's slice row; §15's table (ADR-062 to ADR-065);
  - ARCHITECTURE.md;
  - API_CONTRACTS.md §12 (the symbol kinds `struct` and `trait`);
  - DATABASE_DESIGN.md;
  - IMPLEMENTATION_ROADMAP.md's E4 row;
  - README.md: the languages read, what each one's benchmark measured, free mode; no speed-up claimed for the new languages (ADR-061);
  - BENCHMARKS.md.

  Commit and push.
- [ ] **I7. Final review** ("2026 10 25 E4 Final Review #1" in the ledger): a fresh reviewer reads `git diff pivot/v1...pivot/e4` against this plan and the design. Fix in waves until it's clean, and record each wave.
- [ ] **I8. Hand-over.** Push `pivot/e4`. `progress-integration.md` ends with:
  - what merged and what didn't, with reasons;
  - every measurement;
  - the calls the owner should check (design §5);
  - the design's morning questions (§11);
  - what's not done: CI on macOS and Linux (pushing to a `ci/` branch spends Actions minutes, so it waits for the owner's yes), the summaries for the new languages (a paid run), and the merge to `main` and the PR (the owner's).
