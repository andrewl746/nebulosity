import { dirOf, joinRepoPath } from "../../paths";
import type { LanguageResolver, ReferenceKind, ResolveContext } from "../adapter";
import { readCrates, type CrateManifest } from "./cargo";
import { parseSpecifier, segmentsOf, unraw } from "./syntax";

/**
 * Rust's resolution (the E4 plan's Task R): crates from the Cargo.toml files, each crate root's module tree from the
 * files' `mod` lines (their declares), and every path walked down that tree to the deepest module it names.
 *
 * - Roots: a crate's lib ([lib] path, else src/lib.rs), src/main.rs, its bins ([[bin]], src/bin/*.rs, src/bin/<x>/main.rs),
 *   build.rs, and tests/, examples/ and benches/ (*.rs, <x>/main.rs, and the [[test]]-like tables).
 * - The tree: a root's, a mod.rs's or a #[path] file's children sit in its own folder, another x.rs's in x/; an inline
 *   module adds its name as a folder; `mod y;` is y.rs, else y/mod.rs. A file no root reaches is an orphan.
 * - A path from module m: crate:: is m's crate root, self:: m, super:: m's parent; a leading name is a child module of
 *   m, else what the same file's use (same inline level) binds it to, else a crate (a repo crate's library name, or a
 *   rename in the importer's crate), else external. The rest walks down modules; the target is the deepest one's file.
 */

type ModuleNode = {
    /** The file this module lives in (an inline module's is its parent's); null for a `mod x;` with no file. */
    file: string | null;
    parent: ModuleNode | null;
    children: Map<string, ModuleNode>;
    crate: CrateManifest;
};

type Root = { path: string; declaredBy: string };

/** Where a path lands: outside the repo, or inside it at a module (null when that module can't be placed). */
type Located = { kind: "external" } | { kind: "internal"; node: ModuleNode | null };
const EXTERNAL: Located = { kind: "external" };
const UNPLACED: Located = { kind: "internal", node: null };

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
/** How deep a chain of use bindings is followed (`use a::b; use b::c;` …) before it counts as unresolvable. */
const MAX_BINDING_DEPTH = 8;

/** A crate's root files, in Cargo's order, each with what declares it; only files the index holds. */
function rootsOf(crate: CrateManifest, files: ReadonlySet<string>): Root[] {
    const at = (rel: string): string | null => joinRepoPath(crate.dir, rel);
    const roots: Root[] = [];
    const add = (path: string | null, declaredBy: string): void => {
        if (path !== null && files.has(path) && !roots.some((r) => r.path === path)) roots.push({ path, declaredBy: `${crate.manifest} ${declaredBy}` });
    };
    /** The files directly in `<folder>/` as *.rs, and `<folder>/<x>/main.rs`, sorted, each with its target name. */
    const discovered = (folder: string): { path: string; name: string }[] => {
        const prefix = crate.dir === "" ? `${folder}/` : `${crate.dir}/${folder}/`;
        const found: { path: string; name: string }[] = [];
        for (const file of files){
            if (!file.startsWith(prefix)) continue;
            const rest = file.slice(prefix.length).split("/");
            if (rest.length === 1 && rest[0].endsWith(".rs")) found.push({ path: file, name: rest[0].slice(0, -3) });
            else if (rest.length === 2 && rest[1] === "main.rs") found.push({ path: file, name: rest[0] });
        }
        return found.sort(byPath);
    };
    /** A named target with no path: the file Cargo infers for it in `<folder>/`. */
    const inferred = (folder: string, name: string | null): string | null => {
        if (name === null) return null;
        for (const candidate of [`${folder}/${name}.rs`, `${folder}/${name}/main.rs`]){
            const path = at(candidate);
            if (path !== null && files.has(path)) return path;
        }
        return null;
    };

    add(crate.libPath ?? at("src/lib.rs"), "[lib]");
    if (crate.auto.bins) add(at("src/main.rs"), "src/main.rs");
    for (const bin of crate.bins){
        const path = bin.path ?? inferred("src/bin", bin.name) ?? (bin.name === crate.packageName ? at("src/main.rs") : null);
        add(path, `[[bin]] ${bin.name ?? baseName(path ?? "").replace(/\.rs$/, "")}`);
    }
    if (crate.auto.bins) for (const bin of discovered("src/bin")) add(bin.path, `[[bin]] ${bin.name}`);
    if (crate.build !== false) add(crate.build ?? at("build.rs"), "build");
    for (const [kind, folder, declared, auto] of [
        ["tests", "tests", crate.tests, crate.auto.tests],
        ["examples", "examples", crate.examples, crate.auto.examples],
        ["benches", "benches", crate.benches, crate.auto.benches],
    ] as const){
        for (const target of declared) add(target.path ?? inferred(folder, target.name), kind);
        if (auto) for (const found of discovered(folder)) add(found.path, kind);
    }
    return roots;
}

