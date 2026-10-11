import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { FILES } from "../../../test/helpers/mini-repo-facts";
import { getDb } from "../client";
import { summaryVectors } from "../schema";
import { indexRepository } from "../../index/pipeline";
import { upsertRepository } from "./structure";
import {
    addUsage, applyTargetUpdates, countInFlight, inFlightBatches, loadBatchRows, loadFileFacts, loadFileSummaryChunk,
    loadFolderFacts, loadSummaries, loadUsage, markInFlight, pruneSummaries, targetKey, writeResults,
} from "./summaries";

const ok = (tagline: string) => ({ ok: true as const, text: { tagline, summary: "S" }, model: "m" });

describe("summary store — facts for the planner", () => {
    it("loads every file with how many files import it, in path order", () => {
        const { repoId } = indexRepository(copyFixture());
        expect(loadFileFacts(getDb(), repoId).map((f) => [f.path, f.importedBy, f.isTest, f.lineCount]))
            .toEqual(FILES.map((f) => [f.path, f.importedBy, f.isTest, f.lineCount]));
    });

    it("loads the folder tree with its file counts", () => {
        const { repoId } = indexRepository(copyFixture());
        expect(loadFolderFacts(getDb(), repoId).map((f) => [f.path, f.parentPath, f.depth, f.fileCount, f.directFileCount])).toEqual([
            ["", null, 0, 8, 0],
            ["scripts", "", 1, 1, 1],
            ["src", "", 1, 7, 1],
            ["src/app", "src", 2, 2, 2],
            ["src/core", "src", 2, 2, 2],
            ["src/util", "src", 2, 2, 2],
        ]);
    });

    it("finds a file's generated imports/exports listing, which opens its summary prompt", () => {
        const { repoId } = indexRepository(copyFixture());
        const listing = loadFileSummaryChunk(getDb(), repoId, "src/core/log.ts");
        expect(listing?.split("\n")[0]).toBe("File: src/core/log.ts");
        expect(listing).toContain("Logger (class)");
        expect(loadFileSummaryChunk(getDb(), repoId, "src/nope.ts")).toBeNull();
    });
});

