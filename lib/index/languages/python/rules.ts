import type { LanguageRules } from "../adapter";
import { dirOf } from "../../paths";

// Python's pure rules (ADR-065, the E4 plan's Task P): no parser loaded here, so discovery, the watcher and the engine
// can read them.

/** Python's own test files, by basename: test_x.py, x_test.py, tests.py (Django's per-app file), conftest.py (pytest's). */
const TEST_FILE = /^(test_.*\.pyi?|.*_test\.pyi?|tests\.py|conftest\.py)$/;

/**
 * Python's manifests: the three project files that name roots, scripts and entry points, and pyvenv.cfg, which marks a
 * virtual environment (the files under its folder are someone else's installed code, never the repo's).
 */
export const PYTHON_MANIFEST = /(^|\/)(pyproject\.toml|setup\.cfg|setup\.py|pyvenv\.cfg)$/;

/** The manifests that describe a project (its folder is a root; pyproject also names roots and scripts). */
export const PROJECT_MANIFEST = /(^|\/)(pyproject\.toml|setup\.cfg|setup\.py)$/;

/** The folders holding a pyvenv.cfg, each with a trailing "/" ("" when the repo root is itself a virtual environment). */
export function virtualEnvironments(manifests: readonly string[]): string[] {
    return manifests.filter((m) => /(^|\/)pyvenv\.cfg$/.test(m)).map((m) => (dirOf(m) === "" ? "" : `${dirOf(m)}/`));
}

/** Whether a repo-relative path lies under one of these virtual-environment folders. */
export function inVirtualEnvironment(path: string, venvs: readonly string[]): boolean {
    return venvs.some((prefix) => path.startsWith(prefix));
}

/**
 * A specifier as the source writes it, for answers (B-I3): `a.b` is `import a.b`, `a.b:c` is `from a.b import c`, and
 * `..m:*` is `from ..m import *`. The specifier keeps no alias, so `import a.b as c` reads `import a.b`, and a dynamic
 * `import_module("a.b")` reads as the import it performs.
 */
export function displayPythonSpecifier(specifier: string): string {
    if (specifier === "") return specifier;
    const colon = specifier.indexOf(":");
    return colon === -1 ? `import ${specifier}` : `from ${specifier.slice(0, colon)} import ${specifier.slice(colon + 1)}`;
}

export const pythonRules: LanguageRules = {
    id: "python",
    extensions: [".py", ".pyi"],
    languageOf: () => "python",
    isTest: (path) => TEST_FILE.test(path.slice(path.lastIndexOf("/") + 1)),
    manifest: PYTHON_MANIFEST,
    excluded(manifests){
        const venvs = virtualEnvironments(manifests);
        return (path) => inVirtualEnvironment(path, venvs);
    },
    displaySpecifier: displayPythonSpecifier,
};
