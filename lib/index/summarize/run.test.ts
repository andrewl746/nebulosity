import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { configPath } from "../../config";
import { copyFixture } from "../../../test/helpers/fixture";
import { rejectionOf } from "../../../test/helpers/rejection";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { makeTempDir } from "../../../test/helpers/temp";
import { getDb } from "../../db/client";
import { META_KEYS, meta, summaries } from "../../db/schema";
import { readStages, writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import { loadBatchRows, loadFileFacts, loadSummaries, loadUsage, markInFlight, targetKey, writeResults } from "../../db/store/summaries";
import { readIndexStatus } from "../../engine/status";
import { repoKey } from "../paths";
import { indexRepository } from "../pipeline";
import { createClaudeSummarizer } from "./claude";
import { resolveSummaryModels } from "./models";
import { buildFilePrompt, DEFAULT_BUDGET_USD, plannedRequests, runSummaries, StructureNotReadyError, summarizeNow, TargetNotFoundError, TargetNotReadyError, UnknownBatchError } from "./run";
import { refreshSummaryStatus } from "./status";
import { BatchGoneError, ModelUnavailableError, SummarizerAuthError, type Summarizer } from "./types";

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

/**
 * Puts indexedTwelveFiles' 12 files at Anthropic in 6 batches of 2 on `stub`, the way a wave too big for one batch is
 * split (the run itself splits only at 5,000). A throwaway stub's wait: false run sends them as one batch, still
 * processing; its requests and rows are then regrouped into the 6.
 */
async function sixBatchesInFlight(root: string, stub: ReturnType<typeof stubSummarizer>): Promise<void> {
    const db = getDb();
    const carrier = stubSummarizer({ pollsBeforeDone: 99 });
    await runSummaries(root, { summarizer: carrier.summarizer, transport: "batch", wait: false });

    const [carrierId] = carrier.batches.keys();
    const rowOf = new Map(loadBatchRows(db, carrierId).map((r) => [`s${r.id}`, r]));
    const requests = carrier.batches.get(carrierId)!.requests;
    for (let i = 0; i < requests.length; i += 2){
        const pair = requests.slice(i, i + 2);
        const batchId = await stub.summarizer.submitBatch(pair);
        markInFlight(db, batchId, pair.map((r) => rowOf.get(r.customId)!));
    }
}

/**
 * Leaves the files at `paths` at Anthropic in one batch on `stub`, as an earlier run would have, and every other file
 * ready. As in sixBatchesInFlight, a throwaway stub's wait: false run sends all the files as one batch, still
 * processing. The chosen requests are resubmitted on `stub`, and the throwaway batch's other rows are released, as if
 * they had never gone out. Returns the batch's id.
 */
async function leaveAtAnthropic(root: string, stub: ReturnType<typeof stubSummarizer>, paths: readonly string[]): Promise<string> {
    const db = getDb();
    const carrier = stubSummarizer({ pollsBeforeDone: 99 });
    await runSummaries(root, { summarizer: carrier.summarizer, transport: "batch", wait: false });

    const [carrierId] = carrier.batches.keys();
    const chosen = loadBatchRows(db, carrierId).filter((r) => paths.includes(r.path));
    if (chosen.length !== paths.length) throw new Error(`not every path went out in the throwaway batch: ${paths.join(", ")}`);
    const customIds = new Set(chosen.map((r) => `s${r.id}`));
    const batchId = await stub.summarizer.submitBatch(carrier.batches.get(carrierId)!.requests.filter((r) => customIds.has(r.customId)));
    markInFlight(db, batchId, chosen);
    db.update(summaries).set({ batchId: null, pendingHash: null }).where(eq(summaries.batchId, carrierId)).run();
    return batchId;
}

const rows = (root: string) => loadSummaries(getDb(), requireRepository(getDb(), repoKey(root)));
const row = (root: string, p: string) => rows(root).find((r) => r.path === p);

describe("buildFilePrompt", () => {
    it("tells the model who imports the file, from the import graph", () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const log = loadFileFacts(db, repoId).find((f) => f.path === "src/core/log.ts")!;

        // log.ts (in src/core) is imported by src/app/main.ts, src/core/index.ts and src/index.ts. Their groups:
        // main.ts -> lowest common folder src, so the child src/app; src/core/index.ts sits directly in src/core, so it stands for itself;
        // src/index.ts sits directly in src, so it does too. One file each, in code-point order: src/app < src/core/index.ts < src/index.ts
        expect(buildFilePrompt(db, repoId, root, log))
            .toContain("\nLines: 9\nImported by: 3 files: src/app (1), src/core/index.ts (1), src/index.ts (1)\n\nSource:\n");
    });

    it("counts the test files that import the file apart from the rest", () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const strings = loadFileFacts(db, repoId).find((f) => f.path === "src/util/strings.ts")!;

        // strings.ts (in src/util) is imported by src/app/main.ts (lowest common folder src, so the group src/app)
        // and by its own test, src/util/strings.test.ts, which is tallied apart
        expect(buildFilePrompt(db, repoId, root, strings))
            .toContain("\nLines: 6\nImported by: 1 file: src/app (1), plus 1 test file\n\nSource:\n");
    });

    it("says a file nothing imports has no importers", () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const build = loadFileFacts(db, repoId).find((f) => f.path === "scripts/build.js")!;

        expect(buildFilePrompt(db, repoId, root, build)).toContain("\nLines: 3\nImported by: no other indexed file\n\nSource:\n");
    });
});

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
        expect(row(root, "src/core/log.ts")?.error).toBe("src/core/log.ts changed after it was indexed; run nebulosity index <path-to-repo> (in a checkout: npm run index -- <path-to-repo>) first");
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
            state: "running", done: 1, total: 14, note: "7 requests at Anthropic in batches; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them",
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
            state: "running", done: 8, total: 14, note: "4 requests at Anthropic in batches; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them",
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

    it("gives up after 5 passes in a row that couldn't check any batch, and the stage stays running: the batch is still at Anthropic", async () => {
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

        const said: string[] = [];
        await expect(runSummaries(root, { summarizer: offline, transport: "batch", pollIntervalMs: 0, onProgress: (m) => said.push(m) }))
            .rejects.toThrow("Connection error.");
        expect(polls).toBe(5);   // one batch, so one poll per pass: MAX_MISSED_POLLS passes
        const [first] = stub.batches.keys();
        const retry = `couldn't check ${first} (Connection error.); will retry`;
        expect(said.filter((m) => m.startsWith("couldn't check"))).toEqual([
            retry, retry, retry, retry,
            `couldn't check ${first} (Connection error.); giving up: no batch could be checked in 5 passes in a row`,
        ]);

        // the 7 files' batch is still at Anthropic: running, not failed, long after this process is gone
        const muchLater = new Date(Date.now() + 6 * 60 * 1000);
        expect(readIndexStatus(root, muchLater)?.stages.summaries).toEqual({
            state: "running", done: 1, total: 14,
            note: `Connection error.; 7 requests still at Anthropic; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them; if that batch can never be read, run nebulosity summarize "${repoKey(root)}" --release-batch ${first} (in a checkout: npm run summarize -- "${repoKey(root)}" --release-batch ${first}) to send its requests again (paid again)`,
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
            note: "Anthropic rejected the API key: API error 401: invalid x-api-key; 7 requests still at Anthropic; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them",
        });

        // a run with a working key collects the batch instead of resending it
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, inFlight: 0 });
        expect(stub.requests).toHaveLength(13);
    });

    it("counts a pass that couldn't check any batch as one miss, however many batches are in flight", async () => {
        const root = indexedTwelveFiles();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const stub = stubSummarizer({ failPolls: 6 });
        await sixBatchesInFlight(root, stub);   // one more batch than MAX_MISSED_POLLS
        // the stage's note at every poll: what GET /api/status shows while the run waits
        const stageAtPoll: (string | undefined)[] = [];
        const watched: Summarizer = {
            ...stub.summarizer,
            async batchResults(id){
                stageAtPoll.push(readStages(db, repoId).summaries?.note);
                return stub.summarizer.batchResults(id);
            },
        };

        // The first pass misses all 6 polls: that's one missed pass. From then on each pass collects a batch; when all
        // 12 files are in, src goes out, then the repo. The run's own tally holds only those two batches.
        expect(await runSummaries(root, { summarizer: watched, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 14, failed: 0, batches: 2, waves: 2, inFlight: 0, upToDate: 14 });
        // each of the 6 was polled twice (the failed pass, then the pass that collected it); src's and the repo's once
        expect([...stub.batches.values()].map((b) => b.polls)).toEqual([2, 2, 2, 2, 2, 2, 1, 1]);
        // after the missed pass, the run waited with all 6 still out
        expect(stageAtPoll).toContain("waiting on 6 batches at Anthropic");
    });

    it("with wait: false, a batch it couldn't check is left for the next run", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer({ failPolls: 1 });
        const said: string[] = [];

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", wait: false, onProgress: (m) => said.push(m) }))
            .toMatchObject({ summarized: 0, batches: 1, waves: 1, inFlight: 7 });
        const [first] = stub.batches.keys();
        expect(said).toContain(`couldn't check ${first} (Connection error.); the next run retries it`);

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, failed: 0, inFlight: 0 });
    });

    it("stops waiting when no batch is left in flight: every row it carried was redone another way meanwhile", { timeout: 2_000 }, async () => {
        const root = indexedFixture();
        const db = getDb();
        const stub = stubSummarizer();
        let redone = false;
        const superseded: Summarizer = {
            ...stub.summarizer,
            async batchResults(id){
                if (!redone){
                    // While the run waits, every row this batch carries is answered through the regular API (as
                    // summarizeNow would), which releases the batch's claim. Anthropic still says "processing".
                    redone = true;
                    writeResults(db, loadBatchRows(db, id).map((r) => ({
                        id: r.id, batchId: null, inputHash: r.inputHash,
                        outcome: { ok: true, text: { tagline: "Redone", summary: `Redone ${r.path}.` }, model: "claude-haiku-5-5" },
                    })));
                    return null;
                }
                return stub.summarizer.batchResults(id);
            },
        };

        // the 7 files were written outside the run, so it summarizes only the 5 folders and the repo above them
        expect(await runSummaries(root, { summarizer: superseded, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 6, failed: 0, batches: 4, waves: 4, inFlight: 0, upToDate: 14 });
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

    it("--release-batch gives up on a batch: its requests go out again, and the batch is never polled again", async () => {
        const root = indexedFixture();
        const carrier = stubSummarizer({ pollsBeforeDone: 99 });
        await runSummaries(root, { summarizer: carrier.summarizer, transport: "batch", wait: false });
        const [stuck] = carrier.batches.keys();
        const polls = carrier.batches.get(stuck)!.polls;

        const said: string[] = [];
        const result = await runSummaries(root, { summarizer: carrier.summarizer, transport: "direct", releaseBatches: [stuck], onProgress: (m) => said.push(m) });
        expect(said).toContain(`released ${stuck}: 7 requests will be sent again`);
        expect(result).toMatchObject({ summarized: 13, inFlight: 0 });
        expect(carrier.batches.get(stuck)!.polls).toBe(polls);
    });

    it("refuses to release a batch this repo has nothing in, before taking the lock or touching the stage", async () => {
        const root = indexedFixture();
        await expect(runSummaries(root, { summarizer: stubSummarizer().summarizer, releaseBatches: ["msgbatch_nope"] }))
            .rejects.toThrow(UnknownBatchError);
        const db = getDb();
        expect(readStages(db, requireRepository(db, repoKey(root))).summaries).toBeUndefined();
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
            .rejects.toThrow("the structure stage is running; wait for the index run to finish, or run nebulosity index <path-to-repo> (in a checkout: npm run index -- <path-to-repo>) again, before summarizing");
        expect(stub.requests).toHaveLength(0);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "idle", done: 0, total: 0 });   // nothing ran

        writeStage(db, repoId, "structure", { state: "ready", done: 8, total: 8 });
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toMatchObject({ summarized: 13 });
    });

    it("treats a repo with no structure stage row (indexed before stage status existed) as ready", async () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        db.delete(meta).where(eq(meta.key, `stage:${repoId}:structure`)).run();
        expect(readStages(db, repoId).structure).toBeUndefined();   // the row really is gone

        expect(await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" }))
            .toMatchObject({ summarized: 13, upToDate: 14 });
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
            note: "stopped: 10 of 12 requests failed in the last wave (first error: src/f01.ts changed after it was indexed; run nebulosity index <path-to-repo> (in a checkout: npm run index -- <path-to-repo>) first);"
                + " the failures are retried next run; 2 requests still at Anthropic; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them",
        });

        // after npm run index, the next run collects the 2 and sends the 10, then src and the repo: every target exactly once
        indexRepository(root);
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 14, failed: 0, upToDate: 14, inFlight: 0, stopped: false });
        expect(stub.requests).toHaveLength(14);
    });
});

