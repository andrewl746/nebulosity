import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { FIXTURE } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { discoverFiles } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { createResolver } from "./resolve";
import { readWorkspace } from "./workspace";

const FIXTURE_FILES = new Set([
    "scripts/build.js", "src/app/main.ts", "src/app/view.tsx", "src/core/index.ts",
    "src/core/log.ts", "src/index.ts", "src/util/strings.test.ts", "src/util/strings.ts",
]);

function makeRepo(files: Record<string, string>): string {
    const dir = makeTempDir("neb-resolve-");
    for (const [rel, content] of Object.entries(files)){
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
}

describe("createResolver — the fixture's edges", () => {
    const resolve = createResolver(FIXTURE, FIXTURE_FILES);

    it("resolves relative imports by trying extensions", () => {
        expect(resolve("src/index.ts", "./app/main")).toBe("src/app/main.ts");
        expect(resolve("scripts/build.js", "../src/index")).toBe("src/index.ts");
    });

    it("resolves tsconfig paths aliases (read as JSONC, like TypeScript)", () => {
        expect(resolve("src/index.ts", "@core/log")).toBe("src/core/log.ts");
    });

    it("maps NodeNext .js specifiers onto .ts files", () => {
        expect(resolve("src/app/main.ts", "../util/strings.js")).toBe("src/util/strings.ts");
    });

    it("resolves a directory import to its index file", () => {
        expect(resolve("src/util/strings.ts", "../core")).toBe("src/core/index.ts");
    });

    it("returns null for packages, for paths that leave the repo, and for self-imports", () => {
        expect(resolve("src/app/view.tsx", "react")).toBeNull();
        expect(resolve("src/index.ts", "../../outside")).toBeNull();
        expect(resolve("src/core/index.ts", "./index")).toBeNull();
    });
});

describe("createResolver — tsconfig edge cases", () => {
    it("follows a relative `extends` to inherit paths", () => {
        const dir = makeRepo({
            "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "~/*": ["lib/*"] } } }),
            "packages/app/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json" }),
            "lib/x.ts": "export {};\n",
            "packages/app/main.ts": "export {};\n",
        });
        const resolve = createResolver(dir, new Set(["lib/x.ts", "packages/app/main.ts"]));
        expect(resolve("packages/app/main.ts", "~/x")).toBe("lib/x.ts");
    });

    it("survives a malformed tsconfig: aliases stay unresolved, relative imports still work", () => {
        const dir = makeRepo({ "tsconfig.json": "{ not json", "a.ts": "export {};\n", "b.ts": "export {};\n" });
        const resolve = createResolver(dir, new Set(["a.ts", "b.ts"]));
        expect(resolve("a.ts", "./b")).toBe("b.ts");
        expect(resolve("a.ts", "@x/y")).toBeNull();
    });
});

describe("createResolver with the workspace (ADR-053)", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    const found = discoverFiles(root, { extensions: TYPESCRIPT_EXTENSIONS });
    const files = new Set(found.files.map((f) => f.path));
    const resolve = createResolver(root, files, { workspace: readWorkspace(root, found.manifests) });

    it("resolves a workspace package through its main, compiled path mapped to source", () => {
        expect(resolve("src/platform/node/storageFile.ts", "@arch/core")).toBe("packages/core/src/index.ts");
    });

    it("resolves a workspace subpath through the package's outDir → rootDir", () => {
        expect(resolve("packages/ui/src/button.ts", "@arch/core/lib/log")).toBe("packages/core/src/log.ts");
    });

    it("resolves a package's '.' export and a '*' pattern export", () => {
        expect(resolve("src/app/main.ts", "@arch/ui")).toBe("packages/ui/src/index.ts");
        expect(resolve("src/app/main.ts", "@arch/ui/button")).toBe("packages/ui/src/button.ts");
    });

    it("reads a module id against the one folder holding a tsconfig that has the file (R3)", () => {
        expect(resolve("tools/fixtures/legacy-ids.ts", "base/common/strings")).toBe("src/base/common/strings.ts");
        expect(resolve("src/app/loader.ts", "app/main.js")).toBe("src/app/main.ts");
    });

    it("leaves externals, one-segment names, scoped names that aren't packages and protocols unresolved", () => {
        expect(resolve("src/app/main.ts", "react")).toBeNull();
        expect(resolve("src/app/main.ts", "@other/thing/x")).toBeNull();
        expect(resolve("src/app/main.ts", "node:fs/promises")).toBeNull();
    });

    it("refuses a module id two roots both hold", () => {
        const both = createResolver("/repo", new Set(["a/lib/x.ts", "b/lib/x.ts", "c/main.ts"]), {
            workspace: { byName: new Map(), packages: [], idRoots: ["a", "b"], outDirs: [] },
        });
        expect(both("c/main.ts", "lib/x")).toBeNull();
    });

    it("still resolves relative imports first, as before", () => {
        expect(resolve("src/app/main.ts", "../editor/node/editorFiles")).toBe("src/editor/node/editorFiles.ts");
    });
});
