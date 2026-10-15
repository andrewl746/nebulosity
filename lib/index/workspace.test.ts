import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/helpers/temp";
import { discoverFiles } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { createResolver, createSourceFinder } from "./resolve";
import { declaredEntries, expandBraces, flattenExports, flattenImports, packageNameOf, readWorkspace } from "./workspace";

const fixture = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
const found = discoverFiles(fixture, { extensions: TYPESCRIPT_EXTENSIONS });
const workspace = readWorkspace(fixture, found.manifests);

/** A repo in the temp folder holding these files; an object is written as JSON. Call it from inside a test. */
function makeRepo(files: Record<string, string | object>): string {
    const root = makeTempDir("neb-ws-");
    for (const [rel, content] of Object.entries(files)){
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), typeof content === "string" ? content : JSON.stringify(content));
    }
    return root;
}

describe("readWorkspace on the architecture fixture", () => {
    it("knows the three packages by name", () => {
        expect([...workspace.byName.keys()].sort()).toEqual(["@arch/core", "@arch/ui", "arch-repo"]);
        expect(workspace.byName.get("@arch/core")!.dir).toBe("packages/core");
        expect(workspace.byName.get("arch-repo")!.dir).toBe("");
    });

    it("reads module ids against the folders that hold a tsconfig", () => {
        expect(workspace.idRoots).toEqual(["packages/core", "src", "tools"]);
    });

    it("maps compiled folders to their sources only where a tsconfig sets both outDir and rootDir", () => {
        expect(workspace.outDirs).toEqual([{ outDir: "packages/core/lib", rootDir: "packages/core/src" }]);
    });

    it("finds the entry points each package.json names", () => {
        const findSource = createSourceFinder(new Set(found.files.map((f) => f.path)), workspace);
        expect(declaredEntries(workspace, findSource)).toEqual([
            { path: "packages/core/src/index.ts", declaredBy: "packages/core/package.json main" },
            { path: "packages/ui/src/index.ts", declaredBy: 'packages/ui/package.json exports "."' },
            { path: "src/app/loader.ts", declaredBy: "package.json main" },
        ]);
    });
});

describe("flattenExports", () => {
    it("reads a string as the package's main export", () => {
        expect(flattenExports("./index.js")).toEqual(new Map([[".", ["./index.js"]]]));
    });

    it("keeps subpath keys and orders each entry's conditions: source, types, import, then default", () => {
        expect(flattenExports({ ".": { default: "./lib/index.js", types: "./lib/index.d.ts", source: "./src/index.ts" }, "./*": "./src/*.ts" }))
            .toEqual(new Map([[".", ["./src/index.ts", "./lib/index.d.ts", "./lib/index.js"]], ["./*", ["./src/*.ts"]]]));
    });

    it("reads a map of conditions with no subpaths as the main export, and drops null targets", () => {
        expect(flattenExports({ import: "./a.mjs", require: null })).toEqual(new Map([[".", ["./a.mjs"]]]));
    });
});

describe("expandBraces", () => {
    it("opens each group, nested or one after another, and leaves a group with no choice or no end as written", () => {
        expect(expandBraces("{apps,packages}/*")).toEqual(["apps/*", "packages/*"]);
        expect(expandBraces("a/{b,c}/{d,e}")).toEqual(["a/b/d", "a/b/e", "a/c/d", "a/c/e"]);
        expect(expandBraces("ui-{web,{native,desktop}}")).toEqual(["ui-web", "ui-native", "ui-desktop"]);
        expect(expandBraces("{x}/{a,b}")).toEqual(["{x}/a", "{x}/b"]);
        expect(expandBraces("open{a,b")).toEqual(["open{a,b"]);
        expect(expandBraces("packages/*")).toEqual(["packages/*"]);
    });
});

describe("packageNameOf", () => {
    it("keeps a scope with its name and drops a subpath", () => {
        expect(packageNameOf("@arch/core/lib/log")).toBe("@arch/core");
        expect(packageNameOf("lodash/fp")).toBe("lodash");
    });
});

describe("two packages with one name (Review Focus 1)", () => {
    it("prefers the one outside test, fixture and example folders, then the shallower", () => {
        // every copy is a declared workspace; by path order alone fixtures/ui would win, by realness alone packages/deep/ui
        const root = makeRepo({
            "package.json": { name: "x", workspaces: ["packages/**", "fixtures/*"] },
            "fixtures/ui/package.json": { name: "@x/ui", main: "fake.js" },
            "packages/deep/ui/package.json": { name: "@x/ui", main: "deep.js" },
            "packages/ui/package.json": { name: "@x/ui", main: "real.js" },
            "packages/ui-copy/examples/package.json": { name: "@x/ui", main: "example.js" },
        });
        const ws = readWorkspace(root, [
            "fixtures/ui/package.json", "package.json", "packages/deep/ui/package.json", "packages/ui-copy/examples/package.json", "packages/ui/package.json",
        ]);
        expect(ws.byName.get("@x/ui")!.dir).toBe("packages/ui");
    });
});

