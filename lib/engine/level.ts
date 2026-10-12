import path from "path";
import type { LevelResponse, MapEdge, MapNode, SummaryStatus } from "../contracts";
import { getDb, type Db } from "../db/client";
import type { StoredSummaryStatus } from "../db/schema";
import {
    loadChildFiles, loadChildFolders, loadChildSummaries, loadFileInfo, loadFolderInfo, loadLevelEdgeRows,
} from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";

/** No more than this many boxes are ever on screen, the "+N more" box included (PIVOT_SPEC.md §2, S4). */
export const MAP_BOX_CAP = 50;

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

/** The "+N more" box's path: its level's path plus "/" ("/" at the root). No stored path ends in "/", so it can't collide. */
export function moreNodePath(levelPath: string): string {
    return `${levelPath}/`;
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
 * Folds the overflow (PIVOT_SPEC.md §7). With more than `cap` children, the first cap − 1 stay as boxes and the rest
 * become one "+N more" box, so exactly `cap` boxes are drawn. The children come in the Map's order, largest first.
 */
export function foldNodes(children: readonly MapNode[], levelPath: string, cap: number = MAP_BOX_CAP): { nodes: MapNode[]; hidden: Set<string> } {
    if (children.length <= cap) return { nodes: [...children], hidden: new Set() };

    const shown = children.slice(0, cap - 1);
    const folded = children.slice(cap - 1);
    const more: MapNode = {
        path: moreNodePath(levelPath),
        name: `+${folded.length} more`,
        kind: "more",
        fileCount: folded.reduce((sum, n) => sum + n.fileCount, 0),
        summaryStatus: "skipped",
        hiddenCount: folded.length,
    };
    return { nodes: [...shown, more], hidden: new Set(folded.map((n) => n.path)) };
}

/**
 * The level's lines once the overflow is folded. A folded end now points at "+N more", lines that end up joining the
 * same two boxes are added up, and a line between two folded children (now inside "+N more") is dropped.
 */
export function foldEdges(edges: readonly MapEdge[], hidden: ReadonlySet<string>, morePath: string): MapEdge[] {
    const merged = new Map<string, MapEdge>();

    for (const edge of edges){
        const source = hidden.has(edge.source) ? morePath : edge.source;
        const target = hidden.has(edge.target) ? morePath : edge.target;
        if (source === target) continue;

        const key = `${source}\0${target}`;
        const existing = merged.get(key);
        if (existing) existing.count += edge.count;
        else merged.set(key, { source, target, count: edge.count });
    }

    return [...merged.values()].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));
}

/** GET /api/level (API_CONTRACTS.md §11): one folder of the Map, its boxes folded to the cap, and the lines between them. */
export function level(repoRoot: string, folderPath: string, options: MapReadOptions = {}): LevelResponse {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);

    // one read transaction: a structure update committing meanwhile can't hand us half of its rows
    return db.transaction(() => {
        if (!loadFolderInfo(db, repoId, folderPath)){
            if (loadFileInfo(db, repoId, folderPath)) throw new NotAFolderError(folderPath);
            throw new PathNotFoundError(folderPath);
        }

        const { nodes, hidden } = foldNodes(loadMapChildren(db, repoId, folderPath, options.summariesOff ?? false), folderPath);
        return {
            repo,
            path: folderPath,
            breadcrumb: breadcrumbOf(folderPath),
            nodes,
            edges: foldEdges(loadLevelEdgeRows(db, repoId, folderPath), hidden, moreNodePath(folderPath)),
            hiddenCount: hidden.size,
            indexVersion: readIndexVersion(db, repoId),
        };
    });
}
