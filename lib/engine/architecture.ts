/**
 * How code under a folder is organized, computed from its imports (ADR-055), with no model: its parts in layers by the
 * direction most imports go, the imports against that order, the folder names that recur and what each one's files
 * import (VS Code's common/browser/node), the import cycles, and the files nothing imports. A rule a team wrote down
 * shows here as it's kept or broken; the docs pointers (ADR-054) point at where it's written.
 */
import path from "path";
import { getDb } from "../db/client";
import { loadEntryPoints } from "../db/store/entries";
import { loadChildFiles, loadChildFolders, loadLevelEdgeRows } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { isTestPath } from "../index/discover";
import { dirOf, repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { rangeOf } from "./graph";
import { importIndexFor, requireKind, specifiersAlong, type ImportIndex } from "./reach";

export type Part = { path: string; kind: "folder" | "file" };
export type Layers = {
    /** levels[0] uses nothing else here; each part of level n uses parts below it. Unlinked parts are left out. */
    levels: Part[][];
    against: { from: Part; to: Part; count: number; examples: [string, string][] }[];
    tangled: { a: Part; b: Part; count: number }[];
    /** Parts whose dominant directions go round in a loop: they share one level. */
    circles: Part[][];
    unlinked: Part[];
};
export type Conventions = {
    /** The fewest folders a name recurs in to be listed: relative to the place (see recurringThreshold). */
    minFolders: number;
    names: { name: string; folders: number }[];
    /** examples only for pairs of 3 imports or fewer */
    pairs: { from: string; to: string; count: number; examples: [string, string][] }[];
};
export type Unused = { declared: string[]; others: string[]; tests: number };
export type CycleGroup = { size: number; files: string[] };
export type ArchitectureReport = "summary" | "layers" | "conventions" | "cycles" | "unused";
export type ArchitectureAnswer = {
    path: string;
    kind: "repo" | "folder" | "file";
    report: ArchitectureReport;
    layers?: Layers;
    conventions?: Conventions;
    cycles?: CycleGroup[];
    through?: { file: string; cycle: string[] | null; specifiers: string[] };
    unused?: Unused;
};

/** A folder name recurs when this many folders under the place have it. */
export const MIN_RECURRING = 3;
/** A pair of folder names with this many imports or fewer shows its imports. */
export const RARE_PAIR = 3;
/** A folder name recurs when it is in this many folders: 3, or 1% of the folders under the place when that's more (a huge repo has hundreds of names that merely appear 3 times). */
export const recurringThreshold = (foldersUnder: number): number => Math.max(MIN_RECURRING, Math.ceil(foldersUnder / 100));
/** Imports shown for each pair against the layers. */
const EXAMPLES = 3;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tarjan's strongly connected components over rows in compressed form (offsets, neighbours), iterative so a deep graph
 * can't overflow the stack (Review Focus 4). Component ids come out in completion order, which is reverse topological:
 * a component's id is above every component it reaches.
 */
function tarjan(n: number, offsets: Int32Array, neighbours: Int32Array): { group: Int32Array; sizes: number[] } {
    const order = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const group = new Int32Array(n).fill(-1);
    const onStack = new Uint8Array(n);
    const stack: number[] = [];
    const sizes: number[] = [];
    const frames: number[] = [];   // pairs: node, next edge
    let counter = 0;
    for (let start = 0; start < n; start++){
        if (order[start] !== -1) continue;
        order[start] = low[start] = counter++;
        stack.push(start);
        onStack[start] = 1;
        frames.push(start, offsets[start]);
        while (frames.length > 0){
            const top = frames.length - 2;
            const v = frames[top];
            const e = frames[top + 1];
            if (e < offsets[v + 1]){
                frames[top + 1] = e + 1;
                const w = neighbours[e];
                if (order[w] === -1){
                    order[w] = low[w] = counter++;
                    stack.push(w);
                    onStack[w] = 1;
                    frames.push(w, offsets[w]);
                } else if (onStack[w]) low[v] = Math.min(low[v], order[w]);
                continue;
            }
            frames.length -= 2;
            if (frames.length > 0){
                const u = frames[frames.length - 2];
                low[u] = Math.min(low[u], low[v]);
            }
            if (low[v] === order[v]){
                const id = sizes.length;
                let size = 0;
                let w: number;
                do{
                    w = stack.pop()!;
                    onStack[w] = 0;
                    group[w] = id;
                    size++;
                } while (w !== v);
                sizes.push(size);
            }
        }
    }
    return { group, sizes };
}

/** Kept per import index, so a new index version gets new groups (ADR-044's rule for caches). */
const groupsCache = new WeakMap<ImportIndex, { group: Int32Array; sizes: number[] }>();

export function stronglyConnected(index: ImportIndex): { group: Int32Array; sizes: number[] } {
    let found = groupsCache.get(index);
    if (!found){
        found = tarjan(index.paths.length, index.imports.offsets, index.imports.neighbours);
        groupsCache.set(index, found);
    }
    return found;
}

/** The shortest import cycle from a file back to itself, inside its group (breadth-first, neighbours in path order), or null. */
export function shortestCycleThrough(index: ImportIndex, node: number, group: Int32Array): number[] | null {
    const home = group[node];
    const parent = new Map<number, number>();
    const queue: number[] = [node];
    const { offsets, neighbours } = index.imports;
    for (let head = 0; head < queue.length; head++){
        const v = queue[head];
        for (let e = offsets[v]; e < offsets[v + 1]; e++){
            const w = neighbours[e];
            if (w === node){
                const back: number[] = [];
                for (let at = v; at !== node; at = parent.get(at)!) back.push(at);
                return [node, ...back.reverse(), node];
            }
            if (group[w] !== home || parent.has(w)) continue;
            parent.set(w, v);
            queue.push(w);
        }
    }
    return null;
}

/** Compressed rows from adjacency lists, each list sorted. */
function rowsOf(lists: number[][]): { offsets: Int32Array; neighbours: Int32Array } {
    const offsets = new Int32Array(lists.length + 1);
    lists.forEach((l, i) => { offsets[i + 1] = offsets[i] + l.length; });
    const neighbours = new Int32Array(offsets[lists.length]);
    lists.forEach((l, i) => neighbours.set([...l].sort((a, b) => a - b), offsets[i]));
    return { offsets, neighbours };
}

/**
 * A folder's parts in layers (ADR-055). Between two parts, the direction with more imports is dominant (the importer
 * uses the other); the fewer imports the other way are against the order; an even count is tangled. Levels count up from
 * the parts that use nothing else here; parts whose dominant directions loop share a level and are listed as a circle.
 */
export function layersOf(parts: readonly Part[], rows: readonly { source: string; target: string; count: number }[], examples: (from: Part, to: Part) => [string, string][]): Layers {
    const sorted = [...parts].sort((a, b) => compare(a.path, b.path));
    const n = sorted.length;
    const at = new Map(sorted.map((p, i) => [p.path, i]));
    const count = new Map<number, number>();
    for (const r of rows){
        const i = at.get(r.source);
        const j = at.get(r.target);
        if (i === undefined || j === undefined || i === j) continue;
        count.set(i * n + j, (count.get(i * n + j) ?? 0) + r.count);
    }
    const pairs = [...new Set([...count.keys()].map((key) => {
        const i = Math.floor(key / n);
        const j = key % n;
        return Math.min(i, j) * n + Math.max(i, j);
    }))].sort((a, b) => a - b);

    const uses: number[][] = Array.from({ length: n }, () => []);
    const linked = new Uint8Array(n);
    const against: Layers["against"] = [];
    const tangled: Layers["tangled"] = [];
    for (const key of pairs){
        const i = Math.floor(key / n);
        const j = key % n;
        const ij = count.get(i * n + j) ?? 0;
        const ji = count.get(j * n + i) ?? 0;
        linked[i] = linked[j] = 1;
        if (ij > ji){
            uses[i].push(j);
            if (ji > 0) against.push({ from: sorted[j], to: sorted[i], count: ji, examples: examples(sorted[j], sorted[i]) });
        } else if (ji > ij){
            uses[j].push(i);
            if (ij > 0) against.push({ from: sorted[i], to: sorted[j], count: ij, examples: examples(sorted[i], sorted[j]) });
        } else tangled.push({ a: sorted[i], b: sorted[j], count: ij });
    }

    const { offsets, neighbours } = rowsOf(uses);
    const { group, sizes } = tarjan(n, offsets, neighbours);
    // ids come in reverse topological order, so a component's uses are already levelled when it's reached
    const level = new Int32Array(sizes.length);
    const byGroup: number[][] = sizes.map(() => []);
    for (let i = 0; i < n; i++) byGroup[group[i]].push(i);
    for (let g = 0; g < sizes.length; g++){
        let top = -1;
        for (const i of byGroup[g]) for (const j of uses[i]) if (group[j] !== g) top = Math.max(top, level[group[j]]);
        level[g] = top + 1;
    }

    const levels: Part[][] = [];
    for (let i = 0; i < n; i++) if (linked[i]) (levels[level[group[i]]] ??= []).push(sorted[i]);
    against.sort((a, b) => b.count - a.count || compare(a.from.path, b.from.path) || compare(a.to.path, b.to.path));
    return {
        levels,
        against,
        tangled,
        circles: byGroup.filter((members) => members.length > 1).map((members) => members.map((i) => sorted[i])),
        unlinked: sorted.filter((_, i) => !linked[i]),
    };
}

/** Every folder that holds an indexed file, from the import index's paths (the same set as the folders table). */
function foldersOf(paths: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const p of paths) for (let d = dirOf(p); d !== "" && !out.has(d); d = dirOf(d)) out.add(d);
    return out;
}

