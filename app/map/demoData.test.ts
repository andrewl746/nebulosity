import { describe, expect, it } from "vitest";
import type { DemoManifest } from "@/lib/contracts";
import { boxToward, bundleIdFor, clampPage, indexManifest, pageCountOf, pageHolding } from "./demoData";

const MANIFEST = { folders: ["", "big", "my docs #1"], pages: { "1": 2 } } as unknown as DemoManifest;

describe("demo lookups", () => {
    it("finds the box on a folder's level that holds a path", () => {
        expect(boxToward("", "src/vs/a.ts")).toBe("src");
        expect(boxToward("src", "src/vs/a.ts")).toBe("src/vs");
        expect(boxToward("src/vs", "src/vs/a.ts")).toBe("src/vs/a.ts");
        expect(boxToward("src", "srcx/a.ts")).toBeNull();
        expect(boxToward("src", "src")).toBeNull();
    });

    it("clamps a page to the folder's pages, and finds the page holding a box", () => {
        expect(clampPage(5, 2)).toBe(1);
        expect(clampPage(-1, 3)).toBe(0);
        expect(pageHolding({ boxes: [["a", "b"], ["c"]] }, "c")).toBe(1);
        expect(pageHolding({ boxes: [["a"]] }, "z")).toBeNull();
    });

    it("puts a folder's answer in its own bundle and a file's in its folder's", () => {
        const index = indexManifest(MANIFEST);
        expect(pageCountOf(index, 1)).toBe(2);
        expect(pageCountOf(index, 2)).toBe(1);
        expect(bundleIdFor(index, "big")).toBe(1);
        expect(bundleIdFor(index, "big/a.ts")).toBe(1);
        expect(bundleIdFor(index, "readme.ts")).toBe(0);
        expect(bundleIdFor(index, "my docs #1")).toBe(2);
        expect(bundleIdFor(index, "nope/x.ts")).toBeNull();
    });
});
