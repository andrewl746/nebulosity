/**
 * npx tsx eval3-theia-impact/check-truth.ts
 *
 * The hand check's sheets for theia-impact (Eval #2's method for impact truths, R2): 10 of its dependents drawn with
 * mulberry32(1), each traced to the target along a shortest chain with the import line at every step, for reading in the
 * source; and the dependents' total on preProcessFile's graph, which shares no extractor with the scanner's. Reads ../theia only.
 */
import fs from "fs";
import path from "path";
import { buildRepoGraphs } from "../scripts/eval/build-truth";
import { draw } from "../scripts/eval/draw";
import { importSpecifiers } from "../scripts/eval/scan";
import { adjacency, impactByFolders, transitiveDependents } from "../scripts/eval/truth";

const ROOT = path.resolve(__dirname, "..");
const checkout = path.resolve(ROOT, "..", "theia");
const verdicts = JSON.parse(fs.readFileSync(path.join(__dirname, "truth", "adjudicated.json"), "utf8"));
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "truth-specs.json"), "utf8"))[0] as { target: string; folders: string[] };
const built = buildRepoGraphs(checkout, "theia", verdicts, { resolveBare: true });
const g = built.graph;

// the same counts on preProcessFile's graph (its edges, the same files)
const pre = { files: g.files, edges: built.preProcess.edges } as typeof g;
console.log(`scanner + verdicts: ${JSON.stringify(impactByFolders(g, spec.target, spec.folders))}`);
console.log(`preProcessFile:     ${JSON.stringify(impactByFolders(pre, spec.target, spec.folders))}`);

// a shortest chain from a dependent to the target, breadth-first over importees in path order
const out = adjacency(g, false);
function chain(from: string): string[] {
    const previous = new Map<string, string>([[from, ""]]);
    const queue = [from];
    while (queue.length > 0){
        const at = queue.shift()!;
        if (at === spec.target) break;
        for (const next of out.get(at) ?? []) if (!previous.has(next)){ previous.set(next, at); queue.push(next); }
    }
    const steps: string[] = [];
    for (let at = spec.target; at !== ""; at = previous.get(at)!) steps.unshift(at);
    return steps;
}
const lineOf = (from: string, to: string): string => {
    const text = fs.readFileSync(path.join(checkout, from), "utf8").split(/\r?\n/);
    const toNoExt = to.replace(/\.(d\.)?[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
    const hits: string[] = [];
    text.forEach((line, i) => {
        for (const s of importSpecifiers(line)){
            const tail = s.replace(/^@theia\/([^/]+)\/lib\//, "packages/$1/src/").replace(/^\.\//, "");
            const last = toNoExt.split("/").slice(-2).join("/");
            if (tail.endsWith(last) || tail.endsWith(toNoExt.split("/").pop()!) || (to.endsWith("/index.ts") && tail.endsWith(path.posix.dirname(to).split("/").pop()!))) hits.push(`L${i + 1}: ${line.trim()}`);
        }
    });
    return hits.length > 0 ? hits.join(" | ") : "(no line matched: read the file)";
};

const dependents = transitiveDependents(g, spec.target).sort();
const sample = draw(dependents.map((id) => ({ id })), 10, 1).map((d) => d.id);
for (const d of sample){
    const steps = chain(d);
    console.log(`\n${d} (${steps.length - 1} steps)`);
    for (let i = 0; i + 1 < steps.length; i++) console.log(`  ${steps[i]} -> ${steps[i + 1]}\n      ${lineOf(steps[i], steps[i + 1])}`);
}
