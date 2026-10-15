import { describe, expect, it } from "vitest";
import { ADAPTER_VERSION, countLines, languageOf, parseTypeScriptFile, parseTypeScriptImportsOnly, scanTypeScriptImports } from "./typescript";

const LOG_TS = [
    "/** Writes a message. */",
    "export function log(message: string): void { console.log(message); }",
    "",
    "export class Logger {",
    "    info(message: string): void { log(message); }",
    "    private warn(message: string): void { log(\"warn: \" + message); }",
    "}",
    "",
    "export const banner = \"import fake from './not-real'\";",
    "",
].join("\n");

describe("parseTypeScriptFile — symbols", () => {
    it("lists top-level declarations and class members with exact lines", () => {
        expect(parseTypeScriptFile("src/core/log.ts", LOG_TS).symbols).toEqual([
            { name: "log", qualifiedName: "log", kind: "function", startLine: 2, endLine: 2, exported: true, parentQualifiedName: null },
            { name: "Logger", qualifiedName: "Logger", kind: "class", startLine: 4, endLine: 7, exported: true, parentQualifiedName: null },
            { name: "info", qualifiedName: "Logger.info", kind: "method", startLine: 5, endLine: 5, exported: true, parentQualifiedName: "Logger" },
            { name: "warn", qualifiedName: "Logger.warn", kind: "method", startLine: 6, endLine: 6, exported: false, parentQualifiedName: "Logger" },
            { name: "banner", qualifiedName: "banner", kind: "const", startLine: 9, endLine: 9, exported: true, parentQualifiedName: null },
        ]);
    });

    it("treats an arrow function held in a const as a function", () => {
        const symbols = parseTypeScriptFile("s.ts", "export const shout = (s: string): string => s.toUpperCase();\n").symbols;
        expect(symbols).toEqual([
            { name: "shout", qualifiedName: "shout", kind: "function", startLine: 1, endLine: 1, exported: true, parentQualifiedName: null },
        ]);
    });

    it("parses .tsx (JSX) files", () => {
        const viewTsx = [
            "import { useState } from \"react\";",
            "import { main } from \"./main\";",
            "",
            "export function render(): void {",
            "    void useState;",
            "    void main;",
            "}",
            "",
            "export function View() {",
            "    return <div>view</div>;",
            "}",
            "",
        ].join("\n");
        const parsed = parseTypeScriptFile("src/app/view.tsx", viewTsx);
        expect(parsed.imports).toEqual(["react", "./main"]);
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.startLine, s.endLine])).toEqual([["render", 4, 7], ["View", 9, 11]]);
    });
});

describe("parseTypeScriptFile — imports", () => {
    it("finds every import form, in source order, and ignores import-looking strings", () => {
        const source = [
            "import a from \"./a\";",
            "import type { B } from \"../b\";",
            "import \"./side-effect\";",
            "export { c } from \"./c\";",
            "export * from \"./d\";",
            "import e = require(\"./e\");",
            "const f = require(\"./f\");",
            "async function g() { await import(\"./g\"); }",
            "const notAnImport = \"import x from './h'\";",
            "",
        ].join("\n");
        expect(parseTypeScriptFile("src/x.ts", source).imports).toEqual(["./a", "../b", "./side-effect", "./c", "./d", "./e", "./f", "./g"]);
    });

    it("finds require and dynamic import in plain JavaScript", () => {
        const buildJs = "const { start } = require(\"../src/index\");\n\nimport(\"../src/app/main\").then(() => start());\n";
        expect(parseTypeScriptFile("scripts/build.js", buildJs).imports).toEqual(["../src/index", "../src/app/main"]);
    });

    it("reports each specifier once even when imported twice", () => {
        expect(parseTypeScriptFile("x.ts", "import { a } from \"./a\";\nimport { b } from \"./a\";\n").imports).toEqual(["./a"]);
    });

    it("still finds imports in a file that starts with a UTF-8 BOM", () => {
        expect(parseTypeScriptFile("bom.ts", "﻿import { a } from \"./a\";\n").imports).toEqual(["./a"]);
    });
});

describe("parseTypeScriptFile — chunks and lines", () => {
    it("still produces the chunker's chunks (one parse serves both)", () => {
        expect(parseTypeScriptFile("src/core/log.ts", LOG_TS).chunks.map((c) => c.name)).toEqual(["log", "Logger", "banner", "(file)"]);
    });

    it("counts lines the way an editor shows them", () => {
        expect(countLines(LOG_TS)).toBe(9);
        expect(countLines("a\nb")).toBe(2);
        expect(countLines("")).toBe(0);
    });
});

