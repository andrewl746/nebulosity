import path from "path";
import type { LevelResponse, MapNode, SummaryStatus } from "../contracts";
import { getDb, type Db } from "../db/client";
import type { StoredSummaryStatus } from "../db/schema";
import {
    loadChildFiles, loadChildFolders, loadChildSummaries, loadFileInfo, loadFolderInfo, loadLevelEdgeRows,
} from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { paginateLevel } from "./pages";

export { MAP_BOX_CAP } from "./pages";

export class PathNotFoundError extends Error {
    constructor(targetPath: string){
        super(`Nothing is indexed at "${targetPath}".`);
        this.name = "PathNotFoundError";
    }
}

/** Thrown by level() for a file: the Map opens folders, and a file is selected inside its folder's level. */
export class NotAFolderError extends Error {
    constructor(filePath: string){
        const folder = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
        super(`"${filePath}" is a file. Open its folder ("${folder}") and select it there.`);
        this.name = "NotAFolderError";
    }
}

export type MapReadOptions = {
    /** No API key: a summary that doesn't exist yet reads "off", because nothing can write it. */
    summariesOff?: boolean;
};

export type LevelOptions = MapReadOptions & {
    /** Which page of a big folder to draw, from 0; past the last, the last (V1.3.1, owner review). */
    page?: number;
    /** Draw the page holding this path instead (search and the panel's links open the page their target is on). */
    focus?: string;
};

/**
 * The status the UI shows for one summary row, or for none. Text on show keeps its stored status (fresh, stale,
 * skipped, or failed with older text still shown). With no text, it's "off" when summaries can't run; otherwise it's
 * whatever is stored, or "pending" when there's no row yet.
 */
export function reportedStatus(row: { tagline: string | null; status: StoredSummaryStatus } | null | undefined, summariesOff: boolean): SummaryStatus {
    if (row?.tagline) return row.status;
    if (summariesOff) return "off";
    return row?.status ?? "pending";
}

/** The folders from the root down to `folderPath`: "src/vs" → ["", "src", "src/vs"]. */
export function breadcrumbOf(folderPath: string): string[] {
    if (folderPath === "") return [""];
    const segments = folderPath.split("/");
    return ["", ...segments.map((_, i) => segments.slice(0, i + 1).join("/"))];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A folder's children as boxes, in the Map's order (ADR-036): its subfolders and the files directly inside, largest
 * first, so the cap folds the smallest (PIVOT_SPEC.md §7). A file counts as 1. Among equals the more-imported file
 * comes first, then the path decides. describe() lists a folder's children in this same order.
 */
export function loadMapChildren(db: Db, repoId: number, folderPath: string, summariesOff: boolean): MapNode[] {
    const states = new Map(loadChildSummaries(db, repoId, folderPath).map((s) => [`${s.kind}:${s.path}`, s]));
    const importedBy = new Map<string, number>();

    const box = (kind: "folder" | "file", nodePath: string, name: string, fileCount: number): MapNode => {
        const state = states.get(`${kind}:${nodePath}`);
        return {
            path: nodePath,
            name,
            kind,
            fileCount,
            ...(state?.tagline ? { tagline: state.tagline } : {}),
            summaryStatus: reportedStatus(state, summariesOff),
        };
    };

    const boxes = [
        ...loadChildFolders(db, repoId, folderPath).map((f) => box("folder", f.path, f.name, f.fileCount)),
        ...loadChildFiles(db, repoId, folderPath).map((f) => {
            importedBy.set(f.path, f.importedBy);
            return box("file", f.path, f.path.slice(f.path.lastIndexOf("/") + 1), 1);
        }),
    ];

    return boxes.sort((a, b) =>
        b.fileCount - a.fileCount || (importedBy.get(b.path) ?? 0) - (importedBy.get(a.path) ?? 0) || compare(a.path, b.path));
}

/**
 * GET /api/level (API_CONTRACTS.md §11): one folder of the Map and the lines between its boxes. A big folder is drawn a
 * page at a time, its pages grouping boxes that import each other, with portals to the other pages (pages.ts).
 */
export function level(repoRoot: string, folderPath: string, options: LevelOptions = {}): LevelResponse {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);

    // one read transaction: a structure update committing meanwhile can't hand us half of its rows
    return db.transaction(() => {
        if (!loadFolderInfo(db, repoId, folderPath)){
            if (loadFileInfo(db, repoId, folderPath)) throw new NotAFolderError(folderPath);
            throw new PathNotFoundError(folderPath);
        }

        const { nodes, edges, hiddenCount, page, pageCount } = paginateLevel(
            folderPath,
            loadMapChildren(db, repoId, folderPath, options.summariesOff ?? false),
            loadLevelEdgeRows(db, repoId, folderPath),
            { page: options.page, focus: options.focus },
        );
        return {
            repo,
            path: folderPath,
            breadcrumb: breadcrumbOf(folderPath),
            nodes,
            edges,
            hiddenCount,
            page,
            pageCount,
            indexVersion: readIndexVersion(db, repoId),
        };
    });
}
