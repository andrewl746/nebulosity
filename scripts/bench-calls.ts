/**
 * npm run bench-calls -- --repo ../vscode --checker <checker.json>
 * npm run bench-calls -- --repo ../affine --sites <affine-sites.json> [--verdicts <file>]
 *
 * Calls Benchmark (S14, ADR-059): the index's calls against an independent answer, file by file, read-only.
 *   VS Code: TypeScript's checker over src/tsconfig.json (V1.7's design check, evidence/e2/out/checker.json), for the five
 *   planning methods (R-A allows them here). Both sides are kept to the program's own files (the tsconfig's fileNames, read
 *   without building a program). "Interface calls": files whose call the checker resolves to the interface's member; the
 *   index's files with a call on the interface, or on a sub-interface that doesn't declare the member (the checker files
 *   those under the interface, R-AB). "Interface + implementation": those, and the calls on a class that implements it.
 *   A call on a sub-interface that redeclares the member is counted apart.
 *   AFFiNE: the design check's syntactic L3 sets for its three planning methods; each file only one side has is read in
 *   the source and decided in --verdicts ({ method, file, decision: "in" | "out", line, why }[]), and the score is against
 *   the L3 set with those verdicts applied.
 * Prints recall and precision per method and in all, and every file one side lacks; writes .nebulosity/measure/calls-<repo>.json.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { useReadOnlyDatabase } from "../lib/db/client";
import { calls, type CallerFile } from "../lib/engine/calls";
import { dataPath } from "../lib/home";

type Target = { type: string; member: string; file: string };
const label = (t: Target): string => `${t.type}.${t.member}`;

const VSCODE_TARGETS: Target[] = [
    { type: "IFileService", member: "readFile", file: "src/vs/platform/files/common/files.ts" },
    { type: "IStorageService", member: "store", file: "src/vs/platform/storage/common/storage.ts" },
    { type: "IConfigurationService", member: "getValue", file: "src/vs/platform/configuration/common/configuration.ts" },
    { type: "ICommandService", member: "executeCommand", file: "src/vs/platform/commands/common/commands.ts" },
    { type: "IEditorService", member: "openEditor", file: "src/vs/workbench/services/editor/common/editorService.ts" },
];
const AFFINE_TARGETS: Target[] = [
    { type: "WorkspaceDialogService", member: "open", file: "packages/frontend/core/src/modules/dialogs/services/workspace-dialog.ts" },
    { type: "GlobalDialogService", member: "open", file: "packages/frontend/core/src/modules/dialogs/services/dialog.ts" },
    { type: "GraphQLService", member: "gql", file: "packages/frontend/core/src/modules/cloud/services/graphql.ts" },
];

/** The design check's shapes (evidence/e2/checker.mjs and affine-main.mjs). */
type CheckerOwner = { kind: string; name: string; file: string; implementsTarget?: boolean };
type CheckerRow = { method: string; file: string; line: number; owners: CheckerOwner[] };
type AffineSite = { m: string; file: string; line: number; owner: string | null };
type Verdict = { method: string; file: string; decision: "in" | "out"; line: number; why: string };

/** A file set, with the lines that put each file in it (for reading a miss or an extra at its line). */
type FileSet = Map<string, number[]>;
type Score = { reference: number; index: number; agreed: number; recall: number | null; precision: number | null; missed: { file: string; lines: number[] }[]; extra: { file: string; lines: number[] }[] };
type MethodResult = { method: string; declaring: string; iface?: Score; both: Score; redeclared: { file: string; lines: number[] }[]; referenceNote?: string };

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
};

const addLine = (set: FileSet, file: string, line: number): void => {
    const lines = set.get(file) ?? [];
    if (!lines.includes(line)) lines.push(line);
    set.set(file, lines);
};
const sorted = (lines: readonly number[]): number[] => [...lines].sort((a, b) => a - b);
const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const fmt = (x: number | null): string => (x === null ? "n/a" : x.toFixed(3));

function score(index: FileSet, reference: FileSet): Score {
    const agreed = [...index.keys()].filter((f) => reference.has(f)).length;
    return {
        reference: reference.size, index: index.size, agreed,
        recall: ratio(agreed, reference.size), precision: ratio(agreed, index.size),
        missed: [...reference].filter(([f]) => !index.has(f)).map(([file, lines]) => ({ file, lines: sorted(lines) })).sort((a, b) => (a.file < b.file ? -1 : 1)),
        extra: [...index].filter(([f]) => !reference.has(f)).map(([file, lines]) => ({ file, lines: sorted(lines) })).sort((a, b) => (a.file < b.file ? -1 : 1)),
    };
}

