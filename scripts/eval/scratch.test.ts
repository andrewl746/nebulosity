import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveScratch } from "./scratch";

// Every expectation is derived by hand from the folders each test writes (sizes in bytes, names in sorted order).
const made: string[] = [];
const temp = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(dir);
    return dir;
};
afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("archiveScratch (sweep B, item 3): the scratch folder kept beside the transcript, never a throw", () => {
    it("copies what fits under the cap, records what it left out, and removes the scratch folder", () => {
        const scratch = temp("eval-scratch-");
        fs.writeFileSync(path.join(scratch, "a.js"), "12345");          // 5 bytes
        fs.writeFileSync(path.join(scratch, "big.bin"), "x".repeat(20)); // 20 bytes: 5 + 20 is past a 10-byte cap
        fs.mkdirSync(path.join(scratch, "sub"));
        fs.writeFileSync(path.join(scratch, "sub", "b.txt"), "abc");     // 3 bytes: 5 + 3 = 8 fits
        const kept = path.join(temp("eval-raw-"), "run.scratch");

        const result = archiveScratch(scratch, kept, 10);
        expect(result).toEqual({ files: 2, bytes: 8, leftOut: ["big.bin (20 bytes: past the archive's cap of 10 bytes)"], failure: null, removed: true });
        expect(fs.readFileSync(path.join(kept, "a.js"), "utf8")).toBe("12345");
        expect(fs.readFileSync(path.join(kept, "sub", "b.txt"), "utf8")).toBe("abc");
        expect(fs.existsSync(path.join(kept, "big.bin"))).toBe(false);
        // the note beside the copies says what is missing from them
        expect(fs.readFileSync(path.join(kept, "ARCHIVE-NOTE.txt"), "utf8")).toBe("Left out of this archive of the run's scratch folder:\n- big.bin (20 bytes: past the archive's cap of 10 bytes)\n");
        expect(fs.existsSync(scratch)).toBe(false);
    });

    it("never follows a link: the folder it points at is neither copied nor removed", () => {
        const scratch = temp("eval-scratch-");
        const outside = temp("eval-outside-");
        fs.writeFileSync(path.join(outside, "keep.txt"), "the owner's");
        fs.writeFileSync(path.join(scratch, "probe.js"), "1");
        fs.symlinkSync(outside, path.join(scratch, "link"), process.platform === "win32" ? "junction" : "dir");
        const kept = path.join(temp("eval-raw-"), "run.scratch");

        const result = archiveScratch(scratch, kept);
        expect(result).toMatchObject({ files: 1, bytes: 1, leftOut: ["link (a link, not followed)"], failure: null, removed: true });
        expect(fs.existsSync(path.join(kept, "link"))).toBe(false);
        expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("the owner's");
        expect(fs.existsSync(scratch)).toBe(false);
    });

    it("records a copy that fails, and still removes the scratch folder", () => {
        const scratch = temp("eval-scratch-");
        fs.writeFileSync(path.join(scratch, "a.js"), "1");
        // the archive's place is taken by a file, so no folder can be made there
        const kept = path.join(temp("eval-raw-"), "run.scratch");
        fs.writeFileSync(kept, "not a folder");

        const result = archiveScratch(scratch, kept);
        expect(result.files).toBe(0);
        expect(result.failure).toMatch(/^the scratch folder couldn't be archived: /);
        expect(result.removed).toBe(true);
        expect(fs.existsSync(scratch)).toBe(false);
        expect(fs.readFileSync(kept, "utf8")).toBe("not a folder");
    });
});
