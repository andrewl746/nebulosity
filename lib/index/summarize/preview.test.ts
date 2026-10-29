import { describe, expect, it } from "vitest";
import { copyFixture } from "../../../test/helpers/fixture";
import { FILES, FOLDERS } from "../../../test/helpers/mini-repo-facts";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { files } from "../../db/schema";
import { requireRepository } from "../../db/store/structure";
import { loadSummaries, loadUsage, type StoredSummary, type SummaryText } from "../../db/store/summaries";
import { repoKey } from "../paths";
import { indexRepository } from "../pipeline";
import { planSummaries, type PlannedTarget } from "./plan";
import { FILE_SYSTEM_PROMPT, FOLDER_SYSTEM_PROMPT, PROMPT_VERSION, SUMMARY_MODELS } from "./prompts";
import {
    answeredRow, nextWave, previewRepoFolders, renderFolderPreview, runFolderPreview, SampleNotIndexedError, selectSample, unfinished,
    type FolderPreview,
} from "./preview";
import { runSummaries } from "./run";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "./types";

const PLAN_OPTIONS = { models: SUMMARY_MODELS, refreshStaleFolders: true, failedThisRun: new Set<string>() };

/** A file's prompt for the DB-free tests: the stub reads the target from the first line, as from buildFilePrompt's. */
const filePrompt = (file: { path: string }): string => `File: ${file.path}\n(source)`;

/** Runs the preview over the hand-derived facts, with no index behind them. */
function preview(sample: string[], summarizer: Summarizer, stored: StoredSummary[] = [], onProgress?: (message: string) => void): Promise<FolderPreview> {
    return runFolderPreview({ files: FILES, folders: FOLDERS, stored, sample, summarizer, filePrompt, onProgress });
}

type Answer = (request: SummaryRequest) => SummaryOutcome;

/** An answer with this text, written by the requested model, with these tokens. */
const ok = (text: SummaryText, inputTokens: number, outputTokens: number): Answer => (r) => ({
    customId: r.customId, ok: true, text, model: r.model, usage: [{ model: r.model, inputTokens, outputTokens }],
});

/** A request that got no reply at all: nothing to bill. */
const noReply = (error: string): Answer => (r) => ({ customId: r.customId, ok: false, error, model: null, usage: null });

/** A summarizer that answers each target (named on the prompt's first line, as the stub reads it) as scripted. */
function scripted(answers: Record<string, Answer>): Summarizer {
    return {
        async summarize(request){
            const first = request.prompt.split("\n")[0];
            const answer = answers[first.slice(first.indexOf(": ") + 2)];
            if (!answer) throw new Error(`nothing scripted for ${first}`);
            return answer(request);
        },
        submitBatch: () => Promise.reject(new Error("the preview never uses batches")),
        batchResults: () => Promise.reject(new Error("the preview never uses batches")),
    };
}

describe("selectSample", () => {
    it("covers every file and folder at or under each sample folder, in path order", () => {
        const scope = selectSample(FILES, FOLDERS, ["src"]);

        // the 7 files under src/ (its test file included: the planner templates it); scripts/build.js is outside
        expect(scope.files.map((f) => f.path)).toEqual([
            "src/app/main.ts", "src/app/view.tsx", "src/core/index.ts", "src/core/log.ts", "src/index.ts",
            "src/util/strings.test.ts", "src/util/strings.ts",
        ]);
        expect(scope.folders.map((f) => f.path)).toEqual(["src", "src/app", "src/core", "src/util"]);
        expect(scope.keys).toEqual(new Set([
            "file:src/app/main.ts", "file:src/app/view.tsx", "file:src/core/index.ts", "file:src/core/log.ts", "file:src/index.ts",
            "file:src/util/strings.test.ts", "file:src/util/strings.ts",
            "folder:src", "folder:src/app", "folder:src/core", "folder:src/util",
        ]));
        expect(scope.missing).toEqual([]);
    });

    it("compares whole path segments, and names the sample folders the index doesn't have", () => {
        // src/application.ts starts with "src/app" but isn't inside src/app
        const files = [...FILES, { path: "src/application.ts", contentHash: "h-x", lineCount: 1, isTest: false, importedBy: 0, sizeBytes: 10 }];
        const scope = selectSample(files, FOLDERS, ["src/app", "lib/missing"]);

        expect(scope.files.map((f) => f.path)).toEqual(["src/app/main.ts", "src/app/view.tsx"]);
        expect(scope.folders.map((f) => f.path)).toEqual(["src/app"]);
        expect(scope.missing).toEqual(["lib/missing"]);
    });
});

