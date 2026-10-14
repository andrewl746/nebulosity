// ================================================================
// Embedding model notes
// ================================================================
//
// FIRST RUN downloads Xenova/all-MiniLM-L6-v2 (~25 MB) from huggingface.co and
// caches it under node_modules/.cache. Expect ~10-20s on a cold run, well under
// a second afterwards. lib/embed.ts logs the download so it doesn't look like a
// hang.
//
// HISTORICAL NOTE (2026-08, resolved 2026-09-04): the embedding model could not
// be downloaded, so this suite could not run at all while it was written —
// which is why "should batch multiple texts" shipped failing and stayed that way
// for weeks. It caught a real bug the moment it could execute: transformers.js
// returns ONE tensor per batch, and the code was pushing the whole flat buffer as
// a single vector, so 20 texts produced 2 "vectors" of 6144 floats.
// See BUGS_ENCOUNTERED.md #7 and ADR-017.
//
// The lesson worth keeping: a test you cannot run is not a passing test, and an
// environment that silently prevents verification is itself a project risk.
// ================================================================

import { describe, it, expect } from "vitest";
import { embedTexts, validateVector, getEmbeddingModelInfo } from "./embed";

describe("embed", () => {
    it("should produce 384-dim normalized vectors", async () => {
        const texts = ["function extractImports(content: string): string[]"];
        const vectors = await embedTexts(texts);

        expect(vectors).toHaveLength(1);
        const vec = vectors[0];
        expect(vec).toBeInstanceOf(Float32Array);
        expect(vec.length).toBe(384);

        const { valid, magnitude } = validateVector(vec);
        expect(valid).toBe(true);
        expect(magnitude).toBeCloseTo(1, 3);
    }, 30000); // timeout (30 seconds)

    it("should batch multiple texts", async () => {
        const texts = Array.from({ length: 20 }, (_, i) => `Test text number ${i}`);
        const vectors = await embedTexts(texts);
        expect(vectors).toHaveLength(20);

        for (const vec of vectors){
            expect(vec.length).toBe(384);
        }
    }, 30000); // timeout (30 seconds)

    it("should return correct model info", () => {
        const info = getEmbeddingModelInfo();
        expect(info.name).toBe("Xenova/all-MiniLM-L6-v2");
        expect(info.dimension).toBe(384);
    });
});
