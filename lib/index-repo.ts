/**
 * lib/index-repo.ts — the incremental indexing pipeline (Phase 2, Task 2)
 *
 * Runs in three phases so progress is reportable and the expensive work is done
 * before anything is committed:
 *
 *   scanning  → walk the repo, hash every file, decide what changed
 *   chunking  → parse changed files into chunks (pure, in memory)
 *   embedding → one batched pass over every new chunk in the whole run
 *   commit    → one transaction per file: chunks, vectors and the content hash
 *               land together or not at all
 *
 * The ordering of that last step is the important part. The content hash means
 * "this file's derived data is up to date"; writing it before the derived data
 * exists turns a transient failure into a permanent skip, because the next run
 * sees a matching hash and moves on. See docs/RAG_IMPLEMENTATION_REVIEW.md R7.
 */

import { createHash } from "crypto";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { repositories, files, chunks, meta, vectors, META_KEYS } from "@/lib/db/schema";
import { scanProject } from "@/lib/scan";
import { extractChunksFromFile } from "@/lib/chunks";
import { readFileSync } from "fs";
import { classifyFile } from "@/lib/graph";
import { embedChunks, encodeVector, EMBEDDING_MODEL, EMBEDDING_DIM } from "@/lib/embed";
import path from "path";
import type { CodeChunk, IndexPhase } from "@/lib/contracts";

export type IndexStats = {
    changed: number;
    skipped: number;
    errors: Array<{ path: string; error: string }>;
    warnings: Array<{ path: string; error: string }>;
};

/**
 * Thrown when another run holds the indexing lock.
 *
 * A distinct type rather than a magic string: the route needs to map this to the
 * INDEX_LOCKED error code, and matching on `message` breaks the moment anyone
 * rewords the sentence.
 */
export class IndexLockedError extends Error {
    constructor(startedAt: string){
        super(`Indexing already in progress (started ${startedAt}).`);
        this.name = "IndexLockedError";
    }
}

/**
 * How long a lock row may sit before it is assumed to be debris from a crashed
 * run. The lock is released in a `finally`, which does not run if the process is
 * killed or the dev server restarts mid-index — and indexing is the longest
 * operation in the product, so it is the most likely thing to be interrupted.
 */
const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

type PendingFile = {
    relativePath: string;
    hash: string;
    existingId: number | null;
    chunks: CodeChunk[];
};

export async function indexRepo(
    repoRoot: string,
    options?: { onProgress?: (phase: IndexPhase, done: number, total: number, currentFile?: string) => void }
): Promise<IndexStats> {
    const db = getDb();

    await acquireLock(db);

    try{
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.rootPath, repoRoot))
            .get();

        if (!repo){
            throw new Error(`Repository not found in DB for root path: ${repoRoot}. Run a scan first.`);
        }

        const repoId = repo.id;

        // ---- phase 1: scanning ------------------------------------------------
        const { files: scannedFiles, warnings } = await scanProject(repoRoot);

        const existingFileRows = await db
            .select()
            .from(files)
            .where(eq(files.repoId, repoId))
            .all();

        const existingFileMap = new Map<string, typeof files.$inferSelect>();
        for (const row of existingFileRows){
            existingFileMap.set(row.path, row);
        }

        const stats: IndexStats = { changed: 0, skipped: 0, errors: [], warnings };
        const seenPaths = new Set<string>();

        options?.onProgress?.("scanning", scannedFiles.length, scannedFiles.length);

        // ---- phase 2: chunking ------------------------------------------------
        const pending: PendingFile[] = [];
        let chunked = 0;

        for (const scanned of scannedFiles){
            seenPaths.add(scanned.id);
            chunked++;

            const existing = existingFileMap.get(scanned.id) ?? null;

            let content: string;
            try{
                content = readFileSync(path.join(repoRoot, scanned.id), "utf-8");
            } catch (err){
                stats.errors.push({ path: scanned.id, error: errorMessage(err) });
                options?.onProgress?.("chunking", chunked, scannedFiles.length, scanned.id);
                continue;
            }

            const hash = createHash("sha256").update(content).digest("hex");

            if (existing && existing.contentHash === hash){
                stats.skipped++;
                options?.onProgress?.("chunking", chunked, scannedFiles.length, scanned.id);
                continue;
            }

            try{
                pending.push({
                    relativePath: scanned.id,
                    hash,
                    existingId: existing?.id ?? null,
                    // the PROJECT-RELATIVE id, never the absolute path — chunk ids
                    // have to match graph node ids for the agent to be able to
                    // point at what it cites (contracts.ts header rule)
                    chunks: extractChunksFromFile(scanned.id, content)
                });
            } catch (err){
                stats.errors.push({ path: scanned.id, error: errorMessage(err) });
            }

            options?.onProgress?.("chunking", chunked, scannedFiles.length, scanned.id);
        }

        // ---- phase 3: embedding ----------------------------------------------
        // one pass over every new chunk in the run, so `done`/`total` describe the
        // whole job instead of resetting on each file
        const allChunks = pending.flatMap((file) => file.chunks);
        const vectorsByChunkId = new Map<string, Float32Array>();

        if (allChunks.length > 0){
            options?.onProgress?.("embedding", 0, allChunks.length);

            const embedded = await embedChunks(allChunks, (done, total) => {
                options?.onProgress?.("embedding", done, total);
            });

            for (const { chunk, vector } of embedded){
                vectorsByChunkId.set(chunk.id, vector);
            }
        }

        // ---- commit -----------------------------------------------------------
        for (const file of pending){
            try{
                commitFile(db, repoId, file, vectorsByChunkId);
                stats.changed++;
            } catch (err){
                // the hash was never written, so this file is retried next run
                stats.errors.push({ path: file.relativePath, error: errorMessage(err) });
            }
        }

        // remove files that no longer exist on disk (cascades to chunks + vectors)
        const pathsToDelete = existingFileRows
            .map((row) => row.path)
            .filter((filePath) => !seenPaths.has(filePath));

        if (pathsToDelete.length > 0){
            await db
                .delete(files)
                .where(and(eq(files.repoId, repoId), inArray(files.path, pathsToDelete)))
                .run();
        }

        await db
            .update(repositories)
            .set({ lastIndexAt: new Date() })
            .where(eq(repositories.id, repoId))
            .run();

        await recordEmbeddingModel(db);

        return stats;
    } finally{
        await db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
    }
}

