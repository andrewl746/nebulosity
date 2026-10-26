import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeConfig } from "../../lib/config";
import { FILE_DATA_PREFIX } from "./data-folder";
import { makeTempDir } from "./temp";

// what test/setup.ts left before this file's first line ran
const atLoad = process.env.NEBULOSITY_DATA;

const originalHome = process.env.NEBULOSITY_HOME;
afterEach(() => {
    if (originalHome === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = originalHome;
});

// The pre-ship pass's final review, A-I3: three files moved NEBULOSITY_HOME and wrote config.json, which went to an
// exported NEBULOSITY_DATA instead, the developer's own folder, while the suite passed.
describe("every test file's own data folder (ruling R26)", () => {
    it("is set before the file's first line runs: an empty folder of its own under the system temp folder", () => {
        expect(atLoad).toBeDefined();
        expect(path.dirname(atLoad!)).toBe(path.resolve(os.tmpdir()));
        expect(path.basename(atLoad!).startsWith(FILE_DATA_PREFIX)).toBe(true);
        expect(fs.readdirSync(atLoad!)).toEqual([]);
    });

    it("takes the config a test writes after moving NEBULOSITY_HOME, so a folder exported in the shell is never written", () => {
        const home = makeTempDir("neb-home-");
        process.env.NEBULOSITY_HOME = home;
        writeConfig({ activeRepo: "/repos/x", port: 4123 });
        expect(JSON.parse(fs.readFileSync(path.join(atLoad!, "config.json"), "utf8"))).toEqual({ activeRepo: "/repos/x", port: 4123 });
        expect(fs.existsSync(path.join(home, ".nebulosity"))).toBe(false);
    });
});