/**
 * Every figure below is worked out by hand (ADR-035). Prices per million tokens, input/output: Haiku $0.10/$0.50,
 * Sonnet $2/$10, and the Batch API halves them. A model with no recorded usage is assumed to take 4,600 tokens in and
 * 260 out for a file, 1,000 and 250 for a folder or the repo:
 * - a file: (4,600 × $0.10 + 260 × $0.50) / 1M = $0.00059 through the regular API, $0.000295 by batch;
 * - a folder or the repo: (1,000 × $2 + 250 × $10) / 1M = $0.0045 through the regular API, $0.00225 by batch.
 * The stub answers every request with 100 tokens in and 20 out. Under auto, the fixture's waves (7 files, then 4 leaf
 * folders, src, the repo) are all smaller than BATCH_THRESHOLD, so they go through the regular API.
 */
describe("runSummaries — the spend cap", () => {
    it("stops before a wave that would take the projected spend past the budget, failing and claiming nothing", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        const said: string[] = [];

        // wave 1, the 7 files: 7 × $0.00059 = $0.00413. The rest, the 4 leaf folders, src and the repo, at batch
        // prices: 6 × $0.00225 = $0.0135. Nothing spent or at Anthropic yet: $0.01763, over $0.01. A wave the budget
        // stops is never announced, so it isn't counted.
        expect(await runSummaries(root, { summarizer: stub.summarizer, budgetUsd: 0.01, onProgress: (m) => said.push(m) })).toEqual({
            total: 14, upToDate: 1, summarized: 0, templated: 1, failed: 0, lazy: 0, inFlight: 0, needModel: 0, batches: 0, waves: 0, stopped: true,
        });
        const note = "stopped: the next wave would bring the projected spend to $0.0176, over the $0.0100 budget"
            + " (spent $0.0000, at Anthropic ≈ $0.0000, this wave ≈ $0.0041, the rest ≈ $0.0135); run again with --budget <usd> to go on";
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "failed", done: 1, total: 14, note });
        expect(said).toContain(note);
        expect(stub.requests).toHaveLength(0);
        // all 13 targets that need a model are still pending, and no batch claims any of them
        expect(rows(root).filter((r) => r.status === "pending" && r.batchId === null)).toHaveLength(13);
        expect(rows(root).filter((r) => r.status === "failed")).toHaveLength(0);

        // so a run with room in its budget sends each of the 13 exactly once
        expect(await runSummaries(root, { summarizer: stub.summarizer, budgetUsd: 1 })).toMatchObject({ summarized: 13, failed: 0, upToDate: 14, stopped: false });
        expect(stub.requests).toHaveLength(13);
    });

    it("checks every wave, not just the first: the 4 leaf folders would take it past $0.02", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        // Wave 1 projects $0.01763, as above, so the 7 files go. Wave 2, the 4 leaf folders: spent 7 × (100 × $0.10 +
        // 20 × $0.50) / 1M = $0.00014; this wave 4 × $0.0045 = $0.018 (Sonnet has no usage yet); the rest, src and the
        // repo, 2 × $0.00225 = $0.0045. $0.02264 is over $0.02.
        expect(await runSummaries(root, { summarizer: stub.summarizer, budgetUsd: 0.02 }))
            .toMatchObject({ summarized: 7, failed: 0, inFlight: 0, waves: 1, stopped: true });
        expect(stub.requests).toHaveLength(7);
        expect(stub.subjects().every((s) => s.startsWith("File: "))).toBe(true);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "failed", done: 8, total: 14,
            note: "stopped: the next wave would bring the projected spend to $0.0226, over the $0.0200 budget"
                + " (spent $0.0001, at Anthropic ≈ $0.0000, this wave ≈ $0.0180, the rest ≈ $0.0045); run again with --budget <usd> to go on",
        });
        // the 4 leaf folders, src and the repo wait for the next run, unclaimed
        expect(rows(root).filter((r) => r.kind !== "file" && r.status === "pending" && r.batchId === null)).toHaveLength(6);
    });

    it("stops before a batch that would pass the budget, without building its prompts or claiming its rows", async () => {
        const root = indexedFixture();
        // edited since indexing, so building its prompt would fail it: a row still pending shows no prompt was built
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        const stub = stubSummarizer();

        // this batch, the 7 files: 7 × $0.000295 = $0.002065; the rest $0.0135, as above. $0.015565 is over $0.01.
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", budgetUsd: 0.01, pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 0, failed: 0, batches: 0, waves: 0, inFlight: 0, stopped: true });
        expect(stub.batches.size).toBe(0);
        expect(rows(root).filter((r) => r.kind === "file" && r.status === "pending" && r.batchId === null)).toHaveLength(7);
        expect(rows(root).filter((r) => r.status === "failed")).toHaveLength(0);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "failed", done: 1, total: 14,
            note: "stopped: the next batch would bring the projected spend to $0.0156, over the $0.0100 budget"
                + " (spent $0.0000, at Anthropic ≈ $0.0000, this batch ≈ $0.0021, the rest ≈ $0.0135); run again with --budget <usd> to go on",
        });
    });

    it("prices the rest of a --direct run at regular-API rates", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        // This wave, the 7 files: 7 × $0.00059 = $0.00413. Every wave of a direct run goes through the regular API, so
        // the rest, the 4 leaf folders, src and the repo, is 6 × $0.0045 = $0.027, for $0.03113: over $0.02. (Priced by
        // batch, the rest would be $0.0135 and the total $0.01763, under it.)
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", budgetUsd: 0.02 }))
            .toMatchObject({ summarized: 0, failed: 0, waves: 0, inFlight: 0, stopped: true });
        expect(stub.requests).toHaveLength(0);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "failed", done: 1, total: 14,
            note: "stopped: the next wave would bring the projected spend to $0.0311, over the $0.0200 budget"
                + " (spent $0.0000, at Anthropic ≈ $0.0000, this wave ≈ $0.0041, the rest ≈ $0.0270); run again with --budget <usd> to go on",
        });
    });

    it("stops rather than spends when the budget isn't a number", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        // NaN compares false with everything, so a check written as "total > budget" would never stop
        expect(await runSummaries(root, { summarizer: stub.summarizer, budgetUsd: Number.NaN })).toMatchObject({ summarized: 0, stopped: true });
        expect(stub.requests).toHaveLength(0);
        expect(readIndexStatus(root)?.stages.summaries?.state).toBe("failed");
    });

    it("counts the requests already at Anthropic, stays running for them, and collects them once they've ended, even under the same budget", async () => {
        const root = indexedTwelveFiles();
        const stub = stubSummarizer({ pollsBeforeDone: 1 });   // a batch answers on its second poll
        // an earlier run left src/f01.ts … src/f06.ts at Anthropic
        const batchId = await leaveAtAnthropic(root, stub, FIRST_TEN.slice(0, 6));
        const run = (said: string[]) =>
            runSummaries(root, { summarizer: stub.summarizer, transport: "batch", wait: false, budgetUsd: 0.0075, onProgress: (m) => said.push(m) });
        const overBudget = "stopped: the next batch would bring the projected spend to $0.0080, over the $0.0075 budget"
            + " (spent $0.0000, at Anthropic ≈ $0.0018, this batch ≈ $0.0018, the rest ≈ $0.0045); run again with --budget <usd> to go on";

        // At Anthropic, those 6 at batch prices: 6 × $0.000295 = $0.00177. This batch, the other 6 files, the same
        // $0.00177. The rest, src and the repo: 2 × $0.00225 = $0.0045. $0.00804 is over $0.0075, so nothing goes out.
        // wait: false then looks at the batch once: it's still processing.
        expect(await run([])).toMatchObject({ summarized: 0, failed: 0, batches: 0, waves: 0, inFlight: 6, stopped: true });
        expect([...stub.batches.keys()]).toEqual([batchId]);
        expect(stub.batches.get(batchId)!.polls).toBe(1);
        // the 6 are paid for and go on at Anthropic without this process: running, not failed
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "running", done: 0, total: 14, note: `${overBudget}; 6 requests still at Anthropic; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them`,
        });

        // The next run, under the same budget, finds the batch ended. The first check is over budget, as above, so the
        // run collects the batch first. Haiku's recorded mean (100 tokens in, 20 out) then replaces the assumption:
        // spent 6 × (100 × $0.10 + 20 × $0.50) / 1M / 2 = $0.00006, nothing at Anthropic, this batch the same $0.00006,
        // the rest $0.0045. $0.00462 fits, so the other 6 files go out.
        const said: string[] = [];
        expect(await run(said)).toMatchObject({ summarized: 6, failed: 0, batches: 1, waves: 1, inFlight: 6, stopped: false });
        expect(said.filter((m) => /^(stopped|over budget|collected|budget)/.test(m))).toEqual([
            overBudget,
            "over budget, so nothing new goes out; collecting the 1 batch already at Anthropic",
            `collected ${batchId}: 6 summarized, 0 failed`,
            "budget: spent $0.0001 + at Anthropic ≈ $0.0000 + this batch ≈ $0.0001 + the rest ≈ $0.0045 = $0.0046 of $0.0075",
        ]);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "running", done: 6, total: 14, note: "6 requests at Anthropic in batches; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them",
        });
    });

    it("a budget stop still collects the batches already at Anthropic, and the stage says so while it waits", async () => {
        const root = indexedFixture();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        const stub = stubSummarizer({ pollsBeforeDone: 1 });   // its batch is still processing at the first poll, so the run waits once
        // An earlier run left these 3 files at Anthropic. None of them is the last file its folder waits for, so no
        // folder becomes ready when they land.
        const three = ["src/app/main.ts", "src/core/log.ts", "src/index.ts"];
        const batchId = await leaveAtAnthropic(root, stub, three);
        const said: string[] = [];
        // the stage's note at every poll: what GET /api/status shows while the run waits
        const stageAtPoll: (string | undefined)[] = [];
        const watched: Summarizer = {
            ...stub.summarizer,
            async batchResults(id){
                stageAtPoll.push(readStages(db, repoId).summaries?.note);
                return stub.summarizer.batchResults(id);
            },
        };

        // Pass 1, nothing recorded yet. At Anthropic 3 × $0.000295 = $0.000885; this batch, the other 4 files,
        // 4 × $0.000295 = $0.00118; the rest, the 4 leaf folders, src and the repo, 6 × $0.00225 = $0.0135. $0.015565 is
        // over $0.0001, so nothing goes out, and the run collects the batch: 3 answers of 100 tokens in and 20 out.
        // Pass 2. Spent 3 × (100 × $0.10 + 20 × $0.50) / 1M / 2 = $0.00003; nothing at Anthropic; this batch, the 4
        // files at Haiku's recorded mean, 4 × $0.00001 = $0.00004; the rest $0.0135. $0.01357 is still over, and nothing
        // is in flight, so the run finishes.
        expect(await runSummaries(root, { summarizer: watched, transport: "batch", budgetUsd: 0.0001, pollIntervalMs: 0, onProgress: (m) => said.push(m) }))
            .toMatchObject({ summarized: 3, failed: 0, batches: 0, waves: 0, inFlight: 0, stopped: true });
        expect([...stub.batches.keys()]).toEqual([batchId]);
        expect(stub.batches.get(batchId)!.polls).toBe(2);
        // From the moment it stops sending, and through the wait, the stage says the run is only collecting: monitoring
        // mustn't read it as an ordinary wait.
        const collecting = "over budget, so nothing new goes out; collecting the 1 batch already at Anthropic";
        expect(stageAtPoll).toEqual([collecting, collecting]);
        const note = "stopped: the next batch would bring the projected spend to $0.0136, over the $0.0001 budget"
            + " (spent $0.0000, at Anthropic ≈ $0.0000, this batch ≈ $0.0000, the rest ≈ $0.0135); run again with --budget <usd> to go on";
        expect(said.filter((m) => /^(stopped|over budget|collected|budget)/.test(m))).toEqual([
            "stopped: the next batch would bring the projected spend to $0.0156, over the $0.0001 budget"
                + " (spent $0.0000, at Anthropic ≈ $0.0009, this batch ≈ $0.0012, the rest ≈ $0.0135); run again with --budget <usd> to go on",
            collecting,
            `collected ${batchId}: 3 summarized, 0 failed`,
            note,
        ]);

        expect(rows(root).filter((r) => three.includes(r.path)).map((r) => `${r.path} ${r.status} ${r.batchId}`).sort())
            .toEqual(["src/app/main.ts fresh null", "src/core/log.ts fresh null", "src/index.ts fresh null"]);
        expect(rows(root).filter((r) => r.kind === "file" && r.status === "pending" && r.batchId === null).map((r) => r.path).sort())
            .toEqual(["scripts/build.js", "src/app/view.tsx", "src/core/index.ts", "src/util/strings.ts"]);
        // 3 files and the test template are up to date
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "failed", done: 4, total: 14, note });
    });

    it("says the projection before every wave, from each model's recorded mean once it has one, naming a model with no price", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        // every Sonnet answer also bills claude-opus-5-5 (as when a server-side fallback ran), which has no price on file
        const withFallback: Summarizer = {
            ...stub.summarizer,
            async summarize(request){
                const outcome = await stub.summarizer.summarize(request);
                if (request.model !== "claude-sonnet-5-5") return outcome;
                return { ...outcome, usage: [...(outcome.usage ?? []), { model: "claude-opus-5-5", inputTokens: 100, outputTokens: 20 }] };
            },
        };
        const said: string[] = [];

        expect(await runSummaries(root, { summarizer: withFallback, budgetUsd: DEFAULT_BUDGET_USD, onProgress: (m) => said.push(m) }))
            .toMatchObject({ summarized: 13, waves: 4, stopped: false });
        expect(said.filter((m) => m.startsWith("budget: "))).toEqual([
            // wave 1, the 7 files, and wave 2, the 4 leaf folders: as in the tests above (Sonnet has no usage before wave 2)
            "budget: spent $0.0000 + at Anthropic ≈ $0.0000 + this wave ≈ $0.0041 + the rest ≈ $0.0135 = $0.0176 of $15.00",
            "budget: spent $0.0001 + at Anthropic ≈ $0.0000 + this wave ≈ $0.0180 + the rest ≈ $0.0045 = $0.0226 of $15.00",
            // wave 3, src. Spent: $0.00014 + Sonnet's 4 folders, (400 × $2 + 80 × $10) / 1M = $0.0016, + Opus at $0 =
            // $0.00174. Sonnet's mean is now 100 in and 20 out: src (100 × $2 + 20 × $10) / 1M = $0.0004 through the
            // regular API, and the rest, the repo, half that by batch. $0.00234 in all.
            "budget: spent $0.0017 + at Anthropic ≈ $0.0000 + this wave ≈ $0.0004 + the rest ≈ $0.0002 = $0.0023 of $15.00 (no price on file for claude-opus-5-5: counted as $0)",
            // wave 4, the repo: spent $0.00014 + 5 × $0.0004 = $0.00214; this wave $0.0004; nothing after it. $0.00254 in all.
            "budget: spent $0.0021 + at Anthropic ≈ $0.0000 + this wave ≈ $0.0004 + the rest ≈ $0.0000 = $0.0025 of $15.00 (no price on file for claude-opus-5-5: counted as $0)",
        ]);
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

    it("summarizeNow: two calls for the same target at once send one request, and both get the summary", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        const [first, second] = await Promise.all([
            summarizeNow(root, "src/core/log.ts", stub.summarizer),
            summarizeNow(root, "src/core/log.ts", stub.summarizer),
        ]);
        expect(stub.requests).toHaveLength(1);
        expect(second).toEqual(first);
        expect(first.status).toBe("fresh");

        // once it has landed, asking again finds it current: still one request
        await summarizeNow(root, "src/core/log.ts", stub.summarizer);
        expect(stub.requests).toHaveLength(1);
    });

    it("summarizeNow refuses a folder whose files have no summaries yet, without a request", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await expect(summarizeNow(root, "src/core", stub.summarizer)).rejects.toThrow(TargetNotReadyError);
        expect(stub.requests).toHaveLength(0);
    });

    it("summarizeNow leaves the summaries stage current: the file fresh, its folder out of date", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        indexRepository(root);

        await summarizeNow(root, "src/core/log.ts", stub.summarizer);
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "ready", done: 13, total: 14, note: "1 out of date (redone when opened)" });
    });

    it("sends only the targets `select` accepts", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        fs.appendFileSync(path.join(root, "src/app/main.ts"), "export const extra = 1;\n");
        indexRepository(root);

        const wanted = new Set(["file:src/app/main.ts"]);
        expect(await runSummaries(root, {
            summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false, select: (t) => wanted.has(targetKey(t.kind, t.path)),
        })).toMatchObject({ summarized: 1 });
        expect(row(root, "src/app/main.ts")?.status).toBe("fresh");
        expect(row(root, "src/core/log.ts")?.status).toBe("stale");
    });

    it("sends at most `maxTargets`, the most-imported first", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        fs.appendFileSync(path.join(root, "src/app/main.ts"), "export const extra = 1;\n");
        indexRepository(root);

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false, maxTargets: 1 }))
            .toMatchObject({ summarized: 1 });
        // main.ts and log.ts both have 3 importers; the path breaks the tie
        expect(row(root, "src/app/main.ts")?.status).toBe("fresh");
        expect(row(root, "src/core/log.ts")?.status).toBe("stale");
    });

    it("a per-run cap counts only what this run spends", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        // the first pass spends $0.00254: 7 Haiku files at 100 in / 20 out ($0.00014) and 6 Sonnet folders and the repo ($0.0024)
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        indexRepository(root);

        // against everything the repo has spent, $0.001 is already gone
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false, budgetUsd: 0.001 }))
            .toMatchObject({ summarized: 0, stopped: true });
        // counting only this run: one Haiku file at its mean, (100 × $0.10 + 20 × $0.50) / 1M = $0.00002
        expect(await runSummaries(root, {
            summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false, budgetUsd: 0.001, budgetScope: "run",
        })).toMatchObject({ summarized: 1, stopped: false });
        expect(row(root, "src/core/log.ts")?.status).toBe("fresh");
    });
});

