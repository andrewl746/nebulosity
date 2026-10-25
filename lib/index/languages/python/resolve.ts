/**
 * Python's resolver (the E4 plan's Task P): which indexed file each specifier names, by Python's own rules, from the
 * repo's packages and its manifests. Nothing here runs Python or reads sys.path: the roots are a convention (the
 * design's risk), read from the folders and the manifests alone.
 *
 * - **Packages and roots.** A package is a folder holding an `__init__.py` or `__init__.pyi`; a top-level package is
 *   one whose parent folder isn't a package, and that parent is a root. So are the repo root, each project manifest's
 *   folder and its `src/` (pyproject.toml, setup.cfg, setup.py), and the folders a pyproject.toml names (setuptools'
 *   `where` and `package-dir`, Poetry's `from`, Hatch's wheel packages' folders, pytest's `pythonpath`).
 * - **A module `a.b.c` under a root `r`** is the first indexed of `r/a/b/c.py`, `r/a/b/c/__init__.py`, `r/a/b/c.pyi`,
 *   `r/a/b/c/__init__.pyi`.
 * - **Absolute, from file F:** the roots that contain F, deepest first (the first hit wins); else the other roots, where
 *   exactly one hit resolves and two or more resolve to nothing (two packages named `app`, neither of them F's).
 * - **`X:name`** is the submodule `X.name`, else the module `X`; `X:*` and plain `X` are the module `X`.
 * - **Relative:** from F's folder, one folder up per dot after the first; `.:c` is the module `base/c`, else the
 *   package `base/__init__`; `.m:c` is `base/m/c`, else `base/m`.
 *
 * Manifests inside a virtual environment (the folder of a pyvenv.cfg, which rules.ts leaves out) are ignored.
 */
import { parse as parseToml } from "smol-toml";
import type { LanguageResolver, ReferenceKind, ResolveContext } from "../adapter";
import { dirOf, joinRepoPath } from "../../paths";
import { inVirtualEnvironment, PROJECT_MANIFEST, virtualEnvironments } from "./rules";

const DOTTED_NAME = /^[^\W\d]\w*(\.[^\W\d]\w*)*$/u;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A script a manifest declares: where it's declared (declaredBy) and the module its target names. */
type DeclaredScript = { manifest: string; declaredBy: string; module: string };

/** What the resolver reads from the folders and the manifests once per file set and manifest list (ctx.cache). */
type Layout = {
    /** Every root, "" included. */
    roots: string[];
    /** The names of the top-level packages, and of the modules sitting directly in a root (`<root>/<name>.py(i)`). */
    internalNames: Set<string>;
    /** The scripts the project manifests declare, in manifest order, then each manifest's section order. */
    scripts: DeclaredScript[];
};

const CACHE_KEY = "python:layout";

/** A folder's path joined to a relative one, "" for the root, null past the root or for an absolute path. */
function folderUnder(base: string, relative: string): string | null {
    if (relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) return null;
    const joined = joinRepoPath(base, relative.replace(/\\/g, "/").replace(/\/+$/, "") || ".");
    return joined === null ? null : joined.replace(/\/+$/, "");
}

