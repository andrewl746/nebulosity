/**
 * npm run eval:score [-- --only bp4,cl2,... --runs <dir> --out <file>]
 *
 * The eval's scorer (D2, R4 in docs/plans/2026-10-13-v1-5-ship.md). It reads eval/questions.json, each question's truth
 * (eval/truth) or rubric (eval/rubric), eval/truth/adjudicated.json, the rubric grades (eval/grading/grades.json, once
 * Task 19 writes them) and the kept runs (eval/runs/*.jsonl.gz, with the index line for each), and scores every run:
 *   lists:        recall against the truth (precision reported beside it)
 *   chains:       1 for a valid chain of the shortest length or a right "none", 0.5 for a valid longer one, 0 otherwise.
 *                 A step is real by eval/truth/adjudicated.json (reading the source beats the scanner, either way), else
 *                 when the scanner has the edge, else unknown
 *   big-picture:  the mean of the grades over the rubric points that hold (not scored until the grades exist)
 * Eval #2's kinds (V1.6, D2) are scored from the question's truth the same way: impact counts (the mean over the lines of
 * 1 - the relative error), cycles (1 / 0.5 / 0), unused, violations and entries lists (F1) and pairs (F1). A run or a session
 * message that hit its turn or budget limit scores 0. Task sessions (the runs whose index line has a `session`) are scored
 * message by message against the questions they asked, and a session's score is the mean of its messages'. For an eval
 * with several repos or kinds the scorer also prints the tables per repo and kind, the sessions, and the ship gate
 * (scripts/eval/gate.ts, D1); each run is scored against its own repo's graph and truth only.
 * It prints the Markdown tables Task 20 uses and writes eval/results.json (not under --only, not for zero runs, and with
 * --runs but no --out to a temp file, never over the real one).
 *
 * It exits 1 while any chain step is unknown, printing each `a → b` to adjudicate by reading the source, or when it can't
 * run at all (a missing file, ../vscode not at the commit the questions are for). It also lists the scanner-only steps
 * of the scored chains that the truth's own chain doesn't have, to be read too; those are scored as imports, so they
 * don't stop it. With no runs it prints empty tables and exits 0, without scanning ../vscode.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { buildRepoGraphs, EVAL1, parseAdjudications, type Adjudication, type ChainTruthFile, type CycleTruthFile, type ImpactTruthFile, type ListTruthFile, type PairsTruthFile, type TruthFile } from "./build-truth";
import { answerSection, checkCycle, extractPaths, f1, isNone, scoreChain, scoreCounts, scoreList, scorePairs } from "./answer";
import { loadDefinition } from "./definition";
import { gateVerdict, type GateRun, type GateSession, type QuestionKind, type Verdict } from "./gate";
import type { Arm, RunId } from "./run-config";
import { scanRepo } from "./scan";
import { summarizeSession, type SessionDef, type SessionFile, type SessionSummary } from "./session";
import { summarizeRun, type RunSummary } from "./transcript";

export type Family = "bigPicture" | "list" | "chain" | "grepHard";
export type Rubric = { id: string; source: string; points: { id: string; text: string; check: string; holds: boolean | null; note: string }[] };
export type QuestionData = { id: string; family: Family; kind?: QuestionKind; truth?: TruthFile; rubric?: Rubric };
/** `repo` limits a verdict to one repo of the eval; without it the verdict applies to every repo that has the step. */
export type Adjudicated = { repo?: string; from: string; to: string; imports: boolean; note: string };

/** The verdicts that apply to one repo's steps. */
export const adjudicatedFor = (adjudicated: readonly Adjudicated[], repo: string): Adjudicated[] => adjudicated.filter((j) => j.repo === undefined || j.repo === repo);

/**
 * The kind a question is scored and gated as: its own `kind` when it names one, else Eval #1's family, where a list is
 * transitive when its truth says so and direct otherwise.
 */
export function kindOf(q: QuestionData): QuestionKind {
    if (q.kind !== undefined) return q.kind;
    if (q.family === "list") return q.truth?.kind === "list" && q.truth.scope === "transitive" ? "list-transitive" : "list-direct";
    return q.family === "grepHard" ? "impact" : q.family;
}
/** A run's rubric grade, by point id: 1, 0.5 or 0 and the sentence of the answer that earns it. */
export type RunGrade = Record<string, { score: number; sentence?: string }>;
export type ScoreContext = {
    /** The VS Code folder as the kept transcripts spell it (they are scrubbed): "<vscode>". */
    repoRoot: string;
    known: ReadonlySet<string>;
    imports: (a: string, b: string) => boolean | null;
};

const SEP = "\u0000";

/**
 * Whether one file imports another: the adjudicated verdict first (a reading of the source beats the scanner's regex,
 * whichever way they differ: R4), else the scanner's edge, else null for nobody knows yet. A verdict that overturns a
 * scanner edge is listed by `overrides`, so the ruling shows in the output.
 */
export function makeImports(edges: readonly (readonly [string, string])[], adjudicated: readonly Adjudicated[]): (a: string, b: string) => boolean | null {
    const scanned = new Set(edges.map(([a, b]) => `${a}${SEP}${b}`));
    const verdicts = new Map(adjudicated.map((j) => [`${j.from}${SEP}${j.to}`, j.imports]));
    return (a, b) => verdicts.get(`${a}${SEP}${b}`) ?? (scanned.has(`${a}${SEP}${b}`) ? true : null);
}

/** Adjudicated entries that say "doesn't import" for an edge the scanner has: the scanner's false hits the owner has ruled out. */
export function overrides(edges: readonly (readonly [string, string])[], adjudicated: readonly Adjudicated[]): Adjudicated[] {
    const scanned = new Set(edges.map(([a, b]) => `${a}${SEP}${b}`));
    return adjudicated.filter((j) => !j.imports && scanned.has(`${j.from}${SEP}${j.to}`));
}

/** The inverse of run-config's runName, or null for a name that isn't a run's. */
export function parseRunName(name: string): RunId | null {
    // read from the right (the repeat, an optional "upfront", the arm), so an id may hold hyphens and digits: affine-cn1, vs-s1
    const m = /^([a-z0-9][a-z0-9-]*)-(baseline|nebulosity)(-upfront)?-(\d+)$/.exec(name);
    return m === null ? null : { question: m[1], arm: m[2] as Arm, repeat: Number(m[4]), toolSearch: m[3] === undefined };
}

export type IndexEntry = { name: string; [field: string]: unknown };

