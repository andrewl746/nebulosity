import { describe, expect, it } from "vitest";
import type { AreaCount, MapNode } from "@/lib/contracts";
import {
    barWidth,
    childTitle,
    declarationPlace,
    defaultTab,
    githubFolderLink,
    importsTitle,
    inspectorName,
    inspectorTitle,
    kindBeforeDescribe,
    largestCount,
    MIN_BAR,
    sizeLine,
} from "./inspector";

const area = (path: string, count: number): AreaCount => ({ path, kind: "folder", count });
const box = (path: string, kind: MapNode["kind"]): MapNode => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind, fileCount: 1, summaryStatus: "fresh" });

const ROOT = "C:/code/vscode";
// the mockup's root level, src selected: what uses src, most first (mockup3.html's edges into "src")
const USED_BY = [area("extensions", 665), area("build", 16), area(".eslint-plugin-local", 2), area(".github", 2)];

describe("the inspector", () => {
    it("opens on Used by when anything uses the target, else Uses, else what's inside", () => {
        expect(defaultTab({ uses: [area("base", 3)], usedBy: USED_BY })).toBe("usedBy");   // both have rows: Used by wins
        expect(defaultTab({ uses: [area("base", 3)], usedBy: [] })).toBe("uses");
        expect(defaultTab({ uses: [], usedBy: [] })).toBe("inside");                       // a folder nothing links to
    });

    it("measures each bar against the tab's largest row, never under 1.5%", () => {
        const largest = largestCount(USED_BY);
        expect(largest).toBe(665);
        expect(barWidth(665, largest)).toBe(100);                        // the largest row is the whole row
        expect(barWidth(16, largest)).toBeCloseTo(2.406, 3);             // 100 × 16 / 665 = 2.4060…
        expect(barWidth(2, largest)).toBe(MIN_BAR);                      // 100 × 2 / 665 = 0.30…, under the floor
        expect(barWidth(1, 4)).toBe(25);                                 // 100 × 1 / 4
        expect(barWidth(10, 5)).toBe(100);                               // never past the row
        expect(barWidth(0, 0)).toBe(MIN_BAR);                            // no largest to measure against
        expect(largestCount([])).toBe(0);
    });

    it("knows a target's kind before describe() answers, where the level says it", () => {
        const level = { path: "src", nodes: [box("src/vs", "folder"), box("src/main.ts", "file"), box("src//page-2", "portal")] };
        expect(kindBeforeDescribe("", level)).toBe("repo");
        expect(kindBeforeDescribe("src", level)).toBe("folder");         // the folder on screen
        expect(kindBeforeDescribe("src/vs", level)).toBe("folder");
        expect(kindBeforeDescribe("src/main.ts", level)).toBe("file");
        expect(kindBeforeDescribe("src//page-2", level)).toBeUndefined(); // a doorway has its own panel
        expect(kindBeforeDescribe("src/vs/base/common/event.ts", level)).toBeUndefined();
    });

    it("names a folder with a trailing slash, the repo by its own name, a file by its name", () => {
        expect(inspectorName("src", ROOT, "folder")).toBe("src/");
        expect(inspectorName("src/vs/base", ROOT, "folder")).toBe("base/");
        expect(inspectorName("", ROOT, "repo")).toBe("vscode");
        expect(inspectorName("src/vs/base/common/event.ts", ROOT, "file")).toBe("event.ts");
        expect(inspectorName("src/vs", ROOT, undefined)).toBe("vs");    // not known yet: bare
    });

    it("titles the name with the whole path, which always holds the name as shown", () => {
        expect(inspectorTitle("src/vs/base", ROOT, "folder")).toBe("src/vs/base/");
        expect(inspectorTitle("", ROOT, "repo")).toBe(ROOT);
        expect(inspectorTitle("src/vs/base/common/event.ts", ROOT, "file")).toBe("src/vs/base/common/event.ts");
        for (const [path, kind] of [["src/vs/base", "folder"], ["", "repo"], ["src/a.ts", "file"], ["src/vs", undefined]] as const){
            expect(inspectorTitle(path, ROOT, kind)).toContain(inspectorName(path, ROOT, kind));
        }
    });

    it("writes the sizes with commas, a file's lines alone, and what changed since it was summarized", () => {
        // 3,456,789 lines: 3.456789M, rounded to one decimal, 3.5M
        expect(sizeLine({ kind: "folder", stats: { fileCount: 10_280, lineCount: 3_456_789 }, stalePaths: 0 })).toBe("10,280 files, 3.5M lines");
        expect(sizeLine({ kind: "repo", stats: { fileCount: 15_040, lineCount: 3_395_641 }, stalePaths: 12 })).toBe("15,040 files, 3.4M lines, 12 changed since summarized");
        expect(sizeLine({ kind: "file", stats: { fileCount: 1, lineCount: 120 }, stalePaths: 0 })).toBe("120 lines");
        expect(sizeLine({ kind: "file", stats: { fileCount: 1, lineCount: 1 }, stalePaths: 1 })).toBe("1 line, 1 changed since summarized");
        expect(sizeLine({ kind: "folder", stats: { fileCount: 1, lineCount: 1_234 }, stalePaths: 0 })).toBe("1 file, 1.2K lines");
    });

    it("titles rows with their path and their count", () => {
        expect(importsTitle("src/vs/base", 1)).toBe("src/vs/base, 1 import");
        expect(importsTitle("src/vs/base", 1_234)).toBe("src/vs/base, 1,234 imports");
        expect(childTitle({ path: "src/vs/base", kind: "folder", fileCount: 1_204, tagline: "Shared utilities" })).toBe("src/vs/base, 1,204 files\nShared utilities");
        expect(childTitle({ path: "src/vs/nls", kind: "folder", fileCount: 1 })).toBe("src/vs/nls, 1 file");
        expect(childTitle({ path: "src/main.ts", kind: "file", fileCount: 1 })).toBe("src/main.ts");
        expect(declarationPlace({ kind: "function", startLine: 272 })).toBe("function, line 272");
        expect(declarationPlace({ kind: "method", startLine: 1_234 })).toBe("method, line 1234");   // as an editor writes a line
    });

    it("links a folder and the repo to GitHub as a tree at the indexed commit", () => {
        const source = { owner: "microsoft", name: "vscode", commit: "cc3fec88" };
        expect(githubFolderLink(source, "src/vs")).toBe("https://github.com/microsoft/vscode/tree/cc3fec88/src/vs");
        expect(githubFolderLink(source, "")).toBe("https://github.com/microsoft/vscode/tree/cc3fec88");
        expect(githubFolderLink(source, "a b/c#d")).toBe("https://github.com/microsoft/vscode/tree/cc3fec88/a%20b/c%23d");
    });

    it("keeps the owner's copy rule: no colons, semicolons, em dashes or middle dots in what it writes", () => {
        const shown = [
            sizeLine({ kind: "folder", stats: { fileCount: 10_280, lineCount: 3_456_789 }, stalePaths: 12 }),
            sizeLine({ kind: "file", stats: { fileCount: 1, lineCount: 120 }, stalePaths: 0 }),
            importsTitle("src/vs/base", 12),
            childTitle({ path: "src/vs/base", kind: "folder", fileCount: 3, tagline: "Shared utilities" }),
            declarationPlace({ kind: "function", startLine: 272 }),
        ];
        for (const text of shown) expect(text).not.toMatch(/[:;—·]/);
    });
});
