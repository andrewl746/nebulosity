/**
 * npm run eval:truth -- <path to the vscode checkout> [--force]
 *
 * Builds the eval's ground truth for the ten complete-list and connection questions (D2, R3 in
 * docs/plans/2026-10-13-v1-5-ship.md) from scripts/eval/scan.ts and scripts/eval/truth.ts alone: nothing from lib/, so the
 * answers never come from Nebulosity's index. It writes
 *   eval/truth/<id>.json            one truth per question, unverified: Task 17's hand check turns it on
 *   eval/truth/adjudicated.json     [] when missing: chain steps the scanner lacks, decided by reading the source
 *   .nebulosity/eval/truth-evidence.md   for every truth edge, the line(s) that made it, for that hand check (not committed)
 * A truth file that already carries a hand check (verified, or notes) is kept, never rebuilt over, unless --force is given.
 * ../vscode is only read.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadDefinition } from "./definition";
import { importSpecifiers, resolveRelative, scanRepo } from "./scan";
import { directImporters, outsideImporters, shortestChain, transitiveDependents, type Graph } from "./truth";


export type ListSpec = { id: string; kind: "list"; target: string; scope: "direct" | "outside" | "transitive"; planning: string };
export type ChainSpec = { id: string; kind: "chain"; from: string; to: string; planning: string };
export type TruthSpec = ListSpec | ChainSpec;

export type ListTruthFile = { id: string; kind: "list"; target: string; scope: ListSpec["scope"]; files: string[]; verified: boolean; notes: unknown[] };
export type ChainTruthFile = {
    id: string; kind: "chain"; from: string; to: string; connected: boolean;
    /** Steps (imports) in the shortest chain, one fewer than the example's files; null when nothing connects. */
    shortest: number | null; example: string[] | null; verified: boolean; notes: unknown[];
};

/** D2's ten truths. `planning` is the size the planning-time scan found, to compare the real one against. */
export const TRUTH_TABLE: TruthSpec[] = [
    { id: "cl1", kind: "list", target: "src/vs/workbench/contrib/search/common/search.ts", scope: "direct", planning: "22 files" },
    { id: "cl2", kind: "list", target: "src/vs/workbench/contrib/debug", scope: "outside", planning: "38 files" },
    { id: "cl3", kind: "list", target: "src/vs/editor/standalone", scope: "outside", planning: "3 files" },
    { id: "cl4", kind: "list", target: "src/vs/workbench/contrib/markers/common/markers.ts", scope: "transitive", planning: "63 files (10 direct)" },
    { id: "cl5", kind: "list", target: "src/vs/platform/undoRedo", scope: "outside", planning: "55 files" },
    { id: "cn1", kind: "chain", from: "src/vs/workbench/workbench.desktop.main.ts", to: "src/vs/workbench/contrib/terminal/browser/terminalInstance.ts", planning: "4 steps" },
    { id: "cn2", kind: "chain", from: "src/vs/workbench/workbench.web.main.ts", to: "src/vs/workbench/contrib/debug/browser/debugSession.ts", planning: "5 steps" },
    { id: "cn3", kind: "chain", from: "src/vs/workbench/api/common/extHost.api.impl.ts", to: "src/vs/editor/common/model/textModel.ts", planning: "4 steps (through notebook code)" },
    { id: "cn4", kind: "chain", from: "src/vs/base/common/strings.ts", to: "src/vs/workbench", planning: "none" },
    { id: "cn5", kind: "chain", from: "src/vs/workbench/contrib/scm/browser/scmViewPane.ts", to: "src/vs/platform/undoRedo/common/undoRedo.ts", planning: "3 steps" },
];

