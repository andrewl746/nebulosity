import { describe, expect, it } from "vitest";
import { FILES, FOLDERS } from "../../../test/helpers/mini-repo-facts";
import type { FileFacts, FolderFacts, StoredSummary } from "../../db/store/summaries";
import { inputHash, planSummaries, writtenByModel, type PlanOptions, type PlannedTarget } from "./plan";
import { PROMPT_VERSION, SUMMARY_MODELS } from "./prompts";

const options = (overrides: Partial<PlanOptions> = {}): PlanOptions => ({
    models: SUMMARY_MODELS, refreshStaleFolders: true, failedThisRun: new Set(), ...overrides,
});

const ALL_FILES = FILES.map((f) => f.path);
const states = (targets: PlannedTarget[]) => targets.map((t) => [t.path, t.state]);
const readyPaths = (targets: PlannedTarget[]) => targets.filter((t) => t.state === "ready").map((t) => t.path);

/** Pretends the listed targets were just written: a model summary "T:<path>" / "S:<path>", or the template. */
function written(targets: PlannedTarget[], paths: string[], earlier: StoredSummary[] = []): StoredSummary[] {
    const rows = new Map(earlier.map((s) => [`${s.kind}:${s.path}`, s]));

    for (const t of targets.filter((x) => paths.includes(x.path))){
        rows.set(`${t.kind}:${t.path}`, {
            id: 0, kind: t.kind, path: t.path, model: t.model, inputHash: t.inputHash, batchId: null, error: null,
            status: t.templateText ? "skipped" : "fresh",
            tagline: t.templateText?.tagline ?? `T:${t.path}`,
            summary: t.templateText?.summary ?? `S:${t.path}`,
        });
    }

    return [...rows.values()];
}

/** Plans, "writes" whatever is ready, and repeats until nothing is: every wave's plan, and the rows at the end. */
function allWaves(): { waves: PlannedTarget[][]; stored: StoredSummary[] } {
    const waves: PlannedTarget[][] = [];
    let stored: StoredSummary[] = [];

    for (;;){
        const plan = planSummaries(FILES, FOLDERS, stored, options());
        const go = plan.filter((t) => t.state === "ready" || t.state === "template").map((t) => t.path);
        if (go.length === 0) return { waves, stored };
        waves.push(plan);
        stored = written(plan, go, stored);
    }
}

describe("planSummaries — the first run", () => {
    it("queues files most-imported first, gives the test file its template, and holds every folder back", () => {
        expect(states(planSummaries(FILES, FOLDERS, [], options()))).toEqual([
            ["src/app/main.ts", "ready"],
            ["src/core/log.ts", "ready"],
            ["src/util/strings.ts", "ready"],
            ["src/app/view.tsx", "ready"],
            ["src/core/index.ts", "ready"],
            ["src/index.ts", "ready"],
            ["scripts/build.js", "ready"],
            ["src/util/strings.test.ts", "template"],
            ["src/app", "waiting"],
            ["src/core", "waiting"],
            ["src/util", "waiting"],
            ["src", "waiting"],
            ["scripts", "waiting"],
            ["", "waiting"],
        ]);
    });

    it("sends files to Haiku and folders and the repo to Sonnet, and marks new rows pending", () => {
        const byPath = new Map(planSummaries(FILES, FOLDERS, [], options()).map((t) => [t.path, t]));
        expect(byPath.get("src/core/log.ts")).toMatchObject({ kind: "file", model: "claude-haiku-5-5", status: "pending" });
        expect(byPath.get("src/core")).toMatchObject({ kind: "folder", model: "claude-sonnet-5-5", status: "pending" });
        expect(byPath.get("")).toMatchObject({ kind: "repo", model: "claude-sonnet-5-5" });
        expect(byPath.get("src/util/strings.test.ts")).toMatchObject({
            model: "template",
            status: "skipped",
            templateText: { tagline: "Tests for strings", summary: "Test code (3 lines) for strings. Test files get this template instead of a model-written summary." },
        });
    });
});