/** eval/runs/index.jsonl as a map: a crash can leave a run's line twice, so the last line per name counts. */
export function lastPerName(text: string): Map<string, IndexEntry> {
    const index = new Map<string, IndexEntry>();
    for (const line of text.split(/\r?\n/)){
        try{
            const parsed = JSON.parse(line) as unknown;
            if (parsed !== null && typeof parsed === "object" && typeof (parsed as IndexEntry).name === "string") index.set((parsed as IndexEntry).name, parsed as IndexEntry);
        } catch{
            // a blank or broken line: skipped
        }
    }
    return index;
}

export type Tokens = { input: number; cacheWrite: number; cacheRead: number; output: number; total: number };
const tokens = (input: number, cacheWrite: number, cacheRead: number, output: number): Tokens => ({ input, cacheWrite, cacheRead, output, total: input + cacheWrite + cacheRead + output });

/**
 * A run's tokens summed over every model it used, subagents and background calls included (`usage` is the main
 * conversation only). With no model listed, the main conversation's usage stands in.
 */
export function sumTokens(models: RunSummary["models"], usage: RunSummary["usage"]): Tokens {
    const all = Object.values(models);
    if (all.length === 0) return tokens(usage.input, usage.cacheWrite, usage.cacheRead, usage.output);
    const sum = (pick: (m: RunSummary["models"][string]) => number): number => all.reduce((s, m) => s + pick(m), 0);
    return tokens(sum((m) => m.input), sum((m) => m.cacheWrite), sum((m) => m.cacheRead), sum((m) => m.output));
}

