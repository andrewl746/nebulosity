import type { IndexStatus, StageName, StageStatus } from "../contracts";
import { getDb } from "../db/client";
import { readStages, STAGE_NAMES, type StoredStage } from "../db/store/stages";
import { findRepository } from "../db/store/structure";
import { repoKey } from "../index/paths";

/** A running stage writes at least once a minute; five silent minutes means its process died. */
export const RUNNING_STALE_AFTER_MS = 5 * 60 * 1000;

/** GET /api/status: what each stage of one repo is doing, or null if that repo was never indexed. */
export function readIndexStatus(repoRoot: string, now: Date = new Date()): IndexStatus | null {
    const db = getDb();
    const repo = repoKey(repoRoot);
    const repoId = findRepository(db, repo);
    if (repoId === null) return null;

    const stored = readStages(db, repoId);
    const stages = {} as Record<StageName, StageStatus>;

    for (const name of STAGE_NAMES){
        stages[name] = honest(stored[name], now);
    }

    return { repo, stages };
}

/** What a stored row means now: a "running" row nobody has written for minutes is a crash, not progress (ADR-032). */
function honest(stage: StoredStage | undefined, now: Date): StageStatus {
    if (!stage) return { state: "idle", done: 0, total: 0 };

    const { updatedAt, ...status } = stage;
    const silent = status.state === "running" && now.getTime() - updatedAt.getTime() > RUNNING_STALE_AFTER_MS;
    if (!silent) return status;

    return { ...status, state: "failed", note: `interrupted: no progress since ${updatedAt.toISOString()}` };
}
