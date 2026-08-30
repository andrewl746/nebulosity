// FOR CLAUDE CODE: i added the warnings array to here but idk if ill need it in the future. 
// i think it might be useful to have a list of warnings that were generated during the scan process,
// so that we can display them to the user or log them for debugging purposes. 
// but for now, i'll just keep it in the stats object and see if we need it later.
// none of the indexing stuff is connected to the ui btw so look into that later.

// also i need to connect it to the indexing symbol on the ui near the top bar

import { createHash } from "crypto";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { repositories, files, chunks, meta, vectors, META_KEYS } from "@/lib/db/schema";
import { scanProject } from "@/lib/scan";
import { extractChunksFromFile } from "@/lib/chunks";
import { readFileSync } from "fs";
import { classifyFile } from "@/lib/graph";
import { embedChunks } from "@/lib/embed";
import path from "path";
import type { CodeChunk } from "@/lib/contracts";

export type IndexStats = {
    changed: number;
    skipped: number;
    errors: Array<{ path: string; error: string }>;
    warnings: Array<{ path: string; error: string }>;
};

const INDEXING_LOCK_KEY = META_KEYS.INDEXING_LOCK;

export async function indexRepo(
    repoRoot: string,
    options?: { onProgress?: (phase: string, done: number, total: number) => void }
): Promise<IndexStats> {
    const db = getDb();

    // checks if another indexing process is already running by checking the meta table for a lock key
    const lockRow = await db
        .select()
        .from(meta)
        .where(eq(meta.key, INDEXING_LOCK_KEY))
        .get();

    if (lockRow){
        throw new Error("Indexing is already in progress. Please try again later.");
    }

    await db.insert(meta)
        .values({ key: INDEXING_LOCK_KEY, value: new Date().toISOString() })
        .run();

    try{
        // checks if the repo exists in the database
        const repo = await db
            .select()
            .from(repositories)
            .where(eq(repositories.rootPath, repoRoot))
            .get();

        if (!repo){
            throw new Error(`Repository not found in DB for root path: ${repoRoot}. Run a scan first.`);
        }

        const repoId = repo.id;

        const { files: scannedFiles, warnings } = await scanProject(repoRoot);

        const existingFileRows = await db
            .select()
            .from(files)
            .where(eq(files.repoId, repoId))
            .all();

        // need to compare disk to database to determine which files have changed, which are new, and which are deleted
        const existingFileMap = new Map<string, typeof files.$inferSelect>();
        for (const row of existingFileRows){
            existingFileMap.set(row.path, row);
        }

        /* changed: number of files that changed since last index
        skipped: number of files that were unchanged and thus skipped
        errors: files that failed to index with their error messages
        warnings: files that have warnings */
        const stats: IndexStats = { changed: 0, skipped: 0, errors: [], warnings: warnings };
        const seenPaths = new Set<string>();
        let processedCount = 0;
        const totalFiles = scannedFiles.length;

        options?.onProgress?.("scanning", 0, totalFiles);
        
        for (const scanned of scannedFiles){
            seenPaths.add(scanned.id);
            const existing = existingFileMap.get(scanned.id);

            let fullPath: string;
            let content: string;
            try{ // read file could fail so wrap it in a try
                fullPath = path.join(repoRoot, scanned.id);
                content = readFileSync(fullPath, "utf-8");
            } catch (err){
                stats.errors.push({
                    path: scanned.id,
                    error: err instanceof Error ? err.message : String(err)
                });

                processedCount++;
                options?.onProgress?.("chunking", processedCount, totalFiles);
                continue;
            }

            const hash = createHash("sha256").update(content).digest("hex");

            if (existing && existing.contentHash === hash){
                stats.skipped++;
                processedCount++;
                options?.onProgress?.("chunking", processedCount, totalFiles);
                continue;
            }

            try{
                if (existing){
                    await db
                        .delete(chunks)
                        .where(eq(chunks.fileId, existing.id))
                        .run();
                }

                let fileId: number;
                if (existing){
                    await db
                        .update(files)
                        .set({ contentHash: hash })
                        .where(eq(files.id, existing.id))
                        .run();

                    fileId = existing.id;
                } else{
                    const [ newFile ] = await db
                        .insert(files) // insert the new file into files table
                        .values({ // insert these values specifically
                            repoId,
                            path: scanned.id,
                            kind: classifyFile(scanned.id),
                            contentHash: hash
                        })
                        .returning({ id: files.id }); // returns the id of the newly inserted file
                    
                    // having [] around newFile destructures the returned array ([{id: files.id}]) to get the first element, 
                    // which is the newly inserted file's id
                    fileId = newFile.id;
                }

                // extract chunks from the file content and insert them into the chunks table
                const fileChunks: CodeChunk[] = extractChunksFromFile(fullPath, content);

                if (fileChunks.length > 0){
                    await db
                        .insert(chunks)
                        .values(
                            fileChunks.map((chunk) => ({
                                fileId: fileId,
                                chunkId: chunk.id, // CodeChunk.id goes here
                                kind: chunk.kind,
                                name: chunk.name,
                                startLine: chunk.startLine,
                                endLine: chunk.endLine,
                                exported: chunk.exported,
                                partIndex: chunk.partIndex,
                                text: chunk.text,
                                fileHash: hash
                            }))
                        )
                        .run();
                }

                // --- embed the chunks ---
                // get the inserted chunks' db ids
                const insertedChunkRows = await db
                    .select()
                    .from(chunks)
                    .where(eq(chunks.fileId, fileId))
                    .all();

                // map CodeChunk.id (string) to db id (number)
                const chunkIdToDbId = new Map<string, number>();

                for (const row of insertedChunkRows){
                    chunkIdToDbId.set(row.chunkId, row.id);
                }

                // only embed chunks that were actually inserted (new/changed)
                const chunksToEmbed = fileChunks.filter(chunk => 
                    chunkIdToDbId.has(chunk.id)
                );

                if (chunksToEmbed.length > 0){
                    options?.onProgress?.("embedding", 0, chunksToEmbed.length);

                    const embedded = await embedChunks(chunksToEmbed, (done, total) => {
                        options?.onProgress?.("embedding", done, total);
                    });
                    
                    // build the vector insert values
                    const vectorValues = embedded.map(({ chunk, vector }) => ({
                        chunkId: chunkIdToDbId.get(chunk.id)!, // the db id, not the chunkId string
                        embedding: Buffer.from(vector.buffer)
                    }));
                    
                    await db.insert(vectors)
                        .values(vectorValues)
                        .run();
                }

                stats.changed++;
            } catch (err){
                stats.errors.push({
                    path: scanned.id,
                    error: err instanceof Error ? err.message : String(err)
                })
            }

            processedCount++;
            options?.onProgress?.("chunking", processedCount, totalFiles);
        }

        // delete files that are no longer present on disk (exist in DB but not in the newly scanned files)
        const pathsToDelete = existingFileRows
            .map((row) => row.path)
            .filter((path) => !seenPaths.has(path));

        if (pathsToDelete.length > 0){
            await db
                .delete(files)
                .where(and(eq(files.repoId, repoId), inArray(files.path, pathsToDelete)))
                .run();
        }

        // update the lastIndexAt timestamp for the repository to indicate that indexing has completed
        await db
            .update(repositories)
            .set({ lastIndexAt: new Date() })
            .where(eq(repositories.id, repoId))
            .run();

        // --- store embedding model info in meta table ---
        const modelName = "Xenova/all-MiniLM-L6-v2";
        const dim = 384;

        // check if meta exists, update or insert
        const existingModel = await db
            .select()
            .from(meta)
            .where(eq(meta.key, META_KEYS.EMBEDDING_MODEL))
            .get();

        if (existingModel){
            await db
                .update(meta)
                .set({ value: modelName, updatedAt: new Date() })
                .where(eq(meta.key, META_KEYS.EMBEDDING_MODEL))
                .run();
        } else{
            await db
                .insert(meta)
                .values({ key: META_KEYS.EMBEDDING_MODEL, value: modelName })
                .run();
        }

        // same for embeddingDim
        const existingDim = await db
            .select()
            .from(meta)
            .where(eq(meta.key, META_KEYS.EMBEDDING_DIM))
            .get();

        if (existingDim){
            await db
                .update(meta)
                .set({ value: String(dim), updatedAt: new Date() })
                .where(eq(meta.key, META_KEYS.EMBEDDING_DIM))
                .run();
        } else{
            await db
                .insert(meta)
                .values({ key: META_KEYS.EMBEDDING_DIM, value: String(dim) })
                .run();
        }

        return stats;
    } finally{
        // remove the indexing lock from the meta table to allow future indexing operations
        await db
            .delete(meta)
            .where(eq(meta.key, INDEXING_LOCK_KEY))
            .run();
    }
}
