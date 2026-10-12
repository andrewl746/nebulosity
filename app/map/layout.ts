import dagre from "@dagrejs/dagre";
import type { MapEdge, MapNode } from "@/lib/contracts";

/** Every box is drawn the same size, so the layout needs no measuring. */
export const BOX_WIDTH = 224;
export const BOX_HEIGHT = 76;
const GAP = 28;

export type Position = { x: number; y: number };

/**
 * Where each box of a level goes (ADR-011, PIVOT_SPEC.md §7): dagre's layered layout, importers above what they
 * import. A box with no line to any other at this level adds nothing to the layering, so those go in a grid below
 * the rest, in the level's order. Pure and deterministic: the same level always draws the same picture. React Flow
 * places a node by its top-left corner and dagre by its centre, hence the half-box shift.
 */
export function layoutLevel(nodes: readonly MapNode[], edges: readonly MapEdge[]): Map<string, Position> {
    const positions = new Map<string, Position>();
    const lines = edges.filter((e) => e.source !== e.target);
    const linked = new Set(lines.flatMap((e) => [e.source, e.target]));
    const connected = nodes.filter((n) => linked.has(n.path));
    const loose = nodes.filter((n) => !linked.has(n.path));
    let gridTop = 0;

    if (connected.length > 0){
        const graph = new dagre.graphlib.Graph();
        graph.setGraph({ rankdir: "TB", nodesep: GAP, ranksep: 72, marginx: 0, marginy: 0 });
        graph.setDefaultEdgeLabel(() => ({}));
        for (const node of connected) graph.setNode(node.path, { width: BOX_WIDTH, height: BOX_HEIGHT });
        // a heavier line pulls its boxes closer; the square root keeps 20,000 imports from flattening everything else
        for (const edge of lines) graph.setEdge(edge.source, edge.target, { weight: Math.max(1, Math.round(Math.sqrt(edge.count))) });
        dagre.layout(graph);

        for (const node of connected){
            const centre = graph.node(node.path) as { x: number; y: number };
            positions.set(node.path, { x: centre.x - BOX_WIDTH / 2, y: centre.y - BOX_HEIGHT / 2 });
            gridTop = Math.max(gridTop, centre.y + BOX_HEIGHT / 2 + GAP * 2);
        }
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt(loose.length)));
    loose.forEach((node, i) => {
        positions.set(node.path, { x: (i % columns) * (BOX_WIDTH + GAP), y: gridTop + Math.floor(i / columns) * (BOX_HEIGHT + GAP) });
    });

    return positions;
}
