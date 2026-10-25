import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { k13Texts } from "../../../../test/helpers/adapter-conformance";
import { pythonRepoTruth as truth } from "../../../../test/helpers/python-repo-truth";
import { prepareLanguages } from "../registry";
import { pythonAdapter } from "./index";
import { parsePythonFile, scanPythonImports } from "./parse";

// The fixture's files against their hand-derived truth (test/helpers/python-repo-truth.ts), then small cases worked out
// by hand from the E4 plan's Task P rules.

const fixture = (rel: string): string => fs.readFileSync(path.resolve("test", "fixtures", "python-repo", rel), "utf8");
const parse = (rel: string, text: string, reading: "full" | "parse" | "scan" = "full") => parsePythonFile(rel, text, reading);

beforeAll(async () => {
    await prepareLanguages([pythonAdapter]);
});

describe("python parse: the fixture's files", () => {
    const files = [
        "src/shop/models.py", "src/shop/cli.py", "src/shop/cart.py", "src/shop/__init__.py", "toolkit/broken.py", "toolkit/text.py",
        "scripts/deploy.py", "src/shop/models.pyi", "tests/runtests.py", "src/shop/plugins/__init__.py", "src/shop/tests.py",
    ];

    it.each(files)("%s: specifiers, declares, symbols and line count as the truth says", (rel) => {
        const parsed = parse(rel, fixture(rel));
        expect(parsed.imports).toEqual(truth.specifiers[rel]);
        expect(parsed.declares).toEqual(truth.declares[rel]);
        expect(parsed.symbols).toEqual(truth.symbols[rel]);
        expect(parsed.lineCount).toBe(truth.files.find((f) => f.path === rel)!.lineCount);
        expect(parsed.calls).toEqual({ types: [], bindings: [], calls: [] });
    });

    it.each(Object.keys(truth.chunks))("%s: chunks as the truth says", (rel) => {
        const chunks = parse(rel, fixture(rel)).chunks.map((c) => ({ kind: c.kind, name: c.name, startLine: c.startLine, endLine: c.endLine }));
        expect(chunks).toEqual(truth.chunks[rel]);
    });

    it("reads the broken file's imports above its error", () => {
        expect(parse(truth.broken.path, fixture(truth.broken.path)).imports).toEqual(truth.broken.specifiers);
    });

    it("the parse reading keeps imports and declares only; the scan reading only its column-0 imports", () => {
        for (const rel of ["src/shop/models.py", "src/shop/cli.py", "src/shop/__main__.py"]){
            expect(parse(rel, fixture(rel), "parse")).toMatchObject({ chunks: [], symbols: [], imports: truth.specifiers[rel], declares: truth.declares[rel] });
            expect(parse(rel, fixture(rel), "scan")).toMatchObject({ chunks: [], symbols: [], declares: [], imports: truth.scan?.[rel] ?? truth.specifiers[rel] });
        }
    });

    it("the file summary lists the module-level imports (not from __future__, not a function's) and the exported declarations", () => {
        const summary = parse("src/shop/cart.py", fixture("src/shop/cart.py")).chunks.at(-1)!;
        expect(summary.text).toBe([
            "File: src/shop/cart.py",
            "",
            "Imports:",
            "import shop.payments as pay",
            "import shop.payments.gateway",
            "from vendors import acme",
            "from .models import Product",
            "from .speedups import fast_total",
            "",
            "Exports:",
            "Cart (class)",
            "checkout (function)",
        ].join("\n"));
    });
});

