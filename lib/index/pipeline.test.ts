import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { ARCH_FIXTURE, copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { chunks, files, folders, levelEdges, repositories, symbols } from "../db/schema";
import { loadAllDocLinks, loadDocs } from "../db/store/docs";
import { loadCallBindings, loadCallsOf, loadInjectionSites, loadTypeDecls } from "../db/store/calls";
import { loadEntryPoints } from "../db/store/entries";
import { acquireIndexLock, IndexLockedError, releaseIndexLock } from "../db/store/lock";
import { deferCodeSearch, isCodeSearchDeferred, searchCode } from "../db/store/search";
import { readStages, type StoredStage } from "../db/store/stages";
import { findRepository, loadImportEdges, upsertRepository, writeFileRecords } from "../db/store/structure";
import { readAdapterVersion, writeAdapterVersion } from "../db/store/version";
import { ADAPTER_VERSION } from "./languages/typescript";
import { repoKey } from "./paths";
import { indexRepository, RepoNotFoundError, type IndexStage } from "./pipeline";

function levelRows(repoId: number, levelPath: string) {
    return getDb()
        .select({ s: levelEdges.sourceNode, t: levelEdges.targetNode, c: levelEdges.count })
        .from(levelEdges)
        .where(and(eq(levelEdges.repoId, repoId), eq(levelEdges.levelPath, levelPath)))
        .orderBy(levelEdges.sourceNode, levelEdges.targetNode)
        .all();
}

function storedRoots(): string[] {
    return getDb().select({ rootPath: repositories.rootPath }).from(repositories).all().map((r) => r.rootPath);
}

describe("indexRepository — first run on the fixture", () => {
    it("stores 8 files, 11 edges, 6 folders and 10 level edges, matching the hand-derived ground truth", () => {
        const root = copyFixture();
        const result = indexRepository(root);

        expect(result).toMatchObject({ files: 8, changed: 8, unchanged: 0, deleted: [], edges: 11, folders: 6, levelEdges: 10, errors: [], skipped: [], usedGit: false, indexedHead: null });

        expect(levelRows(result.repoId, "")).toEqual([{ s: "scripts", t: "src", c: 2 }]);
        expect(levelRows(result.repoId, "src")).toEqual([
            { s: "src/app", t: "src/core", c: 1 },
            { s: "src/app", t: "src/util", c: 1 },
            { s: "src/index.ts", t: "src/app", c: 1 },
            { s: "src/index.ts", t: "src/core", c: 1 },
            { s: "src/util", t: "src/core", c: 1 },
        ]);

        const db = getDb();
        const rootFolder = db.select({ name: folders.name, fileCount: folders.fileCount })
            .from(folders).where(and(eq(folders.repoId, result.repoId), eq(folders.path, ""))).get();
        expect(rootFolder).toEqual({ name: path.basename(root), fileCount: 8 });

        const logTs = db.select({ id: files.id, lineCount: files.lineCount, isTest: files.isTest })
            .from(files).where(and(eq(files.repoId, result.repoId), eq(files.path, "src/core/log.ts"))).get()!;
        expect(logTs).toMatchObject({ lineCount: 9, isTest: false });
        expect(db.select({ q: symbols.qualifiedName, k: symbols.kind, s: symbols.startLine, e: symbols.endLine, x: symbols.exported })
            .from(symbols).where(eq(symbols.fileId, logTs.id)).orderBy(symbols.id).all()).toEqual([
            { q: "log", k: "function", s: 2, e: 2, x: true },
            { q: "Logger", k: "class", s: 4, e: 7, x: true },
            { q: "Logger.info", k: "method", s: 5, e: 5, x: true },
            { q: "Logger.warn", k: "method", s: 6, e: 6, x: false },
            { q: "banner", k: "const", s: 9, e: 9, x: true },
        ]);

        const testFile = db.select({ isTest: files.isTest })
            .from(files).where(and(eq(files.repoId, result.repoId), eq(files.path, "src/util/strings.test.ts"))).get();
        expect(testFile).toEqual({ isTest: true });
    });

    it("records scripts/build.js as javascript and the seven .ts/.tsx files as typescript", () => {
        const { repoId } = indexRepository(copyFixture());
        const rows = getDb().select({ path: files.path, language: files.language }).from(files)
            .where(eq(files.repoId, repoId)).orderBy(files.path).all();
        expect(rows.filter((r) => r.language === "javascript").map((r) => r.path)).toEqual(["scripts/build.js"]);
        expect(rows.filter((r) => r.language === "typescript")).toHaveLength(7);
    });

    it("makes the fixture's code searchable, with each chunk's name split into words", () => {
        const { repoId } = indexRepository(copyFixture());
        const db = getDb();
        const found = db.all<{ name: string }>(sql`
            select c.name as name from code_fts
            join chunks c on c.id = code_fts.rowid join files f on f.id = c.file_id
            where code_fts match '"logger"' and f.repo_id = ${repoId} order by code_fts.rank`);
        expect(found.map((r) => r.name)).toEqual(["Logger", "(file)"]);   // both in src/core/log.ts; the name match ranks first

        const logger = db.select({ nameSplit: chunks.nameSplit }).from(chunks).innerJoin(files, eq(files.id, chunks.fileId))
            .where(and(eq(files.repoId, repoId), eq(chunks.name, "Logger"))).get();
        expect(logger).toEqual({ nameSplit: "logger" });
    });
});

describe("indexRepository — incremental runs", () => {
    it("re-indexing an unchanged repo parses nothing and keeps the graph", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(indexRepository(root)).toMatchObject({ changed: 0, unchanged: 8, edges: 11, levelEdges: 10 });
    });

    it("an edited file is re-parsed alone, and its new import appears at the right level", () => {
        const root = copyFixture();
        indexRepository(root);
        fs.appendFileSync(path.join(root, "src/util/strings.ts"), "\nimport { render } from \"../app/view\";\nexport const r = render;\n");

        const after = indexRepository(root);

        // new edge src/util/strings.ts → src/app/view.tsx; LCA(src/util, src/app) = src
        expect(after).toMatchObject({ changed: 1, unchanged: 7, edges: 12, levelEdges: 11 });
        expect(levelRows(after.repoId, "src")).toContainEqual({ s: "src/util", t: "src/app", c: 1 });
    });

    it("a deleted file disappears together with its edges", () => {
        const root = copyFixture();
        indexRepository(root);
        fs.rmSync(path.join(root, "src/util/strings.test.ts"));

        expect(indexRepository(root)).toMatchObject({ files: 7, deleted: ["src/util/strings.test.ts"], edges: 10, folders: 6, levelEdges: 9 });
    });
});

