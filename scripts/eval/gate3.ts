/**
 * Eval #3's ship gate (ADR-060; D1 of V1.7's plan, approved 2026-10-15 and fixed before any run): V and conditions 1-6
 * over the scored runs of arms A (Claude Code alone) and N (with Nebulosity). Every one must hold. Questions fall in three
 * sets: "new" (the DI, task and Theia graph questions), "eval2" (Eval #2's graph questions, reused unchanged) and
 * "bigPicture" (Eval #2's and the new ones). A ratio is per question (N's median over A's), then the median over the set's
 * questions; intervals resample questions. Means run over runs. A per-repo condition fails when any repo fails, and
 * reports the worst repo. A condition with nothing to compare fails. Values are compared unrounded (1e-9) and rounded to
 * 4 decimal places. Eval #2's gate (gate.ts, the V1.6 plan's D1) is untouched: Eval #2 keeps it.
 */
import { median as medianOf, bootstrapMedianInterval, ratioOfMedians, ratioOfPlainMedians } from "./stats";
import type { GateArm, GateRun, GateSession, QuestionKind } from "./gate";

export type QuestionSet = "new" | "eval2" | "bigPicture";
/** A single run as the gate takes it: Eval #2's gate's fields (GateRun), its question's set, its refused calls, and its TTRC from process start (null: never reached; absent: its question has no needed set). */
export type Gate3Run = GateRun & { set: QuestionSet; refusals: number; ttrcMs?: number | null };
export type Gate3Session = GateSession & { refusals: number };
export type Gate3Id = "V" | "1" | "2" | "3" | "4" | "5" | "6";
export type Gate3Condition = { id: Gate3Id; scope: string; values: Record<string, number>; pass: boolean; text: string };
export type Gate3Verdict = { pass: boolean; conditions: Gate3Condition[] };

/** The kinds whose truth is a set of files, the scope of TTRC (D2). */
export const FILE_SET_KINDS: readonly QuestionKind[] = ["callers", "breaks", "adopt", "injects", "task", "list-direct", "list-transitive", "chain", "cycle", "unused", "violations", "entries"];
/** Condition 3's kinds. */
export const DI_AND_TASK: readonly QuestionKind[] = ["callers", "breaks", "adopt", "injects", "task"];

const EPS = 1e-9;
const r4 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 + 0 : x);
const roundAll = (values: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, r4(v)]));
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const ratio = (n: number, a: number): number => (a === 0 ? (n === 0 ? 0 : Infinity) : n / a);
const n4 = (x: number): string => (Number.isFinite(x) ? x.toFixed(4) : "infinite");
const A = <T extends { arm: GateArm }>(xs: readonly T[]): T[] => xs.filter((x) => x.arm === "baseline");
const N = <T extends { arm: GateArm }>(xs: readonly T[]): T[] => xs.filter((x) => x.arm === "nebulosity");
const repos = (xs: readonly { repo: string }[]): string[] => [...new Set(xs.map((x) => x.repo))].sort();

/** The questions of a set of runs that have runs of both arms, each with its A and N runs, in question order. */
function paired(runs: readonly Gate3Run[]): { question: string; a: Gate3Run[]; n: Gate3Run[] }[] {
    const ids = [...new Set(runs.map((r) => r.question))].sort();   // by id, so the seeded bootstrap draws the same way however the runs were loaded
    return ids.map((question) => ({ question, a: A(runs).filter((r) => r.question === question), n: N(runs).filter((r) => r.question === question) }))
        .filter((q) => q.a.length > 0 && q.n.length > 0);
}

type Unit = { scope: string; slack: number; values: Record<string, number>; text: string };

function perUnit(id: Gate3Id, units: Unit[], rule: string, nothing: string): Gate3Condition {
    if (units.length === 0) return { id, scope: "no runs to compare", values: {}, pass: false, text: `${rule}: ${nothing}.` };
    const worst = units.reduce((w, u) => (u.slack < w.slack ? u : w));
    const pass = units.every((u) => u.slack >= -EPS);
    return { id, scope: worst.scope, values: roundAll(worst.values), pass, text: `${rule}: ${worst.text}${pass ? "" : ` (fails on ${worst.scope})`}.` };
}

