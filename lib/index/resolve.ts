import fs from "fs";
import path from "path";
import ts from "typescript";
import { dirOf, joinRepoPath, normalizeSlashes } from "./paths";
import { EMPTY_WORKSPACE, packageNameOf, type Workspace, type WorkspacePackage } from "./workspace";
import type { ImportEdge } from "../db/store/structure";

/** Tried, in order, after a specifier that names no file directly. */
const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** NodeNext style: the source imports "./x.js" but the file on disk is x.ts. */
const JS_TO_TS: Record<string, string[]> = {
    ".js": [".ts", ".tsx", ".d.ts"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
};

type PathPattern = { prefix: string; suffix: string; exact: boolean; targets: string[] };

/** What one tsconfig contributes to resolution. All paths are repo-relative. */
type PathsConfig = { baseDir: string | null; patterns: PathPattern[] };

/** importer + specifier → the repo file it points at, or null (a package, outside the repo, or missing). */
export type Resolver = (importer: string, specifier: string) => string | null;

export type ResolverOptions = { workspace?: Workspace };

/** A path as written to the file it names: itself, NodeNext .js → .ts, an added extension, or a folder's index file. */
function findFile(fileSet: ReadonlySet<string>, base: string): string | null {
    if (fileSet.has(base)) return base;

    for (const [js, tsExtensions] of Object.entries(JS_TO_TS)){
        if (!base.endsWith(js)) continue;
        const stem = base.slice(0, -js.length);
        for (const ext of tsExtensions) if (fileSet.has(stem + ext)) return stem + ext;
    }

    for (const ext of EXTENSIONS) if (fileSet.has(base + ext)) return base + ext;

    const indexPrefix = base === "" ? "index" : `${base}/index`;
    for (const ext of EXTENSIONS) if (fileSet.has(indexPrefix + ext)) return indexPrefix + ext;

    return null;
}

/**
 * A path as written (an import's target, a package.json's main) to the source file the repo has for it: the path
 * itself (with extensions, NodeNext .js → .ts, index files), else its compiled folder mapped to the source folder
 * (packages/core/lib/log → packages/core/src/log) through the workspace's outDir mappings (ADR-053).
 */
export function createSourceFinder(fileSet: ReadonlySet<string>, workspace: Workspace = EMPTY_WORKSPACE): (base: string) => string | null {
    return (base) => {
        const direct = findFile(fileSet, base);
        if (direct !== null) return direct;
        for (const { outDir, rootDir } of workspace.outDirs){
            if (base === outDir || base.startsWith(`${outDir}/`)) return findFile(fileSet, rootDir + base.slice(outDir.length));
        }
        return null;
    };
}

/** The paths a bare specifier can mean inside a workspace package: its exports, then its main fields or its own folders. */
function packageCandidates(workspace: Workspace, specifier: string): string[] {
    const name = packageNameOf(specifier);
    const pkg = workspace.byName.get(name);
    if (!pkg) return [];
    const sub = specifier.slice(name.length).replace(/^\//, "");
    const at = (target: string): string[] => {
        const joined = joinRepoPath(pkg.dir, target);
        return joined === null ? [] : [joined];
    };
    const key = sub === "" ? "." : `./${sub}`;
    const candidates = [...exportTargets(pkg, key).flatMap(at)];
    if (sub === "") candidates.push(...pkg.mains.flatMap((m) => at(m.target)), ...at("src/index"), ...at("index"));
    else candidates.push(...at(sub), ...at(`src/${sub}`));
    return candidates;
}

/** An exports key's targets: the exact key, else the first "*" pattern it fits, with the star filled in. */
function exportTargets(pkg: WorkspacePackage, key: string): string[] {
    const exact = pkg.exports.get(key);
    if (exact) return exact;
    for (const [pattern, targets] of pkg.exports){
        const star = pattern.indexOf("*");
        if (star === -1) continue;
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length){
            const middle = key.slice(prefix.length, key.length - suffix.length);
            return targets.map((t) => t.replace("*", middle));
        }
    }
    return [];
}

export function createResolver(repoRoot: string, fileSet: ReadonlySet<string>, options: ResolverOptions = {}): Resolver {
    const workspace = options.workspace ?? EMPTY_WORKSPACE;
    const sourceFor = createSourceFinder(fileSet, workspace);

    // nearest-tsconfig lookups are cached per directory: VS Code has ~15k files but few tsconfigs
    const configByDir = new Map<string, PathsConfig | null>();

    const nearestConfig = (dir: string): PathsConfig | null => {
        const cached = configByDir.get(dir);
        if (cached !== undefined) return cached;

        const configFile = dir === "" ? "tsconfig.json" : `${dir}/tsconfig.json`;
        const config = fs.existsSync(path.join(repoRoot, configFile))
            ? loadPathsConfig(repoRoot, configFile, new Set())
            : dir === "" ? null : nearestConfig(dirOf(dir));

        configByDir.set(dir, config);
        return config;
    };

    /** A module id read against the folders that hold a tsconfig (R3): the one file exactly one of them holds, or null. */
    const moduleId = (importer: string, specifier: string): string | null => {
        if (specifier.startsWith("@") || /^[a-z][a-z0-9+.-]*:/i.test(specifier) || !specifier.includes("/")) return null;
        let found: string | null = null;
        for (const root of workspace.idRoots){
            const base = joinRepoPath(root, specifier);
            const hit = base === null ? null : findFile(fileSet, base);
            if (hit === null || hit === importer || hit === found) continue;
            if (found !== null) return null;   // two roots hold it: not one file the id can mean
            found = hit;
        }
        return found;
    };

    return (importer, rawSpecifier) => {
        const specifier = normalizeSlashes(rawSpecifier);
        const isRelative = specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
        const candidates: string[] = [];

        if (isRelative){
            const joined = joinRepoPath(dirOf(importer), specifier);
            if (joined !== null) candidates.push(joined);
        } else{
            const config = nearestConfig(dirOf(importer));
            if (config) candidates.push(...aliasCandidates(config, specifier));
            candidates.push(...packageCandidates(workspace, specifier));
        }

        for (const base of candidates){
            const hit = sourceFor(base);
            if (hit !== null && hit !== importer) return hit;   // a file importing itself is no edge
        }

        return isRelative ? null : moduleId(importer, specifier);
    };
}

type RawTsconfig = { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };

/**
 * Reads a tsconfig with TypeScript's own reader, which accepts comments and trailing
 * commas (ADR-016's JSONC gap). It follows a relative `extends` chain because
 * monorepo packages usually inherit `paths` from a shared base config.
 */
function loadPathsConfig(repoRoot: string, configRel: string, seen: Set<string>): PathsConfig | null {
    if (seen.has(configRel)) return null;   // extends cycle
    seen.add(configRel);

    // TypeScript's API expects forward slashes: given a Windows path, readConfigFile
    // throws an internal "Debug Failure" on malformed JSON instead of returning `error`
    const configPath = normalizeSlashes(path.join(repoRoot, configRel));
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error || !config) return null;

    const raw = config as RawTsconfig;
    const configDir = dirOf(configRel);
    const options = raw.compilerOptions ?? {};

    let inherited: PathsConfig | null = null;
    if (typeof raw.extends === "string" && raw.extends.startsWith(".")){
        let parentRel = joinRepoPath(configDir, raw.extends);
        if (parentRel !== null){
            if (!parentRel.endsWith(".json")) parentRel += ".json";
            inherited = loadPathsConfig(repoRoot, parentRel, seen);
        }
    }

    // baseUrl resolves against the config that declares it; a child without one inherits the parent's
    const ownBaseDir = typeof options.baseUrl === "string" ? joinRepoPath(configDir, options.baseUrl) : null;
    const baseDir = ownBaseDir ?? inherited?.baseDir ?? null;

    // `paths` replaces the parent's wholesale (tsconfig merges compilerOptions shallowly).
    // Its targets resolve against baseUrl when there is one, else against this config's folder.
    const patterns = options.paths && typeof options.paths === "object"
        ? parsePatterns(options.paths as Record<string, unknown>, baseDir ?? configDir)
        : inherited?.patterns ?? [];

    if (baseDir === null && patterns.length === 0) return null;
    return { baseDir, patterns };
}

