import path from "path";
import { getDb } from "../db/client";
import { IndexLockedError } from "../db/store/lock";
import { findRepository } from "../db/store/structure";
import { approvedBudgetUsd, countStaleFolders, loadSummaries, summariesConfirmed, targetKey, type StoredSummary } from "../db/store/summaries";
import { NoActiveRepoError, RepoSwitchingError, SummariesNotConfirmedError, SummariesOffError } from "../engine/errors";
import { commandHint } from "../hints";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { repoKey } from "../index/paths";
import { indexRepository, type IndexOptions, type IndexResult } from "../index/pipeline";
import { configuredSummaryModels, SummaryModelsError, type SummaryModelsResolution } from "../index/summarize/models";
import { DEFAULT_BUDGET_USD, runSummaries, StructureNotReadyError, summarizeNow } from "../index/summarize/run";
import type { PlannedTarget } from "../index/summarize/plan";
import { snapshotOf } from "../index/summarize/pricing";
import { writtenInOlderStyle } from "../index/summarize/prompts";
import { refreshSummaryStatus } from "../index/summarize/status";
import type { Summarizer } from "../index/summarize/types";
import { applyFileChanges } from "../index/update";
import { watchRepository, type RepoWatcher } from "../index/watch";
import type { ResolutionState } from "../index/languages/resolution";

/** More changed paths than this at once (a branch switch, a big pull), and one full run is cheaper than an update. */
export const MAX_INCREMENTAL_PATHS = 500;
/**
 * At most this many file summaries are refreshed automatically per AUTO_REFRESH_WINDOW_MS, so a pull or a formatter that
 * touches thousands of files can't spend silently (ADR-038). A window, not a refresh: a long burst reaches the worker as
 * many batches, and each would otherwise get its own 50.
 */
export const MAX_AUTO_REFRESH_FILES = 50;
export const AUTO_REFRESH_WINDOW_MS = 10 * 60_000;
/** At most this many out-of-date folders per sweep, deepest first; their parents follow in later sweeps. */
export const SWEEP_MAX_FOLDERS = 20;
/** Summaries embedded per slice: about 3.5 s of MiniLM at its measured 18 a second, so no other job waits long. */
export const EMBED_SLICE = 64;
/**
 * Each refresh or sweep may spend at most this, counting only its own requests (ADR-035, amended). At VS Code's
 * measured means 50 Haiku files cost about $0.03 direct and 20 Sonnet folders $0.11–0.16, so it only stops a run that
 * has gone wrong. Beside it, no job takes the repo's cumulative spend past the budget of the last yes (R24): the CLI's
 * $15 unless that yes was given with another --budget, so after VS Code's $10.30 first pass about $4.70 remains.
 */
export const INCREMENTAL_BUDGET_USD = 1;

export type ServiceTimings = {
    /** A file's summary is redone this long after its last change (PIVOT_SPEC.md §5.6). */
    summaryQuietMs: number;
    /** How often out-of-date folders are swept. */
    sweepEveryMs: number;
    /** How long to wait before retrying work another process had locked. */
    retryLockedMs: number;
};

export const DEFAULT_TIMINGS: ServiceTimings = { summaryQuietMs: 60_000, sweepEveryMs: 10 * 60_000, retryLockedMs: 30_000 };

/** The background worker's two job queues (createBackgroundService's serial). */
type Lane = "structure" | "maintenance";

/** Files that changed together, waiting out their quiet minute on one timer. */
type WaitGroup = { timer: ReturnType<typeof setTimeout>; paths: Set<string> };

export type BackgroundDeps = {
    /** null without an API key: structure updates still run, summaries don't. */
    summarizer: Summarizer | null;
    /** The file watcher; tests pass a fake. */
    watch?: (repoRoot: string, onChanges: (paths: string[]) => void) => RepoWatcher;
    /** The embedding model; tests pass a fake. */
    embed?: EmbedFn;
    /**
     * The summary models setting (ADR-066), read at each job, so a changed setting applies to the next job without a
     * restart. Default: summaryModels in config.json, through readConfig. Tests pass their own.
     */
    summaryModels?: () => SummaryModelsResolution;
    log?: (message: string) => void;
    timings?: Partial<ServiceTimings>;
};

