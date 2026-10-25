import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture, FIXTURE } from "../../../test/helpers/fixture";
import type { ResolveContext, StoredFacts } from "./adapter";
import { ADAPTERS, adapterById, adapterFor } from "./registry";
import { RULES } from "./rules";
import { parseTypeScriptFile, parseTypeScriptImportsOnly, scanTypeScriptImports } from "./typescript";
import { typescriptAdapter } from "./typescript-adapter";

const grammarFiles = (JSON.parse(fs.readFileSync(path.resolve("lib/index/languages/grammars/grammars.json"), "utf8")) as { id: string; file: string }[]);

/** The mini-repo's files and the specifiers each writes (docs/plans/2026-10-11-v1-1-engine-foundation.md, read from the files). */
const MINI: Record<string, string[]> = {
    "scripts/build.js": ["../src/index", "../src/app/main"],
    "src/app/main.ts": ["../core/log", "./view", "../util/strings.js"],
    "src/app/view.tsx": ["react", "./main"],
    "src/core/index.ts": ["./log"],
    "src/core/log.ts": [],
    "src/index.ts": ["./app/main", "@core/log"],
    "src/util/strings.test.ts": ["./strings"],
    "src/util/strings.ts": ["../core"],
};

function context(root: string, manifests: string[], extraFiles: Record<string, string[]> = {}): ResolveContext {
    const all = { ...MINI, ...extraFiles };
    const files = new Map<string, StoredFacts>(Object.entries(all).map(([p, importSpecifiers]) => [p, { importSpecifiers, declares: [] }]));
    return {
        root, fileSet: new Set(files.keys()), files, manifests,
        readText: (rel) => { try{ return fs.readFileSync(path.join(root, rel), "utf8"); } catch{ return null; } },
        cache: new Map(),
    };
}

describe("the registry", () => {
    it("lists the adapters in the rules' order, each built on that entry's own rules", () => {
        expect(ADAPTERS.map((a) => a.id)).toEqual(RULES.map((r) => r.id));
        ADAPTERS.forEach((adapter, i) => {
            const rules = RULES[i];
            expect(adapter.extensions).toBe(rules.extensions);
            expect(adapter.languageOf).toBe(rules.languageOf);
            expect(adapter.isTest).toBe(rules.isTest);
            expect(adapter.manifest).toBe(rules.manifest);
            expect(adapter.excluded).toBe(rules.excluded);
        });
    });

    it("finds adapters by path and by id", () => {
        expect(adapterFor("src/a.ts")?.id).toBe("typescript");
        expect(adapterFor("scripts/b.cjs")?.id).toBe("typescript");
        expect(adapterById("rust")?.id).toBe("rust");
        expect(adapterById("nope")).toBeNull();
        expect(adapterFor("src/a.ts", [])).toBeNull();
    });

    it("names a committed grammar for every adapter but TypeScript", () => {
        expect(typescriptAdapter.grammar).toBeNull();
        for (const adapter of ADAPTERS.slice(1)){
            expect(grammarFiles.find((g) => g.id === adapter.id)?.file).toBe(adapter.grammar);
        }
    });
});

describe("the TypeScript adapter", () => {
    const logText = fs.readFileSync(path.join(FIXTURE, "src/core/log.ts"), "utf8");

    it("parses a file as typescript.ts does, declaring nothing, in each reading", () => {
        expect(typescriptAdapter.parse("src/core/log.ts", logText, "full")).toEqual({ ...parseTypeScriptFile("src/core/log.ts", logText), declares: [] });
        expect(typescriptAdapter.parse("src/core/log.ts", logText, "parse")).toEqual({ ...parseTypeScriptImportsOnly("src/core/log.ts", logText), declares: [] });
        expect(typescriptAdapter.parse("src/core/log.ts", logText, "scan")).toEqual({ ...scanTypeScriptImports("src/core/log.ts", logText), declares: [] });
    });

    it("resolves the mini-repo's specifiers to the V1.1 plan's edges, as one file each", () => {
        const root = copyFixture();
        const resolver = typescriptAdapter.createResolver(context(root, ["tsconfig.json"]));
        expect(resolver.resolve("src/index.ts", "@core/log")).toEqual(["src/core/log.ts"]);
        expect(resolver.resolve("src/app/main.ts", "../util/strings.js")).toEqual(["src/util/strings.ts"]);
        expect(resolver.resolve("src/util/strings.ts", "../core")).toEqual(["src/core/index.ts"]);
        expect(resolver.resolve("src/app/view.tsx", "react")).toEqual([]);
        expect(resolver.kindOf("src/app/view.tsx", "react")).toBe("external");
        expect(resolver.kindOf("src/index.ts", "@core/log")).toBe("internal");
        expect(resolver.kindOf("src/a.ts", "./missing")).toBe("internal");   // relative: in the repo, resolved or not
        expect(resolver.entryPoints()).toEqual([]);   // the mini-repo has no package.json
    });

    it("keeps the workspace it read in the cache and reads it from there next time", () => {
        const root = copyFixture();
        const ctx = context(root, ["tsconfig.json"]);
        typescriptAdapter.createResolver(ctx);
        const workspace = ctx.cache.get("typescript:workspace");
        expect(workspace).toBeDefined();
        typescriptAdapter.createResolver(ctx);
        expect(ctx.cache.get("typescript:workspace")).toBe(workspace);
    });

    it("reads only its own manifests: another language's manifest is not a tsconfig", () => {
        const root = copyFixture();
        fs.mkdirSync(path.join(root, "sub/x"), { recursive: true });
        fs.writeFileSync(path.join(root, "sub/go.mod"), "module example.com/sub\n");
        fs.writeFileSync(path.join(root, "sub/tsconfig.local.json"), "{}\n");
        // read as a tsconfig, sub/go.mod would make sub/ a module-id root and "x/y" would name sub/x/y.ts
        const asTsconfig = typescriptAdapter.createResolver(context(root, ["sub/tsconfig.local.json", "tsconfig.json"], { "sub/x/y.ts": [] }));
        expect(asTsconfig.resolve("src/index.ts", "x/y")).toEqual(["sub/x/y.ts"]);
        fs.rmSync(path.join(root, "sub/tsconfig.local.json"));
        const withGoMod = typescriptAdapter.createResolver(context(root, ["sub/go.mod", "tsconfig.json"], { "sub/x/y.ts": [] }));
        expect(withGoMod.resolve("src/index.ts", "x/y")).toEqual([]);
    });

    it("resolves only to TypeScript's own files, whatever else the repo indexes", () => {
        const root = copyFixture();
        const ctx = context(root, ["tsconfig.json"]);
        const withOther: ResolveContext = { ...ctx, fileSet: new Set([...ctx.fileSet, "src/tool.py"]) };
        expect(typescriptAdapter.createResolver(withOther).resolve("src/index.ts", "./tool.py")).toEqual([]);
    });
});
