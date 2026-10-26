/**
 * Turning stored specifiers into import edges, for every language at once (ADR-065). The full run and the incremental
 * update both build edges and entry points here, so they can't disagree (as edgesFrom did for TypeScript alone, ADR-037).
 */
import type { ImportEdge } from "../../db/store/structure";
import type { LanguageAdapter, LanguageResolver, ResolveContext, StoredFacts } from "./adapter";
import { rulesFor } from "./rules";

/**
 * What resolution keeps between a worker's incremental updates: the manifests it was read with and each adapter's cache
 * (TypeScript's workspace, ADR-053 amended). A manifest or a file-set change starts a new one.
 */
export type ResolutionState = { manifests: readonly string[]; cache: Map<string, unknown> };

/**
 * One file's import edges: each specifier resolved, one edge per target file, in specifier order and then resolve's
 * order, named by the first specifier that reaches it. The importer itself is never a target: `[importer]` means placed
 * with no edge of its own (LanguageResolver.resolve).
 */
export function edgesOf(resolver: LanguageResolver, source: string, specifiers: readonly string[]): ImportEdge[] {
    const seen = new Set<string>();
    const edges: ImportEdge[] = [];
    for (const specifier of specifiers){
        for (const target of resolver.resolve(source, specifier)){
            if (target === source || seen.has(target)) continue;   // one edge per file pair, and no self edge
            seen.add(target);
            edges.push({ source, target, specifier });
        }
    }
    return edges;
}

/**
 * One resolver per adapter for this run, keyed by adapter id in the adapters' order: each adapter is given the files
 * that adapterFor maps to it, and only an adapter with at least one file gets one.
 */
export function createResolvers(
    adapters: readonly LanguageAdapter[], base: Omit<ResolveContext, "files">, files: ReadonlyMap<string, StoredFacts>
): Map<string, LanguageResolver> {
    const byAdapter = new Map<LanguageAdapter, Map<string, StoredFacts>>();
    for (const [filePath, facts] of files){
        const adapter = rulesFor(filePath, adapters);
        if (adapter === null) continue;
        let own = byAdapter.get(adapter);
        if (own === undefined){
            own = new Map();
            byAdapter.set(adapter, own);
        }
        own.set(filePath, facts);
    }

    const resolvers = new Map<string, LanguageResolver>();
    for (const adapter of adapters){
        const own = byAdapter.get(adapter);
        if (own !== undefined) resolvers.set(adapter.id, adapter.createResolver({ ...base, files: own }));
    }
    return resolvers;
}

/**
 * Every adapter's entry points, in the resolvers' order: one entry per path (entry_points has a unique index), the first
 * one met winning, within one adapter too; sorted by path.
 */
export function entryPointsOf(resolvers: ReadonlyMap<string, LanguageResolver>): { path: string; declaredBy: string }[] {
    const declared = new Map<string, string>();
    for (const resolver of resolvers.values()){
        for (const entry of resolver.entryPoints()) if (!declared.has(entry.path)) declared.set(entry.path, entry.declaredBy);
    }
    return [...declared].map(([p, declaredBy]) => ({ path: p, declaredBy })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
