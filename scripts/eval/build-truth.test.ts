import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
    TRUTH_TABLE, applyAdjudications, applyCallVerdicts, buildRepoGraphs, buildTruth, callsEvidence, checkVerdicts, confirmingVerdicts, edgeDifferences, importLines, loadTruthAdjudications,
    parseAdjudications, parseArgs, parseCallAdjudications, parseTruthSpecs, restingEdges, sampleEdges, specsFor, successors, taskTests, type Adjudication,
    type CallTruthFile, type TaskTruthFile,
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

    it("checks the verdicts against the graphs: the loader's verdict decides its site and adds one edge", () => {
        // built.verdicts holds only this repo's (the "other" repo's verdict is left out), and LOADER names loader.ts's site at L5
        expect(checkVerdicts(built)).toEqual({ in: 1, out: 0, edgesAdded: 1, edgesRemoved: 0, confirmed: 0, leftOut: 0, sitesDecided: 1 });
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

    it("refuses a verdict for a repo the eval doesn't have, naming it", () => {
        const verdict = { repo: "nope", from: "a.ts", to: "b.ts", decision: "out", why: "" };
        expect(parseAdjudications([verdict])).toEqual([verdict]);
        expect(() => parseAdjudications([verdict], ["vscode", "affine"])).toThrow(/nope/);
        expect(parseAdjudications([{ ...verdict, repo: "affine" }], ["vscode", "affine"])).toEqual([{ ...verdict, repo: "affine" }]);
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

describe("checkVerdicts: every verdict must take effect, or the build stops with a sentence naming it", () => {
    // The regex scanner's graph: a → b, b → c, and c → d (say, a path inside a string). preProcessFile's: a → b, b → c and
    // a → e (say, a statement the regex can't read). s.ts holds two computed import() sites, at L5 and L9.
    const FILES = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "s.ts"];
    const base = {
        scanner: { files: FILES, edges: [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"]] as [string, string][] },
        preProcess: { files: FILES, edges: [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["a.ts", "e.ts"]] as [string, string][] },
        known: new Set(FILES),
        sites: [{ file: "s.ts", line: 5, expression: "url" }, { file: "s.ts", line: 9, expression: "mod" }],
    };
    const v = (x: Pick<Adjudication, "from" | "to" | "decision"> & { line?: number }): Adjudication => ({ repo: "r", why: "read", ...x });
    const check = (...verdicts: Adjudication[]): ReturnType<typeof checkVerdicts> => checkVerdicts({ ...base, verdicts });

    it("counts what each kind of verdict did", () => {
        // c → d out: a scanner edge removed. a → e in: preProcessFile's edge added. s → a and s → b in at L5: one site decided,
        // two edges added (a site may load several files). s at L9 out with to null: a second site decided, loading nothing here.
        expect(check(
            v({ from: "c.ts", to: "d.ts", decision: "out" }),
            v({ from: "a.ts", to: "e.ts", decision: "in" }),
            v({ from: "s.ts", to: "a.ts", line: 5, decision: "in" }),
            v({ from: "s.ts", to: "b.ts", line: 5, decision: "in" }),
            v({ from: "s.ts", to: null, line: 9, decision: "out" }),
        )).toEqual({ in: 3, out: 2, edgesAdded: 3, edgesRemoved: 1, confirmed: 0, leftOut: 0, sitesDecided: 2 });
        // a → e out: preProcessFile's edge decided out, so the truth's graph (the scanner's) is unchanged
        expect(check(v({ from: "a.ts", to: "e.ts", decision: "out" }))).toEqual({ in: 0, out: 1, edgesAdded: 0, edgesRemoved: 0, confirmed: 0, leftOut: 1, sitesDecided: 0 });
        // c → d in: the scanner's edge that preProcessFile lacks, confirmed by reading (the truth's graph unchanged)
        expect(check(v({ from: "c.ts", to: "d.ts", decision: "in" }))).toEqual({ in: 1, out: 0, edgesAdded: 0, edgesRemoved: 0, confirmed: 1, leftOut: 0, sitesDecided: 0 });
        // b → a in, from a file with no computed site: an import read by hand that neither extractor finds
        expect(check(v({ from: "b.ts", to: "a.ts", decision: "in" }))).toEqual({ in: 1, out: 0, edgesAdded: 1, edgesRemoved: 0, confirmed: 0, leftOut: 0, sitesDecided: 0 });
        expect(check()).toEqual({ in: 0, out: 0, edgesAdded: 0, edgesRemoved: 0, confirmed: 0, leftOut: 0, sitesDecided: 0 });
    });

    it("stops on an out that matches no edge of either extractor", () => {
        expect(() => check(v({ from: "a.ts", to: "c.ts", decision: "out" }))).toThrow(/a\.ts → c\.ts.*neither extractor/);
    });

    it("stops on an in that names a file the repo doesn't have", () => {
        expect(() => check(v({ from: "a.ts", to: "zz.ts", decision: "in" }))).toThrow(/a\.ts → zz\.ts.*zz\.ts isn't/);
        expect(() => check(v({ from: "zz.ts", to: "a.ts", decision: "in" }))).toThrow(/zz\.ts → a\.ts.*zz\.ts isn't/);
    });

    it("stops on a line that is no computed site's", () => {
        expect(() => check(v({ from: "s.ts", to: "a.ts", line: 7, decision: "in" }))).toThrow(/s\.ts → a\.ts \(L7\).*L5, L9/);
        expect(() => check(v({ from: "a.ts", to: "b.ts", line: 1, decision: "in" }))).toThrow(/a\.ts → b\.ts \(L1\).*no computed import\(\) site/);
    });

    it("stops on a site verdict without its line, and on an out that names both a site and a file", () => {
        expect(() => check(v({ from: "s.ts", to: null, decision: "out" }))).toThrow(/s\.ts → nothing.*line/);
        // an in from a file with computed sites, on an edge neither extractor finds, must say which site it decides
        expect(() => check(v({ from: "s.ts", to: "c.ts", decision: "in" }))).toThrow(/s\.ts → c\.ts.*L5, L9/);
        expect(() => check(v({ from: "s.ts", to: "a.ts", line: 5, decision: "out" }))).toThrow(/s\.ts → a\.ts \(L5\).*to: null/);
    });

    it("stops on a verdict that changes nothing: an in on an edge both extractors already have, without a site's line", () => {
        expect(() => check(v({ from: "a.ts", to: "b.ts", decision: "in" }))).toThrow(/a\.ts → b\.ts.*both extractors already/);
    });

    it("stops on a verdict given twice, and on an edge or a site decided both ways", () => {
        expect(() => check(v({ from: "c.ts", to: "d.ts", decision: "out" }), v({ from: "c.ts", to: "d.ts", decision: "out" }))).toThrow(/c\.ts → d\.ts.*twice/);
        expect(() => check(v({ from: "a.ts", to: "e.ts", decision: "in" }), v({ from: "a.ts", to: "e.ts", decision: "out" }))).toThrow(/a\.ts → e\.ts.*both/);
        expect(() => check(v({ from: "s.ts", to: "a.ts", line: 9, decision: "in" }), v({ from: "s.ts", to: null, line: 9, decision: "out" }))).toThrow(/L9.*both/);
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

describe("grading-time step verdicts stay out of the truths (sweep B, item 9)", () => {
    it("reads only <dir>/truth/adjudicated.json, so an 'out' on a step neither extractor finds, in steps.json, can't stop eval:truth", () => {
        const root = path.resolve("test/fixtures/arch-repo");
        // arrays.ts imports strings.ts alone (the arch-repo's edge table): a model's arrays.ts → main.ts step is neither extractor's
        const hallucinated: Adjudication = { repo: "fx", from: "src/base/common/arrays.ts", to: "src/app/main.ts", decision: "out", why: "a model's step" };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "truth-verdicts-"));
        try{
            fs.mkdirSync(path.join(dir, "truth"));
            fs.writeFileSync(path.join(dir, "truth", "adjudicated.json"), "[]\n");
            fs.writeFileSync(path.join(dir, "truth", "steps.json"), JSON.stringify([hallucinated]));
            const verdicts = loadTruthAdjudications(dir, ["fx"]);
            expect(verdicts).toEqual([]);
            expect(() => checkVerdicts(buildRepoGraphs(root, "fx", verdicts, { resolveBare: true }))).not.toThrow();
            // the same verdict in adjudicated.json is what would stop the build
            expect(() => checkVerdicts(buildRepoGraphs(root, "fx", [hallucinated], { resolveBare: true }))).toThrow("matches an edge neither extractor finds");
            // and a missing adjudicated.json is no verdicts
            fs.rmSync(path.join(dir, "truth", "adjudicated.json"));
            expect(loadTruthAdjudications(dir, ["fx"])).toEqual([]);
        } finally{
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("the call and task specs (Task 10)", () => {
    const repos = ["vscode"];
    it("takes callers, breaks, adopt, injects and task specs with their fields", () => {
        const specs = [
            { id: "a", repo: "vscode", kind: "breaks", type: "IFoo", file: "src/foo.ts", member: "save", within: "src" },
            { id: "b", repo: "vscode", kind: "injects", type: "IFoo", file: "src/foo.ts" },
            { id: "c", repo: "vscode", kind: "task", type: "IFoo", file: "src/foo.ts", member: "save" },
            { id: "d", repo: "vscode", kind: "adopt", type: "IFoo", file: "src/foo.ts", member: "save" },
            { id: "e", repo: "vscode", kind: "callers", type: "IFoo", file: "src/foo.ts", member: "save" },
        ];
        expect(parseTruthSpecs(specs, repos)).toEqual(specs);
    });

    it("refuses a call kind without type or file, a member kind without member, and a within that isn't a string, each in a sentence", () => {
        const base = { id: "q", repo: "vscode", kind: "callers", type: "IFoo", file: "src/foo.ts", member: "save" };
        expect(() => parseTruthSpecs([{ ...base, type: undefined }], repos)).toThrow(/q \(callers\) needs type, the name of a class or interface/);
        expect(() => parseTruthSpecs([{ ...base, file: undefined }], repos)).toThrow(/q \(callers\) needs file, a repo path/);
        expect(() => parseTruthSpecs([{ ...base, member: undefined }], repos)).toThrow(/q \(callers\) needs member/);
        expect(() => parseTruthSpecs([{ ...base, kind: "task", member: undefined }], repos)).toThrow(/q \(task\) needs member/);
        expect(() => parseTruthSpecs([{ ...base, kind: "injects", member: undefined }], repos)).not.toThrow();
        expect(() => parseTruthSpecs([{ ...base, within: 3 }], repos)).toThrow(/within/);
    });

    it("takes a task's tests: the test files among the files to change, and those that directly import one of them", () => {
        const g = {
            files: ["lib/x.spec.ts", "src/a.ts", "src/b.ts", "src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"],
            edges: [["src/test/a.test.ts", "src/a.ts"], ["src/test/c.test.ts", "src/test/b.test.ts"], ["lib/x.spec.ts", "src/b.ts"]] as [string, string][],
        };
        const change = ["src/a.ts", "src/b.ts", "src/test/b.test.ts"];
        // b.test is among the files to change (a test double's file); a.test imports a; c.test imports b.test; x.spec imports b
        expect(taskTests(change, g)).toEqual(["lib/x.spec.ts", "src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"]);
        expect(taskTests(change, g, "src")).toEqual(["src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"]);
    });

    it("refuses a call truth without the checker's program", () => {
        expect(() => buildTruth({ files: [], edges: [] }, { id: "q", repo: "vscode", kind: "callers", type: "IFoo", file: "src/foo.ts", member: "save" }))
            .toThrow("q: a callers truth needs the repo's checker program");
        expect(() => buildTruth({ files: [], edges: [] }, { id: "t", repo: "vscode", kind: "task", type: "IFoo", file: "src/foo.ts", member: "save" }))
            .toThrow("t: a task truth needs the repo's checker program");
    });

    const checked = { verified: false, notes: [] };
    const callFile: CallTruthFile = { id: "q", kind: "callers", type: "IFoo", file: "src/foo.ts", member: "save", within: null, files: ["src/a.ts", "src/b.ts"], ...checked };
    const g = { files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/c.test.ts"], edges: [["src/c.test.ts", "src/c.ts"]] as [string, string][] };
    const known = new Set(g.files);

    it("reads calls-adjudicated.json: a list of { id, file, decision, line, why }, one verdict a file", () => {
        const verdict = { id: "q", file: "src/c.ts", decision: "in", line: 4, why: "calls it through a cast" };
        expect(parseCallAdjudications([verdict], ["q"])).toEqual([verdict]);
        expect(() => parseCallAdjudications({}, ["q"])).toThrow(/list of verdicts/);
        expect(() => parseCallAdjudications([{ ...verdict, line: undefined }], ["q"])).toThrow(/needs id, file/);
        expect(() => parseCallAdjudications([{ ...verdict, id: "z" }], ["q"])).toThrow(/none of the call truths/);
        expect(() => parseCallAdjudications([verdict, verdict], ["q"])).toThrow(/two verdicts on src\/c\.ts/);
    });

    it("adds a file by an 'in' and takes one out by an 'out'", () => {
        const verdicts = parseCallAdjudications([
            { id: "q", file: "src/c.ts", decision: "in", line: 4, why: "w" }, { id: "q", file: "src/a.ts", decision: "out", line: 2, why: "w" },
        ]);
        expect(applyCallVerdicts(callFile, verdicts, g, known).files).toEqual(["src/b.ts", "src/c.ts"]);
        expect(applyCallVerdicts(callFile, [], g, known)).toBe(callFile);
    });

    it("stops, naming the verdict, when it names a file the repo lacks", () => {
        expect(() => applyCallVerdicts(callFile, [{ id: "q", file: "src/zzz.ts", decision: "in", line: 1, why: "w" }], g, known)).toThrow(/q's verdict "in" on src\/zzz\.ts can't take effect: .* isn't a code file of the repo/);
    });

    it("takes a verdict that agrees with the checker as a confirmation: the truth is unchanged, and the evidence lists it", () => {
        const verdicts = parseCallAdjudications([
            { id: "q", file: "src/a.ts", decision: "in", line: 3, why: "the index missed a real call" },
            { id: "q", file: "src/c.ts", decision: "out", line: 8, why: "the index's line is a comment" },
            { id: "q", file: "src/b.ts", decision: "out", line: 5, why: "a string, not a call" },
        ]);
        const applied = applyCallVerdicts(callFile, verdicts, g, known);
        expect(applied.files).toEqual(["src/a.ts"]);                       // b.ts taken out; a.ts and c.ts changed nothing
        const confirmed = confirmingVerdicts(callFile, verdicts);
        expect(confirmed.map((v) => [v.file, v.decision])).toEqual([["src/a.ts", "in"], ["src/c.ts", "out"]]);
        const sheet = callsEvidence(["# top"], [{ truth: applied, sites: [{ file: "src/a.ts", line: 3, why: "call" }], confirmed }], verdicts).join("\n");
        expect(sheet).toContain("   - read: checker right, L3: the index missed a real call");
        expect(sheet).toContain("- read: checker right, `src/c.ts` is not one (L8): the index's line is a comment");
        expect(sheet).toContain("- taken out by reading: `src/b.ts` (L5): a string, not a call");
    });

    it("applies a task's verdict to its CHANGE and recomputes its TESTS", () => {
        const task: TaskTruthFile = { id: "t", kind: "task", type: "IFoo", file: "src/foo.ts", member: "save", within: null, change: ["src/a.ts"], tests: [], ...checked };
        const done = applyCallVerdicts(task, [{ id: "t", file: "src/c.ts", decision: "in", line: 3, why: "w" }], g, known);
        expect([done.change, done.tests]).toEqual([["src/a.ts", "src/c.ts"], ["src/c.test.ts"]]);
    });

    it("writes the evidence sheet: the sites and why, and the verdicts that decided", () => {
        const verdicts = [{ id: "q", file: "src/c.ts", decision: "in" as const, line: 4, why: "a cast" }];
        const truth = { ...callFile, files: ["src/a.ts", "src/c.ts"] };
        const sheet = callsEvidence(["# top"], [{ truth, sites: [{ file: "src/a.ts", line: 9, why: "call" }] }], verdicts).join("\n");
        expect(sheet).toContain("1. `src/a.ts`\n   - L9: call");
        expect(sheet).toContain("2. `src/c.ts`\n   - decided by reading (calls-adjudicated.json, L4): a cast");
    });

    it("rests a task's tests on their edges into the files to change, and other call truths on none", () => {
        const task: TaskTruthFile = { id: "t", kind: "task", type: "IFoo", file: "src/foo.ts", member: "save", within: null, change: ["src/c.ts"], tests: ["src/c.test.ts"], ...checked };
        expect(restingEdges(g, task)).toEqual([["src/c.test.ts", "src/c.ts"]]);
        expect(restingEdges(g, callFile)).toEqual([]);
    });
});
