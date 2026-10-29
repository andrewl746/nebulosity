import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { isolateDataFolder } from "../../test/helpers/data-folder";
import { ARCH_FIXTURE, copyFixture } from "../../test/helpers/fixture";
import { rewriteAsWrittenBy10 } from "../../test/helpers/summaries-v2";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { acquireSummaryLock, releaseSummaryLock } from "../db/store/lock";
import { readStages } from "../db/store/stages";
import { requireRepository } from "../db/store/structure";
import { addUsage, confirmSummaries, loadSummaries } from "../db/store/summaries";
import { countEmbedded } from "../db/store/summary-vectors";
import { describe as describeTarget } from "../engine/describe";
import { errorResponseFor, RepoSwitchingError, SummariesNotConfirmedError, SummariesOffError } from "../engine/errors";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { resolveSummaryModels } from "../index/summarize/models";
import { PROMPT_VERSION } from "../index/summarize/prompts";
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

// The service reads the summary models from config.json at each job (ADR-066): only this test's own, never the developer's
const dataFolder = isolateDataFolder();

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

/** summarizedFixture, with its rows then made what Nebulosity 1.0 stored for the same input (P1). */
async function summarizedBy10(): Promise<string> {
    const root = await summarizedFixture();
    const db = getDb();
    rewriteAsWrittenBy10(db, requireRepository(db, repoKey(root)));
    return root;
}

function storedRow(root: string, targetPath: string){
    const db = getDb();
    return loadSummaries(db, requireRepository(db, repoKey(root))).find((s) => s.path === targetPath);
}

