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
import { infrastructureFailure, resultNotes } from "./validate";

type Usage = RunSummary["usage"];
/** One message of a session: its final text and result subtype (so a message that hit its limit shows), and its own figures. */
export type SessionTurn = {
    finalText: string | null; subtype: string | null; costUsd: number; durationMs: number; toolCalls: Record<string, number>; nebulosityCalls: number;
    /** That message's num_turns and usage (both are per message in a session's results). */
    numTurns: number; usage: Usage;
};
/** The messages, and the session's totals: the last cumulative cost, and the sums of the messages' times, turns and usage. */
export type SessionSummary = { turns: SessionTurn[]; costUsd: number; durationMs: number; firstCallContext: number | null; numTurns: number; usage: Usage };

/** The result subtypes of a message that ran into its turn or budget limit: an answer that scores 0 (D1), never an outage. */
const LIMITS = ["error_max_turns", "error_max_budget_usd"];

/** One line of stdin that sends a user message (the newline is the writer's). */
export const userMessage = (text: string): string => JSON.stringify({ type: "user", message: { role: "user", content: text } });

/** How many messages have been answered: the `result` events, whatever the order of their keys. */
export const resultCount = (jsonl: string): number => streamEvents(jsonl).filter((e) => e.type === "result").length;

/**
 * What the runner does next in a session, `sent` messages of `total` written so far: wait while the last one has no
 * result; else send the next; else close stdin. It also closes after a message that ran out of the session's budget
 * (error_max_budget_usd): that budget is the whole process's, so no later message can be answered, and the session ends
 * cleanly with them unanswered (each scores 0, D1). A message that ran out of turns is that message's limit alone, so
 * the next one is still sent.
 */
export function feedStep(jsonl: string, sent: number, total: number): "wait" | "send" | "close" {
    const results = streamEvents(jsonl).filter((e) => e.type === "result");
    if (results.length < sent) return "wait";
    if (results.length > 0 && results[results.length - 1].subtype === "error_max_budget_usd") return "close";
    return sent < total ? "send" : "close";
}

/**
 * Why a session's transcript is an outage, or null. Fewer results than messages sent means it stopped early; more
 * is refused (turnQuestions would no longer line up with the results). Then every message's own stretch of the
 * transcript (it has its own init and result) gets infrastructureFailure's tests, because that reads only the last result
 * and an error in the middle would be kept as an answer. A message that ran into its turn or budget limit is an answer
 * that scores 0, not an outage (infrastructureFailure already says so). That holds when the process then ends with
 * messages never answered, too (D1: a message never answered scores 0): the last result being a limit's, the session is
 * kept, and its index line names the unanswered messages (sessionIndexFields), which the scorer gives 0. But only when
 * nothing after that result shows work on the next message: an assistant event there means the next message had started,
 * and its missing result is a crash, an outage like any other.
 */
export function sessionOutage(jsonl: string, messagesSent: number): string | null {
    const events = streamEvents(jsonl);
    const lastResult = events.map((e) => e.type).lastIndexOf("result");
    const answered = events.filter((e) => e.type === "result").length;
    const limit: string | null = lastResult >= 0 && LIMITS.includes(events[lastResult].subtype) ? events[lastResult].subtype : null;
    const workedOn = events.slice(lastResult + 1).some((e) => e.type === "assistant");
    if (answered < messagesSent && limit !== null && workedOn){
        return `the session ended after ${answered} of ${messagesSent} results: message ${answered + 1} had started work after message ${answered}'s ${limit}, and has no result (killed or crashed)`;
    }
    if (answered < messagesSent && limit === null) return `the session ended after ${answered} of ${messagesSent} results (killed, crashed or timed out before the last answer)`;
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

/** Per message: the final text, its own cost, its time, turns, usage and tool calls; and the session's totals and first call. */
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
            const u: Json = e.usage ?? {};
            turns.push({
                finalText: e.result ?? null, subtype: e.subtype ?? null, costUsd: total - previousTotal, durationMs: e.duration_ms ?? 0, toolCalls, nebulosityCalls,
                numTurns: e.num_turns ?? 0,
                usage: { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 },
            });
            previousTotal = total;
            toolCalls = {};
            nebulosityCalls = 0;
        }
    }
    const sum = (pick: (t: SessionTurn) => number): number => turns.reduce((s, t) => s + pick(t), 0);
    return {
        turns, costUsd: previousTotal, durationMs: sum((t) => t.durationMs), firstCallContext, numTurns: sum((t) => t.numTurns),
        usage: { input: sum((t) => t.usage.input), cacheWrite: sum((t) => t.usage.cacheWrite), cacheRead: sum((t) => t.usage.cacheRead), output: sum((t) => t.usage.output) },
    };
}

/** What a session's index line says in place of the last message's figures (which are all a single run's summary holds). */
export type SessionIndexFields = {
    session: string; turnQuestions: string[];
    /** Every message's num_turns and usage summed; the first message's subtype that isn't success (else success), and whether any ended on an error. */
    turns: number; usage: Usage; subtype: string | null; isError: boolean;
    /** The last cumulative cost, the summed times, the session's first call. */
    costUsd: number; durationMs: number; firstCallContext: number | null;
    /** The model notes, then one per message that didn't end in success, then the unanswered messages. */
    resultNotes: string[];
    /** Each message's own figures, without its text (that stays in the transcript). */
    sessionTurns: (Omit<SessionTurn, "finalText"> & { finalText: undefined })[];
    /** The questions of the messages a session that ended at its limit never answered (they score 0); absent when every one was. */
    unanswered?: string[];
};

