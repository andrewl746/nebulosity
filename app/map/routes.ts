import type { MapEdge } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, RANK_GAP, type Position } from "./levelLayout";
import { arrowHead, lineWidth, maxImportsOf } from "./weights";

export type Point = { x: number; y: number };

/*
 * The Map's line routing (VISUAL_REFRESH.md §4; the Workbench redesign, ADR-070). A line leaves its box's bottom, runs
 * along the empty channel under that row, goes down (or up) a lane in a gutter clear of every box in the rows it
 * passes, runs along the channel above its target, and drops into the target's top. So no line ever crosses a box,
 * which the owner flags on sight.
 *
 * Since the redesign no two lines share a run or an end (the owner, 2026-10-27): every line gets its own port on each
 * box, its own height (a track) in each channel it runs along, and its own place in each gutter it goes down, so every
 * line stays separate and can be lit on its own. The spacing allows for each line's width (weights.ts) and for the
 * arrowhead it ends in. Pure and deterministic, like the layout it follows: the same level always routes the same way.
 */

/** How far a lane keeps from the boxes beside it, past half its own width. */
const LANE_CLEARANCE = 8;
/** Where the first lane outside every box runs: this far from the outermost box's edge, as before the redesign. */
const OUTER_LANE = 20;
/** The room between two lanes, and between two runs on neighbouring tracks, past half of each one's width. */
const LANE_GAP = 6;
const TRACK_GAP = 6;
/** The room between two lines leaving a box's bottom, past half of each one's width. */
const PORT_GAP_OUT = 10;
/** The room between two arrowheads arriving at a box's top, past each one's half-width. */
const PORT_GAP_IN = 8;
/** The room between two runs on one track, end to end, past half of each one's width. */
const RUN_GAP = 4;
/** How far a box's outermost ports keep from its sides. */
const PORT_MARGIN = 20;
/** A track keeps this far below the row above it, so the line's corner has room. */
const TOP_ROOM = 12;
/** How far above the box's top edge an arrowhead's tip stops (RoutedEdge's TIP_GAP), and the corner above it. */
const TIP_GAP = 3;
const CORNER_ROOM = 8;
/** Where a line runs past the first or last row: as far out as half the gap between layers. */
const OUTER_CHANNEL = RANK_GAP / 2;
/** Corners of a route are rounded this much (VISUAL_REFRESH.md §7's 8 px radius). */
const CORNER_RADIUS = 8;
/** A line whose two ports are this close drops straight down: one port moves over when there's room for it. */
const STRAIGHTEN = 16;

/** One line, with what routing it needs: its width, its rows, and the channels it leaves and enters by. */
type Line = {
    key: string;
    edge: MapEdge;
    width: number;
    head: { half: number; length: number };
    s: Position;
    t: Position;
    /** The channel under the source's row, and the one above the target's: channel k runs between rows k - 1 and k. */
    outChannel: number;
    intoChannel: number;
    /** Set when the line passes a row between its channels (or points back up): the x of its vertical run. */
    lane?: number;
    portOut?: number;
    portIn?: number;
};

/** One horizontal run of a line along a channel, with the two ends where it turns up or down. */
type Run = {
    line: Line;
    channel: number;
    /** It ends by dropping into its target's top, in its arrowhead. */
    arrives: boolean;
    ends: [{ x: number; dir: "up" | "down" }, { x: number; dir: "up" | "down" }];
    track?: number;
    y?: number;
};

const centreOf = (box: Position): number => box.x + BOX_WIDTH / 2;
const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const spanOf = (run: Run): [number, number] => [Math.min(run.ends[0].x, run.ends[1].x), Math.max(run.ends[0].x, run.ends[1].x)];

/**
 * The x a lane takes in the rows `rows` (each a list of its boxes' left edges): the free place nearest `preferred` that
 * keeps LANE_CLEARANCE from every box and LANE_GAP from every lane already there over the same height. Between two
 * boxes a lane starts at the gutter's middle; outside them all, OUTER_LANE out from the outermost box, and further out
 * for each lane already there. A tie goes to the lower x, so the same level always routes the same way.
 */
