import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { runName } from "./run-config";
import {
    cleanliness, cleanlinessLine, familyArmRows, lastPerName, loadRuns, makeImports, median, overrides, parseRunName, pendingSteps, questionArmRows, renderFamilyTable,
    renderQuestionTable, renderTable, resultsFile, scannerOnlySteps, scoreAnswer, scoreRun, sumTokens, type FamilyArmRow, type QuestionArmRow, type QuestionData,
    type RunResult, type ScoreContext,
} from "./score";
import type { RunSummary } from "./transcript";

const A = "src/vs/a.ts", B = "src/vs/b.ts", C = "src/vs/c.ts", D = "src/vs/d.ts", E = "src/vs/e.ts", X = "src/vs/x.ts";
const known = new Set([A, B, C, D, E, X]);
// a → b → c → d, and the longer way a → x → b. Anything going to or from e.ts is unknown (nobody has read it yet).
const EDGES: [string, string][] = [[A, B], [B, C], [C, D], [A, X], [X, B]];
const ctx: ScoreContext = {
    repoRoot: "<vscode>", known,
    imports: (a, b) => (a === E || b === E ? null : EDGES.some(([x, y]) => x === a && y === b)),
};

const listQ: QuestionData = {
    id: "cl1", family: "list",
    truth: { id: "cl1", kind: "list", target: D, scope: "direct", files: [A, B, C, D], verified: true, notes: [] },
};
const chainQ = (shortest: number | null, connected = true, from = A, to = D): QuestionData => ({
    id: "cn1", family: "chain",
    truth: { id: "cn1", kind: "chain", from, to, connected, shortest, example: null, verified: true, notes: [] },
});
const bpQ: QuestionData = {
    id: "bp1", family: "bigPicture",
    rubric: {
        id: "bp1", source: "wiki",
        points: [
            { id: "BP1.1", text: "t", check: "", holds: true, note: "" },
            { id: "BP1.2", text: "t", check: "", holds: null, note: "" },
            { id: "BP1.3", text: "t", check: "", holds: false, note: "" },
            { id: "BP1.4", text: "t", check: "", holds: true, note: "" },
        ],
    },
};
const answer = (...lines: string[]): string => `Some reasoning first.\nANSWER:\n${lines.join("\n")}`;

describe("scoreAnswer: lists", () => {
    it("scores a list by recall and reports precision, what was missed, what was extra, and paths that aren't files of the repo", () => {
        // found a, b, e (e is a file, but not in the truth) and a path that is no file; truth is a, b, c, d
        const s = scoreAnswer(answer(A, B, E, "src/vs/nothere.ts"), listQ, ctx);
        expect(s.score).toBe(0.5);                 // 2 of 4
        expect(s.recall).toBe(0.5);
        expect(s.precision).toBeCloseTo(2 / 3, 10);   // 2 of the 3 files it named
        expect(s.hits).toBe(2);
        expect(s.missed).toEqual([C, D]);
        expect(s.extra).toEqual([E]);
        expect(s.files).toEqual([A, B, E]);
        expect(s.notFiles).toEqual(["src/vs/nothere.ts"]);
        expect(s.pending).toBeNull();
        expect(s.flags).toEqual([]);
    });

    it("scores a complete list 1 even with absolute paths, bullets and a trailing line number", () => {
        const s = scoreAnswer(answer(`- <vscode>/${A}`, `* \`${B}:12\``, `3. ${C}`, D), listQ, ctx);
        expect(s.score).toBe(1);
        expect(s.precision).toBe(1);
    });

    it("scores 0 and flags it when the answer has no ANSWER: line, or no answer at all", () => {
        for (const text of ["I could not find them.", null]){
            const s = scoreAnswer(text, listQ, ctx);
            expect(s.score).toBe(0);
            expect(s.recall).toBe(0);
            expect(s.precision).toBe(0);
            expect(s.flags).toEqual(["no ANSWER: line"]);
        }
    });
});

