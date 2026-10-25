import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { cleanTagline, createClaudeSummarizer, outcomeFromBatchItem, outcomeFromReply, parseSummary, requestParams, SUMMARY_SCHEMA } from "./claude";
import { rejectionOf } from "../../../test/helpers/rejection";
import { configPath } from "../../config";
import { FILE_SYSTEM_PROMPT, FOLDER_SYSTEM_PROMPT } from "./prompts";
import { BatchGoneError, ModelUnavailableError, SummarizerAuthError, type SummaryRequest } from "./types";

const GOOD = JSON.stringify({ tagline: "Logging helpers", summary: "Writes log lines." });
const reply = (text: string, overrides: Record<string, unknown> = {}) => ({
    model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text }],
    usage: { input_tokens: 120, output_tokens: 30 }, ...overrides,
});
const request = (model: string): SummaryRequest => ({ customId: "s7", model, system: FILE_SYSTEM_PROMPT, prompt: "File: src/core/log.ts" });

/**
 * A 404 as the SDK builds it from the API's answer (APIError.generate: the body, then its error.type). The API names a
 * model it doesn't serve as "model: <id>" (a not_found_error).
 */
const notFound = (message: string) =>
    new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message }, request_id: null }, undefined, new Headers(), "not_found_error");

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

describe("cleanTagline", () => {
    it("keeps a tagline of 8 words or fewer whole, connector words and all", () => {
        expect(cleanTagline("Typed event emitter and listener registry helpers")).toBe("Typed event emitter and listener registry helpers");
        // exactly 8 words, ending on a connector: the limit is inclusive, so nothing is cut
        expect(cleanTagline("Registry of commands for the workbench and for")).toBe("Registry of commands for the workbench and for");
        expect(cleanTagline("Logging helpers for")).toBe("Logging helpers for");
    });

    it("cuts a longer tagline to its first 8 words, then drops the connector words it now ends on", () => {
        expect(cleanTagline("Core DOM utilities for the browser workbench and its helpers")).toBe("Core DOM utilities for the browser workbench");
        expect(cleanTagline("Registry of commands for the workbench and for all extensions")).toBe("Registry of commands for the workbench");
        // case doesn't matter
        expect(cleanTagline("Registry Of Commands For The Workbench AND For All Extensions")).toBe("Registry Of Commands For The Workbench");
        // nothing to drop when the cut lands on a content word
        expect(cleanTagline("One two three four five six seven eight nine ten")).toBe("One two three four five six seven eight");
    });

    it("drops a connector at the cut even when punctuation is stuck to it", () => {
        expect(cleanTagline("Registry of commands for the workbench and, for all extensions")).toBe("Registry of commands for the workbench");
        expect(cleanTagline("Registry of commands for the workbench and; for all extensions")).toBe("Registry of commands for the workbench");
    });

    it("never drops the first word", () => {
        expect(cleanTagline("to the of and a an in on at")).toBe("to");
    });

    it("strips backticks, extra whitespace and trailing punctuation, but leaves punctuation inside the phrase", () => {
        expect(cleanTagline("`URI` parsing and formatting.")).toBe("URI parsing and formatting");
        expect(cleanTagline("  Logging \n  helpers; ")).toBe("Logging helpers");
        expect(cleanTagline("Logging helpers:")).toBe("Logging helpers");
        expect(cleanTagline("Logging helpers,")).toBe("Logging helpers");
        expect(cleanTagline("Logging helpers...")).toBe("Logging helpers");
        expect(cleanTagline("Node.js parsing, formatting and merging")).toBe("Node.js parsing, formatting and merging");
    });

    it("returns an empty string when nothing is left", () => {
        expect(cleanTagline("``")).toBe("");
        expect(cleanTagline("  ")).toBe("");
        expect(cleanTagline("...")).toBe("");
    });
});

