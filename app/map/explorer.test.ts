import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { barWidth, explorerRows, explorerView, itemCount, pageLine, rowTone } from "./explorerRows";

const node = (path: string, kind: MapNode["kind"], fileCount: number): MapNode =>
    ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind, fileCount, summaryStatus: "fresh" });

// VS Code's root, the approved mockup's level (mockup3.html, from the demo's level/0-0.json), given here out of order
const ROOT: MapNode[] = [
    node("gulpfile.mjs", "file", 1), node(".github", "folder", 12), node("cli", "folder", 85), node("extensions", "folder", 4_128),
    node(".vscode-test.js", "file", 1), node(".agents", "folder", 4), node("src", "folder", 10_280), node("scripts", "folder", 24),
    node("eslint.config.js", "file", 1), node("test", "folder", 156), node(".vscode", "folder", 21), node("build", "folder", 269),
    node(".eslint-plugin-local", "folder", 58),
];

// The bar's scale, the mockup's logW, worked by hand.
describe("barWidth: max(3, 36 × log10(files + 1) / log10(largest + 1))", () => {
    it("is 36 px, its whole column, for the page's largest folder", () => {
        expect(barWidth(10_280, 10_280)).toBe(36);
    });

    it("is half, 18 px, where log10(files + 1) is half of the largest's", () => {
        // log10(10) / log10(100) = 1 / 2, and 36 × 1 / 2 = 18
        expect(barWidth(9, 99)).toBe(18);
    });

    it("is three quarters, 27 px, where log10(files + 1) is three quarters of the largest's", () => {
        // log10(1,000) / log10(10,000) = 3 / 4, and 36 × 3 / 4 = 27
        expect(barWidth(999, 9_999)).toBe(27);
    });

    it("gives extensions 32.44 px beside src's 36", () => {
        // log10(4,129) = log10(4,096) + log10(1.00806) = 12 × 0.30103 + 0.00348 = 3.61584
        // log10(10,281) = 4 + log10(1.0281) = 4 + 0.01204 = 4.01204
        // 36 × 3.61584 / 4.01204 = 36 × 0.90125 = 32.445
        expect(barWidth(4_128, 10_280)).toBeCloseTo(32.445, 2);
    });

    it("gives .agents, 4 files, 6.27 px", () => {
        // log10(5) = 0.69897, and 36 × 0.69897 / 4.01204 = 36 × 0.17422 = 6.272
        expect(barWidth(4, 10_280)).toBeCloseTo(6.27, 2);
    });

    it("never draws under 3 px, so an empty or tiny folder still has a mark", () => {
        // 36 × log10(1) / 4.01204 = 0
        expect(barWidth(0, 10_280)).toBe(3);
        // one file: 36 × log10(2) / log10(10,281) = 36 × 0.30103 / 4.01204 = 2.70, under the floor
        expect(barWidth(1, 10_280)).toBe(3);
        expect(barWidth(-1, 99)).toBe(3);
    });

    it("is 3 px on a page with no folder to scale against, and never past its 36 px column", () => {
        expect(barWidth(5, 0)).toBe(3);
        // more files than the page's largest can't come from one page, but the bar still stops at its column
        expect(barWidth(20_000, 10_280)).toBe(36);
    });
});

