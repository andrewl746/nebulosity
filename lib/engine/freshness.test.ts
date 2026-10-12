import { describe, expect, it } from "vitest";
import { freshnessNote } from "./freshness";

describe("freshnessNote", () => {
    it("says nothing when nothing is stale, and counts files in plain words otherwise", () => {
        expect(freshnessNote(0)).toBeNull();
        expect(freshnessNote(1)).toBe("1 file here changed since it was summarized, so its summary is out of date until it's refreshed.");
        expect(freshnessNote(3)).toBe("3 files here changed since they were summarized, so their summaries are out of date until they're refreshed.");
    });
});
