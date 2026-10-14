import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { entryPoints } from "../schema";

/** A repo's declared entry points, replaced wholesale: they're derived from its package.json files (ADR-053). */
export function replaceEntryPoints(db: Db, repoId: number, rows: readonly { path: string; declaredBy: string }[]): void {
    db.transaction((tx) => {
        tx.delete(entryPoints).where(eq(entryPoints.repoId, repoId)).run();
        forEachBatch(rows.map((r) => ({ repoId, ...r })), columnCount(entryPoints), (batch) => { tx.insert(entryPoints).values(batch).run(); });
    });
}

export function loadEntryPoints(db: Db, repoId: number): Set<string> {
    return new Set(db.select({ path: entryPoints.path }).from(entryPoints).where(eq(entryPoints.repoId, repoId)).all().map((r) => r.path));
}
