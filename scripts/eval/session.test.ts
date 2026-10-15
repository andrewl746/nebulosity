import { validateInit } from "./validate";
import { describe, expect, it } from "vitest";
import { resultCount, scheduleSessions, sessionInitProblems, sessionOutage, sessionProblems, summarizeSession, userMessage } from "./session";

/**
 * A hand-made two-message session in the shape the probe run of Task 9 showed (docs: task-9-report.md), with round numbers:
 * one process, one init message and one result per message, the user's message replayed first. Figures in each result:
 *   total_cost_usd and duration_api_ms are CUMULATIVE over the session (0.02, then 0.03; 4000, then 9000);
 *   duration_ms and num_turns are PER MESSAGE (6000 then 5000; 3 then 2);
 *   usage is per message too.
 */
const line = (event: unknown): string => JSON.stringify(event);
const init = { type: "system", subtype: "init", model: "claude-sonnet-5-5", claude_code_version: "2.1.300", apiKeySource: "none", permissionMode: "dontAsk", tools: ["Bash"], mcp_servers: [], plugins: [], skills: [] };
const assistant = (content: unknown[], usage?: unknown): unknown => ({ type: "assistant", parent_tool_use_id: null, message: { content, usage } });
const toolUse = (id: string, name: string): unknown => ({ type: "tool_use", id, name, input: {} });
const turnOne = [
    init,
    { type: "user", isReplay: true, message: { role: "user", content: "first question" } },
    assistant([toolUse("a", "Write")], { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20000, output_tokens: 16 }),
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", is_error: false, content: "ok" }] } },
    assistant([toolUse("b", "Bash")], { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 21000, output_tokens: 9 }),
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", is_error: false, content: "42" }] } },
    assistant([{ type: "text", text: "It printed 42." }], { input_tokens: 2, cache_creation_input_tokens: 50, cache_read_input_tokens: 21100, output_tokens: 8 }),
    { type: "result", subtype: "success", is_error: false, result: "It printed 42.", num_turns: 3, duration_ms: 6000, duration_api_ms: 4000, total_cost_usd: 0.02 },
];
const turnTwo = [
    init,
    { type: "user", isReplay: true, message: { role: "user", content: "second question" } },
    assistant([toolUse("c", "Write"), toolUse("d", "mcp__nebulosity__search")], { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 21500, output_tokens: 20 }),
    { type: "system", subtype: "permission_denied" },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c", is_error: true, content: "denied" }] } },
    assistant([{ type: "text", text: "No, I could not." }], { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 21800, output_tokens: 7 }),
    { type: "result", subtype: "success", is_error: false, result: "No, I could not.", num_turns: 2, duration_ms: 5000, duration_api_ms: 9000, total_cost_usd: 0.03 },
];
const SESSION = [...turnOne, ...turnTwo].map(line).join("\n");

describe("userMessage", () => {
    it("is exactly one stream-json input line, without the newline", () => {
        expect(userMessage("hi")).toBe('{"type":"user","message":{"role":"user","content":"hi"}}');
        expect(userMessage('say "x"\nthen stop')).toBe('{"type":"user","message":{"role":"user","content":"say \\"x\\"\\nthen stop"}}');
    });
});

describe("resultCount", () => {
    it("counts result events whatever their key order, and skips lines that are not JSON", () => {
        expect(resultCount(SESSION)).toBe(2);
        expect(resultCount(`${SESSION}\n{"is_error":false,"type":"result"}\nnot json\n{"type":"result"`)).toBe(3);
        expect(resultCount("")).toBe(0);
    });
});

describe("summarizeSession", () => {
    it("reads one entry per result: the final text, that message's own cost (the difference of the cumulative totals), its time and its tool calls", () => {
        const s = summarizeSession(SESSION);
        expect(s.turns).toHaveLength(2);
        expect(s.turns[0].finalText).toBe("It printed 42.");
        expect(s.turns[1].finalText).toBe("No, I could not.");
        // cumulative 0.02 then 0.03: the second message cost 0.03 - 0.02
        expect(s.turns[0].costUsd).toBeCloseTo(0.02, 10);
        expect(s.turns[1].costUsd).toBeCloseTo(0.01, 10);
        // duration_ms is per message already
        expect(s.turns.map((t) => t.durationMs)).toEqual([6000, 5000]);
        expect(s.turns[0].toolCalls).toEqual({ Write: 1, Bash: 1 });
        expect(s.turns[1].toolCalls).toEqual({ Write: 1, mcp__nebulosity__search: 1 });
        expect(s.turns.map((t) => t.nebulosityCalls)).toEqual([0, 1]);
    });

    it("totals: the last cumulative cost, the sum of the messages' times, and the first call's context of the whole session", () => {
        const s = summarizeSession(SESSION);
        expect(s.costUsd).toBeCloseTo(0.03, 10);
        expect(s.durationMs).toBe(11000);
        // the first assistant message of the session: 2 + 1000 + 20000
        expect(s.firstCallContext).toBe(21002);
    });

    it("has no turns and no context for an empty transcript, and a message still waiting for its result is not a turn", () => {
        expect(summarizeSession("")).toEqual({ turns: [], costUsd: 0, durationMs: 0, firstCallContext: null });
        const cut = [...turnOne, ...turnTwo.slice(0, -1)].map(line).join("\n");
        expect(summarizeSession(cut).turns).toHaveLength(1);
    });
});

