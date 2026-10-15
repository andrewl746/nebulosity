/**
 * nebulosity summarize <path-to-repo> [--direct | --batch] [--no-wait] [--budget <usd>] [--path <repo-relative path>]
 *                      [--release-batch <batch id>]... [--yes]
 * (in a checkout: npm run summarize -- <path-to-repo> …)
 *
 * Writes summaries for an indexed repository (PIVOT_SPEC.md §5.3), then embeds them for search (§5.4).
 * - A big first pass goes through the Message Batches API at half price and can take hours.
 *   --no-wait never sleeps: it collects the batches that have already ended, submits what
 *   that makes ready, and exits. Running the command again (by hand, or from cron) carries
 *   on from there.
 * - --budget caps this repo's recorded summary spend (summary_usage, across runs), in US
 *   dollars (default 15, S2's ceiling); ADR-035 lists the spend it can't see, such as the
 *   checkpoint reviews. Before each batch or regular-API wave the run projects spent + at
 *   Anthropic + this submission + the rest. If that would pass the budget, the run stops
 *   sending but keeps collecting what's already at Anthropic, which is paid for (ADR-035).
 *   Running again with a bigger --budget goes on from there.
 * - A full run first prints its estimate (every request it would send, priced as the cap prices them) and asks before it
 *   spends (S11, ADR-035 amended). Without a terminal it needs --yes. The yes is recorded per repo, which is what lets the
 *   Map's background worker refresh summaries afterwards (ADR-038 amended). --path and a run with nothing to send skip it.
 * - --path summarizes one file or folder right now through the regular API (an empty path
 *   means the repo itself). It's one request, so no budget applies.
 * - --release-batch <batch id> (repeatable) gives up on a batch whose results keep failing to download: its
 *   requests are sent again in this run, and paid for again. The summaries stage's note names such a batch.
 */
import path from "path";
import readline from "readline/promises";
import { getDb } from "../../lib/db/client";
import { IndexLockedError } from "../../lib/db/store/lock";
import { readStages } from "../../lib/db/store/stages";
import { RepoNotIndexedError, requireRepository } from "../../lib/db/store/structure";
import { confirmSummaries, loadUsage } from "../../lib/db/store/summaries";
import { embedSummaries } from "../../lib/index/embed";
import { repoKey } from "../../lib/index/paths";
import { summarizerFromEnv } from "../../lib/index/summarize/claude";
import { estimateSpend } from "../../lib/index/summarize/estimate";
import { costUsd, formatUsd } from "../../lib/index/summarize/pricing";
import {
    BATCH_THRESHOLD, BatchesUnreachableError, DEFAULT_BUDGET_USD, plannedRequests, runSummaries, StructureNotReadyError, summarizeNow, TargetNotFoundError,
    TargetNotReadyError, UnknownBatchError, type Transport,
} from "../../lib/index/summarize/run";
import { SUMMARY_MODELS } from "../../lib/index/summarize/prompts";
import { keyHint } from "../../lib/hints";
import { loadLocalEnv } from "../env";

const USAGE = "usage: nebulosity summarize <path-to-repo> [--direct | --batch] [--no-wait] [--budget <usd>] [--path <repo-relative path>] [--release-batch <batch id>]... [--yes]"
    + "   (in a checkout: npm run summarize -- <path-to-repo> …)";

/** The arguments as a run uses them, or null when they can't be run as given. */
type SummarizeOptions = {
    root: string;
    onePath: string | null;
    transport: Transport;
    wait: boolean;
    budgetUsd: number;
    releaseBatches: string[];
    /** --yes: spend without being asked (the only way without a terminal). */
    yes: boolean;
};

/**
 * Every argument after the repo path must be one this command knows, or it stops here. An argument it ignored would
 * leave the defaults in charge: "--path=src/x.ts" used to start a full summary pass (up to the $15 budget) instead of
 * the one request --path asks for. So, each at most once: the three switches, and the two options whose value is the
 * next argument, whatever it is ("--path ''" is the repo itself). Anything else, a "--flag=value" spelling or a second
 * repo path included, gets the usage line.
 */