function conditionV(runs: readonly Gate3Run[], sessions: readonly Gate3Session[]): Gate3Condition {
    const rule = "Valid: at most 5% of each arm's runs have a refused command";
    const count = (arm: GateArm) => {
        const all = [...runs.filter((r) => r.arm === arm), ...sessions.filter((s) => s.arm === arm)];
        const refused = all.filter((r) => r.refusals > 0).length;
        return { refused, runs: all.length, share: all.length === 0 ? Infinity : refused / all.length };
    };
    const [a, n] = [count("baseline"), count("nebulosity")];
    const pass = a.share <= 0.05 + EPS && n.share <= 0.05 + EPS;
    return {
        id: "V", scope: "every run, each arm", pass,
        values: roundAll({ refusedA: a.refused, runsA: a.runs, shareA: a.share, refusedN: n.refused, runsN: n.runs, shareN: n.share }),
        text: `${rule}: A ${a.refused} of ${a.runs} (${n4(a.share)}), N ${n.refused} of ${n.runs} (${n4(n.share)}) (each needs at most 0.05)${pass ? "" : "; the comparison is confounded"}.`,
    };
}

function condition1(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "4x faster to the relevant context: the median per-question TTRC ratio at most 0.25 and its 95% interval's upper end at most 0.50, for each repo's new file-set questions";
    const units = repos(runs).map((repo): Unit => {
        const own = runs.filter((r) => r.repo === repo && r.set === "new" && FILE_SET_KINDS.includes(r.kind) && r.ttrcMs !== undefined);
        const ratios = paired(own).map((q) => ratioOfMedians(q.a.map((r) => r.ttrcMs ?? null), q.n.map((r) => r.ttrcMs ?? null)));
        if (ratios.length === 0) return { scope: repo, slack: -Infinity, values: {}, text: `no new file-set questions with a needed set on ${repo}` };
        const m = medianOf(ratios);
        const [low, high] = bootstrapMedianInterval(ratios);
        return {
            scope: repo, slack: Math.min(0.25 - m, 0.5 - high), values: { questions: ratios.length, median: m, low, high },
            text: `${ratios.length} questions, median ratio ${n4(m)}, 95% interval ${n4(low)} to ${n4(high)} on ${repo} (needs at most 0.25, and at most 0.50 for the upper end)`,
        };
    });
    return perUnit("1", units, rule, "no runs");
}

function condition2(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Half the errors: N's mean error at most half of A's over every repo's new questions, and N's mean at least A's - 0.02 on each repo";
    const own = runs.filter((r) => r.set === "new");
    if (A(own).length === 0 || N(own).length === 0) return { id: "2", scope: "new questions, all repos pooled", values: {}, pass: false, text: `${rule}: no new questions of both arms.` };
    const [errorA, errorN] = [mean(A(own).map((r) => 1 - r.score)), mean(N(own).map((r) => 1 - r.score))];
    const floors = repos(runs).map((repo) => {
        const mine = own.filter((r) => r.repo === repo);
        const difference = A(mine).length === 0 || N(mine).length === 0 ? -Infinity : mean(N(mine).map((r) => r.score)) - mean(A(mine).map((r) => r.score));
        return { repo, difference };
    });
    const worst = floors.reduce((w, f) => (f.difference < w.difference ? f : w));
    const errorRatio = ratio(errorN, errorA);
    const pass = errorN <= 0.5 * errorA + EPS && worst.difference >= -0.02 - EPS;
    return {
        id: "2", scope: "new questions, all repos pooled; the floor per repo", pass,
        values: roundAll({ errorA, errorN, errorRatio, worstFloor: worst.difference }),
        text: `${rule}: mean error A ${n4(errorA)}, N ${n4(errorN)} (${n4(errorRatio)} of A's, needs at most 0.50); the lowest repo is ${worst.repo} at ${n4(worst.difference)} from A (needs at least -0.02).`,
    };
}

function condition3(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Faster and cheaper end to end: the median per-question ratio of time and of cost each at most 0.50, for each repo's DI and task questions";
    const units = repos(runs).map((repo): Unit => {
        const qs = paired(runs.filter((r) => r.repo === repo && r.set === "new" && DI_AND_TASK.includes(r.kind)));
        if (qs.length === 0) return { scope: repo, slack: -Infinity, values: {}, text: `no DI or task questions on ${repo}` };
        const wallRatio = medianOf(qs.map((q) => ratioOfPlainMedians(q.a.map((r) => r.wallMs), q.n.map((r) => r.wallMs))));
        const costRatio = medianOf(qs.map((q) => ratioOfPlainMedians(q.a.map((r) => r.costUsd), q.n.map((r) => r.costUsd))));
        return {
            scope: repo, slack: Math.min(0.5 - wallRatio, 0.5 - costRatio), values: { questions: qs.length, wallRatio, costRatio },
            text: `${qs.length} questions, median time ratio ${n4(wallRatio)}, median cost ratio ${n4(costRatio)} on ${repo} (each needs at most 0.50)`,
        };
    });
    return perUnit("3", units, rule, "no runs");
}

