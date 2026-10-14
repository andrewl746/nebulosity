/**
 * npm run eval:score [-- --only bp4,cl2,... --runs <dir> --out <file>]
 *
 * The eval's scorer (D2, R4 in docs/plans/2026-10-13-v1-5-ship.md). It reads eval/questions.json, each question's truth
 * (eval/truth) or rubric (eval/rubric), eval/truth/adjudicated.json, the rubric grades (eval/grading/grades.json, once
 * Task 19 writes them) and the kept runs (eval/runs/*.jsonl.gz, with the index line for each), and scores every run:
 *   lists:        recall against the truth (precision reported beside it)
 *   chains:       1 for a valid chain of the shortest length or a right "none", 0.5 for a valid longer one, 0 otherwise.
 *                 A step is real when the scanner has the edge, else when eval/truth/adjudicated.json says so, else unknown
 *   big-picture:  the mean of the grades over the rubric points that hold (not scored until the grades exist)
 * It prints the Markdown tables Task 20 uses and writes eval/results.json (not under --only, and not for zero runs).
 *
 * It exits 1 while any chain step is unknown, printing each `a -> b` to adjudicate by reading the source, or when it can't
 * run at all (a missing file, ../vscode not at the commit the questions are for). With no runs it prints empty tables and
 * exits 0, without scanning ../vscode.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { ChainTruthFile, ListTruthFile } from "./build-truth";
import { answerSection, extractPaths, isNone, scoreChain, scoreList } from "./answer";
import type { Arm, RunId } from "./run-config";
import { scanRepo } from "./scan";
import { summarizeRun, type RunSummary } from "./transcript";

export type Family = "bigPicture" | "list" | "chain";
export type Rubric = { id: string; source: string; points: { id: string; text: string; check: string; holds: boolean | null; note: string }[] };
export type QuestionData = { id: string; family: Family; truth?: ListTruthFile | ChainTruthFile; rubric?: Rubric };
export type Adjudicated = { from: string; to: string; imports: boolean; note: string };
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
 * Whether one file imports another: the scanner's edge, else the adjudicated verdict (a step the scanner lacks, decided by
 * reading the source: R4), else null for nobody knows yet. The scanner's edge wins over an adjudicated "false": see
 * `contradictions`, which reports those so a wrong entry is noticed.
 */
export function makeImports(edges: readonly (readonly [string, string])[], adjudicated: readonly Adjudicated[]): (a: string, b: string) => boolean | null {
    const scanned = new Set(edges.map(([a, b]) => `${a}${SEP}${b}`));
    const verdicts = new Map(adjudicated.map((j) => [`${j.from}${SEP}${j.to}`, j.imports]));
    return (a, b) => (scanned.has(`${a}${SEP}${b}`) ? true : verdicts.get(`${a}${SEP}${b}`) ?? null);
}

/** Adjudicated entries that say "doesn't import" for an edge the scanner has. */
export function contradictions(edges: readonly (readonly [string, string])[], adjudicated: readonly Adjudicated[]): Adjudicated[] {
    const scanned = new Set(edges.map(([a, b]) => `${a}${SEP}${b}`));
    return adjudicated.filter((j) => !j.imports && scanned.has(`${j.from}${SEP}${j.to}`));
}

/** The inverse of run-config's runName, or null for a name that isn't a run's. */
export function parseRunName(name: string): RunId | null {
    const m = /^([a-z]+\d+)-(baseline|nebulosity)(-upfront)?-(\d+)$/.exec(name);
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
    /** Things the owner should look at: no ANSWER: line, "none" with files named, a chain shorter than the truth's. */
    flags: string[];
};

const NO_ANSWER_LINE = "no ANSWER: line";

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
    if (q.family === "list"){
        const s = scoreList(named.files, (q.truth as ListTruthFile).files);
        return { ...out, score: s.recall, recall: s.recall, precision: s.precision, hits: s.hits, missed: s.missed, extra: s.extra };
    }

    if (section === null) return { ...out, score: 0, valid: false, problem: NO_ANSWER_LINE };
    const c = scoreChain({ none: out.none, files: named.files }, q.truth as ChainTruthFile, ctx.imports);
    if (out.none && named.files.length > 0) out.flags.push("none, but names files");
    if (c.problem?.startsWith("shorter than")) out.flags.push(c.problem);
    return {
        ...out, score: c.score, pending: c.score === null ? "chain step to adjudicate" : null,
        steps: c.steps, valid: c.valid, problem: c.problem ?? null, unknown: c.unknown ?? null,
    };
}

/** A kept run: its transcript's summary and, when the index has a line for it, when it started and ended. */
export type LoadedRun = { name: string; summary: RunSummary; startedAt: string | null; endedAt: string | null; resultNotes: string[] };

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
};

const sumCalls = (calls: Record<string, number>): number => Object.values(calls).reduce((s, n) => s + n, 0);

function wallTime(run: LoadedRun): number {
    const [start, end] = [run.startedAt, run.endedAt].map((t) => (t === null ? NaN : Date.parse(t)));
    return end >= start ? end - start : run.summary.durationMs;
}

