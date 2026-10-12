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

    it("lays boxes with no lines in a grid below the rest, in the level's order", () => {
        const at = layoutLevel([node("a"), node("b"), ...["l1", "l2", "l3", "l4"].map(node)], [{ source: "a", target: "b", count: 1 }]);
        const bottomOfTheRest = Math.max(at.get("a")!.y, at.get("b")!.y) + BOX_HEIGHT;
        // four loose boxes make a 2 × 2 grid, 28 px apart: l1 l2 / l3 l4
        expect(at.get("l1")!.x).toBe(0);
        expect(at.get("l1")!.y).toBeGreaterThan(bottomOfTheRest);
        expect(at.get("l2")).toEqual({ x: BOX_WIDTH + 28, y: at.get("l1")!.y });
        expect(at.get("l3")).toEqual({ x: 0, y: at.get("l1")!.y + BOX_HEIGHT + 28 });
    });

    it("draws the same level the same way every time", () => {
        const nodes = ["a", "b", "c", "d"].map(node);
        const edges: MapEdge[] = [{ source: "a", target: "c", count: 2 }, { source: "b", target: "c", count: 1 }, { source: "d", target: "a", count: 4 }];
        expect([...layoutLevel(nodes, edges)]).toEqual([...layoutLevel(nodes, edges)]);
    });
});
