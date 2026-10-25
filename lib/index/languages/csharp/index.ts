import type { LanguageAdapter } from "../adapter";
import { csharpRules } from "./rules";

/** A stub (Task F of the E4 plan): its grammar loads, but it claims no file until this language's task builds it. */
export const csharpAdapter: LanguageAdapter = {
    ...csharpRules,
    version: 0,
    grammar: "tree-sitter-c_sharp.wasm",
    parse(){
        throw new Error("csharp adapter not built yet");
    },
    createResolver(){
        throw new Error("csharp adapter not built yet");
    },
};
