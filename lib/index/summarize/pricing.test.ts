import { describe, expect, it } from "vitest";
import { costUsd } from "./pricing";

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
