import type { MapEdge } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, RANK_GAP, type Position } from "./levelLayout";
import { arrowHead, LINE_MAX, lineWidth, maxImportsOf } from "./weights";

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
/** What's left of TOP_ROOM and CORNER_ROOM in a channel too crowded for them (placeTracks). */
const CROWDED_ROOM = 3;
/** Where a line runs past the first or last row: as far out as half the gap between layers. */
const OUTER_CHANNEL = RANK_GAP / 2;
/** Corners of a route are rounded this much (VISUAL_REFRESH.md §7's 8 px radius). */
const CORNER_RADIUS = 8;
/**
 * A sideways step shorter than this is a wiggle, not a turn: the line drops straight instead, or turns at least this
 * far (settlePorts). Three corner radii, so a turn has a straight run between its two curves.
 */
const LEAST_JOG = 24;
/**
 * How many moves settlePorts tries on one level before it stops, so a level of hundreds of lines still routes in a
 * frame or two (src/vs/platform's 441 with every line drawn); what it hasn't fixed by then stays.
 */
const SETTLE_TRIES = 4000;
/**
 * Spacing is compared this loosely: a place exactly one step from a lane is free, though the sums that find it round.
 * Compared exactly, src/vs's gutters both counted as full, and workbench → base fell back onto a lane already there.
 */
const EPSILON = 1e-6;

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
    /** Where it turns, and which way; `port` when that end is one of its boxes' ports rather than its lane. */
    ends: [End, End];
    track?: number;
    y?: number;
};
type Side = "out" | "in";
type End = { x: number; dir: "up" | "down"; port?: Side };

/** A line's runs, from where its ports and lane are now: one between neighbouring rows, else one at each end of its lane. */
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
 * Ports along one edge of a box for `added` lines, where its `kept` lines keep theirs (`keptAt`), placed as placePorts
 * places them when it has none. Each added line goes in the gap between kept ports it falls in by where it's going (or
 * coming from), and those that share a gap spread through it as placePorts spreads a box's, centred in it. Where a gap
 * is too small for them, each goes to the free place nearest where it's going, in any gap with room for it.
 */
function placePortsAround(
    box: Position,
    added: readonly Line[],
    kept: readonly Line[],
    keptAt: (line: Line) => number,
    approach: (line: Line) => number,
    gap: (a: Line, b: Line) => number,
): Map<string, number> {
    if (kept.length === 0) return placePorts(box, added, approach, gap);
    const [lo, hi] = [box.x + PORT_MARGIN, box.x + BOX_WIDTH - PORT_MARGIN];
    const ordered = [...added].sort((a, b) => approach(a) - approach(b) || byKey(a, b));
    // every port on the edge so far, kept or placed, left to right
    const taken = kept.map((line) => ({ line, x: keptAt(line) })).sort((a, b) => a.x - b.x);
    const fixedLeft = (line: Line): number => taken.filter((t) => approach(t.line) < approach(line) || (approach(t.line) === approach(line) && byKey(t.line, line) < 0)).length;
    const groups = new Map<number, Line[]>();
    for (const line of ordered) groups.set(fixedLeft(line), [...(groups.get(fixedLeft(line)) ?? []), line]);
    const ports = new Map<string, number>();
    const strays: Line[] = [];
    for (const [slot, group] of [...groups].sort((a, b) => a[0] - b[0])){
        const [left, right] = [taken[slot - 1], taken[slot]];
        const from = left === undefined ? lo : left.x + gap(left.line, group[0]);
        const to = right === undefined ? hi : right.x - gap(group[group.length - 1], right.line);
        const offsets = [0];
        for (let i = 1; i < group.length; i++) offsets.push(offsets[i - 1] + gap(group[i - 1], group[i]));
        const total = offsets[offsets.length - 1];
        if (total > to - from + EPSILON){
            strays.push(...group);
            continue;
        }
        const start = (from + to) / 2 - total / 2;
        group.forEach((line, i) => ports.set(line.key, start + offsets[i]));
    }
    for (const [key, x] of ports) taken.push({ line: added.find((l) => l.key === key)!, x });
    // each stray to the free place nearest where it's going, in whichever gap holds it
    for (const line of strays){
        taken.sort((a, b) => a.x - b.x);
        const want = Math.max(lo, Math.min(hi, approach(line)));
        let best: number | undefined;
        for (let i = 0; i <= taken.length; i++){
            const from = i === 0 ? lo : taken[i - 1].x + gap(taken[i - 1].line, line);
            const to = i === taken.length ? hi : taken[i].x - gap(line, taken[i].line);
            if (from > to + EPSILON) continue;
            const x = Math.max(from, Math.min(to, want));
            if (best === undefined || Math.abs(x - want) < Math.abs(best - want)) best = x;
        }
        // no room anywhere on the edge: the middle of its widest gap, closer to its neighbours than it should be
        if (best === undefined){
            const xs = [lo, ...taken.map((t) => t.x), hi];
            const widest = xs.slice(1).reduce((w, x, i) => (x - xs[i] > xs[w + 1] - xs[w] ? i : w), 0);
            best = (xs[widest] + xs[widest + 1]) / 2;
        }
        ports.set(line.key, best);
        taken.push({ line, x: best });
    }
    return ports;
}

