import { describe, expect, it } from "vitest";
import { costUsd, formatUsd, pricePerMTok } from "./pricing";
import { SUMMARY_MODELS } from "./prompts";

describe("pricePerMTok", () => {
    it("has a price on file for every model the summary stage uses", () => {
        // an unpriced folder model would make the checkpoint's folder estimate silently $0
        for (const model of Object.values(SUMMARY_MODELS)){
            expect(pricePerMTok(model), `no price on file for ${model}`).not.toBeNull();
        }
    });
});

describe("costUsd", () => {
    it("prices tokens at list price, half for batches", () => {
        const million = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
        expect(costUsd("claude-haiku-5-5", million, "direct")).toBeCloseTo(0.6, 10);
        expect(costUsd("claude-haiku-5-5", million, "batch")).toBeCloseTo(0.3, 10);
        expect(costUsd("claude-sonnet-5-5", million, "direct")).toBeCloseTo(12, 10);
    });

    it("matches a longer model id to its family's price, and says when it has no price", () => {
        expect(costUsd("claude-sonnet-5-5-20261001", { inputTokens: 1_000_000, outputTokens: 0 }, "direct")).toBeCloseTo(2, 10);
        expect(costUsd("claude-opus-5-5", { inputTokens: 1, outputTokens: 1 }, "direct")).toBeNull();
    });

    it("prices a model at the prices it's given before the built-in table (summaryModels, ADR-066)", () => {
        const prices = { "claude-zeta-1": { input: 0.10, output: 0.50 } };
        const usage = { inputTokens: 1_000_000, outputTokens: 200_000 };
        // 1,000,000 × $0.10 + 200,000 × $0.50, per million: $0.10 + $0.10 = $0.20 direct, half by batch
        expect(costUsd("claude-zeta-1", usage, "direct", prices)).toBeCloseTo(0.20, 10);
        expect(costUsd("claude-zeta-1", usage, "batch", prices)).toBeCloseTo(0.10, 10);
        // the table has no price for it
        expect(costUsd("claude-zeta-1", usage, "direct")).toBeNull();
    });

    it("lets given prices win over the table's, and matches a dated id to the given family too", () => {
        const million = { inputTokens: 1_000_000, outputTokens: 0 };
        // the table says $0.10 per million input tokens for Haiku 5.5; the given price is $1
        expect(costUsd("claude-haiku-5-5", million, "direct", { "claude-haiku-5-5": { input: 1, output: 5 } })).toBeCloseTo(1, 10);
        expect(costUsd("claude-zeta-1-20270101", million, "direct", { "claude-zeta-1": { input: 0.30, output: 1 } })).toBeCloseTo(0.30, 10);
        // an exact id in the table beats a shorter given family: claude-sonnet-5-5 is $2 per million input tokens
        expect(costUsd("claude-sonnet-5-5", million, "direct", { "claude-sonnet-5": { input: 9, output: 9 } })).toBeCloseTo(2, 10);
    });
});

describe("formatUsd", () => {
    it("prints 4 decimals below $0.10, so a cent-sized amount keeps its digits, and 2 from $0.10 up", () => {
        expect(formatUsd(0)).toBe("$0.0000");
        expect(formatUsd(0.0118)).toBe("$0.0118");
        expect(formatUsd(0.1)).toBe("$0.10");
        expect(formatUsd(11.694)).toBe("$11.69");
        expect(formatUsd(15)).toBe("$15.00");
    });
});
