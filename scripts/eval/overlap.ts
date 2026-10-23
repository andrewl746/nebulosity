/**
 * npm run eval:overlap -- [--eval <dir>]   (default eval2)
 *
 * R1's check (V1.6's plan): tuning never sees the eval, so no question of the eval may ask about what a dev-set question
 * asked about. A question's targets are the file or folder it asks about, a chain's two ends and a violation's two folders;
 * the folders an impact question counts by and a pairs question's names are not targets. A calls question's (callers,
 * breaks, adopt, injects, task) are its type's file and the method or type it names, so another method of a type the dev
 * set asked about overlaps through the file. It also checks Task 14's rule for
 * task sessions: a session question's targets differ from every single question's.
 *
 * The eval's questions come from <dir>/questions.json, or from <dir>/truth-specs.json while there is no questions.json
 * yet; the dev set's from <dir>/dev/questions.json. Paths compare exactly, per repo. It prints one line per shared target
 * and exits 1 when there is any; it prints nothing when there is none.
 */
import fs from "fs";
import path from "path";
import type { TruthSpec } from "./build-truth";

/** What one question asks about: its repo, its session when it belongs to one, and its targets as repo paths. */
export type Asked = { id: string; repo: string; session?: string; targets: string[] };
type Question = { id: string; repo?: string; kind?: string; prompt?: string; truth?: string; session?: string };

const clean = (p: string): string => p.trim().replace(/^\.\//, "").replace(/\/+$/, "");
const unique = (paths: readonly string[]): string[] => [...new Set(paths.map(clean).filter((p) => p !== ""))];

/**
 * The repo paths a prompt asks about: its backticked spans that look like paths (holding a / or a dot). An impact
 * question's first span is its file (the rest are the folders it counts by), and a pairs question's is its folder (the
 * rest are names); every other kind asks about all of its paths.
 */
export function targetsOfPrompt(kind: string | undefined, prompt: string): string[] {
    const spans = [...prompt.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((s) => /[/.]/.test(s));
    return unique(kind === "impact" || kind === "pairs" ? spans.slice(0, 1) : spans);
}

/** The targets a spec's (or a truth file's) own fields name, by kind. */
function targetsOfFields(fields: Record<string, unknown>): string[] {
    const s = (key: string): string[] => (typeof fields[key] === "string" ? [fields[key] as string] : []);
    switch (fields.kind){
        case "list": case "impact": case "entries": return unique(s("target"));
        case "chain": case "violations": return unique([...s("from"), ...s("to")]);
        case "cycle": return unique(s("file"));
        case "unused": case "pairs": return unique(s("folder"));
        case "callers": case "breaks": case "adopt": case "injects": case "task": {
            const named = typeof fields.type !== "string" ? [] : [typeof fields.member === "string" ? `${fields.type}.${fields.member}` : fields.type];
            return unique([...s("file"), ...named]);
        }
        default: return [];
    }
}

export function askedOfSpec(spec: TruthSpec & { session?: string }): Asked {
    return { id: spec.id, repo: spec.repo ?? "", ...(spec.session !== undefined ? { session: spec.session } : {}), targets: targetsOfFields(spec) };
}

/**
 * A question's targets: its prompt's, and its truth's fields' too when it names a truth `readTruth` can read. A question
 * without a repo belongs to `defaultRepo` (an eval with one repo, as Eval #1's questions are written).
 */
export function askedOfQuestion(q: Question, defaultRepo?: string, readTruth?: (truth: string) => Record<string, unknown> | null): Asked {
    const repo = q.repo ?? defaultRepo;
    if (repo === undefined) throw new Error(`${q.id} names no repo, and the eval has more than one.`);
    const fromTruth = q.truth !== undefined && readTruth ? readTruth(q.truth) : null;
    const targets = unique([...targetsOfPrompt(q.kind, q.prompt ?? ""), ...(fromTruth ? targetsOfFields(fromTruth) : [])]);
    return { id: q.id, repo, ...(q.session !== undefined ? { session: q.session } : {}), targets };
}

/**
 * Every target an eval question shares with a dev-set question, then every target a session question shares with a single
 * question, each as a sentence naming both; the same path in two repos is two files. [] when there are none.
 */
export function overlaps(asked: readonly Asked[], dev: readonly Asked[]): string[] {
    const lines: string[] = [];
    const shared = (a: Asked, b: Asked): string[] => (a.repo === b.repo ? a.targets.filter((t) => b.targets.includes(t)) : []);
    for (const q of asked) for (const d of dev) for (const t of shared(q, d)) lines.push(`${q.repo}: ${t} is a target of ${q.id} and of the dev set's ${d.id}`);
    const singles = asked.filter((q) => q.session === undefined);
    for (const q of asked.filter((x) => x.session !== undefined)){
        for (const s of singles) for (const t of shared(q, s)) lines.push(`${q.repo}: ${t} is a target of ${q.id} (session ${q.session}) and of the single question ${s.id}`);
    }
    return lines;
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

/** The check on an eval folder: its questions (or, before they exist, its truth specs) against its dev set. */
export function overlapReport(dir: string): string[] {
    const evalJson = path.join(dir, "eval.json");
    const repos = fs.existsSync(evalJson) ? Object.keys((readJson(evalJson) as { repos?: Record<string, unknown> }).repos ?? {}) : [];
    const defaultRepo = repos.length === 1 ? repos[0] : undefined;
    // a truth path is written relative to Nebulosity's checkout, the eval folder's parent
    const readTruth = (truth: string): Record<string, unknown> | null => {
        const file = path.resolve(path.dirname(path.resolve(dir)), truth);
        return fs.existsSync(file) ? (readJson(file) as Record<string, unknown>) : null;
    };
    const questionsOf = (file: string): Question[] => (readJson(file) as { questions: Question[] }).questions;
    const devFile = path.join(dir, "dev", "questions.json");
    const dev = fs.existsSync(devFile) ? questionsOf(devFile).map((q) => askedOfQuestion(q, defaultRepo)) : [];
    const questionsFile = path.join(dir, "questions.json");
    const asked = fs.existsSync(questionsFile)
        ? questionsOf(questionsFile).map((q) => askedOfQuestion(q, defaultRepo, readTruth))
        : (readJson(path.join(dir, "truth-specs.json")) as (TruthSpec & { session?: string })[]).map(askedOfSpec);
    return overlaps(asked, dev);
}

function main(): void {
    const argv = process.argv.slice(2);
    const at = argv.indexOf("--eval");
    if (argv.length > 0 && (at !== 0 || argv.length !== 2)){
        console.error("usage: npm run eval:overlap -- [--eval <dir> (default eval2)]");
        process.exitCode = 1;
        return;
    }
    const dir = path.resolve(__dirname, "..", "..", at === 0 ? argv[1] : "eval2");
    try {
        const lines = overlapReport(dir);
        for (const line of lines) console.log(line);
        if (lines.length > 0) process.exitCode = 1;
    } catch (error){
        console.error((error as Error).message);
        process.exitCode = 1;
    }
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]overlap\.ts$/.test(process.argv[1] ?? "")) main();
