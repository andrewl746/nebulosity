import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { ARCH_FIXTURE, copyFixture, DI_FIXTURE } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { toyAdapter } from "../../test/helpers/toy-adapter";
import { getDb } from "../db/client";
import { chunks, files, folders, levelEdges, symbols } from "../db/schema";
import { loadCallsOf } from "../db/store/calls";
import { loadEntryPoints } from "../db/store/entries";
import { acquireIndexLock, IndexLockedError, releaseIndexLock } from "../db/store/lock";
import { loadImportEdges } from "../db/store/structure";
import { loadFileFacts, loadFolderFacts, loadSummaries } from "../db/store/summaries";
import { readIndexVersion } from "../db/store/version";
import type { LanguageAdapter } from "./languages/adapter";
import type { ResolutionState } from "./languages/resolution";
import { GrammarNotLoadedError } from "./languages/treesitter";
import { typescriptAdapter } from "./languages/typescript-adapter";
import { indexRepository } from "./pipeline";
import { runSummaries } from "./summarize/run";
import { applyFileChanges, resolvesEverything } from "./update";

const write = (root: string, rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
};
const prepend = (root: string, rel: string, text: string): void =>
    write(root, rel, text + fs.readFileSync(path.join(root, rel), "utf8"));

/** Everything a structure run derives, in a form two repos can be compared by (the root folder's name differs). */
function tables(repoId: number){
    const db = getDb();
    return {
        files: loadFileFacts(db, repoId).map((f) => [f.path, f.contentHash, f.lineCount, f.isTest, f.importedBy]),
        imports: loadImportEdges(db, repoId).map((e) => `${e.source} -> ${e.target} (${e.specifier})`).sort(),
        levelEdges: db.select().from(levelEdges).where(eq(levelEdges.repoId, repoId)).all()
            .map((r) => `${r.levelPath} | ${r.sourceNode} -> ${r.targetNode} × ${r.count}`).sort(),
        folders: loadFolderFacts(db, repoId).map((f) => [f.path, f.parentPath, f.depth, f.fileCount, f.directFileCount]),
    };
}

/** The oracle: what a full run makes of the same tree, in a twin copy indexed as a repo of its own. */
function fullRunOf(root: string){
    const twin = makeTempDir("neb-twin-");
    fs.cpSync(root, twin, { recursive: true });
    return tables(indexRepository(twin).repoId);
}

function levelEdgeCount(repoId: number, levelPath: string, sourceNode: string, targetNode: string): number {
    return getDb().select({ count: levelEdges.count }).from(levelEdges).where(and(
        eq(levelEdges.repoId, repoId), eq(levelEdges.levelPath, levelPath), eq(levelEdges.sourceNode, sourceNode), eq(levelEdges.targetNode, targetNode),
    )).get()?.count ?? 0;
}

function folderCounts(repoId: number, paths: string[]): number[][] {
    return paths.map((p) => {
        const row = getDb().select().from(folders).where(and(eq(folders.repoId, repoId), eq(folders.path, p))).get()!;
        return [row.fileCount, row.directFileCount];
    });
}

