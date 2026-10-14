/**
 * npm run eval:run -- [--pilot | --only bp1,cl2,...] [--repeat 1|2] [--limit n]
 *                     [--stop-at-seven-day 0.85] [--stop-at-five-hour 0.9] [--config-dir dir] [--dry-run]
 *
 * The eval's runner (D3, D4 in docs/plans/2026-10-13-v1-5-ship.md). It starts `claude -p` headless on each question in
 * both arms (A: no MCP server; B: Nebulosity's), checks every run's init message against the agreed setup instead of
 * trusting it, scrubs the machine's paths out of the transcript, and keeps it in eval/runs. It can be run again: a run
 * whose eval/runs/<name>.jsonl.gz exists is skipped. A run uses the owner's subscription, so nothing here starts without
 * the owner's go-ahead. --dry-run reads, checks and prints, and spawns nothing: not even `claude --version`.
 *
 * It stops the batch, leaving the raw transcript in .nebulosity/eval/raw/ and keeping nothing in eval/runs, with
 *   exit 1: a check before the first run failed, or the arguments were wrong
 *   exit 2: a run's init message differs from the agreed setup
 *   exit 3: `git status` in ../vscode names a change (never restored automatically: the owner decides)
 *   exit 4: the scrubbed transcript still holds a path of this machine, or the owner's email
 *   exit 5: an outage, not an answer: an API error such as a rate limit, no result line, a run killed after 30 minutes
 * and stops cleanly (exit 0) when a run reports the 5-hour or 7-day window past its threshold.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { findLeak, leakNeedles } from "../../lib/demo/privacy";
import { PINS, childEnv, claudeArgs, parsePorcelain, runName, schedule, scrub, type RunId } from "./run-config";
import { summarizeRun, type RunSummary } from "./transcript";
import { infrastructureFailure, resultNotes, validateInit } from "./validate";

const VSCODE_COMMIT = "cc3fec88";
const CLAUDE_VERSION = "2.1.296";
const PILOT = ["bp4", "cl2", "cn3"];
const TIMEOUT_MS = 30 * 60 * 1000;
/** Claude Code's Explore subagent runs on Haiku, so Haiku answering is expected; any other model is noted. */
const ALLOWED_MODELS = [PINS.model, "claude-haiku-5-5"];
const PLACEHOLDER_PROMPT = "<placeholder: eval/questions.json comes in Task 17>";

const forward = (p: string): string => p.replace(/\\/g, "/");
const CHECKOUT = forward(path.resolve(__dirname, "..", ".."));
const VSCODE = forward(path.resolve(CHECKOUT, "..", "vscode"));
const QUESTIONS_FILE = `${CHECKOUT}/eval/questions.json`;
const EMPTY_MCP = `${CHECKOUT}/eval/mcp/empty.json`;
const RUNS_DIR = `${CHECKOUT}/eval/runs`;
const WORK_DIR = `${CHECKOUT}/.nebulosity/eval`;
const RAW_DIR = `${WORK_DIR}/raw`;
const NEBULOSITY_MCP = `${WORK_DIR}/mcp-nebulosity.json`;

/** A reason to stop, said in a sentence, with the exit code from the header. */
class Stop extends Error {
    constructor(readonly code: number, message: string){
        super(message);
    }
}

type Options = {
    pilot: boolean; only: string[] | null; repeat: number | null; limit: number;
    sevenDay: number; fiveHour: number; configDir: string | null; dryRun: boolean;
};

const USAGE = "usage: npm run eval:run -- [--pilot | --only <ids>] [--repeat 1|2] [--limit <n>] [--stop-at-seven-day <0-1>] [--stop-at-five-hour <0-1>] [--config-dir <dir>] [--dry-run]";