describe("sessionOutage", () => {
    it("is an outage when fewer results came back than messages were sent, even though the last result is a success", () => {
        const one = turnOne.map(line).join("\n");
        expect(sessionOutage(one, 2)).toMatch(/1 of 2/);
        expect(sessionOutage("", 2)).toMatch(/0 of 2/);
    });

    it("else says what infrastructureFailure says: nothing for a whole session, the API error of a failed last result", () => {
        expect(sessionOutage(SESSION, 2)).toBeNull();
        const failed = [...turnOne, ...turnTwo.slice(0, -1), { type: "result", subtype: "success", is_error: true, api_error_status: 529, result: "overloaded" }].map(line).join("\n");
        expect(sessionOutage(failed, 2)).toMatch(/API returned an error \(529\)/);
    });
});

describe("scheduleSessions", () => {
    it("alternates which arm goes first by session and by repeat, as single runs do, with no up-front arm", () => {
        const names = scheduleSessions(["s1", "s2"], 2).map((r) => `${r.question}-${r.arm}-${r.repeat}`);
        expect(names).toEqual([
            "s1-baseline-1", "s1-nebulosity-1", "s2-nebulosity-1", "s2-baseline-1",
            "s1-nebulosity-2", "s1-baseline-2", "s2-baseline-2", "s2-nebulosity-2",
        ]);
    });
});

describe("sessionProblems", () => {
    const questions = [{ id: "q1", repo: "vscode" }, { id: "q2", repo: "vscode" }, { id: "q3", repo: "affine" }];
    const repos = ["vscode", "affine"];
    it("accepts sessions whose questions exist and belong to the session's repo", () => {
        expect(sessionProblems({ sessions: [{ id: "s1", repo: "vscode", title: "t", questions: ["q1", "q2"] }] }, questions, repos)).toEqual([]);
    });
    it("names a missing question, another repo's question, an unknown repo, a repeated id and an empty session", () => {
        const problems = sessionProblems({ sessions: [
            { id: "s1", repo: "vscode", title: "t", questions: ["q1", "q9"] },
            { id: "s2", repo: "vscode", title: "t", questions: ["q3"] },
            { id: "s3", repo: "nowhere", title: "t", questions: ["q1"] },
            { id: "s1", repo: "vscode", title: "t", questions: ["q2"] },
            { id: "s5", repo: "vscode", title: "t", questions: [] },
        ] }, questions, repos);
        expect(problems).toHaveLength(6);
        expect(problems[0]).toMatch(/s1.*q9/);
        expect(problems[1]).toMatch(/s2.*q3.*affine/);
        expect(problems[2]).toMatch(/s3.*nowhere/);
        expect(problems[3]).toMatch(/s3 is over nowhere but asks q1/);
        expect(problems[4]).toMatch(/s1.*twice/);
        expect(problems[5]).toMatch(/s5.*no questions/);
    });
});

describe("sessionOutage in the middle of a session", () => {
    const mid = (first: unknown, second: unknown = turnTwo[turnTwo.length - 1]): string =>
        [...turnOne.slice(0, -1), first, ...turnTwo.slice(0, -1), second].map(line).join("\n");
    const ok1 = turnOne[turnOne.length - 1];

    it("names a message whose result is an API error even when the last one succeeded", () => {
        const text = mid({ type: "result", subtype: "success", is_error: true, api_error_status: 529, result: "overloaded" });
        expect(sessionOutage(text, 2)).toBe("message 1 of 2: the API returned an error (529)");
        expect(sessionOutage(mid({ type: "result", subtype: "success", is_error: true, result: "API Error: Connection error." }), 2)).toMatch(/^message 1 of 2: the run ended on an error message/);
        expect(sessionOutage(mid(ok1), 2)).toBeNull();
    });

    it("does not call a message that hit its turn or budget limit an outage", () => {
        const limit = { type: "result", subtype: "error_max_turns", is_error: true, result: "" };
        expect(sessionOutage(mid(limit), 2)).toBeNull();
        // the process ended after the limited message and nothing followed: still a missing result, not a limit
        expect(sessionOutage([...turnOne.slice(0, -1), limit].map(line).join("\n"), 1)).toBeNull();
    });

    it("refuses more results than messages sent", () => {
        const three = [...turnOne, ...turnTwo, ...turnOne].map(line).join("\n");
        expect(sessionOutage(three, 2)).toMatch(/3 results for 2 messages/);
    });
});

describe("sessionInitProblems", () => {
    const expect_ = { arm: "nebulosity" as const, model: "claude-sonnet-5-5", claudeVersion: "2.1.300", forbiddenPlugins: [], scripts: false };
    const connected = { ...init, tools: ["Bash", "Read", "Grep", "Glob"], mcp_servers: [{ name: "nebulosity", status: "connected" }] };
    const dropped = { ...connected, mcp_servers: [] };
    const build = (second: unknown): string => [connected, ...turnOne.slice(1), second, ...turnTwo.slice(1)].map(line).join("\n");

    it("is empty when every message's init matches", () => {
        expect(sessionInitProblems(build(connected), (i) => validateInit(i, expect_))).toEqual([]);
    });
    it("names the message whose init lacks nebulosity: connected", () => {
        const problems = sessionInitProblems(build(dropped), (i) => validateInit(i, expect_));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBe("message 2: MCP servers are [], not [nebulosity:connected]");
    });
});
