import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { makeTempDir } from "../test/helpers/temp";
import { readConfig, writeConfig } from "./config";

const original = process.env.NEBULOSITY_HOME;
const originalData = process.env.NEBULOSITY_DATA;

// these tests find config.json through NEBULOSITY_HOME, so a data folder set in the shell mustn't move it elsewhere
beforeEach(() => {
    delete process.env.NEBULOSITY_DATA;
});

afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
    if (originalData === undefined) delete process.env.NEBULOSITY_DATA;
    else process.env.NEBULOSITY_DATA = originalData;
});

describe("config", () => {
    it("reads null when no config file exists yet", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-config-");
        expect(readConfig()).toEqual({ activeRepo: null, port: 3000 });
    });

    it("round-trips the active repo under NEBULOSITY_HOME/.nebulosity/config.json", () => {
        const home = makeTempDir("neb-config-");
        process.env.NEBULOSITY_HOME = home;
        writeConfig({ activeRepo: "C:/Users/me/vscode", port: 3000 });
        expect(readConfig()).toEqual({ activeRepo: "C:/Users/me/vscode", port: 3000 });
        expect(fs.existsSync(path.join(home, ".nebulosity", "config.json"))).toBe(true);
    });

    it("reads a config written before the port existed as the default port", () => {
        const home = makeTempDir("neb-config-");
        process.env.NEBULOSITY_HOME = home;
        fs.mkdirSync(path.join(home, ".nebulosity"));
        fs.writeFileSync(path.join(home, ".nebulosity", "config.json"), JSON.stringify({ activeRepo: "C:/r", port: "nope" }));
        expect(readConfig()).toEqual({ activeRepo: "C:/r", port: 3000 });
    });

    // Review Focus 1: the repo picker and `nebulosity index` rewrite the file with writeConfig({ ...readConfig(), activeRepo })
    it("keeps summaryModels, and a key it doesn't know, through a rewrite of the active repo", () => {
        const home = makeTempDir("neb-config-");
        process.env.NEBULOSITY_HOME = home;
        const summaryModels = { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 }, repo: { model: "claude-sonnet-6" } };
        fs.mkdirSync(path.join(home, ".nebulosity"));
        fs.writeFileSync(path.join(home, ".nebulosity", "config.json"), JSON.stringify({ activeRepo: "C:/r", port: 3000, summaryModels, futureKey: [1, 2] }));

        writeConfig({ ...readConfig(), activeRepo: "/x" });

        const written = JSON.parse(fs.readFileSync(path.join(home, ".nebulosity", "config.json"), "utf8")) as Record<string, unknown>;
        expect(written.summaryModels).toEqual(summaryModels);
        expect(written.futureKey).toEqual([1, 2]);
        expect(written.activeRepo).toBe("/x");
    });

    it("never throws over a summaryModels it can't use: the Map has to start, and the setting is kept as written", () => {
        const home = makeTempDir("neb-config-");
        process.env.NEBULOSITY_HOME = home;
        fs.mkdirSync(path.join(home, ".nebulosity"));
        fs.writeFileSync(path.join(home, ".nebulosity", "config.json"), JSON.stringify({ activeRepo: "C:/r", summaryModels: "claude-haiku-6" }));

        expect(() => readConfig()).not.toThrow();
        expect(readConfig()).toMatchObject({ activeRepo: "C:/r", port: 3000, summaryModels: "claude-haiku-6" });
    });
});
