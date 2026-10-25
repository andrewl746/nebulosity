import type { TokenUsage } from "./types";

/** A model's list prices: US dollars per million input and output tokens. */
export type ModelPrice = { input: number; output: number };

/** Prices by model id, such as the ones summaryModels sets (ADR-066). */
export type PriceTable = Readonly<Record<string, ModelPrice>>;

/**
 * USD per million tokens at Claude API list prices (claude-api skill, prices cached
 * 2026-10-06; check platform.claude.com/pricing before trusting them for money). Haiku's
 * prices hold for prompts up to 100K tokens, and ours stay far below that. Batch requests
 * cost half. A model set in summaryModels brings its own prices when it isn't here (ADR-066).
 */
const PRICES: PriceTable = {
    "claude-haiku-5-5": { input: 0.10, output: 0.50 },
    "claude-sonnet-5-5": { input: 2.00, output: 10.00 },
};

/**
 * A model's prices: the given ones (the setting's) before the built-in table, an exact id before a family. A longer id
 * (a dated snapshot) takes the price of the longest id it starts with, the given ones winning a tie. Null when there's
 * no price on file.
 */
export function pricePerMTok(model: string, prices: PriceTable = {}): ModelPrice | null {
    // own keys only: an id such as "constructor" mustn't find Object's
    if (Object.hasOwn(prices, model)) return prices[model];
    if (Object.hasOwn(PRICES, model)) return PRICES[model];

    // given first, so the stable sort keeps a given family ahead of a table family of the same length
    const families = [...Object.entries(prices), ...Object.entries(PRICES)].filter(([known]) => model.startsWith(known));
    families.sort(([a], [b]) => b.length - a.length);
    return families[0]?.[1] ?? null;
}

export function costUsd(model: string, usage: TokenUsage, transport: "direct" | "batch", prices?: PriceTable): number | null {
    const price = pricePerMTok(model, prices);
    if (!price) return null;

    const full = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
    return transport === "batch" ? full / 2 : full;
}

/** A dollar amount: 4 decimals below $0.10, so $0.0118 doesn't read as $0.01, and 2 above. */
export function formatUsd(x: number): string {
    return `$${x < 0.1 ? x.toFixed(4) : x.toFixed(2)}`;
}
