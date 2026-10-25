/**
 * The `nebulosity` command (ADR-058). One command for each thing a user does:
 *   nebulosity index <repo> [--no-activate]   build or update a repo's index (free)
 *   nebulosity summarize <repo> [--yes] …     write summaries: shows the estimate and asks first (S11)
 *   nebulosity map [--port <n>]               open the Map (http://localhost:<n>, default 3000); the port is saved
 *                                             in config.json, where the MCP server sends live updates and show_on_map
 *   nebulosity map --print-port               print the port the Map was last started on (the VS Code extension reads it)
 *   nebulosity mcp                            the MCP server Claude Code starts (stdio)
 *   nebulosity setup [--print]                register the server with Claude Code for the repo in this folder
 *   nebulosity doctor                         check Node, the data folder, the database, git and claude
 */
import { spawn, spawnSync, type SpawnSyncReturns, type StdioOptions } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import { DEFAULT_PORT, readConfig, writeConfig } from "../lib/config";
import { dataDir, dataPath, nebulosityHome, nebulosityPath } from "../lib/home";
import { hasAnthropicKey, loadLocalEnv } from "./env";

export type Command = "index" | "summarize" | "map" | "mcp" | "setup" | "doctor" | "version" | "help";
const COMMANDS = ["index", "summarize", "map", "mcp", "setup", "doctor"];

const USAGE = [
    "usage: nebulosity <command>",
    "  nebulosity index <repo> [--no-activate]   build or update a repo's index (free)",
    "  nebulosity summarize <repo> [--yes] …     write summaries: shows the estimate and asks first",
    "  nebulosity map [--port <n>]               open the Map (http://localhost:<n>, default 3000); the port is saved,",
    "                                            so Claude Code's live updates and show_on_map reach this Map",
    "  nebulosity map --print-port               print the port the Map was last started on",
    "  nebulosity mcp                            the MCP server Claude Code starts (stdio)",
    "  nebulosity setup [--print]                register the server with Claude Code for the repo in this folder",
    "  nebulosity doctor                         check Node, the data folder, the database, git and claude",
    "  nebulosity --version",
].join("\n");

export function parseCli(argv: readonly string[]): { command: Command; args: string[] } | { error: string } {
    const [first, ...rest] = argv;
    if (first === undefined || first === "--help" || first === "help") return { command: "help", args: [] };
    if (first === "--version" || first === "-v") return { command: "version", args: [] };
    if (!COMMANDS.includes(first)) return { error: `nebulosity has no command "${first}". Commands: ${COMMANDS.join(", ")}.` };
    return { command: first as Command, args: rest };
}

/** A `claude` command line: the command, its arguments, and whether it runs through the shell. */
export type ClaudeCommand = { command: string; args: string[]; shell: boolean };

/** A stdio registration of the server named nebulosity: its scope, what it runs, and its environment. */
export type Registration = { scope: string; command: string; args: string[]; env: Record<string, string> };

/**
 * The `claude mcp add` line for a registration. The environment goes as -e after the name (claude's own example: a
 * variadic -e before the name would take the name for a value). On Windows `claude` is a .cmd shim that Node can only
 * start through the shell, so each value and argument is quoted there.
 */
export function addCommand(registration: Registration, platform: NodeJS.Platform = process.platform): ClaudeCommand {
    const windows = platform === "win32";
    const quoted = (arg: string): string => (windows ? `"${arg}"` : arg);
    return {
        command: "claude",
        args: [
            "mcp", "add", "--scope", registration.scope, "--transport", "stdio", "nebulosity",
            ...Object.entries(registration.env).flatMap(([name, value]) => ["-e", quoted(`${name}=${value}`)]),
            "--", registration.command, ...registration.args.map(quoted),
        ],
        shell: windows,
    };
}

/**
 * How `setup` registers the MCP server for a repo (ADR-048's line, per repo with --scope local): node and the launcher,
 * written with forward slashes. A custom data folder (NEBULOSITY_DATA, absolute) goes with it, so the server Claude Code
 * starts reads the index this copy wrote, not the default folder's.
 */
export function setupCommand(launcher: string, platform: NodeJS.Platform = process.platform, dataFolder?: string): ClaudeCommand {
    const slashed = (p: string): string => p.replace(/\\/g, "/");
    return addCommand({
        scope: "local", command: "node", args: [slashed(launcher)], env: dataFolder === undefined ? {} : { NEBULOSITY_DATA: slashed(dataFolder) },
    }, platform);
}

const SCOPES: Record<string, string> = { Local: "local", Project: "project", User: "user" };