describe("scoreAnswer: chains", () => {
    it("gives 1 for a valid chain of the shortest length", () => {
        const s = scoreAnswer(answer(A, B, C, D), chainQ(3), ctx);
        expect(s).toMatchObject({ score: 1, valid: true, steps: 3, pending: null, flags: [] });
    });

    it("gives 0.5 for a valid but longer chain and 0 for a step that isn't an import", () => {
        expect(scoreAnswer(answer(A, X, B, C, D), chainQ(3), ctx)).toMatchObject({ score: 0.5, valid: true, steps: 4 });
        expect(scoreAnswer(answer(A, C, D), chainQ(3), ctx)).toMatchObject({ score: 0, valid: false, problem: `${A} doesn't import ${C}` });
    });

    it("leaves the score open, and says which step to adjudicate, when nobody has read a step", () => {
        const s = scoreAnswer(answer(A, E, D), chainQ(3), ctx);
        expect(s.score).toBeNull();
        expect(s.pending).toBe("chain step to adjudicate");
        expect(s.unknown).toEqual([A, E]);
    });

    it("scores 0 without waiting when a step that is known false follows an unknown one", () => {
        // a -> e and e -> b are unknown, but b -> d is not an import, so the chain is wrong whatever e turns out to be
        expect(scoreAnswer(answer(A, E, B, D), chainQ(3), ctx)).toMatchObject({ score: 0, pending: null, unknown: null, problem: `${B} doesn't import ${D}` });
    });

    it("gives 0 for none when a chain exists, and 1 for none when none does", () => {
        expect(scoreAnswer(answer("none"), chainQ(3), ctx)).toMatchObject({ score: 0, problem: "no chain given" });
        expect(scoreAnswer(answer("none"), chainQ(null, false, D, A), ctx)).toMatchObject({ score: 1, none: true, flags: [] });
    });

    it("flags an answer that says none but names files of the repo, and still scores it", () => {
        const s = scoreAnswer(answer("none", B), chainQ(null, false, D, A), ctx);
        expect(s.score).toBe(1);
        expect(s.files).toEqual([B]);
        expect(s.flags).toEqual(["none, but names files"]);
    });

    it("flags a chain that also names a path that isn't a file, such as a made-up hop dropped from it", () => {
        const s = scoreAnswer(answer(A, "src/vs/made/up.ts", B, C, D), chainQ(3), ctx);
        expect(s).toMatchObject({ score: 1, valid: true, steps: 3, files: [A, B, C, D], notFiles: ["src/vs/made/up.ts"], flags: ["names non-files"] });
        // both flags, in the order they are found: the none first
        expect(scoreAnswer(answer("none", B, "src/vs/q/z.ts"), chainQ(null, false, D, A), ctx).flags).toEqual(["none, but names files", "names non-files"]);
    });

    it("flags a valid chain shorter than the truth's shortest, which means the truth is wrong", () => {
        const s = scoreAnswer(answer(A, B, C, D), chainQ(4), ctx);
        expect(s.score).toBe(1);
        expect(s.flags).toEqual(["shorter than the truth's shortest: recheck the truth"]);
    });

    it("scores 0 and flags a chain question with no ANSWER: line", () => {
        expect(scoreAnswer("The chain is a to d.", chainQ(3), ctx)).toMatchObject({ score: 0, pending: null, flags: ["no ANSWER: line"] });
    });
});

describe("scoreAnswer: big-picture", () => {
    it("averages the grades over the rubric points that hold, leaving out a point marked false and keeping one not yet checked", () => {
        // BP1.1 (1), BP1.2 (0.5), BP1.4 (0) count; BP1.3 holds: false and does not
        const grade = { "BP1.1": { score: 1 as const }, "BP1.2": { score: 0.5 as const }, "BP1.3": { score: 1 as const }, "BP1.4": { score: 0 as const } };
        const s = scoreAnswer("Layers: ...", bpQ, ctx, grade);
        expect(s.score).toBe(0.5);   // (1 + 0.5 + 0) / 3
        expect(s.pending).toBeNull();
    });

    it("stays ungraded without a grade, or while a point that holds has none", () => {
        expect(scoreAnswer("Layers: ...", bpQ, ctx)).toMatchObject({ score: null, pending: "ungraded" });
        const partial = { "BP1.1": { score: 1 as const }, "BP1.2": { score: 1 as const } };
        expect(scoreAnswer("Layers: ...", bpQ, ctx, partial)).toMatchObject({ score: null, pending: "ungraded" });
    });
});

