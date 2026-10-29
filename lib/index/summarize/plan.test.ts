import { describe, expect, it } from "vitest";
import { FILES, FOLDERS } from "../../../test/helpers/mini-repo-facts";
import type { FileFacts, FolderFacts, StoredSummary } from "../../db/store/summaries";
import { foldersAbove, inputHash, planSummaries, writtenByModel, type PlanOptions, type PlannedTarget } from "./plan";
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
            promptVersion: t.templateText ? null : PROMPT_VERSION,
            status: t.templateText ? "skipped" : "fresh",
            tagline: t.templateText?.tagline ?? `T:${t.path}`,
            summary: t.templateText?.summary ?? `S:${t.path}`,
        });
    }

    return [...rows.values()];
}

/**
 * Every folder's and the repo's prompt body (the prompt less its length line) once each of their children holds the
 * text written() gives it, transcribed by hand from the mini-repo's facts. Every summary in them is one line, so prompt
 * version 2 rendered the same bodies.
 */
const BODIES: Record<string, string> = {
    "src/app": [
        "Folder: src/app",
        "2 source files in total, 2 directly inside.",
        "",
        "Contents, largest first:",
        "- view.tsx (11 lines): T:src/app/view.tsx — S:src/app/view.tsx",
        "- main.ts (8 lines): T:src/app/main.ts — S:src/app/main.ts",
    ].join("\n"),
    "src/core": [
        "Folder: src/core",
        "2 source files in total, 2 directly inside.",
        "",
        "Contents, largest first:",
        "- log.ts (9 lines): T:src/core/log.ts — S:src/core/log.ts",
        "- index.ts (1 line): T:src/core/index.ts — S:src/core/index.ts",
    ].join("\n"),
    "src/util": [
        "Folder: src/util",
        "2 source files in total, 2 directly inside.",
        "",
        "Contents, largest first:",
        "- strings.ts (6 lines): T:src/util/strings.ts — S:src/util/strings.ts",
        "- strings.test.ts (3 lines): Tests for strings — Test code (3 lines) for strings. Test files get this template instead of a model-written summary.",
    ].join("\n"),
    // app/ has 19 lines below it, core/ 10, util/ 9 and index.ts 7
    "src": [
        "Folder: src",
        "7 source files in total, 1 directly inside.",
        "",
        "Contents, largest first:",
        "- app/ (2 files): T:src/app — S:src/app",
        "- core/ (2 files): T:src/core — S:src/core",
        "- util/ (2 files): T:src/util — S:src/util",
        "- index.ts (7 lines): T:src/index.ts — S:src/index.ts",
    ].join("\n"),
    "scripts": [
        "Folder: scripts",
        "1 source file in total, 1 directly inside.",
        "",
        "Contents, largest first:",
        "- build.js (3 lines): T:scripts/build.js — S:scripts/build.js",
    ].join("\n"),
    "": [
        "Repository: mini-repo",
        "8 source files in 6 folders.",
        "",
        "Top-level contents, largest first:",
        "- src/ (7 files): T:src — S:src",
        "- scripts/ (1 file): T:scripts — S:scripts",
    ].join("\n"),
};

const CONTENT_HASHES = new Map(FILES.map((f) => [f.path, f.contentHash]));

/**
 * The same rows as Nebulosity 1.0 stored them: every model-written row at prompt version 2, with its input hashed under
 * version 2 (a file's from its path and content hash, a folder's and the repo's from BODIES). Templates stay as they are.
 */
