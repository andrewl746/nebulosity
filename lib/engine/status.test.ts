import { describe, expect, it } from "vitest";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { writeStage } from "../db/store/stages";
import { indexRepository } from "../index/pipeline";
import { readIndexStatus } from "./status";

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

        const sixMinutesLater = new Date(Date.now() + 6 * 60 * 1000);
        const later = readIndexStatus(root, sixMinutesLater)?.stages.summaries;
        expect(later).toMatchObject({ state: "failed", done: 2, total: 14 });
        expect(later?.note).toMatch(/^interrupted: no progress since \d{4}-/);
        expect(readIndexStatus(root)?.stages.summaries.state).toBe("running");   // right now it's still fine
    });
});