/** Sums over the methods: the pooled recall and precision (R-AL). */
function pool(scores: readonly Score[]): { reference: number; index: number; agreed: number; recall: number | null; precision: number | null } {
    const reference = scores.reduce((s, x) => s + x.reference, 0);
    const index = scores.reduce((s, x) => s + x.index, 0);
    const agreed = scores.reduce((s, x) => s + x.agreed, 0);
    return { reference, index, agreed, recall: ratio(agreed, reference), precision: ratio(agreed, index) };
}

/** The index's sets from the answer's sites (R-AB). */
function indexSets(files: readonly CallerFile[], keep: (file: string) => boolean): { iface: FileSet; both: FileSet; redeclared: FileSet } {
    const iface: FileSet = new Map(), both: FileSet = new Map(), redeclared: FileSet = new Map();
    for (const f of files){
        if (!keep(f.path)) continue;
        for (const s of f.sites){
            const onInterface = s.category === "type" || (s.category === "subtype" && !s.receiverDeclares);
            if (onInterface) addLine(iface, f.path, s.line);
            if (onInterface || s.category === "implementation") addLine(both, f.path, s.line);
        }
        if (f.sites.every((s) => s.category === "subtype" && s.receiverDeclares)) for (const s of f.sites) addLine(redeclared, f.path, s.line);
    }
    return { iface, both, redeclared };
}

/** The program's own files: src/tsconfig.json's fileNames without .d.ts, repo-relative (no program is built). */
function programFiles(root: string): Set<string> {
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, "src", "tsconfig.json"), {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
    });
    if (!parsed) throw new Error(`couldn't read ${path.join(root, "src", "tsconfig.json")}`);
    return new Set(parsed.fileNames.filter((f) => !f.endsWith(".d.ts")).map((f) => path.relative(root, f).split(path.sep).join("/")));
}

function memberAnswer(root: string, t: Target, within: string | undefined): CallerFile[] {
    const answer = calls(root, { symbol: label(t), path: t.file }, { groupBy: null, ...(within === undefined ? {} : { within }) });
    if (answer.kind !== "member") throw new Error(`${label(t)} in ${t.file}: expected a member answer, got "${answer.kind}"`);
    return answer.files;
}

function vscode(root: string, checkerPath: string): MethodResult[] {
    const { rows } = JSON.parse(fs.readFileSync(checkerPath, "utf8")) as { rows: CheckerRow[] };
    const program = programFiles(root);
    console.log(`program files (src/tsconfig.json, no .d.ts): ${program.size}`);
    return VSCODE_TARGETS.map((t) => {
        const index = indexSets(memberAnswer(root, t, "src"), (f) => program.has(f));
        const checkerIface: FileSet = new Map(), checkerBoth: FileSet = new Map();
        for (const r of rows){
            if (r.method !== t.member || !program.has(r.file)) continue;
            const onInterface = r.owners.some((o) => o.kind === "interface" && o.name === t.type && o.file === t.file);
            const onImplementation = r.owners.some((o) => o.kind === "class" && o.implementsTarget === true);
            if (onInterface) addLine(checkerIface, r.file, r.line);
            if (onInterface || onImplementation) addLine(checkerBoth, r.file, r.line);
        }
        return {
            method: label(t), declaring: t.file, iface: score(index.iface, checkerIface), both: score(index.both, checkerBoth),
            redeclared: [...index.redeclared].map(([file, lines]) => ({ file, lines: sorted(lines) })),
        };
    });
}