function parsePatterns(paths: Record<string, unknown>, targetBase: string): PathPattern[] {
    const patterns: PathPattern[] = [];

    for (const [pattern, targets] of Object.entries(paths)){
        if (!Array.isArray(targets)) continue;

        const resolvedTargets = targets
            .filter((t): t is string => typeof t === "string")
            .map((t) => joinRepoPath(targetBase, t))   // a "*" survives as part of its segment
            .filter((t): t is string => t !== null);

        const star = pattern.indexOf("*");
        patterns.push(star === -1
            ? { prefix: pattern, suffix: "", exact: true, targets: resolvedTargets }
            : { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), exact: false, targets: resolvedTargets });
    }

    return patterns;
}

function aliasCandidates(config: PathsConfig, specifier: string): string[] {
    const candidates: string[] = [];

    for (const p of config.patterns){
        if (p.exact){
            if (specifier === p.prefix) candidates.push(...p.targets);
            continue;
        }

        const fits = specifier.startsWith(p.prefix)
            && specifier.endsWith(p.suffix)
            && specifier.length >= p.prefix.length + p.suffix.length;

        if (fits){
            const middle = specifier.slice(p.prefix.length, specifier.length - p.suffix.length);
            candidates.push(...p.targets.map((t) => t.replace("*", middle)));
        }
    }

    // baseUrl also lets bare specifiers resolve from it (older VS Code: "vs/base/common/uri")
    if (config.baseDir !== null){
        const fromBase = joinRepoPath(config.baseDir, specifier);
        if (fromBase !== null) candidates.push(fromBase);
    }

    return candidates;
}

/**
 * One file's import edges: each specifier resolved, one edge per target file, the first specifier that reaches it
 * naming it. The full run and the incremental update both build edges here, so they can't disagree.
 */
export function edgesFrom(resolve: Resolver, source: string, specifiers: readonly string[]): ImportEdge[] {
    const seen = new Set<string>();
    const edges: ImportEdge[] = [];

    for (const specifier of specifiers){
        const target = resolve(source, specifier);
        if (target === null || seen.has(target)) continue;   // one edge per file pair
        seen.add(target);
        edges.push({ source, target, specifier });
    }

    return edges;
}
