import { describe, expect, it } from "vitest";
import { placeholderFor, wantsSummary } from "./summaries";

describe("summaries in the panel", () => {
    it("asks for a summary only when it's missing or out of date, and says why when there's none", () => {
        expect((["pending", "stale"] as const).map(wantsSummary)).toEqual([true, true]);
        expect((["fresh", "skipped", "failed", "off"] as const).map(wantsSummary)).toEqual([false, false, false, false]);
        expect(placeholderFor("off")).toBe("Summaries are off: ANTHROPIC_API_KEY isn't set.");
        expect(placeholderFor("pending")).toBe("Summarizing…");
        expect(placeholderFor("fresh")).toBe("");
    });
});
