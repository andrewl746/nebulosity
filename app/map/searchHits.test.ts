import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/lib/contracts";
import { codeLabel, groupHits } from "./searchHits";

const hit = (path: string, kind: SearchHit["kind"]): SearchHit => ({ path, kind, score: 0, matchedBy: ["code"] });

describe("groupHits", () => {
    it("puts every folder before every file, each group in the server's order", () => {
        const hits = [hit("a.ts", "file"), hit("src/b", "folder"), hit("c.ts", "file"), hit("src/d", "folder")];
        expect(groupHits(hits)).toEqual({
            folders: [hit("src/b", "folder"), hit("src/d", "folder")],
            files: [hit("a.ts", "file"), hit("c.ts", "file")],
            ordered: [hit("src/b", "folder"), hit("src/d", "folder"), hit("a.ts", "file"), hit("c.ts", "file")],
        });
    });

    it("leaves a group empty when nothing of its kind matched", () => {
        expect(groupHits([hit("a.ts", "file")])).toEqual({ folders: [], files: [hit("a.ts", "file")], ordered: [hit("a.ts", "file")] });
        expect(groupHits([])).toEqual({ folders: [], files: [], ordered: [] });
    });
});

describe("codeLabel", () => {
    it("names the declaration and its lines, or says an imports listing is one", () => {
        expect(codeLabel({ symbol: "log", startLine: 2, endLine: 2, snippet: "" })).toBe("log · line 2");
        expect(codeLabel({ symbol: "Logger", startLine: 4, endLine: 7, snippet: "" })).toBe("Logger · lines 4–7");
        expect(codeLabel({ symbol: "(file)", startLine: 1, endLine: 9, snippet: "" })).toBe("imports and exports");
    });
});
