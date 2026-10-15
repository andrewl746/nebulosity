import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexRepository } from "../lib/index/pipeline";
import { copyFixture } from "../test/helpers/fixture";
import { makeTempDir } from "../test/helpers/temp";
import { main, parseCli, runDoctor, runSetup, setupCommand, SNIPPET } from "./cli";

// No test starts claude, git or npm (the plan's global constraints): the CLI's child processes are stubbed. Everything
// else in child_process stays real (the indexer's own git calls only run in a folder with a .git, which no copy here has).
vi.mock("child_process", async (importOriginal) => ({
    ...(await importOriginal<typeof import("child_process")>()),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
}));

type SpawnResult = ReturnType<typeof spawnSync>;

/** Each stubbed call as the command line it would run: one string through the shell, else the command and its arguments. */
function commandLines(): string[] {
    return (vi.mocked(spawnSync).mock.calls as unknown as [string, unknown, unknown?][])
        .map(([command, args]) => (Array.isArray(args) ? [command, ...args].join(" ") : command));
}

/** The options each stubbed call was given (the second argument through the shell, else the third). */
function callOptions(): Record<string, unknown>[] {
    return (vi.mocked(spawnSync).mock.calls as unknown as [string, unknown, unknown?][])
        .map(([, args, options]) => (Array.isArray(args) ? options : args) as Record<string, unknown>);
}

const printed = (spy: { mock: { calls: unknown[][] } }): string => spy.mock.calls.map((call) => String(call[0])).join("\n");

beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("parseCli", () => {
    it("reads a command and its arguments", () => {
        expect(parseCli(["index", "../repo", "--no-activate"])).toEqual({ command: "index", args: ["../repo", "--no-activate"] });
        expect(parseCli(["map", "--port", "3123"])).toEqual({ command: "map", args: ["--port", "3123"] });
    });

    it("answers --version and --help, and refuses an unknown command in a sentence", () => {
        expect(parseCli(["--version"])).toEqual({ command: "version", args: [] });
        expect(parseCli([])).toEqual({ command: "help", args: [] });
        expect(parseCli(["serve"])).toEqual({ error: 'nebulosity has no command "serve". Commands: index, summarize, map, mcp, setup, doctor.' });
    });
});

