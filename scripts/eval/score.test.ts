import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { runName } from "./run-config";
import {
    cleanliness, cleanlinessLine, familyArmRows, familyOfKind, kindArmRows, kindOf, lastPerName, loadRuns, loadScorerVerdicts, makeImports, median, missingForGate, openSteps, renderAdjudicate, renderRecheck, repoScoreContext, stepsOnTruths, overrides, parseRunName, pendingSteps, questionArmRows, renderFamilyTable, renderGate, renderSessionTable, repoReadouts,
    renderQuestionTable, renderTable, repoIdFor, resultsFile, scannerOnlySteps, scoreAnswer, scoreRun, scoreSession, sumTokens, toGateRun, toGateSession, type Adjudicated, type FamilyArmRow, type SessionResult, type QuestionArmRow, type QuestionData,
    type RunResult, type ScoreContext,
} from "./score";
import type { SessionSummary, SessionTurn } from "./session";
import type { RunSummary } from "./transcript";

const A = "src/vs/a.ts", B = "src/vs/b.ts", C = "src/vs/c.ts", D = "src/vs/d.ts", E = "src/vs/e.ts", X = "src/vs/x.ts";
const NO_USAGE = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
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

describe("repoIdFor", () => {
    it("takes the only repo when a question names none, and the named one when there are several", () => {
        expect(repoIdFor(["vscode"], undefined, "bp1")).toBe("vscode");
        expect(repoIdFor(["vscode", "affine"], "affine", "affine-cn1")).toBe("affine");
    });

    it("refuses a question that names no repo among several, or one the definition doesn't list", () => {
        expect(() => repoIdFor(["vscode", "affine"], undefined, "q1")).toThrow("question q1 names no repo, and eval.json has several (vscode, affine).");
        expect(() => repoIdFor(["vscode"], "other", "q2")).toThrow("question q2 names the repo other, which eval.json doesn't list.");
    });
});

// ---- V1.6 Task 11: the new kinds, sessions, per-repo graphs and the gate's inputs

describe("scoreAnswer: the new kinds", () => {
    // a → b → c → d and the longer way a → x → b; d → a closes a cycle of 4 steps (a b c d a) and a longer one of 5 (a x b c d a)
    const cyc: ScoreContext = { ...ctx, imports: (a, b) => ctx.imports(a, b) === true || (a === D && b === A) };
    const impactQ: QuestionData = {
        id: "gi1", family: "grepHard", kind: "impact",
        truth: { id: "gi1", kind: "impact", target: D, counts: [["src/vs", 3]], elsewhere: 1, total: 4, verified: true, notes: [] },
    };
    const cycleQ = (shortest: number | null): QuestionData => ({
        id: "gc1", family: "grepHard", kind: "cycle",
        truth: { id: "gc1", kind: "cycle", file: A, shortest, example: null, verified: true, notes: [] },
    });
    const unusedQ: QuestionData = { id: "gu1", family: "grepHard", kind: "unused", truth: { id: "gu1", kind: "unused", folder: "src/vs", files: [A, B], verified: true, notes: [] } };
    const pairsQ: QuestionData = {
        id: "gp1", family: "grepHard", kind: "pairs",
        truth: { id: "gp1", kind: "pairs", folder: "src/vs", names: null, pairs: [["a", "b"], ["b", "c"]], verified: true, notes: [] },
    };

    it("scores impact counts line by line: src/vs 3 of 3 is 1, elsewhere 1 of 1 is 1, total 5 against 4 is 0.75", () => {
        const s = scoreAnswer(answer("src/vs: 3", "elsewhere: 1", "total: 5"), impactQ, cyc);
        expect(s.score).toBeCloseTo((1 + 1 + 0.75) / 3, 10);
        expect(s.pending).toBeNull();
    });

    it("scores a cycle through the file: the shortest (4 steps) 1, a valid longer one (5 steps) 0.5, a right none 1", () => {
        expect(scoreAnswer(answer(A, B, C, D, A), cycleQ(4), cyc).score).toBe(1);
        expect(scoreAnswer(answer(A, X, B, C, D, A), cycleQ(4), cyc)).toMatchObject({ score: 0.5, steps: 5, valid: true });
        expect(scoreAnswer(answer("none"), cycleQ(null), cyc).score).toBe(1);
        expect(scoreAnswer(answer("none"), cycleQ(4), cyc).score).toBe(0);
    });

    it("scores unused, violations and entries lists by F1 (listed a and c against a and b: 0.5) and still reports recall and precision", () => {
        const s = scoreAnswer(answer(A, C), unusedQ, cyc);
        expect(s.score).toBeCloseTo(0.5, 10);
        expect(s.recall).toBe(0.5);
        expect(s.precision).toBe(0.5);
        expect(s.extra).toEqual([C]);
    });

    it("scores pairs by F1 over the lines (one right of two listed, one of two wanted: 0.5)", () => {
        expect(scoreAnswer(answer("a -> b", "c → d"), pairsQ, cyc).score).toBeCloseTo(0.5, 10);
    });

    it("scores 0 and flags an answer with no ANSWER: line", () => {
        expect(scoreAnswer("I could not tell.", impactQ, cyc)).toMatchObject({ score: 0, flags: ["no ANSWER: line"] });
        expect(scoreAnswer(null, cycleQ(4), cyc)).toMatchObject({ score: 0, flags: ["no ANSWER: line"] });
    });
});

