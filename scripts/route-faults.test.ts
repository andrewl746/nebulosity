import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import type { Point } from "../app/map/routes";
import {
    afterCommonStart, beforeCommonEnd, drawnAt, drawnAtRest, endsOf, headCrossings, headsOf, linedUp, routeFaults, sharedRuns, shortJogs, widthsOf,
} from "./route-faults";

const pts = (pairs: readonly (readonly [number, number])[]): Point[] => pairs.map(([x, y]) => ({ x, y }));
const routes = (entries: Record<string, readonly (readonly [number, number])[]>): Map<string, Point[]> =>
    new Map(Object.entries(entries).map(([key, points]) => [key, pts(points)]));
const widths = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries));
const keys = (faults: { lines: string[] }[]): string[][] => faults.map((f) => f.lines);
/** Lines that share no end, so each is judged whole, as before the rules knew about merging. */
const apart = (...keys: string[]) => new Map(keys.map((k) => [k, { source: `${k}:s`, target: `${k}:t` }]));
const ends = (entries: Record<string, readonly [string, string]>) => new Map(Object.entries(entries).map(([k, [source, target]]) => [k, { source, target }]));

describe("sharedRuns", () => {
    it("finds two drops closer than their half-widths plus a pixel, alongside over more than a pixel", () => {
        // 2 px lines: they need 1 + 1 + 1 = 3 between centres. 2.5 apart, alongside from y 50 to 100: 50 px
        const found = sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[2.5, 50], [2.5, 200]] }), widths({ a: 2, b: 2 }), apart("a", "b"));
        expect(keys(found)).toEqual([["a", "b"]]);
        expect(found[0].detail).toBe("down at x 0.0 and 2.5, alongside for 50.0 px");
    });

    it("lets them be exactly their half-widths plus a pixel apart", () => {
        expect(sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[3, 50], [3, 200]] }), widths({ a: 2, b: 2 }), apart("a", "b"))).toEqual([]);
    });

    it("lets them meet over a pixel or less", () => {
        // b starts at y 99, a stops at 100: 1 px alongside
        expect(sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[1, 99], [1, 200]] }), widths({ a: 2, b: 2 }), apart("a", "b"))).toEqual([]);
    });

    it("finds two runs across a channel the same way", () => {
        // 1 px lines need 0.5 + 0.5 + 1 = 2: 1.5 apart, alongside from x 50 to 100
        const found = sharedRuns(routes({ a: [[0, 0], [0, 40], [100, 40], [100, 80]], b: [[300, 0], [300, 41.5], [50, 41.5], [50, 80]] }), widths({ a: 1, b: 1 }), apart("a", "b"));
        expect(keys(found)).toEqual([["a", "b"]]);
        expect(found[0].detail).toBe("across at y 40.0 and 41.5, alongside for 50.0 px");
    });

    it("doesn't count a drop that crosses a run", () => {
        expect(sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[-50, 40], [50, 40]] }), widths({ a: 2, b: 2 }), apart("a", "b"))).toEqual([]);
    });
});

describe("shortJogs", () => {
    it("finds a sideways step under 24 px between two drops", () => {
        // a lane at -28 and a port 10 px over at its foot
        const found = shortJogs(routes({ a: [[0, 56], [0, 88], [-28, 88], [-28, 208], [-18, 208], [-18, 240]] }));
        expect(keys(found)).toEqual([["a"]]);
        expect(found[0].detail).toBe("10.0 px sideways at y 208.0");
    });

    it("lets a step of 24 px or more be", () => {
        expect(shortJogs(routes({ a: [[0, 0], [0, 50], [24, 50], [24, 100]], b: [[0, 56], [0, 88], [-28, 88], [-28, 208], [116, 208], [116, 240]] }))).toEqual([]);
    });

    it("counts each short step of a route", () => {
        expect(shortJogs(routes({ a: [[0, 56], [0, 88], [5, 88], [5, 208], [25, 208], [25, 240]] })).map((f) => f.detail))
            .toEqual(["5.0 px sideways at y 88.0", "20.0 px sideways at y 208.0"]);
    });
});

