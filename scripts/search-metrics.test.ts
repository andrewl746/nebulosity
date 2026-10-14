import { describe, expect, it } from "vitest";
import { accepts, firstAcceptable, metrics } from "./search-metrics";

describe("accepts", () => {
    it("takes a folder expectation (ending in /) as the folder or anything inside it, and a file only as itself", () => {
        expect(accepts("src/vs/a/", { path: "src/vs/a", kind: "folder" })).toBe(true);
        expect(accepts("src/vs/a/", { path: "src/vs/a/b.ts", kind: "file" })).toBe(true);
        expect(accepts("src/vs/a/", { path: "src/vs/ab", kind: "folder" })).toBe(false);
        expect(accepts("src/x.ts", { path: "src/x.ts", kind: "file" })).toBe(true);
        expect(accepts("src/x.ts", { path: "src/x.ts/y.ts", kind: "file" })).toBe(false);
    });
});

describe("firstAcceptable", () => {
    it("gives the 1-based rank of the first hit any expectation accepts, or null", () => {
        const hits = [{ path: "a.ts", kind: "file" as const }, { path: "b", kind: "folder" as const }, { path: "c.ts", kind: "file" as const }];
        expect(firstAcceptable(hits, ["c.ts", "b/"])).toBe(2);
        expect(firstAcceptable(hits, ["z.ts"])).toBeNull();
    });
});

describe("metrics", () => {
    it("counts hits at 1, 3 and 5, and averages 1/rank over the top 10", () => {
        // ranks 1, 3, none, 12: hit@1 1/4, hit@3 2/4, hit@5 2/4, MRR (1 + 1/3 + 0 + 0) / 4
        expect(metrics([1, 3, null, 12])).toEqual({ queries: 4, hitAt1: 0.25, hitAt3: 0.5, hitAt5: 0.5, mrr: (1 + 1 / 3) / 4 });
    });
});