describe("plannedRequests", () => {
    it("lists what a full run would send to a model: not the test file's template, and nothing is written", () => {
        const root = indexedFixture();
        const db = getDb();
        const before = loadSummaries(db, requireRepository(db, repoKey(root)));
        // mini-repo: 7 non-test files, then 5 folders (scripts, src, src/app, src/core, src/util) and the repo; the root folder is the repo
        const requests = plannedRequests(root);
        expect(requests.filter((r) => r.kind === "file")).toEqual(Array.from({ length: 7 }, () => ({ kind: "file", model: "claude-haiku-5-5" })));
        expect(requests.filter((r) => r.kind === "folder")).toEqual(Array.from({ length: 5 }, () => ({ kind: "folder", model: "claude-sonnet-5-5" })));
        expect(requests.filter((r) => r.kind === "repo")).toEqual([{ kind: "repo", model: "claude-sonnet-5-5" }]);
        expect(requests).toHaveLength(13);
        expect(loadSummaries(db, requireRepository(db, repoKey(root)))).toEqual(before);
    });

    it("leaves out what is already written, so a second run is priced for what is left", async () => {
        const root = indexedFixture();
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        expect(plannedRequests(root)).toEqual([]);
    });

    it("lists the model set for a kind (ADR-066)", () => {
        const root = indexedFixture();
        const requests = plannedRequests(root, setModels({ file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } }));
        expect(requests.filter((r) => r.kind === "file")).toEqual(Array.from({ length: 7 }, () => ({ kind: "file", model: "claude-haiku-6" })));
        expect(requests.filter((r) => r.kind !== "file").every((r) => r.model === "claude-sonnet-5-5")).toBe(true);
    });
});

