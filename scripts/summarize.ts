/**
 * npm run summarize -- <path-to-repo> [--direct | --batch] [--no-wait] [--budget <usd>] [--path <repo-relative path>]
 *
 * Writes summaries for an indexed repository (PIVOT_SPEC.md §5.3), then embeds them for search (§5.4).
 * - A big first pass goes through the Message Batches API at half price and can take hours.
 *   --no-wait never sleeps: it collects the batches that have already ended, submits what
 *   that makes ready, and exits. Running the command again (by hand, or from cron) carries
 *   on from there.
 * - --budget caps what this repo's summaries may cost in total, in US dollars (default 15,
 *   S2's ceiling). Before each batch or regular-API wave the run projects spent + at
 *   Anthropic + this submission + the rest. If that would pass the budget, the run stops
 *   sending but keeps collecting what's already at Anthropic, which is paid for (ADR-035).
 *   Running again with a bigger --budget goes on from there.
 * - --path summarizes one file or folder right now through the regular API (an empty path
 *   means the repo itself). It's one request, so no budget applies.
 */
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { getDb } from "../lib/db/client";
import { IndexLockedError } from "../lib/db/store/lock";
import { readStages } from "../lib/db/store/stages";
import { RepoNotIndexedError, requireRepository } from "../lib/db/store/structure";
import { loadUsage } from "../lib/db/store/summaries";
import { embedSummaries } from "../lib/index/embed";
import { repoKey } from "../lib/index/paths";
import { createClaudeSummarizer } from "../lib/index/summarize/claude";
import { costUsd } from "../lib/index/summarize/pricing";
import {
    DEFAULT_BUDGET_USD, runSummaries, StructureNotReadyError, summarizeNow, TargetNotFoundError, type Transport,
} from "../lib/index/summarize/run";
import { hasAnthropicKey, loadLocalEnv } from "./env";

loadLocalEnv();

const args = process.argv.slice(2);
const target = args[0];

/** The arguments can't be run as given: print how to call the command, and exit. */
function usage(): never {
    console.error("usage: npm run summarize -- <path-to-repo> [--direct | --batch] [--no-wait] [--budget <usd>] [--path <repo-relative path>]");
    process.exit(1);
}

if (!target || target.startsWith("--")) usage();

// --budget takes a positive number of dollars, as the next argument. "--budget=5" is refused rather than ignored: ignoring
// it would quietly apply the default instead. Number() reads a missing value as NaN and an empty one as 0, so both are
// refused here too, as are words, negatives and Infinity.
if (args.some((arg) => arg.startsWith("--budget="))) usage();
const budgetFlag = args.indexOf("--budget");
const budgetUsd = budgetFlag === -1 ? DEFAULT_BUDGET_USD : Number(args[budgetFlag + 1]);
if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) usage();

const root = path.resolve(target);
const pathFlag = args.indexOf("--path");
const onePath = pathFlag === -1 ? null : (args[pathFlag + 1] ?? "");
const transport: Transport = args.includes("--direct") ? "direct" : args.includes("--batch") ? "batch" : "auto";
const say = (message: string): void => console.log(`[summarize] ${message}`);
const summarizer = hasAnthropicKey() ? createClaudeSummarizer(new Anthropic({ maxRetries: 3 })) : null;

async function main(): Promise<void> {
    if (onePath !== null){
        if (!summarizer){
            console.error("[summarize] ANTHROPIC_API_KEY is not set (put it in .env.local).");
            process.exit(1);
        }
        const row = await summarizeNow(root, onePath, summarizer);
        say(`${row.kind} ${row.path || "(repo)"}: ${row.status}${row.error ? ` (${row.error})` : ""}`);
        if (row.tagline) say(`${row.tagline} — ${row.summary}`);
    } else{
        if (!summarizer) say("ANTHROPIC_API_KEY is not set: writing test-file templates only (put the key in .env.local).");
        const result = await runSummaries(root, { summarizer, transport, wait: !args.includes("--no-wait"), budgetUsd, onProgress: say });
        say(`up to date ${result.upToDate}/${result.total} · summarized ${result.summarized} · templated ${result.templated}`
            + ` · failed ${result.failed} · lazy ${result.lazy} · at Anthropic ${result.inFlight}`
            + ` · waves ${result.waves} · batches ${result.batches}`);
        // the circuit breaker or the spend cap: the stage's note says which, what to do, and what's still at Anthropic
        if (result.stopped) say(summariesNote());
    }

    const embedded = await embedSummaries(root, {
        onProgress: (done, total) => process.stdout.write(`\r[summarize] embedding ${done}/${total}   `),
    });
    if (embedded.embedded > 0) process.stdout.write("\n");
    say(`embedded ${embedded.embedded} summaries; ${embedded.total} now have vectors`);

    printSpend();
}

/** The summaries stage's note, which a stopped run fills in with why it stopped. */
function summariesNote(): string {
    const db = getDb();
    return readStages(db, requireRepository(db, repoKey(root))).summaries?.note ?? "stopped early";
}

/**
 * What this repo's summaries have cost so far, per model and transport (success criterion S2).
 * A model with no price on file (a server-side fallback model, say) isn't counted as $0:
 * the total then reads "at least" and names the models it couldn't price.
 */
function printSpend(): void {
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

main().catch((err: unknown) => {
    if (err instanceof RepoNotIndexedError || err instanceof TargetNotFoundError || err instanceof StructureNotReadyError){
        console.error(`[summarize] ${err.message}`);
        process.exit(1);
    }
    if (err instanceof IndexLockedError){
        console.error(`[summarize] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
        process.exit(2);
    }
    console.error(err);
    process.exit(1);
});
