import { describe, expect, it } from "vitest";
import { draw, drawRepo, graphDrawOf, parseJsonLines, reposWithoutCandidates, isPlanning, PLANNING, sizeInRange, type Candidate } from "./draw";

const pool = ["c", "a", "e", "b", "d"].map((id) => ({ id }));

describe("draw (the seeded draw of Eval #3's questions)", () => {
    it("draws n distinct candidates, the same ones for the same seed whatever the input order", () => {
        const one = draw(pool, 3, 1);
        expect(one).toHaveLength(3);
        expect(new Set(one.map((c) => c.id)).size).toBe(3);
        expect(one.every((c) => pool.some((p) => p.id === c.id))).toBe(true);
        expect(draw([...pool].reverse(), 3, 1)).toEqual(one);
    });

    it("takes every candidate when there are no more than n", () => {
        expect(draw(pool, 9, 1).map((c) => c.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
        expect(draw([], 2, 1)).toEqual([]);
    });
});

const cand = (id: string, kind: string, type: string | null, passes: boolean): Candidate => ({
    id, repo: "r", kind, source: "s", quote: "q", passes, ...(type === null ? {} : { target: { type, file: "f.ts", member: "m" } }),
});

describe("drawRepo (the draw's order, R-AF and R-X)", () => {
    it("leaves a type drawn once out of the later pools, and draws only passing candidates", () => {
        const all = [cand("b1", "breaks", "T1", true), cand("b2", "breaks", "T2", false), cand("c1", "callers", "T1", true), cand("c2", "callers", "T3", true)];
        const { drawn, rows } = drawRepo(all, { breaks: 1, callers: 1 }, 1);
        expect(drawn.map((c) => c.id)).toEqual(["b1", "c2"]);
        expect(rows).toEqual([
            { kind: "breaks", candidates: 2, passing: 1, drawn: 1 },
            { kind: "callers", candidates: 2, passing: 1, drawn: 1 },
        ]);
    });

    it("R-X: with no passing adopt candidate it draws the adopt's count of callers instead, and says so", () => {
        const all = [cand("a1", "adopt", "T1", false), cand("c1", "callers", "T2", true), cand("c2", "callers", "T3", true)];
        const { drawn, notes } = drawRepo(all, { callers: 1, adopt: 1 }, 1);
        expect(drawn.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
        expect(notes).toEqual(["R-X: no passing adopt candidate; 1 more callers question drawn instead."]);
    });
});

describe("the planning methods and the size range", () => {
    it("excludes R-A's pairs by Type.member only", () => {
        expect(isPlanning({ type: "IFileService", member: "readFile" })).toBe(true);
        expect(isPlanning({ type: "GlobalDialogService", member: "open" })).toBe(true);
        expect(isPlanning({ type: "IFileService", member: "writeFile" })).toBe(false);
        expect(isPlanning({ type: "IFileService" })).toBe(false);
        expect(PLANNING).toHaveLength(8);
    });

    it("takes 10 to 80 files", () => {
        expect([9, 10, 80, 81].map(sizeInRange)).toEqual([false, true, true, false]);
    });
});

describe("the graph candidates' input and their record in candidates.json", () => {
    it("reads one JSON candidate per line, blank lines ignored", () => {
        const text = '{"id":"x-1","repo":"r","kind":"cycle"}\n\n{"id":"x-2","repo":"r","kind":"cycle"}\n';
        expect(parseJsonLines(text).map((c) => c.id)).toEqual(["x-1", "x-2"]);
        expect(parseJsonLines("")).toEqual([]);
    });

    it("records each graph kind's pool, passing count and sorted drawn ids, and no call kind", () => {
        const all = [cand("g3", "cycle", null, true), cand("g1", "cycle", null, true), cand("g2", "cycle", null, false), cand("e1", "entries", null, true), cand("b1", "breaks", "T1", true)];
        const { drawn, rows } = drawRepo(all, { breaks: 1, cycle: 2, entries: 1 }, 1);
        expect(graphDrawOf(rows, drawn)).toEqual({
            cycle: { pool: 3, passing: 2, drawn: ["g1", "g3"] },
            entries: { pool: 1, passing: 1, drawn: ["e1"] },
        });
    });
});

describe("one type per repo within a kind, and a repo with no candidates", () => {
    it("never draws two candidates of one type in a kind: of a pair sharing a type and a third, n=2 gives one of the pair and the third", () => {
        const all = [cand("a1", "breaks", "T1", true), cand("a2", "breaks", "T1", true), cand("z", "breaks", "T2", true)];
        const ids = drawRepo(all, { breaks: 2 }, 1).drawn.map((c) => c.id).sort();
        expect(ids).toHaveLength(2);
        expect(ids).toContain("z");
        expect(ids.filter((id) => id.startsWith("a"))).toHaveLength(1);
    });

    it("draws fewer than n, and says so, when the types run out", () => {
        const all = [cand("a1", "breaks", "T1", true), cand("a2", "breaks", "T1", true)];
        const { drawn, notes } = drawRepo(all, { breaks: 2 }, 1);
        expect(drawn).toHaveLength(1);
        expect(notes).toEqual(["breaks: 1 of 2 drawn."]);
    });

    it("names a mix repo that has no candidates", () => {
        expect(reposWithoutCandidates(["vscode", "theia"], ["vscode"])).toEqual(["theia: no call or task candidates"]);
        expect(reposWithoutCandidates(["vscode"], ["vscode"])).toEqual([]);
    });
});
