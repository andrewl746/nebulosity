import type { FolderRow, LevelEdgeRow } from "../db/schema";
import { dirOf } from "./paths";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const depthOf = (folder: string): number => (folder === "" ? 0 : folder.split("/").length);

/** Every folder that contains a source file (plus all its ancestors), with file counts. */
export function buildFolders(filePaths: readonly string[], rootName: string): FolderRow[] {
    const rows = new Map<string, FolderRow>();

    const ensure = (folder: string): FolderRow => {
        let row = rows.get(folder);

        if (!row){
            row = {
                path: folder,
                parentPath: folder === "" ? null : dirOf(folder),
                depth: depthOf(folder),
                name: folder === "" ? rootName : folder.slice(folder.lastIndexOf("/") + 1),
                fileCount: 0,
                directFileCount: 0,
            };
            rows.set(folder, row);

            if (folder !== "") ensure(dirOf(folder));
        }

        return row;
    };

    ensure("");

    for (const file of filePaths){
        const dir = dirOf(file);
        ensure(dir).directFileCount++;

        // every folder from the file's own up to the root counts it once
        for (let folder: string | null = dir; folder !== null; folder = folder === "" ? null : dirOf(folder)){
            ensure(folder).fileCount++;
        }
    }

    return [...rows.values()].sort((a, b) => compare(a.path, b.path));
}

/** The deepest folder containing both folders, compared segment by segment ("src" is not inside "src2"). */
export function lcaFolder(a: string, b: string): string {
    if (a === "" || b === "") return "";

    const as = a.split("/");
    const bs = b.split("/");
    let shared = 0;

    while (shared < as.length && shared < bs.length && as[shared] === bs[shared]) shared++;

    return as.slice(0, shared).join("/");
}

/** How filePath appears when viewing folder `level`: the file itself if it's directly inside, else the child folder that contains it. */
export function childToward(level: string, filePath: string): string {
    const dir = dirOf(filePath);
    if (dir === level) return filePath;
    return dir.split("/").slice(0, depthOf(level) + 1).join("/");
}

/** Where one import is counted on the Map (PIVOT_SPEC.md §4.2): the level, and the two boxes it joins there. */
function placeImport(source: string, target: string): Omit<LevelEdgeRow, "count"> {
    const levelPath = lcaFolder(dirOf(source), dirOf(target));
    return { levelPath, sourceNode: childToward(levelPath, source), targetNode: childToward(levelPath, target) };
}

const byRow = (a: LevelEdgeRow, b: LevelEdgeRow): number =>
    compare(a.levelPath, b.levelPath) || compare(a.sourceNode, b.sourceNode) || compare(a.targetNode, b.targetNode);

/**
 * The Map's lines (PIVOT_SPEC.md §4.2). Each import is counted exactly once, at the
 * level where it crosses between siblings, so opening any folder needs one indexed
 * lookup and no computation. VS Code's 20,648 workbench → base imports become one row.
 */
export function buildLevelEdges(edges: readonly { source: string; target: string }[]): LevelEdgeRow[] {
    const rows = new Map<string, LevelEdgeRow>();

    for (const { source, target } of edges){
        const place = placeImport(source, target);
        const key = `${place.levelPath}\0${place.sourceNode}\0${place.targetNode}`;
        const row = rows.get(key);
        if (row) row.count++;
        else rows.set(key, { ...place, count: 1 });
    }

    return [...rows.values()].sort(byRow);
}

/**
 * How the level edges change when imports come and go (ADR-037): −1 for each removed import and +1 for each added one,
 * on the row each is counted on, netted out. Where an import is counted depends only on its two paths, so these deltas
 * applied to the stored rows give exactly what buildLevelEdges would build from the new set of imports.
 */
export function levelEdgeDeltas(removed: readonly { source: string; target: string }[], added: readonly { source: string; target: string }[]): LevelEdgeRow[] {
    const rows = new Map<string, LevelEdgeRow>();
    const shift = (source: string, target: string, by: number): void => {
        const place = placeImport(source, target);
        const key = `${place.levelPath}\0${place.sourceNode}\0${place.targetNode}`;
        const row = rows.get(key);
        if (row) row.count += by;
        else rows.set(key, { ...place, count: by });
    };

    for (const e of removed) shift(e.source, e.target, -1);
    for (const e of added) shift(e.source, e.target, 1);
    return [...rows.values()].filter((r) => r.count !== 0).sort(byRow);
}