export function createRustResolver(ctx: ResolveContext): LanguageResolver {
    const files = new Set(ctx.files.keys());
    const crates = readCrates(ctx);

    // the roots, crate by crate (sorted by manifest), and each crate's library root
    const roots = new Map<CrateManifest, Root[]>();
    const libRoot = new Map<CrateManifest, string>();
    for (const crate of crates){
        const own = rootsOf(crate, files);
        roots.set(crate, own);
        const lib = own.find((r) => r.declaredBy.endsWith(" [lib]"));
        if (lib !== undefined) libRoot.set(crate, lib.path);
    }
    const byLibName = new Map<string, CrateManifest[]>();
    for (const crate of libRoot.keys()) byLibName.set(crate.libName, [...(byLibName.get(crate.libName) ?? []), crate]);
    const byPackage = new Map<string, CrateManifest>();
    for (const crate of crates) if (!byPackage.has(crate.packageName)) byPackage.set(crate.packageName, crate);

    // the module tree, breadth first from every root; a file keeps the first module that reaches it
    const fileNode = new Map<string, ModuleNode>();
    const rootFiles = new Set<string>();
    const pathLoaded = new Set<string>();
    const queue: ModuleNode[] = [];
    const crateRoot = new Map<ModuleNode, ModuleNode>();
    for (const crate of crates){
        for (const root of roots.get(crate)!){
            rootFiles.add(root.path);
            if (fileNode.has(root.path)) continue;
            const node: ModuleNode = { file: root.path, parent: null, children: new Map(), crate };
            fileNode.set(root.path, node);
            crateRoot.set(node, node);
            queue.push(node);
        }
    }

    /** Whether a file's own `mod` children sit in its folder (a root, a mod.rs, a #[path] file) rather than in <stem>/. */
    const ownsFolder = (file: string): boolean =>
        rootFiles.has(file) || pathLoaded.has(file) || baseName(file) === "mod.rs"
        // an orphan's place is unknown: lib.rs and main.rs read as the roots they're named after
        || (!fileNode.has(file) && (baseName(file) === "lib.rs" || baseName(file) === "main.rs"));
    /** The file `mod <name>;` (or `#[path = …] mod <name>;`) names, declared in `file` inside the inline modules `inline`. */
    const childFile = (file: string, inline: readonly string[], name: string, path: string | null): string | null => {
        const own = ownsFolder(file) ? dirOf(file) : joinRepoPath(dirOf(file), baseName(file).replace(/\.rs$/, ""));
        if (own === null) return null;
        const folder = inline.reduce<string | null>((at, segment) => (at === null ? null : joinRepoPath(at, unraw(segment))), own);
        if (folder === null) return null;
        if (path !== null){
            // at file level a #[path] is relative to the file's folder; inside inline modules, to their folder
            const target = joinRepoPath(inline.length === 0 ? dirOf(file) : folder, path);
            return target !== null && files.has(target) ? target : null;
        }
        for (const candidate of [`${unraw(name)}.rs`, `${unraw(name)}/mod.rs`]){
            const target = joinRepoPath(folder, candidate);
            if (target !== null && files.has(target)) return target;
        }
        return null;
    };
    const inlineNode = (node: ModuleNode, inline: readonly string[], create: boolean): ModuleNode => {
        let at = node;
        for (const segment of inline){
            const name = unraw(segment);
            let next = at.children.get(name);
            if (next === undefined){
                next = { file: node.file, parent: at, children: new Map(), crate: node.crate };
                if (create) at.children.set(name, next);
            }
            at = next;
        }
        return at;
    };

    for (let i = 0; i < queue.length; i++){
        const node = queue[i];
        const file = node.file!;
        for (const fact of ctx.files.get(file)?.declares ?? []){
            const spec = parseSpecifier(fact);
            if (spec === null || spec.form !== "mod") continue;
            const parent = inlineNode(node, spec.inline, true);
            const name = unraw(spec.name);
            if (parent.children.has(name)) continue;
            const target = childFile(file, spec.inline, spec.name, spec.path);
            const child: ModuleNode = { file: target, parent, children: new Map(), crate: node.crate };
            parent.children.set(name, child);
            crateRoot.set(child, crateRoot.get(node)!);
            if (target !== null && !fileNode.has(target)){
                if (spec.path !== null) pathLoaded.add(target);
                fileNode.set(target, child);
                queue.push(child);
            }
        }
    }
    const rootOf = (node: ModuleNode): ModuleNode => {
        let at = node;
        while (at.parent !== null) at = at.parent;
        return at;
    };

    /** The crate a file belongs to: its module's, else (an orphan) the package whose folder holds it. */
    const crateOfFile = (file: string): CrateManifest | null => {
        const node = fileNode.get(file);
        if (node !== undefined) return node.crate;
        let best: CrateManifest | null = null;
        for (const crate of crates){
            if ((crate.dir === "" || file.startsWith(`${crate.dir}/`)) && (best === null || crate.dir.length > best.dir.length)) best = crate;
        }
        return best;
    };
    /** Whether a file belongs to its package's library (its module tree's root is the [lib] root). */
    const inLibrary = (file: string): boolean => {
        const node = fileNode.get(file);
        return node !== undefined && rootOf(node).file === libRoot.get(node.crate);
    };
    /**
     * The repo crate `name` is in `importer`'s code, as Cargo's extern prelude has it: a dependency of the importer's
     * package (of any kind) by its library name, or by its rename (a renamed one only by the rename), and, from a target
     * that isn't the library (a bin, a test, an example, a bench, an orphan), the package's own library. Only a crate
     * with a library root can be named. (The plan said any repo crate's library name; rust-analyzer's index showed that
     * over-links: a `paths::` in its parser, the parser's own module through a glob, reached the `paths` crate.)
     */
    const crateNamed = (importer: string, rawName: string): CrateManifest | null => {
        const name = unraw(rawName);
        const own = crateOfFile(importer);
        if (own === null) return null;
        const renamed = own.renames.get(name);
        if (renamed !== undefined){
            const crate = byPackage.get(renamed);
            return crate !== undefined && libRoot.has(crate) ? crate : null;
        }
        if (own.libName === name && libRoot.has(own) && !inLibrary(importer)) return own;
        const renamedPackages = new Set(own.renames.values());
        const candidates = (byLibName.get(name) ?? []).filter((c) => c !== own && own.dependencies.has(c.packageName) && !renamedPackages.has(c.packageName));
        return candidates.length === 1 ? candidates[0] : null;
    };

    // what each file's uses bind, per inline level: "<inline>\0<name>" → the bound path and the specifier binding it
    const bindingsOf = new Map<string, Map<string, { path: string; specifier: string }>>();
    const bindings = (importer: string): Map<string, { path: string; specifier: string }> => {
        let found = bindingsOf.get(importer);
        if (found !== undefined) return found;
        found = new Map();
        for (const specifier of ctx.files.get(importer)?.importSpecifiers ?? []){
            const spec = parseSpecifier(specifier);
            if (spec === null || spec.form !== "use") continue;
            const name = spec.alias ?? segmentsOf(spec.path).at(-1)!;
            if (name === "*" || name === "_" || name === "" || name === "self") continue;
            const key = `${spec.inline.join("::")}\0${unraw(name)}`;
            if (!found.has(key)) found.set(key, { path: spec.path, specifier });
        }
        bindingsOf.set(importer, found);
        return found;
    };

    /** The module a path's start names, then as far down as its segments name modules. */
    const locate = (importer: string, inline: readonly string[], segments: readonly string[], skip: string | null, depth: number): Located => {
        const fileModule = fileNode.get(importer);
        const m = fileModule === undefined ? null : inlineNode(fileModule, inline, false);
        let at: ModuleNode | null;
        let rest: readonly string[];
        const [first] = segments;
        if (first === "crate"){
            at = m === null ? null : (crateRoot.get(fileModule!) ?? rootOf(m));
            rest = segments.slice(1);
        } else if (first === "self" || first === "super"){
            at = m;
            rest = segments;
        } else if (first === ""){
            const crate = segments.length > 1 ? crateNamed(importer, segments[1]) : null;
            if (crate === null) return EXTERNAL;
            at = fileNode.get(libRoot.get(crate)!) ?? null;
            rest = segments.slice(2);
        } else{
            const child = m?.children.get(unraw(first));
            const bound = child === undefined ? bindings(importer).get(`${inline.join("::")}\0${unraw(first)}`) : undefined;
            if (child !== undefined){
                at = child;
                rest = segments.slice(1);
            } else if (bound !== undefined && bound.specifier !== skip && depth < MAX_BINDING_DEPTH){
                return locate(importer, inline, [...segmentsOf(bound.path), ...segments.slice(1)], bound.specifier, depth + 1);
            } else{
                const crate = crateNamed(importer, first);
                if (crate === null) return EXTERNAL;
                at = fileNode.get(libRoot.get(crate)!) ?? null;
                rest = segments.slice(1);
            }
        }

        for (const segment of rest){
            if (at === null || at.file === null) return UNPLACED;
            if (segment === "*") break;
            if (segment === "self") continue;
            if (segment === "super"){
                at = at.parent;
                continue;
            }
            const next = at.children.get(unraw(segment));
            if (next === undefined) break;
            at = next;
        }
        return at === null || at.file === null ? UNPLACED : { kind: "internal", node: at };
    };

    /** A use: or path: specifier's landing, its own binding skipped (a use doesn't bind its own start). */
    const locateSpecifier = (importer: string, specifier: string): Located | "mod" | "unknown" => {
        const spec = parseSpecifier(specifier);
        if (spec === null) return "unknown";
        if (spec.form === "mod") return "mod";
        if (spec.form === "extern"){
            const crate = crateNamed(importer, spec.name);
            return crate === null ? EXTERNAL : { kind: "internal", node: fileNode.get(libRoot.get(crate)!) ?? null };
        }
        return locate(importer, spec.inline, segmentsOf(spec.path), spec.form === "use" ? specifier : null, 0);
    };

    return {
        resolve(importer, specifier){
            const spec = parseSpecifier(specifier);
            if (spec?.form === "mod"){
                const target = childFile(importer, spec.inline, spec.name, spec.path);
                return target === null ? [] : [target];
            }
            const located = locateSpecifier(importer, specifier);
            if (typeof located === "string" || located.kind === "external" || located.node === null || located.node.file === null) return [];
            return [located.node.file];
        },
        kindOf(importer, specifier): ReferenceKind {
            const located = locateSpecifier(importer, specifier);
            if (located === "mod") return "internal";
            return located === "unknown" ? "external" : located.kind;
        },
        classOf(importer, specifier){
            if (!fileNode.has(importer)) return "orphan";
            const spec = parseSpecifier(specifier);
            if (spec?.form === "mod") return "mod";
            if ((spec?.form === "use" || spec?.form === "path") && ["crate", "self", "super"].includes(segmentsOf(spec.path)[0])) return "relative";
            return "other";
        },
        entryPoints(){
            const declared = new Map<string, string>();
            for (const crate of crates) for (const root of roots.get(crate)!) if (!declared.has(root.path)) declared.set(root.path, root.declaredBy);
            return [...declared].map(([path, declaredBy]) => ({ path, declaredBy })).sort(byPath);
        },
    };
}