function parseArgs(argv: string[]): Options {
    const options: Options = { pilot: false, only: null, repeat: null, limit: Infinity, sevenDay: 0.85, fiveHour: 0.9, configDir: null, dryRun: false };
    for (let i = 0; i < argv.length; i++){
        const arg = argv[i];
        const value = (): string => {
            const v = argv[++i];
            if (v === undefined || v.startsWith("--")) throw new Stop(1, `${arg} needs a value. ${USAGE}`);
            return v;
        };
        const fraction = (): number => {
            const x = Number(value());
            if (!(x > 0 && x <= 1)) throw new Stop(1, `${arg} takes a number above 0 and up to 1 (the share of the window used). ${USAGE}`);
            return x;
        };
        if (arg === "--pilot") options.pilot = true;
        else if (arg === "--dry-run") options.dryRun = true;
        else if (arg === "--only"){
            options.only = value().split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
            if (options.only.length === 0) throw new Stop(1, `--only needs at least one question id. ${USAGE}`);
        }
        else if (arg === "--repeat"){
            const n = Number(value());
            if (n !== 1 && n !== 2) throw new Stop(1, `--repeat takes 1 or 2. ${USAGE}`);
            options.repeat = n;
        } else if (arg === "--limit"){
            const n = Number(value());
            if (!Number.isInteger(n) || n < 1) throw new Stop(1, `--limit takes a whole number of runs, 1 or more. ${USAGE}`);
            options.limit = n;
        } else if (arg === "--stop-at-seven-day") options.sevenDay = fraction();
        else if (arg === "--stop-at-five-hour") options.fiveHour = fraction();
        else if (arg === "--config-dir") options.configDir = forward(path.resolve(value()));
        else throw new Stop(1, `unknown argument ${arg}. ${USAGE}`);
    }
    if (options.pilot && options.only) throw new Stop(1, `--pilot already names its questions (${PILOT.join(", ")}), so it can't be combined with --only.`);
    if (options.pilot && options.repeat !== null) throw new Stop(1, "--pilot is one run of each pilot question, so it can't be combined with --repeat.");
    return options;
}

type Question = { id: string; family: string; prompt: string };
type QuestionFile = { formats: Record<string, string>; questions: Question[] };

/** What a dry run asks until Task 17 writes eval/questions.json: the three pilot ids, with no real prompt. */
const PLACEHOLDER: QuestionFile = {
    formats: { bigPicture: "<placeholder: the big-picture format line>", list: "<placeholder: the list format line>", chain: "<placeholder: the chain format line>" },
    questions: [
        { id: "bp4", family: "bigPicture", prompt: PLACEHOLDER_PROMPT },
        { id: "cl2", family: "list", prompt: PLACEHOLDER_PROMPT },
        { id: "cn3", family: "chain", prompt: PLACEHOLDER_PROMPT },
    ],
};

function loadQuestions(dryRun: boolean): { file: QuestionFile; placeholder: boolean } {
    if (!fs.existsSync(QUESTIONS_FILE)){
        if (dryRun) return { file: PLACEHOLDER, placeholder: true };
        throw new Stop(1, "eval/questions.json doesn't exist yet (Task 17 writes it), so there is nothing to ask. Nothing was run.");
    }
    let parsed: Partial<QuestionFile> | null;
    try{
        parsed = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf8")) as Partial<QuestionFile> | null;
    } catch(e){
        throw new Stop(1, `eval/questions.json isn't valid JSON: ${(e as Error).message}`);
    }
    if (!parsed || typeof parsed.formats !== "object" || parsed.formats === null || !Array.isArray(parsed.questions)){
        throw new Stop(1, 'eval/questions.json needs a "formats" object and a "questions" list.');
    }
    for (const q of parsed.questions){
        if (typeof q?.id !== "string" || typeof q.prompt !== "string" || typeof q.family !== "string" || typeof parsed.formats[q.family] !== "string"){
            throw new Stop(1, `eval/questions.json: question ${JSON.stringify(q?.id)} needs an id, a prompt, and a family that has a line in "formats".`);
        }
    }
    return { file: parsed as QuestionFile, placeholder: false };
}

