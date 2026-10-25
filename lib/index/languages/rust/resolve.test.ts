import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { rustRepoTruth as truth } from "../../../../test/helpers/rust-repo-truth";
import type { LanguageResolver, StoredFacts } from "../adapter";
import { edgesOf } from "../resolution";
import { createRustResolver } from "./resolve";

const FIXTURE = path.resolve("test", "fixtures", "rust-repo");
const CORE = "crates/core/";

/** Every Cargo.toml in a folder, repo-relative and sorted (as discovery lists the manifests). */
function manifestsIn(root: string, at = ""): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(path.join(root, at), { withFileTypes: true })){
        const rel = at === "" ? entry.name : `${at}/${entry.name}`;
        if (entry.isDirectory()) found.push(...manifestsIn(root, rel));
        else if (entry.name === "Cargo.toml") found.push(rel);
    }
    return found.sort();
}

/**
 * The resolver over the truth's own facts (its specifiers and declares), so these tests hold the resolver to the
 * hand-derived edges, kinds and entry points whatever the parse does.
 */
function fixtureResolver(): LanguageResolver {
    const files = new Map<string, StoredFacts>(truth.files.map((f) => [f.path, { importSpecifiers: truth.specifiers[f.path], declares: truth.declares[f.path] }]));
    return createRustResolver({
        root: FIXTURE, fileSet: new Set(files.keys()), files, manifests: manifestsIn(FIXTURE),
        readText: (rel) => fs.readFileSync(path.join(FIXTURE, rel), "utf8"), cache: new Map(),
    });
}

/** A resolver over a made-up repo: its files' facts and its manifests' text. */
function resolverFor(files: Record<string, { specifiers?: string[]; declares?: string[] }>, manifests: Record<string, string>): LanguageResolver {
    const facts = new Map<string, StoredFacts>(Object.entries(files).map(([p, f]) => [p, { importSpecifiers: f.specifiers ?? [], declares: f.declares ?? [] }]));
    return createRustResolver({
        root: "/repo", fileSet: new Set(facts.keys()), files: facts, manifests: Object.keys(manifests).sort(),
        readText: (rel) => manifests[rel] ?? null, cache: new Map(),
    });
}

