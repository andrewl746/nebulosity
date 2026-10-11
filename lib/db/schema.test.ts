import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { chunks, files, repositories, summaries } from "./schema";

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

describe("schema (V1.2)", () => {
    it("creates the summary tables, both search indexes and their triggers", () => {
        const names = getDb()
            .all<{ name: string }>(sql`select name from sqlite_master where type in ('table', 'trigger')`)
            .map((r) => r.name);
        expect(names).toEqual(expect.arrayContaining([
            "summaries", "summary_vectors", "summary_usage", "code_fts", "summary_fts",
            "chunks_fts_insert", "chunks_fts_delete", "summaries_fts_insert", "summaries_fts_update", "summaries_fts_delete",
        ]));
    });

    it("keeps code_fts in step with chunks, including when a file delete cascades", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/fts-code" }).returning().get();
        const file = db.insert(files).values({ repoId: repo.id, path: "fts-code/tabs.ts", kind: "module", contentHash: "" }).returning().get();
        db.insert(chunks).values({
            fileId: file.id, chunkId: "fts-code/tabs.ts#openEditor#0", kind: "function", name: "openEditor",
            nameSplit: "open editor", startLine: 1, endLine: 1, text: "function openEditor() {}", fileHash: "h",
        }).run();
        const matches = () => db.all<{ path: string }>(sql`select path from code_fts where code_fts match '"editor"' and path = 'fts-code/tabs.ts'`);

        expect(matches()).toEqual([{ path: "fts-code/tabs.ts" }]);   // found through name_split
        db.delete(files).where(eq(files.id, file.id)).run();          // cascades to chunks, whose trigger cleans code_fts
        expect(matches()).toEqual([]);
    });

    it("indexes a summary once it has text, follows rewrites, and forgets deleted ones", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/fts-summary" }).returning().get();
        const row = db.insert(summaries).values({ repoId: repo.id, targetKind: "file", targetPath: "fts-summary/a.ts", status: "pending" }).returning().get();
        const find = (word: string) => db.all<{ path: string }>(
            sql`select path from summary_fts where summary_fts match ${`"${word}"`} and path = 'fts-summary/a.ts'`);

        expect(find("tabs")).toEqual([]);                                   // no text yet: nothing indexed
        db.update(summaries).set({ tagline: "Editor tabs", summary: "Draws the tab strip.", status: "fresh" }).where(eq(summaries.id, row.id)).run();
        expect(find("tabs")).toEqual([{ path: "fts-summary/a.ts" }]);
        db.update(summaries).set({ tagline: "Status bar", summary: "Shows the cursor position." }).where(eq(summaries.id, row.id)).run();
        expect(find("tabs")).toEqual([]);
        expect(find("cursor")).toEqual([{ path: "fts-summary/a.ts" }]);
        db.delete(summaries).where(eq(summaries.id, row.id)).run();
        expect(find("cursor")).toEqual([]);
    });

    it("ranks a word in a declaration's name above the same word in another one's body", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/fts-rank" }).returning().get();
        const file = db.insert(files).values({ repoId: repo.id, path: "fts-rank/x.ts", kind: "module", contentHash: "" }).returning().get();
        const chunk = { fileId: file.id, kind: "function" as const, startLine: 1, endLine: 1, fileHash: "h" };
        // The bodies are sized so this fails if the stored bm25 weights are missing: plain bm25 would pick the short body.
        const longBody = Array.from({ length: 40 }, (_, i) => `step${i}();`).join(" ");
        db.insert(chunks).values([
            { ...chunk, chunkId: "a", name: "helper", nameSplit: "helper", text: "function helper() { tabs }" },
            { ...chunk, chunkId: "b", name: "renderTabs", nameSplit: "render tabs", text: `function renderTabs() { ${longBody} }` },
        ]).run();
        const ranked = db.all<{ name: string }>(sql`
            select c.name as name from code_fts join chunks c on c.id = code_fts.rowid
            where code_fts match '"tabs"' and code_fts.path = 'fts-rank/x.ts' order by code_fts.rank`);
        expect(ranked.map((r) => r.name)).toEqual(["renderTabs", "helper"]);
    });
});
