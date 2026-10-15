import { afterEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { dataDir, nebulosityHome, nebulosityPath, userDataDir } from "./home";

const original = process.env.NEBULOSITY_HOME;
const originalData = process.env.NEBULOSITY_DATA;

afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
    if (originalData === undefined) delete process.env.NEBULOSITY_DATA;
    else process.env.NEBULOSITY_DATA = originalData;
});

describe("nebulosityHome", () => {
    it("uses NEBULOSITY_HOME when it is set", () => {
        process.env.NEBULOSITY_HOME = path.join(os.tmpdir(), "neb-home");
        expect(nebulosityHome()).toBe(path.resolve(os.tmpdir(), "neb-home"));
    });

    it("falls back to the current working directory", () => {
        delete process.env.NEBULOSITY_HOME;
        expect(nebulosityHome()).toBe(path.resolve(process.cwd()));
    });

    it("joins paths under home", () => {
        process.env.NEBULOSITY_HOME = path.join(os.tmpdir(), "neb-home");
        expect(nebulosityPath(".nebulosity", "nebulosity.db"))
            .toBe(path.join(path.resolve(os.tmpdir(), "neb-home"), ".nebulosity", "nebulosity.db"));
    });
});

describe("dataDir", () => {
    it("is NEBULOSITY_DATA when it's set", () => {
        process.env.NEBULOSITY_DATA = path.resolve("/somewhere/data");
        expect(dataDir()).toBe(path.resolve("/somewhere/data"));
    });

    it("is the code root's .nebulosity otherwise, where a checkout always kept it", () => {
        delete process.env.NEBULOSITY_DATA;
        process.env.NEBULOSITY_HOME = path.resolve("/somewhere/code");
        expect(dataDir()).toBe(path.join(path.resolve("/somewhere/code"), ".nebulosity"));
    });
});

describe("userDataDir (Review Focus 5)", () => {
    it("uses LOCALAPPDATA on Windows, a user name with a space included", () => {
        expect(userDataDir("win32", { LOCALAPPDATA: "C:\\Users\\Ann Lee\\AppData\\Local" }, "C:\\Users\\Ann Lee")).toBe("C:\\Users\\Ann Lee\\AppData\\Local\\Nebulosity");
        expect(userDataDir("win32", {}, "C:\\Users\\Ann Lee")).toBe("C:\\Users\\Ann Lee\\AppData\\Local\\Nebulosity");
    });

    it("uses Application Support on macOS and XDG_DATA_HOME (else ~/.local/share) on Linux", () => {
        expect(userDataDir("darwin", {}, "/Users/ann")).toBe("/Users/ann/Library/Application Support/Nebulosity");
        expect(userDataDir("linux", { XDG_DATA_HOME: "/data" }, "/home/ann")).toBe("/data/nebulosity");
        expect(userDataDir("linux", {}, "/home/ann")).toBe("/home/ann/.local/share/nebulosity");
    });
});
