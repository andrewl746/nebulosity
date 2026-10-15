import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../client";
import {
    chunks, files, folders, imports, levelEdges, repositories, symbols,
    type CallFacts, type FolderRow, type LevelEdgeRow, type SymbolRow,
} from "../schema";
import { replaceCallFacts } from "./calls";
import { chunkRows, columnCount, forEachBatch } from "../batch";
import type { CodeChunk } from "../../contracts";
import { commandHint } from "../../hints";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A file that couldn't be read, parsed or written this run, and why. It keeps its previous row. */
export type FileError = { path: string; error: string };

/** One resolved import: `source` imports `target`, written as `specifier` in the source. */
export type ImportEdge = { source: string; target: string; specifier: string };

/** A chunk plus its name split into words for code search (lib/index/identifiers.ts). */
export type ChunkRecord = CodeChunk & { nameSplit: string };

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
    chunks: ChunkRecord[];
    symbols: SymbolRow[];
    /** Call facts (ADR-059). */
    calls: CallFacts;
};

export type StoredFile = { id: number; contentHash: string; importSpecifiers: string[] };

export function upsertRepository(db: Db, rootPath: string): number {
    return db.insert(repositories)
        .values({ rootPath })
        .onConflictDoUpdate({ target: repositories.rootPath, set: { rootPath } })
        .returning({ id: repositories.id })
        .get().id;
}

/** The id of an indexed repo, or null if it was never indexed. */
export function findRepository(db: Db, rootPath: string): number | null {
    return db.select({ id: repositories.id }).from(repositories).where(eq(repositories.rootPath, rootPath)).get()?.id ?? null;
}

/** Thrown when a command needs a repo that `nebulosity index` hasn't indexed yet. */
export class RepoNotIndexedError extends Error {
    constructor(rootPath: string){
        super(`${rootPath} isn't indexed yet. Run ${commandHint("index", `"${rootPath}"`)} first.`);
        this.name = "RepoNotIndexedError";
    }
}

