import { execFileSync, spawn } from "child_process";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it, onTestFinished } from "vitest";
import { copyFixture } from "../test/helpers/fixture";
import { makeTempDir } from "../test/helpers/temp";
import type { LiveEvent } from "../lib/contracts";

const CHECKOUT = path.resolve(".");
const LAUNCHER = path.join(CHECKOUT, "mcp", "launch.mjs");
const S = "Summary: none — summaries are off (no ANTHROPIC_API_KEY); a key adds a short summary of every file and folder.";

/**
 * This process's environment for a child, minus what would change its behaviour: Vitest's markers (a child that sees
 * VITEST opens an in-memory database), an API key, live settings, and Claude Code's own project folder. Then the home
 * and the project folder this test chose.
 */
function childEnv(home: string, projectDir: string): Record<string, string> & NodeJS.ProcessEnv {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)){
        if (value === undefined || key.startsWith("VITEST") || ["ANTHROPIC_API_KEY", "NEBULOSITY_LIVE", "CLAUDE_PROJECT_DIR", "NEBULOSITY_HOME"].includes(key)) continue;
        env[key] = value;
    }
    // Next's types make NODE_ENV a required key of ProcessEnv; the StdioClientTransport wants a plain string record, so
    // this is both: the cast only satisfies the types, the copy above carries NODE_ENV if the parent has it
    env.NEBULOSITY_HOME = home;
    env.CLAUDE_PROJECT_DIR = projectDir;
    return env as Record<string, string> & NodeJS.ProcessEnv;
}

/** A Nebulosity home of its own: this checkout's migrations, and no database yet. */
function freshHome(): string {
    const home = makeTempDir("neb-mcp-home-");
    fs.cpSync(path.join(CHECKOUT, "lib", "db", "migrations"), path.join(home, "lib", "db", "migrations"), { recursive: true });
    return home;
}

/** npm run index, as a user runs it, into `home`. */
function indexInto(home: string, repo: string): void {
    execFileSync(process.execPath, ["--import", "tsx", path.join(CHECKOUT, "scripts", "index.ts"), repo], { cwd: CHECKOUT, env: childEnv(home, repo), stdio: "pipe" });
}

/** A stand-in for the Map's server: answers POST /api/live with 204 and keeps the events. */
async function fakeMap(): Promise<{ port: number; events: LiveEvent[] }> {
    const events: LiveEvent[] = [];
    const server = http.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
            if (request.method === "POST" && request.url === "/api/live") events.push(JSON.parse(body) as LiveEvent);
            response.statusCode = 204;
            response.end();
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    return { port: (server.address() as AddressInfo).port, events };
}

async function waitFor(done: () => boolean, ms = 3_000): Promise<void> {
    const until = Date.now() + ms;
    while (!done() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
}

type CallResult = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (result: CallResult): string => (result.content as { type: string; text: string }[])[0].text;

describe("the MCP server over stdio (node mcp/launch.mjs)", () => {
    it("starts before anything is indexed, then answers every tool read-only and tells the Map", async () => {
        const home = freshHome();
        const repo = copyFixture();
        // The fake Map comes first and the config names its port before the server starts, so no call can post to port 3000
        // (the Map a developer may have open). readConfig falls back to 3000 on a missing or malformed file; the seeded one
        // never lets it.
        const map = await fakeMap();
        expect(map.port).not.toBe(3000);
        const configFile = path.join(home, ".nebulosity", "config.json");
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify({ activeRepo: null, port: map.port }));
        const transportErrors: Error[] = [];
        const client = new Client({ name: "stdio-test", version: "1" });
        client.onerror = (err) => transportErrors.push(err);
        const transport = new StdioClientTransport({ command: process.execPath, args: [LAUNCHER], cwd: repo, env: childEnv(home, repo), stderr: "pipe" });
        // read the server's stderr as it comes, so a full pipe can never stall it; failures print it
        let serverLog = "";
        transport.stderr?.on("data", (chunk) => { serverLog += String(chunk); });
        await client.connect(transport);
        onTestFinished(() => client.close());

        // nothing indexed: the tools are listed, and the answer says what to do
        expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["overview", "describe", "search", "dependents", "dependencies", "path", "show_on_map"]);
        const early = await client.callTool({ name: "overview", arguments: {} });
        expect(early.isError).toBe(true);
        expect(textOf(early)).toMatch(/^No repository indexed yet/);

        // the user indexes; the same server answers, no restart
        indexInto(home, repo);
        // npm run index keeps the port it found (scripts/index.ts writes { ...readConfig(), activeRepo }): still the fake Map's
        expect(JSON.parse(fs.readFileSync(configFile, "utf8")).port).toBe(map.port);

        expect(textOf(await client.callTool({ name: "overview", arguments: {} }))).toBe([
            `${path.basename(repo)}: 8 files, 48 lines, 11 imports between files.`,
            S,
            "Docs to read first:", "  README.md — mini-repo",
            "Areas, largest first:", "  src/  7 files, 45 lines", "  scripts/  1 file, 3 lines",
            "Most imported files:",
            "  src/app/main.ts  imported by 3", "  src/core/log.ts  imported by 3", "  src/util/strings.ts  imported by 2",
            "  src/app/view.tsx  imported by 1", "  src/core/index.ts  imported by 1", "  src/index.ts  imported by 1",
        ].join("\n"));

        const calls: [string, Record<string, unknown>][] = [
            ["describe", { path: "src/core" }],
            ["search", { query: "banner" }],
            ["dependents", { path: "src/core/log.ts", transitive: true }],
            ["dependencies", { path: "src/app/main.ts" }],
            ["path", { from: "scripts/build.js", to: "src/core/log.ts" }],
            ["show_on_map", { paths: ["src/core"] }],
        ];
        for (const [name, args] of calls){
            const result = await client.callTool({ name, arguments: args });
            expect(result.isError, `${name}: ${textOf(result)}\n${serverLog}`).toBeFalsy();
        }

        // one live event per answered call, the last carrying show_on_map's action
        await waitFor(() => map.events.length >= 7);
        expect(map.events.map((e) => e.tool).sort()).toEqual(["dependencies", "dependents", "describe", "overview", "path", "search", "show_on_map"]);
        expect(map.events.find((e) => e.tool === "show_on_map")).toMatchObject({ paths: ["src/core"], action: { type: "highlight_nodes", nodeIds: ["src/core"] } });
        // nothing but protocol on stdout (Review Focus 1): a stray line would have surfaced here as a parse error
        expect(transportErrors, serverLog).toEqual([]);
    }, 60_000);

    it("exits when the client closes stdin", async () => {
        const home = freshHome();
        const repo = copyFixture();
        const child = spawn(process.execPath, [LAUNCHER], { cwd: repo, env: childEnv(home, repo), stdio: ["pipe", "pipe", "pipe"] });
        child.stderr.resume();   // drained, so it can never fill and stall the server
        onTestFinished(() => { if (child.exitCode === null) child.kill(); });
        const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
        const answered = new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })}\n`);
        await answered;
        child.stdin.end();
        const code = await Promise.race([exited, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000))]);
        expect(code).toBe(0);
    }, 30_000);
});
