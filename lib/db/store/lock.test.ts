import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { META_KEYS, meta } from "../schema";
import { IndexLockedError, LOCK_STALE_AFTER_MS, acquireIndexLock, releaseIndexLock } from "./lock";

afterEach(() => releaseIndexLock(getDb()));

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
        expect(db.select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get()?.value).not.toBe(ancient);
    });
});