/** The resolved setting for `setting`, which must be one resolveSummaryModels accepts. */
function setModels(setting: unknown){
    const resolved = resolveSummaryModels(setting, configPath());
    if (!resolved.ok) throw new Error(resolved.error);
    return resolved;
}

describe("runSummaries — models set in summaryModels (ADR-066)", () => {
    // Every file gets the same text from both stubs, so the folders' prompts, which carry their files' summaries, don't move
    const FILE_TEXTS = Object.fromEntries(["src/app/main.ts", "src/core/log.ts", "src/util/strings.ts", "src/app/view.tsx", "src/core/index.ts", "src/index.ts", "scripts/build.js"]
        .map((p) => [p, { tagline: `About ${p}`, summary: `Summary of ${p}.` }]));

    it("writes a kind with its set model, marks those requests as set, and a new model re-summarizes only that kind (R2)", async () => {
        const root = indexedFixture();
        await runSummaries(root, { summarizer: stubSummarizer({ texts: FILE_TEXTS }).summarizer, transport: "direct" });

        const stub = stubSummarizer({ texts: FILE_TEXTS });
        const models = setModels({ file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } });
        // the model is part of every file's inputHash, so all 7 files go again; the folders' prompts are unchanged
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", models })).toMatchObject({ summarized: 7, failed: 0 });
        expect(stub.requests.map((r) => [r.model, r.customModel])).toEqual(Array.from({ length: 7 }, () => ["claude-haiku-6", true]));
        expect(row(root, "src/core/log.ts")).toMatchObject({ status: "fresh", model: "claude-haiku-6" });
        expect(row(root, "src/core")).toMatchObject({ status: "fresh", model: "claude-sonnet-5-5" });

        // a kind left at its default is never marked: the Sonnet fallback beta stays with it (R3)
        const defaults = stubSummarizer({ texts: FILE_TEXTS });
        await runSummaries(root, { summarizer: defaults.summarizer, transport: "direct" });
        expect(defaults.requests).toHaveLength(7);
        expect(defaults.requests.every((r) => r.model === "claude-haiku-5-5" && !r.customModel)).toBe(true);
    });

    it("prices the spend cap's projection at the set prices: no model counted as $0", async () => {
        const root = indexedFixture();
        const said: string[] = [];
        const models = setModels({ file: { model: "claude-zeta-1", inputPerMTok: 1, outputPerMTok: 5 } });

        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct", models, budgetUsd: 15, onProgress: (m) => said.push(m) });

        // wave 1: the 7 files at ASSUMED_TOKENS (4,600 in, 260 out) and the set prices: 7 × (4,600 × $1 + 260 × $5) / 1M = $0.0413
        expect(said.find((m) => m.startsWith("budget:"))).toContain("this wave ≈ $0.0413");
        expect(said.some((m) => m.includes("no price on file"))).toBe(false);
    });
});