export function median(xs: readonly number[]): number | null {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The mean of the numbers among them, or null when there are none. */
function mean(xs: readonly (number | null)[]): number | null {
    const present = xs.filter((x): x is number => x !== null);
    return present.length === 0 ? null : present.reduce((s, x) => s + x, 0) / present.length;
}

export type AnswerScore = {
    /** 0 to 1, or null while it waits for a grade or an adjudicated chain step (see `pending`). */
    score: number | null;
    pending: "ungraded" | "chain step to adjudicate" | null;
    none: boolean;
    /** The repo's files the answer names, in order; and path-like things it names that aren't files of the repo. */
    files: string[]; notFiles: string[];
    recall: number | null; precision: number | null; hits: number | null; missed: string[]; extra: string[];
    steps: number | null; valid: boolean | null; problem: string | null; unknown: [string, string] | null;
    /** Things the owner should look at: no ANSWER: line, "none" with files named, a chain naming non-files, one shorter than the truth's. */
    flags: string[];
};

const NO_ANSWER_LINE = "no ANSWER: line";

const NEW_KINDS: readonly TruthFile["kind"][] = ["impact", "cycle", "unused", "violations", "entries", "pairs"];

/** The answer's score for one of Eval #2's kinds (D2); `out` is the answer's parts so far. */
function scoreNewKind(out: AnswerScore, section: string, truth: TruthFile, ctx: ScoreContext): AnswerScore {
    if (truth.kind === "impact") return { ...out, score: scoreCounts(section, truth as ImpactTruthFile) };
    if (truth.kind === "pairs") return { ...out, score: scorePairs(section.split(/\r?\n/), (truth as PairsTruthFile).pairs) };
    if (truth.kind === "cycle"){
        const cycle = truth as CycleTruthFile;
        // a cycle names its first file twice, so the repeats stay; but a file named twice in a row (a lead-in line that
        // repeats the first file) is one step's worth of nothing, so consecutive duplicates collapse
        const named = extractPaths(section, ctx.repoRoot, ctx.known, { repeats: true }).files;
        const files = named.filter((file, i) => i === 0 || file !== named[i - 1]);
        const c = checkCycle(out.none ? "none" : files, cycle, ctx.imports);
        const flags = [...out.flags];
        if (out.none && files.length > 0) flags.push("none, but names files");
        if (c.problem?.startsWith("shorter than") || c.problem?.startsWith("a valid cycle")) flags.push(c.problem);
        return {
            ...out, files, score: c.score, pending: c.score === null ? "chain step to adjudicate" : null,
            steps: c.steps, valid: c.valid, problem: c.problem ?? null, unknown: c.unknown ?? null, flags,
        };
    }
    // unused, violations and entries: a set of files, scored by F1 (recall and precision beside it)
    // a listed path that isn't a file of the repo is a false positive, and is flagged
    const wanted = (truth as { files: string[] }).files;
    const listed = [...out.files, ...out.notFiles];
    const s = scoreList(listed, wanted);
    return {
        ...out, score: f1(listed, wanted), recall: s.recall, precision: s.precision, hits: s.hits, missed: s.missed, extra: s.extra,
        flags: out.notFiles.length > 0 ? [...out.flags, "names non-files"] : out.flags,
    };
}

/** Scores one answer's final text against its question's truth or rubric. `grade` is the run's rubric grade, for big-picture questions. */
export function scoreAnswer(finalText: string | null, q: QuestionData, ctx: ScoreContext, grade?: RunGrade): AnswerScore {
    const section = finalText === null ? null : answerSection(finalText);
    const named = section === null ? { files: [], notFiles: [] } : extractPaths(section, ctx.repoRoot, ctx.known);
    const out: AnswerScore = {
        score: null, pending: null, none: section !== null && isNone(section), files: named.files, notFiles: named.notFiles,
        recall: null, precision: null, hits: null, missed: [], extra: [], steps: null, valid: null, problem: null, unknown: null, flags: [],
    };

    if (q.family === "bigPicture"){
        const holding = (q.rubric?.points ?? []).filter((p) => p.holds !== false);
        if (grade === undefined || holding.length === 0 || holding.some((p) => grade[p.id] === undefined)) return { ...out, pending: "ungraded" };
        return { ...out, score: holding.reduce((s, p) => s + grade[p.id].score, 0) / holding.length };
    }

    if (section === null) out.flags.push(NO_ANSWER_LINE);
    const truth = q.truth;
    if (truth !== undefined && NEW_KINDS.includes(truth.kind)){
        if (section === null) return { ...out, score: 0, valid: false, problem: NO_ANSWER_LINE };
        return scoreNewKind(out, section, truth, ctx);
    }
    if (q.family === "list"){
        const s = scoreList(named.files, (q.truth as ListTruthFile).files);
        return { ...out, score: s.recall, recall: s.recall, precision: s.precision, hits: s.hits, missed: s.missed, extra: s.extra };
    }

    if (section === null) return { ...out, score: 0, valid: false, problem: NO_ANSWER_LINE };
    const c = scoreChain({ none: out.none, files: named.files }, q.truth as ChainTruthFile, ctx.imports);
    if (out.none && named.files.length > 0) out.flags.push("none, but names files");
    if (named.notFiles.length > 0) out.flags.push("names non-files");
    if (c.problem?.startsWith("shorter than")) out.flags.push(c.problem);
    return {
        ...out, score: c.score, pending: c.score === null ? "chain step to adjudicate" : null,
        steps: c.steps, valid: c.valid, problem: c.problem ?? null, unknown: c.unknown ?? null,
    };
}

/** A kept run: its transcript's summary and, when the index has a line for it, when it started and ended. */
export type LoadedRun = {
    name: string; summary: RunSummary; startedAt: string | null; endedAt: string | null; resultNotes: string[];
    /** A task session's run: its id, the question each message asked, and the messages' answers and the session's totals. */
    session?: { id: string; turnQuestions: string[]; summary: SessionSummary };
};

export type RunResult = AnswerScore & {
    name: string; question: string; family: Family;
    /** "baseline", "nebulosity", or "nebulosity-upfront" for the pilot's variant with every tool loaded up front. */
    arm: string; repeat: number;
    /** Every model's tokens, subagents included; and the main conversation's apart. */
    tokens: Tokens; mainTokens: Tokens;
    costUsd: number; wallMs: number;
    /** Tool calls of every tool, top-level and inside subagents. */
    toolCalls: number; nebulosityCalls: number; turns: number; resultNotes: string[];
    summary: Omit<RunSummary, "finalText">;
    /** For an eval with several repos or kinds, the gate's inputs: the question's kind, its repo, and the first call's context. */
    kind?: QuestionKind; repo?: string; firstCallContext?: number | null;
};

const limited = (subtype: string | null): boolean => subtype !== null && subtype.startsWith("error_max");

const sumCalls = (calls: Record<string, number>): number => Object.values(calls).reduce((s, n) => s + n, 0);

function wallTime(run: LoadedRun): number {
    const [start, end] = [run.startedAt, run.endedAt].map((t) => (t === null ? NaN : Date.parse(t)));
    return end >= start ? end - start : run.summary.durationMs;
}

export function scoreRun(run: LoadedRun, id: RunId, data: QuestionData, ctx: ScoreContext, grade?: RunGrade): RunResult {
    // a run that hit its turn or budget limit scores 0 and counts (D1)
    const scored = scoreAnswer(run.summary.finalText, data, ctx, grade);
    const answer = limited(run.summary.subtype) ? { ...scored, score: 0, pending: null, unknown: null } : scored;
    const summary: Partial<RunSummary> = { ...run.summary };
    delete summary.finalText;
    const flags = [...answer.flags];
    if (run.summary.subtype !== "success") flags.push(`ended: ${run.summary.subtype ?? "without a result"}`);
    else if (run.summary.isError) flags.push("ended: is_error");
    return {
        ...answer, flags, name: run.name, question: id.question, family: data.family, arm: id.toolSearch ? id.arm : `${id.arm}-upfront`, repeat: id.repeat,
        tokens: sumTokens(run.summary.models, run.summary.usage), mainTokens: tokens(run.summary.usage.input, run.summary.usage.cacheWrite, run.summary.usage.cacheRead, run.summary.usage.output),
        costUsd: run.summary.costUsd, wallMs: wallTime(run),
        toolCalls: sumCalls(run.summary.toolCalls) + sumCalls(run.summary.nestedToolCalls), nebulosityCalls: run.summary.nebulosityCalls, turns: run.summary.turns,
        resultNotes: run.resultNotes, summary: summary as Omit<RunSummary, "finalText">,
    };
}

/** A scored run with the fields the gate takes, for an eval with several repos or kinds. */
export function withGateFields(r: RunResult, q: QuestionData, repo: string): RunResult {
    return { ...r, kind: kindOf(q), repo, firstCallContext: r.summary.firstCallContext };
}

export function toGateRun(r: RunResult): GateRun | null {
    if (r.score === null || r.kind === undefined || r.repo === undefined || (r.arm !== "baseline" && r.arm !== "nebulosity")) return null;
    return {
        question: r.question, repo: r.repo, kind: r.kind, arm: r.arm, repeat: r.repeat, score: r.score, costUsd: r.costUsd,
        // D1: wall time is the result's duration_ms, as for a session (summed over its messages), not the clock between start and end
        wallMs: r.summary.durationMs ?? r.wallMs, nebulosityCalls: r.nebulosityCalls, firstCallContext: r.firstCallContext ?? null,
    };
}

// ---- task sessions

export type SessionTurnResult = { question: string; score: number | null; pending: AnswerScore["pending"]; flags: string[]; nebulosityCalls: number; costUsd: number };
export type SessionResult = {
    name: string; session: string; repo: string; arm: string; repeat: number;
    /** The mean of the messages' scores, or null while any waits for a chain step to be adjudicated. */
    score: number | null; pending: AnswerScore["pending"]; turns: SessionTurnResult[];
    /** The session's totals: the cost estimate, the sum of the messages' times, and the first call's context. */
    costUsd: number; wallMs: number; firstCallContext: number | null;
    unknown: [string, string][]; flags: string[];
};

/**
 * Scores a task session message by message: message i answered question turnQuestions[i], against that question's truth. A
 * message that hit its turn or budget limit scores 0 (D1), and so does one that never came (the session ended early). The
 * session's score is the mean of its messages'; its cost and time are the session's totals.
 */
export function scoreSession(
    name: string, id: RunId, turnQuestions: readonly string[], summary: SessionSummary, questions: ReadonlyMap<string, QuestionData>, ctx: ScoreContext, repo = "",
): SessionResult {
    const unknown: [string, string][] = [];
    const turns = turnQuestions.map((question, i): SessionTurnResult => {
        const q = questions.get(question);
        if (q === undefined) throw new Error(`session ${name} asks ${question}, which isn't a question of the eval`);
        const turn = summary.turns[i];
        if (turn === undefined) return { question, score: 0, pending: null, flags: ["no answer: the session ended before this message"], nebulosityCalls: 0, costUsd: 0 };
        const answer = scoreAnswer(turn.finalText, q, ctx);
        const flags = [...answer.flags];
        if (turn.subtype !== "success") flags.push(`ended: ${turn.subtype ?? "without a result"}`);
        const hitLimit = limited(turn.subtype);
        if (!hitLimit && answer.unknown !== null) unknown.push(answer.unknown);
        return { question, score: hitLimit ? 0 : answer.score, pending: hitLimit ? null : answer.pending, flags, nebulosityCalls: turn.nebulosityCalls, costUsd: turn.costUsd };
    });
    const open = turns.find((t) => t.score === null);
    return {
        name, session: id.question, repo, arm: id.arm, repeat: id.repeat,
        score: open ? null : mean(turns.map((t) => t.score)), pending: open?.pending ?? null, turns,
        costUsd: summary.costUsd, wallMs: summary.durationMs, firstCallContext: summary.firstCallContext,
        unknown, flags: turns.flatMap((t) => t.flags.map((fl) => `${t.question}: ${fl}`)),
    };
}

export function toGateSession(s: SessionResult): GateSession | null {
    if (s.score === null || (s.arm !== "baseline" && s.arm !== "nebulosity")) return null;
    return { session: s.session, repo: s.repo, arm: s.arm, repeat: s.repeat, score: s.score, costUsd: s.costUsd, wallMs: s.wallMs };
}

// ---- per repo

/** Task 10's verdicts ({ decision: "in" | "out" }) as the scorer reads them: "in" is an import, "out" is not. A site that loads nothing (`to: null`) says nothing about a step. */
export function fromTruthVerdicts(verdicts: readonly Adjudication[]): Adjudicated[] {
    return verdicts.filter((v) => v.to !== null).map((v) => ({ repo: v.repo, from: v.from, to: v.to as string, imports: v.decision === "in", note: v.why }));
}

/**
 * One repo's score context. Eval #1 is scored on the regex scanner's graph and its own verdict format, as it always was. Any
 * other eval is scored on the graph the truth builder builds (buildRepoGraphs with the truth's resolver, so workspace
 * packages and module ids resolve) and on Task 10's verdicts: the same graph and judgments its truths were made from.
 */
export function repoScoreContext(
    root: string, repoId: string, firstEval: boolean, adjudicated: readonly Adjudicated[], verdicts: readonly Adjudication[],
): { ctx: ScoreContext; edges: [string, string][] } {
    if (firstEval){
        const g = scanRepo(root);
        return { edges: g.edges, ctx: { repoRoot: `<${repoId}>`, known: new Set(g.files), imports: makeImports(g.edges, adjudicatedFor(adjudicated, repoId)) } };
    }
    const built = buildRepoGraphs(root, repoId, verdicts, { resolveBare: true });
    return {
        edges: built.scanner.edges.map(([a, b]): [string, string] => [a, b]),
        ctx: { repoRoot: `<${repoId}>`, known: built.known, imports: makeImports(built.scanner.edges, adjudicatedFor(fromTruthVerdicts(verdicts), repoId)) },
    };
}

/**
 * What stops the gate being computed (D1): a repo with no runs, and any question or session without every scheduled repeat
 * of every arm among the scored runs. The sentences name what is missing; none means the data is complete.
 */
export function missingForGate(
    expected: { repoIds: readonly string[]; arms: readonly string[]; repeats: number; questions: readonly { id: string; repo: string }[]; sessions: readonly { id: string; repo: string }[] },
    results: readonly RunResult[], sessions: readonly SessionResult[],
): string[] {
    const missing: string[] = [];
    for (const repo of expected.repoIds){
        if (!results.some((r) => r.repo === repo) && !sessions.some((s) => s.repo === repo)) missing.push(`no runs for the repo ${repo}`);
    }
    const check = (id: string, arm: string, repeats: Iterable<number>): void => {
        const have = new Set([...repeats].filter((n) => n >= 1 && n <= expected.repeats));
        if (have.size < expected.repeats) missing.push(`${id} (${arm}): ${have.size} of ${expected.repeats} runs`);
    };
    for (const q of expected.questions) for (const arm of expected.arms) check(q.id, arm, results.filter((r) => r.question === q.id && r.arm === arm).map((r) => r.repeat));
    for (const s of expected.sessions) for (const arm of expected.arms) check(`session ${s.id}`, arm, sessions.filter((x) => x.session === s.id && x.arm === arm).map((x) => x.repeat));
    return missing;
}

/**
 * The scorer's readings that depend on a repo's graph, each repo against its own: the adjudicated verdicts that overturn a
 * scanner edge, and the steps of valid chains that only that repo's scanner vouches for (to be read in the source). A repo's
 * name prefixes a note only when the eval has several.
 */
export function repoReadouts(
    results: readonly RunResult[], repoOf: (r: RunResult) => string, edgesByRepo: ReadonlyMap<string, readonly (readonly [string, string])[]>,
    adjudicated: readonly Adjudicated[], examples: ReadonlyMap<string, readonly string[] | null>,
): { notes: string[]; toRead: { repo: string; step: [string, string]; runs: string[] }[] } {
    const prefix = (repo: string): string => (edgesByRepo.size > 1 ? `${repo}: ` : "");
    const notes: string[] = [];
    const toRead: { repo: string; step: [string, string]; runs: string[] }[] = [];
    for (const [repo, edges] of edgesByRepo){
        const own = adjudicatedFor(adjudicated, repo);
        for (const j of overrides(edges, own)) notes.push(`${prefix(repo)}adjudicated overrides the scanner: ${j.from} → ${j.to} (false)`);
        for (const s of scannerOnlySteps(results.filter((r) => repoOf(r) === repo), examples, edges, own)) toRead.push({ repo, step: s.step, runs: s.runs });
    }
    return { notes, toRead };
}

// ---- the tables

const FAMILY_ORDER: Family[] = ["bigPicture", "list", "chain", "grepHard"];
const FAMILY_LABEL: Record<Family, string> = { bigPicture: "Big-picture", list: "Complete-list", chain: "Connection", grepHard: "Grep-hard" };
const KIND_ORDER: QuestionKind[] = ["bigPicture", "list-direct", "list-transitive", "chain", "impact", "cycle", "unused", "violations", "entries", "pairs"];
const ARM_ORDER = ["baseline", "nebulosity", "nebulosity-upfront"];
const rank = (order: readonly string[], x: string): number => (order.includes(x) ? order.indexOf(x) : order.length);

function groups<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
    return map;
}

