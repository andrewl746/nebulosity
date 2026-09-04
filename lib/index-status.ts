/**
 * lib/index-status.ts — what the index currently contains.
 *
 * Shared by GET /api/health (to report index state) and POST /api/index (to
 * report the final chunk count), so the two can never disagree about what
 * "indexed" means.
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { repositories, files, chunks } from "@/lib/db/schema";
import type { HealthResponse } from "@/lib/contracts";

export function getIndexStatus(repoRoot: string): HealthResponse["index"] {
    const db = getDb();

    const repo = db
        .select({ id: repositories.id, lastIndexAt: repositories.lastIndexAt })
        .from(repositories)
        .where(eq(repositories.rootPath, repoRoot))
        .get();

    if (!repo){
        return { exists: false, indexedAt: null, chunkCount: 0, staleFiles: 0 };
    }

    const chunkCount = db
        .select({ count: sql<number>`count(*)` })
        .from(chunks)
        .innerJoin(files, eq(chunks.fileId, files.id))
        .where(eq(files.repoId, repo.id))
        .get()?.count ?? 0;

    const indexedRows = db
        .select({ path: files.path, contentHash: files.contentHash })
        .from(files)
        .where(eq(files.repoId, repo.id))
        .all();

    // Re-hash the indexed files to answer "is the index still fresh?" honestly.
    // This is a full read of every indexed file, which is affordable because
    // /api/health is fetched once on mount for one local repository — if it ever
    // becomes a polled endpoint, or targets a large repo, this wants an mtime
    // fast-path first.
    let staleFiles = 0;

    for (const row of indexedRows){
        try{
            const content = readFileSync(path.join(repoRoot, row.path), "utf-8");
            const hash = createHash("sha256").update(content).digest("hex");

            if (hash !== row.contentHash){
                staleFiles++;
            }
        } catch {
            // deleted or unreadable since the last index — stale by definition
            staleFiles++;
        }
    }

    return {
        // "indexed" means chunks actually exist, not merely that a run happened.
        // A run that failed every file still stamps lastIndexAt.
        exists: chunkCount > 0,
        indexedAt: repo.lastIndexAt ? repo.lastIndexAt.toISOString() : null,
        chunkCount,
        staleFiles
    };
}
