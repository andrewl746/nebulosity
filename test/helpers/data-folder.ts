import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach } from "vitest";

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
