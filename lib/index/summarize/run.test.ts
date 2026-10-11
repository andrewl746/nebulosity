import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { makeTempDir } from "../../../test/helpers/temp";
import { getDb } from "../../db/client";
import { META_KEYS, meta } from "../../db/schema";
import { readStages, writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import { loadSummaries, loadUsage, markInFlight } from "../../db/store/summaries";
import { readIndexStatus } from "../../engine/status";
import { repoKey } from "../paths";
import { indexRepository } from "../pipeline";
import { runSummaries, StructureNotReadyError, summarizeNow, TargetNotFoundError } from "./run";
import { BatchGoneError, SummarizerAuthError, type Summarizer } from "./types";

// markInFlight calls straight through to the real one; a single test makes it throw once
vi.mock("../../db/store/summaries", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../db/store/summaries")>();
    return { ...real, markInFlight: vi.fn(real.markInFlight) };
});

function indexedFixture(): string {
    const root = copyFixture();
    indexRepository(root);
    return root;
}

/** src/f01.ts … src/f12.ts, one export each: 14 targets (12 files, src, the repo), and a first wave big enough for the circuit breaker. */
function indexedTwelveFiles(): string {
    const root = makeTempDir("neb-twelve-");
    fs.mkdirSync(path.join(root, "src"));
    for (let i = 1; i <= 12; i++){
        const n = String(i).padStart(2, "0");
        fs.writeFileSync(path.join(root, "src", `f${n}.ts`), `export const value${n} = ${i};\n`);
    }
    indexRepository(root);
    return root;
}

/** src/f01.ts … src/f10.ts: 10 of the 12, at least BREAKER_MIN_FAILURES and more than half. */
const FIRST_TEN = Array.from({ length: 10 }, (_, i) => `src/f${String(i + 1).padStart(2, "0")}.ts`);

const rows = (root: string) => loadSummaries(getDb(), requireRepository(getDb(), repoKey(root)));
const row = (root: string, p: string) => rows(root).find((r) => r.path === p);