describe("planSummaries — bottom-up waves", () => {
    it("releases folders once their children are written: 7 files, then 4 folders, then src, then the repo", () => {
        expect(allWaves().waves.map(readyPaths)).toEqual([
            ["src/app/main.ts", "src/core/log.ts", "src/util/strings.ts", "src/app/view.tsx", "src/core/index.ts", "src/index.ts", "scripts/build.js"],
            ["src/app", "src/core", "src/util", "scripts"],
            ["src"],
            [""],
        ]);
    });

    it("builds each folder's prompt from its children's summaries, largest first", () => {
        const wave2 = allWaves().waves[1];
        const prompt = (p: string) => wave2.find((t) => t.path === p)?.prompt;
        expect(prompt("src/core")).toBe([
            "Folder: src/core",
            "2 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- log.ts (9 lines): T:src/core/log.ts — S:src/core/log.ts",
            "- index.ts (1 line): T:src/core/index.ts — S:src/core/index.ts",
        ].join("\n"));
        expect(prompt("src/util")).toBe([
            "Folder: src/util",
            "2 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- strings.ts (6 lines): T:src/util/strings.ts — S:src/util/strings.ts",
            "- strings.test.ts (3 lines): Tests for strings — Test code (3 lines) for strings. Test files get this template instead of a model-written summary.",
        ].join("\n"));
    });

    it("builds the repo's prompt from its top-level folders, and then everything is current", () => {
        const { waves, stored } = allWaves();
        expect(waves[3].find((t) => t.path === "")?.prompt).toBe(
            "Repository: mini-repo\n8 source files in 6 folders.\n\nTop-level contents, largest first:\n- src/ (7 files): T:src — S:src\n- scripts/ (1 file): T:scripts — S:scripts");
        expect(planSummaries(FILES, FOLDERS, stored, options()).every((t) => t.state === "current")).toBe(true);
    });
});

describe("planSummaries — after the first run", () => {
    it("redoes only an edited file; its folder stays current until the file's new summary changes the folder's input", () => {
        const edited = FILES.map((f) => (f.path === "src/core/log.ts" ? { ...f, contentHash: "h-log-2" } : f));
        const plan = planSummaries(edited, FOLDERS, allWaves().stored, options());
        expect(plan.filter((t) => t.state !== "current").map((t) => [t.path, t.state, t.status])).toEqual([["src/core/log.ts", "ready", "stale"]]);
    });

    it("leaves an out-of-date folder lazy on incremental runs, and redoes it on full runs", () => {
        const stored = allWaves().stored.map((s) => (s.path === "src/core/log.ts" ? { ...s, tagline: "T2:src/core/log.ts" } : s));
        const notCurrent = (refreshStaleFolders: boolean) =>
            states(planSummaries(FILES, FOLDERS, stored, options({ refreshStaleFolders })).filter((t) => t.state !== "current"));
        expect(notCurrent(false)).toEqual([["src/core", "lazy"]]);
        expect(notCurrent(true)).toEqual([["src/core", "ready"]]);
    });

    it("redoes every model-written file summary when the file model changes (inputHash covers the model)", () => {
        const plan = planSummaries(FILES, FOLDERS, allWaves().stored, options({ models: { ...SUMMARY_MODELS, file: "claude-sonnet-5-5" } }));
        expect(readyPaths(plan)).toEqual(["src/app/main.ts", "src/core/log.ts", "src/util/strings.ts", "src/app/view.tsx", "src/core/index.ts", "src/index.ts", "scripts/build.js"]);
    });

    it("comes back to current when an edit is undone", () => {
        const stored = allWaves().stored.map((s) => (s.path === "src/core/log.ts" ? { ...s, status: "stale" as const } : s));
        expect(planSummaries(FILES, FOLDERS, stored, options()).find((t) => t.path === "src/core/log.ts")).toMatchObject({ state: "current", status: "fresh" });
    });

    it("redoes a file summary written under prompt version 1, so prompt v2 reaches every file", () => {
        // the hash a version-1 run stored for log.ts: the planner's recipe for a file's input ("file", path, content hash), under version 1
        const stored = allWaves().stored.map((s) =>
            s.path === "src/core/log.ts" ? { ...s, inputHash: inputHash("claude-haiku-5-5", 1, "file\nsrc/core/log.ts\nh-log") } : s);
        expect(planSummaries(FILES, FOLDERS, stored, options()).find((t) => t.path === "src/core/log.ts"))
            .toMatchObject({ state: "ready", status: "stale" });
    });

    it("doesn't redo a file because more files import it: its hash covers the path and the bytes, not its importers", () => {
        const moreImported = FILES.map((f) => (f.path === "src/core/log.ts" ? { ...f, importedBy: f.importedBy + 40 } : f));
        expect(planSummaries(moreImported, FOLDERS, allWaves().stored, options()).every((t) => t.state === "current")).toBe(true);
    });
});