export type QuestionArmRow = {
    question: string; family: Family; arm: string; runs: number;
    /** The repeat each score belongs to, in order, so a missing repeat isn't read as the first. */
    repeats: number[]; scores: (number | null)[]; mean: number | null; recall: number | null; precision: number | null;
};

/** One row per question and arm: the scores of its repeats in order, their mean, and a list's mean recall and precision. */
export function questionArmRows(results: readonly RunResult[], order: readonly string[]): QuestionArmRow[] {
    const rows = [...groups(results, (r) => `${r.question}${SEP}${r.arm}`).values()].map((group) => {
        const runs = [...group].sort((a, b) => a.repeat - b.repeat);
        return {
            question: runs[0].question, family: runs[0].family, arm: runs[0].arm, runs: runs.length, repeats: runs.map((r) => r.repeat), scores: runs.map((r) => r.score),
            mean: mean(runs.map((r) => r.score)), recall: mean(runs.map((r) => r.recall)), precision: mean(runs.map((r) => r.precision)),
        };
    });
    return rows.sort((a, b) => rank(order, a.question) - rank(order, b.question) || rank(ARM_ORDER, a.arm) - rank(ARM_ORDER, b.arm) || (a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : 0));
}

export type FamilyArmRow = {
    family: Family; arm: string; runs: number; scored: number; mean: number | null; recall: number | null; precision: number | null;
    /** Medians of each kind of token apart (D2), and of the total. */
    medianInput: number | null; medianCacheWrite: number | null; medianCacheRead: number | null; medianOutput: number | null; medianTokens: number | null;
    medianCostUsd: number | null; medianWallMs: number | null; medianToolCalls: number | null;
};

