import dagre from "@dagrejs/dagre";
import type { MapEdge, MapNode } from "@/lib/contracts";

/** Every box is drawn the same size, so the layout needs no measuring (VISUAL_REFRESH.md §4: larger, roomier boxes). */
export const BOX_WIDTH = 232;
export const BOX_HEIGHT = 64;
const GAP = 40;
/** Room between layers: enough for a line's arrowhead to read before it meets the box below. */
const RANK_GAP = 72;

export type Position = { x: number; y: number };

/**
 * At most this many lines shape a level's layout: the heaviest. Dagre's crossing reduction grows with the lines, and
 * VS Code's src/vs/platform level has 390 of them: about 0.6 s to lay out, against 30 ms with the heaviest 100. Every
 * line is still drawn; the lighter ones just don't move the boxes (S3, PIVOT_SPEC.md §2).
 */
export const LAYOUT_MAX_LINES = 100;

/**
 * Where each box of a level goes (ADR-011, PIVOT_SPEC.md §7): dagre's layered layout, importers above what they
 * import, from the level's `maxLines` heaviest lines. A box with no line to any other at this level adds nothing to
 * the layering, so those go in a grid beside the rest, as tall as the layers, in the level's order. Beside rather than
 * below: the layers are usually a tall, narrow chain, and screens are wide, so the level fits at a larger zoom and its
 * names stay readable (VISUAL_REFRESH.md §4; VS Code's root goes from 64% to about 90%). A level with no lines at all
 * is one square-ish grid. Pure and deterministic: the same level always draws the same picture. React Flow places a
 * node by its top-left corner and dagre by its centre, hence the half-box shift.
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
    // where the grid starts, and how many rows it may use
    let gridLeft = 0;
    let gridTop = 0;
    let rows = 0;

    if (connected.length > 0){
        const graph = new dagre.graphlib.Graph();
        graph.setGraph({ rankdir: "TB", nodesep: GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
        graph.setDefaultEdgeLabel(() => ({}));
        for (const node of connected) graph.setNode(node.path, { width: BOX_WIDTH, height: BOX_HEIGHT });
        // a heavier line pulls its boxes closer; the square root keeps 20,000 imports from flattening everything else
        for (const edge of shaping) graph.setEdge(edge.source, edge.target, { weight: Math.max(1, Math.round(Math.sqrt(edge.count))) });
        dagre.layout(graph);

        let top = Infinity;
        let bottom = -Infinity;
        let right = -Infinity;
        for (const node of connected){
            const centre = graph.node(node.path) as { x: number; y: number };
            const at = { x: centre.x - BOX_WIDTH / 2, y: centre.y - BOX_HEIGHT / 2 };
            positions.set(node.path, at);
            top = Math.min(top, at.y);
            bottom = Math.max(bottom, at.y + BOX_HEIGHT);
            right = Math.max(right, at.x + BOX_WIDTH);
        }
        gridLeft = right + GAP * 2;
        gridTop = top;
        rows = Math.max(1, Math.floor((bottom - top + GAP) / (BOX_HEIGHT + GAP)));
    }

    const columns = rows > 0 ? Math.ceil(loose.length / rows) : Math.max(1, Math.ceil(Math.sqrt(loose.length)));
    loose.forEach((node, i) => {
        positions.set(node.path, {
            x: gridLeft + (i % columns) * (BOX_WIDTH + GAP),
            y: gridTop + Math.floor(i / columns) * (BOX_HEIGHT + GAP),
        });
    });

    return positions;
}
