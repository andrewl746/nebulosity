import { describe, expect, it } from "vitest";
import { costUsd, pricePerMTok } from "./pricing";
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
});
