import { describe as group, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { applyTargetUpdates } from "../db/store/summaries";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { describe } from "./describe";
import { PathNotFoundError } from "./level";

group("describe — the fixture", () => {
    it("describes a folder: its two files, its size, and the three areas that import it", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        expect(describe(root, "src/core")).toEqual({
            repo: repoKey(root),
            path: "src/core",
            kind: "folder",
            summaryStatus: "pending",
            stats: { fileCount: 2, lineCount: 10 },
            children: [
                { path: "src/core/log.ts", name: "log.ts", kind: "file", fileCount: 1, summaryStatus: "pending" },
                { path: "src/core/index.ts", name: "index.ts", kind: "file", fileCount: 1, summaryStatus: "pending" },
            ],
            uses: [],
            usedBy: [
                { path: "src/app", kind: "folder", count: 1 },
                { path: "src/index.ts", kind: "file", count: 1 },
                { path: "src/util", kind: "folder", count: 1 },
            ],
            stalePaths: 0,
            indexVersion: readIndexVersion(getDb(), repoId),
        });
    });

    it("describes a file: its declarations in line order, members by their qualified names", () => {
        const root = copyFixture();
        indexRepository(root);
        const log = describe(root, "src/core/log.ts");
        expect(log).toMatchObject({ kind: "file", stats: { fileCount: 1, lineCount: 9 }, uses: [] });
        expect(log.children).toBeUndefined();
        expect(log.symbols).toEqual([
            { name: "log", kind: "function", startLine: 2, endLine: 2, exported: true },
            { name: "Logger", kind: "class", startLine: 4, endLine: 7, exported: true },
            { name: "Logger.info", kind: "method", startLine: 5, endLine: 5, exported: true },
            { name: "Logger.warn", kind: "method", startLine: 6, endLine: 6, exported: false },
            { name: "banner", kind: "const", startLine: 9, endLine: 9, exported: true },
        ]);
        expect(log.usedBy).toEqual([
            { path: "src/app", kind: "folder", count: 1 },
            { path: "src/core/index.ts", kind: "file", count: 1 },
            { path: "src/index.ts", kind: "file", count: 1 },
        ]);
    });

    it("describes the repo: every file and line, its top folders, nothing across its edge", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(describe(root, "")).toMatchObject({
            kind: "repo",
            stats: { fileCount: 8, lineCount: 48 },
            children: [{ path: "src" }, { path: "scripts" }],
            uses: [],
            usedBy: [],
        });
    });

    it("keeps an out-of-date summary on show and counts the stale files under each folder", async () => {
        const root = copyFixture();
        indexRepository(root);
        await runSummaries(root, {
            summarizer: stubSummarizer({ texts: { "src/core/log.ts": { tagline: "Logging helpers", summary: "Writes lines." } } }).summarizer,
            transport: "direct",
        });
        const db = getDb();
        const repoId = requireRepository(db, repoKey(root));
        applyTargetUpdates(db, repoId, [{ kind: "file", path: "src/core/log.ts", inputHash: "edited", status: "stale" }]);

        expect(describe(root, "src/core/log.ts")).toMatchObject({ tagline: "Logging helpers", summary: "Writes lines.", summaryStatus: "stale", stalePaths: 1 });
        expect(describe(root, "src/core").stalePaths).toBe(1);
        expect(describe(root, "src").stalePaths).toBe(1);
        expect(describe(root, "src/app").stalePaths).toBe(0);
    });

    it("says why a summary failed, but not when there's no key to retry with", async () => {
        const root = copyFixture();
        indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer({ failPaths: ["src/index.ts"] }).summarizer, transport: "direct" });
        expect(describe(root, "src/index.ts")).toMatchObject({ summaryStatus: "failed", summaryError: "stub failure" });
        expect(describe(root, "src/index.ts", { summariesOff: true }).summaryError).toBeUndefined();
    });

    it("refuses a path with nothing indexed at it", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(() => describe(root, "src/nope.ts")).toThrow(PathNotFoundError);
    });
});
