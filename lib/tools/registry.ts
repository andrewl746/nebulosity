import path from "path";
import { z } from "zod";
import type { UIAction } from "../contracts";
import { describe } from "../engine/describe";
import { BadInputError } from "../engine/errors";
import { overview } from "../engine/overview";
import { architecture } from "../engine/architecture";
import { impact } from "../engine/impact";
import { importChain, reach, targetKinds } from "../engine/reach";
import { search } from "../engine/search";
import { plural } from "../index/summarize/prompts";
import { architectureAnswer, chainAnswer, describeAnswer, impactAnswer, overviewAnswer, reachAnswer, rootLines, searchAnswer } from "./answers";
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
    /** Loaded into every session's prompt (ADR-056): mcp/server.ts marks it `_meta["anthropic/alwaysLoad"]`. */
    alwaysLoad: boolean;
    /** A deferred tool's words for Claude Code's ToolSearch (`_meta["anthropic/searchHint"]`). */
    searchHint?: string;
    handler(input: z.infer<S>, context: ToolContext): Promise<ToolOutput>;
};

/** Sent once per session (MCP's `instructions`; Claude Code keeps 4,096 characters since 2.1.296, 2,048 before). */
export const SERVER_INSTRUCTIONS = [
    "Nebulosity has indexed this repository: its folder tree, every import between its files, its docs and which folders they describe, and, when summaries are on, a short summary of every file and folder.",
    "Call these tools before grep or reading many files when a question is about how the code is organized or connected. They answer from the whole repo, exactly, in one call:",
    "- imports: what imports a file or folder, or what it imports, directly or through other files; group_by counts what a change would affect, by area; to gives the import chain between two places;",
    "- architecture: a folder's layers and the imports against them, its folder conventions, import cycles, and files nothing imports;",
    "- describe: what a folder or file is, what it uses and what uses it, and the docs that describe it;",
    "- overview: an unfamiliar repo's areas and the docs to read first;",
    "- search: where a feature or concept lives.",
    'Read the docs they point to for the repo\'s own rules. Paths are relative to the repo root ("" is the root) or absolute inside it.',
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
    alwaysLoad: true,
    description: "Start here on an unfamiliar repository: its size and summary, its top-level areas, the docs to read first (its own guides and rules), and the files most others import.",
    inputSchema: overviewInput,
    async handler(_input, context){
        return { text: finish(overviewAnswer(overview(context.repoRoot, { summariesOff: context.summariesOff })), context), paths: [] };
    },
};

const describeInput = z.object({ path: repoPath });
const describeTool: ToolEntry<typeof describeInput> = {
    name: "describe",
    alwaysLoad: true,
    description: "What a folder or file is: its summary, size, what's inside (or a file's declarations), the areas it imports from and is imported by with exact counts, and the docs that describe it. Read those docs for the area's rules.",
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
    alwaysLoad: true,
    description: "Find where a feature or concept lives, by keywords or meaning, across code, summaries, file and folder names, and declarations: the best files and folders with their best-matching code. Use Grep for an exact string.",
    inputSchema: searchInput,
    async handler({ query, limit }, context){
        const result = await search(context.repoRoot, query, { limit, summariesOff: context.summariesOff });
        return { text: finish(searchAnswer(result), context), paths: result.hits.map((hit) => hit.path) };
    },
};