describe("indexRepository — edges of the world", () => {
    it("an empty directory yields an empty index with just a root folder, not a crash", () => {
        const empty = makeTempDir("neb-empty-");
        expect(indexRepository(empty)).toMatchObject({ files: 0, edges: 0, folders: 1, levelEdges: 0, errors: [] });
    });

    it("refuses a path that does not exist, and records no repository for it", () => {
        const missing = path.join(makeTempDir("neb-missing-"), "no-such-repo");
        expect(() => indexRepository(missing)).toThrow(RepoNotFoundError);
        expect(storedRoots()).not.toContain(repoKey(missing));
    });

    it("refuses a file given as the repo root, and records no repository for it", () => {
        const file = path.join(copyFixture(), "README.md");
        expect(() => indexRepository(file)).toThrow(RepoNotFoundError);
        expect(storedRoots()).not.toContain(repoKey(file));
    });

    it("refuses to run while another run holds the lock, and releases its own lock afterwards", () => {
        const db = getDb();
        const root = copyFixture();
        acquireIndexLock(db);
        try{
            expect(() => indexRepository(root)).toThrow(IndexLockedError);
        } finally{
            releaseIndexLock(db);
        }
        expect(() => indexRepository(root)).not.toThrow();
        expect(() => indexRepository(root)).not.toThrow(); // the previous run released its lock
    });
});