describe("makeImports and overrides", () => {
    const adjudicated = [
        { from: A, to: E, imports: true, note: "read it: line 3" },
        { from: B, to: E, imports: false, note: "only in a comment" },
        { from: A, to: B, imports: false, note: "read it: only in a comment, a false hit of the scanner's" },
    ];

    it("takes the adjudicated verdict first (reading the source beats the scanner), else the scanner's edge, else null", () => {
        const imports = makeImports(EDGES, adjudicated);
        expect(imports(A, B)).toBe(false);   // the scanner has this edge, the owner's reading says it is not an import: the reading wins
        expect(imports(A, E)).toBe(true);    // adjudicated true
        expect(imports(B, E)).toBe(false);   // adjudicated false
        expect(imports(B, C)).toBe(true);    // the scanner's edge, not adjudicated
        expect(imports(C, E)).toBeNull();    // nobody knows
        expect(imports(D, A)).toBeNull();    // not an edge, not adjudicated: unknown, not false
    });

    it("lists the adjudicated verdicts that overturn a scanner edge, so the ruling is shown and not silent", () => {
        // A -> E true is a step the scanner lacks and B -> E false overturns nothing; only A -> B overturns an edge
        expect(overrides(EDGES, adjudicated)).toEqual([adjudicated[2]]);
        expect(overrides(EDGES, [])).toEqual([]);
    });
});

describe("parseRunName", () => {
    it("is the inverse of runName", () => {
        for (const name of ["bp1-baseline-1", "cl4-nebulosity-2", "cn3-nebulosity-upfront-1"]) expect(runName(parseRunName(name)!)).toBe(name);
        expect(parseRunName("cn3-nebulosity-upfront-1")).toEqual({ question: "cn3", arm: "nebulosity", repeat: 1, toolSearch: false });
    });

    it("refuses what isn't a run's name", () => {
        for (const name of ["index", "cl1-other-1", "cl1-baseline", "cl1-baseline-x", "CL1-baseline-1.jsonl"]) expect(parseRunName(name)).toBeNull();
    });
});

describe("lastPerName", () => {
    it("keeps the last line for each run name and skips blank and broken lines", () => {
        const text = [
            JSON.stringify({ name: "cl1-baseline-1", costUsd: 1 }),
            "",
            "{ not json",
            JSON.stringify({ name: "bp1-nebulosity-1", costUsd: 5 }),
            JSON.stringify({ name: "cl1-baseline-1", costUsd: 2 }),   // a crash left a repeat: this one counts
            JSON.stringify({ costUsd: 9 }),                           // no name
        ].join("\n");
        const index = lastPerName(text);
        expect([...index.keys()].sort()).toEqual(["bp1-nebulosity-1", "cl1-baseline-1"]);
        expect(index.get("cl1-baseline-1")).toMatchObject({ costUsd: 2 });
    });
});

describe("median", () => {
    it("is the middle value, the mean of the two middle ones, or null for nothing", () => {
        expect(median([])).toBeNull();
        expect(median([5])).toBe(5);
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
    });
});

const MODELS = {
    "claude-sonnet-5-5": { costUsd: 0.29, input: 10, output: 900, cacheRead: 50000, cacheWrite: 2000 },
    "claude-haiku-5-5": { costUsd: 0.02, input: 5, output: 50, cacheRead: 0, cacheWrite: 300 },
};
const USAGE = { input: 10, cacheWrite: 2000, cacheRead: 50000, output: 900 };

describe("sumTokens", () => {
    it("adds every model's tokens, subagents' included, and totals the four kinds", () => {
        // input 10 + 5; cache write 2000 + 300; cache read 50000 + 0; output 900 + 50; total 15 + 2300 + 50000 + 950
        expect(sumTokens(MODELS, USAGE)).toEqual({ input: 15, cacheWrite: 2300, cacheRead: 50000, output: 950, total: 53265 });
    });

    it("falls back to the main conversation's usage when no model is listed", () => {
        expect(sumTokens({}, USAGE)).toEqual({ input: 10, cacheWrite: 2000, cacheRead: 50000, output: 900, total: 52910 });
    });
});

