import type { LanguageAdapter } from "../adapter";
import { parseJava } from "./parse";
import { createJavaResolver } from "./resolve";
import { javaRules } from "./rules";

/** Java's adapter (ADR-065, the E4 plan's Task J): its rules (rules.ts), its parse (parse.ts) and its resolver (resolve.ts). */
export const javaAdapter: LanguageAdapter = {
    ...javaRules,
    version: 1,
    grammar: "tree-sitter-java.wasm",
    parse: parseJava,
    createResolver: createJavaResolver,
};
