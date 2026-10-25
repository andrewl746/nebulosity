import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { rustRepoTruth as truth } from "../../../../test/helpers/rust-repo-truth";
import { prepareLanguages } from "../registry";
import { rustAdapter } from "./index";
import { parseRust } from "./parse";
import { leavesOfUseText } from "./syntax";

const FIXTURE = path.resolve("test", "fixtures", "rust-repo");
const read = (rel: string): string => fs.readFileSync(path.join(FIXTURE, rel), "utf8");
const chunkShape = (rel: string) => parseRust(rel, read(rel), "full").chunks.map((c) => ({ kind: c.kind, name: c.name, startLine: c.startLine, endLine: c.endLine }));
/** Imports of a snippet, as a file at the repo root. */
const importsOf = (text: string): string[] => parseRust("snippet.rs", text, "full").imports;

beforeAll(async () => {
    await prepareLanguages([rustAdapter]);
});

// The fixture's hand-derived truth (test/helpers/rust-repo-truth.ts), file by file.
describe("Rust's parse, on the rust-repo fixture's truth", () => {
    it.each(truth.files.map((f) => f.path))("%s: its specifiers, declares and symbols", (rel) => {
        const parsed = parseRust(rel, read(rel), "full");
        expect(parsed.imports).toEqual(truth.specifiers[rel]);
        expect(parsed.declares).toEqual(truth.declares[rel]);
        expect(parsed.symbols).toEqual(truth.symbols[rel]);
        expect(parsed.lineCount).toBe(truth.files.find((f) => f.path === rel)?.lineCount);
    });

    it.each(Object.keys(truth.chunks))("%s: its chunks", (rel) => {
        expect(chunkShape(rel)).toEqual(truth.chunks[rel]);
    });

    it("the broken file is read around its error: the use above it and the path in the fn after it", () => {
        expect(parseRust(truth.broken.path, read(truth.broken.path), "full").imports).toEqual(truth.broken.specifiers);
    });

    it("the parse reading keeps the imports and declares, with no chunk or symbol", () => {
        const rel = "crates/core/src/lib.rs";
        expect(parseRust(rel, read(rel), "parse")).toMatchObject({ chunks: [], symbols: [], imports: truth.specifiers[rel], declares: truth.declares[rel] });
    });

    it.each(Object.keys(truth.scan ?? {}))("%s: the scan reading", (rel) => {
        expect(parseRust(rel, read(rel), "scan")).toMatchObject({ chunks: [], symbols: [], declares: [], imports: truth.scan?.[rel] });
    });
});

describe("Rust's specifiers", () => {
    it("expands use trees: nested groups, self in a group, a glob in a group, a rename of self", () => {
        expect(importsOf("use crate::{a::{self, B}, c::*, d::E as F};\nuse a::{self as b, *};\n")).toEqual([
            "use:|crate::a", "use:|crate::a::B", "use:|crate::c::*", "use:|crate::d::E as F", "use:|a as b", "use:|a::*",
        ]);
    });

    it("keeps a leading :: on use paths and code paths, and leaves out paths starting with std, core or alloc", () => {
        expect(importsOf("use ::serde::X;\nuse ::std::fmt;\nfn f() { ::serde::X::f(); core::mem::drop(1); alloc::vec::Vec::new(); ::std::process::exit(0); }\n"))
            .toEqual(["use:|::serde::X", "use:|::std::fmt", "path:|::serde::X::f"]);
    });

    it("writes a path without its generic arguments and reads the arguments' own paths", () => {
        expect(importsOf("fn f(x: a::Wrapper<b::Thing>) { Vec::<c::D>::new(); x::y::<T>(); }\n"))
            .toEqual(["path:|a::Wrapper", "path:|b::Thing", "path:|Vec::new", "path:|c::D", "path:|x::y"]);
    });

    it("reads a qualified type's trait path but writes no path for <T as Tr>::x itself", () => {
        expect(importsOf("fn f() { <T as a::Tr>::x(); }\n")).toEqual(["path:|a::Tr"]);
    });

    it("reads macro paths and attribute paths, but nothing inside a token tree or a visibility", () => {
        expect(importsOf("#[tokio::main]\npub(in crate::a) fn f() { serde_json::json!(a::b); }\nmacro_rules! m { () => { x::y() }; }\n"))
            .toEqual(["path:|tokio::main", "path:|serde_json::json"]);
    });

    it("carries the inline module path, nested, and a #[path] with comments between it and the mod", () => {
        expect(importsOf("mod a { mod b { use super::x; mod c; } }\n#[path = \"other/x.rs\"]\n// why\nmod y;\nextern crate foo as bar;\n"))
            .toEqual(["use:a::b|super::x", "mod:a::b|c", "mod:|y@other/x.rs", "extern:foo"]);
    });

    it("reads no comment inside a use group as a leaf", () => {
        expect(importsOf("use crate::{\n    a, // why a\n    /* and b */ b,\n};\n")).toEqual(["use:|crate::a", "use:|crate::b"]);
    });

    it("gives no specifier for a malformed use", () => {
        expect(importsOf("use crate::a::{b, ;\nuse crate::c;\n")).not.toContain("use:|crate::a::b");
    });

    it("reads a CRLF text and a byte-order mark as the LF text", () => {
        const lf = read("crates/core/src/model.rs").replace(/\r\n/g, "\n");
        const a = parseRust("m.rs", lf, "full");
        expect(parseRust("m.rs", lf.replace(/\n/g, "\r\n"), "full")).toMatchObject({ imports: a.imports, declares: a.declares, symbols: a.symbols });
        expect(parseRust("m.rs", `${String.fromCharCode(0xfeff)}${lf}`, "full")).toEqual(a);
    });
});

