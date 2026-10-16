/**
 * npx tsx scripts/eval/calls-candidates.ts --eval <dir>
 *
 * The index's side of the call truths' disagreement sheet (ADR-060, R2; Task 10). For each call or task spec of <dir>'s
 * truth-specs.json it asks the index (lib/engine/calls.ts, the read-only database) for the same question, compares its files
 * with the truth in <dir>/truth/<id>.json (TypeScript's checker, ts-calls.ts), and writes
 *   .nebulosity/<dir>/calls-disagreements.md   per question, every file only one side has, with the index's lines and the checker's
 * The index is consulted here only for candidates: every line of the sheet is read in the source and decided in
 * <dir>/truth/calls-adjudicated.json. Imports lib/ on purpose, so it is not one of the files scan.test.ts pins as independent.
 * The repos and the database are only read.
 */
import fs from "fs";
import path from "path";
import { useReadOnlyDatabase } from "../../lib/db/client";
import { calls, type CallsAnswer } from "../../lib/engine/calls";
import { callSitesFor, specsFor, type CallSpec, type CallTruthFile, type TaskSpec, type TaskTruthFile } from "./build-truth";
import { loadDefinition } from "./definition";
import { programFor } from "./ts-calls";

const forward = (p: string): string => p.replace(/\\/g, "/");
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isCall = (s: { kind: string }): s is CallSpec | TaskSpec => ["callers", "breaks", "adopt", "injects", "task"].includes(s.kind);

/** What the index says for a spec: the files for its kind, each with the lines it reports (none for a file that only declares). */
export type IndexSide = Map<string, string>;

/** The index's files for a spec's kind: callers and adopt every category's files; breaks and a task those and `declaring`; injects the type answer's files. */
export function indexFiles(answer: CallsAnswer, kind: CallSpec["kind"] | "task"): IndexSide {
    const out: IndexSide = new Map();
    if (answer.kind === "ambiguous") throw new Error(`"${answer.name}" is ambiguous: ${answer.candidates.map((c) => `${c.path}:${c.line}`).join(", ")}`);
    if (kind === "injects"){
        if (answer.kind !== "type") throw new Error("an injects spec got a member answer");
        for (const f of answer.files) out.set(f.path, `L${f.lines.join(", L")} (${f.hows.join(", ")})`);
        return out;
    }
    if (answer.kind !== "member") throw new Error(`a ${kind} spec got a type answer: it needs a member`);
    for (const f of answer.files) out.set(f.path, `L${f.lines.join(", L")} (${[...new Set(f.sites.map((s) => s.category))].join(", ")})`);
    if (kind === "breaks" || kind === "task") for (const d of answer.declaring) if (!out.has(d)) out.set(d, "declares the member");
    return out;
}

/** The files only one side has, sorted. */
export function differences(index: ReadonlySet<string>, checker: ReadonlySet<string>): { indexOnly: string[]; checkerOnly: string[] } {
    return {
        indexOnly: [...index].filter((f) => !checker.has(f)).sort(byPath),
        checkerOnly: [...checker].filter((f) => !index.has(f)).sort(byPath),
    };
}

function main(): void {
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--eval") throw new Error("usage: npx tsx scripts/eval/calls-candidates.ts --eval <dir>");
    const definition = loadDefinition(path.resolve(checkout, argv[1]));
    const dir = forward(definition.dir);
    const specs = specsFor(definition).filter(isCall);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it makes this process open the database read-only (ADR-044)
    useReadOnlyDatabase();

    const programs = new Map<string, ReturnType<typeof programFor>>();
    const out = [
        `# Where the index and the checker disagree on the calls, for ${definition.name}`, "",
        "Written by `scripts/eval/calls-candidates.ts`; not committed. The index (lib/engine/calls.ts) is consulted here only for candidates: read each line in the source and decide it in calls-adjudicated.json ({ id, file, decision, line, why }).", "",
    ];
    for (const spec of specs){
        const repo = spec.repo!;
        const root = forward(path.resolve(checkout, definition.repos[repo].path));
        const truthFile = `${dir}/truth/${spec.id}.json`;
        if (!fs.existsSync(truthFile)) throw new Error(`${spec.id}: ${truthFile} doesn't exist yet: run npm run eval:truth first.`);
        const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as CallTruthFile | TaskTruthFile;
        const symbol = spec.kind === "injects" ? spec.type : `${spec.type}.${spec.member}`;
        let answer: CallsAnswer;
        try {
            answer = calls(root, { symbol, path: spec.file }, { groupBy: null, ...(spec.within === undefined ? {} : { within: spec.within }) });
        } catch (error){
            throw new Error(`${spec.id}: the index can't answer ${symbol} in ${spec.file}: ${(error as Error).message}`);
        }
        let index: IndexSide;
        try {
            index = indexFiles(answer, spec.kind);
        } catch (error){
            throw new Error(`${spec.id}: ${(error as Error).message}`);
        }
        const checkerFiles = new Set(truth.kind === "task" ? truth.change : truth.files);
        if (!programs.has(repo)) programs.set(repo, programFor(root, { project: definition.repos[repo].project }));
        const sites = callSitesFor(spec, { program: programs.get(repo)!.program, root }).sites;
        const { indexOnly, checkerOnly } = differences(new Set(index.keys()), checkerFiles);
        out.push(`## ${spec.id}: ${spec.kind} of \`${symbol}\` (${spec.file})${spec.within !== undefined ? ` within \`${spec.within}\`` : ""}`, "",
            `The index has ${index.size} files, the checker ${checkerFiles.size}; ${indexOnly.length} only the index's, ${checkerOnly.length} only the checker's.`, "");
        if (indexOnly.length + checkerOnly.length === 0) out.push("They agree on every file.", "");
        indexOnly.forEach((f, i) => out.push(`${i + 1}. only the index: \`${f}\` (${index.get(f)})`));
        checkerOnly.forEach((f, i) => out.push(`${indexOnly.length + i + 1}. only the checker: \`${f}\` (${sites.filter((s) => s.file === f).map((s) => `L${s.line} ${s.why}`).join("; ") || "added by a verdict"})`));
        out.push("");
        console.log(`${spec.id}: index ${index.size}, checker ${checkerFiles.size}, ${indexOnly.length} only the index's, ${checkerOnly.length} only the checker's`);
    }
    const sheetDir = `${checkout}/.nebulosity/${path.basename(dir)}`;
    fs.mkdirSync(sheetDir, { recursive: true });
    fs.writeFileSync(`${sheetDir}/calls-disagreements.md`, `${out.join("\n")}\n`);
    console.log(`sheet in ${sheetDir}/calls-disagreements.md`);
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]calls-candidates\.ts$/.test(process.argv[1] ?? "")) main();