function git(args: string[]): string {
    try{
        return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch(e){
        throw new Stop(1, `git ${args.join(" ")} failed: ${(e as Error).message.split("\n")[0]}`);
    }
}

/** Paths `git status` names in ../vscode: anything there means a run changed the repo. It takes no lock, so it never writes there. */
const vscodeChanges = (): string[] => parsePorcelain(git(["--no-optional-locks", "-C", VSCODE, "status", "--porcelain"]));

/** The keys of ~/.claude/settings.json's enabledPlugins ("superpowers@claude-plugins-official"): the owner's plugins, which no run may load. */
function ownerPluginKeys(): string[] {
    const file = path.join(os.homedir(), ".claude", "settings.json");
    if (!fs.existsSync(file)) return [];
    try{
        const settings = JSON.parse(fs.readFileSync(file, "utf8")) as { enabledPlugins?: Record<string, unknown> };
        return Object.keys(settings.enabledPlugins ?? {});
    } catch(e){
        throw new Stop(1, `~/.claude/settings.json couldn't be read, so the owner's plugins can't be listed: ${(e as Error).message}`);
    }
}

const quote = (arg: string): string => (/^[\w@%+=:,./\\-]*$/.test(arg) ? arg : JSON.stringify(arg));

let running: ChildProcess | null = null;

/** claude.exe starts children of its own (shells, MCP servers), so on Windows the whole tree goes. */
function killTree(pid: number | undefined): void {
    if (pid === undefined) return;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
}

/** Starts claude with the prompt on stdin, its stdout and stderr going straight into files. Resolves when it has ended. */
async function runClaude(claude: string, args: string[], env: Record<string, string>, prompt: string, rawFile: string, errFile: string): Promise<{ timedOut: boolean }> {
    const out = fs.openSync(rawFile, "w");
    const err = fs.openSync(errFile, "w");
    let timer: NodeJS.Timeout | undefined;
    try{
        let timedOut = false;
        // childEnv's plain record, cast: Next's types make NODE_ENV a required ProcessEnv key (as in run-config.ts)
        const child = spawn(claude, args, { cwd: VSCODE, env: env as NodeJS.ProcessEnv, stdio: ["pipe", out, err], windowsHide: true });
        running = child;
        if (!child.stdin){   // "pipe" always gives one
            killTree(child.pid);
            throw new Error("claude was started without a stdin pipe");
        }
        child.stdin.on("error", () => {});   // claude may end before reading all of the prompt
        child.stdin.end(prompt);
        timer = setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
        }, TIMEOUT_MS);
        await new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", () => resolve());
        });
        return { timedOut };
    } finally{
        if (timer) clearTimeout(timer);
        running = null;
        fs.closeSync(out);
        fs.closeSync(err);
    }
}

type Context = {
    options: Options; questions: QuestionFile; claude: string; gitBash: string; forbiddenPlugins: string[];
    mcp: { empty: string; nebulosity: string }; replacements: { folder: string; with: string }[]; needles: string[];
};

const fixed = (x: number | null): string => (x === null ? "n/a" : x.toFixed(2));

