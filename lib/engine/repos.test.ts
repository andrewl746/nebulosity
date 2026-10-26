import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { configPath, readConfig, writeConfig } from "../config";
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

    it("carries a repo's origin owner and name when it has one, for the top bar's owner / repo", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-repos-");
        const withRemote = copyFixture();
        const without = copyFixture();
        indexRepository(withRemote);
        indexRepository(without);
        // after indexing: discovery runs git ls-files on a folder with a .git, and this one is only a config file
        fs.mkdirSync(path.join(withRemote, ".git"));
        fs.writeFileSync(path.join(withRemote, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/microsoft/vscode.git\n');

        const repos = listRepos().repos;
        expect(repos.find((r) => r.root === repoKey(withRemote))?.remote).toEqual({ owner: "microsoft", name: "vscode" });
        expect(repos.find((r) => r.root === repoKey(without))).not.toHaveProperty("remote");
    });
});

// The pre-ship pass's Final Review #2, minor 1 (ruling R30): the switch read config.json, then writeConfig read it again
// to check it. A read that failed for a moment (Windows' EBUSY, from a scanner) between the two wrote the defaults over a
// valid file, and two writers rewriting one broken file could collide. Each failure is injected, not timed.
describe("setActiveRepo and the config file it rewrites", () => {
    const realRead = fs.readFileSync;
    const realRename = fs.renameSync;
    const busy = (): NodeJS.ErrnoException => Object.assign(new Error("EBUSY: resource busy or locked, open 'config.json'"), { code: "EBUSY" });
    const settings = { activeRepo: "", port: 4123, summaryModels: { file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } } };

    afterEach(() => { vi.restoreAllMocks(); });

    function twoRepos(): { a: string; b: string; file: string } {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-repos-");
        const a = copyFixture();
        const b = copyFixture();
        indexRepository(a);
        indexRepository(b);
        const file = configPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ ...settings, activeRepo: repoKey(a) }, null, 2));
        return { a, b, file };
    }

    /** Fails the next `times` reads of config.json with EBUSY (every read, when times is Infinity); other files read as usual. */
    function busyReads(file: string, times: number): void {
        let left = times;
        vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
            if (target === file && left > 0){
                left--;
                throw busy();
            }
            return realRead(target, options as BufferEncoding);
        }) as typeof fs.readFileSync);
    }

    const asideFiles = (file: string): string[] => fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith("config.json.invalid-"));

    it("tries a read that fails for a moment again, and keeps every setting the file holds", () => {
        const { b, file } = twoRepos();
        busyReads(file, 2);

        expect(setActiveRepo(repoKey(b)).active).toBe(repoKey(b));
        vi.restoreAllMocks();
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ ...settings, activeRepo: repoKey(b) });
        expect(asideFiles(file)).toEqual([]);
    });

    it("refuses to switch, and writes nothing, when the file can't be read at all, saying which file and why", () => {
        const { b, file } = twoRepos();
        const before = fs.readFileSync(file, "utf8");
        busyReads(file, Infinity);

        expect(() => setActiveRepo(repoKey(b))).toThrow(`${file} couldn't be read to change it (EBUSY: resource busy or locked, open 'config.json'), so nothing was written; try again`);
        vi.restoreAllMocks();
        expect(fs.readFileSync(file, "utf8")).toBe(before);
        expect(asideFiles(file)).toEqual([]);
    });

    it("rewriting a broken file another writer moves aside first, merges into what that writer saved", () => {
        const { b, file } = twoRepos();
        const broken = '{ "activeRepo": "/r/app", }';
        fs.writeFileSync(file, broken);
        // The other writer (nebulosity map --port 4001, say) moves the file aside and saves its own; this switch's own
        // move, a moment later, finds nothing there.
        let first = true;
        vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
            if (first && from === file){
                first = false;
                realRename(file, `${file}.invalid-the-other-writer`);
                fs.writeFileSync(file, JSON.stringify({ activeRepo: null, port: 4001 }));
                throw Object.assign(new Error(`ENOENT: no such file or directory, rename '${file}'`), { code: "ENOENT" });
            }
            return realRename(from, to);
        }) as typeof fs.renameSync);
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(setActiveRepo(repoKey(b)).active).toBe(repoKey(b));
        vi.restoreAllMocks();
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ activeRepo: repoKey(b), port: 4001 });
        expect(fs.readFileSync(`${file}.invalid-the-other-writer`, "utf8")).toBe(broken);
    });
});
