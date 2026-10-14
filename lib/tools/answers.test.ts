import path from "path";
import { describe, expect, it } from "vitest";
import type { DescribeResponse, MapNode, SearchResult } from "../contracts";
import { architecture } from "../engine/architecture";
import { layersOf } from "../engine/architecture";
import { indexRepository } from "../index/pipeline";
import type { Overview } from "../engine/overview";
import type { ChainAnswer, ReachAnswer } from "../engine/reach";
import { architectureAnswer, chainAnswer, describeAnswer, impactAnswer, overviewAnswer, reachAnswer, rootLines, searchAnswer } from "./answers";
import { answerText, MAX_ANSWER_CHARS, SUMMARIES_OFF_LINE as S } from "./text";

const off = { summaryStatus: "off" as const };
const file = (p: string): MapNode => ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), kind: "file", fileCount: 1, summaryStatus: "off" });

/** dependents of src/core/log.ts, as the ground truth orders them. */
const LOG_DEPENDENTS: ReachAnswer = {
    path: "src/core/log.ts", kind: "file", direction: "dependents", direct: 3, indexVersion: 1,
    reached: [
        { path: "src/app/main.ts", distance: 1 }, { path: "src/core/index.ts", distance: 1 }, { path: "src/index.ts", distance: 1 },
        { path: "src/util/strings.ts", distance: 2 }, { path: "src/app/view.tsx", distance: 2 }, { path: "scripts/build.js", distance: 2 },
        { path: "src/util/strings.test.ts", distance: 3 },
    ],
};
const LOG_HEADER = "src/core/log.ts is imported by 3 files directly and 7 files in all, counting files that reach it through others.";

describe("overviewAnswer", () => {
    it("sizes, areas and the most-imported files, with no summaries", () => {
        const o: Overview = {
            repo: "C:/r/mini-repo", name: "mini-repo", ...off,
            stats: { fileCount: 8, lineCount: 48, importCount: 11 },
            areas: [{ path: "src", kind: "folder", fileCount: 7, lineCount: 45 }, { path: "scripts", kind: "folder", fileCount: 1, lineCount: 3 }],
            mostImported: [
                { path: "src/app/main.ts", importedBy: 3 }, { path: "src/core/log.ts", importedBy: 3 }, { path: "src/util/strings.ts", importedBy: 2 },
                { path: "src/app/view.tsx", importedBy: 1 }, { path: "src/core/index.ts", importedBy: 1 }, { path: "src/index.ts", importedBy: 1 },
            ],
            docs: [],
            stalePaths: 0, indexVersion: 1,
        };
        expect(overviewAnswer(o)).toEqual({ stale: 0, body: [
            "mini-repo: 8 files, 48 lines, 11 imports between files.",
            S,
            "Areas, largest first:",
            "  src/  7 files, 45 lines",
            "  scripts/  1 file, 3 lines",
            "Most imported files:",
            "  src/app/main.ts  imported by 3",
            "  src/core/log.ts  imported by 3",
            "  src/util/strings.ts  imported by 2",
            "  src/app/view.tsx  imported by 1",
            "  src/core/index.ts  imported by 1",
            "  src/index.ts  imported by 1",
        ] });
    });
});

