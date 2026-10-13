import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/helpers/temp";
import { DatabaseMissingError, DatabaseOutdatedError, openDb, type Db } from "./client";
import { meta } from "./schema";

const tempDatabase = (): string => path.join(makeTempDir("neb-db-"), "nebulosity.db");
const row = (key: string, value: string) => ({ key, value, updatedAt: new Date() });

/** Runs `body`, then closes the handles, so Windows lets the temp folder go. */
function withOpen<T>(handles: Db[], body: () => T): T {
    try{
        return body();
    } finally{
        for (const handle of handles) handle.$client.close();
    }
}

describe("openDb, read-only (ADR-044)", () => {
    it("reads what a writer commits, even after it opened, and refuses to write", () => {
        const file = tempDatabase();
        const writer = openDb(file);
        writer.insert(meta).values(row("before", "1")).run();
        const reader = openDb(file, "readonly");
        withOpen([writer, reader], () => {
            writer.insert(meta).values(row("after", "2")).run();
            expect(reader.select({ value: meta.value }).from(meta).where(eq(meta.key, "before")).get()).toEqual({ value: "1" });
            expect(reader.select({ value: meta.value }).from(meta).where(eq(meta.key, "after")).get()).toEqual({ value: "2" });
            expect(() => reader.insert(meta).values(row("nope", "3")).run()).toThrow(/readonly/);
        });
    });

    it("says nothing is indexed when there's no file, and creates none", () => {
        const file = tempDatabase();
        expect(() => openDb(file, "readonly")).toThrow(DatabaseMissingError);
        expect(fs.existsSync(file)).toBe(false);
    });

    it("refuses a database without this checkout's newest migration", () => {
        const file = tempDatabase();
        const writer = openDb(file);
        writer.run(sql`delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)`);
        writer.$client.close();
        expect(() => openDb(file, "readonly")).toThrow(DatabaseOutdatedError);
    });

    it("refuses a database that was never migrated", () => {
        const file = tempDatabase();
        new Database(file).close();
        expect(() => openDb(file, "readonly")).toThrow(DatabaseOutdatedError);
    });
});
