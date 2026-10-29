import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SummaryText } from "../../db/store/summaries";
import { mapLimit } from "./concurrency";
import { summariesEnabled } from "./env";
import { MAX_OUTPUT_TOKENS, RETRY_MAX_OUTPUT_TOKENS, SUMMARY_EFFORT } from "./prompts";
import {
    BatchGoneError, ModelUnavailableError, SummarizerAuthError, type ModelUsage, type Summarizer, type SummaryOutcome, type SummaryRequest,
    type UnavailableModel,
} from "./types";

/** The reply we ask for, enforced by structured outputs (output_config.format). */
export const SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        tagline: { type: "string", description: "A noun phrase of 3 to 6 plain words." },
        summary: { type: "string", description: "Short paragraphs separated by a blank line, about the length the request gives." },
    },
    required: ["tagline", "summary"],
    additionalProperties: false,
};

// An empty summary passes the schema: parseSummary then calls it cut off, so it gets the retry.
const replySchema = z.object({ tagline: z.string().trim().min(1), summary: z.string().trim() });

/** How the error of a cut-off answer starts. The summarizer retries exactly these, once (ADR-034). */
const CUT_OFF = "the summary was cut off";

/** The end of a sentence: . ! or ?, then any closing quotes, backticks or brackets ("…(see `log.ts`.)"). */
const SENTENCE_END = /[.!?]["'`)\]]*$/;

/** Two or more periods at the very end ("…in one place.."), which read as one. */
const TRAILING_PERIODS = /\.{2,}$/;

/** A paragraph break: two line breaks with only whitespace between them, CRLF and extra blank lines included. */
const PARAGRAPH_BREAK = /\n\s*\n/;

/**
 * A summary's paragraphs in the one shape every reader splits on (P5): exactly one blank line between paragraphs,
 * each trimmed, and a single line break inside one read as a space.
 */
function normalizeParagraphs(summary: string): string {
    return summary.split(PARAGRAPH_BREAK)
        .map((paragraph) => paragraph.trim().replace(/\s*\n\s*/g, " "))
        .filter((paragraph) => paragraph !== "")
        .join("\n\n");
}

/** Regular-API retries of a batch's cut-off answers in flight at once: as many as the runner's regular-API waves send. */
const RETRY_CONCURRENCY = 4;

/** Taglines are asked for in 3 to 6 words; up to this many are kept whole (PIVOT_SPEC.md §4.1, ADR-034). */
export const MAX_TAGLINE_WORDS = 8;

/** Words a tagline can't end on: cut right after one, the phrase hangs ("…the browser workbench and"). */
const CONNECTORS: ReadonlySet<string> = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "via", "by", "from", "at", "as"]);

/** Whitespace and the punctuation that closes a phrase, which a tagline never ends on. */
const TRAILING_PUNCTUATION = /[\s.,;:]+$/;

/**
 * A tagline as the UI shows it: plain text, at most MAX_TAGLINE_WORDS words. Backticks go, since the UI doesn't
 * render markdown. A tagline within the limit stays whole: a hard cut at the 6 words we ask for sliced taglines
 * mid-phrase. A longer one is cut at the limit, then loses the connector words it now ends on (never the first word).
 */
