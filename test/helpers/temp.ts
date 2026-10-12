import fs from "fs";
import os from "os";
import path from "path";
import { onTestFinished } from "vitest";

/**
 * A fresh folder under the OS temp directory, deleted again when the calling test
 * finishes, pass or fail. Call it from inside a test (`it`), not from a describe body.
 */
export function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