describe("applyFileChanges", () => {
    it("replaces a changed file's call facts on an update (ADR-059)", () => {
        const root = copyFixture(DI_FIXTURE);
        const { repoId } = indexRepository(root);
        const file = "src/workbench/history/history.ts";
        fs.appendFileSync(path.join(root, file), "\nexport function late(f: IFileService): string { return f.readFile(\"z\"); }\n");
        applyFileChanges(root, [file]);
        const lines = loadCallsOf(getDb(), repoId, "readFile").filter((c) => c.path === file).map((c) => c.line);
        expect(lines).toEqual([4, 8, 11]);
    });

    it("an edit that adds an import re-resolves only that file and moves one level-edge count", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        prepend(root, "src/util/strings.ts", `import { banner } from "../core/log";\n`);

        expect(applyFileChanges(root, ["src/util/strings.ts"]))
            .toMatchObject({ changed: ["src/util/strings.ts"], deleted: [], unchanged: 0, resolvedAll: false, edgesAdded: 1, edgesRemoved: 0 });
        expect(levelEdgeCount(repoId, "src", "src/util", "src/core")).toBe(2);
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("a new file re-resolves everything, and its folder and every folder above count it", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        write(root, "src/core/extra.ts", `import { log } from "./log";\nexport const extra = 1;\n`);

        expect(applyFileChanges(root, ["src/core/extra.ts"]))
            .toMatchObject({ changed: ["src/core/extra.ts"], deleted: [], resolvedAll: true, edgesAdded: 1, edgesRemoved: 0 });
        expect(levelEdgeCount(repoId, "src/core", "src/core/extra.ts", "src/core/log.ts")).toBe(1);
        expect(folderCounts(repoId, ["", "src", "src/core"])).toEqual([[9, 0], [8, 1], [3, 3]]);
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("a deleted file takes its imports, its folders' counts and its summary with it", async () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
        fs.rmSync(path.join(root, "src/core/index.ts"));

        // edges 7 (core/index → log) and 11 (strings → core/index) go with it; strings.ts's "../core" now resolves to nothing
        expect(applyFileChanges(root, ["src/core/index.ts"]))
            .toMatchObject({ changed: [], deleted: ["src/core/index.ts"], resolvedAll: true, edgesAdded: 0, edgesRemoved: 2 });
        expect(levelEdgeCount(repoId, "src/core", "src/core/index.ts", "src/core/log.ts")).toBe(0);
        expect(levelEdgeCount(repoId, "src", "src/util", "src/core")).toBe(0);
        expect(folderCounts(repoId, ["", "src", "src/core"])).toEqual([[7, 0], [6, 1], [1, 1]]);
        expect(loadSummaries(getDb(), repoId).some((s) => s.path === "src/core/index.ts")).toBe(false);
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("a rename is a delete plus a create: the old name's imports stop resolving, the new file's own resolve", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        fs.renameSync(path.join(root, "src/app/view.tsx"), path.join(root, "src/app/panel.tsx"));

        // edges 4 and 6 go with view.tsx; panel.tsx imports ./main again; main.ts's ./view now resolves to nothing
        expect(applyFileChanges(root, ["src/app/view.tsx", "src/app/panel.tsx"]))
            .toMatchObject({ changed: ["src/app/panel.tsx"], deleted: ["src/app/view.tsx"], resolvedAll: true, edgesAdded: 1, edgesRemoved: 2 });
        expect(levelEdgeCount(repoId, "src/app", "src/app/panel.tsx", "src/app/main.ts")).toBe(1);
        expect(levelEdgeCount(repoId, "src/app", "src/app/main.ts", "src/app/view.tsx")).toBe(0);
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("a changed tsconfig re-resolves every file: without the @core alias, src/index.ts's import of it goes", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        fs.writeFileSync(path.join(root, "tsconfig.json"), `{ "compilerOptions": { "baseUrl": "." } }\n`);

        expect(applyFileChanges(root, ["tsconfig.json"]))
            .toMatchObject({ changed: [], deleted: [], unchanged: 1, resolvedAll: true, edgesAdded: 0, edgesRemoved: 1 });
        expect(levelEdgeCount(repoId, "src", "src/index.ts", "src/core")).toBe(0);
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("does nothing for a file whose bytes didn't change, nor for paths that aren't source files", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        const version = readIndexVersion(getDb(), repoId);

        expect(applyFileChanges(root, ["src/core/log.ts", "README.md", "docs/notes.md"]))
            .toMatchObject({ changed: [], deleted: [], unchanged: 3, edgesAdded: 0, edgesRemoved: 0, indexVersion: version });
    });

    it("keeps a new file .gitignore excludes out of the index, as a full run would", () => {
        const root = copyFixture();
        execFileSync("git", ["init", "-q", root]);
        fs.writeFileSync(path.join(root, ".gitignore"), "generated/\n");
        const { repoId } = indexRepository(root);
        write(root, "generated/out.ts", "export const x = 1;\n");
        write(root, "src/fresh.ts", "export const y = 1;\n");

        expect(applyFileChanges(root, ["generated/out.ts", "src/fresh.ts"])).toMatchObject({ changed: ["src/fresh.ts"], unchanged: 1 });
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("a folder deleted as one path (a watcher's unlinkDir) removes every file in it", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        fs.rmSync(path.join(root, "src/util"), { recursive: true });

        expect(applyFileChanges(root, ["src/util"])).toMatchObject({ deleted: ["src/util/strings.test.ts", "src/util/strings.ts"] });
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("refuses to run while another structure run holds the index lock", () => {
        const root = copyFixture();
        indexRepository(root);
        const db = getDb();
        acquireIndexLock(db);
        try{
            expect(() => applyFileChanges(root, ["src/core/log.ts"])).toThrow(IndexLockedError);
        } finally{
            releaseIndexLock(db);
        }
    });
});

describe("applyFileChanges — files over the size cap (ADR-053, amended)", () => {
    const CAPS = { maxFileBytes: 100, hardMaxFileBytes: 200 };

    function declarationsOf(repoId: number, filePath: string){
        const db = getDb();
        const file = db.select({ id: files.id }).from(files).where(and(eq(files.repoId, repoId), eq(files.path, filePath))).get()!;
        return {
            symbols: db.select({ q: symbols.qualifiedName }).from(symbols).where(eq(symbols.fileId, file.id)).all().map((s) => s.q),
            chunks: db.select({ name: chunks.name }).from(chunks).where(eq(chunks.fileId, file.id)).all().map((c) => c.name),
        };
    }

    const edgesOf = (repoId: number): string[] => loadImportEdges(getDb(), repoId).map((e) => `${e.source} -> ${e.target}`).sort();

    it("a file grown over the cap keeps its import edges and loses its declarations and chunks, as a full run stores it", () => {
        const root = makeTempDir("neb-update-cap-");
        write(root, "a.ts", "export const a = 1;\n");
        write(root, "b.ts", 'import { a } from "./a";\nexport function b(): number { return a; }\n');    // 25 + 42 = 67 bytes
        const { repoId } = indexRepository(root, CAPS);
        expect(declarationsOf(repoId, "b.ts").symbols).toEqual(["b"]);

        fs.appendFileSync(path.join(root, "b.ts"), `// ${"x".repeat(60)}\n`);                                // 67 + 64 = 131 bytes
        expect(applyFileChanges(root, ["b.ts"], CAPS)).toMatchObject({ changed: ["b.ts"], deleted: [], edgesAdded: 0, edgesRemoved: 0 });

        expect(edgesOf(repoId)).toEqual(["b.ts -> a.ts"]);
        expect(declarationsOf(repoId, "b.ts")).toEqual({ symbols: [], chunks: [] });
        const twin = makeTempDir("neb-twin-");
        fs.cpSync(root, twin, { recursive: true });
        expect(tables(repoId)).toEqual(tables(indexRepository(twin, CAPS).repoId));
    });

    it("a file grown past the hard bound leaves the index, its edges with it", () => {
        const root = makeTempDir("neb-update-bound-");
        write(root, "a.ts", "export const a = 1;\n");
        write(root, "b.ts", 'import { a } from "./a";\nexport function b(): number { return a; }\n');    // 67 bytes
        const { repoId } = indexRepository(root, CAPS);

        fs.appendFileSync(path.join(root, "b.ts"), `// ${"x".repeat(140)}\n`);                               // 67 + 144 = 211 bytes
        expect(applyFileChanges(root, ["b.ts"], CAPS)).toMatchObject({ changed: [], deleted: ["b.ts"], edgesRemoved: 1 });
        expect(edgesOf(repoId)).toEqual([]);
    });

    it("reads a file past the parse bound with the token scan, as a full run does", () => {
        const root = makeTempDir("neb-update-scan-");
        const caps = { maxFileBytes: 60, parseMaxFileBytes: 150, hardMaxFileBytes: 400 };
        write(root, "a.ts", "export const a = 1;\n");
        const { repoId } = indexRepository(root, caps);

        // the adapter doesn't count a member require, the token scan does; 20 + 204 = 224 bytes
        write(root, "scanned.ts", `foo.require("./a");\n// ${"x".repeat(200)}\n`);
        expect(applyFileChanges(root, ["scanned.ts"], caps)).toMatchObject({ changed: ["scanned.ts"], edgesAdded: 1 });
        expect(edgesOf(repoId)).toEqual(["scanned.ts -> a.ts"]);
        const twin = makeTempDir("neb-twin-");
        fs.cpSync(root, twin, { recursive: true });
        expect(tables(repoId)).toEqual(tables(indexRepository(twin, caps).repoId));
    });

    it("a new file over the cap enters the index with its edges", () => {
        const root = makeTempDir("neb-update-new-");
        write(root, "a.ts", "export const a = 1;\n");
        const { repoId } = indexRepository(root, CAPS);

        write(root, "big.ts", `import { a } from "./a";\nexport const big = a;\n// ${"x".repeat(80)}\n`);       // 25 + 22 + 84 = 131 bytes
        expect(applyFileChanges(root, ["big.ts"], CAPS)).toMatchObject({ changed: ["big.ts"], edgesAdded: 1 });
        expect(edgesOf(repoId)).toEqual(["big.ts -> a.ts"]);
        expect(declarationsOf(repoId, "big.ts")).toEqual({ symbols: [], chunks: [] });
    });
});

describe("what re-resolves every file, and the workspace on every update (ADR-053)", () => {
    it("re-resolves every file when a package.json changes, as for a tsconfig (ADR-053)", () => {
        expect(resolvesEverything("packages/ui/package.json")).toBe(true);
        expect(resolvesEverything("package.json")).toBe(true);
        expect(resolvesEverything("src/tsconfig.base.json")).toBe(true);
        expect(resolvesEverything("src/package-lock.json")).toBe(false);
        expect(resolvesEverything("src/app/main.ts")).toBe(false);
    });

    it("re-resolves every file when the root's workspace declarations change", () => {
        expect(resolvesEverything("pnpm-workspace.yaml")).toBe(true);
        expect(resolvesEverything("lerna.json")).toBe(true);
        expect(resolvesEverything("packages/p/lerna.json")).toBe(false);
    });

    it("keeps a workspace edge when an edit re-resolves only the edited file", () => {
        const root = copyFixture(ARCH_FIXTURE);
        const { repoId } = indexRepository(root);
        write(root, "src/platform/node/storageFile.ts", fs.readFileSync(path.join(root, "src/platform/node/storageFile.ts"), "utf8") + "// touched\n");

        // a comment changes no import: the file's four edges (#27-#30) are re-resolved and come back the same
        expect(applyFileChanges(root, ["src/platform/node/storageFile.ts"]))
            .toMatchObject({ changed: ["src/platform/node/storageFile.ts"], deleted: [], resolvedAll: false, edgesAdded: 0, edgesRemoved: 0 });
        expect(tables(repoId).imports).toContain("src/platform/node/storageFile.ts -> packages/core/src/index.ts (@arch/core)");
        expect(tables(repoId)).toEqual(fullRunOf(root));
    });

    it("a changed package.json replaces the entry points, and moves the index version though no file or edge changed", () => {
        const root = copyFixture(ARCH_FIXTURE);
        const { repoId } = indexRepository(root);
        const version = readIndexVersion(getDb(), repoId);
        write(root, "package.json", JSON.stringify({ name: "arch-repo", private: true, main: "src/app/main.ts", workspaces: ["packages/*"] }));

        // readers cache per index version (ADR-036): a version that stays put would keep serving loader.ts as the entry point
        expect(applyFileChanges(root, ["package.json"]))
            .toMatchObject({ changed: [], deleted: [], resolvedAll: true, edgesAdded: 0, edgesRemoved: 0, indexVersion: version + 1 });
        expect([...loadEntryPoints(getDb(), repoId)].sort()).toEqual(["packages/core/src/index.ts", "packages/ui/src/index.ts", "src/app/main.ts"]);
    });

    it("a package.json saved with the same entry points keeps the index version", () => {
        const root = copyFixture(ARCH_FIXTURE);
        const { repoId } = indexRepository(root);
        const version = readIndexVersion(getDb(), repoId);
        // the same fields, written again with other spacing: everything re-resolves, and nothing it stores changes
        write(root, "package.json", JSON.stringify({ name: "arch-repo", private: true, main: "src/app/loader.ts", workspaces: ["packages/*"] }));

        expect(applyFileChanges(root, ["package.json"])).toMatchObject({ resolvedAll: true, edgesAdded: 0, edgesRemoved: 0, indexVersion: version });
        expect([...loadEntryPoints(getDb(), repoId)].sort()).toEqual(["packages/core/src/index.ts", "packages/ui/src/index.ts", "src/app/loader.ts"]);
    });
});

describe("the resolution state kept between updates (ADR-053 amended, ADR-065)", () => {
    const FILE = "src/platform/node/storageFile.ts";
    const workspaceOf = (r: { resolution: ResolutionState }) => r.resolution.cache.get("typescript:workspace");

    it("reuses the state it is given when nothing re-resolves: the same cache, the same workspace", () => {
        const root = copyFixture(ARCH_FIXTURE);
        const { repoId } = indexRepository(root);
        fs.appendFileSync(path.join(root, FILE), "// one\n");
        const first = applyFileChanges(root, [FILE]);
        fs.appendFileSync(path.join(root, FILE), "// two\n");
        const second = applyFileChanges(root, [FILE], { resolution: first.resolution });

        expect(second.changed).toEqual([FILE]);
        expect(second.resolution).toBe(first.resolution);
        expect(workspaceOf(second)).toBeDefined();
        expect(workspaceOf(second)).toBe(workspaceOf(first));
        expect(tables(repoId).imports).toContain(`${FILE} -> packages/core/src/index.ts (@arch/core)`);
    });

    it("reads the workspace again when a package.json changes", () => {
        const root = copyFixture(ARCH_FIXTURE);
        indexRepository(root);
        fs.appendFileSync(path.join(root, FILE), "// one\n");
        const first = applyFileChanges(root, [FILE]);
        const second = applyFileChanges(root, ["packages/core/package.json"], { resolution: first.resolution });
        expect(second.resolvedAll).toBe(true);
        expect(second.resolution.cache).not.toBe(first.resolution.cache);
        expect(workspaceOf(second)).not.toBe(workspaceOf(first));
    });

    it("reads it again when the file set changes", () => {
        const root = copyFixture(ARCH_FIXTURE);
        indexRepository(root);
        fs.appendFileSync(path.join(root, FILE), "// one\n");
        const first = applyFileChanges(root, [FILE]);
        write(root, "src/base/common/extra.ts", "export const extra = 1;\n");
        const second = applyFileChanges(root, ["src/base/common/extra.ts"], { resolution: first.resolution });
        expect(second.resolution.cache).not.toBe(first.resolution.cache);
        expect(workspaceOf(second)).not.toBe(workspaceOf(first));
    });
});

describe("the incremental update through the language adapters (ADR-065)", () => {
    const adapters = [typescriptAdapter, toyAdapter];

    function repo(files: Record<string, string>): string {
        const dir = makeTempDir("neb-update-adapters-");
        for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
        return dir;
    }
    /** What a full run with the same adapters makes of the same tree, in a twin copy. */
    function fullRunWithAdapters(root: string){
        const twin = makeTempDir("neb-twin-");
        fs.cpSync(root, twin, { recursive: true });
        const { repoId } = indexRepository(twin, { adapters });
        return { ...tables(repoId), entries: [...loadEntryPoints(getDb(), repoId)].sort() };
    }
    const now = (repoId: number) => ({ ...tables(repoId), entries: [...loadEntryPoints(getDb(), repoId)].sort() });

    it("moves an edge when the name it reads moves to another file of the folder, though the importer didn't change", () => {
        // by the toy's rules, name:x reads the other files of a.toy's folder that define x
        const root = repo({ "a.toy": "name x\n", "b.toy": "def x\n", "c.toy": "def y\n" });
        const { repoId } = indexRepository(root, { adapters });
        expect(tables(repoId).imports).toEqual(["a.toy -> b.toy (name:x)"]);

        write(root, "b.toy", "def other\n");
        expect(applyFileChanges(root, ["b.toy"], { adapters })).toMatchObject({ changed: ["b.toy"], resolvedAll: false, edgesRemoved: 1, edgesAdded: 0 });
        expect(tables(repoId).imports).toEqual([]);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));

        write(root, "c.toy", "def y\ndef x\n");
        expect(applyFileChanges(root, ["c.toy"], { adapters })).toMatchObject({ changed: ["c.toy"], resolvedAll: false, edgesAdded: 1 });
        expect(tables(repoId).imports).toEqual(["a.toy -> c.toy (name:x)"]);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));
    });

    it("computes the entry points again when a file's declares change", () => {
        const root = repo({ "a.toy": "def a\n" });
        const { repoId } = indexRepository(root, { adapters });
        expect(now(repoId).entries).toEqual([]);
        write(root, "a.toy", "def a\nmain\n");
        applyFileChanges(root, ["a.toy"], { adapters });
        expect(now(repoId).entries).toEqual(["a.toy"]);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));
    });

    it.each([["walk", false], ["git", true]] as const)("re-applies a manifest's exclusion both ways when it is added or deleted (%s mode)", (_mode, git) => {
        const root = repo({ "a.toy": "use deps/d\n", "deps/d.toy": "def d\n", "deps/e.ts": "export {};\n" });
        if (git) execFileSync("git", ["init", "-q", root]);
        const { repoId } = indexRepository(root, { adapters });
        expect(tables(repoId).imports).toEqual(["a.toy -> deps/d.toy (use:deps/d)"]);

        // a toy.json leaves out every .toy file under the deps/ folder beside it; TypeScript's deps/e.ts stays
        write(root, "toy.json", "{}\n");
        expect(applyFileChanges(root, ["toy.json"], { adapters })).toMatchObject({ deleted: ["deps/d.toy"], resolvedAll: true });
        expect(tables(repoId).files.map((f) => f[0])).toEqual(["a.toy", "deps/e.ts"]);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));

        // deleted again: deps/d.toy is found by listing the repo again, as a full run would find it
        fs.rmSync(path.join(root, "toy.json"));
        expect(applyFileChanges(root, ["toy.json"], { adapters })).toMatchObject({ changed: ["deps/d.toy"], resolvedAll: true });
        expect(tables(repoId).imports).toEqual(["a.toy -> deps/d.toy (use:deps/d)"]);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));
    });

    it("reads a manifest again when it changes, dropping what the cache held", () => {
        // a toy.json's root is a folder `use` paths are read in too, cached under toy:roots
        const root = repo({ "toy.json": "{ \"root\": \"one\" }\n", "a.toy": "use m\n", "one/m.toy": "def m\n", "two/m.toy": "def m\n" });
        const { repoId } = indexRepository(root, { adapters });
        expect(tables(repoId).imports).toEqual(["a.toy -> one/m.toy (use:m)"]);
        write(root, "a.toy", "use m\n# warm\n");
        const warm = applyFileChanges(root, ["a.toy"], { adapters });
        expect(warm.resolution.cache.get("toy:roots")).toEqual(["one"]);

        write(root, "toy.json", "{ \"root\": \"two\" }\n");
        const after = applyFileChanges(root, ["toy.json"], { adapters, resolution: warm.resolution });
        expect(after.resolution.cache.get("toy:roots")).toEqual(["two"]);
        expect(tables(repoId).imports).toEqual(["a.toy -> two/m.toy (use:m)"]);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));
    });

    it("refuses to parse a file whose grammar this process hasn't loaded", () => {
        const root = repo({ "a.ts": "export {};\n", "b.toy": "def b\n" });
        indexRepository(root, { adapters });
        const unprepared = { ...toyAdapter, grammar: "missing.wasm" };
        write(root, "b.toy", "def c\n");
        expect(() => applyFileChanges(root, ["b.toy"], { adapters: [typescriptAdapter, unprepared] })).toThrow(GrammarNotLoadedError);
        write(root, "a.ts", "export const a = 1;\n");
        expect(applyFileChanges(root, ["a.ts"], { adapters: [typescriptAdapter, unprepared] }).changed).toEqual(["a.ts"]);
    });

    it("reads an edited file whose parse now throws with the scan, keeping its row and its imports (the E4 final review's B-I1)", () => {
        // a toy whose full and parse readings throw on a line `deep` (a recursive walk's overflow); its scan reads only `use` lines
        const throwing: LanguageAdapter = {
            ...toyAdapter,
            parse(p, text, reading){
                if (reading !== "scan" && text.includes("deep")) throw new RangeError("Maximum call stack size exceeded");
                return toyAdapter.parse(p, text, reading);
            },
        };
        const both = [typescriptAdapter, throwing];
        // by the toy's rules: use:b names b.toy; name:y names the other file of the folder that defines y, c.toy
        const root = repo({ "a.toy": "use b\nname y\n", "b.toy": "def b\n", "c.toy": "def y\n" });
        const { repoId } = indexRepository(root, { adapters: both });
        expect(tables(repoId).imports).toEqual(["a.toy -> b.toy (use:b)", "a.toy -> c.toy (name:y)"]);

        write(root, "a.toy", "use b\nname y\ndeep\n");
        expect(applyFileChanges(root, ["a.toy"], { adapters: both })).toMatchObject({
            changed: ["a.toy"], errors: [], scanned: [{ path: "a.toy", error: "Maximum call stack size exceeded" }], edgesAdded: 0, edgesRemoved: 1,
        });
        expect(tables(repoId).imports).toEqual(["a.toy -> b.toy (use:b)"]);   // the scan reads no name:y
        const twin = makeTempDir("neb-twin-");
        fs.cpSync(root, twin, { recursive: true });
        expect(tables(repoId)).toEqual(tables(indexRepository(twin, { adapters: both }).repoId));
    });

    it("starts the resolution state again when a folder holding only a manifest is deleted (the E4 final review's m6)", () => {
        // sub/ holds a toy.json and no indexed file, so deleting it moves the manifest list but not the file set
        const root = repo({ "a.toy": "def a\n", "sub/toy.json": "{}\n" });
        const { repoId } = indexRepository(root, { adapters });
        write(root, "a.toy", "def a\n# one\n");
        const first = applyFileChanges(root, ["a.toy"], { adapters });
        expect(first.resolution.manifests).toEqual(["sub/toy.json"]);

        fs.rmSync(path.join(root, "sub"), { recursive: true });
        const second = applyFileChanges(root, ["sub"], { adapters, resolution: first.resolution });
        expect(second).toMatchObject({ changed: [], deleted: [], resolvedAll: true, edgesAdded: 0, edgesRemoved: 0 });
        expect(second.resolution.manifests).toEqual([]);
        expect(second.resolution.cache).not.toBe(first.resolution.cache);
        expect(now(repoId)).toEqual(fullRunWithAdapters(root));
    });
});
