import { describe, expect, it } from "vitest";
import { summarizeRun } from "./transcript";

const LINES: unknown[] = [
    { type: "system", subtype: "init", model: "claude-sonnet-5-5", claude_code_version: "2.1.296", apiKeySource: "none", permissionMode: "dontAsk",
      tools: ["Bash", "Read", "Grep", "Glob", "Agent", "ToolSearch"], mcp_servers: [{ name: "nebulosity", status: "connected", source: "dynamic" }],
      plugins: [{ name: "cc-plugin-agents-md", path: "x" }], skills: [] },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "Grep", input: {} }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "…" }] } },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t2", name: "ToolSearch", input: {} }] } },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t3", name: "mcp__nebulosity__dependents", input: {} }, { type: "tool_use", id: "t4", name: "Agent", input: {} }] } },
    { type: "assistant", parent_tool_use_id: "t4", message: { content: [{ type: "tool_use", id: "t5", name: "Read", input: {} }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t5", is_error: true, content: "denied" }] } },
    { type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.41 }, seven_day: { utilization: 0.6 } } } },
    "not json",
    { type: "result", subtype: "success", is_error: false, num_turns: 6, duration_ms: 42000, duration_api_ms: 30000, total_cost_usd: 0.31,
      usage: { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 50000, output_tokens: 900 },
      modelUsage: {
          "claude-sonnet-5-5": { inputTokens: 10, outputTokens: 900, cacheReadInputTokens: 50000, cacheCreationInputTokens: 2000, costUSD: 0.29 },
          "claude-haiku-5-5": { inputTokens: 5, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 300, costUSD: 0.02 },
      },
      result: "Done.\nANSWER:\nsrc/a.ts" },
];
const JSONL = LINES.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");

describe("summarizeRun", () => {
    it("counts tool calls top-level and in subagents, errors, tool search, and reads the result and the usage windows", () => {
        expect(summarizeRun(JSONL)).toEqual({
            model: "claude-sonnet-5-5", claudeVersion: "2.1.296", apiKeySource: "none", permissionMode: "dontAsk",
            tools: ["Bash", "Read", "Grep", "Glob", "Agent", "ToolSearch"], mcpServers: [{ name: "nebulosity", status: "connected" }],
            plugins: ["cc-plugin-agents-md"], skills: 0,
            finalText: "Done.\nANSWER:\nsrc/a.ts", subtype: "success", isError: false, turns: 6, durationMs: 42000, apiMs: 30000, costUsd: 0.31,
            usage: { input: 10, cacheWrite: 2000, cacheRead: 50000, output: 900 }, firstCallContext: null,
            models: {
                "claude-sonnet-5-5": { costUsd: 0.29, input: 10, output: 900, cacheRead: 50000, cacheWrite: 2000 },
                "claude-haiku-5-5": { costUsd: 0.02, input: 5, output: 50, cacheRead: 0, cacheWrite: 300 },
            },
            toolCalls: { Grep: 1, ToolSearch: 1, mcp__nebulosity__dependents: 1, Agent: 1 }, nestedToolCalls: { Read: 1 },
            toolErrors: 1, toolSearchCalls: 1, nebulosityCalls: 1,
            utilization: { fiveHour: 0.41, sevenDay: 0.6 },
        });
    });
});

describe("firstCallContext", () => {
    it("is the first assistant message's input, cache writes and cache reads", () => {
        const lines = [
            JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5-5" }),
            JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 2478, cache_read_input_tokens: 18606, output_tokens: 24 } } }),
            JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 471, cache_read_input_tokens: 21084, output_tokens: 24 } } }),
            JSON.stringify({ type: "result", subtype: "success", num_turns: 2 }),
        ].join("\n");
        expect(summarizeRun(lines).firstCallContext).toBe(21086);
    });

    it("is null when no assistant message reported usage", () => {
        expect(summarizeRun(JSON.stringify({ type: "result", subtype: "success" })).firstCallContext).toBeNull();
    });
});
