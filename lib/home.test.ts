import { afterEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { nebulosityHome, nebulosityPath } from "./home";

const original = process.env.NEBULOSITY_HOME;

afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
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
