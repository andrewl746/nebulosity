import type { LanguageAdapter } from "../adapter";
import { parsePythonFile } from "./parse";
import { createPythonResolver } from "./resolve";
import { pythonRules } from "./rules";

/**
 * Python behind the seam (ADR-065, the E4 plan's Task P): tree-sitter-python for the parse, its own import rules.
 * Version 2 (the pre-ship pass's Task P, ruling R13): a standard-library name resolves only through the importer's own
 * roots, so a repo with a root module named like one (`tests/logging.py`) gets different edges and kinds.
 */
export const pythonAdapter: LanguageAdapter = {
    ...pythonRules,
    version: 2,
    grammar: "tree-sitter-python.wasm",
    parse: parsePythonFile,
    createResolver: createPythonResolver,
};
