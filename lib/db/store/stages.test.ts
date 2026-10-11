import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../client";
import { readStages, writeStage } from "./stages";
import { upsertRepository } from "./structure";

describe("stage status store", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("reads back what was written, per repo and stage, with when it was written", () => {
        vi.useFakeTimers();
        const db = getDb();
        const a = upsertRepository(db, "/stages/a");
        const b = upsertRepository(db, "/stages/b");

        const t0 = new Date("2026-10-11T12:00:00Z");   // whole seconds, which is the precision the database keeps
        vi.setSystemTime(t0);
        writeStage(db, a, "structure", { state: "running", done: 3, total: 8 });
        expect(readStages(db, a).structure?.updatedAt).toEqual(t0);

        // Ten minutes on, the same status is written again. The timestamp has to move with it: that
        // rewrite is the heartbeat that tells readers the run is alive (ADR-032).
        const t1 = new Date(t0.getTime() + 10 * 60 * 1000);
        vi.setSystemTime(t1);
        writeStage(db, a, "structure", { state: "running", done: 3, total: 8 });
        expect(readStages(db, a).structure?.updatedAt).toEqual(t1);

        writeStage(db, a, "structure", { state: "ready", done: 8, total: 8 });
        writeStage(db, b, "summaries", { state: "off", done: 0, total: 14, note: "no key" });

        const stagesA = readStages(db, a);
        expect(stagesA.structure).toMatchObject({ state: "ready", done: 8, total: 8 });
        expect(stagesA.summaries).toBeUndefined();
        expect(readStages(db, b)).toEqual({ summaries: expect.objectContaining({ state: "off", note: "no key" }) });
    });
});
