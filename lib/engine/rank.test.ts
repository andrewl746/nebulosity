import { describe, expect, it } from "vitest";
import fs from "fs";
import { cleanFileChunkSnippet, dampTests, fuseRankings, queryTerms, rankFileNames, testOnlyFolders, toFtsQuery, wantsTests } from "./rank";

/** Files the browser bundles (the static demo, ADR-049) and what each may import: nothing that touches a database or a disk. */
const BROWSER_SAFE: Record<string, readonly string[]> = {
    "lib/engine/rank.ts": ["../contracts", "../index/identifiers"],
    "lib/index/identifiers.ts": [],
};

describe("the ranking core", () => {
    it("imports only what the browser can bundle", () => {
        for (const [file, allowed] of Object.entries(BROWSER_SAFE)){
            const imports = [...fs.readFileSync(file, "utf8").matchAll(/^import\s.*?from\s+"([^"]+)";?\s*$/gm)].map((m) => m[1]);
            expect({ file, imports: imports.filter((i) => !allowed.includes(i)) }).toEqual({ file, imports: [] });
        }
    });

    it("gives the words an FTS query quotes", () => {
        expect(queryTerms("Where are editor tabs rendered?")).toEqual(["editor", "tabs", "rendered"]);
        expect(toFtsQuery("Where are editor tabs rendered?")).toBe('"editor" OR "tabs" OR "rendered"');
    });
});

// The fixture's files with their importer counts and exported top-level declarations (test/fixtures/mini-repo, V1.5 plan "Ground truth")
const FILES = [
    { path: "scripts/build.js", importedBy: 0 }, { path: "src/app/main.ts", importedBy: 3 },
    { path: "src/app/view.tsx", importedBy: 1 }, { path: "src/core/index.ts", importedBy: 1 },
    { path: "src/core/log.ts", importedBy: 3 }, { path: "src/index.ts", importedBy: 1 },
    { path: "src/util/strings.test.ts", importedBy: 0 }, { path: "src/util/strings.ts", importedBy: 2 },
];
const DECLARED = [
    { name: "main", path: "src/app/main.ts" }, { name: "render", path: "src/app/view.tsx" }, { name: "View", path: "src/app/view.tsx" },
    { name: "log", path: "src/core/log.ts" }, { name: "Logger", path: "src/core/log.ts" }, { name: "banner", path: "src/core/log.ts" },
    { name: "start", path: "src/index.ts" }, { name: "checks", path: "src/util/strings.test.ts" }, { name: "shout", path: "src/util/strings.ts" },
];

describe("rankFileNames", () => {
    it("finds a file by its own name, most imported first, then by path", () => {
        expect(rankFileNames(FILES, DECLARED, "log")).toEqual(["src/core/log.ts"]);
        expect(rankFileNames(FILES, DECLARED, "index")).toEqual(["src/core/index.ts", "src/index.ts"]);
        // a test file's name drops .test
        expect(rankFileNames(FILES, DECLARED, "strings")).toEqual(["src/util/strings.ts", "src/util/strings.test.ts"]);
    });

    it("finds a file by an exported top-level declaration named exactly like a query word", () => {
        expect(rankFileNames(FILES, DECLARED, "Logger shout")).toEqual(["src/core/log.ts", "src/util/strings.ts"]);
        expect(rankFileNames(FILES, DECLARED, "render")).toEqual(["src/app/view.tsx"]);
    });

    it("takes a name plus an ending of up to 3 letters, when both are 4 letters or longer", () => {
        expect(rankFileNames(FILES, DECLARED, "builder")).toEqual(["scripts/build.js"]);
    });

    it("finds nothing for a stopword", () => {
        expect(rankFileNames(FILES, DECLARED, "the")).toEqual([]);
    });
});

describe("fuseRankings with the file list", () => {
    it("counts the file list double, like folder names", () => {
        const fused = fuseRankings({ code: ["file:a", "file:b"], file: ["file:b"] });
        expect(fused.map((f) => [f.key, f.matchedBy])).toEqual([["file:b", ["code", "file"]], ["file:a", ["code"]]]);
        expect(fused[0].score).toBeCloseTo(1 / 62 + 2 / 61, 12);
    });
});

describe("test damping", () => {
    it("finds folders holding only tests, never the root", () => {
        expect(testOnlyFolders([
            { path: "a/test/x.test.ts", isTest: true }, { path: "a/test/y.spec.ts", isTest: true }, { path: "a/z.ts", isTest: false },
        ])).toEqual(new Set(["a/test"]));
        expect(testOnlyFolders(FILES.map((f) => ({ path: f.path, isTest: f.path.includes(".test.") })))).toEqual(new Set());
    });

    it("halves a test target's score unless the query asks for tests, and re-sorts", () => {
        const fused = [{ key: "file:a/test/x.test.ts", score: 0.04 }, { key: "file:a/z.ts", score: 0.03 }];
        const isTest = (key: string) => key === "file:a/test/x.test.ts";
        expect(dampTests(fused, isTest, "x")).toEqual([{ key: "file:a/z.ts", score: 0.03 }, { key: "file:a/test/x.test.ts", score: 0.02 }]);
        expect(dampTests(fused, isTest, "x tests")).toEqual(fused);
        expect(wantsTests("smoke terminal")).toBe(true);
        expect(wantsTests("terminal")).toBe(false);
    });
});

describe("cleanFileChunkSnippet", () => {
    it("drops an imports listing's File: header and its labels", () => {
        expect(cleanFileChunkSnippet("File: src/vs/platform/lifecycle/common/lifecycle.ts Imports: import { Event } from")).toBe("import { Event } from");
        expect(cleanFileChunkSnippet("…src/vs/x/userActivityRegistry.ts Imports: import { InstantiationType")).toBe("…import { InstantiationType");
        expect(cleanFileChunkSnippet("…import { ChatLocation } from '../../commonTypes.js'")).toBe("…import { ChatLocation } from '../../commonTypes.js'");
        expect(cleanFileChunkSnippet("… Exports: Foo (class) bar (function)")).toBe("… Foo (class) bar (function)");
    });
});
