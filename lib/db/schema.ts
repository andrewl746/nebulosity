import { sqliteTable, integer, text, uniqueIndex, index, blob } from "drizzle-orm/sqlite-core";

export const META_KEYS = {
    INDEXING_LOCK: "indexing",
    SUMMARIZING_LOCK: "summarizing"
} as const;

export const repositories = sqliteTable("repositories", {
    id: integer().primaryKey({ autoIncrement: true }),
    rootPath: text("root_path").notNull().unique(),
    lastScanAt: integer("last_scan_at", { mode: "timestamp" }),
    lastIndexAt: integer("last_index_at", { mode: "timestamp" }),
    // the git commit the last index run saw (null outside git); lets later runs ask git what changed
    indexedHead: text("indexed_head")
});

export const files = sqliteTable("files", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind", { enum: ["component", "module"] }).notNull(),
    contentHash: text("content_hash").notNull(),
    language: text("language").notNull().default("typescript"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    lineCount: integer("line_count").notNull().default(0),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    // Raw import specifiers as a JSON array. Every run re-resolves every file's imports
    // (a new or deleted file changes what "../core" points at) without re-parsing the
    // files whose content hash is unchanged.
    importSpecifiers: text("import_specifiers").notNull().default("[]"),
    // What other files' resolution reads from this one, as a sorted JSON array (ADR-065): a Go file's package and
    // package-level names, a Java or C# file's types, a Rust file's mod lines. A changed file is re-parsed; its
    // neighbours are re-resolved from what is stored here, as they are from import_specifiers. [] for TypeScript.
    declares: text("declares").notNull().default("[]")
}, (t) => [
    uniqueIndex("files_repo_path_unique").on(t.repoId, t.path)
]);

export const imports = sqliteTable("imports", {
    id: integer().primaryKey({ autoIncrement: true }),
    sourceFileId: integer("source_file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    targetFileId: integer("target_file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    specifier: text("specifier").notNull()
}, (t) => [
    uniqueIndex("imports_source_target_unique").on(t.sourceFileId, t.targetFileId),
    index("imports_target_idx").on(t.targetFileId)
]);

export const chunks = sqliteTable("chunks", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    // unique per FILE (index below), not globally: many repos share one database and
    // two of them can both contain "src/index.ts#start#0"
    chunkId: text("chunk_id").notNull(),
    kind: text("kind", {
        enum: ["function", "class", "component", "interface", "type", "const", "enum", "namespace", "file-summary"]
    }).notNull(),
    name: text("name").notNull(),
    // the name as separate lowercase words ("openEditor" → "open editor"), so word search finds it (code_fts)
    nameSplit: text("name_split").notNull().default(""),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    partIndex: integer("part_index").notNull().default(0), // if the function is HUGE (e.g., 500 lines), split it into parts (0 for normal chunks, 1 for second part, 2 for third, etc.)
    text: text("text").notNull(), // the actual source code of this chunk (what the AI will read)
    fileHash: text("file_hash").notNull(), // sha256 of the whole source file at index time
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
}, (t) => [
    uniqueIndex("chunks_file_chunk_unique").on(t.fileId, t.chunkId)
]);

export const meta = sqliteTable("meta", {
    id: integer().primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),   // "indexing", "stage:3:summaries", "indexVersion:3"
    value: text("value").notNull(),        // a timestamp, a JSON stage status, a counter
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

/** struct (Go, C#, Rust) and trait (Rust) arrived with E4 (ADR-065, the design's C5), appended: SQLite has no CHECK on the column. */
export const SYMBOL_KINDS = [
    "function", "class", "method", "property", "accessor", "constructor",
    "interface", "type", "enum", "const", "namespace", "struct", "trait"
] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/** One row per top-level declaration and per class member. */
export const symbols = sqliteTable("symbols", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    qualifiedName: text("qualified_name").notNull(),   // "Logger.info" for members
    kind: text("kind", { enum: SYMBOL_KINDS }).notNull(),
    // the declaration itself, excluding its doc comment: these lines are for jumping to a definition
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    parentQualifiedName: text("parent_qualified_name")  // null for top-level declarations
}, (t) => [
    index("symbols_file_idx").on(t.fileId),
    index("symbols_name_idx").on(t.name)
]);

/** The folder tree of the indexed files. "" is the repo root. */
export const folders = sqliteTable("folders", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    parentPath: text("parent_path"),                         // null only for the root
    depth: integer("depth").notNull(),                       // root = 0
    name: text("name").notNull(),                            // the root uses the repo directory's name
    fileCount: integer("file_count").notNull(),              // source files anywhere below
    directFileCount: integer("direct_file_count").notNull()  // source files directly inside
}, (t) => [
    uniqueIndex("folders_repo_path_unique").on(t.repoId, t.path),
    index("folders_repo_parent_idx").on(t.repoId, t.parentPath)
]);

