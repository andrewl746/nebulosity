import type { SummaryTargetKind } from "../../db/schema";
import type { UsageRow } from "../../db/store/summaries";
import { costUsd } from "./pricing";
import type { TokenUsage } from "./types";

/**
 * The tokens one request is assumed to take while its model has no recorded usage on the repo (ADR-035); after that,
 * the model's measured mean replaces them.
 * - Files: Review #1's Haiku means (SUMMARY_REVIEW.md: 91,515 tokens in and 5,226 out over 20 VS Code files), rounded.
 * - Folders and the repo: a folder's prompt lists its children's taglines and summaries, about 1,000 tokens, and the
 *   answer is about as long as a file's (Review #2: Sonnet's 20 summaries averaged 250 tokens out).
 */
export const ASSUMED_TOKENS: Readonly<Record<SummaryTargetKind, TokenUsage>> = {
    file: { inputTokens: 4_600, outputTokens: 260 },
    folder: { inputTokens: 1_000, outputTokens: 250 },
    repo: { inputTokens: 1_000, outputTokens: 250 },
};

/** One request the projection prices: the kind of target it's for, and the model that answers it. */
export type ProjectedRequest = { kind: SummaryTargetKind; model: string };

type Billing = "direct" | "batch";

export type SpendInput = {
    /** Every summary_usage row of the repo: what it has paid so far, and each model's tokens per request. */
    usage: readonly UsageRow[];
    /** Requests already in batches at Anthropic: billed when their batch ends, at batch prices. */
    atAnthropic: readonly ProjectedRequest[];
    /** The submission about to go out (one batch, or one regular-API wave), at its own transport's prices. */
    thisSubmission: readonly ProjectedRequest[];
    thisTransport: Billing;
    /** The targets still ready or waiting after it, and the transport they're priced at. */
    rest: readonly ProjectedRequest[];
    restTransport: Billing;
};

/** The projection's four parts in USD, their total, and the models that had to be counted as $0. */
export type SpendProjection = {
    spent: number;
    atAnthropic: number;
    thisSubmission: number;
    rest: number;
    total: number;
    /** Models with no price on file (pricing.ts), in name order. Each counted as $0, so the total is then a lower bound. */
    unpriced: string[];
};

/**
 * What the repo's summaries will have cost once this submission and the rest of the run are paid for (ADR-035):
 * spent + at Anthropic + this submission + the rest. Pure, so every figure can be checked by hand: the runner reads the
 * usage and the plan, and decides what to do with the answer.
 */
export function projectSpend(input: SpendInput): SpendProjection {
    const unpriced = new Set<string>();

    // A model with no price on file can't be priced, but it isn't free either: it adds $0 here, and the caller names it.
    const price = (model: string, tokens: TokenUsage, transport: Billing): number => {
        const cost = costUsd(model, tokens, transport);
        if (cost === null) unpriced.add(model);
        return cost ?? 0;
    };

    // A request is expected to take what its model's requests have taken on this repo so far. The assumption for its
    // kind stands in only until the model has answered something.
    const means = meanTokensPerRequest(input.usage);
    const estimate = (requests: readonly ProjectedRequest[], transport: Billing): number =>
        requests.reduce((sum, r) => sum + price(r.model, means.get(r.model) ?? ASSUMED_TOKENS[r.kind], transport), 0);

    const spent = input.usage.reduce((sum, row) => sum + price(row.model, row, row.transport), 0);
    const atAnthropic = estimate(input.atAnthropic, "batch");
    const thisSubmission = estimate(input.thisSubmission, input.thisTransport);
    const rest = estimate(input.rest, input.restTransport);

    return { spent, atAnthropic, thisSubmission, rest, total: spent + atAnthropic + thisSubmission + rest, unpriced: [...unpriced].sort() };
}

/**
 * Each model's mean tokens per request on the repo: Σ tokens ÷ Σ requests over both transports together. (A batch
 * request takes the same tokens as a regular one; only its price differs.)
 */
function meanTokensPerRequest(usage: readonly UsageRow[]): Map<string, TokenUsage> {
    const totals = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();
    for (const row of usage){
        const total = totals.get(row.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
        total.requests += row.requests;
        total.inputTokens += row.inputTokens;
        total.outputTokens += row.outputTokens;
        totals.set(row.model, total);
    }

    const means = new Map<string, TokenUsage>();
    for (const [model, total] of totals){
        if (total.requests > 0) means.set(model, { inputTokens: total.inputTokens / total.requests, outputTokens: total.outputTokens / total.requests });
    }
    return means;
}
