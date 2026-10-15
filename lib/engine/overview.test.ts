import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../db/client";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { buildImportGraph } from "./graph";
import { overview, rankMostImported } from "./overview";
import { buildImportIndex } from "./reach";

describe("overview", () => {
    it("gives the repo's size, its areas largest first and its most-imported files, with no summaries at all", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        expect(overview(root, { summariesOff: true })).toEqual({
            repo: repoKey(root),
            name: path.basename(root),
            summaryStatus: "off",
            stats: { fileCount: 8, lineCount: 48, importCount: 11 },
            areas: [
                { path: "src", kind: "folder", fileCount: 7, lineCount: 45 },
                { path: "scripts", kind: "folder", fileCount: 1, lineCount: 3 },
            ],
            mostImported: [
                { path: "src/app/main.ts", importedBy: 3 },
                { path: "src/core/log.ts", importedBy: 3 },
                { path: "src/util/strings.ts", importedBy: 2 },
                { path: "src/app/view.tsx", importedBy: 1 },
                { path: "src/core/index.ts", importedBy: 1 },
                { path: "src/index.ts", importedBy: 1 },
            ],
            docs: [{ path: "README.md", title: "mini-repo" }],
            stalePaths: 0,
            indexVersion: readIndexVersion(getDb(), repoId),
        });
    });

    it("carries the repo's summary and each area's tagline once they're written", async () => {
        const root = copyFixture();
        indexRepository(root);
        await runSummaries(root, {
            summarizer: stubSummarizer({ texts: {
                "": { tagline: "A tiny sample app", summary: "It starts, logs and shouts." },
                src: { tagline: "The app's source", summary: "Everything the app runs." },
            } }).summarizer,
            transport: "direct",
        });
        const answer = overview(root);
        expect(answer).toMatchObject({ tagline: "A tiny sample app", summary: "It starts, logs and shouts.", summaryStatus: "fresh" });
        expect(answer.areas[0]).toEqual({ path: "src", kind: "folder", fileCount: 7, lineCount: 45, tagline: "The app's source" });
    });

    it("ranks files by how many import them, ties by path, and keeps the top ones", () => {
        // a.ts → c.ts, b.ts → c.ts, d.ts → c.ts, d.ts → a.ts, c.ts → b.ts: c 3, a 1, b 1, d 0
        const index = buildImportIndex(buildImportGraph(
            [{ id: 1, path: "a.ts" }, { id: 2, path: "b.ts" }, { id: 3, path: "c.ts" }, { id: 4, path: "d.ts" }],
            [{ source: 1, target: 3 }, { source: 2, target: 3 }, { source: 4, target: 3 }, { source: 4, target: 1 }, { source: 3, target: 2 }],
        ));
        expect(rankMostImported(index, 10)).toEqual([{ path: "c.ts", importedBy: 3 }, { path: "a.ts", importedBy: 1 }, { path: "b.ts", importedBy: 1 }]);
        expect(rankMostImported(index, 2)).toEqual([{ path: "c.ts", importedBy: 3 }, { path: "a.ts", importedBy: 1 }]);
    });
});
