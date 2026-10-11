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
import { pickSample, renderComparison, type ComparisonRow } from "../lib/index/summarize/compare";
import { mapLimit } from "../lib/index/summarize/concurrency";
import { FILE_SYSTEM_PROMPT, SUMMARY_EFFORT, SUMMARY_MODELS } from "../lib/index/summarize/prompts";
import { buildFilePrompt } from "../lib/index/summarize/run";
import type { SummaryOutcome } from "../lib/index/summarize/types";
import { hasAnthropicKey, loadLocalEnv } from "./env";

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
    const models: [string, string] = [SUMMARY_MODELS.file, SUMMARY_MODELS.folder];

    const rows: ComparisonRow[] = sample.map((file) => ({ file, outcomes: {} }));
    for (const model of models){
        console.log(`[compare] ${model}: ${sample.length} files…`);
        const outcomes = await mapLimit(sample, 4, async (file): Promise<SummaryOutcome> => {
            const prompt = buildFilePrompt(db, repoId, root, file);
            if (prompt === null) return { customId: file.path, ok: false, error: "changed after it was indexed", model: null, usage: null };
            return summarizer.summarize({ customId: file.path, model, system: FILE_SYSTEM_PROMPT, prompt });
        });
        outcomes.forEach((outcome, i) => { rows[i].outcomes[model] = outcome; });
    }

    const existing = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    const reviewNumber = (existing.match(/Summary Review #\d+/g) ?? []).length + 1;
    const today = new Date();
    const date = `${today.getFullYear()} ${String(today.getMonth() + 1).padStart(2, "0")} ${String(today.getDate()).padStart(2, "0")}`;
    const title = `${date} Summary Review #${reviewNumber} — ${models[0]} vs ${models[1]} on ${sample.length} files of ${path.basename(root)}`;

    const header = "# SUMMARY_REVIEW.md — Summary quality reviews\n\nThe owner's checks of model-written summaries before they're generated at scale. Each review is a dated, numbered section; the newest is last.\n";
    const section = renderComparison({
        title, repo: repoKey(root), effort, models, rows,
        fullPass: { files: files.filter((f) => !f.isTest).length, folders: loadFolderFacts(db, repoId).length },
    });
    fs.writeFileSync(out, `${existing || header}\n${section}`);
    console.log(`[compare] wrote "${title}" to ${out}`);
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
