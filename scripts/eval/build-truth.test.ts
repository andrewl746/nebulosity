import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
    TRUTH_TABLE, applyAdjudications, buildRepoGraphs, buildTruth, edgeDifferences, importLines, parseArgs, parseTruthSpecs, restingEdges,
    sampleEdges, specsFor, successors, type Adjudication,
} from "./build-truth";
import { loadDefinition } from "./definition";
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

    it("finds a bare specifier's line through the resolver it is given", () => {
        const resolveBare = (_from: string, specifier: string): string | null => (specifier === "@x/e" ? "src/e.ts" : null);
        expect(importLines("import e from '@x/e';\nimport r from 'react';", "src/a.ts", () => true, known, resolveBare)).toEqual([
            { target: "src/e.ts", line: 1, text: "import e from '@x/e';", spansLines: false },
        ]);
    });
});

// ---- the new kinds, on the arch-repo fixture (every expectation is its ground truth's, "the truth builder")

const FIXTURE = path.resolve("test/fixtures/arch-repo");
const STRINGS = "src/base/common/strings.ts";
const MODEL = "src/editor/common/model.ts";
const LOADER: Adjudication = {
    repo: "arch", from: "src/app/loader.ts", line: 5, to: "src/app/main.ts", decision: "in",
    why: "url is './main.js' in dev, else new URL('app/main.js', import.meta.url).href: src/app/main.ts either way.",
};

