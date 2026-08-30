// ================================================================
// 🚨 IMPORTANT: Embedding Model Setup (Read Before Running Tests)
// ================================================================
// 
// WHAT HAPPENED:
// - In China, the Hugging Face model download is blocked/firewalled.
// - The model cannot be downloaded directly from huggingface.co.
// - Manual download to cache didn't work because the library expected
//   a specific hash-named subfolder inside snapshots/, not "main/".
// - Network is fine in Canada, so the test should work there.
//
// WHAT CLAUDE CODE NEEDS TO DO:
// 1. In Canada, run: npx vitest run lib/embed.test.ts
//    → Model will download automatically from huggingface.co
//    → Should pass all tests (expect ~10-20s first run)
//
// 2. If it passes, re-index to generate embeddings:
//    curl.exe -N -X POST localhost:3000/api/index
//    → Should show "event: progress" with "phase":"embedding"
//    → Done event should have no "fetch failed" errors
// ================================================================

import { describe, it, expect } from "vitest";
import { embedTexts, validateVector, getEmbeddingModelInfo, buildEmbeddingText } from "./embed";
import type { CodeChunk } from "./contracts";

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

    it("should build embedding text with doc comments", () => {
        const chunk: CodeChunk = {
            id: 'test#foo#0',
            filePath: 'lib/test.ts',
            kind: 'function',
            name: 'foo',
            startLine: 1,
            endLine: 10,
            exported: true,
            partIndex: 0,
            text: '/** This function does something */\nfunction foo() { return "bar"; }',
            fileHash: 'abc123'
        };
        
        const text = buildEmbeddingText(chunk);
        expect(text).toContain('lib/test.ts');
        expect(text).toContain('function: foo');
        expect(text).toContain('This function does something');
    });

    it("should return correct model info", () => {
        const info = getEmbeddingModelInfo();
        expect(info.name).toBe("Xenova/all-MiniLM-L6-v2");
        expect(info.dimension).toBe(384);
    });
});
