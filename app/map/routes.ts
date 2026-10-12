import type { MapEdge } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, GAP, RANK_GAP, type Position } from "./levelLayout";

export type Point = { x: number; y: number };

/** How far a lane keeps from the boxes beside it: half the gap between boxes, so it runs down the middle of a gutter. */
const LANE_CLEARANCE = GAP / 2;
/** Where a line runs past the first or last row: as far out as half the gap between layers. */
const OUTER_CHANNEL = RANK_GAP / 2;
/** Corners of a route are rounded this much (VISUAL_REFRESH.md §7's 8 px radius). */
const CORNER_RADIUS = 8;

/**
 * The lane a vertical run takes past some boxes: the x nearest `preferred` that is at least LANE_CLEARANCE from every
 * one of them. The candidates are `preferred` itself and each box's two clearance lines; a tie goes to the lower x,
 * so the same level always routes the same way.
 */
function freeLane(boxLefts: readonly number[], preferred: number): number {
    const blocked = boxLefts.map((left) => [left - LANE_CLEARANCE, left + BOX_WIDTH + LANE_CLEARANCE] as const);
    const free = (x: number): boolean => blocked.every(([lo, hi]) => x <= lo || x >= hi);
    const candidates = [preferred, ...blocked.flat()].filter(free);
    return candidates.reduce((best, x) => {
        const d = Math.abs(x - preferred);
        const bestD = Math.abs(best - preferred);
        return d < bestD || (d === bestD && x < best) ? x : best;
    });
}

/** Drops repeated points, and middle points on a straight run, so a route has only its real corners. */
function simplify(points: readonly Point[]): Point[] {
    const distinct = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    return distinct.filter((p, i) => {
        if (i === 0 || i === distinct.length - 1) return true;
        const [a, b] = [distinct[i - 1], distinct[i + 1]];
        return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
    });
}

/**
 * Every line's route on a laid-out level, by edge key ("source->target"). The owner's review of the first refresh
 * build found lines cutting through boxes: React Flow draws a curve straight from one box to the other, whatever lies
 * between. These routes can't: a line leaves its box's bottom, runs along the empty channel under that row, goes down
 * (or up) a lane clear of every box in the rows it passes, runs along the channel above its target, and drops into the
 * target's top. Rows are the boxes' tops; only boxes with lines count, since the loose ones sit apart in their grid.
 * Pure and deterministic, like the layout it follows.
 */
export function routeEdges(positions: ReadonlyMap<string, Position>, edges: readonly MapEdge[]): Map<string, Point[]> {
    const linked = [...new Set(edges.flatMap((e) => [e.source, e.target]))].filter((p) => positions.has(p));
    const tops = [...new Set(linked.map((p) => positions.get(p)!.y))].sort((a, b) => a - b);
    const lefts = new Map(tops.map((y) => [y, linked.filter((p) => positions.get(p)!.y === y).map((p) => positions.get(p)!.x)]));
    // the channel under row i runs halfway down the gap to the next row; the last row's runs half a rank gap below it
    const below = (i: number): number => (i + 1 < tops.length ? (tops[i] + BOX_HEIGHT + tops[i + 1]) / 2 : tops[i] + BOX_HEIGHT + OUTER_CHANNEL);
    const above = (i: number): number => (i > 0 ? below(i - 1) : tops[0] - OUTER_CHANNEL);

    const routes = new Map<string, Point[]>();
    for (const edge of edges){
        const s = positions.get(edge.source);
        const t = positions.get(edge.target);
        if (!s || !t) continue;
        const start = { x: s.x + BOX_WIDTH / 2, y: s.y + BOX_HEIGHT };
        const end = { x: t.x + BOX_WIDTH / 2, y: t.y };
        const out = below(tops.indexOf(s.y));
        const into = above(tops.indexOf(t.y));
        // the rows the lane passes: every row whose boxes lie between the two channels
        const [from, to] = [Math.min(out, into), Math.max(out, into)];
        const passed = tops.filter((y) => y > from && y < to).flatMap((y) => lefts.get(y)!);
        const lane = freeLane(passed, (start.x + end.x) / 2);
        routes.set(`${edge.source}->${edge.target}`, simplify([
            start, { x: start.x, y: out }, { x: lane, y: out }, { x: lane, y: into }, { x: end.x, y: into }, end,
        ]));
    }
    return routes;
}

/** `from` moved `distance` toward `to`. */
function toward(from: Point, to: Point, distance: number): Point {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: from.x + ((to.x - from.x) * distance) / length, y: from.y + ((to.y - from.y) * distance) / length };
}

/** An SVG path along a route, each corner rounded by CORNER_RADIUS, or by half its shorter side when that's less. */
export function roundedPath(points: readonly Point[], radius: number = CORNER_RADIUS): string {
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++){
        const [prev, corner, next] = [points[i - 1], points[i], points[i + 1]];
        const r = Math.min(radius, Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2, Math.hypot(next.x - corner.x, next.y - corner.y) / 2);
        const a = toward(corner, prev, r);
        const b = toward(corner, next, r);
        d += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
    }
    const last = points[points.length - 1];
    return `${d} L ${last.x} ${last.y}`;
}

/** The point halfway along a route, where its label goes. */
export function midpointAlong(points: readonly Point[]): Point {
    const sides = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let left = sides.reduce((sum, length) => sum + length, 0) / 2;
    for (let i = 0; i < sides.length; i++){
        if (left <= sides[i]) return toward(points[i], points[i + 1], left);
        left -= sides[i];
    }
    return points[points.length - 1];
}
