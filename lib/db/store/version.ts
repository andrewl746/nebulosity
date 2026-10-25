import { and, eq, inArray, sql } from "drizzle-orm";
import { chunkRows, SQLITE_MAX_PARAMS } from "../batch";
import type { Db } from "../client";
import { files, meta } from "../schema";

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

/**
 * One version per language adapter (ADR-065, the design's C16): TypeScript keeps the key it always had, so no existing
 * index re-parses; every other adapter has its own, so bumping one language re-parses only that language's files.
 */
const adapterKey = (repoId: number, adapterId: string): string =>
    adapterId === "typescript" ? `adapterVersion:${repoId}` : `adapterVersion:${repoId}:${adapterId}`;

/** The adapter's version (its `version`) the repo's last full run parsed its files with; 0 when none recorded one (ADR-053). */
export function readAdapterVersion(db: Db, repoId: number, adapterId = "typescript"): number {
    const row = db.select({ value: meta.value }).from(meta).where(eq(meta.key, adapterKey(repoId, adapterId))).get();
    return row ? Number(row.value) : 0;
}

export function writeAdapterVersion(db: Db, repoId: number, version: number, adapterId = "typescript"): void {
    const updatedAt = new Date();
    db.insert(meta)
        .values({ key: adapterKey(repoId, adapterId), value: String(version), updatedAt })
        .onConflictDoUpdate({ target: meta.key, set: { value: String(version), updatedAt } })
        .run();
}

/**
 * Records the adapter version a full run parsed with (ADR-053, amended) and, in the same transaction, clears the content
 * hash of the files it couldn't parse again. Their rows are an older adapter's; a cleared hash ("" = not yet processed,
 * ADR-022) makes the next full run parse those files, and only those, with this one. Each adapter records its own, with
 * its own files' unparsed list.
 */
export function recordAdapterVersion(db: Db, repoId: number, version: number, unparsed: readonly string[], adapterId = "typescript"): void {
    db.transaction((tx) => {
        for (const batch of chunkRows(unparsed, 1, SQLITE_MAX_PARAMS - 1)){
            tx.update(files).set({ contentHash: "" }).where(and(eq(files.repoId, repoId), inArray(files.path, batch))).run();
        }
        const updatedAt = new Date();
        tx.insert(meta)
            .values({ key: adapterKey(repoId, adapterId), value: String(version), updatedAt })
            .onConflictDoUpdate({ target: meta.key, set: { value: String(version), updatedAt } })
            .run();
    });
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