/**
 * An Anthropic client that no longer serves any model but the `served` ones: each request to another model, and each
 * such request of a batch, is answered with the 404 the API gives for an unknown model ("model: <id>", a
 * not_found_error); a served model writes a whole summary. Batch ids are numbered across the file, as the stub's are
 * (stubSummarizer), and zero-padded so they sort in the order they were made. No request leaves the process.
 */
let goneBatches = 0;
function retiredClient(options: { refuseBatches?: boolean; served?: readonly string[] } = {}){
    const sent: { endpoint: string; model: string }[] = [];
    const batches = new Map<string, { customId: string; model: string }[]>();
    const served = (model: string) => options.served?.includes(model) ?? false;
    const notFound = (model: string) =>
        new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: `model: ${model}` }, request_id: null }, undefined, new Headers(), "not_found_error");
    const reply = (model: string) => ({
        model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 },
        content: [{ type: "text", text: JSON.stringify({ tagline: `Written by ${model}`, summary: `A summary by ${model}.` }) }],
    });
    const answer = (endpoint: string) => async (params: { model: string }) => {
        sent.push({ endpoint, model: params.model });
        if (served(params.model)) return reply(params.model);
        throw notFound(params.model);
    };
    const client = {
        messages: {
            create: answer("messages"),
            batches: {
                create: async (params: { requests: { custom_id: string; params: { model: string } }[] }) => {
                    sent.push(...params.requests.map((r) => ({ endpoint: "batch", model: r.params.model })));
                    if (options.refuseBatches) throw notFound(params.requests[0].params.model);
                    goneBatches++;
                    const id = `msgbatch_retired_${String(goneBatches).padStart(4, "0")}`;
                    batches.set(id, params.requests.map((r) => ({ customId: r.custom_id, model: r.params.model })));
                    return { id };
                },
                retrieve: async () => ({ processing_status: "ended" }),
                results: async (id: string) => (async function* (){
                    for (const r of batches.get(id) ?? []){
                        yield served(r.model)
                            ? { custom_id: r.customId, result: { type: "succeeded", message: reply(r.model) } }
                            : { custom_id: r.customId, result: { type: "errored", error: { type: "error", error: { type: "not_found_error", message: `model: ${r.model}` }, request_id: null } } };
                    }
                })(),
            },
        },
        beta: { messages: { create: answer("beta") } },
    };
    return { summarizer: createClaudeSummarizer(client as unknown as Anthropic), sent, batches };
}

