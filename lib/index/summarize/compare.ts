import type { FileFacts } from "../../db/store/summaries";
import { ASSUMED_TOKENS } from "./budget";
import { writtenByModel } from "./plan";
import { costUsd, formatUsd, pricePerMTok, type PriceTable } from "./pricing";
import { plural, PROMPT_VERSION } from "./prompts";
import type { SummaryOutcome } from "./types";

/** Folder inputs, assumed for the estimate as the spend cap assumes them (budget.ts): a folder lists its children's taglines and summaries. */
const ASSUMED_FOLDER_INPUT_TOKENS = ASSUMED_TOKENS.folder.inputTokens;

/** What a new docs/SUMMARY_REVIEW.md opens with. */
export const SUMMARY_REVIEW_HEADER =
    "# SUMMARY_REVIEW.md — Summary quality reviews\n\nThe owner's checks of model-written summaries before they're generated at scale. Each review is a dated, numbered section; the newest is last.\n";

/**
 * The number the next review in SUMMARY_REVIEW.md gets: one more than the reviews it holds. Only review headings
 * count ("## <date> Summary Review #<n> — …"): a verdict that names an earlier review, or a file path that happens to
 * contain the words, must not push the number up.
 */
export function nextReviewNumber(existing: string): number {
    return (existing.match(/^## .*Summary Review #\d+/gm) ?? []).length + 1;
}

/** A review heading's date, "2026 10 11" (the dated-header convention of the review docs). */
export function reviewDate(date: Date): string {
    return `${date.getFullYear()} ${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getDate()).padStart(2, "0")}`;
}

export type ComparisonRow = { file: FileFacts; outcomes: Record<string, SummaryOutcome | undefined> };

export type ComparisonReport = {
    title: string;
    repo: string;
    effort: string;
    /** [the file model, the folder model], as the summary models setting resolves them (ADR-066). */
    models: [string, string];
    /** The setting's prices, checked before the built-in table (ADR-066). */
    prices?: PriceTable;
    rows: ComparisonRow[];
    /** What the real first pass will send: model-written files, and folders plus the repo. */
    fullPass: { files: number; folders: number };
};

/**
 * The checkpoint's sample (PIVOT_SPEC.md §5.3): the most-imported half (central code is
 * read first), then the rest spread evenly through the path-sorted tree. Test files and
 * files over the size cap are left out, because they get a template. Expects files in path
 * order, as loadFileFacts returns them.
 */
export function pickSample(files: readonly FileFacts[], count: number): FileFacts[] {
    // the planner's own rule, at the product's one cap (DEFAULT_MAX_FILE_BYTES), so the sample never holds a templated file
    const candidates = files.filter((f) => writtenByModel(f));
    const central = [...candidates]
        .sort((a, b) => b.importedBy - a.importedBy || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .slice(0, Math.ceil(count / 2));
    const chosen = new Set(central.map((f) => f.path));
    const rest = candidates.filter((f) => !chosen.has(f.path));
    const k = Math.min(count - central.length, rest.length);

    // the middle of each of k equal slices of the remaining files
    const spread = Array.from({ length: k }, (_, i) => rest[Math.floor(((i + 0.5) * rest.length) / k)]);
    return [...central, ...spread];
}

export function renderComparison(report: ComparisonReport): string {
    const [fileModel, folderModel] = report.models;
    const stats = report.models.map((model) => usageStats(model, report.rows.map((row) => row.outcomes[model]), report.prices));
    const [fileStats, folderStats] = stats;
    const central = Math.ceil(report.rows.length / 2);

    // what one file costs with each model, rounded as the lines below print it (see perRequestPrice)
    const filePrice = perRequestPrice(fileStats.meanCost);
    const folderModelFilePrice = perRequestPrice(folderStats.meanCost);

    const filesTotal = (report.fullPass.files * filePrice.value) / 2;
    const folderPrice = pricePerMTok(folderModel, report.prices) ?? { input: 0, output: 0 };
    const meanFolderOutput = Math.round(folderStats.meanOutputTokens);
    const perFolder = (ASSUMED_FOLDER_INPUT_TOKENS * folderPrice.input + meanFolderOutput * folderPrice.output) / 1_000_000;
    const foldersTotal = (report.fullPass.folders * perFolder) / 2;
    const allSonnetFiles = (report.fullPass.files * folderModelFilePrice.value) / 2;

    const lines = [
        `## ${report.title}`,
        "",
        `- **Repo:** \`${report.repo}\` · **effort** ${report.effort} · **prompt version** ${PROMPT_VERSION} · the regular Messages API`,
        `- **Sample:** the ${central} most-imported files, then ${report.rows.length - central} more spread evenly through the tree. Test files are left out: they get a template.`,
        "",
        "### Cost on this sample",
        "",
        "| Model | Requests | Input tokens | Output tokens | Cost |",
        "|---|---|---|---|---|",
        ...stats.map((s) => `| ${s.model} | ${s.requests} | ${s.inputTokens.toLocaleString("en-US")} | ${s.outputTokens.toLocaleString("en-US")} | ${s.unpriced ? "at least " : ""}${formatUsd(s.cost)} |`),
        "",
        "### Full-pass estimate (Batch API, half price)",
        "",
        `- **Files:** ${report.fullPass.files.toLocaleString("en-US")} × ${filePrice.text} (${fileModel}'s mean) × ½ = **${formatUsd(filesTotal)}**`,
        `- **Folders and the repo:** ${report.fullPass.folders.toLocaleString("en-US")} × (${ASSUMED_FOLDER_INPUT_TOKENS.toLocaleString("en-US")} input tokens + ${meanFolderOutput.toLocaleString("en-US")} output tokens at ${folderModel}'s price) × ½ = **${formatUsd(foldersTotal)}**`,
        `- **Total ≈ ${formatUsd(filesTotal + foldersTotal)}** against S2's $15.`,
        `- If ${folderModel} wrote the file summaries too: ${report.fullPass.files.toLocaleString("en-US")} × ${folderModelFilePrice.text} × ½ = **${formatUsd(allSonnetFiles)}**`,
        "",
        `Folder inputs are assumed to be about ${ASSUMED_FOLDER_INPUT_TOKENS.toLocaleString("en-US")} tokens each, since a folder lists its children's taglines and summaries. The full run measures the real number.`,
        "",
        "### The summaries",
    ];

    report.rows.forEach((row, i) => {
        lines.push("", `#### ${i + 1}. \`${row.file.path}\` (${plural(row.file.lineCount, "line")} · imported by ${plural(row.file.importedBy, "file")})`, "");
        for (const model of report.models){
            const outcome = row.outcomes[model];
            lines.push(outcome?.ok
                ? `- ${answerLabel(model, outcome.model)} *${outcome.text.tagline}* — ${outcome.text.summary}`
                : `- **${model}:** failed: ${outcome ? outcome.error : "no answer"}`);
        }
    });

    lines.push("", "### Owner's verdict", "",
        "_To fill in: which model writes the file summaries, whether the prompt or the effort needs changing first, and go or no-go for the full Batch run._");
    return lines.join("\n") + "\n";
}

/** One model's requests, tokens and cost over a set of answers (usageStats). */
export type UsageStats = {
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    /** USD at regular-API prices; a lower bound when `unpriced`. */
    cost: number;
    /** Some model that ran has no price on file, so `cost` leaves it out. */
    unpriced: boolean;
    meanCost: number;
    meanInputTokens: number;
    meanOutputTokens: number;
};

/**
 * Adds up the answers one model was asked for (undefined: it wasn't asked). An answer that came with usage is a
 * request, failed or not; one that got no reply at all (usage null) isn't, and costs nothing. `prices`: the summary
 * models setting's, checked before the built-in table (ADR-066).
 */
export function usageStats(model: string, outcomes: readonly (SummaryOutcome | undefined)[], prices?: PriceTable): UsageStats {
    let requests = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    let unpriced = false;

    for (const outcome of outcomes){
        const usage = outcome?.usage;
        if (!usage) continue;
        requests++;

        // A request a server-side fallback finished lists one entry per model that ran, and every one is billed.
        for (const entry of usage){
            inputTokens += entry.inputTokens;
            outputTokens += entry.outputTokens;

            // A model with no price on file isn't $0: the total is then only a lower bound.
            const entryCost = costUsd(entry.model, entry, "direct", prices);
            if (entryCost === null) unpriced = true;
            else cost += entryCost;
        }
    }

    return {
        model, requests, inputTokens, outputTokens, cost, unpriced,
        meanCost: requests > 0 ? cost / requests : 0,
        meanInputTokens: requests > 0 ? inputTokens / requests : 0,
        meanOutputTokens: requests > 0 ? outputTokens / requests : 0,
    };
}

/**
 * "**model:**", or, when a fallback model wrote the answer, "**model** (answered by other):".
 * That isn't the summary the column's model would have written, and the reader should know.
 */
function answerLabel(model: string, answeredBy: string): string {
    return answeredBy === model ? `**${model}:**` : `**${model}** (answered by ${answeredBy}):`;
}

/**
 * A mean price per request, rounded to 3 significant figures, with the text that prints it.
 * The estimate multiplies the rounded value, not the exact mean, so anyone can redo a line from
 * what it prints and land on the figure beside it: "10,412 × $0.000588 × ½" is $3.06. Printing
 * "$0.0006" while multiplying the exact $0.000588225 left a line that works out to $3.12.
 * Prints at least 4 decimals, and more only while the rounded value needs them ($0.0060, $0.000588).
 */
export function perRequestPrice(mean: number): { value: number; text: string } {
    const value = Number(mean.toPrecision(3));

    // the cap is a backstop: NaN never equals itself, and would otherwise add decimals forever
    let decimals = 4;
    while (decimals < 12 && Number(value.toFixed(decimals)) !== value) decimals++;
    return { value, text: `$${value.toFixed(decimals)}` };
}
