import { describe, expect, it } from "vitest";
import { docLinks, docTitle, folderSuffixes, globFolder, mentionTokens, splitFrontMatter, splitGlobs } from "./docs";

describe("splitFrontMatter (Review Focus 3)", () => {
    it("reads key: value lines between the fences, with a BOM and CRLF line endings", () => {
        const { fields, body } = splitFrontMatter("﻿---\r\napplyTo: src/vs/**\r\ndescription: x\r\n---\r\n\r\n# Title\r\n");
        expect([...fields]).toEqual([["applyTo", "src/vs/**"], ["description", "x"]]);
        expect(body).toBe("\n# Title\n");
    });

    it("leaves a file with no front matter whole", () => {
        expect(splitFrontMatter("# Just text\n")).toEqual({ fields: new Map(), body: "# Just text\n" });
    });

    it("drops a YAML trailing comment from a value, but not a # inside quotes or glued to the text (F22)", () => {
        const { fields } = splitFrontMatter("---\napplyTo: src/**, lib/**   # the sources\nglobs: \"a/#b/**\" # note\nname: x#y\n---\n");
        expect(fields.get("applyTo")).toBe("src/**, lib/**");
        expect(fields.get("globs")).toBe("\"a/#b/**\"");
        expect(fields.get("name")).toBe("x#y");
        expect(splitGlobs(fields.get("applyTo") ?? "")).toEqual(["src/**", "lib/**"]);
    });
});

describe("docTitle", () => {
    it("is the first level-one heading, else the file's name", () => {
        expect(docTitle("docs/architecture.md", "intro\n\n# Architecture\n\n## Layers\n")).toBe("Architecture");
        expect(docTitle("docs/notes.mdx", "## only a second-level heading\n")).toBe("notes");
    });

    it("reads the heading as plain text: badges and images gone, links and code kept as their text, emphasis and HTML tags off", () => {
        const badges = "# [![Build](https://ci.example/badge.svg)](https://ci.example) **Visual Studio Code** - [Open Source](https://github.com/microsoft/vscode) `code`\n";
        expect(docTitle("README.md", badges)).toBe("Visual Studio Code - Open Source code");
        expect(docTitle("README.md", "# __Bold__, *em*, _em_ and ~~old~~ but snake_case_name and 2*3*4\n")).toBe("Bold, em, em and old but snake_case_name and 2*3*4");
        expect(docTitle("README.md", '# <img src="logo.png" alt="logo" width="40"> AFFiNE <br/>\n')).toBe("AFFiNE");
        expect(docTitle("README.md", "# The `__init__` and `<Map>` [`api`][ref] guide ##\n")).toBe("The __init__ and <Map> api guide");
    });

    it("skips a heading with nothing left in it: a bare # or one holding only a badge", () => {
        expect(docTitle("docs/guide.md", "#   \n\n# ![badge](https://x/y.svg)\n\n# Real title\n")).toBe("Real title");
        expect(docTitle("docs/guide.md", "#\t \ntext\n")).toBe("guide");
    });

    it("cuts a long heading to 120 characters, the last an ellipsis", () => {
        const title = docTitle("README.md", `# ${"word ".repeat(60)}\n`);
        expect(title).toHaveLength(120);
        expect(title).toBe(`${"word ".repeat(23)}word…`);   // 119 characters of the heading (23 × 5 + 4), then "…"
    });
});

describe("splitGlobs, on VS Code's own applyTo lines", () => {
    it("reads plain, quoted and comma-separated values", () => {
        expect(splitGlobs("src/vs/**")).toEqual(["src/vs/**"]);
        expect(splitGlobs("'src/vs/platform/agentHost/**'")).toEqual(["src/vs/platform/agentHost/**"]);
        expect(splitGlobs('"src/vs/**/*Tool.ts,src/vs/**/*Tools.ts"')).toEqual(["src/vs/**/*Tool.ts", "src/vs/**/*Tools.ts"]);
        expect(splitGlobs("'**'")).toEqual(["**"]);
    });

    it("opens a value that is one brace group, and keeps braces inside a glob whole", () => {
        expect(splitGlobs('"{src/vs/**/test/**,src/vs/**/*.test.ts,src/vs/**/*.integrationTest.ts}"'))
            .toEqual(["src/vs/**/test/**", "src/vs/**/*.test.ts", "src/vs/**/*.integrationTest.ts"]);
        expect(splitGlobs("'build/azure-pipelines/{oss/**,common/downloadNotice.ts,{win32,linux,darwin}/steps/product-build-*-compile.yml}'"))
            .toEqual(["build/azure-pipelines/{oss/**,common/downloadNotice.ts,{win32,linux,darwin}/steps/product-build-*-compile.yml}"]);
    });

    it("reads a YAML list", () => {
        expect(splitGlobs('["src/**", "test/**"]')).toEqual(["src/**", "test/**"]);
    });
});

describe("globFolder", () => {
    it("is the folder before the first wildcard or brace", () => {
        expect(globFolder("src/vs/**")).toBe("src/vs");
        expect(globFolder("src/vs/**/*.css")).toBe("src/vs");
        expect(globFolder("build/azure-pipelines/{oss/**,common/downloadNotice.ts}")).toBe("build/azure-pipelines");
        expect(globFolder("**")).toBe("");
    });

    it("names a file's folder when the glob is one file", () => {
        expect(globFolder("cli/ThirdPartyNotices.txt")).toBe("cli");
        expect(globFolder("cglicenses.json")).toBe("");
    });

    it("reads past a leading or trailing slash", () => {
        expect(globFolder("/src/vs/**")).toBe("src/vs");
        expect(globFolder("src/vs/")).toBe("src/vs");
        expect(globFolder("/src/vs/")).toBe("src/vs");
        expect(globFolder("./src/vs/")).toBe("src/vs");
        expect(globFolder("docs/v1.2/")).toBe("docs/v1.2");   // a trailing slash says it's a folder
    });
});

