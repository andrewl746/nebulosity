import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { computedSites, importSpecifiers, listFiles, resolveRelative, scanRepo } from "./scan";
import { createTruthResolver } from "./resolve-truth";

const FIXTURE = path.resolve("test/fixtures/arch-repo");

// The arch-repo ground truth's 21 source files, sorted.
const ARCH_FILES = [
    "packages/core/src/index.ts", "packages/core/src/log.ts", "packages/ui/src/button.ts", "packages/ui/src/index.ts",
    "src/app/legacy.ts", "src/app/loader.ts", "src/app/main.ts",
    "src/base/browser/dom.ts", "src/base/common/arrays.ts", "src/base/common/strings.ts", "src/base/node/fs.ts", "src/base/test/common/strings.test.ts",
    "src/editor/browser/editorView.ts", "src/editor/common/model.ts", "src/editor/common/textModel.ts", "src/editor/common/tokens.ts", "src/editor/node/editorFiles.ts",
    "src/platform/browser/storageView.ts", "src/platform/common/storage.ts", "src/platform/node/storageFile.ts",
    "tools/fixtures/legacy-ids.ts",
];

// The ground truth's 31 resolved edges without #5 (loader.ts's computed import(url), which neither extractor reads).
// The number is the edge table's; "how" is relative unless marked.
const ARCH_EDGES_30: [string, string][] = [
    ["packages/core/src/index.ts", "packages/core/src/log.ts"],                // 1
    ["packages/ui/src/button.ts", "packages/core/src/log.ts"],                 // 2 workspace, lib → src
    ["packages/ui/src/index.ts", "packages/ui/src/button.ts"],                 // 3
    ["src/app/legacy.ts", "src/base/common/strings.ts"],                       // 4
    ["src/app/main.ts", "packages/ui/src/index.ts"],                           // 6 workspace, export "."
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
    ["src/platform/node/storageFile.ts", "packages/core/src/index.ts"],        // 27 workspace, main lib/index.js → src/index.ts
    ["src/platform/node/storageFile.ts", "src/base/node/fs.ts"],               // 28
    ["src/platform/node/storageFile.ts", "src/editor/common/model.ts"],        // 29
    ["src/platform/node/storageFile.ts", "src/platform/common/storage.ts"],    // 30
    ["tools/fixtures/legacy-ids.ts", "src/base/common/strings.ts"],            // 31 module id through src
];
// The ones only a bare-specifier resolver finds: #2, #6, #27 (workspace) and #31 (module id).
const BARE = new Set(["packages/ui/src/button.ts>packages/core/src/log.ts", "src/app/main.ts>packages/ui/src/index.ts",
    "src/platform/node/storageFile.ts>packages/core/src/index.ts", "tools/fixtures/legacy-ids.ts>src/base/common/strings.ts"]);

const byPath = (a: readonly [string, string], b: readonly [string, string]): number =>
    (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const sortedEdges = (edges: readonly (readonly [string, string])[]): [string, string][] => edges.map(([a, b]): [string, string] => [a, b]).sort(byPath);

describe("scanRepo on the arch-repo fixture (no .git, so it walks)", () => {
    it("lists the 21 source files and, with the truth resolver for bare specifiers, the 30 edges (all but the computed #5)", () => {
        const files = scanRepo(FIXTURE).files;
        expect(files).toEqual(ARCH_FILES);
        const g = scanRepo(FIXTURE, { resolveBare: createTruthResolver(FIXTURE, files) });
        expect(g.files).toEqual(ARCH_FILES);
        expect(sortedEdges(g.edges)).toEqual(sortedEdges(ARCH_EDGES_30));
    });

    it("without a bare resolver keeps only the 26 relative edges, as Eval #1's truths were built", () => {
        expect(sortedEdges(scanRepo(FIXTURE).edges)).toEqual(sortedEdges(ARCH_EDGES_30.filter(([a, b]) => !BARE.has(`${a}>${b}`))));
    });
});

describe("listFiles", () => {
    let root = "";
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-walk-"));
        for (const file of ["b.ts", "a/x.ts", ".github/notes.md", "node_modules/pkg/index.ts", "a/node_modules/y.js"]){
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), "");
        }
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("walks a folder without .git, sorted, never into node_modules", () => {
        expect(listFiles(root)).toEqual([".github/notes.md", "a/x.ts", "b.ts"]);
    });
});