/** One run, start to finish: the claude process, the checks that can stop the batch, then scrubbed and kept. */
async function runOne(run: RunId, ctx: Context): Promise<RunSummary> {
    const name = runName(run);
    const question = ctx.questions.questions.find((q) => q.id === run.question)!;
    const prompt = `${question.prompt}\n\n${ctx.questions.formats[question.family]}`;
    const rawFile = `${RAW_DIR}/${name}.jsonl`;
    const errFile = `${RAW_DIR}/${name}.stderr.txt`;

    const env = childEnv(process.env, { gitBash: ctx.gitBash, toolSearch: run.toolSearch, configDir: ctx.options.configDir ?? undefined });
    const startedAt = new Date();
    const { timedOut } = await runClaude(ctx.claude, claudeArgs(run.arm, ctx.mcp), env, prompt, rawFile, errFile);
    const endedAt = new Date();
    const raw = fs.readFileSync(rawFile, "utf8");
    const summary = summarizeRun(raw);
    const outage = timedOut ? "the run was killed after 30 minutes" : infrastructureFailure(raw);

    // 1. the init message against the agreed setup. A run that never started has no init to check: it is the outage below.
    const neverStarted = outage !== null && summary.model === null;
    const problems = neverStarted ? [] : validateInit(summary, { arm: run.arm, model: PINS.model, forbiddenPlugins: ctx.forbiddenPlugins });
    if (problems.length > 0) throw new Stop(2, `${name}: the run differs from the agreed setup:\n  - ${problems.join("\n  - ")}\nThe raw transcript is ${rawFile}. Nothing was kept.`);

    // 2. the repo, which no run may change. Never restored automatically.
    const changed = vscodeChanges();
    if (changed.length > 0) throw new Stop(3, `${name}: git status in ${VSCODE} names changes:\n  ${changed.join("\n  ")}\nNothing was restored. Ask the owner. The raw transcript is ${rawFile}.`);

    // 3. an outage is re-run later (it counts toward the 6 re-runs), not scored.
    if (outage !== null){
        const stderr = fs.readFileSync(errFile, "utf8").trim().slice(0, 400);
        throw new Stop(5, `${name}: ${outage}. This is an outage, not an answer: the raw transcript stays in ${rawFile} and nothing was kept; run it again later.${stderr ? `\nstderr: ${stderr}` : ""}`);
    }

    // 4. scrubbed, then checked: a path or the email still there stops the batch before anything is published
    const scrubbed = scrub(raw, ctx.replacements);
    const leak = findLeak(scrubbed, ctx.needles);
    if (leak !== null) throw new Stop(4, `${name}: the scrubbed transcript still holds "${leak}". The raw transcript is ${rawFile}. Nothing was kept.`);

    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const gz = `${RUNS_DIR}/${name}.jsonl.gz`;
    fs.writeFileSync(`${gz}.tmp`, zlib.gzipSync(Buffer.from(scrubbed, "utf8")));
    fs.renameSync(`${gz}.tmp`, gz);
    // finalText stays in the transcript only: undefined leaves JSON.stringify's output
    const entry = { name, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), ...summary, finalText: undefined, resultNotes: resultNotes(summary, ALLOWED_MODELS) };
    fs.appendFileSync(`${RUNS_DIR}/index.jsonl`, `${JSON.stringify(entry)}\n`);

    const u = summary.usage;
    const n = (x: number): string => x.toLocaleString("en-US");
    console.log(`${name}: ${summary.turns} turns, $${summary.costUsd.toFixed(2)} est., in ${n(u.input)} (cache write ${n(u.cacheWrite)}, read ${n(u.cacheRead)}) out ${n(u.output)}, `
        + `${Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)} s, nebulosity calls ${summary.nebulosityCalls}, ToolSearch calls ${summary.toolSearchCalls}, `
        + `5-hour ${fixed(summary.utilization.fiveHour)}, 7-day ${fixed(summary.utilization.sevenDay)}${entry.resultNotes.length ? ` [${entry.resultNotes.join("; ")}]` : ""}`);
    return summary;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const dry = options.dryRun;
    console.log(dry ? "Dry run: nothing is started, written or changed." : "Eval run.");

    // The checks before the first run (all read-only)
    const head = git(["-C", VSCODE, "rev-parse", "HEAD"]).trim();
    if (!head.startsWith(VSCODE_COMMIT)) throw new Stop(1, `${VSCODE} is at ${head}, not ${VSCODE_COMMIT}: the eval's ground truth is for that commit.`);
    const dirty = vscodeChanges();
    if (dirty.length > 0) throw new Stop(1, `git status in ${VSCODE} names changes (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", ..." : ""}). Nothing was run; ask the owner before restoring.`);
    console.log(`${VSCODE}: HEAD ${head}, git status clean`);

    const claude = forward(process.env.CLAUDE_BIN ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    if (!fs.existsSync(claude)) throw new Stop(1, `claude isn't at ${claude}. Set CLAUDE_BIN to claude.exe if it lives elsewhere.`);
    console.log(`claude: ${claude} (exists)`);
    // the one process the checks start, so a real run asks it last, after every check that can stop without it
    if (dry) console.log("claude --version: skipped (dry run)");

    const gitBash = forward(process.env.GIT_BASH ?? path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe"));
    if (!fs.existsSync(gitBash)) throw new Stop(1, `Git Bash isn't at ${gitBash}. Set GIT_BASH to bash.exe if it lives elsewhere.`);
    console.log(`Git Bash: ${gitBash} (exists)`);

    if (options.configDir && !fs.existsSync(options.configDir)) throw new Stop(1, `--config-dir ${options.configDir} doesn't exist.`);

    const { file: questions, placeholder } = loadQuestions(dry);
    console.log(placeholder ? `eval/questions.json: missing (Task 17 writes it); the dry run uses placeholder prompts for ${questions.questions.map((q) => q.id).join(", ")}` : `eval/questions.json: ${questions.questions.length} questions`);

    const keys = ownerPluginKeys();
    const plugins = [...new Set(keys.map((key) => key.split("@")[0]))];
    console.log(`the owner's plugins to refuse: ${plugins.length ? plugins.join(", ") : "none"}`);
    // the init message may name a plugin with or without its marketplace, so both spellings are refused
    const forbiddenPlugins = [...new Set([...plugins, ...keys])];

    // The questions and the runs
    const ids = options.pilot ? PILOT : options.only;
    const unknown = (ids ?? []).filter((id) => !questions.questions.some((q) => q.id === id));
    if (unknown.length > 0) throw new Stop(1, `no such question: ${unknown.join(", ")}. The questions are ${questions.questions.map((q) => q.id).join(", ")}.`);
    const chosen = questions.questions.filter((q) => ids === null || ids.includes(q.id)).map((q) => q.id);
    const planned: RunId[] = schedule(chosen, options.pilot ? 1 : options.repeat ?? 1);
    // the pilot also measures what deferring Nebulosity's tools (Claude Code's default) costs: B with every tool loaded up front
    if (options.pilot) for (const question of chosen) planned.push({ question, arm: "nebulosity", repeat: 1, toolSearch: false });
    const isDone = (run: RunId): boolean => fs.existsSync(`${RUNS_DIR}/${runName(run)}.jsonl.gz`);
    const todo = planned.filter((run) => !isDone(run));
    const batch = todo.slice(0, options.limit);

    const mcp = { empty: EMPTY_MCP, nebulosity: NEBULOSITY_MCP };
    const mcpNebulosity = { mcpServers: { nebulosity: { command: "node", args: [`${CHECKOUT}/mcp/launch.mjs`], env: { NEBULOSITY_LIVE: "off" } } } };
    const text = `${JSON.stringify(mcpNebulosity, null, 2)}\n`;
    console.log(`MCP config for A: ${EMPTY_MCP}`);
    console.log(`schedule: ${planned.length} runs, ${planned.length - todo.length} already in eval/runs, ${batch.length} to start${todo.length > batch.length ? ` (--limit ${options.limit}; ${todo.length - batch.length} more after)` : ""}`);

    if (dry){
        console.log(`MCP config for B, which a real run writes to ${NEBULOSITY_MCP}:\n${text.trimEnd()}`);
        for (const run of batch){
            const pins = childEnv({}, { gitBash, toolSearch: run.toolSearch, configDir: options.configDir ?? undefined });
            const env = childEnv(process.env, { gitBash, toolSearch: run.toolSearch, configDir: options.configDir ?? undefined });
            const removed = Object.keys(process.env).filter((key) => !(key in env));
            const q = questions.questions.find((x) => x.id === run.question)!;
            const stdin = `${q.prompt}\n\n${questions.formats[q.family]}`;
            console.log(`\n${runName(run)}`);
            console.log(`  command: ${quote(claude)} ${claudeArgs(run.arm, mcp).map(quote).join(" ")}`);
            console.log(`  cwd: ${VSCODE}`);
            console.log(`  stdin (${stdin.length} characters): ${JSON.stringify(stdin)}`);
            console.log(`  environment: ${Object.entries(pins).map(([k, v]) => `set ${k}=${v}`).concat(removed.map((k) => `remove ${k}`)).join("; ")}`);
        }
        console.log("\nNothing was started.");
        return;
    }

    if (batch.length === 0){
        console.log("Nothing to run: every run in this schedule is already in eval/runs.");
        return;
    }
    if (!fs.existsSync(EMPTY_MCP)) throw new Stop(1, `${EMPTY_MCP} is missing (it is committed).`);
    const version = spawnSync(claude, ["--version"], { encoding: "utf8" }).stdout?.trim().split(/\s+/)[0];
    if (version !== CLAUDE_VERSION) throw new Stop(1, `claude --version is ${version ?? "unknown"}, not ${CLAUDE_VERSION}: the eval pins the version.`);
    console.log(`claude --version: ${version}`);
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(NEBULOSITY_MCP, text);

    const home = forward(os.homedir());
    let email: string | null = null;
    try{
        email = git(["-C", CHECKOUT, "config", "user.email"]).trim() || null;
    } catch{
        // no email configured: the folders are still checked
    }
    const ctx: Context = {
        options, questions, claude, gitBash, forbiddenPlugins, mcp,
        replacements: [{ folder: VSCODE, with: "<vscode>" }, { folder: CHECKOUT, with: "<nebulosity>" }, { folder: home, with: "~" }],
        needles: leakNeedles({ folders: [home, CHECKOUT, VSCODE], email }),
    };

    process.on("exit", () => killTree(running?.pid));
    process.on("SIGINT", () => process.exit(130));

    let started = 0;
    for (const run of batch){
        const summary = await runOne(run, ctx);
        started++;
        const { fiveHour, sevenDay } = summary.utilization;
        const why = sevenDay !== null && sevenDay >= options.sevenDay ? `the 7-day window is at ${fixed(sevenDay)} (threshold ${options.sevenDay})`
            : fiveHour !== null && fiveHour >= options.fiveHour ? `the 5-hour window is at ${fixed(fiveHour)} (threshold ${options.fiveHour})` : null;
        if (why !== null && started < batch.length){
            console.log(`Stopping cleanly before the next run: ${why}. ${todo.length - started} runs are left; run the same command again later.`);
            return;
        }
        if (why !== null) console.log(`Note: ${why}. Wait before starting more runs.`);
    }
    console.log(`Done: ${started} runs kept in eval/runs. ${todo.length - started} runs are left in this schedule.`);
}

main().catch((e: unknown) => {
    if (e instanceof Stop){
        console.error(e.message);
        process.exitCode = e.code;
    } else {
        console.error(e);
        process.exitCode = 1;
    }
});
