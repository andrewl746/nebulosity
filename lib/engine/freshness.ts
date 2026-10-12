import type { Db } from "../db/client";
import { countStaleFileSummaries } from "../db/store/map";
import { plural } from "../index/summarize/prompts";
import type { TargetKind } from "./graph";

/**
 * Files at or under a target whose summary describes bytes they no longer have (PIVOT_SPEC.md §5.6, "honest answers").
 * An edited file's summary turns stale when the structure update re-plans the summaries (Task 5), and stays stale until
 * it's redone: 60 quiet seconds later in the background worker, at once when opened.
 */
export function stalePaths(db: Db, repoId: number, targetPath: string, kind: TargetKind): number {
    return countStaleFileSummaries(db, repoId, targetPath, kind);
}

/** The sentence an answer adds when it touches stale paths, or null when it touches none. */
export function freshnessNote(stale: number): string | null {
    if (stale === 0) return null;
    return stale === 1
        ? "1 file here changed since it was summarized, so its summary is out of date until it's refreshed."
        : `${plural(stale, "file")} here changed since they were summarized, so their summaries are out of date until they're refreshed.`;
}