function inV2(stored: StoredSummary[]): StoredSummary[] {
    return stored.map((s) => {
        if (!s.model || s.model === "template") return s;
        const input = s.kind === "file" ? `file\n${s.path}\n${CONTENT_HASHES.get(s.path)}` : BODIES[s.path];
        return { ...s, promptVersion: 2, inputHash: inputHash(s.model, 2, input) };
    });
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
        // 2 files each, so both are small
        expect(prompt("src/core")).toBe(`${BODIES["src/core"]}\n\nWrite at most 50 words, in 2 paragraphs, and name at most 2 files or subfolders.`);
        expect(prompt("src/util")).toBe(`${BODIES["src/util"]}\n\nWrite at most 50 words, in 2 paragraphs, and name at most 2 files or subfolders.`);
    });

    it("builds the repo's prompt from its top-level folders, and then everything is current", () => {
        const { waves, stored } = allWaves();
        expect(waves[3].find((t) => t.path === "")?.prompt).toBe(
            `${BODIES[""]}\n\nWrite at most 150 words, in up to 5 paragraphs, as many as it needs, and name at most 5 folders or files.`);
        expect(planSummaries(FILES, FOLDERS, stored, options()).every((t) => t.state === "current")).toBe(true);
    });

    it("hashes a folder's prompt without its length line", () => {
        const core = allWaves().waves[1].find((t) => t.path === "src/core");
        expect(core?.inputHash).toBe(inputHash("claude-sonnet-5-5", PROMPT_VERSION, BODIES["src/core"]));
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

    it("doesn't redo a file because more files import it: its hash covers the path and the bytes, not its importers", () => {
        const moreImported = FILES.map((f) => (f.path === "src/core/log.ts" ? { ...f, importedBy: f.importedBy + 40 } : f));
        expect(planSummaries(moreImported, FOLDERS, allWaves().stored, options()).every((t) => t.state === "current")).toBe(true);
    });
});