/** The message a run stops with when Anthropic no longer serves `model` (Review Focus 2). */
function expectRetiredMessage(message: string, model: string): void {
    expect(message).toContain(model);
    expect(message).toContain(configPath());
    expect(message).toContain("Summary models");
}

describe("runSummaries — a model the API no longer serves (ADR-066, Review Focus 2)", () => {
    /** The fixture summarized, then two files edited and re-indexed: both wait for Haiku, their old summaries kept. */
    async function twoFilesWaiting(): Promise<string> {
        const root = indexedFixture();
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        fs.appendFileSync(path.join(root, "src/util/strings.ts"), "export const extra = 2;\n");
        indexRepository(root);
        refreshSummaryStatus(root, { summarizerAvailable: true });   // the rows as the Map shows them now: both stale
        return root;
    }

    it("stops at the first answer on the regular API: no second request, one message, and the stored rows unchanged", async () => {
        const root = await twoFilesWaiting();
        const before = rows(root);
        const usageBefore = loadUsage(getDb(), requireRepository(getDb(), repoKey(root)));
        const retired = retiredClient();

        const run = runSummaries(root, { summarizer: retired.summarizer, transport: "direct", concurrency: 1 });

        await expect(run).rejects.toThrow(ModelUnavailableError);
        const error = await rejectionOf(run);
        expectRetiredMessage(error.message, "claude-haiku-5-5");
        expect(retired.sent).toEqual([{ endpoint: "messages", model: "claude-haiku-5-5" }]);
        expect(rows(root)).toEqual(before);
        expect(loadUsage(getDb(), requireRepository(getDb(), repoKey(root)))).toEqual(usageBefore);
        // the stage says the same, for the Map's status
        expectRetiredMessage(readStages(getDb(), requireRepository(getDb(), repoKey(root))).summaries?.note ?? "", "claude-haiku-5-5");
    });

    it("sends nothing more after the answers already on their way: 4 of the fixture's 7 files, not 7", async () => {
        const root = indexedFixture();
        refreshSummaryStatus(root, { summarizerAvailable: true });
        const before = rows(root);
        const retired = retiredClient();

        // the default 4 at a time: all 4 are out before the first 404 comes back, and the other 3 never go
        await expect(runSummaries(root, { summarizer: retired.summarizer, transport: "direct" })).rejects.toThrow(ModelUnavailableError);
        expect(retired.sent).toHaveLength(4);
        expect(rows(root)).toEqual(before);
    });

    it("stops at a batch result that errored that way: nothing more is sent, every stored summary is kept, and no row stays claimed", async () => {
        const root = await twoFilesWaiting();
        const before = rows(root);
        const retired = retiredClient();

        const run = runSummaries(root, { summarizer: retired.summarizer, transport: "batch", pollIntervalMs: 0 });

        await expect(run).rejects.toThrow(ModelUnavailableError);
        expectRetiredMessage((await rejectionOf(run)).message, "claude-haiku-5-5");
        // one batch of the two files, and nothing after it
        expect(retired.sent).toEqual([{ endpoint: "batch", model: "claude-haiku-5-5" }, { endpoint: "batch", model: "claude-haiku-5-5" }]);
        expect(retired.batches.size).toBe(1);

        const after = rows(root);
        const text = (r: (typeof after)[number]) => ({ path: r.path, tagline: r.tagline, summary: r.summary, model: r.model, inputHash: r.inputHash });
        expect(after.map(text)).toEqual(before.map(text));
        expect(after.filter((r) => r.batchId !== null)).toEqual([]);
        // the batch is collected, so its two rows are released, failed with the message the run stopped with
        for (const p of ["src/core/log.ts", "src/util/strings.ts"]){
            expect(row(root, p)?.status).toBe("failed");
            expectRetiredMessage(row(root, p)?.error ?? "", "claude-haiku-5-5");
        }
        expect(after.filter((r) => !["src/core/log.ts", "src/util/strings.ts"].includes(r.path))).toEqual(before.filter((r) => !["src/core/log.ts", "src/util/strings.ts"].includes(r.path)));
    });

    it("stops when Anthropic refuses to create a batch for that reason, and leaves the rows unclaimed for the next run", async () => {
        const root = await twoFilesWaiting();
        const before = rows(root);
        const retired = retiredClient({ refuseBatches: true });

        const run = runSummaries(root, { summarizer: retired.summarizer, transport: "batch", pollIntervalMs: 0 });

        await expect(run).rejects.toThrow(ModelUnavailableError);
        expectRetiredMessage((await rejectionOf(run)).message, "claude-haiku-5-5");
        expect(retired.sent).toHaveLength(2);   // the refused batch's two requests, and nothing after them
        expect(rows(root)).toEqual(before);
    });

    it("summarizeNow says so with the same message, and keeps the stored row", async () => {
        const root = await twoFilesWaiting();
        const before = rows(root);
        const retired = retiredClient();

        const asked = summarizeNow(root, "src/core/log.ts", retired.summarizer);

        await expect(asked).rejects.toThrow(ModelUnavailableError);
        expectRetiredMessage((await rejectionOf(asked)).message, "claude-haiku-5-5");
        expect(retired.sent).toHaveLength(1);
        expect(rows(root)).toEqual(before);
    });

    // I2 (R17): a gone model stops a run only while the run still uses it
    it("a batch left at Anthropic for a model the setting no longer uses stops nothing: its rows go again with the model now in use", async () => {
        // The first wave went out as two batches for Haiku 5.5, which is gone: 2 of indexedTwelveFiles' files, then the
        // other 10 (a wave over 5,000 is split this way). A throwaway stub's batch is regrouped into the two.
        const root = indexedTwelveFiles();
        const db = getDb();
        const client = retiredClient({ served: ["claude-haiku-6", "claude-sonnet-5-5"] });
        const carrier = stubSummarizer({ pollsBeforeDone: 99 });
        await runSummaries(root, { summarizer: carrier.summarizer, transport: "batch", wait: false });
        const [carrierId] = carrier.batches.keys();
        const rowOf = new Map(loadBatchRows(db, carrierId).map((r) => [`s${r.id}`, r]));
        const requests = carrier.batches.get(carrierId)!.requests;
        const first = await client.summarizer.submitBatch(requests.slice(0, 2));
        markInFlight(db, first, requests.slice(0, 2).map((r) => rowOf.get(r.customId)!));
        const second = await client.summarizer.submitBatch(requests.slice(2));
        markInFlight(db, second, requests.slice(2).map((r) => rowOf.get(r.customId)!));
        client.sent.length = 0;

        // run 1, at the defaults: the first batch's answers say Haiku 5.5 is gone, and the run stops there
        await expect(runSummaries(root, { summarizer: client.summarizer, transport: "batch", pollIntervalMs: 0 })).rejects.toThrow(ModelUnavailableError);
        expect(loadBatchRows(db, second)).toHaveLength(10);   // still at Anthropic
        expect(client.sent).toEqual([]);

        // run 2, after the user set Haiku 6 for files, the way the worker runs (the regular API, no waiting, so the
        // second batch is collected by collectEndedBatches): its 10 answers name a model the setting no longer uses, so
        // they neither stop the run nor trip the circuit breaker (10 of 10 failed would), and their rows go again
        const models = setModels({ file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } });
        const result = await runSummaries(root, { summarizer: client.summarizer, models, transport: "direct", wait: false });

        expect(result).toMatchObject({ stopped: false, failed: 0, inFlight: 0, upToDate: 14, summarized: 14 });
        expect(client.sent.filter((s) => s.model === "claude-haiku-6")).toHaveLength(12);
        expect(client.sent.some((s) => s.model === "claude-haiku-5-5")).toBe(false);
        expect(rows(root).filter((r) => r.kind === "file").map((r) => [r.status, r.model]))
            .toEqual(Array.from({ length: 12 }, () => ["fresh", "claude-haiku-6"]));
    });
});
