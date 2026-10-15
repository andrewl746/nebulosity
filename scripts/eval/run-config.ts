/** How each eval run is started (D3 in docs/plans/2026-10-13-v1-5-ship.md), as pure functions so they're tested. */
import { slug, spellings } from "../../lib/demo/privacy";

export type Arm = "baseline" | "nebulosity";
export type Pins = { model: string; effort: string; maxTurns: number; maxBudgetUsd: number; sessionMaxBudgetUsd?: number };
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

/**
 * An eval's optional `shell` preset (eval.json; ADR-057, amended 2026-10-15): more Bash commands allowed, the same in
 * both arms. "compound" adds the read-only commands of Eval #2's refused compound commands that the list above lacks:
 * cd and echo. Left out: sed (-i and its w command write files), awk (writes files, runs commands), xargs (runs any
 * command), tee (writes), python3 (runs any code), and mkdir (it writes, and the after-run check can't see an empty
 * folder). Loops (for, while) are shell syntax, which no rule names. Unset, the arguments are Eval #2's.
 */
export const SHELL_PRESETS = { compound: ["Bash(cd:*)", "Bash(echo:*)"] } as const;
export type ShellPreset = keyof typeof SHELL_PRESETS;

/** What an eval turns on beyond the read-only list: scripts in a scratch folder (R6), and a shell preset. */
export type RunOptions = { scratch?: string; shell?: ShellPreset };

/** The claude -p arguments; the prompt goes on stdin. The two arms differ only in the MCP config file. */
export function claudeArgs(arm: Arm, mcp: { empty: string; nebulosity: string }, pins: Pins = PINS, options: RunOptions = {}): string[] {
    const scratch = options.scratch;
    // with scripts on, node and edits under the run's scratch folder are allowed, and Edit and Write leave the deny list (a deny would beat the path rule)
    const scripts = scratch === undefined ? ALLOWED_TOOLS : [...ALLOWED_TOOLS, "Bash(node:*)", `Edit(${scratchRule(scratch)})`];
    const allowed = options.shell === undefined ? scripts : [...scripts, ...SHELL_PRESETS[options.shell]];
    const denied = scratch === undefined ? DENIED_TOOLS : DENIED_TOOLS.filter((tool) => tool !== "Edit" && tool !== "Write");
    return [
        "-p", "--output-format", "stream-json", "--verbose",
        "--model", pins.model, "--effort", pins.effort,
        "--max-turns", String(pins.maxTurns), "--max-budget-usd", String(pins.maxBudgetUsd),
        "--setting-sources", "project,local",
        "--strict-mcp-config", "--mcp-config", arm === "nebulosity" ? mcp.nebulosity : mcp.empty,
        "--permission-mode", "dontAsk", "--permission-prompts", "none",
        "--allowedTools", allowed.join(","),
        "--disallowedTools", denied.join(","),
        ...(scratch === undefined ? [] : ["--add-dir", scratch]),
        "--no-session-persistence",
    ];
}

/**
 * A task session's arguments: claudeArgs, with one budget for the whole process (a session asks several questions, so
 * pins.sessionMaxBudgetUsd replaces the single run's), and stream-json input so each question is a message written to
 * stdin after the last answer. --replay-user-messages echoes each message into the transcript (the probe run used it).
 */
export function sessionArgs(arm: Arm, mcp: { empty: string; nebulosity: string }, pins: Pins = PINS, options: RunOptions = {}): string[] {
    const budget = pins.sessionMaxBudgetUsd ?? pins.maxBudgetUsd;
    return [...claudeArgs(arm, mcp, { ...pins, maxBudgetUsd: budget }, options), "--input-format", "stream-json", "--replay-user-messages"];
}

/** A permission rule's absolute path(code.claude.com permissions: "//" then the path, a Windows drive as /c): everything under the folder. */
export function scratchRule(absPath: string): string {
    const slashed = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const drive = /^([A-Za-z]):\/(.*)$/.exec(slashed);
    return drive ? `//${drive[1].toLowerCase()}/${drive[2]}/**` : `/${slashed}/**`;
}