/** One row per family and arm: the mean score over the scored runs, and the medians over all the runs. */
export function familyArmRows(results: readonly RunResult[]): FamilyArmRow[] {
    const rows = [...groups(results, (r) => `${r.family}${SEP}${r.arm}`).values()].map((runs) => ({
        family: runs[0].family, arm: runs[0].arm, runs: runs.length, scored: runs.filter((r) => r.score !== null).length,
        mean: mean(runs.map((r) => r.score)), recall: mean(runs.map((r) => r.recall)), precision: mean(runs.map((r) => r.precision)),
        medianInput: median(runs.map((r) => r.tokens.input)), medianCacheWrite: median(runs.map((r) => r.tokens.cacheWrite)),
        medianCacheRead: median(runs.map((r) => r.tokens.cacheRead)), medianOutput: median(runs.map((r) => r.tokens.output)),
        medianTokens: median(runs.map((r) => r.tokens.total)), medianCostUsd: median(runs.map((r) => r.costUsd)),
        medianWallMs: median(runs.map((r) => r.wallMs)), medianToolCalls: median(runs.map((r) => r.toolCalls)),
    }));
    return rows.sort((a, b) => rank(FAMILY_ORDER, a.family) - rank(FAMILY_ORDER, b.family) || rank(ARM_ORDER, a.arm) - rank(ARM_ORDER, b.arm) || (a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : 0));
}

/** Each chain step still to adjudicate, once, however many runs left it open. */
export function pendingSteps(results: readonly RunResult[]): [string, string][] {
    const steps = new Map<string, [string, string]>();
    for (const r of results) if (r.unknown !== null) steps.set(r.unknown.join(SEP), r.unknown);
    return [...steps.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, step]) => step);
}

/**
 * The steps of the valid chains that only the scanner vouches for (no adjudicated verdict) and that the truth's own chain
 * doesn't have: the truth's chain was read by hand, these were not. Each comes with the runs that used it, to be read in
 * the source so a false scanner edge in a model's chain is found, not trusted. A chain that scored 0 credited no step.
 */
export function scannerOnlySteps(
    results: readonly RunResult[], examples: ReadonlyMap<string, readonly string[] | null>,
    edges: readonly (readonly [string, string])[], adjudicated: readonly Adjudicated[],
): { step: [string, string]; runs: string[] }[] {
    const scanned = new Set(edges.map(([a, b]) => `${a}${SEP}${b}`));
    const decided = new Set(adjudicated.map((j) => `${j.from}${SEP}${j.to}`));
    const found = new Map<string, { step: [string, string]; runs: string[] }>();
    for (const r of results){
        if (r.family !== "chain" || r.valid !== true || r.steps === null) continue;
        const example = examples.get(r.question) ?? [];
        const own = new Set(example.slice(1).map((file, i) => `${example[i]}${SEP}${file}`));
        for (let i = 0; i + 1 < r.files.length; i++){
            const key = `${r.files[i]}${SEP}${r.files[i + 1]}`;
            if (!scanned.has(key) || decided.has(key) || own.has(key)) continue;
            const entry = found.get(key) ?? { step: [r.files[i], r.files[i + 1]] as [string, string], runs: [] };
            if (!entry.runs.includes(r.name)) entry.runs.push(r.name);
            found.set(key, entry);
        }
    }
    return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, e]) => ({ step: e.step, runs: [...e.runs].sort() }));
}

export type Cleanliness = { truthsVerified: boolean; unverified: string[]; uncheckedPoints: number };

/** Whether every truth is checked (`verified`), and how many rubric points are still unchecked (`holds: null`), over the questions asked. */
export function cleanliness(questions: readonly QuestionData[]): Cleanliness {
    const unverified = questions.filter((q) => q.truth !== undefined && !q.truth.verified).map((q) => q.id);
    const uncheckedPoints = questions.reduce((n, q) => n + (q.rubric?.points ?? []).filter((p) => p.holds === null).length, 0);
    return { truthsVerified: unverified.length === 0, unverified, uncheckedPoints };
}

/** The header line for results that rest on unchecked truths or rubric points, or null when everything is clean. */
export function cleanlinessLine(c: Cleanliness): string | null {
    if (c.truthsVerified && c.uncheckedPoints === 0) return null;
    return `Truths checked: ${c.truthsVerified ? "yes" : `no (${c.unverified.join(", ")})`}. Rubric points still unchecked: ${c.uncheckedPoints}.`;
}

/** The repo a question asks about: the one it names, else the definition's only repo (R: Eval #1's questions name none). */
export function repoIdFor(repoIds: readonly string[], named: string | undefined, questionId: string): string {
    if (named === undefined){
        if (repoIds.length === 1) return repoIds[0];
        throw new Error(`question ${questionId} names no repo, and eval.json has several (${repoIds.join(", ")}).`);
    }
    if (!repoIds.includes(named)) throw new Error(`question ${questionId} names the repo ${named}, which eval.json doesn't list.`);
    return named;
}

/** Where the results are written: --out, else (when the runs come from somewhere else, as in a try-out) a temp file, else eval/results.json. */
export function resultsFile(given: { runs: string | null; out: string | null }, checkout: string, tmp: string, dir = "eval"): string {
    return given.out ?? (given.runs !== null ? `${tmp}/nebulosity-eval-results.json` : `${checkout}/${dir}/results.json`);
}

export function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
    const cell = (s: string): string => s.replace(/\|/g, "\\|");
    const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;
    return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

