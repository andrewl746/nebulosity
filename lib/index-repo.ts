// FOR CLAUDE CODE: i added the warnings array to here but idk if ill need it in the future. 
// i think it might be useful to have a list of warnings that were generated during the scan process,
// so that we can display them to the user or log them for debugging purposes. 
// but for now, i'll just keep it in the stats object and see if we need it later.

// also i need to connect it to the indexing symbol

import { createHash } from "crypto";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { repositories, files, chunks, meta } from "@/lib/db/schema";
import { scanProject } from "@/lib/scan";
import { extractChunksFromFile } from "@/lib/chunks";
import { readFileSync } from "fs";
import path from "path";
import { classifyFile } from "@/lib/graph";
import type { ScannedFile } from "./graph";
import type { CodeChunk } from "@/lib/contracts";

export type IndexStats = {
    changed: number;
    skipped: number;
    errors: Array<{ path: string; error: string }>;
    warnings: Array<{ path: string; error: string }>;
};

const INDEXING_LOCK_KEY = "indexing";

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

                continue;
            }

            const hash = createHash("sha256").update(content).digest("hex");

            if (existing && existing.contentHash === hash){
                stats.skipped++;
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

                stats.changed++;
            } catch (err){
                stats.errors.push({
                    path: scanned.id,
                    error: err instanceof Error ? err.message : String(err)
                })
            }
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

        return stats;
    } finally{
        // remove the indexing lock from the meta table to allow future indexing operations
        await db
            .delete(meta)
            .where(eq(meta.key, INDEXING_LOCK_KEY))
            .run();
    }
}
