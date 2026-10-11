import type { TokenUsage } from "./types";

/**
 * USD per million tokens at Claude API list prices (claude-api skill, prices cached
 * 2026-10-06; check platform.claude.com/pricing before trusting them for money). Haiku's
 * prices hold for prompts up to 100K tokens, and ours stay far below that. Batch requests
 * cost half.
 */
const PRICES: Record<string, { input: number; output: number }> = {
    "claude-haiku-5-5": { input: 0.10, output: 0.50 },
    "claude-sonnet-5-5": { input: 2.00, output: 10.00 },
};

/** A model's prices, matching a longer id (a dated snapshot) to its family. Null when there's no price on file. */
export function pricePerMTok(model: string): { input: number; output: number } | null {
    if (PRICES[model]) return PRICES[model];
    const family = Object.keys(PRICES).find((known) => model.startsWith(known));
    return family ? PRICES[family] : null;
}

export function costUsd(model: string, usage: TokenUsage, transport: "direct" | "batch"): number | null {
    const price = pricePerMTok(model);
    if (!price) return null;

    const full = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
    return transport === "batch" ? full / 2 : full;
}