/**
 * The index line's fields for a session (`run` is summarizeRun's reading of the transcript, which holds the last message's
 * turns, usage and subtype alone): the session's totals, each message's own figures, notes for every message that didn't
 * end in success, and the questions never answered when the session ended at a limit.
 */
export function sessionIndexFields(run: RunSummary, s: SessionSummary, def: { id: string; questions: readonly string[] }, allowedModels: readonly string[]): SessionIndexFields {
    // resultNotes's own "ended with" reads the last message's subtype alone, so it is asked for the model notes only
    const notes = resultNotes({ ...run, subtype: "success" }, allowedModels);
    s.turns.forEach((t, i) => { if (t.subtype !== "success") notes.push(`message ${i + 1} ended with ${t.subtype ?? "no subtype"}`); });
    const unanswered = def.questions.slice(s.turns.length);
    if (unanswered.length > 0){
        const [from, to] = [s.turns.length + 1, def.questions.length];
        const last = s.turns[s.turns.length - 1];
        notes.push(`${from === to ? `message ${from}` : `messages ${from}-${to}`} (${unanswered.join(", ")}) ${unanswered.length === 1 ? "was" : "were"} never answered: the session ended after message ${s.turns.length}'s ${last?.subtype ?? "start"}, so ${unanswered.length === 1 ? "it scores" : "they score"} 0`);
    }
    const failed = s.turns.find((t) => t.subtype !== "success");
    return {
        session: def.id, turnQuestions: [...def.questions],
        turns: s.numTurns, usage: s.usage, subtype: failed === undefined ? (s.turns.length > 0 ? "success" : null) : failed.subtype, isError: s.turns.some((t) => t.subtype !== "success"),
        costUsd: s.costUsd, durationMs: s.durationMs, firstCallContext: s.firstCallContext,
        resultNotes: notes,
        sessionTurns: s.turns.map((t) => ({ ...t, finalText: undefined })),
        ...(unanswered.length > 0 ? { unanswered } : {}),
    };
}

/** Task sessions as RunIds (the id in `question`), arms alternating by session and repeat like single runs; there is no up-front arm. */
export function scheduleSessions(ids: readonly string[], repeats: number, order: readonly string[] = ids): RunId[] {
    return schedule(ids, repeats, order, { upfront: false });
}

/**
 * The sessions a `--sessions` run asks, in the file's order: with `pilot`, the definition's `pilotSessions`; else the ones
 * `only` names (null: every one). Throws a sentence for a pilot with none listed, or an id that isn't a session.
 */
export function chosenSessions(sessionIds: readonly string[], options: { pilot: boolean; only: readonly string[] | null; pilotSessions: readonly string[] }): string[] {
    if (options.pilot && options.pilotSessions.length === 0) throw new Error("eval.json lists no pilot sessions (pilotSessions)");
    const wanted = options.pilot ? options.pilotSessions : options.only;
    const unknown = (wanted ?? []).filter((id) => !sessionIds.includes(id));
    if (unknown.length > 0) throw new Error(`no such session: ${unknown.join(", ")}. The sessions are ${sessionIds.join(", ")}`);
    return sessionIds.filter((id) => wanted === null || wanted.includes(id));
}

/** <dir>/sessions.json: the sessions, each over one repo, and the question ids it asks in order. */
export type SessionDef = { id: string; repo: string; title: string; questions: string[] };
export type SessionFile = { sessions: SessionDef[] };

/** An entry of sessions.json with the shape the runner reads: an id, a repo, and a list of question ids. */
const isSessionDef = (x: unknown): x is SessionDef => {
    const s = x as Partial<SessionDef> | null;
    return s !== null && typeof s === "object" && typeof s.id === "string" && s.id !== "" && typeof s.repo === "string"
        && Array.isArray(s.questions) && s.questions.every((q) => typeof q === "string");
};

/**
 * What is wrong with a sessions file, in sentences ([] when nothing): `questions` are the questions file's (id and the repo
 * each asks about). A malformed entry is named, not thrown on. A session may not share a question's id: a run is kept as
 * <dir>/runs/<id>-<arm>-<repeat>.jsonl.gz, so the two would overwrite each other's files.
 */
export function sessionProblems(file: { sessions: readonly unknown[] }, questions: readonly { id: string; repo: string }[], repoIds: readonly string[]): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const [i, entry] of file.sessions.entries()){
        if (!isSessionDef(entry)){
            problems.push(`session entry ${i + 1} (${JSON.stringify(entry)}) needs an id, a repo and a list of question ids`);
            continue;
        }
        const s = entry;
        if (questions.some((q) => q.id === s.id)) problems.push(`session ${s.id} has the id of a question, so their runs would share names in <dir>/runs (${s.id}-baseline-1.jsonl.gz): give the session another id`);
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
