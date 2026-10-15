import { describe, expect, it } from "vitest";
import { gateVerdict, type GateRun, type GateSession } from "./gate";

const run = (question: string, kind: GateRun["kind"], arm: GateRun["arm"], score: number, costUsd: number, wallMs: number, nebulosityCalls: number, firstCallContext: number, repo = "r"): GateRun =>
    ({ question, repo, kind, arm, repeat: 1, score, costUsd, wallMs, nebulosityCalls, firstCallContext });
const session = (arm: GateSession["arm"], score: number, costUsd: number, wallMs: number): GateSession => ({ session: "s1", repo: "r", arm, repeat: 1, score, costUsd, wallMs });

// one repo; per kind one A run and one N run
const passing: GateRun[] = [
    run("g1", "impact", "baseline", 0.5, 0.40, 100_000, 0, 20_000), run("g1", "impact", "nebulosity", 0.9, 0.10, 20_000, 1, 21_500),
    run("g2", "cycle", "baseline", 0.5, 0.30, 80_000, 0, 20_000), run("g2", "cycle", "nebulosity", 1.0, 0.05, 10_000, 1, 21_500),
    run("c1", "chain", "baseline", 1.0, 0.10, 30_000, 0, 20_000), run("c1", "chain", "nebulosity", 1.0, 0.03, 9_000, 1, 21_500),
    run("l1", "list-direct", "baseline", 1.0, 0.08, 25_000, 0, 20_000), run("l1", "list-direct", "nebulosity", 1.0, 0.08, 24_000, 1, 21_500),
    run("b1", "bigPicture", "baseline", 0.9, 0.02, 13_000, 0, 20_000), run("b1", "bigPicture", "nebulosity", 0.9, 0.022, 13_000, 0, 21_500),
];
const sessions = [session("baseline", 0.8, 1.0, 300_000), session("nebulosity", 0.85, 0.4, 100_000)];
const find = (runs: GateRun[], id: string, s: GateSession[] = sessions) => gateVerdict(runs, s).conditions.find((c) => c.id === id)!;

