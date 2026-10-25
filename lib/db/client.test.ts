import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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

describe("migration 0010 (files.declares, ADR-065)", () => {
    it("gives every file of a database at migration 0009 the declares []", () => {
        // a copy of the migrations up to 0009: the folder drizzle reads, its journal cut after 0009's entry
        const upTo9 = makeTempDir("neb-migrations-");
        fs.cpSync(path.resolve("lib/db/migrations"), upTo9, { recursive: true });
        for (const name of fs.readdirSync(upTo9)) if (name.startsWith("0010_")) fs.rmSync(path.join(upTo9, name));
        fs.rmSync(path.join(upTo9, "meta", "0010_snapshot.json"));
        const journalFile = path.join(upTo9, "meta", "_journal.json");
        const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number }[] };
        journal.entries = journal.entries.filter((e) => e.idx <= 9);
        fs.writeFileSync(journalFile, JSON.stringify(journal));

        const file = tempDatabase();
        const old = new Database(file);
        migrate(drizzle(old), { migrationsFolder: upTo9 });
        expect((old.prepare("select name from pragma_table_info('files')").all() as { name: string }[]).map((c) => c.name)).not.toContain("declares");
        const repoId = Number(old.prepare("insert into repositories (root_path) values ('/migrate/0009')").run().lastInsertRowid);
        old.prepare("insert into files (repo_id, path, kind, content_hash) values (?, 'a.ts', 'module', 'h'), (?, 'b.ts', 'module', 'h')").run(repoId, repoId);
        old.close();

        const migrated = openDb(file);
        withOpen([migrated], () => {
            expect(migrated.all<{ path: string; declares: string }>(sql`select path, declares from files order by path`))
                .toEqual([{ path: "a.ts", declares: "[]" }, { path: "b.ts", declares: "[]" }]);
        });
    });
});

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

    it("lets any other failure through: a file that isn't a database is not 'out of date'", () => {
        const file = tempDatabase();
        fs.writeFileSync(file, "x".repeat(4_096));
        // SQLite's documented text for SQLITE_NOTADB is "file is not a database"; "start the Map" would not help here
        let thrown: unknown;
        try{
            openDb(file, "readonly");
        } catch (err){
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toMatch(/not a database/);
        expect(thrown).not.toBeInstanceOf(DatabaseOutdatedError);
    });
});
