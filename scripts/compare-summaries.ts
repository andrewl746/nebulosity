/**
 * npm run compare-summaries -- <path-to-repo> [--count 20] [--effort low|medium|high]
 *
 * The owner checkpoint before the first full summary pass (PIVOT_SPEC.md §5.3). It
 * summarizes a sample of files with both models through the regular API, then appends the
 * side-by-side, its cost and a full-pass estimate to docs/SUMMARY_REVIEW.md. Nothing is
 * written to the index: the real run starts only after the owner's verdict.
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { getDb } from "../lib/db/client";
import { requireRepository } from "../lib/db/store/structure";
import { loadFileFacts, loadFolderFacts } from "../lib/db/store/summaries";
import { nebulosityPath } from "../lib/home";
import { repoKey } from "../lib/index/paths";
import { createClaudeSummarizer } from "../lib/index/summarize/claude";
import { nextReviewNumber, pickSample, renderComparison, reviewDate, SUMMARY_REVIEW_HEADER, type ComparisonRow } from "../lib/index/summarize/compare";
import { mapLimit } from "../lib/index/summarize/concurrency";
import { FILE_SYSTEM_PROMPT, SUMMARY_EFFORT } from "../lib/index/summarize/prompts";
import { writtenByModel } from "../lib/index/summarize/plan";
import { buildFilePrompt } from "../lib/index/summarize/run";
import type { SummaryOutcome } from "../lib/index/summarize/types";
import { hasAnthropicKey, loadLocalEnv } from "./env";
import { summaryModelsOrExit } from "./summary-models";

loadLocalEnv();

const args = process.argv.slice(2);
const target = args[0];
const flag = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

if (!target || target.startsWith("--")){
    console.error("usage: npm run compare-summaries -- <path-to-repo> [--count 20] [--effort low|medium|high]");
    process.exit(1);
}
if (!hasAnthropicKey()){
    console.error("[compare] ANTHROPIC_API_KEY is not set (put it in .env.local).");
    process.exit(1);
}
// the file and folder models a real run would use: the defaults, or summaryModels in config.json (ADR-066)
const setting = summaryModelsOrExit("compare");

const count = Number(flag("--count") ?? 20);
const effort = (flag("--effort") ?? SUMMARY_EFFORT) as "low" | "medium" | "high";
const root = path.resolve(target);
const out = nebulosityPath("docs", "SUMMARY_REVIEW.md");

async function main(): Promise<void> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const files = loadFileFacts(db, repoId);
    const sample = pickSample(files, count);
    const summarizer = createClaudeSummarizer(new Anthropic({ maxRetries: 3 }), effort);
    const models: [string, string] = [setting.models.file, setting.models.folder];
    // a set model goes without the Sonnet fallback beta, as in a real run (ADR-066, R3)
    const custom = [setting.custom.file, setting.custom.folder];

    const rows: ComparisonRow[] = sample.map((file) => ({ file, outcomes: {} }));
    for (const [i, model] of models.entries()){
        console.log(`[compare] ${model}: ${sample.length} files…`);
        const outcomes = await mapLimit(sample, 4, async (file): Promise<SummaryOutcome> => {
            const prompt = buildFilePrompt(db, repoId, root, file);
            if (prompt === null) return { customId: file.path, ok: false, error: "changed after it was indexed", model: null, usage: null };
            return summarizer.summarize({ customId: file.path, model, system: FILE_SYSTEM_PROMPT, prompt, ...(custom[i] ? { customModel: true } : {}) });
        });
        outcomes.forEach((outcome, i) => { rows[i].outcomes[model] = outcome; });
    }

    const existing = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    // numbered from the review headings already there, so a verdict that names an earlier review can't skip a number
    const title = `${reviewDate(new Date())} Summary Review #${nextReviewNumber(existing)} — ${models[0]} vs ${models[1]} on ${sample.length} files of ${path.basename(root)}`;

    const section = renderComparison({
        title, repo: repoKey(root), effort, models, prices: setting.prices, rows,
        fullPass: { files: files.filter((f) => writtenByModel(f)).length, folders: loadFolderFacts(db, repoId).length },
    });
    fs.writeFileSync(out, `${existing || SUMMARY_REVIEW_HEADER}\n${section}`);
    console.log(`[compare] wrote "${title}" to ${out}`);
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
