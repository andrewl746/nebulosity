import { dirOf } from "../../paths";
import type { LanguageRules } from "../adapter";

/**
 * Rust's pure rules (ADR-065, the E4 plan's Task R): no parser here, so discovery, the watcher and the engine can read them.
 * - a test file is `tests.rs`, `*_test.rs` or `*_tests.rs` (a `tests/` folder is the shared folder rule's);
 * - every Cargo.toml is a manifest (the crates, their targets and their dependency renames are read from it);
 * - Cargo's build output, `target/` beside any Cargo.toml, is left out: it holds generated and packaged copies of the
 *   crates' own sources, which would otherwise be indexed twice.
 */

/** A Cargo.toml anywhere: what Rust's resolution reads its crates from. */
export const CARGO_MANIFEST = /(^|\/)Cargo\.toml$/;

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
};
