/**
 * The MCP adapter (PIVOT_SPEC.md §6.2, ADR-030): the tool registry, served to Claude Code and any MCP client over stdio.
 * Thin by rule (§3, rule 2): each call picks its repo, runs one registry entry, posts one live event, and returns text.
 */
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { LiveEvent } from "../lib/contracts";
import { useReadOnlyDatabase } from "../lib/db/client";
import { errorResponseFor } from "../lib/engine/errors";
import { nebulosityHome } from "../lib/home";
import { postLiveEvent } from "../lib/live/client";
import { SERVER_INSTRUCTIONS, TOOLS } from "../lib/tools/registry";
import { setupCall } from "../lib/tools/repo";
import { deliveryNote, type MapDelivery } from "../lib/tools/text";

/** package.json's version (a test keeps them equal). */
export const SERVER_VERSION = "0.1.0";

/** Sends one live event to the Map's server on `port`; true when it took it (lib/live/client.ts). */
export type LivePoster = (event: LiveEvent, port: number) => Promise<boolean>;

export type ServerOptions = {
    /** The folder Claude Code runs in: it picks the repo (ADR-046). */
    projectDir: string;
    /** false: never post a live event (NEBULOSITY_LIVE=off), for benchmarks and smoke tests while a Map is open. */
    live: boolean;
    post?: LivePoster;
    now?: () => Date;
};

export function createServer(options: ServerOptions): McpServer {
    const server = new McpServer({ name: "nebulosity", version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
    const post: LivePoster = options.post ?? ((event, port) => postLiveEvent(event, { port }));
    const now = options.now ?? (() => new Date());

    for (const tool of TOOLS){
        server.registerTool(
            tool.name,
            { description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
            async (input) => {
                try{
                    const call = setupCall(options.projectDir);
                    const output = await tool.handler(input, call.context);
                    const event: LiveEvent = { tool: tool.name, paths: output.paths, at: now().toISOString(), ...(output.action ? { action: output.action } : {}) };

                    if (!output.action){
                        // a pulse on the open Map: fire and forget, so no answer waits on it
                        if (options.live && call.live.allowed) void post(event, call.live.port);
                        return { content: [{ type: "text" as const, text: output.text }] };
                    }

                    // show_on_map says what became of its event, so it waits (at most the poster's 200 ms)
                    const delivery: MapDelivery = !options.live ? "live-off"
                        : !call.live.allowed ? "other-repo"
                        : (await post(event, call.live.port)) ? "shown" : "no-map";
                    const note = deliveryNote(delivery, { port: call.live.port, mapRepo: call.live.mapRepo, repo: path.basename(call.context.repoRoot) });
                    return { content: [{ type: "text" as const, text: `${output.text}\n${note}` }] };
                } catch (err){
                    return { content: [{ type: "text" as const, text: errorText(err) }], isError: true };
                }
            },
        );
    }

    return server;
}

/** An error as one sentence for the model. Unexpected ones are logged to stderr with their stack. */
export function errorText(err: unknown): string {
    const { status, error } = errorResponseFor(err);
    if (status === 500) console.error(err);
    return error.code === "INDEX_EMPTY" ? `${error.message} (Nebulosity's folder: ${nebulosityHome()}.)` : error.message;
}

/** stdout carries the protocol, so anything else written there breaks it: console output goes to stderr (ADR-048). */
export function keepStdoutForProtocol(): void {
    const toStderr = (...args: unknown[]): void => console.error(...args);
    console.log = toStderr;
    console.info = toStderr;
    console.debug = toStderr;
}

/** The stdio entry point that mcp/launch.mjs runs. */
export async function main(): Promise<void> {
    keepStdoutForProtocol();
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a database mode switch, not a React hook; the name only starts with "use"
    useReadOnlyDatabase();
    const server = createServer({ projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(), live: process.env.NEBULOSITY_LIVE !== "off" });
    // a client stops us by closing stdin (Claude Code on Windows then kills the process tree after 300 ms): leave at once
    process.stdin.on("end", () => {
        void server.close().finally(() => process.exit(0));
    });
    await server.connect(new StdioServerTransport());
}
