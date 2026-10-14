import { describe, expect, it } from "vitest";
import { TRUTH_TABLE, buildTruth, importLines, successors } from "./build-truth";
import type { Graph } from "./truth";

// The same small graph truth.test.ts uses: a → b → c → d, a → dir/e → dir/f → c.
const G: Graph = {
    files: ["a.ts", "b.ts", "c.ts", "d.ts", "dir/e.ts", "dir/f.ts"],
    edges: [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"], ["a.ts", "dir/e.ts"], ["dir/e.ts", "dir/f.ts"], ["dir/f.ts", "c.ts"]],
};

describe("TRUTH_TABLE", () => {
    it("is D2's ten truths: five lists and five chains", () => {
        expect(TRUTH_TABLE).toEqual([
            { id: "cl1", kind: "list", target: "src/vs/workbench/contrib/search/common/search.ts", scope: "direct", planning: "22 files" },
            { id: "cl2", kind: "list", target: "src/vs/workbench/contrib/debug", scope: "outside", planning: "38 files" },
            { id: "cl3", kind: "list", target: "src/vs/editor/standalone", scope: "outside", planning: "3 files" },
            { id: "cl4", kind: "list", target: "src/vs/workbench/contrib/markers/common/markers.ts", scope: "transitive", planning: "63 files (10 direct)" },
            { id: "cl5", kind: "list", target: "src/vs/platform/undoRedo", scope: "outside", planning: "55 files" },
            { id: "cn1", kind: "chain", from: "src/vs/workbench/workbench.desktop.main.ts", to: "src/vs/workbench/contrib/terminal/browser/terminalInstance.ts", planning: "4 steps" },
            { id: "cn2", kind: "chain", from: "src/vs/workbench/workbench.web.main.ts", to: "src/vs/workbench/contrib/debug/browser/debugSession.ts", planning: "5 steps" },
            { id: "cn3", kind: "chain", from: "src/vs/workbench/api/common/extHost.api.impl.ts", to: "src/vs/editor/common/model/textModel.ts", planning: "4 steps (through notebook code)" },
            { id: "cn4", kind: "chain", from: "src/vs/base/common/strings.ts", to: "src/vs/workbench", planning: "none" },
            { id: "cn5", kind: "chain", from: "src/vs/workbench/contrib/scm/browser/scmViewPane.ts", to: "src/vs/platform/undoRedo/common/undoRedo.ts", planning: "3 steps" },
        ]);
    });
});

describe("buildTruth", () => {
    it("writes a list truth in the brief's shape, unverified and without notes", () => {
        expect(buildTruth(G, { id: "x1", kind: "list", target: "c.ts", scope: "direct", planning: "" })).toEqual({
            id: "x1", kind: "list", target: "c.ts", scope: "direct", files: ["b.ts", "dir/f.ts"], verified: false, notes: [],
        });
        expect(Object.keys(buildTruth(G, { id: "x1", kind: "list", target: "c.ts", scope: "direct", planning: "" }))).toEqual(
            ["id", "kind", "target", "scope", "files", "verified", "notes"]);
    });

    it("covers the outside and transitive scopes", () => {
        expect(buildTruth(G, { id: "x2", kind: "list", target: "dir", scope: "outside", planning: "" }).files).toEqual(["a.ts"]);
        expect(buildTruth(G, { id: "x3", kind: "list", target: "d.ts", scope: "transitive", planning: "" }).files).toEqual(
            ["a.ts", "b.ts", "c.ts", "dir/e.ts", "dir/f.ts"]);
    });

    it("counts a chain's steps (one fewer than its files) and keeps the example", () => {
        const chain = buildTruth(G, { id: "y1", kind: "chain", from: "a.ts", to: "d.ts", planning: "" });
        expect(chain).toEqual({
            id: "y1", kind: "chain", from: "a.ts", to: "d.ts", connected: true, shortest: 3, example: ["a.ts", "b.ts", "c.ts", "d.ts"], verified: false, notes: [],
        });
        expect(Object.keys(chain)).toEqual(["id", "kind", "from", "to", "connected", "shortest", "example", "verified", "notes"]);
    });

    it("ends a chain at the first file inside a target folder", () => {
        const chain = buildTruth(G, { id: "y2", kind: "chain", from: "a.ts", to: "dir", planning: "" });
        expect(chain).toMatchObject({ connected: true, shortest: 1, example: ["a.ts", "dir/e.ts"] });
    });

    it("says so when nothing connects: not connected, no steps, no example", () => {
        expect(buildTruth(G, { id: "y3", kind: "chain", from: "d.ts", to: "a.ts", planning: "" })).toMatchObject({
            connected: false, shortest: null, example: null,
        });
    });
});

describe("successors", () => {
    it("gives every dependent its next step toward the target and its distance, breadth first with importers in path order", () => {
        // from d.ts: c.ts imports it (1 step); b.ts and dir/f.ts import c.ts (2); a.ts imports b.ts (3) and dir/e.ts imports dir/f.ts (3).
        // a.ts also imports dir/e.ts, but b.ts is reached first, so it stays a.ts's way.
        expect(successors(G, "d.ts")).toEqual(new Map([
            ["c.ts", { next: "d.ts", steps: 1 }],
            ["b.ts", { next: "c.ts", steps: 2 }],
            ["dir/f.ts", { next: "c.ts", steps: 2 }],
            ["a.ts", { next: "b.ts", steps: 3 }],
            ["dir/e.ts", { next: "dir/f.ts", steps: 3 }],
        ]));
    });
});

describe("importLines", () => {
    const known = new Set(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"]);
    const text = [
        "import { A } from './b';",          // 1
        "// import { Z } from './b';",       // 2: a comment
        "export * from './b';",              // 3: a re-export
        "import './c';",                     // 4: a side-effect import
        "const d = await import('./d');",    // 5: import()
        "import {",                          // 6
        "    X,",                            // 7
        "} from './b';",                     // 8: the specifier is on the last line of the statement
        "import e from",                     // 9
        "    './e';",                        // 10: the quote is on a line of its own
        "import f from 'lodash';",           // 11: not relative
    ].join("\r\n");

    it("finds the lines whose import resolves to a wanted file, skipping comments and bare specifiers", () => {
        expect(importLines(text, "src/a.ts", (t) => t === "src/b.ts", known)).toEqual([
            { target: "src/b.ts", line: 1, text: "import { A } from './b';", spansLines: false },
            { target: "src/b.ts", line: 3, text: "export * from './b';", spansLines: false },
            { target: "src/b.ts", line: 8, text: "} from './b';", spansLines: false },
        ]);
        expect(importLines(text, "src/a.ts", (t) => t === "src/c.ts" || t === "src/d.ts", known)).toEqual([
            { target: "src/c.ts", line: 4, text: "import './c';", spansLines: false },
            { target: "src/d.ts", line: 5, text: "const d = await import('./d');", spansLines: false },
        ]);
    });

    it("falls back to the line holding the quoted path when a statement's keyword and path are on different lines", () => {
        expect(importLines(text, "src/a.ts", (t) => t === "src/e.ts", known)).toEqual([
            { target: "src/e.ts", line: 10, text: "'./e';", spansLines: true },
        ]);
    });

    it("never counts a file as importing itself", () => {
        expect(importLines("import './a';", "src/a.ts", () => true, known)).toEqual([]);
    });
});
