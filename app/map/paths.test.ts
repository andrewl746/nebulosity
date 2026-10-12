import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { boxFor, nameOf, parentOf } from "./paths";

const box = (p: string, kind: MapNode["kind"] = "folder"): MapNode => ({ path: p, name: p, kind, fileCount: 1, summaryStatus: "fresh" });

describe("Map paths", () => {
    it("names and parents paths, and calls the root by the repo's folder name", () => {
        expect(parentOf("src/vs/base")).toBe("src/vs");
        expect(parentOf("README.md")).toBe("");
        expect(nameOf("src/vs/base", "C:/code/vscode")).toBe("base");
        expect(nameOf("", "C:/code/vscode")).toBe("vscode");
    });

    it("finds the box holding a path at this level: '+N more' for a folded one, none for elsewhere", () => {
        const level = { path: "src", nodes: [box("src/app"), box("src/index.ts", "file"), box("src/", "more")] };
        expect(boxFor(level, "src/app/main.ts")).toBe("src/app");
        expect(boxFor(level, "src/app")).toBe("src/app");
        expect(boxFor(level, "src/index.ts")).toBe("src/index.ts");
        expect(boxFor(level, "src/util/strings.ts")).toBe("src/");   // src/util is folded into "+N more"
        expect(boxFor(level, "scripts/build.js")).toBeNull();
        expect(boxFor(level, "src")).toBeNull();
        expect(boxFor({ path: "", nodes: [box("src")] }, "src/app/main.ts")).toBe("src");
    });
});