/** A run's writable folder (R6, as the controller fixed it): opaque, arm-free, outside the checkout and every repo. Forward slashes, as claude and its permission rule are given it. */
export function scratchFolder(tmp: string, hex: string): string {
    return `${tmp.replace(/\\/g, "/").replace(/\/+$/, "")}/eval-scratch/${hex}`;
}

/**
 * A question's format line: its family's, with `<file>` replaced by the question's file in backticks (Eval #2's cycle
 * line names the file the cycle starts and ends with). Throws a sentence when the family has no line, or the line names
 * `<file>` and the question names none.
 */
export function formatLine(question: { family: string; file?: string }, formats: Record<string, string>): string {
    const line = formats[question.family];
    if (typeof line !== "string") throw new Error(`"formats" has no line for its family ${question.family}`);
    if (!line.includes("<file>")) return line;
    if (question.file === undefined) throw new Error(`its format line (${question.family}) names <file>, and the question names no file`);
    return line.split("<file>").join(`\`${question.file}\``);
}

/**
 * The text a run sends: the question, its family's format line, and with scripts on the scratch sentence, the same in
 * both arms. Its wording is the owner's (2026-10-14, "Name the way that works", replacing R6's): it names the way that
 * works under the permission rules, Write into the scratch folder then node, or node -e, because in the dev set (Task 13)
 * every script tried as a Bash heredoc was refused and no run wrote one with Write.
 */
export function promptFor(question: { prompt: string; family: string; file?: string }, formats: Record<string, string>, scratch?: string, rules?: { repoRoot: string }): string {
    const base = `${question.prompt}\n\n${formatLine(question, formats)}`;
    if (scratch === undefined) return base;
    const sentence = rules === undefined
        ? `You may write Node.js scripts in ${scratch} with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.`
        : rulesSentence(rules.repoRoot, scratch);
    return `${base}\n\n${sentence}`;
}

/** Eval #3's rules sentence (D2 of V1.7's plan, R-L), the same in both arms: the repo root and the scratch folder, forward-slashed. */
export function rulesSentence(repoRoot: string, scratch: string): string {
    return `You're at the repository root, ${repoRoot}: run grep, git grep, git ls-files, ls, cat, head and the like from here, without cd. To compute anything, write a Node.js script into ${scratch} with the Write tool (the folder exists) and run it with node, or use node -e. Shell writes (redirects, heredocs, tee, sed -i, mkdir), loops, sed, awk, xargs and paths through .. are refused here. Don't change any file in the repository.`;
}

/** Names that would bill an API key instead of the subscription, or override a pin. Windows ignores their case. */
const STRIPPED = new Set([
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY", "ENABLE_TOOL_SEARCH", "CLAUDE_CONFIG_DIR",
]);
/**
 * The runner is likely started from a Claude Code session, whose own variables (CLAUDECODE, the entrypoint, a messaging
 * socket and its token, the user's email, a base URL, MCP settings, ...) would reach every child. They go with the
 * names above: any name starting with one of these, in any case.
 */
const STRIPPED_PREFIXES = ["CLAUDE", "ANTHROPIC_", "MCP_", "CLAUDE_AGENT_SDK_"];

/** Whether childEnv leaves a name out of the child's environment (the pins are set after, so they survive). */
export function isStripped(name: string): boolean {
    const upper = name.toUpperCase();
    return STRIPPED.has(upper) || STRIPPED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

// a plain record, not NodeJS.ProcessEnv: Next's types make NODE_ENV a required ProcessEnv key (V1.4's stdio test met this)
export function childEnv(base: Readonly<Record<string, string | undefined>>, options: { gitBash: string; toolSearch: boolean; configDir?: string }): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(base)) if (value !== undefined && !isStripped(key)) env[key] = value;
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

/** D2's order of the fifteen questions: the place a question has here decides which arm goes first, whichever of them a run asks for. */
export const QUESTION_ORDER = [
    "bp1", "bp2", "bp3", "bp4", "bp5", "cl1", "cl2", "cl3", "cl4", "cl5", "cn1", "cn2", "cn3", "cn4", "cn5",
];

