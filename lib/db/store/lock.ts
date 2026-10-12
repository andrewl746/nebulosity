import { and, eq } from "drizzle-orm";
import os from "os";
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
 * A holder known to be dead frees it sooner (isAbandoned); this is the fallback.
 */
export const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

/** A lock row's value: when its holder started, then which process on which machine holds it. */
function holderValue(startedAt: string): string {
    return `${startedAt} pid ${process.pid} on ${os.hostname()}`;
}

/** Reads a lock row's value. Rows from before holders were named (just a timestamp) have no PID. */
function parseHolder(value: string): { startedAt: string; pid: number | null; host: string | null } {
    const match = /^(\S+) pid (\d+) on (.+)$/.exec(value);
    return match ? { startedAt: match[1], pid: Number(match[2]), host: match[3] } : { startedAt: value, pid: null, host: null };
}

/**
 * Whether a lock is debris: its holder can't still be running. That's true when it's older than LOCK_STALE_AFTER_MS,
 * or at once when its process is gone. The background worker dies with the server's terminal (Ctrl+C) and never
 * reaches its `finally`; without the PID check its lock would block every update for half an hour (ADR-038, amended).
 * A PID only means something on the machine that wrote it. A reused PID makes a dead holder look alive: the safe way round.
 */
function isAbandoned(value: string, now: number): boolean {
    const holder = parseHolder(value);
    const since = Date.parse(holder.startedAt);
    if (Number.isNaN(since) || now - since > LOCK_STALE_AFTER_MS) return true;
    return holder.pid !== null && holder.host === os.hostname() && !isProcessAlive(holder.pid);
}

function isProcessAlive(pid: number): boolean {
    try{
        process.kill(pid, 0);   // signal 0 sends nothing: it only asks whether the process exists
        return true;
    } catch (err){
        return (err as NodeJS.ErrnoException).code === "EPERM";   // it exists, but belongs to another user
    }
}

export function acquireIndexLock(db: Db): void {
    acquireLock(db, META_KEYS.INDEXING_LOCK, "Indexing");
}

export function releaseIndexLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
}

/**
 * A lock is one `meta` row whose value names its holder (holderValue). Two processes (the
 * CLI and the Next server) can get here at the same moment, so taking it must never be
 * "check, then write": both could see no row, and the second INSERT would die on the
 * UNIQUE constraint as a raw SqliteError. Every step below is one atomic statement.
 */
function acquireLock(db: Db, key: string, activity: string): void {
    const mine = holderValue(new Date().toISOString());
    if (tryInsertLock(db, key, mine)) return;

    const holder = readLock(db, key);

    if (holder !== null){
        if (!isAbandoned(holder, Date.now())){
            throw new IndexLockedError(parseHolder(holder).startedAt, activity);
        }

        console.warn(`[lock] clearing an abandoned ${activity.toLowerCase()} lock (${holder})`);
        // Delete only the row we judged stale. If another process replaced it a moment
        // ago, this matches nothing and our insert below loses to theirs, as it should.
        db.delete(meta).where(and(eq(meta.key, key), eq(meta.value, holder))).run();
    }

    // (holder === null means the lock was released between our two statements: just try again)
    if (!tryInsertLock(db, key, mine)){
        throw new IndexLockedError(parseHolder(readLock(db, key) ?? mine).startedAt, activity);
    }
}

/** True when this call created the lock row; false when someone else's row was already there. */
function tryInsertLock(db: Db, key: string, value: string): boolean {
    return db.insert(meta).values({ key, value }).onConflictDoNothing().run().changes === 1;
}

function readLock(db: Db, key: string): string | null {
    return db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value ?? null;
}

/** Summary runs take a lock of their own: indexing may go on meanwhile, but two summary runs would pay twice. */
export function acquireSummaryLock(db: Db): void {
    acquireLock(db, META_KEYS.SUMMARIZING_LOCK, "Summarizing");
}

export function releaseSummaryLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.SUMMARIZING_LOCK)).run();
}

/** A batch wait can last hours. Refreshing the timestamp keeps a live run's lock from ever looking abandoned. */
export function touchSummaryLock(db: Db): void {
    db.update(meta).set({ value: holderValue(new Date().toISOString()), updatedAt: new Date() }).where(eq(meta.key, META_KEYS.SUMMARIZING_LOCK)).run();
}

/** Whether a live summary run holds the summarizing lock: a row that isn't abandoned (isAbandoned). */
export function isSummaryLockHeld(db: Db, now: Date = new Date()): boolean {
    const holder = readLock(db, META_KEYS.SUMMARIZING_LOCK);
    return holder !== null && !isAbandoned(holder, now.getTime());
}
