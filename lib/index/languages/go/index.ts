import type { LanguageAdapter } from "../adapter";
import { goRules } from "./rules";

/** A stub (Task F of the E4 plan): its grammar loads, but it claims no file until this language's task builds it. */
export const goAdapter: LanguageAdapter = {
    ...goRules,
    version: 0,
    grammar: "tree-sitter-go.wasm",
    parse(){
        throw new Error("go adapter not built yet");
    },
    createResolver(){
        throw new Error("go adapter not built yet");
    },
};
