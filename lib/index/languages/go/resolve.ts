/**
 * Go's resolver (Task G of the E4 plan, ADR-065): turns the parse's three specifier classes into files.
 *
 * - Modules come from the manifests: each go.mod's `module` line names its folder, and a `replace <module> => <./ or
 *   ../ path>` in a go.mod or go.work names that folder too. A go.mod in a folder Go's own rules leave out (a vendored
 *   copy under vendor/) is ignored. An import path names the folder under the module whose path is its longest prefix.
 * - A package is a folder's non-test .go files that share the folder's package name (the name most of them declare).
 *   Importers only ever see those files: a _test.go file is never reached through an import.
 * - `use:x.N` goes to the files of x's package declaring N; `name:N` to the other files of the importer's own package
 *   declaring N, and to the dot-imported packages' files declaring N. Every declarer gets the edge (build-tag twins).
 * - `import:` itself makes an edge only when nothing else does: a blank or dot import loads the whole package, and so
 *   does an import none of whose uses resolve; otherwise it's placed with no edge of its own.
 */
import type { LanguageResolver, ReferenceKind, ResolveContext } from "../adapter";
import { dirOf, joinRepoPath } from "../../paths";
import { goRules } from "./rules";

/** A module: an import path prefix and the repo folder it names ("" is the root). */
export type GoModule = { path: string; dir: string };

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Adds a value to a key's list in place (copying the list on each add made a big folder's lists quadratic, B-M8). */
function appendTo<K>(lists: Map<K, string[]>, key: K, value: string): void {
    const list = lists.get(key);
    if (list === undefined) lists.set(key, [value]);
    else list.push(value);
}

const IS_GO_MANIFEST = /(^|\/)go\.(mod|work)$/;
const IS_LOCAL_PATH = /^\.\.?(\/|$)/;

/** A manifest's lines without comments or line endings, trimmed. */
function manifestLines(text: string): string[] {
    return text.split("\n").map((l) => l.replace(/\r$/, "").replace(/\/\/.*$/, "").trim());
}

/** A module path as go.mod writes it, quotes dropped. */
const unquote = (token: string): string => (/^".*"$/.test(token) || /^`.*`$/.test(token) ? token.slice(1, -1) : token);

/**
 * The repo's modules, read from its go.mod and go.work files: each go.mod's own module first (in manifest order), then
 * each local replace; a module path met twice keeps its first folder.
 */
