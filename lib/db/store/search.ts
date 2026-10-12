import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { meta, summaries, type SummaryTargetKind } from "../schema";
import type { SummaryText } from "./summaries";

export type CodeMatch = { path: string; symbol: string; startLine: number; endLine: number; snippet: string };

/** Chunks matching an FTS5 query, best first (bm25 with the weights migration 0004 stored as `rank`). */
export function searchCode(db: Db, repoId: number, ftsQuery: string, limit: number): CodeMatch[] {
    return db.all<CodeMatch>(sql`
        select f.path as path, c.name as symbol, c.start_line as startLine, c.end_line as endLine,
               snippet(code_fts, 3, '', '', '…', 24) as snippet
        from code_fts
        join chunks c on c.id = code_fts.rowid
        join files f on f.id = c.file_id
        where code_fts match ${ftsQuery} and f.repo_id = ${repoId}
        order by code_fts.rank
        limit ${limit}`);
}

/** File and folder summaries matching an FTS5 query, best first. The repo's own summary is never a hit. */
export function searchSummaries(db: Db, repoId: number, ftsQuery: string, limit: number): { kind: SummaryTargetKind; path: string }[] {
    return db.all<{ kind: SummaryTargetKind; path: string }>(sql`
        select s.target_kind as kind, s.target_path as path
        from summary_fts
        join summaries s on s.id = summary_fts.rowid
        where summary_fts match ${ftsQuery} and s.repo_id = ${repoId} and s.target_kind != 'repo'
        order by summary_fts.rank
        limit ${limit}`);
}

export function loadSummaryText(db: Db, repoId: number, kind: SummaryTargetKind, targetPath: string): SummaryText | null {
    const row = db.select({ tagline: summaries.tagline, summary: summaries.summary })
        .from(summaries)
        .where(and(eq(summaries.repoId, repoId), eq(summaries.targetKind, kind), eq(summaries.targetPath, targetPath)))
        .get();
    return row?.tagline ? { tagline: row.tagline, summary: row.summary ?? "" } : null;
}

/** The meta row that stops the chunk trigger while a bulk run writes (migration 0006, ADR-031 amended). */
const DEFERRED_KEY = "codeSearchDeferred";

/** Stops the chunk trigger from indexing code search until fillCodeSearch runs. Only a run holding the index lock calls it. */
export function deferCodeSearch(db: Db): void {
    db.insert(meta).values({ key: DEFERRED_KEY, value: new Date().toISOString() }).onConflictDoNothing().run();
}

export function isCodeSearchDeferred(db: Db): boolean {
    return db.select({ key: meta.key }).from(meta).where(eq(meta.key, DEFERRED_KEY)).get() !== undefined;
}

/**
 * Indexes every chunk code search is missing, from every repo, in one statement. Then the trigger takes over again.
 * Also the repair for a bulk run that died before getting here. Returns how many chunks it indexed.
 */
export function fillCodeSearch(db: Db): number {
    let filled = 0;
    db.transaction((tx) => {
        filled = tx.run(sql`
            insert into code_fts(rowid, path, name, name_split, text)
            select c.id, f.path, c.name, c.name_split, c.text
            from chunks c join files f on f.id = c.file_id
            where not exists (select 1 from code_fts where code_fts.rowid = c.id)`).changes;
        tx.delete(meta).where(eq(meta.key, DEFERRED_KEY)).run();
    });
    return filled;
}
