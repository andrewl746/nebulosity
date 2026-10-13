import dagre from "@dagrejs/dagre";
import type { MapEdge, MapNode } from "@/lib/contracts";

/**
 * Every box is drawn the same size, so the layout needs no measuring (VISUAL_REFRESH.md §4). 56 tall, not V1.3.1's
 * first 64, and layers 64 apart, not 72: measured on VS Code's busiest levels, the tighter layout fits them 10–30%
 * larger (src/vs/platform's names from 8.8 to 11.6 px on a 1907 px screen), while GAP stays 40 so the routed lines
 * keep their channels.
 */
export const BOX_WIDTH = 232;
export const BOX_HEIGHT = 56;
export const GAP = 40;
/** Room between layers: enough for a line's arrowhead to read before it meets the box below. */
export const RANK_GAP = 64;

export type Position = { x: number; y: number };

/** A layer wider than this wraps into rows: 6 boxes span about 1,600 px, a laptop screen at a readable zoom. */
export const MAX_PER_ROW = 6;
/** On a wide canvas a layer wraps at 8 instead (about 2,100 px): fewer rows, so a dense level fits larger. */
export const WIDE_PER_ROW = 8;
/** A canvas at least this wide counts as wide. Below it, 8 a row would make levels fit smaller, not larger (measured). */
export const WIDE_CANVAS = 1700;

/** How many boxes a layer holds per row on a canvas this wide. */
export function perRowFor(canvasWidth: number): number {
    return canvasWidth >= WIDE_CANVAS ? WIDE_PER_ROW : MAX_PER_ROW;
}

/**
 * Dagre's layers, redrawn as centred tiers (VISUAL_REFRESH.md §4: the level fits the viewport). Dagre decides which
 * layer each box is in and their order within it (the order that crosses fewest lines); its x positions are dropped.
 * Left to them, 49 files that all import one barrel make one layer 13,000 px wide, and fitting that to a screen
 * shrinks every box to a sliver. So each layer is centred on x = 0, and one wider than MAX_PER_ROW wraps into rows,
 * balanced so the last isn't left with one box (13 → 5, 5, 3; at 8 a row, 7 and 6). The tiers stack from y = 0,
 * RANK_GAP apart.
 */
function placeTiers(centres: readonly { path: string; x: number; y: number }[], perRowCap: number): Map<string, Position> {
    const layers = new Map<number, { path: string; x: number }[]>();
    for (const { path, x, y } of centres) layers.set(y, [...(layers.get(y) ?? []), { path, x }]);

    const placed = new Map<string, Position>();
    let top = 0;
    for (const y of [...layers.keys()].sort((a, b) => a - b)){
        const layer = layers.get(y)!.sort((a, b) => a.x - b.x || (a.path < b.path ? -1 : 1));
        const rowCount = Math.ceil(layer.length / perRowCap);
        const perRow = Math.ceil(layer.length / rowCount);
        for (let row = 0; row < rowCount; row++){
            const boxes = layer.slice(row * perRow, (row + 1) * perRow);
            const left = -(boxes.length * BOX_WIDTH + (boxes.length - 1) * GAP) / 2;
            boxes.forEach((box, i) => placed.set(box.path, { x: left + i * (BOX_WIDTH + GAP), y: top + row * (BOX_HEIGHT + GAP) }));
        }
        top += rowCount * (BOX_HEIGHT + GAP) - GAP + RANK_GAP;
    }
    return placed;
}

/**
 * At most this many lines shape a level's layout: the heaviest. Dagre's crossing reduction grows with the lines, and
 * VS Code's src/vs/platform level has 390 of them: about 0.6 s to lay out, against 30 ms with the heaviest 100. Every
 * line is still drawn; the lighter ones just don't move the boxes (S3, PIVOT_SPEC.md §2).
 */
export const LAYOUT_MAX_LINES = 100;