function placeLane(
    rows: readonly (readonly number[])[],
    preferred: number,
    width: number,
    span: [number, number],
    taken: readonly { x: number; width: number; span: [number, number] }[],
): number {
    const lefts = rows.flat();
    if (lefts.length === 0) return preferred;
    // the x ranges a lane can't enter, merged and sorted: every box in the rows passed, widened by the clearance
    const reach = width / 2 + LANE_CLEARANCE;
    const blocked = lefts.map((left) => [left - reach, left + BOX_WIDTH + reach] as [number, number]).sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [lo, hi] of blocked){
        const last = merged[merged.length - 1];
        if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
        else merged.push([lo, hi]);
    }
    // the lanes already placed that pass a row this one passes: each keeps its own place
    const near = taken.filter((lane) => lane.span[0] < span[1] && span[0] < lane.span[1]);
    const clear = (x: number): boolean => near.every((lane) => Math.abs(lane.x - x) >= (lane.width + width) / 2 + LANE_GAP);
    const step = (other: number): number => (other + width) / 2 + LANE_GAP;
    // the gutters: between each pair of blocked ranges, and outside them all
    type Gutter = { lo: number; hi: number; start: number };
    const gutters: Gutter[] = [];
    const outerLeft = merged[0][0] + reach - OUTER_LANE;
    gutters.push({ lo: -Infinity, hi: merged[0][0], start: outerLeft });
    for (let i = 0; i + 1 < merged.length; i++){
        const [lo, hi] = [merged[i][1], merged[i + 1][0]];
        if (hi >= lo) gutters.push({ lo, hi, start: (lo + hi) / 2 });
    }
    const outerRight = merged[merged.length - 1][1] - reach + OUTER_LANE;
    gutters.push({ lo: merged[merged.length - 1][1], hi: Infinity, start: outerRight });

    // each gutter's best free place: its start, else as near it as the lanes there allow (outward, outside the boxes)
    const candidates: number[] = [];
    for (const g of gutters){
        const tries = [g.start, ...near.flatMap((lane) => [lane.x - step(lane.width), lane.x + step(lane.width)])]
            .filter((x) => x >= g.lo && x <= g.hi && clear(x))
            .filter((x) => (g.lo === -Infinity ? x <= g.start : g.hi === Infinity ? x >= g.start : true));
        if (tries.length > 0) candidates.push(tries.reduce((best, x) => (Math.abs(x - g.start) < Math.abs(best - g.start) ? x : best)));
    }
    // a gutter as wide as a lane but full: the lane still goes through, at its start, rather than across a box
    if (candidates.length === 0) return gutters.reduce((best, g) => (Math.abs(g.start - preferred) < Math.abs(best - preferred) ? g.start : best), gutters[0].start);
    return candidates.reduce((best, x) => {
        const [d, bestD] = [Math.abs(x - preferred), Math.abs(best - preferred)];
        return d < bestD || (d === bestD && x < best) ? x : best;
    });
}

/** Whether a lane at `x` keeps LANE_CLEARANCE from every box in `rows` and LANE_GAP from every lane in `taken` over its height. */
function laneFits(
    rows: readonly (readonly number[])[],
    x: number,
    width: number,
    span: [number, number],
    taken: readonly { x: number; width: number; span: [number, number] }[],
): boolean {
    const reach = width / 2 + LANE_CLEARANCE;
    const clearOfBoxes = rows.flat().every((left) => x <= left - reach || x >= left + BOX_WIDTH + reach);
    const clearOfLanes = taken.every((lane) => !(lane.span[0] < span[1] && span[0] < lane.span[1]) || Math.abs(lane.x - x) >= (lane.width + width) / 2 + LANE_GAP);
    return clearOfBoxes && clearOfLanes;
}

