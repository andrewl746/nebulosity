import { describe, expect, it } from "vitest";
import { estimateSpend } from "./estimate";

const requests = [
    { kind: "file" as const, model: "claude-haiku-5-5" },
    { kind: "file" as const, model: "claude-haiku-5-5" },
    { kind: "folder" as const, model: "claude-sonnet-5-5" },
];

describe("estimateSpend", () => {
    it("prices every request a run would send, before any usage exists", () => {
        expect(estimateSpend(requests, [], "direct").usd).toBeCloseTo(0.00568, 10);
        expect(estimateSpend(requests, [], "batch").usd).toBeCloseTo(0.00284, 10);
        expect(estimateSpend(requests, [], "batch").requests).toBe(3);
    });

    it("uses what the repo's requests have taken so far, when it has some", () => {
        const usage = [{ model: "claude-haiku-5-5", transport: "batch" as const, requests: 10, inputTokens: 20_000, outputTokens: 2_000 }];
        // Haiku now 2,000 in and 200 out per request: (2,000 × 0.10 + 200 × 0.50) / 1e6 = $0.0003 direct each
        expect(estimateSpend(requests.slice(0, 2), usage, "direct").usd).toBeCloseTo(0.0006, 10);
    });
});
