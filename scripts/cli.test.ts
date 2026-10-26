import { spawn, spawnSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseMissingError, getDb, useReadOnlyDatabase } from "../lib/db/client";
import { indexRepository } from "../lib/index/pipeline";
import { copyFixture } from "../test/helpers/fixture";
import { makeTempDir } from "../test/helpers/temp";
import { main, parseCli, parseMapArgs, parseRegistration, runDoctor, runSetup, setupCommand, SNIPPET } from "./cli";

// No test starts claude, git or npm (the plan's global constraints): the CLI's child processes are stubbed. Everything
// else in child_process stays real (the indexer's own git calls only run in a folder with a .git, which no copy here has).
vi.mock("child_process", async (importOriginal) => ({
    ...(await importOriginal<typeof import("child_process")>()),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
}));

// setup's read-only switch (ADR-044) is watched, not run: under Vitest every getDb is one in-memory database the tests
// already opened read-write to index a fixture, and the real switch refuses to come after that first open
vi.mock("../lib/db/client", async (importOriginal) => {
    const real = await importOriginal<typeof import("../lib/db/client")>();
    return { ...real, useReadOnlyDatabase: vi.fn(), getDb: vi.fn(real.getDb) };
});

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
    vi.mocked(useReadOnlyDatabase).mockClear();
    vi.mocked(getDb).mockClear();
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

    it("carries a custom NEBULOSITY_DATA into the registration as -e after the name, quoted for the shell like the launcher (sweep B, item 16)", () => {
        const data = path.win32.join("C:", "Users", "Ann Lee", "neb-data");
        expect(setupCommand(path.win32.join("C:", "pkg", "mcp", "launch.mjs"), "win32", data).args).toEqual([
            "mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "-e", '"NEBULOSITY_DATA=C:/Users/Ann Lee/neb-data"', "--", "node", '"C:/pkg/mcp/launch.mjs"',
        ]);
        expect(setupCommand("/pkg/mcp/launch.mjs", "linux", "/home/ann lee/neb-data").args).toEqual([
            "mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "-e", "NEBULOSITY_DATA=/home/ann lee/neb-data", "--", "node", "/pkg/mcp/launch.mjs",
        ]);
    });
});

/** What `claude mcp get nebulosity` prints for a stdio server (the 2.1.300 binary's format): its scope, command, args and environment. */
function registered(launcher: string, env: Record<string, string> = {}, scope = "Local config (private to you in this project)"): string {
    return [
        "nebulosity:", `  Scope: ${scope}`, "  Status: ✓ Connected", "  Type: stdio", "  Command: node", `  Args: ${launcher}`,
        ...(Object.keys(env).length > 0 ? ["  Environment:", ...Object.entries(env).map(([k, v]) => `    ${k}=${v}`)] : []),
        "", 'To remove this server, run: claude mcp remove "nebulosity" -s local', "",
    ].join("\n");
}

describe("parseRegistration (sweep B, item 14)", () => {
    it("reads the scope, the command, the launcher (one argument, spaces and all) and the environment", () => {
        expect(parseRegistration(registered("C:/Users/Ann Lee/old/mcp/launch.mjs", { NEBULOSITY_DATA: "C:/data", OTHER: "a=b" }))).toEqual({
            scope: "local", command: "node", args: ["C:/Users/Ann Lee/old/mcp/launch.mjs"], env: { NEBULOSITY_DATA: "C:/data", OTHER: "a=b" },
        });
        expect(parseRegistration(registered("/old/launch.mjs", {}, "User config (available in all your projects)"))).toMatchObject({ scope: "user", env: {} });
    });

    it("is null when there is no stdio registration to read", () => {
        expect(parseRegistration("")).toBeNull();
        expect(parseRegistration("No MCP server found with name: nebulosity")).toBeNull();
    });
});

describe("SNIPPET (R5)", () => {
    it("names the tools and warns that a CLAUDE.md hides an AGENTS.md", () => {
        expect(SNIPPET).toContain("mcp__nebulosity__imports");
        expect(SNIPPET).toContain("mcp__nebulosity__calls");
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
        expect(printed(logs)).toBe("0.3.0");
    });
});

