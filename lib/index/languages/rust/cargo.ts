import { parse as parseToml } from "smol-toml";
import { dirOf, joinRepoPath } from "../../paths";
import type { ResolveContext } from "../adapter";
import { CARGO_MANIFEST, rustRules } from "./rules";

/**
 * What Rust's resolution reads from the Cargo.toml files (the E4 plan's Task R): each crate (a manifest with a
 * [package]), its targets as the manifest declares them, and the names its dependencies are known by in its code.
 * Read once per manifest set and kept in the resolution cache (ctx.cache, emptied when a manifest changes).
 */

/** A target the manifest names explicitly ([[bin]], [[test]], [[example]], [[bench]]). */
type NamedTarget = { name: string | null; path: string | null };

export type CrateManifest = {
    /** The Cargo.toml, repo-relative. */
    manifest: string;
    /** Its folder ("" at the repo root). */
    dir: string;
    packageName: string;
    /** `[lib] name`, else the package name with `-` replaced by `_`: how other crates' code names this one. */
    libName: string;
    /** `[lib] path`, repo-relative, or null for the default src/lib.rs. */
    libPath: string | null;
    /** package.build: a path, false for none, or null for the default build.rs. */
    build: string | false | null;
    bins: NamedTarget[];
    tests: NamedTarget[];
    examples: NamedTarget[];
    benches: NamedTarget[];
    /** package.autobins and its kin (false turns Cargo's target discovery off for that kind). */
    auto: { bins: boolean; tests: boolean; examples: boolean; benches: boolean };
    /** A renamed dependency: the name its code uses (`store`) → the package it is (`shop-store`). */
    renames: Map<string, string>;
    /**
     * Every package it depends on (renamed or not), of every kind pooled: the crates its code can name (Cargo's extern
     * prelude, ADR-065), and so also what tells apart two crates with one library name.
     */
    dependencies: Set<string>;
};

const CACHE_KEY = "rust:crates";
const DEPENDENCY_TABLES = ["dependencies", "dev-dependencies", "build-dependencies", "dev_dependencies", "build_dependencies"];

type Table = Record<string, unknown>;
const tableOf = (value: unknown): Table | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Table) : null);
const stringOf = (value: unknown): string | null => (typeof value === "string" ? value : null);
/** A dependency key as code writes it: `shop-core` is `shop_core`. */
const codeName = (key: string): string => key.replace(/-/g, "_");

/** Every crate the manifests declare, sorted by manifest path; a manifest under a folder Rust leaves out (target/) is ignored. */
export function readCrates(ctx: Pick<ResolveContext, "manifests" | "readText" | "cache">): CrateManifest[] {
    const cached = ctx.cache.get(CACHE_KEY);
    if (cached !== undefined) return cached as CrateManifest[];

    const excluded = rustRules.excluded(ctx.manifests);
    const parsed: { manifest: string; toml: Table }[] = [];
    for (const manifest of ctx.manifests){
        if (!CARGO_MANIFEST.test(manifest) || excluded(manifest)) continue;
        const text = ctx.readText(manifest);
        if (text === null) continue;
        try{
            parsed.push({ manifest, toml: parseToml(text) as Table });
        } catch{
            // a Cargo.toml that isn't TOML declares nothing
        }
    }

    // [workspace.dependencies] renames, by workspace folder: a member's `foo = { workspace = true }` inherits them
    const workspaceRenames = new Map<string, Map<string, string>>();
    for (const { manifest, toml } of parsed){
        const deps = tableOf(tableOf(toml.workspace)?.dependencies);
        if (deps !== null) workspaceRenames.set(dirOf(manifest), dependencyNames(deps, null).renames);
    }

    const crates: CrateManifest[] = [];
    for (const { manifest, toml } of parsed){
        const pkg = tableOf(toml.package);
        const packageName = stringOf(pkg?.name);
        if (pkg === null || packageName === null) continue;
        const dir = dirOf(manifest);
        const lib = tableOf(toml.lib);
        const inherited = nearestWorkspace(dir, workspaceRenames);

        const renames = new Map<string, string>();
        const dependencies = new Set<string>();
        for (const deps of dependencyTablesOf(toml)){
            const names = dependencyNames(deps, inherited);
            for (const [name, target] of names.renames) renames.set(name, target);
            for (const target of names.packages) dependencies.add(target);
        }

        const buildValue = pkg.build;
        crates.push({
            manifest,
            dir,
            packageName,
            libName: stringOf(lib?.name) ?? codeName(packageName),
            libPath: stringOf(lib?.path) === null ? null : joinRepoPath(dir, stringOf(lib?.path)!),
            build: buildValue === false ? false : stringOf(buildValue) === null ? null : joinRepoPath(dir, stringOf(buildValue)!),
            bins: namedTargets(toml.bin, dir),
            tests: namedTargets(toml.test, dir),
            examples: namedTargets(toml.example, dir),
            benches: namedTargets(toml.bench, dir),
            auto: { bins: pkg.autobins !== false, tests: pkg.autotests !== false, examples: pkg.autoexamples !== false, benches: pkg.autobenches !== false },
            renames,
            dependencies,
        });
    }

    crates.sort((a, b) => (a.manifest < b.manifest ? -1 : a.manifest > b.manifest ? 1 : 0));
    ctx.cache.set(CACHE_KEY, crates);
    return crates;
}

/** [dependencies], [dev-dependencies], [build-dependencies], and each [target.<cfg>.…] one. */
function dependencyTablesOf(toml: Table): Table[] {
    const tables: Table[] = [];
    const add = (owner: Table | null): void => {
        for (const key of DEPENDENCY_TABLES){
            const deps = tableOf(owner?.[key]);
            if (deps !== null) tables.push(deps);
        }
    };
    add(toml);
    for (const target of Object.values(tableOf(toml.target) ?? {})) add(tableOf(target));
    return tables;
}

/**
 * One dependency table's names: `store = { package = "shop-store" }` renames (code name `store` → package shop-store);
 * `store = { workspace = true }` takes the workspace's rename of that key, if it has one. Every entry's package is listed.
 */
function dependencyNames(deps: Table, inherited: Map<string, string> | null): { renames: Map<string, string>; packages: string[] } {
    const renames = new Map<string, string>();
    const packages: string[] = [];
    for (const [key, value] of Object.entries(deps)){
        const entry = tableOf(value);
        const renamed = stringOf(entry?.package) ?? (entry?.workspace === true ? inherited?.get(codeName(key)) ?? null : null);
        if (renamed !== null) renames.set(codeName(key), renamed);
        packages.push(renamed ?? key);
    }
    return { renames, packages };
}

/** The renames of the nearest workspace at or above a crate's folder. */
function nearestWorkspace(dir: string, workspaces: ReadonlyMap<string, Map<string, string>>): Map<string, string> | null {
    for (let at: string | null = dir; at !== null; at = at === "" ? null : dirOf(at)){
        const found = workspaces.get(at);
        if (found !== undefined) return found;
    }
    return null;
}

function namedTargets(value: unknown, dir: string): NamedTarget[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        const target = tableOf(entry);
        if (target === null) return [];
        const path = stringOf(target.path);
        return [{ name: stringOf(target.name), path: path === null ? null : joinRepoPath(dir, path) }];
    });
}