describe("describeAnswer", () => {
    it("describe shows the docs about a folder after its summary line (ADR-054)", () => {
        const text = answerText(describeAnswer({
            repo: "/r", path: "src/editor/common", kind: "folder", summaryStatus: "off", stats: { fileCount: 3, lineCount: 22 },
            children: [], uses: [], usedBy: [], stalePaths: 0, indexVersion: 1,
            docs: [
                { path: ".github/instructions/editor.instructions.md", title: "Editor rules", reason: { kind: "applies", target: "src/editor", detail: "src/editor/**", count: 1 } },
                { path: "docs/architecture.md", title: "Architecture", reason: { kind: "mentions", target: "src/editor/common", count: 1 } },
                { path: "docs/more.md", title: "More", reason: { kind: "mentions", target: "src/editor", count: 2 } },
            ],
        }, "r"));
        expect(text.split("\n").slice(2, 6)).toEqual([
            "Docs about it:",
            "  .github/instructions/editor.instructions.md — Editor rules (applies to src/editor/**)",
            "  docs/architecture.md — Architecture (mentions src/editor/common/)",
            "  docs/more.md — More (mentions src/editor/ (2 times))",
        ]);
    });

    it("describe of a file writes the file's own path without a slash, and a folder README as this folder's or another's", () => {
        const lines = answerText(describeAnswer({
            repo: "/r", path: "src/app/loader.ts", kind: "file", summaryStatus: "off", stats: { fileCount: 1, lineCount: 6 },
            symbols: [], uses: [], usedBy: [], stalePaths: 0, indexVersion: 1,
            docs: [
                { path: "src/app/README.md", title: "The app", reason: { kind: "readme", target: "src/app", count: 1 } },
                { path: "notes.md", title: "Notes", reason: { kind: "mentions", target: "src/app/loader.ts", count: 1 } },
            ],
        }, "r")).split("\n");
        expect(lines.slice(2, 5)).toEqual([
            "Docs about it:",
            "  src/app/README.md — The app (README of src/app/)",
            "  notes.md — Notes (mentions src/app/loader.ts)",
        ]);
    });

    it("a folder: its size, what's inside, and the areas on each side", () => {
        const d: DescribeResponse = {
            repo: "C:/r/mini-repo", path: "src/core", kind: "folder", ...off, stats: { fileCount: 2, lineCount: 10 },
            children: [file("src/core/log.ts"), file("src/core/index.ts")],
            uses: [], usedBy: [{ path: "src/app", kind: "folder", count: 1 }, { path: "src/index.ts", kind: "file", count: 1 }, { path: "src/util", kind: "folder", count: 1 }],
            stalePaths: 0, indexVersion: 1,
        };
        expect(describeAnswer(d, "mini-repo").body).toEqual([
            "src/core/ — folder: 2 files, 10 lines.", S, "Inside (2):", "  log.ts", "  index.ts",
            "Uses: nothing outside it.", "Used by (3 imports):", "  src/app/  1", "  src/index.ts  1", "  src/util/  1",
        ]);
    });

    it("a file: its declarations with their lines", () => {
        const d: DescribeResponse = {
            repo: "C:/r/mini-repo", path: "src/core/log.ts", kind: "file", ...off, stats: { fileCount: 1, lineCount: 9 },
            symbols: [
                { name: "log", kind: "function", startLine: 2, endLine: 2, exported: true },
                { name: "Logger", kind: "class", startLine: 4, endLine: 7, exported: true },
                { name: "Logger.info", kind: "method", startLine: 5, endLine: 5, exported: true },
                { name: "Logger.warn", kind: "method", startLine: 6, endLine: 6, exported: false },
                { name: "banner", kind: "const", startLine: 9, endLine: 9, exported: true },
            ],
            uses: [], usedBy: [{ path: "src/app", kind: "folder", count: 1 }, { path: "src/core/index.ts", kind: "file", count: 1 }, { path: "src/index.ts", kind: "file", count: 1 }],
            stalePaths: 0, indexVersion: 1,
        };
        expect(describeAnswer(d, "mini-repo").body).toEqual([
            "src/core/log.ts — file: 9 lines.", S, "Declarations (5):",
            "  2  function log", "  4–7  class Logger", "  5  method Logger.info", "  6  method Logger.warn (not exported)", "  9  const banner",
            "Uses: nothing outside it.", "Used by (3 imports):", "  src/app/  1", "  src/core/index.ts  1", "  src/index.ts  1",
        ]);
    });

    it("the repo: no outside, so no uses or used by", () => {
        const d: DescribeResponse = {
            repo: "C:/r/mini-repo", path: "", kind: "repo", ...off, stats: { fileCount: 8, lineCount: 48 },
            children: [{ path: "src", name: "src", kind: "folder", fileCount: 7, summaryStatus: "off" }, { path: "scripts", name: "scripts", kind: "folder", fileCount: 1, summaryStatus: "off" }],
            uses: [], usedBy: [], stalePaths: 0, indexVersion: 1,
        };
        expect(describeAnswer(d, "mini-repo").body).toEqual(["mini-repo — the whole repo: 8 files, 48 lines.", S, "Inside (2):", "  src/  7 files", "  scripts/  1 file"]);
    });

    it("cuts long lists and says how many more", () => {
        const children = Array.from({ length: 25 }, (_, i) => file(`big/f${String(i + 1).padStart(2, "0")}.ts`));
        const usedBy = Array.from({ length: 12 }, (_, i) => ({ path: `a${String(i + 1).padStart(2, "0")}`, kind: "folder" as const, count: 1 }));
        const symbols = Array.from({ length: 31 }, (_, i) => ({ name: `s${i + 1}`, kind: "function", startLine: i + 1, endLine: i + 1, exported: true }));
        const folder = describeAnswer({ repo: "C:/r", path: "big", kind: "folder", ...off, stats: { fileCount: 25, lineCount: 25 }, children, uses: [], usedBy, stalePaths: 0, indexVersion: 1 }, "r").body;
        expect(folder.slice(2, 4)).toEqual(["Inside (25):", "  f01.ts"]);
        expect(folder[22]).toBe("  f20.ts");
        expect(folder[23]).toBe("  … 5 more");
        expect(folder.slice(-2)).toEqual(["  a10/  1", "  … 2 more areas"]);
        const one = describeAnswer({ repo: "C:/r", path: "x.ts", kind: "file", ...off, stats: { fileCount: 1, lineCount: 31 }, symbols, uses: [], usedBy: [], stalePaths: 0, indexVersion: 1 }, "r").body;
        expect(one[32]).toBe("  30  function s30");
        expect(one[33]).toBe("  … 1 more");
    });
});