/**
 * Per repeat, question by question, three runs: A and B (B at Claude Code's default tool search), then B with every
 * tool loaded up front (`toolSearch: false`, named `...-nebulosity-upfront-n`). Which of A and B goes first alternates by
 * question and by repeat, so neither always meets a warmer cache or a later hour; the up-front run always follows the
 * pair (its tool list differs, so it shares no cache with them, and the three runs of a question fall within minutes).
 * "By question" is the question's place in `order` (the whole list, which is `questions` itself unless only some of
 * them are asked), so the pilot and --only give a question the arm order the full run will give it.
 */
export function schedule(questions: readonly string[], repeats: number, order: readonly string[] = questions, options: { upfront: boolean } = { upfront: true }): RunId[] {
    const runs: RunId[] = [];
    for (let repeat = 1; repeat <= repeats; repeat++){
        for (const question of questions){
            const place = order.indexOf(question);
            if (place < 0) throw new Error(`question ${question} is not in the order (${order.join(", ")})`);
            const arms: Arm[] = (place + repeat - 1) % 2 === 0 ? ["baseline", "nebulosity"] : ["nebulosity", "baseline"];
            for (const arm of arms) runs.push({ question, arm, repeat, toolSearch: true });
            if (options.upfront) runs.push({ question, arm: "nebulosity", repeat, toolSearch: false });
        }
    }
    return runs;
}

/**
 * The questions a single-run schedule asks, in the file's order: the ones `ids` names (null: every one), leaving out the
 * task sessions' questions (marked `"session"`), which are asked only inside their sessions (Task 14). Throws a sentence
 * for an id that isn't a question, or one that belongs to a session.
 */
export function singleQuestionIds(questions: readonly { id: string; session?: string }[], ids: readonly string[] | null): string[] {
    const singles = questions.filter((q) => q.session === undefined);
    const unknown = (ids ?? []).filter((id) => !questions.some((q) => q.id === id));
    if (unknown.length > 0) throw new Error(`no such question: ${unknown.join(", ")}. The questions are ${singles.map((q) => q.id).join(", ")}`);
    const inSessions = questions.filter((q) => q.session !== undefined && (ids ?? []).includes(q.id));
    if (inSessions.length > 0){
        throw new Error(inSessions.map((q) => `${q.id} is a question of task session ${q.session}, asked only inside it (run it with --sessions --only ${q.session})`).join("; "));
    }
    return singles.filter((q) => ids === null || ids.includes(q.id)).map((q) => q.id);
}

/**
 * The dev set's runs (Task 13, R1): each question once (repeat 1, Claude Code's default tool search), in the arms asked.
 * With both arms, which goes first is schedule's, from the question's place in `order`.
 */
export function devSchedule(questions: readonly string[], order: readonly string[], arms: readonly Arm[]): RunId[] {
    return schedule(questions, 1, order, { upfront: false }).filter((run) => arms.includes(run.arm));
}

const ARMS: readonly Arm[] = ["baseline", "nebulosity"];

/** --arms: a comma list of the eval's arm names, each kept once in the order given. Throws a sentence otherwise. */
export function parseArms(value: string): Arm[] {
    const names = value.split(",").map((name) => name.trim()).filter(Boolean);
    if (names.length === 0) throw new Error("--arms needs at least one arm (baseline, nebulosity)");
    const unknown = names.filter((name) => !(ARMS as readonly string[]).includes(name));
    if (unknown.length > 0) throw new Error(`--arms takes baseline and nebulosity, not ${unknown.join(", ")}`);
    return [...new Set(names)] as Arm[];
}

/**
 * The questions on the wrong side of R1: in a dev run, the ones not marked `"dev": true` (a real question would be tuned
 * on); in a real run, the ones marked (a dev question would be scored). Their ids, in the file's order.
 */
export function devMismatch(questions: readonly { id: string; dev?: boolean }[], dev: boolean): string[] {
    return questions.filter((q) => (q.dev === true) !== dev).map((q) => q.id);
}

export type UtilizationCheck = { unwatched: number; warning: string | null; stop: string | null; giveUp: string | null };

