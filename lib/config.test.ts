import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { makeTempDir } from "../test/helpers/temp";
import { readConfig, writeConfig } from "./config";

const original = process.env.NEBULOSITY_HOME;

afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
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
});
