/**
 * npm run eval:probe -- --config a-default,a-upfront [--repo ../vscode]
 * npm run eval:probe -- --eval eval2 --config a,n [--repo vscode]
 *
 * One-turn runs of `claude -p` ("Reply with the single word ready."), isolated as the eval's runs are (run-config.ts),
 * that report the first API call's context: the per-turn base every answer pays (V1.6 plan, D1 condition 5). It asks
 * nothing of the repo, so no answer is scored. Raw transcripts stay in .nebulosity/eval/probe/ (gitignored). Each run
 * is a real call on the owner's subscription: ask first, with the count.
 *
 * With --eval <dir>, the definition's pins apply, --repo names one of its repos by id, and the configurations are a (no MCP
 * server) and n (Nebulosity's registration, as the runner writes it), both at the default tool search. Without it, --repo
 * is a path and a-default and a-upfront are Eval #1's check.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { loadDefinition } from "./definition";
import crypto from "crypto";
import { PINS, childEnv, claudeArgs, scratchFolder } from "./run-config";
import { summarizeRun } from "./transcript";

const PROMPT = "Reply with the single word ready.";
const CONFIGS: Record<string, { toolSearch: boolean; arm?: "baseline" | "nebulosity" }> = {
    "a-default": { toolSearch: true }, "a-upfront": { toolSearch: false },
    a: { toolSearch: true, arm: "baseline" }, n: { toolSearch: true, arm: "nebulosity" },
};

const forward = (p: string): string => p.replace(/\\/g, "/");
const checkout = forward(path.resolve(__dirname, "..", ".."));
const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const names = (value("--config") ?? "").split(",").filter(Boolean);
const evalDir = value("--eval");
const definition = evalDir === undefined ? null : loadDefinition(path.resolve(checkout, evalDir));
const evalName = definition === null ? "eval" : path.basename(definition.dir);
const repoArg = value("--repo");
let repoPath = path.join(checkout, "..", "vscode");
if (definition !== null){
    const id = repoArg ?? Object.keys(definition.repos)[0];
    if (!(id in definition.repos)){
        console.error(`--repo ${id} is not a repo of ${evalName}/eval.json (${Object.keys(definition.repos).join(", ")}).`);
        process.exit(1);
    }
    repoPath = path.resolve(checkout, definition.repos[id].path);
} else if (repoArg !== undefined) repoPath = repoArg;
const repo = forward(path.resolve(repoPath));
const allowed = definition === null ? ["a-default", "a-upfront"] : ["a", "n"];
const unknown = names.filter((n) => !allowed.includes(n));
if (names.length === 0 || unknown.length > 0){
    console.error(`usage: npm run eval:probe -- [--eval <dir>] --config ${allowed.join(",")} [--repo ${definition === null ? "<path>" : "<repo id>"}]${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
    process.exit(1);
}
const claude = forward(process.env.CLAUDE_BIN ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
const gitBash = forward(process.env.GIT_BASH ?? path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe"));
const work = `${checkout}/.nebulosity/${evalName}`;
const dir = `${work}/probe`;
fs.mkdirSync(dir, { recursive: true });
const empty = `${checkout}/${evalName}/mcp/empty.json`;
// Nebulosity's registration exactly as the runner writes it (R4: no alwaysLoad)
const nebulosity = `${work}/mcp-nebulosity.json`;
fs.writeFileSync(nebulosity, `${JSON.stringify({ mcpServers: { nebulosity: { command: "node", args: [`${checkout}/mcp/launch.mjs`], env: { NEBULOSITY_LIVE: "off" } } } }, null, 2)}
`);
const pins = definition?.pins ?? PINS;
// the kind of scratch folder a scripts-allowed eval's runs get (opaque, under the system temp folder), so the tool list is the one a run sees
const scratch = definition?.scripts ? scratchFolder(fs.realpathSync.native(os.tmpdir()), crypto.randomBytes(8).toString("hex")) : undefined;
if (scratch !== undefined) fs.mkdirSync(scratch, { recursive: true });

for (const name of names){
    const env = childEnv(process.env, { gitBash, toolSearch: CONFIGS[name].toolSearch });
    const run = spawnSync(claude, claudeArgs(CONFIGS[name].arm ?? "baseline", { empty, nebulosity }, pins, { scratch }), { cwd: repo, env: env as NodeJS.ProcessEnv, input: PROMPT, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    const file = `${dir}/${name}.${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.jsonl`;
    fs.writeFileSync(file, run.stdout ?? "");
    const s = summarizeRun(run.stdout ?? "");
    console.log(`${name}: Claude Code ${s.claudeVersion}, ${s.tools.length} tools listed, first call ${s.firstCallContext?.toLocaleString("en-US") ?? "n/a"} tokens, $${s.costUsd.toFixed(3)} est. (${file})`);
}
