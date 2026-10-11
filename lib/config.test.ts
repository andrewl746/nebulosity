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
        expect(readConfig()).toEqual({ activeRepo: null });
    });

    it("round-trips the active repo under NEBULOSITY_HOME/.nebulosity/config.json", () => {
        const home = makeTempDir("neb-config-");
        process.env.NEBULOSITY_HOME = home;
        writeConfig({ activeRepo: "C:/Users/me/vscode" });
        expect(readConfig()).toEqual({ activeRepo: "C:/Users/me/vscode" });
        expect(fs.existsSync(path.join(home, ".nebulosity", "config.json"))).toBe(true);
    });
});