describe("searchAnswer", () => {
    it("lists hits with their tagline and best code, cut to 160 characters", () => {
        const r: SearchResult = {
            query: "log",
            hits: [
                { path: "src/core", kind: "folder", score: 0.03, matchedBy: ["name"], tagline: "Core services" },
                { path: "src/core/log.ts", kind: "file", score: 0.02, matchedBy: ["code"], code: { symbol: "log", startLine: 2, endLine: 2, snippet: "export function log(message: string): void { console.log(message); }" } },
                { path: "src/core/index.ts", kind: "file", score: 0.01, matchedBy: ["code"], tagline: "Re-exports logging", code: { symbol: "(file)", startLine: 1, endLine: 3, snippet: "x".repeat(200) } },
            ],
            lists: { code: 2, summary: 0, vector: 0, name: 1, file: 0 },
            note: "Summaries are off (no ANTHROPIC_API_KEY), so results come from code, folder names and file names only.",
        };
        expect(searchAnswer(r)).toEqual({
            body: [
                'Search "log": 3 best matches.',
                " 1. src/core/ — Core services",
                " 2. src/core/log.ts",
                "    log, line 2: export function log(message: string): void { console.log(message); }",
                " 3. src/core/index.ts — Re-exports logging",
                `    imports and exports: ${"x".repeat(159)}…`,
            ],
            notes: ["Summaries are off (no ANTHROPIC_API_KEY), so results come from code, folder names and file names only."],
        });
    });

    it("says when nothing matches", () => {
        expect(searchAnswer({ query: "zzz", hits: [], lists: { code: 0, summary: 0, vector: 0, name: 0, file: 0 } }))
            .toEqual({ body: ['No files or folders match "zzz". Try other words; for an exact string, use Grep.'], notes: [] });
    });
});