describe("kindOf", () => {
    it("takes a question's own kind, else tells Eval #1's lists apart by the truth's scope", () => {
        expect(kindOf({ ...listQ, kind: "impact" })).toBe("impact");
        expect(kindOf(listQ)).toBe("list-direct");
        expect(kindOf({ ...listQ, truth: { id: "cl4", kind: "list", target: D, scope: "transitive", files: [A], verified: true, notes: [] } })).toBe("list-transitive");
        expect(kindOf({ ...listQ, truth: { id: "cl2", kind: "list", target: D, scope: "outside", files: [A], verified: true, notes: [] } })).toBe("list-direct");
        expect(kindOf(chainQ(3))).toBe("chain");
        expect(kindOf(bpQ)).toBe("bigPicture");
    });
});

describe("scoreRun: limits", () => {
    it("scores 0 a big-picture run that hit its turn or budget limit, graded or not (D1)", () => {
        const grade = { "BP1.1": { score: 1 }, "BP1.2": { score: 1 }, "BP1.4": { score: 1 } };
        for (const subtype of ["error_max_turns", "error_max_budget_usd"]){
            const run = { name: "bp1-baseline-1", summary: summary({ subtype, isError: true, finalText: null }), startedAt: null, endedAt: null, resultNotes: [] };
            const r = scoreRun(run, { question: "bp1", arm: "baseline", repeat: 1, toolSearch: true }, bpQ, ctx, grade);
            expect(r.score).toBe(0);
            expect(r.pending).toBeNull();
        }
    });
});

describe("scoreSession", () => {
    const questions = new Map<string, QuestionData>([["cl1", listQ], ["cn1", chainQ(3)]]);
    const id = { question: "s1", arm: "nebulosity" as const, repeat: 2, toolSearch: true };
    const turn = (finalText: string | null, subtype: string | null = "success"): SessionTurn => ({ finalText, subtype, costUsd: 0.1, durationMs: 3000, toolCalls: {}, nebulosityCalls: 1, numTurns: 2, usage: NO_USAGE });
    const summaryOf = (turns: SessionTurn[]): SessionSummary => ({ turns, costUsd: 0.5, durationMs: 9000, firstCallContext: 20000, numTurns: 2 * turns.length, usage: NO_USAGE });

    it("scores each message against its own question and takes the mean, with the session's totals", () => {
        // message 1: a and b of the list a b c d (recall 0.5); message 2: the chain a b c d, its shortest (3 steps): 1
        const s = scoreSession("s1-nebulosity-2", id, ["cl1", "cn1"], summaryOf([turn(answer(A, B)), turn(answer(A, B, C, D))]), questions, ctx);
        expect(s.turns.map((t) => t.score)).toEqual([0.5, 1]);
        expect(s.score).toBe(0.75);
        expect(s).toMatchObject({ name: "s1-nebulosity-2", session: "s1", arm: "nebulosity", repeat: 2, costUsd: 0.5, wallMs: 9000, firstCallContext: 20000, pending: null });
    });

    it("scores 0 a message that hit its limit, even with a right answer in its text, and one that never came", () => {
        const s = scoreSession("s1-nebulosity-2", id, ["cl1", "cn1"], summaryOf([turn(answer(A, B, C, D), "error_max_turns")]), questions, ctx);
        expect(s.turns.map((t) => t.score)).toEqual([0, 0]);
        expect(s.score).toBe(0);
        expect(s.turns[0].flags).toContain("ended: error_max_turns");
        expect(s.turns[1].flags).toContain("no answer: the session ended before this message");
    });

    it("waits (no score) while a chain step in any message is unknown, and says which", () => {
        const s = scoreSession("s1-nebulosity-2", id, ["cl1", "cn1"], summaryOf([turn(answer(A, B, C, D)), turn(answer(A, E, C, D))]), questions, ctx);
        expect(s.score).toBeNull();
        expect(s.pending).toBe("chain step to adjudicate");
        expect(s.unknown).toEqual([[A, E]]);
    });
});

