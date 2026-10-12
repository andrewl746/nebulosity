import path from "path";
import { getDb } from "../db/client";
import { writeStage } from "../db/store/stages";
import { requireRepository } from "../db/store/structure";
import { countEmbeddable, loadSummariesWithoutVectors, writeSummaryVectors } from "../db/store/summary-vectors";
import { embedTexts, encodeVector } from "../embed";
import { repoKey } from "./paths";

/** Texts → unit vectors. Tests pass a fake; the default is the local MiniLM model (ADR-005). */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export type EmbedRunOptions = {
    embed?: EmbedFn;
    /** Summaries embedded and committed together. */
    groupSize?: number;
    /** Embed at most this many in this call. The background worker embeds in slices, so other work never waits long. */
    limit?: number;
    onProgress?: (done: number, total: number) => void;
};

/** What a summary's vector is made from (PIVOT_SPEC.md §5.4): what it is, what it does, then where it lives. */
export function summaryEmbeddingText(s: { path: string; tagline: string; summary: string }): string {
    return `${s.tagline}\n${s.summary}\n${s.path}`;
}

/**
 * The embeddings stage: a vector for every model-written summary that lacks one. A
 * summary loses its vector when its text is rewritten (writeResults), so re-running this
 * redoes exactly what changed. VS Code's ~15–20k summaries take about 15 minutes at
 * MiniLM's measured ~18 a second; In V1.3 the background worker runs it in slices (limit).
 */
export async function embedSummaries(repoRoot: string, options: EmbedRunOptions = {}): Promise<{ embedded: number; total: number; remaining: number }> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    const embed = options.embed ?? ((texts: string[]) => embedTexts(texts));
    const groupSize = options.groupSize ?? 256;
    const missing = loadSummariesWithoutVectors(db, repoId);
    const pending = options.limit === undefined ? missing : missing.slice(0, options.limit);
    const total = countEmbeddable(db, repoId);
    let done = total - missing.length;
    let embedded = 0;

    try{
        for (let i = 0; i < pending.length; i += groupSize){
            writeStage(db, repoId, "embeddings", { state: "running", done, total });
            const group = pending.slice(i, i + groupSize);
            const vectors = await embed(group.map(summaryEmbeddingText));
            // a summary rewritten meanwhile is skipped here and picked up, with its new text, next time
            const written = writeSummaryVectors(db, group.map((s, j) => ({ summaryId: s.id, inputHash: s.inputHash, embedding: encodeVector(vectors[j]) })));
            embedded += written;
            done += written;
            options.onProgress?.(done, total);
        }
    } catch (err){
        writeStage(db, repoId, "embeddings", { state: "failed", done, total, note: err instanceof Error ? err.message : String(err) });
        throw err;
    }

    // the stage's counts are read live (ADR-032, amended), so "ready" here can't hide what a slice left for later
    writeStage(db, repoId, "embeddings", { state: "ready", done, total });
    return { embedded, total, remaining: missing.length - embedded };
}
