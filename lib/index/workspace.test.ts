import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/helpers/temp";
import { discoverFiles } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { createResolver, createSourceFinder } from "./resolve";
import { declaredEntries, flattenExports, packageNameOf, readWorkspace } from "./workspace";

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

    it("reads lerna.json's packages", () => {
        const root = makeRepo({
            "lerna.json": { version: "1.0.0", packages: ["modules/*"] },
            "modules/m/package.json": { name: "@x/m" },
            "other/o/package.json": { name: "@x/o" },
        });
        expect([...readWorkspace(root, ["modules/m/package.json", "other/o/package.json"]).byName.keys()]).toEqual(["@x/m"]);
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