describe("linedUp", () => {
    it("finds a drop that stops less than 48 px above where another starts, nearer than their half-widths plus 8 px", () => {
        // 1 px lines: within 0.5 + 0.5 + 8 = 9. a stops at y 100, b starts at y 140, 5 px over: 40 px apart
        const found = linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 140], [5, 200]] }), widths({ a: 1, b: 1 }), apart("a", "b"));
        expect(keys(found)).toEqual([["a", "b"]]);
        expect(found[0].detail).toBe("drops at x 0.0 and 5.0, 40.0 px apart end to end");
    });

    it("finds it whichever line is above", () => {
        // b stops at y -10, a starts at y 0: 10 px apart
        expect(keys(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, -60], [5, -10]] }), widths({ a: 1, b: 1 }), apart("a", "b")))).toEqual([["a", "b"]]);
    });

    it("lets them be 48 px apart end to end, or their half-widths plus 8 px apart across", () => {
        expect(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 148], [5, 200]] }), widths({ a: 1, b: 1 }), apart("a", "b"))).toEqual([]);
        expect(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[9, 140], [9, 200]] }), widths({ a: 1, b: 1 }), apart("a", "b"))).toEqual([]);
    });

    it("counts drops that meet over a pixel or less as end to end, and leaves longer ones to sharedRuns", () => {
        // b starts 1 px above where a stops: end to end. 20 px alongside: neither stops above the other
        expect(keys(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 99], [5, 200]] }), widths({ a: 1, b: 1 }), apart("a", "b")))).toEqual([["a", "b"]]);
        expect(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 80], [5, 200]] }), widths({ a: 1, b: 1 }), apart("a", "b"))).toEqual([]);
    });
});

describe("headCrossings", () => {
    // t ends at (100, 200) in a 1 px line: its head (weights.ts) is 4.5 either side and 7 long, the tip 3 px above the
    // box at y 197, so the base runs from x 95.5 to 104.5 at y 190
    const t: [number, number][] = [[100, 100], [100, 200]];

    it("finds a run through another line's arrowhead", () => {
        // o's run at y 192, 0.5 either side: at y 191.5 the head is 4.5 × 5.5 / 7 = 3.54 either side of x 100
        const found = headCrossings(routes({ t, o: [[0, 150], [0, 192], [300, 192], [300, 260]] }), widths({ t: 1, o: 1 }), apart("t", "o"), widths({ t: 1, o: 1 }));
        expect(keys(found)).toEqual([["o", "t"]]);
        expect(found[0].detail).toBe("o runs through t's arrowhead, tip at (100.0, 197.0)");
    });

    it("goes by the head's triangle, not the box round it", () => {
        // a drop at x 104 from y 195, 0.5 either side: at y 195 the head is 4.5 × 2 / 7 = 1.29 either side of x 100, so
        // the drop passes clear of the triangle, though inside the box round it. At x 101 it clips the triangle.
        expect(headCrossings(routes({ t, o: [[104, 195], [104, 300]] }), widths({ t: 1, o: 1 }), apart("t", "o"), widths({ t: 1, o: 1 }))).toEqual([]);
        expect(keys(headCrossings(routes({ t, o: [[101, 195], [101, 300]] }), widths({ t: 1, o: 1 }), apart("t", "o"), widths({ t: 1, o: 1 })))).toEqual([["o", "t"]]);
    });

    it("stops another line where it's drawn, at its own head's base, so two heads side by side cross only when they touch", () => {
        // u arrives at x 106: its line stops at y 191, 0.5 either side, 1 px clear of t's base at 104.5. At x 104.5 each
        // line's end runs into the other's head.
        expect(headCrossings(routes({ t, u: [[106, 100], [106, 200]] }), widths({ t: 1, u: 1 }), apart("t", "u"), widths({ t: 1, u: 1 }))).toEqual([]);
        expect(keys(headCrossings(routes({ t, u: [[104.5, 100], [104.5, 200]] }), widths({ t: 1, u: 1 }), apart("t", "u"), widths({ t: 1, u: 1 }))))
            .toEqual([["u", "t"], ["t", "u"]]);
    });
});

