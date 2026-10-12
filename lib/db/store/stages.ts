import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { meta } from "../schema";
import type { StageName, StageStatus } from "../../contracts";

/** Every stage, in pipeline order. */
export const STAGE_NAMES = ["structure", "summaries", "embeddings"] as const satisfies readonly StageName[];

/** A stage's status as stored, with when it was last written. */
export type StoredStage = StageStatus & { updatedAt: Date };

/** Stage status lives in `meta` (PIVOT_SPEC.md §4.1): one row per repo and stage. */
const stageKey = (repoId: number, stage: StageName): string => `stage:${repoId}:${stage}`;

export function writeStage(db: Db, repoId: number, stage: StageName, status: StageStatus): void {
    const value = JSON.stringify(status);
    const updatedAt = new Date();
    db.insert(meta)
        .values({ key: stageKey(repoId, stage), value, updatedAt })
        .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt } })
        .run();
}

/** Each stage's stored status. A stage that never wrote one is missing. */
export function readStages(db: Db, repoId: number): Partial<Record<StageName, StoredStage>> {
    const stages: Partial<Record<StageName, StoredStage>> = {};

    for (const stage of STAGE_NAMES){
        const row = db.select({ value: meta.value, updatedAt: meta.updatedAt }).from(meta).where(eq(meta.key, stageKey(repoId, stage))).get();
        if (row) stages[stage] = { ...(JSON.parse(row.value) as StageStatus), updatedAt: row.updatedAt };
    }

    return stages;
}
