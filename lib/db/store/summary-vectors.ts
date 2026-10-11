import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client";
import { summaries, summaryVectors, type SummaryTargetKind } from "../schema";
import { columnCount, forEachBatch } from "../batch";

/** The summaries worth a vector: written by a model (a template says little a keyword can't find). */
const embeddable = (repoId: number) => and(eq(summaries.repoId, repoId), isNotNull(summaries.tagline), ne(summaries.model, "template"));

export type SummaryToEmbed = { id: number; path: string; tagline: string; summary: string };

export function loadSummariesWithoutVectors(db: Db, repoId: number): SummaryToEmbed[] {
    return db.select({ id: summaries.id, path: summaries.targetPath, tagline: summaries.tagline, summary: summaries.summary })
        .from(summaries)
        .leftJoin(summaryVectors, eq(summaryVectors.summaryId, summaries.id))
        .where(and(embeddable(repoId), isNull(summaryVectors.id)))
        .orderBy(summaries.id)
        .all()
        .map((r) => ({ id: r.id, path: r.path, tagline: r.tagline!, summary: r.summary ?? "" }));
}

export function countEmbeddable(db: Db, repoId: number): number {
    return db.select({ n: sql<number>`count(*)` }).from(summaries).where(embeddable(repoId)).get()?.n ?? 0;
}

export function writeSummaryVectors(db: Db, rows: readonly { summaryId: number; embedding: Buffer }[]): void {
    db.transaction((tx) => {
        // onConflictDoNothing: a second embedder racing this one must not crash on summary_id's uniqueness
        forEachBatch(rows, columnCount(summaryVectors), (batch) => { tx.insert(summaryVectors).values(batch).onConflictDoNothing().run(); });
    });
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
