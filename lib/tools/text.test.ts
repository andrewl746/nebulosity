import { describe, expect, it } from "vitest";
import { answerText, deliveryNote, fitting, moreLine, shownPath, summaryLine, SUMMARIES_OFF_LINE } from "./text";

describe("text helpers", () => {
    it("writes folders with a trailing slash", () => {
        expect(shownPath("src/core", "folder")).toBe("src/core/");
        expect(shownPath("src/core/log.ts", "file")).toBe("src/core/log.ts");
    });

    it("puts a summary, or says what's in its place", () => {
        expect(summaryLine({ tagline: "Logging helpers", summary: "Writes lines.", summaryStatus: "fresh" })).toBe("Logging helpers — Writes lines.");
        expect(summaryLine({ tagline: "Logging helpers", summary: "Writes lines.", summaryStatus: "stale" }))
            .toBe("Logging helpers — Writes lines. (Out of date: changed since it was summarized.)");
        expect(summaryLine({ tagline: "Tests for strings", summaryStatus: "skipped" })).toBe("Tests for strings");
        expect(summaryLine({ summaryStatus: "off" })).toBe(SUMMARIES_OFF_LINE);
        expect(SUMMARIES_OFF_LINE).toBe("Summary: none — summaries are off (no ANTHROPIC_API_KEY); a key adds a short summary of every file and folder.");
        expect(summaryLine({ summaryStatus: "pending" })).toBe("Summary: not written yet.");
        expect(summaryLine({ summaryStatus: "failed", summaryError: "stub failure" })).toBe("Summary: failed (stub failure).");
        expect(summaryLine({ summaryStatus: "failed" })).toBe("Summary: failed.");
    });

    it("puts a summary of several paragraphs on one line", () => {
        expect(summaryLine({ tagline: "Logging helpers", summary: "Writes lines.\n\nUsed everywhere.", summaryStatus: "fresh" }))
            .toBe("Logging helpers — Writes lines. Used everywhere.");
    });

    it("fits lines under a limit and a character budget, counting each line's break", () => {
        expect(fitting(["aaaa", "bbbb", "cccc"], 2, 1_000)).toBe(2);
        expect(fitting(["aaaa", "bbbb", "cccc"], 10, 10)).toBe(2);   // 5 + 5 fits in 10, a third would make 15
        expect(fitting([], 10, 100)).toBe(0);
    });

    it("says how many more, and where the next page starts", () => {
        expect(moreLine(4231)).toBe("… 4,231 more");
        expect(moreLine(3, 4)).toBe("… 3 more (next page: offset 4)");
    });

    it("orders an answer: the repo note, the body, the tool's notes, the index note, the stale note last", () => {
        expect(answerText({ body: ["a", "b"], notes: ["n"], stale: 2, repoNote: "r", indexNote: "i" }).split("\n")).toEqual([
            "Note: r", "a", "b", "Note: n", "Note: i",
            "Note: 2 files here changed since they were summarized, so their summaries are out of date until they're refreshed.",
        ]);
        expect(answerText({ body: ["a"], stale: 0 })).toBe("a");
    });

    it("tells the model what happened to a Map event", () => {
        const where = { port: 3000, mapRepo: "vscode", repo: "mini-repo" };
        expect(deliveryNote("shown", where)).toBe("Sent to the Map at http://localhost:3000; any open Map tab shows it.");
        expect(deliveryNote("no-map", where)).toBe("No Map answered at http://localhost:3000, so nothing is shown. The user can start it with nebulosity map (in a checkout of Nebulosity: npm run dev).");
        expect(deliveryNote("live-off", where)).toBe("Nothing was sent: live updates are off in this session (NEBULOSITY_LIVE=off).");
        expect(deliveryNote("other-repo", where)).toBe("Nothing was sent: the Map shows vscode, not mini-repo. The user can pick mini-repo in the Map's repo menu.");
        expect(deliveryNote("other-repo", { ...where, mapRepo: null })).toBe("Nothing was sent: the Map shows no repository, not mini-repo. The user can pick mini-repo in the Map's repo menu.");
    });
});
