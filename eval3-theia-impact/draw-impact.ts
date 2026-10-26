/**
 * npx tsx eval3-theia-impact/draw-impact.ts
 *
 * The question of Eval #3's Theia addendum (2026-10-26): Theia's impact question, which Eval #3 didn't ask there (its ruling
 * R-W kept Theia's graph questions to file-set kinds). The rule was fixed before any run, in the manner of Eval #3's Theia
 * graph draw, from the truth's own graph (scripts/eval only, nothing from lib/), and nobody sees how either arm does first:
 *   - a candidate is a non-test file that 10–50% of the repo's files depend on, directly or through other files (Eval #2's two
 *     impact targets reached 30% and 23% of their repos' files);
 *   - it may not share a target with Theia's Eval #3 questions or with Eval #3's dev set (overlap.ts);
 *   - the candidates are sorted by id, shuffled with mulberry32(1), and the first is drawn (draw.ts's draw);
 *   - its folders are the four folders directly under packages/ that hold the most of its dependents, by count, then by
 *     name (four, as AFFiNE's impact question has), and the answer adds elsewhere and the total.
 * It writes eval3-theia-impact/truth-specs.json with the drawn question, and prints the pool. Reads ../theia only.
 */
import fs from "fs";
import path from "path";
import { buildRepoGraphs } from "../scripts/eval/build-truth";
import { draw } from "../scripts/eval/draw";
import { askedOfQuestion, askedOfSpec, overlaps } from "../scripts/eval/overlap";
import { isTestFile, transitiveDependents } from "../scripts/eval/truth";

const ROOT = path.resolve(__dirname, "..");
const HERE = __dirname;
const checkout = path.resolve(ROOT, "..", "theia");
const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON read field by field

const verdicts = readJson(path.join(HERE, "truth", "adjudicated.json"));
const g = buildRepoGraphs(checkout, "theia", verdicts, { resolveBare: true }).graph;
const files = [...g.files].sort();
console.log(`theia graph: ${files.length} files, ${g.edges.length} edges, ${verdicts.length} verdicts`);

// what a candidate may not share a target with: Theia's Eval #3 questions and Eval #3's dev set
const eval3Specs = (readJson(path.join(ROOT, "eval3", "truth-specs.json")) as { id: string; repo: string }[]).filter((s) => s.repo === "theia");
const dev = (readJson(path.join(ROOT, "eval3", "dev", "questions.json")).questions as { id: string; repo?: string }[]).map((q) => askedOfQuestion(q, undefined));
const avoid = [...eval3Specs.map((s) => askedOfSpec(s as Parameters<typeof askedOfSpec>[0])), ...dev];

const low = Math.ceil(files.length * 0.1);
const high = Math.floor(files.length * 0.5);
type Candidate = { id: string; target: string; dependents: number };
const candidates: Candidate[] = [];
let n = 0;
for (const f of files){
    if (isTestFile(f)) continue;
    const dependents = transitiveDependents(g, f).length;
    if (dependents < low || dependents > high) continue;
    const id = `theia-impact-${++n}`;
    if (overlaps([askedOfSpec({ id, repo: "theia", kind: "impact", target: f, folders: [] } as Parameters<typeof askedOfSpec>[0])], avoid).length > 0) continue;
    candidates.push({ id, target: f, dependents });
}
const [drawn] = draw(candidates, 1, 1);
if (!drawn) throw new Error(`no candidate between ${low} and ${high} dependents`);

const byPackage = new Map<string, number>();
for (const d of transitiveDependents(g, drawn.target)){
    const parts = d.split("/");
    if (parts[0] === "packages" && parts.length > 2) byPackage.set(`packages/${parts[1]}`, (byPackage.get(`packages/${parts[1]}`) ?? 0) + 1);
}
const folders = [...byPackage].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 4).map(([folder]) => folder);

console.log(`candidates: ${candidates.length} non-test files with ${low}–${high} dependents and no shared target`);
console.log(`drawn: ${drawn.id}, ${drawn.target}, ${drawn.dependents} dependents`);
console.log(`folders: ${folders.map((f) => `${f} (${byPackage.get(f)})`).join(", ")}`);
const spec = {
    id: "theia-impact", repo: "theia", kind: "impact", target: drawn.target, folders,
    why: `Eval #3's Theia addendum (2026-10-26), drawn by eval3-theia-impact/draw-impact.ts: ${drawn.id} of ${candidates.length} candidates (non-test files with ${low}–${high} dependents, 10–50% of ${files.length}), mulberry32(1); its folders are the four packages holding the most of its dependents.`,
};
fs.writeFileSync(path.join(HERE, "truth-specs.json"), `${JSON.stringify([spec], null, 2)}\n`);
