import type { LevelResponse } from "../lib/contracts";
import { edgeKey, isBusyLevel, mapEmphasis } from "../app/map/emphasis";
import type { Point } from "../app/map/routes";
import { arrowHead, boxHeadWidths, lineWidth, maxImportsOf } from "../app/map/weights";

/*
 * The routing faults the owner flags on sight (2026-10-27), counted over a set of routed lines (scripts/check-routes.ts):
 * two lines sharing a run, a wiggle, two lines in line end to end, and a line through another's arrowhead. Lines that
 * share an end merge (2026-10-28): two out of one box leave by one point and run together till they part, and two into
 * one box meet and go in together under its one head. So a pair that shares an end is judged only past the stretch they
 * share, and the lines into a box share its head. Pure, so each rule is tested on its own (route-faults.test.ts), apart
 * from the routing it checks.
 */

export type FaultKind = "shared" | "jog" | "lined" | "head";
export const FAULT_KINDS: readonly FaultKind[] = ["shared", "jog", "lined", "head"];
/** One fault: the lines in it, by edge key, and where it is. */
export type Fault = { kind: FaultKind; lines: string[]; detail: string };
/** Each line's two boxes, by edge key. The rules tell lines that share an end by these, not the key, since a path may hold "->". */
export type LineEnds = ReadonlyMap<string, { source: string; target: string }>;

/** Two parallel runs share one when they're closer than their half-widths plus this, over more than this. */
const SHARED_ROOM = 1;
/** A sideways step shorter than this is a wiggle, not a turn (routes.ts's LEAST_JOG). */
const LEAST_JOG = 24;
/** One drop stopping less than LINED_REACH above where another starts, closer across than their half-widths plus LINED_ROOM, reads as one line. */
const LINED_REACH = 48;
const LINED_ROOM = 8;
/** How far above the box's top a line's arrowhead stops (RoutedEdge's TIP_GAP). */
const TIP_GAP = 3;
/** The rules are compared this loosely, so routing's sums that land exactly on a limit, give or take rounding, pass. */
const EPSILON = 1e-6;
/** Two points closer than this on both axes are one, where two lines leave or meet together. */
const SAME = 1e-6;

type Segment = { vertical: boolean; at: number; lo: number; hi: number };

/** A route's straight pieces, each down (at its x) or across (at its y), from lo to hi along it. */
function segmentsOf(points: readonly Point[]): Segment[] {
    return points.slice(1).map((q, i) => {
        const p = points[i];
        return p.x === q.x
            ? { vertical: true, at: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) }
            : { vertical: false, at: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) };
    });
}

const fixed = (n: number): string => n.toFixed(1);
const same = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < SAME && Math.abs(p.y - q.y) < SAME;

/**
 * What's left of two routes past the stretch they share from their first points, as two lines out of one box share
 * their way out. They're walked together while the next stretch of each goes the same way along the same line, each
 * time to the nearer of their next corners, up to the first corner where they part or where either ends, and each comes
 * back from that point on. Two routes that start apart come back whole.
 */
export function afterCommonStart(a: readonly Point[], b: readonly Point[]): [Point[], Point[]] {
    if (a.length < 2 || b.length < 2 || !same(a[0], b[0])) return [[...a], [...b]];
    let at = a[0];
    let i = 1;
    let j = 1;
    while (i < a.length && j < b.length){
        const [ax, ay, bx, by] = [a[i].x - at.x, a[i].y - at.y, b[j].x - at.x, b[j].y - at.y];
        const across = Math.abs(ay) < SAME && Math.abs(by) < SAME && ax !== 0 && Math.sign(ax) === Math.sign(bx);
        const down = Math.abs(ax) < SAME && Math.abs(bx) < SAME && ay !== 0 && Math.sign(ay) === Math.sign(by);
        if (!across && !down) break;
        at = (across ? Math.abs(ax) <= Math.abs(bx) : Math.abs(ay) <= Math.abs(by)) ? a[i] : b[j];
        // past each corner reached, and both where they turn at the same one
        if (same(at, a[i])) i++;
        if (same(at, b[j])) j++;
    }
    return [[at, ...a.slice(i)], [at, ...b.slice(j)]];
}

/** The same from their last points, as two lines into one box share their way in: what's left of each before they meet. */
export function beforeCommonEnd(a: readonly Point[], b: readonly Point[]): [Point[], Point[]] {
    const [ra, rb] = afterCommonStart([...a].reverse(), [...b].reverse());
    return [ra.reverse(), rb.reverse()];
}

/** Each pair of lines, once, in the order the routes came. */
function pairs<T>(entries: readonly T[]): [T, T][] {
    const found: [T, T][] = [];
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) found.push([entries[i], entries[j]]);
    return found;
}