export function buildTruth(g: Graph, spec: ListSpec): ListTruthFile;
export function buildTruth(g: Graph, spec: ChainSpec): ChainTruthFile;
export function buildTruth(g: Graph, spec: TruthSpec): ListTruthFile | ChainTruthFile;
export function buildTruth(g: Graph, spec: TruthSpec): ListTruthFile | ChainTruthFile {
    if (spec.kind === "list"){
        const files = spec.scope === "direct" ? directImporters(g, spec.target)
            : spec.scope === "outside" ? outsideImporters(g, spec.target)
            : transitiveDependents(g, spec.target);
        return { id: spec.id, kind: "list", target: spec.target, scope: spec.scope, files, verified: false, notes: [] };
    }
    const example = shortestChain(g, spec.from, spec.to);
    return {
        id: spec.id, kind: "chain", from: spec.from, to: spec.to, connected: example !== null,
        shortest: example === null ? null : example.length - 1, example, verified: false, notes: [],
    };
}

/**
 * For every file that depends on `target`, its next step toward it and how many steps away it is: a breadth-first walk
 * outward through the importers, each level in path order. The same files transitiveDependents lists; the evidence sheet
 * shows each one's edge to its next step, and those edges chain every dependent back to the target.
 */
export function successors(g: Graph, target: string): Map<string, { next: string; steps: number }> {
    const result = new Map<string, { next: string; steps: number }>();
    const seen = new Set([target]);
    let frontier = [target];
    for (let steps = 1; frontier.length > 0; steps++){
        const following: string[] = [];
        for (const file of frontier){
            for (const importer of directImporters(g, file)){
                if (seen.has(importer)) continue;
                seen.add(importer);
                result.set(importer, { next: file, steps });
                following.push(importer);
            }
        }
        frontier = following;
    }
    return result;
}

export type ImportLine = { target: string; line: number; text: string; spansLines: boolean };

/**
 * The lines of a file's text that import a file `wants` accepts, found the way the scanner reads the source (importSpecifiers,
 * resolveRelative) but one line at a time, so each hit has a line number to read. A statement whose keyword and path sit on
 * different lines (`import x from` then `'./x';`) is invisible to a single line: for a wanted file that no line found, the
 * lines holding the quoted path are listed, marked spansLines. Sorted by target, then line.
 */
export function importLines(text: string, fromFile: string, wants: (target: string) => boolean, known: ReadonlySet<string>): ImportLine[] {
    const lines = text.split(/\r?\n/);
    const hits: ImportLine[] = [];
    lines.forEach((line, i) => {
        for (const specifier of importSpecifiers(line)){
            const target = resolveRelative(fromFile, specifier, known);
            if (target !== null && target !== fromFile && wants(target)) hits.push({ target, line: i + 1, text: line.trim(), spansLines: false });
        }
    });
    const found = new Set(hits.map((h) => h.target));
    for (const specifier of new Set(importSpecifiers(text))){
        const target = resolveRelative(fromFile, specifier, known);
        if (target === null || target === fromFile || !wants(target) || found.has(target)) continue;
        lines.forEach((line, i) => {
            if (line.includes(`'${specifier}'`) || line.includes(`"${specifier}"`)) hits.push({ target, line: i + 1, text: line.trim(), spansLines: true });
        });
    }
    return hits.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : a.line - b.line));
}

// ---- the command

