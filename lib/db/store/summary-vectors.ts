import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client";
import { summaries, summaryVectors, type SummaryTargetKind } from "../schema";

/** The summaries worth a vector: written by a model (a template says little a keyword can't find). */
const embeddable = (repoId: number) => and(eq(summaries.repoId, repoId), isNotNull(summaries.tagline), ne(summaries.model, "template"));

export type SummaryToEmbed = { id: number; path: string; tagline: string; summary: string; inputHash: string };

export function loadSummariesWithoutVectors(db: Db, repoId: number): SummaryToEmbed[] {
    return db.select({ id: summaries.id, path: summaries.targetPath, tagline: summaries.tagline, summary: summaries.summary, inputHash: summaries.inputHash })
        .from(summaries)
        .leftJoin(summaryVectors, eq(summaryVectors.summaryId, summaries.id))
        .where(and(embeddable(repoId), isNull(summaryVectors.id)))
        .orderBy(summaries.id)
        .all()
        .map((r) => ({ id: r.id, path: r.path, tagline: r.tagline!, summary: r.summary ?? "", inputHash: r.inputHash! }));
}

export function countEmbeddable(db: Db, repoId: number): number {
    return db.select({ n: sql<number>`count(*)` }).from(summaries).where(embeddable(repoId)).get()?.n ?? 0;
}

/**
 * Stores vectors, each only if its summary still has the text it was computed from: the same inputHash, which changes
 * exactly when the text does. The text can be rewritten while it's being embedded (a "summarize now" in the background
 * worker, say), and a vector of the old text would then sit on the new text for good, since nothing re-embeds a row
 * that has one (ADR-027, amended in V1.3). Returns how many it stored.
 */
export function writeSummaryVectors(db: Db, rows: readonly { summaryId: number; inputHash: string; embedding: Buffer }[]): number {
    let written = 0;

    // immediate: take the write lock before reading the hashes, so no other process rewrites a row between the check and the insert
    db.transaction((tx) => {
        for (const row of rows){
            const current = tx.select({ inputHash: summaries.inputHash }).from(summaries).where(eq(summaries.id, row.summaryId)).get();
            if (current?.inputHash !== row.inputHash) continue;
            // onConflictDoNothing: a second embedder racing this one must not crash on summary_id's uniqueness
            written += tx.insert(summaryVectors).values({ summaryId: row.summaryId, embedding: row.embedding }).onConflictDoNothing().run().changes;
        }
    }, { behavior: "immediate" });

    return written;
}

export type StoredVector = { kind: SummaryTargetKind; path: string; embedding: Buffer };

/** Every file and folder vector of a repo. The repo's own summary is never a search hit, so its vector is left out. */
export function loadSummaryVectors(db: Db, repoId: number): StoredVector[] {
    return db.select({ kind: summaries.targetKind, path: summaries.targetPath, embedding: summaryVectors.embedding })
        .from(summaryVectors)
        .innerJoin(summaries, eq(summaries.id, summaryVectors.summaryId))
        .where(and(eq(summaries.repoId, repoId), ne(summaries.targetKind, "repo")))
        .orderBy(summaryVectors.id)
        .all();
}

/** Changes whenever a vector is added or removed (ids only grow), so a cache can tell when it's out of date. */
export function summaryVectorStamp(db: Db, repoId: number): string {
    const row = db.select({ n: sql<number>`count(*)`, maxId: sql<number | null>`max(${summaryVectors.id})` })
        .from(summaryVectors)
        .innerJoin(summaries, eq(summaries.id, summaryVectors.summaryId))
        .where(eq(summaries.repoId, repoId))
        .get();
    return `${row?.n ?? 0}:${row?.maxId ?? 0}`;
}

/** How many model-written summaries have their vector: the embeddings stage's `done`, counted live. */
export function countEmbedded(db: Db, repoId: number): number {
    return db.select({ n: sql<number>`count(*)` }).from(summaries)
        .innerJoin(summaryVectors, eq(summaryVectors.summaryId, summaries.id))
        .where(embeddable(repoId)).get()?.n ?? 0;
}