/**
 * Ports along one edge of a box, for lines that leave (or arrive) in the order of where they're going (or coming from),
 * so lines from one box don't cross each other on the way out. `gap(a, b)` is the room two neighbours need. The group is
 * centred on the box, and squeezed to stay PORT_MARGIN inside its sides when there are too many to fit.
 */
function placePorts(box: Position, lines: readonly Line[], approach: (line: Line) => number, gap: (a: Line, b: Line) => number): Map<string, number> {
    const ordered = [...lines].sort((a, b) => approach(a) - approach(b) || byKey(a, b));
    const offsets = [0];
    for (let i = 1; i < ordered.length; i++) offsets.push(offsets[i - 1] + gap(ordered[i - 1], ordered[i]));
    const total = offsets[offsets.length - 1] ?? 0;
    const room = BOX_WIDTH - 2 * PORT_MARGIN;
    const squeeze = total > room ? room / total : 1;
    const left = centreOf(box) - (total * squeeze) / 2;
    return new Map(ordered.map((line, i) => [line.key, left + offsets[i] * squeeze]));
}

/**
 * The order runs take down a channel, top to bottom, so their turns cross as few other runs as they can. A run that
 * turns up at an x another run passes over should be above it, and one that turns down there below it (a channel
 * router's vertical constraints); a run that turns up just where another turns down must be above it, or their drops
 * would share a run, which is worse than any crossing. So the musts are kept first, and where the shoulds ask for a
 * loop, the run with the fewest runs that should be above it goes next, the thinner first, so a heavy line sinks to the
 * bottom, nearest its target.
 */
function trackOrder(runs: readonly Run[]): Run[] {
    // above.get(j) holds every run that should be above j, and mustAbove.get(j) every run that must be
    const above = new Map<Run, Set<Run>>(runs.map((r) => [r, new Set<Run>()]));
    const mustAbove = new Map<Run, Set<Run>>(runs.map((r) => [r, new Set<Run>()]));
    for (const i of runs){
        for (const j of runs){
            if (i === j) continue;
            if (sharesDrop(i, j)) mustAbove.get(j)!.add(i);
            else if (mustBeAbove(i, j)) above.get(j)!.add(i);
        }
    }
    const order: Run[] = [];
    const left = new Set(runs);
    while (left.size > 0){
        const waiting = (r: Run): number => [...above.get(r)!].filter((a) => left.has(a)).length;
        const free = [...left].filter((r) => [...mustAbove.get(r)!].every((a) => !left.has(a)));
        const next = (free.length > 0 ? free : [...left]).sort((a, b) => waiting(a) - waiting(b) || a.line.width - b.line.width || byKey(a.line, b.line))[0];
        order.push(next);
        left.delete(next);
    }
    return order;
}

/**
 * Every drawn line's route on a laid-out level, by edge key ("source->target"). Rows are the boxes' tops, and every box
 * with a line on the level stands in the way of a lane, drawn or not; the loose ones sit apart in their grid. `drawn`
 * names the lines to route (all of them when it's left out): ports and tracks are shared out among those alone, so a
 * line that isn't drawn leaves no gap. Widths are scaled against the level's heaviest line, drawn or not.
 */
