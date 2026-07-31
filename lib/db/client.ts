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

    if (dbPath === ":memory:"){
        migrate(db, { migrationsFolder: "./lib/db/migrations" })
    }
    
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