describe("python parse: cases by hand", () => {
    it("joins a dotted name's parts, whatever the spacing, and keeps each specifier once", () => {
        expect(parse("a.py", "import a . b\nimport a.b, c as d\nfrom x import (y,\n    z,  # a comment\n)\nfrom x import y\n").imports)
            .toEqual(["a.b", "c", "x:y", "x:z"]);
    });

    it("relative imports: the dots, then the module's name", () => {
        expect(parse("p/a.py", "from . import a\nfrom .. import b\nfrom .m import c\nfrom ...m.n import d as e\nfrom .m import *\n").imports)
            .toEqual([".:a", "..:b", ".m:c", "...m.n:d", ".m:*"]);
    });

    it("dynamic imports need exactly one plain string literal, and import_module needs importlib's own name", () => {
        const text = [
            "import importlib",
            "from importlib import import_module as load",
            "importlib.import_module(r\"pkg.raw\")",
            "importlib.import_module('pkg.single')",
            "__import__(\"pkg.dunder\")",
            "load(\"pkg.alias\")",                         // the alias isn't import_module
            "import_module(\"pkg.unbound\")",              // not imported from importlib under that name
            "__import__(\"pkg.two\", fromlist=[\"x\"])",   // two arguments
            "importlib.import_module(\"pkg\" \".joined\")",  // concatenated
            "importlib.import_module(b\"pkg.bytes\")",
            "importlib.import_module(f\"pkg.{x}\")",
            "importlib.import_module(\".relative\")",
            "importlib.import_module(\"pkg\\x2eescaped\")",
            "other.import_module(\"pkg.other\")",
        ].join("\n");
        expect(parse("a.py", text).imports).toEqual(["importlib", "importlib:import_module", "pkg.raw", "pkg.single", "pkg.dunder"]);
    });

    it("from __future__ gives nothing", () => {
        expect(parse("a.py", "from __future__ import annotations, division\nimport os\n").imports).toEqual(["os"]);
    });

    it("declares __main__ only for a top-level `__name__ == \"__main__\"` test, parentheses allowed", () => {
        const declares = (text: string): string[] => parse("a.py", text).declares;
        expect(declares("if (__name__ == \"__main__\"):\n    pass\n")).toEqual(["__main__"]);
        expect(declares("if \"__main__\" == __name__:\n    pass\n")).toEqual(["__main__"]);
        expect(declares("if __name__ != \"__main__\":\n    pass\n")).toEqual([]);
        expect(declares("if __name__ == \"__main__\" and fast:\n    pass\n")).toEqual([]);
        expect(declares("if __name__ == f\"__main__\":\n    pass\n")).toEqual([]);
        expect(declares("def f():\n    if __name__ == \"__main__\":\n        pass\n")).toEqual([]);
        expect(declares("if __name__ == \"__main__\":\n    pass\n")).toEqual(["__main__"]);
    });

    it("binds every name of a chained or starred assignment; never an attribute or a subscript", () => {
        const text = "A = B = 1\nfirst, *rest = [1, 2]\nobj.attr = 1\nitems[0] = 2\nlogger: Logger\ncount += 1\n";
        expect(parse("a.py", text).symbols.map((s) => `${s.name} ${s.kind} ${s.startLine}`))
            .toEqual(["A const 1", "B const 1", "first const 2", "rest const 2", "logger const 5"]);
        expect(parse("a.py", text).chunks.map((c) => c.name)).toEqual(["A, B", "first, rest", "logger", "(file)"]);
    });

    it("__all__ as a tuple, extended with +=, decides what is exported; one with a non-literal element is ignored", () => {
        const exported = (text: string): string[] => parse("a.py", text).symbols.filter((s) => s.exported).map((s) => s.name);
        expect(exported("__all__ = (\"a\",)\n__all__ += [\"_b\"]\na = 1\n_b = 2\nc = 3\n")).toEqual(["a", "_b"]);
        expect(exported("__all__ = [\"a\", name]\na = 1\n_b = 2\nc = 3\n")).toEqual(["a", "c"]);
    });

    it("a comment trailing the statement above doesn't attach to the next declaration; one on its own line does", () => {
        const chunks = parse("a.py", "X = 1  # trailing\ndef f():\n    pass\n# leading\ndef g():\n    pass\n").chunks;
        expect(chunks.map((c) => [c.name, c.startLine, c.endLine])).toEqual([["X", 1, 1], ["f", 2, 3], ["g", 4, 6], ["(file)", 1, 6]]);
    });

    it("members: a deleter is an accessor, a static method a method, a class-level annotation a property", () => {
        const text = "class A:\n    x: int\n    @staticmethod\n    def s(): ...\n    @v.deleter\n    def v(self): ...\n    def __init__(self): ...\n";
        expect(parse("a.py", text).symbols.map((s) => `${s.qualifiedName} ${s.kind} ${s.startLine}-${s.endLine}`))
            .toEqual(["A class 1-7", "A.x property 2-2", "A.s method 3-4", "A.v accessor 5-6", "A.__init__ constructor 7-7"]);
    });

    it("a CRLF text and a byte-order mark give the same products", () => {
        const lf = fixture("src/shop/models.py").replace(/\r\n/g, "\n");
        const crlf = lf.replace(/\n/g, "\r\n");
        const a = parse("src/shop/models.py", lf);
        const b = parse("src/shop/models.py", crlf);
        expect({ imports: b.imports, declares: b.declares, symbols: b.symbols, lineCount: b.lineCount })
            .toEqual({ imports: a.imports, declares: a.declares, symbols: a.symbols, lineCount: a.lineCount });
        expect(b.chunks.map((c) => c.text)).toEqual(a.chunks.map((c) => c.text));
        expect(parse("src/shop/models.py", `${String.fromCharCode(0xfeff)}${lf}`)).toEqual(a);
    });

    it("an empty file has no products but the summary", () => {
        const parsed = parse("pkg/__init__.py", "");
        expect(parsed).toMatchObject({ imports: [], declares: [], symbols: [], lineCount: 0 });
        expect(parsed.chunks.map((c) => [c.name, c.startLine, c.endLine])).toEqual([["(file)", 1, 1]]);
    });
});

describe("python scan", () => {
    it("reads column-0 imports, semicolons, a parenthesized list over lines, from. without a space", () => {
        const text = [
            "import os; import sys",
            "from.m import x",
            "from . import (a,",
            "    b as c)  # done",
            "from __future__ import annotations",
            "    import indented",
            "from x import *",
            "import a.b as ab, c",
            "importer = 1",
            "from x import y z",   // malformed: nothing
        ].join("\r\n");
        expect(scanPythonImports(`${String.fromCharCode(0xfeff)}${text}`)).toEqual(["os", "sys", ".m:x", ".:a", ".:b", "x:*", "a.b", "c"]);
    });
});

describe("Python's chunks on a CRLF checkout (B-M2)", () => {
    // K13 compares the specifiers, declares and symbols; this compares every chunk, text included (fileHash hashes the
    // text as given, so it differs by design)
    it.each(truth.files.map((f) => f.path))("%s: the CRLF twin's chunks are the LF text's", (rel) => {
        const { lf, crlf } = k13Texts(fixture(rel));
        const chunksOf = (text: string) => parse(rel, text).chunks.map((c) => ({ ...c, fileHash: "" }));
        expect(chunksOf(crlf)).toEqual(chunksOf(lf));
    });
});
