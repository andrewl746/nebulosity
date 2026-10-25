import type { LanguageAdapter } from "../adapter";
import { pythonRules } from "./rules";

/** A stub (Task F of the E4 plan): its grammar loads, but it claims no file until this language's task builds it. */
export const pythonAdapter: LanguageAdapter = {
    ...pythonRules,
    version: 0,
    grammar: "tree-sitter-python.wasm",
    parse(){
        throw new Error("python adapter not built yet");
    },
    createResolver(){
        throw new Error("python adapter not built yet");
    },
};
