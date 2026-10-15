import { describe, expect, it } from "vitest";
import path from "path";
import { preProcessGraph, preProcessImports } from "./ts-graph";
import { createTruthResolver } from "./resolve-truth";

const FIXTURE = path.resolve("test/fixtures/arch-repo");

const ARCH_FILES = [
    "packages/core/src/index.ts", "packages/core/src/log.ts", "packages/ui/src/button.ts", "packages/ui/src/index.ts",
    "src/app/legacy.ts", "src/app/loader.ts", "src/app/main.ts",
    "src/base/browser/dom.ts", "src/base/common/arrays.ts", "src/base/common/strings.ts", "src/base/node/fs.ts", "src/base/test/common/strings.test.ts",
    "src/editor/browser/editorView.ts", "src/editor/common/model.ts", "src/editor/common/textModel.ts", "src/editor/common/tokens.ts", "src/editor/node/editorFiles.ts",
    "src/platform/browser/storageView.ts", "src/platform/common/storage.ts", "src/platform/node/storageFile.ts",
    "tools/fixtures/legacy-ids.ts",
];

// The ground truth: the regex scanner and preProcessFile agree on 30 edges, every edge of the table except #5.
const ARCH_EDGES_30: [string, string][] = [
    ["packages/core/src/index.ts", "packages/core/src/log.ts"],
    ["packages/ui/src/button.ts", "packages/core/src/log.ts"],
    ["packages/ui/src/index.ts", "packages/ui/src/button.ts"],
    ["src/app/legacy.ts", "src/base/common/strings.ts"],
    ["src/app/main.ts", "packages/ui/src/index.ts"],
    ["src/app/main.ts", "src/editor/browser/editorView.ts"],
    ["src/app/main.ts", "src/editor/node/editorFiles.ts"],
    ["src/app/main.ts", "src/platform/node/storageFile.ts"],
    ["src/base/browser/dom.ts", "src/base/common/strings.ts"],
    ["src/base/common/arrays.ts", "src/base/common/strings.ts"],
    ["src/base/node/fs.ts", "src/base/common/arrays.ts"],
    ["src/base/test/common/strings.test.ts", "src/base/common/strings.ts"],
    ["src/editor/browser/editorView.ts", "src/base/browser/dom.ts"],
    ["src/editor/browser/editorView.ts", "src/editor/common/model.ts"],
    ["src/editor/common/model.ts", "src/editor/common/tokens.ts"],
    ["src/editor/common/model.ts", "src/platform/common/storage.ts"],
    ["src/editor/common/textModel.ts", "src/base/common/strings.ts"],
    ["src/editor/common/textModel.ts", "src/editor/common/model.ts"],
    ["src/editor/common/tokens.ts", "src/editor/common/textModel.ts"],
    ["src/editor/node/editorFiles.ts", "src/base/node/fs.ts"],
    ["src/editor/node/editorFiles.ts", "src/editor/common/textModel.ts"],
    ["src/editor/node/editorFiles.ts", "src/platform/node/storageFile.ts"],
    ["src/platform/browser/storageView.ts", "src/base/browser/dom.ts"],
    ["src/platform/common/storage.ts", "src/base/common/arrays.ts"],
    ["src/platform/common/storage.ts", "src/platform/browser/storageView.ts"],
    ["src/platform/node/storageFile.ts", "packages/core/src/index.ts"],
    ["src/platform/node/storageFile.ts", "src/base/node/fs.ts"],
    ["src/platform/node/storageFile.ts", "src/editor/common/model.ts"],
    ["src/platform/node/storageFile.ts", "src/platform/common/storage.ts"],
    ["tools/fixtures/legacy-ids.ts", "src/base/common/strings.ts"],
];

const byPath = (a: readonly [string, string], b: readonly [string, string]): number =>
    (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const sortedEdges = (edges: readonly (readonly [string, string])[]): [string, string][] => edges.map(([a, b]): [string, string] => [a, b]).sort(byPath);

describe("preProcessGraph", () => {
    it("reads the fixture through TypeScript's own grammar and gives the same 30 edges as the regex scanner", () => {
        const g = preProcessGraph(FIXTURE, ARCH_FILES, createTruthResolver(FIXTURE, ARCH_FILES));
        expect(g.files).toEqual(ARCH_FILES);
        expect(sortedEdges(g.edges)).toEqual(sortedEdges(ARCH_EDGES_30));
    });
});

describe("preProcessImports", () => {
    it("lists each written specifier with its line, never one in a comment or a string, nor a computed import()", () => {
        const text = [
            "import { a } from './a';",                     // 1
            "// import { b } from './commented';",          // 2: a comment
            "const s = \"import { c } from './in-string'\";", // 3: inside a string
            "export * from \"./d\";",                       // 4
            "import {",                                     // 5
            "    e,",                                       // 6
            "} from './e';",                                // 7: the specifier's own line
            "const f = require('./f');",                    // 8
            "const g = await import('./g');",               // 9
            "const h = await import(name);",                // 10: computed
        ].join("\n");
        expect(preProcessImports(text)).toEqual([
            { specifier: "./a", line: 1 },
            { specifier: "./d", line: 4 },
            { specifier: "./e", line: 7 },
            { specifier: "./f", line: 8 },
            { specifier: "./g", line: 9 },
        ]);
    });
});
