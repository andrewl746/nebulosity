import { describe, expect, it } from "vitest";
import { answerSection, extractPaths, isNone, scoreChain, scoreList } from "./answer";

describe("answerSection", () => {
    it("takes the text after the last ANSWER: line, in any case, with markdown around it", () => {
        expect(answerSection("Thinking.\nANSWER:\nsrc/a.ts\nsrc/b.ts")).toBe("src/a.ts\nsrc/b.ts");
        expect(answerSection("ANSWER: wrong\nmore\n**Answer:** none")).toBe("none");
        expect(answerSection("The answer: is in prose, not on its own line")).toBeNull();
        expect(isNone("none")).toBe(true);
        expect(isNone("src/a.ts")).toBe(false);
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
});
