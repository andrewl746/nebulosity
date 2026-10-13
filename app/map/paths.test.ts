import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { boxFor, nameOf, parentOf, shortPath } from "./paths";

const box = (p: string, kind: MapNode["kind"] = "folder"): MapNode => ({ path: p, name: p, kind, fileCount: 1, summaryStatus: "fresh" });

describe("Map paths", () => {
    it("names and parents paths, and calls the root by the repo's folder name", () => {
        expect(parentOf("src/vs/base")).toBe("src/vs");
        expect(parentOf("README.md")).toBe("");
        expect(nameOf("src/vs/base", "C:/code/vscode")).toBe("base");
        expect(nameOf("", "C:/code/vscode")).toBe("vscode");
    });

    it("finds the box holding a path at this level, and none for elsewhere", () => {
        const level = { path: "src", nodes: [box("src/app"), box("src/index.ts", "file")] };
        expect(boxFor(level, "src/app/main.ts")).toBe("src/app");
        expect(boxFor(level, "src/app")).toBe("src/app");
        expect(boxFor(level, "src/index.ts")).toBe("src/index.ts");
        expect(boxFor(level, "scripts/build.js")).toBeNull();
        expect(boxFor(level, "src")).toBeNull();
        expect(boxFor({ path: "", nodes: [box("src")] }, "src/app/main.ts")).toBe("src");
    });

    it("lands a path on another page on that page's portal, or on the merged one", () => {
        const level = {
            path: "src",
            nodes: [
                box("src/app"),
                { ...box("src//page-2", "portal"), page: 1, members: ["src/util", "src/core"] },
                { ...box("src//pages", "portal"), pages: [2, 3], members: ["src/x", "src/y.ts"] },
            ],
        };
        expect(boxFor(level, "src/util/strings.ts")).toBe("src//page-2");
        expect(boxFor(level, "src/core")).toBe("src//page-2");
        expect(boxFor(level, "src/y.ts")).toBe("src//pages");
        expect(boxFor(level, "src/x/deep/a.ts")).toBe("src//pages");
        // on a page this one has no line to, so no doorway here
        expect(boxFor(level, "src/zzz/a.ts")).toBeNull();
        // "src/utility" only shares a prefix with the member "src/util"
        expect(boxFor(level, "src/utility/a.ts")).toBeNull();
    });

    it("shortens a path to its last two segments, for the panel's chips", () => {
        expect(shortPath("src/vs/platform/files/common")).toBe("files/common");
        expect(shortPath("build")).toBe("build");
        expect(shortPath("src/vs")).toBe("src/vs");
        expect(shortPath("")).toBe("");
    });
});
