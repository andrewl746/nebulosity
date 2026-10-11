import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeSummarizer, outcomeFromBatchItem, parseSummary, requestParams, SUMMARY_SCHEMA } from "./claude";
import { FILE_SYSTEM_PROMPT } from "./prompts";
import { BatchGoneError, SummarizerAuthError, type SummaryRequest } from "./types";

const GOOD = JSON.stringify({ tagline: "Logging helpers", summary: "Writes log lines." });
const reply = (text: string, overrides: Record<string, unknown> = {}) => ({
    model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text }],
    usage: { input_tokens: 120, output_tokens: 30 }, ...overrides,
});
const request = (model: string): SummaryRequest => ({ customId: "s7", model, system: FILE_SYSTEM_PROMPT, prompt: "File: src/core/log.ts" });

describe("requestParams", () => {
    it("asks for the {tagline, summary} JSON at low effort, leaving thinking at the model's default", () => {
        expect(requestParams(request("claude-haiku-5-5"))).toEqual({
            model: "claude-haiku-5-5",
            max_tokens: 4096,
            system: FILE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: "File: src/core/log.ts" }],
            output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
        });
    });
});

describe("parseSummary", () => {
    it("reads the tagline and summary, trimming them and clamping the tagline to six words", () => {
        expect(parseSummary(reply(JSON.stringify({ tagline: "The central logging helpers for the core layer.", summary: " Writes log lines. " }))))
            .toEqual({ tagline: "The central logging helpers for the", summary: "Writes log lines." });
    });

    it("explains every way a reply can be unusable", () => {
        expect(() => parseSummary(reply(GOOD, { stop_reason: "refusal" }))).toThrow("the model declined to summarize this");
        expect(() => parseSummary(reply(GOOD, { stop_reason: "max_tokens" }))).toThrow("the reply ran past 4096 output tokens");
        expect(() => parseSummary(reply(GOOD, { content: [{ type: "thinking" }] }))).toThrow("the reply had no text");
        expect(() => parseSummary(reply("{not json"))).toThrow("the reply wasn't valid JSON");
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "x" })))).toThrow("the reply didn't have a tagline and a summary");
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "...", summary: "Writes log lines." })))).toThrow("the reply didn't have a tagline and a summary");
    });

    it("reads the answer that stood when a fallback model took over partway", () => {
        expect(parseSummary(reply(GOOD, { content: [{ type: "text", text: '{"tagl' }, { type: "fallback" }, { type: "text", text: GOOD }] })))
            .toEqual({ tagline: "Logging helpers", summary: "Writes log lines." });
    });
});

describe("outcomeFromBatchItem", () => {
    const item = (result: unknown) => ({ custom_id: "s1", result }) as Anthropic.Messages.MessageBatchIndividualResponse;

    it("turns each kind of batch result into a summary or a reason", () => {
        expect(outcomeFromBatchItem(item({ type: "succeeded", message: reply(GOOD) }))).toEqual({
            customId: "s1", ok: true, text: { tagline: "Logging helpers", summary: "Writes log lines." }, model: "claude-haiku-5-5",
            usage: { inputTokens: 120, outputTokens: 30 },
        });
        expect(outcomeFromBatchItem(item({ type: "errored", error: { type: "error", error: { type: "api_error", message: "overloaded" }, request_id: null } })))
            .toMatchObject({ ok: false, error: "batch request errored: overloaded" });
        expect(outcomeFromBatchItem(item({ type: "expired" }))).toMatchObject({ ok: false, error: "the batch expired before this request ran" });
        expect(outcomeFromBatchItem(item({ type: "canceled" }))).toMatchObject({ ok: false, error: "the batch was canceled" });
    });

    it("keeps the token count of a reply it couldn't use, so spend stays honest", () => {
        expect(outcomeFromBatchItem(item({ type: "succeeded", message: reply("{not json") }))).toEqual({
            customId: "s1", ok: false, error: "the reply wasn't valid JSON", model: "claude-haiku-5-5", usage: { inputTokens: 120, outputTokens: 30 },
        });
    });
});

