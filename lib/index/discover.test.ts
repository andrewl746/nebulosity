import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { discoverFiles, isTestPath, readGitHead } from "./discover";

const FIXTURE = path.resolve("test/fixtures/mini-repo");
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function tempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("discoverFiles — walking (no .git)", () => {
    it("finds the fixture's 8 source files, sorted, and nothing else", () => {
        const result = discoverFiles(FIXTURE, { extensions: TS_EXTENSIONS });
        expect(result.usedGit).toBe(false);
        expect(result.skipped).toEqual([]);
        expect(result.files.map((f) => f.path)).toEqual([
            "scripts/build.js",
            "src/app/main.ts",
            "src/app/view.tsx",
            "src/core/index.ts",
            "src/core/log.ts",
            "src/index.ts",
            "src/util/strings.test.ts",
            "src/util/strings.ts",
        ]);
    });

    it("never returns a backslash in a path, even on Windows", () => {
        const result = discoverFiles(FIXTURE, { extensions: TS_EXTENSIONS });
        expect(result.files.filter((f) => f.path.includes("\\"))).toEqual([]);
    });
});

describe("discoverFiles — git repositories", () => {
    it("respects .gitignore, keeps spaces and non-ASCII names intact, skips oversized files and .env files", () => {
        const dir = tempDir("neb-discover-git-");
        execFileSync("git", ["init", "-q", dir]);
        fs.writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
        fs.mkdirSync(path.join(dir, "ignored"));
        fs.writeFileSync(path.join(dir, "ignored", "b.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "with space.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "ünïcode.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "notes.md"), "# notes\n");
        fs.writeFileSync(path.join(dir, ".env.ts"), "export const secret = 1;\n");
        fs.writeFileSync(path.join(dir, "big.ts"), `export const big = '${"x".repeat(60)}';\n`);

        const result = discoverFiles(dir, { extensions: TS_EXTENSIONS, maxBytes: 40 });

        expect(result.usedGit).toBe(true);
        expect(result.files.map((f) => f.path)).toEqual(["a.ts", "with space.ts", "ünïcode.ts"]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].path).toBe("big.ts");
        expect(result.skipped[0].reason).toMatch(/^too large/);
    });

    it("readGitHead is null for a repository with no commits and for a non-git folder", () => {
        const dir = tempDir("neb-head-");
        execFileSync("git", ["init", "-q", dir]);
        expect(readGitHead(dir)).toBeNull();
        expect(readGitHead(FIXTURE)).toBeNull();
    });
});

describe("isTestPath", () => {
    it("recognizes test files by name and by folder", () => {
        expect(isTestPath("src/util/strings.test.ts")).toBe(true);
        expect(isTestPath("src/x.spec.tsx")).toBe(true);
        expect(isTestPath("src/vs/base/test/common/x.ts")).toBe(true);
        expect(isTestPath("__tests__/x.js")).toBe(true);
    });

    it("does not mistake a word containing 'test' for a test folder", () => {
        expect(isTestPath("src/latest/x.ts")).toBe(false);
        expect(isTestPath("src/attest.ts")).toBe(false);
    });
});