const n2 = (x: number | null): string => (x === null ? "n/a" : x.toFixed(2));
const count = (x: number | null): string => (x === null ? "n/a" : x.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const usd = (x: number | null): string => (x === null ? "n/a" : `$${x.toFixed(2)}`);
const seconds = (ms: number | null): string => (ms === null ? "n/a" : `${Math.round(ms / 1000)} s`);
const shownScore = (score: number | null, pending: RunResult["pending"]): string => (score !== null ? n2(score) : pending === "ungraded" ? "ungraded" : "to adjudicate");

/** Every run on one line, with the paths it named that aren't files of the repo and the things to look at beside its score. */
export function renderRunTable(results: readonly RunResult[], order: readonly string[]): string {
    const sorted = [...results].sort((a, b) => rank(order, a.question) - rank(order, b.question) || rank(ARM_ORDER, a.arm) - rank(ARM_ORDER, b.arm) || a.repeat - b.repeat);
    return renderTable(
        ["Run", "Score", "Recall", "Precision", "Tokens (all models)", "of which output", "Tokens (main conversation)", "Cost est.", "Wall", "Tool calls", "Nebulosity calls", "Not files", "Flags"],
        sorted.map((r) => [
            r.name, shownScore(r.score, r.pending), n2(r.recall), n2(r.precision), count(r.tokens.total), count(r.tokens.output), count(r.mainTokens.total), usd(r.costUsd), seconds(r.wallMs),
            String(r.toolCalls), String(r.nebulosityCalls),
            r.notFiles.length === 0 ? "" : r.notFiles.slice(0, 5).join(", ") + (r.notFiles.length > 5 ? ` (+${r.notFiles.length - 5} more)` : ""),
            [...r.flags, ...r.resultNotes].join("; "),
        ]),
    );
}

export function renderQuestionTable(rows: readonly QuestionArmRow[]): string {
    return renderTable(
        ["Question", "Arm", "Scores (by repeat)", "Mean", "Recall", "Precision"],
        rows.map((r) => [r.question, r.arm, r.scores.map((s, i) => `r${r.repeats[i]}: ${s === null ? "open" : n2(s)}`).join(", "), n2(r.mean), n2(r.recall), n2(r.precision)]),
    );
}

export function renderFamilyTable(rows: readonly FamilyArmRow[]): string {
    return renderTable(
        [
            "Family", "Arm", "Runs (scored / all)", "Mean score", "Recall", "Precision", "Median input (uncached)", "Median cache writes", "Median cache reads",
            "Median output", "Median total tokens", "Median cost est.", "Median wall", "Median tool calls",
        ],
        rows.map((r) => [
            FAMILY_LABEL[r.family], r.arm, `${r.scored} / ${r.runs}`, n2(r.mean), n2(r.recall), n2(r.precision),
            count(r.medianInput), count(r.medianCacheWrite), count(r.medianCacheRead), count(r.medianOutput), count(r.medianTokens),
            usd(r.medianCostUsd), seconds(r.medianWallMs), count(r.medianToolCalls),
        ]),
    );
}

export type KindArmRow = { repo: string; kind: QuestionKind; arm: string; runs: number; scored: number; mean: number | null; medianCostUsd: number | null; medianWallMs: number | null; medianFirstCall: number | null };

/** One row per repo, kind and arm of the runs that carry the gate's fields (Eval #2). */
export function kindArmRows(results: readonly RunResult[]): KindArmRow[] {
    const own = results.filter((r) => r.kind !== undefined && r.repo !== undefined);
    const rows = [...groups(own, (r) => `${r.repo}${SEP}${r.kind}${SEP}${r.arm}`).values()].map((runs): KindArmRow => ({
        repo: runs[0].repo as string, kind: runs[0].kind as QuestionKind, arm: runs[0].arm, runs: runs.length, scored: runs.filter((r) => r.score !== null).length,
        mean: mean(runs.map((r) => r.score)), medianCostUsd: median(runs.map((r) => r.costUsd)), medianWallMs: median(runs.map((r) => r.summary.durationMs ?? r.wallMs)),
        medianFirstCall: median(runs.flatMap((r) => (r.firstCallContext == null ? [] : [r.firstCallContext]))),
    }));
    return rows.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) || rank(KIND_ORDER, a.kind) - rank(KIND_ORDER, b.kind) || rank(ARM_ORDER, a.arm) - rank(ARM_ORDER, b.arm));
}

export function renderKindTable(rows: readonly KindArmRow[]): string {
    return renderTable(
        ["Repo", "Kind", "Arm", "Runs (scored / all)", "Mean score", "Median cost est.", "Median wall", "Median first call"],
        rows.map((r) => [r.repo, r.kind, r.arm, `${r.scored} / ${r.runs}`, n2(r.mean), usd(r.medianCostUsd), seconds(r.medianWallMs), count(r.medianFirstCall)]),
    );
}

/** One row per repo and arm: the sessions' mean score, mean cost estimate and mean time (the session totals of D1). */
export function renderSessionTable(sessions: readonly SessionResult[]): string {
    const rows = [...groups(sessions, (s) => `${s.repo}${SEP}${s.arm}`).values()]
        .sort((a, b) => (a[0].repo < b[0].repo ? -1 : a[0].repo > b[0].repo ? 1 : 0) || rank(ARM_ORDER, a[0].arm) - rank(ARM_ORDER, b[0].arm));
    return renderTable(
        ["Repo", "Arm", "Sessions (scored / all)", "Mean score", "Mean cost est.", "Mean wall", "Mean nebulosity calls"],
        rows.map((g) => [
            g[0].repo, g[0].arm, `${g.filter((s) => s.score !== null).length} / ${g.length}`, n2(mean(g.map((s) => s.score))), usd(mean(g.map((s) => s.costUsd))),
            seconds(mean(g.map((s) => s.wallMs))), n2(mean(g.map((s) => s.turns.reduce((sum, t) => sum + t.nebulosityCalls, 0)))),
        ]),
    );
}

/** The gate, condition by condition, then the verdict. */
export function renderGate(v: Verdict): string {
    return `${v.conditions.map((c) => `- ${c.id} ${c.pass ? "PASS" : "FAIL"} (${c.scope}): ${c.text}`).join("\n")}\n\nGate: ${v.pass ? "PASS" : "FAIL"}`;
}

// ---- reading the kept runs

/** Every kept transcript in a folder (eval/runs), summarized, with its index line when it has one. A missing folder has no runs. */
export function loadRuns(dir: string): { runs: LoadedRun[]; warnings: string[] } {
    if (!fs.existsSync(dir)) return { runs: [], warnings: [] };
    const indexFile = path.join(dir, "index.jsonl");
    const index = fs.existsSync(indexFile) ? lastPerName(fs.readFileSync(indexFile, "utf8")) : new Map<string, IndexEntry>();
    const runs: LoadedRun[] = [];
    const warnings: string[] = [];
    const kept = new Set<string>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz")).sort()){
        const name = file.slice(0, -".jsonl.gz".length);
        if (parseRunName(name) === null){
            warnings.push(`${file} is not named like a run; ignored`);
            continue;
        }
        const meta = index.get(name);
        const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString("utf8");
        runs.push({
            name, summary: summarizeRun(raw),
            startedAt: typeof meta?.startedAt === "string" ? meta.startedAt : null,
            endedAt: typeof meta?.endedAt === "string" ? meta.endedAt : null,
            resultNotes: Array.isArray(meta?.resultNotes) ? meta.resultNotes.filter((n): n is string => typeof n === "string") : [],
            ...(typeof meta?.session === "string" && Array.isArray(meta.turnQuestions)
                ? { session: { id: meta.session, turnQuestions: meta.turnQuestions.filter((q): q is string => typeof q === "string"), summary: summarizeSession(raw) } }
                : {}),
        });
        kept.add(name);
    }
    for (const name of index.keys()) if (!kept.has(name)) warnings.push(`${name} is in the index but has no transcript (an interrupted write); ignored`);
    return { runs, warnings };
}

