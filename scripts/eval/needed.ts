/**
 * npm run eval:needed -- --eval <dir> [--out <file>]
 *
 * The files a question's answer needs, fixed from its truth before the first run (ADR-060, D2 of V1.7's plan): a list
 * truth's files, a call truth's files, a task's CHANGE and TESTS together, and for a chain or cycle the shortest-path DAG of the truth's graph (every shortest path, not one example).
 * Time to relevant context (context.ts) is measured against them. Written to <dir>/truth/needed.json as
 * { [question id]: Needed }, for the single questions that have a needed set. It reads the truth's graph through build-truth.ts and
 * scan.ts only, never score.ts, and definition.ts no longer imports run-config.ts, so nothing here reaches lib/ (scan.test.ts follows the imports).
 */
import fs from "fs";
import path from "path";
import { buildRepoGraphs, EVAL1, parseAdjudications, type ChainTruthFile, type CycleTruthFile, type TruthFile } from "./build-truth";
import type { Needed } from "./context";
import { loadDefinition } from "./definition";
import { scanRepo } from "./scan";
import { adjacency, type Graph } from "./truth";

type Paths = Extract<Needed, { kind: "paths" }>;

/** Breadth-first steps from every start along `next` (importees forward, importers backward). */
function distances(next: ReadonlyMap<string, readonly string[]>, starts: readonly string[]): Map<string, number> {
    const dist = new Map<string, number>(starts.map((s) => [s, 0]));
    const queue = [...starts];
    while (queue.length > 0){
        const at = queue.shift()!;
        for (const w of next.get(at) ?? []) if (!dist.has(w)){ dist.set(w, dist.get(at)! + 1); queue.push(w); }
    }
    return dist;
}

const under = (p: string, folder: string): boolean => folder === "" || p === folder || p.startsWith(`${folder}/`);
const allNodes = (g: Graph): string[] => [...new Set([...g.files, ...g.edges.flat()])];

/** The shortest-path DAG from the sources to the targets, with its length in steps; null when none connects. */
function shortestDag(g: Graph, sources: string[], targets: string[]): { dag: Paths; length: number } | null {
    const forward = distances(adjacency(g, false), sources);
    const backward = distances(adjacency(g, true), targets);
    let length = Infinity;
    for (const t of targets) length = Math.min(length, forward.get(t) ?? Infinity);
    if (length === Infinity) return null;
    const onPath = new Set(allNodes(g).filter((n) => (forward.get(n) ?? Infinity) + (backward.get(n) ?? Infinity) === length));
    return {
        length,
        dag: {
            kind: "paths",
            nodes: allNodes(g).filter((n) => onPath.has(n)),
            edges: g.edges.filter(([a, b]) => onPath.has(a) && onPath.has(b) && (forward.get(a) ?? Infinity) + 1 + (backward.get(b) ?? Infinity) === length).map(([a, b]): [string, string] => [a, b]),
            from: [...onPath].filter((n) => forward.get(n) === 0),
            to: [...onPath].filter((n) => backward.get(n) === 0),
        },
    };
}

const chainOf = (g: Graph, from: string, to: string): { dag: Paths; length: number } | null =>
    shortestDag(g, allNodes(g).filter((f) => under(f, from)), allNodes(g).filter((f) => under(f, to)));

/** The shortest-path DAG of a chain question; null when nothing connects or nothing lies strictly between the ends. */
export function chainDag(g: Graph, from: string, to: string): Paths | null {
    const found = chainOf(g, from, to);
    return found === null || found.length < 2 ? null : found.dag;
}

/** The shortest cycles through `file` as a DAG whose end is written `<file>#`; null when the cycle has nothing between. */
export function cycleDag(g: Graph, file: string, shortest: number): Paths | null {
    if (shortest < 2) return null;
    const forward = distances(adjacency(g, false), [file]);
    const backward = distances(adjacency(g, true), [file]);
    const end = `${file}#`;
    const onPath = (n: string): boolean => n !== file && (forward.get(n) ?? Infinity) + (backward.get(n) ?? Infinity) === shortest;
    const nodes = allNodes(g).filter((n) => n === file || onPath(n));
    const edges: [string, string][] = [];
    for (const [a, b] of g.edges){
        if (a === file && b === file) continue;
        if ((a !== file && !onPath(a)) || (b !== file && !onPath(b))) continue;
        if ((forward.get(a) ?? Infinity) + 1 + (backward.get(b) ?? Infinity) === shortest) edges.push([a, b === file ? end : b]);
    }
    return { kind: "paths", nodes: [...nodes, end], edges, from: [file], to: [end] };
}