describe("which packages resolve by name: the root and the declared workspaces (ADR-053)", () => {
    it("never resolves to a package outside them, though its package.json still names its entry point", () => {
        // VS Code's case: build/ imports the npm package "gulp", and extensions/gulp is a folder whose package.json says "gulp"
        const root = makeRepo({
            "package.json": { name: "app", workspaces: ["packages/*"] },
            "packages/core/package.json": { name: "@app/core", main: "src/index.ts" },
            "packages/core/src/index.ts": "export {};\n",
            "extensions/gulp/package.json": { name: "gulp", main: "./out/main.js" },
            "extensions/gulp/tsconfig.json": { compilerOptions: { outDir: "./out", rootDir: "./src" } },
            "extensions/gulp/src/main.ts": "export {};\n",
            "build/lib/task.ts": 'import gulp from "gulp";\n',
        });
        const files = new Set(["build/lib/task.ts", "extensions/gulp/src/main.ts", "packages/core/src/index.ts"]);
        const ws = readWorkspace(root, ["extensions/gulp/package.json", "extensions/gulp/tsconfig.json", "package.json", "packages/core/package.json"]);

        expect([...ws.byName.keys()].sort()).toEqual(["@app/core", "app"]);
        const resolve = createResolver(root, files, { workspace: ws });
        expect(resolve("build/lib/task.ts", "gulp")).toBeNull();
        expect(resolve("build/lib/task.ts", "@app/core")).toBe("packages/core/src/index.ts");
        expect(declaredEntries(ws, createSourceFinder(files, ws))).toEqual([
            { path: "extensions/gulp/src/main.ts", declaredBy: "extensions/gulp/package.json main" },
            { path: "packages/core/src/index.ts", declaredBy: "packages/core/package.json main" },
        ]);
    });

    it("never reaches an undeclared package through a module id either (F2): its name stands in for nothing", () => {
        // the review's probe: extensions/ holds a tsconfig, so "gulp/src/main" read as a module id names extensions/gulp/src/main.ts,
        // the folder of the undeclared package "gulp"; a module id whose first segment names no package still resolves
        const root = makeRepo({
            "package.json": { name: "app", workspaces: ["packages/*"] },
            "extensions/gulp/package.json": { name: "gulp", main: "./out/main.js" },
            "extensions/gulp/src/main.ts": "export {};\n",
            "extensions/tsconfig.base.json": { compilerOptions: {} },
            "extensions/shared/util.ts": "export {};\n",
            "build/lib/task.ts": 'import "gulp/src/main";\nimport "shared/util";\n',
        });
        const ws = readWorkspace(root, ["extensions/gulp/package.json", "extensions/tsconfig.base.json", "package.json"]);
        expect(ws.idRoots).toEqual(["extensions"]);
        const resolve = createResolver(root, new Set(["build/lib/task.ts", "extensions/gulp/src/main.ts", "extensions/shared/util.ts"]), { workspace: ws });
        expect(resolve("build/lib/task.ts", "gulp")).toBeNull();
        expect(resolve("build/lib/task.ts", "gulp/src/main")).toBeNull();
        expect(resolve("build/lib/task.ts", "shared/util")).toBe("extensions/shared/util.ts");
    });

    it("blocks a module id only inside the undeclared package's own folder: a fixture named common leaves src/common reachable (final review, A row 429)", () => {
        // the review's probe, case 2: test/fixtures/common/package.json is called "common" and declared nowhere, while
        // src/ holds a tsconfig, so "common/strings" read against src/ names src/common/strings.ts, outside that folder
        const root = makeRepo({
            "package.json": { name: "app" },
            "src/tsconfig.json": {},
            "src/common/strings.ts": "export const s = 1;\n",
            "src/browser/view.ts": "import { s } from 'common/strings';\n",
            "test/fixtures/common/package.json": { name: "common" },
            "test/fixtures/common/index.js": "",
        });
        const ws = readWorkspace(root, ["package.json", "src/tsconfig.json", "test/fixtures/common/package.json"]);
        expect([...ws.byName.keys()]).toEqual(["app"]);
        const resolve = createResolver(root, new Set(["src/browser/view.ts", "src/common/strings.ts", "test/fixtures/common/index.js"]), { workspace: ws });
        expect(resolve("src/browser/view.ts", "common/strings")).toBe("src/common/strings.ts");
        expect(resolve("src/browser/view.ts", "common")).toBeNull();   // the bare name still names no folder of the repo's
    });

    it("with no workspaces declared, resolves only the root package by name", () => {
        const root = makeRepo({
            "package.json": { name: "app", main: "src/main.ts" },
            "packages/a/package.json": { name: "@x/a", main: "index.ts" },
        });
        expect([...readWorkspace(root, ["package.json", "packages/a/package.json"]).byName.keys()]).toEqual(["app"]);
    });

    it("reads pnpm-workspace.yaml's packages list: quoted or not, a trailing comment, ** at any depth, and ends it at the next key", () => {
        const root = makeRepo({
            "pnpm-workspace.yaml": [
                "# the workspace",
                "packages:",
                "  - 'packages/*'",
                '  - "apps/**"   # every app, at any depth',
                "",
                "  - tools/cli",
                "onlyBuiltDependencies:",
                "  - esbuild",
                "",
            ].join("\n"),
            "packages/a/package.json": { name: "@x/a" },
            "apps/web/site/package.json": { name: "@x/site" },
            "tools/cli/package.json": { name: "@x/cli" },
            "tools/other/package.json": { name: "@x/other" },
            "esbuild/package.json": { name: "esbuild" },
        });
        const ws = readWorkspace(root, ["apps/web/site/package.json", "esbuild/package.json", "packages/a/package.json", "tools/cli/package.json", "tools/other/package.json"]);
        expect([...ws.byName.keys()].sort()).toEqual(["@x/a", "@x/cli", "@x/site"]);
    });

    it("drops a folder a leading ! excludes (yarn's object form)", () => {
        const root = makeRepo({
            "package.json": { private: true, workspaces: { packages: ["packages/*", "!packages/legacy"], nohoist: ["**/react"] } },
            "packages/a/package.json": { name: "@x/a" },
            "packages/legacy/package.json": { name: "@x/legacy" },
        });
        const ws = readWorkspace(root, ["package.json", "packages/a/package.json", "packages/legacy/package.json"]);
        expect([...ws.byName.keys()]).toEqual(["@x/a"]);
    });

    it("opens brace groups in a workspace glob: one alternative per group, inside a folder name or across folders", () => {
        const root = makeRepo({
            "package.json": { name: "app", workspaces: ["{apps,packages}/*", "tools/{cli,dev}", "libs/ui-{web,{native,desktop}}"] },
            "apps/web/package.json": { name: "@x/web" },
            "packages/a/package.json": { name: "@x/a" },
            "tools/cli/package.json": { name: "@x/cli" },
            "tools/dev/package.json": { name: "@x/dev" },
            "tools/other/package.json": { name: "@x/other" },
            "libs/ui-desktop/package.json": { name: "@x/desktop" },
            "libs/ui-mobile/package.json": { name: "@x/mobile" },
            "{apps,packages}/odd/package.json": { name: "@x/odd" },
        });
        const ws = readWorkspace(root, ["{apps,packages}/odd/package.json", "apps/web/package.json", "libs/ui-desktop/package.json", "libs/ui-mobile/package.json",
            "package.json", "packages/a/package.json", "tools/cli/package.json", "tools/dev/package.json", "tools/other/package.json"]);
        expect([...ws.byName.keys()].sort()).toEqual(["@x/a", "@x/cli", "@x/desktop", "@x/dev", "@x/web", "app"]);
    });

    it("reads lerna.json's packages", () => {
        const root = makeRepo({
            "lerna.json": { version: "1.0.0", packages: ["modules/*"] },
            "modules/m/package.json": { name: "@x/m" },
            "other/o/package.json": { name: "@x/o" },
        });
        expect([...readWorkspace(root, ["modules/m/package.json", "other/o/package.json"]).byName.keys()]).toEqual(["@x/m"]);
    });
});

