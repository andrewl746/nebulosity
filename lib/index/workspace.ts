import fs from "fs";
import path from "path";
import ts from "typescript";
import { dirOf, joinRepoPath, normalizeSlashes } from "./paths";

/** One package of the repo's own: a package.json in the repo, outside node_modules (ADR-053). */
export type WorkspacePackage = {
    name: string;
    /** Its folder, repo-relative ("" for the root package). */
    dir: string;
    /** `exports` flattened: "." or "./sub" or "./sub/*" → the targets to try, conditions in CONDITIONS order. */
    exports: Map<string, string[]>;
    /** main, module, types, typings: those present, in that order, each with its field's name. */
    mains: { field: string; target: string }[];
    /** bin targets, in the bin names' order. */
    bins: string[];
};

/** A compiled folder and the source folder it's built from: a tsconfig that sets both outDir and rootDir. */
export type OutDirMapping = { outDir: string; rootDir: string };

export type Workspace = {
    /**
     * The packages a bare specifier may name, one per name: the root package and those in the repo's declared
     * workspaces. An undeclared folder never captures a name, as npm, yarn and pnpm never link one (ADR-053).
     */
    byName: ReadonlyMap<string, WorkspacePackage>;
    /** Every package.json in the repo that has a name, declared or not, by folder: what entry points are read from (R8). */
    packages: readonly WorkspacePackage[];
    /** Folders that hold a tsconfig*.json, outside test, fixture and example folders: what a module id is read against (R3). Sorted. */
    idRoots: readonly string[];
    /** Longest outDir first, so a nested one wins over its parent. */
    outDirs: readonly OutDirMapping[];
};

export const EMPTY_WORKSPACE: Workspace = { byName: new Map(), packages: [], idRoots: [], outDirs: [] };

/** An exports entry's conditions, in the order tried: the source first, then what TypeScript and bundlers read. */
const CONDITIONS = ["source", "types", "typings", "import", "module", "default", "require", "node", "browser"];
/** Folders a second copy of a package's name usually comes from (Review Focus 1). */
const NOT_REAL = /(^|\/)(test|tests|__tests__|fixtures?|__fixtures__|examples?|samples?)(\/|$)/;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const depth = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);

/** The package a bare specifier names: "@scope/name" with its scope, else the first segment. */
export function packageNameOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function readWorkspace(repoRoot: string, manifests: readonly string[]): Workspace {
    const packages: WorkspacePackage[] = [];
    const idRoots = new Set<string>();
    const outDirs: OutDirMapping[] = [];
    let rootManifest: PackageJson | null = null;

    for (const rel of manifests){
        const dir = dirOf(rel);
        if (rel === "package.json" || rel.endsWith("/package.json")){
            const pkg = readJson(path.join(repoRoot, rel));
            if (rel === "package.json") rootManifest = pkg;
            if (pkg && typeof pkg.name === "string" && pkg.name !== "") packages.push(toPackage(pkg, dir));
        } else{
            // a tsconfig inside a test, fixture or example folder describes that sample, not the repo's own code
            if (!NOT_REAL.test(dir)) idRoots.add(dir);
            const mapping = readOutDir(repoRoot, rel);
            if (mapping) outDirs.push(mapping);
        }
    }

    // only the root package and the declared workspaces may be named; in preference order, so the first of each name
    // wins: real folders, then shallower, then path order
    const declared = declaredWorkspaces(repoRoot, rootManifest);
    const nameable = packages.filter((p) => p.dir === "" || declared(p.dir));
    nameable.sort((a, b) => Number(NOT_REAL.test(a.dir)) - Number(NOT_REAL.test(b.dir)) || depth(a.dir) - depth(b.dir) || compare(a.dir, b.dir));
    const byName = new Map<string, WorkspacePackage>();
    for (const p of nameable) if (!byName.has(p.name)) byName.set(p.name, p);

    packages.sort((a, b) => compare(a.dir, b.dir));
    outDirs.sort((a, b) => b.outDir.length - a.outDir.length || compare(a.outDir, b.outDir));
    return { byName, packages, idRoots: [...idRoots].sort(compare), outDirs };
}

type PackageJson = Record<string, unknown>;

function readJson(file: string): PackageJson | null {
    try{
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PackageJson : null;
    } catch{
        return null;   // missing, unreadable or not JSON: not a package we can use
    }
}

function readText(file: string): string | null {
    try{
        return fs.readFileSync(file, "utf8");
    } catch{
        return null;
    }
}