const forward = (p: string): string => p.replace(/\\/g, "/");
const inside = (p: string, folder: string): boolean => p.startsWith(`${folder}/`);
/** Inline code that survives a backtick in the text (a template literal on an import line). */
const code = (s: string): string => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``);
const clip = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n)}…` : s);

type Evidence = { root: string; known: ReadonlySet<string>; g: Graph };

/** One importer's evidence: for each file `wants` accepts, the lines that import it (or a flag that none was found). */
function importerEvidence(e: Evidence, importer: string, wants: (t: string) => boolean, expected: string[]): string[] {
    const hits = importLines(fs.readFileSync(path.join(e.root, importer), "utf8"), importer, wants, e.known);
    const out: string[] = [];
    // the targets the scanner's edges name, so a target without a line stands out
    const targets = [...new Set([...expected, ...hits.map((h) => h.target)])].sort();
    for (const target of targets){
        out.push(`   - → ${code(target)}`);
        const lines = hits.filter((h) => h.target === target);
        if (lines.length === 0) out.push("     - NO LINE FOUND: the scanner has this edge but no line resolves to it. Investigate.");
        for (const h of lines) out.push(`     - L${h.line}: ${code(clip(h.text))}${h.spansLines ? " (the statement spans lines; this line holds the quoted path)" : ""}`);
    }
    return out;
}

/** The expected targets of an importer: its scanner edges whose target `wants` accepts. */
const edgeTargets = (g: Graph, importer: string, wants: (t: string) => boolean): string[] =>
    g.edges.filter(([a, b]) => a === importer && wants(b)).map(([, b]) => b);

function listEvidence(e: Evidence, truth: ListTruthFile): string[] {
    const out = [`## ${truth.id.toUpperCase()}: ${truth.scope === "direct" ? "files that directly import" : truth.scope === "outside" ? "files outside the folder that import a file inside" : "files that depend, directly or not, on"} ${code(truth.target)} (${truth.files.length} files)`, ""];
    const via = truth.scope === "transitive" ? successors(e.g, truth.target) : null;
    if (via !== null){
        const missing = truth.files.filter((f) => !via.has(f));
        if (missing.length > 0 || via.size !== truth.files.length) throw new Error(`${truth.id}: the step map and transitiveDependents disagree`);
        out.push("Each dependent is shown with its edge to the next step toward the target; those edges chain it back to the target.", "");
    }
    truth.files.forEach((importer, i) => {
        const wants = truth.scope === "direct" ? (t: string): boolean => t === truth.target
            : truth.scope === "outside" ? (t: string): boolean => inside(t, truth.target)
            : (t: string): boolean => t === via!.get(importer)!.next;
        out.push(`${i + 1}. ${code(importer)}${via ? ` (${via.get(importer)!.steps} step${via.get(importer)!.steps === 1 ? "" : "s"} from the target)` : ""}`);
        out.push(...importerEvidence(e, importer, wants, edgeTargets(e.g, importer, wants)));
    });
    out.push("");
    return out;
}

function chainEvidence(e: Evidence, truth: ChainTruthFile): string[] {
    const out = [`## ${truth.id.toUpperCase()}: ${code(truth.from)} to ${code(truth.to)}`, ""];
    if (truth.example === null){
        const reached = transitiveDependents({ files: e.g.files, edges: e.g.edges.map(([a, b]) => [b, a] as const) }, truth.from);
        const wanted = (t: string): boolean => t === truth.to || inside(t, truth.to);
        out.push(`No chain: the scanner finds nothing in ${code(truth.to)} among the ${reached.length} files reachable from the first file. The first file's own imports, which Task 17's check reads by hand:`, "");
        const direct = new Set(e.g.edges.filter(([a]) => a === truth.from).map(([, b]) => b));
        out.push(`1. ${code(truth.from)}`, ...importerEvidence(e, truth.from, (x) => direct.has(x), [...direct]));
        out.push(`(Reachable from the first file and inside the target: ${reached.filter(wanted).length}.)`, "");
        return out;
    }
    out.push(`Shortest chain: ${truth.shortest} steps.`, "", ...truth.example.map((f, i) => `${i + 1}. ${code(f)}`), "");
    for (let i = 0; i + 1 < truth.example.length; i++){
        const [from, to] = [truth.example[i], truth.example[i + 1]];
        out.push(`Step ${i + 1}: ${code(from)} imports ${code(to)}`);
        out.push(...importerEvidence(e, from, (t) => t === to, [to]));
        out.push("");
    }
    return out;
}

/** Whether a truth file already on disk carries Task 17's hand check (verified, or notes), which a rebuild must not erase. */
function isHandChecked(file: string): boolean {
    if (!fs.existsSync(file)) return false;
    const old = JSON.parse(fs.readFileSync(file, "utf8")) as { verified?: boolean; notes?: unknown[] };
    return old.verified === true || (old.notes ?? []).length > 0;
}

