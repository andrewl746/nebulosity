import { describe, expect, it } from "vitest";
import { importerLine, renderFilePrompt, renderFolderPrompt, renderRepoPrompt, testFileSummary, truncateSource, type FolderItem } from "./prompts";

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

/** Importers that aren't test files. */
const source = (...paths: string[]) => paths.map((path) => ({ path, isTest: false }));

describe("importerLine", () => {
    it("says so when no other indexed file imports the file", () => {
        expect(importerLine([])).toBe("Imported by: no other indexed file");
    });

    it("counts a single importer, in the singular", () => {
        expect(importerLine(source("src/app/main.ts"))).toBe("Imported by: 1 file in 1 folder: src/app (1)");
    });

    it("groups importers by folder, biggest folder first, and calls a top-level file's folder the repo root", () => {
        expect(importerLine(source("src/app/main.ts", "src/app/view.tsx", "index.ts")))
            .toBe("Imported by: 3 files in 2 folders: src/app (2), the repo root (1)");
    });

    it("shows the 3 biggest folders, breaks ties by folder path, and folds the rest into a count", () => {
        expect(importerLine(source("a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts", "c/x.ts", "d/x.ts", "e/x.ts")))
            .toBe("Imported by: 7 files in 5 folders: a (2), b (2), c (1), and 2 other folders");
    });

    it("breaks ties by folder path whatever order the importers arrive in, the repo root's empty path first", () => {
        expect(importerLine(source("z/x.ts", "y/x.ts", "x/x.ts", "w/x.ts")))
            .toBe("Imported by: 4 files in 4 folders: w (1), x (1), y (1), and 1 other folder");
        expect(importerLine(source("src/main.ts", "index.ts")))
            .toBe("Imported by: 2 files in 2 folders: the repo root (1), src (1)");
    });

    it("adds no 'other folders' tail when the folders exactly fit", () => {
        expect(importerLine(source("a/x.ts", "b/x.ts", "c/x.ts"))).toBe("Imported by: 3 files in 3 folders: a (1), b (1), c (1)");
    });

    it("shows as many folders as it's told to", () => {
        expect(importerLine(source("a/x.ts", "a/y.ts", "b/x.ts"), 1)).toBe("Imported by: 3 files in 2 folders: a (2), and 1 other folder");
    });

    it("counts test files apart: they leave the totals, the folders and the examples, and are tallied after them", () => {
        expect(importerLine([
            { path: "a/x.ts", isTest: false },
            { path: "a/y.ts", isTest: false },
            { path: "a/test/x.test.ts", isTest: true },
            { path: "b/y.spec.ts", isTest: true },
        ])).toBe("Imported by: 2 files in 1 folder: a (2), plus 2 test files");
    });

    it("puts the test-file tally after the 'other folders' tail", () => {
        expect(importerLine([
            ...source("a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts", "c/x.ts", "d/x.ts", "e/x.ts"),
            { path: "t/z.test.ts", isTest: true },
        ])).toBe("Imported by: 7 files in 5 folders: a (2), b (2), c (1), and 2 other folders, plus 1 test file");
    });

    it("says so when only test files import the file", () => {
        expect(importerLine([{ path: "src/app/main.test.ts", isTest: true }])).toBe("Imported by: only 1 test file");
        expect(importerLine([{ path: "a/x.test.ts", isTest: true }, { path: "b/test/y.ts", isTest: true }])).toBe("Imported by: only 2 test files");
    });
});

describe("renderFilePrompt", () => {
    it("starts with the imports/exports listing, then the line count, who imports the file, and the source", () => {
        expect(renderFilePrompt("File: src/a.ts\n\nImports:\n  (none)", 2, [], "const a = 1;\nexport { a };\n"))
            .toBe("File: src/a.ts\n\nImports:\n  (none)\n\nLines: 2\nImported by: no other indexed file\n\nSource:\nconst a = 1;\nexport { a };\n");
    });

    it("puts the importers right after the line count, and cuts the source at the limit it's given", () => {
        expect(renderFilePrompt("File: src/a.ts", 3, source("src/main.ts", "src/view.ts"), "aaaa\nbbbb\ncccc\n", 7))
            .toBe("File: src/a.ts\n\nLines: 3\nImported by: 2 files in 1 folder: src (2)\n\nSource:\naaaa\n… (truncated: 2 more lines)");
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
