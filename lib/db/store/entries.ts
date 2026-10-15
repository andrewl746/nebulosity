import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { entryPoints } from "../schema";

type EntryRow = { path: string; declaredBy: string };

/**
 * A repo's declared entry points, replaced wholesale: they're derived from its package.json files (ADR-053). Returns
 * whether the stored set changed, so an update that changed only them still moves the index version (readers cache per
 * version, ADR-036). An unchanged set isn't rewritten.
 */
export function replaceEntryPoints(db: Db, repoId: number, rows: readonly EntryRow[]): boolean {
    return db.transaction((tx) => {
        const key = (r: EntryRow): string => `${r.path}\0${r.declaredBy}`;
        const before = tx.select({ path: entryPoints.path, declaredBy: entryPoints.declaredBy }).from(entryPoints).where(eq(entryPoints.repoId, repoId)).all();
        const wanted = new Set(rows.map(key));
        if (before.length === wanted.size && before.every((r) => wanted.has(key(r)))) return false;

        tx.delete(entryPoints).where(eq(entryPoints.repoId, repoId)).run();
        forEachBatch(rows.map((r) => ({ repoId, ...r })), columnCount(entryPoints), (batch) => { tx.insert(entryPoints).values(batch).run(); });
        return true;
    });
}

export function loadEntryPoints(db: Db, repoId: number): Set<string> {
    return new Set(db.select({ path: entryPoints.path }).from(entryPoints).where(eq(entryPoints.repoId, repoId)).all().map((r) => r.path));
}
