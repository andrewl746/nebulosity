import type { LanguageAdapter } from "../adapter";
import { rustRules } from "./rules";

/** A stub (Task F of the E4 plan): its grammar loads, but it claims no file until this language's task builds it. */
export const rustAdapter: LanguageAdapter = {
    ...rustRules,
    version: 0,
    grammar: "tree-sitter-rust.wasm",
    parse(){
        throw new Error("rust adapter not built yet");
    },
    createResolver(){
        throw new Error("rust adapter not built yet");
    },
};