/**
 * The registration `claude mcp get nebulosity` prints (Claude Code 2.1.300: `Scope: Local config (…)`, `Command:`, `Args:`
 * with the arguments joined by spaces, then `Environment:` and one `NAME=value` per line), or null when it prints no stdio
 * server. node's arguments are read as one (the launcher, whose path may hold spaces); another command's are split on spaces.
 */
export function parseRegistration(stdout: string): Registration | null {
    const lines = stdout.split(/\r?\n/);
    const field = (name: string): string | undefined => lines.map((line) => new RegExp(`^\\s+${name}:\\s?(.*)$`).exec(line)?.[1]).find((v) => v !== undefined);
    const command = field("Command")?.trim();
    if (command === undefined || command === "") return null;
    const label = field("Scope") ?? "";
    const argsText = (field("Args") ?? "").trim();
    const env: Record<string, string> = {};
    const at = lines.findIndex((line) => /^\s+Environment:\s*$/.test(line));
    for (const line of at < 0 ? [] : lines.slice(at + 1)){
        const pair = /^\s{3,}([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (pair === null) break;
        env[pair[1]] = pair[2];
    }
    return {
        scope: SCOPES[label.split(" ")[0]] ?? label, command,
        args: argsText === "" ? [] : command === "node" ? [argsText] : argsText.split(/\s+/),
        env,
    };
}

/** An optional note for a repo's CLAUDE.md (R5): never written by setup. */
export const SNIPPET = [
    "## Nebulosity",
    "This repo is indexed by Nebulosity. For questions about what imports what, who calls a method (even through injected services),",
    "what a change would affect, how the code is layered, import cycles or files nothing imports, call its tools (mcp__nebulosity__imports,",
    "mcp__nebulosity__calls, mcp__nebulosity__architecture, mcp__nebulosity__describe) before grep: they answer from the whole repo in one call.",
    "",
    "(Add this only to a CLAUDE.md you already have. Creating a CLAUDE.md in a repo that has an AGENTS.md makes Claude Code stop reading the AGENTS.md.)",
].join("\n");

/** Runs one command. Returns the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
    const parsed = parseCli(argv);
    if ("error" in parsed){
        console.error(parsed.error);
        return 1;
    }

    const { command, args } = parsed;
    switch (command){
        case "help":
            console.log(USAGE);
            return 0;
        case "version":
            console.log(packageVersion());
            return 0;
        // each command loads what it needs when it runs, so --version or the MCP server's start never loads the indexer
        case "index":
            return await (await import("./commands/index-command")).runIndex(args);
        case "summarize":
            return (await import("./commands/summarize-command")).runSummarize(args);
        case "map":
            return runMap(args);
        case "mcp":
            if (args.length > 0){
                console.error("usage: nebulosity mcp   (it takes no arguments: Claude Code starts it)");
                return 1;
            }
            // it answers over stdin and stdout until the client closes stdin, then exits (mcp/server.ts)
            await (await import("../mcp/server")).main();
            return 0;
        case "setup":
            return runSetup(args);
        case "doctor":
            if (args.length > 0){
                console.error("usage: nebulosity doctor");
                return 1;
            }
            loadLocalEnv();   // a key in .env.local counts, as it does for summarize
            return runDoctor();
    }
}

/** The version in this copy's package.json. */
function packageVersion(): string {
    return (JSON.parse(fs.readFileSync(nebulosityPath("package.json"), "utf8")) as { version: string }).version;
}

/**
 * What `nebulosity map`'s arguments ask for: to start the Map on --port <n> (1 to 65535, else the default), or with
 * --print-port alone to print the port it was last started on; null when the arguments can't be read.
 */
export function parseMapArgs(args: readonly string[]): { kind: "start"; port: number } | { kind: "print-port" } | null {
    if (args.length === 0) return { kind: "start", port: DEFAULT_PORT };
    if (args.length === 1 && args[0] === "--print-port") return { kind: "print-port" };
    if (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1])) return null;
    const port = Number(args[1]);
    return port > 0 && port < 65_536 ? { kind: "start", port } : null;
}

/**
 * The Map: `next start` on this copy's prebuilt `.next`, on 127.0.0.1 only (proxy.ts refuses other hosts anyway).
 * The background worker starts with it (instrumentation.ts) unless NEBULOSITY_WORKER=off. Its port is saved in the
 * config first, because the MCP server posts live events and show_on_map to the config's port (lib/live/client.ts):
 * a Map on --port <n> gets them, and they never go to a port the user didn't start the Map on.
 * `--print-port` starts nothing and writes nothing: it prints that saved port, for the VS Code extension (and a script)
 * to find the Map this copy last started.
 */