describe("setupCommand (Review Focus 5)", () => {
    it("registers per repo with claude mcp add, the launcher one argument even with a space in it", () => {
        expect(setupCommand("/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs", "linux")).toEqual({
            command: "claude",
            args: ["mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "--", "node", "/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs"],
            shell: false,
        });
    });

    it("on Windows runs claude's .cmd through the shell, so the path is quoted and written with forward slashes", () => {
        expect(setupCommand("C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\node_modules\\nebulosity\\mcp\\launch.mjs", "win32")).toEqual({
            command: "claude",
            args: ["mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "--", "node", '"C:/Users/Ann Lee/AppData/Roaming/npm/node_modules/nebulosity/mcp/launch.mjs"'],
            shell: true,
        });
    });
});

describe("SNIPPET (R5)", () => {
    it("names the tools and warns that a CLAUDE.md hides an AGENTS.md", () => {
        expect(SNIPPET).toContain("mcp__nebulosity__imports");
        expect(SNIPPET).toContain("AGENTS.md");
    });
});

describe("main", () => {
    it("refuses an unknown command with exit code 1, and prints the package's version", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        expect(await main(["serve"])).toBe(1);
        expect(printed(errors)).toBe('nebulosity has no command "serve". Commands: index, summarize, map, mcp, setup, doctor.');
        expect(await main(["--version"])).toBe(0);
        expect(printed(logs)).toBe("0.2.0");
    });
});

describe("runSetup (ADR-058: R4's registration, R5's snippet)", () => {
    // the launcher setup registers: this checkout's (NEBULOSITY_HOME is unset under Vitest, so the code root is cwd)
    const launcher = path.resolve("mcp", "launch.mjs");
    const launcherArg = process.platform === "win32" ? `"${launcher.replace(/\\/g, "/")}"` : launcher;

    it("replaces any earlier local registration, registers the launcher in the repo's folder, writes no file there, and prints the snippet", async () => {
        vi.mocked(spawnSync).mockReturnValue({ status: 0 } as SpawnResult);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const repo = copyFixture();
        indexRepository(repo);
        const before = fs.readdirSync(repo).sort();

        expect(await runSetup([], repo)).toBe(0);
        expect(commandLines()).toEqual([
            "claude mcp remove --scope local nebulosity",
            `claude mcp add --scope local --transport stdio nebulosity -- node ${launcherArg}`,
        ]);
        expect(callOptions().map((options) => options.cwd)).toEqual([repo, repo]);
        expect(fs.readdirSync(repo).sort()).toEqual(before);   // no CLAUDE.md, no .mcp.json (R5)
        expect(printed(logs)).toContain(SNIPPET);
    });

    it("with --print prints the registration and the snippet, and starts nothing", async () => {
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const repo = copyFixture();
        indexRepository(repo);

        expect(await runSetup(["--print"], repo)).toBe(0);
        expect(spawnSync).not.toHaveBeenCalled();
        expect(printed(logs)).toContain(`claude mcp add --scope local --transport stdio nebulosity -- node ${launcherArg}`);
        expect(printed(logs)).toContain(SNIPPET);
    });

    it("refuses a folder no indexed repo holds, and starts nothing", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await runSetup([], makeTempDir("neb-not-indexed-"))).toBe(1);
        expect(printed(errors)).toContain("Index it first: nebulosity index .");
        expect(spawnSync).not.toHaveBeenCalled();
    });
});

describe("runDoctor", () => {
    const saved = { home: process.env.NEBULOSITY_HOME, data: process.env.NEBULOSITY_DATA, key: process.env.ANTHROPIC_API_KEY };

    afterEach(() => {
        for (const [name, value] of [["NEBULOSITY_HOME", saved.home], ["NEBULOSITY_DATA", saved.data], ["ANTHROPIC_API_KEY", saved.key]] as const){
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    /** A code root of its own (this checkout's migrations, no built Map) and a data folder not made yet; no key. */
    function freshInstall(): string {
        const home = makeTempDir("neb-doctor-");
        fs.cpSync(path.resolve("lib", "db", "migrations"), path.join(home, "lib", "db", "migrations"), { recursive: true });
        process.env.NEBULOSITY_HOME = home;
        process.env.NEBULOSITY_DATA = path.join(home, "data");
        delete process.env.ANTHROPIC_API_KEY;
        return home;
    }

    /** git answers as given; claude isn't installed (the shell can't find it, or the spawn fails). */
    function stubTools(git: Partial<SpawnResult>): void {
        vi.mocked(spawnSync).mockImplementation(((command: string) => (command.startsWith("git")
            ? git
            : { status: 1, stdout: "", stderr: "not found", error: process.platform === "win32" ? undefined : new Error("spawnSync claude ENOENT") }
        )) as unknown as typeof spawnSync);
    }

    const levels = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((call) => String(call[0]).split(" ")[0]);

    it("prints one line per check: Node, the data folder, the database, the Map, git, claude, the key; a WARN is no failure", async () => {
        const home = freshInstall();
        stubTools({ status: 0, stdout: "git version 2.50.1\n", stderr: "" });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(0);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "OK", "WARN", "WARN"]);
        expect(printed(logs)).toContain("git version 2.50.1");
        expect(fs.existsSync(path.join(home, "data", "nebulosity.db"))).toBe(true);   // it opened (and so migrated) a database there
    });

    it("fails without git", async () => {
        freshInstall();
        stubTools({ status: null, stdout: "", stderr: "", error: new Error("spawnSync git ENOENT") });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(1);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "FAIL", "WARN", "WARN"]);
    });
});
