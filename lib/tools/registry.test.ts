import path from "path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ARCH_FIXTURE, copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { applyTargetUpdates } from "../db/store/summaries";
import { BadInputError } from "../engine/errors";
import { PathNotFoundError } from "../engine/level";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { refreshSummaryStatus } from "../index/summarize/status";
import { SERVER_INSTRUCTIONS, TOOLS, type ToolContext, type ToolOutput } from "./registry";
import { SUMMARIES_OFF_LINE as S } from "./text";

/** The fixture indexed with no API key: free mode (ADR-043), as npm run index leaves it. */
function freeFixture(): ToolContext {
    const root = copyFixture();
    indexRepository(root);
    refreshSummaryStatus(root, { summarizerAvailable: false });
    return { repoRoot: repoKey(root), summariesOff: true };
}

/** Calls a tool as the MCP SDK does: the input parsed by the tool's own schema, defaults filled in. */
async function call(name: string, input: Record<string, unknown>, context: ToolContext): Promise<ToolOutput> {
    const tool = TOOLS.find((t) => t.name === name)!;
    return tool.handler(tool.inputSchema.parse(input), context);
}

const lines = (output: ToolOutput): string[] => output.text.split("\n");

/** The arch-repo fixture (ground truth: the V1.6 plan) indexed with no key. */
function archFixture(): ToolContext {
    const root = copyFixture(ARCH_FIXTURE);
    indexRepository(root);
    refreshSummaryStatus(root, { summarizerAvailable: false });
    return { repoRoot: repoKey(root), summariesOff: true };
}

describe("the registry", () => {
    it("defines the tools once, in order, with descriptions Claude Code shows whole", () => {
        for (const tool of TOOLS) expect(tool.description.length).toBeLessThanOrEqual(2_048);
    });

    it("serves six tools, the five that answer questions loaded into every prompt (ADR-056)", () => {
        expect(TOOLS.map((t) => t.name)).toEqual(["overview", "describe", "search", "imports", "architecture", "show_on_map"]);
        expect(TOOLS.filter((t) => t.alwaysLoad).map((t) => t.name)).toEqual(["overview", "describe", "search", "imports", "architecture"]);
        expect(TOOLS.find((t) => t.name === "show_on_map")!.searchHint).toBe("map highlight focus show point visualize");
    });

    it("keeps what every session loads under 7,000 characters: the five definitions and the instructions", () => {
        const chars = TOOLS.filter((t) => t.alwaysLoad)
            .reduce((sum, t) => sum + JSON.stringify({ name: `mcp__nebulosity__${t.name}`, description: t.description, input_schema: z.toJSONSchema(t.inputSchema) }).length, 0);
        expect(chars + SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(7_000);
        expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2_048);   // within the old cap too, for older Claude Code
    });
});

