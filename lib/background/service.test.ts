import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { acquireSummaryLock, releaseSummaryLock } from "../db/store/lock";
import { requireRepository } from "../db/store/structure";
import { addUsage, loadSummaries } from "../db/store/summaries";
import { countEmbedded } from "../db/store/summary-vectors";
import { describe as describeTarget } from "../engine/describe";
import { SummariesOffError } from "../engine/errors";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import type { RepoWatcher } from "../index/watch";
import { createBackgroundService, MAX_AUTO_REFRESH_FILES } from "./service";

const fakeEmbed: EmbedFn = async (texts) => texts.map(() => Float32Array.from([1, 0, 0]));

// Date stays real: lock staleness and stage times are compared against the clock
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); });
afterEach(() => { vi.useRealTimers(); });

/** A watcher the test drives: `changed(paths)` is what chokidar would report after its debounce. */
function fakeWatcher(){
    let onChanges: ((paths: string[]) => void) | null = null;
    let closed = false;
    const watch = (_root: string, callback: (paths: string[]) => void): RepoWatcher => {
        onChanges = callback;
        return { ready: Promise.resolve(), async close(){ closed = true; } };
    };
    return { watch, changed: (paths: string[]) => onChanges!(paths), isClosed: () => closed };
}

/** The fixture summarized and embedded throughout, as the CLI leaves VS Code. */
async function summarizedFixture(): Promise<string> {
    const root = copyFixture();
    indexRepository(root);
    await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
    await embedSummaries(root, { embed: fakeEmbed });
    return root;
}

function rowStatus(root: string, targetPath: string){
    const db = getDb();
    return loadSummaries(db, requireRepository(db, repoKey(root))).find((s) => s.path === targetPath)?.status;
}

function embedded(root: string): number {
    const db = getDb();
    return countEmbedded(db, requireRepository(db, repoKey(root)));
}

describe("background service", () => {
    it("a saved file reaches the index at once, and its summary after 60 quiet seconds", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        expect(describeTarget(root, "src/core/log.ts").symbols?.map((s) => s.name)).toContain("extra");
        expect(rowStatus(root, "src/core/log.ts")).toBe("stale");

        await vi.advanceTimersByTimeAsync(59_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
        expect(rowStatus(root, "src/core/log.ts")).toBe("fresh");
        expect(rowStatus(root, "src/core")).toBe("stale");   // its folder waits to be opened or swept
        expect(embedded(root)).toBe(13);                     // the new summary has its vector again
        await service.stop();
    });

    it("another save within the minute restarts that file's wait", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const one = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(40_000);
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const two = 2;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();

        await vi.advanceTimersByTimeAsync(59_000);   // 99 s after the first save, 59 s after the second
        await service.idle();
        expect(stub.requests).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1_000);
        await service.idle();
        expect(stub.requests).toHaveLength(1);
        await service.stop();
    });

    it("refreshes at most 50 changed files at once, so a big pull can't spend silently", async () => {
        const root = makeTempDir("neb-many-");
        fs.mkdirSync(path.join(root, "src"));
        const names = Array.from({ length: 52 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
        for (const name of names) fs.writeFileSync(path.join(root, name), "export const v = 1;\n");
        indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });

        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const logs: string[] = [];
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed, log: (m) => logs.push(m) });
        await service.setRepo(root);
        for (const name of names) fs.appendFileSync(path.join(root, name), "export const w = 2;\n");
        watcher.changed(names);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();

        expect(stub.requests).toHaveLength(MAX_AUTO_REFRESH_FILES);
        expect(logs).toContain("refreshed at most 50 of 52 changed files; the rest stay out of date until opened or npm run summarize");
        await service.stop();
    });

    it("still refreshes a repo whose summaries have cost more than the CLI's $15: each refresh has its own cap", async () => {
        const root = await summarizedFixture();
        const db = getDb();
        // 400M Haiku tokens at batch rates: 400 × $0.10 / 2 = $20 already spent, and Haiku's mean stays about 4,000 tokens in
        addUsage(db, requireRepository(db, repoKey(root)), "claude-haiku-5-5", "batch", { requests: 100_000, inputTokens: 400_000_000, outputTokens: 0 });
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        // this refresh alone: one file at about 4,000 × $0.10 / 1M = $0.0004, well under INCREMENTAL_BUDGET_USD
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
        await service.stop();
    });

    it("re-indexes the whole repo when more than 500 paths change at once", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const logs: string[] = [];
        const service = createBackgroundService({ summarizer: null, watch: watcher.watch, embed: fakeEmbed, log: (m) => logs.push(m) });
        await service.setRepo(root);
        watcher.changed(Array.from({ length: 501 }, (_, i) => `gen/f${i}.ts`));
        await service.idle();
        expect(logs).toContain("re-indexing the whole repo (501 paths changed)");
        await service.stop();
    });

    it("summarize now needs a key, and queues the new summary's embedding", async () => {
        const root = await summarizedFixture();
        const off = createBackgroundService({ summarizer: null, watch: fakeWatcher().watch, embed: fakeEmbed });
        await off.setRepo(root);
        await expect(off.summarizeNow("src/core/log.ts")).rejects.toThrow(SummariesOffError);
        await off.stop();

        const watcher = fakeWatcher();
        const service = createBackgroundService({ summarizer: stubSummarizer().summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();

        expect(await service.summarizeNow("src/core/log.ts")).toMatchObject({ status: "fresh" });
        await service.idle();
        expect(embedded(root)).toBe(13);
        await service.stop();
    });

    it("waits while another summary run holds the lock, then tries again", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const logs: string[] = [];
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed, log: (m) => logs.push(m) });
        await service.setRepo(root);
        const db = getDb();

        acquireSummaryLock(db);
        try{
            fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
            watcher.changed(["src/core/log.ts"]);
            await service.idle();
            await vi.advanceTimersByTimeAsync(60_000);
            await service.idle();
            expect(stub.requests).toHaveLength(0);
            expect(logs.some((m) => m.endsWith("trying again in 30 s"))).toBe(true);
        } finally{
            releaseSummaryLock(db);
        }

        await vi.advanceTimersByTimeAsync(30_000);
        await service.idle();
        expect(stub.requests).toHaveLength(1);
        await service.stop();
    });

    it("sweeps out-of-date folders every 10 minutes, deepest first, up to the repo", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(rowStatus(root, "src/core")).toBe("stale");

        await vi.advanceTimersByTimeAsync(9 * 60_000);   // 10 minutes after setRepo
        await service.idle();
        // the repo's prompt names the root folder, which buildFolders calls by the copy's own directory name
        expect(stub.subjects()).toEqual(["File: src/core/log.ts", "Folder: src/core", "Folder: src", `Repository: ${path.basename(root)}`]);
        expect(rowStatus(root, "src/core")).toBe("fresh");
        await service.stop();
    });

    it("stops watching and forgets pending waits when the repo is cleared", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();

        await service.setRepo(null);
        expect(watcher.isClosed()).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);
    });
});
