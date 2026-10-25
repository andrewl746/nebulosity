import type { LanguageAdapter } from "../adapter";
import { javaRules } from "./rules";

/** A stub (Task F of the E4 plan): its grammar loads, but it claims no file until this language's task builds it. */
export const javaAdapter: LanguageAdapter = {
    ...javaRules,
    version: 0,
    grammar: "tree-sitter-java.wasm",
    parse(){
        throw new Error("java adapter not built yet");
    },
    createResolver(){
        throw new Error("java adapter not built yet");
    },
};
