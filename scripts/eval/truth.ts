/** The eval's truths over a scanned graph (R3): who imports a file or a folder, what depends on a file, the shortest chain. */
export type Graph = { files: readonly string[]; edges: readonly (readonly [string, string])[] };

const sorted = (paths: Iterable<string>): string[] => [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const inside = (p: string, folder: string): boolean => p === folder || p.startsWith(`${folder}/`);

function adjacency(g: Graph, reverse: boolean): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const [a, b] of g.edges){
        const [from, to] = reverse ? [b, a] : [a, b];
        map.set(from, [...(map.get(from) ?? []), to]);
    }
    for (const [key, list] of map) map.set(key, sorted(list));
    return map;
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
