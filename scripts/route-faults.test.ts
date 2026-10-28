import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import type { Point } from "../app/map/routes";
import { drawnAtRest, headCrossings, linedUp, routeFaults, sharedRuns, shortJogs, widthsOf } from "./route-faults";

const routes = (entries: Record<string, [number, number][]>): Map<string, Point[]> =>
    new Map(Object.entries(entries).map(([key, points]) => [key, points.map(([x, y]) => ({ x, y }))]));
const widths = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries));
const keys = (faults: { lines: string[] }[]): string[][] => faults.map((f) => f.lines);

describe("sharedRuns", () => {
    it("finds two drops closer than their half-widths plus a pixel, alongside over more than a pixel", () => {
        // 2 px lines: they need 1 + 1 + 1 = 3 between centres. 2.5 apart, alongside from y 50 to 100: 50 px
        const found = sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[2.5, 50], [2.5, 200]] }), widths({ a: 2, b: 2 }));
        expect(keys(found)).toEqual([["a", "b"]]);
        expect(found[0].detail).toBe("down at x 0.0 and 2.5, alongside for 50.0 px");
    });

    it("lets them be exactly their half-widths plus a pixel apart", () => {
        expect(sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[3, 50], [3, 200]] }), widths({ a: 2, b: 2 }))).toEqual([]);
    });

    it("lets them meet over a pixel or less", () => {
        // b starts at y 99, a stops at 100: 1 px alongside
        expect(sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[1, 99], [1, 200]] }), widths({ a: 2, b: 2 }))).toEqual([]);
    });

    it("finds two runs across a channel the same way", () => {
        // 1 px lines need 0.5 + 0.5 + 1 = 2: 1.5 apart, alongside from x 50 to 100
        const found = sharedRuns(routes({ a: [[0, 0], [0, 40], [100, 40], [100, 80]], b: [[300, 0], [300, 41.5], [50, 41.5], [50, 80]] }), widths({ a: 1, b: 1 }));
        expect(keys(found)).toEqual([["a", "b"]]);
        expect(found[0].detail).toBe("across at y 40.0 and 41.5, alongside for 50.0 px");
    });

    it("doesn't count a drop that crosses a run", () => {
        expect(sharedRuns(routes({ a: [[0, 0], [0, 100]], b: [[-50, 40], [50, 40]] }), widths({ a: 2, b: 2 }))).toEqual([]);
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
        const found = linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 140], [5, 200]] }), widths({ a: 1, b: 1 }));
        expect(keys(found)).toEqual([["a", "b"]]);
        expect(found[0].detail).toBe("drops at x 0.0 and 5.0, 40.0 px apart end to end");
    });

    it("finds it whichever line is above", () => {
        // b stops at y -10, a starts at y 0: 10 px apart
        expect(keys(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, -60], [5, -10]] }), widths({ a: 1, b: 1 })))).toEqual([["a", "b"]]);
    });

    it("lets them be 48 px apart end to end, or their half-widths plus 8 px apart across", () => {
        expect(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 148], [5, 200]] }), widths({ a: 1, b: 1 }))).toEqual([]);
        expect(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[9, 140], [9, 200]] }), widths({ a: 1, b: 1 }))).toEqual([]);
    });

    it("counts drops that meet over a pixel or less as end to end, and leaves longer ones to sharedRuns", () => {
        // b starts 1 px above where a stops: end to end. 20 px alongside: neither stops above the other
        expect(keys(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 99], [5, 200]] }), widths({ a: 1, b: 1 })))).toEqual([["a", "b"]]);
        expect(linedUp(routes({ a: [[0, 0], [0, 100]], b: [[5, 80], [5, 200]] }), widths({ a: 1, b: 1 }))).toEqual([]);
    });
});

describe("headCrossings", () => {
    // t ends at (100, 200) in a 1 px line: its head (weights.ts) is 4.5 either side and 7 long, the tip 3 px above the
    // box at y 197, so the base runs from x 95.5 to 104.5 at y 190
    const t: [number, number][] = [[100, 100], [100, 200]];

    it("finds a run through another line's arrowhead", () => {
        // o's run at y 192, 0.5 either side: at y 191.5 the head is 4.5 × 5.5 / 7 = 3.54 either side of x 100
        const found = headCrossings(routes({ t, o: [[0, 150], [0, 192], [300, 192], [300, 260]] }), widths({ t: 1, o: 1 }));
        expect(keys(found)).toEqual([["o", "t"]]);
        expect(found[0].detail).toBe("o runs through t's arrowhead, tip at (100.0, 197.0)");
    });

    it("goes by the head's triangle, not the box round it", () => {
        // a drop at x 104 from y 195, 0.5 either side: at y 195 the head is 4.5 × 2 / 7 = 1.29 either side of x 100, so
        // the drop passes clear of the triangle, though inside the box round it. At x 101 it clips the triangle.
        expect(headCrossings(routes({ t, o: [[104, 195], [104, 300]] }), widths({ t: 1, o: 1 }))).toEqual([]);
        expect(keys(headCrossings(routes({ t, o: [[101, 195], [101, 300]] }), widths({ t: 1, o: 1 })))).toEqual([["o", "t"]]);
    });

    it("stops another line where it's drawn, at its own head's base, so two heads side by side cross only when they touch", () => {
        // u arrives at x 106: its line stops at y 191, 0.5 either side, 1 px clear of t's base at 104.5. At x 104.5 each
        // line's end runs into the other's head.
        expect(headCrossings(routes({ t, u: [[106, 100], [106, 200]] }), widths({ t: 1, u: 1 }))).toEqual([]);
        expect(keys(headCrossings(routes({ t, u: [[104.5, 100], [104.5, 200]] }), widths({ t: 1, u: 1 })))).toEqual([["u", "t"], ["t", "u"]]);
    });
});

describe("routeFaults", () => {
    it("gathers the four kinds for one set of routes", () => {
        const found = routeFaults(routes({ a: [[0, 0], [0, 50], [10, 50], [10, 100]], b: [[12, 140], [12, 200]] }), widths({ a: 1, b: 1 }));
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
