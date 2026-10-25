import type { LanguageAdapter } from "../adapter";
import { parseCsharp } from "./parse";
import { createCsharpResolver } from "./resolve";
import { csharpRules } from "./rules";

/**
 * C#'s adapter (the E4 plan's Task C, ADR-065): parse.ts reads a file (specifiers, declares, symbols, chunks; a line
 * scan for the scan reading), resolve.ts turns the specifiers into files by C#'s own name lookup.
 */
export const csharpAdapter: LanguageAdapter = {
    ...csharpRules,
    version: 2,
    grammar: "tree-sitter-c_sharp.wasm",
    parse: parseCsharp,
    createResolver: createCsharpResolver,
};