export function scoreRun(run: LoadedRun, id: RunId, data: QuestionData, ctx: ScoreContext, grade?: RunGrade): RunResult {
    const answer = scoreAnswer(run.summary.finalText, data, ctx, grade);
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

// ---- the tables

const FAMILY_ORDER: Family[] = ["bigPicture", "list", "chain"];
const FAMILY_LABEL: Record<Family, string> = { bigPicture: "Big-picture", list: "Complete-list", chain: "Connection" };
const ARM_ORDER = ["baseline", "nebulosity", "nebulosity-upfront"];
const rank = (order: readonly string[], x: string): number => (order.includes(x) ? order.indexOf(x) : order.length);

function groups<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
    return map;
}

export type QuestionArmRow = {
    question: string; family: Family; arm: string; runs: number; scores: (number | null)[]; mean: number | null; recall: number | null; precision: number | null;
};

/** One row per question and arm: the scores of its repeats in order, their mean, and a list's mean recall and precision. */
export function questionArmRows(results: readonly RunResult[], order: readonly string[]): QuestionArmRow[] {
    const rows = [...groups(results, (r) => `${r.question}${SEP}${r.arm}`).values()].map((group) => {
        const runs = [...group].sort((a, b) => a.repeat - b.repeat);
        return {
            question: runs[0].question, family: runs[0].family, arm: runs[0].arm, runs: runs.length, scores: runs.map((r) => r.score),
            mean: mean(runs.map((r) => r.score)), recall: mean(runs.map((r) => r.recall)), precision: mean(runs.map((r) => r.precision)),
        };
    });
    return rows.sort((a, b) => rank(order, a.question) - rank(order, b.question) || rank(ARM_ORDER, a.arm) - rank(ARM_ORDER, b.arm) || (a.arm < b.arm ? -1 : a.arm > b.arm ? 1 : 0));
}

export type FamilyArmRow = {
    family: Family; arm: string; runs: number; scored: number; mean: number | null; recall: number | null; precision: number | null;
    medianTokens: number | null; medianCostUsd: number | null; medianWallMs: number | null; medianToolCalls: number | null;
};

