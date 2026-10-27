import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, type Position } from "./levelLayout";
import { longestSideMiddle, roundedPath, routeEdges, type Point } from "./routes";

const at = (entries: Record<string, Position>): Map<string, Position> => new Map(Object.entries(entries));
const line = (source: string, target: string): MapEdge => ({ source, target, count: 1 });

describe("routeEdges (owner review: no line may pass through a box)", () => {
    it("draws a line between neighbouring rows as one straight drop when the boxes line up", () => {
        // s's bottom-centre (116, 56) to t's top-centre (116, 120), a layer apart (56 + 64): a straight line
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 0, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 120 }]);
    });

    it("jogs sideways in the channel between neighbouring rows", () => {
        // the channel between y 56 and y 120 runs at y = 88
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 272, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: 388, y: 88 }, { x: 388, y: 120 }]);
    });

    it("goes around a box in a row it skips, down a lane in the gutter beside it", () => {
        // m (0..232 wide, y 120..176) is in the way of s → t; the lanes beside it are 20 px out: x = -20 or 252, and a tie
        // goes to the lower x. Channels: y (0 + 56 + 120) / 2 = 88 under s, y (120 + 56 + 240) / 2 = 208 above t
        const routes = routeEdges(
            at({ s: { x: 0, y: 0 }, m: { x: 0, y: 120 }, t: { x: 0, y: 240 } }),
            [line("s", "m"), line("s", "t")],
        );
        expect(routes.get("s->t")).toEqual([
            { x: 116, y: 56 }, { x: 116, y: 88 }, { x: -20, y: 88 }, { x: -20, y: 208 }, { x: 116, y: 208 }, { x: 116, y: 240 },
        ]);
    });

    it("routes a line that points back up around both rows it passes", () => {
        // s (y 120) imports t (y 0): out under s (y 120 + 56 + 32 = 208, half a rank gap below the last row), up the lane
        // at x = -20 past both rows, and into t from above (y -32)
        const routes = routeEdges(at({ t: { x: 0, y: 0 }, s: { x: 0, y: 120 } }), [line("t", "s"), line("s", "t")]);
        expect(routes.get("s->t")).toEqual([
            { x: 116, y: 176 }, { x: 116, y: 208 }, { x: -20, y: 208 }, { x: -20, y: -32 }, { x: 116, y: -32 }, { x: 116, y: 0 },
        ]);
    });

    it("never crosses a box on a real layout: a wrapped fan of 13 and a layer below it", () => {
        const bs = Array.from({ length: 13 }, (_, i) => `b${i + 1}`);
        const nodes: MapNode[] = ["a", ...bs, "c"].map((p) => ({ path: p, name: p, kind: "folder", fileCount: 1, summaryStatus: "fresh" }));
        const edges = [...bs.map((b) => line("a", b)), line("b1", "c"), line("a", "c"), line("b13", "c")];
        const positions = layoutLevel(nodes, edges);
        const routes = routeEdges(positions, edges);

        for (const edge of edges){
            const points = routes.get(`${edge.source}->${edge.target}`)!;
            for (const [path, box] of positions){
                // the segments may touch their own two boxes at the ends, never the inside of any box
                for (let i = 0; i + 1 < points.length; i++){
                    expect(crossesInside(points[i], points[i + 1], box), `${edge.source}->${edge.target} segment ${i} through ${path}`).toBe(false);
                }
            }
        }
    });
});

/** Whether an axis-aligned segment passes through a box's interior (its edge doesn't count). */
function crossesInside(p: Point, q: Point, box: Position): boolean {
    const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
    const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
    return x1 < box.x + BOX_WIDTH && x2 > box.x && y1 < box.y + BOX_HEIGHT && y2 > box.y;
}

describe("roundedPath and longestSideMiddle", () => {
    it("draws a straight line as one segment", () => {
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 50 }])).toBe("M 0 0 L 0 50");
    });

    it("rounds each corner with an 8 px curve, or half the shorter side when that's less", () => {
        // corner at (0, 20): the sides are 20 and 100 long, so the radius is 8
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }])).toBe("M 0 0 L 0 12 Q 0 20 8 20 L 100 20");
        // corner at (0, 6): the first side is 6 long, so the radius is 3
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 100, y: 6 }])).toBe("M 0 0 L 0 3 Q 0 6 3 6 L 100 6");
    });

    it("puts a line's count in the middle of its longest side", () => {
        // 20 down, then 100 across, then 10 down: the across side is longest, its middle at x = 50
        expect(longestSideMiddle([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 30 }])).toEqual({ x: 50, y: 20 });
        // two sides of 40: the first wins
        expect(longestSideMiddle([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 40, y: 40 }])).toEqual({ x: 0, y: 20 });
    });
});
