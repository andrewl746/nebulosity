import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { claimedExtensions, rulesFor } from "@/lib/index/languages/rules";
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

    it("leaves a very large file plain, escaped but uncolored, so opening it doesn't freeze the Map (deferred minor)", () => {
        // 3 + 13 × 15,385 = 200,008 characters: past MAX_COLORED_CHARS (200,000), where coloring would block for
        // tens of ms more (1 MB took ~350 ms)
        const big = "<b>" + "const x = 1;\n".repeat(15_385);
        const html = highlightCode(big, "typescript");
        expect(html.startsWith("&lt;b&gt;const x = 1;")).toBe(true);
        expect(html).not.toContain("<span");
    });

    it("escapes what it shows, so a file's text can never become markup", () => {
        expect(highlightCode("<script>alert(1)</script>", "text")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
        const html = highlightCode('const a = "<b>";', "typescript");
        expect(html).toContain("&lt;b&gt;");
        expect(html).not.toContain("<b>");
    });
});

describe("highlightCode for the other languages the index reads (E4, C10)", () => {
    it("marks a keyword of each", () => {
        // each grammar's own keyword list (highlight.js 11.11.1): python's def (its function match), go's and java's
        // package, csharp's using, rust's let
        expect(highlightCode("def greet():\n    pass", "python")).toContain('<span class="hljs-keyword">def</span>');
        expect(highlightCode("package main", "go")).toContain('<span class="hljs-keyword">package</span>');
        expect(highlightCode("package shop;", "java")).toContain('<span class="hljs-keyword">package</span>');
        expect(highlightCode("using System;", "csharp")).toContain('<span class="hljs-keyword">using</span>');
        expect(highlightCode("let x = 1;", "rust")).toContain('<span class="hljs-keyword">let</span>');
    });

    it("colors every language languageFor names for an extension the index claims: a number in each", () => {
        for (const extension of claimedExtensions()){
            const language = languageFor(`src/a${extension}`);
            expect(highlightCode("1", language), extension).toBe('<span class="hljs-number">1</span>');
        }
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

    it("names the merged E4 languages (C10), and nothing else", () => {
        expect(languageFor("polls/views.py")).toBe("python");
        expect(languageFor("stubs/os.pyi")).toBe("python");
        expect(languageFor("cmd/server/main.go")).toBe("go");
        expect(languageFor("src/main/java/shop/Order.java")).toBe("java");
        expect(languageFor("crates/core/src/lib.rs")).toBe("rust");
        expect(languageFor("src/Shop/Program.cs")).toBe("csharp");
        expect(languageFor("setup.cfg")).toBe("text");
        expect(languageFor("src/Shop/Shop.csproj")).toBe("text");
    });

    it("mirrors the index's rules for every extension they claim (the UI can't import them, ARCHITECTURE.md §3 rule 3)", () => {
        for (const extension of claimedExtensions()){
            const p = `src/a${extension}`;
            expect(languageFor(p), p).toBe(rulesFor(p)!.languageOf(p));
        }
    });
});

describe("the syntax colors (VISUAL_REFRESH.md §2, code only): VS Code's Dark+ palette, and Light+ under a light theme, transcribed", () => {
    const css = readFileSync("app/globals.css", "utf8");
    // the light theme's block, apart: Dark+ is the one in the page's own :root
    const lightStart = css.search(/:root\[data-kind="light"\], :root\[data-kind="hc-light"\] \{\r?\n\s*--syn-text/);
    const lightBlock = css.slice(lightStart, css.indexOf("}", lightStart));
    const darkCss = css.slice(0, lightStart) + css.slice(lightStart + lightBlock.length);
    // theme-defaults/themes/light_plus.json and light_vs.json, VS Code 1.143
    const LIGHT_PLUS: Record<string, string> = {
        "syn-text": "#000000",
        "syn-keyword": "#0000FF",
        "syn-control": "#AF00DB",
        "syn-string": "#A31515",
        "syn-number": "#098658",
        "syn-comment": "#008000",
        "syn-type": "#267F99",
        "syn-function": "#795E26",
        "syn-variable": "#001080",
        "syn-constant": "#0070C1",
        "syn-regexp": "#811F3F",
    };
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
            const definitions = darkCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g")) ?? [];
            expect(definitions, `--${name}`).toHaveLength(1);
            expect(definitions.join("").toUpperCase(), `--${name}`).toContain(hex.toUpperCase());
        }
    });

    it("defines each once more for a light theme, with Light+'s value", () => {
        expect(lightStart).toBeGreaterThan(0);
        for (const [name, hex] of Object.entries(LIGHT_PLUS)){
            const definitions = lightBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g")) ?? [];
            expect(definitions, `--${name}`).toHaveLength(1);
            expect(definitions.join("").toUpperCase(), `--${name}`).toContain(hex.toUpperCase());
        }
    });
});