function summary(over: Partial<RunSummary> = {}): RunSummary {
    return {
        model: "claude-sonnet-5-5", claudeVersion: "2.1.296", apiKeySource: "none", permissionMode: "dontAsk", tools: [], mcpServers: [], plugins: [], skills: 0,
        finalText: answer(A, B, C, D), subtype: "success", isError: false, turns: 6, durationMs: 40000, apiMs: 30000, costUsd: 0.31,
        usage: USAGE, firstCallContext: null, models: MODELS, toolCalls: { Grep: 1, ToolSearch: 1, mcp__nebulosity__dependents: 1 }, nestedToolCalls: { Read: 2 }, toolErrors: 0,
        toolSearchCalls: 1, nebulosityCalls: 1, utilization: { fiveHour: null, sevenDay: null }, ...over,
    };
}

describe("scoreRun", () => {
    const id = { question: "cl1", arm: "nebulosity" as const, repeat: 2, toolSearch: true };

    it("joins the answer's score with the run's tokens (all models, and the main conversation apart), cost, wall time and tool calls", () => {
        const run = { name: "cl1-nebulosity-2", summary: summary(), startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:42.500Z", resultNotes: ["note"] };
        const r = scoreRun(run, id, listQ, ctx);
        expect(r).toMatchObject({
            name: "cl1-nebulosity-2", question: "cl1", family: "list", arm: "nebulosity", repeat: 2, score: 1, recall: 1, precision: 1,
            tokens: { total: 53265 }, mainTokens: { total: 52910 }, costUsd: 0.31, wallMs: 42500, toolCalls: 5, nebulosityCalls: 1, turns: 6, resultNotes: ["note"], flags: [],
        });
        expect((r.summary as Record<string, unknown>).finalText).toBeUndefined();
    });

    it("takes the wall time from the result when the index has no line for the run", () => {
        const r = scoreRun({ name: "cl1-baseline-1", summary: summary(), startedAt: null, endedAt: null, resultNotes: [] }, { ...id, arm: "baseline", repeat: 1 }, listQ, ctx);
        expect(r.wallMs).toBe(40000);
        expect(r.arm).toBe("baseline");
    });

    it("names the pilot's up-front variant apart from the arm it varies, and flags a run that didn't finish", () => {
        const run = { name: "cl1-nebulosity-upfront-1", summary: summary({ subtype: "error_max_turns", isError: true, finalText: null }), startedAt: null, endedAt: null, resultNotes: [] };
        const r = scoreRun(run, { ...id, repeat: 1, toolSearch: false }, listQ, ctx);
        expect(r.arm).toBe("nebulosity-upfront");
        expect(r.score).toBe(0);
        expect(r.flags).toEqual(["no ANSWER: line", "ended: error_max_turns"]);
    });
});

/** A scored run with only the fields the tables read. */
function result(name: string, over: Partial<RunResult>): RunResult {
    const id = parseRunName(name)!;
    const zero = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0 };
    return {
        name, question: id.question, family: "list", arm: id.arm, repeat: id.repeat, score: null, pending: null,
        none: false, files: [], notFiles: [], recall: null, precision: null, hits: null, missed: [], extra: [],
        steps: null, valid: null, problem: null, unknown: null, flags: [],
        tokens: zero, mainTokens: zero, costUsd: 0, wallMs: 0, toolCalls: 0, nebulosityCalls: 0, turns: 0, resultNotes: [], summary: {} as RunResult["summary"],
        ...over,
    };
}
const tok = (input: number, cacheWrite: number, cacheRead: number, output: number): RunResult["tokens"] =>
    ({ input, cacheWrite, cacheRead, output, total: input + cacheWrite + cacheRead + output });

