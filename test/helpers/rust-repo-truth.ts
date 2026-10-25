import type { SymbolKind, SymbolRow } from "../../lib/db/schema";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";

/**
 * test/fixtures/rust-repo's ground truth, DERIVED BY HAND from the fixture's files and Task R's rules (the E4 plan,
 * docs/plans/2026-10-24-e4-languages.md) before any Rust adapter code existed: never by running the code (CLAUDE.md).
 * Change a fixture file and re-derive this by hand.
 *
 * The rules used, in short:
 * - Specifiers: `mod:<inline>|<name>` (`@<path>` for #[path]), `use:<inline>|<path>` per use-tree leaf (groups expanded,
 *   `self` → its prefix, a glob → `<prefix>::*`, a rename → `<path> as <name>`), `extern:<name>`, and
 *   `path:<inline>|<a::b>` for each outermost path of two or more segments in code whose first segment isn't std, core or
 *   alloc. Macro arguments and macro_rules bodies are token trees, not code, so they hold no path (the fixture keeps its
 *   paths out of them). Each once, in source order. Declares: the file's `mod:` specifiers, sorted.
 * - Crates: crates/core (shop-core, library shop_core: src/lib.rs), crates/store (shop-store, library shop_store: its
 *   [lib] path src/store.rs) and crates/cli (shop-cli: src/main.rs, src/bin/report.rs, and [[bin]] shop-admin at
 *   tools/admin.rs; no library). The root Cargo.toml is a workspace with no [package], so no crate, and
 *   target/package/shop-core-0.1.0/Cargo.toml sits in an excluded folder, so it's ignored. shop-cli renames shop-store
 *   `store`. Roots: lib, src/main.rs, bins, build.rs, tests/*.rs, examples/*.rs, benches/*.rs.
 * - The module tree: a root's or mod.rs's children sit in its own folder, any other x.rs's in x/; an inline module adds
 *   its name as a folder; `mod y;` is y.rs, else y/mod.rs; #[path] is relative to the declaring file's folder.
 * - A path from module m: crate:: is m's crate root, self:: m, super:: m's parent; a leading name is a child module of m,
 *   else a name the same file's use (same inline level) binds, substituted, else a repo crate the importer's crate can
 *   name (below), else external. The rest walks down modules; the target is the deepest module's file, [importer] when
 *   that's the importer's own file.
 * - The crates a crate can name (Cargo's extern prelude): its dependencies of every kind, by library name or by their
 *   rename, plus, from a target that isn't the library (a bin, test, example, bench), its own package's library. The plan
 *   said every repo crate's library name; rust-analyzer's index contradicted it (91 wrong edges, progress-rust.md), so
 *   shop-core's util.rs naming shop_store (no dependency) is external here.
 * - Kinds: mod: and extern: of a nameable crate are internal; use: and path: are internal when their start is crate,
 *   self, super, a child module, a binding to an internal path or a nameable repo crate, else external. A glob binds
 *   no name.
 *
 * Calls this truth pins where the plan's text leaves room (each in progress-rust.md):
 * - a symbol's lines start at its first attached #[…] (doc comments left out); a chunk's start at its first attached
 *   #[…] or outer doc comment (`///`); a plain `//` comment and an inner `//!` doc don't attach;
 * - exported (ADR-065's one rule, the final review's B-I2): a top-level item whose own visibility is exactly `pub`; a
 *   member only when its owner is exported too. A struct's or union's field needs its own `pub` and the type's; a trait's
 *   fns have no visibility of their own, so they take the trait's. An impl's fns sit outside their type's body, maybe in
 *   another file, so an owner this file doesn't declare doesn't gate them: an inherent impl's fn needs its own `pub` and
 *   the self type's (when declared here); a trait impl's fn has none of its own, so it's exported unless the self type or
 *   the trait is declared here without `pub` (`impl Display for Order`: Order is pub, Display is std's);
 * - an impl chunk is named with base names: `impl Display for Order` for `impl fmt::Display for Order`;
 * - an orphan's `crate::` start is internal (the plan lists crate as an internal start) and resolves to nothing;
 * - the scan reading sees no inline module and no #[path] (it has no tree): `mod:|deep`, `use:|super::*`.
 */

const fileSymbol = (name: string, kind: SymbolKind, startLine: number, endLine: number, exported: boolean): SymbolRow => ({
    name, qualifiedName: name, kind, startLine, endLine, exported, parentQualifiedName: null,
});
const member = (parent: string, name: string, kind: SymbolKind, startLine: number, endLine: number, exported: boolean): SymbolRow => ({
    name, qualifiedName: `${parent}.${name}`, kind, startLine, endLine, exported, parentQualifiedName: parent,
});
const edge = (source: string, target: string): TruthEdge => ({ source, target });
/** A file's text as the edits write it: each line ended by "\n". */
const text = (...lines: string[]): string => lines.map((line) => `${line}\n`).join("");

const CLI = "crates/cli/";
const CORE = "crates/core/";
const STORE = "crates/store/";

