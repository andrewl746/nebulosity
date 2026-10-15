/**
 * npm run eval:grading -- sheets
 * npm run eval:grading -- merge
 *
 * Blind grading of the big-picture answers (Task 19 Step 4 in docs/plans/2026-10-13-v1-5-ship.md).
 *   sheets: writes one sheet per big-picture run to eval/grading/sheets/<8 hex>.json, { id, question, points that hold,
 *           answer }, with no arm and no run name, and keeps the id -> run map in .nebulosity/eval/grading-key.json. It
 *           is idempotent: a run that already has a sheet keeps its id and file; only new runs get a new sheet. The
 *           answers are not redacted, so it prints how many mention "nebulosity" or "mcp__" (the results disclose it).
 *   merge:  reads each grader's reply (eval/grading/<id>.json), checks its shape, joins it to its run through the key
 *           and writes eval/grading/grades.json (the shape score.ts reads: run name -> point id -> { score, sentence }),
 *           then copies the key to eval/grading/key.json: grading is done, so the mapping is published. It refuses
 *           (exit 1, listing every problem) and writes nothing when any sheet has no reply or any reply is malformed.
 * The owner's review of the grades goes in eval/grading/review.json (grader 1's replies stay untouched); merge applies it on
 * top of the merged grades, so re-running merge can never undo the review. A ruling that no longer fits refuses the merge.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { loadDefinition } from "./definition";
import { parseRunName, type Rubric, type RunGrade } from "./score";
import { summarizeRun } from "./transcript";

export type Sheet = { id: string; question: string; points: { id: string; text: string }[]; answer: string };
export type Reply = { id: string; points: { id: string; score: number; quote: string }[] };
/** Sheet id -> run name. */
export type Key = Record<string, string>;

const SCORES = [0, 0.5, 1];

/** A sheet shows the grader only the point texts that hold: `check` and `note` hint at the expected answer beyond them. */
export function buildSheet(id: string, question: string, rubric: Rubric, answer: string): Sheet {
    const unchecked = rubric.points.find((p) => p.holds === null);
    if (unchecked !== undefined) throw new Error(`${rubric.id}: point ${unchecked.id} is unchecked (holds: null); settle it before grading`);
    return { id, question, points: rubric.points.filter((p) => p.holds === true).map((p) => ({ id: p.id, text: p.text })), answer };
}

/** Why a reply can't be used for its sheet: an empty list means it is fine. */
export function validateReply(sheet: Sheet, reply: unknown): string[] {
    const r = reply as { id?: unknown; points?: unknown } | null;
    if (r === null || typeof r !== "object" || !Array.isArray(r.points)) return [`${sheet.id}: not an object with a points array`];
    const problems: string[] = [];
    if (r.id !== sheet.id) problems.push(`${sheet.id}: the reply's id is ${JSON.stringify(r.id)}`);
    const known = new Set(sheet.points.map((p) => p.id));
    const seen = new Set<string>();
    for (const raw of r.points as unknown[]){
        const p = raw as { id?: unknown; score?: unknown; quote?: unknown } | null;
        const pid = String(p?.id);
        if (!known.has(pid)){
            problems.push(`${sheet.id}: unknown point ${pid}`);
            continue;
        }
        if (seen.has(pid)) problems.push(`${sheet.id}: point ${pid} appears more than once`);
        seen.add(pid);
        if (typeof p?.score !== "number" || !SCORES.includes(p.score)) problems.push(`${sheet.id}: ${pid} has a score that isn't 0, 0.5 or 1`);
        if (typeof p?.quote !== "string") problems.push(`${sheet.id}: ${pid} has a quote that isn't a string`);
    }
    for (const id of known) if (!seen.has(id)) problems.push(`${sheet.id}: point ${id} is missing`);
    return problems;
}

/** Joins validated replies to their runs through the key, in grades.json's shape, run names sorted. */
export function mergeGrades(key: Key, replies: Record<string, Reply>): Record<string, RunGrade> {
    const grades: Record<string, RunGrade> = {};
    for (const [id, run] of Object.entries(key).sort(([, a], [, b]) => a.localeCompare(b))){
        const grade: RunGrade = {};
        for (const p of replies[id].points) grade[p.id] = { score: p.score, sentence: p.quote };
        grades[run] = grade;
    }
    return grades;
}

