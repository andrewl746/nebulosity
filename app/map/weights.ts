import type { MapEdge, MapNode } from "@/lib/contracts";

/**
 * What the Map draws bigger when there's more of it (the Workbench redesign, ADR-070): a folder's dot by how many files
 * it holds, a line's width by how many imports it carries, and its arrowhead with it. Each is a log scale against the
 * largest on the page, so VS Code's src (10,280 files) and a folder of 3 both read. Pure, so the scales are tested alone.
 */

/** A folder's dot, 6 px across for an empty one up to 18 px for the page's largest. */
export const DOT_MIN = 6;
export const DOT_MAX = 18;

export function dotSize(files: number, maxFiles: number): number {
    if (maxFiles <= 0) return DOT_MIN;
    return DOT_MIN + ((DOT_MAX - DOT_MIN) * Math.log10(Math.max(0, files) + 1)) / Math.log10(maxFiles + 1);
}

/** A line, 1 px for a single import up to 10 px for the page's heaviest. */
export const LINE_MIN = 1;
export const LINE_MAX = 10;

export function lineWidth(imports: number, maxImports: number): number {
    if (maxImports <= 1 || imports <= 1) return LINE_MIN;
    return LINE_MIN + ((LINE_MAX - LINE_MIN) * Math.log(imports)) / Math.log(maxImports);
}

/**
 * A filled arrowhead wider than its line by a margin on each side, so it still stands out on the thickest line (the
 * owner, 2026-10-27: the spec's small open chevron disappeared on thick lines). `half` is half its width, `length` how
 * far it reaches back from its tip, both in px.
 */
export function arrowHead(width: number): { half: number; length: number } {
    return { half: Math.max(4.5, 0.9 * width + 3), length: Math.max(7, 1.2 * width + 5) };
}

/** The largest folder on a page, by files: what its dots are scaled against. Doorways stand for other pages, so they don't count. */
export const maxFilesOf = (nodes: readonly MapNode[]): number => Math.max(0, ...nodes.filter((n) => n.kind === "folder").map((n) => n.fileCount));

/** The heaviest line on a page, by imports. */
export const maxImportsOf = (edges: readonly MapEdge[]): number => Math.max(0, ...edges.map((e) => e.count));

/** How many of the page's heaviest lines carry their count, whatever is selected. */
export const LABELLED_LINES = 3;

/**
 * The lines whose count is written on them: the page's three heaviest (ties by source, then target, so the same page
 * always labels the same ones) and every line of the selected box. Keys are "source->target", as React Flow's ids.
 */
export function labelledLines(edges: readonly MapEdge[], selected: string | null): Set<string> {
    const key = (e: MapEdge): string => `${e.source}->${e.target}`;
    const heaviest = [...edges]
        .filter((e) => e.source !== e.target)
        .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
        .slice(0, LABELLED_LINES)
        .map(key);
    const ofSelected = selected === null ? [] : edges.filter((e) => e.source === selected || e.target === selected).map(key);
    return new Set([...heaviest, ...ofSelected]);
}