/**
 * The Map's lines, precomputed (PIVOT_SPEC.md §4.2). Each file→file import is
 * counted exactly once, at levelPath = the deepest folder containing both files;
 * sourceNode/targetNode are children of that folder (a subfolder, or the file
 * itself when it sits directly inside). Opening a folder is one indexed lookup.
 */
export const levelEdges = sqliteTable("level_edges", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    levelPath: text("level_path").notNull(),
    sourceNode: text("source_node").notNull(),
    targetNode: text("target_node").notNull(),
    count: integer("count").notNull()
}, (t) => [
    uniqueIndex("level_edges_unique").on(t.repoId, t.levelPath, t.sourceNode, t.targetNode)
]);

/** What a summary describes. "cluster" arrives with E5. */
export const SUMMARY_TARGET_KINDS = ["file", "folder", "repo"] as const;
export type SummaryTargetKind = (typeof SUMMARY_TARGET_KINDS)[number];

/**
 * fresh: the text matches the target's current input · stale: text from an older input,
 * kept on show until it's redone · pending: no text yet · failed: the last attempt
 * failed, retried next run · skipped: no model call on purpose, the text is a template
 * (test files). The API also reports "off" (no API key); that one is never stored.
 */
export const SUMMARY_STATUSES = ["fresh", "stale", "pending", "failed", "skipped"] as const;
export type StoredSummaryStatus = (typeof SUMMARY_STATUSES)[number];

/**
 * One summary per file, folder and the repo (PIVOT_SPEC.md §4.1, §5.3). Keyed by path,
 * never by a file or folder id: folders are rebuilt on every structure run, so their
 * ids don't last.
 */
export const summaries = sqliteTable("summaries", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    targetKind: text("target_kind", { enum: SUMMARY_TARGET_KINDS }).notNull(),
    targetPath: text("target_path").notNull(),   // "" for the repo itself
    tagline: text("tagline"),                     // 3–6 words asked for, up to 8 kept whole; null until a summary exists
    summary: text("summary"),                     // 2–4 sentences
    model: text("model"),                         // the model that wrote it, or "template"
    inputHash: text("input_hash"),                // hash(model, prompt version, input) of the text above
    status: text("status", { enum: SUMMARY_STATUSES }).notNull(),
    error: text("error"),                         // why the last attempt failed
    // A Message Batch can take hours. These two say which batch carries this row's request and
    // which input it answers, so a later run collects the answer instead of paying for it twice.
    batchId: text("batch_id"),
    pendingHash: text("pending_hash"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
}, (t) => [
    uniqueIndex("summaries_target_unique").on(t.repoId, t.targetKind, t.targetPath),
    index("summaries_batch_idx").on(t.batchId)
]);

/** One MiniLM vector per model-written summary (ADR-027), stored with the ADR-017 encode/decode pair. */
export const summaryVectors = sqliteTable("summary_vectors", {
    id: integer().primaryKey({ autoIncrement: true }),
    summaryId: integer("summary_id").notNull().unique().references(() => summaries.id, { onDelete: "cascade" }),
    embedding: blob("embedding", { mode: "buffer" }).notNull()
});

/** API spend per repo, model and transport, added up as answers arrive. Success criterion S2 is read from here. */
export const summaryUsage = sqliteTable("summary_usage", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    transport: text("transport", { enum: ["direct", "batch"] }).notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0)
}, (t) => [
    uniqueIndex("summary_usage_unique").on(t.repoId, t.model, t.transport)
]);

/** The files a package.json names as entry points (ADR-053, R8): main, module, types, bin, the "." export. */
export const entryPoints = sqliteTable("entry_points", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    declaredBy: text("declared_by").notNull()   // "packages/core/package.json main"
}, (t) => [
    uniqueIndex("entry_points_repo_path_unique").on(t.repoId, t.path)
]);

/** The repo's Markdown docs (ADR-054): their titles. */
export const docs = sqliteTable("docs", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    title: text("title").notNull()
}, (t) => [
    uniqueIndex("docs_repo_path_unique").on(t.repoId, t.path)
]);

export const DOC_LINK_KINDS = ["applies", "readme", "mentions"] as const;
export type DocLinkKind = (typeof DOC_LINK_KINDS)[number];

/** Which doc talks about which folder or file, and how (ADR-054); "" is the repo itself. */
export const docLinks = sqliteTable("doc_links", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    docPath: text("doc_path").notNull(),
    targetPath: text("target_path").notNull(),
    kind: text("kind", { enum: DOC_LINK_KINDS }).notNull(),
    count: integer("count").notNull(),
    detail: text("detail")   // the glob, for "applies"
}, (t) => [
    index("doc_links_repo_target_idx").on(t.repoId, t.targetPath)
]);

/** A doc as the docs reader produces it and the store writes it (declared here so the store never imports lib/index, ARCHITECTURE.md §3). */
export type DocFacts = { path: string; title: string };
/** A doc link as the docs reader produces it and the store writes it: every column but the ids. */
export type DocLinkRow = Omit<typeof docLinks.$inferSelect, "id" | "repoId">;