export type Ruling = { sheet: string; point: string; grader1: number; grader2?: number; score: number; sentence: string };
export type Review = { rulings: Ruling[] } & Record<string, unknown>;

/** Puts the owner's rulings over the merged grades. Every ruling is checked first; any problem means nothing is applied. */
export function applyReview(grades: Record<string, RunGrade>, review: Review, key: Key): { grades: Record<string, RunGrade>; changed: number; problems: string[] } {
    const out: Record<string, RunGrade> = {};
    for (const [run, g] of Object.entries(grades)) out[run] = { ...g };
    const problems: string[] = [];
    let changed = 0;
    for (const r of review.rulings){
        const run = key[r.sheet];
        if (run === undefined){
            problems.push(`${r.sheet}: not a sheet in the key`);
            continue;
        }
        const current = out[run]?.[r.point];
        if (current === undefined){
            problems.push(`${r.sheet} ${r.point}: not a point on that sheet`);
            continue;
        }
        if (current.score !== r.grader1){
            problems.push(`${r.sheet} ${r.point}: the ruling says grader 1 gave ${r.grader1} but the merged grade is ${current.score}; the replies changed under the review`);
            continue;
        }
        if (!SCORES.includes(r.score)){
            problems.push(`${r.sheet} ${r.point}: the ruled score ${r.score} isn't 0, 0.5 or 1`);
            continue;
        }
        if (r.score !== current.score) changed++;
        out[run][r.point] = { score: r.score, sentence: r.sentence };
    }
    return { grades: out, changed, problems };
}

const forward = (p: string): string => p.replace(/\\/g, "/");
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const writeJson = (file: string, value: unknown): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

type QuestionsFile = { questions: { id: string; family: string; prompt: string; rubric?: string }[] };

function sheets(checkout: string, evalName: string): void {
    const keyFile = `${checkout}/.nebulosity/${evalName}/grading-key.json`;
    const key: Key = fs.existsSync(keyFile) ? readJson<Key>(keyFile) : {};
    const sheetsDir = `${checkout}/${evalName}/grading/sheets`;
    const bigPicture = readJson<QuestionsFile>(`${checkout}/${evalName}/questions.json`).questions.filter((q) => q.family === "bigPicture");
    const runsDir = `${checkout}/${evalName}/runs`;
    const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith(".jsonl.gz")).sort() : [];
    const hasSheet = new Set(Object.values(key));
    let made = 0;
    let empty = 0;
    for (const file of files){
        const name = file.replace(/\.jsonl\.gz$/, "");
        const q = bigPicture.find((b) => b.id === parseRunName(name)?.question);
        if (q === undefined || hasSheet.has(name)) continue;
        if (q.rubric === undefined){
            console.error(`${q.id} has no rubric field in ${evalName}/questions.json`);
            process.exit(1);
        }
        const answer = summarizeRun(zlib.gunzipSync(fs.readFileSync(`${runsDir}/${file}`)).toString("utf8")).finalText ?? "";
        if (answer === "") empty++;
        let id: string;
        do id = crypto.randomBytes(4).toString("hex"); while (key[id] !== undefined);
        writeJson(`${sheetsDir}/${id}.json`, buildSheet(id, q.prompt, readJson<Rubric>(`${checkout}/${q.rubric}`), answer));
        key[id] = name;
        writeJson(keyFile, key);   // after each sheet, so a crash can't leave a sheet without its key
        made++;
    }
    // the disclosure counts every sheet in the key, not only the new ones
    let mentions = 0;
    for (const id of Object.keys(key)){
        const file = `${sheetsDir}/${id}.json`;
        if (fs.existsSync(file) && /nebulosity|mcp__/i.test(readJson<Sheet>(file).answer)) mentions++;
    }
    console.log(`new sheets: ${made} (${Object.keys(key).length} in all) in ${sheetsDir}; key: ${keyFile}`);
    console.log(`answers mentioning nebulosity or mcp__: ${mentions} of ${Object.keys(key).length} (case-insensitive; the answers are not redacted)`);
    if (empty > 0) console.log(`${empty} of the new answers have no final text; their sheets carry an empty answer.`);
}

