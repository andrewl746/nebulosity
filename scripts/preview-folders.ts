/**
 * npm run preview-folders -- <path-to-repo>
 *
 * Summary Review #3, the folder preview: before the full paid pass, the owner reads folder summaries. Every non-test
 * file under the 10 sample folders below goes to the file model, then their folders, bottom-up, to the folder model,
 * through the regular API, with exactly the prompts the real run builds (lib/index/summarize/preview.ts). The write-up
 * is appended to docs/SUMMARY_REVIEW.md. Nothing is written to the index, and nothing to summary_usage: the spend cap
 * can't see this run (about $0.25 on VS Code).
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { getDb } from "../lib/db/client";
import { RepoNotIndexedError, requireRepository } from "../lib/db/store/structure";
import { nebulosityPath } from "../lib/home";
import { repoKey } from "../lib/index/paths";
import { createClaudeSummarizer } from "../lib/index/summarize/claude";
import { nextReviewNumber, reviewDate, SUMMARY_REVIEW_HEADER } from "../lib/index/summarize/compare";
import {
    previewRepoFolders, renderFolderPreview, SampleNotIndexedError, unfinished, type SampleFolder,
} from "../lib/index/summarize/preview";
import { configuredSummaryModels } from "../lib/index/summarize/models";
import { SUMMARY_EFFORT } from "../lib/index/summarize/prompts";
import { StructureNotReadyError } from "../lib/index/summarize/run";
import { hasAnthropicKey, loadLocalEnv } from "./env";

/** The sample, picked by the controller for variety (plan, Addendum 2): 128 non-test files and about 25 folders of VS Code. */
const REVIEW_3_FOLDERS: SampleFolder[] = [
    { path: "src/vs/base/browser/ui/scrollbar", why: "a leaf UI widget (8 files)" },
    { path: "src/vs/base/parts/contextmenu", why: "VS Code's common/browser/electron layering: 3 one-file subfolders" },
    { path: "src/vs/platform/configuration", why: "a platform service with more test files than code" },
    { path: "src/vs/editor/common/model/tokens", why: "files plus a subfolder" },
    { path: "src/vs/editor/contrib/folding", why: "an editor contribution with tests" },
    { path: "src/vs/workbench/contrib/terminal/browser/xterm", why: "a leaf integration with a third-party library" },
    { path: "src/vs/workbench/services/remote", why: "a workbench service split by layer (3 subfolders)" },
    { path: "src/vs/workbench/contrib/chat/browser/aiCustomization", why: "a big leaf (55 files) that exercises the 50-item cap" },
    { path: "extensions/mermaid-markdown-features/src", why: "a built-in extension" },
    { path: "build/npm", why: "build tooling, not product code" },
];

loadLocalEnv();

const args = process.argv.slice(2);

/** The arguments can't be run as given: print how to call the command, and exit. */
function usage(): never {
    console.error("usage: npm run preview-folders -- <path-to-repo>");
    process.exit(1);
}

// Exactly one argument, the repo, as strictly as npm run summarize: a flag, a "--x=y" spelling or a second argument
// prints the usage line instead of being ignored.
if (args.length !== 1 || args[0].startsWith("-")) usage();
if (!hasAnthropicKey()){
    console.error("[preview] ANTHROPIC_API_KEY is not set (put it in .env.local).");
    process.exit(1);
}
// the models a real run would use: the defaults, or summaryModels in config.json (ADR-066)
const setting = (() => {
    const resolved = configuredSummaryModels();
    if (!resolved.ok){
        console.error(`[preview] ${resolved.error}`);
        process.exit(1);
    }
    return resolved;
})();

const root = path.resolve(args[0]);
const out = nebulosityPath("docs", "SUMMARY_REVIEW.md");
const say = (message: string): void => console.log(`[preview] ${message}`);

async function main(): Promise<void> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const summarizer = createClaudeSummarizer(new Anthropic({ maxRetries: 3 }), SUMMARY_EFFORT);
    const models = { file: setting.models.file, folder: setting.models.folder };

    say(`${REVIEW_3_FOLDERS.length} sample folders: files with ${models.file}, then folders bottom-up with ${models.folder}`);
    const result = await previewRepoFolders(db, repoId, root, REVIEW_3_FOLDERS, summarizer, say, setting);
    for (const target of unfinished(result.preview)) say(`never became ready: ${target.kind} ${target.path} (${target.state})`);

    const existing = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    const title = `${reviewDate(new Date())} Summary Review #${nextReviewNumber(existing)} — folder preview:`
        + ` ${models.file} files and ${models.folder} folders on ${REVIEW_3_FOLDERS.length} folders of ${path.basename(root)}`;
    const section = renderFolderPreview({ title, repo: repoKey(root), effort: SUMMARY_EFFORT, models, prices: setting.prices, samples: REVIEW_3_FOLDERS, ...result });
    fs.writeFileSync(out, `${existing || SUMMARY_REVIEW_HEADER}\n${section}`);
    say(`wrote "${title}" to ${out}`);
}

main().catch((err: unknown) => {
    if (err instanceof RepoNotIndexedError || err instanceof StructureNotReadyError || err instanceof SampleNotIndexedError){
        console.error(`[preview] ${err.message}`);
        process.exit(1);
    }
    console.error(err);
    process.exit(1);
});