describe("the tables", () => {
    const results: RunResult[] = [
        result("cl1-baseline-1", { score: 0.5, recall: 0.5, precision: 1, tokens: tok(10, 100, 1000, 5), costUsd: 0.125, wallMs: 10000, toolCalls: 4 }),
        result("cl1-baseline-2", { score: 1, recall: 1, precision: 0.5, tokens: tok(30, 300, 3000, 15), costUsd: 0.375, wallMs: 30000, toolCalls: 8 }),
        result("cl1-nebulosity-1", { score: 1, recall: 1, precision: 1, tokens: tok(5, 50, 400, 45), costUsd: 0.0625, wallMs: 5000, toolCalls: 2 }),
        result("cl2-baseline-1", { score: 0, recall: 0, precision: 0, tokens: tok(20, 200, 2000, 10), costUsd: 0.25, wallMs: 20000, toolCalls: 6 }),
        result("cn1-baseline-1", { family: "chain", score: 1, tokens: tok(1, 9, 80, 10), costUsd: 0.25, wallMs: 1000, toolCalls: 1 }),
        result("cn1-baseline-2", { family: "chain", score: null, pending: "chain step to adjudicate", unknown: [A, E], tokens: tok(3, 27, 240, 30), costUsd: 0.75, wallMs: 3000, toolCalls: 3 }),
    ];
    const order = ["bp1", "cl1", "cl2", "cn1"];

    it("gives each question and arm its scores by repeat, their mean, and the lists' mean recall and precision", () => {
        expect(questionArmRows(results, order)).toEqual([
            { question: "cl1", family: "list", arm: "baseline", runs: 2, repeats: [1, 2], scores: [0.5, 1], mean: 0.75, recall: 0.75, precision: 0.75 },
            { question: "cl1", family: "list", arm: "nebulosity", runs: 1, repeats: [1], scores: [1], mean: 1, recall: 1, precision: 1 },
            { question: "cl2", family: "list", arm: "baseline", runs: 1, repeats: [1], scores: [0], mean: 0, recall: 0, precision: 0 },
            { question: "cn1", family: "chain", arm: "baseline", runs: 2, repeats: [1, 2], scores: [1, null], mean: 1, recall: null, precision: null },
        ]);
    });

    it("gives each family and arm its mean score over the scored runs, and the medians of each kind of token, cost, wall time and tool calls", () => {
        const rows = familyArmRows(results);
        // list, baseline: runs cl1-1, cl1-2, cl2-1. Scores .5, 1, 0; cost .125, .375, .25; wall 10, 30, 20 s; calls 4, 8, 6
        // tokens (uncached input, cache writes, cache reads, output): 10, 100, 1000, 5 / 30, 300, 3000, 15 / 20, 200, 2000, 10; totals 1115, 3345, 2230
        expect(rows[0]).toEqual({
            family: "list", arm: "baseline", runs: 3, scored: 3, mean: 0.5, recall: 0.5, precision: 0.5,
            medianInput: 20, medianCacheWrite: 200, medianCacheRead: 2000, medianOutput: 10, medianTokens: 2230,
            medianCostUsd: 0.25, medianWallMs: 20000, medianToolCalls: 6,
        });
        expect(rows[1]).toMatchObject({ family: "list", arm: "nebulosity", runs: 1, scored: 1, mean: 1, medianInput: 5, medianOutput: 45, medianTokens: 500 });
        // chain, baseline: two runs, one still to adjudicate, so one scored; medians still cover both runs: tokens 1, 9, 80, 10 / 3, 27, 240, 30; totals 100, 300
        expect(rows[2]).toEqual({
            family: "chain", arm: "baseline", runs: 2, scored: 1, mean: 1, recall: null, precision: null,
            medianInput: 2, medianCacheWrite: 18, medianCacheRead: 160, medianOutput: 20, medianTokens: 200,
            medianCostUsd: 0.5, medianWallMs: 2000, medianToolCalls: 2,
        });
        expect(rows).toHaveLength(3);
    });

    it("lists each chain step to adjudicate once, from every run that left it open", () => {
        const twice = [...results, result("cn1-nebulosity-1", { family: "chain", pending: "chain step to adjudicate", unknown: [A, E] }), result("cn2-baseline-1", { family: "chain", pending: "chain step to adjudicate", unknown: [B, E] })];
        expect(pendingSteps(twice)).toEqual([[A, E], [B, E]]);
        expect(pendingSteps([])).toEqual([]);
    });

    it("renders a Markdown table, escaping a pipe, and just the header for no rows", () => {
        expect(renderTable(["A", "B"], [["1", "x|y"]])).toBe("| A | B |\n| --- | --- |\n| 1 | x\\|y |");
        expect(renderTable(["A", "B"], [])).toBe("| A | B |\n| --- | --- |");
    });
});