/**
 * Each pair of lines as the pair rules judge them: two out of one box past where they part, two into one box before
 * where they meet, since running together there is the merge, not a fault. Any other pair whole.
 */
function judgedPairs(routes: ReadonlyMap<string, Point[]>, ends: LineEnds): [[string, Point[]], [string, Point[]]][] {
    return pairs([...routes]).map(([[ka, a], [kb, b]]) => {
        const [ea, eb] = [ends.get(ka)!, ends.get(kb)!];
        const [pa, pb] = ea.source === eb.source ? afterCommonStart(a, b) : ea.target === eb.target ? beforeCommonEnd(a, b) : [a, b];
        return [[ka, pa], [kb, pb]];
    });
}

/**
 * Two lines sharing a run: parallel pieces closer than their half-widths plus a pixel, alongside for more than a pixel.
 * Two lines that share an end are judged past what they share, so running side by side before they meet still counts.
 */
export function sharedRuns(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>, ends: LineEnds): Fault[] {
    const found: Fault[] = [];
    for (const [[ka, pa], [kb, pb]] of judgedPairs(routes, ends)){
        const [a, b] = [segmentsOf(pa), segmentsOf(pb)];
        const room = (widths.get(ka)! + widths.get(kb)!) / 2 + SHARED_ROOM - EPSILON;
        for (const u of a){
            for (const v of b){
                const alongside = Math.min(u.hi, v.hi) - Math.max(u.lo, v.lo);
                if (u.vertical !== v.vertical || Math.abs(u.at - v.at) >= room || alongside <= SHARED_ROOM + EPSILON) continue;
                const way = u.vertical ? "down at x" : "across at y";
                found.push({ kind: "shared", lines: [ka, kb], detail: `${way} ${fixed(u.at)} and ${fixed(v.at)}, alongside for ${fixed(alongside)} px` });
            }
        }
    }
    return found;
}

/** A sideways step under LEAST_JOG between two drops: a wiggle, not a turn. */
export function shortJogs(routes: ReadonlyMap<string, Point[]>): Fault[] {
    const found: Fault[] = [];
    for (const [key, points] of routes){
        // a route starts and ends going down, so its steps across are the pieces between
        for (const s of segmentsOf(points).slice(1, -1)){
            const step = s.hi - s.lo;
            if (!s.vertical && step > 0 && step < LEAST_JOG - EPSILON) found.push({ kind: "jog", lines: [key], detail: `${fixed(step)} px sideways at y ${fixed(s.at)}` });
        }
    }
    return found;
}

/**
 * Two lines in line end to end: one's drop stops less than LINED_REACH above where the other's starts, their x's closer
 * than their half-widths plus LINED_ROOM, so the two read as one line. Drops alongside each other for a pixel or less
 * count as end to end; past that they're alongside, which sharedRuns judges. Pairs are judged as sharedRuns judges
 * them, and two drops at exactly one x whose gap a third line's drop fills are the one line they look like, the third's
 * trunk, so they don't count.
 */
export function linedUp(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>, ends: LineEnds): Fault[] {
    const drops = (points: readonly Point[]): Segment[] => segmentsOf(points).filter((s) => s.vertical);
    const whole = [...routes].map(([key, points]) => [key, drops(points)] as const);
    const filled = (ka: string, kb: string, x: number, from: number, to: number): boolean => whole.some(([key, ds]) => key !== ka && key !== kb
        && ds.some((d) => Math.abs(d.at - x) < SAME && d.lo <= from + SAME && d.hi >= to - SAME));
    const found: Fault[] = [];
    for (const [[ka, pa], [kb, pb]] of judgedPairs(routes, ends)){
        const [a, b] = [drops(pa), drops(pb)];
        const near = (widths.get(ka)! + widths.get(kb)!) / 2 + LINED_ROOM - EPSILON;
        for (const u of a){
            for (const v of b){
                const apart = Math.max(u.lo, v.lo) - Math.min(u.hi, v.hi);
                if (Math.abs(u.at - v.at) >= near || apart < -SHARED_ROOM - EPSILON || apart >= LINED_REACH - EPSILON) continue;
                if (Math.abs(u.at - v.at) < SAME && filled(ka, kb, u.at, Math.min(u.hi, v.hi), Math.max(u.lo, v.lo))) continue;
                found.push({ kind: "lined", lines: [ka, kb], detail: `drops at x ${fixed(u.at)} and ${fixed(v.at)}, ${fixed(Math.max(0, apart))} px apart end to end` });
            }
        }
    }
    return found;
}