describe("runSummaries — the regular API", () => {
    it("summarizes the fixture in four bottom-up waves, central files first", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toEqual({
            total: 14, upToDate: 14, summarized: 13, templated: 1, failed: 0, lazy: 0, inFlight: 0, needModel: 0, batches: 0, waves: 4, stopped: false,
        });
        expect(stub.subjects()).toEqual([
            "File: src/app/main.ts", "File: src/core/log.ts", "File: src/util/strings.ts", "File: src/app/view.tsx",
            "File: src/core/index.ts", "File: src/index.ts", "File: scripts/build.js",
            "Folder: src/app", "Folder: src/core", "Folder: src/util", "Folder: scripts",
            "Folder: src",
            `Repository: ${path.basename(root)}`,
        ]);
        expect(row(root, "src/core/log.ts")).toMatchObject({ status: "fresh", model: "claude-haiku-5-5", tagline: "About File: src/core/log.ts" });
        expect(row(root, "")).toMatchObject({ kind: "repo", status: "fresh", model: "claude-sonnet-5-5" });
        expect(row(root, "src/util/strings.test.ts")).toMatchObject({ status: "skipped", model: "template", tagline: "Tests for strings" });
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "ready", done: 14, total: 14 });
        expect(loadUsage(getDb(), requireRepository(getDb(), repoKey(root)))).toEqual([
            { model: "claude-haiku-5-5", transport: "direct", requests: 7, inputTokens: 700, outputTokens: 140 },
            { model: "claude-sonnet-5-5", transport: "direct", requests: 6, inputTokens: 600, outputTokens: 120 },
        ]);
    });

    it("does nothing the second time: every inputHash still matches", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toMatchObject({ summarized: 0, templated: 0, waves: 0, upToDate: 14 });
        expect(stub.requests).toHaveLength(13);
    });

    it("isolates a failure: its folder goes ahead without it, and the next run redoes it and everything above", async () => {
        const root = indexedFixture();
        const failing = stubSummarizer({ failPaths: ["src/core/log.ts"] });

        expect(await runSummaries(root, { summarizer: failing.summarizer, transport: "direct" })).toMatchObject({ summarized: 12, failed: 1, upToDate: 13 });
        expect(row(root, "src/core/log.ts")).toMatchObject({ status: "failed", error: "stub failure" });
        expect(failing.requests.find((r) => r.prompt.startsWith("Folder: src/core"))?.prompt).toContain("- log.ts (9 lines): (no summary yet)");
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "ready", done: 13, total: 14, note: "1 failed this run (retried next run)" });

        // log.ts, then src/core (its input now has log.ts's summary), then src, then the repo
        expect(await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" })).toMatchObject({ summarized: 4, failed: 0, waves: 4 });
    });

    it("fails a file that changed on disk after indexing, without sending it", async () => {
        const root = indexedFixture();
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toMatchObject({ failed: 1, summarized: 12 });
        expect(stub.subjects()).not.toContain("File: src/core/log.ts");
        expect(row(root, "src/core/log.ts")?.error).toBe("src/core/log.ts changed after it was indexed; run npm run index first");
    });

    it("without an API key writes the test template only and reports the stage off", async () => {
        const root = indexedFixture();

        expect(await runSummaries(root, { summarizer: null })).toMatchObject({ templated: 1, needModel: 13, summarized: 0, upToDate: 1 });
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "off", done: 1, total: 14, note: "ANTHROPIC_API_KEY is not set, so 13 of 14 summaries can't be written",
        });
    });

    it("keeps the stage and the lock alive while a long direct wave is answered", async () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const stub = stubSummarizer();
        const notes: (string | undefined)[] = [];
        const lockValues: (string | undefined)[] = [];
        // each answer takes "a second", so a refreshed lock reads later than the one before it
        const slow: Summarizer = {
            ...stub.summarizer,
            async summarize(request){
                notes.push(readStages(db, repoId).summaries?.note);
                lockValues.push(db.select().from(meta).where(eq(meta.key, META_KEYS.SUMMARIZING_LOCK)).get()?.value);
                vi.setSystemTime(new Date(Date.now() + 1000));
                return stub.summarizer.summarize(request);
            },
        };

        vi.useFakeTimers({ toFake: ["Date"] });
        try{
            await runSummaries(root, { summarizer: slow, transport: "direct", concurrency: 1, heartbeatMs: 0 });
        } finally{
            vi.useRealTimers();
        }

        expect(notes.slice(0, 8)).toEqual([
            "wave 1: 7 to summarize through the regular API",
            "wave 1: 1 of 7 answered", "wave 1: 2 of 7 answered", "wave 1: 3 of 7 answered",
            "wave 1: 4 of 7 answered", "wave 1: 5 of 7 answered", "wave 1: 6 of 7 answered",
            "wave 2: 4 to summarize through the regular API",
        ]);
        for (let i = 1; i < 7; i++) expect(lockValues[i]! > lockValues[i - 1]!).toBe(true);
    });
});

