import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { chunks, files, folders, levelEdges, repositories, symbols } from "../db/schema";
import { acquireIndexLock, IndexLockedError, releaseIndexLock } from "../db/store/lock";
import { readStages, type StoredStage } from "../db/store/stages";
import { findRepository } from "../db/store/structure";
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
