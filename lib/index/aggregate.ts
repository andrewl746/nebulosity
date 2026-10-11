import { dirOf } from "./paths";

export type FolderRow = {
    path: string;
    parentPath: string | null;
    depth: number;
    name: string;
    fileCount: number;
    directFileCount: number;
};

export type LevelEdgeRow = { levelPath: string; sourceNode: string; targetNode: string; count: number };

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

/**
 * The Map's lines (PIVOT_SPEC.md §4.2). Each import is counted exactly once, at the
 * level where it crosses between siblings, so opening any folder needs one indexed
 * lookup and no computation. VS Code's 20,648 workbench → base imports become one row.
 */
export function buildLevelEdges(edges: readonly { source: string; target: string }[]): LevelEdgeRow[] {
    const rows = new Map<string, LevelEdgeRow>();

    for (const { source, target } of edges){
        const levelPath = lcaFolder(dirOf(source), dirOf(target));
        const sourceNode = childToward(levelPath, source);
        const targetNode = childToward(levelPath, target);
        const key = `${levelPath}\0${sourceNode}\0${targetNode}`;

        const row = rows.get(key);
        if (row) row.count++;
        else rows.set(key, { levelPath, sourceNode, targetNode, count: 1 });
    }

    return [...rows.values()].sort((a, b) =>
        compare(a.levelPath, b.levelPath) || compare(a.sourceNode, b.sourceNode) || compare(a.targetNode, b.targetNode));
}
