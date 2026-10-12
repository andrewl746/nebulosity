import { describe, expect, it } from "vitest";
import fs from "fs";
import { makeTempDir } from "./temp";

describe("makeTempDir", () => {
    let made = "";

    it("creates an empty folder whose name starts with the prefix", () => {
        made = makeTempDir("neb-temp-");
        expect(fs.readdirSync(made)).toEqual([]);
        expect(made).toMatch(/neb-temp-[^\\/]+$/);
    });

    it("deletes it once the test that made it has finished", () => {
        expect(made).not.toBe("");
        expect(fs.existsSync(made)).toBe(false);
    });
});
