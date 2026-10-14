import path from "path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { copyFixture } from "../../test/helpers/fixture";
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

describe("the registry", () => {
    it("defines the seven v1 tools once, in order, with descriptions Claude Code shows whole", () => {
        expect(TOOLS.map((t) => t.name)).toEqual(["overview", "describe", "search", "dependents", "dependencies", "path", "show_on_map"]);
        for (const tool of TOOLS) expect(tool.description.length).toBeLessThanOrEqual(2_048);
        expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2_048);
    });
});

describe("overview, describe and search with no API key", () => {
    it("overview: sizes, areas and the most-imported files, and what a key adds", async () => {
        const context = freeFixture();
        expect(await call("overview", {}, context)).toEqual({ paths: [], text: [
            `${path.basename(context.repoRoot)}: 8 files, 48 lines, 11 imports between files.`,
            S,
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
        expect(await call("dependents", { path: path.join(context.repoRoot, "src", "core", "log.ts") }, context))
            .toEqual(await call("dependents", { path: "src/core/log.ts" }, context));
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
        expect(lines(result).at(-1)).toBe("Note: Summaries are off (no ANTHROPIC_API_KEY), so results come from code and folder names only.");
        expect(result.paths).toEqual(["src/core/log.ts"]);
    });
});

describe("dependents and dependencies", () => {
    const HEADER = "src/core/log.ts is imported by 3 files directly and 7 files in all, counting files that reach it through others.";

    it("lists a file's direct importers under both totals", async () => {
        expect(await call("dependents", { path: "src/core/log.ts" }, freeFixture())).toEqual({
            paths: ["src/core/log.ts"], text: [HEADER, "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts"].join("\n"),
        });
    });

    it("groups what reaches a folder by distance", async () => {
        expect(lines(await call("dependents", { path: "src/core", transitive: true }, freeFixture()))).toEqual([
            "src/core/ is imported from outside it by 3 files directly and 6 files in all, counting files that reach it through others.",
            "Distance 1 (3):", "  src/app/main.ts", "  src/util/strings.ts", "  src/index.ts",
            "Distance 2 (3):", "  src/app/view.tsx", "  scripts/build.js", "  src/util/strings.test.ts",
        ]);
    });

    it("pages a long list and says where the next page starts", async () => {
        const context = freeFixture();
        expect(lines(await call("dependents", { path: "src/core/log.ts", transitive: true, limit: 4 }, context))).toEqual([
            HEADER, "Distance 1 (3):", "  src/app/main.ts", "  src/core/index.ts", "  src/index.ts",
            "Distance 2 (3):", "  src/util/strings.ts", "… 3 more (next page: offset 4)",
        ]);
        expect(lines(await call("dependents", { path: "src/core/log.ts", transitive: true, limit: 4, offset: 4 }, context))).toEqual([
            HEADER, "Showing 5–7 of 7.", "Distance 2 (3):", "  src/app/view.tsx", "  scripts/build.js", "Distance 3 (1):", "  src/util/strings.test.ts",
        ]);
    });

    it("says when nothing imports a file, what a folder imports, and what a file reaches", async () => {
        const context = freeFixture();
        expect((await call("dependents", { path: "scripts/build.js" }, context)).text).toBe("Nothing imports scripts/build.js.");
        expect((await call("dependencies", { path: "src" }, context)).text).toBe("src/ imports nothing outside it.");
        expect(lines(await call("dependencies", { path: "src/app/main.ts", transitive: true }, context))).toEqual([
            "src/app/main.ts imports 3 files directly and 4 files in all, counting what those import in turn.",
            "Distance 1 (3):", "  src/core/log.ts", "  src/util/strings.ts", "  src/app/view.tsx",
            "Distance 2 (1):", "  src/core/index.ts",
        ]);
    });

    it("refuses the whole repo, and a limit outside its range", async () => {
        const context = freeFixture();
        await expect(call("dependents", { path: "" }, context)).rejects.toThrow(BadInputError);
        // a schema failure (zod's own error class), not just any throw: 500 is the largest page
        await expect(call("dependents", { path: "src", limit: 501 }, context)).rejects.toBeInstanceOf(z.ZodError);
    });
});

describe("path", () => {
    it("gives the chain with each import, the other way round when needed, or says there is none", async () => {
        const context = freeFixture();
        const steps = ["  scripts/build.js", '  → src/app/main.ts  (import "../src/app/main")', '  → src/core/log.ts  (import "../core/log")'];
        expect(await call("path", { from: "scripts/build.js", to: "src/core/log.ts" }, context)).toEqual({
            text: ["scripts/build.js reaches src/core/log.ts in 2 steps:", ...steps].join("\n"),
            paths: ["scripts/build.js", "src/core/log.ts", "src/app/main.ts"],
        });
        expect(lines(await call("path", { from: "src/core/log.ts", to: "scripts/build.js" }, context))).toEqual([
            "src/core/log.ts doesn't reach scripts/build.js through imports; the other way round, scripts/build.js reaches src/core/log.ts in 2 steps:",
            ...steps,
        ]);
        expect((await call("path", { from: "src/app/view.tsx", to: "src/util/strings.test.ts" }, context)).text)
            .toBe("No chain of imports joins src/app/view.tsx and src/util/strings.test.ts, in either direction.");
        await expect(call("path", { from: "src", to: "src/core" }, context)).rejects.toThrow(BadInputError);
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
        expect(lines(await call("dependents", { path: "scripts/build.js" }, context)))
            .toEqual(["Note: Answering about X.", "Nothing imports scripts/build.js.", "Note: The index is being updated."]);
    });
});
