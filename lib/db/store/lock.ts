import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { META_KEYS, meta } from "../schema";

/**
 * Thrown when another run holds a lock. A distinct type rather than a magic string:
 * routes map it to INDEX_LOCKED, and matching on `message` would break the moment
 * anyone rewords the sentence.
 */
export class IndexLockedError extends Error {
    constructor(startedAt: string, activity: string = "Indexing"){
        super(`${activity} already in progress (started ${startedAt}).`);
        this.name = "IndexLockedError";
    }
}

/**
 * How long a lock row may sit before it's assumed to be debris from a crashed run.
 * The lock is released in a `finally`, which doesn't run if the process is killed.
 */
export const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

export function acquireIndexLock(db: Db): void {
    acquireLock(db, META_KEYS.INDEXING_LOCK, "Indexing");
}

export function releaseIndexLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
}

/**
 * A lock is one `meta` row whose value is when its holder started. Two processes (the
 * CLI and the Next server) can get here at the same moment, so taking it must never be
 * "check, then write": both could see no row, and the second INSERT would die on the
 * UNIQUE constraint as a raw SqliteError. Every step below is one atomic statement.
 */
function acquireLock(db: Db, key: string, activity: string): void {
    const startedAt = new Date().toISOString();
    if (tryInsertLock(db, key, startedAt)) return;

    const holder = readLock(db, key);

    if (holder !== null){
        const heldSince = Date.parse(holder);
        const isStale = Number.isNaN(heldSince) || Date.now() - heldSince > LOCK_STALE_AFTER_MS;

        if (!isStale){
            throw new IndexLockedError(holder, activity);
        }

        console.warn(`[lock] clearing a stale ${activity.toLowerCase()} lock from ${holder}`);
        // Delete only the row we judged stale. If another process replaced it a moment
        // ago, this matches nothing and our insert below loses to theirs, as it should.
        db.delete(meta).where(and(eq(meta.key, key), eq(meta.value, holder))).run();
    }

    // (holder === null means the lock was released between our two statements: just try again)
    if (!tryInsertLock(db, key, startedAt)){
        throw new IndexLockedError(readLock(db, key) ?? startedAt, activity);
    }
}

/** True when this call created the lock row; false when someone else's row was already there. */
function tryInsertLock(db: Db, key: string, startedAt: string): boolean {
    return db.insert(meta).values({ key, value: startedAt }).onConflictDoNothing().run().changes === 1;
}

function readLock(db: Db, key: string): string | null {
    return db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value ?? null;
}