describe("compiled paths to sources", () => {
    it("maps a root package's dist/ to the repo root when its tsconfig's rootDir is \".\" (final review, A-I1)", () => {
        // a one-package library or CLI: the sources sit at the root and compile to dist/, so dist/index.js is index.ts
        const root = makeRepo({
            "package.json": { name: "solo", main: "dist/index.js", bin: "dist/cli.js" },
            "tsconfig.json": { compilerOptions: { outDir: "dist", rootDir: "." } },
            "index.ts": "export const a = 1;\n",
            "cli.ts": "import './index';\n",
        });
        const ws = readWorkspace(root, ["package.json", "tsconfig.json"]);
        expect(ws.outDirs).toEqual([{ outDir: "dist", rootDir: "" }]);
        expect(declaredEntries(ws, createSourceFinder(new Set(["cli.ts", "index.ts"]), ws))).toEqual([
            { path: "cli.ts", declaredBy: "package.json bin" },
            { path: "index.ts", declaredBy: "package.json main" },
        ]);
    });
});

describe("module-id roots (R3)", () => {
    it("leaves out a tsconfig inside a test, fixture or example folder", () => {
        const root = makeRepo({
            "src/tsconfig.json": { compilerOptions: {} },
            "test/fixtures/proj/tsconfig.json": { compilerOptions: {} },
            "examples/demo/tsconfig.json": { compilerOptions: {} },
            "src/main.ts": "export {};\n",
            "test/fixtures/proj/lib/x.ts": "export {};\n",
        });
        const ws = readWorkspace(root, ["examples/demo/tsconfig.json", "src/tsconfig.json", "test/fixtures/proj/tsconfig.json"]);
        expect(ws.idRoots).toEqual(["src"]);
        // only the fixture's folder holds lib/x, so the id means nothing
        expect(createResolver(root, new Set(["src/main.ts", "test/fixtures/proj/lib/x.ts"]), { workspace: ws })("src/main.ts", "lib/x")).toBeNull();
    });
});