export function readModules(manifests: readonly string[], readText: (rel: string) => string | null): GoModule[] {
    const excluded = goRules.excluded(manifests);
    const declared: GoModule[] = [];
    const replaced: GoModule[] = [];
    for (const manifest of manifests){
        if (!IS_GO_MANIFEST.test(manifest) || excluded(manifest)) continue;
        const text = readText(manifest);
        if (text === null) continue;
        const dir = dirOf(manifest);
        let inReplace = false;
        for (const line of manifestLines(text)){
            if (line === "") continue;
            if (inReplace){
                if (line.startsWith(")")){
                    inReplace = false;
                    continue;
                }
                addReplace(line, dir, replaced);
                continue;
            }
            const moduleLine = /^module\s+(\S+)/.exec(line);
            if (moduleLine !== null && manifest.endsWith("go.mod")){
                declared.push({ path: unquote(moduleLine[1]), dir });
                continue;
            }
            if (/^replace\s*\($/.test(line)){
                inReplace = true;
                continue;
            }
            const replace = /^replace\s+(.*)$/.exec(line);
            if (replace !== null) addReplace(replace[1], dir, replaced);
        }
    }
    const seen = new Set<string>();
    return [...declared, ...replaced].filter((m) => (seen.has(m.path) ? false : (seen.add(m.path), true)));
}

/** One replace directive (`old [version] => new [version]`): kept when `new` is a local folder inside the repo. */
function addReplace(directive: string, dir: string, out: GoModule[]): void {
    const [left, right] = directive.split("=>").map((s) => s.trim());
    if (left === undefined || right === undefined) return;
    const from = unquote(left.split(/\s+/)[0] ?? "");
    const to = unquote(right.split(/\s+/)[0] ?? "");
    if (from === "" || !IS_LOCAL_PATH.test(to)) return;
    const folder = joinRepoPath(dir, to);
    if (folder !== null) out.push({ path: from, dir: folder });
}

/** The module an import path is under (its longest prefix at a path-element boundary), or null outside the repo. */
export function moduleOf(importPath: string, modules: readonly GoModule[]): GoModule | null {
    let found: GoModule | null = null;
    for (const m of modules){
        if ((importPath === m.path || importPath.startsWith(`${m.path}/`)) && (found === null || m.path.length > found.path.length)) found = m;
    }
    return found;
}

/** An import's name when the importer gives none and it isn't a repo package: the last element, a /v<N> suffix dropped. */
export function defaultAlias(importPath: string): string {
    const parts = importPath.split("/");
    if (parts.length > 1 && /^v\d+$/.test(parts.at(-1)!)) parts.pop();
    return parts.at(-1)!;
}

/** An `import:<path>[ as <alias>]` specifier's parts. */
function parseImport(specifier: string): { path: string; alias: string | null } {
    const body = specifier.slice("import:".length);
    const at = body.lastIndexOf(" as ");
    return at === -1 ? { path: body, alias: null } : { path: body.slice(0, at), alias: body.slice(at + 4) };
}

/** One of a file's imports, resolved against the repo. */
type Imported = { path: string; alias: string | null; internal: boolean; folder: string | null };

export function createGoResolver(ctx: ResolveContext): LanguageResolver {
    // the modules depend only on the manifests, so a worker keeps them between updates (the cache is emptied when one changes)
    const cached = ctx.cache.get("go:modules") as GoModule[] | undefined;
    const modules = cached ?? readModules(ctx.manifests, (rel) => ctx.readText(rel));
    if (cached === undefined) ctx.cache.set("go:modules", modules);

    // each file's package name, and the declarers of each name, per folder and package
    const packageOf = new Map<string, string>();
    const declarers = new Map<string, string[]>();   // "<folder>\0<package>\0<name>" → files, sorted
    const namesByFolder = new Map<string, Map<string, number>>();   // a folder's non-test files' package names, counted
    for (const [file, facts] of [...ctx.files].sort(([a], [b]) => byText(a, b))){
        const pkg = facts.declares.find((d) => d.startsWith("package:"))?.slice("package:".length);
        if (pkg === undefined) continue;
        packageOf.set(file, pkg);
        const folder = dirOf(file);
        if (!goRules.isTest(file)){
            const counts = namesByFolder.get(folder) ?? new Map<string, number>();
            counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
            namesByFolder.set(folder, counts);
        }
        for (const fact of facts.declares){
            if (fact.startsWith("package:")) continue;
            const key = `${folder}\0${pkg}\0${fact}`;
            appendTo(declarers, key, file);
        }
    }

    /** A folder's package name: the one most of its non-test files declare (ties: the first by name). */
    const folderPackage = new Map<string, string>();
    for (const [folder, counts] of namesByFolder){
        const [name] = [...counts].sort(([a, ca], [b, cb]) => cb - ca || byText(a, b))[0];
        folderPackage.set(folder, name);
    }
    /** The files an importer of the folder sees: its non-test files of the folder's package, sorted. */
    const packageFiles = new Map<string, string[]>();
    for (const file of [...packageOf.keys()].sort(byText)){
        const folder = dirOf(file);
        if (goRules.isTest(file) || packageOf.get(file) !== folderPackage.get(folder)) continue;
        appendTo(packageFiles, folder, file);
    }
    /** The package files of `folder` declaring `name`. */
    const declaredIn = (folder: string, name: string): string[] => {
        const pkg = folderPackage.get(folder);
        if (pkg === undefined) return [];
        return (declarers.get(`${folder}\0${pkg}\0${name}`) ?? []).filter((f) => !goRules.isTest(f));
    };

    /** The folder an import path names, when that folder holds the package's files. */
    const folderOf = (importPath: string): string | null => {
        const owner = moduleOf(importPath, modules);
        if (owner === null) return null;
        const folder = importPath === owner.path ? owner.dir : joinRepoPath(owner.dir, importPath.slice(owner.path.length + 1));
        return folder !== null && packageFiles.has(folder) ? folder : null;
    };

    /** Each importer's imports by alias, and its dot imports, read from its own import: specifiers. */
    const importsCache = new Map<string, { byAlias: Map<string, Imported>; dots: Imported[] }>();
    const importsOf = (importer: string): { byAlias: Map<string, Imported>; dots: Imported[] } => {
        let found = importsCache.get(importer);
        if (found !== undefined) return found;
        found = { byAlias: new Map(), dots: [] };
        for (const specifier of ctx.files.get(importer)?.importSpecifiers ?? []){
            if (!specifier.startsWith("import:")) continue;
            const { path, alias } = parseImport(specifier);
            const imported: Imported = { path, alias, internal: moduleOf(path, modules) !== null, folder: folderOf(path) };
            if (alias === ".") found.dots.push(imported);
            else if (alias !== "_"){
                const name = alias ?? (imported.folder !== null ? folderPackage.get(imported.folder)! : defaultAlias(path));
                if (!found.byAlias.has(name)) found.byAlias.set(name, imported);
            }
        }
        importsCache.set(importer, found);
        return found;
    };

    /** `name:N`: the other files of the importer's package declaring N, and the dot-imported packages' files. */
    const resolveName = (importer: string, name: string): string[] => {
        const pkg = packageOf.get(importer);
        const found = new Set<string>();
        let own = false;
        if (pkg !== undefined){
            const testImporter = goRules.isTest(importer);
            for (const file of declarers.get(`${dirOf(importer)}\0${pkg}\0${name}`) ?? []){
                if (file === importer) own = true;
                else if (testImporter || !goRules.isTest(file)) found.add(file);   // a non-test file never reaches a test
            }
        }
        for (const dot of importsOf(importer).dots) if (dot.folder !== null) for (const file of declaredIn(dot.folder, name)) found.add(file);
        if (found.size === 0) return own ? [importer] : [];
        return [...found].sort(byText);
    };

    /** `use:x.N`: x's package files declaring N when x is an import's alias; otherwise x is a name of the package. */
    const resolveUse = (importer: string, x: string, member: string): string[] => {
        const imported = importsOf(importer).byAlias.get(x);
        if (imported === undefined) return resolveName(importer, x);
        return imported.folder === null ? [] : declaredIn(imported.folder, member);
    };

    const splitUse = (specifier: string): { x: string; member: string } => {
        const body = specifier.slice("use:".length);
        const dot = body.indexOf(".");
        return { x: body.slice(0, dot), member: body.slice(dot + 1) };
    };

    const resolve = (importer: string, specifier: string): string[] => {
        if (specifier.startsWith("use:")){
            const { x, member } = splitUse(specifier);
            return resolveUse(importer, x, member);
        }
        if (specifier.startsWith("name:")) return resolveName(importer, specifier.slice("name:".length));
        if (!specifier.startsWith("import:")) return [];

        const { path, alias } = parseImport(specifier);
        const folder = folderOf(path);
        if (folder === null) return [];
        const files = packageFiles.get(folder)!;
        if (alias === "_" || alias === ".") return files;
        // placed when one of the file's uses of this import resolves: those uses carry the edges
        const name = alias ?? folderPackage.get(folder)!;
        const uses = (ctx.files.get(importer)?.importSpecifiers ?? []).filter((s) => s.startsWith(`use:${name}.`));
        return uses.some((s) => resolveUse(importer, name, splitUse(s).member).length > 0) ? [importer] : files;
    };

    const kindOf = (importer: string, specifier: string): ReferenceKind => {
        if (specifier.startsWith("import:")) return moduleOf(parseImport(specifier).path, modules) !== null ? "internal" : "external";
        if (specifier.startsWith("use:")){
            const imported = importsOf(importer).byAlias.get(splitUse(specifier).x);
            return imported === undefined || imported.internal ? "internal" : "external";
        }
        return specifier.startsWith("name:") ? "internal" : "external";
    };

    return {
        resolve,
        kindOf,
        entryPoints: () => [...ctx.files]
            .filter(([, facts]) => facts.declares.includes("package:main") && facts.declares.includes("main"))
            .map(([path]) => ({ path, declaredBy: "package main, func main" }))
            .sort((a, b) => byText(a.path, b.path)),
    };
}
