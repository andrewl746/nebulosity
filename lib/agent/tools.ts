import { tool, type ToolRuntime } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { findRepository, loadImportEdgesFrom, loadImportEdgesTouching } from "@/lib/db/store/structure";
import { loadFileFacts, loadFolderFacts } from "@/lib/db/store/summaries";
import { search } from "@/lib/engine/search";
import { IGNORED_DIRS } from "@/lib/index/discover";
import { repoKey } from "@/lib/index/paths";

const MAX_READ_LINES = 400;

// V1.3: the tools answer about the active repo (.nebulosity/config.json) from the new engine. V1.4 moves their logic
// into lib/tools/registry.ts, and E1 wraps the registry's entries for the Guide (PIVOT_SPEC.md §6.2).

/** The repo the tools work on, and its id; null until one is indexed. */
function activeRepo(): { root: string; repoId: number } | null {
    const root = readConfig().activeRepo;
    if (root === null) return null;
    const repoId = findRepository(getDb(), repoKey(root));
    return repoId === null ? null : { root, repoId };
}

const NO_REPO = "ERROR INDEX_EMPTY: no repository is indexed yet — tell the user to run npm run index -- <path-to-repo>.";

// makes sure the relative path:
// 1. doesn't escape the repo (e.g., ../../../../etc/passwd)
// 2. doesn't touch ignored directories (e.g., .next, .git)
// 3. doesn't touch any secrets (e.g., .env)
function safePath(root: string, relativePath: string): { ok: true; absolute: string } | { ok: false; error: string } {
    const base = path.resolve(root);
    const resolved = path.resolve(base, relativePath);

    if (resolved !== base && !resolved.startsWith(base + path.sep)){
        return { ok: false, error: `Path "${relativePath}" resolves outside the repository.` };
    }

    const segments = path.relative(base, resolved).split(path.sep);

    if (segments.some((s) => IGNORED_DIRS.has(s) || s.startsWith(".env"))){
        return { ok: false, error: `Path "${relativePath}" is not accessible.` };
    }

    return { ok: true, absolute: resolved };
}

/* ─────────────────────────── Knowledge tools ─────────────────────────── */
export const searchCode = tool(
    async ({ query }: { query: string }, runtime: ToolRuntime) => {
        const repo = activeRepo();
        if (!repo) return NO_REPO;

        const result = await search(repo.root, query, { limit: 8 });

        if (result.hits.length === 0){
            return `No results for "${query}". Try rewording the query once before concluding the code doesn't exist.${result.note ? ` (${result.note})` : ""}`;
        }

        // one line per file or folder: what it is, then its best-matching code when there is some
        const formatted = result.hits
            .map((h, i) => `[${i + 1}] ${h.path}${h.kind === "folder" ? "/" : ""} · ${h.tagline ?? "(no summary yet)"}`
                + (h.code ? `\n    ${h.code.symbol}, lines ${h.code.startLine}-${h.code.endLine}: ${h.code.snippet}` : ""))
            .join("\n");

        // cite every file this search actually surfaced
        return new Command({
            update: {
                messages: [new ToolMessage({ content: formatted, tool_call_id: runtime.toolCallId })],
                sources: result.hits.filter((h) => h.kind === "file").map((h) => h.path)
            }
        });
    },
    {
        name: "search_code",
        description: "Hybrid search over the repository: code keywords, summary keywords and summary meaning. Use for any question about how something works or where something happens. Reword and retry if results look irrelevant.",
        schema: z.object({ query: z.string() })
    }
);

export const readFile = tool(
    (
        { path: relativePath, startLine, endLine }: { path: string; startLine?: number; endLine?: number },
        runtime: ToolRuntime
    ) => {
        const repo = activeRepo();
        if (!repo) return NO_REPO;

        const guard = safePath(repo.root, relativePath);

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
        const repo = activeRepo();
        if (!repo) return NO_REPO;

        const guard = safePath(repo.root, relativePath);

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
            .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."))
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
        const repo = activeRepo();
        if (!repo) return NO_REPO;

        const edges = loadImportEdgesFrom(getDb(), repo.repoId, [filePath]);

        if (edges.length === 0){
            return `"${filePath}" has no outgoing dependencies (or the path isn't indexed).`;
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
        const repo = activeRepo();
        if (!repo) return NO_REPO;

        const edges = loadImportEdgesTouching(getDb(), repo.repoId, [filePath]).filter((e) => e.target === filePath);

        if (edges.length === 0){
            return `No files import "${filePath}" (or the path isn't indexed).`;
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
        const repo = activeRepo();
        if (!repo) return NO_REPO;

        const central = loadFileFacts(getDb(), repo.repoId)
            .sort((a, b) => b.importedBy - a.importedBy || (a.path < b.path ? -1 : 1))
            .slice(0, limit ?? 10);

        if (central.length === 0){
            return "The index holds no files yet.";
        }

        return central
            .map((f, i) => `${i + 1}. ${f.path} (imported by ${f.importedBy})`)
            .join("\n");
    },
    {
        name: "get_central_files",
        description: "Files ranked by how many files import them (in-degree, ADR-010): load-bearing files, and a good place to start reading.",
        schema: z.object({ limit: z.number().optional() })
    }
);

/* ─────────────────────────── UI-action tools ─────────────────────────── */

export const highlightNodes = tool(
    // `reason` isn't read here — the schema requires it purely so the model has
    // to articulate WHY it's highlighting something, per AI_AGENT_DESIGN.md §3
    ({ nodeIds, reason: _reason }: { nodeIds: string[]; reason: string }, runtime: ToolRuntime) => {
        const repo = activeRepo();
        const db = getDb();
        const validIds = new Set(repo ? [...loadFileFacts(db, repo.repoId).map((f) => f.path), ...loadFolderFacts(db, repo.repoId).map((f) => f.path)] : []);

        const valid = nodeIds.filter((id) => validIds.has(id));
        const invalid = nodeIds.filter((id) => !validIds.has(id));

        // the model needs to know if some ids were dropped so it can correct
        // itself (AI_AGENT_DESIGN.md §3) (that's why this isn't just "ok")
        const content = invalid.length > 0
            ? `Highlighted ${valid.length} path(s). Ignored invalid ids (not in the index): ${invalid.join(", ")}`
            : `Highlighted ${valid.length} path(s).`;

        return new Command({
            update: {
                messages: [new ToolMessage({ content, tool_call_id: runtime.toolCallId })],
                uiActions: [{ type: "highlight_nodes", nodeIds: valid }]
            }
        })
    },
    {
        name: "highlight_nodes",
        description: "Highlight one or more files or folders on the Map while discussing them.",
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
        description: "Move the Map to a specific file or folder.",
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
        description: "Reset all Map highlights, e.g. when the topic changes.",
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