describe("buildRepoGraphs on the arch-repo fixture", () => {
    const built = buildRepoGraphs(FIXTURE, "arch", [LOADER, { ...LOADER, repo: "other", to: "src/app/legacy.ts" }], { resolveBare: true });

    it("finds the two extractors agreeing on every edge, and the one computed site with its verdict", () => {
        expect(built.differences).toEqual({ scannerOnly: [], preProcessOnly: [] });
        expect(built.scanner.edges.length).toBe(30);
        expect(built.sites).toEqual([{ file: "src/app/loader.ts", line: 5, expression: "url", verdicts: [LOADER] }]);
    });

    it("adds the decided site's edge, and only this repo's verdicts, for the 31 edges", () => {
        expect(built.graph.edges.length).toBe(31);
        expect(built.graph.edges.filter(([a]) => a === "src/app/loader.ts")).toEqual([["src/app/loader.ts", "src/app/main.ts"]]);
    });

    it("writes each new kind's truth file from the 31 edges", () => {
        const g = built.graph;
        expect(buildTruth(g, { id: "g1", kind: "impact", target: STRINGS, folders: ["src/app", "src/base", "src/editor", "src/platform"] })).toEqual({
            id: "g1", kind: "impact", target: STRINGS, counts: [["src/app", 3], ["src/base", 4], ["src/editor", 5], ["src/platform", 3]], elsewhere: 1, total: 16, verified: false, notes: [],
        });
        expect(buildTruth(g, { id: "g2", kind: "cycle", file: MODEL })).toEqual({
            id: "g2", kind: "cycle", file: MODEL, shortest: 3, example: [MODEL, "src/editor/common/tokens.ts", "src/editor/common/textModel.ts", MODEL], verified: false, notes: [],
        });
        expect(buildTruth(g, { id: "g2b", kind: "cycle", file: "src/platform/common/storage.ts" })).toMatchObject({ shortest: null, example: null });
        expect(buildTruth(g, { id: "g3", kind: "unused", folder: "src" })).toEqual({
            id: "g3", kind: "unused", folder: "src", files: ["src/app/legacy.ts", "src/app/loader.ts"], verified: false, notes: [],
        });
        expect(buildTruth(g, { id: "g4", kind: "violations", from: "src/platform", to: "src/editor" })).toEqual({
            id: "g4", kind: "violations", from: "src/platform", to: "src/editor", files: ["src/platform/node/storageFile.ts"], verified: false, notes: [],
        });
        expect(buildTruth(g, { id: "g5", kind: "entries", target: STRINGS })).toEqual({
            id: "g5", kind: "entries", target: STRINGS, files: ["src/app/legacy.ts", "src/app/loader.ts", "tools/fixtures/legacy-ids.ts"], verified: false, notes: [],
        });
        expect(buildTruth(g, { id: "g6", kind: "pairs", folder: "src" })).toEqual({
            id: "g6", kind: "pairs", folder: "src", names: null, verified: false, notes: [],
            pairs: [["app", "base"], ["app", "editor"], ["app", "platform"], ["editor", "base"], ["editor", "platform"], ["platform", "base"], ["platform", "editor"]],
        });
        expect(buildTruth(g, { id: "g7", kind: "pairs", folder: "src", names: ["common", "browser", "node"] })).toEqual({
            id: "g7", kind: "pairs", folder: "src", names: ["common", "browser", "node"], verified: false, notes: [],
            pairs: [["browser", "browser"], ["browser", "common"], ["common", "browser"], ["common", "common"], ["node", "common"], ["node", "node"]],
        });
    });

    it("leaves an undecided site out of the truths: without #5, main.ts is imported by nothing and loader.ts loads nothing", () => {
        const undecided = buildRepoGraphs(FIXTURE, "arch", [], { resolveBare: true });
        expect(undecided.sites).toEqual([{ file: "src/app/loader.ts", line: 5, expression: "url", verdicts: [] }]);
        expect(buildTruth(undecided.graph, { id: "u", kind: "unused", folder: "src" }).files).toEqual(["src/app/legacy.ts", "src/app/loader.ts", "src/app/main.ts"]);
        // strings.ts's 15 dependents without loader.ts; nothing imports legacy.ts, legacy-ids.ts, the test, or now main.ts,
        // which reaches strings.ts through editorView.ts → dom.ts, so it is a root in loader.ts's place
        expect(buildTruth(undecided.graph, { id: "e", kind: "entries", target: STRINGS }).files).toEqual(["src/app/legacy.ts", "src/app/main.ts", "tools/fixtures/legacy-ids.ts"]);
        expect(buildTruth(undecided.graph, { id: "i", kind: "impact", target: STRINGS, folders: ["src/app"] })).toMatchObject({ counts: [["src/app", 2]], total: 15 });
    });

    it("names the edges each truth rests on: a cycle's steps, each entry's way to the target, one edge per pair, none for files nothing imports", () => {
        const g = built.graph;
        expect(restingEdges(g, buildTruth(g, { id: "c", kind: "cycle", file: MODEL }))).toEqual([
            [MODEL, "src/editor/common/tokens.ts"], ["src/editor/common/textModel.ts", MODEL], ["src/editor/common/tokens.ts", "src/editor/common/textModel.ts"],
        ]);
        // successors from strings.ts: loader → main (4 steps), main → editorView (3), editorView → dom (2), dom → strings (1)
        expect(restingEdges(g, buildTruth(g, { id: "e", kind: "entries", target: STRINGS }))).toEqual([
            ["src/app/legacy.ts", STRINGS], ["src/app/loader.ts", "src/app/main.ts"], ["src/app/main.ts", "src/editor/browser/editorView.ts"],
            ["src/base/browser/dom.ts", STRINGS], ["src/editor/browser/editorView.ts", "src/base/browser/dom.ts"], ["tools/fixtures/legacy-ids.ts", STRINGS],
        ]);
        // each pair's first edge in path order
        expect(restingEdges(g, buildTruth(g, { id: "p", kind: "pairs", folder: "src", names: ["common", "browser", "node"] }))).toEqual([
            ["src/base/browser/dom.ts", STRINGS], ["src/base/common/arrays.ts", STRINGS], ["src/base/node/fs.ts", "src/base/common/arrays.ts"],
            ["src/editor/browser/editorView.ts", "src/base/browser/dom.ts"], ["src/editor/node/editorFiles.ts", "src/base/node/fs.ts"],
            ["src/platform/common/storage.ts", "src/platform/browser/storageView.ts"],
        ]);
        expect(restingEdges(g, buildTruth(g, { id: "u", kind: "unused", folder: "src" }))).toEqual([]);
    });
});

