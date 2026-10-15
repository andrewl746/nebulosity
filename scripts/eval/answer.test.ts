import { describe, expect, it } from "vitest";
import { answerSection, extractPaths, f1, isNone, scoreChain, scoreCounts, scoreCycle, scoreList, scorePairs } from "./answer";

describe("answerSection", () => {
    it("takes the text after the last ANSWER: line, in any case, with markdown around it", () => {
        expect(answerSection("Thinking.\nANSWER:\nsrc/a.ts\nsrc/b.ts")).toBe("src/a.ts\nsrc/b.ts");
        expect(answerSection("ANSWER: wrong\nmore\n**Answer:** none")).toBe("none");
        expect(answerSection("The answer: is in prose, not on its own line")).toBeNull();
        expect(isNone("none")).toBe(true);
        expect(isNone("src/a.ts")).toBe(false);
    });

    it("ignores bold and backticks around the label, but not a prose label with words before it", () => {
        expect(answerSection("**ANSWER**:\nsrc/a.ts")).toBe("src/a.ts");
        expect(answerSection("`ANSWER:`\nsrc/a.ts")).toBe("src/a.ts");
        expect(answerSection("Final answer: x")).toBeNull();
    });
});

describe("extractPaths", () => {
    const root = "C:/Users/Ann/vscode";
    const known = new Set(["src/vs/a.ts", "src/vs/b.ts", "src/vs/c.ts", "src/vs/d.ts"]);

    it("reads absolute and relative paths in any slash and case, without bullets, numbers, backticks or line marks", () => {
        const section = [
            "C:\\Users\\Ann\\vscode\\src\\vs\\a.ts",
            "- c:/users/ann/vscode/src/vs/B.ts",
            "- `src/vs/c.ts:120`",
            "3. src/vs/d.ts#L5-L9",
            "src/vs/a.ts (again)",
            "src/vs/folder/",
            "../outside/x.ts",
        ].join("\n");
        expect(extractPaths(section, root, known)).toEqual({
            files: ["src/vs/a.ts", "src/vs/b.ts", "src/vs/c.ts", "src/vs/d.ts"],
            notFiles: ["src/vs/folder/", "../outside/x.ts"],
        });
    });

    it("reads bolded, italic and table-cell paths, and keeps a file whose own name starts with an underscore", () => {
        const underscored = new Set([...known, "_x.ts"]);
        const section = "**src/vs/a.ts**\n_src/vs/b.ts_\n|src/vs/c.ts|entry|\n- **src/vs/d.ts:12** — the entry\n_x.ts";
        // "entry", "the" and the dash have no "/" and no code extension, so they are not paths at all
        expect(extractPaths(section, root, underscored)).toEqual({
            files: ["src/vs/a.ts", "src/vs/b.ts", "src/vs/c.ts", "src/vs/d.ts", "_x.ts"],
            notFiles: [],
        });
    });

    it("skips the repo root itself", () => {
        expect(extractPaths("C:/Users/Ann/vscode/\n./", root, known)).toEqual({ files: [], notFiles: [] });
    });
});

describe("scores", () => {
    it("scores a list by recall and precision", () => {
        expect(scoreList(["a", "b", "x"], ["a", "b", "c"])).toEqual({ recall: 2 / 3, precision: 2 / 3, hits: 2, missed: ["c"], extra: ["x"] });
    });

    it("scores a chain: shortest 1, longer 0.5, broken or wrong 0, unknown steps pending", () => {
        const edges = new Set(["a>b", "b>c", "c>d", "a>e", "e>f", "f>c"]);
        // a step touching "q" is one nobody has checked yet: neither the scanner nor an adjudication knows it
        const imports = (x: string, y: string): boolean | null => (edges.has(`${x}>${y}`) ? true : x === "q" || y === "q" ? null : false);
        const truth = { from: "a", to: "d", connected: true, shortest: 3 };
        expect(scoreChain({ none: false, files: ["a", "b", "c", "d"] }, truth, imports)).toEqual({ score: 1, valid: true, steps: 3 });
        expect(scoreChain({ none: false, files: ["a", "e", "f", "c", "d"] }, truth, imports)).toEqual({ score: 0.5, valid: true, steps: 4 });
        expect(scoreChain({ none: false, files: ["a", "c", "d"] }, truth, imports)).toMatchObject({ score: 0, valid: false, problem: "a doesn't import c" });
        expect(scoreChain({ none: true, files: [] }, truth, imports)).toMatchObject({ score: 0 });
        expect(scoreChain({ none: false, files: ["a", "q", "d"] }, truth, imports)).toMatchObject({ score: null, unknown: ["a", "q"] });
        const none = { from: "d", to: "a", connected: false, shortest: null };
        expect(scoreChain({ none: true, files: [] }, none, imports)).toEqual({ score: 1, valid: true, steps: null });
        expect(scoreChain({ none: false, files: ["d", "a"] }, none, imports)).toMatchObject({ score: 0 });
    });

    it("checks every step before it decides: a step known false makes the answer 0 even after an unknown step", () => {
        const edges = new Set(["a>b", "b>c", "c>d"]);
        const imports = (x: string, y: string): boolean | null => (edges.has(`${x}>${y}`) ? true : x === "q" || y === "q" ? null : false);
        const truth = { from: "a", to: "d", connected: true, shortest: 3 };
        // a -> q and q -> b are unknown, b -> d is not an import: wrong whatever q turns out to be, so nothing waits for an adjudication
        expect(scoreChain({ none: false, files: ["a", "q", "b", "d"] }, truth, imports)).toEqual({ score: 0, valid: false, steps: 3, problem: "b doesn't import d" });
        // with no false step, the first unknown one is the one to adjudicate
        expect(scoreChain({ none: false, files: ["a", "q", "d"] }, truth, imports)).toEqual({ score: null, valid: false, steps: 2, unknown: ["a", "q"] });
        // two false steps: the first is reported
        expect(scoreChain({ none: false, files: ["a", "c", "d", "b", "d"] }, { ...truth, shortest: 4 }, imports)).toMatchObject({ score: 0, problem: "a doesn't import c" });
    });

    it("scores a right none 1 even when the same section names the files it talks about", () => {
        // "ANSWER:\nnone\nsrc/d.ts never imports src/a.ts" reads as none: true with both files extracted
        const none = { from: "d", to: "a", connected: false, shortest: null };
        expect(scoreChain({ none: true, files: ["d", "a"] }, none, () => false)).toEqual({ score: 1, valid: true, steps: null });
        expect(scoreChain({ none: false, files: ["d", "a"] }, none, () => false)).toMatchObject({ score: 0, problem: "claims a chain where none exists" });
    });
});

