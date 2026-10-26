import { describe, expect, it } from "vitest";
import type { LanguageRules } from "./adapter";
import { claimedExtensions, exclusionFor, isManifestPath, RULES, rulesFor } from "./rules";
import { TYPESCRIPT_EXTENSIONS } from "./typescript-rules";

// Every test here must still hold after the language tasks fill in their own rules: nothing below says what a stub
// claims or doesn't (the plan's Task F3).

/** A test language: a fixed extension, a manifest, and a folder its manifest leaves out. */
const toy: LanguageRules = {
    id: "toy",
    extensions: [".toy", ".big.toy"],
    languageOf: () => "toy",
    isTest: (p) => /_test\.toy$/.test(p),
    manifest: /(^|\/)toy\.json$/,
    excluded: (manifests) => {
        const dirs = manifests.filter((m) => /(^|\/)toy\.json$/.test(m)).map((m) => (m.includes("/") ? `${m.slice(0, m.lastIndexOf("/"))}/` : ""));
        return (p) => dirs.some((d) => p.startsWith(`${d}deps/`));
    },
};

describe("the language rules", () => {
    it("lists every language in the registry's order", () => {
        expect(RULES.map((r) => r.id)).toEqual(["typescript", "python", "go", "java", "csharp", "rust"]);
    });

    it("finds TypeScript's rules for a .tsx file", () => {
        expect(rulesFor("src/a.tsx")?.id).toBe("typescript");
        expect(rulesFor("lib/b.mjs")?.id).toBe("typescript");
    });

    it("claims TypeScript's extensions first, in their order, and no extension twice", () => {
        const claimed = claimedExtensions();
        expect(claimed.slice(0, TYPESCRIPT_EXTENSIONS.length)).toEqual([...TYPESCRIPT_EXTENSIONS]);
        const all = RULES.flatMap((r) => r.extensions);
        expect(new Set(all).size).toBe(all.length);
        expect(claimed).toEqual(all);
    });

    it("counts a package.json anywhere as a manifest", () => {
        expect(isManifestPath("packages/x/package.json")).toBe(true);
        expect(isManifestPath("tsconfig.base.json")).toBe(true);
    });

    it("gives each language its own lowercase id and a language for each of its paths", () => {
        for (const rules of RULES){
            expect(rules.id).toMatch(/^[a-z]+$/);
            for (const ext of rules.extensions) expect(rules.languageOf(`src/a${ext}`)).toMatch(/^[a-z]+$/);
        }
    });

    it("picks the longest claimed extension a path ends with, case-sensitively", () => {
        const plain: LanguageRules = { ...toy, id: "plain", extensions: [".toy"], languageOf: () => "plain" };
        const big: LanguageRules = { ...toy, id: "big", extensions: [".big.toy"], languageOf: () => "big" };
        expect(rulesFor("a/b.big.toy", [plain, big])?.id).toBe("big");
        expect(rulesFor("a/b.toy", [plain, big])?.id).toBe("plain");
        expect(rulesFor("a/b.TOY", [plain, big])).toBeNull();
        expect(rulesFor("a/b.toyx", [plain, big])).toBeNull();
    });

    it("claims a test language's extensions after TypeScript's, each once", () => {
        expect(claimedExtensions([RULES[0], toy])).toEqual([...TYPESCRIPT_EXTENSIONS, ".toy", ".big.toy"]);
        expect(isManifestPath("a/toy.json", [RULES[0], toy])).toBe(true);
        expect(isManifestPath("a/toy.json", [RULES[0]])).toBe(false);
    });

    it("leaves out only the claiming language's files that its manifests exclude", () => {
        const exclude = exclusionFor(["pkg/toy.json", "tsconfig.json"], [RULES[0], toy]);
        expect(exclude("pkg/deps/x.toy")).toBe(true);
        expect(exclude("pkg/deps/x.ts")).toBe(false);   // TypeScript's file: the toy's rule doesn't reach it
        expect(exclude("pkg/src/x.toy")).toBe(false);
        expect(exclude("other/deps/x.toy")).toBe(false);
        expect(exclude("README.md")).toBe(false);
        expect(exclusionFor([], [RULES[0], toy])("pkg/deps/x.toy")).toBe(false);
    });
});