describe("Rust's items", () => {
    it("names impl chunks by base names and gives their fns the self type's base name as parent", () => {
        const parsed = parseRust("x.rs", "impl<T> a::Foo<T> { pub fn new() {} }\nimpl Tr for &mut b::Bar { fn x() {} }\n", "full");
        expect(parsed.chunks.map((c) => c.name)).toEqual(["impl Foo", "impl Tr for Bar", "(file)"]);
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.exported])).toEqual([["Foo.new", true], ["Bar.x", false]]);
    });

    it("keeps attributes in a symbol's lines across a comment, and a chunk's doc comment above its attributes", () => {
        const parsed = parseRust("x.rs", "/// doc\n#[derive(Debug)]\n// note\n#[repr(C)]\npub struct S;\n", "full");
        expect(parsed.symbols[0]).toMatchObject({ name: "S", startLine: 2, endLine: 5 });
        // the plain comment (line 3) isn't attached, so the chunk stops at the attribute under it
        expect(parsed.chunks[0]).toMatchObject({ name: "S", startLine: 4, endLine: 5 });
    });

    it("lists the file's use, mod and extern crate lines in the summary, and its pub items as exports", () => {
        const summary = parseRust("x.rs", "use a::b;\nmod c;\nextern crate d;\npub fn e() {}\nfn f() {}\npub struct G;\n", "full").chunks.at(-1)!;
        expect(summary.text).toBe("File: x.rs\n\nImports:\nuse a::b;\nmod c;\nextern crate d;\n\nExports:\ne (function)\nG (class)");
    });
});

describe("Rust's use-tree text (the scan's reader)", () => {
    it("reads what the tree reads", () => {
        expect(leavesOfUseText("crate::a::{self, inner::*, Thing as Widget}")).toEqual(["crate::a", "crate::a::inner::*", "crate::a::Thing as Widget"]);
        expect(leavesOfUseText("::std :: fmt")).toEqual(["::std::fmt"]);
        expect(leavesOfUseText("{a, b::{c, d}}")).toEqual(["a", "b::c", "b::d"]);
        expect(leavesOfUseText("a::{self as b, *}")).toEqual(["a as b", "a::*"]);
        expect(leavesOfUseText("store::{/* the rename */ Db, e}")).toEqual(["store::Db", "store::e"]);
    });

    it("refuses what isn't a use tree", () => {
        expect(leavesOfUseText("a::{b, ")).toBeNull();
        expect(leavesOfUseText("a::")).toBeNull();
        expect(leavesOfUseText("a b")).toBeNull();
    });
});
