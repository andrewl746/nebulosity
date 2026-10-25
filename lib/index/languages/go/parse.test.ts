import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { k13Texts } from "../../../../test/helpers/adapter-conformance";
import { goRepoTruth as truth } from "../../../../test/helpers/go-repo-truth";
import { prepareLanguages } from "../registry";
import { goAdapter } from "./index";
import { parseGo, scanImports } from "./parse";

const FIXTURE = path.resolve("test", "fixtures", "go-repo");
const read = (rel: string): string => fs.readFileSync(path.join(FIXTURE, rel), "utf8");
/** A Go text from its lines (tabs written "\t"). */
const go = (...lines: string[]): string => lines.map((l) => `${l}\n`).join("");
const full = (text: string) => parseGo("x.go", text, "full");

beforeAll(async () => {
    await prepareLanguages([goAdapter]);
});

describe("the Go parse against the go-repo truth", () => {
    // the five files the plan asks for, and every other one: each file's specifiers, declares, symbols, line count
    const transcribed = ["internal/store/store.go", "cmd/shop/main.go", "internal/api/handler.go", "internal/api/scope.go", "internal/api/broken.go"];

    it.each(transcribed)("%s: specifiers, declares, symbols and line count as the truth says", (rel) => {
        const parsed = parseGo(rel, read(rel), "full");
        expect(parsed.imports).toEqual(truth.specifiers[rel]);
        expect(parsed.declares).toEqual(truth.declares[rel]);
        expect(parsed.symbols).toEqual(truth.symbols[rel]);
        expect(parsed.lineCount).toBe(truth.files.find((f) => f.path === rel)!.lineCount);
    });

    it("reads every truth file's specifiers, declares and symbols", () => {
        for (const { path: rel } of truth.files){
            const parsed = parseGo(rel, read(rel), "full");
            expect({ imports: parsed.imports, declares: parsed.declares, symbols: parsed.symbols }, rel)
                .toEqual({ imports: truth.specifiers[rel], declares: truth.declares[rel], symbols: truth.symbols[rel] });
        }
    });

    it("reads the broken file around its error: the import and Shout's use before it, Width's name:limit after it", () => {
        const parsed = parseGo(truth.broken.path, read(truth.broken.path), "full");
        expect(parsed.imports).toEqual(truth.broken.specifiers);
        expect(parsed.symbols.map((s) => s.name)).toEqual(["Shout", "Width"]);
    });

    it.each(Object.keys(truth.chunks))("%s: chunks as the truth says", (rel) => {
        const chunks = parseGo(rel, read(rel), "full").chunks;
        expect(chunks.map((c) => ({ kind: c.kind, name: c.name, startLine: c.startLine, endLine: c.endLine }))).toEqual(truth.chunks[rel]);
    });

    it("the scan reading gives the truth's scan, or the full imports where it lists none", () => {
        for (const { path: rel } of truth.files){
            expect(parseGo(rel, read(rel), "scan").imports, rel).toEqual(truth.scan?.[rel] ?? truth.specifiers[rel]);
        }
    });

    it("the file summary lists each import spec and the exported top-level declarations", () => {
        const summary = parseGo("internal/api/api.go", read("internal/api/api.go"), "full").chunks.at(-1)!;
        expect(summary.text).toBe([
            "File: internal/api/api.go",
            "",
            "Imports:",
            "import \"fmt\"",
            "import \"example.com/shop/internal/store\"",
            "import \"github.com/other/lib\"",
            "",
            "Exports:",
            "Version (const)",
            "Open (function)",
        ].join("\n"));
    });

    it("names a struct in the summary's exports by its chunk kind, class (B-M1), and leaves methods out", () => {
        const summary = parseGo("internal/store/store.go", read("internal/store/store.go"), "full").chunks.at(-1)!;
        expect(summary.text).toBe([
            "File: internal/store/store.go",
            "",
            "Imports:",
            "  (none)",
            "",
            "Exports:",
            "MaxItems (const)",
            "Key (type)",
            "Store (class)",
            "Getter (interface)",
            "New (function)",
        ].join("\n"));
    });
});

