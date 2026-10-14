import { describe, expect, it } from "vitest";
import type { RunSummary } from "./transcript";
import { firstInitLine, infrastructureFailure, resultNotes, validateInit } from "./validate";

const GOOD: RunSummary = {
    model: "claude-sonnet-5-5", claudeVersion: "2.1.299", apiKeySource: "none", permissionMode: "dontAsk",
    tools: ["Bash", "Read", "Grep", "Glob", "Agent", "ToolSearch"], mcpServers: [{ name: "nebulosity", status: "connected" }],
    plugins: ["cc-plugin-agents-md"], skills: 0, finalText: "x", subtype: "success", isError: false, turns: 3, durationMs: 1, apiMs: 1, costUsd: 0.1,
    usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
    models: { "claude-sonnet-5-5": { costUsd: 0.1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    toolCalls: {}, nestedToolCalls: {}, toolErrors: 0, toolSearchCalls: 0, nebulosityCalls: 0, utilization: { fiveHour: 0.4, sevenDay: 0.6 },
};
const EXPECT = { arm: "nebulosity" as const, model: "claude-sonnet-5-5", claudeVersion: "2.1.299", forbiddenPlugins: ["superpowers", "context7"] };

describe("validateInit", () => {
    it("accepts the agreed setup", () => {
        expect(validateInit(GOOD, EXPECT)).toEqual([]);
        expect(validateInit({ ...GOOD, mcpServers: [] }, { ...EXPECT, arm: "baseline" })).toEqual([]);
    });

    it("refuses a run on a different Claude Code version", () => {
        expect(validateInit({ ...GOOD, claudeVersion: "2.1.300" }, EXPECT)).toEqual(["Claude Code is 2.1.300, not 2.1.299"]);
    });

    it("names every way a run differs from the agreed setup", () => {
        const bad = { ...GOOD, model: "claude-opus-5-5", apiKeySource: "ANTHROPIC_API_KEY", permissionMode: "default", plugins: ["superpowers"],
            mcpServers: [{ name: "nebulosity", status: "connected" }, { name: "component-explorer", status: "connected" }],
            tools: ["Read", "Grep", "Glob", "WebFetch", "Skill", "PowerShell"] };
        expect(validateInit(bad, EXPECT)).toEqual([
            "model is claude-opus-5-5, not claude-sonnet-5-5",
            "permission mode is default, not dontAsk",
            "an API key is in use (ANTHROPIC_API_KEY), not the subscription",
            "MCP servers are [nebulosity:connected, component-explorer:connected], not [nebulosity:connected]",
            "the owner's plugin superpowers is loaded",
            "Bash is missing",
            "WebFetch is present",
            "Skill is present",
            "PowerShell is present",
        ]);
    });
});

describe("resultNotes", () => {
    it("notes a model outside the expected ones and an error ending", () => {
        expect(resultNotes(GOOD, ["claude-sonnet-5-5", "claude-haiku-5-5"])).toEqual([]);
        expect(resultNotes({ ...GOOD, subtype: "error_max_turns", isError: true, models: { ...GOOD.models, "claude-sonnet-5": GOOD.models["claude-sonnet-5-5"] } },
            ["claude-sonnet-5-5", "claude-haiku-5-5"])).toEqual(["model claude-sonnet-5 also answered (a fallback?)", "ended with error_max_turns"]);
    });
});

describe("infrastructureFailure", () => {
    const init = JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5-5" });
    const done = JSON.stringify({ type: "result", subtype: "success", is_error: false, api_error_status: null, result: "x" });
    const limited = JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "limit" });
    const tooLong = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, api_error_status: null });

    it("is null for a run that finished, even one that ran out of turns: that's an answer, not an outage", () => {
        expect(infrastructureFailure([init, done].join("\n"))).toBeNull();
        expect(infrastructureFailure([init, "not json", tooLong, ""].join("\n"))).toBeNull();
    });

    it("names an API error, a transcript that ends without a result, and one that never started", () => {
        expect(infrastructureFailure([init, limited].join("\n"))).toBe("the API returned an error (429)");
        expect(infrastructureFailure(init)).toBe("the transcript has no result line (the run was killed, crashed or timed out)");
        expect(infrastructureFailure("")).toBe("the transcript has no result line (the run was killed, crashed or timed out)");
        expect(infrastructureFailure(done)).toBe("the transcript has no init message");
    });

    it("counts a final message that is an error, with no status, as an outage: Claude Code writes its own API errors as a success that is_error", () => {
        const connection = JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: null, result: "API Error: Connection error." });
        expect(infrastructureFailure([init, connection].join("\n"))).toBe("the run ended on an error message, not an answer (API Error: Connection error.)");
        // the limits are answers that scored 0 even though is_error is true, and a success that isn't an error is an answer
        expect(infrastructureFailure([init, JSON.stringify({ type: "result", subtype: "error_max_budget_usd", is_error: true, api_error_status: null })].join("\n"))).toBeNull();
        expect(infrastructureFailure([init, JSON.stringify({ type: "result", subtype: "success", is_error: false, api_error_status: null, result: "API Error: is this text" })].join("\n"))).toBeNull();
    });
});

describe("firstInitLine", () => {
    const hook = JSON.stringify({ type: "system", subtype: "hook_started", hook_name: "SessionStart" });
    const init = JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5-5", tools: ["Bash"] });
    const assistant = JSON.stringify({ type: "assistant", message: { content: [] } });

    it("finds the first init line, after hook events and lines that aren't JSON", () => {
        expect(firstInitLine([hook, "not json", init, assistant].join("\n"))).toBe(init);
        expect(firstInitLine(`${hook}\r\n${init}\r\n`)).toBe(init);
        // a complete line needs no newline after it: JSON that parses as an object has all of its braces
        expect(firstInitLine(`${hook}\n${init}`)).toBe(init);
    });

    it("waits (null) when the init isn't all there yet: no text, no init, a last line cut short", () => {
        expect(firstInitLine("")).toBeNull();
        expect(firstInitLine([hook, assistant].join("\n"))).toBeNull();
        expect(firstInitLine(`${hook}\n${init.slice(0, 40)}`)).toBeNull();
        // only a system event of subtype init counts
        expect(firstInitLine(JSON.stringify({ type: "assistant", subtype: "init" }))).toBeNull();
    });

    it("returns the first of two init lines", () => {
        const second = JSON.stringify({ type: "system", subtype: "init", model: "other" });
        expect(firstInitLine([init, second].join("\n"))).toBe(init);
    });
});
