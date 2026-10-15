import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadDefinition } from "./definition";

const write = (json: unknown): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-def-"));
    fs.writeFileSync(path.join(dir, "eval.json"), JSON.stringify(json));
    return dir;
};
const good = {
    name: "Eval #2", claudeVersion: "2.1.300",
    pins: { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 80, maxBudgetUsd: 4, sessionMaxBudgetUsd: 10 },
    repos: { vscode: { path: "../vscode", commit: "cc3fec8846d0e678357e476fa611774da26d7e24", slug: "microsoft/vscode" } },
    arms: ["baseline", "nebulosity"], repeats: 3, scripts: true, pilot: ["vscode-cn1"],
};

describe("loadDefinition", () => {
    it("reads a whole definition", () => {
        expect(loadDefinition(write(good))).toEqual({ ...good, dir: expect.any(String) });
    });

    it("reads the pilot's sessions when it lists them, and refuses a list that isn't of ids", () => {
        expect(loadDefinition(write({ ...good, pilotSessions: ["vscode-s1"] })).pilotSessions).toEqual(["vscode-s1"]);
        expect(loadDefinition(write(good)).pilotSessions).toBeUndefined();
        expect(() => loadDefinition(write({ ...good, pilotSessions: "vscode-s1" }))).toThrow("eval.json: pilotSessions, when given, lists session ids.");
        expect(() => loadDefinition(write({ ...good, pilotSessions: [1] }))).toThrow("eval.json: pilotSessions, when given, lists session ids.");
    });

    it("refuses an unknown arm, a repeat count outside 1–3, and a commit that isn't a full sha, each in a sentence", () => {
        expect(() => loadDefinition(write({ ...good, arms: ["baseline", "other"] }))).toThrow('eval.json: arms may be "baseline", "nebulosity" and "nebulosity-upfront", not "other".');
        expect(() => loadDefinition(write({ ...good, repeats: 4 }))).toThrow("eval.json: repeats is 1, 2 or 3.");
        expect(() => loadDefinition(write({ ...good, repos: { vscode: { ...good.repos.vscode, commit: "cc3fec88" } } }))).toThrow("eval.json: repo vscode's commit must be a full 40-character sha.");
    });
});