const USAGE = "usage: npm run eval:truth -- <path to the repo's checkout> [--force] [--eval <dir> (default eval)]";

function main(): void {
    const args = process.argv.slice(2);
    const force = args.includes("--force");
    const given = args.indexOf("--eval");
    const evalDir = given >= 0 ? args[given + 1] : "eval";
    const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--eval");
    if (evalDir === undefined || evalDir.startsWith("--")){
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }
    if (paths.length !== 1){
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    const definition = loadDefinition(path.resolve(checkout, evalDir));
    const evalName = path.basename(definition.dir);
    const root = forward(path.resolve(paths[0]));
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    // the commit the definition pins for the repo at this path
    const repo = Object.values(definition.repos).find((r) => forward(path.resolve(checkout, r.path)) === root);
    if (repo === undefined){
        console.error(`${root} is none of the repos of ${evalName}/eval.json (${Object.values(definition.repos).map((r) => r.path).join(", ")}).`);
        process.exitCode = 1;
        return;
    }
    if (head !== repo.commit){
        console.error(`${root} is at ${head}, not ${repo.commit}: the eval's ground truth is for that commit.`);
        process.exitCode = 1;
        return;
    }
    const started = Date.now();
    const g = scanRepo(root);
    const known = new Set(g.files);
    console.log(`scanned ${root} at ${head.slice(0, 8)}: ${g.files.length} code files, ${g.edges.length} edges, ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const truthDir = `${checkout}/${evalName}/truth`;
    fs.mkdirSync(truthDir, { recursive: true });
    const sheet: string[] = [
        `# Truth evidence for VS Code ${head.slice(0, 8)}`, "",
        "Written by `npm run eval:truth` (scripts/eval/build-truth.ts); not committed. For every edge a truth rests on: the importing file, then the target, then the line(s) that import it.",
        "Task 17's hand check reads this sheet. Lines come from the scanner's own reading of each file, one line at a time.", "",
    ];
    const rows: { id: string; size: string; planning: string; example: string[] }[] = [];
    const sections: string[] = [];
    for (const spec of TRUTH_TABLE){
        const truth = buildTruth(g, spec);
        const size = truth.kind === "list" ? `${truth.files.length} files` : truth.connected ? `${truth.shortest} steps` : "none";
        rows.push({ id: truth.id, size, planning: spec.planning, example: truth.kind === "chain" ? truth.example ?? [] : [] });

        const file = `${truthDir}/${truth.id}.json`;
        if (!force && isHandChecked(file)) console.log(`${truth.id}: ${file} carries a hand check, so it was kept (--force rebuilds it). The evidence sheet is for the rebuilt truth.`);
        else fs.writeFileSync(file, `${JSON.stringify(truth, null, 2)}\n`);

        const e: Evidence = { root, known, g };
        sections.push(...(truth.kind === "list" ? listEvidence(e, truth) : chainEvidence(e, truth)));
    }
    sheet.push("| Question | Size | Planning scan |", "| --- | --- | --- |", ...rows.map((r) => `| ${r.id.toUpperCase()} | ${r.size} | ${r.planning} |`), "", ...sections);

    const adjudicated = `${truthDir}/adjudicated.json`;
    if (!fs.existsSync(adjudicated)) fs.writeFileSync(adjudicated, "[]\n");

    const evidenceFile = `${checkout}/.nebulosity/${evalName}/truth-evidence.md`;
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, `${sheet.join("\n")}\n`);
    for (const r of rows) console.log(`${r.id}: ${r.size} (planning scan: ${r.planning})${r.example.length ? `\n    ${r.example.join("\n    ")}` : ""}`);
    console.log(`evidence sheet: ${evidenceFile} (${fs.statSync(evidenceFile).size} bytes)`);
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]build-truth\.ts$/.test(process.argv[1] ?? "")) main();
