import { describe, expect, it } from "vitest";
import type { SummaryStatus } from "@/lib/contracts";
import { askKey, failureFor, placeholderFor, summaryLine, summaryNotes, wantsSummary } from "./summaries";

describe("summaries in the panel", () => {
    it("asks for a summary only when it's missing or out of date, and says why when there's none", () => {
        const asks = (summaryStatus: SummaryStatus) => wantsSummary({ summaryStatus }, false);
        expect((["pending", "stale"] as const).map(asks)).toEqual([true, true]);
        expect((["fresh", "skipped", "failed", "off"] as const).map(asks)).toEqual([false, false, false, false]);
        expect(placeholderFor("off")).toBe("Summaries are off, since ANTHROPIC_API_KEY isn't set. With a key, each file and folder gets a short plain-language summary here, and search can match by meaning.");
        expect(placeholderFor("pending")).toBe("Summarizing…");
        expect(placeholderFor("fresh")).toBe("");
    });

    it("asks for a summary an older prompt wrote, unless summaries are off", () => {
        // opening it rewrites it in the current style (Q2 B)
        expect(wantsSummary({ summaryStatus: "fresh", summaryOlderStyle: true }, false)).toBe(true);
        // with no key the answer could only be SUMMARIES_OFF, after a flash of "Refreshing…" (P11)
        expect(wantsSummary({ summaryStatus: "fresh", summaryOlderStyle: true }, true)).toBe(false);
        // a missing or out-of-date one asks as it does today, whoever wrote it and whether summaries are off or not
        expect(wantsSummary({ summaryStatus: "stale", summaryOlderStyle: true }, true)).toBe(true);
        expect((["pending", "stale"] as const).map((summaryStatus) => wantsSummary({ summaryStatus }, true))).toEqual([true, true]);
        // the current prompt's is left as it is
        expect(wantsSummary({ summaryStatus: "fresh" }, false)).toBe(false);
    });

    it("asks for an older prompt's summary once per panel, since a rewrite that fails leaves it as it was and moves the index", () => {
        // missing or out of date, once per index version, as today
        expect(askKey({ path: "src/a.ts", indexVersion: 7, summaryStatus: "stale" })).toBe("src/a.ts@7");
        expect(askKey({ path: "src/a.ts", indexVersion: 7, summaryStatus: "pending" })).toBe("src/a.ts@7");
        // in the older style alone, one key whatever the version, so the failure's own move doesn't ask again
        expect(askKey({ path: "src/a.ts", indexVersion: 7, summaryStatus: "fresh" })).toBe("src/a.ts@older");
        expect(askKey({ path: "src/a.ts", indexVersion: 9, summaryStatus: "fresh" })).toBe("src/a.ts@older");
    });

    it("says a summary changed only when it did, and keeps the import-count note for older summaries", () => {
        const changed = "Out of date, it changed since it was summarized.";
        const text = { tagline: "Disposables", summary: "Tracks what to clean up." };

        // no note for the older style itself, and a file's older summary still counts importers without tests (Q1 A)
        expect(summaryNotes({ ...text, summaryStatus: "fresh", summaryOlderStyle: true }, "file", false)).toEqual({ notes: [], testsNote: true });
        // the current prompt gives no counts
        expect(summaryNotes({ ...text, summaryStatus: "fresh" }, "file", false)).toEqual({ notes: [], testsNote: false });
        // a file reads stale only when its bytes changed (P1), so it says so in either style
        expect(summaryNotes({ ...text, summaryStatus: "stale", summaryOlderStyle: true }, "file", false)).toEqual({ notes: [changed], testsNote: true });
        // a folder or the repo an older prompt wrote reads stale once a child is restyled, though no code changed (P10)
        expect(summaryNotes({ ...text, summaryStatus: "stale", summaryOlderStyle: true }, "folder", false)).toEqual({ notes: [], testsNote: false });
        expect(summaryNotes({ ...text, summaryStatus: "stale", summaryOlderStyle: true }, "repo", false)).toEqual({ notes: [], testsNote: false });
        expect(summaryNotes({ ...text, summaryStatus: "stale" }, "folder", false)).toEqual({ notes: [changed], testsNote: false });
        // while it's rewritten
        expect(summaryNotes({ ...text, summaryStatus: "stale" }, "folder", true)).toEqual({ notes: ["Refreshing…"], testsNote: false });
        expect(summaryNotes({ ...text, summaryStatus: "fresh", summaryOlderStyle: true }, "file", true)).toEqual({ notes: ["Refreshing…"], testsNote: true });
        // with nothing on show yet, the placeholder says what's happening instead
        expect(summaryNotes({ summaryStatus: "pending" }, "file", true)).toEqual({ notes: [], testsNote: false });
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