function toPackage(pkg: PackageJson, dir: string): WorkspacePackage {
    const mains = ["main", "module", "types", "typings"]
        .filter((field) => typeof pkg[field] === "string" && pkg[field] !== "")
        .map((field) => ({ field, target: pkg[field] as string }));
    const bin = pkg.bin;
    const bins = typeof bin === "string" ? [bin]
        : bin !== null && typeof bin === "object" ? Object.keys(bin).sort(compare).map((k) => (bin as Record<string, unknown>)[k]).filter((v): v is string => typeof v === "string")
        : [];
    return { name: pkg.name as string, dir, exports: flattenExports(pkg.exports), mains, bins };
}

/** `exports` as subpath → targets: a string is "."'s, a map of subpaths keeps its keys, a map of conditions is "."'s. */
export function flattenExports(value: unknown): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (typeof value === "string" || Array.isArray(value)) out.set(".", targetsOf(value));
    else if (value !== null && typeof value === "object"){
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length > 0 && entries.every(([key]) => key.startsWith("."))) for (const [key, entry] of entries) out.set(key, targetsOf(entry));
        else out.set(".", targetsOf(value));
    }
    for (const [key, targets] of out) if (targets.length === 0) out.delete(key);
    return out;
}

/** One exports entry's file targets, conditions in CONDITIONS order (others after, as written), nested ones flattened. */
function targetsOf(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(targetsOf);
    if (value === null || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const rank = (condition: string): number => {
        const at = CONDITIONS.indexOf(condition);
        return at === -1 ? CONDITIONS.length : at;
    };
    return Object.keys(record).sort((a, b) => rank(a) - rank(b)).flatMap((key) => targetsOf(record[key]));
}

/** A tsconfig's own outDir and rootDir, both repo-relative, when it sets both (an extends chain isn't followed). */
function readOutDir(repoRoot: string, configRel: string): OutDirMapping | null {
    const { config, error } = ts.readConfigFile(normalizeSlashes(path.join(repoRoot, configRel)), ts.sys.readFile);
    if (error || !config) return null;
    const options = (config as { compilerOptions?: { outDir?: unknown; rootDir?: unknown } }).compilerOptions ?? {};
    const dir = dirOf(configRel);
    const outDir = typeof options.outDir === "string" ? joinRepoPath(dir, options.outDir) : null;
    const rootDir = typeof options.rootDir === "string" ? joinRepoPath(dir, options.rootDir) : null;
    return outDir !== null && rootDir !== null && outDir !== rootDir ? { outDir, rootDir } : null;
}

/**
 * Whether a folder is one of the repo's declared workspaces (ADR-053). The declarations are read as one list of globs:
 * the root package.json's `workspaces` (a list, or yarn's object with `packages`), pnpm-workspace.yaml's `packages:`
 * and lerna.json's `packages`. A glob's `*` is one folder name (or part of one), `**` any number of folders, and a
 * leading `!` takes the folders it matches back out.
 */
function declaredWorkspaces(repoRoot: string, rootManifest: PackageJson | null): (dir: string) => boolean {
    const workspaces = rootManifest?.workspaces;
    const lerna = readJson(path.join(repoRoot, "lerna.json"));
    const pnpm = readText(path.join(repoRoot, "pnpm-workspace.yaml"));
    const globs = [
        ...stringsIn(isRecord(workspaces) ? workspaces.packages : workspaces),
        ...(pnpm === null ? [] : pnpmWorkspacePackages(pnpm)),
        ...stringsIn(lerna?.packages),
    ];

    const include: string[][] = [];
    const exclude: string[][] = [];
    for (const glob of globs){
        const negated = glob.startsWith("!");
        for (const one of expandBraces(normalizeSlashes(negated ? glob.slice(1) : glob))){
            const segments = one.split("/").filter((s) => s !== "" && s !== ".");
            if (segments.length > 0) (negated ? exclude : include).push(segments);   // "." is the root, which counts anyway
        }
    }

    return (dir) => {
        const parts = dir.split("/");
        return include.some((glob) => globMatches(glob, parts)) && !exclude.some((glob) => globMatches(glob, parts));
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringsIn(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A glob's brace groups can't multiply past this many globs; the rest of a pathological one is dropped. */
const MAX_BRACE_EXPANSION = 256;

/**
 * A glob with its brace groups opened, as package managers' glob libraries do: "{apps,packages}/*" is apps/* and
 * packages/*, "ui-{web,{native,desktop}}" three names. The first group is opened, then each result again, so groups can
 * nest or follow one another. A "{" with no "}" to close it, or a group with no comma, stays as written.
 */
export function expandBraces(glob: string): string[] {
    const open = glob.indexOf("{");
    if (open === -1) return [glob];
    let depth = 0;
    const commas: number[] = [];
    for (let i = open; i < glob.length; i++){
        const c = glob[i];
        if (c === "{") depth++;
        else if (c === "," && depth === 1) commas.push(i);
        else if (c === "}" && --depth === 0){
            // "{x}" is no choice: it stays as written, and a later group still opens
            if (commas.length === 0) return expandBraces(glob.slice(i + 1)).map((rest) => glob.slice(0, i + 1) + rest);
            const cuts = [open, ...commas, i];
            const prefix = glob.slice(0, open);
            const suffix = glob.slice(i + 1);
            const out: string[] = [];
            for (let k = 0; k + 1 < cuts.length && out.length < MAX_BRACE_EXPANSION; k++){
                for (const rest of expandBraces(prefix + glob.slice(cuts[k] + 1, cuts[k + 1]) + suffix)){
                    if (out.length < MAX_BRACE_EXPANSION) out.push(rest);
                }
            }
            return out;
        }
    }
    return [glob];
}

/** A folder's names against a glob's, one by one; `**` tries every number of folders, none included. */
function globMatches(glob: readonly string[], parts: readonly string[]): boolean {
    if (glob.length === 0) return parts.length === 0;
    const [head, ...rest] = glob;
    if (head === "**"){
        for (let skip = 0; skip <= parts.length; skip++) if (globMatches(rest, parts.slice(skip))) return true;
        return false;
    }
    return parts.length > 0 && nameMatches(head, parts[0]) && globMatches(rest, parts.slice(1));
}

/** One folder name against one glob segment, where `*` stands for any run of characters ("plugin-*"). */
function nameMatches(pattern: string, name: string): boolean {
    if (!pattern.includes("*")) return pattern === name;
    const escaped = pattern.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`^${escaped.join(".*")}$`).test(name);
}

/**
 * pnpm-workspace.yaml's `packages:` list, read line by line rather than by a YAML parser: the block form
 * ("  - 'packages/*'") or the flow form ("packages: ['a/*', 'b']"), quotes and trailing comments dropped. The list ends
 * at the next key that isn't indented.
 */
export function pnpmWorkspacePackages(text: string): string[] {
    const found: string[] = [];
    let inList = false;

    for (const raw of text.split(/\r?\n/)){
        const line = withoutComment(raw).trimEnd();
        if (line.trim() === "") continue;

        const item = /^\s*-(?:\s+(.*))?$/.exec(line);
        if (item){
            const value = unquote(item[1] ?? "");
            if (inList && value !== "") found.push(value);
            continue;
        }
        if (/^\s/.test(line)) continue;   // an indented line of some other key's value

        const key = /^packages\s*:\s*(.*)$/.exec(line);
        inList = key !== null && key[1] === "";
        if (key !== null && key[1].startsWith("[")){
            found.push(...key[1].replace(/^\[|\]$/g, "").split(",").map(unquote).filter((v) => v !== ""));
        }
    }

    return found;
}

/** A YAML line without its comment: a `#` at the start or after a space, outside quotes. */
function withoutComment(line: string): string {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++){
        const c = line[i];
        if (quote !== null){
            if (c === quote) quote = null;
        } else if (c === "'" || c === '"'){
            quote = c;
        } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))){
            return line.slice(0, i);
        }
    }
    return line;
}