describe("nextWave", () => {
    it("takes the ready targets in the sample, in the plan's order, leaving out any already sent", () => {
        const plan = planSummaries(FILES, FOLDERS, [], PLAN_OPTIONS);
        const scope = selectSample(FILES, FOLDERS, ["src"]);
        const keys = (targets: PlannedTarget[]) => targets.map((t) => `${t.kind}:${t.path}`);

        // Every non-test file is ready and no folder is (each waits on a file). The plan puts files most-imported first:
        // main.ts and log.ts (3), strings.ts (2), then view.tsx, core/index.ts, index.ts (1 each, by path).
        // scripts/build.js is ready too, but outside the sample.
        expect(keys(nextWave(plan, scope, new Set()))).toEqual([
            "file:src/app/main.ts", "file:src/core/log.ts", "file:src/util/strings.ts",
            "file:src/app/view.tsx", "file:src/core/index.ts", "file:src/index.ts",
        ]);
        // a target already sent never goes again, even while the plan still calls it ready
        expect(keys(nextWave(plan, scope, new Set(["file:src/app/main.ts", "file:src/core/log.ts"])))).toEqual([
            "file:src/util/strings.ts", "file:src/app/view.tsx", "file:src/core/index.ts", "file:src/index.ts",
        ]);
    });
});

describe("answeredRow", () => {
    it("records an answer as a fresh row carrying the planned hash, so the planner then calls the target current", () => {
        const target = planSummaries(FILES, FOLDERS, [], PLAN_OPTIONS).find((t) => t.path === "src/core/log.ts")!;
        const outcome = {
            customId: "file:src/core/log.ts", ok: true as const, text: { tagline: "Logger", summary: "Logs things." },
            model: "claude-haiku-5-5", usage: [{ model: "claude-haiku-5-5", inputTokens: 100, outputTokens: 20 }],
        };

        const row = answeredRow(target, outcome, undefined);
        expect(row).toEqual({
            id: 0, kind: "file", path: "src/core/log.ts", tagline: "Logger", summary: "Logs things.", model: "claude-haiku-5-5",
            inputHash: target.inputHash, promptVersion: null, status: "fresh", batchId: null, error: null,
        });
        // a row the index already had keeps its id
        expect(answeredRow(target, outcome, { ...row, id: 42, tagline: "Old", inputHash: "old" }).id).toBe(42);

        const replanned = planSummaries(FILES, FOLDERS, [row], PLAN_OPTIONS).find((t) => t.path === "src/core/log.ts")!;
        expect(replanned.state).toBe("current");
    });
});

