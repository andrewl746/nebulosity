/**
 * npm run bench-mcp -- [path-to-repo] [--after-write]   (default ../vscode)
 *
 * S5 (PIVOT_SPEC.md §2): every tool's latency through the real MCP server, as a client sees it. The SDK's stdio client
 * starts `node mcp/launch.mjs` in the repo's folder with live events off, and times each call from request to answer.
 * Each tool's first call is reported apart (it may load the import graph or the embedding model); S5 judges the 20 warm
 * calls after it: every one ≤ 500 ms (D5 in docs/plans/2026-10-13-v1-4-mcp.md).
 *
 * --after-write then runs a warm `npm run index` (no file edited, no API called) and measures the whole table again, first
 * calls included: the caches keyed by the index version rebuild on each tool's first call after the write (V1.5, ADR-052).
 * It's informative; the exit code stays S5's, which judges the warm calls of the first table.
 */
import { spawnSync } from "child_process";
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

/** A row of the table: its label, the tool it calls, and its inputs in the order calls cycle through them (the first is the cold call). */
type Row = { label: string; tool: string; inputs: Record<string, unknown>[] };
const CALLS: Row[] = [
    { label: "overview", tool: "overview", inputs: [{}] },
    { label: "describe", tool: "describe", inputs: [...FOLDERS, ...FILES].map((p) => ({ path: p })) },
    { label: "search", tool: "search", inputs: QUERIES.map((query) => ({ query })) },
    { label: "imports (dependents)", tool: "imports", inputs: FILES.flatMap((p) => [{ path: p }, { path: p, transitive: true }]) },
    { label: "imports (dependencies)", tool: "imports", inputs: FILES.flatMap((p) => [{ path: p, direction: "dependencies" }, { path: p, direction: "dependencies", transitive: true }]) },
    { label: "imports (to)", tool: "imports", inputs: PAIRS.map(([path, to]) => ({ path, to })) },
    // what a change to a widely used file affects, by area (ADR-055)
    { label: "imports (group_by)", tool: "imports", inputs: [{ path: "src/vs/platform/storage/common/storage.ts", group_by: "src/vs" }] },
    { label: "architecture (summary)", tool: "architecture", inputs: [{ path: "src/vs" }] },
    { label: "architecture (cycles)", tool: "architecture", inputs: [{ path: "src/vs/workbench/contrib", report: "cycles" }] },
    { label: "show_on_map", tool: "show_on_map", inputs: [...FILES, ...FOLDERS].map((p) => ({ paths: [p] })) },
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

/**
 * One pass over every tool: its first call, then WARM_CALLS warm ones. Returns the table's rows, the worst warm call
 * (what S5 judges) and the worst call of any kind, first calls included (what the after-a-write line judges).
 */
async function table(client: Client): Promise<{ rows: string[]; worst: number; worstAny: number }> {
    const rows: string[] = [];
    let worst = 0;
    let worstAny = 0;
    for (const { label, tool, inputs } of CALLS){
        const first = await timed(client, tool, inputs[0]);
        const warm: { ms: number; chars: number }[] = [];
        for (let i = 0; i < WARM_CALLS; i++) warm.push(await timed(client, tool, inputs[(i + 1) % inputs.length]));
        const sorted = warm.map((w) => w.ms).sort((a, b) => a - b);
        const largest = Math.max(first.chars, ...warm.map((w) => w.chars));
        worst = Math.max(worst, sorted[sorted.length - 1]);
        worstAny = Math.max(worstAny, first.ms, sorted[sorted.length - 1]);
        rows.push(`| \`${label}\` | ${ms(first.ms)} | ${WARM_CALLS} | ${ms(percentile(sorted, 0.5))} | ${ms(percentile(sorted, 0.95))} | ${ms(sorted[sorted.length - 1])} | ${largest.toLocaleString("en-US")} |`);
    }
    return { rows, worst, worstAny };
}

function printTable(rows: string[]): void {
    console.log("| Tool | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |");
    console.log("|---|---|---|---|---|---|---|");
    for (const row of rows) console.log(row);
}

/**
 * A warm structure run edits no file in the repo and calls no API; it writes the config's activeRepo (scripts/index.ts does,
 * after its last stage) and bumps the index version (ADR-036), so every cache keyed by the
 * version (the import graph, the reach index, the search's name facts) rebuilds on the server's next call. Its progress
 * lines (carriage-return rewrites) are dropped so the bench's output stays a clean markdown file.
 */
function warmIndex(repo: string): string[] {
    const indexed = spawnSync(process.execPath, ["--import", "tsx", nebulosityPath("scripts", "index.ts"), repo], {
        stdio: ["ignore", "pipe", "inherit"],
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NEBULOSITY_LIVE: "off" },
    });
    if (indexed.status !== 0) throw new Error("npm run index failed; the after-write table wasn't measured");
    return indexed.stdout.split(/[\r\n]+/).filter((line) => line.startsWith("[index]") && !/^\[index\] \w+ \d+\/\d+\s*$/.test(line));
}

async function main(): Promise<void> {
    const repo = path.resolve(process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? path.join("..", "vscode"));
    const afterWrite = process.argv.includes("--after-write");
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

    const warm = await table(client);
    console.log(`Server start (spawn → initialized): ${ms(startupMs)}\n`);
    printTable(warm.rows);
    const pass = warm.worst <= S5_MS;
    console.log(`\nS5 (every warm call ≤ ${S5_MS} ms): ${pass ? "PASS" : "FAIL"} (worst ${ms(warm.worst)})`);

    if (afterWrite){
        // the server keeps running across the write, as it would in a session while the owner's worker updates the index
        const indexLines = warmIndex(repo);
        console.log("\nAfter a write (a warm npm run index bumped the index version):\n");
        for (const line of indexLines) console.log(line);
        console.log("");
        const written = await table(client);
        printTable(written.rows);
        console.log(`\nS5 after a write (every call ≤ ${S5_MS} ms, first calls included): ${written.worstAny <= S5_MS ? "PASS" : "FAIL"} (worst ${ms(written.worstAny)})`);
    }
    await client.close();
    process.exit(pass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