function rowStatus(root: string, targetPath: string){
    return storedRow(root, targetPath)?.status;
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
        confirmSummaries(db, requireRepository(db, repoKey(root)), 15);
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

    // R24 (the pre-ship pass's final review, A-I1), which replaces "still refreshes a repo past the CLI's $15": each refresh
    // keeps its own $1 cap, and no automatic job takes the repo past the budget its owner last said yes to
    it("refreshes nothing on a repo whose summaries have cost more than the budget of its last yes, until a yes raises it", async () => {
        const root = await summarizedFixture();   // a model wrote its summaries, and no yes recorded a budget: the CLI's $15
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        // 400M Haiku tokens at batch rates: 400 × $0.10 / 2 = $20 already spent, and Haiku's mean stays about 4,000 tokens in
        addUsage(db, repoId, "claude-haiku-5-5", "batch", { requests: 100_000, inputTokens: 400_000_000, outputTokens: 0 });
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        // This refresh alone, one file at about 4,000 × $0.10 / 1M = $0.0004, is well under INCREMENTAL_BUDGET_USD. But the
        // repo has spent $20.00254 (the $20, the first pass's 7 Haiku files at $0.00002 and 6 Sonnet folders at $0.0004),
        // and $20.00294 is over the $15.
        expect(stub.requests).toHaveLength(0);
        expect(rowStatus(root, "src/core/log.ts")).toBe("stale");
        expect(readStages(db, repoId).summaries).toMatchObject({
            state: "failed",
            note: "stopped: the next wave would bring this repo's summary spend to $20.00, over the $15.00 last approved for it"
                + " (spent $20.00, at Anthropic ≈ $0.0000, this wave ≈ $0.0004, the rest ≈ $0.0000); the rest waits until"
                + ` nebulosity summarize "${repoKey(root)}" --budget <usd> (in a checkout: npm run summarize -- "${repoKey(root)}" --budget <usd>) approves more`,
        });

        // a yes given with --budget 30 (nebulosity summarize records it): the next save is refreshed as usual
        confirmSummaries(db, repoId, 30);
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const more = 2;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
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

    it("passes the resolution state back: the workspace manifests are read for the first update after the startup check, not for the next (ADR-053 amended, ADR-065)", async () => {
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

    it("reads the summary models at each job: a setting it can't use refuses summarize now with what's wrong, and a fixed one applies to the next job (ADR-066)", async () => {
        const root = await summarizedFixture();
        const stub = stubSummarizer();
        let setting: unknown = { file: { model: "claude-zeta-1" } };
        const service = createBackgroundService({
            summarizer: stub.summarizer, watch: fakeWatcher().watch, embed: fakeEmbed,
            summaryModels: () => resolveSummaryModels(setting, "C:/data/config.json"),
        });
        await service.setRepo(root);   // the startup check runs with the broken setting: the Map has to start anyway
        await service.idle();

        const refusal = service.summarizeNow("src/core/log.ts");
        await expect(refusal).rejects.toThrow("summaryModels.file.inputPerMTok");
        expect(errorResponseFor(await refusal.catch((err: unknown) => err)).error.code).toBe("SUMMARIES_OFF");
        expect(stub.requests).toHaveLength(0);

        // no restart: the next job reads the setting again. The model is in the inputHash, so log.ts is due for the new one.
        setting = { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } };
        expect(await service.summarizeNow("src/core/log.ts")).toMatchObject({ status: "fresh", model: "claude-haiku-6" });
        expect(stub.requests.map((r) => [r.model, r.customModel])).toEqual([["claude-haiku-6", true]]);
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
        confirmSummaries(db, requireRepository(db, repoKey(root)), 15);
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

    // Review focus 2 (P1): a file 1.0 wrote whose content then changed is out of date, whatever prompt wrote it
    it("refreshes a file 1.0 summarized once it's saved with new content", async () => {
        const root = await summarizedBy10();
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        expect(rowStatus(root, "src/core/log.ts")).toBe("stale");

        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
        expect(storedRow(root, "src/core/log.ts")).toMatchObject({ status: "fresh", promptVersion: PROMPT_VERSION });
        await service.stop();
    });

    it("never sweeps a folder only because an older prompt wrote it", async () => {
        const root = await summarizedBy10();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: fakeWatcher().watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        // nothing changed, so every folder and the repo 1.0 wrote is current, and the sweep has nothing to do
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);
        expect(["src/app", "src/core", "src/util", "scripts", "src", ""].map((p) => rowStatus(root, p))).toEqual(Array.from({ length: 6 }, () => "fresh"));
        await service.stop();
    });

    // Q2 B: a folder or the repo an older prompt wrote waits to be opened, and the sweep never pays to restyle it
    it("never sweeps a folder an older prompt wrote, even once its inputs change", async () => {
        const root = await summarizedBy10();
        // texts of their own, so each file rewritten here reads differently from what 1.0 stored for it
        const stub = stubSummarizer({ texts: {
            "src/core/log.ts": { tagline: "Log lines", summary: "Writes the app's log lines." },
            "src/util/strings.ts": { tagline: "String helpers", summary: "Pads and trims strings." },
        } });
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: fakeWatcher().watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        // log.ts opened, so rewritten in the current style: its new text is part of src/core's input
        await service.summarizeNow("src/core/log.ts");
        expect(rowStatus(root, "src/core")).toBe("stale");
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
        expect(rowStatus(root, "src/core")).toBe("stale");

        // src/util opened, then strings.ts: src/util, which the current prompt wrote, is out of date the same way, and is
        // swept; src above it, which 1.0 wrote, waits like src/core
        await service.summarizeNow("src/util");
        await service.summarizeNow("src/util/strings.ts");
        expect(rowStatus(root, "src/util")).toBe("stale");
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts", "Folder: src/util", "File: src/util/strings.ts", "Folder: src/util"]);
        expect(["src/util", "src/core", "src"].map((p) => rowStatus(root, p))).toEqual(["fresh", "stale", "stale"]);
        await service.stop();
    });

    // the Task 4 review's I1: a stale folder 1.0 wrote waits to be opened, so it can't hold up the folder above it
    it("sweeps a stale folder the current prompt wrote, though a stale subfolder an older prompt wrote stays as it is", async () => {
        const root = await summarizedBy10();
        // texts of their own, so each file rewritten here reads differently from what 1.0 stored for it
        const stub = stubSummarizer({ texts: {
            "src/core/log.ts": { tagline: "Log lines", summary: "Writes the app's log lines." },
            "src/index.ts": { tagline: "Package entry", summary: "Re-exports the core." },
        } });
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: fakeWatcher().watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        // src opened, so the current prompt wrote it; then src/index.ts, directly inside it, and src/core/log.ts below it
        await service.summarizeNow("src");
        await service.summarizeNow("src/index.ts");
        await service.summarizeNow("src/core/log.ts");
        expect(["src", "src/core"].map((p) => [rowStatus(root, p), storedRow(root, p)?.promptVersion])).toEqual([["stale", PROMPT_VERSION], ["stale", 2]]);

        // the sweep redoes src, over src/core's 1.0 text; src/core, and the repo above src, wait to be opened (Q2 B)
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["Folder: src", "File: src/index.ts", "File: src/core/log.ts", "Folder: src"]);
        expect(["src", "src/core", ""].map((p) => rowStatus(root, p))).toEqual(["fresh", "stale", "stale"]);
        await service.stop();
    });

    // R17 (ADR-066): a model change is paid for only after a yes, so the automatic jobs leave what another model wrote
    it("after a folder model change, the sweep redoes only folders the model now in use wrote, once their own inputs change", async () => {
        const root = await summarizedFixture();   // every folder and the repo written by Sonnet 5.5, every file by Haiku 5.5
        // the service reads config.json itself, at each job
        fs.writeFileSync(path.join(dataFolder(), "config.json"), JSON.stringify({ summaryModels: { folder: { model: "claude-sonnet-6", inputPerMTok: 2, outputPerMTok: 10 } } }));
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();
        expect(rowStatus(root, "src/app")).toBe("stale");   // every folder's inputHash now names Sonnet 6

        // the first sweep: all five folders are out of date, but Sonnet 5.5 wrote them, so they wait for a yes
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);

        // asked for by name, src/core is written by Sonnet 6; then a file inside it changes, and its summary is redone
        expect(await service.summarizeNow("src/core")).toMatchObject({ status: "fresh", model: "claude-sonnet-6" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["Folder: src/core", "File: src/core/log.ts"]);

        // the next sweep redoes src/core, whose own inputs changed; src, now out of date above it, was Sonnet 5.5's and waits
        await vi.advanceTimersByTimeAsync(9 * 60_000);   // 20 minutes after setRepo
        await service.idle();
        expect(stub.subjects()).toEqual(["Folder: src/core", "File: src/core/log.ts", "Folder: src/core"]);
        expect(stub.requests.at(-1)).toMatchObject({ model: "claude-sonnet-6", customModel: true });
        expect(rowStatus(root, "src")).toBe("stale");
        await service.stop();
    });

    // Review #2's probe (n1): Anthropic's ids nest (claude-sonnet-4, claude-sonnet-4-5), and only a dated snapshot is the same model
    it("a folder model whose id starts another's doesn't count that model's folders as its own: the sweep still waits for a yes", async () => {
        const root = await summarizedFixture();   // every folder written by claude-sonnet-5-5
        fs.writeFileSync(path.join(dataFolder(), "config.json"), JSON.stringify({ summaryModels: { folder: { model: "claude-sonnet-5", inputPerMTok: 2, outputPerMTok: 10 } } }));
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        // a file inside src/core changes and its summary is redone (Haiku 5.5 is still the file model): 1 request
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();

        // two sweeps: claude-sonnet-5-5 isn't a snapshot of claude-sonnet-5, so none of its five folders goes unasked
        await vi.advanceTimersByTimeAsync(19 * 60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts"]);
        await service.stop();
    });

    // R24 (the pre-ship pass's final review, A-I1; its probe as a test). A capped or --no-wait run can stop once the files
    // are rewritten: the folders above them are then out of date, but the folder model still in use wrote them, so R17
    // lets the sweep redo them. The budget of the last yes is what bounds that.
    it("after a file model change and a run that redid only the files, the sweep redoes their folders only within the budget of the last yes", async () => {
        const root = await summarizedFixture();   // $0.00254: 7 Haiku 5.5 files at $0.00002 and 6 Sonnet 5.5 targets at $0.0004
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        fs.writeFileSync(path.join(dataFolder(), "config.json"), JSON.stringify({ summaryModels: { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } } }));
        const models = resolveSummaryModels({ file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } }, "C:/data/config.json");
        if (!models.ok) throw new Error(models.error);
        // the files rewritten by Haiku 6 (in words of its own, which change their folders' inputs), $0.00014 more, and nothing above them yet
        const files = ["src/app/main.ts", "src/app/view.tsx", "src/core/index.ts", "src/core/log.ts", "src/index.ts", "src/util/strings.ts", "scripts/build.js"];
        const haiku6 = stubSummarizer({ texts: Object.fromEntries(files.map((p) => [p, { tagline: `Haiku 6 on ${p}`, summary: `What ${p} does, by Haiku 6.` }])) });
        await runSummaries(root, { summarizer: haiku6.summarizer, models, transport: "direct", select: (t) => t.kind === "file" });
        expect(haiku6.requests).toHaveLength(7);
        confirmSummaries(db, repoId, 0.003);
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();
        expect(rowStatus(root, "src/app")).toBe("stale");

        // The first sweep. Spent $0.00268; this wave, the 4 folders whose children are done, at Sonnet 5.5's mean,
        // 4 × $0.0004 = $0.0016; the rest, src and the repo, $0.0008. $0.00508 is over the $0.003 said yes to.
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);
        expect(rowStatus(root, "src/app")).toBe("stale");

        // after a yes for $15, the next sweep redoes all six, deepest first, with the folder model still in use
        confirmSummaries(db, repoId, 15);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["Folder: src/app", "Folder: src/core", "Folder: src/util", "Folder: scripts", "Folder: src", `Repository: ${path.basename(root)}`]);
        expect(stub.requests.every((r) => r.model === "claude-sonnet-5-5")).toBe(true);
        await service.stop();
    });

    it("after a file model change, a saved file waits for a yes until the model now in use has written it", async () => {
        const root = await summarizedFixture();
        fs.writeFileSync(path.join(dataFolder(), "config.json"), JSON.stringify({ summaryModels: { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } } }));
        const watcher = fakeWatcher();
        const stub = stubSummarizer();
        const service = createBackgroundService({ summarizer: stub.summarizer, watch: watcher.watch, embed: fakeEmbed });
        await service.setRepo(root);
        await service.idle();

        // Haiku 5.5 wrote log.ts: a save leaves it out of date, and its quiet minute sends nothing
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.requests).toHaveLength(0);

        // once Haiku 6 has written it (asked for by name), the next save is refreshed as usual
        expect(await service.summarizeNow("src/core/log.ts")).toMatchObject({ status: "fresh", model: "claude-haiku-6" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const more = 2;\n");
        watcher.changed(["src/core/log.ts"]);
        await service.idle();
        await vi.advanceTimersByTimeAsync(60_000);
        await service.idle();
        expect(stub.subjects()).toEqual(["File: src/core/log.ts", "File: src/core/log.ts"]);
        expect(stub.requests.map((r) => r.model)).toEqual(["claude-haiku-6", "claude-haiku-6"]);
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
