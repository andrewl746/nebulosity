import { describe, expect, it } from "vitest";
import { MAX_BYTES, MAX_FILES, refusals } from "./demo-limits";

describe("refusals", () => {
    it("takes exactly the limits: 14,000 files and 95 MB", () => {
        expect(MAX_FILES).toBe(14_000);
        expect(MAX_BYTES).toBe(95_000_000);
        expect(refusals({ files: 14_000, bytes: 95_000_000 }, 0)).toEqual([]);
    });

    it("says how far past the file limit it is", () => {
        expect(refusals({ files: 14_001, bytes: 1_000_000 }, 0)).toEqual(["14,001 files > 14,000"]);
    });

    it("says how far past the size limit it is", () => {
        expect(refusals({ files: 100, bytes: 96_400_000 }, 0)).toEqual(["96.4 MB > 95 MB"]);
    });

    it("names a leak, singular and plural", () => {
        expect(refusals({ files: 100, bytes: 1_000_000 }, 1)).toEqual(["1 file holds a path of this machine or the git email (listed above)"]);
        expect(refusals({ files: 100, bytes: 1_000_000 }, 2)).toEqual(["2 files hold a path of this machine or the git email (listed above)"]);
    });

    it("lists every reason, leaks first", () => {
        expect(refusals({ files: 15_200, bytes: 101_300_000 }, 2)).toEqual([
            "2 files hold a path of this machine or the git email (listed above)",
            "15,200 files > 14,000",
            "101.3 MB > 95 MB",
        ]);
    });
});
