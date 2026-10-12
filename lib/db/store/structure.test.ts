import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { chunks, folders, imports, levelEdges, symbols } from "../schema";
import {
    deleteFilesNotIn, loadStoredFiles, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileRecord,
} from "./structure";

const record = (p: string, overrides: Partial<FileRecord> = {}): FileRecord => ({
    path: p, kind: "module", contentHash: `hash-${p}`, language: "typescript", sizeBytes: 10, lineCount: 1, isTest: false,
    importSpecifiers: [],
    chunks: [{ id: `${p}#a#0`, filePath: p, kind: "function", name: "a", nameSplit: "a", startLine: 1, endLine: 1, exported: true, partIndex: 0, text: "function a() {}", fileHash: `hash-${p}` }],
    symbols: [{ name: "a", qualifiedName: "a", kind: "function", startLine: 1, endLine: 1, exported: true, parentQualifiedName: null }],
    ...overrides,
});

describe("structure store", () => {
    it("upsertRepository returns the same id for the same root", () => {
        const db = getDb();
        expect(upsertRepository(db, "/store/a")).toBe(upsertRepository(db, "/store/a"));
    });

    it("writes file rows with chunks and symbols, and a rewrite replaces rather than duplicates", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/b");
        expect(writeFileRecords(db, repoId, [record("x.ts"), record("y.ts", { importSpecifiers: ["./x"] })])).toEqual([]);
        expect(writeFileRecords(db, repoId, [record("x.ts", { contentHash: "new" })])).toEqual([]);

        const stored = loadStoredFiles(db, repoId);
        expect([...stored.keys()].sort()).toEqual(["x.ts", "y.ts"]);
        expect(stored.get("x.ts")?.contentHash).toBe("new");
        expect(stored.get("y.ts")?.importSpecifiers).toEqual(["./x"]);

        const xId = stored.get("x.ts")!.id;
        expect(db.select().from(chunks).where(eq(chunks.fileId, xId)).all()).toHaveLength(1);
        expect(db.select().from(symbols).where(eq(symbols.fileId, xId)).all()).toHaveLength(1);
    });

    it("isolates a file that fails to write, so the rest of its batch still lands", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/c");
        const chunk = record("bad.ts").chunks[0];
        const bad = record("bad.ts", { chunks: [chunk, chunk] }); // same chunk id twice in one file → unique violation

        const errors = writeFileRecords(db, repoId, [record("good.ts"), bad]);

        expect(errors.map((e) => e.path)).toEqual(["bad.ts"]);
        expect([...loadStoredFiles(db, repoId).keys()]).toEqual(["good.ts"]);
    });

    it("replaceImports drops edges with unknown ends and replaces the previous set", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/d");
        writeFileRecords(db, repoId, [record("a.ts"), record("b.ts"), record("c.ts")]);

        expect(replaceImports(db, repoId, [
            { source: "a.ts", target: "b.ts", specifier: "./b" },
            { source: "a.ts", target: "zzz.ts", specifier: "./zzz" },
        ])).toBe(1);
        expect(replaceImports(db, repoId, [{ source: "b.ts", target: "c.ts", specifier: "./c" }])).toBe(1);

        const rows = db.all<{ s: string; t: string }>(sql`
            select fs.path as s, ft.path as t from imports i
            join files fs on fs.id = i.source_file_id
            join files ft on ft.id = i.target_file_id
            where fs.repo_id = ${repoId}`);
        expect(rows).toEqual([{ s: "b.ts", t: "c.ts" }]);
    });

    it("deleteFilesNotIn removes vanished files and cascades their chunks, symbols and imports", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/e");
        writeFileRecords(db, repoId, [record("keep.ts"), record("gone.ts")]);
        replaceImports(db, repoId, [{ source: "gone.ts", target: "keep.ts", specifier: "./keep" }]);
        const goneId = loadStoredFiles(db, repoId).get("gone.ts")!.id;

        expect(deleteFilesNotIn(db, repoId, new Set(["keep.ts"]))).toEqual(["gone.ts"]);
        expect(db.select().from(chunks).where(eq(chunks.fileId, goneId)).all()).toEqual([]);
        expect(db.select().from(symbols).where(eq(symbols.fileId, goneId)).all()).toEqual([]);
        expect(db.select().from(imports).where(eq(imports.sourceFileId, goneId)).all()).toEqual([]);
    });

    it("replaceAggregates swaps the folder tree and level edges wholesale", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/f");
        replaceAggregates(db, repoId,
            [{ path: "", parentPath: null, depth: 0, name: "f", fileCount: 1, directFileCount: 1 }],
            [{ levelPath: "", sourceNode: "a.ts", targetNode: "b.ts", count: 1 }]);
        replaceAggregates(db, repoId,
            [{ path: "", parentPath: null, depth: 0, name: "f", fileCount: 2, directFileCount: 2 }],
            []);

        expect(db.select({ fileCount: folders.fileCount }).from(folders).where(eq(folders.repoId, repoId)).all()).toEqual([{ fileCount: 2 }]);
        expect(db.select().from(levelEdges).where(eq(levelEdges.repoId, repoId)).all()).toEqual([]);
    });

    it("puts every written chunk into code search and takes it out again when the file changes or goes", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/fts");
        const withChunk = (name: string, nameSplit: string) => record("fts/widget.ts", {
            chunks: [{ id: `fts/widget.ts#${name}#0`, filePath: "fts/widget.ts", kind: "function", name, nameSplit, startLine: 1, endLine: 1, exported: true, partIndex: 0, text: `function ${name}() {}`, fileHash: "h" }],
        });
        const hits = (word: string) => db.all<{ path: string }>(sql`select path from code_fts where code_fts match ${`"${word}"`} and path = 'fts/widget.ts'`);

        writeFileRecords(db, repoId, [withChunk("openEditor", "open editor")]);
        expect(hits("editor")).toHaveLength(1);

        writeFileRecords(db, repoId, [withChunk("closeTab", "close tab")]);   // same file, new content
        expect(hits("editor")).toEqual([]);
        expect(hits("tab")).toHaveLength(1);

        deleteFilesNotIn(db, repoId, new Set());
        expect(hits("tab")).toEqual([]);
    });
});
