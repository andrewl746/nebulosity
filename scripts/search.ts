/**
 * npm run search -- <path-to-repo> "<query>" [--limit 10]
 *
 * Hybrid search over an indexed repo (RAG_PIPELINE.md §6): code keywords, summary
 * keywords and summary meaning, fused with Reciprocal Rank Fusion. Runs the query twice
 * and prints both timings. The first includes loading the embedding model.
 */
import path from "path";
import { RepoNotIndexedError } from "../lib/db/store/structure";
import { search } from "../lib/engine/search";
import { joinParagraphs } from "../lib/index/summarize/prompts";
import { hasAnthropicKey, loadLocalEnv } from "./env";

loadLocalEnv();   // the key may live in .env.local, which tsx doesn't read; free mode (no key) says "off", not "not ready"

const args = process.argv.slice(2);
const [target, query] = args;

if (!target || !query){
    console.error('usage: npm run search -- <path-to-repo> "<query>" [--limit 10]');
    process.exit(1);
}

const limitFlag = args.indexOf("--limit");
const limit = limitFlag === -1 ? 10 : Number(args[limitFlag + 1]);
const root = path.resolve(target);
const summariesOff = !hasAnthropicKey();

async function main(): Promise<void> {
    let started = performance.now();
    const result = await search(root, query, { limit, summariesOff });
    const firstMs = performance.now() - started;
    started = performance.now();
    await search(root, query, { limit, summariesOff });
    const warmMs = performance.now() - started;

    console.log(`[search] "${query}": ${result.hits.length} hits · lists: code ${result.lists.code}, summary ${result.lists.summary},`
        + ` vector ${result.lists.vector}, name ${result.lists.name}, file ${result.lists.file} · first ${firstMs.toFixed(0)} ms, warm ${warmMs.toFixed(0)} ms`);
    if (result.note) console.log(`[search] note: ${result.note}`);

    result.hits.forEach((hit, i) => {
        console.log(`${String(i + 1).padStart(2)}. ${hit.path}${hit.kind === "folder" ? "/" : ""}  (${hit.score.toFixed(4)} · ${hit.matchedBy.join("+")})`);
        if (hit.tagline) console.log(`    ${hit.tagline} — ${joinParagraphs(hit.summary ?? "")}`);
        if (hit.code) console.log(`    ${hit.code.symbol}, lines ${hit.code.startLine}–${hit.code.endLine}: ${hit.code.snippet}`);
    });
}

main().catch((err: unknown) => {
    console.error(err instanceof RepoNotIndexedError ? `[search] ${err.message}` : err);
    process.exit(1);
});
