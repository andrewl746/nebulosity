import { eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { meta } from "../schema";

/**
 * A per-repo counter that goes up whenever anything the Map shows changes: the structure (files, folders, level edges,
 * symbols, imports) or a summary's text or status (PIVOT_SPEC.md §6.1, ADR-036). Readers cache per version and the Map
 * refetches when it moves. It lives in `meta` like the stage rows, so every process sees every other's writes.
 */
const versionKey = (repoId: number): string => `indexVersion:${repoId}`;

export function readIndexVersion(db: Db, repoId: number): number {
    const row = db.select({ value: meta.value }).from(meta).where(eq(meta.key, versionKey(repoId))).get();
    return row ? Number(row.value) : 0;
}

/** Adds one and returns the new value. One statement, so two processes bumping at once can't lose a bump. */
export function bumpIndexVersion(db: Db, repoId: number): number {
    const updatedAt = new Date();
    db.insert(meta)
        .values({ key: versionKey(repoId), value: "1", updatedAt })
        .onConflictDoUpdate({ target: meta.key, set: { value: sql`cast(${meta.value} as integer) + 1`, updatedAt } })
        .run();
    return readIndexVersion(db, repoId);
}
