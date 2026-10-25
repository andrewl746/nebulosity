import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { makeTempDir } from "../test/helpers/temp";
import { movedAsideConfigs, readConfig, readConfigFile, writeConfig } from "./config";

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

// The pre-ship pass's final review, A-I2 (ruling R25): the README has people edit this file by hand, and the likely ways
// a hand edit breaks it are a trailing comma, a UTF-8 byte-order mark and UTF-16 (Windows PowerShell 5.1, Notepad).
describe("config files a hand edit leaves", () => {
    const setting = { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } };
    const settings = { activeRepo: "C:/repos/app", port: 4000, summaryModels: setting };
    const text = JSON.stringify(settings, null, 2);
    const DEFAULTS = { activeRepo: null, port: 3000 };

    /** A home of its own, with its data folder made and no config.json in it yet. */
    function configFile(): string {
        const home = makeTempDir("neb-config-");
        process.env.NEBULOSITY_HOME = home;
        fs.mkdirSync(path.join(home, ".nebulosity"));
        return path.join(home, ".nebulosity", "config.json");
    }

    it("reads through a leading UTF-8 byte-order mark (5.1's Set-Content -Encoding utf8, Notepad's UTF-8 with BOM)", () => {
        const file = configFile();
        fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]));
        expect(readConfigFile()).toEqual({ config: settings, problem: null });
    });

    it("reads UTF-16 when its byte-order mark leads: little-endian (5.1's >) and big-endian", () => {
        const file = configFile();
        const littleEndian = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
        fs.writeFileSync(file, littleEndian);
        expect(readConfig()).toEqual(settings);
        fs.writeFileSync(file, Buffer.from(littleEndian).swap16());   // FE FF, then each character high byte first
        expect(readConfig()).toEqual(settings);
    });

    it("tells a file that isn't one JSON object from a missing one: the defaults either way, and for the first, what's wrong", () => {
        const file = configFile();
        expect(readConfigFile()).toEqual({ config: DEFAULTS, problem: null });   // missing: nothing chosen yet

        fs.writeFileSync(file, '{\n  "port": 4000,\n}\n');   // a trailing comma
        const typo = readConfigFile();
        expect(typo.config).toEqual(DEFAULTS);
        expect(typo.problem?.startsWith(`${file} isn't valid JSON (`)).toBe(true);
        expect(typo.problem?.endsWith(")")).toBe(true);

        fs.writeFileSync(file, "[1, 2]");
        expect(readConfigFile()).toEqual({ config: DEFAULTS, problem: `${file} holds an array, not one JSON object of settings` });
        fs.writeFileSync(file, "null");
        expect(readConfigFile().problem).toBe(`${file} holds null, not one JSON object of settings`);
        fs.writeFileSync(file, '"claude-haiku-6"');
        expect(readConfigFile().problem).toBe(`${file} holds a string, not one JSON object of settings`);

        // nothing but whitespace: nothing set, and nothing a rewrite could lose
        fs.writeFileSync(file, " \r\n");
        expect(readConfigFile()).toEqual({ config: DEFAULTS, problem: null });

        // there, but not a file that reads
        fs.rmSync(file);
        fs.mkdirSync(file);
        expect(readConfigFile().problem?.startsWith(`${file} couldn't be read (`)).toBe(true);
    });

    it("never writes over a file it couldn't read: it's moved aside with its bytes, and the move is said", () => {
        const file = configFile();
        const handEdit = '{\n  "activeRepo": "C:/repos/app",\n  "port": 4000,\n  "summaryModels": { "file": { "model": "claude-haiku-6" } },\n}\n';
        fs.writeFileSync(file, handEdit);
        const said: string[] = [];

        // what nebulosity index and the Map's repo picker do
        const aside = writeConfig({ ...readConfig(), activeRepo: "C:/repos/other" }, (message) => said.push(message));
        expect(typeof aside).toBe("string");
        expect(path.dirname(aside!)).toBe(path.dirname(file));
        expect(path.basename(aside!)).toMatch(/^config\.json\.invalid-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
        expect(fs.readFileSync(aside!, "utf8")).toBe(handEdit);
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ activeRepo: "C:/repos/other", port: 3000 });
        expect(said).toHaveLength(1);
        expect(said[0].startsWith(`[nebulosity] ${file} isn't valid JSON (`)).toBe(true);
        expect(said[0].endsWith(`), so it was moved aside to ${aside} before the settings were written again; copy what you need from it into ${file}, then delete it`)).toBe(true);
        expect(movedAsideConfigs()).toEqual([aside]);

        // the new file reads, so the next rewrite moves nothing
        expect(writeConfig({ ...readConfig(), port: 4001 }, (message) => said.push(message))).toBeNull();
        expect(said).toHaveLength(1);
        expect(movedAsideConfigs()).toEqual([aside]);
    });

    it("writes over a file with nothing in it without moving it aside", () => {
        const file = configFile();
        fs.writeFileSync(file, "\n");
        expect(writeConfig({ activeRepo: "/x", port: 3000 }, () => {})).toBeNull();
        expect(movedAsideConfigs()).toEqual([]);
        expect(readConfig()).toEqual({ activeRepo: "/x", port: 3000 });
    });
});
