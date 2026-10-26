import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { FIXTURE } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { toyRules } from "../../test/helpers/toy-adapter";
import { discoverFiles, gitIgnored, isExcludedPath, isTestPath, listManifests, readGitHead, readingFor } from "./discover";
import { typescriptRules } from "./languages/typescript-rules";

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

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

    it("skips build output and coverage (dist, out, build, coverage) at any depth", () => {
        const dir = makeTempDir("neb-discover-walk-");
        for (const rel of ["dist/a.js", "out/b.js", "build/c.js", "coverage/d.js", "packages/p/dist/e.js", "src/f.ts"]){
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), "export {};\n");
        }
        expect(discoverFiles(dir, { extensions: TS_EXTENSIONS }).files.map((f) => f.path)).toEqual(["src/f.ts"]);
    });

    it("lists a code file over the size cap for its imports only, parsed or scanned by size; past the hard bound it is skipped (ADR-053, amended)", () => {
        const dir = makeTempDir("neb-discover-importsonly-");
        fs.writeFileSync(path.join(dir, "small.ts"), "export {};\n");                                     // 11 bytes
        fs.writeFileSync(path.join(dir, "mid.ts"), `import "./small";\n// ${"x".repeat(30)}\n`);        // 18 + 34 = 52 bytes
        fs.writeFileSync(path.join(dir, "large.ts"), `// ${"x".repeat(86)}\n`);                         // 90 bytes
        fs.writeFileSync(path.join(dir, "huge.ts"), `// ${"x".repeat(120)}\n`);                         // 124 bytes
        fs.writeFileSync(path.join(dir, "mid.md"), `# ${"x".repeat(50)}\n`);                            // 53 bytes: a doc keeps the cap

        const result = discoverFiles(dir, { extensions: TS_EXTENSIONS, maxBytes: 40, parseMaxBytes: 80, hardMaxBytes: 100 });

        expect(result.files).toEqual([
            { path: "large.ts", sizeBytes: 90, importsOnly: "scan" },
            { path: "mid.ts", sizeBytes: 52, importsOnly: "parse" },
            { path: "small.ts", sizeBytes: 11 },
        ]);
        expect(result.files[2].importsOnly).toBeUndefined();
        expect([...result.skipped].sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual([   // walk order is the OS's
            { path: "huge.ts", reason: "too large (124 bytes)" },
            { path: "mid.md", reason: "too large (53 bytes)" },
        ]);
    });
});

describe("readingFor — how a code file of a given size is read (ADR-053, amended)", () => {
    it("reads in full up to 1 MB, parses for imports up to 5 MB, scans for imports up to 20 MB, and skips past that", () => {
        expect([1_000_000, 1_000_001, 5_000_000, 5_000_001, 20_000_000, 20_000_001].map((size) => readingFor(size)))
            .toEqual(["full", "parse", "parse", "scan", "scan", "skip"]);
    });

    it("takes the bounds from the options, and a cap above the parse bound still reads in full", () => {
        const caps = { maxBytes: 40, parseMaxBytes: 80, hardMaxBytes: 100 };
        expect([40, 41, 80, 81, 100, 101].map((size) => readingFor(size, caps))).toEqual(["full", "parse", "parse", "scan", "scan", "skip"]);
        expect(readingFor(70, { maxBytes: 90, parseMaxBytes: 50 })).toBe("full");
    });
});