const importsInput = z.object({
    path: repoPath,
    direction: z.enum(["dependents", "dependencies"]).default("dependents").describe("dependents: the files that import it; dependencies: the files it imports."),
    transitive: z.boolean().default(false).describe("Also count files reached through other files."),
    to: repoPath.optional().describe("Instead: the shortest chain of imports between path and this file or folder, either way."),
    group_by: z.string().max(1024).optional().describe('Count everything reached by area instead of listing it: a folder whose children are the areas ("" the top level), or "auto".'),
    within: z.string().max(1024).optional().describe("Only files inside this folder."),
    limit: z.number().int().min(1).max(500).default(50).describe("How many files to list, 1 to 500."),
    offset: z.number().int().min(0).default(0).describe("Where the next page starts."),
});
const importsTool: ToolEntry<typeof importsInput> = {
    name: "imports",
    alwaysLoad: true,
    description: "Exact answers from the repo's whole import graph, in one call. What imports a file or folder (dependents) or what it imports (dependencies); transitive: true adds files reached through others. group_by counts them by area: what a change would affect, with the tests and the entry points that load it. within keeps only files inside a folder. to gives the shortest import chain between two places. Prefer it to grep for all of these.",
    inputSchema: importsInput,
    async handler(input, context){
        const target = repoPathOf(input.path, context);
        if (input.to !== undefined){
            const answer = importChain(context.repoRoot, target, repoPathOf(input.to, context));
            const middle = answer.files.filter((file) => file !== answer.from && file !== answer.to);
            // `to` wins over the other modes; a model that combined them is told so, rather than handed a chain it reads as filtered
            const ignored = input.within !== undefined || input.group_by !== undefined || input.transitive;
            const parts = chainAnswer(answer);
            if (ignored) parts.notes = [...(parts.notes ?? []), "within, group_by and transitive don't apply to a chain."];
            return { text: finish(parts, context), paths: [answer.from, answer.to, ...middle] };
        }
        const within = input.within === undefined ? undefined : repoPathOf(input.within, context);
        const page = { transitive: input.transitive, limit: input.limit, offset: input.offset };
        if (input.group_by !== undefined){
            const groupBy = input.group_by === "auto" ? null : repoPathOf(input.group_by, context);
            // grouping counts everything a change reaches, so it's always transitive
            return { text: finish(impactAnswer(impact(context.repoRoot, target, input.direction, { groupBy, within })), context), paths: [target] };
        }
        if (input.direction === "dependents" && input.transitive){
            // the tests and the files nothing imports close the first page; later pages are the list's continuation
            const i = impact(context.repoRoot, target, "dependents", { groupBy: null, within });
            return { text: finish(reachAnswer(i.reach, page, page.offset === 0 ? rootLines(i.tests, i.roots) : []), context), paths: [target] };
        }
        return { text: finish(reachAnswer(reach(context.repoRoot, target, input.direction, { within }), page), context), paths: [target] };
    },
};

const architectureInput = z.object({
    path: repoPath.default(""),
    report: z.enum(["summary", "layers", "conventions", "cycles", "unused"]).default("summary")
        .describe("summary: all four in brief; layers, conventions, cycles or unused: one in full."),
    through: z.string().max(1024).optional().describe("With cycles: the shortest import cycle through this file."),
    limit: z.number().int().min(1).max(500).default(20).describe("How many cycles or files to list."),
    offset: z.number().int().min(0).default(0).describe("Where the next page starts."),
});
const architectureTool: ToolEntry<typeof architectureInput> = {
    name: "architecture",
    alwaysLoad: true,
    description: "How code under a folder is organized, computed from its imports: its parts in layers and the imports that go against them (layers); which recurring folder names, like common/browser/node, import which (conventions); import cycles (cycles; through: one file's shortest cycle); files nothing imports (unused). summary gives all four in brief.",
    inputSchema: architectureInput,
    async handler({ path: raw, report, through, limit, offset }, context){
        const target = repoPathOf(raw, context);
        const answer = architecture(context.repoRoot, target, report, through === undefined ? {} : { through: repoPathOf(through, context) });
        return { text: finish(architectureAnswer(answer, { limit, offset }), context), paths: [target] };
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
    alwaysLoad: false,
    searchHint: "map highlight focus show point visualize",
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

/** Every tool (PIVOT_SPEC.md §6.2, ADR-056), in the order clients list them. */
export const TOOLS: readonly ToolEntry[] = [overviewTool, describeTool, searchTool, importsTool, architectureTool, showOnMapTool];
