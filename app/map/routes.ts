import type { MapEdge } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, RANK_GAP, type Position } from "./levelLayout";
import { arrowHead, boxHeadWidths, LINE_MAX, lineWidth, maxImportsOf } from "./weights";

export type Point = { x: number; y: number };

/*
 * The Map's line routing (VISUAL_REFRESH.md §4; the Workbench redesign, ADR-070 as amended). A line leaves its box's
 * bottom, runs along the empty channel under that row, goes down (or up) a lane in a gutter clear of every box in the
 * rows it passes, runs along the channel above its target, and drops into the target's top. So no line ever crosses a
 * box, which the owner flags on sight.
 *
 * Lines that share an end merge (the owner, 2026-10-28): a box's leaving lines start from one point under it, and its
 * arriving lines end at one point over it, in one arrowhead sized for the heaviest line into it (weights.ts). The lines
 * into one box share a lane down each gutter and a track along each channel, and the lines out of one box share their
 * first drop and, those going past the next row, a track along the channel under it, so each box's lines read as one
 * trunk that forks where they part. Lines that share no end keep their own lanes and tracks, spaced for each line's
 * width and for the arrowheads they pass over. A drawn line never moves (nextRoutes): a line that appears takes its
 * boxes' points where a drawn line holds them, joins the lane and the tracks its group has on screen where it fits on
 * them, and routes around everything else there. Pure and deterministic, like the layout it follows: the same level
 * always routes the same way. Each line's count goes on a stretch of its route clear of everything else, or not at all
 * (placeCounts).
 */

/**
 * How far a lane keeps from the boxes beside it, past half its own width, and from other lanes and tracks: room enough
 * that lines running side by side read as separate lines rather than one mass (the owner, 2026-10-27, on src/vs).
 */
const LANE_CLEARANCE = 16;
/** Where the first lane outside every box runs: this far from the outermost box's edge. */
const OUTER_LANE = 28;
/** The room between two lanes, and between two runs on neighbouring tracks, past half of each one's width. */
const LANE_GAP = 8;
const TRACK_GAP = 8;
/** The room between two runs on one track, end to end, past half of each one's width. */
const RUN_GAP = 4;
/** How far a box's points keep from its sides when they settle off its middle. */
const PORT_MARGIN = 20;
/** A track keeps this far below the row above it, so the line's corner has room. */
const TOP_ROOM = 12;
/** How far above the box's top edge an arrowhead's tip stops (RoutedEdge's TIP_GAP), and the corner above it. */
const TIP_GAP = 3;
const CORNER_ROOM = 8;
/** What's left of TOP_ROOM and CORNER_ROOM in a channel too crowded for them (placeTracks). */
const CROWDED_ROOM = 3;
/** Where a line runs past the first or last row: as far out as half the gap between layers. */
const OUTER_CHANNEL = RANK_GAP / 2;
/** Corners of a route are rounded this much (VISUAL_REFRESH.md §7's 8 px radius). */
const CORNER_RADIUS = 8;
/**
 * A sideways step shorter than this is a wiggle, not a turn: the line drops straight instead, or turns at least this
 * far (settle). Three corner radii, so a turn has a straight run between its two curves.
 */
const LEAST_JOG = 24;
/**
 * How many moves settle tries on one level before it stops, so a level of hundreds of lines still routes in a frame or
 * two (src/vs/platform's 441 with every line drawn); what it hasn't fixed by then stays.
 */
const SETTLE_TRIES = 4000;
/**
 * What a hidden line between neighbouring rows weighs when a point settles, for the wiggle a move would leave between
 * its two points: a tie-breaker, so any drawn line's fault counts for more, but a point that can settle either way
 * settles where a hover drawing that line finds it straight. Without it, a point on src/vs settled 13 px off its box's
 * middle, and selecting editor drew platform → editor with a 13 px wiggle between two held points.
 */
const HIDDEN_WIGGLE = 0.01;
/**
 * Spacing is compared this loosely: a place exactly one step from a lane is free, though the sums that find it round.
 * Compared exactly, src/vs's gutters both counted as full, and workbench → base fell back onto a lane already there.
 */
const EPSILON = 1e-6;
/**
 * A line into a box joins a lane of the box's down a gutter when its own lane would run within this of it (the spike's
 * cluster rule), so the lines into one box go down it as one rather than side by side.
 */
export const MERGE_REACH = 60;
/**
 * The room a count keeps from another line past its width, each side, and from another count, each side, so it never
 * touches either (placeCounts).
 */
const COUNT_LINE_ROOM = 2;
const COUNT_GAP = 3;
/**
 * Where a count is tried along a stretch of its line, as shares of the room the label leaves on it: the middle first,
 * then further out each way, so a count sits as near the middle of its stretch as it clearly can.
 */
const COUNT_TRIES = [0.5, 0.3, 0.7, 0.15, 0.85, 0, 1];

/** One line, with what routing it needs: its width, its rows, and the channels it leaves and enters by. */
type Line = {
    key: string;
    edge: MapEdge;
    width: number;
    /** Its target's one arrowhead, which every line into that box shares. */
    head: { half: number; length: number };
    s: Position;
    t: Position;
    /** The channel under the source's row, and the one above the target's: channel k runs between rows k - 1 and k. */
    outChannel: number;
    intoChannel: number;
    /** Set when the line passes a row between its channels (or points back up): the x of its vertical run. */
    lane?: number;
    /** The x of its source's leaving point and its target's arriving point, which it shares with every line there. */
    portOut?: number;
    portIn?: number;
};

/** One horizontal run of a line along a channel, with the ends where it turns up or down. */
type Run = {
    line: Line;
    channel: number;
    /** It ends by dropping into its target's top, in its arrowhead. */
    arrives: boolean;
    /** Where it turns, and which way; `port` when that end is one of its boxes' points rather than its lane. */
    ends: End[];
    track?: number;
    y?: number;
    /** The runs it stands for, when it's their group's (groupRun): each takes its height. */
    members?: Run[];
};
type Side = "out" | "in";
type End = { x: number; dir: "up" | "down"; port?: Side };

/** A box's point on one side, where every line it has on that side meets: held where it is while any of them is kept. */
type BoxPoint = { box: Position; side: Side; lines: Line[]; fixed: boolean };
/**
 * A line on the level that isn't drawn, between neighbouring rows, by where a hover would draw it from and to: at each
 * end its box's point on that side, or the box's middle where no drawn line has a point there, as a fresh one starts.
 */
type HiddenLine = Record<Side, BoxPoint | number>;

/**
 * A lane down a gutter, and the lines on it: the lines into one box, the same way, share one (laneGroupOf). It spans
 * the channels all its lines run between and is as wide as the widest, and it moves only as one, and only while none of
 * its lines is kept. `rows` are the rows it passes, each a list of its boxes' left edges.
 */