describe("runSummaries — the Batch API", () => {
    it("sends one batch per wave and polls until each one ends", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer({ pollsBeforeDone: 1 });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, batches: 4, waves: 4, inFlight: 0 });
        expect([...stub.batches.values()].map((b) => [b.requests.length, b.polls])).toEqual([[7, 2], [4, 2], [1, 2], [1, 2]]);
    });

    it("with wait: false submits and returns; a later run collects that batch instead of resending it", async () => {
        const root = indexedFixture();
        // wait: false looks at its batches once, without sleeping: the batch must still be processing then
        const stub = stubSummarizer({ pollsBeforeDone: 1 });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", wait: false }))
            .toMatchObject({ batches: 1, waves: 1, inFlight: 7, summarized: 0, upToDate: 1 });

        // the run that submitted is long gone, but the batch is still at Anthropic: still running, not crashed
        const muchLater = new Date(Date.now() + 6 * 60 * 1000);
        expect(readIndexStatus(root, muchLater)?.stages.summaries).toEqual({
            state: "running", done: 1, total: 14, note: "7 requests at Anthropic in batches; run npm run summarize to collect them",
        });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, batches: 3, waves: 3, inFlight: 0 });
        expect(stub.requests).toHaveLength(13);   // the 7 files were sent once, in the first batch
    });

    it("marks a batch Anthropic no longer has as failed, releases its rows, and carries on above them", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        const gone: Summarizer = {
            ...stub.summarizer,
            async batchResults(id){
                // the first batch this stub made (the 7 files) is the one Anthropic no longer has
                const [first] = stub.batches.keys();
                if (id === first) throw new BatchGoneError(id, "404 not found");
                return stub.summarizer.batchResults(id);
            },
        };

        // the 7 files fail; the 4 leaf folders, src and the repo are still written over "(no summary yet)"
        expect(await runSummaries(root, { summarizer: gone, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 6, failed: 7, batches: 4, waves: 4, inFlight: 0, upToDate: 7 });
        expect(row(root, "src/core/log.ts")).toMatchObject({
            status: "failed", batchId: null, error: "the batch is no longer available at Anthropic (404 not found)",
        });
        expect(rows(root).filter((r) => r.status === "failed")).toHaveLength(7);
        expect(stub.requests.find((r) => r.prompt.startsWith("Folder: src/core"))?.prompt).toContain("- log.ts (9 lines): (no summary yet)");
        expect(row(root, "")).toMatchObject({ status: "fresh" });
    });

    it("keeps two repos' batches apart: collecting one repo's batch never touches the other's rows", async () => {
        const first = indexedFixture();
        const second = indexedFixture();
        const firstStub = stubSummarizer({ pollsBeforeDone: 1 });

        // the first repo's 7 files stay at Anthropic (its one look finds that batch still processing)
        await runSummaries(first, { summarizer: firstStub.summarizer, transport: "batch", wait: false });
        // a second repo with its own stub: its batches mustn't be mistaken for the first repo's
        expect(await runSummaries(second, { summarizer: stubSummarizer().summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, upToDate: 14 });
        expect(rows(first).filter((r) => r.batchId !== null)).toHaveLength(7);
        expect(rows(first).filter((r) => r.status === "failed")).toHaveLength(0);

        // and the first repo's batch is still there to collect
        expect(await runSummaries(first, { summarizer: firstStub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, upToDate: 14 });
    });

    it("with wait: false collects batches that have already ended, so repeated runs work up the tree", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer({ pollsBeforeDone: 1 });
        const noWait = { summarizer: stub.summarizer, transport: "batch" as const, wait: false };

        // run 1 submits the 7 files; its one look finds that batch still processing
        expect(await runSummaries(root, noWait)).toMatchObject({ summarized: 0, batches: 1, waves: 1, inFlight: 7, upToDate: 1 });
        // run 2 collects the 7, submits the 4 leaf folders, and finds that batch still processing
        expect(await runSummaries(root, noWait)).toMatchObject({ summarized: 7, batches: 1, waves: 1, inFlight: 4, upToDate: 8 });
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "running", done: 8, total: 14, note: "4 requests at Anthropic in batches; run npm run summarize to collect them",
        });
        // one level per run from here: src, then the repo, then there's nothing left to do
        expect(await runSummaries(root, noWait)).toMatchObject({ summarized: 4, batches: 1, inFlight: 1, upToDate: 12 });
        expect(await runSummaries(root, noWait)).toMatchObject({ summarized: 1, batches: 1, inFlight: 1, upToDate: 13 });
        expect(await runSummaries(root, noWait)).toMatchObject({ summarized: 1, batches: 0, waves: 0, inFlight: 0, upToDate: 14 });
        expect(stub.requests).toHaveLength(13);   // nothing was sent twice
    });

    it("counts the tokens of a batch answer whose row was redone meanwhile: that answer was paid for too", async () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const stub = stubSummarizer({ pollsBeforeDone: 1 });

        await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", wait: false });   // the 7 files go out in a batch
        await summarizeNow(root, "src/core/log.ts", stub.summarizer);   // redone directly: its row leaves the batch
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 12, inFlight: 0 });

        // the batch's log.ts answer had no row left to land on, but its 100 + 20 tokens were billed: 7 batch requests, not 6
        expect(loadUsage(db, repoId)).toEqual([
            { model: "claude-haiku-5-5", transport: "batch", requests: 7, inputTokens: 700, outputTokens: 140 },
            { model: "claude-haiku-5-5", transport: "direct", requests: 1, inputTokens: 100, outputTokens: 20 },
            { model: "claude-sonnet-5-5", transport: "batch", requests: 6, inputTokens: 600, outputTokens: 120 },
        ]);
    });

    it("rides out a poll that errors: it says so, and polls that batch again on the next pass", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer({ failPolls: 1 });
        const said: string[] = [];

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0, onProgress: (m) => said.push(m) }))
            .toMatchObject({ summarized: 13, failed: 0, batches: 4, waves: 4, inFlight: 0 });
        // the first batch's first poll failed, so it was polled once more than the other three
        expect([...stub.batches.values()].map((b) => b.polls)).toEqual([2, 1, 1, 1]);
        const [first] = stub.batches.keys();
        expect(said).toContain(`couldn't check ${first} (Connection error.); will retry`);
    });

    it("gives up after 5 missed polls in a row, and the stage stays running: the batch is still at Anthropic", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        let polls = 0;
        const offline: Summarizer = {
            ...stub.summarizer,
            async batchResults(){
                polls++;
                throw new Error("Connection error.");
            },
        };

        await expect(runSummaries(root, { summarizer: offline, transport: "batch", pollIntervalMs: 0 })).rejects.toThrow("Connection error.");
        expect(polls).toBe(5);   // MAX_MISSED_POLLS

        // the 7 files' batch is still at Anthropic: running, not failed, long after this process is gone
        const muchLater = new Date(Date.now() + 6 * 60 * 1000);
        expect(readIndexStatus(root, muchLater)?.stages.summaries).toEqual({
            state: "running", done: 1, total: 14, note: "Connection error.; 7 requests still at Anthropic; run npm run summarize to collect them",
        });

        // ...and, as the note says, the next run collects it: the 7 files were sent once
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, inFlight: 0 });
        expect(stub.requests).toHaveLength(13);
    });

    it("stops at the first poll when Anthropic rejects the key, without retrying", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        let polls = 0;
        const revoked: Summarizer = {
            ...stub.summarizer,
            async batchResults(){
                polls++;
                throw new SummarizerAuthError("API error 401: invalid x-api-key");
            },
        };

        await expect(runSummaries(root, { summarizer: revoked, transport: "batch", pollIntervalMs: 0 })).rejects.toThrow(SummarizerAuthError);
        expect(polls).toBe(1);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "running", done: 1, total: 14,
            note: "Anthropic rejected the API key: API error 401: invalid x-api-key; 7 requests still at Anthropic; run npm run summarize to collect them",
        });

        // a run with a working key collects the batch instead of resending it
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, inFlight: 0 });
        expect(stub.requests).toHaveLength(13);
    });

    it("names a batch it submitted but couldn't record, so the paid-for batch isn't lost silently", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        const said: string[] = [];
        vi.mocked(markInFlight).mockImplementationOnce(() => {
            throw new Error("SQLITE_BUSY: database is locked");
        });

        const error = await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0, onProgress: (m) => said.push(m) })
            .then(() => null, (err: unknown) => err);

        // Anthropic accepted the batch: the stub holds it, and its id is in the error, the progress and the stage
        expect(stub.batches.size).toBe(1);
        const [batchId] = stub.batches.keys();
        const message = `submitted ${batchId} but couldn't record it: SQLITE_BUSY: database is locked`;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(message);
        expect(said).toContain(message);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "failed", done: 1, total: 14, note: message });
    });

    it("stops when a batch can't be submitted, failing nothing, so no folder is summarized over placeholders", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        let submits = 0;
        const overloadedOnce: Summarizer = {
            ...stub.summarizer,
            async submitBatch(requests){
                submits++;
                if (submits === 1) throw new Error("API error 529");
                return stub.summarizer.submitBatch(requests);
            },
        };

        await expect(runSummaries(root, { summarizer: overloadedOnce, transport: "batch", pollIntervalMs: 0 }))
            .rejects.toThrow("couldn't submit a batch: API error 529");
        expect(submits).toBe(1);
        expect(stub.requests).toHaveLength(0);   // no folder or repo request went out (nor anything else)
        // the 7 files' rows are untouched: pending, unclaimed, not failed
        expect(rows(root).filter((r) => r.kind === "file" && r.status === "pending" && r.batchId === null)).toHaveLength(7);
        expect(rows(root).filter((r) => r.status === "failed")).toHaveLength(0);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "failed", done: 1, total: 14, note: "couldn't submit a batch: API error 529" });

        // nothing was failed or claimed, so a healthy run sends each of the 13 exactly once
        const healthy = stubSummarizer();
        expect(await runSummaries(root, { summarizer: healthy.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, upToDate: 14 });
        expect(healthy.requests).toHaveLength(13);
    });
});

