import { spawn, spawnSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import net from "net";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseMissingError, getDb, useReadOnlyDatabase } from "../lib/db/client";
import { indexRepository } from "../lib/index/pipeline";
import { listenError } from "../lib/port";
import { copyFixture } from "../test/helpers/fixture";
import { makeTempDir } from "../test/helpers/temp";
import { addCommand, main, mcpJson, parseCli, parseMapArgs, parseRegistration, runDoctor, runSetup, setupCommand, setupRegistration, SNIPPET } from "./cli";

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

// nebulosity map checks its port before saving it: free here unless a test says otherwise, so no test depends on what
// holds this machine's port 3000 (a running Map often does)
vi.mock("../lib/port", async (importOriginal) => {
    const real = await importOriginal<typeof import("../lib/port")>();
    return { ...real, listenError: vi.fn(async () => null) };
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

describe("setupRegistration (pre-ship pass, Task J)", () => {
    it("is the registration setup's add line is built from: local scope, node and the launcher, the data folder only when given", () => {
        expect(setupRegistration("/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs", "linux")).toEqual({
            scope: "local", command: "node", args: ["/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs"], env: {},
        });
        expect(setupRegistration("C:\\Users\\Ann Lee\\pkg\\mcp\\launch.mjs", "win32", "C:\\Users\\Ann Lee\\neb-data")).toEqual({
            scope: "local", command: "node", args: ["C:/Users/Ann Lee/pkg/mcp/launch.mjs"], env: { NEBULOSITY_DATA: "C:/Users/Ann Lee/neb-data" },
        });
        // claude mcp add's line for it is setupCommand's (the quoting is addCommand's, per platform)
        expect(addCommand(setupRegistration("C:\\pkg\\mcp\\launch.mjs", "win32", "C:\\data"), "win32")).toEqual(setupCommand("C:\\pkg\\mcp\\launch.mjs", "win32", "C:\\data"));
    });

    it("turns backslashes into forward slashes only on Windows: elsewhere a backslash is a character of the file's name", () => {
        expect(setupCommand("/srv/odd\\name/mcp/launch.mjs", "darwin").args.at(-1)).toBe("/srv/odd\\name/mcp/launch.mjs");
        expect(setupRegistration("/srv/odd\\name/mcp/launch.mjs", "linux", "/srv/odd\\data")).toEqual({
            scope: "local", command: "node", args: ["/srv/odd\\name/mcp/launch.mjs"], env: { NEBULOSITY_DATA: "/srv/odd\\data" },
        });
    });
});

describe("mcpJson (pre-ship pass, Task J; Review Focus 4)", () => {
    /** The block's keys, level by level: exactly mcpServers > nebulosity > command, args (and env when given). */
    function shape(text: string): string[][] {
        const block = JSON.parse(text) as { mcpServers: { nebulosity: Record<string, unknown> } };
        return [Object.keys(block), Object.keys(block.mcpServers), Object.keys(block.mcpServers.nebulosity)];
    }

    it("prints a POSIX launcher as an mcpServers block: two-space indent, a closing newline, no env and no type", () => {
        const text = mcpJson(setupRegistration("/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs", "linux"));
        expect(text).toBe([
            "{",
            '  "mcpServers": {',
            '    "nebulosity": {',
            '      "command": "node",',
            '      "args": [',
            '        "/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs"',
            "      ]",
            "    }",
            "  }",
            "}",
            "",
        ].join("\n"));
        expect(shape(text)).toEqual([["mcpServers"], ["nebulosity"], ["command", "args"]]);
    });

    it("adds env with a custom data folder, and only then", () => {
        const text = mcpJson(setupRegistration("/pkg/mcp/launch.mjs", "linux", "/home/ann lee/neb-data"));
        expect(text).toBe([
            "{",
            '  "mcpServers": {',
            '    "nebulosity": {',
            '      "command": "node",',
            '      "args": [',
            '        "/pkg/mcp/launch.mjs"',
            "      ],",
            '      "env": {',
            '        "NEBULOSITY_DATA": "/home/ann lee/neb-data"',
            "      }",
            "    }",
            "  }",
            "}",
            "",
        ].join("\n"));
        expect(shape(text)).toEqual([["mcpServers"], ["nebulosity"], ["command", "args", "env"]]);
    });

    it("writes a Windows launcher and data folder with forward slashes, unquoted (JSON is no shell line), as valid JSON", () => {
        const launcher = "C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\node_modules\\nebulosity\\mcp\\launch.mjs";
        const bare = mcpJson(setupRegistration(launcher, "win32"));
        expect(JSON.parse(bare)).toEqual({ mcpServers: { nebulosity: { command: "node", args: ["C:/Users/Ann Lee/AppData/Roaming/npm/node_modules/nebulosity/mcp/launch.mjs"] } } });
        expect(shape(bare)).toEqual([["mcpServers"], ["nebulosity"], ["command", "args"]]);
        expect(bare).not.toContain("\\");

        const withData = mcpJson(setupRegistration(launcher, "win32", "C:\\Users\\Ann Lee\\neb-data"));
        expect(JSON.parse(withData)).toEqual({ mcpServers: { nebulosity: {
            command: "node", args: ["C:/Users/Ann Lee/AppData/Roaming/npm/node_modules/nebulosity/mcp/launch.mjs"], env: { NEBULOSITY_DATA: "C:/Users/Ann Lee/neb-data" },
        } } });
        expect(shape(withData)).toEqual([["mcpServers"], ["nebulosity"], ["command", "args", "env"]]);
        expect(withData).not.toContain("\\");
        expect(withData.endsWith("}\n")).toBe(true);
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
        expect(printed(logs)).toBe("1.1.0");
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

    // the release rehearsal (2026-10-26): next start failed with EADDRINUSE after the port was saved, so live events,
    // show_on_map and the extension's --print-port went to the other app, away from the Map already running
    it("refuses a port another app listens on, saving and starting nothing", async () => {
        const { configFile } = builtCopy();
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const other = net.createServer();
        await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", () => resolve()));
        const port = (other.address() as net.AddressInfo).port;
        const real = await vi.importActual<typeof import("../lib/port")>("../lib/port");
        vi.mocked(listenError).mockImplementationOnce(real.listenError);
        try{
            expect(await main(["map", "--port", String(port)])).toBe(1);
        } finally{
            await new Promise<void>((resolve) => other.close(() => resolve()));
        }
        expect(printed(errors)).toBe(`[map] port ${port} is already in use (another app, or a Map that's already running): start the Map on another port with nebulosity map --port <n>`);
        expect(spawn).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ activeRepo: "/r/app", port: 3000 });
    });

    it("refuses a port it can't listen on for another reason, with the reason, saving nothing", async () => {
        const { configFile } = builtCopy();
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(listenError).mockResolvedValueOnce(Object.assign(new Error("listen EACCES: permission denied 127.0.0.1:3123"), { code: "EACCES" }));
        expect(await main(["map", "--port", "3123"])).toBe(1);
        expect(printed(errors)).toBe("[map] the Map can't listen on 127.0.0.1:3123: listen EACCES: permission denied 127.0.0.1:3123");
        expect(spawn).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ activeRepo: "/r/app", port: 3000 });
    });

    // Final Review #2, out of scope (ruling R30): the Map used to start on the defaults without a word
    it("warns in one line, naming the file and doctor, when config.json can't be read, and still starts", async () => {
        const { configFile } = builtCopy();
        const broken = '{ "activeRepo": "/r/app", }';
        fs.writeFileSync(configFile, broken);
        vi.mocked(spawn).mockImplementation((() => {
            const child = new EventEmitter();
            setImmediate(() => child.emit("exit", 0));
            return child;
        }) as unknown as typeof spawn);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await main(["map"])).toBe(0);
        const lines = errors.mock.calls.map((call) => String(call[0]));
        expect(lines).toHaveLength(1);
        expect(lines[0].startsWith(`[map] ${configFile} isn't valid JSON (`)).toBe(true);
        expect(lines[0].endsWith("): the Map starts without its settings (no active repo) until it's fixed; nebulosity doctor says more")).toBe(true);
        // the default port needs no save, so the hand edit stays where it is
        expect(fs.readFileSync(configFile, "utf8")).toBe(broken);
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

    /** Everything written to stdout through process.stdout.write, and the spy (console.log goes to its own spy). */
    function stdoutSpy(): { written: () => string; spy: { mock: { calls: unknown[][] } } } {
        const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        return { written: () => spy.mock.calls.map((call) => String(call[0])).join(""), spy };
    }

    it("with --json prints only the mcpServers block, starts no command, reads no index and writes no file (pre-ship pass, Task J)", async () => {
        stubClaude(null);
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const out = stdoutSpy();
        // a folder no indexed repo holds: the block names no repo, so it needs none
        const folder = makeTempDir("neb-json-");

        expect(await runSetup(["--json"], folder)).toBe(0);
        expect(out.spy.mock.calls).toHaveLength(1);
        expect(JSON.parse(out.written())).toEqual({ mcpServers: { nebulosity: { command: "node", args: [forward(launcher)] } } });
        expect(out.written().endsWith("}\n")).toBe(true);
        expect(logs).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
        expect(spawnSync).not.toHaveBeenCalled();
        expect(getDb).not.toHaveBeenCalled();
        expect(fs.readdirSync(folder)).toEqual([]);
    });

    it("with --json carries a custom NEBULOSITY_DATA as env, the absolute path setup registers (pre-ship pass, Task J)", async () => {
        const out = stdoutSpy();
        process.env.NEBULOSITY_DATA = "neb-data-elsewhere";

        expect(await runSetup(["--json"], makeTempDir("neb-json-data-"))).toBe(0);
        expect(JSON.parse(out.written())).toEqual({ mcpServers: { nebulosity: {
            command: "node", args: [forward(launcher)], env: { NEBULOSITY_DATA: forward(path.resolve("neb-data-elsewhere")) },
        } } });
        expect(spawnSync).not.toHaveBeenCalled();
    });

    it("refuses --json with --print or with anything else, in the usage line, and prints and starts nothing (pre-ship pass, Task J)", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});
        const out = stdoutSpy();
        const folder = makeTempDir("neb-json-usage-");

        for (const args of [["--json", "--print"], ["--print", "--json"], ["--json", "--json"], ["--json", "x"]]){
            errors.mockClear();
            expect(await runSetup(args, folder)).toBe(1);
            expect(printed(errors)).toBe("usage: nebulosity setup [--print | --json]");
        }
        expect(out.spy.mock.calls).toHaveLength(0);
        expect(logs).not.toHaveBeenCalled();
        expect(spawnSync).not.toHaveBeenCalled();
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

    it("prints one line per check: Node, the data folder, the database, the Map, git, claude, the key, the summary models; a WARN is no failure", async () => {
        const home = freshInstall();
        stubTools({ status: 0, stdout: "git version 2.50.1\n", stderr: "" });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(0);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "OK", "WARN", "WARN", "OK"]);
        expect(printed(logs)).toContain("git version 2.50.1");
        // nothing set: the defaults (ADR-028), and where to change them
        expect(printed(logs)).toContain("summary models: files claude-haiku-5-5, folders claude-sonnet-5-5, the repo claude-sonnet-5-5 (the defaults;");
        expect(printed(logs)).toContain(path.join(home, "data", "config.json"));
        expect(fs.existsSync(path.join(home, "data", "nebulosity.db"))).toBe(true);   // it opened (and so migrated) a database there
    });

    it("fails without git", async () => {
        freshInstall();
        stubTools({ status: null, stdout: "", stderr: "", error: new Error("spawnSync git ENOENT") });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(1);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "FAIL", "WARN", "WARN", "OK"]);
    });

    it("says which summary models are set in config.json (ADR-066)", async () => {
        const home = freshInstall();
        fs.mkdirSync(path.join(home, "data"), { recursive: true });
        fs.writeFileSync(path.join(home, "data", "config.json"), JSON.stringify({ summaryModels: { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } } }));
        stubTools({ status: 0, stdout: "git version 2.50.1\n", stderr: "" });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(0);
        expect(levels(logs).at(-1)).toBe("OK");
        expect(printed(logs)).toContain(`summary models: files claude-haiku-6 (set in ${path.join(home, "data", "config.json")}), folders claude-sonnet-5-5, the repo claude-sonnet-5-5`);
    });

    it("fails on a summary-models setting it can't use, saying what's wrong", async () => {
        const home = freshInstall();
        fs.mkdirSync(path.join(home, "data"), { recursive: true });
        fs.writeFileSync(path.join(home, "data", "config.json"), JSON.stringify({ summaryModels: { file: { model: "claude-zeta-1" } } }));
        stubTools({ status: 0, stdout: "git version 2.50.1\n", stderr: "" });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(1);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "OK", "WARN", "WARN", "FAIL"]);
        expect(printed(logs)).toContain("summaryModels.file.inputPerMTok");
    });

    // the pre-ship pass's final review, A-I2 (R25): a hand edit's trailing comma used to read as "the defaults", OK
    it("fails on a config.json it can't read, naming the file and the parse error, instead of reporting the defaults", async () => {
        const home = freshInstall();
        const file = path.join(home, "data", "config.json");
        fs.mkdirSync(path.join(home, "data"), { recursive: true });
        fs.writeFileSync(file, '{\n  "summaryModels": { "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 } },\n}\n');
        stubTools({ status: 0, stdout: "git version 2.50.1\n", stderr: "" });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(1);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "OK", "WARN", "WARN", "FAIL"]);
        expect(printed(logs)).toContain(`FAIL summary models: The summary models can't be read: ${file} isn't valid JSON (`);
        expect(printed(logs)).not.toContain("the defaults");
    });

    it("lists each config.json moved aside, as a WARN after the summary models", async () => {
        const home = freshInstall();
        const data = path.join(home, "data");
        fs.mkdirSync(data, { recursive: true });
        const aside = path.join(data, "config.json.invalid-2026-10-25T13-50-12-345Z");
        fs.writeFileSync(aside, '{ "port": 4000, }');
        stubTools({ status: 0, stdout: "git version 2.50.1\n", stderr: "" });
        const logs = vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await runDoctor()).toBe(0);
        expect(levels(logs)).toEqual(["OK", "OK", "OK", "WARN", "OK", "WARN", "WARN", "OK", "WARN"]);
        expect(printed(logs)).toContain(`WARN ${aside} is a config.json that couldn't be read, moved aside when the settings were written again: copy what you need from it into ${path.join(data, "config.json")}, then delete it`);
    });
});