/**
 * The ports settle, a channel at a time, so no line wiggles and no two read as one. A sideways step shorter than
 * LEAST_JOG is a wiggle, not a turn (the owner, 2026-10-27, on src/vs/editor's 460-import line), and a line that stops
 * just above where another starts, at about the same x, reads as one line through the channel. Each fault is fixed by
 * moving a port, on its own or with its box's whole row of ports, keeping their order, their room and the box's
 * margins, or a lane, wherever it still clears the boxes and lanes beside it: onto its line's other end so the line
 * drops straight, else LEAST_JOG from it, or out of line with the other line, or the row parting round it. Of the
 * moves at a run's two ends, the one that fixes the most faults its lines take part in is kept, the smallest of those,
 * so the same level always settles the same way. A fault no move fixes stays.
 */
function settlePorts(
    lines: readonly Line[],
    boxes: ReadonlyMap<string, { out: Line[]; into: Line[] }>,
    positions: ReadonlyMap<string, Position>,
    lanes: ReadonlyMap<Line, { fits: (x: number) => boolean; set: (x: number) => void }>,
    fixed: ReadonlySet<Line> = new Set(),
): void {
    // each box edge's ports, in the order they were placed, with the room each pair keeps (less, where they're squeezed)
    type Edge = { box: Position; side: Side; order: Line[]; room: number[] };
    const portOf = (line: Line, side: Side): number => (side === "out" ? line.portOut! : line.portIn!);
    const setPort = (line: Line, side: Side, x: number): void => {
        if (side === "out") line.portOut = x;
        else line.portIn = x;
    };
    const edgeOf = new Map<string, Edge>();
    for (const [path, { out, into }] of boxes){
        for (const [side, group] of [["out", out], ["in", into]] as const){
            if (group.length === 0) continue;
            const order = [...group].sort((a, b) => portOf(a, side) - portOf(b, side));
            const need = (a: Line, b: Line): number => (side === "out" ? (a.width + b.width) / 2 + PORT_GAP_OUT : a.head.half + b.head.half + PORT_GAP_IN);
            const room = order.slice(1).map((b, i) => Math.min(need(order[i], b), portOf(b, side) - portOf(order[i], side)));
            const edge = { box: positions.get(path)!, side, order, room };
            for (const line of group) edgeOf.set(`${side} ${line.key}`, edge);
        }
    }
    const holds = (edge: Edge): boolean => {
        const xs = edge.order.map((l) => portOf(l, edge.side));
        return xs[0] >= edge.box.x + PORT_MARGIN - EPSILON && xs[xs.length - 1] <= edge.box.x + BOX_WIDTH - PORT_MARGIN + EPSILON
            && xs.slice(1).every((x, i) => x - xs[i] >= edge.room[i] - EPSILON);
    };
    const inChannel = new Map<number, Line[]>();
    for (const line of lines){
        for (const k of new Set([line.outChannel, line.intoChannel])) inChannel.set(k, [...(inChannel.get(k) ?? []), line]);
    }
    // each channel's runs, made once and brought up to date with their lines' ports and lanes when read
    const made = new Map<number, Run[]>();
    const runsIn = (k: number): Run[] => {
        if (!made.has(k)) made.set(k, inChannel.get(k)!.flatMap(runsOf).filter((r) => r.channel === k));
        const runs = made.get(k)!;
        // as runsOf makes them: port to port, else port to lane where it leaves and lane to port where it arrives
        for (const { line, arrives, ends } of runs){
            ends[0].x = line.lane === undefined || !arrives ? line.portOut! : line.lane;
            ends[1].x = line.lane === undefined || arrives ? line.portIn! : line.lane;
        }
        return runs;
    };
    const isJog = (run: Run): boolean => {
        const step = Math.abs(run.ends[0].x - run.ends[1].x);
        return step > 0.5 && step < LEAST_JOG - EPSILON;
    };
    // a line turning up at about the x where another turns down: the one stops just above where the other starts
    const nearOf = (a: Run, b: Run): number => (a.line.width + b.line.width) / 2 + LANE_GAP - EPSILON;
    // the faults in channel k that the lines in `among` take part in (every line's, without): a wiggle counts 1, two
    // lines lined up 2. The turns go in CELL-wide cells by x first, so each is only held against those near it.
    const CELL = 16;
    const faults = (k: number, among?: ReadonlySet<Line>): number => {
        const runs = runsIn(k);
        const cells = new Map<number, { run: Run; x: number; dir: "up" | "down" }[]>();
        for (const run of runs){
            for (const { x, dir } of run.ends){
                const cell = Math.floor(x / CELL);
                if (!cells.has(cell)) cells.set(cell, []);
                cells.get(cell)!.push({ run, x, dir });
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
                        if (o.run.line === run.line || o.dir === end.dir || (end.dir === "down" && counted(o.run))) continue;
                        if (Math.abs(o.x - end.x) < nearOf(run, o.run)) count += 2;
                    }
                }
            }
        }
        return count;
    };

    // a move: the lines it moves, the channels it changes, and whether it keeps a row's room or a lane clear of the boxes
    type Move = { cost: number; lines: Set<Line>; channels: number[]; apply: () => void; restore: () => void; valid: () => boolean };
    // whether the end `i` of `run` is in a fault: its run wiggles, or another line turns the other way in line with it
    const inFault = (runs: readonly Run[], run: Run, i: number): boolean => {
        const end = run.ends[i];
        return isJog(run) || runs.some((other) => other.line !== run.line && other.ends.some((o) => o.dir !== end.dir && Math.abs(o.x - end.x) < nearOf(run, other)));
    };
    // the moves that might fix the fault the end `i` of `run` is in
    const movesFor = (k: number, runs: readonly Run[], run: Run, i: number): Move[] => {
        const end = run.ends[i];
        const partner = run.ends[1 - i].x;
        const line = run.line;
        const edge = end.port === undefined ? undefined : edgeOf.get(`${end.port} ${line.key}`)!;
        const moves: Move[] = [];
        if (fixed.has(line)) return moves;
        // a row's kept ports stay put: only the others move with it
        const movable = edge?.order.filter((l) => !fixed.has(l)) ?? [];
        // onto its line's other end or LEAST_JOG from it, and just clear of each other line's turn the other way, whether
        // that one's in the fault or not
        const targets = new Set([partner, partner - LEAST_JOG, partner + LEAST_JOG]);
        for (const other of runs){
            if (other.line === line) continue;
            const away = nearOf(run, other) + 2 * EPSILON;
            for (const o of other.ends){
                if (o.dir === end.dir) continue;
                targets.add(o.x - away).add(o.x + away);
                // or its box's row of ports parts round the other line's turn, each side moving out
                if (edge !== undefined && Math.abs(o.x - end.x) < away){
                    const side = edge.side;
                    const was = edge.order.map((l) => portOf(l, side));
                    const lefts = was.filter((x) => x < o.x);
                    const rights = was.filter((x) => x >= o.x);
                    const [shiftLeft, shiftRight] = [Math.min(0, o.x - away - Math.max(-Infinity, ...lefts)), Math.max(0, o.x + away - Math.min(Infinity, ...rights))];
                    moves.push({
                        cost: Math.abs(shiftLeft) * lefts.length + shiftRight * rights.length,
                        lines: new Set(movable),
                        channels: [k],
                        apply: () => movable.forEach((l) => setPort(l, side, was[edge.order.indexOf(l)] + (was[edge.order.indexOf(l)] < o.x ? shiftLeft : shiftRight))),
                        restore: () => edge.order.forEach((l, j) => setPort(l, side, was[j])),
                        valid: () => holds(edge),
                    });
                }
            }
        }
        for (const x of targets){
            if (edge !== undefined){
                const side = edge.side;
                const shift = x - portOf(line, side);
                if (Math.abs(shift) < EPSILON || x < edge.box.x + PORT_MARGIN - EPSILON || x > edge.box.x + BOX_WIDTH - PORT_MARGIN + EPSILON) continue;
                const was = edge.order.map((l) => portOf(l, side));
                const restore = (): void => edge.order.forEach((l, j) => setPort(l, side, was[j]));
                // the port on its own, else its box's whole row of ports with it
                moves.push({ cost: Math.abs(shift), lines: new Set([line]), channels: [k], apply: () => setPort(line, side, x), restore, valid: () => holds(edge) });
                moves.push({
                    cost: Math.abs(shift) * movable.length,
                    lines: new Set(movable),
                    channels: [k],
                    apply: () => movable.forEach((l) => setPort(l, side, was[edge.order.indexOf(l)] + shift)),
                    restore,
                    valid: () => holds(edge),
                });
            } else {
                // its lane, to anywhere it still clears the boxes and lanes beside it
                const lane = lanes.get(line)!;
                const from = line.lane!;
                if (Math.abs(x - from) < EPSILON) continue;
                moves.push({ cost: Math.abs(x - from), lines: new Set([line]), channels: [line.outChannel, line.intoChannel], apply: () => lane.set(x), restore: () => lane.set(from), valid: () => lane.fits(x) });
            }
        }
        return moves;
    };
    // what a move's lines take part in, over the channels it changes
    const share = (move: Move): number => move.channels.reduce((sum, c) => sum + faults(c, move.lines), 0);

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
    // ends that line up to within rounding line up exactly, so a straight drop has no hairline step
    for (const line of lines){
        if (fixed.has(line)) continue;
        const to = line.lane ?? line.portOut!;
        if (Math.abs(line.portIn! - to) <= 0.5) line.portIn = to;
        if (line.lane !== undefined && Math.abs(line.portOut! - line.lane) <= 0.5) line.portOut = line.lane;
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
 * Every drawn line's route on a laid-out level, by edge key ("source->target"). Rows are the boxes' tops, and every box
 * with a line on the level stands in the way of a lane, drawn or not; the loose ones sit apart in their grid. `drawn`
 * names the lines to route (all of them when it's left out): ports and tracks are shared out among those alone, so a
 * line that isn't drawn leaves no gap. Widths are scaled against the level's heaviest line, drawn or not.
 *
 * `kept` holds routes already on screen, for lines that stay drawn: each keeps its own exactly, and the other lines
 * are routed around them, taking the free places on each box, in each gutter and in each channel (nextRoutes).
 */
export function routeEdges(
    positions: ReadonlyMap<string, Position>,
    edges: readonly MapEdge[],
    drawn?: ReadonlySet<string>,
    kept: ReadonlyMap<string, Point[]> = new Map(),
): Map<string, Point[]> {
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
    // the kept lines take their ports, lane and tracks from their routes, and stay where they are
    const fixed = new Map<Line, Point[]>();
    for (const line of lines){
        const route = kept.get(line.key);
        if (route !== undefined && takeRoute(line, route, tops)) fixed.set(line, route);
    }
    const fresh = lines.filter((l) => !fixed.has(l));

    // 1. lanes, for the lines that pass a row between their channels or point back up: the free place nearest the
    // middle of their two boxes, the lines nearest their lanes placed first
    const placed: { x: number; width: number; span: [number, number] }[] = [];
    const spanOfLine = (line: Line): [number, number] => [Math.min(line.outChannel, line.intoChannel), Math.max(line.outChannel, line.intoChannel)];
    // a kept line's lane, and its ports as if they were lanes in their channels: a new lane can't line up with one there,
    // since a kept port doesn't move out of its way
    for (const line of fixed.keys()){
        if (line.lane !== undefined) placed.push({ x: line.lane, width: line.width, span: spanOfLine(line) });
        placed.push({ x: line.portOut!, width: line.width, span: [line.outChannel, line.outChannel] }, { x: line.portIn!, width: line.width, span: [line.intoChannel, line.intoChannel] });
    }
    const lanesOf = new Map<Line, { rows: (readonly number[])[]; entry: { x: number; width: number; span: [number, number] } }>();
    const laned = fresh.filter((l) => l.outChannel !== l.intoChannel)
        .sort((a, b) => (centreOf(a.s) + centreOf(a.t)) - (centreOf(b.s) + centreOf(b.t)) || byKey(a, b));
    for (const line of laned){
        // its height as the channels it runs between: two lanes overlap when they share any of it (sharesHeight)
        const span = spanOfLine(line);
        const passed = lefts.slice(span[0], span[1]);
        line.lane = placeLane(passed, (centreOf(line.s) + centreOf(line.t)) / 2, line.width, span, placed);
        const entry = { x: line.lane, width: line.width, span };
        placed.push(entry);
        lanesOf.set(line, { rows: passed, entry });
    }

    // 2. ports: each box's leaving lines along its bottom and arriving lines along its top, ordered by where the other
    // end turns (the lane, else the other box), with room for each line and, at the top, each arrowhead; around the
    // kept ones where a box has any
    const boxes = new Map<string, { out: Line[]; into: Line[] }>();
    for (const line of lines){
        if (!boxes.has(line.edge.source)) boxes.set(line.edge.source, { out: [], into: [] });
        if (!boxes.has(line.edge.target)) boxes.set(line.edge.target, { out: [], into: [] });
        boxes.get(line.edge.source)!.out.push(line);
        boxes.get(line.edge.target)!.into.push(line);
    }
    const gapOut = (a: Line, b: Line): number => (a.width + b.width) / 2 + PORT_GAP_OUT;
    const gapIn = (a: Line, b: Line): number => a.head.half + b.head.half + PORT_GAP_IN;
    for (const [path, { out, into }] of boxes){
        const box = positions.get(path)!;
        const outPorts = placePortsAround(box, out.filter((l) => !fixed.has(l)), out.filter((l) => fixed.has(l)), (l) => l.portOut!, (l) => l.lane ?? centreOf(l.t), gapOut);
        const inPorts = placePortsAround(box, into.filter((l) => !fixed.has(l)), into.filter((l) => fixed.has(l)), (l) => l.portIn!, (l) => l.lane ?? centreOf(l.s), gapIn);
        for (const l of out) if (!fixed.has(l)) l.portOut = outPorts.get(l.key);
        for (const l of into) if (!fixed.has(l)) l.portIn = inPorts.get(l.key);
    }

    // a lane that can run right under its leaving port (or over its arriving one) moves there, so the line drops
    // straight out of its box (or into it) instead of jogging over to the gutter's middle
    for (const line of laned){
        const { rows, entry } = lanesOf.get(line)!;
        const others = placed.filter((p) => p !== entry);
        const straight = [line.portOut!, line.portIn!].find((x) => laneFits(rows, x, line.width, entry.span, others));
        if (straight !== undefined) line.lane = entry.x = straight;
    }

    // then the new lines' ports (and where it takes one, a lane) settle: no short jogs, and no two lines lined up end to end
    settlePorts(lines, boxes, positions, new Map(laned.map((line) => {
        const { rows, entry } = lanesOf.get(line)!;
        return [line, {
            fits: (x: number) => laneFits(rows, x, line.width, entry.span, placed.filter((p) => p !== entry)),
            set: (x: number) => { line.lane = entry.x = x; },
        }];
    })), new Set(fixed.keys()));

    // 3. runs along each channel, and the tracks they take: the kept ones where they were
    const runs = fresh.flatMap(runsOf);
    const keptRuns = [...fixed.keys()].flatMap((line) => runsOf(line).map((run) => ({ ...run, y: trackOf(fixed.get(line)!, run.channel, tops) })));
    const byChannel = new Map<number, Run[]>();
    for (const run of runs){
        // a run whose two ends line up is a straight drop through the channel: it needs no track
        if (run.ends[0].x === run.ends[1].x) continue;
        byChannel.set(run.channel, [...(byChannel.get(run.channel) ?? []), run]);
    }
    for (const [channel, inChannel] of byChannel){
        const around = keptRuns.filter((r) => r.channel === channel && r.y !== undefined);
        if (around.length > 0){
            placeRunsAround(channel, inChannel, around, tops);
            continue;
        }
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
 * other line still drawn keeps the one it had, and the lines that just appeared are routed around them all
 * (routeEdges with them kept). So a line never moves while it's drawn: lines appear and fade, and that's all.
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
 * A kept line's ports and lane, read back from its route (routeEdges's kept): its first point is its leaving port,
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
        // above its own arrowhead, and above those of the lines arriving under it
        const under = placed.filter((o) => o.arrives && o.ends[1].x + o.line.head.half + run.line.width / 2 > lo && o.ends[1].x - o.line.head.half - run.line.width / 2 < hi);
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
