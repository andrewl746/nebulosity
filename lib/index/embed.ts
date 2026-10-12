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
 * MiniLM's measured ~18 a second; V1.3 moves this onto a worker thread.
 */
export async function embedSummaries(repoRoot: string, options: EmbedRunOptions = {}): Promise<{ embedded: number; total: number }> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    const embed = options.embed ?? ((texts: string[]) => embedTexts(texts));
    const groupSize = options.groupSize ?? 256;
    const pending = loadSummariesWithoutVectors(db, repoId);
    const total = countEmbeddable(db, repoId);
    let done = total - pending.length;

    try{
        for (let i = 0; i < pending.length; i += groupSize){
            writeStage(db, repoId, "embeddings", { state: "running", done, total });
            const group = pending.slice(i, i + groupSize);
            const vectors = await embed(group.map(summaryEmbeddingText));
            writeSummaryVectors(db, group.map((s, j) => ({ summaryId: s.id, embedding: encodeVector(vectors[j]) })));
            done += group.length;
            options.onProgress?.(done, total);
        }
    } catch (err){
        writeStage(db, repoId, "embeddings", { state: "failed", done, total, note: err instanceof Error ? err.message : String(err) });
        throw err;
    }

    writeStage(db, repoId, "embeddings", { state: "ready", done, total });
    return { embedded: pending.length, total };
}
