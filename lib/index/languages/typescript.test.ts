import { describe, expect, it } from "vitest";
import { countLines, languageOf, parseTypeScriptFile } from "./typescript";

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
