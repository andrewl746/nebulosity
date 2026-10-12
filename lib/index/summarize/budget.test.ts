import { describe, expect, it } from "vitest";
import { projectSpend } from "./budget";

// Prices per million tokens, input/output: Haiku $0.10/$0.50, Sonnet $2/$10; the Batch API halves them (pricing.ts).
const file = { kind: "file" as const, model: "claude-haiku-5-5" };
const folder = { kind: "folder" as const, model: "claude-sonnet-5-5" };

describe("projectSpend", () => {
    it("assumes each kind's tokens for a model with no recorded usage", () => {
        const projection = projectSpend({
            usage: [], atAnthropic: [], thisSubmission: [file, file, file], thisTransport: "batch", rest: [folder, folder], restTransport: "batch",
        });

        // files: 3 × (4,600 × $0.10 + 260 × $0.50) / 1M / 2 = 3 × $0.000295 = $0.000885
        // folders: 2 × (1,000 × $2 + 250 × $10) / 1M / 2 = 2 × $0.00225 = $0.0045
        expect(projection.spent).toBe(0);
        expect(projection.atAnthropic).toBe(0);
        expect(projection.thisSubmission).toBeCloseTo(0.000885, 12);
        expect(projection.rest).toBeCloseTo(0.0045, 12);
        expect(projection.total).toBeCloseTo(0.005385, 12);
        expect(projection.unpriced).toEqual([]);
    });

    it("prices a model's requests at its recorded mean once it has any, and adds what's been spent", () => {
        const projection = projectSpend({
            usage: [{ model: "claude-haiku-5-5", transport: "batch", requests: 4, inputTokens: 8_000, outputTokens: 400 }],
            atAnthropic: [], thisSubmission: [file, file], thisTransport: "batch", rest: [folder], restTransport: "batch",
        });

        // spent: (8,000 × $0.10 + 400 × $0.50) / 1M / 2 = $0.0005
        expect(projection.spent).toBeCloseTo(0.0005, 12);
        // Haiku's mean is 8,000 / 4 = 2,000 in and 400 / 4 = 100 out: 2 × (2,000 × $0.10 + 100 × $0.50) / 1M / 2 = $0.00025
        expect(projection.thisSubmission).toBeCloseTo(0.00025, 12);
        // Sonnet has no usage yet, so the folder is still assumed: $0.00225
        expect(projection.rest).toBeCloseTo(0.00225, 12);
        expect(projection.total).toBeCloseTo(0.003, 12);
    });

    it("takes a model's mean over both transports together", () => {
        const projection = projectSpend({
            usage: [
                { model: "claude-haiku-5-5", transport: "batch", requests: 4, inputTokens: 8_000, outputTokens: 400 },
                { model: "claude-haiku-5-5", transport: "direct", requests: 1, inputTokens: 7_000, outputTokens: 600 },
            ],
            atAnthropic: [], thisSubmission: [file], thisTransport: "batch", rest: [], restTransport: "batch",
        });

        // spent: $0.0005 by batch + (7,000 × $0.10 + 600 × $0.50) / 1M = $0.001 direct
        expect(projection.spent).toBeCloseTo(0.0015, 12);
        // the mean is 15,000 / 5 = 3,000 in and 1,000 / 5 = 200 out (batch alone would say 2,000 and 100):
        // (3,000 × $0.10 + 200 × $0.50) / 1M / 2 = $0.0002
        expect(projection.thisSubmission).toBeCloseTo(0.0002, 12);
        expect(projection.total).toBeCloseTo(0.0017, 12);
    });

    it("prices the requests at Anthropic at batch rates, whatever the next submission's transport", () => {
        const projection = projectSpend({
            usage: [], atAnthropic: [file, file, file], thisSubmission: [], thisTransport: "direct", rest: [], restTransport: "direct",
        });

        // 3 Haiku rows in flight, no usage yet: 3 × $0.000295 = $0.000885
        expect(projection.atAnthropic).toBeCloseTo(0.000885, 12);
        expect(projection.total).toBeCloseTo(0.000885, 12);
    });

    it("counts a model with no price on file as $0 and names it once, wherever it turns up", () => {
        const opus = "claude-opus-5-5";
        const projection = projectSpend({
            usage: [{ model: opus, transport: "direct", requests: 1, inputTokens: 800, outputTokens: 40 }],
            atAnthropic: [], thisSubmission: [{ kind: "folder", model: opus }], thisTransport: "direct", rest: [folder], restTransport: "batch",
        });

        expect(projection.spent).toBe(0);
        expect(projection.thisSubmission).toBe(0);
        // the priced part still counts: one Sonnet folder by batch, $0.00225
        expect(projection.total).toBeCloseTo(0.00225, 12);
        expect(projection.unpriced).toEqual([opus]);
    });
});