describe("Rust's resolution, on the rust-repo fixture's truth", () => {
    const resolver = fixtureResolver();

    it("gives every edge of the truth, and no other", () => {
        const edges = truth.files.flatMap((f) => edgesOf(resolver, f.path, truth.specifiers[f.path]).map((e) => ({ source: e.source, target: e.target })));
        edges.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
        expect(edges).toEqual(truth.edges);
    });

    it("names every specifier's kind as the truth does", () => {
        for (const f of truth.files){
            for (const [specifier, kind] of Object.entries(truth.kinds[f.path])) expect(resolver.kindOf(f.path, specifier), `${f.path} ${specifier}`).toBe(kind);
        }
    });

    it("lists the entry points: each Cargo target's root, by its manifest", () => {
        expect(resolver.entryPoints()).toEqual(truth.entryPoints);
    });

    it("mod: a sibling file, else a mod.rs folder; a missing one names nothing", () => {
        expect(resolver.resolve(`${CORE}src/lib.rs`, "mod:|a")).toEqual([`${CORE}src/a.rs`]);
        expect(resolver.resolve(`${CORE}src/lib.rs`, "mod:|b")).toEqual([`${CORE}src/b/mod.rs`]);
        expect(resolver.resolve(`${CORE}src/lib.rs`, "mod:|missing")).toEqual([]);
        expect(resolver.kindOf(`${CORE}src/lib.rs`, "mod:|missing")).toBe("internal");
    });

    it("mod: a non-root x.rs's children sit in x/, a [lib] path root's in its own folder", () => {
        expect(resolver.resolve(`${CORE}src/a.rs`, "mod:|inner")).toEqual([`${CORE}src/a/inner.rs`]);
        expect(resolver.resolve("crates/store/src/store.rs", "mod:|db")).toEqual(["crates/store/src/db.rs"]);
    });

    it("mod: #[path] is relative to the declaring file's folder, and an inline module adds its folder", () => {
        expect(resolver.resolve(`${CORE}src/lib.rs`, "mod:|renamed@custom.rs")).toEqual([`${CORE}src/custom.rs`]);
        expect(resolver.resolve(`${CORE}src/lib.rs`, "mod:nested|deep")).toEqual([`${CORE}src/nested/deep.rs`]);
    });

    it("crate:: starts at the crate root; a path in code with no use walks down the same way", () => {
        expect(resolver.resolve(`${CORE}src/b/mod.rs`, "use:|crate::a::Thing")).toEqual([`${CORE}src/a.rs`]);
        expect(resolver.resolve(`${CORE}src/b/mod.rs`, "path:|crate::util::helper")).toEqual([`${CORE}src/util.rs`]);
        expect(resolver.resolve(`${CORE}src/model.rs`, "use:|crate::b")).toEqual([`${CORE}src/b/mod.rs`]);
    });

    it("self:: starts at the file's own module, super:: at its parent, counting inline modules and #[path] files", () => {
        expect(resolver.resolve(`${CORE}src/a.rs`, "use:|self::inner::Y")).toEqual([`${CORE}src/a/inner.rs`]);
        expect(resolver.resolve(`${CORE}src/a/inner.rs`, "use:|super::Thing")).toEqual([`${CORE}src/a.rs`]);
        expect(resolver.resolve(`${CORE}src/nested/deep.rs`, "use:|super::super::util::helper")).toEqual([`${CORE}src/util.rs`]);
        expect(resolver.resolve(`${CORE}src/custom.rs`, "use:|super::model::Kind")).toEqual([`${CORE}src/model.rs`]);
    });

    it("a glob is its module's file; inside an inline mod tests, super::* is the importer itself (placed, no edge)", () => {
        expect(resolver.resolve(`${CORE}src/model.rs`, "use:|crate::a::inner::*")).toEqual([`${CORE}src/a/inner.rs`]);
        expect(resolver.resolve(`${CORE}src/a/tests.rs`, "use:|super::*")).toEqual([`${CORE}src/a.rs`]);
        expect(resolver.resolve(`${CORE}src/model.rs`, "use:tests|super::*")).toEqual([`${CORE}src/model.rs`]);
    });

    it("a leading name: a child module, else a use binding substituted (renames too), else external", () => {
        expect(resolver.resolve("crates/cli/src/main.rs", "path:|commands::run")).toEqual(["crates/cli/src/commands.rs"]);
        expect(resolver.resolve(`${CORE}src/model.rs`, "path:|a::Thing::new")).toEqual([`${CORE}src/a.rs`]);
        expect(resolver.resolve(`${CORE}src/custom.rs`, "path:|Kind::Small")).toEqual([`${CORE}src/model.rs`]);
        expect(resolver.kindOf(`${CORE}src/model.rs`, "path:|Kind::Small")).toBe("external");    // declared here, bound by no use
        expect(resolver.kindOf(`${CORE}src/model.rs`, "path:|fmt::Display")).toBe("external");   // bound to std::fmt
        expect(resolver.kindOf(`${CORE}src/a/tests.rs`, "path:|Thing::new")).toBe("external");   // a glob binds no name
    });

    it("a crate by its library name, by a rename of the importer's crate, and a pub use reached at the crate root", () => {
        expect(resolver.resolve("crates/store/src/db.rs", "use:|shop_core::model::Order")).toEqual([`${CORE}src/model.rs`]);
        expect(resolver.resolve("crates/cli/tools/admin.rs", "use:|store::Db")).toEqual(["crates/store/src/store.rs"]);
        expect(resolver.resolve("crates/cli/src/commands.rs", "use:|shop_core::Order")).toEqual([`${CORE}src/lib.rs`]);
        expect(resolver.resolve("crates/cli/src/main.rs", "extern:shop_core")).toEqual([`${CORE}src/lib.rs`]);
        expect(resolver.kindOf(`${CORE}src/model.rs`, "path:|serde::Serialize")).toBe("external");
    });

    it("an orphan's references are their own class, and its crate:: names nothing", () => {
        expect(resolver.classOf?.(`${CORE}test_data/orphan.rs`, "use:|crate::model::Order")).toBe("orphan");
        expect(resolver.resolve(`${CORE}test_data/orphan.rs`, "use:|crate::model::Order")).toEqual([]);
        expect(resolver.kindOf(`${CORE}test_data/orphan.rs`, "use:|crate::model::Order")).toBe("internal");
    });

    it("classes: mod, relative (crate, self, super), other", () => {
        expect(resolver.classOf?.(`${CORE}src/lib.rs`, "mod:|a")).toBe("mod");
        expect(resolver.classOf?.(`${CORE}src/a.rs`, "use:|self::inner::Y")).toBe("relative");
        expect(resolver.classOf?.(`${CORE}src/b/mod.rs`, "path:|crate::util::helper")).toBe("relative");
        expect(resolver.classOf?.(`${CORE}src/model.rs`, "use:tests|super::*")).toBe("relative");
        expect(resolver.classOf?.("crates/cli/src/main.rs", "use:|store::Db")).toBe("other");
        expect(resolver.classOf?.("crates/cli/src/main.rs", "extern:shop_core")).toBe("other");
    });

    it("ignores the Cargo.toml cargo package left under target/: shop_core still names crates/core alone", () => {
        expect(resolver.resolve("crates/cli/src/bin/report.rs", "path:|shop_core::model::Order::new")).toEqual([`${CORE}src/model.rs`]);
    });
});

