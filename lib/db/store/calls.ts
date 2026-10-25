import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { callBindings, files, symbols, typeDecls, typedCalls, type BindingFact, type CallFacts, type TypeDeclFact, type TypedCallFact } from "../schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type StoredTypeDecl = TypeDeclFact & { path: string; isTest: boolean };
export type StoredBinding = BindingFact & { path: string };
export type StoredCall = TypedCallFact & { path: string; isTest: boolean };

/** A file's call facts, replaced inside writeOne's transaction with its chunks and symbols (ADR-059). */
export function replaceCallFacts(tx: Tx, fileId: number, facts: CallFacts): void {
    tx.delete(typeDecls).where(eq(typeDecls.fileId, fileId)).run();
    tx.delete(callBindings).where(eq(callBindings.fileId, fileId)).run();
    tx.delete(typedCalls).where(eq(typedCalls.fileId, fileId)).run();
    const typeRows = facts.types.map((t) => ({
        fileId, name: t.name, kind: t.kind, line: t.line, exported: t.exported, nested: t.nested,
        extendsRefs: JSON.stringify(t.extendsRefs), implementsRefs: JSON.stringify(t.implementsRefs), testDoubleOf: t.testDoubleOf,
        members: JSON.stringify(t.members), fields: JSON.stringify(t.fields),
    }));
    forEachBatch(typeRows, columnCount(typeDecls), (batch) => { tx.insert(typeDecls).values(batch).run(); });
    forEachBatch(facts.bindings.map((b) => ({ fileId, ...b })), columnCount(callBindings), (batch) => { tx.insert(callBindings).values(batch).run(); });
    forEachBatch(facts.calls.map((c) => ({ fileId, ...c })), columnCount(typedCalls), (batch) => { tx.insert(typedCalls).values(batch).run(); });
}

/** Every class and interface of a repo, with its file (the engine's call index, once per index version). */
export function loadTypeDecls(db: Db, repoId: number): StoredTypeDecl[] {
    return db.select({ path: files.path, isTest: files.isTest, d: typeDecls }).from(typeDecls)
        .innerJoin(files, eq(files.id, typeDecls.fileId)).where(eq(files.repoId, repoId)).orderBy(files.path, typeDecls.id).all()
        .map(({ path, isTest, d }) => ({
            name: d.name, kind: d.kind, line: d.line, exported: d.exported, nested: d.nested,
            extendsRefs: JSON.parse(d.extendsRefs) as string[], implementsRefs: JSON.parse(d.implementsRefs) as string[], testDoubleOf: d.testDoubleOf,
            members: JSON.parse(d.members) as string[], fields: JSON.parse(d.fields) as Record<string, string>, path, isTest,
        }));
}

export function loadCallBindings(db: Db, repoId: number): StoredBinding[] {
    return db.select({ path: files.path, kind: callBindings.kind, local: callBindings.local, imported: callBindings.imported, specifier: callBindings.specifier })
        .from(callBindings).innerJoin(files, eq(files.id, callBindings.fileId)).where(eq(files.repoId, repoId)).orderBy(files.path, callBindings.id).all();
}

const callColumns = {
    path: files.path, isTest: files.isTest, line: typedCalls.line, member: typedCalls.member, receiver: typedCalls.receiver,
    ref: typedCalls.ref, inClass: typedCalls.inClass, how: typedCalls.how,
};

/** The calls of one member name across a repo (typed_calls_member_idx). */
export function loadCallsOf(db: Db, repoId: number, member: string): StoredCall[] {
    return db.select(callColumns).from(typedCalls).innerJoin(files, eq(files.id, typedCalls.fileId))
        .where(and(eq(files.repoId, repoId), eq(typedCalls.member, member))).orderBy(files.path, typedCalls.line, typedCalls.id).all();
}

/** The injection sites whose TypeRef is the name, bare or as a namespace's member ("IFoo", "ns.IFoo"). */
export function loadInjectionSites(db: Db, repoId: number, name: string): StoredCall[] {
    return db.select(callColumns).from(typedCalls).innerJoin(files, eq(files.id, typedCalls.fileId))
        .where(and(eq(files.repoId, repoId), isNull(typedCalls.member), or(eq(typedCalls.ref, name), like(typedCalls.ref, `%.${name}`))))
        .orderBy(files.path, typedCalls.line, typedCalls.id).all()
        // LIKE's "_" matches any character: keep only a true ".name" ending
        .filter((c) => c.ref === name || c.ref!.endsWith(`.${name}`));
}

/**
 * The files whose symbols declare a type named `name` (a class, interface, struct or trait, at any depth), each once, by
 * path. The symbols are every language's, where the calls index is TypeScript's and JavaScript's only, so calls can
 * tell "not indexed" from "indexed in a language calls doesn't read" (the E4 final review's A-I3).
 */
export function loadTypeSymbolPaths(db: Db, repoId: number, name: string): string[] {
    return db.selectDistinct({ path: files.path }).from(symbols).innerJoin(files, eq(files.id, symbols.fileId))
        .where(and(eq(files.repoId, repoId), eq(symbols.name, name), inArray(symbols.kind, ["class", "interface", "struct", "trait"])))
        .orderBy(files.path).all()
        .map((row) => row.path);
}