/**
 * Folder names that recur in `minFolders` or more folders strictly under the place (default: recurringThreshold), and what each one's files import:
 * a file belongs to the deepest recurring name on its path below the place, and an import counts when both ends have one.
 */
export function conventionsOf(index: ImportIndex, folderPath: string, minFolders?: number): Conventions {
    const prefix = folderPath === "" ? "" : `${folderPath}/`;
    const counts = new Map<string, number>();
    let foldersUnder = 0;
    for (const f of foldersOf(index.paths)){
        if (!f.startsWith(prefix)) continue;
        foldersUnder++;
        const name = f.slice(f.lastIndexOf("/") + 1);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const threshold = minFolders ?? recurringThreshold(foldersUnder);
    const names = [...counts].filter(([, n]) => n >= threshold).map(([name, folders]) => ({ name, folders })).sort((a, b) => compare(a.name, b.name));
    const recurring = new Set(names.map((n) => n.name));
    const [from, to] = rangeOf(index, folderPath, folderPath === "" ? "repo" : "folder");
    const envOf = (i: number): string | null => {
        const segments = dirOf(index.paths[i]).slice(prefix.length).split("/");
        for (let s = segments.length - 1; s >= 0; s--) if (recurring.has(segments[s])) return segments[s];
        return null;
    };
    const pairs = new Map<string, { from: string; to: string; count: number; examples: [string, string][] }>();
    for (let i = from; i < to; i++){
        const a = envOf(i);
        if (a === null) continue;
        for (let e = index.imports.offsets[i]; e < index.imports.offsets[i + 1]; e++){
            const j = index.imports.neighbours[e];
            if (j < from || j >= to) continue;
            const b = envOf(j);
            if (b === null) continue;
            const entry = pairs.get(`${a}\0${b}`) ?? { from: a, to: b, count: 0, examples: [] };
            entry.count++;
            if (entry.examples.length < RARE_PAIR) entry.examples.push([index.paths[i], index.paths[j]]);
            pairs.set(`${a}\0${b}`, entry);
        }
    }
    return {
        minFolders: threshold,
        names,
        pairs: [...pairs.values()]
            .map((p) => (p.count <= RARE_PAIR ? p : { ...p, examples: [] }))
            .sort((x, y) => compare(x.from, y.from) || compare(x.to, y.to)),
    };
}

/** The files under the place that nothing imports: tests counted apart, the rest split by whether a package.json names them. */
export function unusedIn(index: ImportIndex, range: [number, number], declared: ReadonlySet<string>): Unused {
    const out: Unused = { declared: [], others: [], tests: 0 };
    for (let i = range[0]; i < range[1]; i++){
        if (index.inDegree[i] !== 0) continue;
        const p = index.paths[i];
        if (isTestPath(p)) out.tests++;
        else if (declared.has(p)) out.declared.push(p);
        else out.others.push(p);
    }
    return out;
}

/** The strongly connected groups of two or more files with a file under the place, largest first, each in path order. */
function groupsTouching(index: ImportIndex, range: [number, number]): CycleGroup[] {
    const { group, sizes } = stronglyConnected(index);
    const touched = new Set<number>();
    for (let i = range[0]; i < range[1]; i++) if (sizes[group[i]] > 1) touched.add(group[i]);
    const members = new Map<number, string[]>();
    for (let i = 0; i < index.paths.length; i++){
        if (!touched.has(group[i])) continue;
        const list = members.get(group[i]) ?? [];
        list.push(index.paths[i]);
        members.set(group[i], list);
    }
    return [...members.values()].map((files) => ({ size: files.length, files })).sort((a, b) => b.size - a.size || compare(a.files[0], b.files[0]));
}

/** The first EXAMPLES imports from files under one part to files under another, in path order. */
function importsBetween(index: ImportIndex, from: Part, to: Part): [string, string][] {
    const a = rangeOf(index, from.path, from.kind);
    const b = rangeOf(index, to.path, to.kind);
    const out: [string, string][] = [];
    for (let i = a[0]; i < a[1] && out.length < EXAMPLES; i++){
        for (let e = index.imports.offsets[i]; e < index.imports.offsets[i + 1] && out.length < EXAMPLES; e++){
            const j = index.imports.neighbours[e];
            if (j >= b[0] && j < b[1]) out.push([index.paths[i], index.paths[j]]);
        }
    }
    return out;
}

/** architecture (ADR-055): one report, or the summary of all four, for a folder; cycles for a file too. */
export function architecture(repoRoot: string, targetPath: string, report: ArchitectureReport, options: { through?: string } = {}): ArchitectureAnswer {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const kind = requireKind(db, repoId, targetPath);
        if (kind === "file" && report !== "cycles") throw new BadInputError('architecture reads a folder ("" for the repo); for one file, ask for report "cycles".');
        // through answers one file's cycle, in place of the groups: with the summary it would have left "Import cycles: none"
        if (options.through !== undefined && report !== "cycles"){
            throw new BadInputError('through goes with report "cycles": ask again with report "cycles" for the shortest import cycle through that file.');
        }
        const through = kind === "file" ? targetPath : options.through;
        if (through !== undefined && requireKind(db, repoId, through) !== "file") throw new BadInputError("through takes a file.");

        const index = importIndexFor(db, repoId, readIndexVersion(db, repoId));
        const range = rangeOf(index, targetPath, kind);
        const answer: ArchitectureAnswer = { path: targetPath, kind, report };
        const all = report === "summary";

        if (all || report === "layers"){
            const parts: Part[] = [
                ...loadChildFolders(db, repoId, targetPath).map((f) => ({ path: f.path, kind: "folder" as const })),
                ...loadChildFiles(db, repoId, targetPath).map((f) => ({ path: f.path, kind: "file" as const })),
            ];
            answer.layers = layersOf(parts, loadLevelEdgeRows(db, repoId, targetPath), (from, to) => importsBetween(index, from, to));
        }
        if (all || report === "conventions") answer.conventions = conventionsOf(index, targetPath);
        if (all || report === "cycles"){
            if (through !== undefined){
                const node = rangeOf(index, through, "file")[0];
                const cycle = shortestCycleThrough(index, node, stronglyConnected(index).group)?.map((i) => index.paths[i]) ?? null;
                answer.through = { file: through, cycle, specifiers: cycle ? specifiersAlong(db, repoId, cycle) : [] };
            } else answer.cycles = groupsTouching(index, range);
        }
        if (all || report === "unused") answer.unused = unusedIn(index, range, loadEntryPoints(db, repoId));
        return answer;
    });
}
