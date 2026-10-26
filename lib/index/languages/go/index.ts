import type { LanguageAdapter } from "../adapter";
import { parseGo } from "./parse";
import { createGoResolver } from "./resolve";
import { goRules } from "./rules";

/** The Go adapter (Task G of the E4 plan, ADR-065): tree-sitter-go's parse (parse.ts), name-based resolution (resolve.ts). */
export const goAdapter: LanguageAdapter = {
    ...goRules,
    version: 2,
    grammar: "tree-sitter-go.wasm",
    parse: parseGo,
    createResolver: createGoResolver,
};