describe("repoReadouts: each repo's own graph", () => {
    const edgesByRepo = new Map<string, [string, string][]>([["r1", [[A, B]]], ["r2", [[B, C]]]]);
    const chainRun = (name: string): RunResult => result(name, { family: "chain", valid: true, steps: 1, files: [A, B] });

    it("lists an adjudicated override only for the repo whose scanner has the edge, and one without a repo for every repo that has it", () => {
        const adjudicated: Adjudicated[] = [
            { repo: "r2", from: A, to: B, imports: false, note: "" },   // r2's scanner never had a → b: no note
            { repo: "r1", from: A, to: B, imports: false, note: "" },
            { from: B, to: C, imports: false, note: "" },               // no repo: it applies where the scanner has b → c, which is r2 alone
        ];
        expect(repoReadouts([], () => "r1", edgesByRepo, adjudicated, new Map()).notes).toEqual([
            `r1: adjudicated overrides the scanner: ${A} → ${B} (false)`,
            `r2: adjudicated overrides the scanner: ${B} → ${C} (false)`,
        ]);
    });

    it("names no repo when there is only one (Eval #1's output is as it was)", () => {
        const one = new Map([["vscode", [[A, B]] as [string, string][]]]);
        expect(repoReadouts([], () => "vscode", one, [{ from: A, to: B, imports: false, note: "" }], new Map()).notes)
            .toEqual([`adjudicated overrides the scanner: ${A} → ${B} (false)`]);
    });

    it("reads a chain's steps against its own repo's scanner: r2's run of a → b isn't vouched for by r1's edge", () => {
        const runs = [chainRun("cn1-baseline-1"), chainRun("cn2-baseline-1")];
        const repoOf = (r: RunResult): string => (r.name === "cn1-baseline-1" ? "r1" : "r2");
        expect(repoReadouts(runs, repoOf, edgesByRepo, [], new Map()).toRead).toEqual([{ repo: "r1", step: [A, B], runs: ["cn1-baseline-1"] }]);
    });
});

describe("the gate's inputs", () => {
    it("turns a scored run of the eval into a gate run, and leaves out what the gate doesn't take", () => {
        // wallMs is the clock between start and end; the gate takes the result's duration_ms (D1), 1500 here
        const base = { score: 0.5, kind: "list-direct" as const, repo: "vscode", costUsd: 0.1, wallMs: 2000, nebulosityCalls: 2, firstCallContext: 21000, summary: { durationMs: 1500 } as RunResult["summary"] };
        expect(toGateRun(result("cl1-nebulosity-2", base))).toEqual({
            question: "cl1", repo: "vscode", kind: "list-direct", arm: "nebulosity", repeat: 2, score: 0.5, costUsd: 0.1, wallMs: 1500, nebulosityCalls: 2, firstCallContext: 21000,
        });
        expect(toGateRun(result("cl1-nebulosity-2", { ...base, score: null }))).toBeNull();
        expect(toGateRun(result("cl1-nebulosity-2", { ...base, kind: undefined }))).toBeNull();
        expect(toGateRun({ ...result("cl1-nebulosity-2", base), arm: "nebulosity-upfront" })).toBeNull();
    });

    it("turns a scored session into a gate session", () => {
        const s: SessionResult = {
            name: "s1-baseline-3", session: "s1", repo: "vscode", arm: "baseline", repeat: 3, score: 0.75, pending: null, turns: [], costUsd: 0.5, wallMs: 9000, firstCallContext: 1, unknown: [], flags: [],
        };
        expect(toGateSession(s)).toEqual({ session: "s1", repo: "vscode", arm: "baseline", repeat: 3, score: 0.75, costUsd: 0.5, wallMs: 9000 });
        expect(toGateSession({ ...s, score: null })).toBeNull();
    });

    it("prints the gate condition by condition, then the verdict", () => {
        const text = renderGate({
            pass: false,
            conditions: [
                { id: "1", scope: "all", values: {}, pass: true, text: "Better." },
                { id: "2", scope: "vscode, chains", values: {}, pass: false, text: "Worse." },
            ],
        });
        expect(text).toBe("- 1 PASS (all): Better.\n- 2 FAIL (vscode, chains): Worse.\n\nGate: FAIL");
    });
});

