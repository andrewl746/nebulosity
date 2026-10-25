import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { TruthEdge } from "../../../../test/helpers/fixture-truth";
import { pythonRepoTruth as truth } from "../../../../test/helpers/python-repo-truth";
import type { ResolveContext, StoredFacts } from "../adapter";
import { edgesOf } from "../resolution";
import { createPythonResolver } from "./resolve";

// The resolver on the fixture's stored facts, taken from the hand-derived truth (so no parse is involved): its edges,
// kinds and entry points as the truth says, then one test per rule of the E4 plan's Task P on small file sets.

const ROOT = path.resolve("test", "fixtures", "python-repo");
/** The fixture's manifests, listed by hand (discovery's job; every language's, sorted). */
const MANIFESTS = [".venv/pyvenv.cfg", ".venv/src/helper-tool/pyproject.toml", "pyproject.toml", "services/beta/pyproject.toml", "setup.cfg", "setup.py"];

function fixtureContext(overrides: Partial<ResolveContext> = {}): ResolveContext {
    const files = new Map<string, StoredFacts>(truth.files.map((f) => [f.path, { importSpecifiers: truth.specifiers[f.path], declares: truth.declares[f.path] }]));
    return {
        root: ROOT,
        fileSet: new Set(files.keys()),
        files,
        manifests: MANIFESTS,
        readText: (rel) => {
            try{
                return fs.readFileSync(path.join(ROOT, rel), "utf8");
            } catch{
                return null;
            }
        },
        cache: new Map(),
        ...overrides,
    };
}

/** A small repo of empty-faced files: path → specifiers (declares []), with manifests' texts. */
function smallContext(specifiers: Record<string, string[]>, manifests: Record<string, string> = {}, declares: Record<string, string[]> = {}): ResolveContext {
    const files = new Map<string, StoredFacts>(Object.entries(specifiers).map(([p, s]) => [p, { importSpecifiers: s, declares: declares[p] ?? [] }]));
    return {
        root: "/repo",
        fileSet: new Set(files.keys()),
        files,
        manifests: Object.keys(manifests).sort(),
        readText: (rel) => manifests[rel] ?? null,
        cache: new Map(),
    };
}

const byEdge = (a: TruthEdge, b: TruthEdge): number =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);

describe("python resolver: the fixture", () => {
    const ctx = fixtureContext();
    const resolver = createPythonResolver(ctx);

    it("gives the truth's edges", () => {
        const edges = [...ctx.files].flatMap(([p, facts]) => edgesOf(resolver, p, facts.importSpecifiers)).map((e) => ({ source: e.source, target: e.target }));
        expect(edges.sort(byEdge)).toEqual(truth.edges);
    });

    it("gives the truth's kinds", () => {
        for (const [p, kinds] of Object.entries(truth.kinds)){
            for (const [specifier, kind] of Object.entries(kinds)) expect(resolver.kindOf(p, specifier), `${p} ${specifier}`).toBe(kind);
        }
    });

    it("gives the truth's entry points", () => {
        expect(resolver.entryPoints()).toEqual(truth.entryPoints);
    });

    it("classes: relative for a leading dot, else absolute", () => {
        expect(resolver.classOf!("src/shop/cli.py", ".:VERSION")).toBe("relative");
        expect(resolver.classOf!("src/shop/cli.py", "..m:x")).toBe("relative");
        expect(resolver.classOf!("src/shop/cli.py", "shop.cart:Cart")).toBe("absolute");
        expect(resolver.classOf!("src/shop/cli.py", "os")).toBe("absolute");
    });

    it("keeps what it read from the manifests in the cache, under python:layout", () => {
        expect(ctx.cache.has("python:layout")).toBe(true);
        // a second resolver on the same cache doesn't read a manifest again
        let reads = 0;
        const again = createPythonResolver({ ...fixtureContext({ cache: ctx.cache }), readText: () => (reads++, null) });
        expect(reads).toBe(0);
        expect(again.resolve("src/shop/gui.py", "promo:DISCOUNT")).toEqual([]);
    });
});