/**
 * A line through a box's arrowhead: any of its pieces, as wide as the line, overlapping the head's triangle. A box has
 * one head, sized for the heaviest line into it (`heads`, by edge key), that the lines into it share, so a line into
 * the same box never counts, and a line counts once for each box whose head it runs through, however many lines end
 * there. Each line is taken as RoutedEdge draws it, stopping at its head's base, so two heads side by side count only
 * once one's line runs into the other. Each fault names the line that runs through first.
 */
export function headCrossings(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>, ends: LineEnds, heads: ReadonlyMap<string, number>): Fault[] {
    const drawn = new Map([...routes].map(([key, points]) => {
        const end = points[points.length - 1];
        const { length } = arrowHead(heads.get(key)!);
        return [key, segmentsOf([...points.slice(0, -1), { x: end.x, y: end.y - TIP_GAP - length + 1 }])];
    }));
    const found: Fault[] = [];
    // the boxes whose head each line has been found running through
    const through = new Map<string, Set<string>>();
    for (const [head, points] of routes){
        const box = ends.get(head)!.target;
        const { half, length } = arrowHead(heads.get(head)!);
        const end = points[points.length - 1];
        const tip = { x: end.x, y: end.y - TIP_GAP };
        const base = tip.y - length;
        for (const [other, segments] of drawn){
            // the lines into this box share the head, its own line among them, and a line already through it counts once
            if (ends.get(other)!.target === box || through.get(other)?.has(box)) continue;
            const w = widths.get(other)! / 2;
            const hit = segments.some((s) => {
                // the piece as a box, as wide as its line across it
                const [x0, x1, y0, y1] = s.vertical ? [s.at - w, s.at + w, s.lo, s.hi] : [s.lo, s.hi, s.at - w, s.at + w];
                // the head narrows to its tip, so it's widest where the piece first meets it: its highest point inside
                const y = Math.max(y0, base);
                if (y >= Math.min(y1, tip.y) - EPSILON) return false;
                const reach = (half * (tip.y - y)) / length;
                return x0 < tip.x + reach - EPSILON && x1 > tip.x - reach + EPSILON;
            });
            if (!hit) continue;
            found.push({ kind: "head", lines: [other, head], detail: `${other} runs through ${head}'s arrowhead, tip at (${fixed(tip.x)}, ${fixed(tip.y)})` });
            through.set(other, (through.get(other) ?? new Set<string>()).add(box));
        }
    }
    return found;
}

/** The four kinds of fault in one set of routes. */
export function routeFaults(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>, ends: LineEnds, heads: ReadonlyMap<string, number>): Record<FaultKind, Fault[]> {
    return { shared: sharedRuns(routes, widths, ends), jog: shortJogs(routes), lined: linedUp(routes, widths, ends), head: headCrossings(routes, widths, ends, heads) };
}

/**
 * The lines a page draws with `selected` selected and the pointer on `hovered`, as MapCanvas decides: Strong links only
 * on (its default), nothing lit, and a busy level's lines quiet, so only the selection's and the hovered box's show.
 */
export function drawnAt(level: Pick<LevelResponse, "nodes" | "edges">, selected: string | null = null, hovered: string | null = null): Set<string> {
    const { edges } = mapEmphasis(level.nodes.map((n) => n.path), level.edges, selected, hovered, { strongOnly: true, quietLines: isBusyLevel(level.edges.length) });
    return new Set(level.edges.map(edgeKey).filter((key) => edges.get(key) !== "hidden"));
}

/** The lines a page draws at rest, as MapCanvas routes them once: nothing selected, hovered or lit. */
export function drawnAtRest(level: Pick<LevelResponse, "nodes" | "edges">): Set<string> {
    return drawnAt(level);
}

/** Each line's width, scaled against the page's heaviest line (weights.ts), by edge key. */
export function widthsOf(edges: LevelResponse["edges"]): Map<string, number> {
    const max = maxImportsOf(edges);
    return new Map(edges.map((e) => [edgeKey(e), lineWidth(e.count, max)]));
}

/** Each line's two boxes, by edge key, the rules' LineEnds. */
export function endsOf(edges: LevelResponse["edges"]): Map<string, { source: string; target: string }> {
    return new Map(edges.map((e) => [edgeKey(e), { source: e.source, target: e.target }]));
}

/** Each line's head width, by edge key: its box's one head (weights.ts's boxHeadWidths). A line from a box to itself isn't drawn, so has none. */
export function headsOf(edges: LevelResponse["edges"]): Map<string, number> {
    const heads = boxHeadWidths(edges);
    return new Map(edges.filter((e) => e.source !== e.target).map((e) => [edgeKey(e), heads.get(e.target)!]));
}