// P1 and P2: what an older prompt wrote stays current until a plan is asked to restyle it, unless its input changed too
describe("planSummaries — summaries an older prompt wrote", () => {
    const notCurrent = (targets: PlannedTarget[]) =>
        targets.filter((t) => t.state !== "current").map((t) => [t.path, t.state, t.status, t.restyle]);

    it("leaves everything 1.0 wrote current, status fresh, when nothing changed", () => {
        const stored = inV2(allWaves().stored);
        // the 7 files, 5 folders and the repo; the test file's template is the 14th row
        expect(stored.filter((s) => s.promptVersion === 2)).toHaveLength(13);
        const plan = planSummaries(FILES, FOLDERS, stored, options());
        expect(plan).toHaveLength(14);
        expect(plan.filter((t) => t.state !== "current" || t.status !== null || t.restyle).map((t) => t.path)).toEqual([]);
    });

    it("redoes everything 1.0 wrote under restyle all, bottom-up, keeping each status fresh", () => {
        const plan = planSummaries(FILES, FOLDERS, inV2(allWaves().stored), options({ restyle: "all" }));
        expect(plan.map((t) => [t.path, t.state, t.status, t.restyle])).toEqual([
            ["src/app/main.ts", "ready", null, true],
            ["src/core/log.ts", "ready", null, true],
            ["src/util/strings.ts", "ready", null, true],
            ["src/app/view.tsx", "ready", null, true],
            ["src/core/index.ts", "ready", null, true],
            ["src/index.ts", "ready", null, true],
            ["scripts/build.js", "ready", null, true],
            ["src/util/strings.test.ts", "current", null, undefined],
            ["src/app", "waiting", null, true],
            ["src/core", "waiting", null, true],
            ["src/util", "waiting", null, true],
            ["src", "waiting", null, true],
            ["scripts", "waiting", null, true],
            ["", "waiting", null, true],
        ]);
    });

    it("restyles only the target it's told to, so a folder whose children 1.0 wrote is ready", () => {
        const plan = planSummaries(FILES, FOLDERS, inV2(allWaves().stored), options({ restyle: { path: "src/core" } }));
        expect(notCurrent(plan)).toEqual([["src/core", "ready", null, true]]);
    });

    it("calls a file 1.0 wrote out of date when its content changed too", () => {
        const edited = FILES.map((f) => (f.path === "src/core/log.ts" ? { ...f, contentHash: "h-log-2" } : f));
        const stored = inV2(allWaves().stored);
        expect(notCurrent(planSummaries(edited, FOLDERS, stored, options()))).toEqual([["src/core/log.ts", "ready", "stale", undefined]]);
        // a restyle doesn't change that: the file is redone because it changed
        const log = planSummaries(edited, FOLDERS, stored, options({ restyle: "all" })).find((t) => t.path === "src/core/log.ts");
        expect([log?.state, log?.status, log?.restyle]).toEqual(["ready", "stale", undefined]);
    });

    it("calls a folder 1.0 wrote out of date once a child's text changes", () => {
        const stored = inV2(allWaves().stored).map((s) => (s.path === "src/core/log.ts" ? { ...s, tagline: "T2:src/core/log.ts" } : s));
        expect(notCurrent(planSummaries(FILES, FOLDERS, stored, options({ refreshStaleFolders: false })))).toEqual([["src/core", "lazy", "stale", undefined]]);
        expect(notCurrent(planSummaries(FILES, FOLDERS, stored, options({ refreshStaleFolders: true })))).toEqual([["src/core", "ready", "stale", undefined]]);
    });

    // Q2 B and the Task 4 review's I1: only opening a stale folder an older prompt wrote rewrites it, so it mustn't hold up its parent
    it("lets a stale folder 1.0 wrote wait to be opened when told to, so the folder above it can go", () => {
        // log.ts rewritten in the current style (as an opened panel would): src/core's input changed, src's didn't
        const stored = inV2(allWaves().stored).map((s) => (s.path === "src/core/log.ts"
            ? { ...s, tagline: "T3:src/core/log.ts", promptVersion: PROMPT_VERSION, inputHash: inputHash("claude-haiku-5-5", PROMPT_VERSION, "file\nsrc/core/log.ts\nh-log") }
            : s));
        const plan = (overrides: Partial<PlanOptions>) => notCurrent(planSummaries(FILES, FOLDERS, stored, options(overrides)));

        // src opened: src/core waits to be opened itself, settled, so src is ready
        expect(plan({ restyle: { path: "src" }, olderFoldersWaitToBeOpened: true })).toEqual([["src/core", "lazy", "stale", undefined], ["src", "ready", null, true]]);
        // without the option, as a full run plans: src/core is ready, and src waits for it
        expect(plan({ restyle: { path: "src" } })).toEqual([["src/core", "ready", "stale", undefined], ["src", "waiting", null, true]]);
        // src/core opened itself: it's ready, and src's input is still unchanged
        expect(plan({ restyle: { path: "src/core" }, olderFoldersWaitToBeOpened: true })).toEqual([["src/core", "ready", "stale", undefined]]);
        // a stale src/core the current prompt wrote is ready as before, so src waits for it
        const current = stored.map((s) => (s.path === "src/core" ? { ...s, promptVersion: PROMPT_VERSION } : s));
        expect(notCurrent(planSummaries(FILES, FOLDERS, current, options({ restyle: { path: "src" }, olderFoldersWaitToBeOpened: true }))))
            .toEqual([["src/core", "ready", "stale", undefined], ["src", "waiting", null, true]]);
    });

    it("keeps a folder 1.0 wrote current when a child's 1.0 summary holds a blank line", () => {
        // the body version 2 rendered, with log.ts's summary verbatim
        const body = [
            "Folder: src/core",
            "2 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- log.ts (9 lines): T:src/core/log.ts — S1.",
            "",
            "S2.",
            "- index.ts (1 line): T:src/core/index.ts — S:src/core/index.ts",
        ].join("\n");
        const stored = inV2(allWaves().stored).map((s) =>
            s.path === "src/core/log.ts" ? { ...s, summary: "S1.\n\nS2." }
            : s.path === "src/core" ? { ...s, inputHash: inputHash("claude-sonnet-5-5", 2, body) }
            : s);
        expect(planSummaries(FILES, FOLDERS, stored, options()).find((t) => t.path === "src/core")).toMatchObject({ state: "current", status: null });
    });

    it("reads a null prompt version as 2, and a version 1 hash as out of date", () => {
        // log.ts's row with no prompt version, its input hashed under the version given
        const unrecorded = (version: number) => inV2(allWaves().stored).map((s) =>
            s.path === "src/core/log.ts" ? { ...s, promptVersion: null, inputHash: inputHash("claude-haiku-5-5", version, "file\nsrc/core/log.ts\nh-log") } : s);
        const log = (stored: StoredSummary[]) => {
            const target = planSummaries(FILES, FOLDERS, stored, options()).find((t) => t.path === "src/core/log.ts");
            return [target?.state, target?.status, target?.restyle];
        };
        expect(log(unrecorded(2))).toEqual(["current", null, undefined]);
        expect(log(unrecorded(1))).toEqual(["ready", "stale", undefined]);
    });

    it("rewrites every template once after the version bump, for free", () => {
        const summary = "Test code (3 lines) for strings. Test files get this template instead of a model-written summary.";
        const stored = inV2(allWaves().stored).map((s) =>
            s.path === "src/util/strings.test.ts" ? { ...s, inputHash: inputHash("template", 2, `src/util/strings.test.ts\nTests for strings\n${summary}`) } : s);
        const plan = planSummaries(FILES, FOLDERS, stored, options());
        expect(plan.find((t) => t.path === "src/util/strings.test.ts")).toMatchObject({
            model: "template", state: "template", status: "skipped", templateText: { tagline: "Tests for strings", summary },
        });
        // its text is the same, so src/util's input hasn't changed and no model is asked for anything
        expect(notCurrent(plan)).toEqual([["src/util/strings.test.ts", "template", "skipped", undefined]]);
    });
});