describe("indexRepository — files over the size cap (ADR-053, amended)", () => {
    const BIG = [
        'import { a } from "./a";',                       // 25 bytes with its newline
        'export type C = typeof import("./c");',          // 38
        "export function f(): number { return a; }",      // 42
        "export class K {}",                              // 18
        "",
    ].join("\n");                                         // 123 bytes, 4 lines

    function repoWithBigFile(): string {
        const dir = makeTempDir("neb-importsonly-");
        fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");                                  // 20 bytes
        fs.writeFileSync(path.join(dir, "c.ts"), "export const c = 2;\n");                                  // 20 bytes
        fs.writeFileSync(path.join(dir, "big.ts"), BIG);
        fs.writeFileSync(path.join(dir, "huge.ts"), `import { a } from "./a";\n// ${"x".repeat(300)}\n`);   // 25 + 304 = 329 bytes
        return dir;
    }

    function declarationsOf(repoId: number, filePath: string){
        const db = getDb();
        const file = db.select({ id: files.id, lineCount: files.lineCount, sizeBytes: files.sizeBytes })
            .from(files).where(and(eq(files.repoId, repoId), eq(files.path, filePath))).get()!;
        return {
            lineCount: file.lineCount,
            sizeBytes: file.sizeBytes,
            symbols: db.select({ q: symbols.qualifiedName }).from(symbols).where(eq(symbols.fileId, file.id)).all().map((s) => s.q),
            chunks: db.select({ name: chunks.name }).from(chunks).where(eq(chunks.fileId, file.id)).all().map((c) => c.name),
        };
    }

    it("indexes a file over the cap for its imports only: its edges, no declarations, no chunks; past the hard bound it is skipped", () => {
        const result = indexRepository(repoWithBigFile(), { maxFileBytes: 100, hardMaxFileBytes: 200 });

        expect(result).toMatchObject({ files: 3, changed: 3, edges: 2, errors: [], importsOnly: [{ path: "big.ts", sizeBytes: 123, importsOnly: "parse" }] });
        expect(result.skipped).toEqual([{ path: "huge.ts", reason: "too large (329 bytes)" }]);
        expect(loadImportEdges(getDb(), result.repoId).map((e) => `${e.source} -> ${e.target}`).sort()).toEqual(["big.ts -> a.ts", "big.ts -> c.ts"]);

        expect(declarationsOf(result.repoId, "big.ts")).toEqual({ lineCount: 4, sizeBytes: 123, symbols: [], chunks: [] });
        // a file under the cap is read in full, as before
        expect(declarationsOf(result.repoId, "a.ts").symbols).toEqual(["a"]);
    });

    it("parses a file up to the parse bound with the full adapter, and scans one past it: each gives an edge only its reader finds", () => {
        const dir = makeTempDir("neb-importsonly-tiers-");
        fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");                                   // 20 bytes
        fs.writeFileSync(path.join(dir, "c.ts"), "export const c = 2;\n");                                   // 20 bytes
        // the token scan misses export * as; 26 + 64 = 90 bytes, between the cap (60) and the parse bound (150)
        fs.writeFileSync(path.join(dir, "parsed.ts"), `export * as c from "./c";\n// ${"x".repeat(60)}\n`);
        // the adapter doesn't count a member require, the token scan does; 20 + 204 = 224 bytes, past the parse bound
        fs.writeFileSync(path.join(dir, "scanned.ts"), `foo.require("./a");\n// ${"x".repeat(200)}\n`);

        const result = indexRepository(dir, { maxFileBytes: 60, parseMaxFileBytes: 150, hardMaxFileBytes: 400 });

        expect(result.importsOnly).toEqual([
            { path: "parsed.ts", sizeBytes: 90, importsOnly: "parse" },
            { path: "scanned.ts", sizeBytes: 224, importsOnly: "scan" },
        ]);
        expect(loadImportEdges(getDb(), result.repoId).map((e) => `${e.source} -> ${e.target}`).sort()).toEqual(["parsed.ts -> c.ts", "scanned.ts -> a.ts"]);
        expect(declarationsOf(result.repoId, "parsed.ts")).toMatchObject({ symbols: [], chunks: [] });
    });

    it("keeps an imports-only file unchanged on the next run, edges and all", () => {
        const root = repoWithBigFile();
        indexRepository(root, { maxFileBytes: 100, hardMaxFileBytes: 200 });
        expect(indexRepository(root, { maxFileBytes: 100, hardMaxFileBytes: 200 })).toMatchObject({ files: 3, changed: 0, unchanged: 3, edges: 2 });
    });
});

