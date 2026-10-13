import { describe, expect, it } from "vitest";
import { inlineCode, MAX_COLORED_CHARS, splitSummary, tooLargeToColor } from "./text";

const plain = (text: string) => ({ text, code: false });
const code = (text: string) => ({ text, code: true });

describe("inlineCode (VISUAL_REFRESH.md §5: backticks render as code, never literally)", () => {
    it("splits a summary into prose and code", () => {
        expect(inlineCode("Uses `vs/base` heavily")).toEqual([plain("Uses "), code("vs/base"), plain(" heavily")]);
        expect(inlineCode("no code")).toEqual([plain("no code")]);
        expect(inlineCode("`a``b`")).toEqual([code("a"), code("b")]);
        expect(inlineCode("`x` and `y` and ` z")).toEqual([code("x"), plain(" and "), code("y"), plain(" and ` z")]);
        expect(inlineCode("")).toEqual([]);
    });

    it("leaves an unmatched or empty pair of backticks as it is", () => {
        expect(inlineCode("an odd ` backtick")).toEqual([plain("an odd ` backtick")]);
        expect(inlineCode("a `` b")).toEqual([plain("a `` b")]);
    });
});

describe("splitSummary (§5: about two lines, then 'Read full summary')", () => {
    it("leads with the first sentence", () => {
        expect(splitSummary("One. Two three.")).toEqual({ lead: "One.", rest: "Two three." });
        expect(splitSummary("Single sentence only.")).toEqual({ lead: "Single sentence only.", rest: "" });
        expect(splitSummary("Ends with a question? Yes it does.")).toEqual({ lead: "Ends with a question?", rest: "Yes it does." });
        expect(splitSummary("One.\n\nTwo.")).toEqual({ lead: "One.", rest: "Two." });
        expect(splitSummary("")).toEqual({ lead: "", rest: "" });
    });

    it("doesn't end a sentence inside code, at an abbreviation, or inside a number", () => {
        expect(splitSummary("Holds `main.ts` and `cli.ts`. Then more.")).toEqual({ lead: "Holds `main.ts` and `cli.ts`.", rest: "Then more." });
        expect(splitSummary("Uses helpers, e.g. `foo`, to log. Second.")).toEqual({ lead: "Uses helpers, e.g. `foo`, to log.", rest: "Second." });
        expect(splitSummary("Wraps APIs (i.e. Node and Electron). Next sentence.")).toEqual({ lead: "Wraps APIs (i.e. Node and Electron).", rest: "Next sentence." });
        expect(splitSummary("Version 3.4 ships. More.")).toEqual({ lead: "Version 3.4 ships.", rest: "More." });
        expect(splitSummary("A period inside `code. Like this` stays. Next.")).toEqual({ lead: "A period inside `code. Like this` stays.", rest: "Next." });
    });

    it("ends a sentence before one that starts with code (the owner saw a whole paragraph as the lead)", () => {
        // the theme folder's summary: its second sentence starts with `common/`
        expect(splitSummary("This folder is the theming layer. `common/` holds the registries. `browser/` turns them into CSS."))
            .toEqual({ lead: "This folder is the theming layer.", rest: "`common/` holds the registries. `browser/` turns them into CSS." });
        // but an abbreviation before code still doesn't end one
        expect(splitSummary("Uses e.g. `foo` to log. Second.")).toEqual({ lead: "Uses e.g. `foo` to log.", rest: "Second." });
    });

    it("reads a backtick with no partner as text, the way inlineCode draws it (deferred minor: nothing after it split)", () => {
        expect(splitSummary("Pads by 5` of space. Second.")).toEqual({ lead: "Pads by 5` of space.", rest: "Second." });
        // `a` pairs; the third backtick has no partner after it, so the period after "three" still ends the sentence
        expect(splitSummary("One `a` two ` three. Four.")).toEqual({ lead: "One `a` two ` three.", rest: "Four." });
        // an empty pair is text too (inlineCode keeps it literal)
        expect(splitSummary("Quotes `` here. Next.")).toEqual({ lead: "Quotes `` here.", rest: "Next." });
    });
});

describe("tooLargeToColor (deferred minor: coloring a 1 MB file blocked for ~350 ms)", () => {
    it("colors up to 200,000 characters and leaves anything longer plain", () => {
        expect(MAX_COLORED_CHARS).toBe(200_000);
        expect(tooLargeToColor("x".repeat(200_000))).toBe(false);
        expect(tooLargeToColor("x".repeat(200_001))).toBe(true);
        expect(tooLargeToColor("")).toBe(false);
    });
});
