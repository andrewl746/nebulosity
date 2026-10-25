import type { LanguageAdapter } from "../adapter";
import { parseRust } from "./parse";
import { rustRules } from "./rules";

/** Rust behind the seam (ADR-065, the E4 plan's Task R): tree-sitter-rust 0.24.0 for the parse. */
export const rustAdapter: LanguageAdapter = {
    ...rustRules,
    version: 1,
    grammar: "tree-sitter-rust.wasm",
    parse: parseRust,
    createResolver(){
        throw new Error("rust resolver not built yet");
    },
};
