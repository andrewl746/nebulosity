import { describe, expect, it } from "vitest";
import { isTestPath } from "../../discover";
import { exclusionFor, isManifestPath, rulesFor } from "../rules";
import { inVirtualEnvironment, pythonRules, virtualEnvironments } from "./rules";

// Python's pure rules, from the E4 plan's Task P table.

describe("python rules", () => {
    it("claims .py and .pyi as python", () => {
        expect(rulesFor("src/shop/models.py")?.id).toBe("python");
        expect(rulesFor("src/shop/models.pyi")?.id).toBe("python");
        expect(pythonRules.languageOf("a.pyi")).toBe("python");
        expect(rulesFor("notes.pyc")).toBeNull();
        expect(rulesFor("app.pyw")).toBeNull();
    });

    it("test_*.py and test_*.pyi are tests; a name merely starting test is not", () => {
        expect(pythonRules.isTest("pkg/test_models.py")).toBe(true);
        expect(pythonRules.isTest("pkg/test_models.pyi")).toBe(true);
        expect(pythonRules.isTest("pkg/testing.py")).toBe(false);
        expect(pythonRules.isTest("pkg/test.py")).toBe(false);
    });

    it("*_test.py and *_test.pyi are tests; a name merely ending test is not", () => {
        expect(pythonRules.isTest("pkg/models_test.py")).toBe(true);
        expect(pythonRules.isTest("models_test.pyi")).toBe(true);
        expect(pythonRules.isTest("pkg/latest.py")).toBe(false);
        expect(pythonRules.isTest("pkg/models_tests.py")).toBe(false);
    });

    it("tests.py is a test; tests.pyi and mytests.py are not", () => {
        expect(pythonRules.isTest("polls/tests.py")).toBe(true);
        expect(pythonRules.isTest("polls/tests.pyi")).toBe(false);
        expect(pythonRules.isTest("polls/mytests.py")).toBe(false);
    });

    it("conftest.py is a test; conftest.pyi and a conftest folder's file are not", () => {
        expect(pythonRules.isTest("conftest.py")).toBe(true);
        expect(pythonRules.isTest("src/conftest.py")).toBe(true);
        expect(pythonRules.isTest("conftest.pyi")).toBe(false);
        expect(pythonRules.isTest("conftest/plugin.py")).toBe(false);
    });

    it("reads only the basename: a test-looking folder name doesn't make a test", () => {
        expect(pythonRules.isTest("test_data/loader.py")).toBe(false);
        expect(pythonRules.isTest("conftest.py/real.py")).toBe(false);
    });

    it("joins the shared folder rule through isTestPath", () => {
        expect(isTestPath("tests/runtests.py")).toBe(true);
        expect(isTestPath("toolkit/text_test.py")).toBe(true);
        expect(isTestPath("toolkit/text.py")).toBe(false);
    });

    it("counts pyproject.toml, setup.cfg, setup.py and pyvenv.cfg as manifests, anywhere", () => {
        for (const path of ["pyproject.toml", "services/beta/pyproject.toml", "setup.cfg", "pkg/setup.py", ".venv/pyvenv.cfg"]){
            expect(pythonRules.manifest.test(path), path).toBe(true);
            expect(isManifestPath(path), path).toBe(true);
        }
        for (const path of ["pyproject.toml.bak", "mysetup.py", "setup.py/x.py", "requirements.txt", "tox.ini", "Pipfile"]){
            expect(pythonRules.manifest.test(path), path).toBe(false);
        }
    });

    it("leaves out every file under the folder of a pyvenv.cfg, and nothing when no manifest is one", () => {
        const manifests = [".venv/pyvenv.cfg", "pyproject.toml", "tools/env/pyvenv.cfg"];
        const excluded = pythonRules.excluded(manifests);
        expect(excluded(".venv/lib/site.py")).toBe(true);
        expect(excluded(".venv/lib/python3.12/site-packages/requests/__init__.py")).toBe(true);
        expect(excluded("tools/env/bin/activate_this.py")).toBe(true);
        expect(excluded("tools/run.py")).toBe(false);
        expect(excluded(".venvs/other.py")).toBe(false);   // a sibling whose name only starts the same
        expect(excluded("src/shop/cli.py")).toBe(false);
        expect(pythonRules.excluded(["pyproject.toml", "setup.cfg"])("anything/at/all.py")).toBe(false);
    });

    it("a pyvenv.cfg at the root makes the whole repo a virtual environment", () => {
        expect(virtualEnvironments(["pyvenv.cfg"])).toEqual([""]);
        expect(inVirtualEnvironment("lib/site.py", [""])).toBe(true);
    });

    it("scopes the exclusion to Python's own files through exclusionFor", () => {
        const exclude = exclusionFor([".venv/pyvenv.cfg"]);
        expect(exclude(".venv/lib/site.py")).toBe(true);
        expect(exclude(".venv/lib/node_shim.js")).toBe(false);   // TypeScript's file: TypeScript decides
    });
});
