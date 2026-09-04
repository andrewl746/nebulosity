import { repositories, files, imports } from "./schema";
import { getDb } from "./client";
import { eq, inArray, count, sql } from "drizzle-orm";

export function getLastScanAt(rootPath: string): Date | null {
    const db = getDb();
    const repo = db.select().from(repositories).where(eq(repositories.rootPath, rootPath)).get();
    
    return repo?.lastScanAt ?? null;
}

export function getCentralFiles(rootPath: string): { path: string; inDegree: number; outDegree: number }[] {
    const db = getDb();

    const repo = db.select().from(repositories).where(eq(repositories.rootPath, rootPath)).get();
    if (!repo) return[];

    const repoFiles = db.select().from(files).where(eq(files.repoId, repo.id)).all();
    const fileIds = repoFiles.map((f) => f.id);
    if (fileIds.length === 0) return [];

    const pathById = new Map(repoFiles.map((f) => [f.id, f.path]));

    const outCounts = db.select({ fileId: imports.sourceFileId, total: count() })
        .from(imports).where(inArray(imports.sourceFileId, fileIds)).groupBy(imports.sourceFileId).all();

    const inCounts = db.select({ fileId: imports.targetFileId, total: count() })
        .from(imports).where(inArray(imports.targetFileId, fileIds)).groupBy(imports.targetFileId).all();

    const degreeByFileId = new Map<number, { inDegree: number; outDegree: number }>();

    for (const id of fileIds){
        degreeByFileId.set(id, { inDegree: 0, outDegree: 0 });
    }

    for (const row of outCounts){
        degreeByFileId.get(row.fileId)!.outDegree = row.total;
    }

    for (const row of inCounts){
        degreeByFileId.get(row.fileId)!.inDegree = row.total;
    }

    const result = Array.from(degreeByFileId, ([fileId, d]) => ({
        path: pathById.get(fileId)!,
        inDegree: d.inDegree,
        outDegree: d.outDegree
    }));

    return result.sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree)).slice(0, 5);
}

type ScanFileInput = { path: string; kind: "component" | "module" };
type ScanEdgeInput = { source: string; target: string; specifier: string };

/**
 * Persists one scan.
 *
 * Two rules make this safe to run on every page load (ADR-022):
 *
 *  1. **Upsert, never delete-and-reinsert.** File rows are the parent of
 *     `chunks`, which cascades to `vectors`. Clearing them wholesale meant a
 *     plain `GET /api/graph` destroyed the entire search index, and churned
 *     every file id in the process.
 *  2. **`contentHash` is not written here.** It belongs to the indexer and
 *     means "the hash the indexer last processed". Stamping the current hash at
 *     *scan* time told the indexer every file was already up to date, so the
 *     chunks table could never fill.
 */
export function saveScan(rootPath: string, scannedFiles: ScanFileInput[], scannedEdges: ScanEdgeInput[]){
    const db = getDb();

    db.transaction((tx) => {
        // repo
        const repo = tx.insert(repositories)
            .values({ rootPath, lastScanAt: new Date() })
            .onConflictDoUpdate({ target: repositories.rootPath, set: { lastScanAt: new Date() }})
            .returning()
            .get();

        if (scannedFiles.length > 0){
            tx.insert(files)
                .values(scannedFiles.map((f) => ({
                    repoId: repo.id,
                    path: f.path,
                    kind: f.kind,
                    contentHash: "" // sentinel: seen by the scanner, never indexed
                })))
                .onConflictDoUpdate({
                    target: [files.repoId, files.path],
                    // only the classification can change for a file that already
                    // exists — contentHash is deliberately left alone
                    set: { kind: sql`excluded.kind` }
                })
                .run();
        }

        const fileRows = tx
            .select({ id: files.id, path: files.path })
            .from(files)
            .where(eq(files.repoId, repo.id))
            .all();

        // files that vanished from disk (this cascade IS wanted — their chunks
        // describe code that no longer exists)
        const scannedPaths = new Set(scannedFiles.map((f) => f.path));
        const goneIds = fileRows.filter((f) => !scannedPaths.has(f.path)).map((f) => f.id);

        if (goneIds.length > 0){
            tx.delete(files).where(inArray(files.id, goneIds)).run();
        }

        // translate path pairs to id pairs for db connections
        const idByPath = new Map(
            fileRows.filter((f) => scannedPaths.has(f.path)).map((f) => [f.path, f.id])
        );

        // Edges are pure derived data with no dependents, so they are rebuilt
        // wholesale. They used to be cleared as a side effect of the file delete
        // above; now that files survive, stale edges have to be removed here or
        // a deleted import would linger on the graph forever.
        const liveFileIds = [...idByPath.values()];

        if (liveFileIds.length > 0){
            tx.delete(imports).where(inArray(imports.sourceFileId, liveFileIds)).run();
        }

        const resolvedEdges: { sourceFileId: number; targetFileId: number; specifier: string }[] = [];

        // resolve each edge
        for (const edge of scannedEdges){
            const sourceFileId = idByPath.get(edge.source);
            const targetFileId = idByPath.get(edge.target);

            if (sourceFileId === undefined || targetFileId === undefined){
                continue;
            }

            resolvedEdges.push({ sourceFileId, targetFileId, specifier: edge.specifier });
        }

        // insert the resolved edges into the db
        if (resolvedEdges.length > 0){
            tx.insert(imports).values(resolvedEdges).onConflictDoNothing().run();
        }
    });
}

type LoadedFile = { path: string; kind: "component" | "module" };
type LoadedEdge = { source: string; target: string; specifier: string };

export function loadGraph(rootPath: string): { files: LoadedFile[]; edges: LoadedEdge[] } | null {
    const db = getDb();

    // find the repo in the database we want to load using rootPath
    const repo = db.select().from(repositories).where(eq(repositories.rootPath, rootPath)).get();

    if (!repo){
        return null;
    }

    // select all files that belong to the repo we want to load
    const repoFiles = db.select().from(files).where(eq(files.repoId, repo.id)).all();
    const fileIds = repoFiles.map((f) => f.id);

    // find all edges whose source is one of this repo's files
    const repoEdges = fileIds.length > 0
        ? db.select().from(imports).where(inArray(imports.sourceFileId, fileIds)).all()
        : [];
    
    // reverse map that turns IDs back to paths
    const pathById = new Map(repoFiles.map((f) => [f.id, f.path]));

    const edges: LoadedEdge[] = repoEdges.map((e) => ({
        source: pathById.get(e.sourceFileId)!,
        target: pathById.get(e.targetFileId)!,
        specifier: e.specifier
    }));

    return {
        files: repoFiles.map((f) => ({ path: f.path, kind: f.kind })),
        edges
    };
}