describe("indexRepository — progress", () => {
    it("reports every stage in order, each ending at its total", () => {
        const root = copyFixture();
        const events: string[] = [];
        indexRepository(root, { batchSize: 3, onProgress: (stage, done, total) => events.push(`${stage} ${done}/${total}`) });

        // 8 files in batches of 3 are parsed and written at 3, 6 and 8; then 8 files resolve and 6 folders aggregate
        expect(events).toEqual([
            "discover 8/8",
            "parse 3/8", "write 3/8",
            "parse 6/8", "write 6/8",
            "parse 8/8", "write 8/8",
            "resolve 8/8",
            "aggregate 6/6",
        ]);
    });
});

describe("indexRepository — stage status", () => {
    it("marks the structure stage failed when a run dies mid-way, rethrows the error, and releases the lock", () => {
        const db = getDb();
        const root = copyFixture();
        const boom = new Error("boom");
        const structureRow = () => readStages(db, findRepository(db, repoKey(root))!).structure;   // what GET /api/status would read right now

        // the stage row that the first event of each stage finds
        const seen: Partial<Record<IndexStage, StoredStage>> = {};
        let thrown: unknown;
        try{
            indexRepository(root, {
                batchSize: 3,   // 8 files in three batches, as in the progress test
                onProgress: (stage) => {
                    if (!(stage in seen)) seen[stage] = structureRow();
                    if (stage === "resolve") throw boom;   // every file is written by now; die before any import is resolved
                },
            });
        } catch (err){
            thrown = err;
        }

        expect(thrown).toBe(boom);   // the very same error, not a copy or a wrapper
        expect(seen.discover).toMatchObject({ state: "running" });   // running from the first moment, not idle until the first batch
        expect(seen.parse).toMatchObject({ state: "running", total: 8 });   // the total is known before the first file is parsed
        expect(seen.resolve).toMatchObject({ state: "running", done: 8, total: 8 });   // every batch had been recorded by then

        const repoId = findRepository(db, repoKey(root))!;
        expect(readStages(db, repoId).structure).toMatchObject({ state: "failed", done: 0, total: 0, note: "boom" });

        // the lock was released, so the next run goes through and replaces the failure
        expect(() => indexRepository(root)).not.toThrow();
        const recovered = readStages(db, repoId).structure;
        expect(recovered).toMatchObject({ state: "ready", done: 8, total: 8 });
        expect(recovered?.note).toBeUndefined();   // nothing of the failure lingers
    });
});

describe("indexRepository — code search deferred for a bulk run (ADR-031, amended)", () => {
    it("fills code search in one go after the structure stage, with what the trigger would have written", () => {
        const root = copyFixture();
        const result = indexRepository(root, { bulkSearchThreshold: 1 });
        const db = getDb();
        expect(result.searchIndexMs).toBeGreaterThan(0);
        expect(isCodeSearchDeferred(db)).toBe(false);
        // "shout" appears in exactly 3 files' chunks (the V1.2 plan's code search facts)
        expect([...new Set(searchCode(db, result.repoId, '"shout"', 50).map((m) => m.path))].sort())
            .toEqual(["src/app/main.ts", "src/util/strings.test.ts", "src/util/strings.ts"]);
    });

    it("repairs a bulk run that died before filling, at the start of the next run", () => {
        const db = getDb();
        const crashed = upsertRepository(db, "/fts-test/crashed");
        deferCodeSearch(db);   // a bulk run began…
        writeFileRecords(db, crashed, [{
            path: "crashed.ts", kind: "module", contentHash: "h", language: "typescript", sizeBytes: 10, lineCount: 1, isTest: false,
            importSpecifiers: [], declares: [], symbols: [], calls: { types: [], bindings: [], calls: [] },
            chunks: [{ id: "crashed.ts#a#0", filePath: "crashed.ts", kind: "function", name: "a", nameSplit: "a", startLine: 1, endLine: 1, exported: true, partIndex: 0, text: "function a() {}", fileHash: "h" }],
        }]);                  // …wrote its chunks, and died before filling
        expect(searchCode(db, crashed, '"crashed"', 10)).toEqual([]);

        indexRepository(copyFixture());   // any later run repairs first
        expect(isCodeSearchDeferred(db)).toBe(false);
        expect(searchCode(db, crashed, '"crashed"', 10).map((m) => m.path)).toEqual(["crashed.ts"]);
    });
});