/**
 * What a run's 5-hour and 7-day figures (from its rate_limit_event) mean for the batch. A window at or past its
 * threshold stops the batch cleanly (the 7-day one first). A run that reports neither window leaves the thresholds
 * unwatched: that is warned about, and two such runs in a row make the runner give up, since it can't protect the
 * subscription blind. `unwatchedBefore` is how many runs in a row were blind until now; `unwatched` is the count after.
 */
export function utilizationCheck(
    now: { fiveHour: number | null; sevenDay: number | null },
    limits: { fiveHour: number; sevenDay: number },
    unwatchedBefore: number,
): UtilizationCheck {
    if (now.fiveHour === null && now.sevenDay === null){
        const unwatched = unwatchedBefore + 1;
        return {
            unwatched, stop: null,
            warning: "WARNING: this run reported neither the 5-hour nor the 7-day window, so the thresholds are not being watched.",
            giveUp: unwatched >= 2 ? "two runs in a row reported neither the 5-hour nor the 7-day window, so the thresholds can't be enforced" : null,
        };
    }
    const stop = now.sevenDay !== null && now.sevenDay >= limits.sevenDay ? `the 7-day window is at ${now.sevenDay.toFixed(2)} (threshold ${limits.sevenDay})`
        : now.fiveHour !== null && now.fiveHour >= limits.fiveHour ? `the 5-hour window is at ${now.fiveHour.toFixed(2)} (threshold ${limits.fiveHour})` : null;
    return { unwatched: 0, warning: null, stop, giveUp: null };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A raw transcript's file name:the run, when the attempt started (UTC), and the kind. A re-run after an outage keeps the earlier evidence. */
export const rawFileName = (name: string, startedAt: Date, extension: "jsonl" | "stderr.txt"): string =>
    `${name}.${startedAt.toISOString().replace(/[-:]/g, "").slice(0, 15)}.${extension}`;

/** How many raw transcripts a run already has among a folder's files: its earlier attempts. Another run whose name starts the same is not counted. */
export function attemptsSoFar(name: string, files: readonly string[]): number {
    const own = new RegExp(`^${escapeRegExp(name)}\\.\\d{8}T\\d{6}\\.jsonl$`);
    return files.filter((file) => own.test(file)).length;
}

/** The paths `git status --porcelain` names: anything there means a run changed the repo. */
export const parsePorcelain = (stdout: string): string[] => stdout.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => line.slice(3));

/**
 * The git arguments for the checkout's status snapshot, read before the batch and after each run. Every untracked file
 * gets its own line (-uall): plain --porcelain collapses an untracked folder to one line, so a file a run added inside a
 * folder that was already untracked would leave the snapshot as it was. It takes no lock, so it never writes there.
 */
export const statusArgs = (root: string): string[] => ["--no-optional-locks", "-C", root, "status", "--porcelain", "-uall"];

/** How the checkout's status lines changed since the snapshot: "+ <line>" for each new one, then "- <line>" for each gone. */
export function statusDifference(before: readonly string[], now: readonly string[]): string[] {
    const [was, is] = [new Set(before), new Set(now)];
    return [...now.filter((l) => !was.has(l)).map((l) => `+ ${l}`), ...before.filter((l) => !is.has(l)).map((l) => `- ${l}`)];
}

/** Why --repeat asks for more than the definition's repeats (Eval #1 ran 2), as a sentence, or null when it doesn't. */
export function repeatProblem(repeat: number | null, definitionRepeats: number, evalName: string): string | null {
    if (repeat === null || repeat <= definitionRepeats) return null;
    return `--repeat ${repeat} asks for more repeats than ${evalName}/eval.json has: its repeats is ${definitionRepeats}, so --repeat takes 1 to ${definitionRepeats}.`;
}

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
 * and would stop the batch. Last, each folder's slug (Claude Code's name for a project's folder, C--Users-Ann-code), the
 * deepest first, because findLeak looks for it too. The replacement is a function so a "$" in it is text.
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
    for (const r of ordered) out = out.replace(new RegExp(escapeRegExp(slug(r.folder)), "gi"), () => r.with);
    return out;
}