export type BackgroundService = {
    /** Points the worker at a repo (null: none): catches up on what changed while nothing watched, then watches it. */
    setRepo(repoRoot: string | null): Promise<void>;
    /** "Summarize now" for the Map (PIVOT_SPEC.md §5.3). It runs at once, beside the queued maintenance work. */
    summarizeNow(targetPath: string, expectedRoot?: string): Promise<StoredSummary>;
    /** A full structure run (POST /api/index), queued behind the work already waiting. */
    indexNow(onProgress?: IndexOptions["onProgress"], expectedRoot?: string): Promise<IndexResult>;
    /** Resolves once every queued job has run (tests use it). */
    idle(): Promise<void>;
    stop(): Promise<void>;
};

/**
 * The background worker's logic (ADR-038), with no process or IPC in it: Task 13's scripts/background.ts runs it. It owns
 * every write while the Map is open:
 * - watched paths become incremental structure updates (ADR-037);
 * - each changed file's summary is redone 60 quiet seconds later, at most 50 at once;
 * - out-of-date folders are swept every 10 minutes;
 * - whatever lacks a vector is embedded in slices.
 * Structure work and maintenance run in two lanes, one job at a time in each (see serial). "Summarize now" waits for neither.
 */
export function createBackgroundService(deps: BackgroundDeps): BackgroundService {
    const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
    const log = deps.log ?? (() => {});
    const watchFn = deps.watch ?? ((repoRoot: string, onChanges: (paths: string[]) => void) =>
        watchRepository(repoRoot, onChanges, { onError: (err) => log(`the file watcher reported an error and goes on: ${err.message}`) }));
    const summarizerAvailable = deps.summarizer !== null;
    const settingNow = deps.summaryModels ?? configuredSummaryModels;
    /** The summaries stage after a change, planned with the setting as this job read it (a broken one leaves it as it was). */
    const refreshStatus = (repo: string, models: SummaryModelsResolution = settingNow()) => refreshSummaryStatus(repo, { summarizerAvailable, models });

    let root: string | null = null;
    let watcher: RepoWatcher | null = null;
    let sweepTimer: ReturnType<typeof setInterval> | null = null;
    /** Each waiting file's group: the files that changed together and come due together (armSummaryTimers). */
    const waiting = new Map<string, WaitGroup>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const pendingUpdate = new Set<string>();
    const pendingRefresh = new Set<string>();
    let embedQueued = false;
    /**
     * What the last update resolved with (ADR-053 amended, ADR-065): the manifests and the adapters' cache (TypeScript's
     * workspace). Kept until a full run or a repo switch, since a full run may have seen a new manifest.
     */
    let resolution: ResolutionState | undefined;
    /** Files refreshed automatically in the last AUTO_REFRESH_WINDOW_MS: each refresh's count leaves it when its window ends. */
    let refreshedInWindow = 0;
    const lanes: Record<Lane, Promise<unknown>> = { structure: Promise.resolve(), maintenance: Promise.resolve() };

    /**
     * Runs a job in its lane, one job at a time per lane, in the order queued; a failed job is logged and the lane goes
     * on (ADR-038, amended). Structure work (updates, the startup check, re-index) is synchronous and takes milliseconds
     * to seconds, and S6 gives a save 2 s to reach the index. Maintenance (summary refreshes, the sweep, embeddings)
     * waits on Haiku, Sonnet or the embedding model for seconds to minutes. In one lane a save would wait behind all of
     * that. Apart, a structure job runs between a maintenance job's awaits; a summary written for content that changed
     * meanwhile is put back to stale when the refresh re-plans at its end.
     */
    function serial<T>(lane: Lane, job: () => T | Promise<T>): Promise<T> {
        const run = lanes[lane].then(job);
        lanes[lane] = run.catch((err: unknown) => log(`job failed: ${err instanceof Error ? err.message : String(err)}`));
        return run;
    }

    function later(fn: () => void, ms: number): void {
        const timer = setTimeout(() => {
            retryTimers.delete(timer);
            fn();
        }, ms);
        retryTimers.add(timer);
    }

    // ---- structure ------------------------------------------------------------------
    function queueUpdate(paths: readonly string[]): void {
        const wasEmpty = pendingUpdate.size === 0;
        for (const p of paths) pendingUpdate.add(p);
        if (wasEmpty) void serial("structure", runUpdate);   // one job takes everything queued by the time it starts
    }

    function runUpdate(): void {
        const repo = root;
        const paths = [...pendingUpdate].sort();
        pendingUpdate.clear();
        if (repo === null || paths.length === 0) return;

        try{
            if (paths.length > MAX_INCREMENTAL_PATHS || paths.some((p) => p === ".gitignore" || p.endsWith("/.gitignore"))){
                log(`re-indexing the whole repo (${paths.length} paths changed)`);
                resolution = undefined;
                indexRepository(repo);
                // too many to refresh one by one: they stay out of date until opened, swept, or npm run summarize
            } else{
                const result = applyFileChanges(repo, paths, { resolution });
                resolution = result.resolution;
                log(`updated ${result.changed.length} changed and ${result.deleted.length} deleted files in ${Math.round(result.totalMs)} ms`);
                if (deps.summarizer !== null && mayRefresh(repo)) armSummaryTimers(result.changed);
                for (const p of result.deleted) cancelSummaryTimer(p);
            }
            refreshStatus(repo);
        } catch (err){
            if (!(err instanceof IndexLockedError)) throw err;
            log(`another index run holds the lock; trying again in ${timings.retryLockedMs / 1000} s`);
            later(() => queueUpdate(paths), timings.retryLockedMs);
        }
    }

    // ---- summaries --------------------------------------------------------------------
    /**
     * Whether this repo's summaries may be written without asking (S11, ADR-038 amended): a yes was recorded by
     * `nebulosity summarize`, or a model has already written some. A key alone never starts spending on a new repo.
     */
    function mayRefresh(repo: string): boolean {
        const db = getDb();
        const repoId = findRepository(db, repoKey(repo));
        return repoId !== null && summariesConfirmed(db, repoId);
    }

    /**
     * What the repo's summaries may have cost in all once an automatic job is done (R24): the budget of the last yes
     * `nebulosity summarize` recorded, else the CLI's default. Past it the jobs send nothing, and the stage's note says
     * how to approve more; after a model change that keeps the sweep from finishing, unasked, a cascade of folder
     * re-summaries a capped or --no-wait run left over.
     */
    function approvedBudget(repo: string): number {
        const db = getDb();
        const repoId = findRepository(db, repoKey(repo));
        return (repoId === null ? null : approvedBudgetUsd(db, repoId)) ?? DEFAULT_BUDGET_USD;
    }

    /** The repo's stored summaries by targetKey, read once per job as it starts, so every check the job makes reads the same rows. */
    function storedRows(repo: string): Map<string, StoredSummary> {
        const db = getDb();
        const repoId = findRepository(db, repoKey(repo));
        return new Map(repoId === null ? [] : loadSummaries(db, repoId).map((s) => [targetKey(s.kind, s.path), s]));
    }

    /**
     * What an automatic job (a refresh after a save, the sweep) may send without asking (ADR-066, R17): a target whose
     * stored text the model now in use for its kind wrote (so it's out of date only because its inputs changed), or one
     * no model has written yet. Text another model wrote waits for `nebulosity summarize`'s estimate and yes, "Summarize
     * now", or a panel being opened: redoing it is a model change, and only a yes pays for that. A dated snapshot the API
     * reported (`<model>-20261001`) counts as its model, and nothing else does: claude-sonnet-5-5 isn't claude-sonnet-5
     * (snapshotOf). `rows` are the job's storedRows.
     */
    function sentUnasked(rows: ReadonlyMap<string, StoredSummary>): (target: PlannedTarget) => boolean {
        return (target) => {
            const model = rows.get(targetKey(target.kind, target.path))?.model;
            return !model || model === "template" || model === target.model || snapshotOf(model) === target.model;
        };
    }

    /**
     * Starts the quiet wait (PIVOT_SPEC.md §5.6) for files that just changed together, on one timer, so they come due
     * as one refresh and MAX_AUTO_REFRESH_FILES bounds it. A timer per file wouldn't: timers due at the same moment fire
     * one by one with microtasks between them, so each would start its own refresh. A file saved again leaves its old
     * group for a new one, which restarts its wait.
     */
    function armSummaryTimers(filePaths: readonly string[], delayMs: number = timings.summaryQuietMs): void {
        if (filePaths.length === 0) return;
        for (const p of filePaths) cancelSummaryTimer(p);
        const group: WaitGroup = {
            paths: new Set(filePaths),
            timer: setTimeout(() => {
                for (const p of group.paths) waiting.delete(p);
                queueRefresh([...group.paths]);
            }, delayMs),
        };
        for (const p of filePaths) waiting.set(p, group);
    }

    /** Stops one file's wait: it changed again, or it's gone. An emptied group's timer goes too. */
    function cancelSummaryTimer(filePath: string): void {
        const group = waiting.get(filePath);
        if (!group) return;
        waiting.delete(filePath);
        group.paths.delete(filePath);
        if (group.paths.size === 0) clearTimeout(group.timer);
    }

    function queueRefresh(paths: readonly string[]): void {
        const wasEmpty = pendingRefresh.size === 0;
        for (const p of paths) pendingRefresh.add(p);
        if (wasEmpty) void serial("maintenance", runRefresh);
    }

    /**
     * Redoes the summaries of files whose quiet minute is up (PIVOT_SPEC.md §5.6): most-imported first, at most
     * MAX_AUTO_REFRESH_FILES per AUTO_REFRESH_WINDOW_MS, through the regular API, under a cap on this refresh's own spend
     * (INCREMENTAL_BUDGET_USD).
     * Their folders turn stale and wait to be opened or swept, so a pull can't set off hundreds of Sonnet calls.
     * Only files the model now in use wrote, or that no model has written, go (sentUnasked).
     */
    async function runRefresh(): Promise<void> {
        const repo = root;
        const paths = [...pendingRefresh].sort();
        pendingRefresh.clear();
        if (repo === null || paths.length === 0 || deps.summarizer === null || !mayRefresh(repo)) return;
        const allowance = MAX_AUTO_REFRESH_FILES - refreshedInWindow;
        if (allowance <= 0){
            log(`${paths.length} changed files keep their old summaries: ${MAX_AUTO_REFRESH_FILES} were refreshed in the last ${AUTO_REFRESH_WINDOW_MS / 60_000} minutes; they're redone when opened, or by ${commandHint("summarize", `"${repo}"`)}`);
            return;
        }
        const models = settingNow();
        if (!models.ok){
            log(`summaries: ${paths.length} changed files keep their old summaries until the setting is fixed: ${models.error}`);
            return;
        }

        const wanted = new Set(paths.map((p) => targetKey("file", p)));
        const unasked = sentUnasked(storedRows(repo));
        // The content whose quiet minute is up: each file's input hash as this run first plans it. A file saved again
        // mid-refresh (structure updates don't wait for refreshes) plans with a new hash and isn't sent again here: its
        // update restarted its own minute. Otherwise every save during a wave would be paid for at once.
        const dueHash = new Map<string, string>();
        const isDue = (target: PlannedTarget): boolean => {
            const key = targetKey(target.kind, target.path);
            if (!wanted.has(key) || !unasked(target)) return false;
            if (!dueHash.has(key)) dueHash.set(key, target.inputHash);
            return dueHash.get(key) === target.inputHash;
        };
        try{
            const result = await runSummaries(repo, {
                summarizer: deps.summarizer,
                models,
                transport: "direct",
                refreshStaleFolders: false,
                wait: false,
                budgetUsd: INCREMENTAL_BUDGET_USD,
                budgetScope: "run",
                repoBudgetUsd: approvedBudget(repo),
                select: isDue,
                maxTargets: allowance,
                onProgress: (message) => log(`summaries: ${message}`),
            });
            const sent = result.summarized + result.failed;
            refreshedInWindow += sent;
            later(() => { refreshedInWindow -= sent; }, AUTO_REFRESH_WINDOW_MS);
            if (paths.length > allowance){
                log(`refreshed at most ${allowance} of ${paths.length} changed files; the rest stay out of date until opened or summarized by ${commandHint("summarize", `"${repo}"`)}`);
            }
            if (result.summarized > 0) queueEmbed();
        } catch (err){
            if (!(err instanceof IndexLockedError) && !(err instanceof StructureNotReadyError)) throw err;
            log(`summaries: busy (another summary run, or a structure run); trying again in ${timings.retryLockedMs / 1000} s`);
            armSummaryTimers(paths, timings.retryLockedMs);
        }
    }

    /**
     * Out-of-date folders whose children are settled, deepest first, at most SWEEP_MAX_FOLDERS (PIVOT_SPEC.md §5.6): only
     * those the model now in use wrote, or that no model has written (sentUnasked). After a folder or repo model change
     * the rest wait for a yes, instead of being redone 20 every 10 minutes with no estimate (R17). A folder or the repo
     * an older prompt version wrote waits too, to be opened or redone by `nebulosity summarize` (Q2 B).
     */
    async function runSweep(): Promise<void> {
        const repo = root;
        if (repo === null || deps.summarizer === null || !mayRefresh(repo)) return;
        const db = getDb();
        const repoId = findRepository(db, repoKey(repo));
        if (repoId === null || countStaleFolders(db, repoId) === 0) return;
        const models = settingNow();
        if (!models.ok){
            log(`sweep: out-of-date folders wait until the setting is fixed: ${models.error}`);
            return;
        }

        const rows = storedRows(repo);
        const unasked = sentUnasked(rows);
        const olderStyle = (target: PlannedTarget): boolean => {
            const row = rows.get(targetKey(target.kind, target.path));
            return row !== undefined && writtenInOlderStyle(row);
        };
        try{
            const result = await runSummaries(repo, {
                summarizer: deps.summarizer,
                models,
                transport: "direct",
                refreshStaleFolders: true,
                // such a folder plans lazy, so it never keeps the folder above it waiting (Q2 B, the select below)
                olderFoldersWaitToBeOpened: true,
                wait: false,
                budgetUsd: INCREMENTAL_BUDGET_USD,
                budgetScope: "run",
                repoBudgetUsd: approvedBudget(repo),
                // Q2 B: a folder or the repo an older prompt wrote is left to be opened, even once its inputs change (an
                // edit below it, or a child a panel restyled), so the sweep never restyles the folders above an edit
                // unasked. The refresh after a save keeps redoing an edited file whatever prompt wrote it (P1).
                select: (target) => target.kind !== "file" && unasked(target) && !olderStyle(target),
                maxTargets: SWEEP_MAX_FOLDERS,
                onProgress: (message) => log(`sweep: ${message}`),
            });
            // the run planned with stale folders as work; between runs they read as lazy again (ADR-032)
            refreshStatus(repo, models);
            if (result.summarized > 0) queueEmbed();
        } catch (err){
            if (!(err instanceof IndexLockedError) && !(err instanceof StructureNotReadyError)) throw err;
            log("sweep: busy; trying again at the next sweep");
        }
    }

    // ---- embeddings -------------------------------------------------------------------
    function queueEmbed(): void {
        if (embedQueued) return;
        embedQueued = true;
        void serial("maintenance", runEmbed);
    }

    async function runEmbed(): Promise<void> {
        embedQueued = false;
        const repo = root;
        if (repo === null) return;
        const result = await embedSummaries(repo, { embed: deps.embed, limit: EMBED_SLICE });
        if (result.remaining > 0) queueEmbed();   // one slice per job, so updates queued meanwhile go first
    }

    // ---- lifecycle --------------------------------------------------------------------
    async function stopWatching(): Promise<void> {
        if (sweepTimer) clearInterval(sweepTimer);
        sweepTimer = null;
        for (const group of new Set(waiting.values())) clearTimeout(group.timer);
        waiting.clear();
        for (const timer of retryTimers) clearTimeout(timer);
        retryTimers.clear();
        refreshedInWindow = 0;   // its timers just went with retryTimers: another repo starts a fresh window
        pendingUpdate.clear();
        pendingRefresh.clear();
        resolution = undefined;
        const current = watcher;
        watcher = null;
        await current?.close();
    }

    async function idle(): Promise<void> {
        for (;;){
            const { structure, maintenance } = lanes;
            await Promise.all([structure, maintenance]);
            if (structure === lanes.structure && maintenance === lanes.maintenance) return;
        }
    }

    /**
     * Starts on an indexed repo: the watcher, then the startup check, the sweep and any embedding left to do. A repo
     * that isn't indexed yet is checked again every retryLockedMs until it is (npm run index from a terminal), instead
     * of leaving the worker idle while the Map shows the repo (C1).
     */
    async function begin(repo: string, firstTry: boolean): Promise<void> {
        if (findRepository(getDb(), repoKey(repo)) === null){
            if (firstTry) log(`${repo} isn't indexed yet; run ${commandHint("index", `"${repo}"`)} (checked again every ${timings.retryLockedMs / 1000} s)`);
            later(() => {
                if (root !== repo || watcher !== null) return;
                begin(repo, false).catch((err: unknown) => log(`starting on ${repo} failed: ${err instanceof Error ? err.message : String(err)}`));
            }, timings.retryLockedMs);
            return;
        }

        // Watch first, then catch up. chokidar reports nothing for a file its first crawl hasn't reached (VS Code's
        // crawl takes seconds), so a change made before the crawl ends is caught by the startup check that follows
        // it, and any later change by the watcher. The other order would lose edits made during the crawl.
        const current = watchFn(repo, queueUpdate);
        watcher = current;
        await current.ready;
        if (root !== repo || watcher !== current) return;   // switched again meanwhile, which closed this watcher

        // the startup check (PIVOT_SPEC.md §5.6): one warm full run catches what changed while nothing watched
        await serial("structure", () => {
            resolution = undefined;
            try{
                indexRepository(repo);
            } catch (err){
                if (!(err instanceof IndexLockedError)) throw err;
                log("another index run holds the lock; watching without the startup check");
            }
            refreshStatus(repo);
        });
        if (root !== repo) return;   // switched again meanwhile

        sweepTimer = setInterval(() => { void serial("maintenance", runSweep); }, timings.sweepEveryMs);
        queueEmbed();   // summaries the CLI wrote but never embedded (an interrupted run) get their vectors here
        log(`watching ${repo}`);
    }

    /**
     * The repo a request runs on: the worker's own, which must be the one the request is for. The Map follows the
     * config, and a request can reach the worker before it has switched; acting anyway would hit the wrong repo (C1).
     */
    function rootFor(expectedRoot: string | undefined): string {
        if (expectedRoot !== undefined && (root === null || repoKey(expectedRoot) !== repoKey(root))){
            throw new RepoSwitchingError(expectedRoot, root === null ? null : repoKey(root));
        }
        if (root === null) throw new NoActiveRepoError();
        return root;
    }

    return {
        async setRepo(next){
            await stopWatching();
            root = next === null ? null : path.resolve(next);
            if (root !== null) await begin(root, true);
        },

        async summarizeNow(targetPath, expectedRoot){
            if (deps.summarizer === null) throw new SummariesOffError();
            const repo = rootFor(expectedRoot);
            // the Map asks on opening a panel; on a repo nobody said yes for, that would spend unasked (S11)
            if (!mayRefresh(repo)) throw new SummariesNotConfirmedError(repo);
            // read now, so a setting changed while the Map is open applies to this click (ADR-066)
            const models = settingNow();
            if (!models.ok) throw new SummaryModelsError(models.error);
            const row = await summarizeNow(repo, targetPath, deps.summarizer, models);
            queueEmbed();
            return row;
        },

        indexNow(onProgress, expectedRoot){
            let repo: string;
            try{
                repo = rootFor(expectedRoot);
            } catch (err){
                return Promise.reject(err);
            }
            return serial("structure", () => {
                resolution = undefined;
                const result = indexRepository(repo, { onProgress });
                refreshStatus(repo);
                return result;
            });
        },

        idle,

        async stop(){
            await stopWatching();
            root = null;
            await idle();
        },
    };
}