type Lane = { x: number; width: number; span: [number, number]; group: string; lines: Line[]; kept: boolean; rows: (readonly number[])[] };

/** A line's runs, from where its points and lane are now: one between neighbouring rows, else one at each end of its lane. */
function runsOf(line: Line): Run[] {
    const down = line.intoChannel > line.outChannel;
    if (line.lane === undefined){
        return [{ line, channel: line.outChannel, arrives: true, ends: [{ x: line.portOut!, dir: "up", port: "out" }, { x: line.portIn!, dir: "down", port: "in" }] }];
    }
    return [
        { line, channel: line.outChannel, arrives: false, ends: [{ x: line.portOut!, dir: "up", port: "out" }, { x: line.lane, dir: down ? "down" : "up" }] },
        { line, channel: line.intoChannel, arrives: true, ends: [{ x: line.lane, dir: down ? "up" : "down" }, { x: line.portIn!, dir: "down", port: "in" }] },
    ];
}

const centreOf = (box: Position): number => box.x + BOX_WIDTH / 2;
const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const spanOf = (run: Run): [number, number] => [Math.min(...run.ends.map((e) => e.x)), Math.max(...run.ends.map((e) => e.x))];
/** The lines that share a lane: those into one box, going the same way. */
const laneGroupOf = (line: Line): string => `${line.edge.target} ${line.intoChannel < line.outChannel ? "up" : "down"}`;
/**
 * The runs that share a track in a channel: those into one box, and those out of one (a laned line's first run). A line
 * between neighbouring rows has one run, which arrives, so it goes with its target's.
 */
const trackGroupOf = (run: Run): string => (run.arrives ? `in ${run.line.edge.target}` : `out ${run.line.edge.source}`);
/**
 * Whether a sideways step is a wiggle: under LEAST_JOG, and over half a pixel, since a step that small is rounding,
 * which routing lines up exactly once the points and lanes have settled.
 */
const isWiggle = (step: number): boolean => step > 0.5 && step < LEAST_JOG - EPSILON;

/** Moves a box's point, and with it every line it has on that side. */
function setPoint(point: BoxPoint, x: number): void {
    for (const line of point.lines){
        if (point.side === "out") line.portOut = x;
        else line.portIn = x;
    }
}

/** Moves a lane, and with it every line on it. */
function setLane(lane: Lane, x: number): void {
    lane.x = x;
    for (const line of lane.lines) line.lane = x;
}

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
    // the lanes already placed that run over any of this one's height: each keeps its own place
    const near = taken.filter((lane) => sharesHeight(lane.span, span));
    const clear = (x: number): boolean => near.every((lane) => Math.abs(lane.x - x) >= (lane.width + width) / 2 + LANE_GAP - EPSILON);
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
    const clearOfLanes = taken.every((lane) => !sharesHeight(lane.span, span) || Math.abs(lane.x - x) >= (lane.width + width) / 2 + LANE_GAP - EPSILON);
    return clearOfBoxes && clearOfLanes;
}

/**
 * Whether two lanes run over any of the same height, by the channels they run between. Lanes that only meet in one
 * channel count: one comes down into it and the other leaves it going down, or both end there from either side, and at
 * one x they'd read as one line straight through it.
 */
const sharesHeight = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] <= b[1] && b[0] <= a[1];

/**
 * The points and new lanes settle, a channel at a time, so no line wiggles and no two read as one. A sideways step
 * shorter than LEAST_JOG is a wiggle, not a turn (the owner, 2026-10-27, on src/vs/editor's 460-import line), and a
 * line that stops just above where another starts, at about the same x, reads as one line through the channel, whatever
 * their ends. Two lines that share an end aren't in line where they fork, one turning at that end's point and the other
 * going on through it, and nor are any two that meet where a line drops straight through the channel (while `trunks`
 * is on), since that column is one true line. Each fault is fixed by moving a box's point, every line on that side of
 * the box with it, inside the box's margins, or a new lane, every line on it with it, wherever it still clears the boxes
 * and lanes beside it: onto its line's other end so the line drops straight, else LEAST_JOG from it, or just out of line
 * with the other line. Of the moves at a run's two ends, the one that fixes the most faults its lines take part in is
 * kept, the smallest of those, so the same level always settles the same way. A point a kept line uses, and a lane a
 * kept line is on, stay where they are, and a fault no move fixes stays.
 *
 * The `hidden` lines between neighbouring rows weigh in when a point moves, since a hover may draw one between two
 * points that are held by then: each the move would leave with a wiggle counts HIDDEN_WIGGLE, and its other end, and
 * LEAST_JOG either side of it, are places the point may move to.
 */
