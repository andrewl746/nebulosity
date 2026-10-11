import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { META_KEYS, meta } from "../schema";
import { IndexLockedError, LOCK_STALE_AFTER_MS, acquireIndexLock, acquireSummaryLock, releaseIndexLock, releaseSummaryLock, touchSummaryLock } from "./lock";

afterEach(() => {
    vi.restoreAllMocks();
    releaseIndexLock(getDb());
    releaseSummaryLock(getDb());
});

const lockValue = () => getDb().select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get()?.value;

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

    it("stays fresh while its holder keeps touching it", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        db.insert(meta).values({ key: META_KEYS.SUMMARIZING_LOCK, value: ancient }).run();
        touchSummaryLock(db);
        expect(() => acquireSummaryLock(db)).toThrow(IndexLockedError);
    });
});
