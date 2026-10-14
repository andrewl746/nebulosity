import path from "path";
import { z } from "zod";
import type { UIAction } from "../contracts";
import { describe } from "../engine/describe";
import { BadInputError } from "../engine/errors";
import { overview } from "../engine/overview";
import { importChain, reach, targetKinds, type Direction } from "../engine/reach";
import { search } from "../engine/search";
import { plural } from "../index/summarize/prompts";
import { chainAnswer, describeAnswer, overviewAnswer, reachAnswer, searchAnswer } from "./answers";
import type { ToolContext } from "./context";
import { repoPathFrom } from "./repo";
import { answerText, shownPath, type AnswerParts } from "./text";

export type { ToolContext } from "./context";

/** What a handler returns (ADR-047): the answer, the paths it touched (the Map pulses them), and show_on_map's action. */
export type ToolOutput = { text: string; paths: string[]; action?: UIAction };

/**
 * One tool, defined once (ADR-030): a name, a description written for a model, a zod schema, and a handler that calls
 * the engine. Adapters wrap entries: MCP now (mcp/server.ts), LangGraph in E1. The handler is a method, so a list of
 * entries with different schemas still type-checks.
 */
export type ToolEntry<S extends z.ZodObject = z.ZodObject> = {
    name: string;
    description: string;
    inputSchema: S;
    handler(input: z.infer<S>, context: ToolContext): Promise<ToolOutput>;
};

/** Sent once per session (MCP's `instructions`; Claude Code keeps up to 2,048 characters): when to reach for these tools. */
export const SERVER_INSTRUCTIONS = [
    "Nebulosity has already indexed this repository: its folder tree, the imports between its files (the import graph) and, when summaries are on, a short summary of every file and folder.",
    "Use these tools before broad Grep/Glob/Read exploration when a question is about structure or connections:",
    "- overview: first, on an unfamiliar repo (its areas, sizes and most-imported files);",
    "- describe: what a folder or file is, what's inside, what it uses and what uses it;",
    "- search: where a feature or concept lives (code, summaries, folder and file names, exported declarations);",
    "- dependents / dependencies: what imports X or what X imports, directly or through other files; exact and complete over the indexed import graph (imports that resolve to files in the repo), so better than grep for impact questions;",
    "- path: how one file or folder reaches another through imports;",
    "- show_on_map: point the user at files or folders on Nebulosity's Map.",
    'Paths are relative to the repo root ("" is the root), or absolute paths inside it; answers write them from the root. Read source text with your own Read tool.',
].join("\n");

const repoPath = z.string().max(1024)
    .describe('A path inside the repo: relative to its root ("src/vs/base", "src/index.ts"; "" is the root), or absolute.');

/** A path from the model (repo-relative, or absolute inside the repo) in the spelling stored paths use; refused when it could leave the repo. */
function repoPathOf(raw: string, context: ToolContext): string {
    const parsed = repoPathFrom(raw, context.repoRoot);
    if (parsed === null) throw new BadInputError(`"${raw}" isn't a path inside the repo (${context.repoRoot}): pass one relative to its root ("" for the root) or an absolute one inside it, without "..".`);
    return parsed;
}

const finish = (parts: AnswerParts, context: ToolContext): string =>
    answerText({ ...parts, repoNote: context.repoNote, indexNote: context.indexNote });

const overviewInput = z.object({});
const overviewTool: ToolEntry<typeof overviewInput> = {
    name: "overview",
    description: "Start here on an unfamiliar repository. Returns the repo's size and summary, its top-level areas (largest first) with their sizes and one-line summaries, and the files most other files import, which are good places to start reading. One call per session is usually enough.",
    inputSchema: overviewInput,
    async handler(_input, context){
        return { text: finish(overviewAnswer(overview(context.repoRoot, { summariesOff: context.summariesOff })), context), paths: [] };
    },
};

const describeInput = z.object({ path: repoPath });
const describeTool: ToolEntry<typeof describeInput> = {
    name: "describe",
    description: "What a folder or file is: its summary, size, what's inside (subfolders and files, or a file's declarations with their line numbers), and which areas it imports from and is imported by, with exact counts. Use it to get oriented in an area before reading its files.",
    inputSchema: describeInput,
    async handler({ path: raw }, context){
        const target = repoPathOf(raw, context);
        const answer = describe(context.repoRoot, target, { summariesOff: context.summariesOff });
        return { text: finish(describeAnswer(answer, path.basename(context.repoRoot)), context), paths: [target] };
    },
};

const searchInput = z.object({
    query: z.string().trim().min(1).max(200).describe("What to look for, in words or identifiers."),
    limit: z.number().int().min(1).max(30).default(10).describe("How many results, 1 to 30."),
});
const searchTool: ToolEntry<typeof searchInput> = {
    name: "search",
    description: "Find where a feature or concept lives, by keywords or meaning. Searches code (identifiers and text), the summaries of every file and folder, folder and file names, and exported declaration names, and returns the best-matching files and folders, each with its one-line summary and its best-matching code. Use it for \"where is X handled?\"; use Grep for an exact string.",
    inputSchema: searchInput,
    async handler({ query, limit }, context){
        const result = await search(context.repoRoot, query, { limit, summariesOff: context.summariesOff });
        return { text: finish(searchAnswer(result), context), paths: result.hits.map((hit) => hit.path) };
    },
};

