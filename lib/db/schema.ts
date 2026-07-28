import { sqliteTable, integer, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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