describe("explorerRows: folders by files, largest first, then the files by name", () => {
    it("lists VS Code's root in the mockup's order", () => {
        expect(explorerRows(ROOT).map((r) => r.path)).toEqual([
            "src", "extensions", "build", "test", "cli", ".eslint-plugin-local", "scripts", ".vscode", ".github", ".agents",
            ".vscode-test.js", "eslint.config.js", "gulpfile.mjs",
        ]);
    });

    it("gives each folder its count, its bar against the page's largest and a label with the unit, and a file none of them", () => {
        const rows = explorerRows(ROOT);
        expect(rows[0]).toEqual({ kind: "folder", path: "src", name: "src", files: 10_280, bar: 36, label: "src, 10,280 files" });
        // the 32.445 px worked out above
        expect(rows[1]).toMatchObject({ kind: "folder", path: "extensions", files: 4_128, label: "extensions, 4,128 files" });
        expect(rows[1].kind === "folder" && rows[1].bar).toBeCloseTo(32.445, 2);
        expect(rows[10]).toEqual({ kind: "file", path: ".vscode-test.js", name: ".vscode-test.js" });
    });

    it("says 1 file, not 1 files", () => {
        expect(explorerRows([node("one", "folder", 1)])[0]).toMatchObject({ label: "one, 1 file" });
    });

    it("leaves out the doorways to other pages, and doesn't scale the bars against them", () => {
        // the portal stands for 900 files on another page: were it counted, src/a's bar would be
        // 36 × log10(41) / log10(901) = 36 × 1.61278 / 2.95472 = 19.65 px, not its whole column
        const rows = explorerRows([node("src//page-2", "portal", 900), node("src/a", "folder", 40), node("src/b.ts", "file", 1)]);
        expect(rows.map((r) => r.path)).toEqual(["src/a", "src/b.ts"]);
        expect(rows[0]).toMatchObject({ bar: 36 });
    });

    it("breaks a tie in files by name, as VS Code's explorer orders names", () => {
        // same count: by name. A dot comes before letters, case is mixed together, and numbers go by value
        const tied = [node("lib", "folder", 5), node("Docs", "folder", 5), node(".config", "folder", 5), node("app", "folder", 5)];
        expect(explorerRows(tied).map((r) => r.name)).toEqual([".config", "app", "Docs", "lib"]);
        const loose = [node("README.md", "file", 1), node("file10.ts", "file", 1), node("app.ts", "file", 1), node("file2.ts", "file", 1)];
        expect(explorerRows(loose).map((r) => r.name)).toEqual(["app.ts", "file2.ts", "file10.ts", "README.md"]);
    });

    it("keeps two names that differ only in case in a fixed order, whichever comes first", () => {
        // "R" (82) is before "r" (114), so README.md comes first either way round
        const a = explorerRows([node("readme.md", "file", 1), node("README.md", "file", 1)]).map((r) => r.name);
        const b = explorerRows([node("README.md", "file", 1), node("readme.md", "file", 1)]).map((r) => r.name);
        expect(a).toEqual(["README.md", "readme.md"]);
        expect(b).toEqual(a);
    });

    it("is empty for an empty level", () => {
        expect(explorerRows([])).toEqual([]);
    });
});

describe("rowTone", () => {
    const linked = new Set(["src", "extensions", "build"]);

    it("draws the selection as selected, even though it's in the linked set too", () => {
        expect(rowTone("src", "src", linked)).toBe("selected");
    });

    it("draws a box joined to the selection by a line as linked, and the rest plain", () => {
        expect(rowTone("extensions", "src", linked)).toBe("linked");
        expect(rowTone("cli", "src", linked)).toBe("plain");
    });

    it("draws every row plain with nothing selected", () => {
        expect(rowTone("src", null, new Set())).toBe("plain");
    });
});

describe("the header's count and the page line", () => {
    it("counts items, singular for one", () => {
        expect(itemCount(13)).toBe("13 items");
        expect(itemCount(1)).toBe("1 item");
        expect(itemCount(0)).toBe("0 items");
        expect(itemCount(1_234)).toBe("1,234 items");
    });

    it("says nothing about pages for a folder that fits on one", () => {
        expect(pageLine({ page: 0, pageCount: 1, hiddenCount: 0 }, 13)).toBeNull();
    });

    it("says which page, and how many of the folder's boxes it draws", () => {
        // page 1 from 0 is the second, with 44 drawn and 138 on the other pages: 44 + 138 = 182
        expect(pageLine({ page: 1, pageCount: 5, hiddenCount: 138 }, 44)).toBe("Page 2 of 5, 44 of 182 folders and files");
        // 50 + 1,950 = 2,000
        expect(pageLine({ page: 0, pageCount: 40, hiddenCount: 1_950 }, 50)).toBe("Page 1 of 40, 50 of 2,000 folders and files");
    });

    it("has no colon, semicolon or em dash in what it shows", () => {
        const line = pageLine({ page: 1, pageCount: 5, hiddenCount: 138 }, 44) ?? "";
        expect(line).not.toMatch(/[:;—]/);
    });
});

describe("explorerView", () => {
    it("counts the rows, not the doorways, in the header and the page line", () => {
        // 3 folders and a file are drawn (4), and the two doorways stand for the 20 boxes on the other pages: 4 + 20 = 24
        const view = explorerView({
            nodes: [
                node("a", "folder", 30), node("b", "folder", 3), node("c", "folder", 12), node("d.ts", "file", 1),
                node("//page-2", "portal", 400), node("//page-3", "portal", 90),
            ],
            page: 0, pageCount: 3, hiddenCount: 20,
        });
        expect(view.rows.map((r) => r.path)).toEqual(["a", "c", "b", "d.ts"]);
        expect(view.count).toBe("4 items");
        expect(view.pageLine).toBe("Page 1 of 3, 4 of 24 folders and files");
    });

    it("gives VS Code's root its 13 items and no page line", () => {
        const view = explorerView({ nodes: ROOT, page: 0, pageCount: 1, hiddenCount: 0 });
        expect(view.count).toBe("13 items");
        expect(view.pageLine).toBeNull();
    });
});