describe("flattenImports", () => {
    it("keeps '#' keys whose targets are inside the package, conditions ordered as for exports", () => {
        expect(flattenImports({ "#a": "./a.js", "#b/*": { default: "./b/*.js", types: "./b/*.d.ts" }, "#c": null, "#d": "dep", "./e": "./e.js" }))
            .toEqual(new Map([["#a", ["./a.js"]], ["#b/*", ["./b/*.d.ts", "./b/*.js"]]]));
    });

    it("reads nothing from a field that isn't an object", () => {
        expect(flattenImports(undefined)).toEqual(new Map());
        expect(flattenImports(["./x.js"])).toEqual(new Map());
    });
});

describe("subpath imports: a '#…' specifier reads the nearest package.json's imports (Node's package scope)", () => {
    it("resolves exact keys, '*' patterns and conditions, as exports are read", () => {
        // the imports of vite's packages/vite/package.json at bd325338, and a target naming an npm package
        const root = makeRepo({
            "package.json": { name: "monorepo", private: true },
            "packages/vite/package.json": {
                name: "vite",
                imports: {
                    "#module-sync-enabled": { "module-sync": "./misc/true.js", default: "./misc/false.js" },
                    "#types/*": "./types/*.d.ts",
                    "#dep-types/*": "./src/types/*.d.ts",
                    "#npm": "some-npm-package",
                },
            },
        });
        const files = new Set([
            "packages/vite/misc/false.js", "packages/vite/misc/true.js", "packages/vite/src/node/config.ts",
            "packages/vite/src/types/alias.d.ts", "packages/vite/types/hot.d.ts",
        ]);
        const resolve = createResolver(root, files, { workspace: readWorkspace(root, ["package.json", "packages/vite/package.json"]) });
        const importer = "packages/vite/src/node/config.ts";

        expect(resolve(importer, "#types/hot")).toBe("packages/vite/types/hot.d.ts");
        expect(resolve(importer, "#dep-types/alias")).toBe("packages/vite/src/types/alias.d.ts");
        // "default" is one of the conditions tried in order; "module-sync" isn't, so it comes after
        expect(resolve(importer, "#module-sync-enabled")).toBe("packages/vite/misc/false.js");
        expect(resolve(importer, "#npm")).toBeNull();
        expect(resolve(importer, "#types/missing")).toBeNull();
    });

    it("reads only the nearest package.json, named or not", () => {
        const root = makeRepo({
            "package.json": { name: "app", imports: { "#util": "./lib/util.ts" } },
            "tools/package.json": { private: true },
        });
        const files = new Set(["lib/util.ts", "src/a.ts", "tools/b.ts"]);
        const resolve = createResolver(root, files, { workspace: readWorkspace(root, ["package.json", "tools/package.json"]) });

        expect(resolve("src/a.ts", "#util")).toBe("lib/util.ts");
        expect(resolve("tools/b.ts", "#util")).toBeNull();   // tools/package.json is its scope, and it has no imports
    });
});
