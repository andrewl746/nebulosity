import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";
import { nebulosityPath } from "../home";

/** How a process opens the database. Everything writes except the MCP server, which only reads (ADR-030, ADR-044). */
export type DbMode = "readwrite" | "readonly";

/** A read-only open found no database file: nothing has been indexed on this machine yet. */
export class DatabaseMissingError extends Error {
    constructor(file: string){
        super(`No repository indexed yet: there's no index at ${file}. In the Nebulosity folder, run npm run index -- <path-to-repo>.`);
        this.name = "DatabaseMissingError";
    }
}

/**
 * A read-only open found a database behind this checkout's migrations. A reader may not migrate (only the Next server
 * and the CLI own the schema, PIVOT_SPEC.md §3), and reading on would fail later on a missing column.
 */
export class DatabaseOutdatedError extends Error {
    constructor(){
        super("Nebulosity's index is older than this version of Nebulosity. Start the Map (npm run dev) or run npm run index -- <path-to-repo> once in the Nebulosity folder to update it, then try again.");
        this.name = "DatabaseOutdatedError";
    }
}

const migrationsFolder = (): string => nebulosityPath("lib", "db", "migrations");

const connect = (sqlite: Database.Database) => drizzle(sqlite, { schema });

/** The database handle every store function takes. */
export type Db = ReturnType<typeof connect>;

/**
 * Opens a database file, or ":memory:" for a throwaway one.
 * - readwrite: WAL, NORMAL sync, foreign keys, then any pending migration (ADR-023).
 * - readonly (the MCP server, ADR-044): the file must exist and be fully migrated, and the database itself is never
 *   written: no pragmas, no migrations. SQLite may still create its -wal and -shm side files beside it (its WAL index)
 *   when either is missing, so the folder must be writable at those times; with both already there it reads without
 *   writing anything. The file is already in WAL mode (a writer set it, and the mode persists in the file), so it reads
 *   while the background worker writes, and every query sees the newest commit.
 */
export function openDb(file: string, mode: DbMode = "readwrite"): Db {
    if (mode === "readonly") return openReadOnly(file);

    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const sqlite = new Database(file);
    sqlite.pragma("journal_mode = WAL");
    // NORMAL is SQLite's recommended pairing for WAL: still corruption-safe, but a
    // commit no longer waits for an fsync. Indexing VS Code commits ~30 batches, and
    // FULL would make every one of them wait on the disk.
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");

    const db = connect(sqlite);

    // Migrate every database, not just the in-memory test one. Drizzle records
    // applied migrations in its own table, so this is idempotent and cheap on an
    // already-current file, and it is what makes "delete the .db file and it
    // self-heals on the next request" (Phase D's acceptance criterion) actually
    // true. Migrating only :memory: also meant schema drift could never be
    // caught by the test suite, because the tests were the only thing running
    // the migrations at all.
    migrate(db, { migrationsFolder: migrationsFolder() });

    return db;
}

function openReadOnly(file: string): Db {
    if (!fs.existsSync(file)) throw new DatabaseMissingError(file);
    const sqlite = new Database(file, { readonly: true, fileMustExist: true });
    try{
        assertMigrated(sqlite);
    } catch (err){
        sqlite.close();
        throw err;
    }
    return connect(sqlite);
}

/**
 * Every migration this checkout has must already be applied. Drizzle records each one in __drizzle_migrations with its
 * folder's timestamp and applies those newer than the newest recorded; this asks the same question and applies nothing.
 */
function assertMigrated(sqlite: Database.Database): void {
    const newest = Math.max(...readMigrationFiles({ migrationsFolder: migrationsFolder() }).map((m) => m.folderMillis));
    let applied: number | null = null;
    try{
        const row = sqlite.prepare("select max(created_at) as at from __drizzle_migrations").get() as { at: number | string | null };
        applied = row.at === null ? null : Number(row.at);
    } catch (err){
        // Only a missing table means "never migrated". Anything else (not a database, SQLITE_BUSY, an I/O error, an
        // unwritable -shm) is a different problem, and "start the Map" would not fix it: let it through.
        if (!/no such table/.test(err instanceof Error ? err.message : String(err))) throw err;
    }
    if (applied === null || applied < newest) throw new DatabaseOutdatedError();
}

const globalForDb = globalThis as unknown as { db?: Db; readOnly?: boolean };

/** The MCP server's first act (ADR-044): this process only reads. It must come before the database is first opened. */
export function useReadOnlyDatabase(): void {
    if (globalForDb.db && !globalForDb.readOnly) throw new Error("useReadOnlyDatabase() must run before the database is first opened.");
    globalForDb.readOnly = true;
}

export function getDb(): Db {
    if (!globalForDb.db){
        // Vitest gets a throwaway in-memory database, whatever the mode: a test never opens a real file through here.
        // Everything else opens the file under NEBULOSITY_HOME (lib/home.ts), never relative to cwd, because the MCP server
        // is launched from inside the user's repository. A failed open isn't kept, so the next call tries again: the MCP
        // server may start before anything is indexed.
        globalForDb.db = process.env.VITEST
            ? openDb(":memory:")
            : openDb(nebulosityPath(".nebulosity", "nebulosity.db"), globalForDb.readOnly ? "readonly" : "readwrite");
    }

    return globalForDb.db;
}