describe("afterCommonStart and beforeCommonEnd", () => {
    it("takes off the stretch two lines out of one box share, up to where they part", () => {
        // both drop to y 20 and run right, a turning down at x 100 first
        const [a, b] = afterCommonStart(pts([[0, 0], [0, 20], [100, 20], [100, 200]]), pts([[0, 0], [0, 20], [300, 20], [300, 200]]));
        expect(a).toEqual(pts([[100, 20], [100, 200]]));
        expect(b).toEqual(pts([[100, 20], [300, 20], [300, 200]]));
    });

    it("leaves two lines that start apart whole", () => {
        const [a] = afterCommonStart(pts([[0, 0], [0, 50]]), pts([[5, 0], [5, 50]]));
        expect(a).toEqual(pts([[0, 0], [0, 50]]));
    });

    it("takes off the stretch two lines into one box share, back to where they meet", () => {
        // a from x 116 and b from x 388 meet at x 252 on y 88 and drop into the box together
        const [a, b] = beforeCommonEnd(pts([[116, 56], [116, 88], [252, 88], [252, 120]]), pts([[388, 56], [388, 88], [252, 88], [252, 120]]));
        expect(a).toEqual(pts([[116, 56], [116, 88], [252, 88]]));
        expect(b).toEqual(pts([[388, 56], [388, 88], [252, 88]]));
    });
});

describe("sharedRuns, merge-aware", () => {
    it("lets two lines into one box share their way in", () => {
        const r = routes({ "a->t": [[116, 56], [116, 88], [252, 88], [252, 120]], "b->t": [[388, 56], [388, 88], [252, 88], [252, 120]] });
        expect(sharedRuns(r, widths({ "a->t": 1, "b->t": 1 }), ends({ "a->t": ["a", "t"], "b->t": ["b", "t"] }))).toEqual([]);
    });

    it("still finds two lines into one box running side by side before they meet", () => {
        // a drops at x 0, b at x 1.5, both to y 150, then together to x 100 and down. Past where they meet (1.5, 150),
        // a's drop and b's are 1.5 apart, under 0.5 + 0.5 + 1, alongside from y 50 to 150
        const r = routes({ "a->t": [[0, 0], [0, 150], [100, 150], [100, 200]], "b->t": [[1.5, 50], [1.5, 150], [100, 150], [100, 200]] });
        const found = sharedRuns(r, widths({ "a->t": 1, "b->t": 1 }), ends({ "a->t": ["a", "t"], "b->t": ["b", "t"] }));
        expect(found.map((f) => f.lines)).toEqual([["a->t", "b->t"]]);
        expect(found[0].detail).toBe("down at x 0.0 and 1.5, alongside for 100.0 px");
    });
});

describe("linedUp, merge-aware", () => {
    // s → x stops at y 100, y → t starts at y 140, both at x 0: 40 px apart, in line
    const two = { "s->x": [[0, 0], [0, 100]], "y->t": [[0, 140], [0, 200]] } as const;
    const theirEnds = { "s->x": ["s", "x"], "y->t": ["y", "t"], "s->t": ["s", "t"] } as const;

    it("finds two drops in line with nothing between them", () => {
        expect(linedUp(routes(two), widths({ "s->x": 1, "y->t": 1 }), ends(theirEnds)).map((f) => f.lines)).toEqual([["s->x", "y->t"]]);
    });

    it("reads them as one line when a third line's drop fills the gap", () => {
        // s → t drops from 0 to 200 at x 0, through the gap from 100 to 140
        expect(linedUp(routes({ ...two, "s->t": [[0, 0], [0, 200]] }), widths({ "s->x": 1, "y->t": 1, "s->t": 1 }), ends(theirEnds))).toEqual([]);
    });
});

describe("headCrossings, merge-aware", () => {
    it("lets lines into one box share its head", () => {
        const r = routes({ "a->t": [[100, 100], [100, 200]], "b->t": [[0, 150], [0, 180], [100, 180], [100, 200]] });
        expect(headCrossings(r, widths({ "a->t": 1, "b->t": 1 }), ends({ "a->t": ["a", "t"], "b->t": ["b", "t"] }), widths({ "a->t": 1, "b->t": 1 }))).toEqual([]);
    });

    it("counts a line through a box's head once, however many lines end there", () => {
        // a and b end in t's one head, tip (100, 197); o's run at y 192 runs through it
        const r = routes({ "a->t": [[100, 100], [100, 200]], "b->t": [[50, 100], [50, 180], [100, 180], [100, 200]], "o->x": [[0, 150], [0, 192], [300, 192], [300, 260]] });
        const e = ends({ "a->t": ["a", "t"], "b->t": ["b", "t"], "o->x": ["o", "x"] });
        const w = widths({ "a->t": 1, "b->t": 1, "o->x": 1 });
        expect(headCrossings(r, w, e, w).map((f) => f.lines)).toEqual([["o->x", "a->t"]]);
    });
});