describe("runFolderPreview", () => {
    it("sends the files, then each folder once its subfolders are answered, bottom-up", async () => {
        const stub = stubSummarizer();
        const messages: string[] = [];
        const result = await preview(["src"], stub.summarizer, [], (m) => messages.push(m));

        // wave 1: the six files (nextWave's order); wave 2: src's subfolders, every child now current
        // (strings.test.ts is a template); wave 3: src, once all three are; then nothing in the sample is left
        expect(result.waves).toEqual([
            ["file:src/app/main.ts", "file:src/core/log.ts", "file:src/util/strings.ts", "file:src/app/view.tsx", "file:src/core/index.ts", "file:src/index.ts"],
            ["folder:src/app", "folder:src/core", "folder:src/util"],
            ["folder:src"],
        ]);
        expect(stub.subjects()).toEqual([
            "File: src/app/main.ts", "File: src/core/log.ts", "File: src/util/strings.ts", "File: src/app/view.tsx", "File: src/core/index.ts", "File: src/index.ts",
            "Folder: src/app", "Folder: src/core", "Folder: src/util",
            "Folder: src",
        ]);
        expect(stub.requests.slice(0, 6).every((r) => r.model === "claude-haiku-5-5" && r.system === FILE_SYSTEM_PROMPT)).toBe(true);
        expect(stub.requests.slice(6).every((r) => r.model === "claude-sonnet-5-5" && r.system === FOLDER_SYSTEM_PROMPT)).toBe(true);
        expect(unfinished(result)).toEqual([]);
        expect(messages).toEqual([
            "wave 1: 6 files", "wave 1 done: 6 summarized, 0 failed",
            "wave 2: 3 folders", "wave 2 done: 3 summarized, 0 failed",
            "wave 3: 1 folder", "wave 3 done: 1 summarized, 0 failed",
        ]);
    });

    it("sends a folder whose child failed, with \"(no summary yet)\" for that child, as a run does", async () => {
        const stub = stubSummarizer({ failPaths: ["src/core/log.ts"], texts: { "src/core/index.ts": { tagline: "Core barrel", summary: "Re-exports the logger." } } });
        const messages: string[] = [];
        const result = await preview(["src/core"], stub.summarizer, [], (m) => messages.push(m));

        // log.ts (imported by 3) goes before index.ts (1); its failure settles it, so src/core goes next
        expect(result.waves).toEqual([["file:src/core/log.ts", "file:src/core/index.ts"], ["folder:src/core"]]);
        expect(result.answers.get("file:src/core/log.ts")).toMatchObject({ ok: false, error: "stub failure" });
        // the folder prompt renderFolderPrompt builds: largest first, log.ts (9 lines) before index.ts (1 line)
        expect(stub.requests[2].prompt).toBe([
            "Folder: src/core",
            "2 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- log.ts (9 lines): (no summary yet)",
            "- index.ts (1 line): Core barrel — Re-exports the logger.",
        ].join("\n"));
        expect(messages).toContain("wave 1 done: 1 summarized, 1 failed");
    });

    it("leaves a summary the index already holds as it is, and its folder's prompt shows it", async () => {
        const logHash = planSummaries(FILES, FOLDERS, [], PLAN_OPTIONS).find((t) => t.path === "src/core/log.ts")!.inputHash;
        const stored: StoredSummary[] = [{
            id: 7, kind: "file", path: "src/core/log.ts", tagline: "Stored logger", summary: "From an earlier run.", model: "claude-haiku-5-5",
            inputHash: logHash, promptVersion: PROMPT_VERSION, status: "fresh", batchId: null, error: null,
        }];
        const stub = stubSummarizer({ texts: { "src/core/index.ts": { tagline: "Core barrel", summary: "Re-exports the logger." } } });
        const result = await preview(["src/core"], stub.summarizer, stored);

        expect(result.waves).toEqual([["file:src/core/index.ts"], ["folder:src/core"]]);
        expect(stub.requests[1].prompt).toContain("- log.ts (9 lines): Stored logger — From an earlier run.");
    });

    it("stops when a folder can never become ready, and names what was left", async () => {
        // log.ts is in a batch at Anthropic: in flight, so neither src/core nor src can go
        const stored: StoredSummary[] = [{
            id: 3, kind: "file", path: "src/core/log.ts", tagline: null, summary: null, model: null,
            inputHash: null, promptVersion: null, status: "pending", batchId: "batch-1", error: null,
        }];
        const stub = stubSummarizer();
        const result = await preview(["src"], stub.summarizer, stored);

        expect(result.waves).toEqual([
            ["file:src/app/main.ts", "file:src/util/strings.ts", "file:src/app/view.tsx", "file:src/core/index.ts", "file:src/index.ts"],
            ["folder:src/app", "folder:src/util"],
        ]);
        expect(unfinished(result).map((t) => [t.kind, t.path, t.state])).toEqual([
            ["file", "src/core/log.ts", "in-flight"],
            ["folder", "src/core", "waiting"],
            ["folder", "src", "waiting"],
        ]);
    });

    it("refuses a sample folder the index doesn't have before sending anything", async () => {
        const stub = stubSummarizer();
        await expect(preview(["src", "lib/missing"], stub.summarizer)).rejects.toThrow(SampleNotIndexedError);
        await expect(preview(["src", "lib/missing"], stub.summarizer)).rejects.toThrow("not in the index: lib/missing");
        expect(stub.requests).toEqual([]);
    });
});