describe("rendering the question and family tables", () => {
    it("labels every score with its repeat, so a missing first repeat isn't read as the first", () => {
        const rows: QuestionArmRow[] = [
            { question: "cl1", family: "list", arm: "baseline", runs: 2, repeats: [1, 2], scores: [0.5, 1], mean: 0.75, recall: 0.75, precision: 0.75 },
            { question: "cl3", family: "list", arm: "nebulosity", runs: 1, repeats: [2], scores: [0.5], mean: 0.5, recall: 0.5, precision: 1 },
            { question: "cn1", family: "chain", arm: "baseline", runs: 2, repeats: [1, 2], scores: [1, null], mean: 1, recall: null, precision: null },
        ];
        expect(renderQuestionTable(rows)).toBe([
            "| Question | Arm | Scores (by repeat) | Mean | Recall | Precision |",
            "| --- | --- | --- | --- | --- | --- |",
            "| cl1 | baseline | r1: 0.50, r2: 1.00 | 0.75 | 0.75 | 0.75 |",
            "| cl3 | nebulosity | r2: 0.50 | 0.50 | 0.50 | 1.00 |",
            "| cn1 | baseline | r1: 1.00, r2: open | 1.00 | n/a | n/a |",
        ].join("\n"));
    });

    it("shows the family's tokens apart (uncached input, cache writes, cache reads, output) and then the total", () => {
        const row: FamilyArmRow = {
            family: "list", arm: "baseline", runs: 3, scored: 3, mean: 0.5, recall: 0.5, precision: 0.5,
            medianInput: 20, medianCacheWrite: 200, medianCacheRead: 2000, medianOutput: 10, medianTokens: 2230,
            medianCostUsd: 0.25, medianWallMs: 20000, medianToolCalls: 6,
        };
        expect(renderFamilyTable([row])).toBe([
            "| Family | Arm | Runs (scored / all) | Mean score | Recall | Precision | Median input (uncached) | Median cache writes | Median cache reads | Median output | Median total tokens | Median cost est. | Median wall | Median tool calls |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            "| Complete-list | baseline | 3 / 3 | 0.50 | 0.50 | 0.50 | 20 | 200 | 2,000 | 10 | 2,230 | $0.25 | 20 s | 6 |",
        ].join("\n"));
    });
});

describe("scannerOnlySteps", () => {
    const chainRun = (name: string, files: string[], over: Partial<RunResult> = {}): RunResult =>
        result(name, { family: "chain", files, valid: true, steps: files.length - 1, score: 1, ...over });
    const examples = new Map<string, string[] | null>([["cn1", [A, B, C, D]], ["cn2", [A, B, C, D]], ["cn3", [A, B, C, D]], ["cn4", null]]);
    const adjudicated = [{ from: A, to: E, imports: true, note: "read it" }];

    it("lists the steps of valid chains that only the scanner vouches for and that the truth's own chain doesn't have, with the runs that used them", () => {
        const results = [
            chainRun("cn1-baseline-1", [A, B, C, D]),                            // exactly the truth's steps: already read
            chainRun("cn1-baseline-2", [A, X, B, C, D], { score: 0.5 }),         // a -> x and x -> b are the scanner's alone
            chainRun("cn1-nebulosity-1", [A, X, B, C, D], { score: 0.5 }),       // the same two steps again
            chainRun("cn2-baseline-1", [A, E], { score: 0.5 }),                  // a -> e was decided by reading: not the scanner's
            chainRun("cn3-baseline-1", [A, X, B], { score: 0, valid: false }),   // not a valid chain: no step was credited
            chainRun("cn4-baseline-1", [B], { steps: null }),                    // "none" naming a file: no steps
            result("cl1-baseline-1", { files: [A, X] }),                         // a list
        ];
        expect(scannerOnlySteps(results, examples, EDGES, adjudicated)).toEqual([
            { step: [A, X], runs: ["cn1-baseline-2", "cn1-nebulosity-1"] },
            { step: [X, B], runs: ["cn1-baseline-2", "cn1-nebulosity-1"] },
        ]);
        expect(scannerOnlySteps([], examples, EDGES, adjudicated)).toEqual([]);
    });
});

