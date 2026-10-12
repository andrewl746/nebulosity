import path from "path";
import { getDb } from "../db/client";
import { IndexLockedError } from "../db/store/lock";
import { findRepository } from "../db/store/structure";
import { countStaleFolders, targetKey, type StoredSummary } from "../db/store/summaries";
import { NoActiveRepoError, SummariesOffError } from "../engine/errors";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { repoKey } from "../index/paths";
import { indexRepository, type IndexOptions, type IndexResult } from "../index/pipeline";
import { runSummaries, StructureNotReadyError, summarizeNow } from "../index/summarize/run";
import { refreshSummaryStatus } from "../index/summarize/status";
import type { Summarizer } from "../index/summarize/types";
import { applyFileChanges } from "../index/update";
import { watchRepository, type RepoWatcher } from "../index/watch";

/** More changed paths than this at once (a branch switch, a big pull), and one full run is cheaper than an update. */
export const MAX_INCREMENTAL_PATHS = 500;
/** At most this many file summaries per refresh, so a pull that touches thousands of files can't spend silently (ADR-038). */
export const MAX_AUTO_REFRESH_FILES = 50;
/** At most this many out-of-date folders per sweep, deepest first; their parents follow in later sweeps. */
export const SWEEP_MAX_FOLDERS = 20;
/** Summaries embedded per slice: about 3.5 s of MiniLM at its measured 18 a second, so no other job waits long. */
export const EMBED_SLICE = 64;
/**
 * Each refresh or sweep may spend at most this, counting only its own requests (ADR-035, amended). At VS Code's
 * measured means 50 Haiku files cost about $0.03 direct and 20 Sonnet folders $0.11–0.16, so it only stops a run that
 * has gone wrong. The CLI's $15 cap is cumulative, and VS Code's first pass already spent $10.30 of it.
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

/** Files that changed together, waiting out their quiet minute on one timer. */
type WaitGroup = { timer: ReturnType<typeof setTimeout>; paths: Set<string> };

export type BackgroundDeps = {
    /** null without an API key: structure updates still run, summaries don't. */
    summarizer: Summarizer | null;
    /** The file watcher; tests pass a fake. */
    watch?: (repoRoot: string, onChanges: (paths: string[]) => void) => RepoWatcher;
    /** The embedding model; tests pass a fake. */
    embed?: EmbedFn;
    log?: (message: string) => void;
    timings?: Partial<ServiceTimings>;
};