describe("parseSummary", () => {
    it("reads the tagline and summary, trimming them and keeping a tagline of up to 8 words whole", () => {
        expect(parseSummary(reply(JSON.stringify({ tagline: "The central logging helpers for the core layer.", summary: " Writes log lines. " }))))
            .toEqual({ tagline: "The central logging helpers for the core layer", summary: "Writes log lines." });
    });

    it("shows the tagline as plain text, without backticks", () => {
        expect(parseSummary(reply(JSON.stringify({ tagline: "`URI` parsing and formatting.", summary: "Parses URIs." }))).tagline)
            .toBe("URI parsing and formatting");
    });

    it("explains every way a reply can be unusable", () => {
        expect(() => parseSummary(reply(GOOD, { stop_reason: "refusal" }))).toThrow("the model declined to summarize this");
        expect(() => parseSummary(reply(GOOD, { content: [{ type: "thinking" }] }))).toThrow("the reply had no text");
        expect(() => parseSummary(reply("{not json"))).toThrow("the reply wasn't valid JSON");
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "x" })))).toThrow("the reply didn't have a tagline and a summary");
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "...", summary: "Writes log lines." })))).toThrow("the reply didn't have a tagline and a summary");
        // nothing but backticks: empty once they're removed
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "``", summary: "Writes log lines." })))).toThrow("the reply didn't have a tagline and a summary");
    });

    it("calls a reply cut off unless it ended its turn on a whole sentence, and names the stop reason", () => {
        // a reply that hit the limit is cut off however its text reads
        expect(() => parseSummary(reply(GOOD, { stop_reason: "max_tokens" }))).toThrow(/^the summary was cut off \(stop reason: max_tokens\)/);
        // a stop reason nothing else checks: complete-looking text, but the turn didn't end
        expect(() => parseSummary(reply(GOOD, { stop_reason: "pause_turn" }))).toThrow(/^the summary was cut off \(stop reason: pause_turn\)/);
        // review #3's configurationService.ts: well-formed JSON, a normal stop, and a summary that stops at "The"
        const midSentence = JSON.stringify({ tagline: "Configuration service", summary: "Writes go through ConfigurationEditing. The" });
        expect(() => parseSummary(reply(midSentence))).toThrow(/^the summary was cut off \(stop reason: end_turn\)/);
        // an identifier in backticks isn't the end of a sentence either
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "Logging helpers", summary: "Writes log lines with `log`" })))).toThrow(/^the summary was cut off/);
        // an empty summary is cut off too, before it ever started
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "Logging helpers", summary: "  " })))).toThrow(/^the summary was cut off \(stop reason: end_turn\)/);
    });

    it("accepts a summary that ends on . ! or ?, followed by any closing quotes, backticks or brackets", () => {
        const summaryOf = (summary: string) => parseSummary(reply(JSON.stringify({ tagline: "Logging helpers", summary }))).summary;
        expect(summaryOf("Writes log lines.")).toBe("Writes log lines.");
        expect(summaryOf("Is this the logger?")).toBe("Is this the logger?");
        expect(summaryOf("Writes log lines!")).toBe("Writes log lines!");
        expect(summaryOf("Used by `main.ts` (see `log.ts`.)")).toBe("Used by `main.ts` (see `log.ts`.)");
        expect(summaryOf('Prints "done."')).toBe('Prints "done."');
        expect(summaryOf("Ends on `log.`")).toBe("Ends on `log.`");
    });

    it("turns a trailing run of periods into one", () => {
        const summaryOf = (summary: string) => parseSummary(reply(JSON.stringify({ tagline: "Logging helpers", summary }))).summary;
        expect(summaryOf("Keeps every setting in one place..")).toBe("Keeps every setting in one place.");
        expect(summaryOf("Keeps every setting in one place...")).toBe("Keeps every setting in one place.");
        // trimmed first, and periods inside the summary stay
        expect(summaryOf(" Reads `a.b`. Keeps every setting in one place.. ")).toBe("Reads `a.b`. Keeps every setting in one place.");
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
            usage: [{ model: "claude-haiku-5-5", inputTokens: 120, outputTokens: 30 }],
        });
        expect(outcomeFromBatchItem(item({ type: "errored", error: { type: "error", error: { type: "api_error", message: "overloaded" }, request_id: null } })))
            .toMatchObject({ ok: false, error: "batch request errored: overloaded" });
        expect(outcomeFromBatchItem(item({ type: "expired" }))).toMatchObject({ ok: false, error: "the batch expired before this request ran" });
        expect(outcomeFromBatchItem(item({ type: "canceled" }))).toMatchObject({ ok: false, error: "the batch was canceled" });
    });

    it("marks a request that errored because its model isn't served, and only that kind of error", () => {
        const errored = (type: string, message: string) => item({ type: "errored", error: { type: "error", error: { type, message }, request_id: null } });

        // the model is named by the request when this process sent it, else read from the API's "model: <id>"
        expect(outcomeFromBatchItem(errored("not_found_error", "model: claude-haiku-5-5"), "claude-haiku-5-5")).toMatchObject({
            ok: false, error: "batch request errored: model: claude-haiku-5-5", modelUnavailable: { model: "claude-haiku-5-5", reason: "model: claude-haiku-5-5" },
        });
        expect(outcomeFromBatchItem(errored("not_found_error", "model: claude-haiku-5-5"))).toMatchObject({
            modelUnavailable: { model: "claude-haiku-5-5", reason: "model: claude-haiku-5-5" },
        });
        // a 404 about something else, and another error that names the model, are ordinary failures
        expect(outcomeFromBatchItem(errored("not_found_error", "file not found"), "claude-haiku-5-5")).not.toHaveProperty("modelUnavailable");
        expect(outcomeFromBatchItem(errored("invalid_request_error", "model: claude-haiku-5-5"), "claude-haiku-5-5")).not.toHaveProperty("modelUnavailable");
    });

    it("keeps the token count of a reply it couldn't use, so spend stays honest", () => {
        expect(outcomeFromBatchItem(item({ type: "succeeded", message: reply("{not json") }))).toEqual({
            customId: "s1", ok: false, error: "the reply wasn't valid JSON", model: "claude-haiku-5-5",
            usage: [{ model: "claude-haiku-5-5", inputTokens: 120, outputTokens: 30 }],
        });
    });
});

