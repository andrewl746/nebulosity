import path from "path";
import type { SummaryStatus } from "../contracts";
import { getDb } from "../db/client";
import { loadFileInfo, sumLinesInside } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { describe } from "./describe";
import type { MapReadOptions } from "./level";
import { importIndexFor, type ImportIndex } from "./reach";

/** How many of the most-imported files an overview lists. */
export const MOST_IMPORTED = 10;

/** A top-level folder or file of the repo, with its size. */
export type OverviewArea = { path: string; kind: "folder" | "file"; fileCount: number; lineCount: number; tagline?: string };

/** The first answer about an unfamiliar repo (PIVOT_SPEC.md §6.2's `overview`). */
export type Overview = {
    repo: string;
    name: string;
    tagline?: string;
    summary?: string;
    summaryStatus: SummaryStatus;
    summaryError?: string;
    stats: { fileCount: number; lineCount: number; importCount: number };
    /** The repo's top-level folders and files, in the Map's order (largest first). */
    areas: OverviewArea[];
    /** The files most files import (ADR-010's importance), at most MOST_IMPORTED, none that nothing imports. */
    mostImported: { path: string; importedBy: number }[];
    stalePaths: number;
    indexVersion: number;
};

/** Files by how many files import them, most first, ties by path; files nothing imports are left out. */
export function rankMostImported(index: ImportIndex, limit: number): { path: string; importedBy: number }[] {
    const imported: number[] = [];
    for (let i = 0; i < index.paths.length; i++) if (index.inDegree[i] > 0) imported.push(i);
    return imported
        .sort((a, b) => index.inDegree[b] - index.inDegree[a] || a - b)
        .slice(0, limit)
        .map((i) => ({ path: index.paths[i], importedBy: index.inDegree[i] }));
}

/**
 * The repo's describe answer (its summary, size and top-level children), plus each area's lines and the repo's
 * most-imported files. One read transaction; describe's own runs inside it as a savepoint.
 */
export function overview(repoRoot: string, options: MapReadOptions = {}): Overview {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const root = describe(repoRoot, "", options);
        const index = importIndexFor(db, repoId, readIndexVersion(db, repoId));
        return {
            repo: root.repo,
            name: path.basename(path.resolve(repoRoot)),
            ...(root.tagline ? { tagline: root.tagline, summary: root.summary ?? "" } : {}),
            summaryStatus: root.summaryStatus,
            ...(root.summaryError ? { summaryError: root.summaryError } : {}),
            stats: { fileCount: root.stats.fileCount, lineCount: root.stats.lineCount, importCount: index.imports.neighbours.length },
            areas: (root.children ?? []).map((child): OverviewArea => ({
                path: child.path,
                kind: child.kind === "folder" ? "folder" : "file",
                fileCount: child.fileCount,
                lineCount: child.kind === "folder" ? sumLinesInside(db, repoId, child.path) : loadFileInfo(db, repoId, child.path)?.lineCount ?? 0,
                ...(child.tagline ? { tagline: child.tagline } : {}),
            })),
            mostImported: rankMostImported(index, MOST_IMPORTED),
            stalePaths: root.stalePaths,
            indexVersion: root.indexVersion,
        };
    });
}
