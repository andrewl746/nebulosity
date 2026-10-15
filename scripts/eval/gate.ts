/**
 * The ship gate (V1.6 plan, D1): seven conditions computed from Eval #2's scored runs. Nothing ships unless every one holds.
 * Arm A is Claude Code alone, arm N is Claude Code with Nebulosity. The definitions below are D1's, word for word:
 *   1  better where it should matter: N's mean >= A's mean + 0.15 over the grep-hard runs of every repo pooled, and no
 *      grep-hard question where N's mean is below A's by more than 0.05
 *   2  no losses elsewhere: N's mean >= A's mean - 0.03, for each repo x each of big-picture, lists and chains. "Lists"
 *      pools the direct and the transitive lists together (as Eval #1's "lists" family did): a repo's list runs are one set
 *   3a efficiency on graph questions: N's median cost <= 0.5 x A's and N's median wall time <= 0.5 x A's, for each repo's
 *      chain, transitive-list and grep-hard runs
 *   3b no overhead elsewhere: N's median cost <= 1.15 x A's, for each repo's big-picture and direct-list runs
 *   4  sessions: N's cost <= 0.6 x A's, N's time <= 0.6 x A's, N's mean session score >= A's - 0.03, for each repo
 *   5a tools used: the share of N's list, chain and grep-hard runs that call a Nebulosity tool >= 0.90
 *   5b cheaply: N's median first-call context - A's <= 2,500 tokens, for each repo's single runs
 * Means and medians run over every matching run (a median of an even count is the mean of the two middle values). A condition
 * that is per repo fails when any repo fails, and reports the numbers of the worst repo. A family with no runs for both arms
 * on a repo is not compared there; a condition with nothing to compare fails (the gate never passes on no data).
 * For sessions "cost" and "time" are the totals over a repo's session runs of each arm, as D1 says; score.ts computes the gate only
 * on complete data, so both arms have the same number of sessions. Values are rounded to 4 decimal places.
 */

export type QuestionKind = "bigPicture" | "list-direct" | "list-transitive" | "chain" | "impact" | "cycle" | "unused" | "violations" | "entries" | "pairs";
export const GREP_HARD: readonly QuestionKind[] = ["impact", "cycle", "unused", "violations", "entries", "pairs"];
export const GRAPH: readonly QuestionKind[] = ["chain", "list-transitive", ...GREP_HARD];
export const OTHER: readonly QuestionKind[] = ["bigPicture", "list-direct"];
const LISTS: readonly QuestionKind[] = ["list-direct", "list-transitive"];
const USED: readonly QuestionKind[] = ["list-direct", "list-transitive", "chain", ...GREP_HARD];

export type GateArm = "baseline" | "nebulosity";
export type GateRun = {
    question: string; repo: string; kind: QuestionKind; arm: GateArm; repeat: number;
    score: number; costUsd: number; wallMs: number; nebulosityCalls: number; firstCallContext: number | null;
};
export type GateSession = { session: string; repo: string; arm: GateArm; repeat: number; score: number; costUsd: number; wallMs: number };

export type ConditionId = "1" | "2" | "3a" | "3b" | "4" | "5a" | "5b";
export type Condition = { id: ConditionId; scope: string; values: Record<string, number>; pass: boolean; text: string };
export type Verdict = { pass: boolean; conditions: Condition[] };

