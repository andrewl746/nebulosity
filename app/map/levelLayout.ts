import dagre from "@dagrejs/dagre";
import type { MapEdge, MapNode } from "@/lib/contracts";

/** Every box is drawn the same size, so the layout needs no measuring (VISUAL_REFRESH.md §4: larger, roomier boxes). */
export const BOX_WIDTH = 232;
export const BOX_HEIGHT = 64;
const GAP = 40;
/** Room between layers: enough for a line's arrowhead to read before it meets the box below. */
const RANK_GAP = 72;

export type Position = { x: number; y: number };

/** A layer wider than this wraps into rows: 6 boxes span about 1,600 px, a laptop screen at a readable zoom. */
export const MAX_PER_ROW = 6;

/**
 * Dagre's layers, redrawn as centred tiers (VISUAL_REFRESH.md §4: the level fits the viewport). Dagre decides which
 * layer each box is in and their order within it (the order that crosses fewest lines); its x positions are dropped.
 * Left to them, 49 files that all import one barrel make one layer 13,000 px wide, and fitting that to a screen
 * shrinks every box to a sliver. So each layer is centred on x = 0, and one wider than MAX_PER_ROW wraps into rows,
 * balanced so the last isn't left with one box (13 → 5, 5, 3). The tiers stack from y = 0, RANK_GAP apart.
 */
function placeTiers(centres: readonly { path: string; x: number; y: number }[]): Map<string, Position> {
    const layers = new Map<number, { path: string; x: number }[]>();
    for (const { path, x, y } of centres) layers.set(y, [...(layers.get(y) ?? []), { path, x }]);

    const placed = new Map<string, Position>();
    let top = 0;
    for (const y of [...layers.keys()].sort((a, b) => a - b)){
        const layer = layers.get(y)!.sort((a, b) => a.x - b.x || (a.path < b.path ? -1 : 1));
        const rowCount = Math.ceil(layer.length / MAX_PER_ROW);
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

/**
 * Where each box of a level goes (ADR-011, PIVOT_SPEC.md §7): dagre's layers, importers above what they import, from
 * the level's `maxLines` heaviest lines, drawn as centred tiers that wrap past MAX_PER_ROW (placeTiers). A box with no
 * line to any other at this level adds nothing to the layering, so those go in a grid beside the tiers, as tall as
 * them, in the level's order. Beside rather than below: the tiers are usually a tall, narrow chain, and screens are
 * wide, so the level fits at a larger zoom and its names stay readable (VISUAL_REFRESH.md §4; VS Code's root goes from
 * 64% to about 90%). A level with no lines at all is one square-ish grid. Pure and deterministic: the same level always
 * draws the same picture. Positions are top-left corners, as React Flow places nodes.
 */
export function layoutLevel(nodes: readonly MapNode[], edges: readonly MapEdge[], maxLines: number = LAYOUT_MAX_LINES): Map<string, Position> {
    const positions = new Map<string, Position>();
    const lines = edges.filter((e) => e.source !== e.target);
    // a box joined by any line stays in the layers, even when only lighter lines join it
    const linked = new Set(lines.flatMap((e) => [e.source, e.target]));
    const connected = nodes.filter((n) => linked.has(n.path));
    const loose = nodes.filter((n) => !linked.has(n.path));
    // heaviest first; ties by source, then target, so the same level always keeps the same lines
    const shaping = [...lines]
        .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
        .slice(0, maxLines);
    // where the grid starts (the tiers start at y = 0), and how many rows it may use
    let gridLeft = 0;
    let rows = 0;

    if (connected.length > 0){
        const graph = new dagre.graphlib.Graph();
        graph.setGraph({ rankdir: "TB", nodesep: GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
        graph.setDefaultEdgeLabel(() => ({}));
        for (const node of connected) graph.setNode(node.path, { width: BOX_WIDTH, height: BOX_HEIGHT });
        // a heavier line pulls its boxes closer; the square root keeps 20,000 imports from flattening everything else
        for (const edge of shaping) graph.setEdge(edge.source, edge.target, { weight: Math.max(1, Math.round(Math.sqrt(edge.count))) });
        dagre.layout(graph);

        const placed = placeTiers(connected.map((node) => ({ path: node.path, ...(graph.node(node.path) as { x: number; y: number }) })));
        let bottom = 0;
        let right = -Infinity;
        for (const [path, at] of placed){
            positions.set(path, at);
            bottom = Math.max(bottom, at.y + BOX_HEIGHT);
            right = Math.max(right, at.x + BOX_WIDTH);
        }
        gridLeft = right + GAP * 2;
        rows = Math.max(1, Math.floor((bottom + GAP) / (BOX_HEIGHT + GAP)));
    }

    const columns = rows > 0 ? Math.ceil(loose.length / rows) : Math.max(1, Math.ceil(Math.sqrt(loose.length)));
    loose.forEach((node, i) => {
        positions.set(node.path, {
            x: gridLeft + (i % columns) * (BOX_WIDTH + GAP),
            y: Math.floor(i / columns) * (BOX_HEIGHT + GAP),
        });
    });

    return positions;
}