describe("the new kinds' scores", () => {
    it("scores counts per line as 1 − the relative error, floored at 0, missing lines 0", () => {
        const answer = "Some text\nANSWER:\nsrc/app: 3\nsrc/base: 2\nelsewhere: 1\ntotal: 20";
        const truth = { counts: [["src/app", 3], ["src/base", 4], ["src/editor", 5]] as [string, number][], elsewhere: 1, total: 16 };
        // src/app 1; src/base 1 − 2/4 = 0.5; src/editor missing 0; elsewhere 1; total 1 − 4/16 = 0.75 → mean 3.25 / 5
        expect(scoreCounts(answerSection(answer)!, truth)).toBeCloseTo(0.65, 10);
    });

    it("reads counts with thousands separators, bullets, bold and any case", () => {
        const truth = { counts: [["Src/App", 1200]] as [string, number][], elsewhere: 0, total: 1200 };
        expect(scoreCounts("- **src/app**: 1,200\nTOTAL: 1,200\nElsewhere: 0", truth)).toBe(1);
    });

    it("scores F1 over a list", () => {
        expect(f1(["a", "b", "x"], ["a", "b", "c", "d"])).toBeCloseTo(2 * (2 / 3) * (2 / 4) / ((2 / 3) + (2 / 4)), 10);
        expect(f1([], [])).toBe(1);
        expect(f1(["a"], [])).toBe(0);
    });

    it("reads pairs written 'a -> b' or with an arrow, in any case and spacing", () => {
        expect(scorePairs(["common -> browser", "node→common", " Browser ->  browser "], [["browser", "browser"], ["common", "browser"], ["node", "common"], ["node", "node"]]))
            .toBeCloseTo(2 * 1 * 0.75 / 1.75, 10);
    });

    it("scores a cycle: 1 shortest, 0.5 longer, 1 a right none, 0 a wrong none or an invalid step", () => {
        const edges = new Set(["m>t", "t>x", "x>m", "m>y", "y>z", "z>m"]);
        const imports = (a: string, b: string): boolean | null => edges.has(`${a}>${b}`);
        expect(scoreCycle(["m", "t", "x", "m"], { file: "m", shortest: 3 }, imports)).toBe(1);
        expect(scoreCycle(["m", "y", "z", "m", "t", "x", "m"], { file: "m", shortest: 3 }, imports)).toBe(0.5);
        expect(scoreCycle("none", { file: "s", shortest: null }, imports)).toBe(1);
        expect(scoreCycle("none", { file: "m", shortest: 3 }, imports)).toBe(0);
        expect(scoreCycle(["m", "x", "m"], { file: "m", shortest: 3 }, imports)).toBe(0);
    });

    it("rejects a cycle that doesn't start and end at the file, and a one-step self loop", () => {
        const imports = (a: string, b: string): boolean | null => ["m>t", "t>x", "x>m", "m>m"].includes(`${a}>${b}`);
        expect(scoreCycle(["t", "x", "m", "t"], { file: "m", shortest: 3 }, imports)).toBe(0);
        expect(scoreCycle(["m", "m"], { file: "m", shortest: 3 }, imports)).toBe(0);
        expect(scoreCycle(["m", "t", "x", "m"], { file: "m", shortest: null }, imports)).toBe(0);
    });

    it("keeps a path's repeats when asked, so a cycle's first and last file both show", () => {
        const known = new Set(["m.ts", "t.ts"]);
        expect(extractPaths("m.ts\nt.ts\nm.ts", "/r", known).files).toEqual(["m.ts", "t.ts"]);
        expect(extractPaths("m.ts\nt.ts\nm.ts", "/r", known, { repeats: true }).files).toEqual(["m.ts", "t.ts", "m.ts"]);
    });
});
