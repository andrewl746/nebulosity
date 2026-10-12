import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "child_process";
import { eq } from "drizzle-orm";
import os from "os";
import { getDb } from "../client";
import { META_KEYS, meta } from "../schema";
import {
    IndexLockedError, LOCK_STALE_AFTER_MS, acquireIndexLock, acquireSummaryLock, isSummaryLockHeld, releaseIndexLock, releaseSummaryLock,
    touchSummaryLock,
} from "./lock";

afterEach(() => {
    vi.restoreAllMocks();
    releaseIndexLock(getDb());
    releaseSummaryLock(getDb());
});

const lockValue = () => getDb().select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get()?.value;

/** The PID of a process that has already exited: a run killed before its `finally` (Ctrl+C, a crash, a kill). */
function deadPid(): number {
    const child = spawnSync(process.execPath, ["-e", ""]);
    return child.pid!;
}

describe("index lock", () => {
    it("refuses a second holder while the first is fresh", () => {
        const db = getDb();
        acquireIndexLock(db);
        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
    });

    it("clears a stale lock left by a crashed run", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: ancient }).run();
        expect(() => acquireIndexLock(db)).not.toThrow();
        expect(lockValue()).not.toBe(ancient);
    });

    it("names the process holding it, so a later run can tell whether that process is still alive (I2)", () => {
        acquireIndexLock(getDb());
        expect(lockValue()).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\S+ pid ${process.pid} on `));
    });

    it("clears a fresh lock at once when the process holding it has died (I2)", () => {
        const db = getDb();
        const orphan = `${new Date().toISOString()} pid ${deadPid()} on ${os.hostname()}`;
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: orphan }).run();
        expect(() => acquireIndexLock(db)).not.toThrow();
        expect(lockValue()).not.toBe(orphan);
    });

    it("keeps a fresh lock whose holder is alive, or runs on another machine where its PID means nothing", () => {
        const db = getDb();
        const now = new Date().toISOString();
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: `${now} pid ${process.pid} on ${os.hostname()}` }).run();
        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
        releaseIndexLock(db);
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: `${now} pid ${deadPid()} on not-${os.hostname()}` }).run();
        expect(() => acquireIndexLock(db)).toThrow(`Indexing already in progress (started ${now}).`);
    });

    it("reports IndexLockedError, not a database error, when another process takes the lock between our check and our write", () => {
        const db = getDb();
        const insert = db.insert.bind(db);
        // The race, made deterministic: the other process's row lands just before ours.
        vi.spyOn(db, "insert").mockImplementationOnce(((table: typeof meta) => {
            insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: new Date().toISOString() }).run();
            return insert(table);
        }) as unknown as typeof db.insert);

        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
    });

    it("never deletes a fresh lock that replaced a stale one a moment earlier", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        const fresh = new Date().toISOString();
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: ancient }).run();
        const remove = db.delete.bind(db);
        // Just before our delete runs, the other process clears the stale row and takes the lock.
        vi.spyOn(db, "delete").mockImplementationOnce(((table: typeof meta) => {
            remove(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
            db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: fresh }).run();
            return remove(table);
        }) as unknown as typeof db.delete);

        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
        expect(lockValue()).toBe(fresh);
    });
});

describe("summary lock", () => {
    it("is independent of the index lock, but refuses a second summary run", () => {
        const db = getDb();
        acquireIndexLock(db);
        expect(() => acquireSummaryLock(db)).not.toThrow();
        expect(() => acquireSummaryLock(db)).toThrow(/^Summarizing already in progress/);
    });

    it("isn't held by a run that died (I2): the summaries stage may be re-derived again", () => {
        const db = getDb();
        db.insert(meta).values({ key: META_KEYS.SUMMARIZING_LOCK, value: `${new Date().toISOString()} pid ${deadPid()} on ${os.hostname()}` }).run();
        expect(isSummaryLockHeld(db)).toBe(false);
    });

    it("stays fresh while its holder keeps touching it", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        db.insert(meta).values({ key: META_KEYS.SUMMARIZING_LOCK, value: ancient }).run();
        touchSummaryLock(db);
        expect(() => acquireSummaryLock(db)).toThrow(IndexLockedError);
    });
});
