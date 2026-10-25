import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { goRepoTruth as truth } from "../../../../test/helpers/go-repo-truth";
import type { ResolveContext, StoredFacts } from "../adapter";
import { edgesOf } from "../resolution";
import { createGoResolver, defaultAlias, moduleOf, readModules } from "./resolve";

const FIXTURE = path.resolve("test", "fixtures", "go-repo");
const MANIFESTS = ["go.mod", "tools/go.mod", "vendor/github.com/x/y/go.mod"];

/** A resolve context over the truth's own facts (its specifiers and declares, as a full run stores them). */
function truthContext(): ResolveContext {
    const files = new Map<string, StoredFacts>(truth.files.map((f) => [f.path, { importSpecifiers: truth.specifiers[f.path], declares: truth.declares[f.path] }]));
    return {
        root: FIXTURE, fileSet: new Set(files.keys()), files, manifests: MANIFESTS, cache: new Map(),
        readText: (rel) => {
            try{
                return fs.readFileSync(path.join(FIXTURE, rel), "utf8");
            } catch{
                return null;
            }
        },
    };
}

/** A context over hand-written files and manifest texts. */
function context(files: Record<string, { specifiers?: string[]; declares: string[] }>, manifests: Record<string, string>): ResolveContext {
    const facts = new Map<string, StoredFacts>(Object.entries(files).map(([p, f]) => [p, { importSpecifiers: f.specifiers ?? [], declares: f.declares }]));
    return {
        root: "/repo", fileSet: new Set(facts.keys()), files: facts, manifests: Object.keys(manifests).sort(), cache: new Map(),
        readText: (rel) => manifests[rel] ?? null,
    };
}

const resolver = createGoResolver(truthContext());
const resolve = (importer: string, specifier: string): string[] => resolver.resolve(importer, specifier);

describe("Go's resolver on the go-repo truth", () => {
    it("gives every edge the truth lists, and no other", () => {
        const edges = truth.files.flatMap((f) => edgesOf(resolver, f.path, truth.specifiers[f.path]).map((e) => ({ source: e.source, target: e.target })));
        const sorted = edges.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
        expect(sorted).toEqual(truth.edges);
    });

    it("names each specifier's kind as the truth does", () => {
        for (const f of truth.files){
            for (const [specifier, kind] of Object.entries(truth.kinds[f.path])) expect(resolver.kindOf(f.path, specifier), `${f.path} ${specifier}`).toBe(kind);
        }
    });

    it("finds the entry points: package main with func main", () => {
        expect(resolver.entryPoints()).toEqual(truth.entryPoints);
    });

    it("maps an import path to the folder under its longest-prefix module, the nested module's too", () => {
        expect(resolve("tools/gen/main.go", "use:lint.Check")).toEqual(["tools/lint/lint.go"]);
        expect(resolve("tools/gen/main.go", "import:example.com/shop/tools/lint")).toEqual(["tools/gen/main.go"]);
    });

    it("loads every non-test file of a blank or dot import's package", () => {
        expect(resolve("cmd/shop/main.go", "import:example.com/shop/plugins as _")).toEqual(["plugins/plugins.go", "plugins/register.go"]);
        expect(resolve("cmd/shop/main.go", "import:example.com/shop/internal/text as .")).toEqual(["internal/text/text.go"]);
    });

    it("places an import whose uses resolve, with no edge of its own (an alias, or the package's name)", () => {
        expect(resolve("internal/api/handler.go", "import:example.com/shop/internal/store as st")).toEqual(["internal/api/handler.go"]);
        expect(resolve("cmd/shop/main.go", "import:example.com/shop/pkg/go-colors")).toEqual(["cmd/shop/main.go"]);
    });

    it("falls back to the package's non-test files when none of an import's uses resolves", () => {
        expect(resolve("cmd/shop/main.go", "use:widgets.Missing")).toEqual([]);
        expect(resolve("cmd/shop/main.go", "import:example.com/shop/pkg/widgets/v2")).toEqual(["pkg/widgets/v2/widgets.go"]);
    });

    it("places nothing for an import outside the repo's modules, and ignores a go.mod under an excluded vendor/ folder", () => {
        expect(resolve("internal/api/api.go", "import:fmt")).toEqual([]);
        expect(resolve("internal/text/text.go", "import:github.com/x/y")).toEqual([]);
        expect(resolver.kindOf("internal/text/text.go", "import:github.com/x/y")).toBe("external");
        expect(readModules(MANIFESTS, truthContext().readText)).toEqual([{ path: "example.com/shop", dir: "" }, { path: "example.com/shop/tools", dir: "tools" }]);
    });

    it("sends use:x.N to the files of x's package that declare N, never to a test file", () => {
        expect(resolve("internal/api/api.go", "use:store.DefaultSize")).toEqual(["internal/store/extra.go"]);
        expect(resolve("internal/api/api.go", "use:store.New")).toEqual(["internal/store/store.go"]);
        expect(resolve("cmd/shop/main.go", "use:colors.Red")).toEqual(["pkg/go-colors/colors.go"]);
    });

    it("reads use:x.N as name:x when x isn't an import's alias", () => {
        expect(resolve("internal/store/store_test.go", "use:Empty.Len")).toEqual(["internal/store/extra.go"]);
    });

    it("sends name:N to the other files of the importer's package declaring it: every build-tag twin", () => {
        expect(resolve("internal/paths/paths.go", "name:sep")).toEqual(["internal/paths/sep_linux.go", "internal/paths/sep_windows.go"]);
        expect(resolve("internal/api/broken.go", "name:limit")).toEqual(["internal/api/api.go"]);
        expect(resolve("internal/api/handler.go", "name:Routes")).toEqual([]);
    });

    it("tries the dot-imported packages for an unqualified name", () => {
        expect(resolve("cmd/shop/main.go", "name:Upper")).toEqual(["internal/text/text.go"]);
    });

    it("keeps an external test package to its own package: api_test reaches api only through its import", () => {
        expect(resolve("internal/api/api_test.go", "use:api.Open")).toEqual(["internal/api/api.go"]);
        expect(resolve("internal/api/api_test.go", "name:Open")).toEqual([]);
    });
});