describe("summary store — rows", () => {
    it("creates rows for new targets, writes templates at once, and returns every row id by key", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/rows");
        const ids = applyTargetUpdates(db, repoId, [
            { kind: "file", path: "a.ts", inputHash: "h1", status: "pending" },
            { kind: "file", path: "a.test.ts", inputHash: "h2", status: "skipped", templateText: { tagline: "Tests for a", summary: "Test code." } },
            { kind: "repo", path: "", inputHash: "h3", status: "pending" },
        ]);

        expect([...ids.keys()].sort()).toEqual(["file:a.test.ts", "file:a.ts", "repo:"]);
        const rows = loadSummaries(db, repoId);
        expect(rows.find((r) => r.path === "a.ts")).toMatchObject({ status: "pending", tagline: null, inputHash: null });
        expect(rows.find((r) => r.path === "a.test.ts")).toMatchObject({ status: "skipped", tagline: "Tests for a", model: "template", inputHash: "h2" });
    });

    it("changes an existing row's status only when asked, and keeps its text", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/status");
        const id = applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h1", status: "pending" }]).get("file:a.ts")!;
        writeResults(db, [{ id, batchId: null, inputHash: "h1", outcome: ok("T") }]);

        applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h2", status: "stale" }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "stale", tagline: "T", inputHash: "h1" });
        applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h2", status: null }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "stale" });
    });

    it("tracks which rows a batch carries, and lets only that batch's answers land", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/batch");
        const ids = applyTargetUpdates(db, repoId, [
            { kind: "file", path: "a.ts", inputHash: "ha", status: "pending" },
            { kind: "file", path: "b.ts", inputHash: "hb", status: "pending" },
        ]);
        const a = ids.get("file:a.ts")!;
        const b = ids.get("file:b.ts")!;
        markInFlight(db, "batch-1", [{ id: a, inputHash: "ha" }, { id: b, inputHash: "hb" }]);

        expect(inFlightBatches(db, repoId)).toEqual(["batch-1"]);
        expect(countInFlight(db, repoId)).toBe(2);
        expect(loadBatchRows(db, "batch-1").map((r) => [r.path, r.inputHash])).toEqual([["a.ts", "ha"], ["b.ts", "hb"]]);

        // b.ts is redone through the regular API meanwhile, so batch-1's late answer for it must not land
        expect(writeResults(db, [{ id: b, batchId: null, inputHash: "hb", outcome: ok("Direct") }])).toBe(1);
        expect(writeResults(db, [
            { id: a, batchId: "batch-1", inputHash: "ha", outcome: ok("From batch") },
            { id: b, batchId: "batch-1", inputHash: "hb", outcome: ok("Late") },
        ])).toBe(1);

        expect(loadSummaries(db, repoId).map((r) => [r.path, r.tagline, r.status, r.batchId]))
            .toEqual([["a.ts", "From batch", "fresh", null], ["b.ts", "Direct", "fresh", null]]);
        expect(inFlightBatches(db, repoId)).toEqual([]);
    });

    it("a failure keeps the old text; a new summary drops the old vector", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/results");
        const id = applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h1", status: "pending" }]).get("file:a.ts")!;
        writeResults(db, [{ id, batchId: null, inputHash: "h1", outcome: ok("Old") }]);
        db.insert(summaryVectors).values({ summaryId: id, embedding: Buffer.alloc(4) }).run();
        const vectors = () => db.select().from(summaryVectors).where(eq(summaryVectors.summaryId, id)).all();

        writeResults(db, [{ id, batchId: null, inputHash: "h2", outcome: { ok: false, error: "boom" } }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "failed", error: "boom", tagline: "Old", inputHash: "h1" });
        expect(vectors()).toHaveLength(1);

        writeResults(db, [{ id, batchId: null, inputHash: "h2", outcome: ok("New") }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "fresh", error: null, tagline: "New", inputHash: "h2" });
        expect(vectors()).toEqual([]);
    });

    it("adds up API usage per model and transport", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/usage");
        addUsage(db, repoId, "claude-haiku-5-5", "batch", { requests: 2, inputTokens: 100, outputTokens: 10 });
        addUsage(db, repoId, "claude-haiku-5-5", "batch", { requests: 1, inputTokens: 50, outputTokens: 5 });
        addUsage(db, repoId, "claude-sonnet-5-5", "direct", { requests: 1, inputTokens: 7, outputTokens: 3 });
        expect(loadUsage(db, repoId)).toEqual([
            { model: "claude-haiku-5-5", transport: "batch", requests: 3, inputTokens: 150, outputTokens: 15 },
            { model: "claude-sonnet-5-5", transport: "direct", requests: 1, inputTokens: 7, outputTokens: 3 },
        ]);
    });
});

describe("summary store — pruning", () => {
    it("the structure stage deletes summaries whose file or folder is gone", () => {
        const root = copyFixture();
        const db = getDb();
        const { repoId } = indexRepository(root);
        applyTargetUpdates(db, repoId, [
            { kind: "file", path: "src/util/strings.test.ts", inputHash: "h", status: "pending" },
            { kind: "file", path: "src/util/strings.ts", inputHash: "h", status: "pending" },
            { kind: "folder", path: "src/util", inputHash: "h", status: "pending" },
            { kind: "folder", path: "src/gone", inputHash: "h", status: "pending" },
        ]);
        fs.rmSync(path.join(root, "src/util/strings.test.ts"));

        indexRepository(root);

        expect(loadSummaries(db, repoId).map((s) => targetKey(s.kind, s.path)).sort()).toEqual(["file:src/util/strings.ts", "folder:src/util"]);
        expect(pruneSummaries(db, repoId)).toBe(0);   // nothing left to prune
    });
});
