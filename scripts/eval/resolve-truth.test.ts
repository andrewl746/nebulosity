import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createTruthResolver, pnpmWorkspaceGlobs } from "./resolve-truth";
import { scanRepo } from "./scan";

const FIXTURE = path.resolve("test/fixtures/arch-repo");

// Every expectation below is the arch-repo ground truth's ("the truth builder", the edge table's "how" column), or
// follows by hand from ADR-053's rules applied to the small repos this file writes.
describe("createTruthResolver on the arch-repo fixture", () => {
    const resolve = createTruthResolver(FIXTURE, scanRepo(FIXTURE).files);

    it("resolves workspace packages by name: main mapped from lib to src, an exports subpath, the \".\" export", () => {
        expect(resolve("packages/ui/src/button.ts", "@arch/core/lib/log")).toBe("packages/core/src/log.ts");
        expect(resolve("src/platform/node/storageFile.ts", "@arch/core")).toBe("packages/core/src/index.ts");
        expect(resolve("src/app/main.ts", "@arch/ui")).toBe("packages/ui/src/index.ts");
        // "./*": "./src/*.ts"
        expect(resolve("src/app/main.ts", "@arch/ui/button")).toBe("packages/ui/src/button.ts");
    });

    it("reads a module id against the one folder holding a tsconfig that has the file", () => {
        expect(resolve("tools/fixtures/legacy-ids.ts", "base/common/strings")).toBe("src/base/common/strings.ts");
        // #5's second literal: app/main.js reaches src/app/main.ts through the id root src
        expect(resolve("src/app/loader.ts", "app/main.js")).toBe("src/app/main.ts");
    });

    it("leaves npm packages, protocols and unknown scoped names unresolved, and still resolves relative specifiers", () => {
        expect(resolve("src/app/main.ts", "react")).toBeNull();
        expect(resolve("tools/fixtures/legacy-ids.ts", "react")).toBeNull();
        expect(resolve("src/app/main.ts", "node:fs")).toBeNull();
        expect(resolve("src/app/main.ts", "@arch/missing")).toBeNull();
        expect(resolve("src/app/legacy.ts", "../base/common/strings")).toBe("src/base/common/strings.ts");
    });
});

