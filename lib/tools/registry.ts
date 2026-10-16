import path from "path";
import { z } from "zod";
import type { UIAction } from "../contracts";
import { describe } from "../engine/describe";
import { BadInputError } from "../engine/errors";
import { overview } from "../engine/overview";
import { architecture } from "../engine/architecture";
import { calls } from "../engine/calls";
import { impact } from "../engine/impact";
import { importChain, reach, targetKinds } from "../engine/reach";
import { search } from "../engine/search";
import { plural } from "../index/summarize/prompts";
import { architectureAnswer, callsAnswer, chainAnswer, describeAnswer, impactAnswer, overviewAnswer, reachAnswer, rootLines, searchAnswer } from "./answers";
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
    "Call these tools first, before grep, a script of your own or reading many files, for any question about how the code is organized or connected: who calls or injects something, what a change touches and which tests to run, imports against the layers, cycles, files nothing imports. They answer from the whole repo, exactly, in one call:",
    "- imports: what imports a file or folder, or what it imports, directly or through other files; group_by counts what a change would affect, by area; to gives the import chain between two places;",
    "- calls: who calls a method, even through injected services, where a type is injected, and what changing it touches (give the type's file as path);",
    "- architecture: a folder's layers and the imports against them, its folder conventions, import cycles, and files nothing imports;",
    "- describe: what a folder or file is, what it uses and what uses it, and the docs that describe it;",
    "- overview: an unfamiliar repo's areas and the docs to read first;",
    "- search: where a feature or concept lives.",
    // ADR-054, amended 2026-10-15: in Eval #2 the docs line alone didn't get the repo's own rules opened; shortened the same day in V1.7's tool-use round 3 (R-AA) to hold the first-call budget
    "Open the docs these answers name before saying how the code is organized or why: they are the maintainers' own account.",
    'Paths are relative to the repo root ("" is the root) or absolute inside it.',
].join("\n");

const repoPath = z.string().max(1024)
    .describe('Relative to the repo root ("" is the root), or absolute inside it.');

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
    description: "What a folder or file is: its summary, size, contents or declarations, the areas it imports and is imported by, with exact counts, and the docs about it. Read those docs for its rules.",
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
    description: "Find where a feature or concept lives: the best files and folders, with their best-matching code.",
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
    to: repoPath.optional().describe("Instead: the shortest import chain between path and this place, either way."),
    group_by: z.string().max(1024).optional().describe('Count by area instead: a folder ("" the top level) or "auto".'),
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
    report: z.enum(["summary", "layers", "conventions", "cycles", "unused"]).default("summary"),
    through: z.string().max(1024).optional(),
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

const callsInput = z.object({
    symbol: z.string().trim().min(1).max(200).describe('"IFooService", or a method: "IFooService.save".'),
    path: z.string().optional().describe("Its file, if two types share the name."),
    group_by: z.string().optional().describe('Count by area: a folder ("" the top level) or "auto".'),
    within: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(50).describe("Files to list, 1 to 500."),
    offset: z.number().int().min(0).default(0),
});
const callsTool: ToolEntry<typeof callsInput> = {
    name: "calls",
    alwaysLoad: true,
    description: "Who calls a method of a class or interface, through declared types: injected services, fields, parameters, locals and base classes. With a method: its callers, its implementations and what changing it touches; with a type: where it is injected. Prefer it to grep.",
    inputSchema: callsInput,
    async handler(input, context){
        const declaredIn = input.path === undefined ? undefined : repoPathOf(input.path, context);
        const within = input.within === undefined ? undefined : repoPathOf(input.within, context);
        const groupBy = input.group_by === undefined || input.group_by === "auto" ? null : repoPathOf(input.group_by, context);
        const answer = calls(context.repoRoot, { symbol: input.symbol, ...(declaredIn !== undefined ? { path: declaredIn } : {}) }, { groupBy, ...(within !== undefined ? { within } : {}) });
        const page = { limit: input.limit, offset: input.offset };
        // the live event: the declaring file, then the files this page lists; the Map's /api/live takes at most 50 paths
        const listed = answer.kind === "ambiguous" ? [] : [answer.type.path, ...answer.files.slice(page.offset, page.offset + page.limit).map((f) => f.path)];
        return { text: finish(callsAnswer(answer, page), context), paths: listed.slice(0, 50) };
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
export const TOOLS: readonly ToolEntry[] = [overviewTool, describeTool, searchTool, importsTool, architectureTool, callsTool, showOnMapTool];
