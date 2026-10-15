import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { copyFixture } from "../test/helpers/fixture";
import { makeTempDir } from "../test/helpers/temp";
import type { LiveEvent } from "../lib/contracts";
import { writeConfig } from "../lib/config";
import { getDb } from "../lib/db/client";
import { repoKey } from "../lib/index/paths";
import { indexRepository } from "../lib/index/pipeline";
import { refreshSummaryStatus } from "../lib/index/summarize/status";
import { SERVER_INSTRUCTIONS, TOOLS } from "../lib/tools/registry";
import { createServer, keepStdoutForProtocol, SERVER_VERSION, type ServerOptions } from "./server";

beforeAll(() => { getDb(); });   // before any test moves NEBULOSITY_HOME (lib/engine/repos.test.ts explains)
const original = process.env.NEBULOSITY_HOME;
afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
});

const AT = new Date("2026-10-13T12:00:00.000Z");
type Posted = { event: LiveEvent; port: number };
type CallResult = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (result: CallResult): string => (result.content as { type: string; text: string }[])[0].text;

/** A fixture copy indexed with no key, in a home of its own whose config says the Map shows it on `port`. */
function mapShowing(port = 4321): string {
    process.env.NEBULOSITY_HOME = makeTempDir("neb-mcp-");
    const root = copyFixture();
    indexRepository(root);
    refreshSummaryStatus(root, { summarizerAvailable: false });
    writeConfig({ activeRepo: repoKey(root), port });
    return root;
}

/** A client talking to createServer over an in-memory pair; `posted` records every live event (unless `post` replaces the recorder). */
async function connect(options: Omit<ServerOptions, "now"> & { mapAnswers?: boolean }){
    const posted: Posted[] = [];
    const server = createServer({
        ...options,
        now: () => AT,
        post: options.post ?? (async (event, port) => { posted.push({ event, port }); return options.mapAnswers ?? true; }),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "server-test", version: "1" });
    await client.connect(clientSide);
    onTestFinished(() => client.close());
    return { client, posted };
}

