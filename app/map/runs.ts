import type { CanvasRect } from "./narrow";
import type { Point } from "./routes";

/**
 * Which lines the pointer is on (the owner, 2026-10-29). Lines that share an end merge (routes.ts), so on a shared run
 * the pointer catches whichever line is drawn on top, and one line's sentence there said nothing of the others. The
 * lines a run is shared by are found from the routes themselves: every drawn line running the same way through the
 * point the pointer is nearest. Pure, so each rule is tested alone.
 */

/**
 * How far apart two routes may run and still be one run. Merged lines share their lanes and tracks exactly, and lines
 * that share no end keep at least a lane's gap apart (routes.ts), so this only absorbs rounding.
 */
const SAME_RUN = 0.75;

/** The point of segment `a`→`b` nearest `p`. */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) return a;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    return { x: a.x + t * dx, y: a.y + t * dy };
}

const distance = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);

/** Whether two segments run the same way (or back the other way): a route's runs are level or upright, so near enough. */
function sameWay(a: Point, b: Point, c: Point, d: Point): boolean {
    const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: d.x - c.x, y: d.y - c.y };
    const lengths = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    return lengths > 0 && Math.abs(u.x * v.y - u.y * v.x) / lengths < 0.01;
}

/**
 * The point of `route` nearest `at`, and the segment it's on: segment i runs from route[i] to route[i + 1]. The first
 * nearest wins a tie, so a corner belongs to the segment that reaches it. Null for a route of fewer than two points.
 */
export function nearestOnRoute(route: readonly Point[], at: Point): { point: Point; segment: number } | null {
    let best: { point: Point; segment: number; away: number } | null = null;
    for (let i = 0; i + 1 < route.length; i++){
        const point = nearestOnSegment(at, route[i], route[i + 1]);
        const away = distance(at, point);
        if (best === null || away < best.away) best = { point, segment: i, away };
    }
    return best && { point: best.point, segment: best.segment };
}

/**
 * The drawn lines that share the run of line `id` at `at` (the Map's own coordinates): the point of its route nearest
 * `at`, and every drawn line with a segment running the same way through that point, `id` among them, sorted, so the
 * same run always reads the same. A line that only crosses there runs the other way, so it isn't on the run. Null when
 * `id` has no route.
 */
export function linesSharing(
    id: string,
    at: Point,
    routes: ReadonlyMap<string, readonly Point[]>,
    drawn: ReadonlySet<string>,
): { lines: string[]; point: Point; segment: number } | null {
    const route = routes.get(id);
    if (route === undefined) return null;
    const near = nearestOnRoute(route, at);
    if (near === null) return null;
    const a = route[near.segment], b = route[near.segment + 1];
    const lines = [...routes].filter(([other, points]) => other === id || (drawn.has(other) && points.some((c, i) => {
        const d = points[i + 1];
        return d !== undefined && sameWay(a, b, c, d) && distance(near.point, nearestOnSegment(near.point, c, d)) <= SAME_RUN;
    }))).map(([other]) => other).sort();
    return { lines, point: near.point, segment: near.segment };
}

/** How near the pointer a bit of its line has to be for the hover card to keep off it, in screen px. */
const POINTED = 40;
/** How much wider than the line is drawn the card keeps off it, each side. */
const LINE_ROOM = 3;

/**
 * The bit of a line the pointer is on, as rectangles on screen (canvas px), which the hover card keeps off: each
 * segment of the line's route that comes within POINTED px of the pointer, as wide as the line is drawn with LINE_ROOM
 * more each side, and its arrowhead (`head`, from weights.ts's arrowHead, its tip RoutedEdge's 3 px over the box) when
 * that comes as near. `view` is the canvas's pan and zoom, so the route, in the Map's own coordinates, is on screen at
 * point × zoom + (x, y).
 */
export function pointedBits(
    route: readonly Point[],
    pointer: Point,
    view: { x: number; y: number; zoom: number },
    width: number,
    head: { half: number; length: number },
): CanvasRect[] {
    const screen = (p: Point): Point => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y });
    const half = (width * view.zoom) / 2 + LINE_ROOM;
    const bits: CanvasRect[] = [];
    for (let i = 0; i + 1 < route.length; i++){
        const a = screen(route[i]), b = screen(route[i + 1]);
        if (distance(pointer, nearestOnSegment(pointer, a, b)) > POINTED) continue;
        bits.push({ left: Math.min(a.x, b.x) - half, top: Math.min(a.y, b.y) - half, width: Math.abs(b.x - a.x) + 2 * half, height: Math.abs(b.y - a.y) + 2 * half });
    }
    const end = route.at(-1);
    if (end !== undefined){
        const tip = screen({ x: end.x, y: end.y - 3 });
        const across = head.half * view.zoom + LINE_ROOM, along = head.length * view.zoom;
        const rect = { left: tip.x - across, top: tip.y - along, width: 2 * across, height: along };
        if (distance(pointer, { x: Math.max(rect.left, Math.min(pointer.x, rect.left + rect.width)), y: Math.max(rect.top, Math.min(pointer.y, tip.y)) }) <= POINTED) bits.push(rect);
    }
    return bits;
}
