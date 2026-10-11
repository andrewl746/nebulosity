import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { META_KEYS, meta } from "../schema";

/**
 * Thrown when another run holds the indexing lock. A distinct type rather than a
 * magic string: routes map it to INDEX_LOCKED, and matching on `message` would
 * break the moment anyone rewords the sentence.
 */
export class IndexLockedError extends Error {
    constructor(startedAt: string){
        super(`Indexing already in progress (started ${startedAt}).`);
        this.name = "IndexLockedError";
    }
}

/**
 * How long a lock row may sit before it's assumed to be debris from a crashed run.
 * The lock is released in a `finally`, which doesn't run if the process is killed.
 */
export const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

export function acquireIndexLock(db: Db): void {
    const lockRow = db.select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get();

    if (lockRow){
        const startedAt = Date.parse(lockRow.value);
        const isStale = Number.isNaN(startedAt) || Date.now() - startedAt > LOCK_STALE_AFTER_MS;

        if (!isStale){
            throw new IndexLockedError(lockRow.value);
        }

        console.warn(`[index] clearing stale indexing lock from ${lockRow.value}`);
        db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
    }

    db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: new Date().toISOString() }).run();
}

export function releaseIndexLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
}
