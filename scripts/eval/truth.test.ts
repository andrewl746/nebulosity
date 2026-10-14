import { describe, expect, it } from "vitest";
import { directImporters, hasEdge, outsideImporters, shortestChain, transitiveDependents, type Graph } from "./truth";

const G: Graph = {
    files: ["a.ts", "b.ts", "c.ts", "d.ts", "dir/e.ts", "dir/f.ts"],
    edges: [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"], ["a.ts", "dir/e.ts"], ["dir/e.ts", "dir/f.ts"], ["dir/f.ts", "c.ts"]],
};

describe("truths over a scanned graph", () => {
    it("lists direct importers, importers from outside a folder, and everything depending on a file", () => {
        expect(directImporters(G, "c.ts")).toEqual(["b.ts", "dir/f.ts"]);
        expect(outsideImporters(G, "dir")).toEqual(["a.ts"]);
        expect(transitiveDependents(G, "d.ts")).toEqual(["a.ts", "b.ts", "c.ts", "dir/e.ts", "dir/f.ts"]);
    });

    it("finds the shortest chain, neighbours in path order, or none", () => {
        expect(shortestChain(G, "a.ts", "d.ts")).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
        expect(shortestChain(G, "d.ts", "a.ts")).toBeNull();
        expect(hasEdge(G, "dir/f.ts", "c.ts")).toBe(true);
        expect(hasEdge(G, "a.ts", "c.ts")).toBe(false);
    });
});