describe("overview, describe and search with no API key", () => {
    it("overview: sizes, areas and the most-imported files, and what a key adds", async () => {
        const context = freeFixture();
        expect(await call("overview", {}, context)).toEqual({ paths: [], text: [
            `${path.basename(context.repoRoot)}: 8 files, 48 lines, 11 imports between files.`,
            S,
            "Docs to read first:", "  README.md — mini-repo",
            "Areas, largest first:", "  src/  7 files, 45 lines", "  scripts/  1 file, 3 lines",
            "Most imported files:",
            "  src/app/main.ts  imported by 3", "  src/core/log.ts  imported by 3", "  src/util/strings.ts  imported by 2",
            "  src/app/view.tsx  imported by 1", "  src/core/index.ts  imported by 1", "  src/index.ts  imported by 1",
        ].join("\n") });
    });

    it("describe: a folder, a file, and a test file's template that shows with no key", async () => {
        const context = freeFixture();
        expect(await call("describe", { path: "src/core" }, context)).toEqual({ paths: ["src/core"], text: [
            "src/core/ — folder: 2 files, 10 lines.", S, "Inside (2):", "  log.ts", "  index.ts",
            "Uses: nothing outside it.", "Used by (3 imports):", "  src/app/  1", "  src/index.ts  1", "  src/util/  1",
        ].join("\n") });
        expect(lines(await call("describe", { path: "src/core/log.ts" }, context))).toEqual([
            "src/core/log.ts — file: 9 lines.", S, "Declarations (5):",
            "  2  function log", "  4–7  class Logger", "  5  method Logger.info", "  6  method Logger.warn (not exported)", "  9  const banner",
            "Uses: nothing outside it.", "Used by (3 imports):", "  src/app/  1", "  src/core/index.ts  1", "  src/index.ts  1",
        ]);
        expect(lines(await call("describe", { path: "src/util" }, context))).toEqual([
            "src/util/ — folder: 2 files, 9 lines.", S, "Inside (2):", "  strings.ts", "  strings.test.ts — Tests for strings",
            "Uses (1 import):", "  src/core/  1", "Used by (1 import):", "  src/app/  1",
        ]);
    });

    it("describe: takes backslashes, ./ and a trailing slash, and refuses a path outside the repo or not indexed", async () => {
        const context = freeFixture();
        const plain = await call("describe", { path: "src/core" }, context);
        expect(await call("describe", { path: ".\\src\\core\\" }, context)).toEqual(plain);
        await expect(call("describe", { path: "../outside" }, context)).rejects.toThrow(BadInputError);
        await expect(call("describe", { path: "src/nope.ts" }, context)).rejects.toThrow(PathNotFoundError);
    });

    it("takes an absolute path inside the repo, Claude Code's own form, and refuses one outside it, naming the root", async () => {
        const context = freeFixture();
        expect(await call("describe", { path: path.join(context.repoRoot, "src", "core") }, context))
            .toEqual(await call("describe", { path: "src/core" }, context));
        expect(await call("imports", { path: path.join(context.repoRoot, "src", "core", "log.ts") }, context))
            .toEqual(await call("imports", { path: "src/core/log.ts" }, context));
        await expect(call("describe", { path: path.join(path.dirname(context.repoRoot), "elsewhere.ts") }, context))
            .rejects.toThrow(`isn't a path inside the repo (${context.repoRoot})`);
    });

    it("describe: notes a stale summary last", async () => {
        const root = copyFixture();
        indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer({ texts: { "src/core/log.ts": { tagline: "Logging helpers", summary: "Writes lines." } } }).summarizer, transport: "direct" });
        const repoId = requireRepository(getDb(), repoKey(root));
        applyTargetUpdates(getDb(), repoId, [{ kind: "file", path: "src/core/log.ts", inputHash: "edited", status: "stale" }]);
        const answer = lines(await call("describe", { path: "src/core/log.ts" }, { repoRoot: repoKey(root), summariesOff: false }));
        expect(answer[1]).toBe("Logging helpers — Writes lines. (Out of date: changed since it was summarized.)");
        expect(answer.at(-1)).toBe("Note: 1 file here changed since it was summarized, so its summary is out of date until it's refreshed.");
    });

    it("search: finds code by keyword with no summaries, and says what it searched", async () => {
        const result = await call("search", { query: "banner" }, freeFixture());
        expect(lines(result)[0]).toBe('Search "banner": 1 best match.');
        expect(result.text).toContain("\n 1. src/core/log.ts\n");
        expect(lines(result).at(-1)).toBe("Note: Summaries are off (no ANTHROPIC_API_KEY), so results come from code, folder names and file names only.");
        expect(result.paths).toEqual(["src/core/log.ts"]);
    });
});

describe("imports", () => {
    const HEADER = "src/core/log.ts is imported by 3 files directly and 7 files in all, counting files that reach it through others.";

    it("lists a file's direct importers under both totals", async () => {
        expect(await call("imports", { path: "src/core/log.ts" }, freeFixture())).toEqual({
            paths: ["src/core/log.ts"], text: [HEADER, "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts"].join("\n"),
        });
    });

    it("groups what reaches a folder by distance", async () => {
        expect(lines(await call("imports", { path: "src/core", transitive: true }, freeFixture()))).toEqual([
            "src/core/ is imported from outside it by 3 files directly and 6 files in all, counting files that reach it through others.",
            "Distance 1 (3):", "  src/app/main.ts", "  src/util/strings.ts", "  src/index.ts",
            "Distance 2 (3):", "  src/app/view.tsx", "  scripts/build.js", "  src/util/strings.test.ts",
            "Tests among them: 1.",
            "Other files nothing imports that load it (1):", "  scripts/build.js",
        ]);
    });

    it("pages a long list and says where the next page starts", async () => {
        const context = freeFixture();
        expect(lines(await call("imports", { path: "src/core/log.ts", transitive: true, limit: 4 }, context))).toEqual([
            HEADER, "Distance 1 (3):", "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts",
            "Distance 2 (3):", "  src/util/strings.ts", "… 3 more (next page: offset 4)",
            "Tests among them: 1.",
            "Other files nothing imports that load it (1):", "  scripts/build.js",
        ]);
        expect(lines(await call("imports", { path: "src/core/log.ts", transitive: true, limit: 4, offset: 4 }, context))).toEqual([
            HEADER, "Showing 5–7 of 7.", "Distance 2 (3):", "  src/app/view.tsx", "  scripts/build.js", "Distance 3 (1):", "  src/util/strings.test.ts",
        ]);
    });

    it("says when nothing imports a file, what a folder imports, and what a file reaches", async () => {
        const context = freeFixture();
        expect((await call("imports", { path: "scripts/build.js" }, context)).text).toBe("Nothing imports scripts/build.js.");
        expect((await call("imports", { path: "src", direction: "dependencies" }, context)).text).toBe("src/ imports nothing outside it.");
        expect(lines(await call("imports", { path: "src/app/main.ts", direction: "dependencies", transitive: true }, context))).toEqual([
            "src/app/main.ts imports 3 files directly and 4 files in all, counting what those import in turn.",
            "Distance 1 (3):", "  src/core/log.ts", "  src/util/strings.ts", "  src/app/view.tsx",
            "Distance 2 (1):", "  src/core/index.ts",
        ]);
    });

    it("refuses the whole repo, and a limit outside its range", async () => {
        const context = freeFixture();
        await expect(call("imports", { path: "" }, context)).rejects.toThrow(BadInputError);
        // a schema failure (zod's own error class), not just any throw: 500 is the largest page
        await expect(call("imports", { path: "src", limit: 501 }, context)).rejects.toBeInstanceOf(z.ZodError);
    });
});