function settle(
    lines: readonly Line[],
    points: readonly BoxPoint[],
    lanes: readonly Lane[],
    fixed: ReadonlySet<Line>,
    lanesClear: (lane: Lane, x: number) => boolean,
    hidden: readonly HiddenLine[],
    trunks: boolean,
): void {
    const pointOf: Record<Side, Map<Line, BoxPoint>> = { out: new Map(), in: new Map() };
    for (const point of points) for (const line of point.lines) pointOf[point.side].set(line, point);
    const laneOf = new Map<Line, Lane>();
    for (const lane of lanes) for (const line of lane.lines) laneOf.set(line, lane);
    const xOf = (point: BoxPoint): number => (point.side === "out" ? point.lines[0].portOut! : point.lines[0].portIn!);
    // the hidden lines at each point, and how many of a point's it leaves wiggling where it is now
    const hiddenAt = new Map<BoxPoint, HiddenLine[]>();
    for (const h of hidden) for (const end of [h.out, h.in]) if (typeof end !== "number") hiddenAt.set(end, [...(hiddenAt.get(end) ?? []), h]);
    const xAt = (end: BoxPoint | number): number => (typeof end === "number" ? end : xOf(end));
    const hiddenWiggles = (point: BoxPoint): number => (hiddenAt.get(point) ?? []).filter((h) => isWiggle(Math.abs(xAt(h.out) - xAt(h.in)))).length;
    const inChannel = new Map<number, Line[]>();
    for (const line of lines){
        for (const k of new Set([line.outChannel, line.intoChannel])) inChannel.set(k, [...(inChannel.get(k) ?? []), line]);
    }
    // each channel's runs, made once and brought up to date with their lines' points and lanes when read
    const made = new Map<number, Run[]>();
    const runsIn = (k: number): Run[] => {
        if (!made.has(k)) made.set(k, inChannel.get(k)!.flatMap(runsOf).filter((r) => r.channel === k));
        const runs = made.get(k)!;
        // as runsOf makes them: point to point, else point to lane where it leaves and lane to point where it arrives
        for (const { line, arrives, ends } of runs){
            ends[0].x = line.lane === undefined || !arrives ? line.portOut! : line.lane;
            ends[1].x = line.lane === undefined || arrives ? line.portIn! : line.lane;
        }
        return runs;
    };
    const isJog = (run: Run): boolean => isWiggle(Math.abs(run.ends[0].x - run.ends[1].x));
    // a line turning up at about the x where another turns down: the one stops just above where the other starts
    const nearOf = (a: Run, b: Run): number => (a.line.width + b.line.width) / 2 + LANE_GAP - EPSILON;
    // two lines that share an end, one turning at that end's point and the other going on through it at the same x: a
    // fork in the trunk they share
    const forks = (a: Run, ea: End, b: Run, eb: End): boolean => Math.abs(ea.x - eb.x) < EPSILON
        && ((a.line.edge.source === b.line.edge.source && (ea.port === "out" || eb.port === "out"))
            || (a.line.edge.target === b.line.edge.target && (ea.port === "in" || eb.port === "in")));
    // a line dropping straight through the channel at x: what meets there is on it
    const throughAt = (runs: readonly Run[], x: number): boolean => trunks && runs.some((r) => Math.abs(r.ends[0].x - x) < EPSILON && Math.abs(r.ends[1].x - x) < EPSILON);
    // whether run a's end ea and run b's end eb, turning opposite ways, leave the two lines in line
    const inLine = (runs: readonly Run[], a: Run, ea: End, b: Run, eb: End): boolean => Math.abs(ea.x - eb.x) < nearOf(a, b)
        && !forks(a, ea, b, eb) && !(Math.abs(ea.x - eb.x) < EPSILON && throughAt(runs, ea.x));
    // the faults in channel k that the lines in `among` take part in (every line's, without): a wiggle counts 1, two
    // lines lined up 2. The turns go in CELL-wide cells by x first, so each is only held against those near it.
    const CELL = 16;
    const faults = (k: number, among?: ReadonlySet<Line>): number => {
        const runs = runsIn(k);
        const cells = new Map<number, { run: Run; end: End }[]>();
        for (const run of runs){
            for (const end of run.ends){
                const cell = Math.floor(end.x / CELL);
                if (!cells.has(cell)) cells.set(cell, []);
                cells.get(cell)!.push({ run, end });
            }
        }
        const counted = (run: Run): boolean => among === undefined || among.has(run.line);
        let count = 0;
        for (const run of runs){
            if (!counted(run)) continue;
            if (isJog(run)) count += 1;
            for (const end of run.ends){
                // a counted line's turn up against every other line's turn down near it, and its turn down against the
                // turns up of lines not counted (those of counted ones were met from their side)
                const reach = run.line.width / 2 + LINE_MAX / 2 + LANE_GAP;
                for (let cell = Math.floor((end.x - reach) / CELL); cell <= Math.floor((end.x + reach) / CELL); cell++){
                    for (const o of cells.get(cell) ?? []){
                        if (o.run.line === run.line || o.end.dir === end.dir || (end.dir === "down" && counted(o.run))) continue;
                        if (inLine(runs, run, end, o.run, o.end)) count += 2;
                    }
                }
            }
        }
        return count;
    };

    // a move: the lines it moves, the channels it changes, whether it keeps a lane clear of the boxes and lanes, and the
    // point it moves, if it moves one
    type Move = { cost: number; lines: Set<Line>; channels: number[]; apply: () => void; restore: () => void; valid: () => boolean; point?: BoxPoint };
    // whether the end `i` of `run` is in a fault: its run wiggles, or another line turns the other way in line with it
    const inFault = (runs: readonly Run[], run: Run, i: number): boolean => {
        const end = run.ends[i];
        return isJog(run) || runs.some((other) => other.line !== run.line && other.ends.some((o) => o.dir !== end.dir && inLine(runs, run, end, other, o)));
    };
    // the moves that might fix the fault the end `i` of `run` is in
    const movesFor = (k: number, runs: readonly Run[], run: Run, i: number): Move[] => {
        const end = run.ends[i];
        const partner = run.ends[1 - i].x;
        const line = run.line;
        // onto its line's other end or LEAST_JOG from it, and just clear of each other line's turn the other way, whether
        // that one's in the fault or not
        const targets = new Set([partner, partner - LEAST_JOG, partner + LEAST_JOG]);
        for (const other of runs){
            if (other.line === line) continue;
            const away = nearOf(run, other) + 2 * EPSILON;
            for (const o of other.ends) if (o.dir !== end.dir) targets.add(o.x - away).add(o.x + away);
        }
        const moves: Move[] = [];
        if (end.port !== undefined){
            // its box's point, with every line on it, anywhere inside the box's margins
            const point = pointOf[end.port].get(line)!;
            if (point.fixed) return moves;
            const was = xOf(point);
            // and onto the other end of each hidden line it would start or end, or LEAST_JOG from it
            for (const h of hiddenAt.get(point) ?? []){
                const other = xAt(point.side === "out" ? h.in : h.out);
                targets.add(other).add(other - LEAST_JOG).add(other + LEAST_JOG);
            }
            for (const x of targets){
                if (Math.abs(x - was) < EPSILON || x < point.box.x + PORT_MARGIN - EPSILON || x > point.box.x + BOX_WIDTH - PORT_MARGIN + EPSILON) continue;
                moves.push({ cost: Math.abs(x - was) * point.lines.length, lines: new Set(point.lines), channels: [k], apply: () => setPoint(point, x), restore: () => setPoint(point, was), valid: () => true, point });
            }
        } else {
            // its lane, with every line on it, anywhere it still clears the boxes and lanes beside it
            const lane = laneOf.get(line);
            if (lane === undefined) return moves;
            const from = lane.x;
            const channels = [...new Set(lane.lines.flatMap((l) => [l.outChannel, l.intoChannel]))];
            for (const x of targets){
                if (Math.abs(x - from) < EPSILON) continue;
                moves.push({ cost: Math.abs(x - from) * lane.lines.length, lines: new Set(lane.lines), channels, apply: () => setLane(lane, x), restore: () => setLane(lane, from), valid: () => lanesClear(lane, x) });
            }
        }
        return moves;
    };
    // what a move's lines take part in, over the channels it changes, and a moved point's hidden lines, a little
    const share = (move: Move): number => move.channels.reduce((sum, c) => sum + faults(c, move.lines), 0)
        + (move.point === undefined ? 0 : HIDDEN_WIGGLE * hiddenWiggles(move.point));

    // a channel at a time, a run at a time, the wiggles first (moving one straight often clears the lines in line with it
    // too): of the moves at either end of a run in a fault, the one that fixes the most is kept, the smallest of those.
    // Up to three passes, and none after SETTLE_TRIES moves have been tried.
    let tried = 0;
    for (let pass = 0; pass < 3 && tried < SETTLE_TRIES; pass++){
        let moved = false;
        for (const k of [...inChannel.keys()].sort((a, b) => a - b)){
            const runs = runsIn(k);
            for (const run of [...runs.filter(isJog), ...runs.filter((r) => !isJog(r))]){
                if (tried > SETTLE_TRIES) break;
                if (fixed.has(run.line)) continue;
                runsIn(k);
                const ends = [0, 1].filter((i) => inFault(runs, run, i));
                if (ends.length === 0) continue;
                let best: { move: Move; gain: number } | null = null;
                for (const move of ends.flatMap((i) => movesFor(k, runs, run, i)).sort((a, b) => a.cost - b.cost)){
                    if (++tried > SETTLE_TRIES) break;
                    const before = share(move);
                    move.apply();
                    const gain = move.valid() ? before - share(move) : 0;
                    move.restore();
                    if (gain > 0 && (best === null || gain > best.gain)) best = { move, gain };
                }
                if (best !== null){
                    best.move.apply();
                    moved = true;
                }
            }
        }
        if (!moved) break;
    }
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
 * One run standing for a channel's runs of one group (trackGroupOf), so they take one track as one line: every end they
 * have, the widest one's width, and arriving when they arrive. Its line is the widest's, whose head is their box's, as
 * all of theirs are. A group of one is its own run.
 */
function groupRun(group: readonly Run[]): Run {
    if (group.length === 1) return group[0];
    const widest = group.reduce((best, r) => (r.line.width > best.line.width || (r.line.width === best.line.width && byKey(r.line, best.line) < 0) ? r : best));
    const ends = group.flatMap((r) => r.ends).filter((e, i, all) => all.findIndex((o) => Math.abs(o.x - e.x) < EPSILON && o.dir === e.dir) === i);
    return { line: widest.line, channel: widest.channel, arrives: widest.arrives, ends, members: [...group] };
}

/**
 * Every drawn line's route on a laid-out level, by edge key ("source->target"). Rows are the boxes' tops, and every box
 * with a line on the level stands in the way of a lane, drawn or not; the loose ones sit apart in their grid. `drawn`
 * names the lines to route (all of them when it's left out): points, lanes and tracks are placed for those alone, so a
 * line that isn't drawn leaves no gap. Widths are scaled against the level's heaviest line, drawn or not, and so is
 * each box's arrowhead.
 *
 * `kept` holds routes already on screen, for lines that stay drawn: each keeps its own exactly, and the other lines take
 * the points they hold, join their groups' lanes and tracks where they fit on them, and are routed around the rest, in
 * each gutter and in each channel (nextRoutes).
 *
 * The level is routed with straight trunks first: two lines that meet where a line drops straight through a channel
 * aren't taken for two lines in line, since the column is one line. Where that leaves a new line on one drop with a line
 * it shares no end with, which would read as one line, the level is routed again without that, so where two trunks
 * cross they keep apart (build/azure-pipelines/oss). Either way the same level always routes the same way.
 */
export function routeEdges(
    positions: ReadonlyMap<string, Position>,
    edges: readonly MapEdge[],
    drawn?: ReadonlySet<string>,
    kept: ReadonlyMap<string, Point[]> = new Map(),
): Map<string, Point[]> {
    const routes = route(positions, edges, drawn, kept, true);
    const ends = new Map(edges.map((e) => [`${e.source}->${e.target}`, e]));
    return dropShared(routes, ends, kept) ? route(positions, edges, drawn, kept, false) : routes;
}

/**
 * Whether a new route runs down one x together with a route it shares no end with, for more than a pixel. A kept route
 * comes back as the same object, so any other is new.
 */
function dropShared(routes: ReadonlyMap<string, Point[]>, ends: ReadonlyMap<string, MapEdge>, kept: ReadonlyMap<string, Point[]>): boolean {
    const byX = new Map<number, { key: string; fresh: boolean; lo: number; hi: number }[]>();
    for (const [key, points] of routes){
        const fresh = points !== kept.get(key);
        for (let i = 1; i < points.length; i++){
            const [p, q] = [points[i - 1], points[i]];
            if (p.x !== q.x) continue;
            if (!byX.has(p.x)) byX.set(p.x, []);
            byX.get(p.x)!.push({ key, fresh, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) });
        }
    }
    for (const drops of byX.values()){
        for (let i = 0; i < drops.length; i++){
            for (let j = i + 1; j < drops.length; j++){
                const [a, b] = [drops[i], drops[j]];
                if (a.key === b.key || (!a.fresh && !b.fresh)) continue;
                const [ea, eb] = [ends.get(a.key)!, ends.get(b.key)!];
                if (ea.source === eb.source || ea.target === eb.target) continue;
                if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 1) return true;
            }
        }
    }
    return false;
}

