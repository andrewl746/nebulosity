import { describe, expect, it } from "vitest";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { writeStage } from "../db/store/stages";
import { loadSummaries, writeResults } from "../db/store/summaries";
import { readIndexVersion } from "../db/store/version";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { readIndexStatus } from "./status";

const fakeEmbed: EmbedFn = async (texts) => texts.map(() => Float32Array.from([1, 0, 0]));

describe("readIndexStatus", () => {
    it("is null for a repo that was never indexed", () => {
        expect(readIndexStatus(path.join(makeTempDir("neb-status-"), "nowhere"))).toBeNull();
    });

    it("after indexing: structure ready with every file counted, the later stages idle", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(readIndexStatus(root)?.stages).toEqual({
            structure: { state: "ready", done: 8, total: 8 },
            summaries: { state: "idle", done: 0, total: 0 },
            embeddings: { state: "idle", done: 0, total: 0 },
        });
    });

    it("reports a running stage that stopped writing as failed, saying since when", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        writeStage(getDb(), repoId, "summaries", { state: "running", done: 2, total: 14 });

        const fourMinutesLater = new Date(Date.now() + 4 * 60 * 1000);
        const sixMinutesLater = new Date(Date.now() + 6 * 60 * 1000);
        const later = readIndexStatus(root, sixMinutesLater)?.stages.summaries;
        expect(later).toMatchObject({ state: "failed", done: 2, total: 14 });
        expect(later?.note).toMatch(/^interrupted: no progress since \d{4}-/);
        expect(readIndexStatus(root)?.stages.summaries.state).toBe("running");   // right now it's still fine
        expect(readIndexStatus(root, fourMinutesLater)?.stages.summaries.state).toBe("running");   // and so is 4 minutes on: the limit is 5

        // only a "running" row can be interrupted: the finished structure stage just gets old
        expect(readIndexStatus(root, sixMinutesLater)?.stages.structure).toEqual({ state: "ready", done: 8, total: 8 });
    });

    it("counts embeddings live, so a rewritten summary's missing vector shows at once, and reports the index version", async () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "idle", done: 0, total: 13, note: "13 summaries without a vector yet" });

        await embedSummaries(root, { embed: fakeEmbed });
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "ready", done: 13, total: 13 });

        const db = getDb();
        const log = loadSummaries(db, repoId).find((s) => s.path === "src/core/log.ts")!;
        writeResults(db, [{ id: log.id, batchId: null, inputHash: "new", outcome: { ok: true, text: { tagline: "New", summary: "S." }, model: "m" } }]);
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "idle", done: 12, total: 13, note: "1 summary without a vector yet" });
        expect(readIndexStatus(root)?.indexVersion).toBe(readIndexVersion(db, repoId));
    });
});
