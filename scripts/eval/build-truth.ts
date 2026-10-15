/**
 * npm run eval:truth -- [--eval <dir>] [<path to a repo's checkout>] [--force] [--out <dir>] [--resolve-bare]
 *
 * Builds an eval's ground truth (D2 of the V1.5 and V1.6 plans; R3 of Eval #1, R2 of Eval #2) from scripts/eval alone:
 * nothing from lib/, so the answers never come from Nebulosity's index.
 *   - Eval #1 (--eval eval, the default): its ten list and chain truths (TRUTH_TABLE) on its one repo, whose checkout may be
 *     given or left to eval.json. Non-relative specifiers stay unresolved, as its truths were built, unless --resolve-bare.
 *   - Any other eval (--eval eval2): the specs in <dir>/truth-specs.json, on the repos its eval.json pins, with the truth's
 *     own resolver (resolve-truth.ts) always on. A checkout given picks one of them.
 * Per repo it builds two graphs, the regex scanner's (scan.ts) and TypeScript's preProcessFile's (ts-graph.ts), and the
 * truths come from the scanner's plus the verdicts in <dir>/truth/adjudicated.json (edges decided by reading the source:
 * a disagreement or a computed import() site; [] when missing). Every verdict is checked against the two graphs and the
 * computed sites first (checkVerdicts): one that can't take effect stops the build, naming it, before anything is written. It writes
 *   <dir>/truth/<id>.json                      one truth per spec, unverified: the hand check turns it on
 *   .nebulosity/<dir>/truth-evidence.md        each list entry's and chain or cycle step's import line(s), for that check
 *   .nebulosity/<dir>/truth-disagreements.md   every edge one graph has and the other lacks, with its line
 *   .nebulosity/<dir>/computed-sites.md        every import(<identifier>), decided or not
 *   .nebulosity/<dir>/truth-sample.md          30 of the edges the truths rest on per repo, chosen by a fixed seed, to read
 * A truth file that already carries a hand check (verified, or notes) is kept, never rebuilt over, unless --force is given;
 * the size printed for it is the kept file's, with this build's beside it when they differ.
 * --out <dir> writes the truths and the sheets there instead, and compares each truth with <dir>/truth's.
 * The repos are only read.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadDefinition, type EvalDefinition } from "./definition";
import { createTruthResolver } from "./resolve-truth";
import { CODE_FILE, computedSites, importSpecifiers, listFiles, resolveSpecifier, scanRepo, type ComputedSite, type ResolveBare } from "./scan";
import { preProcessGraph, preProcessImports } from "./ts-graph";
import {
    adjacency, childOf, childPairs, directImporters, filesNothingImports, impactByFolders, importersWithin, isTestFile, nameOf, namePairs,
    outsideImporters, rootsReaching, shortestChain, shortestCycle, transitiveDependents, type Graph,
} from "./truth";

// ---- the specs

/** What every spec has: `repo` names one of eval.json's repos; `planning` is the size a planning-time scan found, to compare. */
type SpecBase = { id: string; repo?: string; planning?: string };
export type ListSpec = SpecBase & { kind: "list"; target: string; scope: "direct" | "outside" | "transitive" };
export type ChainSpec = SpecBase & { kind: "chain"; from: string; to: string };
/** Everything that depends on `target`, counted in each of `folders`, elsewhere and in all. */
export type ImpactSpec = SpecBase & { kind: "impact"; target: string; folders: string[] };
export type CycleSpec = SpecBase & { kind: "cycle"; file: string };
/** The non-test files in `folder` that no other file imports. */
export type UnusedSpec = SpecBase & { kind: "unused"; folder: string };
/** The files in `from` that directly import a file in `to`. */
export type ViolationsSpec = SpecBase & { kind: "violations"; from: string; to: string };
/** The non-test files nothing imports that end up loading `target`. */
export type EntriesSpec = SpecBase & { kind: "entries"; target: string };
/** Without `names`, which of the folder's children import which; with them, which of those folder names below it do. */
export type PairsSpec = SpecBase & { kind: "pairs"; folder: string; names?: string[] };
export type TruthSpec = ListSpec | ChainSpec | ImpactSpec | CycleSpec | UnusedSpec | ViolationsSpec | EntriesSpec | PairsSpec;

/** Eval #1's definition, whose ten truths are TRUTH_TABLE rather than a truth-specs.json. */
export const EVAL1 = "Eval #1";

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

const KIND_FIELDS: Record<TruthSpec["kind"], string[]> = {
    list: ["target", "scope"], chain: ["from", "to"], impact: ["target", "folders"], cycle: ["file"],
    unused: ["folder"], violations: ["from", "to"], entries: ["target"], pairs: ["folder"],
};
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

/** truth-specs.json, checked: a list of { id, repo, kind, …the kind's fields }, ids unique, repos the definition's. */
export function parseTruthSpecs(raw: unknown, repoIds: readonly string[]): TruthSpec[] {
    const fail = (why: string): never => { throw new Error(`truth-specs.json: ${why}`); };
    if (!Array.isArray(raw)) fail("it must be a list of specs, each { id, repo, kind, …the kind's fields }.");
    const seen = new Set<string>();
    for (const item of raw as unknown[]){
        const s = (item ?? {}) as Record<string, unknown>;
        if (typeof s.id !== "string" || s.id === "") fail(`every spec needs an id: ${JSON.stringify(item)}.`);
        const id = s.id as string;
        if (seen.has(id)) fail(`the id ${id} is used twice.`);
        seen.add(id);
        if (typeof s.repo !== "string" || !repoIds.includes(s.repo)) fail(`${id}'s repo must be one of eval.json's (${repoIds.join(", ")}), not ${JSON.stringify(s.repo)}.`);
        if (typeof s.kind !== "string" || !Object.prototype.hasOwnProperty.call(KIND_FIELDS, s.kind)) fail(`${id}'s kind must be one of ${Object.keys(KIND_FIELDS).join(", ")}, not ${JSON.stringify(s.kind)}.`);
        for (const field of KIND_FIELDS[s.kind as TruthSpec["kind"]]){
            if (field === "folders"){
                if (!isStringList(s.folders)) fail(`${id} (${s.kind}) needs folders, a list of folder paths.`);
            } else if (field === "scope"){
                if (s.scope !== "direct" && s.scope !== "outside" && s.scope !== "transitive") fail(`${id} (list) needs scope "direct", "outside" or "transitive".`);
            } else if (typeof s[field] !== "string") fail(`${id} (${s.kind}) needs ${field}, a repo path.`);
        }
        if (s.names !== undefined && !isStringList(s.names)) fail(`${id}'s names, when given, must be a list of folder names.`);
    }
    return raw as TruthSpec[];
}