/** The 33 edges of a full run, sorted by source then target, each with the rule that makes it. */
const EDGES: TruthEdge[] = [
    // path:|shop_core::model::Order::new: shop_core is a repo crate's library name, so its lib root, then the module model
    edge(`${CLI}src/bin/report.rs`, `${CORE}src/model.rs`),
    // use:|shop_core::Order: the crate root; Order (lib.rs's `pub use`) is no module, so the root's file
    edge(`${CLI}src/commands.rs`, `${CORE}src/lib.rs`),
    // use:|store::Db: `store` is shop-cli's rename of shop-store, whose library root is its [lib] path, src/store.rs
    edge(`${CLI}src/commands.rs`, `${STORE}src/store.rs`),
    // mod:|commands: main.rs is a root, so its children sit in its own folder (path:|commands::run: a child module, too)
    edge(`${CLI}src/main.rs`, `${CLI}src/commands.rs`),
    // extern:shop_core: crate shop_core's library root
    edge(`${CLI}src/main.rs`, `${CORE}src/lib.rs`),
    // use:|shop_core::model::Order (path:|Order::new reaches it through that binding)
    edge(`${CLI}src/main.rs`, `${CORE}src/model.rs`),
    // use:|store::Db, the rename (path:|Db::default reaches it through that binding)
    edge(`${CLI}src/main.rs`, `${STORE}src/store.rs`),
    // use:|store::Db: a [[bin]] of shop-cli sees shop-cli's renames (path:|Db::default too)
    edge(`${CLI}tools/admin.rs`, `${STORE}src/store.rs`),
    // use:|shop_core::model::Order: a bench root sees its own package's library by name (path:|Order::new too)
    edge(`${CORE}benches/bench_orders.rs`, `${CORE}src/model.rs`),
    // use:|shop_core::Order: the re-export, so lib.rs (path:|Order::new through the binding: lib.rs too)
    edge(`${CORE}examples/demo.rs`, `${CORE}src/lib.rs`),
    // mod:|inner: a.rs is neither a root nor a mod.rs, so its children sit in a/ (use:|self::inner::Y: the same file)
    edge(`${CORE}src/a.rs`, `${CORE}src/a/inner.rs`),
    // mod:|tests, behind #[cfg(test)]
    edge(`${CORE}src/a.rs`, `${CORE}src/a/tests.rs`),
    // use:|super::Thing: the super of crate::a::inner is crate::a
    edge(`${CORE}src/a/inner.rs`, `${CORE}src/a.rs`),
    // use:|super::*: a glob is its module's file, crate::a
    edge(`${CORE}src/a/tests.rs`, `${CORE}src/a.rs`),
    // use:|crate::a::Thing
    edge(`${CORE}src/b/mod.rs`, `${CORE}src/a.rs`),
    // path:|crate::util::helper, a path in code with no use
    edge(`${CORE}src/b/mod.rs`, `${CORE}src/util.rs`),
    // use:|crate::model::Order, above the syntax error
    edge(`${CORE}src/broken.rs`, `${CORE}src/model.rs`),
    // path:|crate::util::helper, below the syntax error
    edge(`${CORE}src/broken.rs`, `${CORE}src/util.rs`),
    // use:|super::model::Kind: custom.rs is crate::renamed, whose super is the crate root (path:|Kind::Small through the binding)
    edge(`${CORE}src/custom.rs`, `${CORE}src/model.rs`),
    // mod:|a: a.rs beside the root
    edge(`${CORE}src/lib.rs`, `${CORE}src/a.rs`),
    // mod:|b: no b.rs, so b/mod.rs
    edge(`${CORE}src/lib.rs`, `${CORE}src/b/mod.rs`),
    // mod:|broken
    edge(`${CORE}src/lib.rs`, `${CORE}src/broken.rs`),
    // mod:|renamed@custom.rs: the #[path] is relative to lib.rs's folder
    edge(`${CORE}src/lib.rs`, `${CORE}src/custom.rs`),
    // mod:|model (use:|model::Order too: model is a child module of the root)
    edge(`${CORE}src/lib.rs`, `${CORE}src/model.rs`),
    // mod:nested|deep: the inline module nested adds its name as a folder
    edge(`${CORE}src/lib.rs`, `${CORE}src/nested/deep.rs`),
    // mod:|util
    edge(`${CORE}src/lib.rs`, `${CORE}src/util.rs`),
    // use:|crate::a (the group's self), use:|crate::a::Thing as Widget, and path:|a::Thing::new through the binding a
    edge(`${CORE}src/model.rs`, `${CORE}src/a.rs`),
    // use:|crate::a::inner::*: a glob is its module's file
    edge(`${CORE}src/model.rs`, `${CORE}src/a/inner.rs`),
    // use:|crate::b (path:|b::Basket through the binding b)
    edge(`${CORE}src/model.rs`, `${CORE}src/b/mod.rs`),
    // use:|super::super::util::helper: super is the inline module crate::nested (lib.rs), its super the crate root
    edge(`${CORE}src/nested/deep.rs`, `${CORE}src/util.rs`),
    // use:|shop_core::model::Kind: a test root sees its package's library by name (Order, both paths: the same file)
    edge(`${CORE}tests/integration.rs`, `${CORE}src/model.rs`),
    // use:|shop_core::model::Order: another crate reaching shop-core by its library name
    edge(`${STORE}src/db.rs`, `${CORE}src/model.rs`),
    // mod:|db: store.rs is a root ([lib] path), so its children sit in its own folder src/, not src/store/ (use:|db::Db too)
    edge(`${STORE}src/store.rs`, `${STORE}src/db.rs`),
    // not edges: lib.rs's mod:|missing (no missing.rs or missing/mod.rs: an internal miss); model.rs's use:tests|super::*
    // (the inline tests module's super is model.rs itself: placed, [importer]); test_data/orphan.rs's
    // use:|crate::model::Order (an orphan has no crate root: an internal miss); every external reference; and the files
    // under target/, which are left out
];

