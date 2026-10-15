/**
 * The eval's own resolver for the specifiers a relative path doesn't explain (R2 of V1.6's plan): a second implementation
 * of ADR-053's rules, written from the ADR's text in docs/ENGINEERING_DECISIONS.md and never from the index's code, so a
 * mistake in one shows up as a difference between the truth and the index instead of hiding in both. It imports nothing
 * from lib/.
 *
 * A bare specifier, in turn:
 * 1. names one of the repo's own packages: the root package, or one in a folder the repo declares as a workspace (the root
 *    package.json's workspaces, pnpm-workspace.yaml's packages, lerna.json's packages). It resolves inside that package
 *    through its exports, then main, module, types, typings, src/index and index (no subpath), or the subpath itself and
 *    src/<subpath>. Every candidate tries its own path, then the compiled → source mappings tsconfigs give (outDir → rootDir);
 * 2. names a package the repo has but doesn't declare: nothing. Package managers link only declared workspaces, so an
 *    undeclared folder's name stands for the npm package of that name, and isn't read as a module id either;
 * 3. else, with two or more segments, not starting with @ and naming no protocol, is a module id: read against each folder
 *    holding a tsconfig*.json (folders inside test, fixture and example folders left out), it resolves when exactly one
 *    file is found.
 * File names follow scan.ts's resolvePath, the extensions the regex scanner already uses.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listFiles, resolvePath, resolveRelative, type ResolveBare } from "./scan";

type PackageJson = Record<string, unknown>;
type Package = { name: string; folder: string; json: PackageJson };
type Mapping = { compiled: string; source: string };

/** Export conditions, tried in this order (ADR-053). */
const CONDITIONS = ["source", "types", "typings", "import", "module", "default", "require", "node", "browser"];
/** Folder names that mark test, fixture and example code (with their plurals and __dunder__ forms). */
const TEST_LIKE = /^(?:__)?(?:tests?|fixtures?|examples?)(?:__)?$/i;
const PROTOCOL = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const inside = (p: string, folder: string): boolean => folder === "" || p === folder || p.startsWith(`${folder}/`);
const folderOf = (file: string): string => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const depth = (folder: string): number => (folder === "" ? 0 : folder.split("/").length);
const isTestLike = (folder: string): boolean => folder !== "" && folder.split("/").some((s) => TEST_LIKE.test(s));
const inNodeModules = (file: string): boolean => file.split("/").includes("node_modules");

/** A path joined below a folder as a repo path ("" the root), or null when it climbs out of the repo. */
function join(folder: string, relative: string): string | null {
    const joined = path.posix.normalize(path.posix.join(folder, relative)).replace(/\/+$/, "");
    if (joined === "..") return null;
    if (joined.startsWith("../") || joined.startsWith("/")) return null;
    return joined === "." ? "" : joined;
}

function readJson(root: string, file: string): PackageJson | null {
    try {
        const value: unknown = JSON.parse(fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, ""));
        return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as PackageJson) : null;
    } catch {
        return null;
    }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/**
 * pnpm-workspace.yaml's packages list, read line by line (no YAML parser): the block list under a top-level `packages:`
 * key (or a one-line [a, b] list), quotes and comments dropped, ending at the next top-level key.
 */
export function pnpmWorkspaceGlobs(text: string): string[] {
    const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, "$2");
    const globs: string[] = [];
    let inPackages = false;
    for (const raw of text.split(/\r?\n/)){
        const line = raw.replace(/(^|\s)#.*$/, "");
        if (line.trim() === "") continue;
        if (/^\S/.test(line)){
            const flow = /^packages\s*:\s*\[(.*)\]\s*$/.exec(line);
            if (flow) globs.push(...flow[1].split(",").map(unquote).filter((g) => g !== ""));
            inPackages = /^packages\s*:\s*$/.test(line);
            continue;
        }
        const item = /^\s*-\s*(.+?)\s*$/.exec(line);
        if (inPackages && item) globs.push(unquote(item[1]));
    }
    return globs;
}