/** The id of an indexed repo; throws RepoNotIndexedError if it was never indexed. */
export function requireRepository(db: Db, rootPath: string): number {
    const id = findRepository(db, rootPath);
    if (id === null) throw new RepoNotIndexedError(rootPath);
    return id;
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

    tx.delete(chunks).where(eq(chunks.fileId, fileId)).run();   // cascades to their code search rows (the delete trigger, ADR-031)
    tx.delete(symbols).where(eq(symbols.fileId, fileId)).run();

    const chunkRows = r.chunks.map((c) => ({
        fileId,
        chunkId: c.id,
        kind: c.kind,
        name: c.name,
        nameSplit: c.nameSplit,
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

    replaceCallFacts(tx, fileId, r.calls);
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

/** The git commit the repo's index was built from (PIVOT_SPEC.md §4.1), or null outside git. */
export function loadIndexedHead(db: Db, repoId: number): string | null {
    return db.select({ head: repositories.indexedHead }).from(repositories).where(eq(repositories.id, repoId)).get()?.head ?? null;
}

/** Paths per IN (…) list: far under the parameter cap, with room for the other bound values. */
const IN_LIST = 900;

/** Paths → file ids in this repo, looked up in chunks under the parameter cap. Paths that aren't indexed are left out. */
export function loadFileIds(db: Db, repoId: number, paths: readonly string[]): Map<string, number> {
    const ids = new Map<string, number>();
    for (const batch of chunkRows([...new Set(paths)], 1, IN_LIST)){
        const rows = db.select({ id: files.id, path: files.path }).from(files)
            .where(and(eq(files.repoId, repoId), inArray(files.path, batch))).all();
        for (const row of rows) ids.set(row.path, row.id);
    }
    return ids;
}

/** Imports as paths, filtered by `where` over the source and target files (aliased; imports never cross repos). */
function selectImportEdges(db: Db, repoId: number, where?: (source: typeof files, target: typeof files) => ReturnType<typeof and>): ImportEdge[] {
    const source = alias(files, "source");
    const target = alias(files, "target");
    return db.select({ source: source.path, target: target.path, specifier: imports.specifier })
        .from(imports)
        .innerJoin(source, eq(source.id, imports.sourceFileId))
        .innerJoin(target, eq(target.id, imports.targetFileId))
        .where(and(eq(source.repoId, repoId), where?.(source as unknown as typeof files, target as unknown as typeof files)))
        .all();
}

/** Every import of a repo, as paths. The incremental update diffs against these when the file set changed. */
export function loadImportEdges(db: Db, repoId: number): ImportEdge[] {
    return selectImportEdges(db, repoId);
}

/** The imports out of these files. */
export function loadImportEdgesFrom(db: Db, repoId: number, paths: readonly string[]): ImportEdge[] {
    return chunkRows([...new Set(paths)], 1, IN_LIST).flatMap((batch) =>
        selectImportEdges(db, repoId, (source) => inArray(source.path, batch)));
}

/** The imports into or out of these files: the ones deleting the files would cascade away. */
export function loadImportEdgesTouching(db: Db, repoId: number, paths: readonly string[]): ImportEdge[] {
    const seen = new Map<string, ImportEdge>();
    for (const batch of chunkRows([...new Set(paths)], 1, IN_LIST)){
        for (const edge of selectImportEdges(db, repoId, (source, target) => or(inArray(source.path, batch), inArray(target.path, batch)))){
            seen.set(`${edge.source}\0${edge.target}`, edge);
        }
    }
    return [...seen.values()];
}

/** Deletes these files (their chunks, symbols and imports cascade) and returns the paths that were indexed, in order. */
export function deleteFiles(db: Db, repoId: number, paths: readonly string[]): string[] {
    const ids = loadFileIds(db, repoId, paths);
    db.transaction((tx) => {
        for (const id of ids.values()) tx.delete(files).where(eq(files.id, id)).run();
    });
    return [...ids.keys()].sort();
}

/**
 * An incremental update of the import graph and the Map's lines (ADR-037), in one transaction so no reader sees half
 * of it. The removed imports go and the added ones arrive (a removed and an added row for the same pair, when only
 * the specifier changed). Each level edge moves by its delta, and a row that reaches 0 is deleted.
 */
export function applyEdgeChanges(
    db: Db, repoId: number, removed: readonly ImportEdge[], added: readonly ImportEdge[], deltas: readonly LevelEdgeRow[]
): void {
    const ids = loadFileIds(db, repoId, [...removed, ...added].flatMap((e) => [e.source, e.target]));
    const idsOf = (e: ImportEdge): { sourceFileId: number; targetFileId: number } | null => {
        const sourceFileId = ids.get(e.source);
        const targetFileId = ids.get(e.target);
        return sourceFileId === undefined || targetFileId === undefined ? null : { sourceFileId, targetFileId };
    };

    db.transaction((tx) => {
        for (const edge of removed){
            const pair = idsOf(edge);
            if (pair) tx.delete(imports).where(and(eq(imports.sourceFileId, pair.sourceFileId), eq(imports.targetFileId, pair.targetFileId))).run();
        }

        const rows = added.flatMap((edge) => {
            const pair = idsOf(edge);
            return pair ? [{ ...pair, specifier: edge.specifier }] : [];
        });
        forEachBatch(rows, columnCount(imports), (batch) => { tx.insert(imports).values(batch).onConflictDoNothing().run(); });

        for (const delta of deltas){
            tx.insert(levelEdges).values({ repoId, ...delta })
                .onConflictDoUpdate({
                    target: [levelEdges.repoId, levelEdges.levelPath, levelEdges.sourceNode, levelEdges.targetNode],
                    set: { count: sql`${levelEdges.count} + ${delta.count}` },
                })
                .run();
        }
        tx.delete(levelEdges).where(and(eq(levelEdges.repoId, repoId), lte(levelEdges.count, 0))).run();
    });
}

/** Makes the folders table match `rows` (buildFolders over the current files), writing only what differs. */
export function syncFolders(db: Db, repoId: number, rows: readonly FolderRow[]): void {
    const stored = new Map(db.select().from(folders).where(eq(folders.repoId, repoId)).all().map((f) => [f.path, f]));
    const wanted = new Set(rows.map((r) => r.path));

    db.transaction((tx) => {
        for (const [folderPath, row] of stored) if (!wanted.has(folderPath)) tx.delete(folders).where(eq(folders.id, row.id)).run();

        const created = rows.filter((r) => !stored.has(r.path)).map((r) => ({ repoId, ...r }));
        forEachBatch(created, columnCount(folders), (batch) => { tx.insert(folders).values(batch).run(); });

        for (const r of rows){
            const row = stored.get(r.path);
            if (row && (row.fileCount !== r.fileCount || row.directFileCount !== r.directFileCount)){
                tx.update(folders).set({ fileCount: r.fileCount, directFileCount: r.directFileCount }).where(eq(folders.id, row.id)).run();
            }
        }
    });
}
