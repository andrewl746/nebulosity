import type { LanguageAdapter } from "../adapter";
import { parseJava } from "./parse";
import { javaRules } from "./rules";

/** Java's adapter (ADR-065, the E4 plan's Task J): its rules, its parse (parse.ts) and its resolver. */
export const javaAdapter: LanguageAdapter = {
    ...javaRules,
    version: 1,
    grammar: "tree-sitter-java.wasm",
    parse: parseJava,
    createResolver(){
        throw new Error("java resolver not built yet");
    },
};
