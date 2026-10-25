import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach } from "vitest";

/** The prefix of every test file's own data folder, under the system temp folder (giveFileItsOwnDataFolder). */
export const FILE_DATA_PREFIX = "neb-test-data-";

/**
 * Gives the test file that's starting a data folder of its own (NEBULOSITY_DATA), before its first line runs, and puts
 * the outer value back when the file ends (ruling R26). test/setup.ts calls it for every file, through vitest.config.ts's
 * setupFiles. dataPath() prefers NEBULOSITY_DATA to NEBULOSITY_HOME (lib/home.ts), so without it a test that moves
 * NEBULOSITY_HOME and writes config.json would write to whatever folder the shell exported instead, as agents export it
 * for benchmarks: the developer's own setting, active repo and port, overwritten by a suite that passes. A test that
 * needs the variable unset deletes it itself (config.test.ts), and isolateDataFolder() gives each test a folder of its own.
 */
export function giveFileItsOwnDataFolder(): void {
    const outer = process.env.NEBULOSITY_DATA;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), FILE_DATA_PREFIX));
    process.env.NEBULOSITY_DATA = folder;

    afterAll(() => {
        if (outer === undefined) delete process.env.NEBULOSITY_DATA;
        else process.env.NEBULOSITY_DATA = outer;
        fs.rmSync(folder, { recursive: true, force: true });
    });
}

/**
 * Gives each test of the calling file a data folder of its own (NEBULOSITY_DATA), restored afterwards. Code that reads
 * config.json, such as the summary models setting (ADR-066), then sees only what the test writes there, never the
 * developer's own `.nebulosity/config.json`. Call it at the top level of a test file; it returns the current folder.
 */
export function isolateDataFolder(): () => string {
    const saved = process.env.NEBULOSITY_DATA;
    let folder = "";

    beforeEach(() => {
        folder = fs.mkdtempSync(path.join(os.tmpdir(), "neb-data-"));
        process.env.NEBULOSITY_DATA = folder;
    });

    afterEach(() => {
        if (saved === undefined) delete process.env.NEBULOSITY_DATA;
        else process.env.NEBULOSITY_DATA = saved;
        fs.rmSync(folder, { recursive: true, force: true });
    });

    return () => folder;
}
