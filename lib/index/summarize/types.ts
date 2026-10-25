import { configPath } from "../../config";
import type { SummaryText } from "../../db/store/summaries";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** One model's tokens in one request. A Sonnet request that a server-side fallback finished has two: both attempts are billed. */
export type ModelUsage = TokenUsage & { model: string };

/**
 * One summary request. The custom id ("s<row id>") ties the answer back to its summaries row. customModel: the model
 * came from summaryModels rather than the defaults, so it goes on the plain Messages API, without the Sonnet fallback
 * beta, which a newer model may not know (ADR-066).
 */
export type SummaryRequest = { customId: string; model: string; system: string; prompt: string; customModel?: boolean };

/** A model the API said it doesn't serve (a 404 not_found_error naming it), and what the API said. */
export type UnavailableModel = { model: string; reason: string };

/**
 * A request's answer. `model` wrote the text; `usage` lists the tokens of every model that
 * ran. A failure keeps the model and tokens when a reply arrived but couldn't be used.
 * modelUnavailable marks the failure that every request to that model will share (ADR-066).
 */
export type SummaryOutcome =
    | { customId: string; ok: true; text: SummaryText; model: string; usage: ModelUsage[] }
    | { customId: string; ok: false; error: string; model: string | null; usage: ModelUsage[] | null; modelUnavailable?: UnavailableModel };

/**
 * Everything the summary stage needs from Claude. createClaudeSummarizer (claude.ts)
 * talks to the real API; tests pass a stub, so no test makes a network call
 * (PIVOT_SPEC.md §11).
 */
export interface Summarizer {
    /** One request on the regular Messages API. Never throws: a failure is an outcome. */
    summarize(request: SummaryRequest): Promise<SummaryOutcome>;
    /** Submits requests as one Message Batch and returns its id. Throws ModelUnavailableError when that's why it's refused. */
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

/**
 * Thrown when Anthropic no longer serves a summary model (ADR-066): a 404 not_found_error naming it, on a request, a
 * batch's creation or a batch's result. Every other request to that model would fail the same way, so a run stops at
 * the first one instead of failing thousands one by one (Review Focus 2). The message says where to choose another.
 */
export class ModelUnavailableError extends Error {
    constructor(readonly model: string, readonly reason: string, configFile: string = configPath()){
        super(`${model} isn't available any more (the API said: ${reason}). Choose another model under "summaryModels" in ${configFile}; see the README's "Summary models".`);
        this.name = "ModelUnavailableError";
    }
}
