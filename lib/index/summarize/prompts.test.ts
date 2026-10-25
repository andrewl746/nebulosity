import { describe, expect, it } from "vitest";
import { importerLine, plural, renderFilePrompt, renderFolderPrompt, renderRepoPrompt, testFileSummary, testFolderSummary, truncateSource, type FolderItem } from "./prompts";

describe("plural", () => {
    it("adds an s by default, and takes the plural form a word needs when that isn't it", () => {
        expect(plural(1, "file")).toBe("1 file");
        expect(plural(12_103, "file")).toBe("12,103 files");
        expect(plural(1, "batch", "batches")).toBe("1 batch");
        expect(plural(0, "batch", "batches")).toBe("0 batches");
        expect(plural(3, "batch", "batches")).toBe("3 batches");
    });
});

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
        expect(importerLine("src/app/main.ts", [])).toBe("Imported by: no other indexed file");
    });

    it("names the area an importer sits in: its group is the child of the lowest common folder", () => {
        // the lowest common folder of src/core and src/app is src; the child of src toward src/app/main.ts is src/app
        expect(importerLine("src/core/log.ts", source("src/app/main.ts"))).toBe("Imported by: 1 file: src/app (1)");
    });

    it("makes an importer directly inside the lowest common folder a group of its own", () => {
        // for src/app and src/app the lowest common folder is src/app, so main.ts and view.tsx stand for themselves;
        // for src/app and src it is src, and src/index.ts sits directly in it
        expect(importerLine("src/app/util.ts", source("src/app/main.ts", "src/app/view.tsx", "src/index.ts")))
            .toBe("Imported by: 3 files: src/app/main.ts (1), src/app/view.tsx (1), src/index.ts (1)");
    });

    it("counts importers by area, biggest first, ties by path, and folds the hidden groups into a count of files", () => {
        // lifecycle.ts sits in src/vs/base/common. Each importer's group (lowest common folder, then its child toward the importer):
        //   common/async.ts               src/vs/base/common  -> src/vs/base/common/async.ts (directly inside it)
        //   common/worker/w.ts            src/vs/base/common  -> src/vs/base/common/worker
        //   browser/dom.ts                src/vs/base         -> src/vs/base/browser
        //   browser/ui/list.ts            src/vs/base         -> src/vs/base/browser
        //   workbench a/x.ts, b/y.ts, c.ts  src/vs           -> src/vs/workbench (3)
        //   platform/p/z.ts               src/vs              -> src/vs/platform
        //   extensions/e/src/m.ts         the repo root       -> extensions
        //   build.js                      the repo root       -> build.js (directly inside it)
        // So: workbench 3, base/browser 2, then five groups of 1 in code-point order (build.js, extensions,
        // src/vs/base/common/async.ts, src/vs/base/common/worker, src/vs/platform). The top 3 hold 3 + 2 + 1 = 6
        // of the 10 files, so 4 are elsewhere. The one test file is tallied last.
        expect(importerLine("src/vs/base/common/lifecycle.ts", [
            ...source(
                "src/vs/base/common/async.ts", "src/vs/base/common/worker/w.ts",
                "src/vs/base/browser/dom.ts", "src/vs/base/browser/ui/list.ts",
                "src/vs/workbench/a/x.ts", "src/vs/workbench/b/y.ts", "src/vs/workbench/c.ts",
                "src/vs/platform/p/z.ts", "extensions/e/src/m.ts", "build.js"
            ),
            { path: "src/vs/base/test/common/lifecycle.test.ts", isTest: true },
        ])).toBe("Imported by: 10 files: src/vs/workbench (3), src/vs/base/browser (2), build.js (1), and 4 files elsewhere, plus 1 test file");
    });

    it("breaks ties by path whatever order the importers arrive in", () => {
        // from src/a, each importer's group is its own folder under src: src/w, src/x, src/y, src/z, one file each
        expect(importerLine("src/a/x.ts", source("src/z/x.ts", "src/y/x.ts", "src/x/x.ts", "src/w/x.ts")))
            .toBe("Imported by: 4 files: src/w (1), src/x (1), src/y (1), and 1 file elsewhere");
        expect(importerLine("src/a/x.ts", source("src/z/x.ts", "src/y/x.ts", "src/w/x.ts")))
            .toBe("Imported by: 3 files: src/w (1), src/y (1), src/z (1)");
    });

    it("lets a top-level file be a group of its own, sorted by plain path", () => {
        // from src, index.ts sits directly in the repo root (the lowest common folder) and src/main.ts directly in src; 'i' < 's'
        expect(importerLine("src/a.ts", source("src/main.ts", "index.ts"))).toBe("Imported by: 2 files: index.ts (1), src/main.ts (1)");
    });

    it("shows as many groups as it's told to", () => {
        // from lib, app/x.ts and app/y.ts make group app (2) and web/x.ts makes web (1); one group shown holds 2 of the 3 files
        expect(importerLine("lib/a.ts", source("app/x.ts", "app/y.ts", "web/x.ts"), 1)).toBe("Imported by: 3 files: app (2), and 1 file elsewhere");
    });

    it("pins a file at the repo root: the lowest common folder is the root, so an importer's group is its top-level folder", () => {
        // dirOf("build.js") is "", so the lowest common folder is "" and the child toward src/x/y.ts is src
        expect(importerLine("build.js", [{ path: "src/x/y.ts", isTest: false }])).toBe("Imported by: 1 file: src (1)");
    });

    it("writes group counts with thousands separators, the way the total is written", () => {
        // lcaFolder("b", "a") is "" and childToward("", "a/fN.ts") is a, so all 1,000 importers are one group
        const importers = source(...Array.from({ length: 1000 }, (_, i) => `a/f${i}.ts`));
        expect(importerLine("b/x.ts", importers)).toBe("Imported by: 1,000 files: a (1,000)");
    });

    it("shows at least one group however small a limit it's given", () => {
        // three groups of one in path order; a limit of 0 is raised to 1, so src/app/main.ts is shown and the other 2 files are elsewhere
        expect(importerLine("src/app/util.ts", source("src/app/main.ts", "src/app/view.tsx", "src/index.ts"), 0))
            .toBe("Imported by: 3 files: src/app/main.ts (1), and 2 files elsewhere");
    });

    it("adds no 'elsewhere' tail when the groups exactly fit", () => {
        // from lib, the groups are web (2: x.ts, y.ts), app (1) and docs (1): three groups, all shown; the test file is tallied after them
        expect(importerLine("lib/a.ts", [...source("app/x.ts", "web/x.ts", "web/y.ts", "docs/z.ts"), { path: "lib/a.test.ts", isTest: true }]))
            .toBe("Imported by: 4 files: web (2), app (1), docs (1), plus 1 test file");
    });

    it("counts test files apart: they leave the totals, the groups and the examples, and are tallied after them", () => {
        expect(importerLine("lib/a.ts", [
            { path: "app/x.ts", isTest: false },
            { path: "app/y.ts", isTest: false },
            { path: "lib/a.test.ts", isTest: true },
            { path: "web/y.spec.ts", isTest: true },
        ])).toBe("Imported by: 2 files: app (2), plus 2 test files");
    });

    it("says so when only test files import the file", () => {
        expect(importerLine("src/app/main.ts", [{ path: "src/app/main.test.ts", isTest: true }])).toBe("Imported by: only 1 test file");
        expect(importerLine("a/x.ts", [{ path: "a/x.test.ts", isTest: true }, { path: "b/test/y.ts", isTest: true }])).toBe("Imported by: only 2 test files");
    });
});

