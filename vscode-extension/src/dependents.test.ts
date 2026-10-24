import { describe, expect, it } from "vitest";
import type { ImportsResponse } from "../../lib/contracts";
import { pickItems, pickTitle } from "./dependents";

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
});