describe("imports with to (the chain)", () => {
    it("gives the chain with each import, the other way round when needed, or says there is none", async () => {
        const context = freeFixture();
        const steps = ["  scripts/build.js", '  → src/app/main.ts  (import "../src/app/main")', '  → src/core/log.ts  (import "../core/log")'];
        expect(await call("imports", { path: "scripts/build.js", to: "src/core/log.ts" }, context)).toEqual({
            text: ["scripts/build.js reaches src/core/log.ts in 2 steps:", ...steps].join("\n"),
            paths: ["scripts/build.js", "src/core/log.ts", "src/app/main.ts"],
        });
        expect(lines(await call("imports", { path: "src/core/log.ts", to: "scripts/build.js" }, context))).toEqual([
            "src/core/log.ts doesn't reach scripts/build.js through imports; the other way round, scripts/build.js reaches src/core/log.ts in 2 steps:",
            ...steps,
        ]);
        expect((await call("imports", { path: "src/app/view.tsx", to: "src/util/strings.test.ts" }, context)).text)
            .toBe("No chain of imports joins src/app/view.tsx and src/util/strings.test.ts, in either direction.");
        await expect(call("imports", { path: "src", to: "src/core" }, context)).rejects.toThrow(BadInputError);
    });

    it("says so when within, group_by or transitive came with to, since a chain ignores them (final review, A row 298)", async () => {
        const context = freeFixture();
        const chain = [
            "scripts/build.js reaches src/core/log.ts in 2 steps:",
            "  scripts/build.js", '  → src/app/main.ts  (import "../src/app/main")', '  → src/core/log.ts  (import "../core/log")',
        ];
        const note = "Note: within, group_by and transitive don't apply to a chain.";
        expect(lines(await call("imports", { path: "scripts/build.js", to: "src/core/log.ts", within: "src/app" }, context))).toEqual([...chain, note]);
        expect(lines(await call("imports", { path: "scripts/build.js", to: "src/core/log.ts", group_by: "src" }, context))).toEqual([...chain, note]);
        expect(lines(await call("imports", { path: "scripts/build.js", to: "src/core/log.ts", transitive: true }, context))).toEqual([...chain, note]);
        // transitive: false is the default, so saying it changes nothing
        expect(lines(await call("imports", { path: "scripts/build.js", to: "src/core/log.ts", transitive: false }, context))).toEqual(chain);
    });
});