describe("computedSites", () => {
    it("finds the fixture's one import(<identifier>), on line 5 of src/app/loader.ts", () => {
        expect(computedSites(FIXTURE, ARCH_FILES)).toEqual([{ file: "src/app/loader.ts", line: 5, expression: "url" }]);
    });

    it("skips comment lines and literal or member specifiers, and keeps each site's line", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-sites-"));
        try {
            fs.writeFileSync(path.join(root, "a.ts"), [
                "// return import(commented);",  // 1: a comment line
                " * import(docComment)",         // 2: a doc-comment line
                "const m = await import('./m');", // 3: a literal, which the scanner reads
                "load(() => import( target ));",  // 4: a site
                "import(config.url);",            // 5: a member expression, not an identifier
                "const $x = import($moduleId);",  // 6: a site
            ].join("\r\n"));
            expect(computedSites(root, ["a.ts"])).toEqual([
                { file: "a.ts", line: 4, expression: "target" },
                { file: "a.ts", line: 6, expression: "$moduleId" },
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("importSpecifiers", () => {
    it("reads every import form, skipping comment lines, catching a multi-line import by its from line", () => {
        const text = [
            "import { a } from './a.js';",
            'import type { B } from "../b";',
            "export * from './c';",
            'export { d } from "./d.js";',
            "import './side-effect.css';",
            "const e = await import('./e.js');",
            'const f = require("./f");',
            "// import { g } from './commented.js';",
            " * import { h } from './doc-comment.js';",
            "import {",
            "    i,",
            "} from './multi.js';",
        ].join("\n");
        expect(importSpecifiers(text)).toEqual(["./a.js", "../b", "./c", "./d.js", "./side-effect.css", "./e.js", "./f", "./multi.js"]);
    });

    it("reads a dynamic import with a bundler comment before the quote, and a minified side-effect import", () => {
        const text = 'const d = await import(/* webpackChunkName: "d" */ \'./d.js\');\nimport"./min.js";';
        expect(importSpecifiers(text)).toEqual(["./d.js", "./min.js"]);
    });
});

describe("resolveRelative", () => {
    const known = new Set(["src/a.ts", "src/b/index.ts", "src/c.tsx", "src/d.js", "lib/e.mts"]);

    it("resolves .js to .ts, adds extensions, finds index files", () => {
        expect(resolveRelative("src/x.ts", "./a.js", known)).toBe("src/a.ts");
        expect(resolveRelative("src/x.ts", "./b", known)).toBe("src/b/index.ts");
        expect(resolveRelative("src/x.ts", "./c", known)).toBe("src/c.tsx");
        expect(resolveRelative("src/x.ts", "./d.js", known)).toBe("src/d.js");
        expect(resolveRelative("src/x.ts", "../lib/e.mjs", known)).toBe("lib/e.mts");
        expect(resolveRelative("src/deep/x.ts", "../a", known)).toBe("src/a.ts");
    });

    it("leaves packages, missing files and non-code files unresolved", () => {
        expect(resolveRelative("src/x.ts", "react", known)).toBeNull();
        expect(resolveRelative("src/x.ts", "./missing", known)).toBeNull();
        expect(resolveRelative("src/x.ts", "./a.css", known)).toBeNull();
    });

    it("falls back to a .d.ts declaration file, after every real source candidate", () => {
        const declarations = new Set(["src/api/git.d.ts", "src/types/index.d.ts"]);
        expect(resolveRelative("src/x.ts", "./api/git", declarations)).toBe("src/api/git.d.ts");
        expect(resolveRelative("src/x.ts", "./api/git.js", declarations)).toBe("src/api/git.d.ts");
        expect(resolveRelative("src/x.ts", "./types", declarations)).toBe("src/types/index.d.ts");
        expect(resolveRelative("src/x.ts", "./api/git", new Set([...declarations, "src/api/git.ts"]))).toBe("src/api/git.ts");
    });

    it("resolves a bare or trailing-slash specifier to the index file of the folder it names", () => {
        const folders = new Set(["index.ts", "src/dir/index.ts", "src/index.ts"]);
        expect(resolveRelative("src/x.ts", "..", folders)).toBe("index.ts");
        expect(resolveRelative("src/x.ts", "./dir/", folders)).toBe("src/dir/index.ts");
        expect(resolveRelative("src/x.ts", "./", folders)).toBe("src/index.ts");
    });
});

// Every way a source names a module: import/export ... from (one or many lines, either quote), a bare import, import() and require().
// The same reader as lib/engine/rank.test.ts, so a single-line, double-quoted import is not the only form the pin can see.
function moduleSpecifiers(source: string): string[] {
    const found: { at: number; specifier: string }[] = [];
    const collect = (pattern: RegExp, read: (m: RegExpMatchArray) => string): void => {
        for (const m of source.matchAll(pattern)) found.push({ at: m.index ?? 0, specifier: read(m) });
    };
    collect(/\b(?:import|export)\b[^"';]*?\bfrom\s*(["'])([^"']+)\1/g, (m) => m[2]);
    collect(/\bimport\s*(["'])([^"']+)\1/g, (m) => m[2]);
    collect(/\b(?:import|require)\s*\(\s*(?:(["'])([^"']+)\1\s*\))?/g, (m) => m[2] ?? "<dynamic>");
    return found.sort((a, b) => a.at - b.at).map((f) => f.specifier);
}

// A specifier reaches lib/ when it is relative and climbs into a lib folder, or goes through the @/ alias, or names lib/ itself.
const reachesLib = (specifier: string): boolean => /(^|\/)lib(\/|$)/.test(specifier) || specifier.startsWith("@/");

describe("the scanner's independence (R3)", () => {
    it("reads every specifier form and flags the ones that reach lib/", () => {
        const source = [
            "import { a } from './a';",
            "import {",
            "    b,",
            "} from '../../lib/b';",
            'export * from "@/lib/c";',
            'import "../lib/d";',
            'const e = await import("../../lib/e");',
            "const f = require('../../lib/f');",
            'const g = require("../../lib/x");',
            'import fs from "fs";',
        ].join("\n");
        expect(moduleSpecifiers(source).filter(reachesLib)).toEqual([
            "../../lib/b", "@/lib/c", "../lib/d", "../../lib/e", "../../lib/f", "../../lib/x",
        ]);
        expect(moduleSpecifiers('import { execFileSync } from "child_process";').filter(reachesLib)).toEqual([]);
    });

    it("imports nothing from lib/: the scanner, the truths, the truth's resolver and the second extractor (R2)", () => {
        for (const file of ["scripts/eval/scan.ts", "scripts/eval/truth.ts", "scripts/eval/resolve-truth.ts", "scripts/eval/ts-graph.ts"]){
            const specifiers = moduleSpecifiers(fs.readFileSync(file, "utf8"));
            expect({ file, fromLib: specifiers.filter(reachesLib) }).toEqual({ file, fromLib: [] });
            // A reader that stopped matching would pass the check above for any file, so the files that import must be seen
            // importing (truth.ts imports nothing).
            if (!file.endsWith("truth.ts") || file.endsWith("resolve-truth.ts")) expect({ file, found: specifiers.length > 0 }).toEqual({ file, found: true });
        }
    });
});
