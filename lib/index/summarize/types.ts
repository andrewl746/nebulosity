import type { SummaryText } from "../../db/store/summaries";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** One summary request. The custom id ("s<row id>") ties the answer back to its summaries row. */
export type SummaryRequest = { customId: string; model: string; system: string; prompt: string };

/** A request's answer. A failure keeps the model and tokens when a reply arrived but couldn't be used. */
export type SummaryOutcome =
    | { customId: string; ok: true; text: SummaryText; model: string; usage: TokenUsage }
    | { customId: string; ok: false; error: string; model: string | null; usage: TokenUsage | null };

/**
 * Everything the summary stage needs from Claude. createClaudeSummarizer (claude.ts)
 * talks to the real API; tests pass a stub, so no test makes a network call
 * (PIVOT_SPEC.md §11).
 */
export interface Summarizer {
    /** One request on the regular Messages API. Never throws: a failure is an outcome. */
    summarize(request: SummaryRequest): Promise<SummaryOutcome>;
    /** Submits requests as one Message Batch and returns its id. */
    submitBatch(requests: readonly SummaryRequest[]): Promise<string>;
    /** Every outcome once the batch has ended; null while it's still processing. */
    batchResults(batchId: string): Promise<SummaryOutcome[] | null>;
}

/**
 * Thrown by batchResults when Anthropic no longer has the batch (404): its results are
 * past retention, or it belongs to another workspace's key. Unlike a network error this
 * won't heal by retrying, so the runner gives up on the batch and resends its rows.
 */
export class BatchGoneError extends Error {
    constructor(readonly batchId: string, readonly reason: string){
        super(`Batch ${batchId} is no longer available at Anthropic: ${reason}`);
        this.name = "BatchGoneError";
    }
}

/**
 * Thrown by batchResults when Anthropic rejects the API key (401) or what it may do (403).
 * Polling again can't fix that, so the runner stops at once instead of counting it as a
 * missed poll. The batches stay at Anthropic; a run with a working key collects them.
 */
export class SummarizerAuthError extends Error {
    constructor(readonly reason: string){
        super(`Anthropic rejected the API key: ${reason}`);
        this.name = "SummarizerAuthError";
    }
}