describe("gateVerdict", () => {
    it("passes when every condition holds, and says each one's numbers", () => {
        const v = gateVerdict(passing, sessions);
        expect(v.conditions.map((c) => `${c.id} ${c.pass}`)).toEqual(["1 true", "2 true", "3a true", "3b true", "4 true", "5a true", "5b true"]);
        expect(v.pass).toBe(true);
        expect(v.conditions[0].values).toEqual({ a: 0.5, n: 0.95, margin: 0.45, worstQuestion: 0.4 });
    });

    it("fails 2 when a family drops by more than 0.03 on a repo", () => {
        const worse = passing.map((r) => (r.question === "b1" && r.arm === "nebulosity" ? { ...r, score: 0.85 } : r));
        expect(gateVerdict(worse, sessions).conditions.find((c) => c.id === "2")!.pass).toBe(false);
    });

    it("fails 5a when a graph run of N calls no Nebulosity tool", () => {
        const unused = passing.map((r) => (r.question === "l1" && r.arm === "nebulosity" ? { ...r, nebulosityCalls: 0 } : r));
        const c = gateVerdict(unused, sessions).conditions.find((x) => x.id === "5a")!;
        expect(c.values.share).toBeCloseTo(3 / 4, 10);
        expect(c.pass).toBe(false);
    });

    it("fails 5b when N's first call is more than 2,500 tokens above A's", () => {
        const heavy = passing.map((r) => (r.arm === "nebulosity" ? { ...r, firstCallContext: 22_600 } : r));
        expect(gateVerdict(heavy, sessions).conditions.find((c) => c.id === "5b")!.values).toEqual({ a: 20_000, n: 22_600, difference: 2_600 });
    });

    it("pools direct and transitive lists in condition 2 (F11): +0.05 and -0.05 with equal run counts is a difference of 0", () => {
        const lists: GateRun[] = [
            run("ld", "list-direct", "baseline", 0.9, 0.08, 25_000, 0, 20_000), run("ld", "list-direct", "nebulosity", 0.95, 0.08, 24_000, 1, 21_500),
            run("lt", "list-transitive", "baseline", 0.9, 0.08, 25_000, 0, 20_000), run("lt", "list-transitive", "nebulosity", 0.85, 0.04, 12_000, 1, 21_500),
        ];
        const c = find([...passing.filter((r) => r.question !== "l1"), ...lists], "2");
        expect(c.pass).toBe(true);
        // big-picture 0, lists (pooled) (0.95 + 0.85) / 2 against (0.9 + 0.9) / 2 = 0, chains 0: the worst is 0
        expect(c.values.difference).toBe(0);
    });

    it("fails 1 when the margin is under 0.15, or one grep-hard question is more than 0.05 below A", () => {
        const slim = passing.map((r) => (r.question === "g1" && r.arm === "nebulosity" ? { ...r, score: 0.6 } : r));
        // grep-hard: A 0.5, N (0.6 + 1.0) / 2 = 0.8 → margin 0.3, still passes
        expect(find(slim, "1").pass).toBe(true);
        const tiny = passing.map((r) => (r.question === "g1" && r.arm === "nebulosity" ? { ...r, score: 0.5 } : r.question === "g2" && r.arm === "nebulosity" ? { ...r, score: 0.6 } : r));
        // N (0.5 + 0.6) / 2 = 0.55 against A 0.5: margin 0.05
        expect(find(tiny, "1").pass).toBe(false);
        const loss = [
            ...passing.filter((r) => r.kind !== "impact"),
            run("g1", "impact", "baseline", 0.8, 0.4, 100_000, 0, 20_000), run("g1", "impact", "nebulosity", 0.7, 0.1, 20_000, 1, 21_500),
            run("g3", "pairs", "baseline", 0.2, 0.4, 100_000, 0, 20_000), run("g3", "pairs", "nebulosity", 1.0, 0.1, 20_000, 1, 21_500),
        ];
        // grep-hard pooled: A (0.8 + 0.5 + 0.2) / 3 = 0.5, N (0.7 + 1.0 + 1.0) / 3 = 0.9 → margin 0.4, but g1 is 0.1 below
        const c = find(loss, "1");
        expect(c.values.worstQuestion).toBeCloseTo(-0.1, 10);
        expect(c.pass).toBe(false);
    });

    it("fails 3a when N's median cost or wall time is over half of A's, and 3b when N costs more than 1.15 times A on the rest", () => {
        const dear = passing.map((r) => (r.kind === "chain" && r.arm === "nebulosity" ? { ...r, costUsd: 0.2 } : r));
        // graph costs: A [0.40, 0.30, 0.10] median 0.30; N [0.10, 0.05, 0.20] median 0.10 → 1/3, still passes
        expect(find(dear, "3a").pass).toBe(true);
        const slow = passing.map((r) => (r.arm === "nebulosity" && r.kind !== "bigPicture" ? { ...r, wallMs: 50_000 } : r));
        // wall: A [100, 80, 30] s median 80; N [50, 50, 50] median 50 → 0.625
        const c = find(slow, "3a");
        expect(c.pass).toBe(false);
        expect(c.values.wallRatio).toBeCloseTo(0.625, 10);
        const over = passing.map((r) => (r.kind === "bigPicture" && r.arm === "nebulosity" ? { ...r, costUsd: 0.04 } : r));
        // others: A [0.08, 0.02] median 0.05; N [0.08, 0.04] median 0.06 → 1.2
        const b = find(over, "3b");
        expect(b.values.ratio).toBeCloseTo(1.2, 10);
        expect(b.pass).toBe(false);
    });

    it("fails 4 on the sessions' cost, time or score", () => {
        expect(find(passing, "4", [session("baseline", 0.8, 1.0, 300_000), session("nebulosity", 0.85, 0.7, 100_000)]).pass).toBe(false);
        expect(find(passing, "4", [session("baseline", 0.8, 1.0, 300_000), session("nebulosity", 0.85, 0.4, 200_000)]).pass).toBe(false);
        expect(find(passing, "4", [session("baseline", 0.8, 1.0, 300_000), session("nebulosity", 0.76, 0.4, 100_000)]).pass).toBe(false);
        expect(find(passing, "4", [session("baseline", 0.8, 1.0, 300_000), session("nebulosity", 0.78, 0.6, 180_000)]).pass).toBe(true);
    });

    it("checks each repo apart: one repo's loss fails the condition and names it", () => {
        const other = passing.map((r) => ({ ...r, repo: "q", score: r.question === "b1" && r.arm === "nebulosity" ? 0.5 : r.score }));
        const c = find([...passing, ...other], "2");
        expect(c.pass).toBe(false);
        expect(c.scope).toContain("q");
        expect(c.values.difference).toBeCloseTo(-0.4, 10);
    });

    it("never passes on no data: a condition with nothing to compare fails", () => {
        const v = gateVerdict([], []);
        expect(v.conditions.map((c) => c.pass)).toEqual([false, false, false, false, false, false, false]);
        expect(v.pass).toBe(false);
    });

    it("takes a median of an even count as the mean of the two middle values", () => {
        const two = [
            run("c1", "chain", "baseline", 1, 0.10, 40_000, 0, 1), run("c2", "chain", "baseline", 1, 0.30, 80_000, 0, 1),
            run("c1", "chain", "nebulosity", 1, 0.10, 20_000, 1, 1), run("c2", "chain", "nebulosity", 1, 0.10, 20_000, 1, 1),
        ];
        const c = find(two, "3a");
        // A cost median (0.10 + 0.30) / 2 = 0.20 against N's 0.10 → 0.5, which the limit allows; A wall median 60 s against N's 20 s
        expect(c.values.costRatio).toBeCloseTo(0.5, 10);
        expect(c.pass).toBe(true);
    });
});
