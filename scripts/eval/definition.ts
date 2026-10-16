/** An eval's fixed setup (V1.6's plan, D2): what every script of scripts/eval reads from <dir>/eval.json. */
import fs from "fs";
import path from "path";

/**
 * An eval's optional `shell` preset (eval.json; ADR-057, amended 2026-10-15): more Bash commands allowed, the same in
 * both arms. "compound" adds the read-only commands of Eval #2's refused compound commands that run-config.ts's read-only list lacks:
 * cd and echo. Left out: sed (-i and its w command write files), awk (writes files, runs commands), xargs (runs any
 * command), tee (writes), python3 (runs any code), and mkdir (it writes, and the after-run check can't see an empty
 * folder). Loops (for, while) are shell syntax, which no rule names. Unset, the arguments are Eval #2's.
 */
export const SHELL_PRESETS = { compound: ["Bash(cd:*)", "Bash(echo:*)"] } as const;
export type ShellPreset = keyof typeof SHELL_PRESETS;

export type ArmName = "baseline" | "nebulosity" | "nebulosity-upfront";
export type EvalDefinition = {
    name: string;
    /** The folder holding eval.json, questions, truths, runs and grading (eval for Eval #1, eval2 for Eval #2). */
    dir: string;
    claudeVersion: string;
    pins: { model: string; effort: string; maxTurns: number; maxBudgetUsd: number; sessionMaxBudgetUsd: number };
    /** Repo id → its checkout (relative to Nebulosity's), its commit and its owner/name. */
    repos: Record<string, {
        path: string; commit: string; slug: string;
        /** The tsconfig the call truth's program is built from (VS Code's src/tsconfig.json); absent, every .ts file with the truth's own resolver. */
        project?: string;
    }>;
    arms: ArmName[];
    repeats: number;
    /** Node scripts and edits allowed under a fresh scratch folder per run (R6). */
    scripts: boolean;
    /** More Bash commands allowed in both arms, by preset (run-config's SHELL_PRESETS; ADR-057, amended 2026-10-15). Absent in Eval #1 and Eval #2. */
    shell?: ShellPreset;
    /** The sentence that ends every prompt with scripts on: Eval #2's ("scripts", the default) or Eval #3's rules sentence (ADR-060). */
    sentence?: "scripts" | "rules";
    /** The ship gate this eval is judged by: absent, Eval #2's (the V1.6 plan's D1, gate.ts) for an eval with several repos or kinds; "eval3", ADR-060's. */
    gate?: "eval3";
    pilot: string[];
    /** The task sessions the pilot asks (`--sessions --pilot`, one repeat in each arm); absent in an eval with no sessions. */
    pilotSessions?: string[];
};

const ARMS: readonly ArmName[] = ["baseline", "nebulosity", "nebulosity-upfront"];

export function loadDefinition(dir: string): EvalDefinition {
    const file = path.join(dir, "eval.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<EvalDefinition>;
    const fail = (why: string): never => { throw new Error(`eval.json: ${why}`); };
    if (typeof raw.name !== "string" || typeof raw.claudeVersion !== "string") fail("name and claudeVersion are strings.");
    const pins = raw.pins;
    if (!pins || typeof pins.model !== "string" || typeof pins.effort !== "string" || !(pins.maxTurns! > 0) || !(pins.maxBudgetUsd! > 0) || !(pins.sessionMaxBudgetUsd! > 0)) fail("pins needs model, effort, maxTurns, maxBudgetUsd and sessionMaxBudgetUsd.");
    for (const arm of raw.arms ?? []) if (!ARMS.includes(arm)) fail(`arms may be "baseline", "nebulosity" and "nebulosity-upfront", not "${arm}".`);
    if (!Array.isArray(raw.arms) || raw.arms.length === 0) fail("arms lists at least one arm.");
    if (raw.repeats !== 1 && raw.repeats !== 2 && raw.repeats !== 3) fail("repeats is 1, 2 or 3.");
    if (!raw.repos || Object.keys(raw.repos).length === 0) fail("repos names at least one repo.");
    for (const [id, repo] of Object.entries(raw.repos!)){
        if (typeof repo.path !== "string" || typeof repo.slug !== "string") fail(`repo ${id} needs a path and a slug.`);
        if (!/^[0-9a-f]{40}$/.test(repo.commit ?? "")) fail(`repo ${id}'s commit must be a full 40-character sha.`);
        if (repo.project !== undefined && typeof repo.project !== "string") fail(`repo ${id}'s project, when given, is a tsconfig's path inside it.`);
    }
    if (typeof raw.scripts !== "boolean" || !Array.isArray(raw.pilot)) fail("scripts is true or false, and pilot lists question ids.");
    if (raw.pilotSessions !== undefined && (!Array.isArray(raw.pilotSessions) || raw.pilotSessions.some((id) => typeof id !== "string"))) fail("pilotSessions, when given, lists session ids.");
    if (raw.shell !== undefined && !Object.hasOwn(SHELL_PRESETS, raw.shell)) fail(`shell, when given, is one of ${Object.keys(SHELL_PRESETS).map((name) => `"${name}"`).join(", ")}.`);
    if (raw.sentence !== undefined && raw.sentence !== "scripts" && raw.sentence !== "rules") fail('sentence, when given, is "scripts" or "rules".');
    if (raw.gate !== undefined && raw.gate !== "eval3") fail('gate, when given, is "eval3".');
    return { ...(raw as EvalDefinition), dir: path.resolve(dir) };
}
