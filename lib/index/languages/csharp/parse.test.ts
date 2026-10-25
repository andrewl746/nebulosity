import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { k13Texts } from "../../../../test/helpers/adapter-conformance";
import { csharpRepoTruth as truth } from "../../../../test/helpers/csharp-repo-truth";
import { loadGrammars } from "../treesitter";
import { parseCsharp } from "./parse";

const FIXTURE = path.resolve("test", "fixtures", "csharp-repo");
const read = (rel: string): string => fs.readFileSync(path.join(FIXTURE, rel), "utf8");
const BOM = String.fromCharCode(0xfeff);
/** Specifiers of a snippet (the full reading). */
const imports = (text: string): string[] => parseCsharp("x.cs", text, "full").imports;

describe("parseCsharp", () => {
    beforeAll(async () => {
        await loadGrammars([{ id: "csharp", grammar: "tree-sitter-c_sharp.wasm" }]);
    });

    // the truth's files, transcribed: every one, the broken CartPage.cs and the BOM file Money.cs among them
    describe.each(truth.files.map((f) => [f.path]))("%s", (rel) => {
        it("reads the truth's specifiers, declares and symbols", () => {
            const parsed = parseCsharp(rel, read(rel), "full");
            expect(parsed.imports).toEqual(truth.specifiers[rel]);
            expect(parsed.declares).toEqual(truth.declares[rel]);
            expect(parsed.symbols).toEqual(truth.symbols[rel]);
            expect(parsed.lineCount).toBe(truth.files.find((f) => f.path === rel)!.lineCount);
        });

        it("parse keeps the specifiers and declares; scan reads only using and namespace lines", () => {
            expect(parseCsharp(rel, read(rel), "parse")).toMatchObject({ chunks: [], symbols: [], imports: truth.specifiers[rel], declares: truth.declares[rel] });
            expect(parseCsharp(rel, read(rel), "scan")).toMatchObject({ chunks: [], symbols: [], declares: [], imports: truth.scan?.[rel] ?? truth.specifiers[rel] });
        });
    });

    it("cuts the truth's chunks", () => {
        for (const [rel, expected] of Object.entries(truth.chunks)){
            const chunks = parseCsharp(rel, read(rel), "full").chunks.map((c) => ({ kind: c.kind, name: c.name, startLine: c.startLine, endLine: c.endLine }));
            expect(chunks, rel).toEqual(expected);
        }
    });

    it("reads the real byte-order mark in Money.cs (the bytes EF BB BF on disk) as if it weren't there", () => {
        const bytes = fs.readFileSync(path.join(FIXTURE, "src/Shop.Core/Money.cs"));
        expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        const text = read("src/Shop.Core/Money.cs");
        expect(text.charCodeAt(0)).toBe(0xfeff);
        expect(parseCsharp("m.cs", text, "full")).toEqual(parseCsharp("m.cs", text.slice(1), "full"));
        // two marks (a tool that adds one to a file that has one) read the same too
        expect(parseCsharp("m.cs", `${BOM}${text}`, "full")).toEqual(parseCsharp("m.cs", text.slice(1), "full"));
    });

    it("writes the summary's imports as the using lines and its exports as name (kind)", () => {
        const summary = parseCsharp("src/Shop.Core/Models/Order.cs", read("src/Shop.Core/Models/Order.cs"), "full").chunks.at(-1)!;
        expect(summary.text).toBe([
            "File: src/Shop.Core/Models/Order.cs", "", "Imports:", "using System;", "using System.Collections.Generic;", "",
            "Exports:", "OrderPlacedHandler (type)", "Order (class)",
        ].join("\n"));
    });

    // hand-written snippets for forms the fixture doesn't hold
    it("reads global using static, generic alias targets and global:: names", () => {
        expect(imports("global using static A.B;\nusing global::System.Text;\nusing Map = System.Collections.Generic.Dictionary<string, Order>;\n"))
            .toEqual(["gstatic:A.B", "using:System.Text", "alias:Map=System.Collections.Generic.Dictionary"]);
        expect(parseCsharp("x.cs", "global using static A.B;\nglobal using M = A.C;\n", "full").declares).toEqual(["galias:M=A.C", "gstatic:A.B"]);
    });

    it("leaves out a static access through the file's fields, locals and foreach variables", () => {
        expect(imports("class C { static int Max = 1; void F() { var Local = 1; foreach (var Each in xs) { Each.M(); } Max.ToString(); Local.ToString(); Other.ToString(); } }"))
            .toEqual(["type:Other"]);
    });

    it("reads is, as, casts, catch, default, arrays, tuples and nullable types", () => {
        expect(imports("class C { void F(object o) { if (o is A a) {} var b = o as B; var c = (C2)o; try {} catch (E e) {} var d = default(D); var f = new F2[2]; (G g, H h) t = default; I? i = null; if (o is J) {} } }"))
            .toEqual(["type:A", "type:B", "type:C2", "type:E", "type:D", "type:F2", "type:G", "type:H", "type:I", "type:J"]);
    });

    it("gives an invoked member no specifier (extension-method calls aren't linked); its receiver still can", () => {
        expect(imports("class C { void F(string s) { string.IsNullOrEmpty(s); s.Trim(); Helper.Run(); x?.Go(); } }")).toEqual(["type:Helper"]);
    });

    it("reads a qualified attribute and a generic method's type arguments, and leaves type parameters out", () => {
        expect(imports("[A.B.Marker] class C<T> { T F<U>(U u) => default; void G() { x.Run<Order, T>(); Make<Item>(); } }"))
            .toEqual(["qtype:A.B.Marker", "qtype:A.B.MarkerAttribute", "type:Order", "type:Item"]);
    });

    it("declares nested types with their outer types, and no extension methods", () => {
        const parsed = parseCsharp("x.cs", "namespace N.M { public static class E { public static void A(this int i) {} public class In { public class Deep {} } } public class NotStatic { public static void B(this int i) {} } }", "full");
        expect(parsed.declares).toEqual(["type:N.M.E", "type:N.M.E.In", "type:N.M.E.In.Deep", "type:N.M.NotStatic"]);
        expect(parsed.symbols.map((s) => s.qualifiedName)).toEqual(["E", "E.A", "E.In", "NotStatic", "NotStatic.B"]);
    });

    it("reads declarations inside #if blocks", () => {
        const parsed = parseCsharp("x.cs", "namespace N\n{\n#if DEBUG\n    public class A { }\n#endif\n}\n", "full");
        expect(parsed.declares).toEqual(["type:N.A"]);
        expect(parsed.symbols.map((s) => s.name)).toEqual(["A"]);
    });

    it("scans using lines but not using statements or declarations", () => {
        const text = "using A.B;\nglobal using static C.D;\nusing X = E.F<int>;\nnamespace G.H\n{\n    using (var s = Open()) { }\n    using var t = Open();\n    namespace I;\n}\n";
        expect(parseCsharp("x.cs", text, "scan").imports).toEqual(["using:A.B", "gstatic:C.D", "alias:X=E.F", "ns:G.H", "ns:I"]);
    });
});