/** The specs an eval's truths come from: Eval #1's TRUTH_TABLE on its one repo, or <dir>/truth-specs.json. */
export function specsFor(definition: EvalDefinition): TruthSpec[] {
    const repoIds = Object.keys(definition.repos);
    if (definition.name === EVAL1){
        if (repoIds.length !== 1) throw new Error(`${EVAL1}'s ten truths are for one repo, and its eval.json names ${repoIds.length}.`);
        return TRUTH_TABLE.map((s) => ({ ...s, repo: repoIds[0] }));
    }
    const file = path.join(definition.dir, "truth-specs.json");
    if (!fs.existsSync(file)){
        throw new Error(`${path.basename(definition.dir)}/truth-specs.json doesn't exist yet, and ${definition.name}'s truths are built from it: write it first, a list of { id, repo, kind, …the kind's fields }.`);
    }
    return parseTruthSpecs(JSON.parse(fs.readFileSync(file, "utf8")), repoIds);
}

// ---- the truths

type Checked = { verified: boolean; notes: unknown[] };
export type ListTruthFile = { id: string; kind: "list"; target: string; scope: ListSpec["scope"]; files: string[] } & Checked;
export type ChainTruthFile = {
    id: string; kind: "chain"; from: string; to: string; connected: boolean;
    /** Steps (imports) in the shortest chain, one fewer than the example's files; null when nothing connects. */
    shortest: number | null; example: string[] | null;
} & Checked;
export type ImpactTruthFile = { id: string; kind: "impact"; target: string; counts: [string, number][]; elsewhere: number; total: number } & Checked;
/** Steps in the shortest cycle (its example starts and ends at the file); null when the file is in none. */
export type CycleTruthFile = { id: string; kind: "cycle"; file: string; shortest: number | null; example: string[] | null } & Checked;
export type UnusedTruthFile = { id: string; kind: "unused"; folder: string; files: string[] } & Checked;
export type ViolationsTruthFile = { id: string; kind: "violations"; from: string; to: string; files: string[] } & Checked;
export type EntriesTruthFile = { id: string; kind: "entries"; target: string; files: string[] } & Checked;
export type PairsTruthFile = { id: string; kind: "pairs"; folder: string; names: string[] | null; pairs: [string, string][] } & Checked;
type TruthOf = {
    list: ListTruthFile; chain: ChainTruthFile; impact: ImpactTruthFile; cycle: CycleTruthFile;
    unused: UnusedTruthFile; violations: ViolationsTruthFile; entries: EntriesTruthFile; pairs: PairsTruthFile;
};
export type TruthFile = TruthOf[keyof TruthOf];

/** A spec's truth over a graph, unverified and without notes (the hand check adds both). */
export function buildTruth<S extends TruthSpec>(g: Graph, spec: S): TruthOf[S["kind"]] {
    return truthFor(g, spec) as TruthOf[S["kind"]];
}

function truthFor(g: Graph, spec: TruthSpec): TruthFile {
    const unchecked = (): Checked => ({ verified: false, notes: [] });
    switch (spec.kind){
        case "list": {
            const files = spec.scope === "direct" ? directImporters(g, spec.target)
                : spec.scope === "outside" ? outsideImporters(g, spec.target)
                : transitiveDependents(g, spec.target);
            return { id: spec.id, kind: "list", target: spec.target, scope: spec.scope, files, ...unchecked() };
        }
        case "chain": {
            const example = shortestChain(g, spec.from, spec.to);
            return {
                id: spec.id, kind: "chain", from: spec.from, to: spec.to, connected: example !== null,
                shortest: example === null ? null : example.length - 1, example, ...unchecked(),
            };
        }
        case "impact": {
            const { counts, elsewhere, total } = impactByFolders(g, spec.target, spec.folders);
            return { id: spec.id, kind: "impact", target: spec.target, counts: spec.folders.map((f, i): [string, number] => [f, counts[i]]), elsewhere, total, ...unchecked() };
        }
        case "cycle": {
            const example = shortestCycle(g, spec.file);
            return { id: spec.id, kind: "cycle", file: spec.file, shortest: example === null ? null : example.length - 1, example, ...unchecked() };
        }
        case "unused":
            return { id: spec.id, kind: "unused", folder: spec.folder, files: filesNothingImports(g, spec.folder, isTestFile), ...unchecked() };
        case "violations":
            return { id: spec.id, kind: "violations", from: spec.from, to: spec.to, files: importersWithin(g, spec.to, spec.from), ...unchecked() };
        case "entries":
            return { id: spec.id, kind: "entries", target: spec.target, files: rootsReaching(g, spec.target, isTestFile), ...unchecked() };
        case "pairs":
            return {
                id: spec.id, kind: "pairs", folder: spec.folder, names: spec.names ?? null,
                pairs: spec.names ? namePairs(g, spec.folder, spec.names) : childPairs(g, spec.folder), ...unchecked(),
            };
    }
}

/**
 * For every file that depends on `target`, its next step toward it and how many steps away it is: a breadth-first walk
 * outward through the importers, each level in path order. The same files transitiveDependents lists; the evidence sheet
 * shows each one's edge to its next step, and those edges chain every dependent back to the target.
 */
