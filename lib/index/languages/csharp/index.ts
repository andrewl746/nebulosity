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
    // 3: generic names carry their arity (the pre-ship pass, Task C), so every C# file's specifiers and declares are read again
    version: 3,
    grammar: "tree-sitter-c_sharp.wasm",
    parse: parseCsharp,
    createResolver: createCsharpResolver,
};
