import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { files, imports, repositories } from "./schema";
import { chunkRows, columnCount, forEachBatch } from "./batch";

describe("chunkRows", () => {
    it("splits rows so no batch exceeds the parameter budget", () => {
        // 12 params / 4 per row = 3 rows per batch
        expect(chunkRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, 12)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
    });

    it("returns no batches for no rows", () => {
        expect(chunkRows([], 3)).toEqual([]);
    });

    it("still makes progress when one row alone exceeds the budget", () => {
        expect(chunkRows(["a", "b"], 20, 12)).toEqual([["a"], ["b"]]);
    });

    it("rejects a non-positive row width", () => {
        expect(() => chunkRows([1], 0)).toThrow("paramsPerRow must be >= 1");
    });
});

describe("columnCount", () => {
    it("counts every column of a table, the autoincrement id included", () => {
        expect(columnCount(imports)).toBe(4); // id, source_file_id, target_file_id, specifier
    });
});

describe("forEachBatch against SQLite", () => {
    it("writes 11,000 import rows, more than one statement can hold, without 'too many SQL variables'", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/batch-test" }).returning().get();
        const fileRows = Array.from({ length: 120 }, (_, i) => ({ repoId: repo.id, path: `f${i}.ts`, kind: "module" as const, contentHash: "" }));
        const ids = db.insert(files).values(fileRows).returning({ id: files.id }).all().map((r) => r.id);

        const pairs: { sourceFileId: number; targetFileId: number; specifier: string }[] = [];
        for (const s of ids) for (const t of ids) if (s !== t && pairs.length < 11_000) pairs.push({ sourceFileId: s, targetFileId: t, specifier: "./x" });

        db.transaction((tx) => forEachBatch(pairs, columnCount(imports), (batch) => { tx.insert(imports).values(batch).run(); }));

        const count = db.all<{ c: number }>(sql`select count(*) as c from imports i join files f on f.id = i.source_file_id where f.repo_id = ${repo.id}`)[0].c;
        expect(count).toBe(11_000);
    });
});
