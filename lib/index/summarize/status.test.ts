import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { getDb } from "../../db/client";
import { acquireSummaryLock, releaseSummaryLock } from "../../db/store/lock";
import { readStages, writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import { loadSummaries } from "../../db/store/summaries";
import { repoKey } from "../paths";
import { indexRepository } from "../pipeline";
import { resolveSummaryModels } from "./models";
import type { PlannedTarget, TargetState } from "./plan";
import { runSummaries } from "./run";
import { refreshSummaryStatus, summaryStageStatus } from "./status";

let made = 0;
const target = (state: TargetState, kind: PlannedTarget["kind"] = "file"): PlannedTarget =>
    ({ kind, path: `t${made++}`, model: "m", inputHash: "h", state, status: null });

/** The fixture, fully summarized by the stub (every target current), then log.ts edited and re-indexed. */
async function editedAfterSummaries(): Promise<string> {
    const root = copyFixture();
    indexRepository(root);
    await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
    fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
    indexRepository(root);
    return root;
}

describe("summaryStageStatus", () => {
    it("reads a plan as ready, idle, off, running or stopped", () => {
        const done = [target("current"), target("template")];
        expect(summaryStageStatus([...done, target("lazy", "folder")], { summarizerAvailable: true, inFlight: 0, failed: 2 }))
            .toEqual({ state: "ready", done: 2, total: 3, note: "2 failed this run (retried next run); 1 out of date (redone when opened)" });
        expect(summaryStageStatus([...done, target("ready")], { summarizerAvailable: true, inFlight: 0 }))
            .toEqual({ state: "idle", done: 2, total: 3, note: "1 waiting to be summarized" });
        expect(summaryStageStatus([...done, target("ready"), target("waiting", "folder")], { summarizerAvailable: false, inFlight: 0 }))
            .toEqual({ state: "off", done: 2, total: 4, note: "ANTHROPIC_API_KEY is not set, so 2 of 4 summaries can't be written" });
        expect(summaryStageStatus([...done, target("in-flight")], { summarizerAvailable: true, inFlight: 1 }))
            .toEqual({ state: "running", done: 2, total: 3, note: "1 request at Anthropic in batches; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them" });
        expect(summaryStageStatus(done, { summarizerAvailable: true, inFlight: 3, stopped: "stopped: over budget" }))
            .toEqual({ state: "running", done: 2, total: 2, note: "stopped: over budget; 3 requests still at Anthropic; run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>) to collect them" });
        expect(summaryStageStatus(done, { summarizerAvailable: true, inFlight: 0, stopped: "stopped: over budget" }))
            .toEqual({ state: "failed", done: 2, total: 2, note: "stopped: over budget" });
    });
});

describe("refreshSummaryStatus", () => {
    it("catches the stage up after an edit: the stored row still says ready 14/14 until the refresh says 1 waits", async () => {
        const root = await editedAfterSummaries();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));

        // the bug: nothing re-derived the stage after the structure changed underneath it
        expect(readStages(db, repoId).summaries).toMatchObject({ state: "ready", done: 14, total: 14 });

        // log.ts waits for a model; src/core is out of date at once (lazy, so not done), because its prompt lists
        // log.ts's line count, which the edit changed. The other 12 are current.
        expect(refreshSummaryStatus(root, { summarizerAvailable: true })).toEqual({ state: "idle", done: 12, total: 14, note: "1 waiting to be summarized" });
        expect(readStages(db, repoId).summaries).toMatchObject({ state: "idle", done: 12, total: 14 });
        expect(loadSummaries(db, repoId).find((s) => s.path === "src/core/log.ts")?.status).toBe("stale");
    });

    it("without a key writes the test template and says how many summaries can't be written", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(refreshSummaryStatus(root, { summarizerAvailable: false }))
            .toEqual({ state: "off", done: 1, total: 14, note: "ANTHROPIC_API_KEY is not set, so 13 of 14 summaries can't be written" });
        const db = getDb();
        expect(loadSummaries(db, requireRepository(db, repoKey(root))).find((s) => s.path === "src/util/strings.test.ts"))
            .toMatchObject({ status: "skipped", tagline: "Tests for strings" });
    });

    // the pre-ship pass's final review, m3: a repo indexed for the first time had no stage, so the tools said "not
    // written yet" and the panel "Summarizing…" where free mode's line belongs
    it("without a key and with a setting it can't use, reads as free mode as with no setting, and writes no row", () => {
        const broken = resolveSummaryModels({ file: { model: "claude-zeta-1" } }, "C:/data/config.json");
        expect(broken.ok).toBe(false);
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        const db = getDb();

        // the same stage as with no setting (the test above): 13 of mini-repo's 14 targets need a model, and none can have one
        const freeMode = { state: "off", done: 1, total: 14, note: "ANTHROPIC_API_KEY is not set, so 13 of 14 summaries can't be written" };
        expect(refreshSummaryStatus(root, { summarizerAvailable: false, models: broken })).toEqual(freeMode);
        expect(readStages(db, repoId).summaries).toMatchObject(freeMode);
        // ADR-066's rule holds: nothing is planned into the rows (the test template included) until the setting is fixed
        expect(loadSummaries(db, repoId)).toEqual([]);

        // with a key, the stage is left as it was, as before
        writeStage(db, repoId, "summaries", { state: "idle", done: 0, total: 0 });
        expect(refreshSummaryStatus(root, { summarizerAvailable: true, models: broken })).toBeNull();
        expect(readStages(db, repoId).summaries).toMatchObject({ state: "idle", done: 0, total: 0 });
    });

    it("leaves the stage row to a summary run that holds the lock, but still updates the summary rows", async () => {
        const root = await editedAfterSummaries();
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        acquireSummaryLock(db);
        try{
            writeStage(db, repoId, "summaries", { state: "running", done: 3, total: 14, note: "wave 1" });
            expect(refreshSummaryStatus(root, { summarizerAvailable: true })).toBeNull();
            expect(readStages(db, repoId).summaries).toMatchObject({ state: "running", done: 3, total: 14, note: "wave 1" });
            expect(loadSummaries(db, repoId).find((s) => s.path === "src/core/log.ts")?.status).toBe("stale");
        } finally{
            releaseSummaryLock(db);
        }
    });

    it("keeps a failed run's note while its targets still wait", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        writeStage(getDb(), repoId, "summaries", { state: "failed", done: 0, total: 14, note: "stopped: 10 of 13 requests failed in the last wave" });
        expect(refreshSummaryStatus(root, { summarizerAvailable: true }))
            .toEqual({ state: "failed", done: 1, total: 14, note: "stopped: 10 of 13 requests failed in the last wave" });
    });
});
