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