function merge(checkout: string, evalName: string): void {
    const keyFile = `${checkout}/.nebulosity/${evalName}/grading-key.json`;
    if (!fs.existsSync(keyFile)){
        console.error(`${keyFile} not found: run sheets first`);
        process.exit(1);
    }
    const key = readJson<Key>(keyFile);
    const problems: string[] = [];
    const replies: Record<string, Reply> = {};
    for (const id of Object.keys(key).sort()){
        const sheetFile = `${checkout}/${evalName}/grading/sheets/${id}.json`;
        const replyFile = `${checkout}/${evalName}/grading/${id}.json`;
        if (!fs.existsSync(sheetFile)){
            problems.push(`${id}: its sheet is missing`);
            continue;
        }
        if (!fs.existsSync(replyFile)){
            problems.push(`${id}: no reply (${replyFile})`);
            continue;
        }
        let reply: unknown;
        try{
            reply = readJson<unknown>(replyFile);
        } catch(e){
            problems.push(`${id}: the reply isn't JSON (${(e as Error).message})`);
            continue;
        }
        const bad = validateReply(readJson<Sheet>(sheetFile), reply);
        if (bad.length > 0) problems.push(...bad);
        else replies[id] = reply as Reply;
    }
    if (problems.length > 0){
        console.error(`merge refused, nothing written:\n  ${problems.join("\n  ")}`);
        process.exit(1);
    }
    let grades = mergeGrades(key, replies);
    let reviewNote = "";
    const reviewFile = `${checkout}/${evalName}/grading/review.json`;
    if (fs.existsSync(reviewFile)){
        const review = readJson<Review>(reviewFile);
        const applied = applyReview(grades, review, key);
        if (applied.problems.length > 0){
            console.error(`merge refused, nothing written (the owner's review does not fit):\n  ${applied.problems.join("\n  ")}`);
            process.exit(1);
        }
        grades = applied.grades;
        reviewNote = `owner's review: ${review.rulings.length} rulings, ${applied.changed} changed grades`;
    }
    writeJson(`${checkout}/${evalName}/grading/grades.json`, grades);
    writeJson(`${checkout}/${evalName}/grading/key.json`, Object.fromEntries(Object.entries(key).sort(([a], [b]) => a.localeCompare(b))));
    if (reviewNote !== "") console.log(reviewNote.trim());
    console.log(`${Object.keys(grades).length} runs graded -> ${evalName}/grading/grades.json; the key is published as ${evalName}/grading/key.json`);
}

export const GRADING_USAGE = "usage: npm run eval:grading -- sheets | merge [--eval <dir> (default eval)]";

/** The command and the eval folder, in any order; the usage line for --eval without a value, or anything but one command. */
export function parseGradingArgs(argv: readonly string[]): { command: "sheets" | "merge"; evalDir: string } | { error: string } {
    let command: "sheets" | "merge" | null = null;
    let evalDir = "eval";
    for (let i = 0; i < argv.length; i++){
        const arg = argv[i];
        if (arg === "--eval"){
            const value = argv[++i];
            if (value === undefined || value.startsWith("--")) return { error: GRADING_USAGE };
            evalDir = value;
        } else if ((arg === "sheets" || arg === "merge") && command === null) command = arg;
        else return { error: GRADING_USAGE };
    }
    return command === null ? { error: GRADING_USAGE } : { command, evalDir };
}

function main(): void {
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    const args = parseGradingArgs(process.argv.slice(2));
    if ("error" in args){
        console.error(args.error);
        process.exit(1);
    }
    let evalName: string;
    try{
        evalName = path.basename(loadDefinition(path.resolve(checkout, args.evalDir)).dir);
    } catch(e){
        // a folder with no eval.json, or one that isn't valid: a sentence, not a stack trace
        console.error(`${args.evalDir}: ${(e as Error).message.split("\n")[0]}`);
        process.exit(1);
    }
    if (args.command === "sheets") sheets(checkout, evalName);
    else merge(checkout, evalName);
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]grading\.ts$/.test(process.argv[1] ?? "")) main();