describe("adjudications, the two graphs' differences and the sample", () => {
    const g: Graph = { files: ["a.ts", "b.ts", "c.ts"], edges: [["a.ts", "b.ts"], ["b.ts", "c.ts"]] };

    it("adds an edge decided in, removes one decided out, and leaves the graph alone for a site that imports nothing in the repo", () => {
        const verdicts: Adjudication[] = [
            { repo: "r", from: "c.ts", to: "a.ts", line: 3, decision: "in", why: "" },
            { repo: "r", from: "a.ts", to: "b.ts", decision: "out", why: "inside a string" },
            { repo: "r", from: "b.ts", to: null, line: 9, decision: "out", why: "loads a URL outside the repo" },
        ];
        expect(applyAdjudications(g, verdicts)).toEqual({ files: g.files, edges: [["b.ts", "c.ts"], ["c.ts", "a.ts"]] });
    });

    it("lists the edges one graph has and the other lacks, sorted", () => {
        const other: Graph = { files: g.files, edges: [["b.ts", "c.ts"], ["c.ts", "a.ts"], ["a.ts", "c.ts"]] };
        expect(edgeDifferences(g, other)).toEqual({ scannerOnly: [["a.ts", "b.ts"]], preProcessOnly: [["a.ts", "c.ts"], ["c.ts", "a.ts"]] });
    });

    it("samples a fixed number of distinct edges by a fixed seed, whatever order they come in", () => {
        const edges: [string, string][] = Array.from({ length: 100 }, (_, i) => [`f${String(i).padStart(3, "0")}.ts`, "t.ts"]);
        const sample = sampleEdges(edges, 30);
        expect(sample.length).toBe(30);
        expect(new Set(sample.map(([a]) => a)).size).toBe(30);
        expect(sample.every(([a, b]) => edges.some(([x, y]) => x === a && y === b))).toBe(true);
        expect(sampleEdges([...edges].reverse(), 30)).toEqual(sample);
        expect(sample).toEqual([...sample].sort(([a], [b]) => (a < b ? -1 : 1)));
        expect(sampleEdges(edges.slice(0, 5), 30)).toEqual(edges.slice(0, 5));
    });
});

describe("the specs and the arguments", () => {
    it("checks truth-specs.json: known kinds, the definition's repos, each kind's fields, no id twice", () => {
        const specs = [
            { id: "x", repo: "vscode", kind: "impact", target: "a.ts", folders: ["src"] },
            { id: "y", repo: "affine", kind: "pairs", folder: "src" },
        ];
        expect(parseTruthSpecs(specs, ["vscode", "affine"])).toEqual(specs);
        expect(() => parseTruthSpecs([{ id: "x", repo: "vscode", kind: "graph" }], ["vscode"])).toThrow(/kind/);
        expect(() => parseTruthSpecs([{ id: "x", repo: "nope", kind: "unused", folder: "src" }], ["vscode"])).toThrow(/repo/);
        expect(() => parseTruthSpecs([{ id: "x", repo: "vscode", kind: "impact", target: "a.ts" }], ["vscode"])).toThrow(/folders/);
        expect(() => parseTruthSpecs([specs[0], specs[0]], ["vscode", "affine"])).toThrow(/twice/);
    });

    it("gives Eval #1 its ten truths on its one repo, and stops with a sentence when another eval has no truth-specs.json", () => {
        expect(specsFor(loadDefinition(path.resolve("eval")))).toEqual(TRUTH_TABLE.map((s) => ({ ...s, repo: "vscode" })));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-eval-"));
        try {
            fs.copyFileSync(path.resolve("eval2", "eval.json"), path.join(dir, "eval.json"));
            expect(() => specsFor(loadDefinition(dir))).toThrow(/truth-specs\.json/);
            fs.writeFileSync(path.join(dir, "truth-specs.json"), JSON.stringify([{ id: "x", repo: "affine", kind: "cycle", file: "a.ts" }]));
            expect(specsFor(loadDefinition(dir))).toEqual([{ id: "x", repo: "affine", kind: "cycle", file: "a.ts" }]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("reads --eval, --force, --out and --resolve-bare, and refuses a flag it doesn't know or one missing its value", () => {
        expect(parseArgs(["--eval", "eval2"])).toEqual({ evalDir: "eval2", force: false, out: null, resolveBare: false, paths: [] });
        expect(parseArgs(["../vscode", "--force", "--out", ".nebulosity/eval/rebuild", "--resolve-bare"])).toEqual({
            evalDir: "eval", force: true, out: ".nebulosity/eval/rebuild", resolveBare: true, paths: ["../vscode"],
        });
        expect(() => parseArgs(["--out"])).toThrow(/usage/);
        expect(() => parseArgs(["--eval", "--force"])).toThrow(/usage/);
        expect(() => parseArgs(["--frobnicate"])).toThrow(/usage/);
    });
});