describe("cleanliness", () => {
    const unverified: QuestionData = { ...listQ, truth: { ...(listQ.truth as NonNullable<QuestionData["truth"]>), verified: false } };

    it("says whether every truth is checked and how many rubric points are still unchecked", () => {
        // bpQ: BP1.2 has holds: null, so one point is unchecked
        expect(cleanliness([listQ, chainQ(3), bpQ])).toEqual({ truthsVerified: true, unverified: [], uncheckedPoints: 1 });
        expect(cleanliness([unverified, chainQ(3)])).toEqual({ truthsVerified: false, unverified: ["cl1"], uncheckedPoints: 0 });
        expect(cleanliness([])).toEqual({ truthsVerified: true, unverified: [], uncheckedPoints: 0 });
    });

    it("has a header line only when something is not clean, naming both", () => {
        expect(cleanlinessLine({ truthsVerified: true, unverified: [], uncheckedPoints: 0 })).toBeNull();
        expect(cleanlinessLine({ truthsVerified: true, unverified: [], uncheckedPoints: 1 })).toBe("Truths checked: yes. Rubric points still unchecked: 1.");
        expect(cleanlinessLine({ truthsVerified: false, unverified: ["cl1", "cl2"], uncheckedPoints: 0 })).toBe("Truths checked: no (cl1, cl2). Rubric points still unchecked: 0.");
    });
});

describe("resultsFile", () => {
    it("writes the real eval/results.json only when neither --runs nor --out is given", () => {
        expect(resultsFile({ runs: null, out: null }, "/repo", "/tmp")).toBe("/repo/eval/results.json");
        expect(resultsFile({ runs: "/fake/runs", out: null }, "/repo", "/tmp")).toBe("/tmp/nebulosity-eval-results.json");
        expect(resultsFile({ runs: "/fake/runs", out: "/x/out.json" }, "/repo", "/tmp")).toBe("/x/out.json");
        expect(resultsFile({ runs: null, out: "/x/out.json" }, "/repo", "/tmp")).toBe("/x/out.json");
    });
});

describe("loadRuns", () => {
    it("reads each kept transcript, with its index line when it has one, and ignores half-written files", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "score-"));
        try{
            const lines = [
                { type: "system", subtype: "init", model: "claude-sonnet-5-5", claude_code_version: "2.1.296", apiKeySource: "none", permissionMode: "dontAsk", tools: [], mcp_servers: [], plugins: [], skills: [] },
                { type: "result", subtype: "success", is_error: false, num_turns: 2, duration_ms: 5000, duration_api_ms: 4000, total_cost_usd: 0.1, result: `ANSWER:\n${A}`,
                  usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } },
            ].map((l) => JSON.stringify(l)).join("\n");
            fs.writeFileSync(path.join(dir, "cl1-baseline-1.jsonl.gz"), zlib.gzipSync(Buffer.from(lines)));
            fs.writeFileSync(path.join(dir, "cl1-baseline-2.jsonl.gz.tmp"), "half");
            fs.writeFileSync(path.join(dir, "odd.jsonl.gz"), zlib.gzipSync(Buffer.from(lines)));   // a transcript that isn't named like a run
            fs.writeFileSync(path.join(dir, "index.jsonl"), `${JSON.stringify({ name: "cl1-baseline-1", startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:07.000Z", resultNotes: ["x"] })}\n`
                + `${JSON.stringify({ name: "cl9-baseline-1" })}\n`);   // in the index, no transcript: ignored
            const { runs, warnings } = loadRuns(dir);
            expect(runs).toHaveLength(1);
            expect(runs[0]).toMatchObject({ name: "cl1-baseline-1", startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:07.000Z", resultNotes: ["x"] });
            expect(runs[0].summary.finalText).toBe(`ANSWER:\n${A}`);
            expect(runs[0].summary.usage).toEqual({ input: 1, cacheWrite: 2, cacheRead: 3, output: 4 });
            expect(warnings).toEqual([
                "odd.jsonl.gz is not named like a run; ignored",
                "cl9-baseline-1 is in the index but has no transcript (an interrupted write); ignored",
            ]);
        } finally{
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("finds nothing in a folder that doesn't exist", () => {
        expect(loadRuns(path.join(os.tmpdir(), "score-no-such-folder"))).toEqual({ runs: [], warnings: [] });
    });
});
