import { describe, expect, it } from "vitest";
import type { MapEdge } from "@/lib/contracts";
import { edgeKey, isBusyLevel, mapEmphasis, STRONG_SHARE, strongThreshold, weakLinesHidden, type BoxTone, type EdgeTone } from "./emphasis";

// boxes a, b, c, d; lines a→b, b→c, d→c (the plan's Task 5 vectors)
const BOXES = ["a", "b", "c", "d"];
const EDGES: MapEdge[] = [
    { source: "a", target: "b", count: 3 },
    { source: "b", target: "c", count: 1 },
    { source: "d", target: "c", count: 2 },
];

function tones(selected: string | null, hovered: string | null, quietLines = false): { boxes: BoxTone[]; edges: EdgeTone[] } {
    const result = mapEmphasis(BOXES, EDGES, selected, hovered, { quietLines });
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

    it("calls a level busy past 60 lines", () => {
        expect(isBusyLevel(60)).toBe(false);
        expect(isBusyLevel(61)).toBe(true);
    });

    describe("on a busy level (quiet lines: only the hovered or selected box's lines are drawn)", () => {
        it("hides every line at rest, and keeps the boxes plain", () => {
            expect(tones(null, null, true)).toEqual({ boxes: ["normal", "normal", "normal", "normal"], edges: ["hidden", "hidden", "hidden"] });
        });

        it("draws only the hovered box's lines", () => {
            expect(tones(null, "d", true)).toEqual({ boxes: ["normal", "normal", "preview", "preview"], edges: ["hidden", "hidden", "preview"] });
        });

        it("draws only the selection's lines, in purple, and fades the rest as usual", () => {
            expect(tones("b", null, true)).toEqual({ boxes: ["linked", "selected", "linked", "faded"], edges: ["selected", "selected", "hidden"] });
        });

        it("draws the selection's lines and the hovered box's together", () => {
            expect(tones("b", "d", true)).toEqual({ boxes: ["linked", "selected", "linked", "preview"], edges: ["selected", "selected", "preview"] });
        });

        it("draws a selected box's line to a portal, so the doorway lights up only when it's linked", () => {
            const edges: MapEdge[] = [
                { source: "src/a", target: "src//page-2", count: 4 },
                { source: "src/b", target: "src//page-3", count: 1 },
            ];
            const result = mapEmphasis(["src/a", "src/b", "src//page-2", "src//page-3"], edges, "src/a", null, { quietLines: true });
            expect([...result.edges]).toEqual([["src/a->src//page-2", "selected"], ["src/b->src//page-3", "hidden"]]);
            expect(result.boxes.get("src//page-2")).toBe("linked");
            expect(result.boxes.get("src//page-3")).toBe("faded");
        });
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

describe("Strong links only (ADR-070)", () => {
    // VS Code's root (the demo's level file): its heaviest line carries 665 imports, so a strong line carries at least
    // 2% × 665 = 13.3, which leaves extensions → src (665), build → src (16) and extensions → test (16)
    const ROOT_BOXES = ["eslint.config.js", "extensions", "gulpfile.mjs", "test", "build", ".github", ".eslint-plugin-local", "src"];
    const ROOT: MapEdge[] = [
        { source: ".eslint-plugin-local", target: "src", count: 2 }, { source: ".github", target: "src", count: 2 },
        { source: "build", target: ".eslint-plugin-local", count: 2 }, { source: "build", target: "src", count: 16 },
        { source: "eslint.config.js", target: ".eslint-plugin-local", count: 1 }, { source: "eslint.config.js", target: "extensions", count: 1 },
        { source: "extensions", target: "build", count: 1 }, { source: "extensions", target: "src", count: 665 },
        { source: "extensions", target: "test", count: 16 }, { source: "gulpfile.mjs", target: "build", count: 1 }, { source: "test", target: "build", count: 1 },
    ];
    const drawn = (selected: string | null, hovered: string | null, pinned?: Set<string>): string[] => {
        const tones = mapEmphasis(ROOT_BOXES, ROOT, selected, hovered, { strongOnly: true, pinned }).edges;
        return [...tones].filter(([, tone]) => tone !== "hidden").map(([key]) => key).sort();
    };

    it("puts the threshold at 2% of the heaviest line, with no floor (the owner's pick, 2026-10-27)", () => {
        expect(strongThreshold(665)).toBeCloseTo(13.3, 10);
        expect(strongThreshold(100)).toBe(2);
        expect(strongThreshold(0)).toBe(0);
        expect(STRONG_SHARE).toBe(0.02);
    });

    it("hides nothing in a folder of files whose lines are 1 or 2 imports", () => {
        // the heaviest is 2, so a strong line needs 0.04 imports: every line shows
        const files: MapEdge[] = [{ source: "a.ts", target: "b.ts", count: 1 }, { source: "b.ts", target: "c.ts", count: 2 }, { source: "a.ts", target: "c.ts", count: 1 }];
        const tones = mapEmphasis(["a.ts", "b.ts", "c.ts"], files, null, null, { strongOnly: true }).edges;
        expect([...tones.values()]).toEqual(["normal", "normal", "normal"]);
        expect(weakLinesHidden(files, null)).toBe(0);
    });

    it("draws only the strong lines when nothing is selected", () => {
        expect(drawn(null, null)).toEqual(["build->src", "extensions->src", "extensions->test"]);
    });

    it("adds every line of the selected box, as the approved mockup draws src", () => {
        expect(drawn("src", null)).toEqual([".eslint-plugin-local->src", ".github->src", "build->src", "extensions->src", "extensions->test"]);
    });

    it("adds the hovered box's lines", () => {
        expect(drawn(null, "gulpfile.mjs")).toEqual(["build->src", "extensions->src", "extensions->test", "gulpfile.mjs->build"]);
    });

    it("always draws the lines of a box Claude Code or the editor has lit", () => {
        expect(drawn(null, null, new Set(["test"]))).toEqual(["build->src", "extensions->src", "extensions->test", "test->build"]);
    });

    it("counts the lines it hides, before any hover", () => {
        // eleven lines, three strong: eight hidden; with src selected its two weak lines show, so six
        expect(weakLinesHidden(ROOT, null)).toBe(8);
        expect(weakLinesHidden(ROOT, "src")).toBe(6);
        // test → build is lit as well
        expect(weakLinesHidden(ROOT, "src", new Set(["test"]))).toBe(5);
    });

    it("draws every line with it off", () => {
        const tones = mapEmphasis(ROOT_BOXES, ROOT, null, null, { strongOnly: false }).edges;
        expect([...tones.values()].every((tone) => tone === "normal")).toBe(true);
    });

    it("on a busy level, still draws a lit box's lines", () => {
        const tones = mapEmphasis(ROOT_BOXES, ROOT, null, null, { quietLines: true, pinned: new Set(["test"]) }).edges;
        expect([...tones].filter(([, t]) => t !== "hidden").map(([k]) => k).sort()).toEqual(["extensions->test", "test->build"]);
    });
});
