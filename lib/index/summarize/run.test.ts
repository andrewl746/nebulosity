import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { getDb } from "../../db/client";
import { META_KEYS, meta } from "../../db/schema";
import { readStages } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import { loadSummaries, loadUsage } from "../../db/store/summaries";
import { readIndexStatus } from "../../engine/status";
import { repoKey } from "../paths";
import { indexRepository } from "../pipeline";
import { runSummaries, summarizeNow, TargetNotFoundError } from "./run";
import { BatchGoneError, SummarizerAuthError, type Summarizer } from "./types";

function indexedFixture(): string {
    const root = copyFixture();
    indexRepository(root);
    return root;
}

const rows = (root: string) => loadSummaries(getDb(), requireRepository(getDb(), repoKey(root)));
const row = (root: string, p: string) => rows(root).find((r) => r.path === p);

describe("runSummaries — the regular API", () => {
    it("summarizes the fixture in four bottom-up waves, central files first", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toEqual({
            total: 14, upToDate: 14, summarized: 13, templated: 1, failed: 0, lazy: 0, inFlight: 0, needModel: 0, batches: 0, waves: 4,
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
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", wait: false }))
            .toMatchObject({ batches: 1, waves: 1, inFlight: 7, summarized: 0, upToDate: 1 });

        // the run that submitted is long gone, but the batch is still at Anthropic: still running, not crashed
        const muchLater = new Date(Date.now() + 6 * 60 * 1000);
        expect(readIndexStatus(root, muchLater)?.stages.summaries).toEqual({
            state: "running", done: 1, total: 14, note: "7 requests at Anthropic in batches; run npm run summarize to collect them",
        });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, batches: 3, waves: 3, inFlight: 0 });
        expect(stub.requests).toHaveLength(13);   // the 7 files were sent once, in batch-1
    });

    it("marks a batch Anthropic no longer has as failed, releases its rows, and carries on above them", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        const gone: Summarizer = {
            ...stub.summarizer,
            async batchResults(id){
                if (id === "batch-1") throw new BatchGoneError(id, "404 not found");
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
