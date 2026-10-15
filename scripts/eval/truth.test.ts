import { describe, expect, it } from "vitest";
import {
    childPairs, directImporters, filesNothingImports, hasEdge, impactByFolders, importersWithin, isTestFile, namePairs, outsideImporters,
    rootsReaching, shortestChain, shortestCycle, transitiveDependents, type Graph,
} from "./truth";

const G: Graph = {
    files: ["a.ts", "b.ts", "c.ts", "d.ts", "dir/e.ts", "dir/f.ts"],
    edges: [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"], ["a.ts", "dir/e.ts"], ["dir/e.ts", "dir/f.ts"], ["dir/f.ts", "c.ts"]],
};

describe("truths over a scanned graph", () => {
    it("lists direct importers, importers from outside a folder, and everything depending on a file", () => {
        expect(directImporters(G, "c.ts")).toEqual(["b.ts", "dir/f.ts"]);
        expect(outsideImporters(G, "dir")).toEqual(["a.ts"]);
        expect(transitiveDependents(G, "d.ts")).toEqual(["a.ts", "b.ts", "c.ts", "dir/e.ts", "dir/f.ts"]);
    });

    it("finds the shortest chain, neighbours in path order, or none", () => {
        expect(shortestChain(G, "a.ts", "d.ts")).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
        expect(shortestChain(G, "d.ts", "a.ts")).toBeNull();
        expect(hasEdge(G, "dir/f.ts", "c.ts")).toBe(true);
        expect(hasEdge(G, "a.ts", "c.ts")).toBe(false);
    });

    it("breaks a tie between equally short chains by path order, whatever order the edges came in", () => {
        const tie: Graph = {
            files: ["a.ts", "x.ts", "y.ts", "z.ts"],
            edges: [["a.ts", "y.ts"], ["a.ts", "x.ts"], ["x.ts", "z.ts"], ["y.ts", "z.ts"]],
        };
        expect(shortestChain(tie, "a.ts", "z.ts")).toEqual(["a.ts", "x.ts", "z.ts"]);
    });

    it("ends a chain at the first file reached inside a folder when the target is a folder", () => {
        expect(shortestChain(G, "a.ts", "dir")).toEqual(["a.ts", "dir/e.ts"]);
    });
});

// The arch-repo ground truth's 21 source files and its 31 resolved edges: the 30 both extractors find, plus #5, the
// computed import(url) in src/app/loader.ts adjudicated as importing src/app/main.ts.
const ARCH: Graph = {
    files: [
        "packages/core/src/index.ts", "packages/core/src/log.ts", "packages/ui/src/button.ts", "packages/ui/src/index.ts",
        "src/app/legacy.ts", "src/app/loader.ts", "src/app/main.ts",
        "src/base/browser/dom.ts", "src/base/common/arrays.ts", "src/base/common/strings.ts", "src/base/node/fs.ts", "src/base/test/common/strings.test.ts",
        "src/editor/browser/editorView.ts", "src/editor/common/model.ts", "src/editor/common/textModel.ts", "src/editor/common/tokens.ts", "src/editor/node/editorFiles.ts",
        "src/platform/browser/storageView.ts", "src/platform/common/storage.ts", "src/platform/node/storageFile.ts",
        "tools/fixtures/legacy-ids.ts",
    ],
    edges: [
        ["packages/core/src/index.ts", "packages/core/src/log.ts"],                // 1
        ["packages/ui/src/button.ts", "packages/core/src/log.ts"],                 // 2
        ["packages/ui/src/index.ts", "packages/ui/src/button.ts"],                 // 3
        ["src/app/legacy.ts", "src/base/common/strings.ts"],                       // 4
        ["src/app/loader.ts", "src/app/main.ts"],                                  // 5 (adjudicated)
        ["src/app/main.ts", "packages/ui/src/index.ts"],                           // 6
        ["src/app/main.ts", "src/editor/browser/editorView.ts"],                   // 7
        ["src/app/main.ts", "src/editor/node/editorFiles.ts"],                     // 8
        ["src/app/main.ts", "src/platform/node/storageFile.ts"],                   // 9
        ["src/base/browser/dom.ts", "src/base/common/strings.ts"],                 // 10
        ["src/base/common/arrays.ts", "src/base/common/strings.ts"],               // 11
        ["src/base/node/fs.ts", "src/base/common/arrays.ts"],                      // 12
        ["src/base/test/common/strings.test.ts", "src/base/common/strings.ts"],    // 13
        ["src/editor/browser/editorView.ts", "src/base/browser/dom.ts"],           // 14
        ["src/editor/browser/editorView.ts", "src/editor/common/model.ts"],        // 15
        ["src/editor/common/model.ts", "src/editor/common/tokens.ts"],             // 16
        ["src/editor/common/model.ts", "src/platform/common/storage.ts"],          // 17
        ["src/editor/common/textModel.ts", "src/base/common/strings.ts"],          // 18
        ["src/editor/common/textModel.ts", "src/editor/common/model.ts"],          // 19
        ["src/editor/common/tokens.ts", "src/editor/common/textModel.ts"],         // 20
        ["src/editor/node/editorFiles.ts", "src/base/node/fs.ts"],                 // 21
        ["src/editor/node/editorFiles.ts", "src/editor/common/textModel.ts"],      // 22
        ["src/editor/node/editorFiles.ts", "src/platform/node/storageFile.ts"],    // 23
        ["src/platform/browser/storageView.ts", "src/base/browser/dom.ts"],        // 24
        ["src/platform/common/storage.ts", "src/base/common/arrays.ts"],           // 25
        ["src/platform/common/storage.ts", "src/platform/browser/storageView.ts"], // 26
        ["src/platform/node/storageFile.ts", "packages/core/src/index.ts"],        // 27
        ["src/platform/node/storageFile.ts", "src/base/node/fs.ts"],               // 28
        ["src/platform/node/storageFile.ts", "src/editor/common/model.ts"],        // 29
        ["src/platform/node/storageFile.ts", "src/platform/common/storage.ts"],    // 30
        ["tools/fixtures/legacy-ids.ts", "src/base/common/strings.ts"],            // 31
    ],
};
const STRINGS = "src/base/common/strings.ts";

describe("the new kinds' truths over the arch-repo's 31 edges (the ground truth's \"truths over the 31\")", () => {
    it("impact: strings.ts's 16 dependents counted per folder, with the one elsewhere", () => {
        expect(impactByFolders(ARCH, STRINGS, ["src/app", "src/base", "src/editor", "src/platform"])).toEqual({ counts: [3, 4, 5, 3], elsewhere: 1, total: 16 });
    });

    it("cycle: the 3-step cycle through model.ts, and none through storage.ts", () => {
        expect(shortestCycle(ARCH, "src/editor/common/model.ts")).toEqual([
            "src/editor/common/model.ts", "src/editor/common/tokens.ts", "src/editor/common/textModel.ts", "src/editor/common/model.ts",
        ]);
        expect(shortestCycle(ARCH, "src/platform/common/storage.ts")).toBeNull();
    });

    it("unused: the non-test files nothing imports, in src and in the whole repo", () => {
        expect(filesNothingImports(ARCH, "src", isTestFile)).toEqual(["src/app/legacy.ts", "src/app/loader.ts"]);
        expect(filesNothingImports(ARCH, "", isTestFile)).toEqual(["src/app/legacy.ts", "src/app/loader.ts", "tools/fixtures/legacy-ids.ts"]);
    });

    it("violations: the files in src/platform that import a file in src/editor", () => {
        expect(importersWithin(ARCH, "src/editor", "src/platform")).toEqual(["src/platform/node/storageFile.ts"]);
    });

    it("entries: the non-test files nothing imports that end up loading strings.ts", () => {
        expect(rootsReaching(ARCH, STRINGS, isTestFile)).toEqual(["src/app/legacy.ts", "src/app/loader.ts", "tools/fixtures/legacy-ids.ts"]);
    });

    it("pairs: src's children, and the names common, browser and node, each file under the deepest name on its path", () => {
        expect(childPairs(ARCH, "src")).toEqual([
            ["app", "base"], ["app", "editor"], ["app", "platform"], ["editor", "base"], ["editor", "platform"], ["platform", "base"], ["platform", "editor"],
        ]);
        expect(namePairs(ARCH, "src", ["common", "browser", "node"])).toEqual([
            ["browser", "browser"], ["browser", "common"], ["common", "browser"], ["common", "common"], ["node", "common"], ["node", "node"],
        ]);
    });
});

describe("the new kinds on hand-built graphs", () => {
    it("finds a cycle of one step when a file imports itself, and breaks a tie between equal cycles by path order", () => {
        expect(shortestCycle({ files: ["a.ts"], edges: [["a.ts", "a.ts"]] }, "a.ts")).toEqual(["a.ts", "a.ts"]);
        const tie: Graph = { files: ["a.ts", "x.ts", "y.ts"], edges: [["a.ts", "y.ts"], ["y.ts", "a.ts"], ["a.ts", "x.ts"], ["x.ts", "a.ts"]] };
        expect(shortestCycle(tie, "a.ts")).toEqual(["a.ts", "x.ts", "a.ts"]);
    });

    it("leaves out a child's own files and imports leaving the folder when pairing children", () => {
        const g: Graph = {
            files: ["top/a/x.ts", "top/b/y.ts", "top/c.ts", "out/z.ts"],
            edges: [["top/a/x.ts", "top/b/y.ts"], ["top/c.ts", "top/a/x.ts"], ["top/a/x.ts", "out/z.ts"], ["top/b/y.ts", "top/b/y.ts"]],
        };
        expect(childPairs(g, "top")).toEqual([["a", "b"]]);
    });

    it("calls a file a test by a test, tests or __tests__ folder, or a .test. or .spec. name; a fixture is no test", () => {
        expect(["src/base/test/common/strings.test.ts", "a/tests/x.ts", "a/__tests__/x.ts", "a/x.test.ts", "a/x.spec.tsx"].map(isTestFile)).toEqual([true, true, true, true, true]);
        expect(["tools/fixtures/legacy-ids.ts", "src/testing/x.ts", "src/contest.ts", "a/latest/x.ts"].map(isTestFile)).toEqual([false, false, false, false]);
    });
});