function parseSummarizeArgs(args: readonly string[]): SummarizeOptions | null {
    const target = args[0];
    if (!target || target.startsWith("--")) return null;

    const SWITCHES = ["--direct", "--batch", "--no-wait", "--yes"];
    const OPTIONS = ["--budget", "--path"];
    const REPEATABLE = ["--release-batch"];
    const repeated = new Map<string, string[]>();
    const switches = new Set<string>();
    const values = new Map<string, string>();
    for (let i = 1; i < args.length; i++){
        const arg = args[i];
        if (SWITCHES.includes(arg) && !switches.has(arg)){
            switches.add(arg);
        } else if (OPTIONS.includes(arg) && !values.has(arg) && i + 1 < args.length){
            values.set(arg, args[i + 1]);
            i++;   // its value is used up
        } else if (REPEATABLE.includes(arg) && i + 1 < args.length){
            repeated.set(arg, [...(repeated.get(arg) ?? []), args[i + 1]]);
            i++;   // its value is used up
        } else{
            return null;
        }
    }
    if (switches.has("--direct") && switches.has("--batch")) return null;   // one or the other
    const releaseBatches = repeated.get("--release-batch") ?? [];
    if (releaseBatches.length > 0 && values.has("--path")) return null;   // --path sends no batch, so there's nothing to release

    // --budget is a positive number of dollars: Number() reads an empty value as 0 and a word as NaN, and both are refused,
    // as are negatives and Infinity.
    const budgetText = values.get("--budget");
    const budgetUsd = budgetText === undefined ? DEFAULT_BUDGET_USD : Number(budgetText);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return null;

    return {
        root: path.resolve(target),
        onePath: values.get("--path") ?? null,
        transport: switches.has("--direct") ? "direct" : switches.has("--batch") ? "batch" : "auto",
        wait: !switches.has("--no-wait"),
        budgetUsd,
        releaseBatches,
        yes: switches.has("--yes"),
    };
}

const say = (message: string): void => console.log(`[summarize] ${message}`);

