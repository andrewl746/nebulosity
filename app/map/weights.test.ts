import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import { arrowHead, dotSize, labelledLines, lineWidth, maxFilesOf, maxImportsOf } from "./weights";

// The scales of the approved mockup (mockup3.html, the owner's picks of 2026-10-27), worked by hand.
describe("dotSize: 6 + 12 × log10(files + 1) / log10(largest + 1)", () => {
    it("is 6 px for an empty folder and 18 px for the page's largest", () => {
        expect(dotSize(0, 10_280)).toBe(6);
        expect(dotSize(10_280, 10_280)).toBe(18);
    });

    it("is halfway, 12 px, where log10(files + 1) is half of the largest's", () => {
        // log10(10) / log10(100) = 1 / 2
        expect(dotSize(9, 99)).toBe(12);
    });

    it("is 6 px on a page with no folder, and never below 6", () => {
        expect(dotSize(5, 0)).toBe(6);
        expect(dotSize(-1, 99)).toBe(6);
    });
});

describe("lineWidth: 1 + 9 × ln(imports) / ln(heaviest)", () => {
    it("is 1 px for one import and 10 px for the heaviest line", () => {
        expect(lineWidth(1, 665)).toBe(1);
        expect(lineWidth(665, 665)).toBe(10);
    });

    it("is 5.5 px where ln(imports) is half of the heaviest's", () => {
        // ln(10) / ln(100) = 1 / 2
        expect(lineWidth(10, 100)).toBeCloseTo(5.5, 10);
    });

    it("is 1 px on a page whose heaviest line is a single import", () => {
        expect(lineWidth(1, 1)).toBe(1);
        expect(lineWidth(0, 0)).toBe(1);
    });
});

describe("arrowHead: half-width max(4.5, 0.9w + 3), length max(7, 1.2w + 5)", () => {
    it("keeps its smallest size on thin lines", () => {
        // 0.9 + 3 = 3.9 < 4.5, and 1.2 + 5 = 6.2 < 7
        expect(arrowHead(1)).toEqual({ half: 4.5, length: 7 });
    });

    it("grows with a thick line, wider than it by 3 px a side and more", () => {
        // 0.9 × 10 + 3 = 12, 1.2 × 10 + 5 = 17
        expect(arrowHead(10)).toEqual({ half: 12, length: 17 });
    });
});

const node = (path: string, kind: MapNode["kind"], fileCount: number): MapNode => ({ path, name: path, kind, fileCount, summaryStatus: "fresh" });
const edge = (source: string, target: string, count: number): MapEdge => ({ source, target, count });

describe("the page's largest folder and heaviest line", () => {
    it("counts folders only, not files or doorways", () => {
        expect(maxFilesOf([node("a", "folder", 12), node("b.ts", "file", 1), node("x//page-2", "portal", 900), node("c", "folder", 40)])).toBe(40);
        expect(maxFilesOf([node("b.ts", "file", 1)])).toBe(0);
    });

    it("takes the heaviest line", () => {
        expect(maxImportsOf([edge("a", "b", 3), edge("b", "c", 665)])).toBe(665);
        expect(maxImportsOf([])).toBe(0);
    });
});

describe("labelledLines: the three heaviest, and the selection's", () => {
    // VS Code's root (mockup3.html's edges)
    const ROOT = [
        edge(".eslint-plugin-local", "src", 2), edge(".github", "src", 2), edge("build", ".eslint-plugin-local", 2), edge("build", "src", 16),
        edge("eslint.config.js", ".eslint-plugin-local", 1), edge("eslint.config.js", "extensions", 1), edge("extensions", "build", 1),
        edge("extensions", "src", 665), edge("extensions", "test", 16), edge("gulpfile.mjs", "build", 1), edge("test", "build", 1),
    ];

    it("labels the three heaviest with nothing selected, ties by source then target", () => {
        // 665, then the two 16s; the 2s are tied, and three is the cap
        expect([...labelledLines(ROOT, null)].sort()).toEqual(["build->src", "extensions->src", "extensions->test"]);
    });

    it("adds every line of the selected box", () => {
        expect([...labelledLines(ROOT, "src")].sort()).toEqual([".eslint-plugin-local->src", ".github->src", "build->src", "extensions->src", "extensions->test"]);
    });

    it("never labels a line from a box to itself among the heaviest", () => {
        expect([...labelledLines([edge("a", "a", 99), edge("a", "b", 1)], null)]).toEqual(["a->b"]);
    });
});
