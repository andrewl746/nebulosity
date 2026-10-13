import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { highlightCode, languageFor } from "./syntax";

describe("highlightCode (owner review: code colored like in VS Code)", () => {
    it("marks keywords, numbers, function and class names", () => {
        const html = highlightCode("const x = 1;\nfunction greet() {}\nclass Foo {}", "typescript");
        expect(html).toContain('<span class="hljs-keyword">const</span>');
        expect(html).toContain('<span class="hljs-number">1</span>');
        expect(html).toContain('<span class="hljs-title function_">greet</span>');
        expect(html).toContain('<span class="hljs-title class_">Foo</span>');
    });

    it("tells control-flow keywords apart, the way VS Code colors import and return differently from const", () => {
        const html = highlightCode("import { a } from 'b';\nexport const c = () => { return a; };", "typescript");
        expect(html).toContain('<span class="hljs-keyword hljs-control">import</span>');
        expect(html).toContain('<span class="hljs-keyword hljs-control">from</span>');
        expect(html).toContain('<span class="hljs-keyword hljs-control">export</span>');
        expect(html).toContain('<span class="hljs-keyword hljs-control">return</span>');
        expect(html).toContain('<span class="hljs-keyword">const</span>');
    });

    it("marks strings and comments", () => {
        const html = highlightCode("// note\nconst s = 'hi';", "typescript");
        expect(html).toContain('<span class="hljs-comment">// note</span>');
        expect(html).toContain('<span class="hljs-string">&#x27;hi&#x27;</span>');
    });

    it("escapes what it shows, so a file's text can never become markup", () => {
        expect(highlightCode("<script>alert(1)</script>", "text")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
        const html = highlightCode('const a = "<b>";', "typescript");
        expect(html).toContain("&lt;b&gt;");
        expect(html).not.toContain("<b>");
    });
});

describe("languageFor", () => {
    it("names the language a path's extension implies, as the source route does", () => {
        expect(languageFor("src/a.ts")).toBe("typescript");
        expect(languageFor("src/b.tsx")).toBe("typescript");
        expect(languageFor("build/c.mjs")).toBe("javascript");
        expect(languageFor("d.js")).toBe("javascript");
        expect(languageFor("README.md")).toBe("text");
    });
});

describe("the syntax colors (VISUAL_REFRESH.md §2, code only): VS Code's Dark+ palette, transcribed", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const DARK_PLUS: Record<string, string> = {
        "syn-text": "#D4D4D4",
        "syn-keyword": "#569CD6",
        "syn-control": "#C586C0",
        "syn-string": "#CE9178",
        "syn-number": "#B5CEA8",
        "syn-comment": "#6A9955",
        "syn-type": "#4EC9B0",
        "syn-function": "#DCDCAA",
        "syn-variable": "#9CDCFE",
        "syn-constant": "#4FC1FF",
        "syn-regexp": "#D16969",
    };

    it("defines each once, with Dark+'s value", () => {
        for (const [name, hex] of Object.entries(DARK_PLUS)){
            const definitions = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g")) ?? [];
            expect(definitions, `--${name}`).toHaveLength(1);
            expect(definitions.join("").toUpperCase(), `--${name}`).toContain(hex.toUpperCase());
        }
    });
});