describe("the Go parse, case by case", () => {
    it("binds a function's names wherever they're declared in it: a later := still binds an earlier use", () => {
        const text = go("package p", "", "func f() int {", "\tdefer func() { _ = later }()", "\tlater := 1", "\treturn later", "}");
        expect(full(text).imports).toEqual([]);
    });

    it("reads a range or a receive with = as a use, with := as a binding", () => {
        expect(full(go("package p", "", "func f(m map[int]int) {", "\tfor k = range m {", "\t}", "}")).imports).toEqual(["name:k"]);
        expect(full(go("package p", "", "func f(m map[int]int) {", "\tfor k := range m {", "\t\t_ = k", "\t}", "}")).imports).toEqual([]);
        expect(full(go("package p", "", "func f(c chan int) {", "\tselect {", "\tcase v := <-c:", "\t\t_ = v", "\tcase w = <-c:", "\t}", "}")).imports)
            .toEqual(["name:w"]);
    });

    it("binds a top-level function literal's parameters inside it, and reads its free names", () => {
        expect(full(go("package p", "", "var hook = func(n int) int { return n + offset }")).imports).toEqual(["name:offset"]);
    });

    it("reads a type constraint and an embedded interface as names, a type parameter as bound", () => {
        const text = go("package p", "", "type Set[K Key, V any] map[K]V", "", "type Both interface {", "\tReader", "\tio.Writer", "}");
        expect(full(text).imports).toEqual(["name:Key", "name:Reader", "use:io.Writer"]);
    });

    it("reads an embedded struct field as a property named by its type, and its type as a reference", () => {
        const text = go("package p", "", "type T struct {", "\tsync.Mutex", "\t*Base", "\ta, b int", "}");
        const parsed = full(text);
        expect(parsed.imports).toEqual(["use:sync.Mutex", "name:Base"]);
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.kind, s.startLine])).toEqual([
            ["T", "struct", 3], ["T.Mutex", "property", 4], ["T.Base", "property", 5], ["T.a", "property", 6], ["T.b", "property", 6],
        ]);
    });

    it("gives each name of a spec a symbol on the spec's lines, leaves `_` out of symbols and declares, and keeps its chunk", () => {
        const parsed = full(go("package p", "", "var a, B = 1, 2", "", "var _ Getter = (*T)(nil)"));
        expect(parsed.symbols.map((s) => [s.name, s.kind, s.startLine, s.exported])).toEqual([["a", "const", 3, false], ["B", "const", 3, true]]);
        expect(parsed.declares).toEqual(["B", "a", "package:p"]);
        expect(parsed.imports).toEqual(["name:Getter", "name:T"]);
        expect(parsed.chunks.map((c) => [c.kind, c.name])).toEqual([["const", "a, B"], ["const", "_"], ["file-summary", "(file)"]]);
    });

    it("names a grouped type declaration's chunk by its specs, a struct group a class and a mixed group a type", () => {
        const parsed = full(go("package p", "", "type (", "\tA struct{}", "\tB struct{}", ")", "", "type (", "\tC struct{}", "\tD int", ")"));
        expect(parsed.chunks.map((c) => [c.kind, c.name, c.startLine, c.endLine])).toEqual([
            ["class", "A, B", 3, 6], ["type", "C, D", 8, 11], ["file-summary", "(file)", 1, 11],
        ]);
        expect(parsed.symbols.map((s) => [s.name, s.kind, s.startLine])).toEqual([["A", "struct", 4], ["B", "struct", 5], ["C", "struct", 9], ["D", "type", 10]]);
    });

    it("doesn't take a comment trailing the code above as a declaration's own", () => {
        const parsed = full(go("package p", "", "var a = 1 // the first", "func f() {}"));
        expect(parsed.chunks.map((c) => [c.name, c.startLine, c.endLine])).toEqual([["a", 3, 3], ["f", 4, 4], ["(file)", 1, 4]]);
    });

    it("never reads a keyed element's bare key, a label or a field name as a name, but reads a map key's expression", () => {
        const text = go("package p", "", "func f() {", "outer:", "\tfor {", "\t\tbreak outer", "\t}", "\t_ = T{Field: v}", "\t_ = map[string]int{store.Key: 1}", "}");
        expect(full(text).imports).toEqual(["name:T", "name:v", "use:store.Key"]);
    });

    it("reads a selector on a call or a field as nothing more than its operand's own references", () => {
        expect(full(go("package p", "", "func f() {", "\tNew().Close()", "\tcfg.Server.Port = 1", "}")).imports).toEqual(["name:New", "use:cfg.Server"]);
    });

    it("reads a raw-string import path, and an alias, a dot and a blank", () => {
        const text = go("package p", "", "import (", "\tx `example.com/a`", "\t. \"example.com/b\"", "\t_ \"example.com/c\"", ")");
        expect(full(text).imports).toEqual(["import:example.com/a as x", "import:example.com/b as .", "import:example.com/c as _"]);
        expect(scanImports(text)).toEqual(["import:example.com/a as x", "import:example.com/b as .", "import:example.com/c as _"]);
    });

    it("the parse reading keeps the specifiers and declares, with no chunks or symbols", () => {
        const text = read("internal/store/store.go");
        const parsed = parseGo("internal/store/store.go", text, "parse");
        expect(parsed).toMatchObject({ chunks: [], symbols: [], imports: ["name:DefaultSize"], declares: truth.declares["internal/store/store.go"] });
    });

    it("the scan reads one-line blocks and cgo's comment, and stops at the first declaration", () => {
        const text = go(
            "package p",
            "",
            "/*",
            "import \"not/this\"",
            "*/",
            "import \"C\"",
            "import ( \"one\" )",
            "import (",
            "\t// a comment",
            "\t\"two\" // trailing",
            ")",
            "",
            "var s = `",
            "import \"not/this/either\"",
            "`",
        );
        expect(scanImports(text)).toEqual(["import:C", "import:one", "import:two"]);
    });

    it("drops one leading byte-order mark and reads CRLF text alike", () => {
        const lf = read("cmd/shop/main.go").replace(/\r\n/g, "\n");
        const bom = String.fromCharCode(0xfeff);
        expect(parseGo("cmd/shop/main.go", `${bom}${lf}`, "full")).toEqual(parseGo("cmd/shop/main.go", lf, "full"));
        const crlf = parseGo("cmd/shop/main.go", lf.replace(/\n/g, "\r\n"), "full");
        expect(crlf.imports).toEqual(truth.specifiers["cmd/shop/main.go"]);
        expect(crlf.symbols).toEqual(truth.symbols["cmd/shop/main.go"]);
    });
});

