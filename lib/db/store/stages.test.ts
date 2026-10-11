import { describe, expect, it } from "vitest";
import { getDb } from "../client";
import { readStages, writeStage } from "./stages";
import { upsertRepository } from "./structure";

describe("stage status store", () => {
    it("reads back what was written, per repo and stage, with when it was written", () => {
        const db = getDb();
        const a = upsertRepository(db, "/stages/a");
        const b = upsertRepository(db, "/stages/b");
        writeStage(db, a, "structure", { state: "running", done: 3, total: 8 });
        writeStage(db, a, "structure", { state: "ready", done: 8, total: 8 });
        writeStage(db, b, "summaries", { state: "off", done: 0, total: 14, note: "no key" });

        const stagesA = readStages(db, a);
        expect(stagesA.structure).toMatchObject({ state: "ready", done: 8, total: 8 });
        expect(stagesA.structure?.updatedAt).toBeInstanceOf(Date);
        expect(stagesA.summaries).toBeUndefined();
        expect(readStages(db, b)).toEqual({ summaries: expect.objectContaining({ state: "off", note: "no key" }) });
    });
});
