/**
 * npm run bench-languages -- <path-to-repo>… [--runs 3] [--data-root <folder>] [--keep]
 *
 * L1 and S1 (PIVOT_SPEC.md §2; E4's Task I4): the structure stage of each repo, cold. Every run indexes into a fresh
 * NEBULOSITY_DATA folder (a new database, so nothing is stored yet), all in this one process after one
 * prepareLanguages(), so the rss printed after each run shows what the grammars and the runs leave in a long-lived
 * process (WebAssembly memory never shrinks). One repo at a time, in the order given; run it on a quiet machine.
 * Prints each run's stage timings, its files by language, edges and rss, then each repo's worst and median structure
 * total, and its L2 verdict ("no crash"): a file that failed to index, or whose parse threw so that the scan read it
 * instead (the E4 final review's B-I1), fails L2, and the process exits 1. The data folders are made under --data-root
 * (default: the system's temp folder) and removed after each run unless --keep. Free: it never calls Anthropic, and it
 * never touches the owner's database or the active repo.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { closeDb, getDb } from "../lib/db/client";
import { prepareLanguages } from "../lib/index/languages/registry";
import { describeScanned, indexRepository, type IndexResult } from "../lib/index/pipeline";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
};
const runs = Number(option("--runs") ?? 3);
const dataRoot = path.resolve(option("--data-root") ?? os.tmpdir());
const keep = args.includes("--keep");
const valued = new Set(["--runs", "--data-root"]);
const repos = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
if (repos.length === 0 || !Number.isInteger(runs) || runs < 1){
    console.error("usage: npm run bench-languages -- <path-to-repo>… [--runs 3] [--data-root <folder>] [--keep]");
    process.exit(1);
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const megabytes = (bytes: number): string => `${Math.round(bytes / 1e6).toLocaleString("en-US")} MB`;

/** The repo's stored files counted by files.language, most first. */
function filesByLanguage(repoId: number): string {
    const rows = getDb().$client.prepare("select language, count(*) as n from files where repo_id = ? group by language order by n desc, language")
        .all(repoId) as { language: string; n: number }[];
    return rows.map((r) => `${r.language} ${r.n.toLocaleString("en-US")}`).join(", ");
}

function printRun(repo: string, run: number, result: IndexResult, data: string): void {
    const t = result.timingsMs;
    console.log(`[bench] ${repo} run ${run}/${runs}: structure ${seconds(result.totalMs)} (discover ${seconds(t.discover)} · parse ${seconds(t.parse)}`
        + ` · write ${seconds(t.write)} · resolve ${seconds(t.resolve)} · aggregate ${seconds(t.aggregate)}); code search after it ${seconds(result.searchIndexMs)}`);
    console.log(`[bench]   files ${result.files.toLocaleString("en-US")} (${filesByLanguage(result.repoId)}) · edges ${result.edges.toLocaleString("en-US")}`
        + ` · imports only ${result.importsOnly.length} · skipped ${result.skipped.length} · errors ${result.errors.length}`
        + ` · scanned ${result.scanned.length}`
        + ` · head ${result.indexedHead ?? "none"} · rss ${megabytes(process.memoryUsage().rss)}${keep ? ` · data ${data}` : ""}`);
    if (result.errors.length > 0) console.log(`[bench]   errors, first: ${result.errors[0].path}: ${result.errors[0].error}`);
    if (result.scanned.length > 0) console.log(`[bench]   ${describeScanned(result.scanned)}`);
}

/** L2, no crash: every claimed file indexed by its parse, none failed and none read by the scan after a throw. */
function crashes(result: IndexResult): number {
    return result.errors.length + result.scanned.length;
}

async function main(): Promise<void> {
    const started = performance.now();
    await prepareLanguages();
    console.log(`[bench] grammars loaded in ${Math.round(performance.now() - started)} ms · rss ${megabytes(process.memoryUsage().rss)}`);

    const summary: string[] = [];
    for (const target of repos){
        const root = path.resolve(target);
        const totals: number[] = [];
        let worstCrashes = 0;
        for (let run = 1; run <= runs; run++){
            const data = fs.mkdtempSync(path.join(dataRoot, "neb-bench-"));
            process.env.NEBULOSITY_DATA = data;
            try{
                const result = indexRepository(root);
                totals.push(result.totalMs);
                worstCrashes = Math.max(worstCrashes, crashes(result));
                printRun(target, run, result, data);
            } finally{
                closeDb();
                if (!keep) fs.rmSync(data, { recursive: true, force: true });
            }
        }
        const sorted = [...totals].sort((a, b) => a - b);
        summary.push(`[bench] ${target}: worst ${seconds(sorted[sorted.length - 1])}, median ${seconds(sorted[Math.floor(sorted.length / 2)])}`
            + ` (${totals.map(seconds).join(", ")}); L2 ${worstCrashes === 0 ? "PASS" : `FAIL (${worstCrashes} files failed or read by the scan in the worst run)`}`);
        if (worstCrashes > 0) process.exitCode = 1;
    }
    for (const line of summary) console.log(line);
    console.log(`[bench] rss after all of them ${megabytes(process.memoryUsage().rss)}`);
}

void main();