describe("planSummaries — in flight and failed", () => {
    it("never requeues a target a batch is carrying, and its folder waits for it", () => {
        const stored: StoredSummary[] = [{ id: 1, kind: "file", path: "src/app/main.ts", tagline: null, summary: null, model: null, inputHash: null, status: "pending", batchId: "batch-1", error: null }];
        const plan = planSummaries(FILES, FOLDERS, stored, options());
        expect(plan.find((t) => t.path === "src/app/main.ts")?.state).toBe("in-flight");
        expect(plan.find((t) => t.path === "src/app")?.state).toBe("waiting");
    });

    it("parks a target that failed earlier in this run, and lets its folder go ahead without it", () => {
        const stored = written(planSummaries(FILES, FOLDERS, [], options()), ALL_FILES.filter((p) => p !== "src/core/log.ts"));
        const plan = planSummaries(FILES, FOLDERS, stored, options({ failedThisRun: new Set(["file:src/core/log.ts"]) }));
        expect(plan.find((t) => t.path === "src/core/log.ts")?.state).toBe("failed");
        const core = plan.find((t) => t.path === "src/core");
        expect(core?.state).toBe("ready");
        expect(core?.prompt).toContain("- log.ts (9 lines): (no summary yet)");
    });
});

describe("planSummaries — files over the size cap (ADR-053, amended)", () => {
    const facts = (path: string, sizeBytes: number, isTest = false): FileFacts =>
        ({ path, contentHash: `h-${path}`, lineCount: 120, isTest, importedBy: 0, sizeBytes });
    const FOLDERS_SRC: FolderFacts[] = [
        { path: "", parentPath: null, depth: 0, name: "r", fileCount: 3, directFileCount: 0 },
        { path: "src", parentPath: "", depth: 1, name: "src", fileCount: 3, directFileCount: 3 },
    ];
    const SUMMARY = "Too large to read in full (120 lines, over the 1 MB size cap): only its imports are indexed. "
        + "Files over the cap get this template instead of a model-written summary.";

    it("gives a non-test file over the cap a template, not a model: it is indexed for its imports only", () => {
        const files = [facts("src/bundle.cjs", 1_000_001), facts("src/main.ts", 1_000_000), facts("src/huge.test.ts", 1_500_000, true)];
        const byPath = new Map(planSummaries(files, FOLDERS_SRC, [], options()).map((t) => [t.path, t]));

        expect(byPath.get("src/bundle.cjs")).toMatchObject({
            kind: "file", model: "template", state: "template", status: "skipped",
            templateText: { tagline: "Over the size cap: imports only", summary: SUMMARY },
        });
        expect(byPath.get("src/bundle.cjs")?.inputHash)
            .toBe(inputHash("template", PROMPT_VERSION, `src/bundle.cjs\nOver the size cap: imports only\n${SUMMARY}`));
        // exactly at the cap is read in full, so it is summarized as before
        expect(byPath.get("src/main.ts")).toMatchObject({ model: SUMMARY_MODELS.file, state: "ready" });
        // a test file keeps its test template, whatever its size
        expect(byPath.get("src/huge.test.ts")?.templateText?.tagline).toBe("Tests for huge");
    });

    it("takes the cap from the options when one is given", () => {
        const byPath = new Map(planSummaries([facts("src/a.ts", 2_000)], FOLDERS_SRC, [], options({ maxFileBytes: 1_000 })).map((t) => [t.path, t]));
        expect(byPath.get("src/a.ts")).toMatchObject({ model: "template", state: "template" });
        expect(byPath.get("src/a.ts")?.templateText?.summary).toContain("over the 1,000-byte size cap");
    });
});

