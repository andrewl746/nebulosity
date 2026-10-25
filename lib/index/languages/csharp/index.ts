import type { LanguageAdapter } from "../adapter";
import { parseCsharp } from "./parse";
import { csharpRules } from "./rules";

/** C#'s adapter (the E4 plan's Task C): parse.ts reads a file; the resolver comes in the next step. */
export const csharpAdapter: LanguageAdapter = {
    ...csharpRules,
    version: 1,
    grammar: "tree-sitter-c_sharp.wasm",
    parse: parseCsharp,
    createResolver(){
        throw new Error("csharp resolver not built yet");
    },
};
