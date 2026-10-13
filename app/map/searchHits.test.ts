import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/lib/contracts";
import { groupHits } from "./searchHits";

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
