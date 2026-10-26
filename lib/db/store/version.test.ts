import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { getDb } from "../client";
import { indexRepository } from "../../index/pipeline";
import { runSummaries } from "../../index/summarize/run";
import { eq } from "drizzle-orm";
import { meta } from "../schema";
import { loadStoredFiles, upsertRepository, writeFileRecords, type FileRecord } from "./structure";
import { bumpIndexVersion, readAdapterVersion, readIndexVersion, recordAdapterVersion, writeAdapterVersion } from "./version";

const record = (p: string): FileRecord => ({
    path: p, kind: "module", contentHash: `hash-${p}`, language: "typescript", sizeBytes: 1, lineCount: 1, isTest: false,
    importSpecifiers: [], declares: [], chunks: [], symbols: [], calls: { types: [], bindings: [], calls: [] },
});

describe("adapter versions, one per adapter (ADR-065, the design's C16)", () => {
    const metaValue = (key: string): string | undefined => getDb().select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value;

    it("keeps TypeScript's under the key it always had, and every other adapter's under its own", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/version-test/adapters");
        writeAdapterVersion(db, repoId, 7);
        expect(metaValue(`adapterVersion:${repoId}`)).toBe("7");
        expect(readAdapterVersion(db, repoId)).toBe(7);
        expect(readAdapterVersion(db, repoId, "typescript")).toBe(7);

        expect(readAdapterVersion(db, repoId, "python")).toBe(0);
        writeAdapterVersion(db, repoId, 3, "python");
        expect(metaValue(`adapterVersion:${repoId}:python`)).toBe("3");
        expect(readAdapterVersion(db, repoId, "python")).toBe(3);
        expect(readAdapterVersion(db, repoId)).toBe(7);
    });

    it("records one adapter's version and clears only the hashes it is given", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/version-test/record");
        writeFileRecords(db, repoId, [record("a.go"), record("b.go"), record("c.ts")]);
        recordAdapterVersion(db, repoId, 7, []);
        recordAdapterVersion(db, repoId, 2, ["b.go"], "go");

        expect(readAdapterVersion(db, repoId, "go")).toBe(2);
        expect(metaValue(`adapterVersion:${repoId}:go`)).toBe("2");
        expect(readAdapterVersion(db, repoId)).toBe(7);
        const stored = loadStoredFiles(db, repoId);
        expect([...stored].map(([p, f]) => [p, f.contentHash])).toEqual([["a.go", "hash-a.go"], ["b.go", ""], ["c.ts", "hash-c.ts"]]);
    });
});

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
