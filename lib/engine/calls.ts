import path from "path";
import { getDb, type Db } from "../db/client";
import { loadCallBindings, loadCallsOf, loadInjectionSites, loadTypeDecls, type StoredBinding, type StoredCall, type StoredTypeDecl } from "../db/store/calls";
import { loadFolderInfo } from "../db/store/map";
import { loadImportEdges, requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import type { CallRule } from "../db/schema";
import { rulesFor } from "../index/languages/rules";
import { repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { importGraphFor, type ImportGraph } from "./graph";
import { areasOf, type ImpactArea } from "./impact";
import { kindAt } from "./reach";

/**
 * Calls through declared types (ADR-059), resolved at query time (R-B). The adapter stored each file's facts; here a
 * TypeRef written in a file is followed to the file that declares the type: a type declared there wins, else the import
 * binding of that name, the stored import edge with the binding's specifier, and that module's exports, through
 * re-exports and `export *` with a visited set. Heritage then gives each type's subtypes and implementations. The index is
 * built once per index version and kept beside the import graph of that version, as the import index is (ADR-045).
 */

/** A type: its file and name ("src/a.ts#IFoo"), or for a nested or nameless class its file and line ("src/a.ts@12", R-O). */
export type TypeKey = string;

export type TypeInfo = {
    key: TypeKey; file: string; name: string | null; kind: "class" | "interface"; line: number; nested: boolean; isTest: boolean;
    extendsRefs: string[]; implementsRefs: string[]; testDoubleOf: string | null; members: Set<string>; fields: Map<string, string>;
};

export type CallIndex = {
    types: Map<TypeKey, TypeInfo>;
    /** A declared name → its top-level types, in path order. */
    byName: Map<string, TypeKey[]>;
    /** A type → the types that extend it directly (sub-interfaces; subclasses). */
    extendedBy: Map<TypeKey, TypeKey[]>;
    /** A type → the classes that implement it directly, and its test doubles. */
    implementedBy: Map<TypeKey, { key: TypeKey; double: boolean }[]>;
    /** A TypeRef as written in a file → the type it names, or null. Memoized. */
    resolve(file: string, ref: string): TypeKey | null;
};

export type Implementation = { key: TypeKey; via: "implements" | "sub-interface" | "base class" | "test double"; through: string | null };

type Edge = { source: string; target: string; specifier: string };
type Found = { type: TypeKey } | { namespace: string } | null;

/** How many bindings one resolution may follow before it gives up: barrels chain, but not this far. */
const MAX_HOPS = 32;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (info: TypeInfo | undefined): string => info?.name ?? "(anonymous class)";

export function buildCallIndex(decls: readonly StoredTypeDecl[], bindings: readonly StoredBinding[], edges: readonly Edge[]): CallIndex {
    const types = new Map<TypeKey, TypeInfo>();
    const byName = new Map<string, TypeKey[]>();
    const localTypes = new Map<string, Map<string, TypeKey>>();
    for (const d of decls){
        const key = d.nested || d.name === null ? `${d.path}@${d.line}` : `${d.path}#${d.name}`;
        const seen = types.get(key);
        if (seen){
            // one name, several declarations in a file (Review Focus 2): one type, its parts merged
            if (d.kind === "class") seen.kind = "class";
            seen.line = Math.min(seen.line, d.line);
            seen.extendsRefs.push(...d.extendsRefs);
            seen.implementsRefs.push(...d.implementsRefs);
            seen.testDoubleOf ??= d.testDoubleOf;
            for (const m of d.members) seen.members.add(m);
            for (const [field, ref] of Object.entries(d.fields)) if (!seen.fields.has(field)) seen.fields.set(field, ref);
            continue;
        }
        types.set(key, {
            key, file: d.path, name: d.name, kind: d.kind, line: d.line, nested: d.nested, isTest: d.isTest,
            extendsRefs: [...d.extendsRefs], implementsRefs: [...d.implementsRefs], testDoubleOf: d.testDoubleOf,
            members: new Set(d.members), fields: new Map(Object.entries(d.fields)),
        });
        if (!d.nested && d.name !== null){
            byName.set(d.name, [...(byName.get(d.name) ?? []), key]);
            const local = localTypes.get(d.path) ?? new Map<string, TypeKey>();
            local.set(d.name, key);
            localTypes.set(d.path, local);
        }
    }
    const bindingsOf = new Map<string, StoredBinding[]>();
    for (const b of bindings) bindingsOf.set(b.path, [...(bindingsOf.get(b.path) ?? []), b]);
    const targets = new Map<string, string>();
    for (const e of edges) targets.set(`${e.source}\0${e.specifier}`, e.target);
    const edgeOf = (file: string, specifier: string | null): string | null => (specifier === null ? null : targets.get(`${file}\0${specifier}`) ?? null);

    // a name in a file: a type declared there, or what its import binding brings in
    // one visited set per resolution, shared by both functions: a local re-export (`import { X } from "./b"; export { X }`) goes round the same cycle, and a fresh set each time would walk it MAX_HOPS deep through every `export *`
    const resolveLocal = (file: string, name: string, hops: number, visited: Set<string> = new Set()): Found => {
        const local = localTypes.get(file)?.get(name);
        if (local !== undefined) return { type: local };
        const b = (bindingsOf.get(file) ?? []).find((x) => x.kind === "import" && x.local === name);
        const into = b ? edgeOf(file, b.specifier) : null;
        if (!b || into === null) return null;
        return b.imported === "*" ? { namespace: into } : resolveExport(into, b.imported, hops + 1, visited);
    };
    // a name a module exports: its own type, a local export, a re-export, or what an `export *` passes on
    const resolveExport = (file: string, name: string, hops: number, visited: Set<string>): Found => {
        const at = `${file}\0${name}`;
        if (hops > MAX_HOPS || visited.has(at)) return null;   // re-export loops (Review Focus 1)
        visited.add(at);
        if (name !== "default"){
            const local = localTypes.get(file)?.get(name);
            if (local !== undefined) return { type: local };
        }
        const own = bindingsOf.get(file) ?? [];
        const exported = own.find((x) => x.kind === "export" && x.local === name);
        if (exported) return resolveLocal(file, exported.imported, hops + 1, visited);
        const renamed = own.find((x) => x.kind === "reexport" && x.local === name);
        if (renamed){
            const into = edgeOf(file, renamed.specifier);
            if (into === null) return null;
            return renamed.imported === "*" ? { namespace: into } : resolveExport(into, renamed.imported, hops + 1, visited);
        }
        if (name === "default") return null;   // an `export *` never passes a default on
        for (const star of own.filter((x) => x.kind === "reexport" && x.local === "*")){
            const into = edgeOf(file, star.specifier);
            const found = into === null ? null : resolveExport(into, name, hops + 1, visited);
            if (found !== null) return found;
        }
        return null;
    };
    const memo = new Map<string, TypeKey | null>();
    const resolve = (file: string, ref: string): TypeKey | null => {
        // "@12": a nested or nameless class of this very file (R-O's key), which no import can name
        if (ref.startsWith("@")) return types.has(`${file}${ref}`) ? `${file}${ref}` : null;
        const k = `${file}\0${ref}`;
        if (memo.has(k)) return memo.get(k)!;
        const dot = ref.indexOf(".");
        let found: Found;
        if (dot < 0) found = resolveLocal(file, ref, 0);
        else {
            const space = resolveLocal(file, ref.slice(0, dot), 0);
            found = space !== null && "namespace" in space ? resolveExport(space.namespace, ref.slice(dot + 1), 1, new Set()) : null;
        }
        const key = found !== null && "type" in found ? found.type : null;
        memo.set(k, key);
        return key;
    };

    const extendedBy = new Map<TypeKey, TypeKey[]>();
    const implementedBy = new Map<TypeKey, { key: TypeKey; double: boolean }[]>();
    const add = <T>(map: Map<TypeKey, T[]>, key: TypeKey, value: T): void => { map.set(key, [...(map.get(key) ?? []), value]); };
    for (const t of types.values()){
        for (const ref of t.extendsRefs){
            const s = resolve(t.file, ref);
            if (s !== null && s !== t.key) add(extendedBy, s, t.key);
        }
        for (const ref of t.implementsRefs){
            const s = resolve(t.file, ref);
            if (s !== null) add(implementedBy, s, { key: t.key, double: false });
        }
        const double = t.testDoubleOf === null ? null : resolve(t.file, t.testDoubleOf);
        if (double !== null) add(implementedBy, double, { key: t.key, double: true });
    }
    return { types, byName, extendedBy, implementedBy, resolve };
}

/** A type's subtypes (sub-interfaces, or a class's subclasses) and its implementations, each once, by rank: implements, sub-interface, base class, test double. */
export function hierarchyOf(index: CallIndex, target: TypeKey): { subtypes: Set<TypeKey>; implementations: Map<TypeKey, Implementation> } {
    const subtypes = new Set<TypeKey>();
    for (const queue = [target]; queue.length > 0;){
        for (const s of index.extendedBy.get(queue.shift()!) ?? []){
            if (s === target || subtypes.has(s)) continue;
            subtypes.add(s);
            queue.push(s);
        }
    }
    const rank = { "implements": 0, "sub-interface": 1, "base class": 2, "test double": 3 } as const;
    const implementations = new Map<TypeKey, Implementation>();
    const offer = (impl: Implementation): void => {
        const had = implementations.get(impl.key);
        if (!had || rank[impl.via] < rank[had.via]) implementations.set(impl.key, impl);
    };
    const interfaces = [target, ...[...subtypes].filter((s) => index.types.get(s)?.kind === "interface")];
    for (const i of interfaces){
        for (const { key, double } of index.implementedBy.get(i) ?? []){
            offer(double ? { key, via: "test double", through: null }
                : i === target ? { key, via: "implements", through: null }
                : { key, via: "sub-interface", through: nameOf(index.types.get(i)) });
        }
    }
    // the subclasses of an implementation implement the type too, through their base class
    for (const base of [...implementations.keys()]){
        for (const below = [base]; below.length > 0;){
            for (const sub of index.extendedBy.get(below.shift()!) ?? []){
                const had = implementations.get(sub);
                if (had && rank[had.via] <= rank["base class"]) continue;
                offer({ key: sub, via: "base class", through: nameOf(index.types.get(base)) });
                below.push(sub);
            }
        }
    }
    for (const s of subtypes) implementations.delete(s);   // a class's own subclasses are its subtypes
    return { subtypes, implementations };
}

/** Every member of a type and of what it extends. */
function allMembers(index: CallIndex, key: TypeKey): Set<string> {
    const out = new Set<string>();
    const seen = new Set<TypeKey>();
    for (const queue = [key]; queue.length > 0;){
        const at = queue.shift()!;
        const t = index.types.get(at);
        if (seen.has(at) || !t) continue;
        seen.add(at);
        for (const m of t.members) out.add(m);
        for (const ref of t.extendsRefs){
            const s = index.resolve(t.file, ref);
            if (s !== null) queue.push(s);
        }
    }
    return out;
}

/** A class's field, declared in it or in a base class (another file's included), as the type it holds. */
function fieldType(index: CallIndex, classKey: TypeKey, field: string, depth: number): TypeKey | null {
    const t = index.types.get(classKey);
    if (!t || depth > 10) return null;
    const ref = t.fields.get(field);
    if (ref !== undefined) return index.resolve(t.file, ref);
    if (t.members.has(field)) return null;   // declared there, with no type a rule can read
    for (const base of t.extendsRefs){
        const b = index.resolve(t.file, base);
        const found = b === null ? null : fieldType(index, b, field, depth + 1);
        if (found !== null) return found;
    }
    return null;
}

function receiverType(index: CallIndex, c: StoredCall): TypeKey | null {
    if (c.receiver === "type") return c.ref === null ? null : index.resolve(c.path, c.ref);
    // the class a this or a field goes through: a top-level class of the file by name (a local declaration wins), or "@<line>"
    const own = c.inClass === null ? null : index.resolve(c.path, c.inClass);
    if (own === null) return null;
    return c.receiver === "this" ? own : c.ref === null ? null : fieldType(index, own, c.ref, 0);
}

const indexes = new WeakMap<ImportGraph, CallIndex>();

/** The call index of one index version, kept with that version's import graph (a new version loads a new one, ADR-044). */
export function callIndexFor(db: Db, repoId: number, version: number): CallIndex {
    const graph = importGraphFor(db, repoId, version);
    let index = indexes.get(graph);
    if (!index){
        index = buildCallIndex(loadTypeDecls(db, repoId), loadCallBindings(db, repoId), loadImportEdges(db, repoId));
        indexes.set(graph, index);
    }
    return index;
}

export type TypeSummary = { name: string; kind: "class" | "interface"; path: string; line: number };
export type ImplementationLine = { name: string | null; path: string; line: number; via: Implementation["via"]; through: string | null; declares: boolean };
export type CallSite = { line: number; category: "type" | "subtype" | "implementation"; receiver: string; receiverDeclares: boolean };
export type CallerFile = { path: string; lines: number[]; receivers: string[]; isTest: boolean; sites: CallSite[] };
export type Areas = { groupBy: string | null; areas: ImpactArea[]; elsewhere: number };
export type MemberAnswer = Areas & {
    kind: "member"; type: TypeSummary; member: string; files: CallerFile[]; calls: number; tests: number;
    categories: { type: number; subtype: number; implementation: number }; subtypeWord: "sub-interface" | "subclass";
    /** Files declaring the member on the type, a subtype or an implementation, that don't also call it: what a signature change adds. */
    declaring: string[]; implementations: ImplementationLine[]; within?: string;
};
export type TypeAnswer = Areas & {
    kind: "type"; type: TypeSummary; files: { path: string; lines: number[]; hows: string[]; isTest: boolean }[]; places: number; tests: number;
    implementations: ImplementationLine[]; within?: string;
};
export type AmbiguousAnswer = { kind: "ambiguous"; name: string; candidates: { kind: "class" | "interface"; path: string; line: number }[] };
export type CallsAnswer = MemberAnswer | TypeAnswer | AmbiguousAnswer;

const SYMBOL = /^([A-Za-z_$][\w$]*)(?:\.(#?[A-Za-z_$][\w$]*))?$/;

/**
 * How a refusal names a language the index reads but the calls index doesn't (E4, C4: calls stays TypeScript and
 * JavaScript), by files.language. One row per merged language; a test holds every language the rules claim to a row.
 */
export const CALLS_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
    python: "Python",
    go: "Go",
    java: "Java",
    csharp: "C#",
    rust: "Rust",
};

/** The refusal for a `path` in a language calls doesn't read, or null for TypeScript, JavaScript or a path no language claims. */
function otherLanguage(filePath: string): string | null {
    const rules = rulesFor(filePath);
    if (rules === null || rules.id === "typescript") return null;
    const language = rules.languageOf(filePath);
    return `Calls are indexed for TypeScript and JavaScript only; ${filePath} is ${CALLS_LANGUAGE_NAMES[language] ?? language}.`;
}

const HOW_WORDS: Partial<Record<CallRule, string>> = { "ctor-param": "constructor", "inject-field": "@inject field", provider: "accessor or hook" };

/** Who calls a type's member, or where a type is injected, with its implementations (ADR-059). */
export function calls(repoRoot: string, query: { symbol: string; path?: string }, options: { groupBy: string | null; within?: string } = { groupBy: null }): CallsAnswer {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        // before the symbol: a file in another language has no calls to find, whatever the name
        const elsewhere = query.path === undefined ? null : otherLanguage(query.path);
        if (elsewhere !== null) throw new BadInputError(elsewhere);
        const parsed = SYMBOL.exec(query.symbol.trim());
        if (parsed === null) throw new BadInputError('symbol takes a class or interface ("IFooService") or one of its members ("IFooService.save").');
        const [, name, member] = parsed;
        const within = options.within === undefined || options.within === "" ? undefined : options.within;
        if (within !== undefined){
            const kind = kindAt(db, repoId, within);
            if (kind === null) throw new BadInputError(`within "${within}" isn't a folder in the index.`);
            if (kind === "file") throw new BadInputError("within takes a folder.");
        }
        if (options.groupBy !== null && options.groupBy !== "" && !loadFolderInfo(db, repoId, options.groupBy)){
            throw new BadInputError(`group_by takes a folder: nothing is indexed as a folder at "${options.groupBy}".`);
        }
        const index = callIndexFor(db, repoId, readIndexVersion(db, repoId));
        const candidates = (index.byName.get(name) ?? []).filter((k) => query.path === undefined || index.types.get(k)!.file === query.path);
        if (candidates.length === 0){
            throw new BadInputError(query.path === undefined
                ? `No class or interface named ${name} is indexed. calls finds a type by its declared name; a type alias, an enum or a type from outside the repo has none.`
                : `${query.path} declares no class or interface named ${name}.`);
        }
        if (candidates.length > 1){
            const found = candidates.map((k) => index.types.get(k)!).map((t) => ({ kind: t.kind, path: t.file, line: t.line }));
            return { kind: "ambiguous", name, candidates: found.sort((a, b) => compare(a.path, b.path)) };
        }
        const target = candidates[0];
        const t = index.types.get(target)!;
        const type: TypeSummary = { name, kind: t.kind, path: t.file, line: t.line };
        const inside = (p: string): boolean => within === undefined || p.startsWith(`${within}/`);
        const { subtypes, implementations } = hierarchyOf(index, target);
        const implementationLines = (declares: (info: TypeInfo) => boolean): ImplementationLine[] => [...implementations.values()]
            .map((impl) => ({ impl, info: index.types.get(impl.key)! }))
            .filter(({ info }) => inside(info.file))
            .map(({ impl, info }) => ({ name: info.name, path: info.file, line: info.line, via: impl.via, through: impl.through, declares: declares(info) }))
            .sort((a, b) => compare(a.path, b.path) || a.line - b.line);
        const areasFor = (paths: readonly string[]): Areas => ({ groupBy: options.groupBy, ...areasOf(paths.map((p) => ({ path: p, distance: 1 })), { path: t.file, kind: "file" }, options.groupBy) });
        const scope = within === undefined ? {} : { within };

        if (member === undefined){
            const byFile = new Map<string, { lines: number[]; hows: Set<string>; isTest: boolean }>();
            for (const site of loadInjectionSites(db, repoId, name)){
                if (!inside(site.path) || site.ref === null || index.resolve(site.path, site.ref) !== target) continue;
                const f = byFile.get(site.path) ?? { lines: [], hows: new Set<string>(), isTest: site.isTest };
                f.lines.push(site.line);
                f.hows.add(HOW_WORDS[site.how] ?? site.how);
                byFile.set(site.path, f);
            }
            const files = [...byFile].map(([p, f]) => ({ path: p, lines: [...f.lines].sort((a, b) => a - b), hows: [...f.hows].sort(compare), isTest: f.isTest }))
                .sort((a, b) => b.lines.length - a.lines.length || compare(a.path, b.path));
            return {
                kind: "type", type, files, places: files.reduce((s, f) => s + f.lines.length, 0), tests: files.filter((f) => f.isTest).length,
                implementations: implementationLines(() => false), ...areasFor(files.map((f) => f.path)), ...scope,
            };
        }

        const known = allMembers(index, target);
        if (!known.has(member)){
            const list = [...known].sort(compare);
            throw new BadInputError(`${name} has no member ${member}. Its members: ${list.slice(0, 30).join(", ")}${list.length > 30 ? ", …" : ""}.`);
        }
        const byFile = new Map<string, { sites: CallSite[]; isTest: boolean }>();
        for (const c of loadCallsOf(db, repoId, member)){
            if (!inside(c.path)) continue;
            const r = receiverType(index, c);
            const category = r === null ? null : r === target ? "type" : subtypes.has(r) ? "subtype" : implementations.has(r) ? "implementation" : null;
            if (r === null || category === null) continue;
            const info = index.types.get(r)!;
            const f = byFile.get(c.path) ?? { sites: [], isTest: c.isTest };
            f.sites.push({ line: c.line, category, receiver: nameOf(info), receiverDeclares: info.members.has(member) });
            byFile.set(c.path, f);
        }
        const files: CallerFile[] = [...byFile].map(([p, f]) => {
            const onlyOnType = f.sites.every((s) => s.category === "type");
            return {
                path: p, lines: f.sites.map((s) => s.line).sort((a, b) => a - b), isTest: f.isTest, sites: f.sites,
                receivers: onlyOnType ? [] : [...new Set(f.sites.map((s) => s.receiver))].sort(compare),
            };
        }).sort((a, b) => b.lines.length - a.lines.length || compare(a.path, b.path));
        const count = (category: CallSite["category"]): number => files.filter((f) => f.sites.some((s) => s.category === category)).length;
        const callers = new Set(files.map((f) => f.path));
        const declaring = new Set<string>();
        for (const key of [target, ...subtypes, ...implementations.keys()]){
            const info = index.types.get(key)!;
            if (info.members.has(member) && inside(info.file) && !callers.has(info.file)) declaring.add(info.file);
        }
        return {
            kind: "member", type, member, files, calls: files.reduce((s, f) => s + f.lines.length, 0), tests: files.filter((f) => f.isTest).length,
            categories: { type: count("type"), subtype: count("subtype"), implementation: count("implementation") },
            subtypeWord: t.kind === "interface" ? "sub-interface" : "subclass",
            declaring: [...declaring].sort(compare), implementations: implementationLines((info) => info.members.has(member)),
            ...areasFor(files.map((f) => f.path)), ...scope,
        };
    });
}
