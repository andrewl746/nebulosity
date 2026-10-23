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

    it("reads a shell preset when it names one, and refuses any other value (ADR-057, amended 2026-10-15)", () => {
        expect(loadDefinition(write({ ...good, shell: "compound" })).shell).toBe("compound");
        expect(loadDefinition(write(good)).shell).toBeUndefined();
        expect(() => loadDefinition(write({ ...good, shell: "everything" }))).toThrow('eval.json: shell, when given, is one of "compound".');
        expect(() => loadDefinition(write({ ...good, shell: ["Bash(cd:*)"] }))).toThrow('eval.json: shell, when given, is one of "compound".');
    });

    it("leaves the shell preset unset in Eval #1's and Eval #2's own definitions", () => {
        const checkout = path.join(__dirname, "..", "..");
        expect(loadDefinition(path.join(checkout, "eval")).shell).toBeUndefined();
        expect(loadDefinition(path.join(checkout, "eval2")).shell).toBeUndefined();
    });

    it("reads Eval #3's sentence, gate and a repo's project, and refuses other values in a sentence", () => {
        const def = loadDefinition(write({ ...good, sentence: "rules", gate: "eval3", repos: { vscode: { ...good.repos.vscode, project: "src/tsconfig.json" } } }));
        expect([def.sentence, def.gate, def.repos.vscode.project]).toEqual(["rules", "eval3", "src/tsconfig.json"]);
        expect(() => loadDefinition(write({ ...good, sentence: "loud" }))).toThrow('eval.json: sentence, when given, is "scripts" or "rules".');
        expect(() => loadDefinition(write({ ...good, gate: "d2" }))).toThrow('eval.json: gate, when given, is "eval3".');
        expect(() => loadDefinition(write({ ...good, repos: { vscode: { ...good.repos.vscode, project: 3 } } }))).toThrow("eval.json: repo vscode's project, when given, is a tsconfig's path inside it.");
    });

    it("leaves Eval #1's and Eval #2's definitions without a sentence or a gate, and gives Eval #3 both", () => {
        expect([loadDefinition("eval").sentence, loadDefinition("eval2").sentence, loadDefinition("eval2").gate]).toEqual([undefined, undefined, undefined]);
        expect([loadDefinition("eval3").sentence, loadDefinition("eval3").gate]).toEqual(["rules", "eval3"]);
    });

    it("refuses an unknown arm, a repeat count outside 1–3, and a commit that isn't a full sha, each in a sentence", () => {
        expect(() => loadDefinition(write({ ...good, arms: ["baseline", "other"] }))).toThrow('eval.json: arms may be "baseline", "nebulosity" and "nebulosity-upfront", not "other".');
        expect(() => loadDefinition(write({ ...good, repeats: 4 }))).toThrow("eval.json: repeats is 1, 2 or 3.");
        expect(() => loadDefinition(write({ ...good, repos: { vscode: { ...good.repos.vscode, commit: "cc3fec88" } } }))).toThrow("eval.json: repo vscode's commit must be a full 40-character sha.");
    });
});
