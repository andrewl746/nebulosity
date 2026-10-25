import { describe, expect, it } from "vitest";
import { isTestPath } from "../../discover";
import { exclusionFor, isManifestPath, rulesFor } from "../rules";
import { rustRules } from "./rules";

describe("Rust's rules", () => {
    it("claims .rs files, as the rust language", () => {
        expect(rustRules.extensions).toEqual([".rs"]);
        expect(rulesFor("crates/core/src/lib.rs")?.id).toBe("rust");
        expect(rustRules.languageOf("crates/core/src/lib.rs")).toBe("rust");
        expect(rulesFor("crates/core/src/lib.rs.bak")).toBeNull();
    });

    it("a file named tests.rs is a test, and one only ending in tests.rs isn't", () => {
        expect(rustRules.isTest("crates/core/src/a/tests.rs")).toBe(true);
        expect(rustRules.isTest("tests.rs")).toBe(true);
        expect(rustRules.isTest("crates/core/src/contests.rs")).toBe(false);
        expect(rustRules.isTest("crates/core/src/tests.rs/mod.rs")).toBe(false);
    });

    it("a *_test.rs file is a test, and a test_*.rs or *_testing.rs one isn't", () => {
        expect(rustRules.isTest("crates/core/src/parser_test.rs")).toBe(true);
        expect(rustRules.isTest("crates/core/src/test_parser.rs")).toBe(false);
        expect(rustRules.isTest("crates/core/src/parser_testing.rs")).toBe(false);
    });

    it("a *_tests.rs file is a test, and one whose name merely contains _tests isn't", () => {
        expect(rustRules.isTest("crates/core/src/parser_tests.rs")).toBe(true);
        expect(rustRules.isTest("crates/core/src/parser_tests_util.rs")).toBe(false);
    });

    it("a file under tests/ is a test by the shared folder rule, and one under benches/ or test_data/ isn't", () => {
        expect(isTestPath("crates/core/tests/integration.rs")).toBe(true);
        expect(isTestPath("crates/core/benches/bench_orders.rs")).toBe(false);
        expect(isTestPath("crates/parser/test_data/parser/ok/0001_use.rs")).toBe(false);
    });

    it("counts a Cargo.toml anywhere as a manifest, and no other toml", () => {
        expect(rustRules.manifest.test("Cargo.toml")).toBe(true);
        expect(rustRules.manifest.test("crates/core/Cargo.toml")).toBe(true);
        expect(rustRules.manifest.test("crates/core/Cargo.lock")).toBe(false);
        expect(rustRules.manifest.test("crates/core/MyCargo.toml")).toBe(false);
        expect(rustRules.manifest.test("crates/core/cargo.toml")).toBe(false);
        expect(rustRules.manifest.test("rustfmt.toml")).toBe(false);
        expect(isManifestPath("crates/core/Cargo.toml")).toBe(true);
    });

    it("leaves out target/ beside each Cargo.toml on the manifest list, the workspace root's included", () => {
        const excluded = rustRules.excluded(["Cargo.toml", "crates/core/Cargo.toml", "crates/core/README.md"]);
        expect(excluded("target/debug/generated.rs")).toBe(true);
        expect(excluded("crates/core/target/release/stale.rs")).toBe(true);
        expect(excluded("crates/core/src/target/mod.rs")).toBe(false);      // a module named target, not beside a Cargo.toml
        expect(excluded("crates/store/target/release/stale.rs")).toBe(false); // no Cargo.toml in crates/store on this list
        expect(excluded("crates/core/src/lib.rs")).toBe(false);
        expect(excluded("targets/x.rs")).toBe(false);
    });

    it("leaves nothing out without a Cargo.toml", () => {
        expect(rustRules.excluded([])("target/debug/generated.rs")).toBe(false);
        expect(rustRules.excluded(["package.json"])("target/debug/generated.rs")).toBe(false);
    });

    it("leaves out only Rust's own files: a TypeScript file under target/ stays", () => {
        const excluded = exclusionFor(["Cargo.toml"]);
        expect(excluded("target/debug/generated.rs")).toBe(true);
        expect(excluded("target/doc/search.js")).toBe(false);
    });
});

describe("Rust's specifiers as written (displaySpecifier, B-I3)", () => {
    it("shows a use, mod or extern crate as its statement, and a path as the code writes it", () => {
        const shown = (s: string) => rustRules.displaySpecifier!(s);
        expect(shown("use:|shop_core::model::Order")).toBe("use shop_core::model::Order");
        expect(shown("use:|crate::a::Thing as Widget")).toBe("use crate::a::Thing as Widget");
        expect(shown("use:tests|super::*")).toBe("use super::*");    // the inline module isn't written in it
        expect(shown("mod:|commands")).toBe("mod commands");
        expect(shown("mod:nested|deep")).toBe("mod deep");
        expect(shown("mod:|renamed@custom.rs")).toBe('#[path = "custom.rs"] mod renamed');
        expect(shown("extern:shop_core")).toBe("extern crate shop_core");
        expect(shown("path:|crate::util::helper")).toBe("crate::util::helper");
        expect(shown("./not/rust")).toBe("./not/rust");
    });
});
