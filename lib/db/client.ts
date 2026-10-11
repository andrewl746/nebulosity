import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "./schema";
import { nebulosityPath } from "../home";

function createDb(){
    // Vitest gets a throwaway in-memory database. Everything else opens the real file
    // under NEBULOSITY_HOME (lib/home.ts), never relative to cwd, because the MCP
    // server is launched from inside the user's repository.
    const dbPath = process.env.VITEST ? ":memory:" : nebulosityPath(".nebulosity", "nebulosity.db");

    if (dbPath !== ":memory:"){
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    // NORMAL is SQLite's recommended pairing for WAL: still corruption-safe, but a
    // commit no longer waits for an fsync. Indexing VS Code commits ~30 batches, and
    // FULL would make every one of them wait on the disk.
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, {schema});

    // Migrate every database, not just the in-memory test one. Drizzle records
    // applied migrations in its own table, so this is idempotent and cheap on an
    // already-current file, and it is what makes "delete the .db file and it
    // self-heals on the next request" (Phase D's acceptance criterion) actually
    // true. Migrating only :memory: also meant schema drift could never be
    // caught by the test suite, because the tests were the only thing running
    // the migrations at all.
    migrate(db, { migrationsFolder: nebulosityPath("lib", "db", "migrations") });

    return db;
}

const globalForDb = globalThis as unknown as {
    db?: ReturnType<typeof createDb>;
};

export function getDb(){
    if (!globalForDb.db){
        globalForDb.db = createDb();
    }

    return globalForDb.db;
}

/** The database handle every store function takes. */
export type Db = ReturnType<typeof getDb>;