describe("parseMapArgs", () => {
    it("starts the Map on the default port, or on --port <n> (1 to 65535)", () => {
        expect(parseMapArgs([])).toEqual({ kind: "start", port: 3000 });
        expect(parseMapArgs(["--port", "3125"])).toEqual({ kind: "start", port: 3125 });
    });

    it("reads --print-port alone as a request to print the saved port", () => {
        expect(parseMapArgs(["--print-port"])).toEqual({ kind: "print-port" });
    });

    it("refuses a port out of range, a flag with a stray argument, and a flag with no value", () => {
        expect(parseMapArgs(["--port", "0"])).toBeNull();
        expect(parseMapArgs(["--port", "65536"])).toBeNull();
        expect(parseMapArgs(["--print-port", "x"])).toBeNull();
        expect(parseMapArgs(["--port"])).toBeNull();
    });
});

describe("nebulosity map (final review, C-M2)", () => {
    const saved = { home: process.env.NEBULOSITY_HOME, data: process.env.NEBULOSITY_DATA };

    afterEach(() => {
        vi.mocked(spawn).mockReset();
        for (const [name, value] of [["NEBULOSITY_HOME", saved.home], ["NEBULOSITY_DATA", saved.data]] as const){
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    /**
     * A copy with a built Map (a BUILD_ID) and a stand-in next to start, and a data folder whose config names an active
     * repo on the default port. Returns the config file and the config each stubbed `next start` saw when it was started.
     */
    function builtCopy(): { configFile: string; seen: unknown[] } {
        const home = makeTempDir("neb-map-");
        fs.mkdirSync(path.join(home, ".next"));
        fs.writeFileSync(path.join(home, ".next", "BUILD_ID"), "build-1");
        fs.writeFileSync(path.join(home, "package.json"), JSON.stringify({ name: "nebulosity", version: "0.0.0" }));
        fs.mkdirSync(path.join(home, "node_modules", "next", "dist", "bin"), { recursive: true });
        fs.writeFileSync(path.join(home, "node_modules", "next", "dist", "bin", "next"), "");
        process.env.NEBULOSITY_HOME = home;
        process.env.NEBULOSITY_DATA = path.join(home, "data");
        const configFile = path.join(home, "data", "config.json");
        fs.mkdirSync(path.dirname(configFile));
        fs.writeFileSync(configFile, JSON.stringify({ activeRepo: "/r/app", port: 3000 }));

        const seen: unknown[] = [];
        vi.mocked(spawn).mockImplementation((() => {
            seen.push(JSON.parse(fs.readFileSync(configFile, "utf8")));
            const child = new EventEmitter();
            setImmediate(() => child.emit("exit", 0));   // next start stops at once
            return child;
        }) as unknown as typeof spawn);
        return { configFile, seen };
    }

    it("saves --port in the config before next starts, keeping the active repo, so live events follow the Map", async () => {
        const { seen } = builtCopy();
        expect(await main(["map", "--port", "3123"])).toBe(0);
        // the first argument is the stand-in next, as require resolves it (macOS's temp folder sits behind a link)
        expect((vi.mocked(spawn).mock.calls[0][1] as string[]).slice(1)).toEqual(["start", "-H", "127.0.0.1", "-p", "3123"]);
        expect(seen).toEqual([{ activeRepo: "/r/app", port: 3123 }]);
    });

    it("puts the default back when started without --port, and saves nothing for a port it refuses", async () => {
        const { configFile, seen } = builtCopy();
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await main(["map", "--port", "3123"])).toBe(0);
        expect(await main(["map"])).toBe(0);
        expect(seen).toEqual([{ activeRepo: "/r/app", port: 3123 }, { activeRepo: "/r/app", port: 3000 }]);

        expect(await main(["map", "--port", "70000"])).toBe(1);
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ activeRepo: "/r/app", port: 3000 });
    });

    it("map --print-port prints the saved port", async () => {
        // a copy with no built Map: print-port answers before the BUILD_ID check, and starts and saves nothing
        const home = makeTempDir("neb-print-port-");
        process.env.NEBULOSITY_HOME = home;
        process.env.NEBULOSITY_DATA = path.join(home, "data");
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await main(["map", "--print-port"])).toBe(0);
        expect(printed(logs)).toBe("3000");   // no config.json yet: the default

        fs.mkdirSync(process.env.NEBULOSITY_DATA);
        const configFile = path.join(process.env.NEBULOSITY_DATA, "config.json");
        fs.writeFileSync(configFile, JSON.stringify({ activeRepo: null, port: 3125 }));
        logs.mockClear();
        expect(await main(["map", "--print-port"])).toBe(0);
        expect(printed(logs)).toBe("3125");

        expect(spawn).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ activeRepo: null, port: 3125 });
    });

    it("refuses --print-port with anything after it, in the usage line", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await main(["map", "--print-port", "x"])).toBe(1);
        expect(printed(errors)).toBe("usage: nebulosity map [--port <n> | --print-port]");
    });
});