/** Writes and embeds the summaries the arguments ask for. Returns the exit code: 0 done, 1 refused or failed, 2 the index is locked. */
export async function runSummarize(args: readonly string[]): Promise<number> {
    loadLocalEnv();

    const options = parseSummarizeArgs(args);
    if (options === null){
        console.error(USAGE);
        return 1;
    }

    try{
        return await summarize(options);
    } catch (err){
        if (err instanceof RepoNotIndexedError || err instanceof TargetNotFoundError || err instanceof TargetNotReadyError
            || err instanceof StructureNotReadyError || err instanceof UnknownBatchError){
            console.error(`[summarize] ${err.message}`);
            return 1;
        }
        if (err instanceof IndexLockedError){
            console.error(`[summarize] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
            return 2;
        }
        if (err instanceof BatchesUnreachableError){
            console.error(`[summarize] ${summariesNote(options.root)}`);
            return 1;
        }
        console.error(err);
        return 1;
    }
}

async function summarize(options: SummarizeOptions): Promise<number> {
    const { root, onePath } = options;
    const summarizer = summarizerFromEnv();

    if (onePath !== null){
        if (!summarizer){
            console.error(`[summarize] ANTHROPIC_API_KEY is not set (${keyHint()}).`);
            return 1;
        }
        const row = await summarizeNow(root, onePath, summarizer);
        say(`${row.kind} ${row.path || "(repo)"}: ${row.status}${row.error ? ` (${row.error})` : ""}`);
        if (row.tagline) say(`${row.tagline} — ${row.summary}`);
    } else{
        if (!summarizer) say(`ANTHROPIC_API_KEY is not set: writing test-file templates only (summaries need a key: ${keyHint()}).`);
        else if (!(await confirmSpend(options))) return 1;
        const result = await runSummaries(root, {
            summarizer, transport: options.transport, wait: options.wait, budgetUsd: options.budgetUsd, releaseBatches: options.releaseBatches, onProgress: say,
        });
        say(`up to date ${result.upToDate}/${result.total} · summarized ${result.summarized} · templated ${result.templated}`
            + ` · failed ${result.failed} · lazy ${result.lazy} · at Anthropic ${result.inFlight}`
            + ` · waves ${result.waves} · batches ${result.batches}`);
        // the circuit breaker or the spend cap: the stage's note says which, what to do, and what's still at Anthropic
        if (result.stopped) say(summariesNote(root));
    }

    const embedded = await embedSummaries(root, {
        onProgress: (done, total) => process.stdout.write(`\r[summarize] embedding ${done}/${total}   `),
    });
    if (embedded.embedded > 0) process.stdout.write("\n");
    say(`embedded ${embedded.embedded} summaries; ${embedded.total} now have vectors`);

    printSpend(root);
    return 0;
}

/**
 * The estimate and the yes (S11): prints what a full run would send and cost, then asks. Without a terminal it needs --yes.
 * A run with nothing to send needs no yes. A yes is recorded for the repo. Returns false when the run must not start.
 */
async function confirmSpend(options: SummarizeOptions): Promise<boolean> {
    const { root } = options;
    const requests = plannedRequests(root);
    if (requests.length === 0) return true;

    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const files = requests.filter((r) => r.kind === "file").length;
    // the runner's own rule: auto goes through the Batch API (half price) for waves of BATCH_THRESHOLD or more
    const batch = options.transport === "batch" || (options.transport === "auto" && files >= BATCH_THRESHOLD);
    const estimate = estimateSpend(requests, loadUsage(db, repoId), batch ? "batch" : "direct");
    const noPrice = estimate.unpriced.length > 0 ? ` (no price on file for: ${estimate.unpriced.join(", ")})` : "";
    say(`${path.basename(root)}: about ${estimate.requests.toLocaleString("en-US")} requests (${files.toLocaleString("en-US")} files to ${SUMMARY_MODELS.file},`
        + ` ${requests.filter((r) => r.kind === "folder").length.toLocaleString("en-US")} folders and the repo to ${SUMMARY_MODELS.folder}), about ${formatUsd(estimate.usd)} at list prices`
        + `${batch ? ", by the Batch API" : ""}${noPrice}. Writing summaries sends each file's code to Anthropic.`);

    if (!options.yes){
        if (!process.stdin.isTTY){
            console.error("[summarize] Nothing was sent. Run it again with --yes to spend this, or in a terminal to be asked.");
            return false;
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`Spend up to ${formatUsd(options.budgetUsd)} on this repo's summaries? [y/N] `);
        rl.close();
        if (!/^y(es)?$/i.test(answer.trim())){
            say("Nothing was sent.");
            return false;
        }
    }
    confirmSummaries(db, repoId);
    return true;
}

/** The summaries stage's note, which a stopped run fills in with why it stopped. */
function summariesNote(root: string): string {
    const db = getDb();
    return readStages(db, requireRepository(db, repoKey(root))).summaries?.note ?? "stopped early";
}

/**
 * What this repo's summaries have cost so far, per model and transport (success criterion S2).
 * A model with no price on file (a server-side fallback model, say) isn't counted as $0:
 * the total then reads "at least" and names the models it couldn't price.
 */
function printSpend(root: string): void {
    const db = getDb();
    let total = 0;
    const unpriced = new Set<string>();

    for (const row of loadUsage(db, requireRepository(db, repoKey(root)))){
        const cost = costUsd(row.model, row, row.transport);
        if (cost === null) unpriced.add(row.model);
        else total += cost;
        say(`spend: ${row.model} ${row.transport} · ${row.requests} requests · ${row.inputTokens.toLocaleString("en-US")} in`
            + ` · ${row.outputTokens.toLocaleString("en-US")} out · ${cost === null ? "no price on file" : `$${cost.toFixed(4)}`}`);
    }

    say(unpriced.size === 0
        ? `spend so far on this repo: $${total.toFixed(2)}`
        : `spend so far on this repo: at least $${total.toFixed(2)} (no price on file for: ${[...unpriced].join(", ")})`);
}
