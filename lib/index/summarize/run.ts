import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { SummaryTargetKind } from "../../db/schema";
import { getDb, type Db } from "../../db/client";
import { acquireSummaryLock, releaseSummaryLock, touchSummaryLock } from "../../db/store/lock";
import { readStages, writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import {
    addUsage, applyTargetUpdates, countInFlight, inFlightBatches, loadBatchRows, loadFileFacts, loadFileSummaryChunk,
    loadFolderFacts, loadImporters, loadSummaries, loadUsage, markInFlight, targetKey, writeResults,
    type FileFacts, type StoredSummary, type SummaryResult,
} from "../../db/store/summaries";
import { repoKey } from "../paths";
import { projectSpend, type ProjectedRequest } from "./budget";
import { mapLimit } from "./concurrency";
import { planSummaries, type PlannedTarget, type TargetState } from "./plan";
import { formatUsd } from "./pricing";
import { FILE_SYSTEM_PROMPT, FOLDER_SYSTEM_PROMPT, plural, REPO_SYSTEM_PROMPT, renderFilePrompt, SUMMARY_MODELS } from "./prompts";
import { BatchGoneError, SummarizerAuthError, type Summarizer, type SummaryOutcome, type SummaryRequest } from "./types";

/** auto: the Batch API for waves of BATCH_THRESHOLD requests or more, the regular API below that. */
export type Transport = "auto" | "direct" | "batch";

export type SummaryRunOptions = {
    /** null without an API key: test-file templates are still written; everything else waits for a key. */
    summarizer: Summarizer | null;
    transport?: Transport;
    /**
     * false: never sleep. Batches that have already ended are collected (which may make a new wave ready, sent at
     * once); the ones still processing are left for a later run.
     */
    wait?: boolean;
    /** Redo out-of-date folders now (default). Incremental runs pass false: those wait until someone opens them. */
    refreshStaleFolders?: boolean;
    pollIntervalMs?: number;
    /** How often a long wave refreshes the stage and the lock. */
    heartbeatMs?: number;
    concurrency?: number;
    /**
     * The spend cap in US dollars (ADR-035). Before every submission, each batch and each regular-API wave, the run
     * projects spent + at Anthropic + this submission + the rest, and stops instead of sending if that's over this.
     * Undefined: no cap. The CLI passes DEFAULT_BUDGET_USD unless told otherwise.
     */
    budgetUsd?: number;
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
    /** Requests still at Anthropic when the run ended: after wait: false, or when the circuit breaker or the spend cap stopped it. */
    inFlight: number;
    /** Targets that need a model and had none to go to (no API key). */
    needModel: number;
    batches: number;
    waves: number;
    /** The circuit breaker or the spend cap ended the run early; the summaries stage's note says why. */
    stopped: boolean;
};

/** A wave this big goes through the Batch API at half price. A smaller one answers in seconds through the regular API. */
export const BATCH_THRESHOLD = 100;
/** Requests per Message Batch (PIVOT_SPEC.md §5.3), so one failed upload loses little. */
export const MAX_BATCH_REQUESTS = 5_000;
/**
 * A poll that errors (a dropped connection, a laptop waking from sleep) is a missed poll: the run says so and asks
 * again on its next pass. A pass in which no batch could be checked counts as one miss, however many batches are in
 * flight, and any answer resets the count. This many missed passes in a row means the problem isn't passing, so the
 * run stops. Its batches are still at Anthropic, and the next run collects them.
 */
export const MAX_MISSED_POLLS = 5;
/**
 * The circuit breaker trips when at least this many requests failed in one wave or batch, and they
 * were more than half of it. A few refusals in a small wave are normal and never trip it.
 */
export const BREAKER_MIN_FAILURES = 10;
/** The CLI's spend cap when --budget isn't given: S2's ceiling for VS Code's full pass (PIVOT_SPEC.md §2, ADR-035). */
export const DEFAULT_BUDGET_USD = 15;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_MS = 60_000;
const DEFAULT_HEARTBEAT_MS = 30_000;

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

/**
 * Thrown by runSummaries and summarizeNow while the structure stage is running or failed:
 * summaries of a half-indexed repo would fail as "changed after it was indexed", or be
 * written over facts that are about to change, and both cost money.
 */
export class StructureNotReadyError extends Error {
    constructor(readonly state: string){
        super(`the structure stage is ${state}; wait for npm run index to finish (or re-run it) before summarizing`);
        this.name = "StructureNotReadyError";
    }
}

/** One planning pass: the plan, and the file facts it was made from. */
type Snapshot = { targets: PlannedTarget[]; files: Map<string, FileFacts> };

type Tally = { summarized: number; templated: number; failed: number; batches: number; waves: number };

/** A run's spend cap (ADR-035). */
type Budget = {
    usd: number;
    /** How the projection prices the rest of the run: batch rates, or direct ones when the run's transport is direct. */
    restTransport: "direct" | "batch";
};

type RunContext = {
    db: Db;
    repoId: number;
    root: string;
    failedThisRun: Set<string>;
    tally: Tally;
    /** Passes in a row in which no batch could be checked (MAX_MISSED_POLLS). */
    missedPasses: number;
    /** Set when the circuit breaker trips or the spend cap is reached: why the run stops before planning another wave. */
    stopped: string | null;
    /** Checked before every submission; null means no cap. */
    budget: Budget | null;
    say: (message: string) => void;
};

function newContext(db: Db, repoId: number, root: string, say: (message: string) => void, budget: Budget | null = null): RunContext {
    return {
        db, repoId, root, say, budget,
        failedThisRun: new Set(),
        tally: { summarized: 0, templated: 0, failed: 0, batches: 0, waves: 0 },
        missedPasses: 0,
        stopped: null,
    };
}

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
    requireStructureReady(db, repoId);
    const summarizer = options.summarizer;
    const transport = options.transport ?? "auto";
    // Under auto most of the money goes on waves big enough for the Batch API, so the rest of the run is priced at
    // batch rates (ADR-035; the small waves at the top of the tree make that a slight underestimate).
    const budget: Budget | null = options.budgetUsd === undefined ? null
        : { usd: options.budgetUsd, restTransport: transport === "direct" ? "direct" : "batch" };
    const ctx = newContext(db, repoId, root, options.onProgress ?? (() => {}), budget);
    let last: PlannedTarget[] = [];

    acquireSummaryLock(db);
    try{
        for (;;){
            const snap = snapshot(db, repoId, options.refreshStaleFolders ?? true, ctx.failedThisRun);
            last = snap.targets;
            const ids = applyTargetUpdates(db, repoId, snap.targets);
            ctx.tally.templated += snap.targets.filter((t) => t.state === "template").length;

            // the circuit breaker tripped, or the spend cap was reached: report where things stand, and send nothing more
            if (ctx.stopped !== null) return finish(ctx, snap.targets, summarizer !== null);

            const ready = snap.targets.filter((t) => t.state === "ready");
            const progress = (note: string) =>
                writeStage(db, repoId, "summaries", { state: "running", done: upToDate(snap.targets), total: snap.targets.length, note });

            if (summarizer && ready.length > 0){
                ctx.tally.waves++;
                const useBatch = transport === "batch" || (transport === "auto" && ready.length >= BATCH_THRESHOLD);
                const how = useBatch ? "through the Batch API" : "through the regular API";
                progress(`wave ${ctx.tally.waves}: ${ready.length} to summarize ${how}`);
                ctx.say(`wave ${ctx.tally.waves}: ${ready.length} to summarize ${how}`);

                if (useBatch) await submitInBatches(ctx, summarizer, snap, ready, ids);
                else await sendDirect(ctx, summarizer, snap, ready, ids, options.concurrency ?? DEFAULT_CONCURRENCY,
                    options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS, progress);
                continue;
            }

            const batches = inFlightBatches(db, repoId);
            if (summarizer && batches.length > 0){
                if (options.wait ?? true){
                    await collectNextBatch(ctx, summarizer, options.pollIntervalMs ?? DEFAULT_POLL_MS,
                        () => progress(`waiting on ${plural(batches.length, "batch")} at Anthropic`));
                    continue;
                }

                // wait: false looks once, without sleeping. Collecting a batch may make a new wave ready, so go round
                // again; each collection takes a batch out of flight, and each target goes out once a run, so this ends.
                if (await collectEndedBatches(ctx, summarizer) > 0) continue;
            }

            return finish(ctx, snap.targets, summarizer !== null);
        }
    } catch (err){
        reportRunError(db, repoId, last, err);
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
    requireStructureReady(db, repoId);
    const snap = snapshot(db, repoId, true, new Set());
    const target = snap.targets.find((t) => t.path === targetPath);
    if (!target) throw new TargetNotFoundError(targetPath);

    const ids = applyTargetUpdates(db, repoId, [target]);

    if (target.state !== "current" && target.state !== "template"){
        const ctx = newContext(db, repoId, root, () => {});
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
    if (listing === null) return null;

    // The importers are in the prompt but not in the input hash (path + content only, plan.ts), so a new importer doesn't re-summarize a central file on every pull.
    return renderFilePrompt(listing, file.lineCount, loadImporters(db, repoId, file.path), source);
}

/**
 * Summaries are built on the structure index, so it has to be finished first. A repo indexed
 * before stage status existed has no structure row at all; that counts as ready.
 */
function requireStructureReady(db: Db, repoId: number): void {
    const structure = readStages(db, repoId).structure;
    if (structure && structure.state !== "ready") throw new StructureNotReadyError(structure.state);
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

/**
 * The regular API, a few at a time; each answer is written as it arrives, so a crash loses at most the ones in flight.
 * A big wave (VS Code's files with --direct) runs for hours, so it heartbeats: without that, readers would call the
 * live run crashed after 5 minutes (ADR-032), and a second run could take its lock after 30 and pay twice.
 */
async function sendDirect(
    ctx: RunContext, summarizer: Summarizer, snap: Snapshot, ready: readonly PlannedTarget[], ids: ReadonlyMap<string, number>,
    concurrency: number, heartbeatMs: number, progress: (note: string) => void
): Promise<void> {
    // The whole wave is one submission, checked before any prompt is built. Every ready target is in it, so the rest of
    // the run is what's still waiting.
    if (!withinBudget(ctx, "direct", inState(snap, "in-flight"), ready, inState(snap, "waiting"))) return;

    const destinations = destinationsFor(ready, ids);
    let answered = 0;
    let lastBeat: number | null = null;

    const outcomes = await mapLimit(ready, concurrency, async (target) => {
        const built = buildRequest(ctx, snap, target, ids);
        const outcome = "failure" in built ? built.failure : await summarizer.summarize(built.request);
        ingest(ctx, [outcome], "direct", (customId) => destinations.get(customId));
        answered++;

        if (lastBeat === null || Date.now() - lastBeat >= heartbeatMs){
            lastBeat = Date.now();
            touchSummaryLock(ctx.db);
            progress(`wave ${ctx.tally.waves}: ${answered} of ${ready.length} answered`);
        }
        return outcome;
    });

    const errors = errorsOf(outcomes);
    ctx.say(`wave ${ctx.tally.waves} done: ${outcomes.length - errors.length} summarized, ${errors.length} failed`);
    checkFailures(ctx, errors, outcomes.length, "wave");
}

/**
 * Submits ready targets as Message Batches of up to MAX_BATCH_REQUESTS and records which batch carries each row.
 * A chunk that can't be submitted ends the run (see below); chunks submitted before it stay at Anthropic, and the
 * next run collects them.
 */
async function submitInBatches(ctx: RunContext, summarizer: Summarizer, snap: Snapshot, ready: readonly PlannedTarget[], ids: ReadonlyMap<string, number>): Promise<void> {
    const destinations = destinationsFor(ready, ids);
    const unsendable: string[] = [];
    const waiting = inState(snap, "waiting");
    // What's at Anthropic as each chunk is checked: the requests in flight when this pass planned, plus the chunks this
    // wave has submitted since. The snapshot predates those, so each joins the list once markInFlight has recorded it.
    // (The lock keeps any other run from submitting meanwhile.) Without them, a later chunk's projection would forget
    // money this wave has already committed.
    const atAnthropic: ProjectedRequest[] = inState(snap, "in-flight");

    for (let i = 0; i < ready.length; i += MAX_BATCH_REQUESTS){
        const chunk = ready.slice(i, i + MAX_BATCH_REQUESTS);
        // checked before the chunk's prompts are built; the rest is the later chunks and everything still waiting
        if (!withinBudget(ctx, "batch", atAnthropic, chunk, [...ready.slice(i + MAX_BATCH_REQUESTS), ...waiting])) return;

        const requests: SummaryRequest[] = [];
        const failures: SummaryOutcome[] = [];

        // built one chunk at a time, so at most 5,000 prompts sit in memory at once
        for (const target of chunk){
            const built = buildRequest(ctx, snap, target, ids);
            if ("failure" in built) failures.push(built.failure);
            else requests.push(built.request);
        }
        ingest(ctx, failures, "direct", (customId) => destinations.get(customId));
        unsendable.push(...errorsOf(failures));
        if (requests.length === 0) continue;

        let batchId: string;
        try{
            batchId = await summarizer.submitBatch(requests);
        } catch (err){
            // No batch id came back. Usually Anthropic refused the batch and nothing went out; if the reply was lost on
            // its way back, the batch exists but nothing here can name it (ADR-033). Either way no row can be tied to
            // it, so these rows stay pending, unclaimed and unfailed, and the next run sends them. The cause (an outage,
            // a rejected key) would sink the next chunk too, and carrying on would only summarize folders over
            // "(no summary yet)", so the run ends here.
            throw new Error(`couldn't submit a batch: ${messageOf(err)}`, { cause: err });
        }

        try{
            markInFlight(ctx.db, batchId, requests.map((r) => {
                const destination = destinations.get(r.customId)!;
                return { id: destination.id, inputHash: destination.inputHash };
            }));
        } catch (err){
            // The batch is at Anthropic and paid for, but no row knows it (SQLITE_BUSY while npm run index holds the
            // write lock, say). Name it before anything else can go wrong, so it can still be found and collected.
            const message = `submitted ${batchId} but couldn't record it: ${messageOf(err)}`;
            ctx.say(message);
            throw new Error(message, { cause: err });
        }
        atAnthropic.push(...requests.map((r) => ({ kind: destinations.get(r.customId)!.kind, model: r.model })));
        ctx.tally.batches++;
        ctx.say(`submitted ${batchId} with ${plural(requests.length, "request")}`);
    }

    // files that couldn't even be sent (edited since indexing) count against the wave
    checkFailures(ctx, unsendable, ready.length, "wave");
}

/**
 * Polls the batches still at Anthropic until one has ended, then writes its answers.
 * It can't wait forever:
 * - a pass returns when it collects a batch, or finds none left in flight (summarizeNow
 *   can redo every row a batch carried); the caller then plans again;
 * - a pass that hears a batch is still processing sleeps and asks again (Anthropic ends
 *   every batch within 24 hours);
 * - a failed poll was already retried by the SDK (maxRetries: 3), so it's more than a blip,
 *   but a connection that drops for a few minutes still comes back. MAX_MISSED_POLLS passes
 *   in a row that couldn't check any batch end the run, rethrowing the last error.
 */
async function collectNextBatch(ctx: RunContext, summarizer: Summarizer, pollIntervalMs: number, heartbeat: () => void): Promise<void> {
    for (;;){
        const batchIds = inFlightBatches(ctx.db, ctx.repoId);
        if (batchIds.length === 0) return;

        const misses: { batchId: string; error: unknown }[] = [];
        let collected = false;
        for (const batchId of batchIds){
            const poll = await pollBatch(ctx, summarizer, batchId);
            if (poll.kind === "missed"){
                misses.push({ batchId, error: poll.error });
                continue;
            }

            ctx.missedPasses = 0;   // Anthropic answered (processing, ended or gone): the connection works
            if (poll.kind === "collected"){
                collected = true;
                break;
            }
        }

        // A pass in which no batch could be checked is one miss, however many batches are in flight. The misses are
        // reported once the pass knows what comes next: another pass, or giving up.
        if (misses.length === batchIds.length) ctx.missedPasses++;
        const givingUp = ctx.missedPasses >= MAX_MISSED_POLLS;
        const next = givingUp ? `giving up: no batch could be checked in ${MAX_MISSED_POLLS} passes in a row` : "will retry";
        for (const miss of misses) ctx.say(`couldn't check ${miss.batchId} (${messageOf(miss.error)}); ${next}`);
        if (givingUp) throw misses[misses.length - 1].error;
        if (collected) return;

        touchSummaryLock(ctx.db);
        heartbeat();
        ctx.say(`waiting on Anthropic (next check in ${Math.round(pollIntervalMs / 1000)} s)`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}

/**
 * wait: false's single pass: asks about every batch at Anthropic once, with no sleeping,
 * and collects each one that has ended. Returns how many it collected. Nothing here gives
 * up on missed polls: a pass that collects nothing ends the run.
 */
async function collectEndedBatches(ctx: RunContext, summarizer: Summarizer): Promise<number> {
    let collected = 0;
    const unchecked: string[] = [];

    for (const batchId of inFlightBatches(ctx.db, ctx.repoId)){
        const poll = await pollBatch(ctx, summarizer, batchId);
        if (poll.kind === "collected") collected++;
        if (poll.kind === "missed") unchecked.push(`couldn't check ${batchId} (${messageOf(poll.error)})`);
    }

    // after a pass that collected something the run goes round again; after one that didn't, it finishes
    for (const line of unchecked) ctx.say(`${line}; ${collected > 0 ? "will retry" : "the next run retries it"}`);
    return collected;
}

/** What one poll found: the batch is done with (collected, or gone), it's still processing, or the poll itself failed. */
type Poll = { kind: "collected" } | { kind: "processing" } | { kind: "missed"; error: unknown };

/**
 * Asks Anthropic about one batch. "collected": its answers were written, or Anthropic no
 * longer has it (BatchGoneError), in which case its rows are marked failed, which releases
 * them: the next run resends them instead of failing at the same batch forever.
 * "processing": not ended yet. "missed": the poll failed (a dropped connection, a 5xx); the
 * caller decides what that means. A rejected key is rethrown: asking again can't help.
 */
async function pollBatch(ctx: RunContext, summarizer: Summarizer, batchId: string): Promise<Poll> {
    let outcomes: SummaryOutcome[] | null;
    try{
        outcomes = await summarizer.batchResults(batchId);
    } catch (err){
        if (err instanceof SummarizerAuthError) throw err;
        if (!(err instanceof BatchGoneError)) return { kind: "missed", error: err };

        const rows = loadBatchRows(ctx.db, batchId);
        const destinations = new Map(rows.map((r) => [`s${r.id}`, { ...r, batchId }]));
        const error = `the batch is no longer available at Anthropic (${err.reason})`;
        ingest(ctx, [...destinations.keys()].map((customId) => ({ customId, ok: false, error, model: null, usage: null })),
            "batch", (customId) => destinations.get(customId));
        ctx.say(`${batchId} is gone at Anthropic: ${plural(rows.length, "request")} failed (resent next run)`);
        checkFailures(ctx, rows.map(() => error), rows.length, "batch");
        return { kind: "collected" };
    }

    if (outcomes === null) return { kind: "processing" };

    const destinations = new Map(loadBatchRows(ctx.db, batchId).map((r) => [`s${r.id}`, { ...r, batchId }]));
    ingest(ctx, outcomes, "batch", (customId) => destinations.get(customId));

    // a row the results never mention would otherwise stay "in flight" forever
    const answered = new Set(outcomes.map((o) => o.customId));
    const missing = [...destinations.keys()].filter((customId) => !answered.has(customId));
    ingest(ctx, missing.map((customId) => ({ customId, ok: false, error: "missing from the batch's results", model: null, usage: null })),
        "batch", (customId) => destinations.get(customId));

    const errors = [...errorsOf(outcomes), ...missing.map(() => "missing from the batch's results")];
    ctx.say(`collected ${batchId}: ${outcomes.length + missing.length - errors.length} summarized, ${errors.length} failed`);
    checkFailures(ctx, errors, outcomes.length + missing.length, "batch");
    return { kind: "collected" };
}


/**
 * The circuit breaker (ADR-033), checked after every wave and every collected batch. When
 * most of one failed, the cause is almost certainly shared: a rejected key, an outage, a
 * repo edited since indexing. Failed children count as settled, so carrying on would
 * summarize their folders over "(no summary yet)" and pay for those folders again next run.
 * Instead the run stops before planning another wave.
 */
function checkFailures(ctx: RunContext, errors: readonly string[], total: number, where: "wave" | "batch"): void {
    if (ctx.stopped !== null) return;   // already stopping: the first reason stands
    if (errors.length < BREAKER_MIN_FAILURES || errors.length * 2 <= total) return;

    ctx.stopped = `stopped: ${errors.length} of ${total} requests failed in the last ${where} (first error: ${errors[0]}); the failures are retried next run`;
    ctx.say(ctx.stopped);
}

/**
 * The spend cap (ADR-035), checked before every submission: each regular-API wave ("direct") and each batch. It
 * projects spent + at Anthropic + this submission + the rest (budget.ts) and returns whether the submission may go.
 * Over the budget it stops the run the way the circuit breaker does: ctx.stopped is set, the caller sends nothing, and
 * the loop's next pass ends the run, so no row is failed or claimed and the next run (with a bigger --budget) sends them.
 */
function withinBudget(
    ctx: RunContext, transport: "direct" | "batch",
    atAnthropic: readonly ProjectedRequest[], thisSubmission: readonly ProjectedRequest[], rest: readonly ProjectedRequest[]
): boolean {
    if (ctx.budget === null) return true;

    const projection = projectSpend({
        usage: loadUsage(ctx.db, ctx.repoId), atAnthropic, thisSubmission, thisTransport: transport, rest, restTransport: ctx.budget.restTransport,
    });
    const submission = transport === "batch" ? "batch" : "wave";
    const usd = {
        spent: formatUsd(projection.spent),
        atAnthropic: formatUsd(projection.atAnthropic),
        thisSubmission: formatUsd(projection.thisSubmission),
        rest: formatUsd(projection.rest),
        total: formatUsd(projection.total),
        budget: formatUsd(ctx.budget.usd),
    };

    // Within means total ≤ budget, and anything else stops: a budget that isn't a number (NaN) stops the run instead
    // of quietly lifting the cap.
    if (!(projection.total <= ctx.budget.usd)){
        ctx.stopped = `stopped: the next ${submission} would bring the projected spend to ${usd.total}, over the ${usd.budget} budget`
            + ` (spent ${usd.spent}, at Anthropic ≈ ${usd.atAnthropic}, this ${submission} ≈ ${usd.thisSubmission}, the rest ≈ ${usd.rest});`
            + " run again with --budget <usd> to go on";
        ctx.say(ctx.stopped);
        return false;
    }

    // a model with no price on file was counted as $0, so the total is only a lower bound: say which
    const unpriced = projection.unpriced.length > 0 ? ` (no price on file for ${projection.unpriced.join(", ")}: counted as $0)` : "";
    ctx.say(`budget: spent ${usd.spent} + at Anthropic ≈ ${usd.atAnthropic} + this ${submission} ≈ ${usd.thisSubmission}`
        + ` + the rest ≈ ${usd.rest} = ${usd.total} of ${usd.budget}${unpriced}`);
    return true;
}

/** The error of every failed outcome, in order. */
function errorsOf(outcomes: readonly SummaryOutcome[]): string[] {
    return outcomes.flatMap((o) => (o.ok ? [] : [o.error]));
}

/**
 * Writes outcomes to their rows and adds their tokens to the repo's spend, per model: a
 * request a fallback model finished counts once for each model that ran.
 */
function ingest(ctx: RunContext, outcomes: readonly SummaryOutcome[], transport: "direct" | "batch", destinationOf: (customId: string) => Destination | undefined): void {
    const results: SummaryResult[] = [];
    const usage = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();

    for (const outcome of outcomes){
        // counted before anything else: an answer with nowhere to land was still paid for
        for (const share of outcome.usage ?? []){
            const sum = usage.get(share.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
            sum.requests++;
            sum.inputTokens += share.inputTokens;
            sum.outputTokens += share.outputTokens;
            usage.set(share.model, sum);
        }

        const destination = destinationOf(outcome.customId);
        if (!destination) continue;   // its row is gone (the file or folder was deleted meanwhile), or was redone another way

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
        stopped: ctx.stopped !== null,
    };

    let state: "ready" | "running" | "failed" | "off" = "ready";
    const notes: string[] = [];

    if (ctx.stopped !== null){
        // the circuit breaker or the spend cap: still running if batches are at Anthropic (as after an error), failed otherwise
        state = result.inFlight > 0 ? "running" : "failed";
        notes.push(ctx.stopped);
        if (result.inFlight > 0) notes.push(stillAtAnthropic(result.inFlight));
    } else if (result.needModel > 0){
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

/**
 * The stage after a run stopped on an error. Requests still at Anthropic go on without this
 * process, and the next run collects them, so the stage stays "running" (ADR-032's exception)
 * instead of calling paid-for work failed.
 */
function reportRunError(db: Db, repoId: number, targets: readonly PlannedTarget[], err: unknown): void {
    try{
        const inFlight = countInFlight(db, repoId);
        const progress = { done: upToDate(targets), total: targets.length };
        writeStage(db, repoId, "summaries", inFlight > 0
            ? { state: "running", ...progress, note: `${messageOf(err)}; ${stillAtAnthropic(inFlight)}` }
            : { state: "failed", ...progress, note: messageOf(err) });
    } catch{
        // the database itself may be what failed (SQLITE_BUSY, say); the original error matters more
    }
}

/** The note for requests a stopped run leaves at Anthropic: they're paid for, and the next run collects them. */
function stillAtAnthropic(inFlight: number): string {
    return `${plural(inFlight, "request")} still at Anthropic; run npm run summarize to collect them`;
}

function upToDate(targets: readonly PlannedTarget[]): number {
    return targets.filter((t) => t.state === "current" || t.state === "template").length;
}

/** The pass's targets in one state, as a new list. */
function inState(snap: Snapshot, state: TargetState): PlannedTarget[] {
    return snap.targets.filter((t) => t.state === state);
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
