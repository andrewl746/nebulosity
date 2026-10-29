import { and, eq, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../client";
import type { SymbolInfo } from "../../contracts";
import { files, folders, imports, levelEdges, summaries, symbols, type StoredSummaryStatus, type SummaryTargetKind } from "../schema";

/** A folder as the Map draws it. */
export type FolderInfo = { path: string; name: string; fileCount: number };

/** A file directly inside a folder, with how many files import it (its importance, which orders the boxes). */
export type ChildFile = { path: string; lineCount: number; importedBy: number };

/** What the Map shows of one target's summary. */
export type SummaryState = {
    kind: SummaryTargetKind;
    path: string;
    tagline: string | null;
    summary: string | null;
    /** The model that wrote the text, or "template". */
    model: string | null;
    /** The prompt version that wrote the text, null for a template or for text from before v3 (ADR-034). */
    promptVersion: number | null;
    status: StoredSummaryStatus;
    error: string | null;
};

/**
 * `column` holds a path strictly inside `folder` ("" means anywhere in the repo). It's a range, so SQLite answers it
 * from the (repo, path) index: every path that starts with "src/" sorts at or after "src/" and before "src0", because
 * "0" is the character right after "/".
 */
function inside(column: SQLiteColumn, folder: string): SQL {
    return folder === "" ? sql`1 = 1` : sql`${column} >= ${`${folder}/`} and ${column} < ${`${folder}0`}`;
}

/** `column` holds a path directly inside `folder`: inside it, with no "/" after the folder's own prefix. */
function directlyInside(column: SQLiteColumn, folder: string): SQL {
    const skip = folder === "" ? 0 : folder.length + 1;
    return sql`${inside(column, folder)} and instr(substr(${column}, ${skip + 1}), '/') = 0`;
}

const summaryColumns = {
    kind: summaries.targetKind,
    path: summaries.targetPath,
    tagline: summaries.tagline,
    summary: summaries.summary,
    model: summaries.model,
    promptVersion: summaries.promptVersion,
    status: summaries.status,
    error: summaries.error,
};

export function loadFolderInfo(db: Db, repoId: number, folderPath: string): FolderInfo | null {
    return db.select({ path: folders.path, name: folders.name, fileCount: folders.fileCount }).from(folders)
        .where(and(eq(folders.repoId, repoId), eq(folders.path, folderPath))).get() ?? null;
}

/** A folder's subfolders, in path order. */
export function loadChildFolders(db: Db, repoId: number, folderPath: string): FolderInfo[] {
    return db.select({ path: folders.path, name: folders.name, fileCount: folders.fileCount }).from(folders)
        .where(and(eq(folders.repoId, repoId), eq(folders.parentPath, folderPath))).orderBy(folders.path).all();
}

/** The files directly inside a folder, each with how many files import it, in path order. */
export function loadChildFiles(db: Db, repoId: number, folderPath: string): ChildFile[] {
    return db.select({ path: files.path, lineCount: files.lineCount, importedBy: sql<number>`count(${imports.id})` })
        .from(files)
        .leftJoin(imports, eq(imports.targetFileId, files.id))
        .where(and(eq(files.repoId, repoId), directlyInside(files.path, folderPath)))
        .groupBy(files.id)
        .orderBy(files.path)
        .all();
}

/** The summaries of a folder's direct children: its files and subfolders (never the repo's own). */
export function loadChildSummaries(db: Db, repoId: number, folderPath: string): SummaryState[] {
    return db.select(summaryColumns).from(summaries)
        .where(and(
            eq(summaries.repoId, repoId),
            sql`${summaries.targetKind} in ('file', 'folder')`,
            directlyInside(summaries.targetPath, folderPath),
        ))
        .all();
}

export function loadSummaryState(db: Db, repoId: number, kind: SummaryTargetKind, targetPath: string): SummaryState | null {
    return db.select(summaryColumns).from(summaries)
        .where(and(eq(summaries.repoId, repoId), eq(summaries.targetKind, kind), eq(summaries.targetPath, targetPath)))
        .get() ?? null;
}

/** The Map's lines at one level (PIVOT_SPEC.md §4.2), in source-then-target order: one indexed lookup. */
export function loadLevelEdgeRows(db: Db, repoId: number, levelPath: string): { source: string; target: string; count: number }[] {
    return db.select({ source: levelEdges.sourceNode, target: levelEdges.targetNode, count: levelEdges.count }).from(levelEdges)
        .where(and(eq(levelEdges.repoId, repoId), eq(levelEdges.levelPath, levelPath)))
        .orderBy(levelEdges.sourceNode, levelEdges.targetNode)
        .all();
}

export function loadFileInfo(db: Db, repoId: number, filePath: string): { path: string; lineCount: number; isTest: boolean; sizeBytes: number } | null {
    return db.select({ path: files.path, lineCount: files.lineCount, isTest: files.isTest, sizeBytes: files.sizeBytes }).from(files)
        .where(and(eq(files.repoId, repoId), eq(files.path, filePath))).get() ?? null;
}

/** Every file of a repo, by id and path: the import graph's nodes. */
export function loadGraphFiles(db: Db, repoId: number): { id: number; path: string }[] {
    return db.select({ id: files.id, path: files.path }).from(files).where(eq(files.repoId, repoId)).all();
}

/** Every import of a repo as a pair of file ids: the import graph's edges. Imports never cross repos, so the source's repo decides. */
export function loadGraphEdges(db: Db, repoId: number): { source: number; target: number }[] {
    return db.select({ source: imports.sourceFileId, target: imports.targetFileId })
        .from(imports)
        .innerJoin(files, eq(files.id, imports.sourceFileId))
        .where(eq(files.repoId, repoId))
        .all();
}
/** The lines of every file inside a folder ("" = the whole repo). */
export function sumLinesInside(db: Db, repoId: number, folderPath: string): number {
    return db.select({ lines: sql<number>`coalesce(sum(${files.lineCount}), 0)` }).from(files)
        .where(and(eq(files.repoId, repoId), inside(files.path, folderPath))).get()?.lines ?? 0;
}

/** A file's declarations in line order: top-level ones and class members, members by their qualified name. */
export function loadFileSymbols(db: Db, repoId: number, filePath: string): SymbolInfo[] {
    return db.select({
        name: symbols.qualifiedName,
        kind: symbols.kind,
        startLine: symbols.startLine,
        endLine: symbols.endLine,
        exported: symbols.exported,
    })
        .from(symbols)
        .innerJoin(files, eq(files.id, symbols.fileId))
        .where(and(eq(files.repoId, repoId), eq(files.path, filePath)))
        .orderBy(symbols.startLine, symbols.qualifiedName)
        .all();
}

/** How many files at or under a target have a stale summary: text written for bytes the file no longer has. */
export function countStaleFileSummaries(db: Db, repoId: number, targetPath: string, kind: "repo" | "folder" | "file"): number {
    const where = kind === "file" ? eq(summaries.targetPath, targetPath) : inside(summaries.targetPath, kind === "repo" ? "" : targetPath);
    return db.select({ n: sql<number>`count(*)` }).from(summaries)
        .where(and(eq(summaries.repoId, repoId), eq(summaries.targetKind, "file"), eq(summaries.status, "stale"), where))
        .get()?.n ?? 0;
}