export type BackgroundService = {
    /** Points the worker at a repo (null: none): catches up on what changed while nothing watched, then watches it. */
    setRepo(repoRoot: string | null): Promise<void>;
    /** "Summarize now" for the Map (PIVOT_SPEC.md §5.3). It runs at once, beside the queued maintenance work. */
    summarizeNow(targetPath: string): Promise<StoredSummary>;
    /** A full structure run (POST /api/index), queued behind the work already waiting. */
    indexNow(onProgress?: IndexOptions["onProgress"]): Promise<IndexResult>;
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
 * That maintenance work runs one job at a time. "Summarize now" doesn't wait for it.
 */
export function createBackgroundService(deps: BackgroundDeps): BackgroundService {
    const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
    const log = deps.log ?? (() => {});
    const watchFn = deps.watch ?? watchRepository;
    const summarizerAvailable = deps.summarizer !== null;

    let root: string | null = null;
    let watcher: RepoWatcher | null = null;
    let sweepTimer: ReturnType<typeof setInterval> | null = null;
    /** Each waiting file's group: the files that changed together and come due together (armSummaryTimers). */
    const waiting = new Map<string, WaitGroup>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const pendingUpdate = new Set<string>();
    const pendingRefresh = new Set<string>();
    let embedQueued = false;
    let chain: Promise<unknown> = Promise.resolve();

    /** Maintenance runs one job at a time, in the order queued. A failed job is logged and the next one still runs. */
    function exclusive<T>(job: () => T | Promise<T>): Promise<T> {
        const run = chain.then(job);
        chain = run.catch((err: unknown) => log(`job failed: ${err instanceof Error ? err.message : String(err)}`));
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
        if (wasEmpty) void exclusive(runUpdate);   // one job takes everything queued by the time it starts
    }

    function runUpdate(): void {
        const repo = root;
        const paths = [...pendingUpdate].sort();
        pendingUpdate.clear();
        if (repo === null || paths.length === 0) return;

        try{
            if (paths.length > MAX_INCREMENTAL_PATHS || paths.some((p) => p === ".gitignore" || p.endsWith("/.gitignore"))){
                log(`re-indexing the whole repo (${paths.length} paths changed)`);
                indexRepository(repo);
                // too many to refresh one by one: they stay out of date until opened, swept, or npm run summarize
            } else{
                const result = applyFileChanges(repo, paths);
                log(`updated ${result.changed.length} changed and ${result.deleted.length} deleted files in ${Math.round(result.totalMs)} ms`);
                armSummaryTimers(result.changed);
                for (const p of result.deleted) cancelSummaryTimer(p);
            }
            refreshSummaryStatus(repo, { summarizerAvailable });
        } catch (err){
            if (!(err instanceof IndexLockedError)) throw err;
            log(`another index run holds the lock; trying again in ${timings.retryLockedMs / 1000} s`);
            later(() => queueUpdate(paths), timings.retryLockedMs);
        }
    }

    // ---- summaries --------------------------------------------------------------------
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
        if (wasEmpty) void exclusive(runRefresh);
    }

    /**
     * Redoes the summaries of files whose quiet minute is up (PIVOT_SPEC.md §5.6): most-imported first, at most
     * MAX_AUTO_REFRESH_FILES, through the regular API, under a cap on this refresh's own spend (INCREMENTAL_BUDGET_USD).
     * Their folders turn stale and wait to be opened or swept, so a pull can't set off hundreds of Sonnet calls.
     */
    async function runRefresh(): Promise<void> {
        const repo = root;
        const paths = [...pendingRefresh].sort();
        pendingRefresh.clear();
        if (repo === null || paths.length === 0 || deps.summarizer === null) return;

        const wanted = new Set(paths.map((p) => targetKey("file", p)));
        try{
            const result = await runSummaries(repo, {
                summarizer: deps.summarizer,
                transport: "direct",
                refreshStaleFolders: false,
                wait: false,
                budgetUsd: INCREMENTAL_BUDGET_USD,
                budgetScope: "run",
                select: (target) => wanted.has(targetKey(target.kind, target.path)),
                maxTargets: MAX_AUTO_REFRESH_FILES,
                onProgress: (message) => log(`summaries: ${message}`),
            });
            if (paths.length > MAX_AUTO_REFRESH_FILES){
                log(`refreshed at most ${MAX_AUTO_REFRESH_FILES} of ${paths.length} changed files; the rest stay out of date until opened or npm run summarize`);
            }
            if (result.summarized > 0) queueEmbed();
        } catch (err){
            if (!(err instanceof IndexLockedError) && !(err instanceof StructureNotReadyError)) throw err;
            log(`summaries: busy (another summary run, or a structure run); trying again in ${timings.retryLockedMs / 1000} s`);
            armSummaryTimers(paths, timings.retryLockedMs);
        }
    }

    /** Out-of-date folders whose children are settled, deepest first, at most SWEEP_MAX_FOLDERS (PIVOT_SPEC.md §5.6). */
    async function runSweep(): Promise<void> {
        const repo = root;
        if (repo === null || deps.summarizer === null) return;
        const db = getDb();
        const repoId = findRepository(db, repoKey(repo));
        if (repoId === null || countStaleFolders(db, repoId) === 0) return;

        try{
            const result = await runSummaries(repo, {
                summarizer: deps.summarizer,
                transport: "direct",
                refreshStaleFolders: true,
                wait: false,
                budgetUsd: INCREMENTAL_BUDGET_USD,
                budgetScope: "run",
                select: (target) => target.kind !== "file",
                maxTargets: SWEEP_MAX_FOLDERS,
                onProgress: (message) => log(`sweep: ${message}`),
            });
            // the run planned with stale folders as work; between runs they read as lazy again (ADR-032)
            refreshSummaryStatus(repo, { summarizerAvailable });
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
        void exclusive(runEmbed);
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
        pendingUpdate.clear();
        pendingRefresh.clear();
        const current = watcher;
        watcher = null;
        await current?.close();
    }

    async function idle(): Promise<void> {
        for (;;){
            const current = chain;
            await current;
            if (current === chain) return;
        }
    }

    return {
        async setRepo(next){
            await stopWatching();
            root = next === null ? null : path.resolve(next);
            const repo = root;
            if (repo === null) return;

            // the startup check (PIVOT_SPEC.md §5.6): one warm full run catches what changed while nothing watched
            const indexed = await exclusive(() => {
                if (findRepository(getDb(), repoKey(repo)) === null){
                    log(`${repo} isn't indexed yet; run npm run index -- "${repo}"`);
                    return false;
                }
                try{
                    indexRepository(repo);
                } catch (err){
                    if (!(err instanceof IndexLockedError)) throw err;
                    log("another index run holds the lock; watching without the startup check");
                }
                refreshSummaryStatus(repo, { summarizerAvailable });
                return true;
            });
            if (!indexed || root !== repo) return;   // never indexed, or switched again meanwhile

            watcher = watchFn(repo, queueUpdate);
            sweepTimer = setInterval(() => { void exclusive(runSweep); }, timings.sweepEveryMs);
            queueEmbed();   // summaries the CLI wrote but never embedded (an interrupted run) get their vectors here
            log(`watching ${repo}`);
        },

        async summarizeNow(targetPath){
            if (deps.summarizer === null) throw new SummariesOffError();
            if (root === null) throw new NoActiveRepoError();
            const row = await summarizeNow(root, targetPath, deps.summarizer);
            queueEmbed();
            return row;
        },

        indexNow(onProgress){
            const repo = root;
            if (repo === null) return Promise.reject(new NoActiveRepoError());
            return exclusive(() => {
                const result = indexRepository(repo, { onProgress });
                refreshSummaryStatus(repo, { summarizerAvailable });
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