export function cleanTagline(raw: string): string {
    let words = raw.replace(/`/g, "").split(/\s+/).filter(Boolean);

    if (words.length > MAX_TAGLINE_WORDS){
        words = words.slice(0, MAX_TAGLINE_WORDS);
        // punctuation stuck to the last word doesn't make it any less dangling: "and," is still an "and"
        while (words.length > 1 && CONNECTORS.has(words[words.length - 1].replace(TRAILING_PUNCTUATION, "").toLowerCase())) words.pop();
    }

    return words.join(" ").replace(TRAILING_PUNCTUATION, "");
}

type Effort = "low" | "medium" | "high";

/**
 * Sonnet 5.5 on the regular API: if a safety classifier declines a request, the API runs
 * it again on a fallback model it picks by category. The Batches API rejects this
 * parameter, and Haiku 5.5 has no server-side fallback. It goes only with a kind left at its
 * default (ADR-066, R3): a model set in summaryModels may not know this beta.
 */
const SONNET_FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/** Whether a request gets SONNET_FALLBACK: a default Sonnet model, never a set one. */
function withFallback(request: SummaryRequest): boolean {
    return !request.customModel && request.model.startsWith("claude-sonnet");
}

/**
 * The model a 404 says the API doesn't serve, or null when the 404 is about something else (a batch past retention,
 * another workspace's batch). The API answers an unknown model with a not_found_error whose message names it
 * ("model: claude-haiku-5-5"). When the request's model is known, the message has to name that model whole (not as
 * the start of a longer id: claude-sonnet-5-5 isn't claude-sonnet-5); when it isn't (a batch another process
 * submitted), the model is read from that wording.
 */
export function unavailableModel(type: string | null | undefined, message: string, model?: string): string | null {
    if (type !== "not_found_error") return null;
    if (model !== undefined) return namesWhole(message, model) ? model : null;
    // a model id's characters (letters, digits, - _ . : @), less a sentence's closing . or :, which no id ends with
    return /\bmodel: ([\w.:@-]+)/.exec(message)?.[1].replace(/[.:]+$/, "") || null;
}

/** Whether `message` holds `model` as a whole id: no id character just before it, nor a letter, digit, - or _ just after. */
function namesWhole(message: string, model: string): boolean {
    for (let at = message.indexOf(model); at !== -1; at = message.indexOf(model, at + 1)){
        const before = message[at - 1] ?? "";
        const after = message[at + model.length] ?? "";
        if (!/[\w.:@-]/.test(before) && !/[\w-]/.test(after)) return true;
    }
    return false;
}

/** The API's own words in an SDK error (its body's error.message) and its error.type, which the SDK reads from that body too. */
function apiError(err: InstanceType<typeof Anthropic.APIError>): { type: string | null; message: string } {
    const body = err.error as { error?: { type?: unknown; message?: unknown } } | undefined;
    const message = typeof body?.error?.message === "string" ? body.error.message : err.message;
    const type = err.type ?? (typeof body?.error?.type === "string" ? body.error.type : null);
    return { type, message };
}

/** A request's model as gone, if the error is the API's 404 for it. */
function goneFrom(err: unknown, model: string): UnavailableModel | null {
    if (!(err instanceof Anthropic.NotFoundError)) return null;
    const { type, message } = apiError(err);
    const gone = unavailableModel(type, message, model);
    return gone ? { model: gone, reason: message } : null;
}

/** One attempt in a BetaMessage's usage.iterations (the SDK's BetaIterationsUsage entries). */
type Attempt = { model?: string | null; input_tokens: number; output_tokens: number };

/** What we read from a reply. Both Message (regular, batch) and BetaMessage fit; only BetaMessage has iterations. */
type Reply = {
    model: string;
    stop_reason: string | null;
    content: ReadonlyArray<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number; iterations?: ReadonlyArray<Attempt> | null };
};

/**
 * One request's parameters, the same on the regular API and inside a batch. Thinking stays at the model's default
 * (adaptive). maxTokens is raised only for the retry of a cut-off answer.
 */
export function requestParams(request: SummaryRequest, effort: Effort = SUMMARY_EFFORT, maxTokens: number = MAX_OUTPUT_TOKENS) {
    return {
        model: request.model,
        max_tokens: maxTokens,
        system: request.system,
        messages: [{ role: "user" as const, content: request.prompt }],
        output_config: { effort, format: { type: "json_schema" as const, schema: SUMMARY_SCHEMA } },
    };
}

/**
 * The tagline and summary in a reply, or an Error saying what was wrong with it. A summary that isn't whole is never
 * returned (ADR-034): the reply has to have ended its turn, and its summary has to end a sentence. Anything else is
 * "cut off", the one failure the summarizer retries.
 */
export function parseSummary(reply: Pick<Reply, "stop_reason" | "content">): SummaryText {
    if (reply.stop_reason === "refusal") throw new Error("the model declined to summarize this");
    // Only end_turn means the model finished. max_tokens hit the limit, and pause_turn (or any stop reason added later)
    // didn't end the turn, so the text may stop anywhere, even inside JSON that happens to parse.
    if (reply.stop_reason !== "end_turn") throw new Error(`${CUT_OFF} (stop reason: ${reply.stop_reason})`);

    // the last text block is the answer that stood: a Sonnet fallback leaves the declined partial before its marker
    const text = reply.content.findLast((block) => block.type === "text")?.text;
    if (!text) throw new Error("the reply had no text");

    let json: unknown;
    try{
        json = JSON.parse(text);
    } catch{
        throw new Error("the reply wasn't valid JSON");
    }

    const parsed = replySchema.safeParse(json);
    if (!parsed.success) throw new Error("the reply didn't have a tagline and a summary");

    // "up to 8 words, as plain text" (PIVOT_SPEC.md §4.1) is a promise to the UI, so it's enforced here, not just asked for
    const tagline = cleanTagline(parsed.data.tagline);
    if (!tagline) throw new Error("the reply didn't have a tagline and a summary");

    // ".." is a slip, not an ellipsis, and so is "...": the run becomes one "." before the check below.
    // Then the paragraphs take their one shape, whatever line breaks the model wrote between them.
    const summary = normalizeParagraphs(parsed.data.summary.replace(TRAILING_PERIODS, "."));
    // A normal stop doesn't prove the answer is whole: Summary Review #3 found well-formed JSON, stopped at end_turn,
    // whose summary ended "…applyEdits. The". A summary's paragraphs are whole sentences, so a whole one ends a sentence.
    if (!SENTENCE_END.test(summary)) throw new Error(`${CUT_OFF} (stop reason: end_turn): ${summary === "" ? "it's empty" : "it ends mid-sentence"}`);
    return { tagline, summary };
}

/**
 * A reply's tokens, per model. The top-level usage covers only the attempt that produced the
 * message, so a Sonnet request a server-side fallback finished would hide the declined attempt,
 * which is billed too. usage.iterations lists every attempt with its model; an attempt without
 * one is counted under the reply's model.
 */
export function usageByModel(reply: Pick<Reply, "model" | "usage">): ModelUsage[] {
    const attempts = reply.usage.iterations ?? [];
    if (attempts.length === 0){
        return [{ model: reply.model, inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens }];
    }

    const byModel = new Map<string, ModelUsage>();
    for (const attempt of attempts){
        const model = attempt.model ?? reply.model;
        const sum = byModel.get(model) ?? { model, inputTokens: 0, outputTokens: 0 };
        sum.inputTokens += attempt.input_tokens;
        sum.outputTokens += attempt.output_tokens;
        byModel.set(model, sum);
    }
    return [...byModel.values()];
}

/**
 * Several attempts' tokens, summed per model, in the order the models first appear. Every attempt is billed, so a
 * retried answer counts both; and per model, one target still adds one request to that model's tally.
 */
export function mergeUsage(...attempts: ReadonlyArray<readonly ModelUsage[] | null>): ModelUsage[] {
    const byModel = new Map<string, ModelUsage>();
    for (const share of attempts.flatMap((usage) => usage ?? [])){
        const sum = byModel.get(share.model) ?? { model: share.model, inputTokens: 0, outputTokens: 0 };
        sum.inputTokens += share.inputTokens;
        sum.outputTokens += share.outputTokens;
        byModel.set(share.model, sum);
    }
    return [...byModel.values()];
}

/** Whether an outcome is a cut-off answer: the one failure worth asking for again. */
function isCutOff(outcome: SummaryOutcome): boolean {
    return !outcome.ok && outcome.error.startsWith(CUT_OFF);
}

export function outcomeFromReply(customId: string, reply: Reply): SummaryOutcome {
    const usage = usageByModel(reply);

    try{
        return { customId, ok: true, text: parseSummary(reply), model: reply.model, usage };
    } catch (err){
        return { customId, ok: false, error: messageOf(err), model: reply.model, usage };
    }
}

/** One batch result as an outcome. `model` is the request's, when this process sent it: it decides whether a 404 names it. */
export function outcomeFromBatchItem(item: Anthropic.Messages.MessageBatchIndividualResponse, model?: string): SummaryOutcome {
    const { custom_id: customId, result } = item;

    switch (result.type){
        case "succeeded":
            return outcomeFromReply(customId, result.message);
        case "errored": {
            const { type, message } = result.error.error;
            const gone = unavailableModel(type, message, model);
            return {
                customId, ok: false, error: `batch request errored: ${message}`, model: null, usage: null,
                ...(gone ? { modelUnavailable: { model: gone, reason: message } } : {}),
            };
        }
        case "expired":
            return { customId, ok: false, error: "the batch expired before this request ran", model: null, usage: null };
        case "canceled":
            return { customId, ok: false, error: "the batch was canceled", model: null, usage: null };
    }
}

/**
 * The real Summarizer. Pass a client made with `new Anthropic({ maxRetries: 3 })`: the
 * SDK then retries connection errors, 408/409/429 and 5xx three times with backoff,
 * honouring retry-after (PIVOT_SPEC.md §5.7), before a request counts as failed.
 * Creating a batch is the exception: it's never retried (see submitBatch).
 *
 * A cut-off answer (parseSummary) is asked for once more on the regular API with
 * RETRY_MAX_OUTPUT_TOKENS, whichever transport sent it (ADR-034). Once at most: a second
 * cut-off answer is a failed outcome, so nothing is stored and the next run resends it.
 */
export function createClaudeSummarizer(client: Anthropic, effort: Effort = SUMMARY_EFFORT): Summarizer {
    // Each batch's requests, kept from submission until its results are collected: the results don't carry the
    // prompts, and a retry needs them. A batch another process submitted (a run resumed after a restart) isn't here,
    // so its cut-off answers stay failed, and the next run resends them.
    const submitted = new Map<string, Map<string, SummaryRequest>>();

    /** One request on the regular API. Never throws: a failure is an outcome, marked when it's the model that's gone. */
    async function send(request: SummaryRequest, maxTokens: number): Promise<SummaryOutcome> {
        try{
            const params = requestParams(request, effort, maxTokens);
            const reply = withFallback(request)
                ? await client.beta.messages.create({ ...params, ...SONNET_FALLBACK })
                : await client.messages.create(params);
            return outcomeFromReply(request.customId, reply);
        } catch (err){
            const gone = goneFrom(err, request.model);
            return { customId: request.customId, ok: false, error: messageOf(err), model: null, usage: null, ...(gone ? { modelUnavailable: gone } : {}) };
        }
    }

    /** The one retry of a cut-off answer. Both attempts are billed, so the outcome counts both. Never throws. */
    async function retry(request: SummaryRequest, cutOff: SummaryOutcome): Promise<SummaryOutcome> {
        const second = await send(request, RETRY_MAX_OUTPUT_TOKENS);
        const usage = mergeUsage(cutOff.usage, second.usage);
        if (second.ok) return { ...second, usage };
        return { ...second, error: `${second.error} (retried once at ${RETRY_MAX_OUTPUT_TOKENS} output tokens)`, model: second.model ?? cutOff.model, usage };
    }

    return {
        async summarize(request){
            const first = await send(request, MAX_OUTPUT_TOKENS);
            return isCutOff(first) ? retry(request, first) : first;
        },

        async submitBatch(requests){
            let batch: { id: string };
            try{
                batch = await client.messages.batches.create(
                    { requests: requests.map((r) => ({ custom_id: r.customId, params: requestParams(r, effort) })) },
                    // never retried: after a lost reply, a retry would create a second batch that's billed and never collected
                    { maxRetries: 0 },
                );
            } catch (err){
                // refused because a model in it is gone: the runner stops on this rather than resending it every run
                for (const model of new Set(requests.map((r) => r.model))){
                    const gone = goneFrom(err, model);
                    if (gone) throw new ModelUnavailableError(gone.model, gone.reason);
                }
                throw err;
            }
            submitted.set(batch.id, new Map(requests.map((r) => [r.customId, r])));
            return batch.id;
        },

        async batchResults(batchId){
            let outcomes: SummaryOutcome[];
            try{
                const batch = await client.messages.batches.retrieve(batchId);
                if (batch.processing_status !== "ended") return null;

                // results arrive in any order: they're matched by custom_id, never by position
                outcomes = [];
                const sent = submitted.get(batchId);
                for await (const item of await client.messages.batches.results(batchId)){
                    outcomes.push(outcomeFromBatchItem(item, sent?.get(item.custom_id)?.model));
                }
            } catch (err){
                // A 404 is permanent (results past retention, or another workspace's key), and so is a rejected key.
                // Anything else (a dropped connection, a 5xx) may heal: the runner counts it as a missed poll.
                if (err instanceof Anthropic.NotFoundError){
                    submitted.delete(batchId);
                    throw new BatchGoneError(batchId, messageOf(err));
                }
                if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError){
                    throw new SummarizerAuthError(messageOf(err));
                }
                throw err;
            }

            // Cut-off answers are retried before the runner sees them, so it only gets whole summaries or failures.
            // retry never throws, so nothing from here on can lose a collected batch's results.
            const requests = submitted.get(batchId);
            const settled = await mapLimit(outcomes, RETRY_CONCURRENCY, async (outcome) => {
                const request = isCutOff(outcome) ? requests?.get(outcome.customId) : undefined;
                return request ? retry(request, outcome) : outcome;
            });
            submitted.delete(batchId);
            return settled;
        },
    };
}

function messageOf(err: unknown): string {
    if (err instanceof Anthropic.APIError) return `API error ${err.status ?? "(no status)"}: ${err.message}`;
    return err instanceof Error ? err.message : String(err);
}

/** The real Summarizer when ANTHROPIC_API_KEY is set, its failed requests retried 3 times (PIVOT_SPEC.md §5.7); else null. */
export function summarizerFromEnv(): Summarizer | null {
    return summariesEnabled() ? createClaudeSummarizer(new Anthropic({ maxRetries: 3 })) : null;
}
