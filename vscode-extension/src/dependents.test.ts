import { describe, expect, it } from "vitest";
import type { ImportsResponse } from "../../lib/contracts";
import { pickItems, pickNote, pickTitle } from "./dependents";

/** A dependents answer, from the plan's "Ground truth" (test/fixtures/mini-repo). */
function dependents(path: string, transitive: boolean, files: [string, number][], direct: number): ImportsResponse {
    return {
        path,
        kind: "file",
        direction: "dependents",
        transitive,
        files: files.map(([p, distance]) => ({ path: p, distance })),
        direct,
        total: files.length,
        offset: 0,
        indexVersion: 1,
    };
}

const LOG_DIRECT = dependents("src/core/log.ts", false, [["src/app/main.ts", 1], ["src/core/index.ts", 1], ["src/index.ts", 1]], 3);
const LOG_ALL = dependents("src/core/log.ts", true, [
    ["src/app/main.ts", 1], ["src/core/index.ts", 1], ["src/index.ts", 1],
    ["src/util/strings.ts", 2], ["src/app/view.tsx", 2], ["scripts/build.js", 2], ["src/util/strings.test.ts", 3],
], 3);

describe("the What depends QuickPick (the plan's Ground truth)", () => {
    it("lists the direct importers of log.ts", () => {
        expect(pickTitle(LOG_DIRECT)).toBe("3 files import log.ts");
        expect(pickItems(LOG_DIRECT)).toEqual([
            { label: "main.ts", description: "src/app", path: "src/app/main.ts" },
            { label: "index.ts", description: "src/core", path: "src/core/index.ts" },
            { label: "index.ts", description: "src", path: "src/index.ts" },
        ]);
    });

    it("lists them all, indirect included", () => {
        expect(pickTitle(LOG_ALL)).toBe("7 files import log.ts, 4 of them indirectly");
        expect(pickItems(LOG_ALL)).toEqual([
            { label: "main.ts", description: "src/app", path: "src/app/main.ts" },
            { label: "index.ts", description: "src/core", path: "src/core/index.ts" },
            { label: "index.ts", description: "src", path: "src/index.ts" },
            { label: "strings.ts", description: "src/util", path: "src/util/strings.ts" },
            { label: "view.tsx", description: "src/app", path: "src/app/view.tsx" },
            { label: "build.js", description: "scripts", path: "scripts/build.js" },
            { label: "strings.test.ts", description: "src/util", path: "src/util/strings.test.ts" },
        ]);
    });

    it("says one file, and none", () => {
        expect(pickTitle(dependents("src/index.ts", true, [["scripts/build.js", 1]], 1))).toBe("1 file imports index.ts");
        const nothing = dependents("scripts/build.js", false, [], 0);
        expect(pickTitle(nothing)).toBe("No file imports build.js");
        expect(pickItems(nothing)).toEqual([]);
    });

    it("gives a file at the repo root no folder", () => {
        expect(pickItems(dependents("src/index.ts", false, [["build.js", 1]], 1))).toEqual([{ label: "build.js", description: "", path: "build.js" }]);
    });

    it("writes a count past 999 with its thousands comma", () => {
        const event = { ...dependents("src/vs/base/common/event.ts", false, [["src/vs/a.ts", 1]], 2631), total: 2631 };
        expect(pickTitle(event)).toBe("2,631 files import event.ts");
    });
});

describe("the note on a list cut at its page (pickNote)", () => {
    /** An answer of `listed` files out of `total`: what a page of 500 gives for a busy file. */
    const cut = (transitive: boolean, listed: number, total: number, direct: number): ImportsResponse => ({
        ...dependents("src/vs/base/common/event.ts", transitive, Array.from({ length: listed }, (_, i): [string, number] => [`src/vs/f${i}.ts`, 1]), direct),
        total,
    });

    it("is a row with no path that says how many of how many are listed, nearest first, when the page holds fewer than the total", () => {
        expect(pickNote(cut(false, 500, 2631, 2631))).toEqual({ label: "Showing the first 500 of 2,631, nearest first", alwaysShow: true, path: null });
        expect(pickNote(cut(true, 500, 4012, 2631))).toEqual({ label: "Showing the first 500 of 4,012, nearest first", alwaysShow: true, path: null });
    });

    it("says nothing when the list is whole", () => {
        expect(pickNote(LOG_DIRECT)).toBeNull();
        expect(pickNote(LOG_ALL)).toBeNull();
        expect(pickNote(dependents("scripts/build.js", false, [], 0))).toBeNull();
        expect(pickNote(cut(false, 500, 500, 500))).toBeNull();
    });
});
