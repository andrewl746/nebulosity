/**
 * npm run eval:probe -- --config a-default,a-upfront [--repo ../vscode]
 *
 * One-turn runs of `claude -p` ("Reply with the single word ready."), isolated as the eval's runs are (run-config.ts),
 * that report the first API call's context: the per-turn base every answer pays (V1.6 plan, D1 condition 5). It asks
 * nothing of the repo, so no answer is scored. Raw transcripts stay in .nebulosity/eval/probe/ (gitignored). Each run
 * is a real call on the owner's subscription: ask first, with the count.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { childEnv, claudeArgs } from "./run-config";
import { summarizeRun } from "./transcript";

const PROMPT = "Reply with the single word ready.";
const CONFIGS: Record<string, { toolSearch: boolean }> = { "a-default": { toolSearch: true }, "a-upfront": { toolSearch: false } };

const forward = (p: string): string => p.replace(/\\/g, "/");
const checkout = forward(path.resolve(__dirname, "..", ".."));
const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const names = (value("--config") ?? "").split(",").filter(Boolean);
const repo = forward(path.resolve(value("--repo") ?? path.join(checkout, "..", "vscode")));
const unknown = names.filter((n) => !(n in CONFIGS));
if (names.length === 0 || unknown.length > 0){
    console.error(`usage: npm run eval:probe -- --config ${Object.keys(CONFIGS).join(",")} [--repo <path>]${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
    process.exit(1);
}
const claude = forward(process.env.CLAUDE_BIN ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
const gitBash = forward(process.env.GIT_BASH ?? path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe"));
const dir = `${checkout}/.nebulosity/eval/probe`;
fs.mkdirSync(dir, { recursive: true });
const empty = `${checkout}/eval/mcp/empty.json`;

for (const name of names){
    const env = childEnv(process.env, { gitBash, toolSearch: CONFIGS[name].toolSearch });
    const run = spawnSync(claude, claudeArgs("baseline", { empty, nebulosity: empty }), { cwd: repo, env: env as NodeJS.ProcessEnv, input: PROMPT, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    const file = `${dir}/${name}.${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.jsonl`;
    fs.writeFileSync(file, run.stdout ?? "");
    const s = summarizeRun(run.stdout ?? "");
    console.log(`${name}: Claude Code ${s.claudeVersion}, ${s.tools.length} tools listed, first call ${s.firstCallContext?.toLocaleString("en-US") ?? "n/a"} tokens, $${s.costUsd.toFixed(3)} est. (${file})`);
}
