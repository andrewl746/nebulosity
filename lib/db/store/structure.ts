import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import {
    chunks, files, folders, imports, levelEdges, repositories, symbols,
    type FolderRow, type LevelEdgeRow, type SymbolRow,
} from "../schema";
import { columnCount, forEachBatch } from "../batch";
import type { CodeChunk } from "../../contracts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A file that couldn't be read, parsed or written this run, and why. It keeps its previous row. */
export type FileError = { path: string; error: string };

/** One resolved import: `source` imports `target`, written as `specifier` in the source. */
export type ImportEdge = { source: string; target: string; specifier: string };

/** Everything one structure run knows about one changed file. */
export type FileRecord = {
    path: string;
    kind: (typeof files.$inferInsert)["kind"];
    contentHash: string;
    language: string;
    sizeBytes: number;
    lineCount: number;
    isTest: boolean;
    importSpecifiers: string[];
    chunks: CodeChunk[];
    symbols: SymbolRow[];
};

export type StoredFile = { id: number; contentHash: string; importSpecifiers: string[] };

export function upsertRepository(db: Db, rootPath: string): number {
    return db.insert(repositories)
        .values({ rootPath })
        .onConflictDoUpdate({ target: repositories.rootPath, set: { rootPath } })
        .returning({ id: repositories.id })
        .get().id;
}

/** path → what the last successful run stored. */
export function loadStoredFiles(db: Db, repoId: number): Map<string, StoredFile> {
    const rows = db
        .select({ id: files.id, path: files.path, contentHash: files.contentHash, importSpecifiers: files.importSpecifiers })
        .from(files)
        .where(eq(files.repoId, repoId))
        .all();

    return new Map(rows.map((r) => [r.path, {
        id: r.id,
        contentHash: r.contentHash,
        importSpecifiers: JSON.parse(r.importSpecifiers) as string[],
    }]));
}

/**
 * Writes a batch of changed files in ONE transaction: with ~30 batches for VS Code
 * instead of ~15,000 per-file commits, the disk is touched ~30 times. If the batch
 * fails, it's retried file by file so one bad file can't sink its neighbours, and
 * that file keeps its old hash and is retried on the next run (ADR-022).
 */
export function writeFileRecords(db: Db, repoId: number, records: readonly FileRecord[]): FileError[] {
    const errors: FileError[] = [];

    try{
        db.transaction((tx) => {
            for (const record of records) writeOne(tx, repoId, record);
        });
    } catch{
        for (const record of records){
            try{
                db.transaction((tx) => writeOne(tx, repoId, record));
            } catch (err){
                errors.push({ path: record.path, error: err instanceof Error ? err.message : String(err) });
            }
        }
    }

    return errors;
}

function writeOne(tx: Tx, repoId: number, r: FileRecord): void {
    const fields = {
        kind: r.kind,
        contentHash: r.contentHash,
        language: r.language,
        sizeBytes: r.sizeBytes,
        lineCount: r.lineCount,
        isTest: r.isTest,
        importSpecifiers: JSON.stringify(r.importSpecifiers),
    };

    const { id: fileId } = tx.insert(files)
        .values({ repoId, path: r.path, ...fields })
        .onConflictDoUpdate({ target: [files.repoId, files.path], set: fields })
        .returning({ id: files.id })
        .get();

    tx.delete(chunks).where(eq(chunks.fileId, fileId)).run();   // cascades to the old vectors
    tx.delete(symbols).where(eq(symbols.fileId, fileId)).run();

    const chunkRows = r.chunks.map((c) => ({
        fileId,
        chunkId: c.id,
        kind: c.kind,
        name: c.name,
        startLine: c.startLine,
        endLine: c.endLine,
        exported: c.exported,
        partIndex: c.partIndex,
        text: c.text,
        fileHash: c.fileHash,
    }));
    forEachBatch(chunkRows, columnCount(chunks), (batch) => { tx.insert(chunks).values(batch).run(); });

    const symbolRows = r.symbols.map((s) => ({ fileId, ...s }));
    forEachBatch(symbolRows, columnCount(symbols), (batch) => { tx.insert(symbols).values(batch).run(); });
}

/** Deletes files that are no longer on disk (cascading their chunks, symbols and imports) and returns their paths. */
export function deleteFilesNotIn(db: Db, repoId: number, keep: ReadonlySet<string>): string[] {
    const stored = db.select({ id: files.id, path: files.path }).from(files).where(eq(files.repoId, repoId)).all();
    const gone = stored.filter((f) => !keep.has(f.path));

    db.transaction((tx) => {
        for (const f of gone) tx.delete(files).where(eq(files.id, f.id)).run();
    });

    return gone.map((f) => f.path);
}

/** Replaces the repo's whole import graph and returns how many edges were stored. */
export function replaceImports(db: Db, repoId: number, edges: readonly ImportEdge[]): number {
    const idByPath = new Map(
        db.select({ id: files.id, path: files.path }).from(files).where(eq(files.repoId, repoId)).all().map((f) => [f.path, f.id])
    );

    const rows = edges.flatMap((e) => {
        const sourceFileId = idByPath.get(e.source);
        const targetFileId = idByPath.get(e.target);
        return sourceFileId !== undefined && targetFileId !== undefined
            ? [{ sourceFileId, targetFileId, specifier: e.specifier }]
            : [];
    });

    db.transaction((tx) => {
        // a subquery, never an IN-list of every id: that list is what blew the parameter cap before
        tx.delete(imports)
            .where(inArray(imports.sourceFileId, tx.select({ id: files.id }).from(files).where(eq(files.repoId, repoId))))
            .run();
        forEachBatch(rows, columnCount(imports), (batch) => { tx.insert(imports).values(batch).onConflictDoNothing().run(); });
    });

    return rows.length;
}

/** Folder tree + level edges are fully derived from the file set and the edges, so they're rebuilt wholesale. */
export function replaceAggregates(db: Db, repoId: number, folderRows: readonly FolderRow[], edgeRows: readonly LevelEdgeRow[]): void {
    db.transaction((tx) => {
        tx.delete(folders).where(eq(folders.repoId, repoId)).run();
        tx.delete(levelEdges).where(eq(levelEdges.repoId, repoId)).run();
        forEachBatch(folderRows.map((f) => ({ repoId, ...f })), columnCount(folders), (batch) => { tx.insert(folders).values(batch).run(); });
        forEachBatch(edgeRows.map((e) => ({ repoId, ...e })), columnCount(levelEdges), (batch) => { tx.insert(levelEdges).values(batch).run(); });
    });
}

export function markIndexed(db: Db, repoId: number, indexedHead: string | null): void {
    const now = new Date();
    db.update(repositories).set({ lastIndexAt: now, lastScanAt: now, indexedHead }).where(eq(repositories.id, repoId)).run();
}