describe("reachAnswer", () => {
    it("lists the direct importers under both totals", () => {
        expect(reachAnswer(LOG_DEPENDENTS, { transitive: false, limit: 50, offset: 0 }).body)
            .toEqual([LOG_HEADER, "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts"]);
    });

    it("groups everything reached by distance, and pages it", () => {
        expect(reachAnswer(LOG_DEPENDENTS, { transitive: true, limit: 50, offset: 0 }).body).toEqual([
            LOG_HEADER,
            "Distance 1 (3):", "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts",
            "Distance 2 (3):", "  src/util/strings.ts", "  src/app/view.tsx", "  scripts/build.js",
            "Distance 3 (1):", "  src/util/strings.test.ts",
        ]);
        expect(reachAnswer(LOG_DEPENDENTS, { transitive: true, limit: 4, offset: 0 }).body).toEqual([
            LOG_HEADER,
            "Distance 1 (3):", "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts",
            "Distance 2 (3):", "  src/util/strings.ts",
            "… 3 more (next page: offset 4)",
        ]);
        expect(reachAnswer(LOG_DEPENDENTS, { transitive: true, limit: 4, offset: 4 }).body).toEqual([
            LOG_HEADER, "Showing 5–7 of 7.",
            "Distance 2 (3):", "  src/app/view.tsx", "  scripts/build.js",
            "Distance 3 (1):", "  src/util/strings.test.ts",
        ]);
        expect(reachAnswer(LOG_DEPENDENTS, { transitive: true, limit: 4, offset: 10 }).body).toEqual([LOG_HEADER, "Nothing at offset 10: the list has 7."]);
    });

    it("words an empty answer for each direction and kind", () => {
        const none = (direction: "dependents" | "dependencies", kind: "file" | "folder", p: string) =>
            reachAnswer({ path: p, kind, direction, reached: [], direct: 0, indexVersion: 1 }, { transitive: false, limit: 50, offset: 0 }).body;
        expect(none("dependents", "file", "scripts/build.js")).toEqual(["Nothing imports scripts/build.js."]);
        expect(none("dependents", "folder", "scripts")).toEqual(["Nothing outside scripts/ imports it."]);
        expect(none("dependencies", "file", "src/core/log.ts")).toEqual(["src/core/log.ts imports no other indexed file."]);
        expect(none("dependencies", "folder", "src")).toEqual(["src/ imports nothing outside it."]);
    });

    it("says a folder's importers are from outside it, and what a file imports in turn", () => {
        const folder: ReachAnswer = { path: "src", kind: "folder", direction: "dependents", direct: 1, indexVersion: 1, reached: [{ path: "scripts/build.js", distance: 1 }] };
        expect(reachAnswer(folder, { transitive: false, limit: 50, offset: 0 }).body)
            .toEqual(["src/ is imported from outside it by 1 file directly and 1 file in all, counting files that reach it through others.", "  scripts/build.js"]);
        const main: ReachAnswer = {
            path: "src/app/main.ts", kind: "file", direction: "dependencies", direct: 3, indexVersion: 1,
            reached: [{ path: "src/core/log.ts", distance: 1 }, { path: "src/util/strings.ts", distance: 1 }, { path: "src/app/view.tsx", distance: 1 }, { path: "src/core/index.ts", distance: 2 }],
        };
        expect(reachAnswer(main, { transitive: true, limit: 50, offset: 0 }).body).toEqual([
            "src/app/main.ts imports 3 files directly and 4 files in all, counting what those import in turn.",
            "Distance 1 (3):", "  src/core/log.ts", "  src/util/strings.ts", "  src/app/view.tsx",
            "Distance 2 (1):", "  src/core/index.ts",
        ]);
    });

    it("stays under the character budget on a huge answer, and the cut line's offset is right", () => {
        const reached = Array.from({ length: 600 }, (_, i) => ({ path: `deep/${"x".repeat(90)}/${String(i).padStart(4, "0")}.ts`, distance: 1 }));
        const parts = reachAnswer({ path: "hub.ts", kind: "file", direction: "dependents", direct: 600, indexVersion: 1, reached }, { transitive: false, limit: 500, offset: 0 });
        const text = answerText({ ...parts, repoNote: "r".repeat(300), indexNote: "i".repeat(200) });
        expect(text.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        // Hand-derived. The header "hub.ts is imported by 600 files directly and 600 files in all, counting files that reach
        // it through others." is 107 characters, so the budget is 40,000 - 2,000 (headroom for the notes) - 107 = 37,893. Each
        // line "  deep/" + 90 x's + "/0000.ts" is 2 + 5 + 90 + 1 + 4 + 3 = 105 characters, 106 with its line break. 37,893 / 106
        // is 357.5, so 357 lines fit and 243 are left.
        const listed = parts.body.filter((line) => line.startsWith("  deep/")).length;
        expect(listed).toBe(357);
        expect(parts.body.at(-1)).toBe("… 243 more (next page: offset 357)");
    });
});

describe("chainAnswer", () => {
    const chain = { files: ["scripts/build.js", "src/app/main.ts", "src/core/log.ts"], specifiers: ["../src/app/main", "../core/log"] };
    const steps = ["  scripts/build.js", '  → src/app/main.ts  (import "../src/app/main")', '  → src/core/log.ts  (import "../core/log")'];

    it("shows the chain, either way round, or says there is none", () => {
        const forward: ChainAnswer = { from: "scripts/build.js", fromKind: "file", to: "src/core/log.ts", toKind: "file", found: "forward", ...chain };
        expect(chainAnswer(forward).body).toEqual(["scripts/build.js reaches src/core/log.ts in 2 steps:", ...steps]);
        const reverse: ChainAnswer = { from: "src/core/log.ts", fromKind: "file", to: "scripts/build.js", toKind: "file", found: "reverse", ...chain };
        expect(chainAnswer(reverse).body).toEqual([
            "src/core/log.ts doesn't reach scripts/build.js through imports; the other way round, scripts/build.js reaches src/core/log.ts in 2 steps:",
            ...steps,
        ]);
        const none: ChainAnswer = { from: "src/app/view.tsx", fromKind: "file", to: "src/util/strings.test.ts", toKind: "file", found: "none", files: [], specifiers: [] };
        expect(chainAnswer(none).body).toEqual(["No chain of imports joins src/app/view.tsx and src/util/strings.test.ts, in either direction."]);
        const folders: ChainAnswer = { from: "src/app", fromKind: "folder", to: "src/core", toKind: "folder", found: "forward", files: ["src/app/main.ts", "src/core/log.ts"], specifiers: ["../core/log"] };
        expect(chainAnswer(folders).body).toEqual(["src/app/ reaches src/core/ in 1 step:", "  src/app/main.ts", '  → src/core/log.ts  (import "../core/log")']);
    });
});

describe("impact and root lines (ADR-055)", () => {
    const strings: ReachAnswer = {
        path: "src/base/common/strings.ts", kind: "file", direction: "dependents", direct: 6, indexVersion: 1,
        reached: [
            ["src/base/browser/dom.ts", 1], ["src/base/common/arrays.ts", 1], ["src/editor/common/textModel.ts", 1], ["src/app/legacy.ts", 1],
            ["src/base/test/common/strings.test.ts", 1], ["tools/fixtures/legacy-ids.ts", 1],
            ["src/base/node/fs.ts", 2], ["src/platform/common/storage.ts", 2], ["src/editor/browser/editorView.ts", 2], ["src/editor/common/tokens.ts", 2],
            ["src/editor/node/editorFiles.ts", 2], ["src/platform/browser/storageView.ts", 2],
            ["src/editor/common/model.ts", 3], ["src/platform/node/storageFile.ts", 3], ["src/app/main.ts", 3],
            ["src/app/loader.ts", 4],
        ].map(([p, d]) => ({ path: p as string, distance: d as number })),
    };
    const roots = { declared: ["src/app/loader.ts"], others: ["src/app/legacy.ts", "tools/fixtures/legacy-ids.ts"] };

    it("impact counts by area, then tests and the files nothing imports that load it (ADR-055)", () => {
        const text = answerText(impactAnswer({
            reach: strings, groupBy: "src", elsewhere: 1, tests: 1, roots,
            areas: [{ path: "src/editor", kind: "folder", count: 5 }, { path: "src/base", kind: "folder", count: 4 },
                { path: "src/app", kind: "folder", count: 3 }, { path: "src/platform", kind: "folder", count: 3 }],
        }));
        expect(text).toBe([
            "src/base/common/strings.ts is imported by 6 files directly and 16 files in all, counting files that reach it through others.",
            "By area (inside src/):",
            "  src/editor/  5",
            "  src/base/  4",
            "  src/app/  3",
            "  src/platform/  3",
            "  elsewhere (outside src/)  1",
            "Tests among them: 1.",
            "Entry points a package.json names that load it (1):",
            "  src/app/loader.ts",
            "Other files nothing imports that load it (2):",
            "  src/app/legacy.ts",
            "  tools/fixtures/legacy-ids.ts",
        ].join("\n"));
    });

    it("a transitive list of dependents ends with the same lines", () => {
        const lines = answerText(reachAnswer(strings, { transitive: true, limit: 50, offset: 0 }, rootLines(1, roots))).split("\n");
        expect(lines.slice(0, 2)).toEqual([
            "src/base/common/strings.ts is imported by 6 files directly and 16 files in all, counting files that reach it through others.",
            "Distance 1 (6):",
        ]);
        expect(lines.slice(-6)).toEqual([
            "Tests among them: 1.",
            "Entry points a package.json names that load it (1):",
            "  src/app/loader.ts",
            "Other files nothing imports that load it (2):",
            "  src/app/legacy.ts",
            "  tools/fixtures/legacy-ids.ts",
        ]);
    });

    it("a list within a folder says so in its first line", () => {
        const text = answerText(reachAnswer({
            path: "src/editor", kind: "folder", direction: "dependents", direct: 1, indexVersion: 1, within: "src/platform",
            reached: [{ path: "src/platform/node/storageFile.ts", distance: 1 }],
        }, { transitive: false, limit: 50, offset: 0 }));
        expect(text.split("\n")[0]).toBe("src/editor/ is imported from outside it by 1 file directly and 1 file in all, counting files that reach it through others. Only files inside src/platform/ are counted.");
    });

    it("an empty list within a folder says which folder", () => {
        const base = { path: "src/editor", kind: "folder" as const, reached: [], direct: 0, indexVersion: 1, within: "src/app" };
        expect(reachAnswer({ ...base, direction: "dependents" }, { transitive: false, limit: 50, offset: 0 }).body)
            .toEqual(["No file inside src/app/ imports src/editor/."]);
        expect(reachAnswer({ ...base, direction: "dependencies" }, { transitive: false, limit: 50, offset: 0 }).body)
            .toEqual(["src/editor/ imports no file inside src/app/."]);
    });

    it("a page whose root lines are long still fits the answer limit (F24)", () => {
        // 100 root paths of about 150 characters: about 15,000 characters after the list, which the list's budget must leave room for
        const long = (tag: string): string[] => Array.from({ length: 50 }, (_, i) => `${tag.repeat(145)}${String(i).padStart(3, "0")}.ts`);
        const after = rootLines(0, { declared: long("d"), others: long("o") });
        expect(after.join("\n").length).toBeGreaterThan(15_000);
        // 400 reached files of about 310 characters: the list alone would be about 125,000, so it must be cut
        const reached = Array.from({ length: 400 }, (_, i) => ({ path: `${"p".repeat(300)}${String(i).padStart(3, "0")}.ts`, distance: 1 }));
        const a: ReachAnswer = { path: "x.ts", kind: "file", direction: "dependents", direct: 400, indexVersion: 1, reached };
        const text = answerText(reachAnswer(a, { transitive: true, limit: 500, offset: 0 }, after));
        expect(text.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(text.endsWith(after[after.length - 1])).toBe(true);
        expect(text).toContain("… ");
    });
});

describe("architectureAnswer, against the arch-repo ground truth", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    indexRepository(root);
    const page = { limit: 50, offset: 0 };
    const text = (p: string, report: Parameters<typeof architecture>[2], options: { through?: string } = {}): string[] =>
        answerText(architectureAnswer(architecture(root, p, report, options), page)).split("\n");

    it("layers of src", () => {
        expect(text("src", "layers")).toEqual([
            "Layers of src/, bottom first (each uses only the layers below it, except the imports listed after):",
            "  0  base/",
            "  1  platform/",
            "  2  editor/",
            "  3  app/",
            "Against that order (1 import):",
            "  platform/ → editor/  1",
            "    src/platform/node/storageFile.ts → src/editor/common/model.ts",
        ]);
    });

    it("layers of src/base", () => {
        expect(text("src/base", "layers")).toEqual([
            "Layers of src/base/, bottom first (each uses only the layers below it, except the imports listed after):",
            "  0  common/",
            "  1  browser/, node/, test/",
            "Against that order: none.",
        ]);
    });

    it("conventions of src", () => {
        expect(text("src", "conventions")).toEqual([
            "Folder names that recur under src/ (in 3 or more folders): browser (3), common (4), node (3).",
            "What each one's files import:",
            "  browser → browser 2, common 2",
            "  common → browser 1, common 8",
            "  node → common 4, node 3",
            "The rarer pairs (3 imports or fewer):",
            "  browser → browser: src/editor/browser/editorView.ts → src/base/browser/dom.ts; src/platform/browser/storageView.ts → src/base/browser/dom.ts",
            "  browser → common: src/base/browser/dom.ts → src/base/common/strings.ts; src/editor/browser/editorView.ts → src/editor/common/model.ts",
            "  common → browser: src/platform/common/storage.ts → src/platform/browser/storageView.ts",
            "  node → node: src/editor/node/editorFiles.ts → src/base/node/fs.ts; src/editor/node/editorFiles.ts → src/platform/node/storageFile.ts; src/platform/node/storageFile.ts → src/base/node/fs.ts",
        ]);
    });

    it("cycles of src", () => {
        expect(text("src", "cycles")).toEqual([
            "Import cycles touching src/: 1, holding 3 files in all.",
            "  3 files: src/editor/common/model.ts, src/editor/common/textModel.ts, src/editor/common/tokens.ts",
        ]);
    });

    it("the shortest cycle through model.ts", () => {
        expect(text("src/editor/common/model.ts", "cycles")).toEqual([
            "The shortest import cycle through src/editor/common/model.ts (3 steps):",
            "  src/editor/common/model.ts",
            '  → src/editor/common/tokens.ts  (import "./tokens")',
            '  → src/editor/common/textModel.ts  (import "./textModel")',
            '  → src/editor/common/model.ts  (import "./model")',
        ]);
    });

    it("no cycle through storage.ts", () => {
        expect(text("src/platform/common/storage.ts", "cycles")).toEqual(["src/platform/common/storage.ts is in no import cycle."]);
    });

    it("files nothing imports, in src and in the repo", () => {
        expect(text("src", "unused")).toEqual([
            "Files in src/ that no indexed file imports: 2, not counting 1 test file.",
            "Named as entry points by a package.json (1):",
            "  src/app/loader.ts",
            "Not named anywhere (1):",
            "  src/app/legacy.ts",
            "Note: a file nothing imports may still be loaded by name (a build script, a worker, an HTML page, a test runner), so check before deleting it.",
        ]);
        const repo = text("", "unused");
        expect(repo[0]).toBe("Files in the repo that no indexed file imports: 3, not counting 1 test file.");
        expect(repo.slice(1, 6)).toEqual([
            "Named as entry points by a package.json (1):",
            "  src/app/loader.ts",
            "Not named anywhere (2):",
            "  src/app/legacy.ts",
            "  tools/fixtures/legacy-ids.ts",
        ]);
    });

    it("the summary of src", () => {
        expect(text("src", "summary")).toEqual([
            "src/ — what its imports say about how it's organized:",
            "Layers, bottom first: base/ · platform/ · editor/ · app/ (1 import against that order)",
            "Folder conventions: browser, common, node",
            "Import cycles: 1, the largest 3 files",
            "Files nothing imports: 2, not counting tests (1 entry point named by a package.json)",
            'For details, ask again with report "layers", "conventions", "cycles" or "unused".',
        ]);
    });

    it("keeps a huge conventions report and a huge cycles report under the answer limit", () => {
        // 150 recurring names, each importing every name: 22,500 pairs, of which 150 are rare
        const names = Array.from({ length: 150 }, (_, i) => ({ name: `env${String(i).padStart(3, "0")}`, folders: 3 }));
        const pairs = names.flatMap((a, i) => names.map((b, j) => ({
            from: a.name, to: b.name, count: i === j ? 2 : 9_000, examples: i === j ? ([["src/a/" + "x".repeat(100) + ".ts", "src/b/" + "y".repeat(100) + ".ts"]] as [string, string][]) : [],
        })));
        const conventions = answerText(architectureAnswer({ path: "src", kind: "folder", report: "conventions", conventions: { minFolders: 3, names, pairs } }, page));
        expect(conventions.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(conventions).toContain("… 130 more");
        // 400 groups of 20 files with 150-character paths
        const cycles = Array.from({ length: 400 }, (_, g) => ({ size: 20, files: Array.from({ length: 20 }, (_, i) => `${"p".repeat(150)}${g}-${i}.ts`) }));
        const text = answerText(architectureAnswer({ path: "", kind: "repo", report: "cycles", cycles }, { limit: 400, offset: 0 }));
        expect(text.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(text).toContain("(next page: offset ");
    });

    it("prints the place's own threshold, and when the names are capped keeps the most-recurring, not the first alphabetically", () => {
        // 30 names: n00-n24 recur in 10 folders each, n25-n29 in 50. The top 20 are n25-n29 and, on the tie at 10, n00-n14.
        const names = Array.from({ length: 30 }, (_, i) => ({ name: `n${String(i).padStart(2, "0")}`, folders: i >= 25 ? 50 : 10 }));
        const pair = (from: string, to: string, count: number) => ({ from, to, count, examples: [] as [string, string][] });
        const c = { minFolders: 7, names, pairs: [pair("n00", "n29", 4), pair("n20", "n00", 2), pair("n20", "n20", 6), pair("n29", "n29", 5)] };
        const lines = answerText(architectureAnswer({ path: "src", kind: "folder", report: "conventions", conventions: c }, page)).split("\n");
        expect(lines[0]).toBe("Folder names that recur under src/ (in 7 or more folders): "
            + "n00 (10), n01 (10), n02 (10), n03 (10), n04 (10), n05 (10), n06 (10), n07 (10), n08 (10), n09 (10), n10 (10), n11 (10), n12 (10), n13 (10), n14 (10), "
            + "n25 (50), n26 (50), n27 (50), n28 (50), n29 (50), … 10 more.");
        // rows only for kept names; n20 is cut, and so is every pair that touches it
        expect(lines.slice(1)).toEqual(["What each one's files import:", "  n00 → n29 4", "  n29 → n29 5"]);
        expect(answerText(architectureAnswer({ path: "", kind: "repo", report: "conventions", conventions: { minFolders: 4, names: [], pairs: [] } }, page)))
            .toBe("No folder name recurs in 4 or more folders under the repo.");
    });

    it("keeps layers, the summary and a long cycle under the limit, and says how many were left out", () => {
        const part = (p: string) => ({ path: p, kind: "file" as const });
        const none = (): [string, string][] => [];
        const rest = { conventions: { minFolders: 3, names: [], pairs: [] }, cycles: [], unused: { declared: [], others: [], tests: 0 } };
        // a flat folder of 3,001 files each importing one helper: two levels, the second with 3,000 names
        const flatParts = [part("helper.ts"), ...Array.from({ length: 3_000 }, (_, i) => part(`file${String(i).padStart(4, "0")}.ts`))];
        const flat = layersOf(flatParts, flatParts.slice(1).map((p) => ({ source: p.path, target: "helper.ts", count: 1 })), none);
        const summary = answerText(architectureAnswer({ path: "", kind: "repo", report: "summary", layers: flat, ...rest }, page));
        expect(summary.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(summary).toContain("… 2,980 more");
        // a chain of 3,000 files: 3,000 levels
        const chainParts = Array.from({ length: 3_000 }, (_, i) => part(`c${String(i).padStart(4, "0")}.ts`));
        const chain = layersOf(chainParts, chainParts.slice(0, -1).map((p, i) => ({ source: p.path, target: chainParts[i + 1].path, count: 1 })), none);
        const chainSummary = answerText(architectureAnswer({ path: "", kind: "repo", report: "summary", layers: chain, ...rest }, page));
        expect(chainSummary.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(chainSummary).toContain("… 2,992 more levels");
        const chainLayers = answerText(architectureAnswer({ path: "", kind: "repo", report: "layers", layers: chain }, page));
        expect(chainLayers.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(chainLayers).toContain("… 2,970 more levels");
        // 400 tangled pairs and 30 circles of 40 long names
        const long = (i: number) => part(`${"q".repeat(120)}${i}.ts`);
        const tangled = Array.from({ length: 400 }, (_, i) => ({ a: long(i), b: long(i + 1_000), count: 2 }));
        const circles = Array.from({ length: 30 }, (_, g) => Array.from({ length: 40 }, (_, i) => long(g * 100 + i)));
        const tangledText = answerText(architectureAnswer({ path: "", kind: "repo", report: "layers", layers: { levels: [], against: [], tangled, circles, unlinked: [] } }, page));
        expect(tangledText.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(tangledText).toContain("… 380 more pairs with as many imports each way");
        expect(tangledText).toContain("… 20 more circles");
        // a cycle of 2,000 steps shows its first 20 steps and its last 20
        const cycle = Array.from({ length: 2_001 }, (_, i) => `${"c".repeat(100)}${i % 2_000}.ts`);
        const specifiers = cycle.slice(1).map((_, i) => `./s${i}`);
        const through = answerText(architectureAnswer({ path: cycle[0], kind: "file", report: "cycles", through: { file: cycle[0], cycle, specifiers } }, page)).split("\n");
        expect(through.join("\n").length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(through[0]).toContain("(2,000 steps)");
        expect(through).toContain("  … 1,960 more steps");
        expect(through).toHaveLength(1 + 1 + 20 + 1 + 20);
        expect(through[through.length - 1]).toBe(`  → ${cycle[2_000]}  (import "./s1999")`);
    });
});
