/**
 * nebulosity index <path-to-repo> [--no-activate]   (in a checkout: npm run index -- <path-to-repo> [--no-activate])
 *
 * Runs the structure stage on a repository, prints what it found and how long each
 * step took (the numbers recorded in docs/BENCHMARKS.md), and makes that repo the
 * active one for the Map and the MCP server. --no-activate indexes it and leaves the
 * active repo as it was (a second repo indexed beside the one the Map shows).
 * Free: it never calls Anthropic (the summaries stage's status is only re-derived).
 */
import path from "path";
import { prepareLanguages } from "../../lib/index/languages/registry";
import { describeScanned, indexRepository, RepoNotFoundError } from "../../lib/index/pipeline";
import { repoKey } from "../../lib/index/paths";
import { IndexLockedError } from "../../lib/db/store/lock";
import { readConfig, writeConfig } from "../../lib/config";
import { configuredSummaryModels } from "../../lib/index/summarize/models";
import { refreshSummaryStatus } from "../../lib/index/summarize/status";
import { hasAnthropicKey, loadLocalEnv } from "../env";

/**
 * Indexes the repo the arguments name. Resolves to the exit code: 0 done, 1 bad arguments or no such repo, 2 the index
 * is locked. Async because the tree-sitter grammars load first (prepareLanguages, ADR-065); the run itself is synchronous.
 */
export async function runIndex(args: readonly string[]): Promise<number> {
    loadLocalEnv();

    const [target, ...extra] = args;
    const activate = !extra.includes("--no-activate");

    if (!target || target.startsWith("--") || extra.some((arg) => arg !== "--no-activate")){
        console.error("usage: nebulosity index <path-to-repo> [--no-activate]   (in a checkout: npm run index -- <path-to-repo> [--no-activate])");
        return 1;
    }

    const root = path.resolve(target);
    const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

    console.log(`[index] ${root}`);

    // the grammars load once, asynchronously (WebAssembly can't start synchronously); the run is then synchronous
    await prepareLanguages();

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

        if (result.importsOnly.length > 0){
            const first = result.importsOnly[0];
            console.log(`[index] imports only ${result.importsOnly.length} (over the size cap; first: ${first.path}: ${first.sizeBytes} bytes)`);
        }
        if (result.skipped.length > 0){
            console.log(`[index] skipped ${result.skipped.length} (first: ${result.skipped[0].path}: ${result.skipped[0].reason})`);
        }
        if (result.errors.length > 0){
            console.log(`[index] ${result.errors.length} file errors (first: ${result.errors[0].path}: ${result.errors[0].error})`);
        }
        // a parse that threw, read by the scan instead (ADR-065, the E4 final review's B-I1): indexed, but imports only
        if (result.scanned.length > 0){
            console.log(`[index] ${describeScanned(result.scanned)} (first error: ${result.scanned[0].error})`);
        }

        // the summaries stage depends on what was just indexed (ADR-032, amended): re-derive it now, with the summary
        // models setting, since every inputHash holds its model (ADR-066). A setting that can't be used leaves the rows as
        // they were, and the stage too with a key; without one the stage still reads as free mode (refreshSummaryStatus).
        const models = configuredSummaryModels();
        const key = hasAnthropicKey();
        if (!models.ok){
            console.log(key
                ? `[index] summaries: not re-derived until the setting is fixed: ${models.error}`
                : `[index] summaries: summarize refuses the summary models setting until it's fixed: ${models.error}`);
        }
        const summaries = refreshSummaryStatus(root, { summarizerAvailable: key, models });
        if (summaries){
            console.log(`[index] summaries: ${summaries.state} ${summaries.done}/${summaries.total}${summaries.note ? ` (${summaries.note})` : ""}`);
        }

        if (activate){
            writeConfig({ ...readConfig(), activeRepo: repoKey(root) });
            console.log(`[index] active repo → ${repoKey(root)}`);
        } else{
            console.log(`[index] active repo unchanged (--no-activate)`);
        }
        return 0;
    } catch (err){
        if (err instanceof RepoNotFoundError){
            // returns before writeConfig, so a typo never becomes the active repo
            console.error(`[index] ${err.message}. Pass the path to a repository folder.`);
            return 1;
        }
        if (err instanceof IndexLockedError){
            console.error(`[index] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
            return 2;
        }
        throw err;
    }
}
