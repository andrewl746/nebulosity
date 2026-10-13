import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { toBoxNode } from "./flowNodes";

const box: MapNode = { path: "src/vs", name: "vs", kind: "folder", fileCount: 10073, summaryStatus: "fresh" };
const data = { box, tone: "normal" as const, agent: false, pulseKey: 0 };

describe("toBoxNode (owner review: lines sometimes missing)", () => {
    it("carries its connection points, so its lines never wait for React Flow to measure the box", () => {
        const node = toBoxNode(box, { x: 10, y: 20 }, data);
        // a 1 px point at the middle of the top edge (lines arrive) and of the bottom edge (lines leave): 232 / 2 - 0.5
        expect(node.handles).toEqual([
            { type: "target", position: "top", x: 115.5, y: 0, width: 1, height: 1 },
            { type: "source", position: "bottom", x: 115.5, y: 55, width: 1, height: 1 },
        ]);
    });

    it("says its own size, so rebuilding it on a hover or selection doesn't make React Flow forget the measurement", () => {
        const node = toBoxNode(box, { x: 10, y: 20 }, data);
        expect(node).toMatchObject({ id: "src/vs", type: "box", position: { x: 10, y: 20 }, width: 232, height: 56, measured: { width: 232, height: 56 } });
        expect(node.data).toBe(data);
    });
});
