import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test/helpers/temp";
import { toyAdapter } from "../test/helpers/toy-adapter";
import { toyRepoTruth } from "../test/helpers/toy-repo-truth";
import { getDb } from "../lib/db/client";
import { typescriptAdapter } from "../lib/index/languages/typescript-adapter";
import { indexRepository } from "../lib/index/pipeline";
import { mulberry32 } from "./eval/stats";
import { sampleEdges } from "./sample-edges";

/**
 * The draw as written down (scripts/sample-edges.ts): the list sorted, then a Fisher–Yates shuffle from its last place
 * down, each swap partner j = floor(random() * (i + 1)) from mulberry32(seed), the first n kept. Written here from that
 * description, and applied to the toy repo's hand-derived truth, so the expectation never comes from the code it checks.
 */
function drawn<T>(sorted: readonly T[], seed: number, n: number): T[] {
    const pool = [...sorted];
    const random = mulberry32(seed);
    for (let i = pool.length - 1; i > 0; i--){
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

describe("npm run sample-edges", () => {
    const adapters = [typescriptAdapter, toyAdapter];
    function indexedToyRepo(): { root: string; repoId: number } {
        const root = makeTempDir("neb-sample-toy-");
        fs.cpSync(path.resolve("test/fixtures/toy-repo"), root, { recursive: true });
        return { root, repoId: indexRepository(root, { adapters }).repoId };
    }

    it("draws the toy repo's edges in seed 1's order, and its unresolved internal references after them", () => {
        const { root, repoId } = indexedToyRepo();
        const sample = sampleEdges(getDb(), root, repoId, { language: "toy", count: 30, seed: 1, unresolved: 20, adapters });
        expect(sample.edgesTotal).toBe(10);
        expect(sample.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual(drawn(toyRepoTruth.edges, 1, 30));
        // the three references the truth's rules can't place, sorted by file then specifier, then drawn the same way
        const misses = [
            { importer: "app/broken.toy", specifier: "use:missing/thing" },
            { importer: "tests/check.toy", specifier: "name:nothing" },
            { importer: "tests/check.toy", specifier: "use:deps/vendored" },
        ];
        expect(sample.unresolvedTotal).toBe(3);
        expect(sample.unresolved).toEqual(drawn(misses, 1, 20));
    });

    it("keeps the count asked for, and another seed draws another order of the same edges", () => {
        const { root, repoId } = indexedToyRepo();
        const four = sampleEdges(getDb(), root, repoId, { language: "toy", count: 4, seed: 1, unresolved: 1, adapters });
        expect(four.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual(drawn(toyRepoTruth.edges, 1, 4));
        expect(four.unresolved).toHaveLength(1);
        const other = sampleEdges(getDb(), root, repoId, { language: "toy", count: 30, seed: 2, unresolved: 20, adapters });
        expect(other.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual(drawn(toyRepoTruth.edges, 2, 30));
        expect(sampleEdges(getDb(), root, repoId, { language: "typescript", count: 30, seed: 1, unresolved: 20, adapters }))
            .toEqual({ edges: [], edgesTotal: 0, unresolved: [], unresolvedTotal: 0 });
    });

    it("names each edge by its stored specifier", () => {
        const { root, repoId } = indexedToyRepo();
        const sample = sampleEdges(getDb(), root, repoId, { language: "toy", count: 30, seed: 1, unresolved: 0, adapters });
        // the first specifier reaching each target (edgesOf): app/main.toy's edge to lib/strings.toy comes from use:strings
        expect(sample.edges.find((e) => e.source === "app/main.toy" && e.target === "lib/strings.toy")?.specifier).toBe("use:strings");
        expect(sample.edges.find((e) => e.source === "lib/strings_test.toy")?.specifier).toBe("use:strings");
        expect(sample.edges.find((e) => e.source === "app/greet.toy" && e.target === "app/banner.toy")?.specifier).toBe("name:banner");
    });
});