async function runMap(args: readonly string[]): Promise<number> {
    const parsed = parseMapArgs(args);
    if (parsed === null){
        console.error("usage: nebulosity map [--port <n> | --print-port]");
        return 1;
    }
    if (parsed.kind === "print-port"){
        console.log(readConfig().port);
        return 0;
    }
    const { port } = parsed;
    if (!fs.existsSync(nebulosityPath(".next", "BUILD_ID"))){
        console.error("This copy of Nebulosity has no built Map. In a checkout, run npm run build first.");
        return 1;
    }

    const config = readConfig();
    if (config.port !== port) writeConfig({ ...config, port });

    // next resolves from this copy's own node_modules, whatever the working folder
    const next = createRequire(nebulosityPath("package.json")).resolve("next/dist/bin/next");
    const child = spawn(process.execPath, [next, "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: nebulosityHome(), stdio: "inherit" });
    return new Promise((resolve) => {
        child.on("error", (err) => {
            console.error(`[map] ${err.message}`);
            resolve(1);
        });
        child.on("exit", (code) => resolve(code ?? 1));
    });
}

/** A claude command as one line to read or paste (Windows' is already quoted for its shell). */
function commandLine(command: ClaudeCommand): string {
    return [command.command, ...command.args.map((arg) => (!command.shell && /\s/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
}

/**
 * Starts claude in `cwd`, where --scope local files the registration. Through the shell the line goes as one string,
 * already quoted (Node 24 warns when arguments are passed to a shell, which only joins them).
 */
function runClaude(command: ClaudeCommand, cwd: string, stdio: StdioOptions): SpawnSyncReturns<Buffer> {
    return command.shell
        ? spawnSync([command.command, ...command.args].join(" "), { cwd, shell: true, stdio })
        : spawnSync(command.command, command.args, { cwd, stdio });
}

/**
 * `nebulosity setup [--print]`: registers the MCP server with Claude Code for the indexed repo holding `cwd` (ADR-046's
 * rule picks it, as the server will), in that repo's root, where --scope local files it, with ADR-048's line and no
 * alwaysLoad (R4). It only reads the index (ADR-044's read-only open) and writes no file in the repo (R5). It first reads
 * any registration Claude Code already has (`claude mcp get`, which changes nothing), so a different one is shown before
 * it is replaced, and can be restored if the new one fails.
 */
export async function runSetup(args: readonly string[], cwd: string = process.cwd()): Promise<number> {
    if (args.some((arg) => arg !== "--print")){
        console.error("usage: nebulosity setup [--print]");
        return 1;
    }

    const client = await import("../lib/db/client");
    const { listStagedRepositories } = await import("../lib/db/store/stages");
    const { chooseRepo } = await import("../lib/tools/repo");
    // setup only reads the index: no migration, nothing written (ADR-044), so it can't race the Map or the worker
    client.useReadOnlyDatabase();
    let roots: string[];
    try{
        roots = listStagedRepositories(client.getDb()).map((repo) => repo.rootPath);
    } catch (err){
        if (err instanceof client.DatabaseMissingError){
            console.error(`Nebulosity hasn't indexed any repository yet (there's no index at ${dataPath("nebulosity.db")}). Index it first: nebulosity index .`);
        } else console.error(messageOf(err));
        return 1;
    }
    const choice = chooseRepo(cwd, roots, null);
    if (choice === null){
        console.error(`Nebulosity hasn't indexed a repository holding ${cwd}. Index it first: nebulosity index .`);
        return 1;
    }
    // --scope local files the registration under the folder claude runs in: the repo's root, wherever inside it setup ran
    const root = choice.root;

    const add = setupCommand(nebulosityPath("mcp", "launch.mjs"), process.platform, process.env.NEBULOSITY_DATA ? dataDir() : undefined);
    const remove: ClaudeCommand = { ...add, args: ["mcp", "remove", "--scope", "local", "nebulosity"] };
    const got = runClaude({ ...add, args: ["mcp", "get", "nebulosity"] }, root, "pipe");
    const earlier = got.error || got.status !== 0 ? null : parseRegistration(String(got.stdout ?? ""));
    const earlierLine = earlier === null ? null : commandLine(addCommand(earlier));
    const replacing = earlier !== null && earlier.scope === "local";
    const same = earlierLine === commandLine(add);

    if (args.includes("--print")){
        console.log(replacing ? `Run these in ${root}:` : `Run this in ${root}:`);
        if (replacing) console.log(`  ${commandLine(remove)}`);
        console.log(`  ${commandLine(add)}`);
        if (earlier !== null && !replacing) console.log(`(Claude Code also has a ${earlier.scope} registration named nebulosity; this repo's local one takes its place here.)`);
    } else{
        if (earlierLine !== null && !same){
            console.log([
                replacing ? "Claude Code already has a nebulosity server for this repo:" : `Claude Code already has a nebulosity server in its ${earlier!.scope} config:`,
                `  ${earlierLine}`,
                replacing ? "It is replaced by this one:" : "This repo's local one, registered now, takes its place here:",
                `  ${commandLine(add)}`,
            ].join("\n"));
        }
        // A second setup (after an upgrade moved the package, ADR-058) replaces the first: claude mcp add refuses a name
        // the scope already has. Its own message when there's nothing to remove isn't shown.
        const removed = runClaude(remove, root, "ignore");
        const added = runClaude(add, root, "inherit");
        if (added.error || added.status !== 0){
            console.error(`Claude Code didn't register the server${added.error ? ` (${added.error.message})` : ""}. Is Claude Code installed?`);
            if (replacing && removed.status === 0){
                console.error(`The earlier registration was removed. To restore it, run this in ${root}:\n  ${earlierLine}`);
                console.error(`To try this one again:\n  ${commandLine(add)}`);
            } else console.error(`You can run this yourself, in ${root}:\n  ${commandLine(add)}`);
            return 1;
        }
        console.log(`Registered Nebulosity with Claude Code for ${root}${replacing ? same ? " (the same registration as before)" : ", in place of the earlier registration" : ""}.`);
        console.log(`Start Claude Code sessions in ${root} (the registration is that folder's): a session there can use Nebulosity's tools.`);
    }

    console.log("");
    console.log("Optional: a note for this repo's CLAUDE.md, if it has one (setup never writes it):");
    console.log("");
    console.log(SNIPPET);
    return 0;
}

type Check = { level: "OK" | "WARN" | "FAIL"; text: string };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `claude --version`: through the shell on Windows, where claude is a .cmd shim. */
function claudeVersion(): SpawnSyncReturns<string> {
    return process.platform === "win32"
        ? spawnSync("claude --version", { shell: true, encoding: "utf8" })
        : spawnSync("claude", ["--version"], { encoding: "utf8" });
}

/**
 * `nebulosity doctor`: one line per check, in order: Node, the data folder, the database, the Map, git, claude, the key.
 * Returns 1 when any check FAILs; a WARN (no built Map, no claude, no key) leaves the rest working.
 */
export async function runDoctor(): Promise<number> {
    const checks: Check[] = [];

    const node = process.versions.node;
    checks.push(Number(node.split(".")[0]) >= 24
        ? { level: "OK", text: `Node ${node}` }
        : { level: "FAIL", text: `Node ${node}: Nebulosity needs Node 24 or newer` });

    const data = dataDir();
    try{
        fs.mkdirSync(data, { recursive: true });
        const probe = dataPath(`.doctor-${process.pid}`);
        fs.writeFileSync(probe, "");
        fs.rmSync(probe);
        checks.push({ level: "OK", text: `data folder ${data} (writable)` });
    } catch (err){
        checks.push({ level: "FAIL", text: `data folder ${data} isn't writable: ${messageOf(err)}` });
    }

    const file = dataPath("nebulosity.db");
    try{
        const { openDb } = await import("../lib/db/client");
        const { listStagedRepositories } = await import("../lib/db/store/stages");
        const db = openDb(file);   // opening read-write applies any pending migration (ADR-023)
        try{
            const repos = listStagedRepositories(db).length;
            checks.push({ level: "OK", text: `database ${file} (opens and migrates; ${repos} ${repos === 1 ? "repository" : "repositories"} indexed)` });
        } finally{
            db.$client.close();
        }
    } catch (err){
        checks.push({ level: "FAIL", text: `database ${file}: ${messageOf(err)}` });
    }

    checks.push(fs.existsSync(nebulosityPath(".next", "BUILD_ID"))
        ? { level: "OK", text: `the Map is built (${nebulosityPath(".next")})` }
        : { level: "WARN", text: "the Map isn't built: nebulosity map won't start (in a checkout, run npm run build)" });

    const git = spawnSync("git", ["--version"], { encoding: "utf8" });
    checks.push(!git.error && git.status === 0
        ? { level: "OK", text: git.stdout.trim() }
        : { level: "FAIL", text: "git not found: indexing a git repository needs git on the PATH" });

    const claude = claudeVersion();
    checks.push(!claude.error && claude.status === 0
        ? { level: "OK", text: `claude ${claude.stdout.trim()}` }
        : { level: "WARN", text: "claude not found: nebulosity setup needs Claude Code (the index and the Map work without it)" });

    checks.push(hasAnthropicKey()
        ? { level: "OK", text: "ANTHROPIC_API_KEY set: summaries and meaning search are available" }
        : { level: "WARN", text: "ANTHROPIC_API_KEY not set: free mode (the index, code search, imports and the Map; summaries and meaning search need a key)" });

    for (const check of checks) console.log(`${check.level.padEnd(5)}${check.text}`);
    return checks.some((check) => check.level === "FAIL") ? 1 : 0;
}