describe("Go's one export rule (ADR-065, the final review's B-I2)", () => {
    it("exports a field, an interface method or a method only when its owner type is exported too", () => {
        const parsed = full(go(
            "package p",
            "",
            "type hidden struct {",
            "\tShown int",
            "}",
            "",
            "type getter interface {",
            "\tGet() int",
            "}",
            "",
            "type Open struct {",
            "\tShown int",
            "\tquiet int",
            "}",
            "",
            "func (h *hidden) Shown2() {}",
            "func (o Open) Do() {}",
            "func (e Elsewhere) Run() {}",
        ));
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.exported])).toEqual([
            ["hidden", false], ["hidden.Shown", false],
            ["getter", false], ["getter.Get", false],
            ["Open", true], ["Open.Shown", true], ["Open.quiet", false],
            ["hidden.Shown2", false],   // its receiver's type is declared here, unexported
            ["Open.Do", true],
            ["Elsewhere.Run", true],    // its receiver's type isn't declared in this file, so only the case decides
        ]);
        expect(parsed.chunks.filter((c) => c.kind === "function").map((c) => [c.name, c.exported])).toEqual([
            ["hidden.Shown2", false], ["Open.Do", true], ["Elsewhere.Run", true],
        ]);
    });
});

describe("a valid Go file nested deeper than the call stack goes (B-I1)", () => {
    // `pkg.Deep + x + x + …`: a left-nested chain of 40,000 terms, whose deepest node is the first term
    const deep = go("package p", "", "import \"example.com/pkg\"", "", "func f(x int) int {", `\treturn pkg.Deep${" + x".repeat(39_999)}`, "}");

    it.each(["full", "parse"] as const)("parses in the %s reading, down to the deepest term", (reading) => {
        const parsed = parseGo("deep.go", deep, reading);
        expect(parsed.imports).toEqual(["import:example.com/pkg", "use:pkg.Deep"]);
        expect(parsed.declares).toEqual(["f", "package:p"]);
        expect(parsed.lineCount).toBe(7);
    });
});

describe("Go's chunks on a CRLF checkout (B-M2)", () => {
    // K13 compares the specifiers, declares and symbols; this compares every chunk, text included (fileHash hashes the
    // text as given, so it differs by design)
    it.each(truth.files.map((f) => f.path))("%s: the CRLF twin's chunks are the LF text's", (rel) => {
        const { lf, crlf } = k13Texts(read(rel));
        const chunksOf = (text: string) => parseGo(rel, text, "full").chunks.map((c) => ({ ...c, fileHash: "" }));
        expect(chunksOf(crlf)).toEqual(chunksOf(lf));
    });
});