/** routeEdges's routes, with lines that meet on a straight trunk through a channel let off as in line or not (`trunks`). */
function route(
    positions: ReadonlyMap<string, Position>,
    edges: readonly MapEdge[],
    drawn: ReadonlySet<string> | undefined,
    kept: ReadonlyMap<string, Point[]>,
    trunks: boolean,
): Map<string, Point[]> {
    const maxImports = maxImportsOf(edges);
    const heads = boxHeadWidths(edges);
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
        return { key: `${edge.source}->${edge.target}`, edge, width, head: arrowHead(heads.get(edge.target)!), s, t, outChannel: row(s) + 1, intoChannel: row(t) };
    });
    // the kept lines take their points, lane and tracks from their routes, and stay where they are
    const fixed = new Map<Line, Point[]>();
    for (const line of lines){
        const route = kept.get(line.key);
        if (route !== undefined && takeRoute(line, route, tops)) fixed.set(line, route);
    }
    const fresh = lines.filter((l) => !fixed.has(l));
    // the points the kept lines hold, by box
    const heldOut = new Map<string, number>();
    const heldIn = new Map<string, number>();
    for (const line of fixed.keys()){
        heldOut.set(line.edge.source, line.portOut!);
        heldIn.set(line.edge.target, line.portIn!);
    }

    // 1. lanes, for the lines that pass a row between their channels or point back up. The kept lines' lanes are there
    // from the start, one to each group and x, and their points stand in their channels as lanes do: a new lane can't line
    // up with one there, since a kept point doesn't move out of its way
    const spanOfLine = (line: Line): [number, number] => [Math.min(line.outChannel, line.intoChannel), Math.max(line.outChannel, line.intoChannel)];
    // the rows a lane passes, by the channels it runs between. A group's lines all end in their target's channel, so the
    // longest's rows are every one's
    const rowsOf = (span: [number, number]): (readonly number[])[] => lefts.slice(span[0], span[1]);
    const lanes: Lane[] = [];
    const widen = (lane: Lane, line: Line, span: [number, number]): void => {
        lane.lines.push(line);
        lane.width = Math.max(lane.width, line.width);
        lane.span = [Math.min(lane.span[0], span[0]), Math.max(lane.span[1], span[1])];
        lane.rows = rowsOf(lane.span);
    };
    const heldPoints: { x: number; width: number; span: [number, number] }[] = [];
    for (const line of fixed.keys()){
        if (line.lane !== undefined){
            const [group, span] = [laneGroupOf(line), spanOfLine(line)];
            const same = lanes.find((l) => l.group === group && Math.abs(l.x - line.lane!) < EPSILON);
            if (same !== undefined) widen(same, line, span);
            else lanes.push({ x: line.lane, width: line.width, span, group, lines: [line], kept: true, rows: rowsOf(span) });
        }
        heldPoints.push({ x: line.portOut!, width: line.width, span: [line.outChannel, line.outChannel] }, { x: line.portIn!, width: line.width, span: [line.intoChannel, line.intoChannel] });
    }
    // what a lane keeps clear of: the kept points, and every lane but `lane` itself and, when `group` is given, its group's
    const others = (lane: Lane | null, group?: string): { x: number; width: number; span: [number, number] }[] =>
        [...heldPoints, ...lanes.filter((l) => l !== lane && (group === undefined || l.group !== group))];
    // the new lines' lanes, each as near the middle of its two boxes as it can be, placed in the order of those middles
    const laned = fresh.filter((l) => l.outChannel !== l.intoChannel)
        .sort((a, b) => (centreOf(a.s) + centreOf(a.t)) - (centreOf(b.s) + centreOf(b.t)) || byKey(a, b));
    for (const line of laned){
        // its height as the channels it runs between: two lanes overlap when they share any of it (sharesHeight)
        const span = spanOfLine(line);
        const rows = rowsOf(span);
        const group = laneGroupOf(line);
        const preferred = (centreOf(line.s) + centreOf(line.t)) / 2;
        // its own lane as if its group had none there, and whether that's clear of the lanes it would keep from
        const own = placeLane(rows, preferred, line.width, span, others(null, group));
        const ownFits = laneFits(rows, own, line.width, span, others(null, group));
        // a lane its kept leaving point would step over to by less than a jog would leave it a wiggle
        const from = heldOut.get(line.edge.source);
        const wiggles = (x: number): boolean => from !== undefined && isWiggle(Math.abs(from - x));
        // it joins its group's lane nearest its own, a kept one or a new one, within reach, when that leaves no wiggle and
        // either the lane's clear over all its rows, its own isn't clear either (a full gutter), or its own would crowd it
        // while the lane clears the boxes and, joined, runs no more than a pixel nearer any other lane than its own would
        const join = lanes.filter((lane) => lane.group === group && Math.abs(lane.x - own) < MERGE_REACH && !wiggles(lane.x)
                && (!ownFits || laneFits(rows, lane.x, line.width, span, others(lane))
                    || (Math.abs(lane.x - own) < (lane.width + line.width) / 2 + LANE_GAP && laneFits(rows, lane.x, line.width, span, [])
                        && others(lane).every((o) => !sharesHeight(o.span, span) || Math.abs(o.x - lane.x) >= Math.min(Math.abs(o.x - own), (o.width + line.width) / 2 + LANE_GAP) - 1))))
            .sort((a, b) => Math.abs(a.x - own) - Math.abs(b.x - own) || a.x - b.x)[0];
        if (join !== undefined){
            line.lane = join.x;
            widen(join, line, span);
            continue;
        }
        // else a lane of its own, clear of every lane there, its group's too
        line.lane = ownFits && laneFits(rows, own, line.width, span, others(null)) ? own : placeLane(rows, preferred, line.width, span, others(null));
        lanes.push({ x: line.lane, width: line.width, span, group, lines: [line], kept: false, rows });
    }

    // 2. points: one under each box for all its leaving lines and one over it for all its arriving lines, at its middle,
    // or where a kept line holds it
    for (const line of fresh){
        line.portOut = heldOut.get(line.edge.source) ?? centreOf(line.s);
        line.portIn = heldIn.get(line.edge.target) ?? centreOf(line.t);
    }
    const pointAt = new Map<string, BoxPoint>();
    const pointOf = (line: Line, side: Side): BoxPoint => {
        const path = side === "out" ? line.edge.source : line.edge.target;
        const id = `${side} ${path}`;
        if (!pointAt.has(id)) pointAt.set(id, { box: positions.get(path)!, side, lines: [], fixed: (side === "out" ? heldOut : heldIn).has(path) });
        return pointAt.get(id)!;
    };
    for (const line of lines) for (const side of ["out", "in"] as const) pointOf(line, side).lines.push(line);

    // a lane still of one new line moves right under its leaving point (or over its arriving one) when that fits, so the
    // line drops straight out of its box (or into it) instead of jogging over to the gutter's middle
    const lanesClear = (lane: Lane, x: number): boolean => laneFits(lane.rows, x, lane.width, lane.span, others(lane));
    const newLanes = lanes.filter((l) => !l.kept);
    for (const lane of newLanes){
        if (lane.lines.length !== 1) continue;
        const [line] = lane.lines;
        const straight = [line.portOut!, line.portIn!].find((x) => lanesClear(lane, x));
        if (straight !== undefined) setLane(lane, straight);
    }

    // then the new lines' points and lanes settle: no short jogs, and no two lines lined up end to end. The lines not
    // drawn between neighbouring rows weigh in a little, from the points they'd join, so a hover finds them straight
    const hidden: HiddenLine[] = drawn === undefined ? [] : onLevel
        .filter((e) => !drawn.has(`${e.source}->${e.target}`) && row(positions.get(e.target)!) === row(positions.get(e.source)!) + 1)
        .map((e) => ({ out: pointAt.get(`out ${e.source}`) ?? centreOf(positions.get(e.source)!), in: pointAt.get(`in ${e.target}`) ?? centreOf(positions.get(e.target)!) }));
    settle(lines, [...pointAt.values()], newLanes, new Set(fixed.keys()), lanesClear, hidden, trunks);
    // ends that line up to within rounding line up exactly, so a straight drop has no hairline step: a new line between
    // neighbouring rows has its free point take the other's x, and then a new lane takes the x of its lines' point it's
    // that near, unless it's already on one
    for (const line of fresh){
        const step = Math.abs(line.portOut! - line.portIn!);
        if (line.lane !== undefined || step === 0 || step > 0.5) continue;
        const [out, into] = [pointOf(line, "out"), pointOf(line, "in")];
        if (!into.fixed) setPoint(into, line.portOut!);
        else if (!out.fixed) setPoint(out, line.portIn!);
    }
    for (const lane of newLanes){
        const xs = lane.lines.flatMap((l) => [l.portIn!, l.portOut!]);
        const near = xs.find((x) => Math.abs(lane.x - x) <= 0.5);
        if (near !== undefined && !xs.includes(lane.x)) setLane(lane, near);
    }

    // 3. runs along each channel, and the tracks they take: a group's runs (trackGroupOf) as one, joining its kept tracks
    // or around the kept ones where the channel has any
    const runs = fresh.flatMap(runsOf);
    const keptRuns = [...fixed.keys()].flatMap((line) => runsOf(line).map((run) => ({ ...run, y: trackOf(fixed.get(line)!, run.channel, tops) })));
    const byChannel = new Map<number, Run[]>();
    for (const run of runs){
        // a run whose two ends line up is a straight drop through the channel: it needs no track
        if (Math.abs(run.ends[0].x - run.ends[1].x) < EPSILON) continue;
        byChannel.set(run.channel, [...(byChannel.get(run.channel) ?? []), run]);
    }
    for (const [channel, inChannel] of byChannel){
        const groups = new Map<string, Run[]>();
        for (const run of inChannel) groups.set(trackGroupOf(run), [...(groups.get(trackGroupOf(run)) ?? []), run]);
        const around: Run[] = keptRuns.filter((r) => r.channel === channel && r.y !== undefined);
        // a new run whose group has kept runs here joins one of their tracks where what it runs past them fits (joins),
        // the height it reaches least past them first, then the lowest y, the highest up. The group's other new runs
        // go round them all as one
        const arrivals = lines.filter((l) => l.intoChannel === channel);
        const left: Run[][] = [];
        for (const [group, members] of groups){
            const groupKept = around.filter((r) => trackGroupOf(r) === group);
            const otherRuns = around.filter((r) => trackGroupOf(r) !== group);
            const unjoined: Run[] = [];
            for (const run of members){
                const [lo, hi] = spanOf(run);
                const heights = [...new Set(groupKept.map((r) => r.y!))].map((y) => {
                    const spans = groupKept.filter((r) => r.y === y).map(spanOf);
                    const covered: [number, number] = [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
                    return { y, covered, past: Math.max(0, covered[0] - lo) + Math.max(0, hi - covered[1]) };
                }).sort((a, b) => a.past - b.past || a.y - b.y);
                const height = heights.find((h) => joins(run, h.y, h.covered, otherRuns, arrivals, channel, tops));
                if (height === undefined){
                    unjoined.push(run);
                    continue;
                }
                run.y = height.y;
                around.push(run);
            }
            if (unjoined.length > 0) left.push(unjoined);
        }
        const grouped = left.map(groupRun);
        if (around.length > 0){
            placeRunsAround(channel, grouped, around, tops);
        } else {
            // tracks in order, each run on the first track at or below the ones that must be above it that it fits on
            const tracks: Run[][] = [];
            for (const run of trackOrder(grouped)){
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
        // each line's run takes its group's height
        for (const run of grouped) for (const member of run.members ?? []) member.y = run.y;
    }

    // 4. every line's corners, in order: a kept line's as they were, the same object, so React Flow keeps it as it is
    const routes = new Map<string, Point[]>();
    const runsByLine = new Map<Line, Run[]>();
    for (const run of runs) runsByLine.set(run.line, [...(runsByLine.get(run.line) ?? []), run]);
    for (const line of lines){
        if (fixed.has(line)){
            routes.set(line.key, fixed.get(line)!);
            continue;
        }
        const [first, second] = runsByLine.get(line)!;
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
 * The routes to draw when the lines drawn change to `drawn` from what's on screen, `before` (the owner, 2026-10-27:
 * pointing at a box rearranged lines already there). The lines drawn at rest keep their routes from `rest`, every
 * other line still drawn keeps the one it had, and the lines that just appeared join them where they share an end and
 * fit, and are routed around them all elsewhere (routeEdges with them kept). So a line never moves while it's drawn:
 * lines appear and fade, and that's all.
 */
export function nextRoutes(
    positions: ReadonlyMap<string, Position>,
    edges: readonly MapEdge[],
    rest: ReadonlyMap<string, Point[]>,
    before: ReadonlyMap<string, Point[]>,
    drawn: ReadonlySet<string>,
): Map<string, Point[]> {
    const kept = new Map<string, Point[]>();
    for (const [key, route] of before) if (drawn.has(key)) kept.set(key, route);
    for (const [key, route] of rest) if (drawn.has(key)) kept.set(key, route);
    return routeEdges(positions, edges, drawn, kept);
}

/**
 * A kept line's points and lane, read back from its route (routeEdges's kept): its first point is its leaving point,
 * its last its arriving one, and its lane is the drop that passes the middle of the first row between its channels.
 * False when the route isn't one this level could have given it, so the line is routed afresh.
 */
function takeRoute(line: Line, route: readonly Point[], tops: readonly number[]): boolean {
    if (route.length < 2 || route[0].y !== line.s.y + BOX_HEIGHT || route[route.length - 1].y !== line.t.y) return false;
    line.portOut = route[0].x;
    line.portIn = route[route.length - 1].x;
    if (line.outChannel === line.intoChannel) return true;
    const y = tops[Math.min(line.outChannel, line.intoChannel)] + BOX_HEIGHT / 2;
    const drop = route.slice(1).findIndex((p, i) => p.x === route[i].x && Math.min(p.y, route[i].y) <= y && y <= Math.max(p.y, route[i].y));
    if (drop < 0) return false;
    line.lane = route[drop].x;
    return true;
}

/** The height a kept route runs along channel `k`, or undefined where it drops straight through it. */
function trackOf(route: readonly Point[], k: number, tops: readonly number[]): number | undefined {
    const channelOf = (y: number): number => tops.filter((t) => t + BOX_HEIGHT <= y).length;
    return route.slice(1).find((p, i) => p.y === route[i].y && channelOf(p.y) === k)?.y;
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
 * A block too tall for its channel is squeezed, down to a pixel between lines. One still too tall takes the corners'
 * room too, down to CROWDED_ROOM under the row above and then over the arrowheads, so every head keeps its full length;
 * past that its lines touch.
 */
function placeTracks(k: number, tracks: readonly Run[][], tops: readonly number[]): void {
    const widest = tracks.map((track) => Math.max(...track.map((r) => r.line.width)));
    const gaps = widest.slice(1).map((w, i) => (widest[i] + w) / 2 + TRACK_GAP);
    const tightest = widest.slice(1).map((w, i) => (widest[i] + w) / 2 + 1);
    const height = gaps.reduce((sum, g) => sum + g, 0);
    const least = tightest.reduce((sum, g) => sum + g, 0);
    // the lowest a track may run: above the next row by its arrowheads and a corner
    const head = Math.max(0, ...tracks.flat().filter((r) => r.arrives).map((r) => r.line.head.length)) + TIP_GAP;
    let upper = k > 0 ? tops[k - 1] + BOX_HEIGHT + TOP_ROOM : -Infinity;
    let lower = k < tops.length ? tops[k] - head - CORNER_ROOM : Infinity;
    let spacing = gaps;
    if (Number.isFinite(upper) && Number.isFinite(lower) && height > lower - upper){
        // the corner under the row above goes first: the one over an arrowhead is what lets it read as one
        if (least > lower - upper) upper = tops[k - 1] + BOX_HEIGHT + CROWDED_ROOM;
        if (least > lower - upper) lower = tops[k] - head - CROWDED_ROOM;
        const room = Math.max(0, lower - upper);
        const share = height === least ? 0 : Math.max(0, Math.min(1, (room - least) / (height - least)));
        spacing = least > room ? tightest.map((g) => (g * room) / least) : gaps.map((g, i) => tightest[i] + (g - tightest[i]) * share);
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

/**
 * Whether a new run in channel `k` can join its group's kept track at height `y`, whose kept runs cover `covered`: along
 * that it runs on their track, one line with them, and what it runs past it keeps TRACK_GAP past half of each width
 * from every other run alongside it, keeps the order a shared drop needs (sharesDrop), and passes CROWDED_ROOM above
 * the arrowhead of each line arriving in the channel under it (`arrivals`), but its own box's, which it shares.
 */
function joins(run: Run, y: number, covered: readonly [number, number], others: readonly Run[], arrivals: readonly Line[], k: number, tops: readonly number[]): boolean {
    const [lo, hi] = spanOf(run);
    const past: [number, number][] = [];
    if (lo < covered[0] - EPSILON) past.push([lo, covered[0]]);
    if (hi > covered[1] + EPSILON) past.push([covered[1], hi]);
    return past.every(([plo, phi]) => others.every((o) => {
        const [olo, ohi] = spanOf(o);
        const room = (o.line.width + run.line.width) / 2 + RUN_GAP;
        if (phi + room <= olo || ohi + room <= plo) return true;
        return Math.abs(y - o.y!) >= (o.line.width + run.line.width) / 2 + TRACK_GAP - EPSILON && !(sharesDrop(run, o) && y > o.y!) && !(sharesDrop(o, run) && y < o.y!);
    }) && arrivals.every((l) => l.edge.target === run.line.edge.target
        || l.portIn! + l.head.half + run.line.width / 2 <= plo || l.portIn! - l.head.half - run.line.width / 2 >= phi
        || y <= tops[k] - l.head.length - TIP_GAP - CROWDED_ROOM + EPSILON));
}

/**
 * The heights for `fresh` runs in channel `k`, which already holds the `kept` runs of lines that stay where they are
 * (routeEdges with routes kept). In trackOrder's order, each takes the free height nearest the channel's middle (past
 * the first or last row, nearest the boxes): TRACK_GAP from every run it overlaps, end to end or alongside, above any it
 * must be above, and inside placeTracks's bounds. A run that should be above another, or below it, and isn't costs
 * more than any distance. Where nothing is free, the bounds widen to CROWDED_ROOM and then the gap to a pixel; past
 * that a run takes the middle.
 */
function placeRunsAround(k: number, fresh: readonly Run[], kept: readonly Run[], tops: readonly number[]): void {
    const placed: Run[] = [...kept];
    const middle = channelMiddle(k, tops);
    const want = k <= 0 ? Math.min(middle, tops[0] - TOP_ROOM) : k >= tops.length ? Math.max(middle, tops[tops.length - 1] + BOX_HEIGHT + TOP_ROOM) : middle;
    for (const run of trackOrder(fresh)){
        const [lo, hi] = spanOf(run);
        const alongside = placed.filter((other) => {
            const [olo, ohi] = spanOf(other);
            const room = (other.line.width + run.line.width) / 2 + RUN_GAP;
            return !(hi + room <= olo || ohi + room <= lo);
        });
        // above its own arrowhead, and above those of the lines arriving under it, each at its box's arriving point
        const under = placed.filter((o) => o.arrives && o.line.portIn! + o.line.head.half + run.line.width / 2 > lo && o.line.portIn! - o.line.head.half - run.line.width / 2 < hi);
        const head = Math.max(run.arrives ? run.line.head.length : 0, ...under.map((o) => o.line.head.length)) + TIP_GAP;
        const attempts: [number, number, number][] = [[TOP_ROOM, CORNER_ROOM, TRACK_GAP], [CROWDED_ROOM, CROWDED_ROOM, TRACK_GAP], [CROWDED_ROOM, CROWDED_ROOM, 1]];
        let y: number | undefined;
        for (const [topRoom, cornerRoom, trackGap] of attempts){
            const upper = k > 0 ? tops[k - 1] + BOX_HEIGHT + topRoom : -Infinity;
            const lower = k < tops.length ? tops[k] - head - cornerRoom : Infinity;
            const gapTo = (other: Run): number => (other.line.width + run.line.width) / 2 + trackGap;
            const tries = [want, upper, lower, ...alongside.flatMap((o) => [o.y! - gapTo(o), o.y! + gapTo(o)])].filter(Number.isFinite);
            const free = tries.filter((t) => t >= upper - EPSILON && t <= lower + EPSILON
                && alongside.every((o) => Math.abs(t - o.y!) >= gapTo(o) - EPSILON && !(sharesDrop(run, o) && t > o.y!) && !(sharesDrop(o, run) && t < o.y!)));
            const cost = (t: number): number => Math.abs(t - want)
                + 1000 * alongside.filter((o) => (mustBeAbove(run, o) && t > o.y!) || (mustBeAbove(o, run) && t < o.y!)).length;
            if (free.length > 0){
                y = free.reduce((best, t) => (cost(t) < cost(best) || (cost(t) === cost(best) && t < best) ? t : best));
                break;
            }
        }
        run.y = y ?? middle;
        placed.push(run);
    }
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

/** A rectangle by its middle and size, as a count's label or a box takes the canvas. */
export type Rect = { x: number; y: number; width: number; height: number };

/** One side of a route, and the width of the line it's part of. */
type Segment = { key: string; a: Point; b: Point; width: number };

/** Whether two rectangles overlap. Touching isn't overlapping. */
const overlaps = (r: Rect, s: Rect): boolean => Math.abs(r.x - s.x) * 2 < r.width + s.width && Math.abs(r.y - s.y) * 2 < r.height + s.height;

/**
 * The stretches of line `key`'s sides that no other line runs along (two lines along one run are within half of each
 * width and a pixel of each other), longest first: a count on a run two lines share didn't say whose it was.
 */
function ownStretches(key: string, segments: readonly Segment[]): { a: Point; b: Point; length: number }[] {
    const others = segments.filter((s) => s.key !== key);
    const stretches: { a: Point; b: Point; length: number }[] = [];
    for (const s of segments){
        if (s.key !== key) continue;
        const across = s.a.y === s.b.y;
        const [lo, hi] = across ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
        let free: [number, number][] = [[lo, hi]];
        for (const o of others){
            const along = across
                ? o.a.y === o.b.y && Math.abs(o.a.y - s.a.y) < (o.width + s.width) / 2 + 1
                : o.a.x === o.b.x && Math.abs(o.a.x - s.a.x) < (o.width + s.width) / 2 + 1;
            if (!along) continue;
            const [olo, ohi] = across ? [Math.min(o.a.x, o.b.x), Math.max(o.a.x, o.b.x)] : [Math.min(o.a.y, o.b.y), Math.max(o.a.y, o.b.y)];
            free = free.flatMap(([f0, f1]): [number, number][] => (ohi <= f0 || olo >= f1
                ? [[f0, f1]]
                : ([[f0, Math.max(f0, olo)], [Math.min(f1, ohi), f1]] as [number, number][]).filter(([p, q]) => q - p > 0.5)));
        }
        for (const [f0, f1] of free){
            stretches.push(across ? { a: { x: f0, y: s.a.y }, b: { x: f1, y: s.a.y }, length: f1 - f0 } : { a: { x: s.a.x, y: f0 }, b: { x: s.a.x, y: f1 }, length: f1 - f0 });
        }
    }
    return stretches.sort((p, q) => q.length - p.length);
}

/**
 * Where each line's count is written, for the lines it fits on (the owner, 2026-10-28: "make the numbers never overlap
 * with anything"). A label, its size centred on its point, overlaps nothing but its own line, which runs under it: no
 * other line, grown by COUNT_LINE_ROOM each side past its width, no other count, grown by COUNT_GAP each side, and no
 * box (`boxes`, each with its back card). Heavier lines go first, ties by key, so the same screen always places the same
 * way. A `kept` place, where the screen this one grew from had the count, stays while it's clear, so lines that appear
 * move only the counts they run into. Every other count tries along the stretches its line has to itself (ownStretches),
 * at COUNT_TRIES of the room, and takes the first clear place. A count with none is left out, and isn't drawn: its number
 * is still in the inspector and in the line's hover sentence. `labels` gives each counted line its label's size.
 */
export function placeCounts(
    routes: ReadonlyMap<string, readonly Point[]>,
    widths: ReadonlyMap<string, number>,
    labels: ReadonlyMap<string, { width: number; height: number }>,
    boxes: readonly Rect[],
    kept: ReadonlyMap<string, Point> = new Map(),
): Map<string, Point> {
    const segments: Segment[] = [];
    for (const [key, points] of routes){
        for (let i = 0; i + 1 < points.length; i++) segments.push({ key, a: points[i], b: points[i + 1], width: widths.get(key) ?? 1 });
    }
    // each side as the room a count keeps off it, worked out once rather than for every place tried
    const rooms = segments.map((s) => ({ key: s.key, room: {
        x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2,
        width: Math.abs(s.b.x - s.a.x) + s.width + 2 * COUNT_LINE_ROOM, height: Math.abs(s.b.y - s.a.y) + s.width + 2 * COUNT_LINE_ROOM,
    } }));
    const placed: Rect[] = [];
    const clear = (key: string, at: Point): boolean => {
        const label = { x: at.x, y: at.y, ...labels.get(key)! };
        return !rooms.some((s) => s.key !== key && overlaps(label, s.room))
            && !placed.some((q) => overlaps(label, { ...q, width: q.width + 2 * COUNT_GAP, height: q.height + 2 * COUNT_GAP }))
            && !boxes.some((b) => overlaps(label, b));
    };
    const result = new Map<string, Point>();
    const place = (key: string, at: Point): void => {
        result.set(key, at);
        placed.push({ x: at.x, y: at.y, ...labels.get(key)! });
    };
    const order = [...labels.keys()].filter((key) => routes.has(key))
        .sort((a, b) => (widths.get(b) ?? 1) - (widths.get(a) ?? 1) || (a < b ? -1 : a > b ? 1 : 0));
    for (const key of order){
        const at = kept.get(key);
        if (at !== undefined && clear(key, at)) place(key, at);
    }
    // the first clear place along a stretch, the longest stretch first, where the whole label lies on the stretch
    const spot = (key: string): Point | undefined => {
        const size = labels.get(key)!;
        for (const st of ownStretches(key, segments)){
            const across = st.a.y === st.b.y;
            const need = across ? size.width : size.height;
            const room = st.length - need;
            if (room < 0) continue;
            for (const t of COUNT_TRIES){
                const along = need / 2 + room * t;
                const at = across ? { x: Math.min(st.a.x, st.b.x) + along, y: st.a.y } : { x: st.a.x, y: Math.min(st.a.y, st.b.y) + along };
                if (clear(key, at)) return at;
            }
        }
        return undefined;
    };
    for (const key of order){
        if (result.has(key)) continue;
        const at = spot(key);
        if (at !== undefined) place(key, at);
    }
    return result;
}

/**
 * The room a count keeps off each drawn arrowhead, to go with the boxes placeCounts keeps counts off: a count over a
 * head hid it, and an arrowhead is always visible (PR #16). A route ends at its box's top, under the head, so its last
 * drop alone kept no count off it (review: on src/vs with workbench selected, 3,652 covered editor's whole head). One
 * for each box a drawn line arrives at, since its lines end at one point under one head (weights.ts's boxHeadWidths),
 * where RoutedEdge draws it, TIP_GAP above the route's end, and grown by COUNT_LINE_ROOM each side as a line's room is.
 */
export function headRooms(routes: ReadonlyMap<string, readonly Point[]>, edges: readonly MapEdge[]): Rect[] {
    const maxImports = maxImportsOf(edges);
    const heads = boxHeadWidths(edges);
    const edgeOf = new Map(edges.map((e) => [`${e.source}->${e.target}`, e]));
    const rooms = new Map<string, Rect>();
    for (const [key, points] of routes){
        const edge = edgeOf.get(key);
        if (edge === undefined || points.length < 2 || rooms.has(edge.target)) continue;
        const end = points[points.length - 1];
        const { half, length } = arrowHead(heads.get(edge.target) ?? lineWidth(edge.count, maxImports));
        rooms.set(edge.target, {
            x: end.x, y: end.y - TIP_GAP - length / 2,
            width: 2 * half + 2 * COUNT_LINE_ROOM, height: length + 2 * COUNT_LINE_ROOM,
        });
    }
    return [...rooms.values()];
}