export function successors(g: Graph, target: string): Map<string, { next: string; steps: number }> {
    const into = adjacency(g, true);
    const result = new Map<string, { next: string; steps: number }>();
    const seen = new Set([target]);
    let frontier = [target];
    for (let steps = 1; frontier.length > 0; steps++){
        const following: string[] = [];
        for (const file of frontier){
            for (const importer of into.get(file) ?? []){
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

const within = (p: string, folder: string): boolean => folder === "" || p === folder || p.startsWith(`${folder}/`);
const edgeKey = ([a, b]: readonly [string, string]): string => `${a}\0${b}`;
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Edges each once, sorted by importer then imported file. */
function sortEdges(edges: Iterable<readonly [string, string]>): [string, string][] {
    const unique = new Map<string, [string, string]>();
    for (const [a, b] of edges) unique.set(edgeKey([a, b]), [a, b]);
    return [...unique.values()].sort((x, y) => byPath(x[0], y[0]) || byPath(x[1], y[1]));
}

/**
 * The edges a truth rests on, for the sample a reader checks: a direct list's imports of the target, an outside list's or a
 * violation's imports into the folder, each dependent's way to the target (transitive lists, impact, entries), a chain's or
 * a cycle's steps, the first edge (in path order) of each pair. Files nothing imports rest on no edge.
 */
export function restingEdges(g: Graph, truth: TruthFile): [string, string][] {
    const edges: [string, string][] = [];
    const ways = (target: string, from: readonly string[]): void => {
        const via = successors(g, target);
        for (const file of from) for (let p = file; p !== target && via.has(p); p = via.get(p)!.next) edges.push([p, via.get(p)!.next]);
    };
    const steps = (example: readonly string[] | null): void => {
        for (let i = 0; example !== null && i + 1 < example.length; i++) edges.push([example[i], example[i + 1]]);
    };
    const into = (importers: readonly string[], folder: string): void => {
        const set = new Set(importers);
        edges.push(...g.edges.filter(([a, b]) => set.has(a) && within(b, folder)).map(([a, b]): [string, string] => [a, b]));
    };
    switch (truth.kind){
        case "list":
            if (truth.scope === "direct") edges.push(...truth.files.map((f): [string, string] => [f, truth.target]));
            else if (truth.scope === "outside") into(truth.files, truth.target);
            else ways(truth.target, truth.files);
            break;
        case "chain": case "cycle": steps(truth.example); break;
        case "impact": ways(truth.target, transitiveDependents(g, truth.target)); break;
        case "entries": ways(truth.target, truth.files); break;
        case "violations": into(truth.files, truth.to); break;
        case "unused": break;
        case "pairs": {
            const group = truth.names ? nameOf(truth.folder, truth.names) : childOf(truth.folder);
            const firsts = new Map<string, [string, string]>();
            for (const [a, b] of sortEdges(g.edges)){
                const [ga, gb] = [group(a), group(b)];
                if (ga === null || gb === null || (truth.names === null && ga === gb)) continue;
                if (!firsts.has(`${ga}\0${gb}`)) firsts.set(`${ga}\0${gb}`, [a, b]);
            }
            edges.push(...firsts.values());
            break;
        }
    }
    return sortEdges(edges);
}

// ---- the two graphs, the verdicts and the sample

/**
 * A reader's verdict on an edge (R2), in <dir>/truth/adjudicated.json: "in" puts from → to in the truth's graph (a computed
 * import() read to its target, an edge only preProcessFile finds), "out" takes a scanner edge out (an import inside a
 * string). `line` ties a verdict to a computed import() site; `to: null` decides a site that loads nothing in the repo.
 */
export type Adjudication = { repo: string; from: string; to: string | null; line?: number; decision: "in" | "out"; why: string };

/** adjudicated.json, checked for shape; with `repoIds`, every verdict's repo must be one of them. */
export function parseAdjudications(raw: unknown, repoIds?: readonly string[]): Adjudication[] {
    if (!Array.isArray(raw)) throw new Error("adjudicated.json: it must be a list of verdicts, each { repo, from, to, line?, decision, why }.");
    for (const item of raw as unknown[]){
        const v = (item ?? {}) as Record<string, unknown>;
        const ok = typeof v.repo === "string" && typeof v.from === "string" && (typeof v.to === "string" || v.to === null)
            && (v.decision === "in" || v.decision === "out") && typeof v.why === "string" && (v.line === undefined || Number.isInteger(v.line))
            && !(v.decision === "in" && v.to === null);
        if (!ok) throw new Error(`adjudicated.json: ${JSON.stringify(item)} needs repo, from, to (a repo path; null only for an "out" site that loads nothing in the repo), decision "in" or "out", why, and optionally line.`);
        if (repoIds !== undefined && !repoIds.includes(v.repo as string)){
            throw new Error(`adjudicated.json: the verdict on ${v.from as string} → ${(v.to as string | null) ?? "nothing"} is for the repo ${JSON.stringify(v.repo)}, which the eval doesn't have (${repoIds.join(", ")}).`);
        }
    }
    return raw as Adjudication[];
}

/**
 * What one repo's verdicts did, every one of them having taken effect (checkVerdicts): how many said in and out, the edges
 * added to and taken out of the scanner's graph, the scanner's edges preProcessFile lacks that reading confirmed and the
 * edges only preProcessFile has that reading left out (both disagreements decided, the truth's graph unchanged), and the
 * computed import() sites decided.
 */
export type VerdictEffects = {
    in: number; out: number; edgesAdded: number; edgesRemoved: number; confirmed: number; leftOut: number; sitesDecided: number;
};

/**
 * Checks one repo's verdicts against its two graphs before any truth is built from them (R2: a verdict that silently does
 * nothing, or adds an edge to a file that isn't there, would hide a mistake in the truths). Each verdict must take effect:
 *   - an "out" with a `to` takes out an edge one of the extractors found (the scanner's, or one only preProcessFile has);
 *   - an "in" names two files the repo has, and adds an edge the scanner lacks, confirms one only the scanner has, or
 *     decides a computed site (an in on an edge both extractors have, naming no site, changes nothing);
 *   - a `line` is a computed import() site's in `from`: "in" with the file it loads, or "out" with `to: null` (loads nothing
 *     here); a `to: null` always needs its site's line, and an "in" on an edge neither extractor finds, from a file that
 *     holds computed sites, must name the site it decides;
 *   - no verdict is given twice, and no edge or site is decided both ways.
 * Otherwise it throws a sentence naming the verdict. Returns what the verdicts did.
 */
export function checkVerdicts(built: {
    scanner: Graph; preProcess: Graph; known: ReadonlySet<string>; sites: readonly ComputedSite[]; verdicts: readonly Adjudication[];
}): VerdictEffects {
    const [scanned, preProcessed] = [new Set(built.scanner.edges.map(edgeKey)), new Set(built.preProcess.edges.map(edgeKey))];
    const siteLines = new Map<string, number[]>();
    for (const s of built.sites) siteLines.set(s.file, [...(siteLines.get(s.file) ?? []), s.line]);
    const linesOf = (file: string): string => (siteLines.get(file) ?? []).map((l) => `L${l}`).join(", ");
    const effects: VerdictEffects = { in: 0, out: 0, edgesAdded: 0, edgesRemoved: 0, confirmed: 0, leftOut: 0, sitesDecided: 0 };
    const added = new Set<string>();
    const decidedSites = new Set<string>();
    const edgeDecisions = new Map<string, Adjudication["decision"]>();
    const siteDecisions = new Map<string, "loads" | "nothing">();
    const given = new Set<string>();
    for (const v of built.verdicts){
        const named = `adjudicated.json: ${v.repo}'s verdict "${v.decision}" on ${v.from} → ${v.to ?? "nothing"}${v.line !== undefined ? ` (L${v.line})` : ""}`;
        const stop = (why: string): never => { throw new Error(`${named} ${why}`); };
        const whole = JSON.stringify([v.from, v.to, v.line ?? null, v.decision]);
        if (given.has(whole)) stop("is given twice.");
        given.add(whole);
        for (const file of v.decision === "in" ? [v.from, v.to!] : [v.from]){
            if (!built.known.has(file)) stop(`can't take effect: ${file} isn't a code file of the repo.`);
        }
        if (v.line !== undefined){
            if (!(siteLines.get(v.from) ?? []).includes(v.line)){
                stop(siteLines.has(v.from) ? `names a line that holds none of ${v.from}'s computed import() sites (${linesOf(v.from)}).` : `names a line, but ${v.from} holds no computed import() site.`);
            }
            if (v.decision === "out" && v.to !== null) stop(`names a site and a file: a site's verdict is "in" with the file it loads, or "out" with to: null when it loads nothing in the repo.`);
            const site = `${v.from}\0${v.line}`;
            const what = v.to === null ? "nothing" : "loads";
            if (siteDecisions.has(site) && siteDecisions.get(site) !== what) stop("decides the site both ways: it loads a file, and it loads nothing here.");
            siteDecisions.set(site, what);
            if (!decidedSites.has(site)){ decidedSites.add(site); effects.sitesDecided++; }
        } else if (v.to === null) stop(`needs the line of the computed import() site it decides${siteLines.has(v.from) ? ` (${linesOf(v.from)})` : ""}.`);
        if (v.to !== null){
            const key = edgeKey([v.from, v.to]);
            if (edgeDecisions.has(key) && edgeDecisions.get(key) !== v.decision) stop("decides the edge both ways, in and out.");
            edgeDecisions.set(key, v.decision);
            if (v.decision === "out"){
                if (scanned.has(key)) effects.edgesRemoved++;
                else if (preProcessed.has(key)) effects.leftOut++;
                else stop("matches an edge neither extractor finds, so it changes nothing: check its from and to.");
            } else if (!scanned.has(key)){
                if (v.line === undefined && !preProcessed.has(key) && siteLines.has(v.from)){
                    stop(`names no line, and ${v.from} holds computed import() sites (${linesOf(v.from)}): give the line of the site that loads it.`);
                }
                if (!added.has(key)){ added.add(key); effects.edgesAdded++; }
            } else if (!preProcessed.has(key)) effects.confirmed++;
            else if (v.line === undefined) stop("changes nothing: both extractors already have this edge, and the verdict names no computed site.");
        }
        effects[v.decision]++;
    }
    return effects;
}

/** A graph with the verdicts applied: "out" edges taken away, then "in" edges added (each once). */
export function applyAdjudications(g: Graph, verdicts: readonly Adjudication[]): Graph {
    const out = new Set(verdicts.filter((v) => v.decision === "out" && v.to !== null).map((v) => edgeKey([v.from, v.to!])));
    const edges = g.edges.filter((e) => !out.has(edgeKey(e))).map(([a, b]): [string, string] => [a, b]);
    const have = new Set(edges.map(edgeKey));
    for (const v of verdicts){
        if (v.decision !== "in" || v.to === null || have.has(edgeKey([v.from, v.to]))) continue;
        edges.push([v.from, v.to]);
        have.add(edgeKey([v.from, v.to]));
    }
    return { files: g.files, edges };
}

/** The edges the regex scanner's graph has and preProcessFile's lacks, and the other way round, each sorted. */
export function edgeDifferences(scanner: Graph, preProcess: Graph): { scannerOnly: [string, string][]; preProcessOnly: [string, string][] } {
    const [inScanner, inPreProcess] = [new Set(scanner.edges.map(edgeKey)), new Set(preProcess.edges.map(edgeKey))];
    return {
        scannerOnly: sortEdges(scanner.edges.filter((e) => !inPreProcess.has(edgeKey(e)))),
        preProcessOnly: sortEdges(preProcess.edges.filter((e) => !inScanner.has(edgeKey(e)))),
    };
}

/** The sample's fixed seed: the same edges come back for the same truths, run after run. */
export const SAMPLE_SEED = 20261014;

/** mulberry32: a small seeded generator of numbers in [0, 1), so the sample needs no library and never changes. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** `n` distinct edges chosen by the seed from the edges sorted by path (all of them when there are no more), sorted. */
export function sampleEdges(edges: readonly (readonly [string, string])[], n: number, seed = SAMPLE_SEED): [string, string][] {
    const pool = sortEdges(edges);
    if (pool.length <= n) return pool;
    const random = seeded(seed);
    for (let i = 0; i < n; i++){
        const j = i + Math.floor(random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return sortEdges(pool.slice(0, n));
}

export type RepoGraphs = {
    /** The regex scanner's graph, preProcessFile's, and the truth's: the scanner's with this repo's verdicts applied. */
    scanner: Graph; preProcess: Graph; graph: Graph;
    known: ReadonlySet<string>; resolve: ResolveBare | undefined; verdicts: Adjudication[];
    /** Every import(<identifier>), with the verdicts that decide it (none: undecided, left out of the truths). */
    sites: (ComputedSite & { verdicts: Adjudication[] })[];
    differences: { scannerOnly: [string, string][]; preProcessOnly: [string, string][] };
};

/** One repo's two graphs, its computed sites and the truth's graph, bare specifiers resolved by the truth's resolver when asked. */
export function buildRepoGraphs(root: string, repo: string, adjudications: readonly Adjudication[], options: { resolveBare: boolean }): RepoGraphs {
    const files = listFiles(root).filter((f) => CODE_FILE.test(f));
    const resolve = options.resolveBare ? createTruthResolver(root, files) : undefined;
    const scanner = scanRepo(root, { resolveBare: resolve });
    const preProcess = preProcessGraph(root, scanner.files, resolve ?? ((): null => null));
    const verdicts = adjudications.filter((a) => a.repo === repo);
    const sites = computedSites(root, scanner.files).map((s) => ({ ...s, verdicts: verdicts.filter((v) => v.from === s.file && v.line === s.line) }));
    return {
        scanner, preProcess, graph: applyAdjudications(scanner, verdicts), known: new Set(scanner.files), resolve, verdicts, sites,
        differences: edgeDifferences(scanner, preProcess),
    };
}

// ---- the evidence

export type ImportLine = { target: string; line: number; text: string; spansLines: boolean };

/**
 * The lines of a file's text that import a file `wants` accepts, found the way the scanner reads the source (importSpecifiers,
 * then resolveRelative, or `resolveBare` for other specifiers) but one line at a time, so each hit has a line number to read.
 * A statement whose keyword and path sit on different lines (`import x from` then `'./x';`) is invisible to a single line:
 * for a wanted file that no line found, the lines holding the quoted path are listed, marked spansLines. Sorted by target,
 * then line.
 */
export function importLines(text: string, fromFile: string, wants: (target: string) => boolean, known: ReadonlySet<string>, resolveBare?: ResolveBare): ImportLine[] {
    const lines = text.split(/\r?\n/);
    const hits: ImportLine[] = [];
    lines.forEach((line, i) => {
        for (const specifier of importSpecifiers(line)){
            const target = resolveSpecifier(fromFile, specifier, known, resolveBare);
            if (target !== null && target !== fromFile && wants(target)) hits.push({ target, line: i + 1, text: line.trim(), spansLines: false });
        }
    });
    const found = new Set(hits.map((h) => h.target));
    for (const specifier of new Set(importSpecifiers(text))){
        const target = resolveSpecifier(fromFile, specifier, known, resolveBare);
        if (target === null || target === fromFile || !wants(target) || found.has(target)) continue;
        lines.forEach((line, i) => {
            if (line.includes(`'${specifier}'`) || line.includes(`"${specifier}"`)) hits.push({ target, line: i + 1, text: line.trim(), spansLines: true });
        });
    }
    return hits.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : a.line - b.line));
}

const forward = (p: string): string => p.replace(/\\/g, "/");
/** Inline code that survives a backtick in the text (a template literal on an import line). */
const code = (s: string): string => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``);
const clip = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

type Evidence = { root: string; known: ReadonlySet<string>; g: Graph; resolve: ResolveBare | undefined; verdicts: readonly Adjudication[] };

const readSource = (e: Evidence, file: string): string => fs.readFileSync(path.join(e.root, file), "utf8");
const hitsOf = (e: Evidence, from: string, wants: (t: string) => boolean): ImportLine[] => importLines(readSource(e, from), from, wants, e.known, e.resolve);

/** The lines of `from` that import `to` (from `hits`), or the verdict that put the edge in, or a flag that nothing does. */
function lineEvidence(e: Evidence, from: string, to: string, hits: readonly ImportLine[]): string[] {
    const lines = hits.filter((h) => h.target === to);
    if (lines.length > 0){
        return lines.map((h) => `     - L${h.line}: ${code(clip(h.text))}${h.spansLines ? " (the statement spans lines; this line holds the quoted path)" : ""}`);
    }
    const verdict = e.verdicts.find((v) => v.decision === "in" && v.from === from && v.to === to);
    if (verdict) return [`     - decided by reading (adjudicated.json${verdict.line !== undefined ? `, L${verdict.line}` : ""}): ${verdict.why}`];
    return ["     - NO LINE FOUND: the scanner has this edge but no line resolves to it. Investigate."];
}

/** One importer's evidence: for each file `wants` accepts, the lines that import it (or a flag that none was found). */
function importerEvidence(e: Evidence, importer: string, wants: (t: string) => boolean, expected: string[]): string[] {
    const hits = hitsOf(e, importer, wants);
    // the targets the scanner's edges name, so a target without a line stands out
    const targets = [...new Set([...expected, ...hits.map((h) => h.target)])].sort();
    return targets.flatMap((target) => [`   - → ${code(target)}`, ...lineEvidence(e, importer, target, hits)]);
}

/** The expected targets of an importer: its edges in the truth's graph whose target `wants` accepts. */
const edgeTargets = (g: Graph, importer: string, wants: (t: string) => boolean): string[] =>
    g.edges.filter(([a, b]) => a === importer && wants(b)).map(([, b]) => b);

/** Each step of a chain or cycle, with its line(s). */
function stepsEvidence(e: Evidence, example: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i + 1 < example.length; i++){
        const [from, to] = [example[i], example[i + 1]];
        out.push(`Step ${i + 1}: ${code(from)} imports ${code(to)}`, ...importerEvidence(e, from, (t) => t === to, [to]), "");
    }
    return out;
}

function listEvidence(e: Evidence, truth: ListTruthFile): string[] {
    const what = truth.scope === "direct" ? "files that directly import" : truth.scope === "outside" ? "files outside the folder that import a file inside" : "files that depend, directly or not, on";
    const out = [`### ${truth.id.toUpperCase()}: ${what} ${code(truth.target)} (${truth.files.length} files)`, ""];
    const via = truth.scope === "transitive" ? successors(e.g, truth.target) : null;
    if (via !== null){
        const missing = truth.files.filter((f) => !via.has(f));
        if (missing.length > 0 || via.size !== truth.files.length) throw new Error(`${truth.id}: the step map and transitiveDependents disagree`);
        out.push("Each dependent is shown with its edge to the next step toward the target; those edges chain it back to the target.", "");
    }
    truth.files.forEach((importer, i) => {
        const wants = truth.scope === "direct" ? (t: string): boolean => t === truth.target
            : truth.scope === "outside" ? (t: string): boolean => within(t, truth.target)
            : (t: string): boolean => t === via!.get(importer)!.next;
        out.push(`${i + 1}. ${code(importer)}${via ? ` (${plural(via.get(importer)!.steps, "step")} from the target)` : ""}`);
        out.push(...importerEvidence(e, importer, wants, edgeTargets(e.g, importer, wants)));
    });
    out.push("");
    return out;
}

/** The files reachable from `from` along imports (`from` itself left out). */
const reachableFrom = (g: Graph, from: string): string[] => transitiveDependents({ files: g.files, edges: g.edges.map(([a, b]) => [b, a] as const) }, from);

function chainEvidence(e: Evidence, truth: ChainTruthFile): string[] {
    const out = [`### ${truth.id.toUpperCase()}: ${code(truth.from)} to ${code(truth.to)}`, ""];
    if (truth.example === null){
        const reached = reachableFrom(e.g, truth.from);
        out.push(`No chain: the scanner finds nothing in ${code(truth.to)} among the ${reached.length} files reachable from the first file. The first file's own imports, to read by hand:`, "");
        const direct = new Set(e.g.edges.filter(([a]) => a === truth.from).map(([, b]) => b));
        out.push(`1. ${code(truth.from)}`, ...importerEvidence(e, truth.from, (x) => direct.has(x), [...direct]));
        out.push(`(Reachable from the first file and inside the target: ${reached.filter((t) => within(t, truth.to)).length}.)`, "");
        return out;
    }
    out.push(`Shortest chain: ${truth.shortest} steps.`, "", ...truth.example.map((f, i) => `${i + 1}. ${code(f)}`), "");
    return [...out, ...stepsEvidence(e, truth.example)];
}

function cycleEvidence(e: Evidence, truth: CycleTruthFile): string[] {
    const out = [`### ${truth.id.toUpperCase()}: the shortest import cycle through ${code(truth.file)}`, ""];
    if (truth.example === null){
        const reached = reachableFrom(e.g, truth.file);
        out.push(`No cycle: none of the ${reached.length} files reachable from it imports it. Its own imports, to read by hand:`, "");
        const direct = new Set(e.g.edges.filter(([a]) => a === truth.file).map(([, b]) => b));
        out.push(`1. ${code(truth.file)}`, ...importerEvidence(e, truth.file, (x) => direct.has(x), [...direct]), "");
        return out;
    }
    out.push(`Shortest cycle: ${truth.shortest} steps.`, "", ...truth.example.map((f, i) => `${i + 1}. ${code(f)}`), "");
    return [...out, ...stepsEvidence(e, truth.example)];
}

function impactEvidence(truth: ImpactTruthFile): string[] {
    return [
        `### ${truth.id.toUpperCase()}: everything that depends on ${code(truth.target)} (${truth.total} files)`, "",
        "| Folder | Files |", "| --- | --- |", ...truth.counts.map(([folder, n]) => `| ${code(folder)} | ${n} |`), `| elsewhere | ${truth.elsewhere} |`, `| total | ${truth.total} |`, "",
        "Too many to read one by one (R2): truth-sample.md reads 30 of the edges these counts rest on, and truth-disagreements.md every edge the two extractors differ on.", "",
    ];
}

function unusedEvidence(e: Evidence, truth: UnusedTruthFile, preImporters: ReadonlyMap<string, string[]>): string[] {
    const tests = filesNothingImports(e.g, truth.folder, () => false).filter(isTestFile).length;
    const out = [
        `### ${truth.id.toUpperCase()}: files in ${code(truth.folder === "" ? "the repo" : truth.folder)} that no other file imports (${truth.files.length} files; ${plural(tests, "test file")} left out)`, "",
        "Nothing in the truth's graph imports these. Beside each: the importers preProcessFile finds, which should be none.", "",
    ];
    truth.files.forEach((file, i) => {
        const others = (preImporters.get(file) ?? []).filter((f) => f !== file);
        out.push(`${i + 1}. ${code(file)}: preProcessFile ${others.length === 0 ? "finds none" : `finds ${others.map(code).join(", ")}`}`);
    });
    out.push("");
    return out;
}

function violationsEvidence(e: Evidence, truth: ViolationsTruthFile): string[] {
    const out = [`### ${truth.id.toUpperCase()}: files in ${code(truth.from)} that import a file in ${code(truth.to)} (${truth.files.length} files)`, ""];
    const wants = (t: string): boolean => within(t, truth.to);
    truth.files.forEach((importer, i) => out.push(`${i + 1}. ${code(importer)}`, ...importerEvidence(e, importer, wants, edgeTargets(e.g, importer, wants))));
    out.push("");
    return out;
}

function entriesEvidence(e: Evidence, truth: EntriesTruthFile): string[] {
    const out = [
        `### ${truth.id.toUpperCase()}: files nothing imports that end up loading ${code(truth.target)} (${truth.files.length} files, tests left out)`, "",
        "Each one with its way to the target, one import per step (each step the shortest way's, importers in path order).", "",
    ];
    const via = successors(e.g, truth.target);
    truth.files.forEach((root, i) => {
        out.push(`${i + 1}. ${code(root)} (${plural(via.get(root)!.steps, "step")} from the target)`);
        for (let p = root; p !== truth.target; p = via.get(p)!.next){
            const next = via.get(p)!.next;
            out.push(`   - ${code(p)} → ${code(next)}`, ...lineEvidence(e, p, next, hitsOf(e, p, (t) => t === next)));
        }
    });
    out.push("");
    return out;
}

function pairsEvidence(e: Evidence, truth: PairsTruthFile): string[] {
    const groups = truth.names ? `the folder names ${truth.names.join(", ")} below it (each file under the deepest on its path)` : "its children";
    const out = [`### ${truth.id.toUpperCase()}: which of ${groups} import which, in ${code(truth.folder)} (${truth.pairs.length} pairs)`, ""];
    const group = truth.names ? nameOf(truth.folder, truth.names) : childOf(truth.folder);
    const edges = new Map<string, [string, string][]>();
    for (const [a, b] of sortEdges(e.g.edges)){
        const [ga, gb] = [group(a), group(b)];
        if (ga === null || gb === null || (truth.names === null && ga === gb)) continue;
        const list = edges.get(`${ga}\0${gb}`);
        if (list) list.push([a, b]);
        else edges.set(`${ga}\0${gb}`, [[a, b]]);
    }
    truth.pairs.forEach(([from, to], i) => {
        const list = edges.get(`${from}\0${to}`) ?? [];
        const [a, b] = list[0];
        out.push(`${i + 1}. ${from} → ${to} (${plural(list.length, "import")}); the first: ${code(a)} → ${code(b)}`, ...lineEvidence(e, a, b, hitsOf(e, a, (t) => t === b)));
    });
    out.push("");
    return out;
}

function evidenceFor(e: Evidence, truth: TruthFile, preImporters: ReadonlyMap<string, string[]>): string[] {
    switch (truth.kind){
        case "list": return listEvidence(e, truth);
        case "chain": return chainEvidence(e, truth);
        case "impact": return impactEvidence(truth);
        case "cycle": return cycleEvidence(e, truth);
        case "unused": return unusedEvidence(e, truth, preImporters);
        case "violations": return violationsEvidence(e, truth);
        case "entries": return entriesEvidence(e, truth);
        case "pairs": return pairsEvidence(e, truth);
    }
}

/** The lines of `from` whose preProcessFile specifier resolves to `to`. */
function preProcessLines(e: Evidence, from: string, to: string): string[] {
    const text = readSource(e, from);
    const lines = text.split(/\r?\n/);
    const found = preProcessImports(text).filter((i) => resolveSpecifier(from, i.specifier, e.known, e.resolve) === to);
    if (found.length === 0) return ["     - NO LINE FOUND: preProcessFile has this edge but no specifier resolves to it. Investigate."];
    return found.map((i) => `     - L${i.line}: ${code(clip(lines[i.line - 1]?.trim() ?? ""))}`);
}

const verdictNote = (e: Evidence, from: string, to: string): string => {
    const v = e.verdicts.filter((x) => x.from === from && x.to === to);
    return v.length === 0 ? " (undecided)" : ` (decided ${v.map((x) => `${x.decision}: ${x.why}`).join("; ")})`;
};

function disagreementSection(repo: string, e: Evidence, built: RepoGraphs): string[] {
    const { scannerOnly, preProcessOnly } = built.differences;
    const out = [`## ${repo}: ${plural(scannerOnly.length, "edge")} only the regex scanner has, ${preProcessOnly.length} only preProcessFile has`, ""];
    if (scannerOnly.length + preProcessOnly.length === 0) out.push("The two extractors agree on every edge.", "");
    scannerOnly.forEach(([a, b], i) => out.push(`${i + 1}. only the regex scanner: ${code(a)} → ${code(b)}${verdictNote(e, a, b)}`, ...lineEvidence(e, a, b, hitsOf(e, a, (t) => t === b))));
    preProcessOnly.forEach(([a, b], i) => out.push(`${scannerOnly.length + i + 1}. only preProcessFile: ${code(a)} → ${code(b)}${verdictNote(e, a, b)}`, ...preProcessLines(e, a, b)));
    out.push("");
    return out;
}

function sitesSection(repo: string, e: Evidence, built: RepoGraphs): string[] {
    const undecided = built.sites.filter((s) => s.verdicts.length === 0).length;
    const out = [
        `## ${repo}: ${plural(built.sites.length, "computed import() site")}, ${undecided} undecided`, "",
        "Neither extractor follows import(<identifier>). Read the code around each and record what it loads in adjudicated.json: { repo, from, line, to, decision: \"in\", why } per file it loads in the repo, or to: null with decision \"out\" when it loads nothing here. Undecided sites stay out of the truths.", "",
    ];
    const texts = new Map<string, string[]>();
    built.sites.forEach((s, i) => {
        if (!texts.has(s.file)) texts.set(s.file, readSource(e, s.file).split(/\r?\n/));
        out.push(`${i + 1}. ${code(s.file)} L${s.line}: ${code(clip(texts.get(s.file)![s.line - 1]?.trim() ?? ""))}`);
        if (s.verdicts.length === 0) out.push("   - undecided");
        for (const v of s.verdicts) out.push(`   - ${v.decision}${v.to === null ? "" : ` → ${code(v.to)}`}: ${v.why}`);
    });
    out.push("");
    return out;
}

function sampleSection(repo: string, e: Evidence, resting: readonly [string, string][], preProcess: Graph): string[] {
    const sample = sampleEdges(resting, 30);
    const pre = new Set(preProcess.edges.map(edgeKey));
    const out = [`## ${repo}: ${sample.length} of the ${sortEdges(resting).length} edges its truths rest on (seed ${SAMPLE_SEED})`, ""];
    sample.forEach(([a, b], i) => out.push(`${i + 1}. ${code(a)} → ${code(b)}${pre.has(edgeKey([a, b])) ? "" : " (preProcessFile lacks it)"}`, ...lineEvidence(e, a, b, hitsOf(e, a, (t) => t === b))));
    out.push("");
    return out;
}

// ---- the command

function sizeOf(t: TruthFile): string {
    switch (t.kind){
        case "list": case "unused": case "violations": case "entries": return plural(t.files.length, "file");
        case "chain": return t.connected ? `${t.shortest} steps` : "none";
        case "cycle": return t.shortest === null ? "none" : `${t.shortest} steps`;
        case "impact": return `${t.total} files (${t.counts.map(([f, n]) => `${f} ${n}`).join(", ")}, elsewhere ${t.elsewhere})`;
        case "pairs": return plural(t.pairs.length, "pair");
    }
}

/** How a truth built with --out differs from the eval's own, line by line ([] when they are the same). */
export function compareTruths(built: TruthFile, reference: TruthFile): string[] {
    const out: string[] = [];
    if (built.kind !== reference.kind) return [`a ${built.kind} here, a ${reference.kind} there`];
    if ("files" in built && "files" in reference){
        // entries the reference's hand check added by reading (Eval #1's notes, decision "added")
        const byReading = new Set((reference.notes as { path?: string; decision?: string }[]).filter((n) => n?.decision === "added").map((n) => n.path));
        const [now, then] = [new Set(built.files), new Set(reference.files)];
        const show = (label: string, list: string[]): void => { if (list.length > 0) out.push(`${label} (${list.length}): ${list.join(", ")}`); };
        show("found by this build, which the reference added by reading", built.files.filter((f) => byReading.has(f)));
        show("only by reading still, not in this build", reference.files.filter((f) => byReading.has(f) && !now.has(f)));
        show("in this build, not in the reference", built.files.filter((f) => !then.has(f)));
        show("in the reference (its scanner's), not in this build", reference.files.filter((f) => !byReading.has(f) && !now.has(f)));
        return out;
    }
    // the truth itself, without the hand check's fields (JSON leaves out a field set to undefined)
    const json = (t: TruthFile): string => JSON.stringify({ ...t, verified: undefined, notes: undefined });
    if (json(built) !== json(reference)) out.push(`this build ${json(built)}, the reference ${json(reference)}`);
    return out;
}

/** Whether a truth file already on disk carries a hand check (verified, or notes), which a rebuild must not erase. */
function isHandChecked(file: string): boolean {
    if (!fs.existsSync(file)) return false;
    const old = JSON.parse(fs.readFileSync(file, "utf8")) as { verified?: boolean; notes?: unknown[] };
    return old.verified === true || (old.notes ?? []).length > 0;
}

export const USAGE = "usage: npm run eval:truth -- [--eval <dir> (default eval)] [<path to a repo's checkout>] [--force] [--out <dir>] [--resolve-bare]";
export type TruthArgs = { evalDir: string; force: boolean; out: string | null; resolveBare: boolean; paths: string[] };

export function parseArgs(argv: readonly string[]): TruthArgs {
    const args: TruthArgs = { evalDir: "eval", force: false, out: null, resolveBare: false, paths: [] };
    for (let i = 0; i < argv.length; i++){
        const arg = argv[i];
        if (arg === "--force") args.force = true;
        else if (arg === "--resolve-bare") args.resolveBare = true;
        else if (arg === "--eval" || arg === "--out"){
            const value = argv[++i];
            if (value === undefined || value.startsWith("--")) throw new Error(USAGE);
            if (arg === "--eval") args.evalDir = value;
            else args.out = value;
        } else if (arg.startsWith("--")) throw new Error(USAGE);
        else args.paths.push(arg);
    }
    if (args.paths.length > 1) throw new Error(USAGE);
    return args;
}

function main(): void {
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    let args: TruthArgs;
    let definition: EvalDefinition;
    let specs: TruthSpec[];
    let adjudications: Adjudication[];
    const adjudicatedFile = (d: EvalDefinition): string => `${forward(d.dir)}/truth/adjudicated.json`;
    try {
        args = parseArgs(process.argv.slice(2));
        definition = loadDefinition(path.resolve(checkout, args.evalDir));
        specs = specsFor(definition);
        const file = adjudicatedFile(definition);
        adjudications = fs.existsSync(file) ? parseAdjudications(JSON.parse(fs.readFileSync(file, "utf8")), Object.keys(definition.repos)) : [];
    } catch (error){
        console.error((error as Error).message);
        process.exitCode = 1;
        return;
    }
    const evalName = path.basename(definition.dir);
    const resolveBare = definition.name !== EVAL1 || args.resolveBare;
    const rootOf = (repo: string): string => forward(path.resolve(checkout, definition.repos[repo].path));

    // the repos: every one the specs use, or the one a checkout given names
    let repos = [...new Set(specs.map((s) => s.repo!))];
    if (args.paths.length === 1){
        const root = forward(path.resolve(args.paths[0]));
        const picked = repos.find((r) => rootOf(r) === root);
        if (picked === undefined){
            console.error(`${root} is none of the repos ${evalName}'s truths use (${repos.map((r) => definition.repos[r].path).join(", ")}).`);
            process.exitCode = 1;
            return;
        }
        repos = [picked];
    }
    const heads = new Map<string, string>();
    for (const repo of repos){
        const head = execFileSync("git", ["-C", rootOf(repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        if (head !== definition.repos[repo].commit){
            console.error(`${rootOf(repo)} is at ${head}, not ${definition.repos[repo].commit}: the eval's ground truth is for that commit.`);
            process.exitCode = 1;
            return;
        }
        heads.set(repo, head);
    }

    // every repo's graphs first, and every verdict checked against them, so a verdict that can't take effect stops the build
    // before any truth or sheet is written
    const builds = new Map<string, { built: RepoGraphs; effects: VerdictEffects; seconds: string }>();
    for (const repo of repos){
        const started = Date.now();
        const built = buildRepoGraphs(rootOf(repo), repo, adjudications, { resolveBare });
        try {
            builds.set(repo, { built, effects: checkVerdicts(built), seconds: ((Date.now() - started) / 1000).toFixed(1) });
        } catch (error){
            console.error((error as Error).message);
            process.exitCode = 1;
            return;
        }
    }

    const reference = `${forward(definition.dir)}/truth`;
    const truthDir = args.out !== null ? forward(path.resolve(checkout, args.out)) : reference;
    const sheetDir = args.out !== null ? truthDir : `${checkout}/.nebulosity/${evalName}`;
    fs.mkdirSync(truthDir, { recursive: true });
    fs.mkdirSync(sheetDir, { recursive: true });
    const intro = (what: string): string[] => [
        `# ${what} for ${definition.name}`, "",
        `Written by \`npm run eval:truth\` (scripts/eval/build-truth.ts); not committed. Bare specifiers ${resolveBare ? "resolved by scripts/eval/resolve-truth.ts" : "left unresolved (Eval #1's truths; --resolve-bare resolves them)"}.`, "",
    ];
    const evidence = intro("Truth evidence");
    evidence.push("For every edge a truth rests on: the importing file, then the target, then the line(s) that import it, read one line at a time as the scanner reads each file. The hand check reads this sheet; it is for the truths this run built, kept files or not.", "");
    const disagreements = intro("Where the two extractors disagree");
    const sites = intro("Computed import() sites");
    const sample = intro("A sample of the truths' edges");
    const comparisons: string[] = [];
    const rows: { id: string; size: string; planning: string; example: string[] }[] = [];

    for (const repo of repos){
        const root = rootOf(repo);
        const { built, effects: fx, seconds } = builds.get(repo)!;
        const { scannerOnly, preProcessOnly } = built.differences;
        const applied = fx.in + fx.out === 0 ? "no verdicts"
            : `${plural(fx.in + fx.out, "verdict")} (${fx.in} in, ${fx.out} out: ${plural(fx.edgesAdded, "edge")} added, ${fx.edgesRemoved} taken out, ${fx.confirmed} of the scanner's alone confirmed, ${fx.leftOut} of preProcessFile's alone left out, ${plural(fx.sitesDecided, "site")} decided)`;
        console.log(`scanned ${root} at ${heads.get(repo)!.slice(0, 8)}: ${built.scanner.files.length} code files, ${built.scanner.edges.length} edges (preProcessFile ${built.preProcess.edges.length}; ${scannerOnly.length} only the scanner's, ${preProcessOnly.length} only preProcessFile's), ${plural(built.sites.length, "computed import() site")} (${built.sites.filter((s) => s.verdicts.length === 0).length} undecided), ${applied}, ${seconds} s`);
        const e: Evidence = { root, known: built.known, g: built.graph, resolve: built.resolve, verdicts: built.verdicts };
        const preImporters = adjacency(built.preProcess, true);
        evidence.push(`## ${repo} (${definition.repos[repo].slug}) at ${heads.get(repo)!.slice(0, 8)}`, "");
        const sections: string[] = [];
        const resting: [string, string][] = [];
        const table: string[] = ["| Truth | Size | Planning scan |", "| --- | --- | --- |"];
        for (const spec of specs.filter((s) => s.repo === repo)){
            const truth = buildTruth(built.graph, spec);
            const file = `${truthDir}/${truth.id}.json`;
            const kept = !args.force && isHandChecked(file);
            if (!kept) fs.writeFileSync(file, `${JSON.stringify(truth, null, 2)}\n`);
            const onDisk = kept ? (JSON.parse(fs.readFileSync(file, "utf8")) as TruthFile) : truth;
            const size = kept
                ? `${sizeOf(onDisk)} (kept: it carries a hand check, and --force rebuilds it; this build gives ${sizeOf(truth) === sizeOf(onDisk) ? "the same" : sizeOf(truth)})`
                : sizeOf(truth);
            const example = onDisk.kind === "chain" || onDisk.kind === "cycle" ? onDisk.example ?? [] : [];
            rows.push({ id: truth.id, size, planning: spec.planning ?? "", example });
            table.push(`| ${truth.id.toUpperCase()} | ${sizeOf(truth)} | ${spec.planning ?? ""} |`);
            sections.push(...evidenceFor(e, truth, preImporters));
            resting.push(...restingEdges(built.graph, truth));
            const referenceFile = `${reference}/${truth.id}.json`;
            if (args.out !== null && fs.existsSync(referenceFile)){
                const lines = compareTruths(truth, JSON.parse(fs.readFileSync(referenceFile, "utf8")) as TruthFile);
                comparisons.push(`${truth.id}: ${sizeOf(truth)} here, ${sizeOf(JSON.parse(fs.readFileSync(referenceFile, "utf8")) as TruthFile)} in ${evalName}/truth${lines.length === 0 ? ", the same" : ""}`, ...lines.map((l) => `    ${l}`));
            }
        }
        evidence.push(...table, "", ...sections);
        disagreements.push(...disagreementSection(repo, e, built));
        sites.push(...sitesSection(repo, e, built));
        sample.push(...sampleSection(repo, e, resting, built.preProcess));
    }

    if (args.out === null && !fs.existsSync(adjudicatedFile(definition))) fs.writeFileSync(adjudicatedFile(definition), "[]\n");
    const sheets: [string, string[]][] = [
        ["truth-evidence.md", evidence], ["truth-disagreements.md", disagreements], ["computed-sites.md", sites], ["truth-sample.md", sample],
    ];
    for (const [name, lines] of sheets) fs.writeFileSync(`${sheetDir}/${name}`, `${lines.join("\n")}\n`);
    for (const r of rows) console.log(`${r.id}: ${r.size}${r.planning ? ` (planning scan: ${r.planning})` : ""}${r.example.length ? `\n    ${r.example.join("\n    ")}` : ""}`);
    if (args.out !== null) console.log(`\nAgainst ${evalName}/truth:\n${comparisons.join("\n")}`);
    console.log(`\nsheets in ${sheetDir}: ${sheets.map(([name]) => `${name} (${fs.statSync(`${sheetDir}/${name}`).size} bytes)`).join(", ")}`);
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]build-truth\.ts$/.test(process.argv[1] ?? "")) main();