describe("createClaudeSummarizer", () => {
    function fakeClient(){
        const calls: { endpoint: string; params: Record<string, unknown> }[] = [];
        const state = { ended: false, fail: false, gone: false, denied: null as 401 | 403 | null, offline: false };
        const client = {
            messages: {
                create: async (params: Record<string, unknown>) => {
                    calls.push({ endpoint: "messages", params });
                    if (state.fail) throw new Error("connection reset");
                    return reply(GOOD, { model: params.model });
                },
                batches: {
                    create: async (params: Record<string, unknown>) => { calls.push({ endpoint: "batches", params }); return { id: "msgbatch_1" }; },
                    retrieve: async () => {
                        if (state.gone) throw new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "batch not found" } }, "batch not found", new Headers());
                        if (state.denied === 401) throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
                        if (state.denied === 403) throw new Anthropic.PermissionDeniedError(403, { type: "error", error: { type: "permission_error", message: "not allowed" } }, "not allowed", new Headers());
                        if (state.offline) throw new Error("Connection error.");
                        return { processing_status: state.ended ? "ended" : "in_progress" };
                    },
                    results: async () => (async function* (){
                        yield { custom_id: "s1", result: { type: "succeeded", message: reply(GOOD) } };
                        yield { custom_id: "s2", result: { type: "expired" } };
                    })(),
                },
            },
            beta: {
                messages: {
                    create: async (params: Record<string, unknown>) => { calls.push({ endpoint: "beta", params }); return reply(GOOD, { model: params.model }); },
                },
            },
        };
        return { client: client as unknown as Anthropic, calls, state };
    }

    it("sends Haiku requests to the regular endpoint, exactly as requestParams builds them", async () => {
        const { client, calls } = fakeClient();
        const outcome = await createClaudeSummarizer(client).summarize(request("claude-haiku-5-5"));
        expect(calls).toEqual([{ endpoint: "messages", params: requestParams(request("claude-haiku-5-5")) }]);
        expect(outcome).toMatchObject({ customId: "s7", ok: true, model: "claude-haiku-5-5" });
    });

    it("adds the server-side refusal fallback to Sonnet requests", async () => {
        const { client, calls } = fakeClient();
        await createClaudeSummarizer(client).summarize(request("claude-sonnet-5-5"));
        expect(calls).toEqual([{ endpoint: "beta", params: { ...requestParams(request("claude-sonnet-5-5")), betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } }]);
    });

    it("turns a thrown error into a failed outcome instead of throwing", async () => {
        const { client, state } = fakeClient();
        state.fail = true;
        expect(await createClaudeSummarizer(client).summarize(request("claude-haiku-5-5")))
            .toEqual({ customId: "s7", ok: false, error: "connection reset", model: null, usage: null });
    });

    it("submits a batch with custom ids, reports null until it ends, then one outcome per result", async () => {
        const { client, calls, state } = fakeClient();
        const summarizer = createClaudeSummarizer(client);
        expect(await summarizer.submitBatch([request("claude-haiku-5-5")])).toBe("msgbatch_1");
        expect(calls[0].params).toEqual({ requests: [{ custom_id: "s7", params: requestParams(request("claude-haiku-5-5")) }] });
        expect(await summarizer.batchResults("msgbatch_1")).toBeNull();
        state.ended = true;
        expect((await summarizer.batchResults("msgbatch_1"))?.map((o) => [o.customId, o.ok])).toEqual([["s1", true], ["s2", false]]);
    });

    it("reports a batch Anthropic no longer has (404) as BatchGoneError", async () => {
        const { client, state } = fakeClient();
        state.gone = true;
        await expect(createClaudeSummarizer(client).batchResults("msgbatch_1")).rejects.toThrow(BatchGoneError);
    });

    it("reports a rejected key (401, 403) as SummarizerAuthError, and passes a network error through unchanged", async () => {
        const { client, state } = fakeClient();
        const summarizer = createClaudeSummarizer(client);

        state.denied = 401;
        await expect(summarizer.batchResults("msgbatch_1")).rejects.toThrow(SummarizerAuthError);
        state.denied = 403;
        await expect(summarizer.batchResults("msgbatch_1")).rejects.toThrow(SummarizerAuthError);

        // the runner counts this one as a missed poll and asks again
        state.denied = null;
        state.offline = true;
        await expect(summarizer.batchResults("msgbatch_1")).rejects.toThrow(/^Connection error\.$/);
    });
});