/** The fit's padding (MapCanvas's FIT): React Flow fits a level at most this much smaller than the canvas, each way. */
export const FIT_PADDING = 0.15;
/**
 * Room for the divider over the loose boxes ("Not linked to anything on this page", owner's design, 2026-10-13): a grid
 * below the tiers starts this far under them, three gaps instead of two, with the line halfway; a column beside them
 * starts this far down, the line in the band above it.
 */
export const BELOW_GAP = 3 * GAP;
export const DIVIDER_BAND = 64;

/** The canvas a level is judged against when choosing where its loose boxes go: a 1440 × 900 screen less the bars. */
const NOMINAL_CANVAS = { width: 1440, height: 780 };

/** The zoom React Flow's fit would pick for a level this big on the nominal canvas: never past 100% (MapCanvas's maxZoom). */
function fitZoom(width: number, height: number): number {
    return Math.min(1, NOMINAL_CANVAS.width / (width * (1 + FIT_PADDING)), NOMINAL_CANVAS.height / (height * (1 + FIT_PADDING)));
}

/** A grid of `count` boxes, `columns` wide, from (left, top), in order: the level's order for its loose boxes. */
function grid(count: number, columns: number, left: number, top: number): Position[] {
    return Array.from({ length: count }, (_, i) => ({
        x: left + (i % columns) * (BOX_WIDTH + GAP),
        y: top + Math.floor(i / columns) * (BOX_HEIGHT + GAP),
    }));
}

/** How wide (or tall) `k` boxes side by side (or stacked) are, with the gaps between them. */
const span = (k: number, size: number): number => k * (size + GAP) - GAP;

/** The paths joined by a line to another box at this level; a line from a box to itself joins nothing. */
function linkedPaths(edges: readonly MapEdge[]): Set<string> {
    return new Set(edges.filter((e) => e.source !== e.target).flatMap((e) => [e.source, e.target]));
}

/**
 * Where each box of a level goes (ADR-011, PIVOT_SPEC.md §7): dagre's layers, importers above what they import, from
 * the level's `maxLines` heaviest lines, drawn as centred tiers that wrap past `perRow` (placeTiers). A box with no
 * line to any other at this level adds nothing to the layering, so those go in a grid, in the level's order, on the
 * side that lets the whole level fit larger (VISUAL_REFRESH.md §4: readable, fitting the viewport):
 * - beside the tiers, as tall as them: right for a tall chain on a wide screen (VS Code's root: 91% against 68%);
 * - or below them, square-ish and centred: right for a short stack with many loose boxes (2 tiers and 20 loose: 95%
 *   against 42%). A tie stays beside.
 * Either way they leave room for the divider that says they're not linked (looseDivider, below).
 * A level with no lines at all is one square-ish grid. Pure and deterministic: the same level always draws the same
 * picture. Positions are top-left corners, as React Flow places nodes.
 */
