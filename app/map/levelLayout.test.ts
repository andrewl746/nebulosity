import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, perRowFor } from "./levelLayout";

const node = (p: string): MapNode => ({ path: p, name: p, kind: "folder", fileCount: 1, summaryStatus: "fresh" });

describe("layoutLevel", () => {
    it("puts importers above what they import", () => {
        const at = layoutLevel([node("a"), node("b"), node("c")], [{ source: "a", target: "b", count: 3 }, { source: "b", target: "c", count: 1 }]);
        expect(at.get("a")!.y).toBeLessThan(at.get("b")!.y);
        expect(at.get("b")!.y).toBeLessThan(at.get("c")!.y);
    });

    it("lays out only the heaviest lines, so a dense level stays fast; a box joined by a lighter one stays in the layers", () => {
        const nodes = [node("a"), node("b"), node("c"), node("d")];
        const edges: MapEdge[] = [{ source: "a", target: "b", count: 5 }, { source: "c", target: "a", count: 1 }];
        // every line: c above a above b
        const full = layoutLevel(nodes, edges);
        expect(full.get("c")!.y).toBeLessThan(full.get("a")!.y);
        // only the heaviest line: c is no longer pulled above a, it sits on the top rank beside it, not in the grid with d
        const capped = layoutLevel(nodes, edges, 1);
        expect(capped.get("c")!.y).toBe(capped.get("a")!.y);
        expect(capped.get("a")!.y).toBeLessThan(capped.get("b")!.y);
        // d has no line at all: the grid, beside the layers
        expect(capped.get("d")!.x).toBeGreaterThan(Math.max(...["a", "b", "c"].map((p) => capped.get(p)!.x)) + BOX_WIDTH);
    });

    it("lays boxes with no lines in a grid beside the rest, as tall as the layers, in the level's order", () => {
        const at = layoutLevel([node("a"), node("b"), ...["l1", "l2", "l3", "l4"].map(node)], [{ source: "a", target: "b", count: 1 }]);
        // the layers: a above b, one column, 56 + 64 + 56 = 176 px tall; the grid starts 80 px (two gaps) to their right
        expect(at.get("a")!.x).toBe(at.get("b")!.x);
        expect(at.get("b")!.y - at.get("a")!.y).toBe(BOX_HEIGHT + 64);
        const left = at.get("a")!.x + BOX_WIDTH + 80;
        const top = at.get("a")!.y;
        // 176 px holds floor((176 + 40) / (56 + 40)) = 2 rows, so four loose boxes make 2 × 2, 40 px apart: l1 l2 / l3 l4
        expect(at.get("l1")).toEqual({ x: left, y: top });
        expect(at.get("l2")).toEqual({ x: left + BOX_WIDTH + 40, y: top });
        expect(at.get("l3")).toEqual({ x: left, y: top + BOX_HEIGHT + 40 });
        expect(at.get("l4")).toEqual({ x: left + BOX_WIDTH + 40, y: top + BOX_HEIGHT + 40 });
    });

    it("centres every layer, keeping dagre's order", () => {
        const at = layoutLevel([node("a"), node("b"), node("c")], [{ source: "a", target: "b", count: 1 }, { source: "a", target: "c", count: 1 }]);
        // one box: 232 wide, centred on x = 0 → x = -116; two boxes: 232 + 40 + 232 = 504 wide → x = -252 and 20
        expect(at.get("a")).toEqual({ x: -116, y: 0 });
        expect([at.get("b")!.x, at.get("c")!.x].sort((p, q) => p - q)).toEqual([-252, 20]);
        // the layer below: 56 + 64 = 120 down
        expect([at.get("b")!.y, at.get("c")!.y]).toEqual([120, 120]);
    });

    it("wraps a layer wider than 6 boxes into centred rows, and moves the layers below it down", () => {
        // a imports b1..b13 (one layer of 13), and b1 imports c (the layer below)
        const bs = Array.from({ length: 13 }, (_, i) => `b${i + 1}`);
        const at = layoutLevel(
            [node("a"), ...bs.map(node), node("c")],
            [...bs.map((b) => ({ source: "a", target: b, count: 1 })), { source: "b1", target: "c", count: 1 }],
        );
        // 13 boxes need ceil(13 / 6) = 3 rows, balanced at ceil(13 / 3) = 5 a row: 5, 5 and 3, 96 px apart from y = 120
        const rows = new Map<number, number[]>();
        for (const b of bs) rows.set(at.get(b)!.y, [...(rows.get(at.get(b)!.y) ?? []), at.get(b)!.x]);
        // a full row of 5 is 5 × 232 + 4 × 40 = 1,320 wide, so it starts at -660; a row of 3 is 776 wide, from -388
        expect([...rows].sort(([p], [q]) => p - q).map(([y, xs]) => [y, xs.sort((p, q) => p - q)])).toEqual([
            [120, [-660, -388, -116, 156, 428]],
            [216, [-660, -388, -116, 156, 428]],
            [312, [-388, -116, 156]],
        ]);
        // the layer below starts 64 px under the last row: 312 + 56 + 64 = 432
        expect(at.get("a")).toEqual({ x: -116, y: 0 });
        expect(at.get("c")).toEqual({ x: -116, y: 432 });
    });

    it("wraps at 8 a row when asked (a wide canvas), so a wide layer takes fewer rows", () => {
        const bs = Array.from({ length: 13 }, (_, i) => `b${i + 1}`);
        const at = layoutLevel(
            [node("a"), ...bs.map(node), node("c")],
            [...bs.map((b) => ({ source: "a", target: b, count: 1 })), { source: "b1", target: "c", count: 1 }],
            undefined,
            8,
        );
        // ceil(13 / 8) = 2 rows of ceil(13 / 2) = 7: 7 and 6. A row of 7 is 7 × 232 + 6 × 40 = 1,864 wide, from -932;
        // a row of 6 is 1,592 wide, from -796. The rows sit at 120 and 216, and c at 216 + 56 + 64 = 336
        const rows = new Map<number, number[]>();
        for (const b of bs) rows.set(at.get(b)!.y, [...(rows.get(at.get(b)!.y) ?? []), at.get(b)!.x]);
        expect([...rows].sort(([p], [q]) => p - q).map(([y, xs]) => [y, xs.sort((p, q) => p - q)])).toEqual([
            [120, [-932, -660, -388, -116, 156, 428, 700]],
            [216, [-796, -524, -252, 20, 292, 564]],
        ]);
        expect(at.get("c")).toEqual({ x: -116, y: 336 });
    });

    it("chooses 8 a row on a wide canvas (1,700 px and up) and 6 otherwise", () => {
        expect([perRowFor(0), perRowFor(1440), perRowFor(1699), perRowFor(1700), perRowFor(1907)]).toEqual([6, 6, 6, 8, 8]);
    });

    it("puts the loose boxes below a short stack of tiers when that fits the level larger (final review I3)", () => {
        // a → b and 20 loose boxes. Beside: 2 rows of 10, 2,992 × 176 px, fits a 1440 × 780 canvas at 1440 / (2,992 × 1.15)
        // ≈ 0.42. Below: ceil(√20) = 5 columns, 4 rows, centred under the tiers: 1,320 × (176 + 80 + 344) = 600 px, fits at
        // min(1440 / (1,320 × 1.15), 780 / (600 × 1.15)) ≈ 0.95. Below wins.
        const loose = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
        const at = layoutLevel([node("a"), node("b"), ...loose.map(node)], [{ source: "a", target: "b", count: 1 }]);
        // the grid is 5 × 232 + 4 × 40 = 1,320 wide, centred: from -660; it starts 80 px under b's bottom (176), rows 96 apart
        expect(at.get("l1")).toEqual({ x: -660, y: 256 });
        expect(at.get("l5")).toEqual({ x: 428, y: 256 });
        expect(at.get("l6")).toEqual({ x: -660, y: 352 });
        expect(at.get("l20")).toEqual({ x: 428, y: 544 });
    });

    it("keeps the loose boxes beside a tall chain, where they fit it larger", () => {
        // a chain of 6 is 6 × 56 + 5 × 64 = 656 px tall, which holds floor(696 / 96) = 7 rows, so 4 loose boxes make one
        // column at x = 116 + 80 = 196. Beside: 544 × 656, fits at 1 (capped). Below: 504 × 888, 780 / (888 × 1.15) ≈ 0.76
        const chain = ["c1", "c2", "c3", "c4", "c5", "c6"];
        const at = layoutLevel(
            [...chain, "l1", "l2", "l3", "l4"].map(node),
            chain.slice(1).map((c, i) => ({ source: chain[i], target: c, count: 1 })),
        );
        expect(["l1", "l2", "l3", "l4"].map((l) => at.get(l))).toEqual([
            { x: 196, y: 0 }, { x: 196, y: 96 }, { x: 196, y: 192 }, { x: 196, y: 288 },
        ]);
    });

    it("lays a level with no lines at all in a square-ish grid", () => {
        const at = layoutLevel(["l1", "l2", "l3", "l4"].map(node), []);
        expect([...at.values()]).toEqual([
            { x: 0, y: 0 }, { x: BOX_WIDTH + 40, y: 0 },
            { x: 0, y: BOX_HEIGHT + 40 }, { x: BOX_WIDTH + 40, y: BOX_HEIGHT + 40 },
        ]);
    });

    it("draws boxes 232 × 56: shorter than V1.3.1's first 64, so dense levels fit larger (owner review of a critique)", () => {
        expect([BOX_WIDTH, BOX_HEIGHT]).toEqual([232, 56]);
    });

    it("draws the same level the same way every time", () => {
        const nodes = ["a", "b", "c", "d"].map(node);
        const edges: MapEdge[] = [{ source: "a", target: "c", count: 2 }, { source: "b", target: "c", count: 1 }, { source: "d", target: "a", count: 4 }];
        expect([...layoutLevel(nodes, edges)]).toEqual([...layoutLevel(nodes, edges)]);
    });
});
