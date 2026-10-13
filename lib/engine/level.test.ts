import { describe, expect, it } from "vitest";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import type { MapNode } from "../contracts";
import { getDb } from "../db/client";
import { RepoNotIndexedError } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { breadcrumbOf, level, NotAFolderError, PathNotFoundError, reportedStatus } from "./level";

const pending = (p: string, kind: "folder" | "file", fileCount: number): MapNode =>
    ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), kind, fileCount, summaryStatus: "pending" });

describe("level — the fixture", () => {
    it("opens the repo root: src, then scripts, the line between them, nothing folded", () => {
        const root = copyFixture();
        indexRepository(root);
        const view = level(root, "");
        expect(view).toMatchObject({ repo: repoKey(root), path: "", breadcrumb: [""], hiddenCount: 0 });
        expect(view.nodes).toEqual([pending("src", "folder", 7), pending("scripts", "folder", 1)]);
        expect(view.edges).toEqual([{ source: "scripts", target: "src", count: 2 }]);
    });

    it("opens src: three folders of 2 files, then the file directly inside, and the 5 lines between them", () => {
        const root = copyFixture();
        indexRepository(root);
        const view = level(root, "src");
        expect(view.breadcrumb).toEqual(["", "src"]);
        expect(view.nodes).toEqual([
            pending("src/app", "folder", 2), pending("src/core", "folder", 2), pending("src/util", "folder", 2), pending("src/index.ts", "file", 1),
        ]);
        expect(view.edges).toEqual([
            { source: "src/app", target: "src/core", count: 1 },
            { source: "src/app", target: "src/util", count: 1 },
            { source: "src/index.ts", target: "src/app", count: 1 },
            { source: "src/index.ts", target: "src/core", count: 1 },
            { source: "src/util", target: "src/core", count: 1 },
        ]);
    });

    it("orders a leaf folder's files by how many files import them", () => {
        const root = copyFixture();
        indexRepository(root);
        // log.ts has 3 importers (edges 3, 7, 9), index.ts 1 (edge 11); main.ts 3 (edges 2, 6, 8), view.tsx 1 (edge 4)
        expect(level(root, "src/core").nodes.map((n) => n.path)).toEqual(["src/core/log.ts", "src/core/index.ts"]);
        expect(level(root, "src/core").edges).toEqual([{ source: "src/core/index.ts", target: "src/core/log.ts", count: 1 }]);
        expect(level(root, "src/app").nodes.map((n) => n.path)).toEqual(["src/app/main.ts", "src/app/view.tsx"]);
    });

    it("shows taglines and statuses once summaries exist, and 'off' for missing ones without a key", async () => {
        const root = copyFixture();
        indexRepository(root);
        expect(level(root, "src/util", { summariesOff: true }).nodes.map((n) => n.summaryStatus)).toEqual(["off", "off"]);

        const stub = stubSummarizer({ texts: { "src/util/strings.ts": { tagline: "String helpers", summary: "Shouts." } } });
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        expect(level(root, "src/util").nodes).toEqual([
            { path: "src/util/strings.ts", name: "strings.ts", kind: "file", fileCount: 1, tagline: "String helpers", summaryStatus: "fresh" },
            { path: "src/util/strings.test.ts", name: "strings.test.ts", kind: "file", fileCount: 1, tagline: "Tests for strings", summaryStatus: "skipped" },
        ]);
    });

    it("refuses a file, an unknown path, and a repo that was never indexed", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(() => level(root, "src/core/log.ts")).toThrow(NotAFolderError);
        expect(() => level(root, "src/nope")).toThrow(PathNotFoundError);
        expect(() => level(path.join(makeTempDir("neb-level-"), "never"), "")).toThrow(RepoNotIndexedError);
    });

    it("carries the repo's index version", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        expect(level(root, "").indexVersion).toBe(readIndexVersion(getDb(), repoId));
    });

    it("says which page it drew: the fixture's levels fit on one, so any page asked for is page 0 of 1", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(level(root, "")).toMatchObject({ page: 0, pageCount: 1 });
        expect(level(root, "src", { page: 2 })).toMatchObject({ page: 0, pageCount: 1 });
    });

    it("draws the page holding `focus`: page 0 of 1 for a file inside src's one page", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(level(root, "src", { focus: "src/core/log.ts" })).toMatchObject({ page: 0, pageCount: 1, hiddenCount: 0 });
    });
});

describe("level helpers", () => {
    it("lists the folders from the root down", () => {
        expect(breadcrumbOf("")).toEqual([""]);
        expect(breadcrumbOf("src/vs/base")).toEqual(["", "src", "src/vs", "src/vs/base"]);
    });

    it("reports text's own status, 'off' only when there's no text, and pending without a row", () => {
        expect(reportedStatus({ tagline: "T", status: "stale" }, true)).toBe("stale");
        expect(reportedStatus({ tagline: null, status: "failed" }, true)).toBe("off");
        expect(reportedStatus({ tagline: null, status: "failed" }, false)).toBe("failed");
        expect(reportedStatus(null, false)).toBe("pending");
        expect(reportedStatus(undefined, true)).toBe("off");
    });
});