describe("mentionTokens", () => {
    it("finds paths of two or more segments, without URL parts, globs' tails or trailing punctuation", () => {
        expect(mentionTokens("See `src/app`, then src/editor/common. Docs: https://github.com/a/b and ./packages/ui/ or src/vs/**/x.ts."))
            .toEqual(["src/app", "src/editor/common", "packages/ui", "src/vs"]);
    });

    it("drops a word with one segment and a path cut down to one", () => {
        expect(mentionTokens("main.ts, src/**/x.ts and and/or")).toEqual(["and/or"]);
    });

    it("reads a 200,000-character word with no slash in linear time, and still finds the path after it", () => {
        // the regex used to try every start inside such a word, each running to its end: 40,000 characters took about 1 s,
        // so 200,000 would take about 25 s (a base64 image in a README, a minified line in a doc)
        const body = `${"x".repeat(200_000)} then src/app/main.ts, and ${"y".repeat(100_000)}/z`;
        const started = performance.now();
        const tokens = mentionTokens(body);
        expect(performance.now() - started).toBeLessThan(500);
        expect(tokens).toEqual(["src/app/main.ts", `${"y".repeat(100_000)}/z`]);
    });
});

describe("folderSuffixes", () => {
    it("maps each tail of two or more segments to its folder, or to null when two folders share it", () => {
        const suffixes = folderSuffixes(["src/editor/browser", "src/base/browser", "x/editor/common", "y/editor/common"]);
        expect(suffixes.get("editor/browser")).toBe("src/editor/browser");
        expect(suffixes.get("editor/common")).toBeNull();
        expect(suffixes.has("browser")).toBe(false);
    });
});

describe("docLinks on the architecture fixture's docs", () => {
    const folders = ["", "packages", "packages/core", "packages/core/src", "packages/ui", "packages/ui/src", "src", "src/app", "src/base",
        "src/base/browser", "src/base/common", "src/base/node", "src/base/test", "src/base/test/common", "src/editor", "src/editor/browser",
        "src/editor/common", "src/editor/node", "src/platform", "src/platform/browser", "src/platform/common", "src/platform/node", "tools", "tools/fixtures"];
    const known = { folders: new Set(folders), files: new Set(["src/app/loader.ts", "src/app/main.ts"]), suffixes: folderSuffixes(folders) };

    it("links an instructions file to the folder its applyTo names", () => {
        const text = "---\napplyTo: src/editor/**\n---\n\n# Editor rules\n\nThe editor never imports the app.\n";
        expect(docLinks(".github/instructions/editor.instructions.md", text, known)).toEqual({
            facts: { path: ".github/instructions/editor.instructions.md", title: "Editor rules" },
            links: [{ docPath: ".github/instructions/editor.instructions.md", targetPath: "src/editor", kind: "applies", count: 1, detail: "src/editor/**" }],
        });
    });

    it("keeps one applies link per folder, by its plain glob when a file pattern names the same folder first", () => {
        const text = "---\napplyTo: 'src/editor/**/*.css, src/editor/**, src/editor/**/*.ts'\n---\n\n# Editor rules\n";
        expect(docLinks(".github/instructions/editor.instructions.md", text, known).links).toEqual([
            { docPath: ".github/instructions/editor.instructions.md", targetPath: "src/editor", kind: "applies", count: 1, detail: "src/editor/**" },
        ]);
        // with no plain glob for the folder, the first pattern stays
        expect(docLinks("x.instructions.md", "---\napplyTo: 'src/app/**/*.ts, src/app/**/*.tsx'\n---\n", known).links)
            .toEqual([{ docPath: "x.instructions.md", targetPath: "src/app", kind: "applies", count: 1, detail: "src/app/**/*.ts" }]);
    });

    it("links a README to its own folder and counts the paths a doc mentions", () => {
        const text = "# The app\n\nStart at `src/app/loader.ts`, which loads `main.ts`.\n";
        expect(docLinks("src/app/README.md", text, known).links).toEqual([
            { docPath: "src/app/README.md", targetPath: "src/app", kind: "readme", count: 1, detail: null },
            { docPath: "src/app/README.md", targetPath: "src/app/loader.ts", kind: "mentions", count: 1, detail: null },
        ]);
    });

    it("counts each mention, and matches a folder by a tail only one folder has", () => {
        const text = "# Architecture\n\nThe layers are `src/base`, `src/platform`, `src/editor` and `src/app`, each using only the ones before it.\n"
            + "Code in `src/platform` must not import `src/editor`.\n\n"
            + "Environment folders: `common`, `browser` and `node`. The text model lives in `src/editor/common`, and views in `editor/browser`.\n";
        expect(docLinks("docs/architecture.md", text, known).links).toEqual([
            { docPath: "docs/architecture.md", targetPath: "src/app", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/base", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/editor", kind: "mentions", count: 2, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/editor/browser", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/editor/common", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/platform", kind: "mentions", count: 2, detail: null },
        ]);
    });
});