function condition4(runs: readonly Gate3Run[], sessions: readonly Gate3Session[]): Gate3Condition {
    const rule = "No loss elsewhere: big-picture N at least A - 0.03 with a cost ratio at most 1.15; Eval #2's graph questions N at least A - 0.03 with a cost ratio at most 1.0; the session N at least A - 0.03; each repo where it has them";
    const units: Unit[] = [];
    for (const repo of repos([...runs, ...sessions])){
        for (const [set, name, bar] of [["bigPicture", "big-picture", 1.15], ["eval2", "Eval #2's graph questions", 1.0]] as const){
            const own = runs.filter((r) => r.repo === repo && r.set === set);
            const qs = paired(own);
            if (qs.length === 0) continue;
            const difference = mean(N(own).map((r) => r.score)) - mean(A(own).map((r) => r.score));
            const costRatio = medianOf(qs.map((q) => ratioOfPlainMedians(q.a.map((r) => r.costUsd), q.n.map((r) => r.costUsd))));
            units.push({
                scope: `${repo}, ${name}`, slack: Math.min(difference + 0.03, bar - costRatio), values: { difference, costRatio },
                text: `score difference ${n4(difference)}, median cost ratio ${n4(costRatio)} on ${repo}, ${name} (needs at least -0.03, and at most ${bar.toFixed(2)})`,
            });
        }
        const own = sessions.filter((s) => s.repo === repo);
        if (A(own).length > 0 && N(own).length > 0){
            const difference = mean(N(own).map((s) => s.score)) - mean(A(own).map((s) => s.score));
            units.push({ scope: `${repo}, the session`, slack: difference + 0.03, values: { difference }, text: `session score difference ${n4(difference)} on ${repo} (needs at least -0.03)` });
        }
    }
    return perUnit("4", units, rule, "no big-picture, Eval #2 or session runs of both arms");
}

function condition5(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Tools used: at least 0.90 of N's runs on new and graph questions call a Nebulosity tool (all repos)";
    const own = N(runs.filter((r) => r.set === "new" || r.set === "eval2"));
    if (own.length === 0) return { id: "5", scope: "all repos", values: {}, pass: false, text: `${rule}: no such N runs.` };
    const used = own.filter((r) => r.nebulosityCalls > 0).length;
    const share = used / own.length;
    return { id: "5", scope: "all repos", values: roundAll({ share, runs: own.length, used }), pass: share >= 0.9 - EPS, text: `${rule}: ${used} of ${own.length} (${n4(share)}).` };
}

function condition6(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Cheap per turn: N's median first-call context at most 2,500 tokens above A's, for each repo";
    const units: Unit[] = [];
    for (const repo of repos(runs)){
        const own = runs.filter((r) => r.repo === repo && r.firstCallContext !== null);
        if (A(own).length === 0 || N(own).length === 0) continue;
        const [a, n] = [medianOf(A(own).map((r) => r.firstCallContext as number)), medianOf(N(own).map((r) => r.firstCallContext as number))];
        units.push({ scope: repo, slack: 2500 - (n - a), values: { a, n, difference: n - a }, text: `median first call A ${Math.round(a).toLocaleString("en-US")}, N ${Math.round(n).toLocaleString("en-US")}, ${n - a >= 0 ? "+" : ""}${Math.round(n - a).toLocaleString("en-US")} tokens on ${repo} (needs at most +2,500)` });
    }
    return perUnit("6", units, rule, "no runs with a first call of both arms");
}

/** V and conditions 1-6, in that order; `pass` is all seven. */
export function gate3Verdict(runs: readonly Gate3Run[], sessions: readonly Gate3Session[]): Gate3Verdict {
    const conditions = [conditionV(runs, sessions), condition1(runs), condition2(runs), condition3(runs), condition4(runs, sessions), condition5(runs), condition6(runs)];
    return { pass: conditions.every((c) => c.pass), conditions };
}
