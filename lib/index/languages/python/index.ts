import type { LanguageAdapter } from "../adapter";
import { parsePythonFile } from "./parse";
import { pythonRules } from "./rules";

/** Python behind the seam (ADR-065, the E4 plan's Task P): tree-sitter-python for the parse, its own import rules. */
export const pythonAdapter: LanguageAdapter = {
    ...pythonRules,
    version: 1,
    grammar: "tree-sitter-python.wasm",
    parse: parsePythonFile,
    createResolver(){
        throw new Error("python adapter's resolver not built yet");
    },
};
