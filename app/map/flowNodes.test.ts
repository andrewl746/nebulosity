import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { reuseUnchanged, sameBoxNode, sameRoutedEdge, toBoxNode } from "./flowNodes";
import type { BoxData } from "./MapBox";
import type { RoutedEdgeType } from "./RoutedEdge";

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

describe("reuseUnchanged (deferred minor: every hover rebuilt every box and line)", () => {
    type Item = { id: string; v: number };
    const same = (a: Item, b: Item): boolean => a.v === b.v;
    const a1 = { id: "a", v: 1 }, b1 = { id: "b", v: 1 };

    it("keeps the previous object for an item that hasn't changed, and takes the new one for one that has", () => {
        const b2 = { id: "b", v: 2 };
        const out = reuseUnchanged([a1, b1], [{ id: "a", v: 1 }, b2], same);
        expect(out[0]).toBe(a1);
        expect(out[1]).toBe(b2);
    });

    it("hands back the previous list itself when nothing changed, so React has nothing to redraw", () => {
        const previous = [a1, b1];
        expect(reuseUnchanged(previous, [{ id: "a", v: 1 }, { id: "b", v: 1 }], same)).toBe(previous);
    });

    it("makes a new list when the order or the number of items changed, still reusing what it can", () => {
        const previous = [a1, b1];
        const reordered = reuseUnchanged(previous, [{ id: "b", v: 1 }, { id: "a", v: 1 }], same);
        expect(reordered).not.toBe(previous);
        expect(reordered[0]).toBe(b1);
        expect(reordered[1]).toBe(a1);
        const shorter = reuseUnchanged(previous, [{ id: "a", v: 1 }], same);
        expect(shorter).not.toBe(previous);
        expect(shorter).toEqual([a1]);
    });
});

describe("sameBoxNode: whether a box would draw the same", () => {
    const node = (fields: Partial<BoxData> = {}, at = { x: 10, y: 20 }) => toBoxNode(box, at, { ...data, ...fields });

    it("is the same with the same box, place, tone, ring, pulse and doorway", () => {
        expect(sameBoxNode(node(), node())).toBe(true);
    });

    it("differs when its tone, Claude's ring, a pulse or its place changes", () => {
        expect(sameBoxNode(node(), node({ tone: "faded" }))).toBe(false);
        expect(sameBoxNode(node(), node({ agent: true }))).toBe(false);
        expect(sameBoxNode(node(), node({ pulseKey: 3 }))).toBe(false);
        expect(sameBoxNode(node(), node({}, { x: 10, y: 21 }))).toBe(false);
    });
});

describe("sameRoutedEdge: whether a line would draw the same", () => {
    const points = [{ x: 0, y: 0 }, { x: 0, y: 40 }];
    const line = (fields: Partial<RoutedEdgeType> = {}): RoutedEdgeType => ({
        id: "a->b", type: "routed", source: "a", target: "b", data: { points },
        style: { stroke: "var(--neutral-edge)", strokeWidth: 1, opacity: 1 },
        markerEnd: { type: "arrowclosed" as never, color: "var(--text-2)" },
        ...fields,
    });

    it("is the same with the same ends, route, label, stroke and arrowhead", () => {
        expect(sameRoutedEdge(line(), line())).toBe(true);
    });

    it("differs when it's hovered (a label), recolored, rerouted or its arrowhead changes", () => {
        expect(sameRoutedEdge(line(), line({ label: "a uses b · 3 imports" }))).toBe(false);
        expect(sameRoutedEdge(line(), line({ style: { stroke: "var(--select)", strokeWidth: 1.5, opacity: 1 } }))).toBe(false);
        expect(sameRoutedEdge(line(), line({ data: { points: [{ x: 0, y: 0 }, { x: 0, y: 40 }] } }))).toBe(false);
        expect(sameRoutedEdge(line(), line({ markerEnd: { type: "arrowclosed" as never, color: "var(--select)" } }))).toBe(false);
    });
});