/** One row per family and arm: the mean score over the scored runs, and the medians over all the runs. */
export function familyArmRows(results: readonly RunResult[]): FamilyArmRow[] {
    const rows = [...groups(results, (r) => `${r.family}${SEP}${r.arm}`).values()].map((runs) => ({
        family: runs[0].family, arm: runs[0].arm, runs: runs.length, scored: runs.filter((r) => r.score !== null).length,
        mean: mean(runs.map((r) => r.score)), recall: mean(runs.map((r) => r.recall)), precision: mean(runs.map((r) => r.precision)),
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

export function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
    const cell = (s: string): string => s.replace(/\|/g, "\\|");
    const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;
    return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

const n2 = (x: number | null): string => (x === null ? "n/a" : x.toFixed(2));
const count = (x: number | null): string => (x === null ? "n/a" : Math.round(x).toLocaleString("en-US"));
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
        rows.map((r) => [r.question, r.arm, r.scores.map((s) => (s === null ? "open" : n2(s))).join(" / "), n2(r.mean), n2(r.recall), n2(r.precision)]),
    );
}

export function renderFamilyTable(rows: readonly FamilyArmRow[]): string {
    return renderTable(
        ["Family", "Arm", "Runs (scored / all)", "Mean score", "Recall", "Precision", "Median tokens", "Median cost est.", "Median wall", "Median tool calls"],
        rows.map((r) => [
            FAMILY_LABEL[r.family], r.arm, `${r.scored} / ${r.runs}`, n2(r.mean), n2(r.recall), n2(r.precision),
            count(r.medianTokens), usd(r.medianCostUsd), seconds(r.medianWallMs), r.medianToolCalls === null ? "n/a" : String(r.medianToolCalls),
        ]),
    );
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
        runs.push({
            name, summary: summarizeRun(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString("utf8")),
            startedAt: typeof meta?.startedAt === "string" ? meta.startedAt : null,
            endedAt: typeof meta?.endedAt === "string" ? meta.endedAt : null,
            resultNotes: Array.isArray(meta?.resultNotes) ? meta.resultNotes.filter((n): n is string => typeof n === "string") : [],
        });
        kept.add(name);
    }
    for (const name of index.keys()) if (!kept.has(name)) warnings.push(`${name} is in the index but has no transcript (an interrupted write); ignored`);
    return { runs, warnings };
}

// ---- the command

const forward = (p: string): string => p.replace(/\\/g, "/");
const USAGE = "usage: npm run eval:score [-- --only <ids>] [--runs <dir>] [--out <file>]";

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
    let runsDir = `${checkout}/eval/runs`;
    let outFile = `${checkout}/eval/results.json`;
    for (let i = 0; i < args.length; i++){
        const value = (): string => {
            const v = args[++i];
            if (v === undefined || v.startsWith("--")) throw new Stop(`${args[i - 1]} needs a value. ${USAGE}`);
            return v;
        };
        if (args[i] === "--only") only = value().split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
        else if (args[i] === "--runs") runsDir = forward(path.resolve(value()));
        else if (args[i] === "--out") outFile = forward(path.resolve(value()));
        else throw new Stop(`unknown argument ${args[i]}. ${USAGE}`);
    }

    const file = readJson<{ commit: string; questions: { id: string; family: Family; truth?: string; rubric?: string }[] }>(`${checkout}/eval/questions.json`);
    const unknown = (only ?? []).filter((id) => !file.questions.some((q) => q.id === id));
    if (unknown.length > 0 || only?.length === 0) throw new Stop(`no such question: ${unknown.join(", ") || "(none given)"}. The questions are ${file.questions.map((q) => q.id).join(", ")}.`);
    const questions: QuestionData[] = file.questions.filter((q) => only === null || only.includes(q.id)).map((q) => ({
        id: q.id, family: q.family,
        ...(q.truth ? { truth: readJson<ListTruthFile | ChainTruthFile>(`${checkout}/${q.truth}`) } : {}),
        ...(q.rubric ? { rubric: readJson<Rubric>(`${checkout}/${q.rubric}`) } : {}),
    }));
    const order = questions.map((q) => q.id);
    const adjudicated = fs.existsSync(`${checkout}/eval/truth/adjudicated.json`) ? readJson<Adjudicated[]>(`${checkout}/eval/truth/adjudicated.json`) : [];
    const grades = fs.existsSync(`${checkout}/eval/grading/grades.json`) ? readJson<Record<string, RunGrade>>(`${checkout}/eval/grading/grades.json`) : {};

    const loaded = loadRuns(runsDir);
    const warnings = [...loaded.warnings];
    const wanted = loaded.runs.filter((r) => order.includes(parseRunName(r.name)!.question));
    for (const r of loaded.runs) if (!file.questions.some((q) => q.id === parseRunName(r.name)!.question)) warnings.push(`${r.name} is for a question that isn't in eval/questions.json; ignored`);

    let results: RunResult[] = [];
    let edges: [string, string][] = [];
    if (wanted.length > 0){
        const vscode = forward(path.resolve(checkout, "..", "vscode"));
        const head = execFileSync("git", ["-C", vscode, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        if (!head.startsWith(file.commit.slice(0, 8))) throw new Stop(`${vscode} is at ${head}, not ${file.commit}: the truth is for that commit.`);
        const g = scanRepo(vscode);
        edges = g.edges;
        const ctx: ScoreContext = { repoRoot: "<vscode>", known: new Set(g.files), imports: makeImports(g.edges, adjudicated) };
        results = wanted.map((r) => {
            const id = parseRunName(r.name)!;
            return scoreRun(r, id, questions.find((q) => q.id === id.question)!, ctx, grades[r.name]);
        });
        if (JSON.stringify(results.map((r) => r.name)) !== JSON.stringify([...new Set(results.map((r) => r.name))])) warnings.push("two runs share a name");
    }
    for (const j of contradictions(edges, adjudicated)) warnings.push(`eval/truth/adjudicated.json says ${j.from} doesn't import ${j.to}, but the scanner has that edge; the scanner's edge counts. Fix the entry or the truth.`);
    for (const q of questions){
        if (q.truth && !q.truth.verified) warnings.push(`${q.id}: the truth is not hand-verified yet (verified: false)`);
        const unchecked = (q.rubric?.points ?? []).filter((p) => p.holds === null).length;
        if (unchecked > 0) warnings.push(`${q.id}: ${unchecked} rubric points are not checked against the code yet (holds: null); they count as holding`);
    }

    console.log(results.length === 0 ? `No runs of ${order.join(", ")} in ${runsDir}.\n` : `${results.length} runs scored from ${runsDir}.\n`);
    console.log(`## Runs\n\n${renderRunTable(results, order)}\n`);
    console.log(`## Per question and arm\n\n${renderQuestionTable(questionArmRows(results, order))}\n`);
    console.log(`## Per family and arm\n\n${renderFamilyTable(familyArmRows(results))}\n`);
    if (warnings.length > 0) console.log(`## Warnings\n\n${warnings.map((w) => `- ${w}`).join("\n")}\n`);

    if (results.length > 0 && only === null){
        fs.writeFileSync(outFile, `${JSON.stringify({ commit: file.commit, runs: results }, null, 2)}\n`);
        console.log(`Wrote ${outFile}.`);
    } else if (results.length > 0) console.log("--only: the results file was not written.");

    const steps = pendingSteps(results);
    if (steps.length > 0){
        console.log(`\n## Chain steps to adjudicate\n\nRead the source for each step and add {"from", "to", "imports", "note"} to eval/truth/adjudicated.json:\n\n${steps.map(([a, b]) => `- ${a} -> ${b}`).join("\n")}`);
        process.exitCode = 1;
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
