import path from "path";
import { getDb, type Db } from "../db/client";
import { loadFileInfo, loadFolderInfo } from "../db/store/map";
import { loadImportEdgesFrom, requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { importGraphFor, rangeOf, type ImportGraph, type TargetKind } from "./graph";
import { PathNotFoundError } from "./level";

/** Which way an answer follows imports: to the files that import the target, or to the files it imports. */
export type Direction = "dependents" | "dependencies";

/** One direction of the graph as compressed rows: node i's neighbours are neighbours[offsets[i] .. offsets[i + 1]), in path order. */
export type Adjacency = { offsets: Int32Array; neighbours: Int32Array };

/** The import graph ready for walking (PIVOT_SPEC.md §6.1): both directions, and how many files import each file. */
export type ImportIndex = { paths: string[]; imports: Adjacency; importedBy: Adjacency; inDegree: Int32Array };

/** A file reached from a target, and how many imports away it is. */
export type Reached = { path: string; distance: number };

/** dependents or dependencies of one file or folder (ADR-045): every file reached, ordered, and how many directly. */
export type ReachAnswer = { path: string; kind: "folder" | "file"; direction: Direction; reached: Reached[]; direct: number; indexVersion: number;
    /** Only files inside this folder are counted (ADR-045, amended). */
    within?: string;
};

/** How one place reaches another through imports (ADR-045). */
export type ChainAnswer = {
    from: string;
    fromKind: "folder" | "file";
    to: string;
    toKind: "folder" | "file";
    /** forward: `from` reaches `to`; reverse: only `to` reaches `from`; none: neither does. */
    found: "forward" | "reverse" | "none";
    /** The chain in import order, importer first; empty when none. */
    files: string[];
    /** specifiers[i] is how files[i] imports files[i + 1], as written in its source. */
    specifiers: string[];
};

/** Rows of `to` per `from`, counting first, then filling, then sorting each row so walks are deterministic. */
function adjacency(count: number, from: Int32Array, to: Int32Array): Adjacency {
    const offsets = new Int32Array(count + 1);
    for (let i = 0; i < from.length; i++) offsets[from[i] + 1]++;
    for (let i = 0; i < count; i++) offsets[i + 1] += offsets[i];
    const next = offsets.slice(0, count);
    const neighbours = new Int32Array(from.length);
    for (let i = 0; i < from.length; i++) neighbours[next[from[i]]++] = to[i];
    for (let i = 0; i < count; i++) neighbours.subarray(offsets[i], offsets[i + 1]).sort();
    return { offsets, neighbours };
}

export function buildImportIndex(graph: ImportGraph): ImportIndex {
    const count = graph.paths.length;
    const inDegree = new Int32Array(count);
    for (const target of graph.targets) inDegree[target]++;
    return {
        paths: graph.paths,
        imports: adjacency(count, graph.sources, graph.targets),
        importedBy: adjacency(count, graph.targets, graph.sources),
        inDegree,
    };
}

/** Kept per graph object: a new index version loads a new graph, so it gets a new index (ADR-044's rule for caches). */
const indexes = new WeakMap<ImportGraph, ImportIndex>();

export function importIndexFor(db: Db, repoId: number, version: number): ImportIndex {
    const graph = importGraphFor(db, repoId, version);
    let index = indexes.get(graph);
    if (!index){
        index = buildImportIndex(graph);
        indexes.set(graph, index);
    }
    return index;
}

/**
 * Every file reached from a target by following imports one way, breadth-first (PIVOT_SPEC.md §6.1): nearest first,
 * then the most imported (ADR-010's importance), then by path. The target's own files are the start, never the answer.
 */
export function reachFrom(index: ImportIndex, targetPath: string, kind: TargetKind, direction: Direction): Reached[] {
    const [from, to] = rangeOf(index, targetPath, kind);
    const edges = direction === "dependents" ? index.importedBy : index.imports;
    const distance = new Int32Array(index.paths.length).fill(-1);
    const reached: number[] = [];

    let frontier: number[] = [];
    for (let i = from; i < to; i++){
        distance[i] = 0;
        frontier.push(i);
    }
    for (let d = 1; frontier.length > 0; d++){
        const next: number[] = [];
        for (const node of frontier){
            for (let e = edges.offsets[node]; e < edges.offsets[node + 1]; e++){
                const other = edges.neighbours[e];
                if (distance[other] !== -1) continue;
                distance[other] = d;
                next.push(other);
                reached.push(other);
            }
        }
        frontier = next;
    }

    // positions are in path order, so a - b is "by path"
    return reached
        .sort((a, b) => distance[a] - distance[b] || index.inDegree[b] - index.inDegree[a] || a - b)
        .map((i) => ({ path: index.paths[i], distance: distance[i] }));
}

/**
 * The shortest chain of imports from any file in `from` to any file in `to`, or null (PIVOT_SPEC.md §6.1). Breadth-first
 * from every start at once, neighbours in path order, so equally short chains always resolve to the same one.
 * Callers must refuse overlapping ranges: a start inside `to` is never matched at depth 0 (a file is tested against `to`
 * only when an import reaches it, and starts are already seen), so the answer would be a longer chain or none. importChain
 * refuses them.
 */
export function shortestChain(index: ImportIndex, from: [number, number], to: [number, number]): string[] | null {
    const parent = new Int32Array(index.paths.length).fill(-2);   // -2 unseen, -1 a start
    const queue: number[] = [];
    for (let i = from[0]; i < from[1]; i++){
        parent[i] = -1;
        queue.push(i);
    }
    for (let head = 0; head < queue.length; head++){
        const node = queue[head];
        for (let e = index.imports.offsets[node]; e < index.imports.offsets[node + 1]; e++){
            const next = index.imports.neighbours[e];
            if (parent[next] !== -2) continue;
            parent[next] = node;
            if (next >= to[0] && next < to[1]){
                const chain = [next];
                for (let at = node; at !== -1; at = parent[at]) chain.push(at);
                return chain.reverse().map((i) => index.paths[i]);
            }
            queue.push(next);
        }
    }
    return null;
}

/** What a path is in the index, or null when nothing is indexed there. */
export function kindAt(db: Db, repoId: number, targetPath: string): TargetKind | null {
    if (loadFolderInfo(db, repoId, targetPath)) return targetPath === "" ? "repo" : "folder";
    return loadFileInfo(db, repoId, targetPath) ? "file" : null;
}

export function requireKind(db: Db, repoId: number, targetPath: string): TargetKind {
    const kind = kindAt(db, repoId, targetPath);
    if (kind === null) throw new PathNotFoundError(targetPath);
    return kind;
}

/** What each path is (repo, folder or file), or null where nothing is indexed: show_on_map's check. */
export function targetKinds(repoRoot: string, paths: readonly string[]): (TargetKind | null)[] {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return paths.map((p) => kindAt(db, repoId, p));
}

/** dependents and dependencies (PIVOT_SPEC.md §6.1, ADR-045). The whole repo has no outside, so it's refused. */
export function reach(repoRoot: string, targetPath: string, direction: Direction, options: { within?: string } = {}): ReachAnswer {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    // one read transaction: the version and the graph it names are one consistent picture
    return db.transaction(() => {
        const kind = requireKind(db, repoId, targetPath);
        if (kind === "repo") throw new BadInputError("Pass a folder or a file: the whole repo has nothing outside it.");
        const within = options.within === undefined || options.within === "" ? undefined : options.within;
        if (within !== undefined){
            // the bare PathNotFoundError would read as if the target were missing, so within gets an error of its own
            const withinKind = kindAt(db, repoId, within);
            if (withinKind === null) throw new BadInputError(`within "${within}" isn't a folder in the index.`);
            if (withinKind === "file") throw new BadInputError("within takes a folder.");
            // a folder's dependents and dependencies lie outside it, so nothing inside it can ever match
            if (kind === "folder" && (within === targetPath || within.startsWith(`${targetPath}/`))){
                throw new BadInputError(`within "${within}" is inside ${targetPath}/, and a folder's importers and imports lie outside it: pick a folder elsewhere.`);
            }
        }
        const version = readIndexVersion(db, repoId);
        const all = reachFrom(importIndexFor(db, repoId, version), targetPath, kind, direction);
        const reached = within === undefined ? all : all.filter((r) => r.path.startsWith(`${within}/`));
        return {
            path: targetPath, kind, direction, reached, direct: reached.filter((r) => r.distance === 1).length, indexVersion: version,
            ...(within !== undefined ? { within } : {}),
        };
    });
}

/** path (PIVOT_SPEC.md §6.1, ADR-045): the shortest chain from `from` to `to`, or else from `to` to `from`, or none. */
export function importChain(repoRoot: string, fromPath: string, toPath: string): ChainAnswer {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const fromKind = requireKind(db, repoId, fromPath);
        const toKind = requireKind(db, repoId, toPath);
        if (fromKind === "repo" || toKind === "repo") throw new BadInputError("Pass two folders or files: the whole repo holds everything.");
        const index = importIndexFor(db, repoId, readIndexVersion(db, repoId));
        const a = rangeOf(index, fromPath, fromKind);
        const b = rangeOf(index, toPath, toKind);
        if (a[0] < b[1] && b[0] < a[1]) throw new BadInputError(`"${fromPath}" and "${toPath}" overlap: one holds the other. Pick two places side by side.`);

        const forward = shortestChain(index, a, b);
        const reverse = forward ? null : shortestChain(index, b, a);
        const files = forward ?? reverse ?? [];
        return {
            from: fromPath, fromKind, to: toPath, toKind,
            found: forward ? "forward" : reverse ? "reverse" : "none",
            files,
            specifiers: specifiersAlong(db, repoId, files),
        };
    });
}

/** How each file of a chain imports the next, as written in its source. */
export function specifiersAlong(db: Db, repoId: number, files: readonly string[]): string[] {
    const specifiers: string[] = [];
    for (let i = 0; i + 1 < files.length; i++){
        const edge = loadImportEdgesFrom(db, repoId, [files[i]]).find((e) => e.target === files[i + 1]);
        specifiers.push(edge?.specifier ?? "");
    }
    return specifiers;
}