describe("routeFaults", () => {
    it("gathers the four kinds for one set of routes", () => {
        const found = routeFaults(routes({ a: [[0, 0], [0, 50], [10, 50], [10, 100]], b: [[12, 140], [12, 200]] }), widths({ a: 1, b: 1 }), apart("a", "b"), widths({ a: 1, b: 1 }));
        expect(Object.fromEntries(Object.entries(found).map(([kind, faults]) => [kind, faults.length]))).toEqual({ shared: 0, jog: 1, lined: 1, head: 0 });
    });
});

const box = (path: string): MapNode => ({ path, name: path, kind: "folder", fileCount: 1, summaryStatus: "fresh" });
const line = (source: string, target: string, count: number): MapEdge => ({ source, target, count });

describe("drawnAtRest", () => {
    it("draws the strong lines, 2% of the heaviest's imports or more, with Strong links only on", () => {
        // the heaviest carries 100: a line needs 2. a → c's 1 is hidden
        const edges = [line("a", "b", 100), line("a", "c", 1), line("b", "c", 2)];
        expect(drawnAtRest({ nodes: ["a", "b", "c"].map(box), edges })).toEqual(new Set(["a->b", "b->c"]));
    });

    it("draws nothing on a busy level, more than 60 lines", () => {
        const fan = (n: number): MapEdge[] => Array.from({ length: n }, (_, i) => line("hub", `b${i}`, 1));
        const nodes = (n: number): MapNode[] => [box("hub"), ...Array.from({ length: n }, (_, i) => box(`b${i}`))];
        expect(drawnAtRest({ nodes: nodes(61), edges: fan(61) }).size).toBe(0);
        expect(drawnAtRest({ nodes: nodes(60), edges: fan(60) }).size).toBe(60);
    });
});

describe("drawnAt", () => {
    it("draws a weak line when its box is hovered", () => {
        // a → c's 1 import is under 2% of a → b's 100, hidden at rest, drawn when a is hovered
        const edges = [line("a", "b", 100), line("a", "c", 1), line("b", "c", 2)];
        expect(drawnAt({ nodes: ["a", "b", "c"].map(box), edges }, null, "a")).toEqual(new Set(["a->b", "a->c", "b->c"]));
    });
});

describe("endsOf and headsOf", () => {
    it("takes each line's ends from its edge, so a path holding \"->\" stays whole, and gives it its box's one head", () => {
        // into c, 100 and 10 imports: the head is the heavier's width, 6 (10's alone would be 3.5). Into a->b, one import: 1
        const edges = [line("a->b", "c", 100), line("d", "c", 10), line("d", "a->b", 1)];
        expect(endsOf(edges).get("a->b->c")).toEqual({ source: "a->b", target: "c" });
        expect(endsOf(edges).get("d->a->b")).toEqual({ source: "d", target: "a->b" });
        const heads = headsOf(edges);
        expect([...heads.keys()]).toEqual(["a->b->c", "d->c", "d->a->b"]);
        expect(heads.get("a->b->c")).toBeCloseTo(6, 9);
        expect(heads.get("d->c")).toBe(heads.get("a->b->c"));
        expect(heads.get("d->a->b")).toBe(1);
    });
});

describe("widthsOf", () => {
    it("scales each line against the page's heaviest, 1 px to 6", () => {
        // weights.ts: 1 + 5 × ln 10 / ln 100 = 3.5
        const found = widthsOf([line("a", "b", 100), line("a", "c", 10), line("b", "c", 1)]);
        expect([...found.keys()]).toEqual(["a->b", "a->c", "b->c"]);
        expect(found.get("a->b")).toBeCloseTo(6, 9);
        expect(found.get("a->c")).toBeCloseTo(3.5, 9);
        expect(found.get("b->c")).toBe(1);
    });
});
