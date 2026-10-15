import { validateInit } from "./validate";
import { describe, expect, it } from "vitest";
import { scoreSession, type QuestionData, type ScoreContext } from "./score";
import { chosenSessions, feedStep, resultCount, scheduleSessions, sessionIndexFields, sessionInitProblems, sessionOutage, sessionProblems, summarizeSession, userMessage } from "./session";
import { summarizeRun } from "./transcript";

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
        expect(s.turns.map((t) => t.subtype)).toEqual(["success", "success"]);
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
        expect(summarizeSession("")).toEqual({ turns: [], costUsd: 0, durationMs: 0, firstCallContext: null, numTurns: 0, usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } });
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

describe("chosenSessions", () => {
    const ids = ["v-s1", "v-s2", "v-s3", "a-s1", "a-s2", "a-s3"];

    it("takes the definition's pilot sessions with --pilot, in the file's order, and schedules each once in each arm", () => {
        const chosen = chosenSessions(ids, { pilot: true, only: null, pilotSessions: ["a-s1", "v-s1"] });
        expect(chosen).toEqual(["v-s1", "a-s1"]);
        // one repeat: v-s1 is first in the file (A first), a-s1 fourth (N first)
        expect(scheduleSessions(chosen, 1, ids).map((r) => `${r.question}-${r.arm}-${r.repeat}`)).toEqual([
            "v-s1-baseline-1", "v-s1-nebulosity-1", "a-s1-nebulosity-1", "a-s1-baseline-1",
        ]);
    });

    it("takes --only's sessions, or every session with neither", () => {
        expect(chosenSessions(ids, { pilot: false, only: ["v-s2"], pilotSessions: ["v-s1"] })).toEqual(["v-s2"]);
        expect(chosenSessions(ids, { pilot: false, only: null, pilotSessions: ["v-s1"] })).toEqual(ids);
    });

    it("refuses a pilot with no sessions listed, and an id that isn't a session, each in a sentence", () => {
        expect(() => chosenSessions(ids, { pilot: true, only: null, pilotSessions: [] })).toThrow("eval.json lists no pilot sessions (pilotSessions)");
        expect(() => chosenSessions(ids, { pilot: true, only: null, pilotSessions: ["v-s9"] })).toThrow("no such session: v-s9. The sessions are v-s1, v-s2, v-s3, a-s1, a-s2, a-s3");
        expect(() => chosenSessions(ids, { pilot: false, only: ["x"], pilotSessions: [] })).toThrow("no such session: x.");
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

// ---- pre-freeze sweep B

/** A result event as Claude Code writes one (the probe's shape): per-message num_turns and usage, cumulative cost. */
const result = (subtype: string, text: string, turns: number, usage: { i: number; cw: number; cr: number; o: number }, total: number): unknown => ({
    type: "result", subtype, is_error: subtype !== "success", result: text, num_turns: turns, duration_ms: 1000, total_cost_usd: total,
    usage: { input_tokens: usage.i, cache_creation_input_tokens: usage.cw, cache_read_input_tokens: usage.cr, output_tokens: usage.o },
});
const work = (n: number): unknown[] => [init, { type: "user", isReplay: true, message: { role: "user", content: `question ${n}` } }, assistant([{ type: "text", text: "..." }])];

describe("sessionIndexFields: a session's index line sums its messages (sweep B, item 5)", () => {
    // message 1: 3 turns, usage 6 / 1150 / 62100 / 33, success; message 2: 2 turns, usage 4 / 310 / 43300 / 27, ran out of turns
    const raw = [
        ...work(1), result("success", "ANSWER:\nfirst", 3, { i: 6, cw: 1150, cr: 62100, o: 33 }, 0.02),
        ...work(2), result("error_max_turns", "", 2, { i: 4, cw: 310, cr: 43300, o: 27 }, 0.03),
    ].map(line).join("\n");

    it("gives the whole session's turns and usage, not the last message's, and names the message that hit its limit", () => {
        const fields = sessionIndexFields(summarizeRun(raw), summarizeSession(raw), { id: "s1", questions: ["q1", "q2"] }, ["claude-sonnet-5-5"]);
        // 3 + 2 turns; 6 + 4, 1150 + 310, 62100 + 43300, 33 + 27
        expect(fields.turns).toBe(5);
        expect(fields.usage).toEqual({ input: 10, cacheWrite: 1460, cacheRead: 105400, output: 60 });
        // the first message that didn't end in success, and whether any ended on an error
        expect(fields.subtype).toBe("error_max_turns");
        expect(fields.isError).toBe(true);
        expect(fields.resultNotes).toEqual(["message 2 ended with error_max_turns"]);
        expect(fields.sessionTurns.map((t) => [t.subtype, t.numTurns])).toEqual([["success", 3], ["error_max_turns", 2]]);
        expect(fields.unanswered).toBeUndefined();
        // the totals the runner already took from the session summary: the last cumulative cost, the summed times
        expect(fields).toMatchObject({ session: "s1", turnQuestions: ["q1", "q2"], costUsd: 0.03, durationMs: 2000 });
    });

    it("says success and no error for a session whose every message succeeded", () => {
        const ok = [...work(1), result("success", "a", 3, { i: 1, cw: 1, cr: 1, o: 1 }, 0.01), ...work(2), result("success", "b", 1, { i: 1, cw: 1, cr: 1, o: 1 }, 0.02)].map(line).join("\n");
        const fields = sessionIndexFields(summarizeRun(ok), summarizeSession(ok), { id: "s1", questions: ["q1", "q2"] }, ["claude-sonnet-5-5"]);
        expect(fields).toMatchObject({ turns: 4, subtype: "success", isError: false, resultNotes: [] });
    });
});

describe("sessionProblems: sessions that would break the runner (sweep B, item 6)", () => {
    const questions = [{ id: "q1", repo: "vscode" }, { id: "q2", repo: "vscode" }];

    it("refuses a session whose id is a question's: their runs would share a name in <dir>/runs", () => {
        expect(sessionProblems({ sessions: [{ id: "q1", repo: "vscode", title: "t", questions: ["q2"] }] }, questions, ["vscode"]))
            .toEqual(["session q1 has the id of a question, so their runs would share names in <dir>/runs (q1-baseline-1.jsonl.gz): give the session another id"]);
    });

    it("refuses a malformed entry in a sentence instead of throwing a TypeError", () => {
        const problems = sessionProblems({ sessions: [null, { id: "s2", repo: "vscode", title: "t" }, { id: 3, repo: "vscode", questions: ["q1"] }] } as never, questions, ["vscode"]);
        expect(problems).toEqual([
            "session entry 1 (null) needs an id, a repo and a list of question ids",
            'session entry 2 ({"id":"s2","repo":"vscode","title":"t"}) needs an id, a repo and a list of question ids',
            'session entry 3 ({"id":3,"repo":"vscode","questions":["q1"]}) needs an id, a repo and a list of question ids',
        ]);
    });
});

describe("a session that hits its limit and then ends (sweep B, item 7; D1)", () => {
    // 4 messages: message 1 answers, message 2 ends error_max_budget_usd, and the process ends with 3 and 4 never answered
    const raw = [
        ...work(1), result("success", "ANSWER:\nsrc/a.ts", 3, { i: 1, cw: 1, cr: 1, o: 1 }, 0.5),
        ...work(2), result("error_max_budget_usd", "", 4, { i: 1, cw: 1, cr: 1, o: 1 }, 1.2),
    ].map(line).join("\n");

    it("is not an outage: the limited message and every message after it count, at 0", () => {
        expect(sessionOutage(raw, 4)).toBeNull();
    });

    it("still calls it an outage when the process ends after an answer, with messages unsent", () => {
        const cut = [...work(1), result("success", "ANSWER:\nsrc/a.ts", 3, { i: 1, cw: 1, cr: 1, o: 1 }, 0.5)].map(line).join("\n");
        expect(sessionOutage(cut, 4)).toBe("the session ended after 1 of 4 results (killed, crashed or timed out before the last answer)");
    });

    it("records the unanswered messages on the index line", () => {
        const fields = sessionIndexFields(summarizeRun(raw), summarizeSession(raw), { id: "s1", questions: ["q1", "q2", "q3", "q4"] }, ["claude-sonnet-5-5"]);
        expect(fields.unanswered).toEqual(["q3", "q4"]);
        expect(fields.resultNotes).toEqual(["message 2 ended with error_max_budget_usd", "messages 3-4 (q3, q4) were never answered: the session ended after message 2's error_max_budget_usd, so they score 0"]);
    });

    it("scores message 1 as answered and messages 2 to 4 at 0: a mean of 0.25", () => {
        const list = (id: string): QuestionData => ({ id, family: "list", truth: { id, kind: "list", target: "src/b.ts", scope: "direct", files: ["src/a.ts"], verified: true, notes: [] } });
        const questions = new Map(["q1", "q2", "q3", "q4"].map((id) => [id, list(id)] as const));
        const ctx: ScoreContext = { repoRoot: "<r>", known: new Set(["src/a.ts", "src/b.ts"]), imports: () => null };
        const s = scoreSession("s1-baseline-1", { question: "s1", arm: "baseline", repeat: 1, toolSearch: true }, ["q1", "q2", "q3", "q4"], summarizeSession(raw), questions, ctx);
        expect(s.turns.map((t) => t.score)).toEqual([1, 0, 0, 0]);
        expect(s.score).toBe(0.25);
    });
});

describe("a crash after a limit (sweep B fix round 1, item 1)", () => {
    const answered = [...work(1), result("success", "ANSWER:\nsrc/a.ts", 3, { i: 1, cw: 1, cr: 1, o: 1 }, 0.5), ...work(2), result("error_max_turns", "", 80, { i: 1, cw: 1, cr: 1, o: 1 }, 1.0)];
    const replay3 = { type: "user", isReplay: true, message: { role: "user", content: "question 3" } };

    it("is an outage when the next message had started work (an assistant event after the limit's result) and has no result", () => {
        // the reviewer's probe: message 3 starts (its init, its replay, a tool call) and the process dies
        const raw = [...answered, init, replay3, assistant([toolUse("x", "Grep")])].map(line).join("\n");
        expect(sessionOutage(raw, 4)).toBe("the session ended after 2 of 4 results: message 3 had started work after message 2's error_max_turns, and has no result (killed or crashed)");
    });

    it("counts when the process ended at the limit, before any work on the next message", () => {
        // message 3 was written and replayed, but no assistant event followed: nothing was lost but the limit's own
        expect(sessionOutage([...answered, init, replay3].map(line).join("\n"), 4)).toBeNull();
        expect(sessionOutage(answered.map(line).join("\n"), 4)).toBeNull();
    });
});

describe("feedStep: what the runner does next in a session (sweep B fix round 1, item 2)", () => {
    const ok = (n: number): unknown[] => [...work(n), result("success", "a", 1, { i: 1, cw: 1, cr: 1, o: 1 }, n * 0.1)];
    const text = (events: unknown[]): string => events.map(line).join("\n");

    it("waits while the last message sent has no result", () => {
        expect(feedStep("", 1, 4)).toBe("wait");
        expect(feedStep(text([...ok(1), ...work(2)]), 2, 4)).toBe("wait");
    });

    it("sends the next message after an answer, and after a message that ran out of turns (a limit of that message alone)", () => {
        expect(feedStep(text(ok(1)), 1, 4)).toBe("send");
        expect(feedStep(text([...ok(1), ...work(2), result("error_max_turns", "", 80, { i: 1, cw: 1, cr: 1, o: 1 }, 0.5)]), 2, 4)).toBe("send");
    });

    it("closes stdin after the last answer, and after the session's budget ran out, whatever is left unsent", () => {
        expect(feedStep(text([...ok(1), ...ok(2)]), 2, 2)).toBe("close");
        expect(feedStep(text([...ok(1), ...work(2), result("error_max_budget_usd", "", 4, { i: 1, cw: 1, cr: 1, o: 1 }, 2.0)]), 2, 4)).toBe("close");
    });
});