export function routeEdges(positions: ReadonlyMap<string, Position>, edges: readonly MapEdge[], drawn?: ReadonlySet<string>): Map<string, Point[]> {
    const maxImports = maxImportsOf(edges);
    const onLevel = edges.filter((e) => e.source !== e.target && positions.has(e.source) && positions.has(e.target));
    const routable = drawn === undefined ? onLevel : onLevel.filter((e) => drawn.has(`${e.source}->${e.target}`));
    const linked = [...new Set(onLevel.flatMap((e) => [e.source, e.target]))];
    const tops = [...new Set(linked.map((p) => positions.get(p)!.y))].sort((a, b) => a - b);
    const lefts = tops.map((y) => linked.filter((p) => positions.get(p)!.y === y).map((p) => positions.get(p)!.x));
    const row = (box: Position): number => tops.indexOf(box.y);

    const lines: Line[] = routable.map((edge) => {
        const s = positions.get(edge.source)!;
        const t = positions.get(edge.target)!;
        const width = lineWidth(edge.count, maxImports);
        return { key: `${edge.source}->${edge.target}`, edge, width, head: arrowHead(width), s, t, outChannel: row(s) + 1, intoChannel: row(t) };
    });

    // 1. lanes, for the lines that pass a row between their channels or point back up: the free place nearest the
    // middle of their two boxes, the lines nearest their lanes placed first
    const placed: { x: number; width: number; span: [number, number] }[] = [];
    const lanesOf = new Map<Line, { rows: (readonly number[])[]; entry: { x: number; width: number; span: [number, number] } }>();
    const laned = lines.filter((l) => l.outChannel !== l.intoChannel)
        .sort((a, b) => (centreOf(a.s) + centreOf(a.t)) - (centreOf(b.s) + centreOf(b.t)) || byKey(a, b));
    for (const line of laned){
        const [from, to] = [Math.min(line.outChannel, line.intoChannel), Math.max(line.outChannel, line.intoChannel)];
        const passed = lefts.slice(from, to);
        // its height as the channels it runs between: two lanes overlap when they share a row they pass
        const span: [number, number] = [from, to];
        line.lane = placeLane(passed, (centreOf(line.s) + centreOf(line.t)) / 2, line.width, span, placed);
        const entry = { x: line.lane, width: line.width, span };
        placed.push(entry);
        lanesOf.set(line, { rows: passed, entry });
    }

    // 2. ports: each box's leaving lines along its bottom and arriving lines along its top, ordered by where the other
    // end turns (the lane, else the other box), with room for each line and, at the top, each arrowhead
    const boxes = new Map<string, { out: Line[]; into: Line[] }>();
    for (const line of lines){
        if (!boxes.has(line.edge.source)) boxes.set(line.edge.source, { out: [], into: [] });
        if (!boxes.has(line.edge.target)) boxes.set(line.edge.target, { out: [], into: [] });
        boxes.get(line.edge.source)!.out.push(line);
        boxes.get(line.edge.target)!.into.push(line);
    }
    for (const [path, { out, into }] of boxes){
        const box = positions.get(path)!;
        const outPorts = placePorts(box, out, (l) => l.lane ?? centreOf(l.t), (a, b) => (a.width + b.width) / 2 + PORT_GAP_OUT);
        const inPorts = placePorts(box, into, (l) => l.lane ?? centreOf(l.s), (a, b) => a.head.half + b.head.half + PORT_GAP_IN);
        for (const l of out) l.portOut = outPorts.get(l.key);
        for (const l of into) l.portIn = inPorts.get(l.key);
    }

    // a line between neighbouring rows whose ports nearly line up drops straight: its arrival port moves over to its
    // leaving port when that keeps the room between the target's ports and stays inside the box
    for (const line of lines){
        if (line.lane !== undefined || Math.abs(line.portOut! - line.portIn!) >= STRAIGHTEN || line.portOut === line.portIn) continue;
        const others = boxes.get(line.edge.target)!.into.filter((l) => l !== line);
        const x = line.portOut!;
        const inBox = x >= line.t.x + PORT_MARGIN && x <= line.t.x + BOX_WIDTH - PORT_MARGIN;
        // it keeps its place among the box's other ports, so no two arriving lines cross for it
        const [lo, hi] = [Math.min(x, line.portIn!), Math.max(x, line.portIn!)];
        const inOrder = others.every((o) => o.portIn! < lo || o.portIn! > hi);
        if (inBox && inOrder && others.every((o) => Math.abs(o.portIn! - x) >= o.head.half + line.head.half + PORT_GAP_IN)) line.portIn = x;
    }

    // a lane that can run right under its leaving port (or over its arriving one) moves there, so the line drops
    // straight out of its box (or into it) instead of jogging over to the gutter's middle
    for (const line of laned){
        const { rows, entry } = lanesOf.get(line)!;
        const others = placed.filter((p) => p !== entry);
        const straight = [line.portOut!, line.portIn!].find((x) => laneFits(rows, x, line.width, entry.span, others));
        if (straight !== undefined) line.lane = entry.x = straight;
    }

    // 3. runs along each channel, and the tracks they take
    const runs: Run[] = [];
    for (const line of lines){
        const down = line.intoChannel > line.outChannel;
        if (line.lane === undefined){
            runs.push({ line, channel: line.outChannel, arrives: true, ends: [{ x: line.portOut!, dir: "up" }, { x: line.portIn!, dir: "down" }] });
        } else {
            runs.push({ line, channel: line.outChannel, arrives: false, ends: [{ x: line.portOut!, dir: "up" }, { x: line.lane, dir: down ? "down" : "up" }] });
            runs.push({ line, channel: line.intoChannel, arrives: true, ends: [{ x: line.lane, dir: down ? "up" : "down" }, { x: line.portIn!, dir: "down" }] });
        }
    }
    const byChannel = new Map<number, Run[]>();
    for (const run of runs){
        // a run whose two ends line up is a straight drop through the channel: it needs no track
        if (run.ends[0].x === run.ends[1].x) continue;
        byChannel.set(run.channel, [...(byChannel.get(run.channel) ?? []), run]);
    }
    for (const [channel, inChannel] of byChannel){
        // tracks in order, each run on the first track at or below the ones that must be above it that it fits on
        const tracks: Run[][] = [];
        for (const run of trackOrder(inChannel)){
            const [lo, hi] = spanOf(run);
            const fits = (track: Run[]): boolean => track.every((other) => {
                const [olo, ohi] = spanOf(other);
                const room = (other.line.width + run.line.width) / 2 + RUN_GAP;
                return hi + room <= olo || ohi + room <= lo;
            });
            const after = Math.max(-1, ...tracks.flatMap((track, k) => (track.some((r) => mustBeAbove(r, run)) ? [k] : [])));
            let k = after + 1;
            while (k < tracks.length && !fits(tracks[k])) k++;
            if (k === tracks.length) tracks.push([]);
            tracks[k].push(run);
            run.track = k;
        }
        placeTracks(channel, tracks, tops);
    }

    // 4. every line's corners, in order
    const routes = new Map<string, Point[]>();
    const runsOf = new Map<Line, Run[]>();
    for (const run of runs) runsOf.set(run.line, [...(runsOf.get(run.line) ?? []), run]);
    for (const line of lines){
        const [first, second] = runsOf.get(line)!;
        const start = { x: line.portOut!, y: line.s.y + BOX_HEIGHT };
        const end = { x: line.portIn!, y: line.t.y };
        const yOf = (run: Run): number => run.y ?? channelMiddle(run.channel, tops);
        const points = line.lane === undefined
            ? [start, { x: start.x, y: yOf(first) }, { x: end.x, y: yOf(first) }, end]
            : [start, { x: start.x, y: yOf(first) }, { x: line.lane, y: yOf(first) }, { x: line.lane, y: yOf(second) }, { x: end.x, y: yOf(second) }, end];
        routes.set(line.key, simplify(points));
    }
    return routes;
}

