import { describe, expect, it } from "vitest";
import { buildFolders, buildLevelEdges, childToward, lcaFolder, levelEdgeDeltas } from "./aggregate";

const FILES = [
    "scripts/build.js", "src/app/main.ts", "src/app/view.tsx", "src/core/index.ts",
    "src/core/log.ts", "src/index.ts", "src/util/strings.test.ts", "src/util/strings.ts",
];

const EDGES = [
    { source: "scripts/build.js", target: "src/index.ts" },
    { source: "scripts/build.js", target: "src/app/main.ts" },
    { source: "src/app/main.ts", target: "src/core/log.ts" },
    { source: "src/app/main.ts", target: "src/app/view.tsx" },
    { source: "src/app/main.ts", target: "src/util/strings.ts" },
    { source: "src/app/view.tsx", target: "src/app/main.ts" },
    { source: "src/core/index.ts", target: "src/core/log.ts" },
    { source: "src/index.ts", target: "src/app/main.ts" },
    { source: "src/index.ts", target: "src/core/log.ts" },
    { source: "src/util/strings.test.ts", target: "src/util/strings.ts" },
    { source: "src/util/strings.ts", target: "src/core/index.ts" },
];

describe("lcaFolder", () => {
    it("finds the deepest common folder, comparing whole segments", () => {
        expect(lcaFolder("src/app", "src/core")).toBe("src");
        expect(lcaFolder("scripts", "src")).toBe("");
        expect(lcaFolder("src", "src2")).toBe("");
        expect(lcaFolder("src/app", "src/app")).toBe("src/app");
        expect(lcaFolder("", "src")).toBe("");
    });
});

describe("childToward", () => {
    it("is the file itself when it sits directly in the level, else the child folder that contains it", () => {
        expect(childToward("src", "src/index.ts")).toBe("src/index.ts");
        expect(childToward("", "src/app/main.ts")).toBe("src");
        expect(childToward("src", "src/app/main.ts")).toBe("src/app");
        expect(childToward("", "index.ts")).toBe("index.ts");
    });
});

describe("buildFolders", () => {
    it("builds the fixture's 6 folders with recursive and direct counts", () => {
        expect(buildFolders(FILES, "mini-repo")).toEqual([
            { path: "", parentPath: null, depth: 0, name: "mini-repo", fileCount: 8, directFileCount: 0 },
            { path: "scripts", parentPath: "", depth: 1, name: "scripts", fileCount: 1, directFileCount: 1 },
            { path: "src", parentPath: "", depth: 1, name: "src", fileCount: 7, directFileCount: 1 },
            { path: "src/app", parentPath: "src", depth: 2, name: "app", fileCount: 2, directFileCount: 2 },
            { path: "src/core", parentPath: "src", depth: 2, name: "core", fileCount: 2, directFileCount: 2 },
            { path: "src/util", parentPath: "src", depth: 2, name: "util", fileCount: 2, directFileCount: 2 },
        ]);
    });

    it("always has a root, even with no files", () => {
        expect(buildFolders([], "empty")).toEqual([
            { path: "", parentPath: null, depth: 0, name: "empty", fileCount: 0, directFileCount: 0 },
        ]);
    });
});

describe("buildLevelEdges", () => {
    it("counts each of the fixture's 11 imports exactly once, at its LCA level", () => {
        expect(buildLevelEdges(EDGES)).toEqual([
            { levelPath: "", sourceNode: "scripts", targetNode: "src", count: 2 },
            { levelPath: "src", sourceNode: "src/app", targetNode: "src/core", count: 1 },
            { levelPath: "src", sourceNode: "src/app", targetNode: "src/util", count: 1 },
            { levelPath: "src", sourceNode: "src/index.ts", targetNode: "src/app", count: 1 },
            { levelPath: "src", sourceNode: "src/index.ts", targetNode: "src/core", count: 1 },
            { levelPath: "src", sourceNode: "src/util", targetNode: "src/core", count: 1 },
            { levelPath: "src/app", sourceNode: "src/app/main.ts", targetNode: "src/app/view.tsx", count: 1 },
            { levelPath: "src/app", sourceNode: "src/app/view.tsx", targetNode: "src/app/main.ts", count: 1 },
            { levelPath: "src/core", sourceNode: "src/core/index.ts", targetNode: "src/core/log.ts", count: 1 },
            { levelPath: "src/util", sourceNode: "src/util/strings.test.ts", targetNode: "src/util/strings.ts", count: 1 },
        ]);
    });

    it("never loses or double-counts an import (the counts sum to the edge count)", () => {
        expect(buildLevelEdges(EDGES).reduce((sum, row) => sum + row.count, 0)).toBe(EDGES.length);
    });
});

describe("levelEdgeDeltas", () => {
    it("nets removals against additions at the row each import is counted on", () => {
        // main.ts's import moves from core/log.ts to core/index.ts: both are counted on (src, src/app → src/core)
        expect(levelEdgeDeltas([{ source: "src/app/main.ts", target: "src/core/log.ts" }], [{ source: "src/app/main.ts", target: "src/core/index.ts" }]))
            .toEqual([]);
        expect(levelEdgeDeltas([], [{ source: "src/util/strings.ts", target: "src/core/log.ts" }]))
            .toEqual([{ levelPath: "src", sourceNode: "src/util", targetNode: "src/core", count: 1 }]);
        expect(levelEdgeDeltas([{ source: "src/core/index.ts", target: "src/core/log.ts" }], []))
            .toEqual([{ levelPath: "src/core", sourceNode: "src/core/index.ts", targetNode: "src/core/log.ts", count: -1 }]);
    });

    it("from nothing, builds exactly what buildLevelEdges builds", () => {
        expect(levelEdgeDeltas([], EDGES)).toEqual(buildLevelEdges(EDGES));
    });
});