const asStrings = (value: unknown): string[] =>
    (typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const asTable = (value: unknown): Record<string, unknown> =>
    (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const at = (table: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((t, k) => asTable(t)[k], table);

/** An entry-point target's module: `pkg.mod:attr [extra]` → `pkg.mod`; null when it isn't a dotted name. */
function targetModule(target: string): string | null {
    const dotted = target.replace(/\[.*$/, "").split(":")[0].trim();
    return DOTTED_NAME.test(dotted) ? dotted : null;
}

/** pyproject.toml's root folders and declared scripts. A file that isn't valid TOML names nothing. */
function readPyproject(manifest: string, text: string, roots: Set<string>, scripts: DeclaredScript[]): void {
    let doc: Record<string, unknown>;
    try{
        doc = parseToml(text) as Record<string, unknown>;
    } catch{
        return;
    }
    const folder = dirOf(manifest);
    const addRoot = (relative: string): void => {
        const root = folderUnder(folder, relative);
        if (root !== null) roots.add(root);
    };
    for (const where of asStrings(at(doc, "tool", "setuptools", "packages", "find", "where"))) addRoot(where);
    for (const value of Object.values(asTable(at(doc, "tool", "setuptools", "package-dir")))) for (const dir of asStrings(value)) addRoot(dir);
    for (const entry of Array.isArray(at(doc, "tool", "poetry", "packages")) ? (at(doc, "tool", "poetry", "packages") as unknown[]) : []){
        for (const from of asStrings(asTable(entry).from)) addRoot(from);
    }
    for (const pkg of asStrings(at(doc, "tool", "hatch", "build", "targets", "wheel", "packages"))) addRoot(dirOf(pkg.replace(/\/+$/, "")));
    const pythonpath = at(doc, "tool", "pytest", "ini_options", "pythonpath");
    for (const dir of typeof pythonpath === "string" ? pythonpath.split(/\s+/).filter(Boolean) : asStrings(pythonpath)) addRoot(dir);

    const declare = (section: string, table: unknown): void => {
        for (const [name, value] of Object.entries(asTable(table))){
            // Poetry 2 also writes a script as a table: { reference = "pkg.mod:attr", type = "console" }
            const target = typeof value === "string" ? value : asStrings(asTable(value).reference ?? asTable(value).callable)[0];
            const dotted = target === undefined ? null : targetModule(target);
            if (dotted !== null) scripts.push({ manifest, declaredBy: `${manifest} [${section}] ${name}`, module: dotted });
        }
    };
    declare("project.scripts", at(doc, "project", "scripts"));
    declare("project.gui-scripts", at(doc, "project", "gui-scripts"));
    for (const [group, table] of Object.entries(asTable(at(doc, "project", "entry-points")))) declare(`project.entry-points.${group}`, table);
    declare("tool.poetry.scripts", at(doc, "tool", "poetry", "scripts"));
}

/** setup.cfg's console_scripts (an INI file: `[options.entry_points]`, then `console_scripts =` and indented lines). */
function readSetupCfg(manifest: string, text: string, scripts: DeclaredScript[]): void {
    let section = "";
    let key = "";
    for (const raw of text.replace(/\r/g, "").split("\n")){
        if (/^\s*([#;]|$)/.test(raw)) continue;
        const header = /^\[([^\]]+)\]\s*$/.exec(raw);
        if (header !== null){
            section = header[1].trim();
            key = "";
            continue;
        }
        let value: string;
        if (/^\s/.test(raw)){
            value = raw.trim();   // a continuation of the key above
        } else{
            const pair = /^([^=:]+)[=:](.*)$/.exec(raw);
            if (pair === null) continue;
            key = pair[1].trim();
            value = pair[2].trim();
        }
        if (section !== "options.entry_points" || key !== "console_scripts" || value === "") continue;
        const script = /^([^=\s]+)\s*=\s*(.+)$/.exec(value);
        const dotted = script === null ? null : targetModule(script[2]);
        if (script !== null && dotted !== null) scripts.push({ manifest, declaredBy: `${manifest} [options.entry_points] console_scripts ${script[1]}`, module: dotted });
    }
}

function buildLayout(ctx: ResolveContext, files: ReadonlySet<string>): Layout {
    const venvs = virtualEnvironments(ctx.manifests);
    const manifests = ctx.manifests.filter((m) => PROJECT_MANIFEST.test(m) && !inVirtualEnvironment(m, venvs));

    const packages = new Set<string>();
    for (const file of files) if (/(^|\/)__init__\.pyi?$/.test(file) && file.includes("/")) packages.add(dirOf(file));
    const roots = new Set<string>([""]);
    const internalNames = new Set<string>();
    for (const pkg of packages){
        const parent = dirOf(pkg);
        if (packages.has(parent)) continue;
        roots.add(parent);
        internalNames.add(pkg.slice(pkg.lastIndexOf("/") + 1));
    }

    const scripts: DeclaredScript[] = [];
    const holdsFiles = (folder: string): boolean => [...files].some((f) => f.startsWith(`${folder}/`));
    for (const manifest of manifests){
        const folder = dirOf(manifest);
        roots.add(folder);
        const src = folder === "" ? "src" : `${folder}/src`;
        if (holdsFiles(src)) roots.add(src);
        const text = /(^|\/)(pyproject\.toml|setup\.cfg)$/.test(manifest) ? ctx.readText(manifest) : null;
        if (text === null) continue;
        if (manifest.endsWith("pyproject.toml")) readPyproject(manifest, text, roots, scripts);
        else readSetupCfg(manifest, text, scripts);
    }

    for (const file of files){
        const stem = /^(?:(.*)\/)?([^/]+)\.pyi?$/.exec(file);
        if (stem !== null && stem[2] !== "__init__" && roots.has(stem[1] ?? "")) internalNames.add(stem[2]);
    }
    return { roots: [...roots].sort(compare), internalNames, scripts };
}

const depthOf = (folder: string): number => (folder === "" ? 0 : folder.split("/").length);
const contains = (root: string, folder: string): boolean => root === "" || folder === root || folder.startsWith(`${root}/`);

export function createPythonResolver(ctx: ResolveContext): LanguageResolver {
    const files: ReadonlySet<string> = new Set(ctx.files.keys());
    let layout = ctx.cache.get(CACHE_KEY) as Layout | undefined;
    if (layout === undefined){
        layout = buildLayout(ctx, files);
        ctx.cache.set(CACHE_KEY, layout);
    }
    const { roots, internalNames, scripts } = layout;

    /** The module `dotted` (a.b.c) under a folder: the first indexed of its four candidates. */
    const moduleUnder = (folder: string, dotted: string): string | null => {
        const stem = folder === "" ? dotted.replace(/\./g, "/") : `${folder}/${dotted.replace(/\./g, "/")}`;
        for (const candidate of [`${stem}.py`, `${stem}/__init__.py`, `${stem}.pyi`, `${stem}/__init__.pyi`]){
            if (files.has(candidate)) return candidate;
        }
        return null;
    };

    /** The roots containing a folder, deepest first, and the others (memoized per folder). */
    const rootsByFolder = new Map<string, { inside: string[]; outside: string[] }>();
    const rootsFor = (folder: string): { inside: string[]; outside: string[] } => {
        let found = rootsByFolder.get(folder);
        if (found === undefined){
            const inside = roots.filter((r) => contains(r, folder)).sort((a, b) => depthOf(b) - depthOf(a));
            found = { inside, outside: roots.filter((r) => !contains(r, folder)) };
            rootsByFolder.set(folder, found);
        }
        return found;
    };

    /** An absolute module from a folder: the containing roots, deepest first; else exactly one hit among the others. */
    const absoluteCache = new Map<string, string | null>();
    const absolute = (folder: string, dotted: string): string | null => {
        const key = `${folder}\0${dotted}`;
        if (absoluteCache.has(key)) return absoluteCache.get(key)!;
        const { inside, outside } = rootsFor(folder);
        let target: string | null = null;
        for (const root of inside){
            target = moduleUnder(root, dotted);
            if (target !== null) break;
        }
        if (target === null){
            const hits = outside.map((root) => moduleUnder(root, dotted)).filter((t): t is string => t !== null);
            target = hits.length === 1 ? hits[0] : null;
        }
        absoluteCache.set(key, target);
        return target;
    };

    /** The file a specifier names, or null. */
    const target = (importer: string, specifier: string): string | null => {
        const colon = specifier.indexOf(":");
        const source = colon === -1 ? specifier : specifier.slice(0, colon);
        const name = colon === -1 ? null : specifier.slice(colon + 1);

        const dots = /^\.*/.exec(source)![0].length;
        if (dots === 0){
            if (!DOTTED_NAME.test(source)) return null;
            const folder = dirOf(importer);
            if (name !== null && name !== "*"){
                const submodule = absolute(folder, `${source}.${name}`);
                if (submodule !== null) return submodule;
            }
            return absolute(folder, source);
        }

        let base = dirOf(importer);
        for (let up = 1; up < dots; up++){
            if (base === "") return null;   // more dots than folders: past the repo root
            base = dirOf(base);
        }
        const rest = source.slice(dots);
        if (rest !== "" && !DOTTED_NAME.test(rest)) return null;
        if (name !== null && name !== "*"){
            const submodule = moduleUnder(base, rest === "" ? name : `${rest}.${name}`);
            if (submodule !== null) return submodule;
        }
        if (rest !== "") return moduleUnder(base, rest);
        // `from . import c` with no module c: the names come from the package itself
        const init = base === "" ? "__init__" : `${base}/__init__`;
        return files.has(`${init}.py`) ? `${init}.py` : files.has(`${init}.pyi`) ? `${init}.pyi` : null;
    };

    const resolve = (importer: string, specifier: string): string[] => {
        const found = target(importer, specifier);
        return found === null ? [] : [found];
    };

    return {
        resolve,
        kindOf(importer: string, specifier: string): ReferenceKind {
            if (specifier.startsWith(".") || target(importer, specifier) !== null) return "internal";
            const first = /^[^.:]*/.exec(specifier)![0];
            return internalNames.has(first) ? "internal" : "external";
        },
        classOf: (_importer: string, specifier: string): string => (specifier.startsWith(".") ? "relative" : "absolute"),
        entryPoints(){
            const declared = new Map<string, string>();
            const add = (file: string, declaredBy: string): void => {
                if (!declared.has(file)) declared.set(file, declaredBy);
            };
            for (const script of scripts){
                const folder = dirOf(script.manifest);
                const file = moduleUnder(folder, script.module) ?? moduleUnder(folder === "" ? "src" : `${folder}/src`, script.module)
                    ?? absolute(folder, script.module);
                if (file !== null) add(file, script.declaredBy);
            }
            const sorted = [...ctx.files.keys()].sort(compare);
            for (const file of sorted) if (/(^|\/)__main__\.py$/.test(file)) add(file, "__main__.py");
            for (const file of sorted) if (ctx.files.get(file)!.declares.includes("__main__")) add(file, "if __name__ == \"__main__\"");
            return [...declared].map(([path, declaredBy]) => ({ path, declaredBy })).sort((a, b) => compare(a.path, b.path));
        },
    };
}