const EPS = 1e-9;
/** Rounded to 4 decimal places; "+ 0" turns -0 into 0. */
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4 + 0;
const roundAll = (values: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, r4(v)]));
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
function median(xs: readonly number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const ratio = (n: number, a: number): number => (a === 0 ? (n === 0 ? 0 : Infinity) : n / a);
const repos = (xs: readonly { repo: string }[]): string[] => [...new Set(xs.map((x) => x.repo))].sort();
const kinds = (set: readonly QuestionKind[]) => (r: GateRun): boolean => set.includes(r.kind);
const arm = (a: GateArm) => <T extends { arm: GateArm }>(xs: readonly T[]): T[] => xs.filter((x) => x.arm === a);
const A = arm("baseline");
const N = arm("nebulosity");
const usd = (x: number): string => `$${x.toFixed(4)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
/** The numbers in the sentences print 4 decimal places, as the values are rounded to. */
const n2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(4) : "infinite");

/** One thing compared on one repo: how far it is from its limit (negative: over it), and the numbers. */
type Unit = { scope: string; slack: number; values: Record<string, number>; text: string };

/** A per-repo condition: it passes when every unit has slack, reports the worst unit's numbers, and fails with no units. */
function perUnit(id: ConditionId, units: Unit[], rule: string, nothing: string): Condition {
    if (units.length === 0) return { id, scope: "no runs to compare", values: {}, pass: false, text: `${rule}: ${nothing}.` };
    const worst = units.reduce((w, u) => (u.slack < w.slack ? u : w));
    const pass = units.every((u) => u.slack >= -EPS);
    return { id, scope: worst.scope, values: roundAll(worst.values), pass, text: `${rule}: ${worst.text}${pass ? "" : ` (fails on ${worst.scope})`}.` };
}

function condition1(runs: readonly GateRun[]): Condition {
    const rule = "Better where it should matter: N's grep-hard mean at least A's + 0.15, and no grep-hard question more than 0.05 below A";
    const hard = runs.filter(kinds(GREP_HARD));
    const [a, n] = [A(hard), N(hard)];
    if (a.length === 0 || n.length === 0) return { id: "1", scope: "grep-hard runs, all repos pooled", values: {}, pass: false, text: `${rule}: no grep-hard runs of both arms.` };
    const [aMean, nMean] = [mean(a.map((r) => r.score)), mean(n.map((r) => r.score))];
    const byQuestion = new Map<string, GateRun[]>();
    for (const r of hard) byQuestion.set(`${r.repo}\u0000${r.question}`, [...(byQuestion.get(`${r.repo}\u0000${r.question}`) ?? []), r]);
    const margins = [...byQuestion.entries()].filter(([, rs]) => A(rs).length > 0 && N(rs).length > 0)
        .map(([key, rs]) => ({ key, margin: mean(N(rs).map((r) => r.score)) - mean(A(rs).map((r) => r.score)) }));
    const worst = margins.length === 0 ? null : margins.reduce((w, m) => (m.margin < w.margin ? m : w));
    const margin = nMean - aMean;
    const pass = margin >= 0.15 - EPS && worst !== null && worst.margin >= -0.05 - EPS;
    const values = roundAll({ a: aMean, n: nMean, margin, worstQuestion: worst?.margin ?? NaN });
    return {
        id: "1", scope: "grep-hard runs, all repos pooled", values, pass,
        text: `${rule}: A ${n2(aMean)}, N ${n2(nMean)}, margin ${n2(margin)} (needs 0.1500); the worst question is ${n2(worst?.margin ?? NaN)} from A${worst ? ` (${worst.key.replace("\u0000", " ")})` : ""} (needs at least -0.05).`,
    };
}

function condition2(runs: readonly GateRun[]): Condition {
    const rule = "No losses elsewhere: N's mean at least A's - 0.03 for each repo and each of big-picture, lists (direct and transitive pooled) and chains";
    const families: [string, readonly QuestionKind[]][] = [["big-picture", ["bigPicture"]], ["lists (direct and transitive pooled)", LISTS], ["chains", ["chain"]]];
    const units: Unit[] = [];
    for (const repo of repos(runs)) for (const [name, set] of families){
        const own = runs.filter((r) => r.repo === repo && set.includes(r.kind));
        if (A(own).length === 0 || N(own).length === 0) continue;
        const [a, n] = [mean(A(own).map((r) => r.score)), mean(N(own).map((r) => r.score))];
        units.push({ scope: `${repo}, ${name}`, slack: n - a + 0.03, values: { a, n, difference: n - a }, text: `A ${n2(a)}, N ${n2(n)}, difference ${n2(n - a)} on ${repo}, ${name} (needs at least -0.03)` });
    }
    return perUnit("2", units, rule, "no big-picture, list or chain runs of both arms");
}

function condition3a(runs: readonly GateRun[]): Condition {
    const rule = "Efficiency on graph questions: N's median cost and wall time each at most half of A's, for each repo's chain, transitive-list and grep-hard runs";
    const units: Unit[] = [];
    for (const repo of repos(runs)){
        const own = runs.filter((r) => r.repo === repo && GRAPH.includes(r.kind));
        if (A(own).length === 0 || N(own).length === 0) continue;
        const [costA, costN] = [median(A(own).map((r) => r.costUsd)), median(N(own).map((r) => r.costUsd))];
        const [wallA, wallN] = [median(A(own).map((r) => r.wallMs)), median(N(own).map((r) => r.wallMs))];
        const [costRatio, wallRatio] = [ratio(costN, costA), ratio(wallN, wallA)];
        units.push({
            scope: repo, slack: Math.min(0.5 - costRatio, 0.5 - wallRatio), values: { costA, costN, costRatio, wallA, wallN, wallRatio },
            text: `median cost A ${usd(costA)}, N ${usd(costN)} (${n2(costRatio)} of A's), median wall A ${secs(wallA)}, N ${secs(wallN)} (${n2(wallRatio)} of A's) on ${repo} (each needs at most 0.50)`,
        });
    }
    return perUnit("3a", units, rule, "no chain, transitive-list or grep-hard runs of both arms");
}

function condition3b(runs: readonly GateRun[]): Condition {
    const rule = "No overhead elsewhere: N's median cost at most 1.15 times A's, for each repo's big-picture and direct-list runs";
    const units: Unit[] = [];
    for (const repo of repos(runs)){
        const own = runs.filter((r) => r.repo === repo && OTHER.includes(r.kind));
        if (A(own).length === 0 || N(own).length === 0) continue;
        const [costA, costN] = [median(A(own).map((r) => r.costUsd)), median(N(own).map((r) => r.costUsd))];
        const r = ratio(costN, costA);
        units.push({ scope: repo, slack: 1.15 - r, values: { costA, costN, ratio: r }, text: `median cost A ${usd(costA)}, N ${usd(costN)} (${n2(r)} of A's) on ${repo} (needs at most 1.15)` });
    }
    return perUnit("3b", units, rule, "no big-picture or direct-list runs of both arms");
}