/** A symbol as the language adapter produces it and the store writes it: every column but the ids. */
export type SymbolRow = Omit<typeof symbols.$inferSelect, "id" | "fileId">;
/** A folder as the aggregator builds it and the store writes it. */
export type FolderRow = Omit<typeof folders.$inferSelect, "id" | "repoId">;
/** A level edge as the aggregator builds it and the store writes it. */
export type LevelEdgeRow = Omit<typeof levelEdges.$inferSelect, "id" | "repoId">;

/** How a call's receiver got its type, or (member null) what kind of injection site a fact is (ADR-059). */
export const CALL_RULES = [
    "param", "local", "destructure", "constraint", "cast", "provider", "new", "alias", "field", "this", "ctor-param", "inject-field",
    "super", "return", "member",
] as const;
export type CallRule = (typeof CALL_RULES)[number];

/**
 * A class or interface as the TypeScript adapter reads it (ADR-059). A TypeRef is a type as written: "IFoo", or "ns.IFoo"
 * through a namespace import; type arguments are dropped.
 */
export type TypeDeclFact = {
    /** null for a class expression with no name. */
    name: string | null;
    kind: "class" | "interface";
    /** 1-based: its name's line, or its `class` keyword's when it has no name. */
    line: number;
    exported: boolean;
    /** Inside a function, a namespace or an expression (R-O): an implementation all the same, but no import can name it. */
    nested: boolean;
    extendsRefs: string[];
    implementsRefs: string[];
    /** `class X extends mock<IFoo>()`: a test double of IFoo. */
    testDoubleOf: string | null;
    /** Its methods, accessors and properties (a class's constructor parameter properties too), sorted, each once. */
    members: string[];
    /** A class's field, or an interface's property → the type it is declared with, or sure to hold (`= new C()`, `= this._register(new C())`). */
    fields: Record<string, string>;
};

/** An import, a re-export or a local export, as call resolution follows them (ADR-059). */
export type BindingFact = {
    kind: "import" | "reexport" | "export";
    /** The name in this file: an import's local name; a re-export's or an export's exported name ("*" for `export * from`). */
    local: string;
    /** The name in the other module: "default", "*" (a namespace) or a name; for a local export, the local name it exports. */
    imported: string;
    /** null for a local export. */
    specifier: string | null;
};

/** A call on a value whose type a rule can read; with `member` null, a place a type is injected (ADR-059). */
export type TypedCallFact = {
    /** 1-based: a call's member name's line; an injection site's TypeRef node's line. */
    line: number;
    member: string | null;
    receiver: "type" | "field" | "this";
    /** "type": the TypeRef ("@<line>" for a nested or nameless class of this file, R-O); "field": the field's name; "this": null. */
    ref: string | null;
    /** "field" and "this": the type they resolve through, a TypeRef ("@<line>" for a nested or nameless class); otherwise the top-level class the call sits in, or null. */
    inClass: string | null;
    how: CallRule;
};

/** The adapter's fourth product of its one parse (ADR-059). */
export type CallFacts = { types: TypeDeclFact[]; bindings: BindingFact[]; calls: TypedCallFact[] };

/** Classes and interfaces, per file (ADR-059). Lists and maps are JSON text, read back by lib/db/store/calls.ts. */
export const typeDecls = sqliteTable("type_decls", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    name: text("name"),
    kind: text("kind", { enum: ["class", "interface"] }).notNull(),
    line: integer("line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    nested: integer("nested", { mode: "boolean" }).notNull().default(false),
    extendsRefs: text("extends_refs").notNull().default("[]"),
    implementsRefs: text("implements_refs").notNull().default("[]"),
    testDoubleOf: text("test_double_of"),
    members: text("members").notNull().default("[]"),
    fields: text("fields").notNull().default("{}"),
}, (t) => [
    index("type_decls_file_idx").on(t.fileId),
    index("type_decls_name_idx").on(t.name),
]);

/** Imports the call facts name, and every re-export and local export, per file (ADR-059). */
export const callBindings = sqliteTable("call_bindings", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["import", "reexport", "export"] }).notNull(),
    local: text("local").notNull(),
    imported: text("imported").notNull(),
    specifier: text("specifier"),
}, (t) => [
    index("call_bindings_file_idx").on(t.fileId),
]);

/** Typed calls and injection sites (member null), per file (ADR-059); looked up by member. */
export const typedCalls = sqliteTable("typed_calls", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    member: text("member"),
    receiver: text("receiver", { enum: ["type", "field", "this"] }).notNull(),
    ref: text("ref"),
    inClass: text("in_class"),
    how: text("how", { enum: CALL_RULES }).notNull(),
}, (t) => [
    index("typed_calls_file_idx").on(t.fileId),
    index("typed_calls_member_idx").on(t.member),
]);
