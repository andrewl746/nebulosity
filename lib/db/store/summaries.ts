import { and, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../client";
import {
    chunks, files, folders, imports, summaries, summaryUsage, summaryVectors,
    type StoredSummaryStatus, type SummaryTargetKind,
} from "../schema";
import { columnCount, forEachBatch } from "../batch";

/** What a model (or a template) wrote about a target. */
export type SummaryText = { tagline: string; summary: string };

/** One row of the summaries table, as the planner and the CLI read it. */
export type StoredSummary = {
    id: number;
    kind: SummaryTargetKind;
    path: string;
    tagline: string | null;
    summary: string | null;
    model: string | null;
    inputHash: string | null;
    status: StoredSummaryStatus;
    batchId: string | null;
    error: string | null;
};

/** A file as the summary planner sees it. */
export type FileFacts = { path: string; contentHash: string; lineCount: number; isTest: boolean; importedBy: number };

/** A file that imports another, as that file's prompt needs it: where it is, and whether the indexer calls it a test file. */
export type Importer = { path: string; isTest: boolean };

/** A folder as the summary planner sees it. */
export type FolderFacts = { path: string; parentPath: string | null; depth: number; name: string; fileCount: number; directFileCount: number };

/** What the planner decided for one target, as far as the database needs to know. */
export type TargetUpdate = {
    kind: SummaryTargetKind;
    path: string;
    inputHash: string;
    /** The status the row shows from now on; null leaves the row's status as it is. */
    status: StoredSummaryStatus | null;
    /** Test files only: written right away, no model call. */
    templateText?: SummaryText;
};

/** One answer to write back: a summary, or why there isn't one. */
export type SummaryResult = {
    id: number;
    /** The batch the answer came from; null for the regular API. A batch answer only lands while that batch still owns the row. */
    batchId: string | null;
    /** The input the answer was written for. */
    inputHash: string;
    outcome: { ok: true; text: SummaryText; model: string } | { ok: false; error: string };
};

export type UsageRow = { model: string; transport: "direct" | "batch"; requests: number; inputTokens: number; outputTokens: number };

/** The one key a target goes by everywhere: "file:src/a.ts", "folder:src", "repo:". */
export const targetKey = (kind: SummaryTargetKind, targetPath: string): string => `${kind}:${targetPath}`;

/** Every file, in path order, with how many files import it (its importance, PIVOT_SPEC.md §5.2). */
export function loadFileFacts(db: Db, repoId: number): FileFacts[] {
    return db.select({
        path: files.path,
        contentHash: files.contentHash,
        lineCount: files.lineCount,
        isTest: files.isTest,
        importedBy: sql<number>`count(${imports.id})`,
    })
        .from(files)
        .leftJoin(imports, eq(imports.targetFileId, files.id))
        .where(eq(files.repoId, repoId))
        .groupBy(files.id)
        .orderBy(files.path)
        .all();
}

/**
 * The files that import filePath, in path order (empty for a path that isn't indexed), each with its own is-test
 * flag. Each appears once: an import is unique per source and target. `files` is joined twice, once as the
 * imported file and once, aliased, as its importer; imports never cross repos, so the importer needs no repo
 * check of its own.
 */
export function loadImporters(db: Db, repoId: number, filePath: string): Importer[] {
    const importer = alias(files, "importer");

    return db.select({ path: importer.path, isTest: importer.isTest })
        .from(files)
        .innerJoin(imports, eq(imports.targetFileId, files.id))
        .innerJoin(importer, eq(importer.id, imports.sourceFileId))
        .where(and(eq(files.repoId, repoId), eq(files.path, filePath)))
        .orderBy(importer.path)
        .all();
}

export function loadFolderFacts(db: Db, repoId: number): FolderFacts[] {
    return db.select({
        path: folders.path,
        parentPath: folders.parentPath,
        depth: folders.depth,
        name: folders.name,
        fileCount: folders.fileCount,
        directFileCount: folders.directFileCount,
    }).from(folders).where(eq(folders.repoId, repoId)).orderBy(folders.path).all();
}

export function loadSummaries(db: Db, repoId: number): StoredSummary[] {
    return db.select({
        id: summaries.id,
        kind: summaries.targetKind,
        path: summaries.targetPath,
        tagline: summaries.tagline,
        summary: summaries.summary,
        model: summaries.model,
        inputHash: summaries.inputHash,
        status: summaries.status,
        batchId: summaries.batchId,
        error: summaries.error,
    }).from(summaries).where(eq(summaries.repoId, repoId)).orderBy(summaries.id).all();
}

/** The imports/exports listing chunks.ts generates for every file (kind "file-summary"). */
export function loadFileSummaryChunk(db: Db, repoId: number, filePath: string): string | null {
    return db.select({ text: chunks.text })
        .from(chunks)
        .innerJoin(files, eq(files.id, chunks.fileId))
        .where(and(eq(files.repoId, repoId), eq(files.path, filePath), eq(chunks.kind, "file-summary")))
        .get()?.text ?? null;
}

/**
 * Persists a plan: creates rows for new targets, updates the status of existing ones when
 * the plan says so, and writes test-file templates. Returns every row id by targetKey;
 * the ids become the requests' custom ids.
 */
export function applyTargetUpdates(db: Db, repoId: number, updates: readonly TargetUpdate[]): Map<string, number> {
    const now = new Date();
    const existing = new Set(loadSummaries(db, repoId).map((s) => targetKey(s.kind, s.path)));

    db.transaction((tx) => {
        const created = updates
            .filter((u) => !existing.has(targetKey(u.kind, u.path)))
            .map((u) => ({
                repoId,
                targetKind: u.kind,
                targetPath: u.path,
                status: u.status ?? ("pending" as const),
                tagline: u.templateText?.tagline ?? null,
                summary: u.templateText?.summary ?? null,
                model: u.templateText ? "template" : null,
                inputHash: u.templateText ? u.inputHash : null,
                updatedAt: now,
            }));
        forEachBatch(created, columnCount(summaries), (batch) => { tx.insert(summaries).values(batch).run(); });

        for (const u of updates){
            if (!existing.has(targetKey(u.kind, u.path))) continue;
            const row = and(eq(summaries.repoId, repoId), eq(summaries.targetKind, u.kind), eq(summaries.targetPath, u.path));

            if (u.templateText){
                tx.update(summaries).set({
                    tagline: u.templateText.tagline, summary: u.templateText.summary, model: "template",
                    inputHash: u.inputHash, status: "skipped", error: null, updatedAt: now,
                }).where(row).run();
            } else if (u.status !== null){
                tx.update(summaries).set({ status: u.status, updatedAt: now }).where(row).run();
            }
        }
    });

    return new Map(loadSummaries(db, repoId).map((s) => [targetKey(s.kind, s.path), s.id]));
}

/** Records that a Message Batch now carries these rows' requests, and the input each one answers. */
export function markInFlight(db: Db, batchId: string, rows: readonly { id: number; inputHash: string }[]): void {
    db.transaction((tx) => {
        for (const row of rows){
            tx.update(summaries).set({ batchId, pendingHash: row.inputHash }).where(eq(summaries.id, row.id)).run();
        }
    });
}

/** Every batch still out at Anthropic for this repo. */
export function inFlightBatches(db: Db, repoId: number): string[] {
    return db.selectDistinct({ batchId: summaries.batchId }).from(summaries)
        .where(and(eq(summaries.repoId, repoId), isNotNull(summaries.batchId)))
        .all()
        .map((r) => r.batchId!)
        .sort();
}

/** How many requests are still out at Anthropic for this repo. */
export function countInFlight(db: Db, repoId: number): number {
    return db.select({ n: sql<number>`count(*)` }).from(summaries)
        .where(and(eq(summaries.repoId, repoId), isNotNull(summaries.batchId))).get()?.n ?? 0;
}

/** The rows one batch carries, with the input each request answers (markInFlight sets both columns together). */
export function loadBatchRows(db: Db, batchId: string): { id: number; kind: SummaryTargetKind; path: string; inputHash: string }[] {
    return db.select({ id: summaries.id, kind: summaries.targetKind, path: summaries.targetPath, pendingHash: summaries.pendingHash })
        .from(summaries).where(eq(summaries.batchId, batchId)).orderBy(summaries.id).all()
        .map((r) => ({ id: r.id, kind: r.kind, path: r.path, inputHash: r.pendingHash! }));
}

/**
 * Writes answers back and returns how many rows changed.
 * - A summary lands as "fresh" with its text and inputHash. Its old vector is deleted, so
 *   the embeddings stage redoes it.
 * - A failure becomes "failed" and keeps any older text on show. A failure from the regular API
 *   leaves a batch's claim on the row in place: that request is already paid for, and its
 *   answer can still land.
 * - An answer from a batch that no longer owns the row (the row was redone some other way
 *   meanwhile) is dropped.
 */
export function writeResults(db: Db, results: readonly SummaryResult[]): number {
    const now = new Date();
    let written = 0;

    db.transaction((tx) => {
        for (const r of results){
            const owner = r.batchId === null ? eq(summaries.id, r.id) : and(eq(summaries.id, r.id), eq(summaries.batchId, r.batchId));
            const answer = r.outcome.ok
                ? { tagline: r.outcome.text.tagline, summary: r.outcome.text.summary, model: r.outcome.model, inputHash: r.inputHash, status: "fresh" as const, error: null }
                : { status: "failed" as const, error: r.outcome.error };

            // Only a regular-API failure keeps the row's claim: a regular-API success supersedes the batch,
            // and a batch's own answer, either way, is the end of that batch's request.
            const releasesClaim = r.outcome.ok || r.batchId !== null;
            const changed = tx.update(summaries)
                .set({ ...answer, ...(releasesClaim ? { batchId: null, pendingHash: null } : {}), updatedAt: now })
                .where(owner).run().changes;
            if (changed > 0 && r.outcome.ok) tx.delete(summaryVectors).where(eq(summaryVectors.summaryId, r.id)).run();
            written += changed;
        }
    });

    return written;
}

/** Adds answers' tokens to the repo's running API spend (an upsert that increments). */
export function addUsage(db: Db, repoId: number, model: string, transport: "direct" | "batch", usage: { requests: number; inputTokens: number; outputTokens: number }): void {
    db.insert(summaryUsage)
        .values({ repoId, model, transport, ...usage })
        .onConflictDoUpdate({
            target: [summaryUsage.repoId, summaryUsage.model, summaryUsage.transport],
            set: {
                requests: sql`${summaryUsage.requests} + ${usage.requests}`,
                inputTokens: sql`${summaryUsage.inputTokens} + ${usage.inputTokens}`,
                outputTokens: sql`${summaryUsage.outputTokens} + ${usage.outputTokens}`,
            },
        })
        .run();
}

export function loadUsage(db: Db, repoId: number): UsageRow[] {
    return db.select({
        model: summaryUsage.model,
        transport: summaryUsage.transport,
        requests: summaryUsage.requests,
        inputTokens: summaryUsage.inputTokens,
        outputTokens: summaryUsage.outputTokens,
    }).from(summaryUsage).where(eq(summaryUsage.repoId, repoId)).orderBy(summaryUsage.model, summaryUsage.transport).all();
}

/** Deletes summaries whose file or folder no longer exists (their vectors and search rows follow). Returns how many. */
export function pruneSummaries(db: Db, repoId: number): number {
    return db.run(sql`
        delete from summaries where repo_id = ${repoId} and (
            (target_kind = 'file' and not exists (select 1 from files f where f.repo_id = ${repoId} and f.path = summaries.target_path))
            or (target_kind = 'folder' and not exists (select 1 from folders d where d.repo_id = ${repoId} and d.path = summaries.target_path))
        )`).changes;
}
