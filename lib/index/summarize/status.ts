import path from "path";
import type { StageState, StageStatus } from "../../contracts";
import { getDb } from "../../db/client";
import { isSummaryLockHeld } from "../../db/store/lock";
import { readStages, writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import { applyTargetUpdates, countInFlight } from "../../db/store/summaries";
import { commandHint } from "../../hints";
import { repoKey } from "../paths";
import { DEFAULT_SUMMARY_MODELS, type SummaryModelsResolution } from "./models";
import type { PlannedTarget, TargetState } from "./plan";
import { plural } from "./prompts";
import { planSnapshot } from "./snapshot";

/** What the summaries stage's status depends on besides the plan. */
export type SummaryStageContext = {
    /** An API key is set, so a summarizer exists. */
    summarizerAvailable: boolean;
    /** Requests still at Anthropic in Message Batches. */
    inFlight: number;
    /** Requests that failed during the run that's finishing (runs only). */
    failed?: number;
    /** Why that run stopped early: the circuit breaker or the spend cap (runs only). */
    stopped?: string | null;
};

/** The note for requests a stopped run leaves at Anthropic: they're paid for, and the next run collects them. */
export function stillAtAnthropic(inFlight: number): string {
    return `${plural(inFlight, "request")} still at Anthropic; run ${commandHint("summarize", "<path-to-repo>")} to collect them`;
}

/**
 * The summaries stage as one plan sees it (PIVOT_SPEC.md §5.7). Pure, and shared by the stage's two writers: a
 * finishing summary run, and refreshSummaryStatus after anything else changed what's planned (ADR-032, amended).
 * - stopped (runs only): running while batches are at Anthropic, failed otherwise.
 * - off: no API key, and targets wait for a model.
 * - running: requests are at Anthropic in batches.
 * - idle: targets wait for a model and nothing is sending them yet (a file edited since it was summarized, say).
 * - ready: nothing waits. Folders left out of date for later ("lazy") and this run's failures go in the note.
 */
export function summaryStageStatus(targets: readonly PlannedTarget[], context: SummaryStageContext): StageStatus {
    const count = (state: TargetState): number => targets.filter((t) => t.state === state).length;
    const done = count("current") + count("template");
    const waiting = count("ready") + count("waiting");
    const notes: string[] = [];
    let state: StageState;

    if (context.stopped){
        state = context.inFlight > 0 ? "running" : "failed";
        notes.push(context.stopped);
        if (context.inFlight > 0) notes.push(stillAtAnthropic(context.inFlight));
    } else if (!context.summarizerAvailable && waiting > 0){
        state = "off";
        notes.push(`ANTHROPIC_API_KEY is not set, so ${waiting} of ${targets.length} summaries can't be written`);
    } else if (context.inFlight > 0){
        state = "running";
        notes.push(`${plural(context.inFlight, "request")} at Anthropic in batches; run ${commandHint("summarize", "<path-to-repo>")} to collect them`);
    } else if (waiting > 0){
        state = "idle";
        notes.push(`${waiting} waiting to be summarized`);
    } else{
        state = "ready";
        if (context.failed) notes.push(`${context.failed} failed this run (retried next run)`);
        const lazy = count("lazy");
        if (lazy > 0) notes.push(`${lazy} out of date (redone when opened)`);
    }

    return { state, done, total: targets.length, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) };
}

/**
 * Brings the summaries stage up to date after something other than a summary run changed what it depends on: a
 * structure update, or a summarizeNow (ADR-032, amended in V1.3). It plans like a run that sends nothing. New targets
 * get rows, statuses follow the plan (an edited file's summary turns stale), and test templates are written. While a
 * live summary run holds the lock, that run owns the stage row, so only the rows are updated and this returns null.
 * A failed run's note is kept until its targets stop waiting.
 *
 * `models` is the summary models setting as the caller resolved it for this job (ADR-066; the defaults when left out).
 * When it can't be used, no row is planned or written: every inputHash holds its model, so a plan with any other models
 * would mark the rows of the set ones stale. The first refresh after the fix catches up. Then:
 * - with a key, the stage is left as it was too, and this returns null;
 * - without one (free mode, which sends nothing either way), the stage is written as it reads with no setting, from a
 *   plan with the defaults that touches no row (the pre-ship pass's final review, m3). Otherwise a repo indexed for the
 *   first time has no summaries stage, and the tools and the panel treat its summaries as pending, not off.
 */
export function refreshSummaryStatus(
    repoRoot: string, options: { summarizerAvailable: boolean; models?: SummaryModelsResolution }
): StageStatus | null {
    const models = options.models ?? { ok: true, ...DEFAULT_SUMMARY_MODELS };
    if (!models.ok && options.summarizerAvailable) return null;
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    // between runs, out-of-date folders are lazy: redone when opened, or by the background worker's sweep
    const snap = planSnapshot(db, repoId, false, new Set(), models.ok ? models : DEFAULT_SUMMARY_MODELS);
    if (models.ok) applyTargetUpdates(db, repoId, snap.targets);
    if (isSummaryLockHeld(db)) return null;

    let status = summaryStageStatus(snap.targets, { summarizerAvailable: options.summarizerAvailable, inFlight: countInFlight(db, repoId) });
    const previous = readStages(db, repoId).summaries;
    if (previous?.state === "failed" && status.state === "idle"){
        status = { ...status, state: "failed", ...(previous.note ? { note: previous.note } : {}) };
    }

    writeStage(db, repoId, "summaries", status);
    return status;
}