function affine(root: string, sitesPath: string, verdictsPath: string | undefined): MethodResult[] {
    const sites = JSON.parse(fs.readFileSync(sitesPath, "utf8")) as AffineSite[];
    const verdicts = verdictsPath === undefined ? [] : JSON.parse(fs.readFileSync(verdictsPath, "utf8")) as Verdict[];
    for (const v of verdicts){
        if (!AFFINE_TARGETS.some((t) => label(t) === v.method)) throw new Error(`a verdict names an unknown method: ${v.method}`);
        if (v.decision !== "in" && v.decision !== "out") throw new Error(`a verdict's decision is "in" or "out": ${JSON.stringify(v)}`);
    }
    return AFFINE_TARGETS.map((t) => {
        const index = indexSets(memberAnswer(root, t, undefined), () => true);
        const l3: FileSet = new Map();
        for (const s of sites) if (s.m === t.member && s.owner === `${t.file}#${t.type}`) addLine(l3, s.file, s.line);
        const reference: FileSet = new Map([...l3].map(([f, lines]) => [f, [...lines]]));
        let applied = 0;
        for (const v of verdicts.filter((x) => x.method === label(t))){
            const disputed = l3.has(v.file) !== index.both.has(v.file);
            if (!disputed) console.warn(`  note: a verdict on ${v.file} (${v.method}), a file both sides already agree on`);
            if (v.decision === "in") addLine(reference, v.file, v.line);
            else reference.delete(v.file);
            applied++;
        }
        return {
            method: label(t), declaring: t.file, both: score(index.both, reference),
            redeclared: [...index.redeclared].map(([file, lines]) => ({ file, lines: sorted(lines) })),
            referenceNote: `L3 ${l3.size} files; ${applied} verdicts applied → ${reference.size}`,
        };
    });
}

function printTable(title: string, results: readonly MethodResult[], pick: (r: MethodResult) => Score): ReturnType<typeof pool> {
    console.log(`\n${title}\n| Method | Reference files | Index files | Both | Recall | Precision |\n|---|---|---|---|---|---|`);
    for (const r of results){
        const s = pick(r);
        console.log(`| ${r.method} | ${s.reference} | ${s.index} | ${s.agreed} | ${fmt(s.recall)} | ${fmt(s.precision)} |`);
    }
    const p = pool(results.map(pick));
    console.log(`| **pooled** | ${p.reference} | ${p.index} | ${p.agreed} | ${fmt(p.recall)} | ${fmt(p.precision)} |`);
    for (const r of results){
        const s = pick(r);
        for (const m of s.missed) console.log(`  - missed  ${r.method}  ${m.file}:${m.lines.join(",")}`);
        for (const e of s.extra) console.log(`  + extra   ${r.method}  ${e.file}:${e.lines.join(",")}`);
    }
    return p;
}

function main(): void {
    const repo = flag("--repo");
    const checkerPath = flag("--checker");
    const sitesPath = flag("--sites");
    if (!repo || (checkerPath === undefined) === (sitesPath === undefined)){
        console.error("usage: npm run bench-calls -- --repo <repo> (--checker <checker.json> | --sites <affine-sites.json> [--verdicts <file>])");
        process.exit(2);
    }
    const root = path.resolve(repo);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook
    useReadOnlyDatabase();

    const started = performance.now();
    const results = checkerPath !== undefined ? vscode(root, path.resolve(checkerPath)) : affine(root, path.resolve(sitesPath!), flag("--verdicts"));
    const seconds = (performance.now() - started) / 1000;

    let bar: { iface: ReturnType<typeof pool>; both: ReturnType<typeof pool>; pass: boolean } | null = null;
    if (checkerPath !== undefined){
        const iface = printTable("Interface calls (against TypeScript's checker)", results, (r) => r.iface!);
        const both = printTable("Interface + implementation calls (against TypeScript's checker)", results, (r) => r.both);
        const meets = (p: ReturnType<typeof pool>): boolean => p.recall !== null && p.precision !== null && p.recall >= 0.98 && p.precision >= 0.99;
        bar = { iface, both, pass: meets(iface) && meets(both) };
        for (const r of results){
            const under = [r.iface!, r.both].some((s) => s.recall === null || s.precision === null || s.recall < 0.98 || s.precision < 0.99);
            if (under) console.log(`  under 0.98/0.99 on its own: ${r.method}`);
        }
        console.log(`\nThe bar (S14, R-AL: pooled recall ≥ 0.98 and precision ≥ 0.99 on both sets): ${bar.pass ? "PASS" : "UNDER"}`);
    } else {
        for (const r of results) console.log(`${r.method}: ${r.referenceNote}`);
        printTable("Interface + implementation calls (against the design check's L3 sets, verdicts applied)", results, (r) => r.both);
    }
    for (const r of results) for (const d of r.redeclared) console.log(`  apart (a subtype that redeclares the member)  ${r.method}  ${d.file}:${d.lines.join(",")}`);
    console.log(`\n${seconds.toFixed(1)} s`);

    const name = path.basename(root);
    const out = dataPath("measure", `calls-${name}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ repo: name, at: new Date().toISOString(), seconds: +seconds.toFixed(1), bar, results }, null, 2) + "\n");
    console.log(`wrote ${out}`);
    process.exit(bar === null || bar.pass ? 0 : 1);
}

main();