describe("renderFolderPreview", () => {
    it("writes the header, the importer lines, the cost, the estimate and each folder with its files", async () => {
        const fileTokens = [3_000, 200] as const;
        const result = await preview(["src"], scripted({
            "src/app/main.ts": ok({ tagline: "Entry point", summary: "Starts the app." }, ...fileTokens),
            "src/app/view.tsx": ok({ tagline: "Main view", summary: "Renders the page." }, ...fileTokens),
            "src/core/index.ts": ok({ tagline: "Core barrel", summary: "Re-exports the logger." }, ...fileTokens),
            "src/core/log.ts": noReply("API error 429: slow down"),
            "src/index.ts": ok({ tagline: "Package entry", summary: "Re-exports the core." }, ...fileTokens),
            "src/util/strings.ts": ok({ tagline: "String helpers", summary: "Pads and trims strings." }, ...fileTokens),
            "src/app": ok({ tagline: "App layer", summary: "The entry point and its view." }, 1_200, 300),
            "src/core": ok({ tagline: "Core services", summary: "Logging, with one summary missing." }, 1_200, 300),
            "src/util": ok({ tagline: "Utilities", summary: "String helpers and their tests." }, 1_200, 300),
            "src": ok({ tagline: "Source root", summary: "The app, its core and utilities." }, 2_400, 300),
        }));

        const markdown = renderFolderPreview({
            title: "2026 10 12 Summary Review #3 — folder preview",
            repo: "C:/code/mini-repo",
            effort: "low",
            models: { file: "claude-haiku-5-5", folder: "claude-sonnet-5-5" },
            samples: [{ path: "src", why: "the whole source tree" }],
            preview: result,
            importerLines: [{ path: "src/core/log.ts", line: "Imported by: 3 files: src/app (1), src/core/index.ts (1), src/index.ts (1)" }],
            fullPass: { files: 10_000, folders: 1_000 },
        });

        // Haiku: 5 answers of 3,000 in and 200 out (log.ts got no reply, so it isn't a request): 15,000 and 1,000,
        // (15,000 × $0.10 + 1,000 × $0.50) / 1M = $0.0020, a mean of $0.0004 a file.
        // Sonnet: 3 × 1,200 + 2,400 = 6,000 in, 4 × 300 = 1,200 out: (6,000 × $2 + 1,200 × $10) / 1M = $0.0240,
        // means 1,500 and 300. Total $0.0260.
        // Estimate: 10,000 × $0.0004 / 2 = $2.00; 1,000 × (1,500 × $2 + 300 × $10) / 1M / 2 = $3.00; total $5.00.
        // The biggest folder is src: index.ts and 3 subfolders, 4 items (each subfolder holds 2).
        expect(markdown).toBe([
            "## 2026 10 12 Summary Review #3 — folder preview",
            "",
            "- **Repo:** `C:/code/mini-repo` · **effort** low · **prompt version** 3 · the regular Messages API",
            "- **Sample:** 1 folder (below): 6 files went to claude-haiku-5-5, then 4 folders to claude-sonnet-5-5, bottom-up in 3 waves,"
                + " with exactly the prompts a real run builds. 1 test file got the template, as in a real run. Nothing was written to the index.",
            "- **Failures (1):**",
            "  - `src/core/log.ts` (file): failed: API error 429: slow down",
            "",
            "| Folder | Files | Test files | Why |",
            "|---|---|---|---|",
            "| `src` | 7 | 1 | the whole source tree |",
            "",
            "### \"Imported by\", grouped by area",
            "",
            "The line each file of Review #1's sample (1 file) now carries in its prompt, from the import graph (no API call):",
            "",
            "- `src/core/log.ts`: Imported by: 3 files: src/app (1), src/core/index.ts (1), src/index.ts (1)",
            "",
            "### Cost on this sample",
            "",
            "| Model | Requests | Input tokens | Output tokens | Mean input | Mean output | Cost |",
            "|---|---|---|---|---|---|---|",
            "| claude-haiku-5-5 (files) | 5 | 15,000 | 1,000 | 3,000 | 200 | $0.0020 |",
            "| claude-sonnet-5-5 (folders) | 4 | 6,000 | 1,200 | 1,500 | 300 | $0.0240 |",
            "",
            "**Total:** $0.0260",
            "",
            "### Full-pass estimate (Batch API, half price)",
            "",
            "- **Files:** 10,000 × $0.0004 (claude-haiku-5-5's mean) × ½ = **$2.00**",
            "- **Folders and the repo:** 1,000 × (1,500 input tokens + 300 output tokens at claude-sonnet-5-5's price) × ½ = **$3.00**",
            "- **Total ≈ $5.00** against S2's $15.",
            "",
            "The folder means are measured on this sample's 4 folder requests, in place of the 1,000 input tokens assumed before."
                + " The sample skews toward small folders, and the full pass has folders whose prompts list up to 50 children, so its mean may be higher.",
            "",
            "- **The biggest folder here:** `src` (4 items directly inside): 2,400 input tokens and 300 output tokens.",
            "",
            "### The folders",
            "",
            "#### 1. `src`",
            "",
            "_the whole source tree_",
            "",
            "- **`src/`** (7 files): *Source root* — The app, its core and utilities.",
            "  - **`app/`** (2 files): *App layer* — The entry point and its view.",
            "  - **`core/`** (2 files): *Core services* — Logging, with one summary missing.",
            "  - **`util/`** (2 files): *Utilities* — String helpers and their tests.",
            "",
            "<details><summary>6 file summaries (claude-haiku-5-5)</summary>",
            "",
            "- `app/main.ts` (8 lines): *Entry point* — Starts the app.",
            "- `app/view.tsx` (11 lines): *Main view* — Renders the page.",
            "- `core/index.ts` (1 line): *Core barrel* — Re-exports the logger.",
            "- `core/log.ts` (9 lines): failed: API error 429: slow down",
            "- `index.ts` (7 lines): *Package entry* — Re-exports the core.",
            "- `util/strings.ts` (6 lines): *String helpers* — Pads and trims strings.",
            "",
            "</details>",
            "",
            "### Owner's verdict",
            "",
            "_To fill in: go or no-go for the full run, and any prompt changes first._",
            "",
        ].join("\n"));
    });

    it("marks an answer a fallback model wrote, calls a cost with an unpriced model a lower bound, and lists what never went", async () => {
        const result = await preview(["src/util"], scripted({
            "src/util/strings.ts": ok({ tagline: "String helpers", summary: "Pads strings." }, 3_000, 200),
            // Sonnet declined after 10 output tokens and claude-opus-5-5 (no price on file) wrote the answer
            "src/util": (r) => ({
                customId: r.customId, ok: true, text: { tagline: "Utilities", summary: "String helpers and their tests." }, model: "claude-opus-5-5",
                usage: [{ model: "claude-sonnet-5-5", inputTokens: 1_000, outputTokens: 10 }, { model: "claude-opus-5-5", inputTokens: 1_000, outputTokens: 290 }],
            }),
        }));
        const report = {
            title: "t", repo: "r", effort: "low", models: { file: "claude-haiku-5-5", folder: "claude-sonnet-5-5" },
            samples: [{ path: "src/util", why: "a leaf" }], importerLines: [], fullPass: { files: 1, folders: 1 },
        };
        const markdown = renderFolderPreview({ ...report, preview: result });

        // Sonnet's one request: 2,000 in and 300 out over both attempts; only its own has a price: (1,000 × $2 + 10 × $10) / 1M = $0.0021
        expect(markdown).toContain("| claude-sonnet-5-5 (folders) | 1 | 2,000 | 300 | 2,000 | 300 | at least $0.0021 |");
        // Haiku: (3,000 × $0.10 + 200 × $0.50) / 1M = $0.0004, so at least $0.0025 in all
        expect(markdown).toContain("**Total:** at least $0.0025");
        expect(markdown).toContain("- **`util/`** (2 files): *Utilities* — String helpers and their tests. (answered by claude-opus-5-5)");
        expect(markdown).toContain("- **Failures:** none.");

        // a folder that never went out says so where its summary would be, and in the failures list
        const stuck = await preview(["src"], stubSummarizer().summarizer, [{
            id: 3, kind: "file", path: "src/core/log.ts", tagline: null, summary: null, model: null,
            inputHash: null, promptVersion: null, status: "pending", batchId: "batch-1", error: null,
        }]);
        const stuckMarkdown = renderFolderPreview({ ...report, samples: [{ path: "src", why: "w" }], preview: stuck });
        expect(stuckMarkdown).toContain("- **Failures (3):**\n  - `src/core/log.ts` (file): not summarized (in-flight)\n"
            + "  - `src/core` (folder): not summarized (waiting)\n  - `src` (folder): not summarized (waiting)\n");
        expect(stuckMarkdown).toContain("  - **`core/`** (2 files): not summarized (waiting)");
        expect(stuckMarkdown).toContain("- `core/log.ts` (9 lines): not summarized (in-flight)");
    });
});

