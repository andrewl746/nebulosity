import { describe, expect, it } from "vitest";
import { isTestPath } from "../../discover";
import { exclusionFor, rulesFor } from "../rules";
import { goRules } from "./rules";

describe("Go's rules", () => {
    it("claims .go files, as language go", () => {
        expect(goRules.extensions).toEqual([".go"]);
        expect(rulesFor("cmd/shop/main.go")).toBe(goRules);
        expect(rulesFor("cmd/shop/main.gox")).toBeNull();
        expect(rulesFor("cmd/shop/main.GO")).toBeNull();
        expect(goRules.languageOf("internal/store/store.go")).toBe("go");
    });

    it("counts a file whose name ends _test.go as a test, and no other", () => {
        expect(goRules.isTest("internal/store/store_test.go")).toBe(true);
        expect(goRules.isTest("store_test.go")).toBe(true);
        expect(goRules.isTest("internal/store/store.go")).toBe(false);
        expect(goRules.isTest("internal/store/testing.go")).toBe(false);
        expect(goRules.isTest("internal/store/store_testdata.go")).toBe(false);
        expect(goRules.isTest("internal/test_helpers/store.go")).toBe(false);
    });

    it("leaves a testdata/ folder to the shared folder rule, which doesn't count it (only test/, tests/, __tests__/)", () => {
        expect(isTestPath("tsdb/testdata/x.go")).toBe(false);
        expect(isTestPath("test/e2e/x.go")).toBe(true);
        expect(isTestPath("tsdb/db_test.go")).toBe(true);
    });

    it("counts go.mod and go.work anywhere as manifests, and nothing else", () => {
        for (const p of ["go.mod", "tools/go.mod", "go.work", "a/b/go.work"]) expect(goRules.manifest.test(p), p).toBe(true);
        for (const p of ["go.sum", "go.work.sum", "xgo.mod", "go.mod.bak", "go.mod/x.go", "docs/go.md"]) expect(goRules.manifest.test(p), p).toBe(false);
    });

    it("leaves out every file under the vendor/ folder beside a go.mod, and no other vendor/ folder", () => {
        const excluded = goRules.excluded(["go.mod", "tools/go.mod", "web/package.json"]);
        expect(excluded("vendor/github.com/x/y/y.go")).toBe(true);
        expect(excluded("tools/vendor/golang.org/x/tools/a.go")).toBe(true);
        expect(excluded("vendor.go")).toBe(false);
        expect(excluded("internal/vendor/a.go")).toBe(false);      // no go.mod in internal/
        expect(excluded("tools/vendored/a.go")).toBe(false);
        expect(excluded("cmd/vendor.go")).toBe(false);
    });

    it("leaves nothing out without a go.mod: a go.work alone names no vendor/ folder", () => {
        const excluded = goRules.excluded(["go.work", "package.json"]);
        expect(excluded("vendor/github.com/x/y/y.go")).toBe(false);
    });

    it("keeps another language's files in a Go vendor/ folder: each language decides for its own files", () => {
        const excluded = exclusionFor(["go.mod"]);
        expect(excluded("vendor/github.com/x/y/y.go")).toBe(true);
        expect(excluded("vendor/github.com/x/y/tool.ts")).toBe(false);
    });
});
