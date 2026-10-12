import type { MapEdge } from "@/lib/contracts";

export const EDGE_MIN_WIDTH = 1;
export const EDGE_MAX_WIDTH = 6;

/** A line's thickness ∝ √count (PIVOT_SPEC.md §7), scaled so the level's heaviest line is EDGE_MAX_WIDTH wide. */
export function edgeWidth(count: number, maxCount: number): number {
    if (maxCount <= 0) return EDGE_MIN_WIDTH;
    return Math.max(EDGE_MIN_WIDTH, EDGE_MAX_WIDTH * Math.sqrt(count / maxCount));
}

/**
 * How strongly a line is drawn (PIVOT_SPEC.md §7): the selected box's lines at full strength, the rest ghosted. With
 * nothing selected every line is faint, so the level's shape still shows.
 */
export function edgeOpacity(edge: MapEdge, selected: string | null): number {
    if (selected === null) return 0.3;
    return edge.source === selected || edge.target === selected ? 0.95 : 0.06;
}