describe("previewRepoFolders", () => {
    it("sends exactly the prompts a real run sends, and writes nothing to the index", async () => {
        const root = copyFixture();
        indexRepository(root);
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));

        // fixed texts, so both runs' folder prompts list the same children's summaries
        const texts = Object.fromEntries([
            "src/app/main.ts", "src/app/view.tsx", "src/core/index.ts", "src/core/log.ts", "src/index.ts", "src/util/strings.ts",
            "src/app", "src/core", "src/util", "src",
        ].map((p) => [p, { tagline: `About ${p}`, summary: `What ${p} does.` }]));
        const previewStub = stubSummarizer({ texts });
        const result = await previewRepoFolders(db, repoId, root, [{ path: "src", why: "w" }], previewStub.summarizer);

        expect(loadSummaries(db, repoId)).toEqual([]);
        expect(loadUsage(db, repoId)).toEqual([]);
        // pickSample(files, 20) on the fixture's 7 non-test files: all of them, most-imported first (compare.test.ts)
        expect(result.importerLines.map((l) => l.path)).toEqual([
            "src/app/main.ts", "src/core/log.ts", "src/util/strings.ts", "src/app/view.tsx", "src/core/index.ts", "src/index.ts", "scripts/build.js",
        ]);
        // log.ts's importers, grouped by area (run.test.ts's buildFilePrompt expectations)
        expect(result.importerLines[1].line).toBe("Imported by: 3 files: src/app (1), src/core/index.ts (1), src/index.ts (1)");
        expect(result.fullPass).toEqual({ files: 7, folders: 6 });

        const runStub = stubSummarizer({ texts });
        await runSummaries(root, { summarizer: runStub.summarizer, transport: "direct" });

        const firstLine = (r: SummaryRequest) => r.prompt.split("\n")[0];
        const sent = (r: SummaryRequest) => ({ model: r.model, system: r.system, prompt: r.prompt });
        const ran = new Map(runStub.requests.map((r) => [firstLine(r), sent(r)]));

        expect(previewStub.requests.map(firstLine).sort()).toEqual([
            "File: src/app/main.ts", "File: src/app/view.tsx", "File: src/core/index.ts", "File: src/core/log.ts", "File: src/index.ts", "File: src/util/strings.ts",
            "Folder: src", "Folder: src/app", "Folder: src/core", "Folder: src/util",
        ]);
        for (const request of previewStub.requests) expect(sent(request)).toEqual(ran.get(firstLine(request)));
    });
});

describe("previewRepoFolders' full-pass counts (Task 14e's minor)", () => {
    it("leaves out a file over the size cap, which gets a template and no request", async () => {
        const root = copyFixture();
        indexRepository(root);
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        // src/index.ts is 140 bytes; making it 1,000,001 puts it over the 1 MB cap, so 6 of the 7 non-test files remain
        db.update(files).set({ sizeBytes: 1_000_001 }).where(and(eq(files.repoId, repoId), eq(files.path, "src/index.ts"))).run();

        const result = await previewRepoFolders(db, repoId, root, [{ path: "src", why: "w" }], stubSummarizer().summarizer);
        expect(result.fullPass).toEqual({ files: 6, folders: 6 });
    });
});
