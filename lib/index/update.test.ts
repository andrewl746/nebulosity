import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { ARCH_FIXTURE, copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { chunks, files, folders, levelEdges, symbols } from "../db/schema";
import { loadEntryPoints } from "../db/store/entries";
import { acquireIndexLock, IndexLockedError, releaseIndexLock } from "../db/store/lock";
import { loadImportEdges } from "../db/store/structure";
import { loadFileFacts, loadFolderFacts, loadSummaries } from "../db/store/summaries";
import { readIndexVersion } from "../db/store/version";
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