const reachInput = z.object({
    path: repoPath,
    transitive: z.boolean().default(false).describe("Also list files reached through other files, not only direct imports."),
    limit: z.number().int().min(1).max(500).default(50).describe("How many files to list, 1 to 500. The totals always count everything."),
    offset: z.number().int().min(0).default(0).describe("Where to start listing: the next page of a long answer."),
});
function reachTool(direction: Direction, description: string): ToolEntry<typeof reachInput> {
    return {
        name: direction,
        description,
        inputSchema: reachInput,
        async handler({ path: raw, transitive, limit, offset }, context){
            const target = repoPathOf(raw, context);
            return { text: finish(reachAnswer(reach(context.repoRoot, target, direction), { transitive, limit, offset }), context), paths: [target] };
        },
    };
}

const pathInput = z.object({ from: repoPath, to: repoPath });
const pathTool: ToolEntry<typeof pathInput> = {
    name: "path",
    description: "How one file or folder reaches another through imports: the shortest chain of files, each step with the import that makes it. Checks both directions and says which way the chain runs, or that none exists. Use it for \"how does A end up depending on B?\".",
    inputSchema: pathInput,
    async handler({ from, to }, context){
        const answer = importChain(context.repoRoot, repoPathOf(from, context), repoPathOf(to, context));
        const middle = answer.files.filter((file) => file !== answer.from && file !== answer.to);
        return { text: finish(chainAnswer(answer), context), paths: [answer.from, answer.to, ...middle] };
    },
};

const showInput = z.object({
    action: z.enum(["highlight", "focus", "clear"]).default("highlight")
        .describe("highlight: mark the paths; focus: move the Map to one path and select it; clear: remove the highlights."),
    paths: z.array(z.string().max(1024)).max(50).default([])
        .describe("Paths inside the repo (relative to its root, or absolute): 1 to 50 for highlight, exactly 1 for focus, none for clear."),
});
const showOnMapTool: ToolEntry<typeof showInput> = {
    name: "show_on_map",
    description: "Point the user at files or folders on Nebulosity's Map, the zoomable picture of this repo they may have open in a browser: highlight up to 50 paths, focus one (the Map moves to it and selects it), or clear the highlights. Use it while explaining, so the user sees what you mean. If no Map is open, nothing shows, and the answer says so.",
    inputSchema: showInput,
    async handler({ action, paths: raw }, context){
        if (action === "clear") return { text: "Clearing the Map's highlights.", paths: [], action: { type: "clear_highlights" } };

        const wanted = [...new Set(raw.map((p) => repoPathOf(p, context)))];
        if (action === "focus" && wanted.length !== 1) throw new BadInputError("focus takes exactly one path.");
        if (wanted.length === 0) throw new BadInputError("highlight takes 1 to 50 paths.");

        const kinds = targetKinds(context.repoRoot, wanted);
        const known = wanted.filter((_, i) => kinds[i] !== null);
        const unknown = wanted.filter((_, i) => kinds[i] === null);
        if (known.length === 0) throw new BadInputError(`None of these paths are in the index: ${unknown.join(", ")}.`);
        const label = (p: string): string => {
            const kind = kinds[wanted.indexOf(p)];
            return kind === "repo" ? "the repo" : shownPath(p, kind === "folder" ? "folder" : "file");
        };

        if (action === "focus") return { text: `Moving the Map to ${label(known[0])}.`, paths: known, action: { type: "focus_node", nodeId: known[0] } };
        const leftOut = unknown.length > 0 ? ` Left out, not in the index: ${unknown.join(", ")}.` : "";
        return {
            text: `Highlighting ${plural(known.length, "path")} on the Map: ${known.map(label).join(", ")}.${leftOut}`,
            paths: known,
            action: { type: "highlight_nodes", nodeIds: known },
        };
    },
};

/** Every v1 tool (PIVOT_SPEC.md §6.2), in the order clients list them. */
export const TOOLS: readonly ToolEntry[] = [
    overviewTool,
    describeTool,
    searchTool,
    reachTool("dependents", "The files that import a file or folder: the direct importers, or with transitive: true also every file that reaches it through others. Totals are exact and complete over the indexed import graph (imports that resolve to files in the repo), so prefer it to grep for \"what uses X?\" and \"what breaks if X changes?\". Lists are nearest first, then the most imported; page long ones with offset."),
    reachTool("dependencies", "The files a file or folder imports: directly, or with transitive: true also what those import in turn. Totals are exact and complete over the indexed import graph (imports that resolve to files in the repo). Packages outside the repo (like react) aren't indexed, so they never appear."),
    pathTool,
    showOnMapTool,
];