describe("the MCP server", () => {
    it("serves the registry's seven tools, read-only, the six that answer questions marked always loaded, with its instructions and version", async () => {
        const { client } = await connect({ projectDir: mapShowing(), live: true });
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
        for (const tool of tools){
            expect(tool.description).toBe(TOOLS.find((t) => t.name === tool.name)!.description);
            expect(tool.inputSchema.type).toBe("object");
            expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
            const entry = TOOLS.find((t) => t.name === tool.name)!;
            expect(tool._meta).toEqual(entry.alwaysLoad ? { "anthropic/alwaysLoad": true } : { "anthropic/searchHint": entry.searchHint });
        }
        expect(tools.find((t) => t.name === "describe")!.inputSchema.properties).toHaveProperty("path");
        expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
        expect(client.getServerVersion()).toMatchObject({ name: "nebulosity", version: SERVER_VERSION });
    });

    it("answers with the registry's text, and pulses the Map once on its port", async () => {
        const root = mapShowing();
        const { client, posted } = await connect({ projectDir: root, live: true });
        // the fixture is indexed with no key, so this is the ground truth's free-mode `describe src/core`
        expect(textOf(await client.callTool({ name: "describe", arguments: { path: "src/core" } }))).toBe([
            "src/core/ — folder: 2 files, 10 lines.",
            "Summary: none — summaries are off (no ANTHROPIC_API_KEY); a key adds a short summary of every file and folder.",
            "Inside (2):", "  log.ts", "  index.ts",
            "Uses: nothing outside it.",
            "Used by (3 imports):", "  src/app/  1", "  src/index.ts  1", "  src/util/  1",
        ].join("\n"));
        expect(posted).toEqual([{ event: { tool: "describe", paths: ["src/core"], at: AT.toISOString() }, port: 4321 }]);
    });

    it("answers a call even when the live poster rejects (the pulse is fire and forget)", async () => {
        // an unhandled rejection kills a Node 24 process, and Vitest fails the run on one, so without the .catch this fails
        const { client } = await connect({ projectDir: mapShowing(), live: true, post: async () => { throw new Error("down"); } });
        const result = await client.callTool({ name: "describe", arguments: { path: "src/core" } });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toMatch(/^src\/core\/ — folder: 2 files, 10 lines\.\n/);
        // give a stray rejection its turn to surface before the test ends
        await new Promise((resolve) => setTimeout(resolve, 20));
    });

    it("show_on_map waits for the Map and says what became of the event", async () => {
        const root = mapShowing();
        const highlight = { name: "show_on_map", arguments: { paths: ["src/core"] } };

        const shown = await connect({ projectDir: root, live: true });
        expect(textOf(await shown.client.callTool(highlight)).split("\n").at(-1)).toBe("Sent to the Map at http://localhost:4321; any open Map tab shows it.");
        expect(shown.posted[0].event).toEqual({ tool: "show_on_map", paths: ["src/core"], at: AT.toISOString(), action: { type: "highlight_nodes", nodeIds: ["src/core"] } });

        const unanswered = await connect({ projectDir: root, live: true, mapAnswers: false });
        expect(textOf(await unanswered.client.callTool(highlight)))
            .toContain("No Map answered at http://localhost:4321, so nothing is shown.");

        const off = await connect({ projectDir: root, live: false });
        expect(textOf(await off.client.callTool(highlight))).toContain("Nothing was sent: live updates are off in this session (NEBULOSITY_LIVE=off).");
        expect(off.posted).toEqual([]);
    });

    it("sends nothing about a repo the Map isn't showing, and says so", async () => {
        const root = mapShowing();
        const other = copyFixture();
        indexRepository(other);
        writeConfig({ activeRepo: repoKey(other), port: 4321 });
        const { client, posted } = await connect({ projectDir: root, live: true });
        await client.callTool({ name: "describe", arguments: { path: "src" } });
        expect(textOf(await client.callTool({ name: "show_on_map", arguments: { paths: ["src"] } })))
            .toContain(`Nothing was sent: the Map shows ${path.basename(other)}, not ${path.basename(root)}.`);
        expect(posted).toEqual([]);
    });

    it("returns engine errors and bad input as error results", async () => {
        const { client, posted } = await connect({ projectDir: mapShowing(), live: true });
        const missing = await client.callTool({ name: "describe", arguments: { path: "src/nope.ts" } });
        expect(missing.isError).toBe(true);
        expect(textOf(missing)).toBe('Nothing is indexed at "src/nope.ts".');
        const whole = await client.callTool({ name: "imports", arguments: { path: "" } });
        expect(whole.isError).toBe(true);
        expect(textOf(whole)).toBe("Pass a folder or a file: the whole repo has nothing outside it.");
        const invalid = await client.callTool({ name: "imports", arguments: { path: "src", limit: 0 } });
        expect(invalid.isError).toBe(true);
        expect(textOf(invalid)).toContain("Input validation error");
        expect(posted).toEqual([]);
    });

    it("says nothing is indexed, and where Nebulosity lives, when no repo can be chosen", async () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-mcp-");
        writeConfig({ activeRepo: null, port: 4321 });
        const { client } = await connect({ projectDir: makeTempDir("neb-elsewhere-"), live: true });
        const result = await client.callTool({ name: "overview", arguments: {} });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(`No repository indexed yet. Run nebulosity index <path-to-repo> (in a checkout: npm run index -- <path-to-repo>). (Nebulosity's folder: ${process.env.NEBULOSITY_HOME}.)`);
    });

    it("keeps stdout for the protocol: log, info, debug, dir and dirxml go through console.error", () => {
        // Vitest routes console output through its own streams, so this spies on console.error, not on process.stderr;
        // that a real process's stdout carries nothing else is mcp/stdio.test.ts's job (Review Focus 1)
        const saved = { log: console.log, info: console.info, debug: console.debug, dir: console.dir, dirxml: console.dirxml };
        const toError = vi.spyOn(console, "error").mockImplementation(() => {});
        try{
            keepStdoutForProtocol();
            console.log("a");
            console.info("b");
            console.debug("c");
            console.dir({ a: 1 });
            console.dirxml("d");
            expect(toError.mock.calls).toEqual([["a"], ["b"], ["c"], ["{ a: 1 }"], ["d"]]);
        } finally{
            Object.assign(console, saved);
            toError.mockRestore();
        }
    });

    it("reports package.json's version", () => {
        expect(SERVER_VERSION).toBe(JSON.parse(fs.readFileSync("package.json", "utf8")).version);
    });
});
