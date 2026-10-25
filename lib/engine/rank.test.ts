import { describe, expect, it } from "vitest";
import fs from "fs";
import { claimedExtensions } from "../index/languages/rules";
import { cleanFileChunkSnippet, dampTests, fileStem, fuseRankings, queryTerms, rankFileNames, testOnlyFolders, toFtsQuery, wantsTests } from "./rank";

/** Files the browser bundles (the static demo, ADR-049) and what each may import: nothing that touches a database or a disk. */
const BROWSER_SAFE: Record<string, readonly string[]> = {
    "lib/engine/rank.ts": ["../contracts", "../index/identifiers"],
    "lib/engine/staticSearch.ts": ["../contracts", "../index/identifiers", "./rank"],
    "lib/index/identifiers.ts": [],
};

/**
 * Every module a source names, in the order it names them: the from clause of an import or export (either quote, the
 * clause may span lines), a side-effect import, import("x") and require("x"). A dynamic import or require whose
 * argument isn't a plain string can't be read, so it counts as "<dynamic>", which no list allows. Comments aren't
 * stripped (a quote or "/*" inside a string would make that unsafe), so a commented-out import counts too: the check
 * can only get stricter.
 */
function moduleSpecifiers(source: string): string[] {
    const found: { at: number; specifier: string }[] = [];
    const collect = (pattern: RegExp, read: (m: RegExpMatchArray) => string): void => {
        for (const m of source.matchAll(pattern)) found.push({ at: m.index ?? 0, specifier: read(m) });
    };
    collect(/\b(?:import|export)\b[^"';]*?\bfrom\s*(["'])([^"']+)\1/g, (m) => m[2]);
    collect(/\bimport\s*(["'])([^"']+)\1/g, (m) => m[2]);
    collect(/\b(?:import|require)\s*\(\s*(?:(["'])([^"']+)\1\s*\))?/g, (m) => m[2] ?? "<dynamic>");
    return found.sort((a, b) => a.at - b.at).map((f) => f.specifier);
}

describe("the ranking core", () => {
    it("imports only what the browser can bundle", () => {
        for (const [file, allowed] of Object.entries(BROWSER_SAFE)){
            const specifiers = moduleSpecifiers(fs.readFileSync(file, "utf8"));
            expect({ file, outside: specifiers.filter((s) => !allowed.includes(s)) }).toEqual({ file, outside: [] });
            // A reader that stopped matching would pass the check above for any file, so a file allowed to import must be seen importing.
            if (allowed.length > 0) expect({ file, found: specifiers.length > 0 }).toEqual({ file, found: true });
        }
    });

    it("reads every way a source names a module", () => {
        const source = [
            "import type { A } from 'one';",
            "import {",
            "    b,",
            "    c,",
            '} from "two";',
            'export * from "three";',
            "export { d } from 'four';",
            'import "five";',
            'const e = await import("six");',
            "const f = require('seven');",
        ].join("\n");
        expect(moduleSpecifiers(source)).toEqual(["one", "two", "three", "four", "five", "six", "seven"]);
        expect(moduleSpecifiers('const g = require(name);\nconst h = import("./" + x);\nexport const i = 1;')).toEqual(["<dynamic>", "<dynamic>"]);
        expect(moduleSpecifiers('const from = "not a module";')).toEqual([]);
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

    // one path per language E4 added (the E4 final review's A-I2): the old stem kept every extension but TypeScript's,
    // so "order" missed Order.java, "db" missed db.py and "views" missed views.pyi; importer counts made up, by hand
    const LANGUAGES = [
        { path: "src/main/java/shop/Order.java", importedBy: 2 }, { path: "src/Shop.Core/Models/Order.cs", importedBy: 3 },
        { path: "services/beta/src/app/db.py", importedBy: 1 }, { path: "src/app/db.ts", importedBy: 0 },
        { path: "django/views.py", importedBy: 4 }, { path: "django/views.pyi", importedBy: 0 },
        { path: "crates/core/src/lib.rs", importedBy: 5 }, { path: "internal/store/store.go", importedBy: 2 },
    ];

    it("finds a file of every language by its own name, its extension dropped", () => {
        expect(rankFileNames(LANGUAGES, [], "order")).toEqual(["src/Shop.Core/Models/Order.cs", "src/main/java/shop/Order.java"]);
        expect(rankFileNames(LANGUAGES, [], "db")).toEqual(["services/beta/src/app/db.py", "src/app/db.ts"]);
        expect(rankFileNames(LANGUAGES, [], "views")).toEqual(["django/views.py", "django/views.pyi"]);
        expect(rankFileNames(LANGUAGES, [], "lib")).toEqual(["crates/core/src/lib.rs"]);
        expect(rankFileNames(LANGUAGES, [], "store")).toEqual(["internal/store/store.go"]);
    });

    it("drops every claimed extension from a file's name, and keeps TypeScript's stems as they were", () => {
        for (const extension of claimedExtensions()) expect(fileStem(`a/b/name${extension}`)).toBe("name");
        expect(["src/util/strings.test.ts", "c.test.d.ts", "x.d.ts", "a/.eslintrc.cjs", "view.spec.tsx"].map(fileStem))
            .toEqual(["strings", "c.test.d", "x.d", ".eslintrc", "view"]);
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

    it("drops the File: header of every indexed language's listing (the E4 final review's A-I2)", () => {
        expect(cleanFileChunkSnippet("File: django/views.py Imports: from django.http import HttpResponse"))
            .toBe("from django.http import HttpResponse");
        expect(cleanFileChunkSnippet("File: src/main/java/shop/Order.java Imports: import java.util.List;")).toBe("import java.util.List;");
        expect(cleanFileChunkSnippet("…ore/src/lib.rs Imports: use std::fmt;")).toBe("…use std::fmt;");
        for (const extension of claimedExtensions()){
            expect(cleanFileChunkSnippet(`File: a/b/name${extension} Imports: x`)).toBe("x");
        }
    });

    it("keeps an import's last word that only looks like a path", () => {
        expect(cleanFileChunkSnippet("…os.path Exports: main (function)")).toBe("…os.path main (function)");
    });
});
