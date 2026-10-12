import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SummaryText } from "../../db/store/summaries";
import { MAX_OUTPUT_TOKENS, SUMMARY_EFFORT } from "./prompts";
import { BatchGoneError, SummarizerAuthError, type ModelUsage, type Summarizer, type SummaryOutcome, type SummaryRequest } from "./types";

/** The reply we ask for, enforced by structured outputs (output_config.format). */
export const SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        tagline: { type: "string", description: "A noun phrase of 3 to 6 plain words." },
        summary: { type: "string", description: "2 to 4 sentences." },
    },
    required: ["tagline", "summary"],
    additionalProperties: false,
};

const replySchema = z.object({ tagline: z.string().trim().min(1), summary: z.string().trim().min(1) });

/** Taglines are asked for in 3 to 6 words; up to this many are kept whole (PIVOT_SPEC.md §4.1, ADR-034). */
export const MAX_TAGLINE_WORDS = 8;

/** Words a tagline can't end on: cut right after one, the phrase hangs ("…the browser workbench and"). */
const CONNECTORS: ReadonlySet<string> = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "via", "by", "from", "at", "as"]);

/**
 * A tagline as the UI shows it: plain text, at most MAX_TAGLINE_WORDS words. Backticks go, since the UI doesn't
 * render markdown. A tagline within the limit stays whole: a hard cut at the 6 words we ask for sliced taglines
 * mid-phrase. A longer one is cut at the limit, then loses the connector words it now ends on (never the first word).
 */
export function cleanTagline(raw: string): string {
    let words = raw.replace(/`/g, "").split(/\s+/).filter(Boolean);

    if (words.length > MAX_TAGLINE_WORDS){
        words = words.slice(0, MAX_TAGLINE_WORDS);
        while (words.length > 1 && CONNECTORS.has(words[words.length - 1].toLowerCase())) words.pop();
    }

    return words.join(" ").replace(/[\s.,;:]+$/, "");
}

type Effort = "low" | "medium" | "high";

/**
 * Sonnet 5.5 on the regular API: if a safety classifier declines a request, the API runs
 * it again on a fallback model it picks by category. The Batches API rejects this
 * parameter, and Haiku 5.5 has no server-side fallback.
 */
const SONNET_FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/** One attempt in a BetaMessage's usage.iterations (the SDK's BetaIterationsUsage entries). */
type Attempt = { model?: string | null; input_tokens: number; output_tokens: number };

/** What we read from a reply. Both Message (regular, batch) and BetaMessage fit; only BetaMessage has iterations. */
type Reply = {
    model: string;
    stop_reason: string | null;
    content: ReadonlyArray<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number; iterations?: ReadonlyArray<Attempt> | null };
};

/** One request's parameters, the same on the regular API and inside a batch. Thinking stays at the model's default (adaptive). */
export function requestParams(request: SummaryRequest, effort: Effort = SUMMARY_EFFORT) {
    return {
        model: request.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.system,
        messages: [{ role: "user" as const, content: request.prompt }],
        output_config: { effort, format: { type: "json_schema" as const, schema: SUMMARY_SCHEMA } },
    };
}

/** The tagline and summary in a reply, or an Error saying what was wrong with it. */
export function parseSummary(reply: Pick<Reply, "stop_reason" | "content">): SummaryText {
    if (reply.stop_reason === "refusal") throw new Error("the model declined to summarize this");
    if (reply.stop_reason === "max_tokens") throw new Error(`the reply ran past ${MAX_OUTPUT_TOKENS} output tokens`);

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
    return { tagline, summary: parsed.data.summary };
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

export function outcomeFromReply(customId: string, reply: Reply): SummaryOutcome {
    const usage = usageByModel(reply);

    try{
        return { customId, ok: true, text: parseSummary(reply), model: reply.model, usage };
    } catch (err){
        return { customId, ok: false, error: messageOf(err), model: reply.model, usage };
    }
}

export function outcomeFromBatchItem(item: Anthropic.Messages.MessageBatchIndividualResponse): SummaryOutcome {
    const { custom_id: customId, result } = item;

    switch (result.type){
        case "succeeded":
            return outcomeFromReply(customId, result.message);
        case "errored":
            return { customId, ok: false, error: `batch request errored: ${result.error.error.message}`, model: null, usage: null };
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
 */
export function createClaudeSummarizer(client: Anthropic, effort: Effort = SUMMARY_EFFORT): Summarizer {
    return {
        async summarize(request){
            try{
                const params = requestParams(request, effort);
                const reply = request.model.startsWith("claude-sonnet")
                    ? await client.beta.messages.create({ ...params, ...SONNET_FALLBACK })
                    : await client.messages.create(params);
                return outcomeFromReply(request.customId, reply);
            } catch (err){
                return { customId: request.customId, ok: false, error: messageOf(err), model: null, usage: null };
            }
        },

        async submitBatch(requests){
            const batch = await client.messages.batches.create(
                { requests: requests.map((r) => ({ custom_id: r.customId, params: requestParams(r, effort) })) },
                // never retried: after a lost reply, a retry would create a second batch that's billed and never collected
                { maxRetries: 0 },
            );
            return batch.id;
        },

        async batchResults(batchId){
            try{
                const batch = await client.messages.batches.retrieve(batchId);
                if (batch.processing_status !== "ended") return null;

                // results arrive in any order: they're matched by custom_id, never by position
                const outcomes: SummaryOutcome[] = [];
                for await (const item of await client.messages.batches.results(batchId)){
                    outcomes.push(outcomeFromBatchItem(item));
                }
                return outcomes;
            } catch (err){
                // A 404 is permanent (results past retention, or another workspace's key), and so is a rejected key.
                // Anything else (a dropped connection, a 5xx) may heal: the runner counts it as a missed poll.
                if (err instanceof Anthropic.NotFoundError) throw new BatchGoneError(batchId, messageOf(err));
                if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError){
                    throw new SummarizerAuthError(messageOf(err));
                }
                throw err;
            }
        },
    };
}

function messageOf(err: unknown): string {
    if (err instanceof Anthropic.APIError) return `API error ${err.status ?? "(no status)"}: ${err.message}`;
    return err instanceof Error ? err.message : String(err);
}