describe("C#'s one export rule (ADR-065, the final review's B-I2)", () => {
    beforeAll(async () => {
        await loadGrammars([{ id: "csharp", grammar: "tree-sitter-c_sharp.wasm" }]);
    });

    it("exports a member or a nested type only when its owner is exported and it is public; an interface's members take its flag", () => {
        const parsed = parseCsharp("x.cs", [
            "internal class Hidden { public void Shown() {} public class Inner {} }",
            "public class Open { public void Shown() {} void Quiet() {} public class Inner {} class Private {} }",
            "public interface IThing { void Do(); }",
            "interface IHidden { void Do(); }",
        ].join("\n"), "full");
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.exported])).toEqual([
            ["Hidden", false], ["Hidden.Shown", false], ["Hidden.Inner", false],
            ["Open", true], ["Open.Shown", true], ["Open.Quiet", false], ["Open.Inner", true], ["Open.Private", false],
            ["IThing", true], ["IThing.Do", true],
            ["IHidden", false], ["IHidden.Do", false],
        ]);
    });
});

describe("C#'s file summary on a CRLF checkout (B-M2)", () => {
    beforeAll(async () => {
        await loadGrammars([{ id: "csharp", grammar: "tree-sitter-c_sharp.wasm" }]);
    });
    const summaryOf = (text: string): string => parseCsharp("x.cs", text, "full").chunks.at(-1)!.text;

    it("keeps no carriage return from a multi-line using: the CRLF twin (K13's) gives the LF summary", () => {
        const { lf, crlf } = k13Texts("using Map =\n    System.Text;\nusing static\n    System.Math;\n\nnamespace N;\n\npublic class C { }\n");
        expect(summaryOf(crlf)).toBe(summaryOf(lf));
        expect(summaryOf(crlf)).toBe("File: x.cs\n\nImports:\nusing Map =\n    System.Text;\nusing static\n    System.Math;\n\nExports:\nC (class)");
    });

    it("leaves a malformed using out of the specifiers and the summary, as the other languages do", () => {
        const parsed = parseCsharp("x.cs", "using ;\nusing X = ;\nusing global::;\nusing A.B;\nclass C {}\n", "full");
        expect(parsed.imports).toEqual(["using:A.B"]);
        expect(parsed.chunks.at(-1)!.text).toBe("File: x.cs\n\nImports:\nusing A.B;\n\nExports:\n  (none)");
    });

    // K13 compares the specifiers, declares and symbols; this compares every chunk, text included (fileHash hashes the
    // text as given, so it differs by design)
    it.each(truth.files.map((f) => f.path))("%s: the CRLF twin's chunks are the LF text's", (rel) => {
        const { lf, crlf } = k13Texts(read(rel));
        const chunksOf = (text: string) => parseCsharp(rel, text, "full").chunks.map((c) => ({ ...c, fileHash: "" }));
        expect(chunksOf(crlf)).toEqual(chunksOf(lf));
    });
});