/**
 * Whether `a` must run above `b` or their drops share a run: `a` turns up just where `b` turns down (a line leaving the box
 * above at the very x a line arrives at the box below, between two wrapped rows).
 */
function sharesDrop(a: Run, b: Run): boolean {
    const touching = (a.line.width + b.line.width) / 2 + 1;
    return a.ends.some((up) => up.dir === "up" && b.ends.some((down) => down.dir === "down" && Math.abs(up.x - down.x) < touching));
}

/**
 * Whether `a` should run above `b` in their channel (trackOrder's rule): it must when their drops would share a run, and
 * it should when `a` turns up where `b` passes, or `b` turns down where `a` passes, so neither turn crosses the other run.
 */
function mustBeAbove(a: Run, b: Run): boolean {
    const inside = (x: number, run: Run): boolean => {
        const [lo, hi] = spanOf(run);
        return x > lo && x < hi;
    };
    return sharesDrop(a, b)
        || a.ends.some((end) => end.dir === "up" && inside(end.x, b))
        || b.ends.some((end) => end.dir === "down" && inside(end.x, a));
}

/** The middle of channel `k` (between rows k - 1 and k), or half a rank gap past the first or last row. */
function channelMiddle(k: number, tops: readonly number[]): number {
    if (k <= 0) return tops[0] - OUTER_CHANNEL;
    if (k >= tops.length) return tops[tops.length - 1] + BOX_HEIGHT + OUTER_CHANNEL;
    return (tops[k - 1] + BOX_HEIGHT + tops[k]) / 2;
}

