import { describe, expect, it } from "vitest";
import { renderFilePrompt, renderFolderPrompt, renderRepoPrompt, testFileSummary, truncateSource, type FolderItem } from "./prompts";

describe("truncateSource", () => {
    it("leaves source within the limit alone", () => {
        expect(truncateSource("a\nb\n", 10)).toBe("a\nb\n");
    });

    it("cuts at the last line break before the limit and says how many lines are missing", () => {
        expect(truncateSource("aaaa\nbbbb\ncccc\n", 7)).toBe("aaaa\n… (truncated: 2 more lines)");
    });

    it("cuts a single enormous line (minified code) at the limit itself", () => {
        expect(truncateSource("x".repeat(30), 10)).toBe(`${"x".repeat(10)}\n… (truncated: 1 more line)`);
    });
});

describe("renderFilePrompt", () => {
    it("starts with the imports/exports listing, then the line count and the source", () => {
        expect(renderFilePrompt("File: src/a.ts\n\nImports:\n  (none)", 2, "const a = 1;\nexport { a };\n"))
            .toBe("File: src/a.ts\n\nImports:\n  (none)\n\nLines: 2\n\nSource:\nconst a = 1;\nexport { a };\n");
    });
});

describe("renderFolderPrompt", () => {
    const items: FolderItem[] = [
        { name: "index.ts", kind: "file", fileCount: 1, lineCount: 1, text: { tagline: "Barrel", summary: "Re-exports log." } },
        { name: "log.ts", kind: "file", fileCount: 1, lineCount: 9, text: { tagline: "Logging", summary: "Writes lines." } },
        { name: "deep", kind: "folder", fileCount: 3, lineCount: 40, text: null },
    ];

    it("lists children largest first, folders with a slash, and marks missing summaries", () => {
        expect(renderFolderPrompt({ path: "src/core", fileCount: 5, directFileCount: 2 }, items)).toBe([
            "Folder: src/core",
            "5 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- deep/ (3 files): (no summary yet)",
            "- log.ts (9 lines): Logging — Writes lines.",
            "- index.ts (1 line): Barrel — Re-exports log.",
        ].join("\n"));
    });

    it("folds whatever doesn't fit into a count", () => {
        expect(renderFolderPrompt({ path: "src/core", fileCount: 5, directFileCount: 2 }, items, 2).split("\n").slice(-3)).toEqual([
            "- deep/ (3 files): (no summary yet)",
            "- log.ts (9 lines): Logging — Writes lines.",
            "- …and 1 smaller item",
        ]);
    });
});

describe("renderRepoPrompt", () => {
    it("names the repo and its size, then its top-level contents", () => {
        expect(renderRepoPrompt({ name: "mini-repo", fileCount: 8, folderCount: 6 }, [
            { name: "src", kind: "folder", fileCount: 7, lineCount: 45, text: { tagline: "App source", summary: "Everything." } },
        ])).toBe("Repository: mini-repo\n8 source files in 6 folders.\n\nTop-level contents, largest first:\n- src/ (7 files): App source — Everything.");
    });
});

describe("testFileSummary", () => {
    it("says what the file tests, from its name alone", () => {
        expect(testFileSummary("src/util/strings.test.ts", 3)).toEqual({
            tagline: "Tests for strings",
            summary: "Test code (3 lines) for strings. Test files get this template instead of a model-written summary.",
        });
        expect(testFileSummary("src/vs/base/test/common/utils.ts", 1).tagline).toBe("Tests for utils");
    });
});
