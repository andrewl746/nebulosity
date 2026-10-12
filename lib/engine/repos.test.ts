import { afterEach, beforeAll, describe, expect, it } from "vitest";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { readConfig, writeConfig } from "../config";
import { getDb } from "../db/client";
import { upsertRepository } from "../db/store/structure";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { listRepos, setActiveRepo, UnknownRepoError } from "./repos";

// Open the test database before any test moves NEBULOSITY_HOME: getDb() finds its migrations under
// NEBULOSITY_HOME (lib/db/client.ts), and a temp home has none. Once open, the handle is reused.
beforeAll(() => { getDb(); });

const original = process.env.NEBULOSITY_HOME;
afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
});

describe("repos", () => {
    it("lists the repos the structure stage indexed, with names and times, and which one is active", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-repos-");
        const root = copyFixture();
        indexRepository(root);
        upsertRepository(getDb(), "/repos-test/never-indexed");   // a row with no structure stage: left out
        writeConfig({ activeRepo: repoKey(root), port: 3000 });

        const list = listRepos();
        expect(list.active).toBe(repoKey(root));
        const entry = list.repos.find((r) => r.root === repoKey(root));
        expect(entry).toMatchObject({ root: repoKey(root), name: path.basename(root) });
        expect(entry?.indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(list.repos.some((r) => r.root === "/repos-test/never-indexed")).toBe(false);
    });

    it("switches the active repo and keeps the port, and refuses a repo that was never indexed", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-repos-");
        const a = copyFixture();
        const b = copyFixture();
        indexRepository(a);
        indexRepository(b);
        writeConfig({ activeRepo: repoKey(a), port: 4123 });

        expect(setActiveRepo(repoKey(b)).active).toBe(repoKey(b));
        expect(readConfig()).toEqual({ activeRepo: repoKey(b), port: 4123 });
        expect(() => setActiveRepo("/nowhere")).toThrow(UnknownRepoError);
        expect(readConfig().activeRepo).toBe(repoKey(b));
    });
});