/**
 * The height of each track in channel `k`: the tracks as one block, spaced by their lines' widths, centred on the
 * channel's middle, then kept TOP_ROOM under the row above and, for a run that ends in an arrowhead in the row below,
 * far enough above it for the head and a corner. Past the first or last row the block grows outward from the boxes.
 * A block too tall for its channel is squeezed, down to a pixel between lines.
 */
function placeTracks(k: number, tracks: readonly Run[][], tops: readonly number[]): void {
    const widest = tracks.map((track) => Math.max(...track.map((r) => r.line.width)));
    const gaps = widest.slice(1).map((w, i) => (widest[i] + w) / 2 + TRACK_GAP);
    const tightest = widest.slice(1).map((w, i) => (widest[i] + w) / 2 + 1);
    const height = gaps.reduce((sum, g) => sum + g, 0);
    // the lowest a track may run: above the next row by its arrowheads and a corner
    const headRoom = Math.max(0, ...tracks.flat().filter((r) => r.arrives).map((r) => r.line.head.length)) + TIP_GAP + CORNER_ROOM;
    const upper = k > 0 ? tops[k - 1] + BOX_HEIGHT + TOP_ROOM : -Infinity;
    const lower = k < tops.length ? tops[k] - headRoom : Infinity;
    let spacing = gaps;
    if (Number.isFinite(upper) && Number.isFinite(lower) && height > lower - upper){
        const room = Math.max(0, lower - upper);
        const least = tightest.reduce((sum, g) => sum + g, 0);
        const share = height === least ? 0 : Math.max(0, Math.min(1, (room - least) / (height - least)));
        spacing = gaps.map((g, i) => tightest[i] + (g - tightest[i]) * share);
    }
    const total = spacing.reduce((sum, g) => sum + g, 0);
    let top = channelMiddle(k, tops) - total / 2;
    if (k <= 0) top = Math.min(channelMiddle(k, tops), lower) - total;                // above the first row: grows upward
    else if (k >= tops.length) top = Math.max(channelMiddle(k, tops), upper);         // below the last row: grows downward
    else top = Math.max(upper, Math.min(top, lower - total));
    let y = top;
    tracks.forEach((track, i) => {
        if (i > 0) y += spacing[i - 1];
        for (const run of track) run.y = y;
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

/**
 * The middle of a route's longest side, where its count is written: the longest run has the most room beside it, and a
 * label there stays in its channel or gutter. A tie goes to the first.
 */
export function longestSideMiddle(points: readonly Point[]): Point {
    if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
    let best = 0;
    let bestLength = -1;
    for (let i = 0; i < points.length - 1; i++){
        const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
        if (length > bestLength){
            best = i;
            bestLength = length;
        }
    }
    return { x: (points[best].x + points[best + 1].x) / 2, y: (points[best].y + points[best + 1].y) / 2 };
}
