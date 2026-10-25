import { describe, expect, it } from "vitest";
import { toyAdapter } from "../../../test/helpers/toy-adapter";
import type { LanguageAdapter, LanguageResolver, ResolveContext, StoredFacts } from "./adapter";
import { createResolvers, edgesOf, entryPointsOf } from "./resolution";
import { typescriptAdapter } from "./typescript-adapter";

/** A resolver that answers from a table: "<importer> <specifier>" → its files. */
function tableResolver(table: Record<string, string[]>, entries: { path: string; declaredBy: string }[] = []): LanguageResolver {
    return {
        resolve: (importer, specifier) => table[`${importer} ${specifier}`] ?? [],
        kindOf: () => "internal",
        entryPoints: () => entries,
    };
}

describe("edgesOf", () => {
    it("gives one edge per target, in specifier order then resolve's order, named by the first specifier reaching it", () => {
        const resolver = tableResolver({ "a x": ["c", "b"], "a y": ["b", "d"], "a z": [] });
        expect(edgesOf(resolver, "a", ["x", "y", "z"])).toEqual([
            { source: "a", target: "c", specifier: "x" },
            { source: "a", target: "b", specifier: "x" },
            { source: "a", target: "d", specifier: "y" },
        ]);
    });

    it("never makes an edge to the importer itself: [importer] is placed with no edge", () => {
        const resolver = tableResolver({ "a self": ["a"], "a both": ["a", "b"] });
        expect(edgesOf(resolver, "a", ["self"])).toEqual([]);
        expect(edgesOf(resolver, "a", ["both"])).toEqual([{ source: "a", target: "b", specifier: "both" }]);
    });
});

describe("createResolvers and entryPointsOf", () => {
    const base: Omit<ResolveContext, "files"> = { root: "/nowhere", fileSet: new Set(), manifests: [], readText: () => null, cache: new Map() };
    const facts = (declares: string[] = []): StoredFacts => ({ importSpecifiers: [], declares });

    it("hands each adapter only its own files, and skips an adapter with none", () => {
        const seen: Record<string, string[]> = {};
        const spy = (adapter: LanguageAdapter): LanguageAdapter => ({
            ...adapter,
            createResolver(ctx){
                seen[adapter.id] = [...ctx.files.keys()];
                return tableResolver({});
            },
        });
        const other: LanguageAdapter = { ...toyAdapter, id: "other", extensions: [".oth"] };
        const files = new Map([["a.ts", facts()], ["b.toy", facts()], ["c.toy", facts()], ["d.md", facts()]]);
        const resolvers = createResolvers([spy(typescriptAdapter), spy(toyAdapter), spy(other)], base, files);
        expect([...resolvers.keys()]).toEqual(["typescript", "toy"]);
        expect(seen).toEqual({ typescript: ["a.ts"], toy: ["b.toy", "c.toy"] });
    });

    it("keeps one entry per path, the first met, in the resolvers' order, sorted by path", () => {
        const resolvers = new Map<string, LanguageResolver>([
            ["first", tableResolver({}, [{ path: "z", declaredBy: "first z" }, { path: "m", declaredBy: "first m" }, { path: "m", declaredBy: "first m again" }])],
            ["second", tableResolver({}, [{ path: "m", declaredBy: "second m" }, { path: "a", declaredBy: "second a" }])],
        ]);
        expect(entryPointsOf(resolvers)).toEqual([
            { path: "a", declaredBy: "second a" },
            { path: "m", declaredBy: "first m" },
            { path: "z", declaredBy: "first z" },
        ]);
    });
});
