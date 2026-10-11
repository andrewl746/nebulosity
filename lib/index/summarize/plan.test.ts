import { describe, expect, it } from "vitest";
import { FILES, FOLDERS } from "../../../test/helpers/mini-repo-facts";
import type { StoredSummary } from "../../db/store/summaries";
import { inputHash, planSummaries, type PlanOptions, type PlannedTarget } from "./plan";
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

describe("inputHash", () => {
    it("changes with the model, the prompt version and the input, and only with them", () => {
        const base = inputHash("claude-haiku-5-5", PROMPT_VERSION, "input");
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION, "input")).toBe(base);
        expect(inputHash("claude-sonnet-5-5", PROMPT_VERSION, "input")).not.toBe(base);
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION + 1, "input")).not.toBe(base);
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION, "input2")).not.toBe(base);
    });
});
