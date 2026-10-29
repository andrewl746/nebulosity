import { describe, expect, it } from "vitest";
import type { Point } from "./routes";
import { linesSharing, nearestOnRoute, pointedBits } from "./runs";

const p = (x: number, y: number): Point => ({ x, y });

// Three lines into one box whose point is at (100, 200), merged as routes.ts merges them: a and b come along the track
// at y 100 from either side and turn down at x 100, c drops straight from above, so from (100, 100) down all three are
// one run. d only crosses that run, level, at y 150.
const routes = new Map<string, Point[]>([
    ["a->t", [p(0, 0), p(0, 100), p(100, 100), p(100, 200)]],
    ["b->t", [p(200, 0), p(200, 100), p(100, 100), p(100, 200)]],
    ["c->t", [p(100, 0), p(100, 200)]],
    ["d->e", [p(50, 150), p(150, 150)]],
]);
const all = new Set(routes.keys());

describe("nearestOnRoute", () => {
    it("finds the point of the route nearest the pointer, and the segment it's on", () => {
        // 6 px right of a's first drop, 40 down it
        expect(nearestOnRoute(routes.get("a->t")!, p(6, 40))).toEqual({ point: p(0, 40), segment: 0 });
        // 3 px under a's track, at x 60
        expect(nearestOnRoute(routes.get("a->t")!, p(60, 103))).toEqual({ point: p(60, 100), segment: 1 });
    });

    it("gives a corner to the segment that reaches it, the first of the two", () => {
        expect(nearestOnRoute(routes.get("a->t")!, p(-5, 105))).toEqual({ point: p(0, 100), segment: 0 });
    });

    it("has nothing to say about a route of one point", () => {
        expect(nearestOnRoute([p(0, 0)], p(1, 1))).toBeNull();
    });
});

describe("linesSharing (the owner, 2026-10-29: which line is the hover about?)", () => {
    it("names every drawn line on the run under the pointer, sorted, whichever of them caught it", () => {
        // 4 px beside the drop into the box, 50 above it: a, b and c all run down there
        const lines = ["a->t", "b->t", "c->t"];
        expect(linesSharing("a->t", p(104, 150), routes, all)?.lines).toEqual(lines);
        expect(linesSharing("c->t", p(97, 150), routes, all)?.lines).toEqual(lines);
    });

    it("leaves out a line that only crosses the run there", () => {
        // d crosses the drop at (100, 150), level, so it isn't on the run, and the run isn't on d's
        expect(linesSharing("a->t", p(100, 150), routes, all)?.lines).not.toContain("d->e");
        expect(linesSharing("d->e", p(100, 151), routes, all)?.lines).toEqual(["d->e"]);
    });

    it("is one line on a stretch it has to itself, and two where two share it", () => {
        // a's track from x 0 to 100 is its own; b's from 200 to 100 is its own, and c's drop above y 100 is c's
        expect(linesSharing("a->t", p(50, 102), routes, all)?.lines).toEqual(["a->t"]);
        expect(linesSharing("b->t", p(150, 98), routes, all)?.lines).toEqual(["b->t"]);
        expect(linesSharing("c->t", p(100, 50), routes, all)?.lines).toEqual(["c->t"]);
    });

    it("counts only the lines drawn: a hidden line's route says nothing", () => {
        expect(linesSharing("a->t", p(100, 150), routes, new Set(["a->t", "c->t"]))?.lines).toEqual(["a->t", "c->t"]);
    });

    it("takes routes within rounding of each other for one run, and a lane's gap apart for two", () => {
        const near = new Map([...routes, ["f->t", [p(100.5, 120), p(100.5, 200)]], ["g->h", [p(102, 120), p(102, 200)]]]);
        const lines = linesSharing("a->t", p(100, 150), near, new Set(near.keys()))?.lines;
        expect(lines).toContain("f->t");
        expect(lines).not.toContain("g->h");
    });

    it("gives the point the pointer is nearest on the hovered line and its segment, for the hover card", () => {
        expect(linesSharing("a->t", p(104, 150), routes, all)).toMatchObject({ point: p(100, 150), segment: 2 });
    });

    it("has nothing to say about a line with no route", () => {
        expect(linesSharing("x->y", p(0, 0), routes, all)).toBeNull();
    });
});

describe("pointedBits (what the hover card keeps off)", () => {
    // down 100 and right 100 in the Map's own coordinates, panned to (10, 20) at 2x: on screen (10, 20), (10, 220), (210, 220)
    const route = [p(0, 0), p(0, 100), p(100, 100)];
    const view = { x: 10, y: 20, zoom: 2 };
    const head = { half: 6, length: 10 };

    it("is each segment within 40 px of the pointer, as wide as the line on screen and 3 px more each side", () => {
        // a 4 px line at 2x is 8 px wide, so 4 + 3 = 7 px each side of the segment; the level one is 100 px away
        expect(pointedBits(route, p(12, 120), view, 4, head)).toEqual([{ left: 3, top: 13, width: 14, height: 214 }]);
    });

    it("takes in the arrowhead near the pointer, its tip 3 px over the box and as long and wide as it's drawn", () => {
        // the tip at (100, 97) is (210, 214) on screen; the head is 6 × 2 + 3 = 15 px each side and 10 × 2 = 20 long
        expect(pointedBits(route, p(200, 215), view, 4, head)).toEqual([
            { left: 3, top: 213, width: 214, height: 14 },
            { left: 195, top: 194, width: 30, height: 20 },
        ]);
    });
});
