import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { makeTempDir } from "../../test/helpers/temp";
import { toyRules } from "../../test/helpers/toy-adapter";
import type { FSWatcher } from "chokidar";
import { isManifestPath, RULES } from "./languages/rules";
import { typescriptRules } from "./languages/typescript-rules";
import { createBatcher, createFolderFilter, isWatchedFile, watchRepository } from "./watch";

// the real chokidar, wrapped only to keep each watcher it makes, so a test can make one report an error
const chokidarWatchers = vi.hoisted(() => [] as FSWatcher[]);
vi.mock("chokidar", async (importOriginal) => {
    const real = await importOriginal<typeof import("chokidar")>();
    return {
        ...real,
        watch: (...args: Parameters<typeof real.watch>) => {
            const watcher = real.watch(...args);
            chokidarWatchers.push(watcher);
            return watcher;
        },
    };
});

afterEach(() => { vi.useRealTimers(); });

describe("createBatcher", () => {
    it("hands over everything that arrived before a quiet spell, once, sorted", () => {
        vi.useFakeTimers();
        const flushed: string[][] = [];
        const batcher = createBatcher((items) => flushed.push(items), { quietMs: 1000, maxWaitMs: 5000 });

        batcher.add("src/b.ts");
        vi.advanceTimersByTime(500);
        batcher.add("src/a.ts");
        batcher.add("src/b.ts");
        vi.advanceTimersByTime(999);
        expect(flushed).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(flushed).toEqual([["src/a.ts", "src/b.ts"]]);
    });

    it("never holds a batch back longer than maxWaitMs, however steady the trickle", () => {
        vi.useFakeTimers();
        const flushed: string[][] = [];
        const batcher = createBatcher((items) => flushed.push(items), { quietMs: 1000, maxWaitMs: 5000 });

        for (let t = 0; t <= 4800; t += 400){
            batcher.add(`src/f${t}.ts`);
            vi.advanceTimersByTime(400);
        }
        expect(flushed).toHaveLength(1);
        expect(flushed[0]).toHaveLength(13);   // t = 0, 400, …, 4800: everything up to the deadline at 5,000 ms
    });

    it("drops what's pending when cancelled", () => {
        vi.useFakeTimers();
        const flushed: string[][] = [];
        const batcher = createBatcher((items) => flushed.push(items), { quietMs: 1000, maxWaitMs: 5000 });
        batcher.add("src/a.ts");
        batcher.cancel();
        vi.advanceTimersByTime(10_000);
        expect(flushed).toEqual([]);
    });
});

describe("isWatchedFile", () => {
    it("watches source files and the files that change how sources are found or resolved", () => {
        for (const rel of ["src/a.ts", "a.tsx", "b.mjs", "tsconfig.json", "packages/p/tsconfig.base.json", ".gitignore", "src/.gitignore"]){
            expect(isWatchedFile(rel)).toBe(true);
        }
        for (const rel of ["README.md", "src", "src/styles.css"]){
            expect(isWatchedFile(rel)).toBe(false);
        }
    });

    it("reports a package.json, which changes what bare specifiers resolve to (ADR-053)", () => {
        expect(isWatchedFile("packages/ui/package.json")).toBe(true);
        expect(isWatchedFile("package.json")).toBe(true);
        expect(isWatchedFile("package-lock.json")).toBe(false);
    });

    it("reports the root's workspace declarations, pnpm-workspace.yaml and lerna.json, and nothing of those names below it", () => {
        expect(isWatchedFile("pnpm-workspace.yaml")).toBe(true);
        expect(isWatchedFile("lerna.json")).toBe(true);
        expect(isWatchedFile("packages/p/pnpm-workspace.yaml")).toBe(false);
        expect(isWatchedFile("packages/p/lerna.json")).toBe(false);
    });

    it("reports every language's code files and manifests (ADR-065)", () => {
        for (const rules of RULES){
            for (const ext of rules.extensions) expect(isWatchedFile(`src/a${ext}`), `${rules.id} ${ext}`).toBe(true);
        }
        // names some language's rules may call a manifest: each one isManifestPath accepts is watched
        const candidates = [
            "package.json", "tsconfig.json", "go.mod", "go.work", "Cargo.toml", "pyproject.toml", "setup.cfg", "setup.py", "pyvenv.cfg",
            "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "src/App/App.csproj", "Directory.Build.props",
        ];
        for (const name of candidates) for (const rel of [name, `sub/dir/${name}`]){
            if (isManifestPath(rel)) expect(isWatchedFile(rel), rel).toBe(true);
        }
    });

    it("reports a test language's code files and manifests when given its rules", () => {
        const rules = [typescriptRules, toyRules];
        expect(isWatchedFile("lib/a.toy", rules)).toBe(true);
        expect(isWatchedFile("pkg/toy.json", rules)).toBe(true);
        expect(isWatchedFile("setup.toy", rules)).toBe(true);
        expect(isWatchedFile("lib/a.toy")).toBe(false);   // no registry language claims .toy
        expect(isWatchedFile("src/a.ts", rules)).toBe(true);
        expect(isWatchedFile("package.json", rules)).toBe(true);
    });
});