describe("languageOf", () => {
    it("calls .js, .jsx, .mjs and .cjs files javascript and the rest typescript", () => {
        expect(["a.js", "a.jsx", "a.mjs", "a.cjs"].map(languageOf)).toEqual(["javascript", "javascript", "javascript", "javascript"]);
        expect(["a.ts", "a.tsx", "a.mts", "a.cts"].map(languageOf)).toEqual(["typescript", "typescript", "typescript", "typescript"]);
    });
});

describe("computed import() (ADR-053)", () => {
    const importsOf = (text: string): string[] => parseTypeScriptFile("x.ts", text).imports;

    it("reads the literals assigned to the variable an import() is given, in source order", () => {
        const loader = [
            "export async function load(dev: boolean): Promise<unknown> {",
            "    let url: string;",
            '    if (dev) url = "./main.js";',
            '    else url = new URL("app/main.js", import.meta.url).href;',
            "    return import(url);",
            "}",
        ].join("\n");
        expect(importsOf(loader)).toEqual(["./main.js", "app/main.js"]);
    });

    it("reads a const initializer, a template without ${}, and new URL(...).toString()", () => {
        expect(importsOf("const a = `./a.js`;\nimport(a);")).toEqual(["./a.js"]);
        expect(importsOf('function f() { const u = new URL("./b.js", base).toString(); return import(u); }')).toEqual(["./b.js"]);
    });

    it("gives nothing for a parameter, a template with ${}, or a value from a call", () => {
        expect(importsOf("export function f(name: string) { return import(name); }")).toEqual([]);
        expect(importsOf("function f(lang: string) { const p = `./locales/${lang}.js`; return import(p); }")).toEqual([]);
        expect(importsOf('function f() { const p = pick("./x.js"); return import(p); }')).toEqual([]);
    });

    it("gives nothing for a call given straight to import() (Review Focus 2)", () => {
        expect(importsOf('function f() { return import(getUrl()); }')).toEqual([]);
    });

    it("keeps a plain string import() as before", () => {
        expect(importsOf('import("./c.js");')).toEqual(["./c.js"]);
    });
});

describe("import type expressions (ADR-053, amended)", () => {
    const importsOf = (text: string): string[] => parseTypeScriptFile("x.ts", text).imports;

    it("reads typeof import('…') and import('…').T in a type position as imports, like a type-only import", () => {
        const source = [
            "export interface TestWindow {",
            "    database: typeof import('@blocksuite/affine/blocks/database');",   // AFFiNE's declare-test-window.ts L16
            "}",
            'let model: import("./model").Model;',
            'type Default = typeof import("./ns.js").default;',
        ].join("\n");
        expect(importsOf(source)).toEqual(["@blocksuite/affine/blocks/database", "./model", "./ns.js"]);
    });

    it("gives nothing for an import type whose argument isn't a string literal", () => {
        expect(importsOf("type T = typeof import(Foo);")).toEqual([]);
    });

    it("leaves an import('…') type inside a JSDoc comment out: it is a comment", () => {
        expect(importsOf("/** @type {import('./a').X} */\nlet x;\n")).toEqual([]);
    });

    it("counts a specifier once when both a statement and an import type name it", () => {
        expect(importsOf('import type { A } from "./a";\nlet b: typeof import("./a");\n')).toEqual(["./a"]);
    });
});

