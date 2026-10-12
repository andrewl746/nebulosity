import path from "path";
import type { DescribeResponse } from "../contracts";
import { getDb } from "../db/client";
import { loadFileInfo, loadFileSymbols, loadFolderInfo, loadSummaryState, sumLinesInside } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { stalePaths } from "./freshness";
import { cachedAreaCounts, type TargetKind } from "./graph";
import { loadMapChildren, PathNotFoundError, reportedStatus, type MapReadOptions } from "./level";

/**
 * GET /api/describe (API_CONTRACTS.md §12): what a folder or file is, what's inside it, what it uses and what uses it
 * (PIVOT_SPEC.md §6.1). The detail panel shows it; V1.4's MCP `describe` tool formats it as text.
 */
export function describe(repoRoot: string, targetPath: string, options: MapReadOptions = {}): DescribeResponse {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);
    const summariesOff = options.summariesOff ?? false;

    // one read transaction, as level() does: the answer is one consistent picture
    return db.transaction(() => {
        const folder = loadFolderInfo(db, repoId, targetPath);
        const file = folder ? null : loadFileInfo(db, repoId, targetPath);
        if (!folder && !file) throw new PathNotFoundError(targetPath);

        const kind: TargetKind = folder ? (targetPath === "" ? "repo" : "folder") : "file";
        const version = readIndexVersion(db, repoId);
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
    });
}
