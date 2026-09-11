import { tool, type ToolRuntime } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { retrieve, getVectorCache } from "@/lib/retrieve";
import { loadGraph, getCentralFiles } from "@/lib/db/graph-store";
import { IGNORE_LIST } from "@/lib/scan"; // requires exporting it in scan.ts first

const REPO_ROOT = process.cwd();
const MAX_READ_LINES = 400;

// makes sure the relative path:
// 1. doesn't escape the repo (e.g., ../../../../etc/passwd)
// 2. doesn't touch ignored directories (e.g., .next, .git)
// 3. doesn't touch any secrets (e.g., .env)
function safePath(relativePath: string): { ok: true; absolute: string } | { ok: false; error: string } {
    const resolved = path.resolve(REPO_ROOT, relativePath);

    if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)){
        return { ok: false, error: `Path "${relativePath}" resolves outside the repository.` };
    }

    const segments = path.relative(REPO_ROOT, resolved).split(path.sep);

    if (segments.some((s) => IGNORE_LIST.includes(s) || s.startsWith(".env"))){
        return { ok: false, error: `Path "${relativePath}" is not accessible.` };
    }

    return { ok: true, absolute: resolved };
}

/* ─────────────────────────── Knowledge tools ─────────────────────────── */
export const searchCode = tool(
    async ({ query }: { query: string }, runtime: ToolRuntime) => {
        const vectorCache = await getVectorCache();

        if (vectorCache.lastIndexAtMs === null){
            return "ERROR INDEX_EMPTY: no index exists yet — tell the user to run indexing first.";
        }

        const results = await retrieve(query);

        if (results.length === 0){
            return `No results above the relevance threshold for "${query}". Try rewording the query once before concluding the code doesn't exist.`;
        }

        // format matches the one in RAG_PIPELINE.md exactly 
        const formatted = results
            .map((r, i) => `[${i + 1}] ${r.filePath}:${r.startLine}-${r.endLine} · ${r.kind} ${r.name} (score ${r.score.toFixed(2)})\n${r.text}`)
            .join("\n\n");
        
        // cite every file this search actually surfaced
        return new Command({
            update: {
                messages: [new ToolMessage({ content: formatted, tool_call_id: runtime.toolCallId })],
                sources: [...new Set(results.map((r) => r.filePath))]
            }
        });
    },
    {
        name: "search_code",
        description: "Semantic search over the repository's code. Use for any question about how something works or where something happens. Reword and retry if results look irrelevant.",
        schema: z.object({ query: z.string() })
    }
);

export const readFile = tool(
    (
        { path: relativePath, startLine, endLine }: { path: string; startLine?: number; endLine?: number },
        runtime: ToolRuntime
    ) => {
        const guard = safePath(relativePath);

        if (!guard.ok){
            return `ERROR: ${guard.error}`;
        }

        let content: string;

        try{
            content = fs.readFileSync(guard.absolute, "utf-8");
        } catch (err){
            return `ERROR: could not read "${relativePath}": ${err instanceof Error ? err.message : String(err)}`;
        }

        const lines = content.split("\n");
        const start = startLine ? Math.max(1, startLine) : 1;
        const end = Math.min(endLine ?? lines.length, start + MAX_READ_LINES - 1, lines.length);

        const numbered = lines
            .slice(start - 1, end)
            .map((line, i) => `${start + i}| ${line}`)
            .join("\n");

        return new Command({
            update: {
                messages: [new ToolMessage({ content: numbered, tool_call_id: runtime.toolCallId })],
                sources: [relativePath]
            }
        });
    },
    {
        name: "read_file",
        description: "Read a file's contents, with line numbers. Request line ranges for large files (cap 400 lines per call).",
        schema: z.object({
            path: z.string(),
            startLine: z.number().optional(),
            endLine: z.number().optional()
        })
    }
);

export const listDirectory = tool(
    ({ path: relativePath }) => {
        const guard = safePath(relativePath);

        if (!guard.ok){
            return `ERROR: ${guard.error}`;
        }

        let entries: fs.Dirent[];

        try{
            entries = fs.readdirSync(guard.absolute, { withFileTypes: true });
        } catch (err){
            return `ERROR: could not list "${relativePath}": ${err instanceof Error ? err.message : String(err)}`;
        }

        const lines = entries
            .filter((e) => !IGNORE_LIST.includes(e.name) && !e.name.startsWith("."))
            .map((e) => {
                if (e.isDirectory()) return `${e.name}/ (dir)`;
                const size = fs.statSync(path.join(guard.absolute, e.name)).size;
                return `${e.name} (${size} bytes)`;
            });

        return lines.length ? lines.join("\n") : "(empty directory)";
    },
    {
        name: "list_directory",
        description: "List entries in a directory (files and subdirectories). Use \".\" for the repo root.",
        schema: z.object({ path: z.string() })
    }
);

