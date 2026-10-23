import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { ARCH_FIXTURE, copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { acquireSummaryLock, releaseSummaryLock } from "../db/store/lock";
import { requireRepository } from "../db/store/structure";
import { addUsage, confirmSummaries, loadSummaries } from "../db/store/summaries";
import { countEmbedded } from "../db/store/summary-vectors";
import { describe as describeTarget } from "../engine/describe";
import { errorResponseFor, RepoSwitchingError, SummariesNotConfirmedError, SummariesOffError } from "../engine/errors";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import type { Summarizer } from "../index/summarize/types";
import type { RepoWatcher } from "../index/watch";
import { readWorkspace } from "../index/workspace";
import { createBackgroundService, MAX_AUTO_REFRESH_FILES } from "./service";

// keep the real module, but count the manifest reads (ADR-053, amended)
vi.mock("../index/workspace", async (importOriginal) => {
    const original = await importOriginal<typeof import("../index/workspace")>();
    return { ...original, readWorkspace: vi.fn(original.readWorkspace) };
});

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

    it("never starts spending on a repo whose summaries nobody confirmed (S11); a yes starts it", async () => {
        const root = copyFixture();
        indexRepository(root);   // structure only: no model has written anything, and no yes is recorded
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);

        const db = getDb();
        confirmSummaries(db, requireRepository(db, repoKey(root)));
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const more = 2;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
        await service.stop();
    });

    it("a save reaches the index while a summary refresh is still waiting on the API (I4)", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        let answer!: () => void;
        const apiAnswers = new Promise<void>((resolve) => { answer = resolve; });
        const slow: Summarizer = { ...stub.summarizer, async summarize(request){ await apiAnswers; return stub.summarizer.summarize(request); } };
        const service = createBackgroundService({ summarizer: slow, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await vi.advanceTimersByTimeAsync(60_000);   // log.ts's refresh starts, and waits on Haiku

        fs.appendFileSync(path.join(root, "src/util/strings.ts"), "export const whisper = 1;\n");
        watcher.changed(["src/util/strings.ts"]);
        await vi.advanceTimersByTimeAsync(10);
        expect(stub.requests).toHaveLength(0);   // log.ts's request is still out
        // S6: within 2 s of the save, whatever the maintenance work is doing
        expect(describeTarget(root, "src/util/strings.ts").symbols?.map((s) => s.name)).toContain("whisper");

        answer();
        await service.idle();
        expect(rowStatus(root, "src/core/log.ts")).toBe("fresh");
        expect(rowStatus(root, "src/util/strings.ts")).toBe("stale");   // its own minute hasn't passed
        await service.stop();
    });

    it("a file saved again while its own refresh is out comes back stale, not fresh with the old text (I4)", async () => {
        const root = await summarizedFixture();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        let answer!: () => void;
        const apiAnswers = new Promise<void>((resolve) => { answer = resolve; });
        const slow: Summarizer = { ...stub.summarizer, async summarize(request){ await apiAnswers; return stub.summarizer.summarize(request); } };
        const service = createBackgroundService({ summarizer: slow, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await vi.advanceTimersByTimeAsync(60_000);   // its refresh asks Haiku about the first edit

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const more = 2;\n");
        watcher.changed(["src/core/log.ts"]);
        await vi.advanceTimersByTimeAsync(10);
        answer();
        await vi.advanceTimersByTimeAsync(10);
        await service.idle();

        // the answer describes the first edit; the file now has the second, and waits its own minute
        expect(stub.requests).toHaveLength(1);
        expect(rowStatus(root, "src/core/log.ts")).toBe("stale");
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
        const repo = path.resolve(root);
        expect(logs).toContain(`refreshed at most 50 of 52 changed files; the rest stay out of date until opened or summarized by nebulosity summarize "${repo}" (in a checkout: npm run summarize -- "${repo}")`);
        await service.stop();
    });

    it("refreshes at most 50 files per 10 minutes, however a long burst splits into groups (M2)", async () => {
        const root = makeTempDir("neb-many-");
        fs.mkdirSync(path.join(root, "src"));
        const names = Array.from({ length: 61 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
        for (const name of names) fs.writeFileSync(path.join(root, name), "export const v = 1;\n");
        indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });

        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        const save = async (batch: string[]) => {
            for (const name of batch) fs.appendFileSync(path.join(root, name), "export const w = 2;\n");
            watcher.changed(batch);
            await service.idle();
        };
        const filesSent = () => stub.subjects().filter((s) => s.startsWith("File: ")).length;

        // a formatter over the tree: the watcher hands its saves over in batches at most 5 s apart
        await save(names.slice(0, 30));
        await vi.advanceTimersByTimeAsync(5_000);
        await save(names.slice(30, 60));
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(filesSent()).toBe(MAX_AUTO_REFRESH_FILES);

        // ten minutes on, the window has room again
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await save([names[60]]);
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(filesSent()).toBe(MAX_AUTO_REFRESH_FILES + 1);
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

    it("reads the workspace manifests for the first update after the startup check, not for the next (ADR-053, amended)", async () => {
        const root = copyFixture(ARCH_FIXTURE);
        indexRepository(root);
        const watcher = fakeWatcher();
        const service = createBackgroundService({ summarizer: null, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();
        const reads = vi.mocked(readWorkspace);
        const afterStartup = reads.mock.calls.length;

        fs.appendFileSync(path.join(root, "src/app/legacy.ts"), "// one\n");
        watcher.changed(["src/app/legacy.ts"]);
        await service.idle();
        expect(reads.mock.calls.length).toBe(afterStartup + 1);

        fs.appendFileSync(path.join(root, "src/app/legacy.ts"), "// two\n");
        watcher.changed(["src/app/legacy.ts"]);
        await service.idle();
        expect(reads.mock.calls.length).toBe(afterStartup + 1);
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

    it("summarize now spends nothing on a repo whose summaries nobody confirmed, and says how to confirm them (S11)", async () => {
        const root = copyFixture();
        indexRepository(root);   // structure only: no yes recorded, no model-written summary
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: fakeWatcher().watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        const refusal = service.summarizeNow("src/core/log.ts");
        await expect(refusal).rejects.toThrow(SummariesNotConfirmedError);
        await expect(refusal).rejects.toThrow(`run nebulosity summarize "${path.resolve(root)}"`);
        expect(stub.requests).toHaveLength(0);
        expect(errorResponseFor(await refusal.catch((err: unknown) => err)).error.code).toBe("SUMMARIES_OFF");

        const db = getDb();
        confirmSummaries(db, requireRepository(db, repoKey(root)));
        expect(await service.summarizeNow("src/core/log.ts")).toMatchObject({ status: "fresh" });
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
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

    it("catches a change made while the watcher is still starting: it watches first, then runs the startup check", async () => {
        const root = await summarizedFixture();
        // chokidar reports nothing for a file it hasn't crawled yet (VS Code's first crawl takes seconds): an edit
        // landing as the watcher starts is only caught by a startup check that runs after it
        const watch = (): RepoWatcher => {
            fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const duringCrawl = 1;\n");
            return { ready: Promise.resolve(), async close(){} };
        };
        const service = createBackgroundService({ summarizer: null, watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();
        expect(describeTarget(root, "src/core/log.ts").symbols?.map((s) => s.name)).toContain("duringCrawl");
        await service.stop();
    });

    it("refuses summarize-now and re-index meant for another repo, without a request (C1)", async () => {
        const root = await summarizedFixture();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: fakeWatcher().watch, embed: fakeEmbed });
        await service.setRepo(root);

        await expect(service.summarizeNow("src/core/log.ts", "C:/somewhere/else")).rejects.toThrow(RepoSwitchingError);
        await expect(service.indexNow(undefined, "C:/somewhere/else")).rejects.toThrow(RepoSwitchingError);
        expect(stub.requests).toHaveLength(0);
        // the repo it's on, spelled as the config spells it (forward slashes), is fine
        expect(await service.summarizeNow("src/core/log.ts", repoKey(root))).toMatchObject({ status: "fresh" });
        await service.stop();
    });

    it("picks up a repo that wasn't indexed yet once it is, instead of giving up (C1)", async () => {
        const root = copyFixture();
        let watching = 0;
        const watch = (): RepoWatcher => { watching++; return { ready: Promise.resolve(), async close(){} }; };
        const logs: string[] = [];
        const service = createBackgroundService({ summarizer: null, watch, embed: fakeEmbed, log: (m) => logs.push(m) });

        await service.setRepo(root);
        expect(watching).toBe(0);
        expect(logs).toContain(`${path.resolve(root)} isn't indexed yet; run nebulosity index "${path.resolve(root)}" (in a checkout: npm run index -- "${path.resolve(root)}") (checked again every 30 s)`);

        indexRepository(root);   // npm run index, from a terminal
        await vi.advanceTimersByTimeAsync(30_000);
        await service.idle();
        expect(watching).toBe(1);
        expect(logs.at(-1)).toBe(`watching ${path.resolve(root)}`);
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