describe("python resolver: one rule at a time", () => {
    it("a module's four candidates, in order: .py, /__init__.py, .pyi, /__init__.pyi", () => {
        const all = createPythonResolver(smallContext({ "a.py": ["m"], "m.py": [], "m/__init__.py": [], "m.pyi": [], "m/__init__.pyi": [] }));
        expect(all.resolve("a.py", "m")).toEqual(["m.py"]);
        const noPy = createPythonResolver(smallContext({ "a.py": ["m"], "m/__init__.py": [], "m.pyi": [] }));
        expect(noPy.resolve("a.py", "m")).toEqual(["m/__init__.py"]);
        const stubs = createPythonResolver(smallContext({ "a.py": ["m"], "m.pyi": [], "m/__init__.pyi": [] }));
        expect(stubs.resolve("a.py", "m")).toEqual(["m.pyi"]);
        const pkgStub = createPythonResolver(smallContext({ "a.py": ["m"], "m/__init__.pyi": [] }));
        expect(pkgStub.resolve("a.py", "m")).toEqual(["m/__init__.pyi"]);
    });

    it("a top-level package's parent is a root; a nested package's isn't", () => {
        const r = createPythonResolver(smallContext({
            "lib/pkg/__init__.py": [], "lib/pkg/sub/__init__.py": [], "lib/pkg/sub/x.py": [], "app.py": ["pkg.sub.x", "sub.x"],
        }));
        expect(r.resolve("app.py", "pkg.sub.x")).toEqual(["lib/pkg/sub/x.py"]);   // through the root lib
        expect(r.resolve("app.py", "sub.x")).toEqual([]);                          // lib/pkg isn't a root
    });

    it("the roots containing the importer come first, deepest first, the first hit winning", () => {
        const r = createPythonResolver(smallContext({
            "x/__init__.py": [], "x/util.py": [], "inner/x/__init__.py": [], "inner/x/util.py": [], "inner/run.py": ["x.util"], "run.py": ["x.util"],
        }));
        // roots: "" (x's parent) and inner (inner/x's parent); inner contains inner/run.py and is deeper
        expect(r.resolve("inner/run.py", "x.util")).toEqual(["inner/x/util.py"]);
        expect(r.resolve("run.py", "x.util")).toEqual(["x/util.py"]);
    });

    it("among the other roots, exactly one hit resolves and two resolve to nothing", () => {
        const two = createPythonResolver(smallContext({
            "a/app/__init__.py": [], "a/app/config.py": [], "b/app/__init__.py": [], "b/app/config.py": [], "tool.py": ["app.config"],
        }));
        expect(two.resolve("tool.py", "app.config")).toEqual([]);
        expect(two.kindOf("tool.py", "app.config")).toBe("internal");   // app is a top-level package's name
        expect(two.resolve("a/app/config.py", "app.config")).toEqual(["a/app/config.py"]);   // its own root: placed, no edge
        const one = createPythonResolver(smallContext({ "a/app/__init__.py": [], "a/app/config.py": [], "b/app/__init__.py": [], "tool.py": ["app.config"] }));
        expect(one.resolve("tool.py", "app.config")).toEqual(["a/app/config.py"]);
    });

    it("X:name tries the submodule X.name, then the module X; X:* and plain X are the module", () => {
        const r = createPythonResolver(smallContext({ "pkg/__init__.py": [], "pkg/sub.py": [], "a.py": [] }));
        expect(r.resolve("a.py", "pkg:sub")).toEqual(["pkg/sub.py"]);
        expect(r.resolve("a.py", "pkg:name")).toEqual(["pkg/__init__.py"]);
        expect(r.resolve("a.py", "pkg:*")).toEqual(["pkg/__init__.py"]);
        expect(r.resolve("a.py", "pkg.sub:*")).toEqual(["pkg/sub.py"]);
        expect(r.resolve("a.py", "pkg")).toEqual(["pkg/__init__.py"]);
        expect(r.resolve("a.py", "pkg.missing")).toEqual([]);
    });

    it("relative: one folder up per dot after the first; .:c is base/c, else base's __init__; past the root is nothing", () => {
        const r = createPythonResolver(smallContext({
            "p/__init__.py": [], "p/c.py": [], "p/q/__init__.py": [], "p/q/a.py": [], "p/m/__init__.py": [], "p/m/n.py": [], "top.py": [],
        }));
        expect(r.resolve("p/q/a.py", ".:x")).toEqual(["p/q/__init__.py"]);
        expect(r.resolve("p/q/a.py", "..:c")).toEqual(["p/c.py"]);
        expect(r.resolve("p/q/a.py", "..m:n")).toEqual(["p/m/n.py"]);
        expect(r.resolve("p/q/a.py", "..m:other")).toEqual(["p/m/__init__.py"]);
        expect(r.resolve("p/q/a.py", "..m.n:thing")).toEqual(["p/m/n.py"]);
        expect(r.resolve("p/q/a.py", "..m:*")).toEqual(["p/m/__init__.py"]);
        expect(r.resolve("p/q/a.py", "...:top")).toEqual(["top.py"]);   // up to the repo root
        expect(r.resolve("p/q/a.py", "....:top")).toEqual([]);          // past it
        expect(r.resolve("p/q/a.py", "......:top")).toEqual([]);        // well past it
        expect(r.resolve("top.py", "..:x")).toEqual([]);
        expect(r.resolve("p/q/a.py", ".missing:x")).toEqual([]);
        expect(r.kindOf("p/q/a.py", ".missing:x")).toBe("internal");
    });

    it("a manifest's folder and its src/ are roots, the src/ only when it holds files", () => {
        const r = createPythonResolver(smallContext(
            { "proj/src/mod.py": [], "proj/top.py": [], "run.py": ["mod", "top"] },
            { "proj/setup.py": "" },
        ));
        expect(r.resolve("run.py", "mod")).toEqual(["proj/src/mod.py"]);
        expect(r.resolve("run.py", "top")).toEqual(["proj/top.py"]);
    });

    it("the folders a pyproject names are roots: where, package-dir, Poetry's from, Hatch's folder, pytest's pythonpath", () => {
        const pyproject = [
            "[tool.setuptools.packages.find]", "where = [\"w\"]",
            "[tool.setuptools.package-dir]", "\"\" = \"pd\"",
            "[tool.poetry]", "packages = [{ include = \"x\", from = \"pf\" }]",
            "[tool.hatch.build.targets.wheel]", "packages = [\"hf/pkgname\"]",
            "[tool.pytest.ini_options]", "pythonpath = [\"pp\", \"../outside\"]",
        ].join("\n");
        const files = { "sub/w/m1.py": [], "sub/pd/m2.py": [], "sub/pf/m3.py": [], "sub/hf/m4.py": [], "sub/pp/m5.py": [], "run.py": ["m1", "m2", "m3", "m4", "m5"] };
        const r = createPythonResolver(smallContext(files, { "sub/pyproject.toml": pyproject }));
        expect(["m1", "m2", "m3", "m4", "m5"].map((m) => r.resolve("run.py", m))).toEqual([
            ["sub/w/m1.py"], ["sub/pd/m2.py"], ["sub/pf/m3.py"], ["sub/hf/m4.py"], ["sub/pp/m5.py"],
        ]);
        // without the pyproject none of those folders is a root
        const bare = createPythonResolver(smallContext(files));
        expect(bare.resolve("run.py", "m1")).toEqual([]);
        expect(bare.kindOf("run.py", "m1")).toBe("external");
    });

    it("a pyproject that isn't valid TOML names nothing, and the rest still resolves", () => {
        const r = createPythonResolver(smallContext({ "w/m.py": [], "pkg/__init__.py": [], "run.py": [] }, { "pyproject.toml": "[tool\nwhere = " }));
        expect(r.resolve("run.py", "m")).toEqual([]);
        expect(r.resolve("run.py", "pkg")).toEqual(["pkg/__init__.py"]);
        expect(r.entryPoints()).toEqual([]);
    });

    it("ignores the manifests inside a virtual environment: no roots, no scripts", () => {
        const r = createPythonResolver(smallContext(
            { "tools/mod.py": [], "run.py": [] },
            { "env/pyvenv.cfg": "home = /usr\n", "env/src/x/pyproject.toml": "[tool.pytest.ini_options]\npythonpath = [\"../../../tools\"]\n[project.scripts]\nx = \"run:main\"\n" },
        ));
        expect(r.resolve("run.py", "mod")).toEqual([]);
        expect(r.entryPoints()).toEqual([]);
    });

    it("kindOf: internal when it resolves, or when its first segment is a top-level package or a root's module; else external", () => {
        const r = createPythonResolver(smallContext({ "pkg/__init__.py": [], "settings.py": [], "email/templates.py": [], "a.py": [] }));
        expect(r.kindOf("a.py", "pkg.missing:x")).toBe("internal");
        expect(r.kindOf("a.py", "settings.nothing")).toBe("internal");
        expect(r.kindOf("a.py", "email.utils:formatdate")).toBe("external");   // a namespace folder: internal only when it resolves
        expect(r.kindOf("a.py", "email:templates")).toBe("internal");          // it does
        expect(r.kindOf("a.py", "os.path")).toBe("external");
    });

    it("entry points: every script kind, __main__.py, the marker; the first declaration of a path wins", () => {
        const pyproject = [
            "[project.scripts]", "a = \"pkg.a:main\"", "ghost = \"pkg.ghost:main\"",
            "[project.gui-scripts]", "b = \"pkg.b:run [gui]\"",
            "[project.entry-points.\"x.y\"]", "c = \"pkg.c\"",
            "[tool.poetry.scripts]", "d = \"pkg.d:main\"", "e = { reference = \"pkg.e:main\", type = \"console\" }", "again = \"pkg.a:other\"",
        ].join("\n");
        const setupCfg = "[options.entry_points]\nconsole_scripts =\n    f = pkg.f:main\n# a comment\ngui_scripts =\n    g = pkg.g:main\n";
        const files = {
            "src/pkg/__init__.py": [], "src/pkg/a.py": [], "src/pkg/b.py": [], "src/pkg/c.py": [], "src/pkg/d.py": [], "src/pkg/e.py": [],
            "src/pkg/f.py": [], "src/pkg/g.py": [], "src/pkg/__main__.py": [], "tool.py": [],
        };
        const r = createPythonResolver(smallContext(files, { "pyproject.toml": pyproject, "setup.cfg": setupCfg }, { "src/pkg/__main__.py": ["__main__"], "tool.py": ["__main__"] }));
        expect(r.entryPoints()).toEqual([
            { path: "src/pkg/__main__.py", declaredBy: "__main__.py" },
            { path: "src/pkg/a.py", declaredBy: "pyproject.toml [project.scripts] a" },
            { path: "src/pkg/b.py", declaredBy: "pyproject.toml [project.gui-scripts] b" },
            { path: "src/pkg/c.py", declaredBy: "pyproject.toml [project.entry-points.x.y] c" },
            { path: "src/pkg/d.py", declaredBy: "pyproject.toml [tool.poetry.scripts] d" },
            { path: "src/pkg/e.py", declaredBy: "pyproject.toml [tool.poetry.scripts] e" },
            { path: "src/pkg/f.py", declaredBy: "setup.cfg [options.entry_points] console_scripts f" },
            { path: "tool.py", declaredBy: "if __name__ == \"__main__\"" },
        ]);
    });
});