// ---- the command

const forward = (p: string): string => p.replace(/\\/g, "/");
const USAGE = "usage: npm run eval:score [-- --only <ids>] [--runs <dir>] [--out <file>] [--eval <dir> (default eval)]";

class Stop extends Error {}

const readJson = <T>(file: string): T => {
    try{
        return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch(e){
        throw new Stop(`${file} couldn't be read: ${(e as Error).message}`);
    }
};

function main(): void {
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    const args = process.argv.slice(2);
    let only: string[] | null = null;
    let runsGiven: string | null = null;
    let outGiven: string | null = null;
    let evalDir = "eval";
    for (let i = 0; i < args.length; i++){
        const value = (): string => {
            const v = args[++i];
            if (v === undefined || v.startsWith("--")) throw new Stop(`${args[i - 1]} needs a value. ${USAGE}`);
            return v;
        };
        if (args[i] === "--only") only = value().split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
        else if (args[i] === "--runs") runsGiven = forward(path.resolve(value()));
        else if (args[i] === "--out") outGiven = forward(path.resolve(value()));
        else if (args[i] === "--eval") evalDir = value();
        else throw new Stop(`unknown argument ${args[i]}. ${USAGE}`);
    }
    const definition = loadDefinition(path.resolve(checkout, evalDir));
    const dir = forward(definition.dir);
    const name = path.basename(dir);
    const repoIds = Object.keys(definition.repos);
    const runsDir = runsGiven ?? `${dir}/runs`;
    const outFile = resultsFile({ runs: runsGiven, out: outGiven }, checkout, forward(os.tmpdir()), name);

    const questionsFile = `${dir}/questions.json`;
    if (!fs.existsSync(questionsFile)) throw new Stop(`${name}/questions.json doesn't exist yet, so there is nothing to score. Nothing was scored.`);
    type FileQuestion = { id: string; family?: Family; kind?: QuestionKind; repo?: string; truth?: string; rubric?: string };
    const file = readJson<{ commit: string; questions: FileQuestion[] }>(questionsFile);
    const familyOf = (q: FileQuestion): Family => {
        if (q.family !== undefined) return q.family;
        if (q.kind === undefined) throw new Stop(`${name}/questions.json: question ${q.id} has neither a family nor a kind.`);
        return q.kind === "bigPicture" ? "bigPicture" : q.kind === "chain" ? "chain" : q.kind.startsWith("list-") ? "list" : "grepHard";
    };
    // an eval with several repos or any question kind gets the per-repo tables, the sessions and the gate; Eval #1's output is as it was
    const gated = repoIds.length > 1 || file.questions.some((q) => q.kind !== undefined);
    const unknown = (only ?? []).filter((id) => !file.questions.some((q) => q.id === id));
    if (unknown.length > 0 || only?.length === 0) throw new Stop(`no such question: ${unknown.join(", ") || "(none given)"}. The questions are ${file.questions.map((q) => q.id).join(", ")}.`);
    const toData = (q: FileQuestion): QuestionData => ({
        id: q.id, family: familyOf(q),
        ...(q.kind !== undefined ? { kind: q.kind } : {}),
        ...(q.truth ? { truth: readJson<TruthFile>(`${checkout}/${q.truth}`) } : {}),
        ...(q.rubric ? { rubric: readJson<Rubric>(`${checkout}/${q.rubric}`) } : {}),
    });
    const questions: QuestionData[] = file.questions.filter((q) => only === null || only.includes(q.id)).map(toData);
    const order = questions.map((q) => q.id);
    // Eval #1's verdicts are { from, to, imports, note }; every other eval's are Task 10's { repo, from, to, decision, why }
    const firstEval = definition.name === EVAL1;
    const rawVerdicts = fs.existsSync(`${dir}/truth/adjudicated.json`) ? readJson<unknown>(`${dir}/truth/adjudicated.json`) : [];
    let truthVerdicts: Adjudication[] = [];
    if (!firstEval){
        try{
            truthVerdicts = parseAdjudications(rawVerdicts);
        } catch(e){
            throw new Stop((e as Error).message);
        }
    }
    const adjudicated: Adjudicated[] = firstEval ? (rawVerdicts as Adjudicated[]) : fromTruthVerdicts(truthVerdicts);
    const grades = fs.existsSync(`${dir}/grading/grades.json`) ? readJson<Record<string, RunGrade>>(`${dir}/grading/grades.json`) : {};
    const sessionDefs = fs.existsSync(`${dir}/sessions.json`) ? readJson<SessionFile>(`${dir}/sessions.json`).sessions : [];

    const loaded = loadRuns(runsDir);
    const warnings = [...loaded.warnings];
    const singles = loaded.runs.filter((r) => r.session === undefined);
    const wanted = singles.filter((r) => order.includes(parseRunName(r.name)!.question));
    for (const r of singles) if (!file.questions.some((q) => q.id === parseRunName(r.name)!.question)) warnings.push(`${r.name} is for a question that isn't in ${name}/questions.json; ignored`);
    // task sessions are scored whole: --only picks questions, so it leaves them out
    const sessionRuns: { run: LoadedRun; def: SessionDef }[] = [];
    for (const r of loaded.runs) {
        if (r.session === undefined || only !== null) continue;
        const def = sessionDefs.find((s) => s.id === r.session!.id);
        if (def === undefined) warnings.push(`${r.name} is a run of session ${r.session.id}, which isn't in ${name}/sessions.json; ignored`);
        else sessionRuns.push({ run: r, def });
    }

    const repoOfQuestion = new Map<string, string>();
    for (const q of file.questions){
        try{
            repoOfQuestion.set(q.id, repoIdFor(repoIds, q.repo, q.id));
        } catch(e){
            throw new Stop(`${name}/questions.json: ${(e as Error).message}`);
        }
    }
    let results: RunResult[] = [];
    let sessionResults: SessionResult[] = [];
    // each repo has its own graph: its scanner's edges, the verdicts that apply to it, and so its own context
    const edgesByRepo = new Map<string, [string, string][]>();
    if (wanted.length > 0 || sessionRuns.length > 0){
        // one score context per repo the runs touch; each repo's HEAD is checked against its pinned commit
        const contexts = new Map<string, ScoreContext>();
        const touched = new Set([...wanted.map((r) => repoOfQuestion.get(parseRunName(r.name)!.question)!), ...sessionRuns.map((s) => s.def.repo)]);
        for (const repoId of repoIds.filter((id) => touched.has(id))){
            const repoPath = forward(path.resolve(checkout, definition.repos[repoId].path));
            const pinned = definition.repos[repoId].commit;
            const head = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
            if (head !== pinned) throw new Stop(`${repoPath} is at ${head}, not ${pinned}: the truth is for that commit.`);
            const built = repoScoreContext(repoPath, repoId, firstEval, adjudicated, truthVerdicts);
            edgesByRepo.set(repoId, built.edges);
            contexts.set(repoId, built.ctx);
        }
        results = wanted.map((r) => {
            const id = parseRunName(r.name)!;
            const q = questions.find((x) => x.id === id.question)!;
            const repoId = repoOfQuestion.get(id.question)!;
            const scored = scoreRun(r, id, q, contexts.get(repoId)!, grades[r.name]);
            return gated ? withGateFields(scored, q, repoId) : scored;
        });
        if (JSON.stringify(results.map((r) => r.name)) !== JSON.stringify([...new Set(results.map((r) => r.name))])) warnings.push("two runs share a name");
        const byId = new Map(questions.map((q) => [q.id, q] as const));
        try{
            sessionResults = sessionRuns.map(({ run, def }) =>
                scoreSession(run.name, parseRunName(run.name)!, run.session!.turnQuestions, run.session!.summary, byId, contexts.get(def.repo)!, def.repo));
        } catch(e){
            throw new Stop(`${name}: ${(e as Error).message}`);
        }
    }
    const examples = new Map(questions.map((q) => [q.id, q.truth?.kind === "chain" ? q.truth.example : null] as const));
    const { notes, toRead } = repoReadouts(results, (r) => repoOfQuestion.get(r.question)!, edgesByRepo, adjudicated, examples);
    const clean = cleanliness(questions);

    console.log(results.length === 0 && sessionResults.length === 0 ? `No runs of ${order.join(", ")} in ${runsDir}.` : `${results.length} runs scored from ${runsDir}${sessionResults.length > 0 ? `, and ${sessionResults.length} task sessions` : ""}.`);
    const line = cleanlinessLine(clean);
    if (line !== null) console.log(`${line} Unchecked points count as holding.`);
    console.log(`\n## Runs\n\n${renderRunTable(results, order)}\n`);
    console.log(`## Per question and arm\n\n${renderQuestionTable(questionArmRows(results, order))}\n`);
    console.log(`## Per family and arm\n\n${renderFamilyTable(familyArmRows(results))}\n`);
    if (gated){
        console.log(`## Per repo and kind\n\n${renderKindTable(kindArmRows(results))}\n`);
        if (sessionResults.length > 0) console.log(`## Task sessions\n\n${renderSessionTable(sessionResults)}\n`);
    }
    if (warnings.length > 0) console.log(`## Warnings\n\n${warnings.map((w) => `- ${w}`).join("\n")}\n`);
    if (notes.length > 0) console.log(`## Notes\n\n${notes.map((n) => `- ${n}`).join("\n")}\n`);

    if ((results.length > 0 || sessionResults.length > 0) && only === null){
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, `${JSON.stringify({
            commit: file.commit, truthsVerified: clean.truthsVerified, uncheckedPoints: clean.uncheckedPoints, runs: results,
            ...(sessionResults.length > 0 ? { sessions: sessionResults } : {}),
        }, null, 2)}\n`);
        console.log(`Wrote ${outFile}.`);
    } else if (results.length > 0) console.log("--only: the results file was not written.");

    if (toRead.length > 0){
        const many = edgesByRepo.size > 1;
        console.log(`\n## Chain steps to read\n\nThese steps of scored chains are the scanner's alone and are not steps of the truth's own chain, which was read by hand. They count as imports; read each in the source, and add a verdict to ${name}/truth/adjudicated.json if the scanner is wrong. They do not stop the scorer.\n\n${toRead.map((t) => `- ${many ? `${t.repo}: ` : ""}${t.step[0]} → ${t.step[1]} (${t.runs.join(", ")})`).join("\n")}`);
    }
    const open = new Map<string, [string, string]>();
    for (const s of pendingSteps(results)) open.set(s.join(SEP), s);
    for (const s of sessionResults) for (const u of s.unknown) open.set(u.join(SEP), u);
    const steps = [...open.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, step]) => step);
    if (steps.length > 0){
        console.log(`\n## Chain steps to adjudicate\n\nRead the source for each step and add ${firstEval ? '{"from", "to", "imports", "note"} (and "repo" when the step is one repo\'s alone)' : '{"repo", "from", "to", "decision": "in" or "out", "why"}'} to ${name}/truth/adjudicated.json:\n\n${steps.map(([a, b]) => `- ${a} → ${b}`).join("\n")}`);
        process.exitCode = 1;
    }

    if (gated){
        const missing = missingForGate({
            repoIds, arms: definition.arms, repeats: definition.repeats,
            questions: file.questions.map((q) => ({ id: q.id, repo: repoOfQuestion.get(q.id)! })),
            sessions: sessionDefs.map((s) => ({ id: s.id, repo: s.repo })),
        }, results, sessionResults);
        const waiting = results.filter((r) => r.score === null).length + sessionResults.filter((s) => s.score === null).length;
        if (only !== null) console.log("\n## Ship gate (D1)\n\n--only: the gate is computed over every question, so it was not computed.");
        else if (missing.length > 0) console.log(`\n## Ship gate (D1)\n\nNot computed: the data is incomplete.\n\n${missing.slice(0, 20).map((m) => `- ${m}`).join("\n")}${missing.length > 20 ? `\n- ... and ${missing.length - 20} more` : ""}`);
        else if (waiting > 0) console.log(`\n## Ship gate (D1)\n\nNot computed: ${waiting} runs or sessions still wait for a grade or an adjudicated chain step.`);
        else console.log(`\n## Ship gate (D1)\n\n${renderGate(gateVerdict(results.flatMap((r) => toGateRun(r) ?? []), sessionResults.flatMap((s) => toGateSession(s) ?? [])))}`);
    }
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]score\.ts$/.test(process.argv[1] ?? "")){
    try{
        main();
    } catch(e){
        if (!(e instanceof Stop)) throw e;
        console.error(e.message);
        process.exitCode = 1;
    }
}
