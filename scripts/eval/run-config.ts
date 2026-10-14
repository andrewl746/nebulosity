/** How each eval run is started (D3 in docs/plans/2026-10-13-v1-5-ship.md), as pure functions so they're tested. */
import { spellings } from "../../lib/demo/privacy";

export type Arm = "baseline" | "nebulosity";
export type Pins = { model: string; effort: string; maxTurns: number; maxBudgetUsd: number };
export const PINS: Pins = { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 80, maxBudgetUsd: 4 };

/** Read-only built-in tools and the Agent tool (subagents); Nebulosity's tools exist only where its server runs. */
export const ALLOWED_TOOLS = [
    "Read", "Grep", "Glob", "Agent",
    "Bash(git grep:*)", "Bash(git ls-files:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(rg:*)", "Bash(grep:*)",
    "Bash(ls:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(sort:*)", "Bash(uniq:*)", "Bash(find:*)",
    "mcp__nebulosity",
];
/** Nothing may change the repo, read the web (the rubric's source is a web page), load a skill, or use another shell. */
export const DENIED_TOOLS = ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Skill", "PowerShell", "Monitor"];

/** The claude -p arguments; the prompt goes on stdin. The two arms differ only in the MCP config file. */
export function claudeArgs(arm: Arm, mcp: { empty: string; nebulosity: string }, pins: Pins = PINS): string[] {
    return [
        "-p", "--output-format", "stream-json", "--verbose",
        "--model", pins.model, "--effort", pins.effort,
        "--max-turns", String(pins.maxTurns), "--max-budget-usd", String(pins.maxBudgetUsd),
        "--setting-sources", "project,local",
        "--strict-mcp-config", "--mcp-config", arm === "nebulosity" ? mcp.nebulosity : mcp.empty,
        "--permission-mode", "dontAsk", "--permission-prompts", "none",
        "--allowedTools", ALLOWED_TOOLS.join(","),
        "--disallowedTools", DENIED_TOOLS.join(","),
        "--no-session-persistence",
    ];
}

/** Names that would bill an API key instead of the subscription, or override a pin. Windows ignores their case. */
const STRIPPED = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "ENABLE_TOOL_SEARCH", "CLAUDE_CONFIG_DIR"]);

// a plain record, not NodeJS.ProcessEnv: Next's types make NODE_ENV a required ProcessEnv key (V1.4's stdio test met this)
export function childEnv(base: Readonly<Record<string, string | undefined>>, options: { gitBash: string; toolSearch: boolean; configDir?: string }): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(base)) if (value !== undefined && !STRIPPED.has(key.toUpperCase())) env[key] = value;
    Object.assign(env, {
        CLAUDE_CODE_GIT_BASH_PATH: options.gitBash,
        CLAUDE_CODE_USE_POWERSHELL_TOOL: "0",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
        DISABLE_AUTOUPDATER: "1",
        NEBULOSITY_LIVE: "off",
    });
    if (!options.toolSearch) env.ENABLE_TOOL_SEARCH = "false";
    if (options.configDir) env.CLAUDE_CONFIG_DIR = options.configDir;
    return env;
}

export type RunId = { question: string; arm: Arm; repeat: number; toolSearch: boolean };
export const runName = (r: RunId): string => `${r.question}-${r.arm}${r.toolSearch ? "" : "-upfront"}-${r.repeat}`;

/** Per repeat, question by question, both arms; which arm goes first alternates by question and by repeat, so neither always meets a warmer cache or a later hour. */
export function schedule(questions: readonly string[], repeats: number): RunId[] {
    const runs: RunId[] = [];
    for (let repeat = 1; repeat <= repeats; repeat++){
        questions.forEach((question, i) => {
            const arms: Arm[] = (i + repeat - 1) % 2 === 0 ? ["baseline", "nebulosity"] : ["nebulosity", "baseline"];
            for (const arm of arms) runs.push({ question, arm, repeat, toolSearch: true });
        });
    }
    return runs;
}

/** The paths `git status --porcelain` names: anything there means a run changed the repo. */
export const parsePorcelain = (stdout: string): string[] => stdout.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => line.slice(3));

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One or more separators written any way: "/", "\" (as many as escaping stacked up), or %2f and %5c. */
const SEPARATORS = String.raw`(?:[\\/]|%5c|%2f)+`;

/**
 * The folder as a pattern that doesn't care how its separators or its drive colon were written: a path escaped twice
 * has four backslashes where one stood, a path can mix "\" and "/" (C:\Users/Ann), and a file URL encodes the colon
 * alone (c%3A/Users/Ann). A drive is "c:", "c%3a" or Git Bash's "/c". The match stops at the last name, so the
 * separators after the folder stay, and a JSON string stays valid.
 */
function loosePattern(folder: string): RegExp {
    const [first, ...rest] = folder.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
    const names = rest.map(escapeRegExp).join(SEPARATORS);
    const drive = /^([a-zA-Z]):$/.exec(first);
    if (drive) return new RegExp(`(?:${drive[1]}(?::|%3a)|/${drive[1]})${SEPARATORS}${names}`, "gi");
    // a path from the root ("/home/ann") starts with a separator; a relative one with its first name
    return new RegExp(`${first === "" ? SEPARATORS : escapeRegExp(first) + SEPARATORS}${names}`, "gi");
}

/**
 * Every spelling (lib/demo/privacy.ts) of each folder replaced, deepest folder first, so a transcript can be published
 * (D7). A second pass per folder catches what the spellings can't list (loosePattern), because findLeak catches it too
 * and would stop the batch. The replacement is a function so a "$" in it is text.
 */
export function scrub(text: string, replacements: readonly { folder: string; with: string }[]): string {
    const ordered = [...replacements].sort((a, b) => b.folder.length - a.folder.length);
    let out = text;
    for (const r of ordered){
        const instead = (): string => r.with;
        for (const spelling of spellings(r.folder).sort((a, b) => b.length - a.length)){
            out = out.replace(new RegExp(escapeRegExp(spelling), "gi"), instead);
        }
        out = out.replace(loosePattern(r.folder), instead);
    }
    return out;
}