/** Writes a small repo of the given files (path → text) into a fresh temporary folder: no .git, so the eval walks it. */
function writeRepo(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-truth-"));
    for (const [file, text] of Object.entries(files)){
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
    return root;
}

describe("createTruthResolver: only declared workspaces resolve by name (ADR-053, F2)", () => {
    let yarnRepo = "";
    let pnpmRepo = "";
    beforeAll(() => {
        yarnRepo = writeRepo({
            // yarn's object form; packages/** covers packages/libs/ui and packages/private, and ! takes packages/private back out
            "package.json": JSON.stringify({ name: "root", workspaces: { packages: ["packages/**", "fixtures/*", "!packages/private"] } }),
            "packages/libs/ui/package.json": JSON.stringify({ name: "@x/ui", main: "index.ts" }),
            "packages/libs/ui/index.ts": "export const ui = 1;\n",
            "packages/private/package.json": JSON.stringify({ name: "@x/private", main: "index.ts" }),
            "packages/private/index.ts": "export const secret = 1;\n",
            // a declared fixture with the same name, shallower than the real package
            "fixtures/ui/package.json": JSON.stringify({ name: "@x/ui", main: "index.ts" }),
            "fixtures/ui/index.ts": "export const fake = 1;\n",
            // tools holds a tsconfig, so it is an id root; tools/gulp is a package no workspace declares
            "tools/tsconfig.json": "{ \"compilerOptions\": {} }\n",
            "tools/gulp/package.json": JSON.stringify({ name: "gulp", main: "index.ts" }),
            "tools/gulp/index.ts": "export const gulp = 1;\n",
            "tools/gulp/lib/run.ts": "export const run = 1;\n",
            "tools/util/paths.ts": "export const paths = 1;\n",
            "app/main.ts": "export {};\n",
        });
        pnpmRepo = writeRepo({
            "package.json": JSON.stringify({ name: "mono" }),
            "pnpm-workspace.yaml": "packages:\n  # the apps\n  - 'apps/*'\n  - \"libs/**\"\n  - '!libs/legacy/**'\nonlyBuiltDependencies:\n  - esbuild\n",
            "lerna.json": JSON.stringify({ packages: ["modules/*"] }),
            "apps/web/package.json": JSON.stringify({ name: "web", main: "src/main.ts" }),
            "apps/web/src/main.ts": "export {};\n",
            // types names a .d.ts nobody has; import's ./dist/index.js maps through outDir → rootDir to src/index.ts
            "libs/core/package.json": JSON.stringify({ name: "@m/core", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
            "libs/core/tsconfig.json": "{\n  // compiled to dist\n  \"compilerOptions\": { \"outDir\": \"dist\", \"rootDir\": \"src\", },\n}\n",
            "libs/core/src/index.ts": "export const core = 1;\n",
            "libs/legacy/old/package.json": JSON.stringify({ name: "@m/old", main: "index.ts" }),
            "libs/legacy/old/index.ts": "export const old = 1;\n",
            "modules/a/package.json": JSON.stringify({ name: "a-mod", main: "a.ts" }),
            "modules/a/a.ts": "export const a = 1;\n",
            // node_modules is never read: its package would otherwise be a third @m/core
            "node_modules/@m/core/package.json": JSON.stringify({ name: "@m/core", main: "index.ts" }),
            "node_modules/@m/core/index.ts": "export const installed = 1;\n",
        });
    });
    afterAll(() => {
        for (const root of [yarnRepo, pnpmRepo]) fs.rmSync(root, { recursive: true, force: true });
    });

    it("never resolves a package no workspace declares by its name, nor reads a module id that starts with that name", () => {
        const resolve = createTruthResolver(yarnRepo, scanRepo(yarnRepo).files);
        expect(resolve("app/main.ts", "gulp")).toBeNull();
        expect(resolve("app/main.ts", "gulp/lib/run")).toBeNull();
        // the id root works for a module id no package name explains
        expect(resolve("app/main.ts", "util/paths")).toBe("tools/util/paths.ts");
    });

    it("takes a folder a leading ! excludes back out of the workspaces", () => {
        const resolve = createTruthResolver(yarnRepo, scanRepo(yarnRepo).files);
        expect(resolve("app/main.ts", "@x/private")).toBeNull();
    });

    it("breaks a name shared by two declared packages toward the real folder, before the shallower fixture", () => {
        const resolve = createTruthResolver(yarnRepo, scanRepo(yarnRepo).files);
        expect(resolve("app/main.ts", "@x/ui")).toBe("packages/libs/ui/index.ts");
    });

    it("reads pnpm-workspace.yaml's list line by line and lerna.json's packages; tries export conditions in order through outDir → rootDir", () => {
        const resolve = createTruthResolver(pnpmRepo, scanRepo(pnpmRepo).files);
        expect(resolve("modules/a/a.ts", "web")).toBe("apps/web/src/main.ts");
        expect(resolve("apps/web/src/main.ts", "@m/core")).toBe("libs/core/src/index.ts");
        expect(resolve("apps/web/src/main.ts", "@m/old")).toBeNull();
        expect(resolve("apps/web/src/main.ts", "a-mod")).toBe("modules/a/a.ts");
    });
});

describe("a byte-order mark (sweep B, item 8)", () => {
    let bomRepo = "";
    beforeAll(() => {
        bomRepo = writeRepo({
            // Windows editors save files with a BOM: pnpm reads this list as apps/*, so "web" is a declared workspace
            "pnpm-workspace.yaml": "\uFEFFpackages:\n  - 'apps/*'\n",
            "apps/web/package.json": "\uFEFF" + JSON.stringify({ name: "web", main: "src/main.ts" }),
            "apps/web/src/main.ts": "export {};\n",
            "lib/x.ts": "export {};\n",
        });
    });
    afterAll(() => fs.rmSync(bomRepo, { recursive: true, force: true }));

    it("is dropped from pnpm-workspace.yaml as it is from package.json, so the workspace resolves", () => {
        expect(pnpmWorkspaceGlobs("\uFEFFpackages:\n  - 'apps/*'\n")).toEqual(["apps/*"]);
        const resolve = createTruthResolver(bomRepo, scanRepo(bomRepo).files);
        expect(resolve("lib/x.ts", "web")).toBe("apps/web/src/main.ts");
    });

    it("is written as an escape in the source, never as the invisible character itself", () => {
        expect(fs.readFileSync(path.resolve("scripts", "eval", "resolve-truth.ts"), "utf8")).not.toContain("\uFEFF");
    });
});