describe("runSummaries — the structure guard and the circuit breaker", () => {
    it("refuses to start while the structure stage isn't ready", async () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const stub = stubSummarizer();
        writeStage(db, repoId, "structure", { state: "running", done: 3, total: 8 });

        await expect(runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).rejects.toThrow(StructureNotReadyError);
        await expect(summarizeNow(root, "src/core/log.ts", stub.summarizer))
            .rejects.toThrow("the structure stage is running; wait for npm run index to finish (or re-run it) before summarizing");
        expect(stub.requests).toHaveLength(0);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "idle", done: 0, total: 0 });   // nothing ran

        writeStage(db, repoId, "structure", { state: "ready", done: 8, total: 8 });
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toMatchObject({ summarized: 13 });
    });

    it("stops after a direct wave where most requests failed, before any folder is written over placeholders", async () => {
        const root = indexedTwelveFiles();
        const stub = stubSummarizer({ failPaths: FIRST_TEN });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toEqual({
            total: 14, upToDate: 2, summarized: 2, templated: 0, failed: 10, lazy: 0, inFlight: 0, needModel: 0, batches: 0, waves: 1, stopped: true,
        });
        expect(stub.subjects()).toHaveLength(12);
        expect(stub.subjects().every((s) => s.startsWith("File: "))).toBe(true);   // no folder, no repo
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "failed", done: 2, total: 14,
            note: "stopped: 10 of 12 requests failed in the last wave (first error: stub failure); the failures are retried next run",
        });

        // the next run redoes the 10, then writes src and the repo once, over real summaries
        const healthy = stubSummarizer();
        expect(await runSummaries(root, { summarizer: healthy.summarizer, transport: "direct" }))
            .toMatchObject({ summarized: 12, failed: 0, upToDate: 14, stopped: false });
        expect(healthy.subjects().filter((s) => !s.startsWith("File: "))).toEqual(["Folder: src", `Repository: ${path.basename(root)}`]);
    });

    it("stops after a collected batch where most requests failed", async () => {
        const root = indexedTwelveFiles();
        const stub = stubSummarizer({ failPaths: FIRST_TEN });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ upToDate: 2, summarized: 2, failed: 10, batches: 1, waves: 1, inFlight: 0, stopped: true });
        expect(stub.subjects().every((s) => s.startsWith("File: "))).toBe(true);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "failed", done: 2, total: 14,
            note: "stopped: 10 of 12 requests failed in the last batch (first error: stub failure); the failures are retried next run",
        });
    });

    it("counts files edited since indexing against a batch wave, and stays running for the batch it did send", async () => {
        const root = indexedTwelveFiles();
        for (const p of FIRST_TEN) fs.appendFileSync(path.join(root, p), "export const extra = 1;\n");
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ upToDate: 0, summarized: 0, failed: 10, batches: 1, waves: 1, inFlight: 2, stopped: true });
        expect(stub.subjects()).toEqual(["File: src/f11.ts", "File: src/f12.ts"]);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "running", done: 0, total: 14,
            note: "stopped: 10 of 12 requests failed in the last wave (first error: src/f01.ts changed after it was indexed; run npm run index first);"
                + " the failures are retried next run; 2 requests still at Anthropic; run npm run summarize to collect them",
        });

        // after npm run index, the next run collects the 2 and sends the 10, then src and the repo: every target exactly once
        indexRepository(root);
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 14, failed: 0, upToDate: 14, inFlight: 0, stopped: false });
        expect(stub.requests).toHaveLength(14);
    });
});

describe("runSummaries — incremental runs and summarizeNow", () => {
    it("on an incremental run redoes the edited file and leaves its folder lazy until it's opened", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        indexRepository(root);

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false }))
            .toMatchObject({ summarized: 1, lazy: 1 });
        expect(row(root, "src/core")?.status).toBe("stale");

        // opening src/core redoes it; that makes src lazy in turn
        expect(await summarizeNow(root, "src/core", stub.summarizer)).toMatchObject({ status: "fresh" });
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false }))
            .toMatchObject({ summarized: 0, lazy: 1 });
        expect(row(root, "src")?.status).toBe("stale");
    });

    it("summarizeNow writes one file's summary, a test file's template without a call, and rejects unknown paths", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        expect(await summarizeNow(root, "src/core/log.ts", stub.summarizer)).toMatchObject({ status: "fresh", tagline: "About File: src/core/log.ts" });
        expect(await summarizeNow(root, "src/util/strings.test.ts", stub.summarizer)).toMatchObject({ status: "skipped", tagline: "Tests for strings" });
        expect(stub.requests).toHaveLength(1);
        await expect(summarizeNow(root, "src/nope.ts", stub.summarizer)).rejects.toThrow(TargetNotFoundError);
    });
});