function condition4(sessions: readonly GateSession[]): Condition {
    const rule = "Sessions: N's cost and time each at most 0.6 of A's, and N's mean score at least A's - 0.03, for each repo's task-session runs";
    const units: Unit[] = [];
    for (const repo of repos(sessions)){
        const own = sessions.filter((s) => s.repo === repo);
        if (A(own).length === 0 || N(own).length === 0) continue;
        // D1: the totals over the repo's session runs of each arm (the data is complete when the gate runs: equal counts)
        const total = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
        const [costA, costN] = [total(A(own).map((s) => s.costUsd)), total(N(own).map((s) => s.costUsd))];
        const [wallA, wallN] = [total(A(own).map((s) => s.wallMs)), total(N(own).map((s) => s.wallMs))];
        const [scoreA, scoreN] = [mean(A(own).map((s) => s.score)), mean(N(own).map((s) => s.score))];
        const [costRatio, wallRatio] = [ratio(costN, costA), ratio(wallN, wallA)];
        units.push({
            scope: repo, slack: Math.min(0.6 - costRatio, 0.6 - wallRatio, scoreN - scoreA + 0.03),
            values: { costA, costN, costRatio, wallA, wallN, wallRatio, scoreA, scoreN, scoreDifference: scoreN - scoreA },
            text: `total cost A ${usd(costA)}, N ${usd(costN)} (${n2(costRatio)} of A's), total time A ${secs(wallA)}, N ${secs(wallN)} (${n2(wallRatio)} of A's), score A ${n2(scoreA)}, N ${n2(scoreN)} on ${repo} (cost and time need at most 0.60; score at least -0.03)`,
        });
    }
    return perUnit("4", units, rule, "no sessions of both arms");
}

function condition5a(runs: readonly GateRun[]): Condition {
    const rule = "Tools used: the share of N's list, chain and grep-hard runs that call a Nebulosity tool is at least 0.90 (both repos)";
    const own = N(runs.filter(kinds(USED)));
    if (own.length === 0) return { id: "5a", scope: "all repos", values: {}, pass: false, text: `${rule}: no such N runs.` };
    const used = own.filter((r) => r.nebulosityCalls > 0).length;
    const share = used / own.length;
    return { id: "5a", scope: "all repos", values: roundAll({ share, runs: own.length, used }), pass: share >= 0.9 - EPS, text: `${rule}: ${used} of ${own.length} (${n2(share)}).` };
}

function condition5b(runs: readonly GateRun[]): Condition {
    const rule = "Cheaply: N's median first-call context at most 2,500 tokens above A's, for each repo's single runs";
    const units: Unit[] = [];
    for (const repo of repos(runs)){
        const own = runs.filter((r) => r.repo === repo && r.firstCallContext !== null);
        if (A(own).length === 0 || N(own).length === 0) continue;
        const [a, n] = [median(A(own).map((r) => r.firstCallContext as number)), median(N(own).map((r) => r.firstCallContext as number))];
        units.push({ scope: repo, slack: 2500 - (n - a), values: { a, n, difference: n - a }, text: `median first call A ${Math.round(a).toLocaleString("en-US")}, N ${Math.round(n).toLocaleString("en-US")}, ${n - a >= 0 ? "+" : ""}${Math.round(n - a).toLocaleString("en-US")} tokens on ${repo} (needs at most +2,500)` });
    }
    return perUnit("5b", units, rule, "no runs with a first call of both arms");
}

/** D1's seven conditions over the scored runs and sessions, in D1's order; `pass` is all seven. */
export function gateVerdict(runs: readonly GateRun[], sessions: readonly GateSession[]): Verdict {
    const conditions = [condition1(runs), condition2(runs), condition3a(runs), condition3b(runs), condition4(sessions), condition5a(runs), condition5b(runs)];
    return { pass: conditions.every((c) => c.pass), conditions };
}
