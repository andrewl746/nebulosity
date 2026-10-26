import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { chunks, folders, imports, levelEdges, symbols } from "../schema";
import { loadCallBindings, loadCallsOf, loadInjectionSites, loadTypeDecls } from "./calls";
import {
    deleteFilesNotIn, loadStoredFiles, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileRecord,
} from "./structure";

const record = (p: string, overrides: Partial<FileRecord> = {}): FileRecord => ({
    path: p, kind: "module", contentHash: `hash-${p}`, language: "typescript", sizeBytes: 10, lineCount: 1, isTest: false,
    importSpecifiers: [], declares: [],
    chunks: [{ id: `${p}#a#0`, filePath: p, kind: "function", name: "a", nameSplit: "a", startLine: 1, endLine: 1, exported: true, partIndex: 0, text: "function a() {}", fileHash: `hash-${p}` }],
    symbols: [{ name: "a", qualifiedName: "a", kind: "function", startLine: 1, endLine: 1, exported: true, parentQualifiedName: null }],
    calls: { types: [], bindings: [], calls: [] },
    ...overrides,
});

describe("structure store", () => {
    it("writes a file's call facts and a rewrite replaces them (ADR-059)", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/calls");
        const facts = {
            types: [{ name: "A", kind: "class" as const, line: 1, exported: true, nested: false, extendsRefs: ["B"], implementsRefs: [], testDoubleOf: null, members: ["run"], fields: { f: "IF" } }],
            bindings: [{ kind: "import" as const, local: "B", imported: "B", specifier: "./b" }],
            calls: [{ line: 2, member: "go", receiver: "field" as const, ref: "f", inClass: "A", how: "field" as const }],
        };
        writeFileRecords(db, repoId, [record("a.ts", { calls: facts })]);
        expect(loadTypeDecls(db, repoId)).toEqual([{ ...facts.types[0], path: "a.ts", isTest: false }]);
        expect(loadCallBindings(db, repoId)).toEqual([{ ...facts.bindings[0], path: "a.ts" }]);
        expect(loadCallsOf(db, repoId, "go")).toEqual([{ ...facts.calls[0], path: "a.ts", isTest: false }]);

        writeFileRecords(db, repoId, [record("a.ts", { contentHash: "new", calls: { types: [], bindings: [], calls: [] } })]);
        expect(loadTypeDecls(db, repoId)).toEqual([]);
        expect(loadCallBindings(db, repoId)).toEqual([]);
        expect(loadCallsOf(db, repoId, "go")).toEqual([]);
    });

    it("finds injection sites by a type's name, bare or through a namespace", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/sites");
        const site = (line: number, ref: string) => ({ line, member: null, receiver: "type" as const, ref, inClass: null, how: "provider" as const });
        writeFileRecords(db, repoId, [record("s.ts", { calls: { types: [], bindings: [], calls: [site(1, "IFoo"), site(2, "ns.IFoo"), site(3, "IFooBar"), site(4, "x.IFoo2")] } })]);
        expect(loadInjectionSites(db, repoId, "IFoo").map((s) => s.line)).toEqual([1, 2]);
    });

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

    it("writes a file's declares and reads them back (ADR-065), [] when it declares nothing", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/declares");
        writeFileRecords(db, repoId, [record("a.go", { language: "go", declares: ["package:x"] }), record("b.ts")]);
        const stored = loadStoredFiles(db, repoId);
        expect(stored.get("a.go")?.declares).toEqual(["package:x"]);
        expect(stored.get("b.ts")?.declares).toEqual([]);

        writeFileRecords(db, repoId, [record("a.go", { language: "go", contentHash: "new", declares: ["package:x", "type:T"] })]);
        expect(loadStoredFiles(db, repoId).get("a.go")?.declares).toEqual(["package:x", "type:T"]);
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
