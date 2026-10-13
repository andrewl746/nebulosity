import { describe, expect, it } from "vitest";
import type { MapEdge } from "@/lib/contracts";
import { edgeKey, mapEmphasis, type BoxTone, type EdgeTone } from "./emphasis";

// boxes a, b, c, d; lines a→b, b→c, d→c (the plan's Task 5 vectors)
const BOXES = ["a", "b", "c", "d"];
const EDGES: MapEdge[] = [
    { source: "a", target: "b", count: 3 },
    { source: "b", target: "c", count: 1 },
    { source: "d", target: "c", count: 2 },
];

function tones(selected: string | null, hovered: string | null): { boxes: BoxTone[]; edges: EdgeTone[] } {
    const result = mapEmphasis(BOXES, EDGES, selected, hovered);
    return { boxes: BOXES.map((b) => result.boxes.get(b)!), edges: EDGES.map((e) => result.edges.get(edgeKey(e))!) };
}

describe("mapEmphasis (VISUAL_REFRESH.md §4)", () => {
    it("draws everything plainly when nothing is selected or hovered", () => {
        expect(tones(null, null)).toEqual({ boxes: ["normal", "normal", "normal", "normal"], edges: ["normal", "normal", "normal"] });
    });

    it("turns the selection's lines purple, keeps the boxes they join, and fades the rest", () => {
        expect(tones("b", null)).toEqual({ boxes: ["linked", "selected", "linked", "faded"], edges: ["selected", "selected", "faded"] });
    });

    it("previews a hovered box's lines and neighbours without selecting anything", () => {
        expect(tones(null, "d")).toEqual({ boxes: ["normal", "normal", "preview", "preview"], edges: ["normal", "normal", "preview"] });
    });

    it("keeps the selection's links when another box is hovered, and previews the hovered one's", () => {
        expect(tones("b", "d")).toEqual({ boxes: ["linked", "selected", "linked", "preview"], edges: ["selected", "selected", "preview"] });
    });

    it("treats a selection that isn't a box on this level as none", () => {
        expect(tones("x", null)).toEqual(tones(null, null));
    });

    it("ignores hovering the selected box", () => {
        expect(tones("b", "b")).toEqual(tones("b", null));
    });

    it("treats a portal like any other box: selecting a box turns its cross-page line purple", () => {
        const boxes = ["src/a", "src/b", "src//page-2"];
        const edges: MapEdge[] = [{ source: "src/a", target: "src//page-2", count: 4 }];
        const result = mapEmphasis(boxes, edges, "src/a", null);
        expect([...result.boxes]).toEqual([["src/a", "selected"], ["src/b", "faded"], ["src//page-2", "linked"]]);
        expect([...result.edges]).toEqual([["src/a->src//page-2", "selected"]]);
        expect([...mapEmphasis(boxes, edges, "src//page-2", null).boxes]).toEqual([["src/a", "linked"], ["src/b", "faded"], ["src//page-2", "selected"]]);
    });
});
