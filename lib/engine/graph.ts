import type { AreaCount } from "../contracts";
import type { Db } from "../db/client";
import { loadGraphEdges, loadGraphFiles } from "../db/store/map";
import { childToward, lcaFolder } from "../index/aggregate";
import { dirOf } from "../index/paths";

/**
 * A repo's import graph in memory (PIVOT_SPEC.md §6.1). Every file appears once, sorted by path, and every import is a
 * pair of positions in that list. Sorted paths turn "every file inside this folder" into one contiguous range, so asking
 * about a folder is a scan over integer pairs. VS Code's 139,580 imports take about 1 MB here.
 */
export type ImportGraph = { paths: string[]; sources: Int32Array; targets: Int32Array };

/** What a target is, which decides what counts as inside it. */
export type TargetKind = "repo" | "folder" | "file";

type Areas = { uses: AreaCount[]; usedBy: AreaCount[] };

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildImportGraph(files: readonly { id: number; path: string }[], edges: readonly { source: number; target: number }[]): ImportGraph {
    const sorted = [...files].sort((a, b) => compare(a.path, b.path));
    const position = new Map(sorted.map((f, i) => [f.id, i]));
    const sources = new Int32Array(edges.length);
    const targets = new Int32Array(edges.length);

    edges.forEach((edge, i) => {
        sources[i] = position.get(edge.source)!;
        targets[i] = position.get(edge.target)!;
    });

    return { paths: sorted.map((f) => f.path), sources, targets };
}

/** The first position whose path is ≥ key: binary search over the sorted paths. */
function lowerBound(paths: readonly string[], key: string): number {
    let lo = 0;
    let hi = paths.length;
    while (lo < hi){
        const mid = (lo + hi) >> 1;
        if (paths[mid] < key) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * The positions [from, to) of the files at or under a target: every file for the repo, one file for a file, and a
 * folder's whole subtree for a folder ("src/" ≤ path < "src0", since "0" comes right after "/").
 */
export function rangeOf(graph: Pick<ImportGraph, "paths">, targetPath: string, kind: TargetKind): [number, number] {
    if (kind === "repo") return [0, graph.paths.length];
    if (kind === "file"){
        const at = lowerBound(graph.paths, targetPath);
        return graph.paths[at] === targetPath ? [at, at + 1] : [at, at];
    }
    return [lowerBound(graph.paths, `${targetPath}/`), lowerBound(graph.paths, `${targetPath}0`)];
}

/**
 * "Uses" and "used by" (PIVOT_SPEC.md §4.2): the imports that cross the target's boundary, each counted under the area
 * on the other side. That area is the child of the lowest folder holding both ends, on the way to the other file, or
 * that file itself when it sits directly in that folder. Most first, ties by path.
 */
export function areaCounts(graph: ImportGraph, targetPath: string, kind: TargetKind): Areas {
    const [from, to] = rangeOf(graph, targetPath, kind);
    const home = kind === "file" ? dirOf(targetPath) : targetPath;
    // one lowest-common-folder walk per file on the other side, however many imports it shares with the target
    const areaOf = new Map<number, AreaCount>();
    const area = (other: number): AreaCount => {
        let found = areaOf.get(other);
        if (!found){
            const otherPath = graph.paths[other];
            const groupPath = childToward(lcaFolder(home, dirOf(otherPath)), otherPath);
            found = { path: groupPath, kind: groupPath === otherPath ? "file" : "folder", count: 0 };
            areaOf.set(other, found);
        }
        return found;
    };

    const uses = new Map<string, AreaCount>();
    const usedBy = new Map<string, AreaCount>();
    const tally = (into: Map<string, AreaCount>, other: number): void => {
        const { path, kind: areaKind } = area(other);
        const entry = into.get(path) ?? { path, kind: areaKind, count: 0 };
        entry.count++;
        into.set(path, entry);
    };

    for (let i = 0; i < graph.sources.length; i++){
        const source = graph.sources[i];
        const target = graph.targets[i];
        const sourceInside = source >= from && source < to;
        const targetInside = target >= from && target < to;
        if (sourceInside && !targetInside) tally(uses, target);
        else if (targetInside && !sourceInside) tally(usedBy, source);
    }

    const ranked = (counts: Map<string, AreaCount>): AreaCount[] =>
        [...counts.values()].sort((a, b) => b.count - a.count || compare(a.path, b.path));
    return { uses: ranked(uses), usedBy: ranked(usedBy) };
}

/** Area answers kept per repo, for one index version at a time; a new version empties them. */
type Cached = { version: number; graph: ImportGraph; areas: Map<string, Areas> };
const cache = new Map<number, Cached>();
/** A bound on one version's answers, not an LRU: past it the map starts over. */
const MAX_CACHED_AREAS = 2_000;

/** The repo's graph for one index version: loaded once per version (about 60 ms on VS Code) and shared by every query. */
function entryFor(db: Db, repoId: number, version: number): Cached {
    let entry = cache.get(repoId);
    if (!entry || entry.version !== version){
        entry = { version, graph: buildImportGraph(loadGraphFiles(db, repoId), loadGraphEdges(db, repoId)), areas: new Map() };
        cache.set(repoId, entry);
    }
    return entry;
}

/** The import graph for one index version: describe's area counts, and dependents and paths (reach.ts). */
export function importGraphFor(db: Db, repoId: number, version: number): ImportGraph {
    return entryFor(db, repoId, version).graph;
}

/**
 * Area counts for describe(), from a graph loaded once per repo and index version (PIVOT_SPEC.md §6.1: "cached per
 * index version"). About 60 ms to load on VS Code. Each answer is cached per path until the version moves.
 */
export function cachedAreaCounts(db: Db, repoId: number, version: number, targetPath: string, kind: TargetKind): Areas {
    const entry = entryFor(db, repoId, version);

    const key = `${kind}:${targetPath}`;
    let areas = entry.areas.get(key);
    if (!areas){
        areas = areaCounts(entry.graph, targetPath, kind);
        if (entry.areas.size >= MAX_CACHED_AREAS) entry.areas.clear();
        entry.areas.set(key, areas);
    }
    return areas;
}
