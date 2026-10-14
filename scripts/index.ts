/**
 * npm run index -- <path-to-repo> [--no-activate]
 *
 * Runs the structure stage on a repository, prints what it found and how long each
 * step took (the numbers recorded in docs/BENCHMARKS.md), and makes that repo the
 * active one for the Map and the MCP server. --no-activate indexes it and leaves the
 * active repo as it was (a second repo indexed beside the one the Map shows).
 */
import path from "path";
import { indexRepository, RepoNotFoundError } from "../lib/index/pipeline";
import { repoKey } from "../lib/index/paths";
import { IndexLockedError } from "../lib/db/store/lock";
import { readConfig, writeConfig } from "../lib/config";
import { refreshSummaryStatus } from "../lib/index/summarize/status";
import { hasAnthropicKey, loadLocalEnv } from "./env";

loadLocalEnv();

const target = process.argv[2];
const extra = process.argv.slice(3);
const activate = !extra.includes("--no-activate");

if (!target || target.startsWith("--") || extra.some((arg) => arg !== "--no-activate")){
    console.error("usage: npm run index -- <path-to-repo> [--no-activate]");
    process.exit(1);
}

const root = path.resolve(target);
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

console.log(`[index] ${root}`);

try{
    const result = indexRepository(root, {
        onProgress: (stage, done, total) => process.stdout.write(`\r[index] ${stage} ${done}/${total}   `),
    });
    process.stdout.write("\n");

    console.log(`[index] files ${result.files} (changed ${result.changed}, unchanged ${result.unchanged}, deleted ${result.deleted.length})`
        + ` · edges ${result.edges} · folders ${result.folders} · level edges ${result.levelEdges}`);
    console.log(`[index] discover ${seconds(result.timingsMs.discover)} · parse ${seconds(result.timingsMs.parse)}`
        + ` · write ${seconds(result.timingsMs.write)} · resolve ${seconds(result.timingsMs.resolve)}`
        + ` · aggregate ${seconds(result.timingsMs.aggregate)} · total ${seconds(result.totalMs)}`);
    if (result.searchIndexMs > 0) console.log(`[index] code search filled in ${seconds(result.searchIndexMs)} after the structure stage`);

    if (result.skipped.length > 0){
        console.log(`[index] skipped ${result.skipped.length} (first: ${result.skipped[0].path}: ${result.skipped[0].reason})`);
    }
    if (result.errors.length > 0){
        console.log(`[index] ${result.errors.length} file errors (first: ${result.errors[0].path}: ${result.errors[0].error})`);
    }

    // the summaries stage depends on what was just indexed (ADR-032, amended): re-derive it now
    const summaries = refreshSummaryStatus(root, { summarizerAvailable: hasAnthropicKey() });
    if (summaries){
        console.log(`[index] summaries: ${summaries.state} ${summaries.done}/${summaries.total}${summaries.note ? ` (${summaries.note})` : ""}`);
    }

    if (activate){
        writeConfig({ ...readConfig(), activeRepo: repoKey(root) });
        console.log(`[index] active repo → ${repoKey(root)}`);
    } else{
        console.log(`[index] active repo unchanged (--no-activate)`);
    }
} catch (err){
    if (err instanceof RepoNotFoundError){
        // exits before writeConfig, so a typo never becomes the active repo
        console.error(`[index] ${err.message}. Pass the path to a repository folder.`);
        process.exit(1);
    }
    if (err instanceof IndexLockedError){
        console.error(`[index] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
        process.exit(2);
    }
    throw err;
}
