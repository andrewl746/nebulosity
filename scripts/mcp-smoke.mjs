#!/usr/bin/env node
// A smoke test of the MCP server as Claude Code starts it (ADR-048, ADR-058): `node <launcher>` in the repo's folder.
// CI runs it on all three systems, and it's run by hand after packing:
//   node scripts/mcp-smoke.mjs --launcher <package>/mcp/launch.mjs --repo <an indexed repo> [--files <n>]
// It lists the tools (the six names, the five that answer questions marked always loaded through _meta, show_on_map
// deferred with a search hint), calls overview, and checks the answer names the repo and its file count (exactly <n>
// with --files). It prints "mcp-smoke: ok (6 tools, overview answered)" and exits 0, or prints what differed and exits 1.
// Plain JavaScript, so it needs nothing but node and the MCP SDK.
import path from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TOOLS = ["overview", "describe", "search", "imports", "architecture", "show_on_map"];
const ALWAYS_LOADED = ["overview", "describe", "search", "imports", "architecture"];
const TIMEOUT_MS = 120_000;   // a first start compiles the engine through tsx with a cold cache

const { values } = parseArgs({ options: { launcher: { type: "string" }, repo: { type: "string" }, files: { type: "string" } } });
if (!values.launcher || !values.repo || (values.files !== undefined && !/^\d+$/.test(values.files))){
    console.error("usage: node scripts/mcp-smoke.mjs --launcher <package>/mcp/launch.mjs --repo <an indexed repo> [--files <n>]");
    process.exit(1);
}
const launcher = path.resolve(values.launcher);
const repo = path.resolve(values.repo);

// The SDK passes a child only a short default list of variables plus `env`, so the whole environment goes in `env`:
// without it NEBULOSITY_DATA wouldn't reach the server, and an installed copy would read the user's real data folder.
// Live events are off, so a smoke run never lights up a Map; the project folder is the repo, as Claude Code sets it.
const env = {};
for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
env.NEBULOSITY_LIVE = "off";
env.CLAUDE_PROJECT_DIR = repo;

const problems = [];
let serverLog = "";
const transport = new StdioClientTransport({ command: process.execPath, args: [launcher], cwd: repo, env, stderr: "pipe" });
transport.stderr?.on("data", (chunk) => { serverLog += String(chunk); });
const client = new Client({ name: "mcp-smoke", version: "1" });

const timer = setTimeout(() => {
    console.error(`mcp-smoke: no answer within ${TIMEOUT_MS / 1000} s`);
    if (serverLog) console.error(serverLog);
    process.exit(1);
}, TIMEOUT_MS);

try{
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    if (JSON.stringify(names) !== JSON.stringify(TOOLS)) problems.push(`tools: expected ${TOOLS.join(", ")}; got ${names.join(", ")}`);
    for (const tool of tools){
        const always = tool._meta?.["anthropic/alwaysLoad"] === true;
        if (ALWAYS_LOADED.includes(tool.name) && !always) problems.push(`${tool.name}: not marked always loaded (_meta "anthropic/alwaysLoad")`);
        if (!ALWAYS_LOADED.includes(tool.name) && always) problems.push(`${tool.name}: marked always loaded, but it should stay deferred`);
        if (tool.name === "show_on_map" && typeof tool._meta?.["anthropic/searchHint"] !== "string") problems.push("show_on_map: no search hint (_meta \"anthropic/searchHint\")");
    }

    const answer = await client.callTool({ name: "overview", arguments: {} });
    const text = answer.content?.[0]?.type === "text" ? answer.content[0].text : "";
    const first = text.split("\n")[0];
    const counted = new RegExp(`^${path.basename(repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ([\\d,]+) files?\\b`).exec(first);
    if (answer.isError) problems.push(`overview answered with an error: ${first}`);
    else if (!counted) problems.push(`overview's first line doesn't name ${path.basename(repo)} and its file count: ${first}`);
    else if (values.files !== undefined && counted[1].replace(/,/g, "") !== values.files) problems.push(`overview counts ${counted[1]} files; expected ${values.files}`);
} catch (err){
    problems.push(`the server failed: ${err instanceof Error ? err.message : String(err)}`);
}

clearTimeout(timer);
await client.close().catch(() => {});
if (problems.length > 0){
    for (const problem of problems) console.error(`mcp-smoke: ${problem}`);
    if (serverLog) console.error(`the server's stderr:\n${serverLog}`);
    process.exit(1);
}
console.log(`mcp-smoke: ok (${TOOLS.length} tools, overview answered)`);
process.exit(0);
