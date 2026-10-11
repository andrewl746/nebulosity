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
