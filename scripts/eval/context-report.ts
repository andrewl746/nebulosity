/**
 * npm run eval:context -- --eval <dir> [--needed <file>] [--runs <dir>] [--refusal-free]
 *
 * Read-only. Time to relevant context (context.ts) for every kept single run whose question has a needed set (needed.ts),
 * printed per question kind, per repo and pooled: each arm's reached share and median TTRC (from the run's startedAt, the
 * gate's measure, and from the query start), its ratio to Alone, the matched per-question ratios' median with a seeded
 * bootstrap interval over questions, the same for the mostly-relevant version, and the median tokens to relevant context.
 * With --refusal-free, Alone's runs with a refused call are left out (the design check's Follow-up 1). Reads the scorer's run-name helpers
 * from score.ts, so it is not one of the lib-free modules.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { relevantContext, type ContextResult, type Needed } from "./context";
import { loadDefinition } from "./definition";
import { lastPerName, parseRunName, repoIdFor } from "./score";
import { bootstrapMedianInterval, median, ratioOfMedians } from "./stats";
import { refusedCalls } from "./transcript";

type Row = { name: string; question: string; repo: string; kind: string; arm: string; refused: number; result: ContextResult };

const forward = (p: string): string => p.replace(/\\/g, "/");
const USAGE = "usage: npm run eval:context -- --eval <dir> [--needed <file>] [--runs <dir>] [--refusal-free]";
const seconds = (ms: number | null): string => (ms === null ? "-" : ms === Infinity ? "inf" : (ms / 1000).toFixed(1));
const ratioText = (r: number): string => (r === Infinity ? "inf" : r.toFixed(2));

/** A median over runs, a run that never reached counting as infinitely late; null with no runs. */
const medianOf = (rows: readonly Row[], pick: (r: Row) => number | null): number | null =>
    rows.length === 0 ? null : median(rows.map((r) => pick(r) ?? Infinity));

