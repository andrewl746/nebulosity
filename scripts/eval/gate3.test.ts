import { describe, expect, it } from "vitest";
import type { GateArm, QuestionKind } from "./gate";
import { gate3Verdict, type Gate3Run, type Gate3Session, type QuestionSet } from "./gate3";

const run = (question: string, kind: QuestionKind, set: QuestionSet, arm: GateArm, repeat: number, over: Partial<Gate3Run> = {}): Gate3Run => ({
    question, repo: "r1", kind, set, arm, repeat, score: 1, costUsd: 1, wallMs: 1000,
    nebulosityCalls: arm === "nebulosity" ? 1 : 0, firstCallContext: arm === "nebulosity" ? 22_000 : 20_000, refusals: 0, ...over,
});
const three = (question: string, kind: QuestionKind, set: QuestionSet, arm: GateArm, per: (i: number) => Partial<Gate3Run>): Gate3Run[] =>
    [1, 2, 3].map((i) => run(question, kind, set, arm, i, per(i)));
const sessions = (score: number): Gate3Session[] => (["baseline", "nebulosity"] as const).flatMap((arm) =>
    [1, 2, 3].map((repeat) => ({ session: "s1", repo: "r1", arm, repeat, score, costUsd: 1, wallMs: 1000, refusals: 0 })));

// q1 callers and q2 task are new; q3 big-picture; q4 one of Eval #2's chains
const good = (): Gate3Run[] => [
    ...three("q1", "callers", "new", "baseline", (i) => ({ ttrcMs: [100, 200, 300][i - 1], score: 0.8 })),
    ...three("q1", "callers", "new", "nebulosity", (i) => ({ ttrcMs: [20, 40, 60][i - 1], costUsd: 0.4, wallMs: 400 })),
    ...three("q2", "task", "new", "baseline", () => ({ ttrcMs: 1000, score: 0.6, costUsd: 2, wallMs: 2000 })),
    ...three("q2", "task", "new", "nebulosity", () => ({ ttrcMs: 100, score: 0.9, costUsd: 0.5, wallMs: 600 })),
    ...three("q3", "bigPicture", "bigPicture", "baseline", () => ({ score: 0.9, costUsd: 0.5 })),
    ...three("q3", "bigPicture", "bigPicture", "nebulosity", () => ({ score: 0.9, costUsd: 0.55 })),
    ...three("q4", "chain", "eval2", "baseline", () => ({})),
    ...three("q4", "chain", "eval2", "nebulosity", () => ({ costUsd: 0.5 })),
];
const byId = (v: ReturnType<typeof gate3Verdict>) => Object.fromEntries(v.conditions.map((c) => [c.id, c]));

describe("gate3Verdict (ADR-060)", () => {
    it("passes when every condition holds, with each condition's numbers", () => {
        const v = gate3Verdict(good(), sessions(0.9));
        const c = byId(v);
        expect(v.conditions.map((x) => [x.id, x.pass])).toEqual([["V", true], ["1", true], ["2", true], ["3", true], ["4", true], ["5", true], ["6", true]]);
        expect(v.pass).toBe(true);
        // V: 12 single runs and 3 sessions per arm, none refused
        expect(c.V.values).toEqual({ refusedA: 0, runsA: 15, shareA: 0, refusedN: 0, runsN: 15, shareN: 0 });
        // 1: q1 40 / 200 = 0.2, q2 100 / 1000 = 0.1; the median 0.15; a resample's median is 0.1, 0.15 or 0.2, so the interval is [0.1, 0.2]
        expect(c["1"].values).toEqual({ questions: 2, median: 0.15, low: 0.1, high: 0.2 });
        // 2: A's errors 0.2 x 3 and 0.4 x 3 (mean 0.3), N's 0 x 3 and 0.1 x 3 (0.05): 0.05 / 0.3 = 0.1667; the floor N 0.95 - A 0.7 = 0.25
        expect(c["2"].values).toEqual({ errorA: 0.3, errorN: 0.05, errorRatio: 0.1667, worstFloor: 0.25 });
        // 3: time 400 / 1000 = 0.4 and 600 / 2000 = 0.3, median 0.35; cost 0.4 / 1 = 0.4 and 0.5 / 2 = 0.25, median 0.325
        expect(c["3"].values).toEqual({ questions: 2, wallRatio: 0.35, costRatio: 0.325 });
        // 5: N's 9 runs on q1, q2 and q4 all called a tool; 6: 22,000 - 20,000
        expect(c["5"].values).toEqual({ share: 1, runs: 9, used: 9 });
        expect(c["6"].values).toEqual({ a: 20_000, n: 22_000, difference: 2_000 });
    });

    it("fails V on one refused run in fifteen, and says the comparison is confounded", () => {
        const runs = good().map((r) => (r.question === "q1" && r.arm === "baseline" && r.repeat === 1 ? { ...r, refusals: 2 } : r));
        const v = gate3Verdict(runs, sessions(0.9));
        expect([byId(v).V.pass, byId(v).V.values.shareA, v.pass]).toEqual([false, 0.0667, false]);
        expect(byId(v).V.text).toMatch(/the comparison is confounded/);
    });

    it("counts a question A never reached as 0 and one N rarely reached as infinitely slow", () => {
        const neverA = good().map((r) => (r.question === "q1" && r.arm === "baseline" ? { ...r, ttrcMs: null } : r));
        // q1 0 (A never), q2 0.1: median 0.05, interval [0, 0.1]
        expect(byId(gate3Verdict(neverA, sessions(0.9)))["1"].values).toEqual({ questions: 2, median: 0.05, low: 0, high: 0.1 });
        const rarelyN = good().map((r) => (r.question === "q2" && r.arm === "nebulosity" && r.repeat < 3 ? { ...r, ttrcMs: null } : r));
        // N's q2 median is infinite, so q2's ratio is; the median of 0.2 and infinity is infinite
        const c1 = byId(gate3Verdict(rarelyN, sessions(0.9)))["1"];
        expect([c1.pass, c1.values.median]).toEqual([false, Infinity]);
        expect(c1.text).toMatch(/median ratio infinite/);
    });

    it("fails 2 when N's errors are more than half of A's, the floor still holding", () => {
        const runs = good().map((r) => (r.question === "q2" && r.arm === "nebulosity" ? { ...r, score: 0.5 } : r));
        // N's errors 0 x 3 and 0.5 x 3: 0.25, against A's 0.3: 0.8333; the floor 0.75 - 0.7 = 0.05
        const c2 = byId(gate3Verdict(runs, sessions(0.9)))["2"];
        expect([c2.pass, c2.values]).toEqual([false, { errorA: 0.3, errorN: 0.25, errorRatio: 0.8333, worstFloor: 0.05 }]);
    });

    it("fails 1 and 3 on a repo with no new questions, and skips that repo's missing sets in 4", () => {
        const r2 = [...three("p1", "bigPicture", "bigPicture", "baseline", () => ({ repo: "r2" })), ...three("p1", "bigPicture", "bigPicture", "nebulosity", () => ({ repo: "r2" }))];
        const c = byId(gate3Verdict([...good(), ...r2], sessions(0.9)));
        expect([c["1"].pass, c["1"].scope, c["3"].pass, c["4"].pass]).toEqual([false, "r2", false, true]);
    });
});