describe("indexRepository on the architecture fixture", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");

    it("resolves the 31 imports of the ground truth", () => {
        const result = indexRepository(root);
        expect(result.files).toBe(21);
        const db = getDb();
        const edges = loadImportEdges(db, result.repoId).map((e) => `${e.source} -> ${e.target} (${e.specifier})`).sort();
        expect(edges).toEqual([
            "packages/core/src/index.ts -> packages/core/src/log.ts (./log)",
            "packages/ui/src/button.ts -> packages/core/src/log.ts (@arch/core/lib/log)",
            "packages/ui/src/index.ts -> packages/ui/src/button.ts (./button)",
            "src/app/legacy.ts -> src/base/common/strings.ts (../base/common/strings)",
            "src/app/loader.ts -> src/app/main.ts (./main.js)",
            "src/app/main.ts -> packages/ui/src/index.ts (@arch/ui)",
            "src/app/main.ts -> src/editor/browser/editorView.ts (../editor/browser/editorView)",
            "src/app/main.ts -> src/editor/node/editorFiles.ts (../editor/node/editorFiles)",
            "src/app/main.ts -> src/platform/node/storageFile.ts (../platform/node/storageFile)",
            "src/base/browser/dom.ts -> src/base/common/strings.ts (../common/strings)",
            "src/base/common/arrays.ts -> src/base/common/strings.ts (./strings)",
            "src/base/node/fs.ts -> src/base/common/arrays.ts (../common/arrays)",
            "src/base/test/common/strings.test.ts -> src/base/common/strings.ts (../../common/strings)",
            "src/editor/browser/editorView.ts -> src/base/browser/dom.ts (../../base/browser/dom)",
            "src/editor/browser/editorView.ts -> src/editor/common/model.ts (../common/model)",
            "src/editor/common/model.ts -> src/editor/common/tokens.ts (./tokens)",
            "src/editor/common/model.ts -> src/platform/common/storage.ts (../../platform/common/storage)",
            "src/editor/common/textModel.ts -> src/base/common/strings.ts (../../base/common/strings)",
            "src/editor/common/textModel.ts -> src/editor/common/model.ts (./model)",
            "src/editor/common/tokens.ts -> src/editor/common/textModel.ts (./textModel)",
            "src/editor/node/editorFiles.ts -> src/base/node/fs.ts (../../base/node/fs)",
            "src/editor/node/editorFiles.ts -> src/editor/common/textModel.ts (../common/textModel)",
            "src/editor/node/editorFiles.ts -> src/platform/node/storageFile.ts (../../platform/node/storageFile)",
            "src/platform/browser/storageView.ts -> src/base/browser/dom.ts (../../base/browser/dom)",
            "src/platform/common/storage.ts -> src/base/common/arrays.ts (../../base/common/arrays)",
            "src/platform/common/storage.ts -> src/platform/browser/storageView.ts (../browser/storageView)",
            "src/platform/node/storageFile.ts -> packages/core/src/index.ts (@arch/core)",
            "src/platform/node/storageFile.ts -> src/base/node/fs.ts (../../base/node/fs)",
            "src/platform/node/storageFile.ts -> src/editor/common/model.ts (../../editor/common/model)",
            "src/platform/node/storageFile.ts -> src/platform/common/storage.ts (../common/storage)",
            "tools/fixtures/legacy-ids.ts -> src/base/common/strings.ts (base/common/strings)",
        ]);
    });

    it("stores the three entry points the package.json files name", () => {
        const { repoId } = indexRepository(root);
        expect([...loadEntryPoints(getDb(), repoId)].sort()).toEqual(["packages/core/src/index.ts", "packages/ui/src/index.ts", "src/app/loader.ts"]);
    });

    it("stores the 4 docs with their titles and the 13 links of the ground truth", () => {
        const { repoId } = indexRepository(root);
        const db = getDb();
        expect(loadDocs(db, repoId)).toEqual([
            { path: ".github/instructions/editor.instructions.md", title: "Editor rules" },
            { path: "README.md", title: "arch-repo" },
            { path: "docs/architecture.md", title: "Architecture" },
            { path: "src/app/README.md", title: "The app" },
        ]);
        expect(loadAllDocLinks(db, repoId).map((l) => `${l.docPath} ${l.targetPath || "(root)"} ${l.kind} ${l.count}`)).toEqual([
            ".github/instructions/editor.instructions.md src/editor applies 1",
            "README.md (root) readme 1",
            "README.md packages/core mentions 1",
            "README.md packages/ui mentions 1",
            "README.md src/app mentions 1",
            "docs/architecture.md src/app mentions 1",
            "docs/architecture.md src/base mentions 1",
            "docs/architecture.md src/editor mentions 2",
            "docs/architecture.md src/editor/browser mentions 1",
            "docs/architecture.md src/editor/common mentions 1",
            "docs/architecture.md src/platform mentions 2",
            "src/app/README.md src/app readme 1",
            "src/app/README.md src/app/loader.ts mentions 1",
        ]);
    });

    it("re-parses every file once when an older adapter parsed them, so unchanged files gain what this one reads", () => {
        const copy = copyFixture(ARCH_FIXTURE);
        const { repoId } = indexRepository(copy);
        const db = getDb();
        // as an index written before computed import(): loader.ts's stored imports lack its two literals, so edge #5 is gone
        db.update(files).set({ importSpecifiers: "[]" }).where(and(eq(files.repoId, repoId), eq(files.path, "src/app/loader.ts"))).run();
        writeAdapterVersion(db, repoId, ADAPTER_VERSION - 1);

        expect(indexRepository(copy)).toMatchObject({ files: 21, changed: 21, unchanged: 0, edges: 31 });
        expect(indexRepository(copy)).toMatchObject({ files: 21, changed: 0, unchanged: 21, edges: 31 });
    });

    it("clears the hash of a file that failed the forced re-parse, so the next full run parses it, and only it, again", () => {
        const copy = copyFixture(ARCH_FIXTURE);
        const { repoId } = indexRepository(copy);
        const db = getDb();
        db.update(files).set({ importSpecifiers: "[]" }).where(and(eq(files.repoId, repoId), eq(files.path, "src/app/loader.ts"))).run();
        writeAdapterVersion(db, repoId, ADAPTER_VERSION - 1);

        // loader.ts can't be read during the forced re-parse: discovered, then moved away before its turn
        const loader = path.join(copy, "src/app/loader.ts");
        const away = path.join(copy, "loader.moved");
        const failed = indexRepository(copy, { onProgress: (stage) => { if (stage === "discover") fs.renameSync(loader, away); } });
        fs.renameSync(away, loader);
        // its old row stays (ADR-022), with the old adapter's empty specifiers: edge #5 is still missing
        expect(failed).toMatchObject({ files: 21, changed: 20, edges: 30 });
        expect(failed.errors.map((e) => e.path)).toEqual(["src/app/loader.ts"]);
        // the other 20 were parsed by this adapter, so its version is recorded; loader.ts's hash no longer claims its bytes
        expect(readAdapterVersion(db, repoId)).toBe(ADAPTER_VERSION);
        const hashOf = (p: string) => db.select({ h: files.contentHash }).from(files).where(and(eq(files.repoId, repoId), eq(files.path, p))).get()?.h;
        expect(hashOf("src/app/loader.ts")).toBe("");
        expect(hashOf("src/app/main.ts")).not.toBe("");

        // the next full run parses loader.ts alone, with this adapter, and edge #5 is back
        expect(indexRepository(copy)).toMatchObject({ files: 21, changed: 1, unchanged: 20, edges: 31, errors: [] });
        expect(readAdapterVersion(db, repoId)).toBe(ADAPTER_VERSION);
    });
});

describe("indexRepository on the calls fixture (ADR-059)", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "di-repo");

    it("indexes 31 files, two of them tests, with 38 edges, and stores editorPane.ts's call facts", () => {
        const result = indexRepository(root);
        expect(result.files).toBe(31);
        expect(result.edges).toBe(38);
        const db = getDb();
        const ofFile = <T extends { path: string }>(rows: T[]): T[] => rows.filter((r) => r.path === "src/workbench/editor/editorPane.ts");
        expect(ofFile(loadTypeDecls(db, result.repoId)).map((t) => t.name)).toEqual(["EditorPane"]);
        expect(ofFile(loadCallBindings(db, result.repoId)).map((b) => b.local)).toEqual(["IFileService", "IWatchingFileService", "Disposable"]);
        expect(ofFile(loadCallsOf(db, result.repoId, "readFile")).map((c) => c.line)).toEqual([15, 15]);
        expect(ofFile(loadInjectionSites(db, result.repoId, "IFileService")).map((c) => c.line)).toEqual([6]);
    });
});
