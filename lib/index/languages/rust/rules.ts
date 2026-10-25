import { dirOf } from "../../paths";
import type { LanguageRules } from "../adapter";
import { parseSpecifier } from "./syntax";

/**
 * Rust's pure rules (ADR-065, the E4 plan's Task R): no parser here, so discovery, the watcher and the engine can read them.
 * - a test file is `tests.rs`, `*_test.rs` or `*_tests.rs` (a `tests/` folder is the shared folder rule's);
 * - every Cargo.toml is a manifest (the crates, their targets and their dependency renames are read from it);
 * - Cargo's build output, `target/` beside any Cargo.toml, is left out: it holds generated and packaged copies of the
 *   crates' own sources, which would otherwise be indexed twice.
 */

/** A Cargo.toml anywhere: what Rust's resolution reads its crates from. */
export const CARGO_MANIFEST = /(^|\/)Cargo\.toml$/;

/**
 * A specifier as the source writes it, for answers (B-I3): `use:|a::B as C` is `use a::B as C`, `mod:|x@y.rs` is
 * `#[path = "y.rs"] mod x`, `extern:a` is `extern crate a`, and `path:|crate::a::f` is the code's `crate::a::f`. The
 * inline module a reference sits in (`use:tests|super::*`) isn't written in it, so it's left out.
 */
export function displayRustSpecifier(specifier: string): string {
    const parsed = parseSpecifier(specifier);
    if (parsed === null) return specifier;
    switch (parsed.form){
        case "extern":
            return `extern crate ${parsed.name}`;
        case "mod":
            return parsed.path === null ? `mod ${parsed.name}` : `#[path = "${parsed.path}"] mod ${parsed.name}`;
        case "use":
            return `use ${parsed.path}${parsed.alias === null ? "" : ` as ${parsed.alias}`}`;
        case "path":
            return parsed.path;
    }
}

export const rustRules: LanguageRules = {
    id: "rust",
    extensions: [".rs"],
    languageOf: () => "rust",
    isTest: (path) => /(^|\/)(tests|[^/]*_tests?)\.rs$/.test(path),
    manifest: CARGO_MANIFEST,
    excluded(manifests){
        const targets = manifests.filter((m) => CARGO_MANIFEST.test(m)).map((m) => (dirOf(m) === "" ? "target/" : `${dirOf(m)}/target/`));
        return (path) => targets.some((prefix) => path.startsWith(prefix));
    },
    displaySpecifier: displayRustSpecifier,
};
