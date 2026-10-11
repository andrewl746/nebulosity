import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { chunks, files, repositories } from "./schema";

describe("schema (V1.1)", () => {
    it("creates the pivot tables", () => {
        const names = getDb()
            .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
            .map((r) => r.name);
        expect(names).toEqual(expect.arrayContaining(["folders", "level_edges", "symbols"]));
    });

    it("adds the new files columns with defaults", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/defaults" }).returning().get();
        const row = db.insert(files).values({ repoId: repo.id, path: "a.ts", kind: "module", contentHash: "" }).returning().get();
        expect(row).toMatchObject({ language: "typescript", sizeBytes: 0, lineCount: 0, isTest: false, importSpecifiers: "[]" });
    });

    it("lets two repos hold the same chunk id (unique per file, not globally)", () => {
        const db = getDb();
        const repoA = db.insert(repositories).values({ rootPath: "/schema-test/a" }).returning().get();
        const repoB = db.insert(repositories).values({ rootPath: "/schema-test/b" }).returning().get();
        const fileA = db.insert(files).values({ repoId: repoA.id, path: "src/index.ts", kind: "module", contentHash: "" }).returning().get();
        const fileB = db.insert(files).values({ repoId: repoB.id, path: "src/index.ts", kind: "module", contentHash: "" }).returning().get();
        const chunk = { chunkId: "src/index.ts#start#0", kind: "function" as const, name: "start", startLine: 1, endLine: 2, text: "x", fileHash: "h" };
        db.insert(chunks).values([{ ...chunk, fileId: fileA.id }, { ...chunk, fileId: fileB.id }]).run();
        const count = db.all<{ c: number }>(sql`select count(*) as c from chunks where chunk_id = 'src/index.ts#start#0'`)[0].c;
        expect(count).toBe(2);
    });
});