/**
 * Writes one file's chunks, vectors and content hash in a single transaction.
 *
 * Synchronous by necessity: better-sqlite3 transactions are synchronous, so no
 * `await` may appear inside one. That constraint is what forces embedding to
 * happen before the commit phase rather than inside it — which is also the
 * design we want, since it keeps the slow network/CPU work out of a held write
 * lock.
 */
function commitFile(
    db: ReturnType<typeof getDb>,
    repoId: number,
    file: PendingFile,
    vectorsByChunkId: Map<string, Float32Array>
): void {
    db.transaction((tx) => {
        let fileId: number;

        if (file.existingId !== null){
            fileId = file.existingId;

            // clearing the old chunks cascades to their vectors
            tx.delete(chunks).where(eq(chunks.fileId, fileId)).run();
            tx.update(files).set({ contentHash: file.hash }).where(eq(files.id, fileId)).run();
        } else{
            const [inserted] = tx
                .insert(files)
                .values({
                    repoId,
                    path: file.relativePath,
                    kind: classifyFile(file.relativePath),
                    contentHash: file.hash
                })
                .returning({ id: files.id })
                .all();

            fileId = inserted.id;
        }

        if (file.chunks.length === 0){
            return;
        }

        const insertedChunks = tx
            .insert(chunks)
            .values(
                file.chunks.map((chunk) => ({
                    fileId,
                    chunkId: chunk.id,
                    kind: chunk.kind,
                    name: chunk.name,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    exported: chunk.exported,
                    partIndex: chunk.partIndex,
                    text: chunk.text,
                    fileHash: file.hash
                }))
            )
            .returning({ id: chunks.id, chunkId: chunks.chunkId })
            .all();

        const vectorRows = insertedChunks
            .map((row) => {
                const vector = vectorsByChunkId.get(row.chunkId);
                return vector ? { chunkId: row.id, embedding: encodeVector(vector) } : null;
            })
            .filter((row): row is { chunkId: number; embedding: Buffer } => row !== null);

        if (vectorRows.length !== insertedChunks.length){
            // refuse to half-index a file: without every vector, retrieval would
            // silently never surface the missing chunks, and the content hash we
            // are about to keep would claim the file was fully processed
            throw new Error(
                `Missing embeddings for ${insertedChunks.length - vectorRows.length} of ` +
                `${insertedChunks.length} chunks in ${file.relativePath}`
            );
        }

        tx.insert(vectors).values(vectorRows).run();
    });
}

async function acquireLock(db: ReturnType<typeof getDb>): Promise<void> {
    const lockRow = await db
        .select()
        .from(meta)
        .where(eq(meta.key, META_KEYS.INDEXING_LOCK))
        .get();

    if (lockRow){
        const startedAt = Date.parse(lockRow.value);
        const isStale = Number.isNaN(startedAt) || Date.now() - startedAt > LOCK_STALE_AFTER_MS;

        if (!isStale){
            throw new IndexLockedError(lockRow.value);
        }

        // debris from a run that was killed before its `finally` could fire
        console.warn(`[index] clearing stale indexing lock from ${lockRow.value}`);
        await db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
    }

    await db
        .insert(meta)
        .values({ key: META_KEYS.INDEXING_LOCK, value: new Date().toISOString() })
        .run();
}

async function recordEmbeddingModel(db: ReturnType<typeof getDb>): Promise<void> {
    // a model or dimension change invalidates every stored vector
    // (docs/DATABASE_DESIGN.md §2)
    const entries: Array<[string, string]> = [
        [META_KEYS.EMBEDDING_MODEL, EMBEDDING_MODEL],
        [META_KEYS.EMBEDDING_DIM, String(EMBEDDING_DIM)]
    ];

    for (const [key, value] of entries){
        await db
            .insert(meta)
            .values({ key, value })
            .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt: new Date() } })
            .run();
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
