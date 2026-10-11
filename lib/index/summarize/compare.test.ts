import { describe, expect, it } from "vitest";
import { FILES } from "../../../test/helpers/mini-repo-facts";
import { pickSample, renderComparison } from "./compare";

describe("pickSample", () => {
    it("takes the most-imported half, then spreads the rest evenly through the tree, never a test file", () => {
        // non-test files 7; the 2 most imported (main.ts and log.ts, 3 each), then 2 of the other 5 at positions 1 and 3
        expect(pickSample(FILES, 4).map((f) => f.path)).toEqual(["src/app/main.ts", "src/core/log.ts", "src/app/view.tsx", "src/index.ts"]);
    });
});

describe("renderComparison", () => {
    it("shows the cost per model, the full-pass estimate and each file's two summaries", () => {
        const file = FILES.find((f) => f.path === "src/core/log.ts")!;
        const ok = (model: string, tagline: string) => ({
            customId: "s1", ok: true as const, text: { tagline, summary: `${tagline} in detail.` }, model, usage: [{ model, inputTokens: 2_000, outputTokens: 200 }],
        });
        const markdown = renderComparison({
            title: "2026 10 12 Summary Review #1",
            repo: "C:/code/vscode",
            effort: "low",
            models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
            rows: [{ file, outcomes: { "claude-haiku-5-5": ok("claude-haiku-5-5", "Logging helpers"), "claude-sonnet-5-5": ok("claude-sonnet-5-5", "Core logging") } }],
            fullPass: { files: 1_000, folders: 100 },
        });

        expect(markdown).toContain("## 2026 10 12 Summary Review #1");
        expect(markdown).toContain("| claude-haiku-5-5 | 1 | 2,000 | 200 | $0.0003 |");
        expect(markdown).toContain("| claude-sonnet-5-5 | 1 | 2,000 | 200 | $0.0060 |");
        expect(markdown).toContain("- **Files:** 1,000 × $0.0003 (claude-haiku-5-5's mean) × ½ = **$0.15**");
        expect(markdown).toContain("- **Folders and the repo:** 100 × (1,000 input tokens + 200 output tokens at claude-sonnet-5-5's price) × ½ = **$0.20**");
        expect(markdown).toContain("- **Total ≈ $0.35** against S2's $15.");
        expect(markdown).toContain("- If claude-sonnet-5-5 wrote the file summaries too: 1,000 × $0.0060 × ½ = **$3.00**");
        expect(markdown).toContain("#### 1. `src/core/log.ts` (9 lines · imported by 3 files)");
        expect(markdown).toContain("- **claude-haiku-5-5:** *Logging helpers* — Logging helpers in detail.");
    });

    it("adds up every model that ran for a request, calls a cost with an unpriced model a lower bound, and skips a request that got no reply", () => {
        const log = FILES.find((f) => f.path === "src/core/log.ts")!;
        const main = FILES.find((f) => f.path === "src/app/main.ts")!;
        const haiku = (customId: string) => ({
            customId, ok: true as const, text: { tagline: "Haiku wrote", summary: "Haiku wrote this." }, model: "claude-haiku-5-5",
            usage: [{ model: "claude-haiku-5-5", inputTokens: 2_000, outputTokens: 200 }],
        });
        const markdown = renderComparison({
            title: "t",
            repo: "r",
            effort: "low",
            models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
            rows: [
                {
                    // Sonnet declined after 12 output tokens and claude-opus-5-5 (no price on file) wrote the answer:
                    // one request, two billed attempts
                    file: log,
                    outcomes: {
                        "claude-haiku-5-5": haiku("s1"),
                        "claude-sonnet-5-5": {
                            customId: "s1", ok: true, text: { tagline: "Core logging", summary: "Core logging in detail." }, model: "claude-opus-5-5",
                            usage: [
                                { model: "claude-sonnet-5-5", inputTokens: 800, outputTokens: 12 },
                                { model: "claude-opus-5-5", inputTokens: 800, outputTokens: 40 },
                            ],
                        },
                    },
                },
                {
                    // no reply at all (usage null): not a request, and nothing to bill
                    file: main,
                    outcomes: {
                        "claude-haiku-5-5": haiku("s2"),
                        "claude-sonnet-5-5": { customId: "s2", ok: false, error: "API error 429: slow down", model: null, usage: null },
                    },
                },
            ],
            fullPass: { files: 1_000, folders: 100 },
        });

        // Haiku: 2 requests, 4,000 in and 400 out = (4,000 × $0.10 + 400 × $0.50) / 1M = $0.0006
        expect(markdown).toContain("| claude-haiku-5-5 | 2 | 4,000 | 400 | $0.0006 |");
        // Sonnet: 1 request, 800 + 800 in and 12 + 40 out; only its own attempt has a price: (800 × $2 + 12 × $10) / 1M = $0.00172
        expect(markdown).toContain("| claude-sonnet-5-5 | 1 | 1,600 | 52 | at least $0.0017 |");
        expect(markdown).toContain("- **claude-sonnet-5-5:** failed: API error 429: slow down");
        // an answer a fallback model wrote says so: it isn't the summary Sonnet would have written
        expect(markdown).toContain("- **claude-sonnet-5-5** (answered by claude-opus-5-5): *Core logging* — Core logging in detail.");
    });

    it("multiplies the rounded per-request price it prints, so every line of the estimate can be redone by hand", () => {
        const [first, second, third] = FILES.filter((f) => !f.isTest);
        // both models carry the same tokens, so every figure below comes from one set of sums
        const tokens = [{ inputTokens: 1_000, outputTokens: 100 }, { inputTokens: 2_000, outputTokens: 300 }, { inputTokens: 4_000, outputTokens: 50 }];
        const ok = (model: string, i: number) => ({
            customId: `s${i}`, ok: true as const, text: { tagline: "Tagline", summary: "Summary." }, model, usage: [{ model, ...tokens[i] }],
        });
        const markdown = renderComparison({
            title: "t",
            repo: "r",
            effort: "low",
            models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
            rows: [first, second, third].map((file, i) => ({
                file,
                outcomes: { "claude-haiku-5-5": ok("claude-haiku-5-5", i), "claude-sonnet-5-5": ok("claude-sonnet-5-5", i) },
            })),
            fullPass: { files: 100_000, folders: 10 },
        });

        // Haiku: 7,000 in and 450 out = (7,000 × $0.10 + 450 × $0.50) / 1M = $0.000925, a mean of $0.000308333, which is $0.000308 to 3 significant figures
        expect(markdown).toContain("| claude-haiku-5-5 | 3 | 7,000 | 450 | $0.0009 |");
        // Sonnet: (7,000 × $2 + 450 × $10) / 1M = $0.0185, a mean of $0.0061667, which is $0.00617
        expect(markdown).toContain("| claude-sonnet-5-5 | 3 | 7,000 | 450 | $0.0185 |");
        // the product uses the printed factor: 100,000 × $0.000308 / 2 = $15.40 (the unrounded mean would give $15.42)
        expect(markdown).toContain("- **Files:** 100,000 × $0.000308 (claude-haiku-5-5's mean) × ½ = **$15.40**");
        // 450 / 3 = 150 output tokens a folder: 10 × (1,000 × $2 + 150 × $10) / 1M / 2 = $0.0175
        expect(markdown).toContain("- **Folders and the repo:** 10 × (1,000 input tokens + 150 output tokens at claude-sonnet-5-5's price) × ½ = **$0.0175**");
        expect(markdown).toContain("- **Total ≈ $15.42** against S2's $15.");
        // 100,000 × $0.00617 / 2 = $308.50 (the unrounded mean would give $308.33)
        expect(markdown).toContain("- If claude-sonnet-5-5 wrote the file summaries too: 100,000 × $0.00617 × ½ = **$308.50**");
    });
});
