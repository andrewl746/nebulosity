/**
 * npm run bench-mcp -- [path-to-repo]   (default ../vscode)
 *
 * S5 (PIVOT_SPEC.md §2): every tool's latency through the real MCP server, as a client sees it. The SDK's stdio client
 * starts `node mcp/launch.mjs` in the repo's folder with live events off, and times each call from request to answer.
 * Each tool's first call is reported apart (it may load the import graph or the embedding model); S5 judges the 20 warm
 * calls after it: every one ≤ 500 ms (D5 in docs/plans/2026-10-13-v1-4-mcp.md).
 */
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { nebulosityPath } from "../lib/home";

const WARM_CALLS = 20;
const S5_MS = 500;

const FILES = [
    "src/vs/base/common/lifecycle.ts", "src/vs/base/common/event.ts", "src/vs/base/common/uri.ts",
    "src/vs/platform/instantiation/common/instantiation.ts", "src/vs/editor/common/core/range.ts",
    "src/vs/workbench/services/editor/common/editorService.ts", "src/vs/platform/files/common/files.ts",
    "src/vs/base/browser/dom.ts", "src/vs/platform/configuration/common/configuration.ts", "src/vs/workbench/common/contributions.ts",
];
const FOLDERS = [
    "src/vs/base", "src/vs/platform", "src/vs/editor", "src/vs/workbench", "src/vs/workbench/contrib/terminal",
    "src/vs/workbench/browser/parts/editor", "src/vs/platform/files", "extensions/git", "build", "src/vs/code",
];
const QUERIES = [
    "integrated terminal", "editor tabs", "extension host", "file watcher", "keybinding resolution",
    "lifecycle", "settings editor", "git blame", "debug adapter", "notebook kernel",
];
const PAIRS: [string, string][] = [
    ["src/vs/workbench/contrib/terminal", "src/vs/base/common/lifecycle.ts"],
    ["src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts", "src/vs/platform/instantiation/common/instantiation.ts"],
    ["extensions/git/src/git.ts", "src/vs/base/common/strings.ts"],
    ["src/vs/workbench/contrib/debug/browser/debugService.ts", "src/vs/base/common/event.ts"],
    ["src/vs/code", "src/vs/platform/files"],
    ["src/vs/workbench/api/common/extHost.api.impl.ts", "src/vs/editor/common/core/range.ts"],
    ["src/vs/workbench/browser/parts/editor", "src/vs/workbench/services/editor/common/editorService.ts"],
    ["src/vs/platform/keybinding/common/keybinding.ts", "src/vs/base/common/uri.ts"],
    ["build", "src/vs/base"],
    ["src/vs/workbench/contrib/notebook/common/notebookCommon.ts", "src/vs/base/browser/dom.ts"],
];

/** Each tool's inputs, in the order calls cycle through them (the first is the cold call). */
const CALLS: [string, Record<string, unknown>[]][] = [
    ["overview", [{}]],
    ["describe", [...FOLDERS, ...FILES].map((p) => ({ path: p }))],
    ["search", QUERIES.map((query) => ({ query }))],
    ["dependents", FILES.flatMap((p) => [{ path: p }, { path: p, transitive: true }])],
    ["dependencies", FILES.flatMap((p) => [{ path: p }, { path: p, transitive: true }])],
    ["path", PAIRS.map(([from, to]) => ({ from, to }))],
    ["show_on_map", [...FILES, ...FOLDERS].map((p) => ({ paths: [p] }))],
];

/** Nearest-rank percentile of sorted values. */
const percentile = (sorted: number[], q: number): number => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
const ms = (n: number): string => `${n.toFixed(0)} ms`;

async function timed(client: Client, name: string, args: Record<string, unknown>): Promise<{ ms: number; chars: number }> {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: args });
    const took = performance.now() - started;
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    if (result.isError) throw new Error(`${name} ${JSON.stringify(args)} failed: ${text}`);
    return { ms: took, chars: text.length };
}

async function main(): Promise<void> {
    const repo = path.resolve(process.argv[2] ?? path.join("..", "vscode"));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;

    const client = new Client({ name: "bench-mcp", version: "1" });
    const started = performance.now();
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [nebulosityPath("mcp", "launch.mjs")],
        cwd: repo,
        env: { ...env, NEBULOSITY_LIVE: "off", CLAUDE_PROJECT_DIR: repo },
        stderr: "inherit",
    }));
    const startupMs = performance.now() - started;

    const rows: string[] = [];
    let worst = 0;
    for (const [name, inputs] of CALLS){
        const first = await timed(client, name, inputs[0]);
        const warm: { ms: number; chars: number }[] = [];
        for (let i = 0; i < WARM_CALLS; i++) warm.push(await timed(client, name, inputs[(i + 1) % inputs.length]));
        const sorted = warm.map((w) => w.ms).sort((a, b) => a - b);
        const largest = Math.max(first.chars, ...warm.map((w) => w.chars));
        worst = Math.max(worst, sorted[sorted.length - 1]);
        rows.push(`| \`${name}\` | ${ms(first.ms)} | ${WARM_CALLS} | ${ms(percentile(sorted, 0.5))} | ${ms(percentile(sorted, 0.95))} | ${ms(sorted[sorted.length - 1])} | ${largest.toLocaleString("en-US")} |`);
    }
    await client.close();

    console.log(`Server start (spawn → initialized): ${ms(startupMs)}\n`);
    console.log("| Tool | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |");
    console.log("|---|---|---|---|---|---|---|");
    for (const row of rows) console.log(row);
    const pass = worst <= S5_MS;
    console.log(`\nS5 (every warm call ≤ ${S5_MS} ms): ${pass ? "PASS" : "FAIL"} (worst ${ms(worst)})`);
    process.exit(pass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
