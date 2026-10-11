import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { SummaryTargetKind } from "../../db/schema";
import { getDb, type Db } from "../../db/client";
import { acquireSummaryLock, releaseSummaryLock, touchSummaryLock } from "../../db/store/lock";
import { writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import {
    addUsage, applyTargetUpdates, countInFlight, inFlightBatches, loadBatchRows, loadFileFacts, loadFileSummaryChunk,
    loadFolderFacts, loadSummaries, markInFlight, targetKey, writeResults,
    type FileFacts, type StoredSummary, type SummaryResult,
} from "../../db/store/summaries";
import { repoKey } from "../paths";
import { mapLimit } from "./concurrency";
import { planSummaries, type PlannedTarget, type TargetState } from "./plan";
import { FILE_SYSTEM_PROMPT, FOLDER_SYSTEM_PROMPT, plural, REPO_SYSTEM_PROMPT, renderFilePrompt, SUMMARY_MODELS } from "./prompts";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "./types";

/** auto: the Batch API for waves of BATCH_THRESHOLD requests or more, the regular API below that. */
export type Transport = "auto" | "direct" | "batch";

export type SummaryRunOptions = {
    /** null without an API key: test-file templates are still written; everything else waits for a key. */
    summarizer: Summarizer | null;
    transport?: Transport;
    /** false: submit batches and return at once; running again collects them. */
    wait?: boolean;
    /** Redo out-of-date folders now (default). Incremental runs pass false: those wait until someone opens them. */
    refreshStaleFolders?: boolean;
    pollIntervalMs?: number;
    concurrency?: number;
    onProgress?: (message: string) => void;
};

export type SummaryRunResult = {
    /** Every target: files, folders and the repo. */
    total: number;
    /** Targets whose text matches their current input when the run ended. */
    upToDate: number;
    /** Summaries a model wrote during this run. */
    summarized: number;
    /** Test files given their template during this run. */
    templated: number;
    /** Requests that failed during this run; the next run retries them. */
    failed: number;
    /** Out-of-date folders left for later (refreshStaleFolders: false). */
    lazy: number;
    /** Requests still at Anthropic (wait: false). */
    inFlight: number;
    /** Targets that need a model and had none to go to (no API key). */
    needModel: number;
    batches: number;
    waves: number;
};

/** A wave this big goes through the Batch API at half price. A smaller one answers in seconds through the regular API. */
export const BATCH_THRESHOLD = 100;
/** Requests per Message Batch (PIVOT_SPEC.md §5.3), so one failed upload loses little. */
export const MAX_BATCH_REQUESTS = 5_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_MS = 60_000;

const SYSTEM_PROMPTS: Record<SummaryTargetKind, string> = {
    file: FILE_SYSTEM_PROMPT,
    folder: FOLDER_SYSTEM_PROMPT,
    repo: REPO_SYSTEM_PROMPT,
};

/** Thrown by summarizeNow for a path that's neither an indexed file nor a folder. */
export class TargetNotFoundError extends Error {
    constructor(targetPath: string){
        super(`Nothing indexed at "${targetPath}". Pass a repo-relative file or folder path ("" for the repo itself).`);
        this.name = "TargetNotFoundError";
    }
}

/** One planning pass: the plan, and the file facts it was made from. */
type Snapshot = { targets: PlannedTarget[]; files: Map<string, FileFacts> };

type Tally = { summarized: number; templated: number; failed: number; batches: number; waves: number };

type RunContext = {
    db: Db;
    repoId: number;
    root: string;
    failedThisRun: Set<string>;
    tally: Tally;
    say: (message: string) => void;
};

/** Where an answer goes: its row, and the input it answers. */
type Destination = { id: number; kind: SummaryTargetKind; path: string; inputHash: string; batchId: string | null };

/**
 * The summary stage (PIVOT_SPEC.md §5.3, ADR-033). Plans every target, sends whatever is
 * ready, and repeats. Folders become ready bottom-up as their children's summaries land:
 * VS Code's first pass takes about a dozen waves. Each wave picks its transport, and
 * batch ids are stored on the rows, so an interrupted run resumes instead of resending.
 */
export async function runSummaries(repoRoot: string, options: SummaryRunOptions): Promise<SummaryRunResult> {
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const summarizer = options.summarizer;
    const ctx: RunContext = {
        db, repoId, root,
        failedThisRun: new Set(),
        tally: { summarized: 0, templated: 0, failed: 0, batches: 0, waves: 0 },
        say: options.onProgress ?? (() => {}),
    };
    let last: PlannedTarget[] = [];

    acquireSummaryLock(db);
    try{
        for (;;){
            const snap = snapshot(db, repoId, options.refreshStaleFolders ?? true, ctx.failedThisRun);
            last = snap.targets;
            const ids = applyTargetUpdates(db, repoId, snap.targets);
            ctx.tally.templated += snap.targets.filter((t) => t.state === "template").length;

            const ready = snap.targets.filter((t) => t.state === "ready");
            const progress = (note: string) =>
                writeStage(db, repoId, "summaries", { state: "running", done: upToDate(snap.targets), total: snap.targets.length, note });

            if (summarizer && ready.length > 0){
                ctx.tally.waves++;
                const transport = options.transport ?? "auto";
                const useBatch = transport === "batch" || (transport === "auto" && ready.length >= BATCH_THRESHOLD);
                const how = useBatch ? "through the Batch API" : "through the regular API";
                progress(`wave ${ctx.tally.waves}: ${ready.length} to summarize ${how}`);
                ctx.say(`wave ${ctx.tally.waves}: ${ready.length} to summarize ${how}`);

                if (useBatch) await submitInBatches(ctx, summarizer, snap, ready, ids);
                else await sendDirect(ctx, summarizer, snap, ready, ids, options.concurrency ?? DEFAULT_CONCURRENCY);
                continue;
            }

            const batches = inFlightBatches(db, repoId);
            if (summarizer && batches.length > 0 && (options.wait ?? true)){
                await collectNextBatch(ctx, summarizer, options.pollIntervalMs ?? DEFAULT_POLL_MS,
                    () => progress(`waiting on ${plural(batches.length, "batch")} at Anthropic`));
                continue;
            }

            return finish(ctx, snap.targets, summarizer !== null);
        }
    } catch (err){
        writeStage(db, repoId, "summaries", { state: "failed", done: upToDate(last), total: last.length, note: messageOf(err) });
        throw err;
    } finally{
        releaseSummaryLock(db);
    }
}

/**
 * Summarizes one file or folder right now through the regular API, jumping the queue
 * (PIVOT_SPEC.md §5.3: the Map calls this when someone opens a path that has no summary,
 * or an out-of-date one). A current summary comes back as it is, without an API call.
 */
export async function summarizeNow(repoRoot: string, targetPath: string, summarizer: Summarizer): Promise<StoredSummary> {
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const snap = snapshot(db, repoId, true, new Set());
    const target = snap.targets.find((t) => t.path === targetPath);
    if (!target) throw new TargetNotFoundError(targetPath);

    const ids = applyTargetUpdates(db, repoId, [target]);

    if (target.state !== "current" && target.state !== "template"){
        const ctx: RunContext = { db, repoId, root, failedThisRun: new Set(), tally: { summarized: 0, templated: 0, failed: 0, batches: 0, waves: 0 }, say: () => {} };
        const built = buildRequest(ctx, snap, target, ids);
        const outcome = "failure" in built ? built.failure : await summarizer.summarize(built.request);
        const destinations = destinationsFor([target], ids);
        ingest(ctx, [outcome], "direct", (customId) => destinations.get(customId));
    }

    return loadSummaries(db, repoId).find((s) => s.kind === target.kind && s.path === target.path)!;
}

/**
 * A file's prompt, built from exactly the bytes the index saw. Null when the file changed
 * on disk after indexing, or vanished: a summary of different bytes would contradict the
 * structure the index holds for it.
 */
export function buildFilePrompt(db: Db, repoId: number, root: string, file: Pick<FileFacts, "path" | "contentHash" | "lineCount">): string | null {
    let source: string;
    try{
        source = fs.readFileSync(path.join(root, file.path), "utf8");
    } catch{
        return null;
    }

    if (createHash("sha256").update(source).digest("hex") !== file.contentHash) return null;

    const listing = loadFileSummaryChunk(db, repoId, file.path);
    return listing === null ? null : renderFilePrompt(listing, file.lineCount, source);
}

function snapshot(db: Db, repoId: number, refreshStaleFolders: boolean, failedThisRun: ReadonlySet<string>): Snapshot {
    // One read transaction: a structure run committing meanwhile can't hand us half of its changes.
    // (better-sqlite3 has one connection, so reads through `db` inside the callback belong to it.)
    return db.transaction(() => {
        const files = loadFileFacts(db, repoId);
        const targets = planSummaries(files, loadFolderFacts(db, repoId), loadSummaries(db, repoId), {
            models: SUMMARY_MODELS,
            refreshStaleFolders,
            failedThisRun,
        });
        return { targets, files: new Map(files.map((f) => [f.path, f])) };
    });
}

function buildRequest(ctx: RunContext, snap: Snapshot, target: PlannedTarget, ids: ReadonlyMap<string, number>): { request: SummaryRequest } | { failure: SummaryOutcome } {
    const customId = `s${ids.get(targetKey(target.kind, target.path))}`;
    let prompt = target.prompt ?? null;

    if (target.kind === "file"){
        const file = snap.files.get(target.path);
        prompt = file ? buildFilePrompt(ctx.db, ctx.repoId, ctx.root, file) : null;
    }

    if (prompt === null){
        return { failure: { customId, ok: false, error: `${target.path} changed after it was indexed; run npm run index first`, model: null, usage: null } };
    }

    return { request: { customId, model: target.model, system: SYSTEM_PROMPTS[target.kind], prompt } };
}

function destinationsFor(targets: readonly PlannedTarget[], ids: ReadonlyMap<string, number>): Map<string, Destination> {
    return new Map(targets.map((t) => {
        const id = ids.get(targetKey(t.kind, t.path))!;
        return [`s${id}`, { id, kind: t.kind, path: t.path, inputHash: t.inputHash, batchId: null }];
    }));
}

/** The regular API, a few at a time; each answer is written as it arrives, so a crash loses at most the ones in flight. */
async function sendDirect(ctx: RunContext, summarizer: Summarizer, snap: Snapshot, ready: readonly PlannedTarget[], ids: ReadonlyMap<string, number>, concurrency: number): Promise<void> {
    const destinations = destinationsFor(ready, ids);

    const outcomes = await mapLimit(ready, concurrency, async (target) => {
        const built = buildRequest(ctx, snap, target, ids);
        const outcome = "failure" in built ? built.failure : await summarizer.summarize(built.request);
        ingest(ctx, [outcome], "direct", (customId) => destinations.get(customId));
        return outcome;
    });

    const failed = outcomes.filter((o) => !o.ok).length;
    ctx.say(`wave ${ctx.tally.waves} done: ${outcomes.length - failed} summarized, ${failed} failed`);
}

/** Submits ready targets as Message Batches of up to MAX_BATCH_REQUESTS and records which batch carries each row. */
async function submitInBatches(ctx: RunContext, summarizer: Summarizer, snap: Snapshot, ready: readonly PlannedTarget[], ids: ReadonlyMap<string, number>): Promise<void> {
    const destinations = destinationsFor(ready, ids);

    for (let i = 0; i < ready.length; i += MAX_BATCH_REQUESTS){
        const requests: SummaryRequest[] = [];
        const failures: SummaryOutcome[] = [];

        // built one chunk at a time, so at most 5,000 prompts sit in memory at once
        for (const target of ready.slice(i, i + MAX_BATCH_REQUESTS)){
            const built = buildRequest(ctx, snap, target, ids);
            if ("failure" in built) failures.push(built.failure);
            else requests.push(built.request);
        }
        ingest(ctx, failures, "direct", (customId) => destinations.get(customId));
        if (requests.length === 0) continue;

        try{
            const batchId = await summarizer.submitBatch(requests);
            markInFlight(ctx.db, batchId, requests.map((r) => {
                const destination = destinations.get(r.customId)!;
                return { id: destination.id, inputHash: destination.inputHash };
            }));
            ctx.tally.batches++;
            ctx.say(`submitted ${batchId} with ${plural(requests.length, "request")}`);
        } catch (err){
            // nothing went out for this chunk: its targets wait for the next run
            const error = `couldn't submit the batch: ${messageOf(err)}`;
            ingest(ctx, requests.map((r) => ({ customId: r.customId, ok: false, error, model: null, usage: null })), "batch",
                (customId) => destinations.get(customId));
        }
    }
}

/** Polls the batches still at Anthropic until one has ended, then writes its answers. */
async function collectNextBatch(ctx: RunContext, summarizer: Summarizer, pollIntervalMs: number, heartbeat: () => void): Promise<void> {
    for (;;){
        for (const batchId of inFlightBatches(ctx.db, ctx.repoId)){
            const outcomes = await summarizer.batchResults(batchId);
            if (outcomes === null) continue;

            const destinations = new Map(loadBatchRows(ctx.db, batchId).map((r) => [`s${r.id}`, { ...r, batchId }]));
            ingest(ctx, outcomes, "batch", (customId) => destinations.get(customId));

            // a row the results never mention would otherwise stay "in flight" forever
            const answered = new Set(outcomes.map((o) => o.customId));
            const missing = [...destinations.keys()].filter((customId) => !answered.has(customId));
            ingest(ctx, missing.map((customId) => ({ customId, ok: false, error: "missing from the batch's results", model: null, usage: null })),
                "batch", (customId) => destinations.get(customId));

            const ok = outcomes.filter((o) => o.ok).length;
            ctx.say(`collected ${batchId}: ${ok} summarized, ${outcomes.length - ok + missing.length} failed`);
            return;
        }

        touchSummaryLock(ctx.db);
        heartbeat();
        ctx.say(`waiting on Anthropic (next check in ${Math.round(pollIntervalMs / 1000)} s)`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}

/** Writes outcomes to their rows and adds their tokens to the repo's spend. */
function ingest(ctx: RunContext, outcomes: readonly SummaryOutcome[], transport: "direct" | "batch", destinationOf: (customId: string) => Destination | undefined): void {
    const results: SummaryResult[] = [];
    const usage = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();

    for (const outcome of outcomes){
        const destination = destinationOf(outcome.customId);
        if (!destination) continue;   // its row is gone: the file or folder was deleted meanwhile

        results.push({
            id: destination.id,
            batchId: destination.batchId,
            inputHash: destination.inputHash,
            outcome: outcome.ok ? { ok: true, text: outcome.text, model: outcome.model } : { ok: false, error: outcome.error },
        });

        if (outcome.ok){
            ctx.tally.summarized++;
        } else{
            ctx.tally.failed++;
            ctx.failedThisRun.add(targetKey(destination.kind, destination.path));
        }

        if (outcome.model && outcome.usage){
            const sum = usage.get(outcome.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
            sum.requests++;
            sum.inputTokens += outcome.usage.inputTokens;
            sum.outputTokens += outcome.usage.outputTokens;
            usage.set(outcome.model, sum);
        }
    }

    writeResults(ctx.db, results);
    for (const [model, sum] of usage) addUsage(ctx.db, ctx.repoId, model, transport, sum);
}

function finish(ctx: RunContext, targets: readonly PlannedTarget[], hasSummarizer: boolean): SummaryRunResult {
    const count = (state: TargetState) => targets.filter((t) => t.state === state).length;
    const result: SummaryRunResult = {
        total: targets.length,
        upToDate: upToDate(targets),
        ...ctx.tally,
        lazy: count("lazy"),
        inFlight: countInFlight(ctx.db, ctx.repoId),
        needModel: hasSummarizer ? 0 : count("ready") + count("waiting"),
    };

    let state: "ready" | "running" | "off" = "ready";
    const notes: string[] = [];

    if (result.needModel > 0){
        state = "off";
        notes.push(`ANTHROPIC_API_KEY is not set, so ${result.needModel} of ${result.total} summaries can't be written`);
    } else if (result.inFlight > 0){
        state = "running";
        notes.push(`${plural(result.inFlight, "request")} at Anthropic in batches; run npm run summarize to collect them`);
    } else{
        if (result.failed > 0) notes.push(`${result.failed} failed this run (retried next run)`);
        if (result.lazy > 0) notes.push(`${result.lazy} out of date (redone when opened)`);
    }

    writeStage(ctx.db, ctx.repoId, "summaries", {
        state,
        done: result.upToDate,
        total: result.total,
        ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    });
    return result;
}

function upToDate(targets: readonly PlannedTarget[]): number {
    return targets.filter((t) => t.state === "current" || t.state === "template").length;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
