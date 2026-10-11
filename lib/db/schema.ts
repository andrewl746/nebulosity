import { sqliteTable, integer, text, uniqueIndex, index, blob } from "drizzle-orm/sqlite-core";

export const META_KEYS = {
    EMBEDDING_MODEL: "embeddingModel",
    EMBEDDING_DIM: "embeddingDim",
    SCHEMA_VERSION: "schemaVersion",
    INDEXING_LOCK: "indexing"
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
    importSpecifiers: text("import_specifiers").notNull().default("[]")
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
    key: text("key").notNull().unique(),   // "embeddingModel"
    value: text("value").notNull(),        // "Xenova/all-MiniLM-L6-v2"
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

export const vectors = sqliteTable("vectors", {
    id: integer().primaryKey({ autoIncrement: true }),
    chunkId: integer("chunk_id")
        .notNull()
        .references(() => chunks.id, { onDelete: "cascade" }),
    embedding: blob("embedding", { mode: "buffer" }).notNull()
});

export const SYMBOL_KINDS = [
    "function", "class", "method", "property", "accessor", "constructor",
    "interface", "type", "enum", "const", "namespace"
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
    tagline: text("tagline"),                     // ≤ 6 words; null until a summary exists
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

/** A symbol as the language adapter produces it and the store writes it: every column but the ids. */
export type SymbolRow = Omit<typeof symbols.$inferSelect, "id" | "fileId">;
/** A folder as the aggregator builds it and the store writes it. */
export type FolderRow = Omit<typeof folders.$inferSelect, "id" | "repoId">;
/** A level edge as the aggregator builds it and the store writes it. */
export type LevelEdgeRow = Omit<typeof levelEdges.$inferSelect, "id" | "repoId">;
