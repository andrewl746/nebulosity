import type { Db } from "../../db/client";
import { loadFileFacts, loadFolderFacts, loadSummaries, type FileFacts } from "../../db/store/summaries";
import type { ResolvedSummaryModels } from "./models";
import { planSummaries, type PlannedTarget, type Restyle } from "./plan";

/** One planning pass: the plan, and the file facts it was made from. */
export type Snapshot = { targets: PlannedTarget[]; files: Map<string, FileFacts> };

/**
 * Plans every target of a repo from what the database holds right now. Summary runs, summarizeNow and the stage
 * refresh (status.ts) all plan through here, so they can't disagree about a target's state. `models` is the setting
 * as resolved for this job (ADR-066): the model is part of every inputHash, so every planner has to use the same one.
 * `restyle` is PlanOptions.restyle: which summaries an older prompt wrote this plan redoes (P1).
 */
export function planSnapshot(
    db: Db, repoId: number, refreshStaleFolders: boolean, failedThisRun: ReadonlySet<string>, models: ResolvedSummaryModels,
    restyle: Restyle = "none"
): Snapshot {
    // One read transaction: a structure run committing meanwhile can't hand us half of its changes.
    // (better-sqlite3 has one connection, so reads through `db` inside the callback belong to it.)
    return db.transaction(() => {
        const files = loadFileFacts(db, repoId);
        const targets = planSummaries(files, loadFolderFacts(db, repoId), loadSummaries(db, repoId), {
            models: models.models,
            refreshStaleFolders,
            failedThisRun,
            restyle,
        });
        return { targets, files: new Map(files.map((f) => [f.path, f])) };
    });
}
