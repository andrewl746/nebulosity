import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact (R-AD)", () => {
    it("turns Nebulosity and its tools into neutral words, with a capital where a sentence starts", () => {
        expect(redact("Nebulosity's import graph shows 461 imports that go against the layers.").text).toBe("The import graph shows 461 imports that go against the layers.");
        expect(redact("They come from the import graph that the Nebulosity code-index tool built for this repo.").text).toBe("They come from the import graph that the index built for this repo.");
        expect(redact("I called mcp__nebulosity__architecture, then `mcp__nebulosity__calls`.").text).toBe("I called a search, then a search.");
        expect(redact("The `architecture` tool reports the layers; the describe answer adds the docs.").text).toBe("A search reports the layers; the describe answer adds the docs.");
        expect(redact("Then the architecture tool listed the layers.").text).toBe("Then a search listed the layers.");
    });

    it("leaves an answer by Claude Code alone as it is, a folder named like a tool included, and lists what it replaced", () => {
        const plain = "I ran git grep for `IFooService` and a script over the import graph; see the `search` folder.";
        expect(redact(plain)).toEqual({ text: plain, redactions: [] });
        const ordinary = "The search results list three files, and the overview answers it; the describe call and the imports results agree.";
        expect(redact(ordinary)).toEqual({ text: ordinary, redactions: [] });
        expect(redact("Nebulosity's index, and Nebulosity again.")).toEqual({
            text: "The index, and the index again.",
            redactions: [{ from: "Nebulosity's", to: "the", count: 1 }, { from: "Nebulosity", to: "the index", count: 1 }],
        });
    });
});

describe("redact keeps the sentence grammatical (no doubled article)", () => {
    it("absorbs the article and the word 'tool' or 'call' around an mcp__ name", () => {
        expect(redact("Then the `mcp__nebulosity__search` tool found it.").text).toBe("Then a search found it.");
        expect(redact("We used an mcp__nebulosity__imports call twice.").text).toBe("We used a search twice.");
    });

    it("does not add an article when a modifier already stands before a bare tool name", () => {
        expect(redact("I ran a code search tool.")).toEqual({ text: "I ran a code search.", redactions: [{ from: "search tool", to: "search", count: 1 }] });
        expect(redact("Use the web search tool first.").text).toBe("Use the web search first.");
        expect(redact("It is a semantic search tool.").text).toBe("It is a semantic search.");
        expect(redact("Search tool output is long.").text).toBe("A search output is long.");
    });

    it("handles Eval #2's third phrasing and capitals", () => {
        expect(redact("Nebulosity's index of `src/vs` lists them.").text).toBe("The index of `src/vs` lists them.");
        expect(redact("Ask NEBULOSITY about it.").text).toBe("Ask the index about it.");
        expect(redact("NEBULOSITY found it.").text).toBe("The index found it.");
    });
});
