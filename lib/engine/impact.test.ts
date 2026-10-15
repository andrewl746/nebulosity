import path from "path";
import { describe, expect, it } from "vitest";
import { indexRepository } from "../index/pipeline";
import { areasOf, impact, rootsAmong } from "./impact";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
indexRepository(root);
const target = "src/base/common/strings.ts";

describe("impact of strings.ts on the architecture fixture", () => {
    it("counts the 16 dependents by the children of a folder, with the rest elsewhere", () => {
        const i = impact(root, target, "dependents", { groupBy: "src" });
        expect(i.reach.reached).toHaveLength(16);
        expect(i.reach.direct).toBe(6);
        expect(i.areas).toEqual([
            { path: "src/editor", kind: "folder", count: 5 },
            { path: "src/base", kind: "folder", count: 4 },
            { path: "src/app", kind: "folder", count: 3 },
            { path: "src/platform", kind: "folder", count: 3 },
        ]);
        expect(i.elsewhere).toBe(1);
        expect(i.tests).toBe(1);
    });

    it("splits the files nothing imports into those a package.json names and the others, tests left out", () => {
        expect(impact(root, target, "dependents", { groupBy: "src" }).roots).toEqual({
            declared: ["src/app/loader.ts"],
            others: ["src/app/legacy.ts", "tools/fixtures/legacy-ids.ts"],
        });
    });

    it("with no folder, groups as describe's used-by does", () => {
        expect(impact(root, target, "dependents", { groupBy: null }).areas).toEqual([
            { path: "src/editor", kind: "folder", count: 5 },
            { path: "src/app", kind: "folder", count: 3 },
            { path: "src/platform", kind: "folder", count: 3 },
            { path: "src/base/browser", kind: "folder", count: 1 },
            { path: "src/base/common/arrays.ts", kind: "file", count: 1 },
            { path: "src/base/node", kind: "folder", count: 1 },
            { path: "src/base/test", kind: "folder", count: 1 },
            { path: "tools", kind: "folder", count: 1 },
        ]);
    });

    it("refuses a group_by that isn't a folder", () => {
        expect(() => impact(root, target, "dependents", { groupBy: "src/app/main.ts" })).toThrow('group_by takes a folder: nothing is indexed as a folder at "src/app/main.ts".');
    });

    it("lists no roots for dependencies", () => {
        expect(impact(root, "src/app/main.ts", "dependencies", { groupBy: null }).roots).toBeNull();
    });
});

describe("areasOf and rootsAmong, hand-built", () => {
    it("puts a file directly in the folder under its own name", () => {
        expect(areasOf([{ path: "a/x.ts", distance: 1 }, { path: "a/b/y.ts", distance: 2 }], { path: "c/z.ts", kind: "file" }, "a"))
            .toEqual({ areas: [{ path: "a/b", kind: "folder", count: 1 }, { path: "a/x.ts", kind: "file", count: 1 }], elsewhere: 0 });
    });

    it("leaves out tests and files something imports", () => {
        const inDegree = (p: string): number => (p === "a.ts" ? 1 : 0);
        expect(rootsAmong([{ path: "a.ts", distance: 1 }, { path: "test/b.ts", distance: 1 }, { path: "c.ts", distance: 2 }], inDegree, new Set()))
            .toEqual({ declared: [], others: ["c.ts"] });
    });
});