const filesOnly = (files: string[]): Needed | null => (files.length === 0 ? null : { kind: "files", files });

/** A question's needed set from its truth, or null for the kinds and answers that have none (big picture, impact, pairs, "none"). */
export function neededFor(truth: TruthFile, g: Graph): Needed | null {
    switch (truth.kind){
        case "list": case "unused": case "violations": case "entries": case "callers": case "breaks": case "adopt": case "injects":
            return filesOnly(truth.files);
        case "task":
            return filesOnly([...new Set([...truth.change, ...truth.tests])].sort());
        case "chain": {
            const t = truth as ChainTruthFile;
            if (!t.connected || t.shortest === null) return null;
            const found = chainOf(g, t.from, t.to);
            if (found === null || found.length !== t.shortest) throw new Error(`${t.id}: the truth says a chain of ${t.shortest} steps and the graph has ${found === null ? "none" : found.length}.`);
            return found.length < 2 ? null : found.dag;
        }
        case "cycle": {
            const t = truth as CycleTruthFile;
            return t.shortest === null ? null : cycleDag(g, t.file, t.shortest);
        }
        default:
            return null;
    }
}

// ---- the command

const USAGE = "usage: npm run eval:needed -- --eval <dir> [--out <file>]";
const forward = (p: string): string => p.replace(/\\/g, "/");

function main(): void {
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    const args = process.argv.slice(2);
    let evalDir = "eval";
    let out: string | null = null;
    for (let i = 0; i < args.length; i++){
        if (args[i] === "--eval" && args[i + 1] !== undefined) evalDir = args[++i];
        else if (args[i] === "--out" && args[i + 1] !== undefined) out = args[++i];
        else throw new Error(`unknown argument ${args[i]}. ${USAGE}`);
    }
    const definition = loadDefinition(path.resolve(checkout, evalDir));
    const dir = forward(definition.dir);
    const repoIds = Object.keys(definition.repos);
    const file = JSON.parse(fs.readFileSync(`${dir}/questions.json`, "utf8")) as { questions: { id: string; repo?: string; truth?: string; session?: string }[] };
    const firstEval = definition.name === EVAL1;
    // the truth's graph: Eval #1's is the scanner's; any other eval's is buildRepoGraphs with the truths' own verdicts (adjudicated.json)
    const verdictsFile = `${dir}/truth/adjudicated.json`;
    const verdicts = firstEval || !fs.existsSync(verdictsFile) ? [] : parseAdjudications(JSON.parse(fs.readFileSync(verdictsFile, "utf8")), repoIds);
    const graphs = new Map<string, Graph>();
    const graphOf = (repo: string): Graph => {
        if (!graphs.has(repo)){
            const root = forward(path.resolve(checkout, definition.repos[repo].path));
            graphs.set(repo, firstEval ? scanRepo(root) : buildRepoGraphs(root, repo, verdicts, { resolveBare: true }).graph);
        }
        return graphs.get(repo)!;
    };
    const repoOf = (named: string | undefined, id: string): string => {
        const repo = named ?? (repoIds.length === 1 ? repoIds[0] : undefined);
        if (repo === undefined || !repoIds.includes(repo)) throw new Error(`question ${id} names no repo that eval.json lists.`);
        return repo;
    };

    const needed: Record<string, Needed> = {};
    const kinds = new Map<string, number>();
    const left: string[] = [];
    for (const q of file.questions){
        if (q.session !== undefined || q.truth === undefined) continue;
        const truth = JSON.parse(fs.readFileSync(`${checkout}/${q.truth}`, "utf8")) as TruthFile;
        const n = neededFor(truth, graphOf(repoOf(q.repo, q.id)));
        if (n === null){
            left.push(`${q.id} (${truth.kind}${truth.kind === "impact" || truth.kind === "pairs" ? ": a count" : ": no files between or none"})`);
            continue;
        }
        needed[q.id] = n;
        const key = `${truth.kind} -> ${n.kind}`;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
    const target = out !== null ? path.resolve(checkout, out) : path.join(dir, "truth", "needed.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(needed, null, 2)}\n`);
    console.log(`wrote ${Object.keys(needed).length} needed sets to ${forward(target)}`);
    for (const [k, c] of kinds) console.log(`  ${k}: ${c}`);
    console.log(`left out (${left.length}): ${left.join(", ") || "none"}`);
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]needed\.ts$/.test(process.argv[1] ?? "")) main();
