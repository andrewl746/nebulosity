import { describe, expect, it } from "vitest";
import type { DemoSearchIndex } from "../contracts";
import { bm25Rank, bm25Scores, buildStaticSearch, searchStatic, STATIC_NOTE } from "./staticSearch";

const INDEX: DemoSearchIndex = {
    summaries: [
        [0, "src/render/paint.ts", "Paints the canvas", "Renders shapes onto the canvas."],
        [0, "src/log/logger.ts", "Console logger", "Writes log lines to the console."],
        [1, "src/render", "Rendering", "Code that draws and renders the scene."],
    ],
    folders: [["src", 3], ["src/render", 2], ["src/log", 1], ["test/render", 1]],
    files: [["src/render/paint.ts", 5, 0], ["src/log/logger.ts", 2, 0], ["src/render/canvas.ts", 1, 0], ["test/render/paint.test.ts", 0, 1]],
    declarations: [["Painter", 0], ["log", 1]],
};

describe("bm25", () => {
    it("scores one document by hand: idf ln(4/3), the tagline weighed 4, a term factor of 1 at average length", () => {
        const s = buildStaticSearch({ summaries: [[0, "a.ts", "Alpha", "Beta gamma."]], folders: [], files: [], declarations: [] });
        expect(bm25Scores(s, ["alpha"]).get("file:a.ts")).toBeCloseTo(4 * Math.log(4 / 3), 9);
    });

    it("weighs a tagline over a summary over a path, and matches words a 3+ letter term begins", () => {
        const s = buildStaticSearch(INDEX);
        expect(bm25Rank(s, ["render"])).toEqual(["folder:src/render", "file:src/render/paint.ts"]);
        expect(bm25Rank(s, ["canvas"])).toEqual(["file:src/render/paint.ts"]);
    });
});

describe("searchStatic", () => {
    const s = buildStaticSearch(INDEX);

    it("fuses summaries with file names, halving a test file's score", () => {
        const result = searchStatic(s, "paint", { repoName: "demo" });
        expect(result.hits).toEqual([
            { path: "src/render/paint.ts", kind: "file", score: 3 / 61, matchedBy: ["summary", "file"], tagline: "Paints the canvas", summary: "Renders shapes onto the canvas." },
            { path: "test/render/paint.test.ts", kind: "file", score: 1 / 62, matchedBy: ["file"] },
        ]);
        expect(result.lists).toEqual({ code: 0, summary: 1, vector: 0, name: 0, file: 2 });
        expect(result.note).toBe(STATIC_NOTE);
    });

    it("keeps a test file's whole score when the query asks for tests, and drops the repo's own name", () => {
        expect(searchStatic(s, "paint test", { repoName: "demo" }).hits[1].score).toBeCloseTo(2 / 62, 12);
        const named = searchStatic(s, "demo paint", { repoName: "demo" });
        expect(named.query).toBe("demo paint");
        expect(named.hits).toEqual(searchStatic(s, "paint", { repoName: "demo" }).hits);
    });
});