describe("imports and architecture on the arch-repo", () => {
    const STRINGS = "src/base/common/strings.ts";

    it("group_by counts what a change reaches by area, with the tests and entry points", async () => {
        expect(await call("imports", { path: STRINGS, transitive: true, group_by: "src" }, archFixture())).toEqual({
            paths: [STRINGS],
            text: [
                `${STRINGS} is imported by 6 files directly and 16 files in all, counting files that reach it through others.`,
                "By area (inside src/):",
                "  src/editor/  5", "  src/base/  4", "  src/app/  3", "  src/platform/  3", "  elsewhere (outside src/)  1",
                "Tests among them: 1.",
                "Entry points a package.json names that load it (1):", "  src/app/loader.ts",
                "Other files nothing imports that load it (2):", "  src/app/legacy.ts", "  tools/fixtures/legacy-ids.ts",
            ].join("\n"),
        });
    });

    it("within keeps the files inside a folder; with no direct file it says so", async () => {
        const context = archFixture();
        expect(lines(await call("imports", { path: "src/editor", within: "src/platform" }, context))).toEqual([
            "src/editor/ is imported from outside it by 1 file directly and 1 file in all, counting files that reach it through others. Only files inside src/platform/ are counted.",
            "  src/platform/node/storageFile.ts",
        ]);
        // storage.ts and storageView.ts import it through others only, storageFile.ts through two steps
        expect(lines(await call("imports", { path: STRINGS, within: "src/platform" }, context)).slice(1)).toEqual([
            "None of them imports it directly; list them with transitive.",
        ]);
    });

    it("to gives the shortest chain, through the first neighbour in path order", async () => {
        expect(await call("imports", { path: "src/app/loader.ts", to: STRINGS }, archFixture())).toEqual({
            text: [
                `src/app/loader.ts reaches ${STRINGS} in 4 steps:`,
                "  src/app/loader.ts",
                '  → src/app/main.ts  (import "./main.js")',
                '  → src/editor/browser/editorView.ts  (import "../editor/browser/editorView")',
                '  → src/base/browser/dom.ts  (import "../../base/browser/dom")',
                `  → ${STRINGS}  (import "../common/strings")`,
            ].join("\n"),
            paths: ["src/app/loader.ts", STRINGS, "src/app/main.ts", "src/editor/browser/editorView.ts", "src/base/browser/dom.ts"],
        });
    });

    it("architecture: the summary of src, and the cycle through a file", async () => {
        const context = archFixture();
        expect(await call("architecture", { path: "src" }, context)).toEqual({
            paths: ["src"],
            text: [
                "src/ — what its imports say about how it's organized:",
                "Layers, bottom first: base/ · platform/ · editor/ · app/ (1 import against that order)",
                "Folder conventions: browser, common, node",
                "Import cycles: 1, the largest 3 files",
                "Files nothing imports: 2, not counting tests (1 entry point named by a package.json)",
                'For details, ask again with report "layers", "conventions", "cycles" or "unused".',
            ].join("\n"),
        });
        expect(await call("architecture", { path: "src/editor/common/model.ts", report: "cycles" }, context)).toEqual({
            paths: ["src/editor/common/model.ts"],
            text: [
                "The shortest import cycle through src/editor/common/model.ts (3 steps):",
                "  src/editor/common/model.ts",
                '  → src/editor/common/tokens.ts  (import "./tokens")',
                '  → src/editor/common/textModel.ts  (import "./textModel")',
                '  → src/editor/common/model.ts  (import "./model")',
            ].join("\n"),
        });
    });
});

describe("show_on_map", () => {
    it("highlights what the index holds and says what it left out", async () => {
        expect(await call("show_on_map", { paths: ["src/core", "src/app/main.ts", "src/nope.ts"] }, freeFixture())).toEqual({
            text: "Highlighting 2 paths on the Map: src/core/, src/app/main.ts. Left out, not in the index: src/nope.ts.",
            paths: ["src/core", "src/app/main.ts"],
            action: { type: "highlight_nodes", nodeIds: ["src/core", "src/app/main.ts"] },
        });
    });

    it("focuses one path, and clears", async () => {
        const context = freeFixture();
        expect(await call("show_on_map", { action: "focus", paths: ["src/core/log.ts"] }, context)).toEqual({
            text: "Moving the Map to src/core/log.ts.", paths: ["src/core/log.ts"], action: { type: "focus_node", nodeId: "src/core/log.ts" },
        });
        expect(await call("show_on_map", { action: "clear" }, context)).toEqual({ text: "Clearing the Map's highlights.", paths: [], action: { type: "clear_highlights" } });
    });

    it("refuses focus without exactly one path, highlight without paths, and paths the index doesn't hold", async () => {
        const context = freeFixture();
        await expect(call("show_on_map", { action: "focus", paths: ["src", "scripts"] }, context)).rejects.toThrow("focus takes exactly one path.");
        await expect(call("show_on_map", { paths: [] }, context)).rejects.toThrow("highlight takes 1 to 50 paths.");
        await expect(call("show_on_map", { paths: ["src/nope.ts"] }, context)).rejects.toThrow("None of these paths are in the index: src/nope.ts.");
    });

    it("takes an absolute path inside the repo", async () => {
        const context = freeFixture();
        expect(await call("show_on_map", { action: "focus", paths: [path.join(context.repoRoot, "src", "core", "log.ts")] }, context)).toEqual({
            text: "Moving the Map to src/core/log.ts.", paths: ["src/core/log.ts"], action: { type: "focus_node", nodeId: "src/core/log.ts" },
        });
    });
});

describe("notes", () => {
    it("puts the repo note first and the index note after the answer", async () => {
        const context = { ...freeFixture(), repoNote: "Answering about X.", indexNote: "The index is being updated." };
        expect(lines(await call("imports", { path: "scripts/build.js" }, context)))
            .toEqual(["Note: Answering about X.", "Nothing imports scripts/build.js.", "Note: The index is being updated."]);
    });
});
