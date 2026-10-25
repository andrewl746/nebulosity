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
 * The model a dated snapshot id belongs to ("claude-sonnet-5-5-20261001" → "claude-sonnet-5-5"), or null for an id with
 * no date at its end. Only a date makes two ids one model: Anthropic's ids nest (claude-sonnet-4, claude-sonnet-4-5),
 * so a longer id that merely starts with another is a different model, with its own price.
 */
export function snapshotOf(model: string): string | null {
    return /-\d{8}$/.test(model) ? model.slice(0, -9) : null;
}

/**
 * A model's prices: the given ones (the setting's) before the built-in table. A dated snapshot takes its model's price
 * when it has none of its own. Null when there's no price on file.
 */
export function pricePerMTok(model: string, prices: PriceTable = {}): ModelPrice | null {
    // own keys only: an id such as "constructor" mustn't find Object's
    const lookUp = (id: string): ModelPrice | null =>
        Object.hasOwn(prices, id) ? prices[id] : Object.hasOwn(PRICES, id) ? PRICES[id] : null;
    const family = snapshotOf(model);
    return lookUp(model) ?? (family === null ? null : lookUp(family));
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