// R24 (the pre-ship pass's final review, A-I1): what a full run redoes besides what plans as ready
describe("foldersAbove", () => {
    const paths = (targets: PlannedTarget[]) => targets.map((t) => t.path);

    it("after a file model change, is every folder and the repo, deepest first, though each plans as current", () => {
        const plan = planSummaries(FILES, FOLDERS, allWaves().stored, options({ models: { ...SUMMARY_MODELS, file: "claude-haiku-6" } }));
        const files = plan.filter((t) => t.state === "ready");
        expect(plan.filter((t) => t.kind !== "file").every((t) => t.state === "current")).toBe(true);
        // depth 2 (src/app, src/core, src/util: 2 files each, so by path), then depth 1 (src's 7 files before scripts' 1), then the repo
        expect(paths(foldersAbove(plan, files))).toEqual(["src/app", "src/core", "src/util", "src", "scripts", ""]);
    });

    it("after an edit, is the edited file's folders up to the repo, and leaves out what's already counted", () => {
        const edited = FILES.map((f) => (f.path === "src/core/log.ts" ? { ...f, contentHash: "h-log-2" } : f));
        const plan = planSummaries(edited, FOLDERS, allWaves().stored, options());
        const log = plan.filter((t) => t.path === "src/core/log.ts");
        expect(paths(foldersAbove(plan, log))).toEqual(["src/core", "src", ""]);
        // src/core already counted (waiting or ready, say): only what's above it is new
        expect(paths(foldersAbove(plan, [...log, plan.find((t) => t.path === "src/core")!]))).toEqual(["src", ""]);
        expect(foldersAbove(plan, [])).toEqual([]);
    });

    it("stops at a folder that failed this run: it waits for the next run, so nothing above it changes through it", () => {
        const edited = FILES.map((f) => (f.path === "src/core/log.ts" || f.path === "scripts/build.js" ? { ...f, contentHash: `${f.contentHash}-2` } : f));
        const plan = planSummaries(edited, FOLDERS, allWaves().stored, options({ failedThisRun: new Set(["folder:src"]) }));
        expect(plan.find((t) => t.path === "src")?.state).toBe("failed");
        const files = plan.filter((t) => t.kind === "file" && t.state === "ready");
        // log.ts reaches src/core, then src stops it; build.js reaches scripts and the repo
        expect(paths(foldersAbove(plan, files))).toEqual(["src/core", "scripts", ""]);
    });

    it("leaves out a test-only folder, which gets a template", () => {
        const withTests: FileFacts[] = [...FILES, { path: "test/unit/a.test.ts", contentHash: "h-a", lineCount: 4, isTest: true, importedBy: 0, sizeBytes: 50 }];
        const withTestFolders: FolderFacts[] = [
            ...FOLDERS.map((f) => (f.path === "" ? { ...f, fileCount: 9 } : f)),
            { path: "test", parentPath: "", depth: 1, name: "test", fileCount: 1, directFileCount: 0 },
            { path: "test/unit", parentPath: "test", depth: 2, name: "unit", fileCount: 1, directFileCount: 1 },
        ];
        const plan = planSummaries(withTests, withTestFolders, [], options());
        // the test file stands in for a written target: the walk up from it meets test/unit, a template, and counts nothing
        const templated = plan.filter((t) => t.path === "test/unit/a.test.ts");
        expect(plan.filter((t) => t.path.startsWith("test")).map((t) => t.model)).toEqual(["template", "template", "template"]);
        expect(paths(foldersAbove(plan, templated))).toEqual([]);
    });
});

describe("planSummaries — in flight and failed", () => {
    it("never requeues a target a batch is carrying, and its folder waits for it", () => {
        const stored: StoredSummary[] = [{ id: 1, kind: "file", path: "src/app/main.ts", tagline: null, summary: null, model: null, inputHash: null, promptVersion: null, status: "pending", batchId: "batch-1", error: null }];
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