describe("loadRuns: sessions", () => {
    it("reads a task session's per-message answers, and the totals of the whole session", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "score-session-"));
        try{
            const init = { type: "system", subtype: "init", model: "claude-sonnet-5-5", tools: [], mcp_servers: [], plugins: [], skills: [] };
            const done = (text: string, total: number, ms: number): unknown => ({ type: "result", subtype: "success", is_error: false, result: text, num_turns: 2, duration_ms: ms, total_cost_usd: total });
            const lines = [init, done("ANSWER:\nfirst", 0.02, 6000), init, done("ANSWER:\nsecond", 0.03, 5000)].map((l) => JSON.stringify(l)).join("\n");
            fs.writeFileSync(path.join(dir, "s1-baseline-1.jsonl.gz"), zlib.gzipSync(Buffer.from(lines)));
            fs.writeFileSync(path.join(dir, "cl1-baseline-1.jsonl.gz"), zlib.gzipSync(Buffer.from(lines)));
            fs.writeFileSync(path.join(dir, "index.jsonl"), `${JSON.stringify({ name: "s1-baseline-1", session: "s1", turnQuestions: ["cl1", "cn1"] })}\n`);
            const { runs } = loadRuns(dir);
            const s = runs.find((r) => r.name === "s1-baseline-1")!;
            expect(s.session).toMatchObject({ id: "s1", turnQuestions: ["cl1", "cn1"] });
            expect(s.session!.summary.turns.map((t) => t.finalText)).toEqual(["ANSWER:\nfirst", "ANSWER:\nsecond"]);
            expect(s.session!.summary.durationMs).toBe(11000);
            expect(s.session!.summary.costUsd).toBeCloseTo(0.03, 10);
            expect(runs.find((r) => r.name === "cl1-baseline-1")!.session).toBeUndefined();
        } finally{
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("the Eval #2 tables", () => {
    it("gives each repo, kind and arm its mean score and medians, the first call's context included", () => {
        const base = { kind: "chain" as const, repo: "r", family: "chain" as const };
        const rows = kindArmRows([
            result("cn1-baseline-1", { ...base, score: 1, costUsd: 0.1, wallMs: 10000, firstCallContext: 100 }),
            result("cn1-baseline-2", { ...base, score: 0.5, costUsd: 0.3, wallMs: 20000, firstCallContext: 300 }),
            result("cl1-baseline-1", { score: 1 }),   // no kind or repo: an Eval #1 run, left out
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ repo: "r", kind: "chain", arm: "baseline", runs: 2, scored: 2, mean: 0.75, medianWallMs: 15000, medianFirstCall: 200 });
        expect(rows[0].medianCostUsd).toBeCloseTo(0.2, 10);
    });

    it("scores a question that names its kind in the kind's family: the lists one family, the six new kinds grep-hard", () => {
        expect(familyOfKind("bigPicture")).toBe("bigPicture");
        expect(familyOfKind("chain")).toBe("chain");
        expect(familyOfKind("list-direct")).toBe("list");
        expect(familyOfKind("list-transitive")).toBe("list");
        for (const kind of ["impact", "cycle", "unused", "violations", "entries", "pairs"] as const) expect(familyOfKind(kind)).toBe("grepHard");
    });

    it("gives each grep-hard kind its own row in the family table, labeled by the kind, after the other families", () => {
        const hard = (name: string, kind: "impact" | "cycle", score: number): RunResult => result(name, { family: "grepHard", kind, repo: "r", score });
        const rows = familyArmRows([
            hard("vi-cycle-baseline-1", "cycle", 1),
            hard("vi-impact-baseline-1", "impact", 1),
            hard("vi-impact-baseline-2", "impact", 0.5),
            result("vl-cl1-baseline-1", { kind: "list-direct", repo: "r", score: 1 }),
        ]);
        // list first (FAMILY_ORDER), then grep-hard by KIND_ORDER: impact before cycle
        expect(rows.map((r) => [r.family, r.kind, r.runs, r.mean])).toEqual([["list", undefined, 1, 1], ["grepHard", "impact", 2, 0.75], ["grepHard", "cycle", 1, 1]]);
        expect(rows[0]).not.toHaveProperty("kind");
        expect(renderFamilyTable(rows).split("\n").slice(2).map((l) => l.split(" | ")[0])).toEqual(["| Complete-list", "| Impact", "| Cycle"]);
    });

    it("prints a repo's sessions of one arm as one row: scored of all, mean score, mean cost, mean time, mean Nebulosity calls", () => {
        const s = (score: number | null, costUsd: number, wallMs: number): SessionResult => ({
            name: "s1-baseline-1", session: "s1", repo: "r", arm: "baseline", repeat: 1, score, pending: null,
            turns: [{ question: "q", score, pending: null, flags: [], nebulosityCalls: 0, costUsd }], costUsd, wallMs, firstCallContext: null, unknown: [], flags: [],
        });
        const text = renderSessionTable([s(0.5, 0.4, 10000), s(1, 0.6, 20000)]);
        expect(text.split("\n")[2]).toBe("| r | baseline | 2 / 2 | 0.75 | $0.50 | 15 s | 0.00 |");
    });
});

describe("fix round 1", () => {
    // d → a closes the cycle; everything else is ctx's, an unknown step (anything to or from e.ts) staying unknown
    const cyc: ScoreContext = { ...ctx, imports: (a, b) => (a === D && b === A ? true : ctx.imports(a, b)) };
    const cycleQ = (shortest: number | null): QuestionData => ({
        id: "gc1", family: "grepHard", kind: "cycle", truth: { id: "gc1", kind: "cycle", file: A, shortest, example: null, verified: true, notes: [] },
    });

    it("sends an unknown cycle step for reading, and a session and the pending list pick it up (I1)", () => {
        // a → b is real, b → e is unknown (nobody has read e.ts)
        const s = scoreAnswer(answer(A, B, E, A), cycleQ(4), cyc);
        expect(s).toMatchObject({ score: null, pending: "chain step to adjudicate", unknown: [B, E] });
        const questions = new Map([["gc1", cycleQ(4)]]);
        const turn = { finalText: answer(A, B, E, A), subtype: "success", costUsd: 0, durationMs: 1, toolCalls: {}, nebulosityCalls: 0, numTurns: 1, usage: NO_USAGE };
        const session = scoreSession("s1-baseline-1", { question: "s1", arm: "baseline", repeat: 1, toolSearch: true }, ["gc1"], { turns: [turn], costUsd: 0, durationMs: 1, firstCallContext: null, numTurns: 1, usage: NO_USAGE }, questions, cyc);
        expect(session).toMatchObject({ score: null, pending: "chain step to adjudicate", unknown: [[B, E]] });
    });

    it("reads a cycle after a lead-in line that repeats its first file as the same cycle (M3)", () => {
        expect(scoreAnswer(answer(`The cycle through ${A}:`, A, B, C, D, A), cycleQ(4), cyc).score).toBe(1);
    });

    it("flags a valid cycle where the truth says none, for a recheck (M4)", () => {
        const s = scoreAnswer(answer(A, B, C, D, A), cycleQ(null), cyc);
        expect(s.score).toBe(0);
        expect(s.flags).toContain("a valid cycle, though the truth says none: recheck the truth");
    });

    it("counts a listed path that isn't a file of the repo as a false positive, and flags it (M2)", () => {
        const q: QuestionData = { id: "gu1", family: "grepHard", kind: "unused", truth: { id: "gu1", kind: "unused", folder: "src/vs", files: [A, B], verified: true, notes: [] } };
        const s = scoreAnswer(answer(A, "src/vs/nothere.ts"), q, cyc);
        // listed a and nothere against a and b: 1 hit, precision 1/2, recall 1/2
        expect(s.score).toBeCloseTo(0.5, 10);
        expect(s.precision).toBe(0.5);
        expect(s.extra).toEqual(["src/vs/nothere.ts"]);
        expect(s.flags).toContain("names non-files");
    });

    it("parses run names from the right, so ids may hold hyphens and digits (I3)", () => {
        expect(parseRunName("affine-cn1-nebulosity-2")).toEqual({ question: "affine-cn1", arm: "nebulosity", repeat: 2, toolSearch: true });
        expect(parseRunName("vs-s1-baseline-3")).toEqual({ question: "vs-s1", arm: "baseline", repeat: 3, toolSearch: true });
        expect(parseRunName("affine-cn1-nebulosity-upfront-1")).toEqual({ question: "affine-cn1", arm: "nebulosity", repeat: 1, toolSearch: false });
    });

    it("finds what stops the gate: a repo with no runs, and a question or session short of its scheduled repeats in an arm (I3)", () => {
        const expected = {
            repoIds: ["vscode", "affine"], arms: ["baseline", "nebulosity"], repeats: 2,
            questions: [{ id: "q1", repo: "vscode" }], sessions: [{ id: "s1", repo: "vscode" }],
        };
        const run = (name: string): RunResult => ({ ...result(name, { score: 1 }), repo: "vscode" });
        const have = [run("q1-baseline-1"), run("q1-baseline-2"), run("q1-nebulosity-1")];
        const sess = (arm: string, repeat: number): SessionResult => ({
            name: "x", session: "s1", repo: "vscode", arm, repeat, score: 1, pending: null, turns: [], costUsd: 0, wallMs: 0, firstCallContext: null, unknown: [], flags: [],
        });
        expect(missingForGate(expected, have, [sess("baseline", 1), sess("baseline", 2), sess("nebulosity", 1), sess("nebulosity", 2)])).toEqual([
            "no runs for the repo affine",
            "q1 (nebulosity): 1 of 2 runs",
        ]);
        // a repeat counted twice isn't two runs, and one past the schedule isn't one
        expect(missingForGate({ ...expected, repoIds: ["vscode"] }, [run("q1-baseline-1"), run("q1-baseline-1"), run("q1-nebulosity-1"), run("q1-nebulosity-3")], []))
            .toEqual(["q1 (baseline): 1 of 2 runs", "q1 (nebulosity): 1 of 2 runs", "session s1 (baseline): 0 of 2 runs", "session s1 (nebulosity): 0 of 2 runs"]);
        expect(missingForGate({ ...expected, repoIds: ["vscode"], sessions: [] }, [run("q1-baseline-1"), run("q1-baseline-2"), run("q1-nebulosity-1"), run("q1-nebulosity-2")], [])).toEqual([]);
    });

    it("expects a session's questions only through the session's runs, never as single runs (Task 14)", () => {
        const expected = {
            repoIds: ["vscode"], arms: ["baseline", "nebulosity"], repeats: 2,
            questions: [{ id: "q1", repo: "vscode" }, { id: "s1-impact", repo: "vscode", session: "s1" }, { id: "s1-chain", repo: "vscode", session: "s1" }],
            sessions: [{ id: "s1", repo: "vscode" }],
        };
        const run = (name: string): RunResult => ({ ...result(name, { score: 1 }), repo: "vscode" });
        const singles = [run("q1-baseline-1"), run("q1-baseline-2"), run("q1-nebulosity-1"), run("q1-nebulosity-2")];
        const sess = (arm: string, repeat: number): SessionResult => ({
            name: "x", session: "s1", repo: "vscode", arm, repeat, score: 1, pending: null, turns: [], costUsd: 0, wallMs: 0, firstCallContext: null, unknown: [], flags: [],
        });
        // q1 has its four single runs and s1 its four session runs: complete, with no single run of s1-impact or s1-chain
        expect(missingForGate(expected, singles, [sess("baseline", 1), sess("baseline", 2), sess("nebulosity", 1), sess("nebulosity", 2)])).toEqual([]);
        // a session short of a repeat is still missing, named as the session, and its questions still aren't asked for as single runs
        expect(missingForGate(expected, singles, [sess("baseline", 1), sess("baseline", 2), sess("nebulosity", 1)])).toEqual(["session s1 (nebulosity): 1 of 2 runs"]);
    });

    it("scores Eval #2 on the truth's own graph: a workspace import resolves, and Task 10's 'out' verdict removes a scanner edge (C1)", () => {
        const root = path.resolve("test/fixtures/arch-repo");
        const main = "src/app/main.ts", view = "src/editor/browser/editorView.ts", ui = "packages/ui/src/index.ts", button = "packages/ui/src/button.ts", log = "packages/core/src/log.ts";
        // main.ts imports "../editor/browser/editorView" and the workspace package "@arch/ui" (packages/ui/src/index.ts);
        // button.ts imports "@arch/core/lib/log" (packages/core/src/log.ts, through the lib → src mapping)
        const eval2 = repoScoreContext(root, "fx", false, [], []).ctx;
        expect(eval2.imports(main, view)).toBe(true);
        expect(eval2.imports(main, ui)).toBe(true);
        expect(eval2.imports(button, log)).toBe(true);
        expect(eval2.imports(view, main)).toBeNull();
        // Eval #1's scanner has no resolver: the workspace imports are unknown there
        const eval1 = repoScoreContext(root, "fx", true, [], []).ctx;
        expect(eval1.imports(main, view)).toBe(true);
        expect(eval1.imports(main, ui)).toBeNull();
        // Task 10's verdict format: "out" says main.ts does not import editorView.ts, "in" says view imports main
        const verdicts = [
            { repo: "fx", from: main, to: view, decision: "out" as const, why: "inside a string" },
            { repo: "fx", from: view, to: main, decision: "in" as const, why: "a computed import" },
            { repo: "other", from: main, to: ui, decision: "out" as const, why: "another repo's verdict" },
        ];
        const judged = repoScoreContext(root, "fx", false, [], verdicts).ctx;
        expect(judged.imports(main, view)).toBe(false);
        expect(judged.imports(view, main)).toBe(true);
        expect(judged.imports(main, ui)).toBe(true);
    });
});

// ---- pre-freeze sweep B

describe("grading-time step verdicts in steps.json (sweep B, item 9)", () => {
    const root = path.resolve("test/fixtures/arch-repo");
    // arrays.ts imports strings.ts alone (the arch-repo's edge table), so a model's arrays.ts → main.ts step is neither extractor's
    const arrays = "src/base/common/arrays.ts", main = "src/app/main.ts";
    const hallucinated = { repo: "fx", from: arrays, to: main, decision: "out", why: "arrays.ts imports only ./strings" };
    const evalDir = (files: Record<string, unknown>): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "score-verdicts-"));
        fs.mkdirSync(path.join(dir, "truth"));
        for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, "truth", name), JSON.stringify(value));
        return dir;
    };

    it("reads steps.json beside adjudicated.json, and applies an 'out' there to a step neither extractor finds", () => {
        const dir = evalDir({ "adjudicated.json": [], "steps.json": [hallucinated] });
        try{
            const { truth, steps } = loadScorerVerdicts(dir, ["fx"]);
            expect(truth).toEqual([]);
            expect(steps).toEqual([hallucinated]);
            expect(repoScoreContext(root, "fx", false, [], truth, steps).ctx.imports(arrays, main)).toBe(false);
            // without the verdict the step is unknown, and the run would wait for it
            expect(repoScoreContext(root, "fx", false, [], [], []).ctx.imports(arrays, main)).toBeNull();
        } finally{
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("has no step verdicts when steps.json is missing, and names steps.json in a problem with it", () => {
        const none = evalDir({ "adjudicated.json": [] });
        const bad = evalDir({ "adjudicated.json": [], "steps.json": [{ repo: "fx", from: arrays }] });
        try{
            expect(loadScorerVerdicts(none, ["fx"]).steps).toEqual([]);
            expect(() => loadScorerVerdicts(bad, ["fx"])).toThrow(/^steps\.json: /);
        } finally{
            for (const dir of [none, bad]) fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("the truth's own graph decides a step (sweep B, item 11)", () => {
    const root = path.resolve("test/fixtures/arch-repo");
    const main = "src/app/main.ts", view = "src/editor/browser/editorView.ts";

    it("takes an edge given both 'in' and 'out' in adjudicated.json as in, as applyAdjudications builds the truth's graph", () => {
        // applyAdjudications takes the outs away, then adds the ins: view → main ends up in the truth's graph
        const both = [
            { repo: "fx", from: view, to: main, decision: "in" as const, why: "read" },
            { repo: "fx", from: view, to: main, decision: "out" as const, why: "read again" },
        ];
        expect(repoScoreContext(root, "fx", false, [], both).ctx.imports(view, main)).toBe(true);
        // a lone "out" on a scanner edge is still a known "no", not an unknown step
        expect(repoScoreContext(root, "fx", false, [], [{ repo: "fx", from: main, to: view, decision: "out", why: "x" }]).ctx.imports(main, view)).toBe(false);
    });
});

describe("the steps to adjudicate, each with its repo (sweep B, item 12)", () => {
    it("collects the open steps of runs and sessions once per repo, sorted by repo, then step", () => {
        const runs = [
            result("cn1-baseline-1", { repo: "vscode", unknown: [A, E] }),
            result("cn2-nebulosity-1", { repo: "affine", unknown: [A, E] }),
            result("cn1-nebulosity-1", { repo: "vscode", unknown: [A, E] }),
            result("cn3-baseline-1", { repo: "vscode", unknown: null }),
        ];
        const session: SessionResult = {
            name: "s1-baseline-1", session: "s1", repo: "affine", arm: "baseline", repeat: 1, score: null, pending: "chain step to adjudicate", turns: [], costUsd: 0, wallMs: 0, firstCallContext: null, unknown: [[B, E]], flags: [],
        };
        expect(openSteps(runs, [session], (r) => r.repo!)).toEqual([
            { repo: "affine", step: [A, E] }, { repo: "affine", step: [B, E] }, { repo: "vscode", step: [A, E] },
        ]);
    });

    it("prints each step as <repo>: <from> → <to>, with the verdict to add to steps.json under it", () => {
        expect(renderAdjudicate([{ repo: "affine", step: [C, D] }, { repo: "vscode", step: [A, B] }], { firstEval: false, evalName: "eval2" })).toBe([
            "## Chain steps to adjudicate",
            "",
            "Read the source for each step, then add its verdict to eval2/truth/steps.json, the grading-time verdicts: \"decision\" is \"in\" when the first file imports the second and \"out\" when it doesn't, and \"why\" says what the source shows. The scorer reads steps.json after adjudicated.json; the truth builder never reads it, so the truths stay as they were approved.",
            "",
            `- affine: ${C} → ${D}`,
            `  {"repo": "affine", "from": "${C}", "to": "${D}", "decision": "", "why": ""}`,
            `- vscode: ${A} → ${B}`,
            `  {"repo": "vscode", "from": "${A}", "to": "${B}", "decision": "", "why": ""}`,
        ].join("\n"));
    });

    it("keeps Eval #1's own format", () => {
        expect(renderAdjudicate([{ repo: "vscode", step: [A, B] }], { firstEval: true, evalName: "eval" })).toBe([
            "## Chain steps to adjudicate",
            "",
            "Read the source for each step and add {\"from\", \"to\", \"imports\", \"note\"} (and \"repo\" when the step is one repo's alone) to eval/truth/adjudicated.json:",
            "",
            `- ${A} → ${B}`,
        ].join("\n"));
    });
});

describe("F1 lists count only what reads as a listed file (sweep B, item 10)", () => {
    const unusedQ: QuestionData = { id: "gu1", family: "grepHard", kind: "unused", truth: { id: "gu1", kind: "unused", folder: "src/vs", files: [A, B], verified: true, notes: [] } };

    it("doesn't count a lead-in that names the question's folder", () => {
        // without the rule: listed a, b and "src/vs" against a and b, precision 2/3, recall 1, F1 0.8
        const s = scoreAnswer(answer("Unused files in src/vs:", A, B), unusedQ, ctx);
        expect(s.score).toBe(1);
        expect(s.flags).toEqual([]);
    });

    it("doesn't count a slash-word", () => {
        const s = scoreAnswer(answer(A, B, "Neither is imported and/or loaded."), unusedQ, ctx);
        expect(s.score).toBe(1);
        expect(s.flags).not.toContain("names non-files");
    });

    it("doesn't count either folder of a violations question", () => {
        const q: QuestionData = { id: "gv1", family: "grepHard", kind: "violations", truth: { id: "gv1", kind: "violations", from: "src/vs", to: "src/base", files: [A], verified: true, notes: [] } };
        expect(scoreAnswer(answer("Files in src/vs that import src/base:", A), q, ctx).score).toBe(1);
    });

    it("leaves out the question's own folder even when its name has a dot, and still counts a file that isn't there", () => {
        const inside = "src/vs.old/a.ts";
        const dotted: ScoreContext = { ...ctx, known: new Set([...known, inside]) };
        const q: QuestionData = { id: "gu2", family: "grepHard", kind: "unused", truth: { id: "gu2", kind: "unused", folder: "src/vs.old", files: [inside], verified: true, notes: [] } };
        // listed a.ts (a hit) and gone.ts (not a file: a false positive): precision 1/2, recall 1, F1 2/3
        const s = scoreAnswer(answer("In src/vs.old:", inside, "src/vs.old/gone.ts"), q, dotted);
        expect(s.score).toBeCloseTo(2 / 3, 10);
        expect(s.flags).toContain("names non-files");
    });
});

describe("an entries answer that names its target (sweep B fix round 1, item 3)", () => {
    const roots = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => `src/vs/root${n}.ts`);
    const target = "src/vs/target.ts";
    const withRoots: ScoreContext = { ...ctx, known: new Set([...known, ...roots, target]) };
    const entriesQ = (files: string[]): QuestionData => ({ id: "ge1", family: "grepHard", kind: "entries", truth: { id: "ge1", kind: "entries", target, files, verified: true, notes: [] } });

    it("doesn't count the target named in a lead-in as a wrong entry: the 9 roots and the target is F1 1", () => {
        // without the rule: 10 listed, 9 right, precision 0.9, recall 1, F1 2·0.9/1.9 ≈ 0.947
        const s = scoreAnswer(answer(`The files that end up loading ${target}:`, ...roots), entriesQ(roots), withRoots);
        expect(s.score).toBe(1);
        expect(s.precision).toBe(1);
        expect(s.extra).toEqual([]);
    });

    it("still counts the target when the truth holds it", () => {
        // a hand-made truth that lists the target among its roots: listed and wanted alike, F1 1
        expect(scoreAnswer(answer(target, ...roots), entriesQ([target, ...roots]), withRoots).score).toBe(1);
    });
});

describe("a steps.json 'out' on an edge an approved truth rests on (sweep B fix round 1, item 4)", () => {
    // ctx's graph: a → b → c → d and a → x → b
    const graph = { files: [A, B, C, D, X], edges: EDGES };
    const chain = { id: "cn1", kind: "chain" as const, from: A, to: D, connected: true, shortest: 3, example: [A, B, C, D], verified: true, notes: [] };
    const direct = { id: "cl1", kind: "list" as const, target: D, scope: "direct" as const, files: [C], verified: true, notes: [] };
    const step = (from: string, to: string, decision: "in" | "out" = "out", repo = "r") => ({ repo, from, to, decision, why: "read" });

    it("names each such step with the truths that rest on it; an 'in', another repo's verdict or an edge no truth uses names nothing", () => {
        // cn1 rests on a → b, b → c and c → d; cl1 (direct importers of d) on c → d
        const steps = [step(B, C), step(C, D), step(A, X), step(B, C, "in"), step(B, C, "out", "other")];
        expect(stepsOnTruths(steps, "r", graph, [direct, chain])).toEqual([
            { repo: "r", from: B, to: C, truths: ["cn1"] },
            { repo: "r", from: C, to: D, truths: ["cl1", "cn1"] },
        ]);
    });

    it("prints them as a recheck of the truth", () => {
        expect(renderRecheck([{ repo: "r", from: C, to: D, truths: ["cl1", "cn1"] }], "eval2")).toBe([
            "## Truths to recheck",
            "",
            "A grading-time verdict in eval2/truth/steps.json says each step below is not an import, but an approved truth rests on it. Recheck the truth: it stays as approved until the owner rules on it.",
            "",
            `- r: ${C} → ${D}: recheck the truth (cl1, cn1)`,
        ].join("\n"));
    });
});

describe("scoreAnswer: Eval #3's call kinds and tasks", () => {
    const callersQ: QuestionData = {
        id: "vc1", family: "grepHard", kind: "callers",
        truth: { id: "vc1", kind: "callers", type: "IFoo", file: X, member: "save", within: null, files: [A, B], verified: true, notes: [] },
    };
    const taskQ: QuestionData = {
        id: "vt1", family: "grepHard", kind: "task",
        truth: { id: "vt1", kind: "task", type: "IFoo", file: X, member: "save", within: null, change: [A, B, X], tests: [C], verified: true, notes: [] },
    };

    it("scores a callers answer by F1 over files, with recall and precision beside it; a non-file counts as a wrong file", () => {
        const s = scoreAnswer(answer(A, C, "src/vs/gone.ts"), callersQ, ctx);
        // a, c and a non-file (3) against a and b: precision 1/3, recall 1/2, F1 = 2·(1/3)·(1/2) / (1/3 + 1/2) = 0.4
        expect(s.score).toBeCloseTo(0.4, 10);
        expect([s.recall, s.precision, s.hits, s.missed, s.flags]).toEqual([0.5, 1 / 3, 1, [B], ["names non-files"]]);
    });

    it("doesn't mark a callers answer down for naming its type's own file, as an entries answer may name its target", () => {
        expect(scoreAnswer(answer(`IFoo is declared in ${X}; its callers:`, A, B), callersQ, ctx).score).toBe(1);
    });

    it("scores a task as the mean of its two blocks' F1, each block reported", () => {
        const s = scoreAnswer(`Plan.\nANSWER CHANGE:\n${A}\n${B}\n${X}\nANSWER TESTS:\n${C}\n${D}`, taskQ, ctx);
        // CHANGE 3 of 3: F1 1; TESTS c and d against c: precision 1/2, recall 1, F1 2/3; the task 5/6
        expect(s.score).toBeCloseTo(5 / 6, 10);
        expect(s.parts).toEqual({
            change: { score: 1, recall: 1, precision: 1, missed: [], extra: [] },
            tests: { score: expect.closeTo(2 / 3, 10), recall: 1, precision: 0.5, missed: [], extra: [D] },
        });
        expect(s.flags).toEqual([]);
    });

    it("scores a missing block 0 and flags it; with neither block the task scores 0", () => {
        const s = scoreAnswer(`ANSWER CHANGE:\n${A}\n${B}\n${X}`, taskQ, ctx);
        expect([s.score, s.flags]).toEqual([0.5, ["no ANSWER TESTS: line"]]);
        expect(scoreAnswer("I'd change a few files.", taskQ, ctx).score).toBe(0);
    });

    it("puts the new kinds in the grep-hard family, each with its own row label", () => {
        for (const kind of ["callers", "breaks", "adopt", "injects", "task"] as const) expect(familyOfKind(kind)).toBe("grepHard");
    });
});
