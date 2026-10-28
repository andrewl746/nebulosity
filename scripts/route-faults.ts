import type { LevelResponse } from "../lib/contracts";
import { edgeKey, isBusyLevel, mapEmphasis } from "../app/map/emphasis";
import type { Point } from "../app/map/routes";
import { arrowHead, lineWidth, maxImportsOf } from "../app/map/weights";

/*
 * The routing faults the owner flags on sight (2026-10-27), counted over a set of routed lines (scripts/check-routes.ts):
 * two lines sharing a run, a wiggle, two lines in line end to end, and a line through another's arrowhead. Pure, so each
 * rule is tested on its own (route-faults.test.ts), apart from the routing it checks.
 */

export type FaultKind = "shared" | "jog" | "lined" | "head";
export const FAULT_KINDS: readonly FaultKind[] = ["shared", "jog", "lined", "head"];
/** One fault: the lines in it, by edge key, and where it is. */
export type Fault = { kind: FaultKind; lines: string[]; detail: string };

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

/** Each pair of lines, once, in the order the routes came. */
function pairs<T>(entries: readonly T[]): [T, T][] {
    const found: [T, T][] = [];
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) found.push([entries[i], entries[j]]);
    return found;
}

/** Two lines sharing a run: parallel pieces closer than their half-widths plus a pixel, alongside for more than a pixel. */
export function sharedRuns(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>): Fault[] {
    const found: Fault[] = [];
    for (const [[ka, a], [kb, b]] of pairs([...routes].map(([key, points]) => [key, segmentsOf(points)] as const))){
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
 * count as end to end; past that they're alongside, which sharedRuns judges.
 */
export function linedUp(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>): Fault[] {
    const found: Fault[] = [];
    const drops = [...routes].map(([key, points]) => [key, segmentsOf(points).filter((s) => s.vertical)] as const);
    for (const [[ka, a], [kb, b]] of pairs(drops)){
        const near = (widths.get(ka)! + widths.get(kb)!) / 2 + LINED_ROOM - EPSILON;
        for (const u of a){
            for (const v of b){
                const apart = Math.max(u.lo, v.lo) - Math.min(u.hi, v.hi);
                if (Math.abs(u.at - v.at) >= near || apart < -SHARED_ROOM - EPSILON || apart >= LINED_REACH - EPSILON) continue;
                found.push({ kind: "lined", lines: [ka, kb], detail: `drops at x ${fixed(u.at)} and ${fixed(v.at)}, ${fixed(Math.max(0, apart))} px apart end to end` });
            }
        }
    }
    return found;
}

/**
 * A line through another's arrowhead: any of its pieces, as wide as the line, overlapping the head's triangle. Each line
 * is taken as RoutedEdge draws it, stopping at its own head's base, so two heads side by side count only once one's line
 * runs into the other. Each pair counts once, the line that runs through first.
 */
export function headCrossings(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>): Fault[] {
    const drawn = new Map([...routes].map(([key, points]) => {
        const end = points[points.length - 1];
        const { length } = arrowHead(widths.get(key)!);
        return [key, segmentsOf([...points.slice(0, -1), { x: end.x, y: end.y - TIP_GAP - length + 1 }])];
    }));
    const found: Fault[] = [];
    for (const [head, points] of routes){
        const { half, length } = arrowHead(widths.get(head)!);
        const end = points[points.length - 1];
        const tip = { x: end.x, y: end.y - TIP_GAP };
        const base = tip.y - length;
        for (const [other, segments] of drawn){
            if (other === head) continue;
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
            if (hit) found.push({ kind: "head", lines: [other, head], detail: `${other} runs through ${head}'s arrowhead, tip at (${fixed(tip.x)}, ${fixed(tip.y)})` });
        }
    }
    return found;
}

/** The four kinds of fault in one set of routes. */
export function routeFaults(routes: ReadonlyMap<string, Point[]>, widths: ReadonlyMap<string, number>): Record<FaultKind, Fault[]> {
    return { shared: sharedRuns(routes, widths), jog: shortJogs(routes), lined: linedUp(routes, widths), head: headCrossings(routes, widths) };
}

/**
 * The lines a page draws at rest, as MapCanvas routes them once: Strong links only on (its default), nothing selected,
 * hovered or lit, and a busy level's lines quiet.
 */
export function drawnAtRest(level: Pick<LevelResponse, "nodes" | "edges">): Set<string> {
    const { edges } = mapEmphasis(level.nodes.map((n) => n.path), level.edges, null, null, { strongOnly: true, quietLines: isBusyLevel(level.edges.length) });
    return new Set(level.edges.map(edgeKey).filter((key) => edges.get(key) !== "hidden"));
}

/** Each line's width, scaled against the page's heaviest line (weights.ts), by edge key. */
export function widthsOf(edges: LevelResponse["edges"]): Map<string, number> {
    const max = maxImportsOf(edges);
    return new Map(edges.map((e) => [edgeKey(e), lineWidth(e.count, max)]));
}