describe("Go's resolver, rule by rule", () => {
    const GO_MOD = "module example.com/m\n\ngo 1.22\n";

    it("never lets a non-test file reach a _test.go file, while a test file reaches both", () => {
        const r = createGoResolver(context({
            "p/a.go": { specifiers: ["name:helper"], declares: ["package:p"] },
            "p/a_test.go": { specifiers: ["name:helper", "name:Real"], declares: ["helper", "package:p"] },
            "p/b.go": { declares: ["Real", "package:p"] },
        }, { "go.mod": GO_MOD }));
        expect(r.resolve("p/a.go", "name:helper")).toEqual([]);
        expect(r.resolve("p/a_test.go", "name:Real")).toEqual(["p/b.go"]);
    });

    it("places a name only its own file declares, and gives nothing for one no file does", () => {
        const r = createGoResolver(context({ "p/a.go": { specifiers: ["name:x"], declares: ["package:p", "x"] } }, { "go.mod": GO_MOD }));
        expect(r.resolve("p/a.go", "name:x")).toEqual(["p/a.go"]);
        expect(r.resolve("p/a.go", "name:y")).toEqual([]);
    });

    it("counts an import only when its folder holds a non-test .go file", () => {
        const r = createGoResolver(context({
            "main.go": { specifiers: ["import:example.com/m/onlytests", "import:example.com/m/missing"], declares: ["package:main"] },
            "onlytests/x_test.go": { declares: ["package:onlytests"] },
        }, { "go.mod": GO_MOD }));
        expect(r.resolve("main.go", "import:example.com/m/onlytests")).toEqual([]);
        expect(r.resolve("main.go", "import:example.com/m/missing")).toEqual([]);
        expect(r.kindOf("main.go", "import:example.com/m/missing")).toBe("internal");
    });

    it("reads go.mod's quoted module, comments and CRLF, and go.work's and go.mod's local replaces", () => {
        const modules = readModules(["go.mod", "go.work", "lib/go.mod", "tools/go.mod"], (rel) => ({
            "go.mod": "module \"example.com/m\" // the root\r\n\r\nreplace (\r\n\texample.com/x v1.0.0 => ./third_party/x\r\n\texample.com/far => github.com/far/far v1.2.3\r\n)\r\n",
            "go.work": "go 1.22\n\nuse (\n\t.\n\t./lib\n)\n\nreplace example.com/y => ./y\n",
            "lib/go.mod": "module example.com/lib\n",
            "tools/go.mod": "module example.com/m/tools\n\nreplace example.com/m => ../\n\nreplace example.com/out => ../../outside\n",
        } as Record<string, string>)[rel] ?? null);
        expect(modules).toEqual([
            { path: "example.com/m", dir: "" },
            { path: "example.com/lib", dir: "lib" },
            { path: "example.com/m/tools", dir: "tools" },
            { path: "example.com/x", dir: "third_party/x" },
            { path: "example.com/y", dir: "y" },
        ]);
    });

    it("resolves an import through a replace's folder", () => {
        const r = createGoResolver(context({
            "main.go": { specifiers: ["import:example.com/x/sub", "use:sub.Do"], declares: ["package:main"] },
            "third_party/x/sub/sub.go": { declares: ["Do", "package:sub"] },
        }, { "go.mod": "module example.com/m\n\nreplace example.com/x => ./third_party/x\n" }));
        expect(r.resolve("main.go", "use:sub.Do")).toEqual(["third_party/x/sub/sub.go"]);
        expect(r.kindOf("main.go", "import:example.com/x/sub")).toBe("internal");
    });

    it("picks the longest module prefix at a path-element boundary", () => {
        const modules = [{ path: "example.com/m", dir: "" }, { path: "example.com/m/tools", dir: "build/tools" }];
        expect(moduleOf("example.com/m/tools/lint", modules)).toEqual({ path: "example.com/m/tools", dir: "build/tools" });
        expect(moduleOf("example.com/m/toolsx", modules)).toEqual({ path: "example.com/m", dir: "" });
        expect(moduleOf("example.com/mx", modules)).toBeNull();
    });

    it("names an import by its explicit alias, else its repo package's name, else its last element without /v<N>", () => {
        expect(defaultAlias("github.com/other/kit/v2")).toBe("kit");
        expect(defaultAlias("go.yaml.in/yaml/v3")).toBe("yaml");
        expect(defaultAlias("fmt")).toBe("fmt");
        expect(defaultAlias("v2")).toBe("v2");
        const r = createGoResolver(context({
            "main.go": { specifiers: ["import:example.com/m/go-colors", "use:colors.Red", "import:example.com/m/x as y", "use:y.X", "use:x.X"], declares: ["package:main"] },
            "go-colors/c.go": { declares: ["Red", "package:colors"] },
            "x/x.go": { declares: ["X", "package:x"] },
        }, { "go.mod": GO_MOD }));
        expect(r.resolve("main.go", "use:colors.Red")).toEqual(["go-colors/c.go"]);
        expect(r.resolve("main.go", "use:y.X")).toEqual(["x/x.go"]);
        expect(r.resolve("main.go", "use:x.X")).toEqual([]);   // x isn't an alias here (y is): read as name:x
    });

    it("takes a folder's package from most of its non-test files, so a generator's package main stays out of it", () => {
        const r = createGoResolver(context({
            "main.go": { specifiers: ["import:example.com/m/lib", "use:lib.A"], declares: ["package:main"] },
            "lib/a.go": { declares: ["A", "package:lib"] },
            "lib/b.go": { declares: ["B", "package:lib"] },
            "lib/gen.go": { declares: ["A", "main", "package:main"] },
        }, { "go.mod": GO_MOD }));
        expect(r.resolve("main.go", "use:lib.A")).toEqual(["lib/a.go"]);
        expect(r.resolve("main.go", "import:example.com/m/lib as _")).toEqual(["lib/a.go", "lib/b.go"]);
    });

    it("keeps the modules in the cache under go:modules and reads them from there", () => {
        const ctx = context({ "a.go": { declares: ["package:a"] } }, { "go.mod": GO_MOD });
        createGoResolver(ctx);
        expect(ctx.cache.get("go:modules")).toEqual([{ path: "example.com/m", dir: "" }]);
        ctx.cache.set("go:modules", [{ path: "example.com/other", dir: "" }]);
        expect(createGoResolver(ctx).kindOf("a.go", "import:example.com/m/x")).toBe("external");
    });

    it("calls an external import's alias's uses external, a non-alias's internal", () => {
        const r = createGoResolver(context({ "a.go": { specifiers: ["import:github.com/o/lib", "use:lib.Do", "use:local.Do"], declares: ["package:a"] } }, { "go.mod": GO_MOD }));
        expect(r.kindOf("a.go", "use:lib.Do")).toBe("external");
        expect(r.kindOf("a.go", "use:local.Do")).toBe("internal");
        expect(r.kindOf("a.go", "name:Thing")).toBe("internal");
    });
});
