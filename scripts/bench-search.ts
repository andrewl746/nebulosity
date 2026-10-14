/**
 * npm run bench-search -- [path-to-repo]   (default ../vscode)
 *
 * Search Benchmark #2 (D5 in docs/plans/2026-10-13-v1-5-ship.md): runs the tuning set through the real engine, read
 * only, and prints where the first expected target lands for each query, hit@1/3/5 and MRR per group, and V1.2's five
 * checks (each must stay in the top 5).
 */
import fs from "fs";
import path from "path";
import { useReadOnlyDatabase } from "../lib/db/client";
import { search } from "../lib/engine/search";
import { firstAcceptable, metrics, type Expectation } from "./search-metrics";

type QueryFile = { v12: { query: string; expect: string[] }[]; queries: Expectation[] };

async function main(): Promise<void> {
    const repo = path.resolve(process.argv[2] ?? path.join("..", "vscode"));
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a database mode switch, not a React hook; the name only starts with "use"
    useReadOnlyDatabase();
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, "bench-search-queries.json"), "utf8")) as QueryFile;

    const rows: string[] = [];
    const ranks = new Map<string, (number | null)[]>();
    for (const q of file.queries){
        const result = await search(repo, q.query, { limit: 10 });
        const rank = firstAcceptable(result.hits, q.expect);
        ranks.set(q.group, [...(ranks.get(q.group) ?? []), rank]);
        rows.push(`| ${q.group} | \`${q.query}\` | ${rank ?? "—"} | ${result.hits.slice(0, 3).map((h) => `\`${h.path}${h.kind === "folder" ? "/" : ""}\``).join(", ")} |`);
    }

    console.log("| Group | Query | First expected | Top 3 |\n|---|---|---|---|");
    for (const row of rows) console.log(row);
    console.log("\n| Group | Queries | hit@1 | hit@3 | hit@5 | MRR@10 |\n|---|---|---|---|---|---|");
    const all = [...ranks.values()].flat();
    for (const [group, list] of [...ranks.entries(), ["all", all] as const]){
        const m = metrics(list);
        console.log(`| ${group} | ${m.queries} | ${m.hitAt1.toFixed(2)} | ${m.hitAt3.toFixed(2)} | ${m.hitAt5.toFixed(2)} | ${m.mrr.toFixed(3)} |`);
    }

    console.log("\nV1.2's five checks (top 5 required):");
    let lost = 0;
    for (const check of file.v12){
        const rank = firstAcceptable((await search(repo, check.query, { limit: 10 })).hits, check.expect);
        if (rank === null || rank > 5) lost++;
        console.log(`  ${check.query}: ${rank ?? "not in the top 10"}`);
    }
    process.exit(lost === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