describe("planSummaries — test-only folders", () => {
    const file = (path: string, lineCount: number, isTest: boolean): FileFacts => ({ path, contentHash: `h-${path}`, lineCount, isTest, importedBy: 0, sizeBytes: 100 });
    const folder = (path: string, parentPath: string | null, depth: number, fileCount: number, directFileCount: number): FolderFacts =>
        ({ path, parentPath, depth, name: path.slice(path.lastIndexOf("/") + 1), fileCount, directFileCount });
    const TEMPLATE_SUMMARY = "Test code (1 test file) for a. Test-only folders get this template instead of a model-written summary.";

    const nestedFiles = [file("a/x.ts", 10, false), file("a/test/unit/x.test.ts", 5, true)];
    const nestedFolders = [
        folder("", null, 0, 2, 0),
        folder("a", "", 1, 2, 1),
        folder("a/test", "a", 2, 1, 0),
        folder("a/test/unit", "a/test", 3, 1, 1),
    ];

    it("gives a test-only folder and its test-only subfolder a template, and the parent waits only on its own file", () => {
        const first = planSummaries(nestedFiles, nestedFolders, [], options());
        const byPath = new Map(first.map((t) => [t.path, t]));

        for (const path of ["a/test", "a/test/unit"]){
            expect(byPath.get(path)).toMatchObject({
                kind: "folder", model: "template", state: "template", status: "skipped",
                templateText: { tagline: "Tests for a", summary: TEMPLATE_SUMMARY },
            });
        }
        expect(byPath.get("a/test")?.inputHash).toBe(inputHash("template", PROMPT_VERSION, `a/test\nTests for a\n${TEMPLATE_SUMMARY}`));
        expect(byPath.get("a")?.state).toBe("waiting");

        const second = planSummaries(nestedFiles, nestedFolders, written(first, ["a/x.ts", "a/test", "a/test/unit"]), options());
        const a = second.find((t) => t.path === "a");
        expect(a?.state).toBe("ready");
        expect(a?.prompt).toContain(`- test/ (1 file): Tests for a — ${TEMPLATE_SUMMARY}`);
        // the templates are in place, so they are current and need no write
        expect(second.find((t) => t.path === "a/test")).toMatchObject({ state: "current", status: null });
    });

    it("does not template a folder that holds a non-test file, directly or below", () => {
        const files = [file("b/a.test.ts", 4, true), file("b/c.ts", 6, false), file("d/sub/e.ts", 2, false), file("d/f.test.ts", 3, true)];
        const folders = [
            folder("", null, 0, 4, 0), folder("b", "", 1, 2, 2), folder("d", "", 1, 2, 1), folder("d/sub", "d", 2, 1, 1),
        ];
        const byPath = new Map(planSummaries(files, folders, [], options()).map((t) => [t.path, t]));
        expect(byPath.get("b")).toMatchObject({ model: "claude-sonnet-5-5", state: "waiting" });
        expect(byPath.get("d")).toMatchObject({ model: "claude-sonnet-5-5", state: "waiting" });
        expect(byPath.get("d/sub")).toMatchObject({ model: "claude-sonnet-5-5", state: "waiting" });
    });

    it("does not template a folder with no files", () => {
        const byPath = new Map(planSummaries([], [folder("", null, 0, 0, 0), folder("empty", "", 1, 0, 0)], [], options()).map((t) => [t.path, t]));
        expect(byPath.get("empty")).toMatchObject({ model: "claude-sonnet-5-5", state: "ready" });
    });

    it("templates a top-level test folder with the repo's name, taken from the root folder's row", () => {
        const files = [file("src/a.ts", 5, false), file("test/a.test.ts", 7, true)];
        const folders = [
            { ...folder("", null, 0, 2, 0), name: "acme" },
            folder("src", "", 1, 1, 1),
            folder("test", "", 1, 1, 1),
        ];
        const byPath = new Map(planSummaries(files, folders, [], options()).map((t) => [t.path, t]));
        expect(byPath.get("test")?.templateText?.tagline).toBe("Tests for acme");
    });

    it("never templates the repo, even when every file in it is a test", () => {
        const files = [file("t/x.test.ts", 4, true)];
        const folders = [folder("", null, 0, 1, 0), folder("t", "", 1, 1, 1)];
        const byPath = new Map(planSummaries(files, folders, [], options()).map((t) => [t.path, t]));
        expect(byPath.get("t")).toMatchObject({ model: "template", state: "template" });
        expect(byPath.get("")).toMatchObject({ kind: "repo", model: "claude-sonnet-5-5", state: "ready" });
        expect(byPath.get("")?.templateText).toBeUndefined();
    });
});

describe("inputHash", () => {
    it("changes with the model, the prompt version and the input, and only with them", () => {
        const base = inputHash("claude-haiku-5-5", PROMPT_VERSION, "input");
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION, "input")).toBe(base);
        expect(inputHash("claude-sonnet-5-5", PROMPT_VERSION, "input")).not.toBe(base);
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION + 1, "input")).not.toBe(base);
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION, "input2")).not.toBe(base);
    });
});

describe("writtenByModel", () => {
    const file = (over: Partial<FileFacts>): FileFacts => ({ path: "a.ts", contentHash: "h", lineCount: 1, isTest: false, importedBy: 0, sizeBytes: 100, ...over });

    it("is true only for a non-test file within the size cap: tests and over-cap files get templates", () => {
        expect(writtenByModel(file({}))).toBe(true);
        expect(writtenByModel(file({ sizeBytes: 1_000_000 }))).toBe(true);    // exactly the cap is still read in full
        expect(writtenByModel(file({ sizeBytes: 1_000_001 }))).toBe(false);   // indexed for its imports only (ADR-053)
        expect(writtenByModel(file({ isTest: true }))).toBe(false);
        expect(writtenByModel(file({ sizeBytes: 500 }), 400)).toBe(false);    // a smaller cap, as planSummaries' option
    });
});