describe("parseTypeScriptImportsOnly — a file over the 1 MB cap, up to 5 MB (ADR-053, amended)", () => {
    it("reads every import form in source order, and no declarations or chunks", () => {
        const source = [
            "import a from \"./a\";",
            "import type { B } from \"../b\";",
            "import \"./side-effect\";",
            "export { c } from \"./c\";",
            "export * from \"./d\";",
            "import e = require(\"./e\");",
            "const f = require(\"./f\");",
            "async function g() { await import(\"./g\"); }",
            "let h: typeof import(\"./h\");",
            "export class Big { run(): void {} }",
            "",
        ].join("\n");
        expect(parseTypeScriptImportsOnly("src/big.ts", source)).toEqual({
            imports: ["./a", "../b", "./side-effect", "./c", "./d", "./e", "./f", "./g", "./h"],
            symbols: [],
            chunks: [],
            calls: {
                types: [{ name: "Big", kind: "class", line: 10, exported: true, nested: false, extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: ["run"], fields: {} }],
                bindings: [{ kind: "reexport", local: "c", imported: "c", specifier: "./c" }, { kind: "reexport", local: "*", imported: "*", specifier: "./d" }],
                calls: [],
            },
            lineCount: 10,
        });
    });

    it("ignores import-looking strings, templates and comments", () => {
        const source = [
            "const s = \"import x from './s'\";",
            "const t = `import y from './t'`;",
            "// import z from './c'",
            "/* require('./r') */",
            "",
        ].join("\n");
        expect(parseTypeScriptImportsOnly("x.ts", source).imports).toEqual([]);
    });

    it("leaves out a module augmentation (declare module \"…\"), as the full parse does", () => {
        const source = "import { x } from \"./b\";\ndeclare module \"./a\" {\n    interface X { y: number }\n}\n";
        expect(parseTypeScriptImportsOnly("x.ts", source).imports).toEqual(["./b"]);
        expect(parseTypeScriptFile("x.ts", source).imports).toEqual(["./b"]);
    });

    it("reports each specifier once", () => {
        expect(parseTypeScriptImportsOnly("x.ts", "import { a } from \"./a\";\nconst b = require(\"./a\");\n").imports).toEqual(["./a"]);
    });

    it("reads by the adapter's own rule, where the token scan goes wrong (a 1–5 MB file is parsed in full)", () => {
        const source = [
            'export * as ns from "./a";',            // a re-export of a namespace
            'export type * as t from "./t";',
            "const r = /`/;",                         // a regex, not the start of a template
            'import b from "./b";',
            'foo.require("./m");',                    // a member call, not require
            'require("./n", 1);',                     // two arguments
            'export const s = /import x from "y"/;',  // regex text, not an import
            "",
        ].join("\n");
        expect(parseTypeScriptImportsOnly("x.ts", source).imports).toEqual(["./a", "./t", "./b"]);
        expect(parseTypeScriptImportsOnly("x.tsx", 'export const a = <p>import x from "./jsx"</p>;\n').imports).toEqual([]);
    });
});

describe("scanTypeScriptImports — the token scan, for a file over 5 MB (ADR-053, amended)", () => {
    const scan = (text: string, filePath = "x.ts"): string[] => scanTypeScriptImports(filePath, text).imports;

    it("reads the statement forms in source order, with no declarations or chunks", () => {
        const source = [
            "import a from \"./a\";",
            "import type { B } from \"../b\";",
            "import \"./side-effect\";",
            "export { c } from \"./c\";",
            "export * from \"./d\";",
            "import e = require(\"./e\");",
            "const f = require(\"./f\");",
            "async function g() { await import(\"./g\"); }",
            "let h: typeof import(\"./h\");",
            "export class Big { run(): void {} }",
            "",
        ].join("\n");
        expect(scanTypeScriptImports("src/huge.ts", source)).toEqual({
            imports: ["./a", "../b", "./side-effect", "./c", "./d", "./e", "./f", "./g", "./h"],
            symbols: [],
            chunks: [],
            calls: { types: [], bindings: [], calls: [] },
            lineCount: 10,
        });
    });

    it("drops a module augmentation, and keeps an import() whose comment ends in \"module\"", () => {
        expect(scan("import { x } from \"./b\";\ndeclare module \"./a\" {\n    interface X { y: number }\n}\n")).toEqual(["./b"]);
        expect(scan("import(// module\n\"./a\");\n")).toEqual(["./a"]);
    });

    it("misses export * as ns and export type * as ns", () => {
        expect(scan('export * as ns from "./a";\nexport type * as t from "./t";\n')).toEqual([]);
    });

    it("reads a member require and a two-argument require, which the adapter doesn't", () => {
        expect(scan('foo.require("./a");\nrequire("./b", 1);\n')).toEqual(["./a", "./b"]);
    });

    it("loses imports after a regex literal holding a backtick (to the next backtick) or a quote (to the line's end)", () => {
        // with no regex context, ` opens a template and ' a string
        expect(scan('const r = /`/;\nimport a from "./a";\nimport b from "./b";\n')).toEqual([]);
        expect(scan('const r = /[\'"]/; import x from "./same-line";\nimport y from "./next-line";\n')).toEqual(["./next-line"]);
    });

    it("can invent a specifier from a regex literal's or JSX text's words", () => {
        expect(scan('export const r = /import x from "y"/;\n')).toEqual(["y"]);
        expect(scan('export const a = <p>import x from "./jsx"</p>;\n', "x.tsx")).toEqual(["./jsx"]);
    });

    it("reads an AMD define list, and doesn't follow a computed import()", () => {
        expect(scan('define(["./a", "./b"], function (a, b) {});\n')).toEqual(["./a", "./b"]);
        expect(scan('const u = "./a"; import(u);\n')).toEqual([]);
    });
});

describe("parseTypeScriptFile: call facts (ADR-059)", () => {
    it("is the adapter's fourth product, and the adapter is at version 7", () => {
        const { types } = parseTypeScriptFile("src/a.ts", "export class A {}\n").calls;
        expect(types).toHaveLength(1);
        expect(types[0].name).toBe("A");
        expect(ADAPTER_VERSION).toBe(7);
    });
});
