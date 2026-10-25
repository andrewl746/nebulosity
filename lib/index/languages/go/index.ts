import type { LanguageAdapter } from "../adapter";
import { parseGo } from "./parse";
import { goRules } from "./rules";

/** The Go adapter (Task G of the E4 plan, ADR-065): tree-sitter-go's parse (parse.ts), name-based resolution. */
export const goAdapter: LanguageAdapter = {
    ...goRules,
    version: 1,
    grammar: "tree-sitter-go.wasm",
    parse: parseGo,
    createResolver(){
        throw new Error("go resolver not built yet");
    },
};