export function layoutLevel(
    nodes: readonly MapNode[],
    edges: readonly MapEdge[],
    maxLines: number = LAYOUT_MAX_LINES,
    perRow: number = MAX_PER_ROW,
): Map<string, Position> {
    const positions = new Map<string, Position>();
    const lines = edges.filter((e) => e.source !== e.target);
    // a box joined by any line stays in the layers, even when only lighter lines join it
    const linked = linkedPaths(edges);
    const connected = nodes.filter((n) => linked.has(n.path));
    const loose = nodes.filter((n) => !linked.has(n.path));
    // heaviest first; ties by source, then target, so the same level always keeps the same lines
    const shaping = [...lines]
        .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
        .slice(0, maxLines);
    const squareColumns = Math.max(1, Math.ceil(Math.sqrt(loose.length)));

    if (connected.length === 0){
        grid(loose.length, squareColumns, 0, 0).forEach((at, i) => positions.set(loose[i].path, at));
        return positions;
    }

    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "TB", nodesep: GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of connected) graph.setNode(node.path, { width: BOX_WIDTH, height: BOX_HEIGHT });
    // a heavier line pulls its boxes closer; the square root keeps 20,000 imports from flattening everything else
    for (const edge of shaping) graph.setEdge(edge.source, edge.target, { weight: Math.max(1, Math.round(Math.sqrt(edge.count))) });
    dagre.layout(graph);

    // the tiers are centred on x = 0 and start at y = 0
    let bottom = 0;
    let right = 0;
    for (const [path, at] of placeTiers(connected.map((node) => ({ path: node.path, ...(graph.node(node.path) as { x: number; y: number }) })), perRow)){
        positions.set(path, at);
        bottom = Math.max(bottom, at.y + BOX_HEIGHT);
        right = Math.max(right, at.x + BOX_WIDTH);
    }
    if (loose.length === 0) return positions;

    // beside: as many rows as the tiers are tall, starting two gaps right of them and a band down, under the divider
    const besideRows = Math.max(1, Math.floor((bottom + GAP) / (BOX_HEIGHT + GAP)));
    const besideColumns = Math.ceil(loose.length / besideRows);
    const besideWidth = right + 2 * GAP + span(besideColumns, BOX_WIDTH) + right;   // the tiers span -right … right
    const besideHeight = Math.max(bottom, DIVIDER_BAND + span(Math.ceil(loose.length / besideColumns), BOX_HEIGHT));
    // below: square-ish, centred, starting BELOW_GAP under the tiers, the divider halfway
    const belowColumns = Math.min(squareColumns, loose.length);
    const belowWidth = Math.max(2 * right, span(belowColumns, BOX_WIDTH));
    const belowHeight = bottom + BELOW_GAP + span(Math.ceil(loose.length / belowColumns), BOX_HEIGHT);

    const cells = fitZoom(belowWidth, belowHeight) > fitZoom(besideWidth, besideHeight)
        ? grid(loose.length, belowColumns, -span(belowColumns, BOX_WIDTH) / 2, bottom + BELOW_GAP)
        : grid(loose.length, besideColumns, right + 2 * GAP, DIVIDER_BAND);
    cells.forEach((at, i) => positions.set(loose[i].path, at));
    return positions;
}

/** Where the divider over a level's loose boxes runs: its left end, its centre line, its length. */
export type Divider = { x: number; y: number; width: number };

/**
 * The line with "Not linked to anything on this page" in its middle, between the boxes joined by lines and the loose
 * ones (owner's design, 2026-10-13: without it the loose grid read as randomly placed cards). Below the tiers it runs
 * the whole level's width, halfway down BELOW_GAP; over a column beside them it's as wide as the column, centred in
 * DIVIDER_BAND. No divider when every box is linked or none is: there's nothing to set apart.
 */
export function looseDivider(nodes: readonly MapNode[], edges: readonly MapEdge[], positions: ReadonlyMap<string, Position>): Divider | null {
    const linked = linkedPaths(edges);
    const boundsOf = (paths: readonly string[]) => {
        const at = paths.map((p) => positions.get(p)).filter((q): q is Position => q !== undefined);
        return {
            left: Math.min(...at.map((q) => q.x)),
            right: Math.max(...at.map((q) => q.x + BOX_WIDTH)),
            top: Math.min(...at.map((q) => q.y)),
            bottom: Math.max(...at.map((q) => q.y + BOX_HEIGHT)),
        };
    };
    const joined = nodes.filter((n) => linked.has(n.path)).map((n) => n.path);
    const loose = nodes.filter((n) => !linked.has(n.path)).map((n) => n.path);
    if (joined.length === 0 || loose.length === 0) return null;

    const tiers = boundsOf(joined);
    const grid = boundsOf(loose);
    // beside: the grid starts right of the tiers (layoutLevel puts it two gaps past them); below, it's centred under them
    if (grid.left >= tiers.right) return { x: grid.left, y: grid.top - DIVIDER_BAND / 2, width: grid.right - grid.left };
    const left = Math.min(tiers.left, grid.left);
    return { x: left, y: (tiers.bottom + grid.top) / 2, width: Math.max(tiers.right, grid.right) - left };
}
