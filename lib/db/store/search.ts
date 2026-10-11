import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { summaries, type SummaryTargetKind } from "../schema";
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
