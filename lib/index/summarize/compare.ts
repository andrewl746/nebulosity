import type { FileFacts } from "../../db/store/summaries";
import { costUsd, pricePerMTok } from "./pricing";
import { plural, PROMPT_VERSION } from "./prompts";
import type { SummaryOutcome } from "./types";

/** Folder inputs, assumed for the estimate: a folder lists its children's taglines and summaries. */
const ASSUMED_FOLDER_INPUT_TOKENS = 1_000;

export type ComparisonRow = { file: FileFacts; outcomes: Record<string, SummaryOutcome | undefined> };

export type ComparisonReport = {
    title: string;
    repo: string;
    effort: string;
    /** [the file model, the folder model], as in SUMMARY_MODELS. */
    models: [string, string];
    rows: ComparisonRow[];
    /** What the real first pass will send: model-written files, and folders plus the repo. */
    fullPass: { files: number; folders: number };
};

/**
 * The checkpoint's sample (PIVOT_SPEC.md §5.3): the most-imported half (central code is
 * read first), then the rest spread evenly through the path-sorted tree. Test files are
 * left out, because they get a template. Expects files in path order, as loadFileFacts
 * returns them.
 */
export function pickSample(files: readonly FileFacts[], count: number): FileFacts[] {
    const candidates = files.filter((f) => !f.isTest);
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
    const stats = report.models.map((model) => modelStats(model, report.rows));
    const [fileStats, folderStats] = stats;
    const central = Math.ceil(report.rows.length / 2);

    const filesTotal = (report.fullPass.files * fileStats.meanCost) / 2;
    const folderPrice = pricePerMTok(folderModel) ?? { input: 0, output: 0 };
    const meanFolderOutput = Math.round(folderStats.meanOutputTokens);
    const perFolder = (ASSUMED_FOLDER_INPUT_TOKENS * folderPrice.input + meanFolderOutput * folderPrice.output) / 1_000_000;
    const foldersTotal = (report.fullPass.folders * perFolder) / 2;
    const allSonnetFiles = (report.fullPass.files * folderStats.meanCost) / 2;

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
        ...stats.map((s) => `| ${s.model} | ${s.requests} | ${s.inputTokens.toLocaleString("en-US")} | ${s.outputTokens.toLocaleString("en-US")} | ${s.unpriced ? "at least " : ""}${usd(s.cost)} |`),
        "",
        "### Full-pass estimate (Batch API, half price)",
        "",
        `- **Files:** ${report.fullPass.files.toLocaleString("en-US")} × ${usd(fileStats.meanCost)} (${fileModel}'s mean) × ½ = **${usd(filesTotal)}**`,
        `- **Folders and the repo:** ${report.fullPass.folders.toLocaleString("en-US")} × (${ASSUMED_FOLDER_INPUT_TOKENS.toLocaleString("en-US")} input tokens + ${meanFolderOutput.toLocaleString("en-US")} output tokens at ${folderModel}'s price) × ½ = **${usd(foldersTotal)}**`,
        `- **Total ≈ ${usd(filesTotal + foldersTotal)}** against S2's $15.`,
        `- If ${folderModel} wrote the file summaries too: ${report.fullPass.files.toLocaleString("en-US")} × ${usd(folderStats.meanCost)} × ½ = **${usd(allSonnetFiles)}**`,
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
                ? `- **${model}:** *${outcome.text.tagline}* — ${outcome.text.summary}`
                : `- **${model}:** failed: ${outcome ? outcome.error : "no answer"}`);
        }
    });

    lines.push("", "### Owner's verdict", "",
        "_To fill in: which model writes the file summaries, whether the prompt or the effort needs changing first, and go or no-go for the full Batch run._");
    return lines.join("\n") + "\n";
}

function modelStats(model: string, rows: readonly ComparisonRow[]){
    let requests = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    let unpriced = false;

    for (const row of rows){
        const usage = row.outcomes[model]?.usage;
        if (!usage) continue;
        requests++;

        // A request a server-side fallback finished lists one entry per model that ran, and every one is billed.
        for (const entry of usage){
            inputTokens += entry.inputTokens;
            outputTokens += entry.outputTokens;

            // A model with no price on file isn't $0: the total is then only a lower bound.
            const entryCost = costUsd(entry.model, entry, "direct");
            if (entryCost === null) unpriced = true;
            else cost += entryCost;
        }
    }

    return {
        model, requests, inputTokens, outputTokens, cost, unpriced,
        meanCost: requests > 0 ? cost / requests : 0,
        meanOutputTokens: requests > 0 ? outputTokens / requests : 0,
    };
}

function usd(x: number): string {
    return `$${x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
}