/** A git repo in the temp folder whose .gitignore leaves out the top-level out/ and .build/, and every dist/. */
function gitRepoWithIgnores(): string {
    const root = makeTempDir("neb-watch-git-");
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, ".gitignore"), "/out/\n.build/\ndist/\n");
    return root;
}

describe("createFolderFilter", () => {
    it("in a git repo, skips build output and top-level folders only where .gitignore leaves them out", () => {
        const skips = createFolderFilter(gitRepoWithIgnores(), true);
        expect(skips("node_modules")).toBe(true);
        expect(skips("packages/p/node_modules")).toBe(true);
        expect(skips("out")).toBe(true);                 // build output, and ignored
        expect(skips(".build")).toBe(true);              // a top-level folder .gitignore leaves out
        expect(skips("packages/p/dist")).toBe(true);     // build output, and ignored at any depth
        expect(skips("packages/p/dist/esm")).toBe(true); // inside a skipped folder
        expect(skips("build")).toBe(false);              // build output by name, but not ignored: VS Code tracks its build scripts there
        expect(skips("packages/p/out")).toBe(false);     // "/out/" only matches at the top
        expect(skips("src")).toBe(false);
    });

    it("without git, skips build output by name, as discovery's walk does", () => {
        const skips = createFolderFilter(makeTempDir("neb-watch-walk-"), false);
        expect(skips("build")).toBe(true);
        expect(skips("packages/p/dist")).toBe(true);
        expect(skips(".build")).toBe(false);   // no .gitignore to ask
        expect(skips("src")).toBe(false);
    });
});

/**
 * Writes, then waits for what the test expects, writing again every half second until the watcher has reported anything
 * at all. On macOS, FSEvents can lose what's written in the moment after chokidar says it's ready: CI's macOS runs lost
 * a whole first write, in a different test each time. So the first report, not a fixed wait, says the watcher is live.
 * Writing a file again is harmless here, since every test checks which paths were reported, not how often.
 */
async function writeUntilReported(write: () => void, batches: string[][], expected: () => void): Promise<void> {
    write();
    await vi.waitFor(() => {
        if (batches.length === 0) write();
        expected();
    }, { timeout: 10_000, interval: 500 });
}

describe("watchRepository", () => {
    it("reports a new source file, and nothing from node_modules or non-source files", { timeout: 20_000 }, async () => {
        const root = makeTempDir("neb-watch-");
        fs.mkdirSync(path.join(root, "src"));
        fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
        const batches: string[][] = [];
        const watcher = watchRepository(root, (paths) => batches.push(paths), { quietMs: 100, maxWaitMs: 1000 });

        try{
            await watcher.ready;
            await writeUntilReported(() => {
                fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
                fs.writeFileSync(path.join(root, "node_modules", "x", "b.ts"), "export const b = 1;\n");
                fs.writeFileSync(path.join(root, "README.md"), "# hi\n");
            }, batches, () => expect(batches.flat()).toContain("src/a.ts"));
            expect(batches.flat().filter((p) => p !== "src/a.ts")).toEqual([]);
        } finally{
            await watcher.close();
        }
    });

    it("survives a watcher error (an unreadable folder, the inotify limit): reports it and keeps watching (I3)", { timeout: 20_000 }, async () => {
        const root = makeTempDir("neb-watch-");
        fs.mkdirSync(path.join(root, "src"));
        const batches: string[][] = [];
        const errors: Error[] = [];
        const watcher = watchRepository(root, (paths) => batches.push(paths), { quietMs: 100, maxWaitMs: 1000, onError: (err) => errors.push(err) });

        try{
            await watcher.ready;
            const failure = Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), { code: "ENOSPC" });
            // with no listener, an EventEmitter's 'error' throws: in the worker, an uncaught exception that kills it
            expect(() => chokidarWatchers.at(-1)!.emit("error", failure)).not.toThrow();
            expect(errors).toEqual([failure]);

            await writeUntilReported(() => fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n"), batches,
                () => expect(batches.flat()).toContain("src/a.ts"));
        } finally{
            await watcher.close();
        }
    });

    it("reports nothing from build output or folders .gitignore leaves out at the top", { timeout: 20_000 }, async () => {
        const root = gitRepoWithIgnores();
        for (const dir of ["src", "out", ".build", "build", "packages/p/dist"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
        const batches: string[][] = [];
        const watcher = watchRepository(root, (paths) => batches.push(paths), { quietMs: 100, maxWaitMs: 1000 });

        try{
            await watcher.ready;
            await writeUntilReported(() => {
                for (const rel of ["out/b.ts", ".build/c.ts", "packages/p/dist/e.ts", "build/d.ts", "src/a.ts"]){
                    fs.writeFileSync(path.join(root, rel), "export const x = 1;\n");
                }
            }, batches, () => expect(batches.flat()).toEqual(expect.arrayContaining(["build/d.ts", "src/a.ts"])));
            expect([...new Set(batches.flat())].sort()).toEqual(["build/d.ts", "src/a.ts"]);
        } finally{
            await watcher.close();
        }
    });
});