function unquote(value: string): string {
    const v = value.trim();
    return v.length >= 2 && (v[0] === "'" || v[0] === '"') && v[v.length - 1] === v[0] ? v.slice(1, -1) : v;
}

/**
 * Every file a package.json names as an entry point (R8): the "." export, main, module, types, typings, bin. Every
 * package.json counts here, declared workspace or not: a VS Code extension's main is its entry point all the same.
 */
export function declaredEntries(workspace: Workspace, findSource: (base: string) => string | null): { path: string; declaredBy: string }[] {
    const declared = new Map<string, string>();
    for (const pkg of workspace.packages){
        const manifest = pkg.dir === "" ? "package.json" : `${pkg.dir}/package.json`;
        const add = (field: string, target: string): void => {
            const base = joinRepoPath(pkg.dir, target);
            const file = base === null ? null : findSource(base);
            if (file !== null && !declared.has(file)) declared.set(file, `${manifest} ${field}`);
        };
        for (const target of pkg.exports.get(".") ?? []) add('exports "."', target);
        for (const main of pkg.mains) add(main.field, main.target);
        for (const target of pkg.bins) add("bin", target);
    }
    return [...declared].map(([file, declaredBy]) => ({ path: file, declaredBy })).sort((a, b) => compare(a.path, b.path));
}
