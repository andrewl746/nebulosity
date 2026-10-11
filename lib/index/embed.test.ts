import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { loadSummaries, writeResults } from "../db/store/summaries";
import { loadSummaryVectors } from "../db/store/summary-vectors";
import { readIndexStatus } from "../engine/status";
import { embedSummaries, summaryEmbeddingText, type EmbedFn } from "./embed";
import { repoKey } from "./paths";
import { indexRepository } from "./pipeline";
import { runSummaries } from "./summarize/run";

const fakeEmbed: EmbedFn = async (texts) => texts.map(() => Float32Array.from([1, 0, 0]));

async function summarizedFixture(): Promise<string> {
    const root = copyFixture();
    indexRepository(root);
    await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
    return root;
}

describe("embedSummaries", () => {
    it("embeds every model-written summary once, skips templates, and marks the stage ready", async () => {
        const root = await summarizedFixture();
        const repoId = requireRepository(getDb(), repoKey(root));

        expect(await embedSummaries(root, { embed: fakeEmbed })).toEqual({ embedded: 13, total: 13 });
        expect(await embedSummaries(root, { embed: fakeEmbed })).toEqual({ embedded: 0, total: 13 });
        expect(loadSummaryVectors(getDb(), repoId)).toHaveLength(12);   // the repo's own vector is left out of search
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "ready", done: 13, total: 13 });
    });

    it("re-embeds a rewritten summary, and only that one", async () => {
        const root = await summarizedFixture();
        await embedSummaries(root, { embed: fakeEmbed });
        const db = getDb();
        const log = loadSummaries(db, requireRepository(db, repoKey(root))).find((s) => s.path === "src/core/log.ts")!;
        writeResults(db, [{ id: log.id, batchId: null, inputHash: "new", outcome: { ok: true, text: { tagline: "New", summary: "S" }, model: "m" } }]);

        expect(await embedSummaries(root, { embed: fakeEmbed })).toEqual({ embedded: 1, total: 13 });
    });

    it("embeds what a summary says, then where it lives", () => {
        expect(summaryEmbeddingText({ path: "src/core/log.ts", tagline: "Logging", summary: "Writes lines." })).toBe("Logging\nWrites lines.\nsrc/core/log.ts");
    });

    it("marks the stage failed when the model can't load, and says why", async () => {
        const root = await summarizedFixture();
        const broken: EmbedFn = async () => { throw new Error("model unavailable"); };

        await expect(embedSummaries(root, { embed: broken })).rejects.toThrow("model unavailable");
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "failed", done: 0, total: 13, note: "model unavailable" });
    });
});