describe("Rust's resolution, beyond the fixture", () => {
    const pkg = (name: string, extra = ""): string => `[package]\nname = "${name}"\nversion = "0.1.0"\n${extra}`;

    it("of two crates with one library name, picks the importer's dependency, and names none when neither is", () => {
        const resolver = resolverFor({
            "a/src/lib.rs": {}, "b/src/lib.rs": {}, "app/src/main.rs": {}, "other/src/main.rs": {},
        }, {
            "a/Cargo.toml": pkg("dup"), "b/Cargo.toml": pkg("dup-two", "[lib]\nname = \"dup\"\n"),
            "app/Cargo.toml": pkg("app", "[dependencies]\ndup-two = { path = \"../b\" }\n"), "other/Cargo.toml": pkg("other"),
        });
        expect(resolver.resolve("app/src/main.rs", "use:|dup::X")).toEqual(["b/src/lib.rs"]);
        expect(resolver.resolve("other/src/main.rs", "use:|dup::X")).toEqual([]);
    });

    it("inherits a workspace dependency's rename through `workspace = true`", () => {
        const resolver = resolverFor({ "crates/b/src/lib.rs": {}, "crates/app/src/main.rs": {} }, {
            "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]\n[workspace.dependencies]\nshort = { package = \"long-name\", path = \"crates/b\" }\n",
            "crates/b/Cargo.toml": pkg("long-name"),
            "crates/app/Cargo.toml": pkg("app", "[dependencies]\nshort = { workspace = true }\n"),
        });
        expect(resolver.resolve("crates/app/src/main.rs", "use:|short::X")).toEqual(["crates/b/src/lib.rs"]);
        expect(resolver.resolve("crates/app/src/main.rs", "use:|long_name::X")).toEqual(["crates/b/src/lib.rs"]);
    });

    it("finds a [[bin]] with no path where Cargo infers it, honours autobins = false, and reads [lib] name", () => {
        const resolver = resolverFor({ "src/bin/tool/main.rs": {}, "src/bin/extra.rs": {}, "src/main.rs": {}, "src/lib.rs": {} }, {
            "Cargo.toml": pkg("thing", "autobins = false\n[lib]\nname = \"thing_lib\"\n[[bin]]\nname = \"tool\"\n"),
        });
        expect(resolver.entryPoints()).toEqual([
            { path: "src/bin/tool/main.rs", declaredBy: "Cargo.toml [[bin]] tool" },
            { path: "src/lib.rs", declaredBy: "Cargo.toml [lib]" },
        ]);
        expect(resolver.resolve("src/bin/tool/main.rs", "use:|thing_lib::X")).toEqual(["src/lib.rs"]);
        expect(resolver.kindOf("src/bin/tool/main.rs", "use:|thing::X")).toBe("external");
    });

    it("a bin-only crate's name names nothing, and a leading :: names a crate", () => {
        const resolver = resolverFor({ "app/src/main.rs": {}, "lib/src/lib.rs": {} }, { "app/Cargo.toml": pkg("app"), "lib/Cargo.toml": pkg("lib-a") });
        expect(resolver.kindOf("lib/src/lib.rs", "use:|app::X")).toBe("external");
        expect(resolver.resolve("app/src/main.rs", "use:|::lib_a::X")).toEqual(["lib/src/lib.rs"]);
    });

    it("a #[path] inside an inline module of a non-mod.rs file is relative to that module's folder", () => {
        const resolver = resolverFor({ "src/lib.rs": { declares: ["mod:|x"] }, "src/x.rs": { declares: ["mod:inner|y@z.rs"] }, "src/x/inner/z.rs": {} }, { "Cargo.toml": pkg("p") });
        expect(resolver.resolve("src/x.rs", "mod:inner|y@z.rs")).toEqual(["src/x/inner/z.rs"]);
    });

    it("follows a chain of use bindings, and a #[path] file's children sit in its own folder", () => {
        const resolver = resolverFor({
            "src/lib.rs": { declares: ["mod:|a", "mod:|p@gen/p.rs"] },
            "src/a.rs": { declares: ["mod:|b"] }, "src/a/b.rs": {},
            "src/gen/p.rs": { declares: ["mod:|q"] }, "src/gen/q.rs": {},
            "src/main.rs": { specifiers: ["use:|p::a", "use:|a::b", "path:|b::f"] },
        }, { "Cargo.toml": pkg("p") });
        expect(resolver.resolve("src/main.rs", "path:|b::f")).toEqual(["src/a/b.rs"]);   // b → a::b → p::a::b → crate p, a, b
        expect(resolver.resolve("src/gen/p.rs", "mod:|q")).toEqual(["src/gen/q.rs"]);
    });
});
