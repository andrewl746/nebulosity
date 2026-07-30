import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

function createDb(){
    const sqlite = new Database(".nebulosity/nebulosity.db");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    return drizzle(sqlite, {schema});
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
