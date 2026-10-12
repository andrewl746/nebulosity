import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { getDb } from "../client";
import { indexRepository } from "../../index/pipeline";
import { runSummaries } from "../../index/summarize/run";
import { upsertRepository } from "./structure";
import { bumpIndexVersion, readIndexVersion } from "./version";

describe("index version", () => {
    it("is 0 for a repo nothing has written yet, and counts up by one per bump", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/version-test/counter");
        expect(readIndexVersion(db, repoId)).toBe(0);
        expect(bumpIndexVersion(db, repoId)).toBe(1);
        expect(bumpIndexVersion(db, repoId)).toBe(2);
        expect(readIndexVersion(db, repoId)).toBe(2);
    });

    it("keeps each repo's count apart", () => {
        const db = getDb();
        const a = upsertRepository(db, "/version-test/a");
        const b = upsertRepository(db, "/version-test/b");
        bumpIndexVersion(db, a);
        expect(readIndexVersion(db, b)).toBe(0);
    });

    it("moves once at the end of every structure run", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        const first = readIndexVersion(getDb(), repoId);
        expect(first).toBe(1);
        indexRepository(root);
        expect(readIndexVersion(getDb(), repoId)).toBe(2);
    });

    it("moves when summaries are written, and not when a run finds every summary current", async () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        const db = getDb();

        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        const afterRun = readIndexVersion(db, repoId);
        expect(afterRun).toBeGreaterThan(1);

        // every inputHash still matches: no row is created, changed or answered, so nothing on the Map changed
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        expect(readIndexVersion(db, repoId)).toBe(afterRun);
    });

    it("moves when a deleted file takes its summary with it", async () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        const db = getDb();
        const before = readIndexVersion(db, repoId);

        fs.rmSync(path.join(root, "scripts/build.js"));
        indexRepository(root);
        // pruning build.js's and scripts/'s summaries bumps once; the end of the run bumps again
        expect(readIndexVersion(db, repoId)).toBe(before + 2);
    });
});