/** A workspace glob as a test of a folder: `*` one folder name (or part of one), `**` any number of folders. */
function globTest(glob: string): RegExp {
    const escape = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const parts = glob.replace(/^\.\//, "").split("/").filter((p) => p !== "" && p !== ".");
    const body = parts.map((p) => (p === "**" ? "(?:[^/]+/)*" : `${p.split("*").map(escape).join("[^/]*")}/`)).join("");
    return new RegExp(`^${body}$`);
}

/** Whether a folder is a declared workspace: some glob covers it and no ! glob takes it back out. */
function declaredBy(globs: readonly string[]): (folder: string) => boolean {
    const include = globs.filter((g) => !g.startsWith("!")).map(globTest);
    const exclude = globs.filter((g) => g.startsWith("!")).map((g) => globTest(g.slice(1)));
    return (folder) => include.some((r) => r.test(`${folder}/`)) && !exclude.some((r) => r.test(`${folder}/`));
}

/** The repo's workspace globs: the root package.json's workspaces (a list, or yarn's object), pnpm's and lerna's. */
function workspaceGlobs(root: string, all: ReadonlySet<string>, rootJson: PackageJson | null): string[] {
    const workspaces = rootJson?.workspaces;
    const globs = Array.isArray(workspaces) ? strings(workspaces)
        : workspaces !== null && typeof workspaces === "object" ? strings((workspaces as PackageJson).packages) : [];
    if (all.has("pnpm-workspace.yaml")) globs.push(...pnpmWorkspaceGlobs(fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")));
    if (all.has("lerna.json")) globs.push(...strings(readJson(root, "lerna.json")?.packages));
    return globs;
}

/** The targets an exports field gives a subpath ("" for the package itself), exact key first, else the longest * pattern. */
function exportTargets(exports: unknown, subpath: string): string[] {
    const key = subpath === "" ? "." : `./${subpath}`;
    let map: PackageJson;
    if (typeof exports === "string" || Array.isArray(exports)) map = { ".": exports };
    else if (exports !== null && typeof exports === "object"){
        const keys = Object.keys(exports);
        map = keys.length > 0 && keys.every((k) => k.startsWith(".")) ? (exports as PackageJson) : { ".": exports };
    } else return [];
    if (Object.prototype.hasOwnProperty.call(map, key)) return targetsOf(map[key], null);
    let best: { prefix: number; star: string; value: unknown } | null = null;
    for (const [pattern, value] of Object.entries(map)){
        const star = pattern.indexOf("*");
        if (star < 0 || pattern.indexOf("*", star + 1) >= 0) continue;
        const [prefix, suffix] = [pattern.slice(0, star), pattern.slice(star + 1)];
        if (key.length < prefix.length + suffix.length || !key.startsWith(prefix) || !key.endsWith(suffix)) continue;
        if (best === null || prefix.length > best.prefix) best = { prefix: prefix.length, star: key.slice(prefix.length, key.length - suffix.length), value };
    }
    return best === null ? [] : targetsOf(best.value, best.star);
}

/** An export's value as target paths: a string, a list of fallbacks, or conditions tried in CONDITIONS's order. */
function targetsOf(value: unknown, star: string | null): string[] {
    if (typeof value === "string") return [star === null ? value : value.split("*").join(star)];
    if (Array.isArray(value)) return value.flatMap((v) => targetsOf(v, star));
    if (value !== null && typeof value === "object"){
        const conditions = value as PackageJson;
        return CONDITIONS.filter((c) => Object.prototype.hasOwnProperty.call(conditions, c)).flatMap((c) => targetsOf(conditions[c], star));
    }
    return [];
}

/**
 * A resolver for the repo at `root` whose code files are `files`: relative specifiers by scan.ts's resolveRelative, any
 * other by ADR-053's rules (above). It reads the repo's package.json, tsconfig*.json, pnpm-workspace.yaml and lerna.json
 * (outside node_modules) once; a bare specifier's answer doesn't depend on the importing file, so each is worked out once.
 */
export function createTruthResolver(root: string, files: readonly string[]): ResolveBare {
    const known = new Set(files);
    const all = new Set(listFiles(root).filter((f) => !inNodeModules(f)));

    // packages: every package.json with a name; only the root and declared workspaces resolve by name
    const manifests = [...all].filter((f) => f === "package.json" || f.endsWith("/package.json")).sort(byPath);
    const rootJson = all.has("package.json") ? readJson(root, "package.json") : null;
    const declared = declaredBy(workspaceGlobs(root, all, rootJson));
    const everyName = new Set<string>();
    const candidates = new Map<string, Package[]>();
    for (const manifest of manifests){
        const json = manifest === "package.json" ? rootJson : readJson(root, manifest);
        if (json === null || typeof json.name !== "string" || json.name === "") continue;
        const folder = folderOf(manifest);
        everyName.add(json.name);
        if (folder === "" || declared(folder)) candidates.set(json.name, [...(candidates.get(json.name) ?? []), { name: json.name, folder, json }]);
    }
    // a name two declared packages share: one outside test, fixture and example folders, then the shallower, then path order
    const packages = new Map<string, Package>();
    for (const [name, list] of candidates){
        const rank = (p: Package): [number, number, string] => [isTestLike(p.folder) ? 1 : 0, depth(p.folder), p.folder];
        packages.set(name, [...list].sort((a, b) => {
            const [x, y] = [rank(a), rank(b)];
            return x[0] - y[0] || x[1] - y[1] || byPath(x[2], y[2]);
        })[0]);
    }

    // tsconfigs: their folders are the id roots (not inside test, fixture and example folders), and outDir → rootDir mappings
    const idRoots: string[] = [];
    const mappings: Mapping[] = [];
    for (const config of [...all].filter((f) => /^tsconfig[^/]*\.json$/.test(f.slice(f.lastIndexOf("/") + 1))).sort(byPath)){
        const folder = folderOf(config);
        if (!isTestLike(folder) && !idRoots.includes(folder)) idRoots.push(folder);
        const read = ts.readConfigFile(path.join(root, config), (p) => fs.readFileSync(p, "utf8"));
        const options = (read.config as { compilerOptions?: { outDir?: unknown; rootDir?: unknown } } | undefined)?.compilerOptions;
        if (typeof options?.outDir !== "string" || typeof options.rootDir !== "string") continue;
        const [compiled, source] = [join(folder, options.outDir), join(folder, options.rootDir)];
        if (compiled !== null && source !== null && compiled !== source) mappings.push({ compiled, source });
    }
    // the deepest compiled folder first, so a nested outDir wins over its parent's
    mappings.sort((a, b) => depth(b.compiled) - depth(a.compiled) || byPath(a.compiled, b.compiled));

    /** A candidate path as a file: its own path first, then the path each mapping gives it. */
    const find = (base: string | null): string | null => {
        if (base === null) return null;
        const own = resolvePath(base, known);
        if (own !== null) return own;
        for (const m of mappings){
            if (!inside(base, m.compiled)) continue;
            const rest = m.compiled === "" ? base : base === m.compiled ? "" : base.slice(m.compiled.length + 1);
            const mapped = resolvePath(m.source === "" ? rest : rest === "" ? m.source : `${m.source}/${rest}`, known);
            if (mapped !== null) return mapped;
        }
        return null;
    };

    const inPackage = (pkg: Package, subpath: string): string | null => {
        for (const target of exportTargets(pkg.json.exports, subpath)){
            const found = find(join(pkg.folder, target));
            if (found !== null) return found;
        }
        const fields = ["main", "module", "types", "typings"].map((f) => pkg.json[f]).filter((v): v is string => typeof v === "string");
        const bases = subpath === "" ? [...fields, "src/index", "index"] : [subpath, `src/${subpath}`];
        for (const base of bases){
            const found = find(join(pkg.folder, base));
            if (found !== null) return found;
        }
        return null;
    };

    const moduleId = (specifier: string): string | null => {
        const found = new Set<string>();
        for (const idRoot of idRoots){
            const file = find(join(idRoot, specifier));
            if (file !== null) found.add(file);
        }
        return found.size === 1 ? [...found][0] : null;
    };

    const bare = (specifier: string): string | null => {
        if (specifier.startsWith("/") || PROTOCOL.test(specifier)) return null;
        const segments = specifier.split("/").filter((s) => s !== "");
        const nameLength = specifier.startsWith("@") ? 2 : 1;
        const name = segments.slice(0, nameLength).join("/");
        const pkg = packages.get(name);
        if (pkg !== undefined) return inPackage(pkg, segments.slice(nameLength).join("/"));
        if (everyName.has(name) || specifier.startsWith("@") || segments.length < 2) return null;
        return moduleId(segments.join("/"));
    };

    const cache = new Map<string, string | null>();
    return (fromFile, specifier) => {
        if (specifier.startsWith(".")) return resolveRelative(fromFile, specifier, known);
        if (!cache.has(specifier)) cache.set(specifier, bare(specifier));
        return cache.get(specifier)!;
    };
}