describe("runSetup (ADR-058: R4's registration, R5's snippet)", () => {
    // the launcher setup registers: this checkout's (NEBULOSITY_HOME is unset under Vitest, so the code root is cwd)
    const launcher = path.resolve("mcp", "launch.mjs");
    const windows = process.platform === "win32";
    /** An argument as setup writes it: through the shell on Windows, so quoted there (setupCommand's rule). */
    const q = (arg: string): string => (windows ? `"${arg}"` : arg);
    const forward = (p: string): string => p.replace(/\\/g, "/");
    const launcherArg = windows ? q(forward(launcher)) : launcher;
    const GET = "claude mcp get nebulosity";
    const REMOVE = "claude mcp remove --scope local nebulosity";
    const ADD = `claude mcp add --scope local --transport stdio nebulosity -- node ${launcherArg}`;
    // an earlier registration of an older copy, with its own data folder
    const OLD = registered("/old/place/mcp/launch.mjs", { NEBULOSITY_DATA: "/old/data" });
    const OLD_LINE = `claude mcp add --scope local --transport stdio nebulosity -e ${q("NEBULOSITY_DATA=/old/data")} -- node ${q("/old/place/mcp/launch.mjs")}`;

    const saved = process.env.NEBULOSITY_DATA;
    beforeEach(() => {
        delete process.env.NEBULOSITY_DATA;
    });
    afterEach(() => {
        if (saved === undefined) delete process.env.NEBULOSITY_DATA;
        else process.env.NEBULOSITY_DATA = saved;
    });

    /** claude as the stub answers it: `mcp get` prints `registration` (or finds none when null); remove and add exit as given. */
    function stubClaude(registration: string | null, codes: { remove?: number; add?: number } = {}): void {
        vi.mocked(spawnSync).mockImplementation(((command: string, args?: unknown) => {
            const line = Array.isArray(args) ? [command, ...args].join(" ") : command;
            if (line.startsWith(GET)) return registration === null ? { status: 1, stdout: "", stderr: "No MCP server found with name: nebulosity" } : { status: 0, stdout: registration, stderr: "" };
            return { status: line.startsWith(REMOVE) ? codes.remove ?? 0 : codes.add ?? 0 };
        }) as unknown as typeof spawnSync);
    }

    /** A private copy of the mini-repo, indexed; its root as the index spells it (forward slashes). */
    function indexedRepo(): { repo: string; root: string } {
        const repo = copyFixture();
        indexRepository(repo);
        return { repo, root: forward(repo) };
    }

    it("reads any earlier registration first, then replaces it and registers the launcher in the repo's folder, writes no file there, and prints the snippet", async () => {
        stubClaude(null);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo, root } = indexedRepo();
        const before = fs.readdirSync(repo).sort();

        expect(await runSetup([], repo)).toBe(0);
        expect(commandLines()).toEqual([GET, REMOVE, ADD]);
        expect(callOptions().map((options) => forward(String(options.cwd)))).toEqual([root, root, root]);
        expect(fs.readdirSync(repo).sort()).toEqual(before);   // no CLAUDE.md, no .mcp.json (R5)
        expect(printed(logs)).toContain(SNIPPET);
    });

    it("prints an earlier registration that differs and says it is replaced (sweep B, item 14)", async () => {
        stubClaude(OLD);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo } = indexedRepo();

        expect(await runSetup([], repo)).toBe(0);
        expect(commandLines()).toEqual([GET, REMOVE, ADD]);
        expect(printed(logs)).toContain(`Claude Code already has a nebulosity server for this repo:\n  ${OLD_LINE}\nIt is replaced by this one:\n  ${ADD}`);
    });

    it("says the earlier registration was removed, and how to restore it, when the add then fails (sweep B, item 14)", async () => {
        stubClaude(OLD, { add: 1 });
        vi.spyOn(console, "log").mockImplementation(() => {});
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const { repo, root } = indexedRepo();

        expect(await runSetup([], repo)).toBe(1);
        expect(printed(errors)).toContain(`The earlier registration was removed. To restore it, run this in ${root}:\n  ${OLD_LINE}`);
        expect(printed(errors)).toContain(`To try this one again:\n  ${ADD}`);
    });

    it("with --print prints the registration and the snippet, and starts only the read-only claude mcp get", async () => {
        stubClaude(null);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo } = indexedRepo();

        expect(await runSetup(["--print"], repo)).toBe(0);
        expect(commandLines()).toEqual([GET]);
        expect(printed(logs)).toContain(ADD);
        expect(printed(logs)).not.toContain(REMOVE);
        expect(printed(logs)).toContain(SNIPPET);
    });

    it("with --print prints the remove line too when a registration exists (sweep B, item 14)", async () => {
        stubClaude(OLD);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo, root } = indexedRepo();

        expect(await runSetup(["--print"], repo)).toBe(0);
        expect(commandLines()).toEqual([GET]);
        expect(printed(logs)).toContain(`Run these in ${root}:\n  ${REMOVE}\n  ${ADD}`);
    });

    it("registers in the repo's root when run in a folder inside it, and says where sessions start (sweep B, item 15)", async () => {
        stubClaude(null);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo, root } = indexedRepo();

        expect(await runSetup([], path.join(repo, "src", "app"))).toBe(0);
        expect(callOptions().map((options) => forward(String(options.cwd)))).toEqual([root, root, root]);
        expect(printed(logs)).toContain(`Start Claude Code sessions in ${root} (the registration is that folder's): a session there can use Nebulosity's tools.`);
    });

    it("carries a custom NEBULOSITY_DATA into the registration, as an absolute path (sweep B, item 16)", async () => {
        stubClaude(null);
        vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo } = indexedRepo();
        process.env.NEBULOSITY_DATA = "neb-data-elsewhere";

        expect(await runSetup([], repo)).toBe(0);
        const data = forward(path.resolve("neb-data-elsewhere"));
        expect(commandLines()[2]).toBe(`claude mcp add --scope local --transport stdio nebulosity -e ${q(`NEBULOSITY_DATA=${windows ? data : path.resolve("neb-data-elsewhere")}`)} -- node ${launcherArg}`);
    });

    it("opens the index read-only: ADR-044's switch comes before the first getDb (sweep B, item 17)", async () => {
        stubClaude(null);
        vi.spyOn(console, "log").mockImplementation(() => {});
        const { repo } = indexedRepo();
        vi.mocked(getDb).mockClear();

        expect(await runSetup(["--print"], repo)).toBe(0);
        expect(useReadOnlyDatabase).toHaveBeenCalledTimes(1);
        expect(vi.mocked(getDb)).toHaveBeenCalled();
        expect(vi.mocked(useReadOnlyDatabase).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(getDb).mock.invocationCallOrder[0]);
    });

    it("with no index at all says to index first, and starts nothing (sweep B, item 17)", async () => {
        vi.mocked(getDb).mockImplementationOnce(() => { throw new DatabaseMissingError("/data/nebulosity.db"); });
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await runSetup([], makeTempDir("neb-no-index-"))).toBe(1);
        expect(printed(errors)).toContain("Index it first: nebulosity index .");
        expect(spawnSync).not.toHaveBeenCalled();
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