describe("discoverFiles — git repositories", () => {
    it("respects .gitignore, keeps spaces and non-ASCII names intact, skips files over the hard bound and .env files", () => {
        const dir = makeTempDir("neb-discover-git-");
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

        // the hard bound at the cap: past it a file is skipped, not read for its imports (ADR-053, amended)
        const result = discoverFiles(dir, { extensions: TS_EXTENSIONS, maxBytes: 40, hardMaxBytes: 40 });

        expect(result.usedGit).toBe(true);
        expect(result.files.map((f) => f.path)).toEqual(["a.ts", "with space.ts", "ünïcode.ts"]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].path).toBe("big.ts");
        expect(result.skipped[0].reason).toMatch(/^too large/);
    });

    it("reports a doc over the size cap in skipped, not silently (F15)", () => {
        const dir = makeTempDir("neb-discover-bigdoc-");
        fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "small.md"), "# s\n");
        fs.writeFileSync(path.join(dir, "huge.md"), `# h\n${"x".repeat(60)}\n`);
        const result = discoverFiles(dir, { extensions: TS_EXTENSIONS, maxBytes: 40 });
        expect(result.docs.map((d) => d.path)).toEqual(["small.md"]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].path).toBe("huge.md");
        expect(result.skipped[0].reason).toMatch(/^too large/);
    });

    it("never returns files under node_modules, even in a git repo whose .gitignore doesn't exclude it", () => {
        const dir = makeTempDir("neb-discover-nm-");
        execFileSync("git", ["init", "-q", dir]);
        fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
        fs.mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
        fs.writeFileSync(path.join(dir, "node_modules", "dep", "index.js"), "module.exports = {};\n");
        fs.mkdirSync(path.join(dir, "packages", "p", "node_modules", "x"), { recursive: true });
        fs.writeFileSync(path.join(dir, "packages", "p", "node_modules", "x", "i.ts"), "export {};\n");

        const result = discoverFiles(dir, { extensions: TS_EXTENSIONS });

        expect(result.usedGit).toBe(true);
        expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
    });

    it("keeps a build/ folder in a git repo, where .gitignore decides (VS Code's build scripts live there)", () => {
        const dir = makeTempDir("neb-discover-build-");
        execFileSync("git", ["init", "-q", dir]);
        fs.mkdirSync(path.join(dir, "build"));
        fs.writeFileSync(path.join(dir, "build", "gulpfile.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
        expect(discoverFiles(dir, { extensions: TS_EXTENSIONS }).files.map((f) => f.path)).toEqual(["a.ts", "build/gulpfile.ts"]);
    });

    it("readGitHead is null for a repository with no commits and for a non-git folder", () => {
        const dir = makeTempDir("neb-head-");
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

describe("isExcludedPath", () => {
    it("leaves out what discoverFiles would, whatever the file holds", () => {
        const git = { extensions: TS_EXTENSIONS, usedGit: true };
        const walk = { extensions: TS_EXTENSIONS, usedGit: false };
        expect(isExcludedPath("src/a.ts", git)).toBe(false);
        expect(isExcludedPath("README.md", git)).toBe(true);
        expect(isExcludedPath(".env.ts", git)).toBe(true);
        expect(isExcludedPath("node_modules/x/a.ts", git)).toBe(true);
        expect(isExcludedPath("a/.git/b.ts", git)).toBe(true);
        expect(isExcludedPath("build/gulpfile.ts", git)).toBe(false);   // in a git repo, .gitignore decides
        expect(isExcludedPath("build/gulpfile.ts", walk)).toBe(true);
        expect(isExcludedPath("packages/p/dist/e.js", walk)).toBe(true);
    });
});

describe("gitIgnored", () => {
    it("asks git once which paths .gitignore excludes", () => {
        const dir = makeTempDir("neb-ignored-");
        execFileSync("git", ["init", "-q", dir]);
        fs.writeFileSync(path.join(dir, ".gitignore"), "out/\n*.gen.ts\n");
        expect([...gitIgnored(dir, ["out/a.ts", "src/b.gen.ts", "src/c.ts"])].sort()).toEqual(["out/a.ts", "src/b.gen.ts"]);
        expect(gitIgnored(dir, ["src/c.ts"]).size).toBe(0);
        expect(gitIgnored(dir, []).size).toBe(0);
    });
});

describe("discovery through the language rules (ADR-065)", () => {
    const rules = [typescriptRules, toyRules];

    /** A repo of these files, each holding a line, in a git repo or a plain folder. */
    function repo(files: string[], git: boolean): string {
        const dir = makeTempDir("neb-discover-rules-");
        if (git) execFileSync("git", ["init", "-q", dir]);
        for (const rel of files){
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), "x\n");
        }
        return dir;
    }

    it("lists a toy.json as a manifest, and setup.toy as a manifest and a code file both", () => {
        const dir = repo(["toy.json", "setup.toy", "src/a.toy", "src/b.ts"], false);
        const found = discoverFiles(dir, { rules });
        expect(found.manifests).toEqual(["setup.toy", "toy.json"]);
        expect(found.files.map((f) => f.path)).toEqual(["setup.toy", "src/a.toy", "src/b.ts"]);
    });

    it.each([["git", true], ["walk", false]] as const)("leaves out deps/*.toy beside a toy.json, keeping TypeScript's files there (%s mode)", (_mode, git) => {
        const dir = repo(["pkg/toy.json", "pkg/deps/x.toy", "pkg/deps/x.ts", "pkg/src/y.toy", "other/deps/z.toy"], git);
        const found = discoverFiles(dir, { rules });
        expect(found.usedGit).toBe(git);
        expect(found.files.map((f) => f.path)).toEqual(["other/deps/z.toy", "pkg/deps/x.ts", "pkg/src/y.toy"]);
        expect(found.skipped).toEqual([]);   // left out silently, as node_modules is
    });

    it("claims every rules' extensions when none are given", () => {
        const dir = repo(["a.toy", "b.ts", "c.txt"], false);
        expect(discoverFiles(dir, { rules }).files.map((f) => f.path)).toEqual(["a.toy", "b.ts"]);
        expect(discoverFiles(dir, { rules: [typescriptRules] }).files.map((f) => f.path)).toEqual(["b.ts"]);
    });

    it("lists the same manifests listManifests does", () => {
        const dir = repo(["toy.json", "setup.toy", "package.json", "sub/tsconfig.json", "a.toy"], false);
        expect(listManifests(dir, rules)).toEqual(discoverFiles(dir, { rules }).manifests);
        expect(listManifests(dir, rules)).toEqual(["package.json", "setup.toy", "sub/tsconfig.json", "toy.json"]);
    });

    it("counts a language's own test files on top of the shared folder rule", () => {
        expect(isTestPath("lib/a_test.toy", rules)).toBe(true);
        expect(isTestPath("lib/a_test.toy")).toBe(false);   // no registry language claims .toy
        expect(isTestPath("tests/a.toy", rules)).toBe(true);
        expect(isTestPath("lib/a.toy", rules)).toBe(false);
        expect(isTestPath("lib/a.test.ts", rules)).toBe(true);
    });

    it("isExcludedPath takes the manifests' exclusion", () => {
        const exclude = (rel: string): boolean => rel.startsWith("pkg/deps/");
        expect(isExcludedPath("pkg/deps/x.toy", { extensions: [".toy"], usedGit: true, exclude })).toBe(true);
        expect(isExcludedPath("pkg/src/x.toy", { extensions: [".toy"], usedGit: true, exclude })).toBe(false);
        expect(isExcludedPath("pkg/deps/x.toy", { extensions: [".toy"], usedGit: true })).toBe(false);
    });
});

describe("discoverFiles on the architecture fixture", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    const found = discoverFiles(root, { extensions: TS_EXTENSIONS });

    it("finds the 21 source files", () => {
        expect(found.files).toHaveLength(21);
    });

    it("lists the package.json and tsconfig files apart, sorted", () => {
        expect(found.manifests).toEqual([
            "package.json", "packages/core/package.json", "packages/core/tsconfig.json", "packages/ui/package.json", "src/tsconfig.json", "tools/tsconfig.json",
        ]);
    });

    it("lists the markdown docs apart, sorted, the .github folder included", () => {
        expect(found.docs.map((d) => d.path)).toEqual([".github/instructions/editor.instructions.md", "README.md", "docs/architecture.md", "src/app/README.md"]);
    });
});