export const getDependencies = tool(
    ({ path: filePath }) => {
        const graph = loadGraph(REPO_ROOT);

        if (!graph){
            return "ERROR: no scan exists yet (the repository has not been scanned).";
        }

        const edges = graph.edges.filter((e) => e.source === filePath);

        if (edges.length === 0){
            return `"${filePath}" has no outgoing dependencies (or the path doesn't exist in the graph).`;
        }

        return edges.map((e) => `${e.target} (via "${e.specifier}")`).join("\n");
    },
    {
        name: "get_dependencies",
        description: "Files this file imports (outgoing edges).",
        schema: z.object({ path: z.string() })
    }
);

export const getImporters = tool(
    ({ path: filePath }) => {
        const graph = loadGraph(REPO_ROOT);

        if (!graph){
            return "ERROR: no scan exists yet (the repository has not been scanned).";
        }

        const edges = graph.edges.filter((e) => e.target === filePath);

        if (edges.length === 0){
            return `No files import "${filePath}" (or the path doesn't exist in the graph).`;
        }

        return edges.map((e) => `${e.source} (via "${e.specifier}")`).join("\n");
    },
    {
        name: "get_importers",
        description: "Files that import this file (incoming edges).",
        schema: z.object({ path: z.string() })
    }
);

export const getCentralFilesTool = tool(
        ({ limit }) => {
        const central = getCentralFiles(REPO_ROOT).slice(0, limit ?? 10);

        if (central.length === 0){
            return "ERROR: no scan exists yet (the repository has not been scanned).";
        }

        return central
            .map((f, i) => `${i + 1}. ${f.path} (in ${f.inDegree} / out ${f.outDegree})`)
            .join("\n");
    },
    {
        name: "get_central_files",
        description: "Files ranked by degree centrality (high in-degree files are load-bearing and a good place to start reading).",
        schema: z.object({ limit: z.number().optional() })
    }
);

/* ─────────────────────────── UI-action tools ─────────────────────────── */

export const highlightNodes = tool(
    // `reason` isn't read here — the schema requires it purely so the model has
    // to articulate WHY it's highlighting something, per AI_AGENT_DESIGN.md §3
    ({ nodeIds, reason: _reason }: { nodeIds: string[]; reason: string }, runtime: ToolRuntime) => {
        const graph = loadGraph(REPO_ROOT);
        const validIds = new Set(graph?.files.map((f) => f.path) ?? []);

        const valid = nodeIds.filter((id) => validIds.has(id));
        const invalid = nodeIds.filter((id) => !validIds.has(id));

        // the model needs to know if some ids were dropped so it can correct
        // itself (AI_AGENT_DESIGN.md §3) (that's why this isn't just "ok")
        const content = invalid.length > 0
            ? `Highlighted ${valid.length} file(s). Ignored invalid ids (not in graph): ${invalid.join(", ")}`
            : `Highlighted ${valid.length} file(s).`;

        return new Command({
            update: {
                messages: [new ToolMessage({ content, tool_call_id: runtime.toolCallId })],
                uiActions: [{ type: "highlight_nodes", nodeIds: valid }]
            }
        })
    },
    {
        name: "highlight_nodes",
        description: "Highlight one or more files on the dependency graph while discussing them.",
        schema: z.object({
            nodeIds: z.array(z.string()),
            reason: z.string()
        })
    }
);

export const focusNode = tool(
    ({ nodeId }: { nodeId: string }, runtime: ToolRuntime) => {
        return new Command({
            update: {
                messages: [new ToolMessage({ content: "ok", tool_call_id: runtime.toolCallId })],
                uiActions: [{ type: "focus_node", nodeId }]
            }
        })
    },
    {
        name: "focus_node",
        description: "Pan/zoom the graph camera to a specific file.",
        schema: z.object({ nodeId: z.string() })
    }
);

export const clearHighlights = tool(
    (_input: Record<string, never>, runtime: ToolRuntime) => {
        return new Command({
            update: {
                messages: [new ToolMessage({ content: "ok", tool_call_id: runtime.toolCallId })],
                uiActions: [{ type: "clear_highlights" }]
            }
        })
    },
    {
        name: "clear_highlights",
        description: "Reset all graph highlights, e.g. when the topic changes.",
        schema: z.object({})
    }
);

export const allTools = [
    searchCode,
    readFile,
    listDirectory,
    getDependencies,
    getImporters,
    getCentralFilesTool,
    highlightNodes,
    focusNode,
    clearHighlights
];
