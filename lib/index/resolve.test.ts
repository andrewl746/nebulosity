import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { FIXTURE } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { createResolver } from "./resolve";

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
