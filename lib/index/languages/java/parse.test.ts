import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { k13Texts } from "../../../../test/helpers/adapter-conformance";
import { javaRepoTruth as truth } from "../../../../test/helpers/java-repo-truth";
import { loadGrammars } from "../treesitter";
import { importSpecifier, parseJava, scanImports } from "./parse";

const FIXTURE = path.resolve("test", "fixtures", "java-repo");
const read = (rel: string): string => fs.readFileSync(path.join(FIXTURE, rel), "utf8");
const full = (rel: string) => parseJava(rel, read(rel), "full");
/** A snippet's products, with its lines joined by "\n". */
const parseLines = (lines: string[]) => parseJava("a/B.java", `${lines.join("\n")}\n`, "full");

beforeAll(async () => {
    await loadGrammars([{ id: "java", grammar: "tree-sitter-java.wasm" }]);
});

// the fixture files below transcribe test/helpers/java-repo-truth.ts (derived by hand); the conformance kit checks
// every file, these pin the readings one file at a time
describe("Java's parse, on the fixture", () => {
    const files = [
        "app/src/main/java/com/example/app/App.java",                 // every import form, a main, the object rule
        "app/src/main/java/com/example/app/Registry.java",            // every form of a type name
        "app/src/main/java/com/example/app/Service.java",             // qualified names, in a type and in an expression
        "app/src/main/java/com/example/app/Mode.java",                // an enum and a second top-level type
        "app/src/main/java/com/example/app/Broken.java",              // the syntax error
        "lib/src/main/java/com/example/lib/Outer.java",               // a nested class with members
        "lib/src/main/java/com/example/lib/Audited.java",             // an annotation type
        "lib/src/main/java/com/example/lib/package-info.java",        // a package annotation, no type
        "tools/src/main/java/Launcher.java",                          // the default package, main(String...)
    ];

    for (const rel of files){
        it(`reads ${rel.slice(rel.lastIndexOf("/") + 1)}'s specifiers, declares, symbols and line count`, () => {
            const parsed = full(rel);
            expect(parsed.imports).toEqual(truth.specifiers[rel]);
            expect(parsed.declares).toEqual(truth.declares[rel]);
            expect(parsed.symbols).toEqual(truth.symbols[rel]);
            expect(parsed.lineCount).toBe(truth.files.find((f) => f.path === rel)!.lineCount);
            expect(parsed.calls).toEqual({ types: [], bindings: [], calls: [] });
        });
    }

    it("cuts the chunk files as the truth says", () => {
        for (const [rel, expected] of Object.entries(truth.chunks)){
            expect(full(rel).chunks.map((c) => ({ kind: c.kind, name: c.name, startLine: c.startLine, endLine: c.endLine })), rel).toEqual(expected);
        }
    });

    it("reads the broken file's specifiers around its error", () => {
        expect(full(truth.broken.path).imports).toEqual(truth.broken.specifiers);
    });

    it("gives the parse reading the full imports and declares, with no chunks or symbols", () => {
        for (const rel of files){
            const parsed = parseJava(rel, read(rel), "parse");
            expect(parsed).toMatchObject({ chunks: [], symbols: [], imports: truth.specifiers[rel], declares: truth.declares[rel] });
        }
    });

    it("gives the scan reading only the import lines' specifiers, and no declares", () => {
        for (const rel of files){
            const parsed = parseJava(rel, read(rel), "scan");
            expect(parsed).toMatchObject({ chunks: [], symbols: [], declares: [], imports: truth.scan?.[rel] ?? truth.specifiers[rel] });
        }
    });

    it("lists App's imports and exports in its file summary", () => {
        const summary = full("app/src/main/java/com/example/app/App.java").chunks.at(-1)!;
        expect(summary.text).toBe([
            "File: app/src/main/java/com/example/app/App.java",
            "",
            "Imports:",
            "import static com.example.lib.Constants.*;",
            "import static com.example.lib.Strings.shout;",
            "import com.example.lib.*;",
            "import com.example.lib.Greeter;",
            "import com.example.lib.Outer.Inner;",
            "import java.util.List;",
            "",
            "Exports:",
            "App (class)",
        ].join("\n"));
    });
});

