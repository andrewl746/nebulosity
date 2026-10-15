import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { docLinks, docs, type DocFacts, type DocLinkRow } from "../schema";

/** A repo's docs and their links, replaced wholesale on each full run (ADR-054, R7). */
export function replaceDocs(db: Db, repoId: number, facts: readonly DocFacts[], links: readonly DocLinkRow[]): void {
    db.transaction((tx) => {
        tx.delete(docs).where(eq(docs.repoId, repoId)).run();
        tx.delete(docLinks).where(eq(docLinks.repoId, repoId)).run();
        forEachBatch(facts.map((f) => ({ repoId, ...f })), columnCount(docs), (batch) => { tx.insert(docs).values(batch).run(); });
        forEachBatch(links.map((l) => ({ repoId, ...l })), columnCount(docLinks), (batch) => { tx.insert(docLinks).values(batch).run(); });
    });
}

export function loadDocs(db: Db, repoId: number): { path: string; title: string }[] {
    return db.select({ path: docs.path, title: docs.title }).from(docs).where(eq(docs.repoId, repoId)).orderBy(asc(docs.path)).all();
}

const linkColumns = { docPath: docLinks.docPath, targetPath: docLinks.targetPath, kind: docLinks.kind, count: docLinks.count, detail: docLinks.detail };

/** The links to these places: a path and its folders above it, a handful of values. */
export function loadDocLinksTo(db: Db, repoId: number, targets: readonly string[]): DocLinkRow[] {
    if (targets.length === 0) return [];
    return db.select(linkColumns).from(docLinks).where(and(eq(docLinks.repoId, repoId), inArray(docLinks.targetPath, [...targets]))).all();
}

/** Every link of the repo, by doc and then target: overview's ranking needs them all (VS Code: a few thousand rows). */
export function loadAllDocLinks(db: Db, repoId: number): DocLinkRow[] {
    return db.select(linkColumns).from(docLinks).where(eq(docLinks.repoId, repoId))
        .orderBy(asc(docLinks.docPath), asc(docLinks.targetPath), asc(docLinks.kind)).all();
}
