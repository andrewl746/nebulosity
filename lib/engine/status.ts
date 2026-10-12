import type { IndexStatus, StageName, StageStatus } from "../contracts";
import { getDb } from "../db/client";
import { readStages, type StoredStage } from "../db/store/stages";
import { countInFlight } from "../db/store/summaries";
import { countEmbeddable, countEmbedded } from "../db/store/summary-vectors";
import { findRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { plural } from "../index/summarize/prompts";

/** A running stage writes at least once a minute; five silent minutes means its process died. */
export const RUNNING_STALE_AFTER_MS = 5 * 60 * 1000;

/** GET /api/status: what each stage of one repo is doing, or null if that repo was never indexed. */
export function readIndexStatus(repoRoot: string, now: Date = new Date()): IndexStatus | null {
    const db = getDb();
    const repo = repoKey(repoRoot);
    const repoId = findRepository(db, repo);
    if (repoId === null) return null;

    const stored = readStages(db, repoId);
    const inFlight = () => countInFlight(db, repoId);

    return {
        repo,
        stages: {
            structure: honest("structure", stored.structure, now, inFlight),
            summaries: honest("summaries", stored.summaries, now, inFlight),
            embeddings: liveEmbeddings(honest("embeddings", stored.embeddings, now, inFlight), {
                done: countEmbedded(db, repoId),
                total: countEmbeddable(db, repoId),
            }),
        },
        indexVersion: readIndexVersion(db, repoId),
    };
}

/**
 * The embeddings stage with its counts taken from the tables (ADR-032, amended in V1.3): a rewritten summary loses its
 * vector at once, and a stored count would claim it for as long as nothing re-embeds. A running or failed stage keeps
 * its state and note. Otherwise the counts decide: nothing to embed is idle, everything embedded is ready, and anything
 * missing is idle with a note.
 */
export function liveEmbeddings(stage: StageStatus, live: { done: number; total: number }): StageStatus {
    if (stage.state === "running" || stage.state === "failed") return { ...stage, done: live.done, total: live.total };
    if (live.total === 0) return { state: "idle", done: 0, total: 0 };
    if (live.done >= live.total) return { state: "ready", done: live.done, total: live.total };

    const missing = live.total - live.done;
    return { state: "idle", done: live.done, total: live.total, note: `${plural(missing, "summary", "summaries")} without a vector yet` };
}

/**
 * What a stored row means now: a "running" row nobody has written for minutes is a crash,
 * not progress (ADR-032). The exception is summaries with batches still at Anthropic: that
 * work goes on without any local process, so it stays running.
 */
function honest(name: StageName, stage: StoredStage | undefined, now: Date, inFlight: () => number): StageStatus {
    if (!stage) return { state: "idle", done: 0, total: 0 };

    const { updatedAt, ...status } = stage;
    const silent = status.state === "running" && now.getTime() - updatedAt.getTime() > RUNNING_STALE_AFTER_MS;
    if (!silent || (name === "summaries" && inFlight() > 0)) return status;

    return { ...status, state: "failed", note: `interrupted: no progress since ${updatedAt.toISOString()}` };
}
