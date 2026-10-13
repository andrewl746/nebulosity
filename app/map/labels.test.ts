import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { boxTitle, lineLabel } from "./labels";

const box = (path: string, extra: Partial<MapNode> = {}): MapNode =>
    ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "folder", fileCount: 3, summaryStatus: "fresh", ...extra });
const portal = (path: string, name: string, extra: Partial<MapNode>): MapNode =>
    ({ path, name, kind: "portal", fileCount: 9, summaryStatus: "skipped", ...extra });

describe("lineLabel (owner's three-task test: 'base depends on editor')", () => {
    it("says which box uses which, in words, with the import count", () => {
        expect(lineLabel(box("src/vs/editor"), box("src/vs/base"), 12)).toBe("editor uses base · 12 imports");
        expect(lineLabel(box("src/a.ts", { kind: "file" }), box("src/b.ts", { kind: "file" }), 1)).toBe("a.ts uses b.ts · 1 import");
    });

    it("names the boxes behind a portal instead of the doorway", () => {
        const page2 = portal("x//page-2", "Page 2", { page: 1 });
        expect(lineLabel(box("x/github"), page2, 3)).toBe("github uses boxes on Page 2 · 3 imports");
        expect(lineLabel(page2, box("x/github"), 1)).toBe("Boxes on Page 2 use github · 1 import");
    });

    it("counts the pages behind a merged portal", () => {
        const merged = portal("x//pages", "+3 pages", { pages: [2, 3, 4] });
        expect(lineLabel(box("x/log"), merged, 40)).toBe("log uses boxes on 3 other pages · 40 imports");
        expect(lineLabel(merged, box("x/log"), 2)).toBe("Boxes on 3 other pages use log · 2 imports");
    });
});

describe("boxTitle", () => {
    it("shows a box's path and its one-line summary, so you can tell what it is before opening it", () => {
        expect(boxTitle(box(".vscode", { tagline: "Editor settings for working on this repo" }))).toBe(".vscode: Editor settings for working on this repo");
    });

    it("shows just the path when there's no summary yet", () => {
        expect(boxTitle(box("src/vs/editor"))).toBe("src/vs/editor");
    });
});
