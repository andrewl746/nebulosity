import { describe, expect, it } from "vitest";
import { failureFor, placeholderFor, summaryLine, wantsSummary } from "./summaries";

describe("summaries in the panel", () => {
    it("asks for a summary only when it's missing or out of date, and says why when there's none", () => {
        expect((["pending", "stale"] as const).map(wantsSummary)).toEqual([true, true]);
        expect((["fresh", "skipped", "failed", "off"] as const).map(wantsSummary)).toEqual([false, false, false, false]);
        expect(placeholderFor("off")).toBe("Summaries are off: ANTHROPIC_API_KEY isn't set. With a key, each file and folder gets a short plain-language summary here, and search can match by meaning.");
        expect(placeholderFor("pending")).toBe("Summarizing…");
        expect(placeholderFor("fresh")).toBe("");
    });

    it("shows a summarize-now answer that waits on something as a plain line, never a failure to try again", () => {
        const unconfirmed = { code: "SUMMARIES_OFF" as const, message: "Summaries for C:/r haven't been confirmed, so nothing is sent from here: run nebulosity summarize \"C:/r\" (…), which shows the estimate and asks first." };
        const notReady = { code: "NOT_READY" as const, message: "\"src\" can't be summarized yet: …" };
        const upstream = { code: "UPSTREAM" as const, message: "Anthropic rejected the API key: invalid x-api-key" };

        // a key, but no yes for the repo: the sentence takes the place of "Summarizing…", in the plain style, with no retry
        expect(summaryLine("pending", unconfirmed)).toBe(unconfirmed.message);
        expect(failureFor(undefined, unconfirmed)).toBeNull();
        // a folder whose insides aren't summarized yet: as before
        expect(summaryLine("pending", notReady)).toBe("Waiting for what's inside to be summarized first.");
        expect(failureFor(undefined, notReady)).toBeNull();
        // anything else is a failure the panel offers to try again; with no answer yet, the status says what's happening
        expect(summaryLine("pending", upstream)).toBe("Summarizing…");
        expect(failureFor(undefined, upstream)).toBe(upstream.message);
        expect(summaryLine("pending", null)).toBe("Summarizing…");
        expect(failureFor("the last request timed out", null)).toBe("the last request timed out");
        expect(failureFor(undefined, null)).toBeNull();
    });
});