function main(): void {
    const checkout = forward(path.resolve(__dirname, "..", ".."));
    const args = process.argv.slice(2);
    let evalDir = "eval";
    let neededFile: string | null = null;
    let runsDir: string | null = null;
    let refusalFree = false;
    for (let i = 0; i < args.length; i++){
        if (args[i] === "--eval" && args[i + 1] !== undefined) evalDir = args[++i];
        else if (args[i] === "--needed" && args[i + 1] !== undefined) neededFile = args[++i];
        else if (args[i] === "--runs" && args[i + 1] !== undefined) runsDir = args[++i];
        else if (args[i] === "--refusal-free") refusalFree = true;
        else throw new Error(`unknown argument ${args[i]}. ${USAGE}`);
    }
    const definition = loadDefinition(path.resolve(checkout, evalDir));
    const dir = forward(definition.dir);
    const repoIds = Object.keys(definition.repos);
    const needed = JSON.parse(fs.readFileSync(neededFile !== null ? path.resolve(checkout, neededFile) : `${dir}/truth/needed.json`, "utf8")) as Record<string, Needed>;
    const questions = new Map((JSON.parse(fs.readFileSync(`${dir}/questions.json`, "utf8")) as { questions: { id: string; repo?: string; kind?: string; family?: string }[] }).questions.map((q) => [q.id, q]));
    const runs = runsDir !== null ? forward(path.resolve(checkout, runsDir)) : `${dir}/runs`;
    const index = fs.existsSync(`${runs}/index.jsonl`) ? lastPerName(fs.readFileSync(`${runs}/index.jsonl`, "utf8")) : new Map();

    const tracked = new Map<string, Set<string>>();
    const trackedOf = (repo: string): Set<string> => {
        if (!tracked.has(repo)){
            const root = path.resolve(checkout, definition.repos[repo].path);
            const listing = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
            tracked.set(repo, new Set(listing.split(/\r?\n/).filter(Boolean).map((f) => f.toLowerCase())));
        }
        return tracked.get(repo)!;
    };

    const rows: Row[] = [];
    for (const file of fs.readdirSync(runs).filter((f) => f.endsWith(".jsonl.gz")).sort()){
        const name = file.slice(0, -".jsonl.gz".length);
        const id = parseRunName(name);
        const meta = index.get(name);
        if (id === null || meta === undefined || typeof meta.session === "string" || needed[id.question] === undefined) continue;
        const q = questions.get(id.question)!;
        const repo = repoIdFor(repoIds, q.repo, q.id);
        const raw = zlib.gunzipSync(fs.readFileSync(`${runs}/${file}`)).toString("utf8");
        if (typeof meta.startedAt !== "string") continue;
        rows.push({
            name, question: id.question, repo, kind: q.kind ?? q.family ?? "?",
            arm: id.arm === "baseline" ? "A" : id.toolSearch ? "N" : "N-up",
            refused: refusedCalls(raw),
            result: relevantContext({ jsonl: raw, startedAt: meta.startedAt, repoId: repo, needed: needed[id.question], tracked: trackedOf(repo) }),
        });
    }
    const arms = [...new Set(rows.map((r) => r.arm))].sort();
    const others = arms.filter((a) => a !== "A");
    console.log(`${definition.name}: ${rows.length} runs with a needed set (${[...new Set(rows.map((r) => r.question))].length} questions)${refusalFree ? ", Alone's runs with a refused call left out" : ""}`);

    const keep = (r: Row): boolean => !(refusalFree && r.arm === "A" && r.refused > 0);
    const kept = rows.filter(keep);
    const sets: [string, (r: Row) => boolean][] = [
        ...[...new Set(rows.map((r) => r.kind))].sort().map((k): [string, (r: Row) => boolean] => [k, (r) => r.kind === k]),
        ...repoIds.map((id): [string, (r: Row) => boolean] => [`repo ${id}`, (r) => r.repo === id]),
        ["pooled", () => true],
    ];

    console.log("\n| Set | Arm | Runs | Reached | TTRC from start (s) | from query (s) | Median tokens | Ratio to A, start / query |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const [label, pick] of sets){
        const base = kept.filter((r) => r.arm === "A" && pick(r));
        const baseStart = medianOf(base, (r) => r.result.ttrcMs);
        const baseQuery = medianOf(base, (r) => r.result.ttrcQueryMs);
        for (const arm of arms){
            const mine = kept.filter((r) => r.arm === arm && pick(r));
            if (mine.length === 0) continue;
            const start = medianOf(mine, (r) => r.result.ttrcMs);
            const query = medianOf(mine, (r) => r.result.ttrcQueryMs);
            const reachedTokens = mine.filter((r) => r.result.tokens !== null).map((r) => r.result.tokens!);
            const ratio = (a: number | null, b: number | null): string => (arm === "A" || a === null || b === null || b === 0 || (a === Infinity && b === Infinity) ? "-" : ratioText(a / b));
            console.log(`| ${label} | ${arm} | ${mine.length} | ${mine.filter((r) => r.result.reached).length}/${mine.length} | ${seconds(start)} | ${seconds(query)} | ${reachedTokens.length === 0 ? "-" : Math.round(median(reachedTokens))} | ${ratio(start, baseStart)} / ${ratio(query, baseQuery)} |`);
        }
    }

    console.log("\nThe mostly-relevant version (a result counts only if half its tracked files are needed; the design check's floor version):");
    console.log("| Set | Arm | Reached | TTRC from start (s) | from query (s) | Ratio to A, start / query |");
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const [label, pick] of sets){
        const base = kept.filter((r) => r.arm === "A" && pick(r));
        const baseStart = medianOf(base, (r) => r.result.mostlyRelevant.ttrcMs);
        const baseQuery = medianOf(base, (r) => r.result.mostlyRelevant.ttrcQueryMs);
        for (const arm of arms){
            const mine = kept.filter((r) => r.arm === arm && pick(r));
            if (mine.length === 0) continue;
            const start = medianOf(mine, (r) => r.result.mostlyRelevant.ttrcMs);
            const query = medianOf(mine, (r) => r.result.mostlyRelevant.ttrcQueryMs);
            const ratio = (a: number | null, b: number | null): string => (arm === "A" || a === null || b === null || b === 0 || (a === Infinity && b === Infinity) ? "-" : ratioText(a / b));
            console.log(`| ${label} | ${arm} | ${mine.filter((r) => r.result.mostlyRelevant.reached).length}/${mine.length} | ${seconds(start)} | ${seconds(query)} | ${ratio(start, baseStart)} / ${ratio(query, baseQuery)} |`);
        }
    }

    // matched per question: N's median TTRC over A's, then the median of those and its bootstrap interval over questions
    console.log("\nMatched per question (median over questions of N's median TTRC / A's, [95% bootstrap interval over questions]):");
    const questionIds = [...new Set(kept.map((r) => r.question))].sort();
    const measures: [string, (r: Row) => number | null][] = [
        ["plain rule, from start", (r) => r.result.ttrcMs],
        ["plain rule, from query", (r) => r.result.ttrcQueryMs],
        ["mostly relevant, from start", (r) => r.result.mostlyRelevant.ttrcMs],
        ["mostly relevant, from query", (r) => r.result.mostlyRelevant.ttrcQueryMs],
    ];
    for (const arm of others){
        for (const [measure, value] of measures){
            for (const [label, pick] of [...repoIds.map((id): [string, (repo: string) => boolean] => [id, (repo) => repo === id]), ["pooled", (): boolean => true] as [string, (repo: string) => boolean]]){
                const ratios: number[] = [];
                for (const q of questionIds){
                    const a = kept.filter((r) => r.question === q && r.arm === "A").map(value);
                    const n = kept.filter((r) => r.question === q && r.arm === arm).map(value);
                    const repo = kept.find((r) => r.question === q)!.repo;
                    if (a.length === 0 || n.length === 0 || !pick(repo)) continue;
                    ratios.push(ratioOfMedians(a, n));
                }
                if (ratios.length === 0) continue;
                const [lo, hi] = bootstrapMedianInterval(ratios);
                console.log(`  ${arm} vs A, ${measure}, ${label} (${ratios.length} questions): ${ratioText(median(ratios))} [${ratioText(lo)}-${ratioText(hi)}]`);
            }
        }
    }
}

// runs only as a script, so the tests can import what's above
if (/[\\/]context-report\.ts$/.test(process.argv[1] ?? "")) main();
