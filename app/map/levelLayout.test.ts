import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel } from "./levelLayout";

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
        // the layers: a above b, one column, 64 + 72 + 64 = 200 px tall; the grid starts 80 px (two gaps) to their right
        expect(at.get("a")!.x).toBe(at.get("b")!.x);
        expect(at.get("b")!.y - at.get("a")!.y).toBe(BOX_HEIGHT + 72);
        const left = at.get("a")!.x + BOX_WIDTH + 80;
        const top = at.get("a")!.y;
        // 200 px holds floor((200 + 40) / (64 + 40)) = 2 rows, so four loose boxes make 2 × 2, 40 px apart: l1 l2 / l3 l4
        expect(at.get("l1")).toEqual({ x: left, y: top });
        expect(at.get("l2")).toEqual({ x: left + BOX_WIDTH + 40, y: top });
        expect(at.get("l3")).toEqual({ x: left, y: top + BOX_HEIGHT + 40 });
        expect(at.get("l4")).toEqual({ x: left + BOX_WIDTH + 40, y: top + BOX_HEIGHT + 40 });
    });

    it("lays a level with no lines at all in a square-ish grid", () => {
        const at = layoutLevel(["l1", "l2", "l3", "l4"].map(node), []);
        expect([...at.values()]).toEqual([
            { x: 0, y: 0 }, { x: BOX_WIDTH + 40, y: 0 },
            { x: 0, y: BOX_HEIGHT + 40 }, { x: BOX_WIDTH + 40, y: BOX_HEIGHT + 40 },
        ]);
    });

    it("draws the refresh's larger boxes: 232 × 64", () => {
        expect([BOX_WIDTH, BOX_HEIGHT]).toEqual([232, 64]);
    });

    it("draws the same level the same way every time", () => {
        const nodes = ["a", "b", "c", "d"].map(node);
        const edges: MapEdge[] = [{ source: "a", target: "c", count: 2 }, { source: "b", target: "c", count: 1 }, { source: "d", target: "a", count: 4 }];
        expect([...layoutLevel(nodes, edges)]).toEqual([...layoutLevel(nodes, edges)]);
    });
});