describe("renderFilePrompt", () => {
    it("starts with the imports/exports listing, then the line count, who imports the file, and the source", () => {
        expect(renderFilePrompt("File: src/a.ts\n\nImports:\n  (none)", 2, "Imported by: no other indexed file", "const a = 1;\nexport { a };\n"))
            .toBe("File: src/a.ts\n\nImports:\n  (none)\n\nLines: 2\nImported by: no other indexed file\n\nSource:\nconst a = 1;\nexport { a };\n");
    });

    it("puts the importers line right after the line count, and cuts the source at the limit it's given", () => {
        expect(renderFilePrompt("File: src/a.ts", 3, "Imported by: 2 files: src/main.ts (1), src/view.ts (1)", "aaaa\nbbbb\ncccc\n", 7))
            .toBe("File: src/a.ts\n\nLines: 3\nImported by: 2 files: src/main.ts (1), src/view.ts (1)\n\nSource:\naaaa\n… (truncated: 2 more lines)");
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

    it("drops each merged language's test marker and extension (E4, C9)", () => {
        const subject = (p: string) => testFileSummary(p, 1).tagline;
        expect(subject("polls/test_views.py")).toBe("Tests for views");
        expect(subject("polls/views_test.py")).toBe("Tests for views");
        expect(subject("stubs/test_shapes.pyi")).toBe("Tests for shapes");
        expect(subject("tsdb/head/server_test.go")).toBe("Tests for server");
        expect(subject("src/test/java/shop/OrderTests.java")).toBe("Tests for Order");
        expect(subject("src/test/java/shop/OrderTest.java")).toBe("Tests for Order");
        expect(subject("src/test/java/shop/OrderIT.java")).toBe("Tests for Order");
        expect(subject("src/test/java/shop/OrderTestCase.java")).toBe("Tests for Order");
        expect(subject("crates/hir/src/db_tests.rs")).toBe("Tests for db");
        expect(subject("crates/hir/src/db_test.rs")).toBe("Tests for db");
        // a file in a test folder with no marker keeps its name, as TypeScript's do
        expect(subject("tests/integration.rs")).toBe("Tests for integration");
        expect(subject("src/test/java/shop/Fixtures.java")).toBe("Tests for Fixtures");
        expect(testFileSummary("polls/test_views.py", 12)).toEqual({
            tagline: "Tests for views",
            summary: "Test code (12 lines) for views. Test files get this template instead of a model-written summary.",
        });
    });

    it("names the folder for a file that is only a marker or stands for its folder", () => {
        const subject = (p: string) => testFileSummary(p, 1).tagline;
        expect(subject("tests/admin_views/tests.py")).toBe("Tests for admin_views");
        expect(subject("polls/conftest.py")).toBe("Tests for polls");
        expect(subject("tests/forms/__init__.py")).toBe("Tests for forms");
        expect(subject("crates/hir-ty/src/tests.rs")).toBe("Tests for hir-ty");     // a src folder names nothing
        expect(subject("crates/hir-ty/src/infer/tests.rs")).toBe("Tests for infer");
        expect(subject("src/tests.rs")).toBe("Tests for tests");
        expect(subject("tests/common/mod.rs")).toBe("Tests for common");
        expect(subject("shop/Test.java")).toBe("Tests for shop");
        expect(subject("store/_test.go")).toBe("Tests for store");
        // at the root there's no folder to name: the file's own stem
        expect(subject("tests.py")).toBe("Tests for tests");
        expect(subject("conftest.py")).toBe("Tests for conftest");
    });

    it("keeps TypeScript's and JavaScript's subjects as they were", () => {
        const subject = (p: string) => testFileSummary(p, 1).tagline;
        expect(subject("src/a.spec.tsx")).toBe("Tests for a");
        expect(subject("build/b.test.mjs")).toBe("Tests for b");
        expect(subject("src/test/index.ts")).toBe("Tests for index");
        expect(subject("src/c.test.d.ts")).toBe("Tests for c.test.d");
    });
});

describe("testFolderSummary", () => {
    it("names the area above the first test segment", () => {
        expect(testFolderSummary("src/vs/editor/contrib/folding/test/browser", 6, "vscode")).toEqual({
            tagline: "Tests for folding",
            summary: "Test code (6 test files) for folding. Test-only folders get this template instead of a model-written summary.",
        });
        expect(testFolderSummary("src/vs/platform/configuration/test", 8, "vscode").tagline).toBe("Tests for configuration");
    });

    it("falls back to the folder's own name when no segment is a test folder", () => {
        expect(testFolderSummary("src/fixtures", 1, "vscode")).toEqual({
            tagline: "Tests for fixtures",
            summary: "Test code (1 test file) for fixtures. Test-only folders get this template instead of a model-written summary.",
        });
    });

    it("names a top-level test folder after the repo: it tests the whole thing", () => {
        expect(testFolderSummary("test", 12, "vscode")).toEqual({
            tagline: "Tests for vscode",
            summary: "Test code (12 test files) for vscode. Test-only folders get this template instead of a model-written summary.",
        });
        // below a top-level test folder, today's rule stands: the folder's own name
        expect(testFolderSummary("test/smoke", 4, "vscode").tagline).toBe("Tests for smoke");
        // the segment before the first test segment still names the area
        expect(testFolderSummary("src/vs/editor/contrib/folding/test/browser", 3, "vscode").tagline).toBe("Tests for folding");
    });
});
