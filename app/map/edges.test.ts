import { describe, expect, it } from "vitest";
import { edgeOpacity, edgeWidth } from "./edges";

describe("edges", () => {
    it("makes a line's thickness the square root of its count, the level's heaviest 6 px wide", () => {
        expect(edgeWidth(400, 400)).toBe(6);
        expect(edgeWidth(100, 400)).toBe(3);
        expect(edgeWidth(1, 20_648)).toBe(1);   // never thinner than 1
        expect(edgeWidth(5, 0)).toBe(1);
    });

    it("draws the selected box's lines at full strength and ghosts the rest", () => {
        const edge = { source: "a", target: "b", count: 1 };
        expect(edgeOpacity(edge, null)).toBe(0.3);
        expect(edgeOpacity(edge, "a")).toBe(0.95);
        expect(edgeOpacity(edge, "b")).toBe(0.95);
        expect(edgeOpacity(edge, "c")).toBe(0.06);
    });
});
