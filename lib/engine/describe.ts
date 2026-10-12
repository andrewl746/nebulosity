import path from "path";
import type { DescribeResponse } from "../contracts";
import { getDb, type Db } from "../db/client";
import { loadFileInfo, loadFileSymbols, loadFolderInfo, loadSummaryState, sumLinesInside } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { stalePaths } from "./freshness";
import { cachedAreaCounts, type TargetKind } from "./graph";
import { loadMapChildren, PathNotFoundError, reportedStatus, type MapReadOptions } from "./level";

/** Answers kept per repo for one index version at a time; a new version empties them (PIVOT_SPEC.md §6.1). */
type CachedAnswers = { version: number; answers: Map<string, DescribeResponse> };
const answerCache = new Map<string, CachedAnswers>();
/** A bound on one version's answers, not an LRU: past it the map starts over (as cachedAreaCounts does). */
const MAX_CACHED_ANSWERS = 2_000;

/**
 * GET /api/describe (API_CONTRACTS.md §12): what a folder or file is, what's inside it, what it uses and what uses it
 * (PIVOT_SPEC.md §6.1). The detail panel shows it; V1.4's MCP `describe` tool formats it as text.
 *
 * Answers are cached per index version (ADR-036, amended in V1.3.1): building one costs about 30 ms on VS Code's
 * biggest folders, mostly two scans (lines inside, stale summaries inside), and a repeat costs nothing. The answer is
 * shared between callers, so treat it as read-only.
 */
export function describe(repoRoot: string, targetPath: string, options: MapReadOptions = {}): DescribeResponse {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);
    const summariesOff = options.summariesOff ?? false;

    // one read transaction, as level() does: the answer is one consistent picture
    return db.transaction(() => {
        // every write the panel shows moves the version (ADR-036), so an answer holds until it moves; the repo's id is in
        // the key because a re-created repo starts counting again
        const version = readIndexVersion(db, repoId);
        const cacheKey = `${repoId}\0${repo}`;
        let cached = answerCache.get(cacheKey);
        if (!cached || cached.version !== version){
            cached = { version, answers: new Map() };
            answerCache.set(cacheKey, cached);
        }
        const key = `${summariesOff ? "off" : "on"}\0${targetPath}`;
        const hit = cached.answers.get(key);
        if (hit) return hit;

        const answer = describeUncached(db, repo, repoId, version, targetPath, summariesOff);
        if (cached.answers.size >= MAX_CACHED_ANSWERS) cached.answers.clear();
        cached.answers.set(key, answer);
        return answer;
    });
}

/** Builds one answer from the store. A path with nothing indexed throws, and a throw is never cached. */
function describeUncached(db: Db, repo: string, repoId: number, version: number, targetPath: string, summariesOff: boolean): DescribeResponse {
    const folder = loadFolderInfo(db, repoId, targetPath);
    const file = folder ? null : loadFileInfo(db, repoId, targetPath);
    if (!folder && !file) throw new PathNotFoundError(targetPath);

    const kind: TargetKind = folder ? (targetPath === "" ? "repo" : "folder") : "file";
    const row = loadSummaryState(db, repoId, kind, targetPath);
    const summaryStatus = reportedStatus(row, summariesOff);
    const { uses, usedBy } = cachedAreaCounts(db, repoId, version, targetPath, kind);

    return {
        repo,
        path: targetPath,
        kind,
        ...(row?.tagline ? { tagline: row.tagline, summary: row.summary ?? "" } : {}),
        summaryStatus,
        ...(summaryStatus === "failed" && row?.error ? { summaryError: row.error } : {}),
        stats: folder
            ? { fileCount: folder.fileCount, lineCount: sumLinesInside(db, repoId, targetPath) }
            : { fileCount: 1, lineCount: file!.lineCount },
        ...(folder
            ? { children: loadMapChildren(db, repoId, targetPath, summariesOff) }
            : { symbols: loadFileSymbols(db, repoId, targetPath) }),
        uses,
        usedBy,
        stalePaths: stalePaths(db, repoId, targetPath, kind),
        indexVersion: version,
    };
}