// snippets for rules the fixture doesn't hold; each expectation is read off the snippet by hand
describe("Java's parse, on snippets", () => {
    it("reads import declarations to their specifiers, and a malformed one to none", () => {
        expect(importSpecifier(false, ["a", "b", "C"], false)).toBe("import:a.b.C");
        expect(importSpecifier(false, ["a", "b"], true)).toBe("import:a.b.*");
        expect(importSpecifier(true, ["a", "B", "m"], false)).toBe("static:a.B");
        expect(importSpecifier(true, ["a", "B"], true)).toBe("static:a.B");
        expect(importSpecifier(true, ["m"], false)).toBeNull();
        expect(importSpecifier(false, ["a", ""], false)).toBeNull();
    });

    it("takes an upper-case head of a dotted type or chain as the type, and a lower-case head as a package", () => {
        const parsed = parseLines([
            "package p;",
            "class B {",
            "    Map.Entry<String, Integer> e;",
            "    java.util.List<Item> items;",
            "    Object x = Outer.Inner.make();",
            "    Object y = org.acme.Thing.Nested.VALUE;",
            "}",
        ]);
        expect(parsed.imports).toEqual(["type:Map", "type:String", "type:Integer", "qualified:java.util.List", "type:Item", "type:Object", "type:Outer", "qualified:org.acme.Thing"]);
    });

    it("leaves out var, type parameters, the file's own types at any depth, single-type imports and the file's variables", () => {
        const parsed = parseLines([
            "package p;",
            "import a.Single;",
            "class B<T> {",
            "    static final Helper LOG = null;",
            "    <R extends Bound> R map(T value, Single s) {",
            "        var local = new Local();",
            "        LOG.info(value);",
            "        Single.go();",
            "        class Local {}",
            "        return null;",
            "    }",
            "}",
        ]);
        expect(parsed.imports).toEqual(["import:a.Single", "type:Helper", "type:Bound"]);
    });

    it("leaves out a statically imported member used as an object, and a lower-case object", () => {
        const parsed = parseLines([
            "import static a.Config.SETTINGS;",
            "class B {",
            "    void f(Object other) {",
            "        SETTINGS.read();",
            "        other.toString();",
            "        Tool.run();",
            "    }",
            "}",
        ]);
        expect(parsed.imports).toEqual(["static:a.Config", "type:Object", "type:Tool"]);
    });

    it("reads types in throws, catch, casts, instanceof, arrays and method references", () => {
        const parsed = parseLines([
            "class B {",
            "    void f(Object o) throws IOError {",
            "        try { g((Cast) o); } catch (Oops | Again e) { }",
            "        if (o instanceof Pattern p) { }",
            "        Elem[] xs = new Made[1];",
            "        Runnable r = Ref::run;",
            "    }",
            "}",
        ]);
        expect(parsed.imports).toEqual(["type:Object", "type:IOError", "type:Cast", "type:Oops", "type:Again", "type:Pattern", "type:Elem", "type:Made", "type:Runnable", "type:Ref"]);
    });

    it("declares main for String[], String... and String args[], and not for an instance or non-void main", () => {
        const mains = (signature: string) => parseLines(["package p;", "public class B {", `    ${signature} {}`, "}"]).declares;
        expect(mains("public static void main(String[] args)")).toContain("main:p.B");
        expect(mains("public static void main(String... args)")).toContain("main:p.B");
        expect(mains("public static void main(String args[])")).toContain("main:p.B");
        expect(mains("public static void main(java.lang.String[] args)")).toContain("main:p.B");
        expect(mains("public void main(String[] args)")).not.toContain("main:p.B");
        expect(mains("static void main(String[] args)")).not.toContain("main:p.B");
        expect(mains("public static int main(String[] args)")).not.toContain("main:p.B");
        expect(mains("public static void main(String[][] args)")).not.toContain("main:p.B");
        expect(mains("public static void main(String[] args, int n)")).not.toContain("main:p.B");
        // an interface's methods are public without the word
        expect(parseLines(["package p;", "public interface B {", "    static void main(String[] args) {}", "}"]).declares).toContain("main:p.B");
    });

    it("lists a declaration with two declarators as two properties, each with its lines", () => {
        const parsed = parseLines(["public class B {", "    public int a,", "        b;", "}"]);
        expect(parsed.symbols.map((s) => [s.name, s.kind, s.startLine, s.endLine, s.exported])).toEqual([
            ["B", "class", 1, 4, true], ["a", "property", 2, 3, true], ["b", "property", 2, 3, true],
        ]);
    });

    it("exports a public member only of an exported type, and a public interface's members unless private", () => {
        const hidden = parseLines(["class B {", "    public void f() {}", "}"]);
        expect(hidden.symbols.map((s) => s.exported)).toEqual([false, false]);
        const api = parseLines(["public interface B {", "    void f();", "    private void g() {}", "}"]);
        expect(api.symbols.map((s) => [s.name, s.exported])).toEqual([["B", true], ["f", true], ["g", false]]);
    });

    it("gives a compact constructor the record's name", () => {
        const parsed = parseLines(["public record B(int x) {", "    public B {", "    }", "}"]);
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.kind, s.startLine, s.endLine])).toEqual([["B", "class", 1, 4], ["B.B", "constructor", 2, 3]]);
    });

    it("attaches a comment on its own line above a type to its chunk, and not one that trails an import", () => {
        const parsed = parseLines(["import a.X; // trailing", "public class B {", "}", "", "// own line", "class C {", "}"]);
        expect(parsed.chunks.map((c) => [c.name, c.startLine, c.endLine])).toEqual([["B", 2, 3], ["C", 5, 7], ["(file)", 1, 7]]);
    });

    it("declares the default package and no type for a file with only a package line", () => {
        expect(parseLines(["class B {}"]).declares).toEqual(["package:", "type:B"]);
        expect(parseLines(["package a.b;"]).declares).toEqual(["package:a.b"]);
    });

    it("scans import lines with spaces, a BOM, CRLF and two on one line, and nothing in other lines", () => {
        const text = "﻿package a;\r\nimport  java . util . List ;\r\nimport static a.B.*; import c.D;\r\nclass X { String s = \"import e.F;\"; }\r\n";
        expect(scanImports(text)).toEqual(["import:java.util.List", "static:a.B", "import:c.D"]);
    });
});

describe("Java's chunks on a CRLF checkout (B-M2)", () => {
    // K13 compares the specifiers, declares and symbols; this compares every chunk, text included (fileHash hashes the
    // text as given, so it differs by design)
    it.each(truth.files.map((f) => f.path))("%s: the CRLF twin's chunks are the LF text's", (rel) => {
        const { lf, crlf } = k13Texts(read(rel));
        const chunksOf = (text: string) => parseJava(rel, text, "full").chunks.map((c) => ({ ...c, fileHash: "" }));
        expect(chunksOf(crlf)).toEqual(chunksOf(lf));
    });
});
