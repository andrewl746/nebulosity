import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "./schema";

function createDb(){
    // either creates a database from .nebulosity/nebulosity.db OR from memory if it's running under Vitest (testing)
    const dbPath = process.env.VITEST ? ":memory:" : ".nebulosity/nebulosity.db";
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, {schema});

    // Migrate every database, not just the in-memory test one. Drizzle records
    // applied migrations in its own table, so this is idempotent and cheap on an
    // already-current file — and it is what makes "delete the .db file and it
    // self-heals on the next request" (Phase D's acceptance criterion) actually
    // true. Migrating only :memory: also meant schema drift could never be
    // caught by the test suite, because the tests were the only thing running
    // the migrations at all.
    migrate(db, { migrationsFolder: "./lib/db/migrations" });

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
