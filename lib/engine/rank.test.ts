import { describe, expect, it } from "vitest";
import fs from "fs";
import { queryTerms, toFtsQuery } from "./rank";

/** Files the browser bundles (the static demo, ADR-049) and what each may import: nothing that touches a database or a disk. */
const BROWSER_SAFE: Record<string, readonly string[]> = {
    "lib/engine/rank.ts": ["../contracts", "../index/identifiers"],
    "lib/index/identifiers.ts": [],
};

describe("the ranking core", () => {
    it("imports only what the browser can bundle", () => {
        for (const [file, allowed] of Object.entries(BROWSER_SAFE)){
            const imports = [...fs.readFileSync(file, "utf8").matchAll(/^import\s.*?from\s+"([^"]+)";?\s*$/gm)].map((m) => m[1]);
            expect({ file, imports: imports.filter((i) => !allowed.includes(i)) }).toEqual({ file, imports: [] });
        }
    });

    it("gives the words an FTS query quotes", () => {
        expect(queryTerms("Where are editor tabs rendered?")).toEqual(["editor", "tabs", "rendered"]);
        expect(toFtsQuery("Where are editor tabs rendered?")).toBe('"editor" OR "tabs" OR "rendered"');
    });
});
