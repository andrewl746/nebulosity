import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepareLanguages } from "./registry";
import { compileQuery, endLineOf, GrammarNotLoadedError, isPrepared, leadingSpan, parseTree, startLineOf } from "./treesitter";

const IDS = ["python", "go", "java", "csharp", "rust"];

describe("tree-sitter", () => {
    beforeAll(async () => {
        await prepareLanguages();
    });

    it("has every registry grammar loaded after prepareLanguages()", () => {
        for (const id of IDS) expect(isPrepared(id)).toBe(true);
        expect(isPrepared("nope")).toBe(false);
    });

    it.each([
        ["python", "import os\n", "module"],
        ["go", "package main\n", "source_file"],
        ["java", "class A {}", "program"],
        ["csharp", "class A {}", "compilation_unit"],
        ["rust", "fn main() {}", "source_file"],
    ])("parses %s to its root type without an error", (id, text, rootType) => {
        expect(parseTree(id, text, (root) => ({ type: root.type, hasError: root.hasError }))).toEqual({ type: rootType, hasError: false });
    });

    it("drops one leading byte-order mark before parsing", () => {
        const bom = String.fromCharCode(0xfeff);
        expect(parseTree("python", `${bom}import os\n`, (root) => ({ hasError: root.hasError, startColumn: root.firstChild?.startPosition.column })))
            .toEqual({ hasError: false, startColumn: 0 });
    });

    it("throws GrammarNotLoadedError for a grammar that isn't loaded, naming it", () => {
        expect(() => parseTree("nope", "x", () => null)).toThrow(GrammarNotLoadedError);
        expect(() => parseTree("nope", "x", () => null)).toThrow(/nope.*prepareLanguages\(\)/);
        expect(() => compileQuery("nope", "(x) @x")).toThrow(GrammarNotLoadedError);
    });

    it("deletes the tree when the callback throws", () => {
        let spy: ReturnType<typeof vi.spyOn> | null = null;
        expect(() => parseTree("python", "import os\n", (root) => {
            spy = vi.spyOn(root.tree, "delete");
            throw new Error("boom");
        })).toThrow("boom");
        expect(spy).not.toBeNull();
        expect(spy!).toHaveBeenCalledTimes(1);
    });

    it("compiles a query once per grammar and source", () => {
        const source = "(import_statement) @i";
        const query = compileQuery("python", source);
        expect(compileQuery("python", source)).toBe(query);
        expect(parseTree("python", "import os\nimport sys\n", (root) => query.captures(root).map((c) => c.node.text))).toEqual(["import os", "import sys"]);
    });

    it("numbers lines from 1, a node's last line being the one holding its last character", () => {
        const text = "# one\n# two\n\n# four\ndef f():\n    return 1\n";
        const lines = parseTree("python", text, (root) => root.namedChildren.map((n) => [n.type, startLineOf(n), endLineOf(n)]));
        expect(lines).toEqual([["comment", 1, 1], ["comment", 2, 2], ["comment", 4, 4], ["function_definition", 5, 6]]);
    });

    it("extends a span over the attached siblings above it, stopping at a blank line", () => {
        const text = "# one\n# two\n\n# four\n# five\ndef f():\n    return 1\n";
        const span = parseTree("python", text, (root) => leadingSpan(root.namedChildren.at(-1)!, (prev) => prev.type === "comment"));
        expect(span).toEqual({ startLine: 4, endLine: 7 });
        const none = parseTree("python", text, (root) => leadingSpan(root.namedChildren.at(-1)!, () => false));
        expect(none).toEqual({ startLine: 6, endLine: 7 });
    });

    it("gives the same lines for a CRLF text", () => {
        const text = "# one\r\n# two\r\n\r\n# four\r\n# five\r\ndef f():\r\n    return 1\r\n";
        const span = parseTree("python", text, (root) => leadingSpan(root.namedChildren.at(-1)!, (prev) => prev.type === "comment"));
        expect(span).toEqual({ startLine: 4, endLine: 7 });
    });
});
