/**
 * Task sessions (V1.6 plan, Task 9): several eval questions asked in one Claude Code process, one message after another,
 * over `--input-format stream-json`. The pure parts live here so they're tested; run.ts does the spawning.
 *
 * What a session's transcript looks like (the probe run, task-9-report.md): one process, and for each message an init
 * event, the replayed user message, the assistant's work, and its own `result` event. The result's figures are mixed:
 *   total_cost_usd, modelUsage and duration_api_ms are CUMULATIVE over the session (each result adds to the one before);
 *   duration_ms, num_turns and usage are that message's alone.
 * So a message's cost is the difference of two totals, and a session's time is the sum of its messages' duration_ms.
 */
import { schedule, type RunId } from "./run-config";
import { streamEvents, summarizeRun, type Json, type RunSummary } from "./transcript";
import { infrastructureFailure } from "./validate";

export type SessionTurn = { finalText: string | null; subtype: string | null; costUsd: number; durationMs: number; toolCalls: Record<string, number>; nebulosityCalls: number };
export type SessionSummary = { turns: SessionTurn[]; costUsd: number; durationMs: number; firstCallContext: number | null };

/** One line of stdin that sends a user message (the newline is the writer's). */
export const userMessage = (text: string): string => JSON.stringify({ type: "user", message: { role: "user", content: text } });

/** How many messages have been answered: the `result` events, whatever the order of their keys. */
export const resultCount = (jsonl: string): number => streamEvents(jsonl).filter((e) => e.type === "result").length;

/**
 * Why a session's transcript is an outage, or null. Fewer results than messages sent means it stopped early; more
 * is refused (turnQuestions would no longer line up with the results). Then every message's own stretch of the
 * transcript (it has its own init and result) gets infrastructureFailure's tests, because that reads only the last result
 * and an error in the middle would be kept as an answer. A message that ran into its turn or budget limit is an answer
 * that scores 0, not an outage (infrastructureFailure already says so).
 */
export function sessionOutage(jsonl: string, messagesSent: number): string | null {
    const answered = resultCount(jsonl);
    if (answered < messagesSent) return `the session ended after ${answered} of ${messagesSent} results (killed, crashed or timed out before the last answer)`;
    if (answered > messagesSent) return `the session has ${answered} results for ${messagesSent} messages sent, so the questions can't be matched to the answers`;
    let message = 0;
    let segment: Json[] = [];
    for (const e of streamEvents(jsonl)){
        segment.push(e);
        if (e.type !== "result") continue;
        message++;
        const why = infrastructureFailure(segment.map((x) => JSON.stringify(x)).join("\n"));
        if (why !== null) return `message ${message} of ${messagesSent}: ${why}`;
        segment = [];
    }
    return null;
}

/** Every init message of a session checked as a single run's is; the problems name the message whose init differs. */
export function sessionInitProblems(jsonl: string, check: (init: RunSummary) => string[]): string[] {
    const problems: string[] = [];
    let message = 0;
    for (const e of streamEvents(jsonl)){
        if (e.type !== "system" || e.subtype !== "init") continue;
        message++;
        for (const p of check(summarizeRun(JSON.stringify(e)))) problems.push(`message ${message}: ${p}`);
    }
    return problems;
}

const count = (into: Record<string, number>, name: string): void => { into[name] = (into[name] ?? 0) + 1; };

/** Per message: the final text, its own cost, its time and its tool calls; and the session's totals and first call. */
export function summarizeSession(jsonl: string): SessionSummary {
    const turns: SessionTurn[] = [];
    let toolCalls: Record<string, number> = {};
    let nebulosityCalls = 0;
    let previousTotal = 0;
    let firstCallContext: number | null = null;
    for (const e of streamEvents(jsonl) as Json[]){
        if (e.type === "assistant"){
            const content: Json[] = Array.isArray(e.message?.content) ? e.message.content : [];
            for (const c of content){
                if (c.type !== "tool_use") continue;
                if (!e.parent_tool_use_id) count(toolCalls, c.name);
                if (typeof c.name === "string" && c.name.startsWith("mcp__nebulosity__")) nebulosityCalls++;
            }
            const usage = e.message?.usage as Json | undefined;
            if (firstCallContext === null && usage) firstCallContext = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
        } else if (e.type === "result"){
            const total: number = e.total_cost_usd ?? previousTotal;
            turns.push({ finalText: e.result ?? null, subtype: e.subtype ?? null, costUsd: total - previousTotal, durationMs: e.duration_ms ?? 0, toolCalls, nebulosityCalls });
            previousTotal = total;
            toolCalls = {};
            nebulosityCalls = 0;
        }
    }
    return { turns, costUsd: previousTotal, durationMs: turns.reduce((sum, t) => sum + t.durationMs, 0), firstCallContext };
}

/** Task sessions as RunIds (the id in `question`), arms alternating by session and repeat like single runs; there is no up-front arm. */
export function scheduleSessions(ids: readonly string[], repeats: number, order: readonly string[] = ids): RunId[] {
    return schedule(ids, repeats, order, { upfront: false });
}

/** <dir>/sessions.json: the sessions, each over one repo, and the question ids it asks in order. */
export type SessionDef = { id: string; repo: string; title: string; questions: string[] };
export type SessionFile = { sessions: SessionDef[] };

/** What is wrong with a sessions file, in sentences ([] when nothing): `questions` are the questions file's (id and the repo each asks about). */
export function sessionProblems(file: SessionFile, questions: readonly { id: string; repo: string }[], repoIds: readonly string[]): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const s of file.sessions){
        if (seen.has(s.id)) problems.push(`session ${s.id} is listed twice`);
        seen.add(s.id);
        if (!repoIds.includes(s.repo)) problems.push(`session ${s.id} names the repo ${s.repo}, which eval.json doesn't list`);
        if (s.questions.length === 0) problems.push(`session ${s.id} has no questions`);
        for (const id of s.questions){
            const q = questions.find((x) => x.id === id);
            if (q === undefined) problems.push(`session ${s.id} asks ${id}, which questions.json doesn't have`);
            else if (q.repo !== s.repo) problems.push(`session ${s.id} is over ${s.repo} but asks ${id}, a question about ${q.repo}`);
        }
    }
    return problems;
}
