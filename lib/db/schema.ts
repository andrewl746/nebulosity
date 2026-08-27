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
    lastIndexAt: integer("last_index_at", { mode: "timestamp" })
});

export const files = sqliteTable("files", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind", { enum: ["component", "module"] }).notNull(),
    contentHash: text("content_hash").notNull()
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
    chunkId: text("chunk_id").notNull().unique(),
    kind: text("kind", {
        enum: ["function", "class", "component", "interface", "type", "const", "file-summary"]
    }).notNull(),
    name: text("name").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    partIndex: integer("part_index").notNull().default(0), // if the function is HUGE (e.g., 500 lines), split it into parts (0 for normal chunks, 1 for second part, 2 for third, etc.)
    text: text("text").notNull(), // the actual source code of this chunk (what the AI will read)
    fileHash: text("file_hash").notNull(), // sha256 of the whole source file at index time
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
});

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