const without = (...dropped: TruthEdge[]): TruthEdge[] =>
    EDGES.filter((e) => !dropped.some((d) => d.source === e.source && d.target === e.target));

export const rustRepoTruth: FixtureTruth = {
    files: [
        { path: `${CLI}src/bin/report.rs`, language: "rust", isTest: false, lineCount: 4 },
        { path: `${CLI}src/commands.rs`, language: "rust", isTest: false, lineCount: 9 },
        { path: `${CLI}src/main.rs`, language: "rust", isTest: false, lineCount: 12 },
        { path: `${CLI}tools/admin.rs`, language: "rust", isTest: false, lineCount: 7 },
        { path: `${CORE}benches/bench_orders.rs`, language: "rust", isTest: false, lineCount: 6 },
        { path: `${CORE}build.rs`, language: "rust", isTest: false, lineCount: 4 },
        { path: `${CORE}examples/demo.rs`, language: "rust", isTest: false, lineCount: 6 },
        { path: `${CORE}src/a.rs`, language: "rust", isTest: false, lineCount: 23 },
        { path: `${CORE}src/a/inner.rs`, language: "rust", isTest: false, lineCount: 8 },
        { path: `${CORE}src/a/tests.rs`, language: "rust", isTest: true, lineCount: 7 },         // basename tests.rs
        { path: `${CORE}src/b/mod.rs`, language: "rust", isTest: false, lineCount: 10 },
        { path: `${CORE}src/broken.rs`, language: "rust", isTest: false, lineCount: 11 },
        { path: `${CORE}src/custom.rs`, language: "rust", isTest: false, lineCount: 4 },
        { path: `${CORE}src/lib.rs`, language: "rust", isTest: false, lineCount: 17 },
        { path: `${CORE}src/model.rs`, language: "rust", isTest: false, lineCount: 86 },
        { path: `${CORE}src/nested/deep.rs`, language: "rust", isTest: false, lineCount: 5 },
        { path: `${CORE}src/util.rs`, language: "rust", isTest: false, lineCount: 12 },
        { path: `${CORE}test_data/orphan.rs`, language: "rust", isTest: false, lineCount: 6 },   // test_data/ isn't a test folder
        { path: `${CORE}tests/integration.rs`, language: "rust", isTest: true, lineCount: 8 },   // the tests/ folder rule
        { path: `${STORE}src/db.rs`, language: "rust", isTest: false, lineCount: 13 },
        { path: `${STORE}src/store.rs`, language: "rust", isTest: false, lineCount: 4 },
    ],
    // target/ beside the workspace's Cargo.toml, and beside crates/store/Cargo.toml (no folder named build, out or dist on
    // the way, so it's the Rust exclusion that leaves them out, not the walk). target/package/shop-core-0.1.0/Cargo.toml,
    // cargo package's copy, names shop-core a second time: a manifest in an excluded folder, which resolution ignores
    // (the plan's common rules), so it changes nothing below
    excluded: [`${STORE}target/release/stale.rs`, "target/debug/generated.rs", "target/package/shop-core-0.1.0/src/lib.rs"],
    specifiers: {
        [`${CLI}src/bin/report.rs`]: ["path:|shop_core::model::Order::new"],
        // a // comment inside the group (lines 1-4) is no leaf; tools/admin.rs has a /* */ one inside a one-line group
        [`${CLI}src/commands.rs`]: ["use:|shop_core::Order", "use:|store::Db"],
        [`${CLI}src/main.rs`]: [
            "extern:shop_core", "mod:|commands", "use:|shop_core::model::Order", "use:|store::Db",
            "path:|Db::default", "path:|commands::run", "path:|Order::new",
        ],
        [`${CLI}tools/admin.rs`]: ["use:|store::Db", "path:|Db::default"],
        [`${CORE}benches/bench_orders.rs`]: ["use:|shop_core::model::Order", "path:|Order::new"],
        [`${CORE}build.rs`]: [],   // println! is one segment, and its arguments are a token tree
        [`${CORE}examples/demo.rs`]: ["use:|shop_core::Order", "path:|Order::new"],
        [`${CORE}src/a.rs`]: ["mod:|inner", "mod:|tests", "use:|self::inner::Y", "path:|String::new"],
        [`${CORE}src/a/inner.rs`]: ["use:|super::Thing"],
        [`${CORE}src/a/tests.rs`]: ["use:|super::*", "path:|Thing::new"],
        [`${CORE}src/b/mod.rs`]: ["use:|crate::a::Thing", "path:|crate::util::helper"],
        [`${CORE}src/broken.rs`]: ["use:|crate::model::Order", "path:|crate::util::helper"],
        [`${CORE}src/custom.rs`]: ["use:|super::model::Kind", "path:|Kind::Small"],
        [`${CORE}src/lib.rs`]: [
            "mod:|a", "mod:|b", "mod:|broken", "mod:|model", "mod:|util", "mod:|renamed@custom.rs", "mod:nested|deep",
            "mod:|missing", "use:|model::Order",
        ],
        [`${CORE}src/model.rs`]: [
            "use:|std::fmt",
            "use:|crate::a", "use:|crate::a::inner::*", "use:|crate::a::Thing as Widget",   // line 4's group, in order
            "use:|crate::b",
            "path:|Kind::Small",             // line 24
            "path:|a::Thing::new",           // line 28
            "path:|fmt::Display",            // line 32
            "path:|fmt::Formatter", "path:|fmt::Result",   // line 33 (fmt::Formatter<'_>: the path without its arguments)
            "path:|serde::Serialize",        // line 47, a bound
            "path:|b::Basket",               // line 53
            // the macro_rules body ($crate::model::Order::new) is a token tree: nothing
            "use:tests|super::*",            // line 79, inside the inline module tests
            "path:tests|Order::new",         // line 83 (assert_eq!'s arguments hold no path)
        ],
        [`${CORE}src/nested/deep.rs`]: ["use:|super::super::util::helper"],
        // std::collections::HashMap::new starts with std: no path:; shop_store::Db::default (line 11) does
        [`${CORE}src/util.rs`]: ["use:|std::collections::HashMap", "path:|shop_store::Db::default"],
        [`${CORE}test_data/orphan.rs`]: ["use:|crate::model::Order"],
        [`${CORE}tests/integration.rs`]: [
            "use:|shop_core::model::Kind", "use:|shop_core::model::Order", "path:|Order::new", "path:|Kind::Small",
        ],
        [`${STORE}src/db.rs`]: ["use:|shop_core::model::Order"],
        [`${STORE}src/store.rs`]: ["mod:|db", "use:|db::Db"],
    },
    declares: {
        [`${CLI}src/bin/report.rs`]: [],
        [`${CLI}src/commands.rs`]: [],
        [`${CLI}src/main.rs`]: ["mod:|commands"],
        [`${CLI}tools/admin.rs`]: [],
        [`${CORE}benches/bench_orders.rs`]: [],
        [`${CORE}build.rs`]: [],
        [`${CORE}examples/demo.rs`]: [],
        [`${CORE}src/a.rs`]: ["mod:|inner", "mod:|tests"],
        [`${CORE}src/a/inner.rs`]: [],
        [`${CORE}src/a/tests.rs`]: [],
        [`${CORE}src/b/mod.rs`]: [],
        [`${CORE}src/broken.rs`]: [],
        [`${CORE}src/custom.rs`]: [],
        // code-unit order: "n" (0x6E) sorts before "|" (0x7C), so the inline module's line comes first
        [`${CORE}src/lib.rs`]: [
            "mod:nested|deep", "mod:|a", "mod:|b", "mod:|broken", "mod:|missing", "mod:|model", "mod:|renamed@custom.rs", "mod:|util",
        ],
        [`${CORE}src/model.rs`]: [],   // mod tests { … } is inline: no mod: specifier
        [`${CORE}src/nested/deep.rs`]: [],
        [`${CORE}src/util.rs`]: [],
        [`${CORE}test_data/orphan.rs`]: [],
        [`${CORE}tests/integration.rs`]: [],
        [`${STORE}src/db.rs`]: [],
        [`${STORE}src/store.rs`]: ["mod:|db"],
    },
    symbols: {
        [`${CLI}src/bin/report.rs`]: [fileSymbol("main", "function", 1, 4, false)],
        [`${CLI}src/commands.rs`]: [fileSymbol("run", "function", 7, 9, true)],
        [`${CLI}src/main.rs`]: [fileSymbol("main", "function", 9, 12, false)],
        [`${CLI}tools/admin.rs`]: [fileSymbol("main", "function", 4, 7, false)],
        [`${CORE}benches/bench_orders.rs`]: [fileSymbol("main", "function", 3, 6, false)],
        [`${CORE}build.rs`]: [fileSymbol("main", "function", 2, 4, false)],
        [`${CORE}examples/demo.rs`]: [fileSymbol("main", "function", 3, 6, false)],
        [`${CORE}src/a.rs`]: [
            fileSymbol("Thing", "struct", 9, 13, true),          // from its #[derive] (line 9); the doc comment (8) left out
            member("Thing", "id", "property", 11, 11, true),
            member("Thing", "label", "property", 12, 12, false),
            member("Thing", "new", "method", 16, 18, true),
            member("Thing", "marker", "method", 20, 22, true),
        ],
        [`${CORE}src/a/inner.rs`]: [
            fileSymbol("Y", "struct", 4, 4, true),
            fileSymbol("label_of", "function", 6, 8, true),
        ],
        [`${CORE}src/a/tests.rs`]: [fileSymbol("new_thing_has_its_id", "function", 3, 7, false)],   // from #[test]
        [`${CORE}src/b/mod.rs`]: [
            fileSymbol("Basket", "struct", 4, 6, true),
            member("Basket", "items", "property", 5, 5, true),
            fileSymbol("basket_total", "function", 8, 10, true),
        ],
        [`${CORE}src/broken.rs`]: [
            fileSymbol("double", "function", 4, 7, true),   // the error sits inside its body; its braces still close it
            fileSymbol("after", "function", 9, 11, true),
        ],
        [`${CORE}src/custom.rs`]: [fileSymbol("DEFAULT_KIND", "const", 4, 4, true)],
        [`${CORE}src/lib.rs`]: [fileSymbol("nested", "namespace", 11, 13, false)],   // mod x; lines are no symbols
        [`${CORE}src/model.rs`]: [
            fileSymbol("Kind", "enum", 8, 12, true),
            fileSymbol("Order", "struct", 15, 20, true),
            member("Order", "quantity", "property", 17, 17, true),
            member("Order", "kind", "property", 18, 18, true),
            member("Order", "note", "property", 19, 19, false),
            member("Order", "new", "method", 23, 25, true),
            member("Order", "widget", "method", 27, 29, false),
            // impl fmt::Display for Order: the self type's base name; Order is pub and Display isn't declared here
            member("Order", "fmt", "method", 33, 35, true),
            fileSymbol("Priced", "trait", 39, 45, true),            // the plain comment (38) is no attribute
            member("Priced", "price", "method", 40, 40, true),      // a signature; a trait fn takes the trait's pub
            member("Priced", "discounted", "method", 42, 44, true),
            // impl<T: …> Priced for Vec<T>: base name Vec, declared elsewhere; Priced, declared here, is pub
            member("Vec", "price", "method", 48, 50, true),
            fileSymbol("Basket", "type", 53, 53, true),
            fileSymbol("MAX_ITEMS", "const", 55, 55, true),
            fileSymbol("GREETING", "const", 57, 57, false),         // static → const
            fileSymbol("order", "function", 60, 65, false),         // macro_rules! from #[macro_export]; no visibility
            fileSymbol("Bits", "struct", 67, 71, true),             // a union → struct
            member("Bits", "whole", "property", 69, 69, true),
            member("Bits", "halves", "property", 70, 70, false),
            fileSymbol("hidden_helper", "function", 73, 75, false), // pub(crate) isn't exactly pub
            fileSymbol("tests", "namespace", 77, 86, false),        // an inline mod; its contents are no symbols
        ],
        [`${CORE}src/nested/deep.rs`]: [fileSymbol("deep_value", "function", 3, 5, true)],
        [`${CORE}src/util.rs`]: [
            fileSymbol("helper", "function", 4, 7, true),
            fileSymbol("unrelated", "function", 10, 12, true),   // its doc comment (9) left out
        ],
        [`${CORE}test_data/orphan.rs`]: [fileSymbol("sample", "function", 4, 6, false)],
        [`${CORE}tests/integration.rs`]: [fileSymbol("orders_start_small", "function", 3, 8, false)],
        [`${STORE}src/db.rs`]: [
            fileSymbol("Db", "struct", 4, 7, true),
            member("Db", "orders", "property", 6, 6, true),
            member("Db", "save", "method", 10, 12, true),
        ],
        [`${STORE}src/store.rs`]: [],
    },
    kinds: {
        [`${CLI}src/bin/report.rs`]: { "path:|shop_core::model::Order::new": "internal" },
        [`${CLI}src/commands.rs`]: { "use:|shop_core::Order": "internal", "use:|store::Db": "internal" },
        [`${CLI}src/main.rs`]: {
            "extern:shop_core": "internal", "mod:|commands": "internal", "use:|shop_core::model::Order": "internal",
            "use:|store::Db": "internal", "path:|Db::default": "internal", "path:|commands::run": "internal",
            "path:|Order::new": "internal",
        },
        [`${CLI}tools/admin.rs`]: { "use:|store::Db": "internal", "path:|Db::default": "internal" },
        [`${CORE}benches/bench_orders.rs`]: { "use:|shop_core::model::Order": "internal", "path:|Order::new": "internal" },
        [`${CORE}build.rs`]: {},
        [`${CORE}examples/demo.rs`]: { "use:|shop_core::Order": "internal", "path:|Order::new": "internal" },
        [`${CORE}src/a.rs`]: {
            "mod:|inner": "internal", "mod:|tests": "internal", "use:|self::inner::Y": "internal",
            "path:|String::new": "external",   // String: no child module, no binding, no crate
        },
        [`${CORE}src/a/inner.rs`]: { "use:|super::Thing": "internal" },
        [`${CORE}src/a/tests.rs`]: { "use:|super::*": "internal", "path:|Thing::new": "external" },   // a glob binds no name
        [`${CORE}src/b/mod.rs`]: { "use:|crate::a::Thing": "internal", "path:|crate::util::helper": "internal" },
        [`${CORE}src/broken.rs`]: { "use:|crate::model::Order": "internal", "path:|crate::util::helper": "internal" },
        [`${CORE}src/custom.rs`]: { "use:|super::model::Kind": "internal", "path:|Kind::Small": "internal" },   // Kind is bound
        [`${CORE}src/lib.rs`]: {
            "mod:|a": "internal", "mod:|b": "internal", "mod:|broken": "internal", "mod:|model": "internal", "mod:|util": "internal",
            "mod:|renamed@custom.rs": "internal", "mod:nested|deep": "internal", "mod:|missing": "internal", "use:|model::Order": "internal",
        },
        [`${CORE}src/model.rs`]: {
            "use:|std::fmt": "external",
            "use:|crate::a": "internal",
            "use:|crate::a::inner::*": "internal",
            "use:|crate::a::Thing as Widget": "internal",
            "use:|crate::b": "internal",
            "path:|Kind::Small": "external",          // Kind is declared here, not bound by a use
            "path:|a::Thing::new": "internal",        // a is bound to crate::a
            "path:|fmt::Display": "external",         // fmt is bound to std::fmt, an external path
            "path:|fmt::Formatter": "external",
            "path:|fmt::Result": "external",
            "path:|serde::Serialize": "external",     // serde is no repo crate
            "path:|b::Basket": "internal",            // b is bound to crate::b
            "use:tests|super::*": "internal",
            "path:tests|Order::new": "external",      // inside tests only the glob, which binds nothing
        },
        [`${CORE}src/nested/deep.rs`]: { "use:|super::super::util::helper": "internal" },
        [`${CORE}src/util.rs`]: {
            "use:|std::collections::HashMap": "external",
            "path:|shop_store::Db::default": "external",   // a repo crate, but no dependency of shop-core: out of its reach
        },
        [`${CORE}test_data/orphan.rs`]: { "use:|crate::model::Order": "internal" },
        [`${CORE}tests/integration.rs`]: {
            "use:|shop_core::model::Kind": "internal", "use:|shop_core::model::Order": "internal",
            "path:|Order::new": "internal", "path:|Kind::Small": "internal",
        },
        [`${STORE}src/db.rs`]: { "use:|shop_core::model::Order": "internal" },
        [`${STORE}src/store.rs`]: { "mod:|db": "internal", "use:|db::Db": "internal" },
    },
    edges: EDGES,
    // each Cargo target's root file, declared by its Cargo.toml; auto-discovered bins named by their file
    entryPoints: [
        { path: `${CLI}src/bin/report.rs`, declaredBy: `${CLI}Cargo.toml [[bin]] report` },
        { path: `${CLI}src/main.rs`, declaredBy: `${CLI}Cargo.toml src/main.rs` },
        { path: `${CLI}tools/admin.rs`, declaredBy: `${CLI}Cargo.toml [[bin]] shop-admin` },
        { path: `${CORE}benches/bench_orders.rs`, declaredBy: `${CORE}Cargo.toml benches` },
        { path: `${CORE}build.rs`, declaredBy: `${CORE}Cargo.toml build` },
        { path: `${CORE}examples/demo.rs`, declaredBy: `${CORE}Cargo.toml examples` },
        { path: `${CORE}src/lib.rs`, declaredBy: `${CORE}Cargo.toml [lib]` },
        { path: `${CORE}tests/integration.rs`, declaredBy: `${CORE}Cargo.toml tests` },
        { path: `${STORE}src/store.rs`, declaredBy: `${STORE}Cargo.toml [lib]` },
    ],
    broken: { path: `${CORE}src/broken.rs`, specifiers: ["use:|crate::model::Order", "path:|crate::util::helper"] },
    // the scan reading reads `mod x;`, single-line `use …;` and `extern crate x;` lines with no tree: no path: specifiers,
    // no inline-module part and no #[path]. The files listed are those whose full reading has one of those.
    scan: {
        [`${CLI}src/bin/report.rs`]: [],
        [`${CLI}src/commands.rs`]: ["use:|store::Db"],   // its first use spans four lines: not a single-line use
        [`${CLI}src/main.rs`]: ["extern:shop_core", "mod:|commands", "use:|shop_core::model::Order", "use:|store::Db"],
        [`${CLI}tools/admin.rs`]: ["use:|store::Db"],
        [`${CORE}benches/bench_orders.rs`]: ["use:|shop_core::model::Order"],
        [`${CORE}examples/demo.rs`]: ["use:|shop_core::Order"],
        [`${CORE}src/a.rs`]: ["mod:|inner", "mod:|tests", "use:|self::inner::Y"],
        [`${CORE}src/a/tests.rs`]: ["use:|super::*"],
        [`${CORE}src/b/mod.rs`]: ["use:|crate::a::Thing"],
        [`${CORE}src/broken.rs`]: ["use:|crate::model::Order"],
        [`${CORE}src/custom.rs`]: ["use:|super::model::Kind"],
        [`${CORE}src/util.rs`]: ["use:|std::collections::HashMap"],
        [`${CORE}src/lib.rs`]: [
            "mod:|a", "mod:|b", "mod:|broken", "mod:|model", "mod:|util", "mod:|renamed", "mod:|deep", "mod:|missing", "use:|model::Order",
        ],
        [`${CORE}src/model.rs`]: [
            "use:|std::fmt", "use:|crate::a", "use:|crate::a::inner::*", "use:|crate::a::Thing as Widget", "use:|crate::b", "use:|super::*",
        ],
        [`${CORE}tests/integration.rs`]: ["use:|shop_core::model::Kind", "use:|shop_core::model::Order"],
    },
    chunks: {
        [`${CORE}build.rs`]: [
            { kind: "function", name: "main", startLine: 2, endLine: 4 },   // the inner //! doc above it doesn't attach
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 4 },
        ],
        [`${CORE}src/a.rs`]: [
            { kind: "class", name: "Thing", startLine: 8, endLine: 13 },    // its /// doc and #[derive] attached
            { kind: "class", name: "impl Thing", startLine: 15, endLine: 23 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 23 },
        ],
        [`${CORE}src/a/tests.rs`]: [
            { kind: "function", name: "new_thing_has_its_id", startLine: 3, endLine: 7 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 7 },
        ],
        [`${CORE}src/broken.rs`]: [
            { kind: "function", name: "double", startLine: 4, endLine: 7 },
            { kind: "function", name: "after", startLine: 9, endLine: 11 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 11 },
        ],
        [`${CORE}src/lib.rs`]: [
            { kind: "namespace", name: "nested", startLine: 11, endLine: 13 },   // mod x;, use and #[path] lines are no chunks
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 17 },
        ],
        [`${CORE}src/model.rs`]: [
            { kind: "enum", name: "Kind", startLine: 7, endLine: 12 },
            { kind: "class", name: "Order", startLine: 14, endLine: 20 },
            { kind: "class", name: "impl Order", startLine: 22, endLine: 30 },
            { kind: "class", name: "impl Display for Order", startLine: 32, endLine: 36 },
            { kind: "interface", name: "Priced", startLine: 39, endLine: 45 },   // the plain // comment on 38 doesn't attach
            { kind: "class", name: "impl Priced for Vec", startLine: 47, endLine: 51 },
            { kind: "type", name: "Basket", startLine: 53, endLine: 53 },
            { kind: "const", name: "MAX_ITEMS", startLine: 55, endLine: 55 },
            { kind: "const", name: "GREETING", startLine: 57, endLine: 57 },
            { kind: "function", name: "order", startLine: 59, endLine: 65 },
            { kind: "class", name: "Bits", startLine: 67, endLine: 71 },
            { kind: "function", name: "hidden_helper", startLine: 73, endLine: 75 },
            { kind: "namespace", name: "tests", startLine: 77, endLine: 86 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 86 },
        ],
        [`${STORE}src/db.rs`]: [
            { kind: "class", name: "Db", startLine: 3, endLine: 7 },
            { kind: "class", name: "impl Db", startLine: 9, endLine: 13 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 13 },
        ],
    },
    edits: [
        {
            // util.rs is then reached from no root (an orphan, with only external references). The unchanged files whose paths
            // walked crate → util now stop at the crate root, since util names no module: lib.rs, not util.rs.
            description: "lib.rs drops `mod util;` (its declares change): b/mod.rs, broken.rs and nested/deep.rs, unchanged, now reach lib.rs instead of util.rs",
            writes: {
                [`${CORE}src/lib.rs`]: text(
                    "//! shop-core: orders, baskets and the helpers around them.",
                    "mod a;",
                    "mod b;",
                    "mod broken;",
                    "pub mod model;",
                    "",
                    "#[path = \"custom.rs\"]",
                    "mod renamed;",
                    "",
                    "mod nested {",
                    "    mod deep;",
                    "}",
                    "",
                    "mod missing;",
                    "",
                    "pub use model::Order;",
                ),
            },
            edgesAfter: [
                edge(`${CLI}src/bin/report.rs`, `${CORE}src/model.rs`),
                edge(`${CLI}src/commands.rs`, `${CORE}src/lib.rs`),
                edge(`${CLI}src/commands.rs`, `${STORE}src/store.rs`),
                edge(`${CLI}src/main.rs`, `${CLI}src/commands.rs`),
                edge(`${CLI}src/main.rs`, `${CORE}src/lib.rs`),
                edge(`${CLI}src/main.rs`, `${CORE}src/model.rs`),
                edge(`${CLI}src/main.rs`, `${STORE}src/store.rs`),
                edge(`${CLI}tools/admin.rs`, `${STORE}src/store.rs`),
                edge(`${CORE}benches/bench_orders.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}examples/demo.rs`, `${CORE}src/lib.rs`),
                edge(`${CORE}src/a.rs`, `${CORE}src/a/inner.rs`),
                edge(`${CORE}src/a.rs`, `${CORE}src/a/tests.rs`),
                edge(`${CORE}src/a/inner.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/a/tests.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/b/mod.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/b/mod.rs`, `${CORE}src/lib.rs`),        // path:|crate::util::helper stops at the crate root
                edge(`${CORE}src/broken.rs`, `${CORE}src/lib.rs`),       // path:|crate::util::helper, the same
                edge(`${CORE}src/broken.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}src/custom.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/b/mod.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/broken.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/custom.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/nested/deep.rs`),
                edge(`${CORE}src/model.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/model.rs`, `${CORE}src/a/inner.rs`),
                edge(`${CORE}src/model.rs`, `${CORE}src/b/mod.rs`),
                edge(`${CORE}src/nested/deep.rs`, `${CORE}src/lib.rs`),  // super::super is the crate root; util names no module
                edge(`${CORE}tests/integration.rs`, `${CORE}src/model.rs`),
                edge(`${STORE}src/db.rs`, `${CORE}src/model.rs`),
                edge(`${STORE}src/store.rs`, `${STORE}src/db.rs`),
            ],
        },
        {
            // the library name becomes shop_kernel: nothing names shop_core any more, so every reference starting with it
            // (and every binding to one) is external. The entry points keep their Cargo.toml paths.
            description: "crates/core/Cargo.toml renames the package shop-kernel (a manifest changes): every edge through the name shop_core goes",
            writes: {
                [`${CORE}Cargo.toml`]: text(
                    "[package]",
                    "name = \"shop-kernel\"",
                    "version = \"0.1.0\"",
                    "edition = \"2021\"",
                    "",
                    "[dependencies]",
                    "serde = { version = \"1\", features = [\"derive\"] }",
                ),
            },
            edgesAfter: without(
                edge(`${CLI}src/bin/report.rs`, `${CORE}src/model.rs`),
                edge(`${CLI}src/commands.rs`, `${CORE}src/lib.rs`),
                edge(`${CLI}src/main.rs`, `${CORE}src/lib.rs`),
                edge(`${CLI}src/main.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}benches/bench_orders.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}examples/demo.rs`, `${CORE}src/lib.rs`),
                edge(`${CORE}tests/integration.rs`, `${CORE}src/model.rs`),
                edge(`${STORE}src/db.rs`, `${CORE}src/model.rs`),
            ),
        },
        {
            // b/mod.rs is a mod.rs, so its child sits in its own folder: b/extra.rs. extra.rs's super is crate::b.
            description: "a new file b/extra.rs with its `mod extra;` line in b/mod.rs (the file set and b/mod.rs's declares change): an edge each way",
            writes: {
                [`${CORE}src/b/mod.rs`]: text(
                    "//! Baskets of things.",
                    "mod extra;",
                    "use crate::a::Thing;",
                    "",
                    "pub struct Basket {",
                    "    pub items: Vec<Thing>,",
                    "}",
                    "",
                    "pub fn basket_total(basket: &Basket) -> u32 {",
                    "    basket.items.len() as u32 + crate::util::helper()",
                    "}",
                ),
                [`${CORE}src/b/extra.rs`]: text(
                    "use super::Basket;",
                    "",
                    "pub fn is_empty(basket: &Basket) -> bool {",
                    "    basket.items.is_empty()",
                    "}",
                ),
            },
            edgesAfter: [
                edge(`${CLI}src/bin/report.rs`, `${CORE}src/model.rs`),
                edge(`${CLI}src/commands.rs`, `${CORE}src/lib.rs`),
                edge(`${CLI}src/commands.rs`, `${STORE}src/store.rs`),
                edge(`${CLI}src/main.rs`, `${CLI}src/commands.rs`),
                edge(`${CLI}src/main.rs`, `${CORE}src/lib.rs`),
                edge(`${CLI}src/main.rs`, `${CORE}src/model.rs`),
                edge(`${CLI}src/main.rs`, `${STORE}src/store.rs`),
                edge(`${CLI}tools/admin.rs`, `${STORE}src/store.rs`),
                edge(`${CORE}benches/bench_orders.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}examples/demo.rs`, `${CORE}src/lib.rs`),
                edge(`${CORE}src/a.rs`, `${CORE}src/a/inner.rs`),
                edge(`${CORE}src/a.rs`, `${CORE}src/a/tests.rs`),
                edge(`${CORE}src/a/inner.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/a/tests.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/b/extra.rs`, `${CORE}src/b/mod.rs`),    // use:|super::Basket
                edge(`${CORE}src/b/mod.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/b/mod.rs`, `${CORE}src/b/extra.rs`),    // mod:|extra
                edge(`${CORE}src/b/mod.rs`, `${CORE}src/util.rs`),
                edge(`${CORE}src/broken.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}src/broken.rs`, `${CORE}src/util.rs`),
                edge(`${CORE}src/custom.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/b/mod.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/broken.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/custom.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/model.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/nested/deep.rs`),
                edge(`${CORE}src/lib.rs`, `${CORE}src/util.rs`),
                edge(`${CORE}src/model.rs`, `${CORE}src/a.rs`),
                edge(`${CORE}src/model.rs`, `${CORE}src/a/inner.rs`),
                edge(`${CORE}src/model.rs`, `${CORE}src/b/mod.rs`),
                edge(`${CORE}src/nested/deep.rs`, `${CORE}src/util.rs`),
                edge(`${CORE}tests/integration.rs`, `${CORE}src/model.rs`),
                edge(`${STORE}src/db.rs`, `${CORE}src/model.rs`),
                edge(`${STORE}src/store.rs`, `${STORE}src/db.rs`),
            ],
        },
    ],
};
