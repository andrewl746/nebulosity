/**
 * The eval's truths over a scanned graph (R3 of Eval #1, R2 of Eval #2): who imports a file or a folder, what depends on a
 * file, the shortest chain, and the grep-hard kinds of Eval #2 (impact, cycles, files nothing imports, violations, the
 * roots that load a file, folder pairs). Each is a few lines over the edges; nothing here reads the index.
 */
export type Graph = { files: readonly string[]; edges: readonly (readonly [string, string])[] };

const sorted = (paths: Iterable<string>): string[] => [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** Whether a path is the folder (or file) itself or sits below it; "" is the whole repo. */
const inside = (p: string, folder: string): boolean => folder === "" || p === folder || p.startsWith(`${folder}/`);

/** Each file's importees (or, reversed, its importers), sorted by path and each once, so every walk is the same every time. */
export function adjacency(g: Graph, reverse: boolean): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const [a, b] of g.edges){
        const [from, to] = reverse ? [b, a] : [a, b];
        const list = map.get(from);
        if (list) list.push(to);
        else map.set(from, [to]);
    }
    for (const [key, list] of map) map.set(key, sorted(list));
    return map;
}

/**
 * The eval's own test rule: a file under a folder named test, tests or __tests__, or with .test. or .spec. in its name.
 * A fixture folder is no test folder: a fixture is code that tests read, and the question asks about it like any other.
 */
export function isTestFile(p: string): boolean {
    const parts = p.split("/");
    const name = parts.pop() ?? "";
    return parts.some((s) => s === "test" || s === "tests" || s === "__tests__") || /\.(?:test|spec)\./.test(name);
}

export const hasEdge = (g: Graph, a: string, b: string): boolean => g.edges.some(([x, y]) => x === a && y === b);
export const directImporters = (g: Graph, target: string): string[] => sorted(g.edges.filter(([, b]) => b === target).map(([a]) => a));
export const outsideImporters = (g: Graph, folder: string): string[] =>
    sorted(g.edges.filter(([a, b]) => inside(b, folder) && !inside(a, folder)).map(([a]) => a));

export function transitiveDependents(g: Graph, target: string): string[] {
    const into = adjacency(g, true);
    const seen = new Set([target]);
    const queue = [target];
    while (queue.length > 0) for (const next of into.get(queue.shift()!) ?? []) if (!seen.has(next)){ seen.add(next); queue.push(next); }
    seen.delete(target);
    return sorted(seen);
}

/** Breadth-first from `from`, neighbours in path order, so the same chain comes back every time; `to` may be a folder. */
export function shortestChain(g: Graph, from: string, to: string): string[] | null {
    const out = adjacency(g, false);
    const previous = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length > 0){
        const at = queue.shift()!;
        if (at !== from && inside(at, to)){
            const chain: string[] = [];
            for (let p: string | null = at; p !== null; p = previous.get(p)!) chain.push(p);
            return chain.reverse();
        }
        for (const next of out.get(at) ?? []) if (!previous.has(next)){ previous.set(next, at); queue.push(next); }
    }
    return null;
}

/** Impact: everything that depends on `target`, counted inside each folder (a file counts in each folder holding it), elsewhere and in all. */
export function impactByFolders(g: Graph, target: string, folders: readonly string[]): { counts: number[]; elsewhere: number; total: number } {
    const dependents = transitiveDependents(g, target);
    return {
        counts: folders.map((folder) => dependents.filter((d) => inside(d, folder)).length),
        elsewhere: dependents.filter((d) => !folders.some((folder) => inside(d, folder))).length,
        total: dependents.length,
    };
}

/**
 * The shortest import cycle through `file`, as its files from `file` back to `file`, or null. Breadth-first from the file's
 * importees, neighbours in path order; the file itself is never marked seen, so the first walk that comes back to it is the
 * shortest, and a tie goes to the path-ordered one.
 */
export function shortestCycle(g: Graph, file: string): string[] | null {
    const out = adjacency(g, false);
    const previous = new Map<string, string>();
    const queue = [file];
    while (queue.length > 0){
        const at = queue.shift()!;
        for (const next of out.get(at) ?? []){
            if (next === file){
                const middle: string[] = [];
                for (let p = at; p !== file; p = previous.get(p)!) middle.push(p);
                return [file, ...middle.reverse(), file];
            }
            if (!previous.has(next)){ previous.set(next, at); queue.push(next); }
        }
    }
    return null;
}

/** The files no other file imports (a file importing only itself counts as imported by nothing). */
const importedByOthers = (g: Graph): Set<string> => new Set(g.edges.filter(([a, b]) => a !== b).map(([, b]) => b));

/** Unused: the files inside `folder` ("" for the repo) that no other file imports, leaving out the ones `isTest` calls tests. */
export function filesNothingImports(g: Graph, folder: string, isTest: (p: string) => boolean): string[] {
    const imported = importedByOthers(g);
    return sorted(g.files.filter((f) => inside(f, folder) && !imported.has(f) && !isTest(f)));
}

/** Violations: the files inside `folder` that directly import a file inside `target` (a folder or a file). */
export const importersWithin = (g: Graph, target: string, folder: string): string[] =>
    sorted(g.edges.filter(([a, b]) => inside(a, folder) && inside(b, target)).map(([a]) => a));

/** Entries: the files that depend on `target` and that no other file imports, leaving out the ones `isTest` calls tests. */
export function rootsReaching(g: Graph, target: string, isTest: (p: string) => boolean): string[] {
    const imported = importedByOthers(g);
    return transitiveDependents(g, target).filter((f) => !imported.has(f) && !isTest(f));
}

/** The child folder of `folder` a path sits in, or null for a path outside it or a file directly inside it. */
export function childOf(folder: string): (p: string) => string | null {
    return (p) => {
        if (p === folder || !inside(p, folder)) return null;
        const rest = folder === "" ? p : p.slice(folder.length + 1);
        const slash = rest.indexOf("/");
        return slash < 0 ? null : rest.slice(0, slash);
    };
}

/** The deepest of `names` among the folders on a path below `folder`, or null. */
export function nameOf(folder: string, names: readonly string[]): (p: string) => string | null {
    return (p) => {
        if (p === folder || !inside(p, folder)) return null;
        const folders = (folder === "" ? p : p.slice(folder.length + 1)).split("/").slice(0, -1);
        for (let i = folders.length - 1; i >= 0; i--) if (names.includes(folders[i])) return folders[i];
        return null;
    };
}

/** Each [from, to] group pair some import goes along, sorted; `same` keeps the pairs of a group with itself. */
function pairsBy(g: Graph, group: (p: string) => string | null, same: boolean): [string, string][] {
    const keys = new Set<string>();
    for (const [a, b] of g.edges){
        const [ga, gb] = [group(a), group(b)];
        if (ga !== null && gb !== null && (same || ga !== gb)) keys.add(`${ga}\0${gb}`);
    }
    return sorted(keys).map((k) => k.split("\0") as [string, string]);
}

/** Pairs: which of the folder's children import which (a child's own imports aren't a pair). */
export const childPairs = (g: Graph, folder: string): [string, string][] => pairsBy(g, childOf(folder), false);

/** Pairs: which of the recurring folder names below `folder` import which, each file under the deepest name on its path. */
export const namePairs = (g: Graph, folder: string, names: readonly string[]): [string, string][] => pairsBy(g, nameOf(folder, names), true);
