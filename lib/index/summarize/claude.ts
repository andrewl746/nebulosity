import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SummaryText } from "../../db/store/summaries";
import { MAX_OUTPUT_TOKENS, SUMMARY_EFFORT } from "./prompts";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "./types";

/** The reply we ask for, enforced by structured outputs (output_config.format). */
export const SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        tagline: { type: "string", description: "What this is, in at most 6 words." },
        summary: { type: "string", description: "2 to 4 sentences." },
    },
    required: ["tagline", "summary"],
    additionalProperties: false,
};

const replySchema = z.object({ tagline: z.string().trim().min(1), summary: z.string().trim().min(1) });

type Effort = "low" | "medium" | "high";

/**
 * Sonnet 5.5 on the regular API: if a safety classifier declines a request, the API runs
 * it again on a fallback model it picks by category. The Batches API rejects this
 * parameter, and Haiku 5.5 has no server-side fallback.
 */
const SONNET_FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/** What we read from a reply. Both Message (regular, batch) and BetaMessage fit. */
type Reply = {
    model: string;
    stop_reason: string | null;
    content: ReadonlyArray<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
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

    // "≤ 6 words" (PIVOT_SPEC.md §4.1) is a promise to the UI, so it's enforced here, not just asked for
    const tagline = parsed.data.tagline.split(/\s+/).slice(0, 6).join(" ").replace(/\.+$/, "");
    if (!tagline) throw new Error("the reply didn't have a tagline and a summary");
    return { tagline, summary: parsed.data.summary };
}

export function outcomeFromReply(customId: string, reply: Reply): SummaryOutcome {
    const usage = { inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens };

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
            const batch = await client.messages.batches.create({
                requests: requests.map((r) => ({ custom_id: r.customId, params: requestParams(r, effort) })),
            });
            return batch.id;
        },

        async batchResults(batchId){
            const batch = await client.messages.batches.retrieve(batchId);
            if (batch.processing_status !== "ended") return null;

            // results arrive in any order: they're matched by custom_id, never by position
            const outcomes: SummaryOutcome[] = [];
            for await (const item of await client.messages.batches.results(batchId)){
                outcomes.push(outcomeFromBatchItem(item));
            }
            return outcomes;
        },
    };
}

function messageOf(err: unknown): string {
    if (err instanceof Anthropic.APIError) return `API error ${err.status ?? "(no status)"}: ${err.message}`;
    return err instanceof Error ? err.message : String(err);
}