describe("outcomeFromReply", () => {
    it("counts every attempt under its own model when a fallback model finished a Sonnet request", () => {
        // Sonnet declined after 12 output tokens; the fallback model then wrote the answer. The top-level usage
        // covers only that last attempt, so the declined one is only in usage.iterations.
        const served = reply(GOOD, {
            model: "claude-opus-5-5",
            content: [{ type: "text", text: '{"tagl' }, { type: "fallback" }, { type: "text", text: GOOD }],
            usage: {
                input_tokens: 800, output_tokens: 40,
                iterations: [
                    { type: "message", model: "claude-sonnet-5-5", input_tokens: 800, output_tokens: 12 },
                    { type: "fallback_message", model: "claude-opus-5-5", input_tokens: 800, output_tokens: 40 },
                ],
            },
        });

        expect(outcomeFromReply("s3", served)).toEqual({
            customId: "s3", ok: true, text: { tagline: "Logging helpers", summary: "Writes log lines." }, model: "claude-opus-5-5",
            usage: [
                { model: "claude-sonnet-5-5", inputTokens: 800, outputTokens: 12 },
                { model: "claude-opus-5-5", inputTokens: 800, outputTokens: 40 },
            ],
        });
    });
});

describe("createClaudeSummarizer", () => {
    function fakeClient(){
        const calls: { endpoint: string; params: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
        const state = {
            ended: false, fail: false, gone: false, denied: null as 401 | 403 | null, offline: false,
            // what creating a batch throws, if anything
            createError: null as Error | null,
            // what the regular endpoints hand out in order (a reply, or an Error they throw); once it runs out, every request gets GOOD
            replies: [] as unknown[],
            // the batch's results; null gives the default pair below
            results: null as unknown[] | null,
        };
        const answer = (params: Record<string, unknown>) => {
            const next = state.replies.shift();
            if (next instanceof Error) throw next;
            return next ?? reply(GOOD, { model: params.model });
        };
        const client = {
            messages: {
                create: async (params: Record<string, unknown>) => {
                    calls.push({ endpoint: "messages", params });
                    if (state.fail) throw new Error("connection reset");
                    return answer(params);
                },
                batches: {
                    create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
                        calls.push({ endpoint: "batches", params, options });
                        if (state.createError) throw state.createError;
                        return { id: "msgbatch_1" };
                    },
                    retrieve: async () => {
                        if (state.gone) throw new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "batch not found" } }, "batch not found", new Headers());
                        if (state.denied === 401) throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
                        if (state.denied === 403) throw new Anthropic.PermissionDeniedError(403, { type: "error", error: { type: "permission_error", message: "not allowed" } }, "not allowed", new Headers());
                        if (state.offline) throw new Error("Connection error.");
                        return { processing_status: state.ended ? "ended" : "in_progress" };
                    },
                    results: async () => (async function* (){
                        if (state.results){
                            yield* state.results;
                            return;
                        }
                        yield { custom_id: "s1", result: { type: "succeeded", message: reply(GOOD) } };
                        yield { custom_id: "s2", result: { type: "expired" } };
                    })(),
                },
            },
            beta: {
                messages: {
                    create: async (params: Record<string, unknown>) => {
                        calls.push({ endpoint: "beta", params });
                        if (state.fail) throw new Error("connection reset");
                        return answer(params);
                    },
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

    // ADR-066 (R3): the fallback beta goes only with a kind left at its default, so a newer model never gets a beta it doesn't know
    describe("the Sonnet fallback beta, by whether the kind's model is set", () => {
        const folder = (model: string, customModel?: boolean): SummaryRequest => ({
            customId: "s9", model, system: FOLDER_SYSTEM_PROMPT, prompt: "Folder: src/core", ...(customModel === undefined ? {} : { customModel }),
        });

        it("goes with a folder request at the default model", async () => {
            const { client, calls } = fakeClient();
            await createClaudeSummarizer(client).summarize(folder("claude-sonnet-5-5", false));
            expect(calls).toEqual([{ endpoint: "beta", params: { ...requestParams(folder("claude-sonnet-5-5")), betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } }]);
        });

        it("doesn't go with a folder request for a set model, even a Sonnet: the plain Messages API, without betas or fallbacks", async () => {
            for (const model of ["claude-sonnet-6", "claude-sonnet-5-5"]){
                const { client, calls } = fakeClient();
                const outcome = await createClaudeSummarizer(client).summarize(folder(model, true));
                expect(calls).toEqual([{ endpoint: "messages", params: requestParams(folder(model)) }]);
                expect(calls[0].params).not.toHaveProperty("betas");
                expect(calls[0].params).not.toHaveProperty("fallbacks");
                expect(outcome).toMatchObject({ ok: true, model });
            }
        });
    });

    describe("a model the API no longer serves (a 404 not_found_error naming it)", () => {
        it("is a failed outcome that says which model, on the regular API", async () => {
            const { client, state } = fakeClient();
            state.replies = [notFound("model: claude-haiku-5-5")];
            const outcome = await createClaudeSummarizer(client).summarize(request("claude-haiku-5-5"));
            expect(outcome).toMatchObject({ customId: "s7", ok: false, model: null, usage: null, modelUnavailable: { model: "claude-haiku-5-5", reason: "model: claude-haiku-5-5" } });
        });

        it("isn't a 404 about anything else, which stays an ordinary failure", async () => {
            const { client, state } = fakeClient();
            state.replies = [notFound("Not found")];
            const outcome = await createClaudeSummarizer(client).summarize(request("claude-haiku-5-5"));
            expect(outcome).toMatchObject({ ok: false });
            expect(outcome).not.toHaveProperty("modelUnavailable");
        });

        it("in a batch's results is marked on that request's outcome, the batch's other answers kept", async () => {
            const { client, state } = fakeClient();
            const summarizer = createClaudeSummarizer(client);
            await summarizer.submitBatch([{ ...request("claude-haiku-6"), customId: "s1" }, { ...request("claude-haiku-6"), customId: "s2" }]);
            state.ended = true;
            state.results = [
                { custom_id: "s1", result: { type: "errored", error: { type: "error", error: { type: "not_found_error", message: "model: claude-haiku-6" }, request_id: null } } },
                { custom_id: "s2", result: { type: "succeeded", message: reply(GOOD, { model: "claude-haiku-6" }) } },
            ];

            const outcomes = await summarizer.batchResults("msgbatch_1");

            expect(outcomes).toHaveLength(2);
            expect(outcomes![0]).toMatchObject({ customId: "s1", ok: false, modelUnavailable: { model: "claude-haiku-6", reason: "model: claude-haiku-6" } });
            expect(outcomes![1]).toMatchObject({ customId: "s2", ok: true });
        });

        it("refusing a batch's creation throws ModelUnavailableError, naming the model, the config file and the README's section", async () => {
            const { client, state } = fakeClient();
            state.createError = notFound("model: claude-haiku-5-5");
            const submitting = createClaudeSummarizer(client).submitBatch([request("claude-haiku-5-5")]);

            await expect(submitting).rejects.toThrow(ModelUnavailableError);
            const error = await rejectionOf(submitting);
            expect(error.message).toContain("claude-haiku-5-5");
            expect(error.message).toContain(configPath());
            expect(error.message).toContain("Summary models");
            // the API answers this way for a model the key can't use too (M5)
            expect(error.message).toContain("retired, or isn't open to this API key");
        });

        it("refusing a batch's creation for another reason is thrown as it came", async () => {
            const { client, state } = fakeClient();
            state.createError = notFound("Not found");
            const error = await createClaudeSummarizer(client).submitBatch([request("claude-haiku-5-5")]).catch((err: unknown) => err);
            expect(error).toBeInstanceOf(Anthropic.NotFoundError);
            expect(error).not.toBeInstanceOf(ModelUnavailableError);
        });
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

    it("creates a batch with no automatic retry, so a lost reply can't leave a second batch nobody collects", async () => {
        const { client, calls } = fakeClient();
        await createClaudeSummarizer(client).submitBatch([request("claude-haiku-5-5")]);
        expect(calls).toHaveLength(1);
        expect(calls[0].options).toEqual({ maxRetries: 0 });
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

    describe("a cut-off summary", () => {
        const CUT_OFF = JSON.stringify({ tagline: "Configuration service", summary: "Writes go through ConfigurationEditing. The" });
        const COMPLETE = JSON.stringify({ tagline: "Configuration service", summary: "Writes go through ConfigurationEditing." });
        const COMPLETE_TEXT = { tagline: "Configuration service", summary: "Writes go through ConfigurationEditing." };
        const haiku = request("claude-haiku-5-5");
        /** The requests sent to the regular endpoints, leaving out batch submissions. */
        const sent = (calls: ReturnType<typeof fakeClient>["calls"]) => calls.filter((call) => call.endpoint !== "batches");

        it("is asked for again once, with room for 8192 output tokens, and both attempts' tokens are counted", async () => {
            const { client, calls, state } = fakeClient();
            state.replies = [reply(CUT_OFF), reply(COMPLETE, { usage: { input_tokens: 120, output_tokens: 45 } })];

            const outcome = await createClaudeSummarizer(client).summarize(haiku);

            expect(calls).toEqual([
                { endpoint: "messages", params: requestParams(haiku) },
                { endpoint: "messages", params: { ...requestParams(haiku), max_tokens: 8192 } },
            ]);
            // 120 + 120 input tokens and 30 + 45 output tokens, all Haiku's: both attempts are billed
            expect(outcome).toEqual({
                customId: "s7", ok: true, text: COMPLETE_TEXT, model: "claude-haiku-5-5",
                usage: [{ model: "claude-haiku-5-5", inputTokens: 240, outputTokens: 75 }],
            });
        });

        it("fails, so nothing is stored, when the retry is cut off too, and no third request is sent", async () => {
            const { client, calls, state } = fakeClient();
            state.replies = [reply(CUT_OFF), reply(CUT_OFF)];

            const outcome = await createClaudeSummarizer(client).summarize(haiku);

            expect(calls).toHaveLength(2);
            expect(outcome.ok).toBe(false);
            expect(!outcome.ok && outcome.error).toMatch(/^the summary was cut off/);
            expect(outcome.usage).toEqual([{ model: "claude-haiku-5-5", inputTokens: 240, outputTokens: 60 }]);
        });

        it("is retried when the turn didn't end, however complete the text looks", async () => {
            const { client, calls, state } = fakeClient();
            state.replies = [reply(COMPLETE, { stop_reason: "pause_turn" }), reply(COMPLETE)];

            const outcome = await createClaudeSummarizer(client).summarize(haiku);

            expect(calls).toHaveLength(2);
            expect(calls[1].params.max_tokens).toBe(8192);
            expect(outcome).toMatchObject({ ok: true, text: COMPLETE_TEXT });
        });

        it("is retried on Sonnet's endpoint, fallback and all", async () => {
            const { client, calls, state } = fakeClient();
            const sonnet = request("claude-sonnet-5-5");
            state.replies = [reply(CUT_OFF, { model: "claude-sonnet-5-5" }), reply(COMPLETE, { model: "claude-sonnet-5-5" })];

            const outcome = await createClaudeSummarizer(client).summarize(sonnet);

            const fallback = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
            expect(calls).toEqual([
                { endpoint: "beta", params: { ...requestParams(sonnet), ...fallback } },
                { endpoint: "beta", params: { ...requestParams(sonnet), max_tokens: 8192, ...fallback } },
            ]);
            expect(outcome).toEqual({
                customId: "s7", ok: true, text: COMPLETE_TEXT, model: "claude-sonnet-5-5",
                usage: [{ model: "claude-sonnet-5-5", inputTokens: 240, outputTokens: 60 }],
            });
        });

        it("keeps the first attempt's tokens when the retry itself fails", async () => {
            const { client, calls, state } = fakeClient();
            // the first request is answered, then the connection drops on the retry
            state.replies = [reply(CUT_OFF), new Error("connection reset")];
            const outcome = await createClaudeSummarizer(client).summarize(haiku);

            expect(calls).toHaveLength(2);
            expect(outcome.ok).toBe(false);
            expect(!outcome.ok && outcome.error).toMatch(/^connection reset/);
            expect(outcome.usage).toEqual([{ model: "claude-haiku-5-5", inputTokens: 120, outputTokens: 30 }]);
        });

        it("is the only failure that's retried", async () => {
            const { client, calls, state } = fakeClient();
            const summarizer = createClaudeSummarizer(client);

            state.replies = [reply("{not json")];
            expect(await summarizer.summarize(haiku)).toMatchObject({ ok: false, error: "the reply wasn't valid JSON" });
            state.replies = [reply(GOOD, { stop_reason: "refusal" })];
            expect(await summarizer.summarize(haiku)).toMatchObject({ ok: false, error: "the model declined to summarize this" });

            expect(calls).toHaveLength(2);
        });

        it("in a batch is re-requested once on the regular API at 8192, and only that item is", async () => {
            const { client, calls, state } = fakeClient();
            const first: SummaryRequest = { customId: "s1", model: "claude-haiku-5-5", system: FILE_SYSTEM_PROMPT, prompt: "File: src/a.ts" };
            const second: SummaryRequest = { customId: "s2", model: "claude-haiku-5-5", system: FILE_SYSTEM_PROMPT, prompt: "File: src/b.ts" };
            const summarizer = createClaudeSummarizer(client);
            await summarizer.submitBatch([first, second]);

            state.ended = true;
            state.results = [
                { custom_id: "s1", result: { type: "succeeded", message: reply(CUT_OFF) } },
                { custom_id: "s2", result: { type: "succeeded", message: reply(GOOD) } },
            ];
            state.replies = [reply(COMPLETE, { usage: { input_tokens: 120, output_tokens: 45 } })];

            const outcomes = await summarizer.batchResults("msgbatch_1");

            expect(sent(calls)).toEqual([{ endpoint: "messages", params: { ...requestParams(first), max_tokens: 8192 } }]);
            expect(outcomes).toEqual([
                // the batch attempt's 120 + 30 and the retry's 120 + 45
                { customId: "s1", ok: true, text: COMPLETE_TEXT, model: "claude-haiku-5-5", usage: [{ model: "claude-haiku-5-5", inputTokens: 240, outputTokens: 75 }] },
                {
                    customId: "s2", ok: true, text: { tagline: "Logging helpers", summary: "Writes log lines." }, model: "claude-haiku-5-5",
                    usage: [{ model: "claude-haiku-5-5", inputTokens: 120, outputTokens: 30 }],
                },
            ]);
        });

        it("in a batch is a failed outcome, not a throw, when its retry fails", async () => {
            const { client, calls, state } = fakeClient();
            const summarizer = createClaudeSummarizer(client);
            await summarizer.submitBatch([{ ...haiku, customId: "s1" }]);
            state.ended = true;
            state.results = [{ custom_id: "s1", result: { type: "succeeded", message: reply(CUT_OFF) } }];
            state.replies = [new Error("connection reset")];

            const outcomes = await summarizer.batchResults("msgbatch_1");

            expect(sent(calls)).toHaveLength(1);
            expect(outcomes).toHaveLength(1);
            expect(outcomes![0]).toMatchObject({ customId: "s1", ok: false, usage: [{ model: "claude-haiku-5-5", inputTokens: 120, outputTokens: 30 }] });
            expect(!outcomes![0].ok && outcomes![0].error).toMatch(/^connection reset/);
        });

        it("in a batch this process didn't submit can't be re-requested, so it fails and the next run resends it", async () => {
            const { client, calls, state } = fakeClient();
            state.ended = true;
            state.results = [{ custom_id: "s1", result: { type: "succeeded", message: reply(CUT_OFF) } }];

            // a run resumed after a restart: this summarizer never saw the batch's requests
            const outcomes = await createClaudeSummarizer(client).batchResults("msgbatch_1");

            expect(calls).toEqual([]);
            expect(outcomes).toHaveLength(1);
            expect(!outcomes![0].ok && outcomes![0].error).toMatch(/^the summary was cut off/);
        });
    });
});
