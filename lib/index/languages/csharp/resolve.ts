/**
 * Resolving C# references to files (the E4 plan's Task C, design §6.4): by name, as the compiler looks names up, read
 * from the syntax and the project files with no build run.
 *
 * - A file's project is the folder of the nearest .csproj above it, else the repo root. A project's usings are its files'
 *   `global using`s (stored as declares: global:, gstatic:, galias:) plus its .csproj's and the Directory.Build.props'
 *   `<Using Include="…" />` items; a file's own using:, static: and alias: apply to that file only.
 * - type:N: each enclosing namespace from the innermost out (the global namespace last), the first that holds N; else an
 *   alias named N (the file's, then the project's), its target; else every visible using's U.N together, the types
 *   nested in static: and gstatic: types counting too.
 * - Every file declaring a chosen name gets the edge (partial types); when files of several projects declare it, the
 *   importer's own project's win.
 * - qtype:A.B.N: under each enclosing namespace, as written, through an alias for A, then under each visible using.
 * - ext:M: every extension method M whose namespace is enclosing or visible. static:/gstatic: name their type's files.
 * - using:, global:, alias:, galias: and ns: make no edge (context).
 */
import type { LanguageResolver, ReferenceKind, ResolveContext } from "../adapter";
import { dirOf } from "../../paths";
import { CSHARP_MANIFEST, csharpRules, projectFiles } from "./rules";

type Usings = { namespaces: string[]; statics: string[]; aliases: Map<string, string> };
type FileView = Usings & {
    project: string;
    /** The file's namespaces and their parents, innermost first, then "" (the global namespace). */
    enclosing: string[];
};
/** One extension method's full name (ext:<namespace>.<Class>.<M>) and the files that declare it. */
type Extension = { namespace: string; fullName: string; files: string[] };

const join = (outer: string, name: string): string => (outer === "" ? name : `${outer}.${name}`);
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const PROPS = /(^|\/)Directory\.Build\.props$/;

/** A specifier's text after its class prefix (`type:Order` → Order). */
function body(specifier: string): string {
    return specifier.slice(specifier.indexOf(":") + 1);
}

/** An alias specifier's two halves (`alias:X=A.B.C` → X, A.B.C), or null. */
function aliasOf(text: string): [string, string] | null {
    const eq = text.indexOf("=");
    return eq <= 0 ? null : [text.slice(0, eq), text.slice(eq + 1)];
}

/**
 * The `<Using>` items of one project file or Directory.Build.props: Include="X" (a namespace), with Alias="Y" (an alias)
 * or Static="true" (a static type). Items whose name needs an MSBuild property ($(…)) are left out, as is Remove="…"
 * (it only takes away the SDK's implicit usings, which are all outside the repo).
 */
export function usingItems(xml: string): Usings {
    const out: Usings = { namespaces: [], statics: [], aliases: new Map() };
    for (const tag of xml.match(/<Using\b[^>]*>/g) ?? []){
        const attributes = new Map<string, string>();
        for (const [, key, value] of tag.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attributes.set(key, value.trim());
        const include = attributes.get("Include");
        if (include === undefined || include === "" || include.includes("$(")) continue;
        const name = include.replace(/^global::/, "");
        const alias = attributes.get("Alias");
        if (alias !== undefined && alias !== "") out.aliases.set(alias, name);
        else if ((attributes.get("Static") ?? "").toLowerCase() === "true") out.statics.push(name);
        else out.namespaces.push(name);
    }
    return out;
}

export function createCsharpResolver(ctx: ResolveContext): LanguageResolver {
    // manifests under a folder C# itself leaves out (a .csproj copied into bin/) are not read
    const excluded = csharpRules.excluded(ctx.manifests);
    const manifests = ctx.manifests.filter((m) => CSHARP_MANIFEST.test(m) && !excluded(m));
    const projectFolders = new Set(projectFiles(manifests).map(dirOf));
    const projectOfFile = new Map<string, string>();
    const projectOf = (file: string): string => {
        let found = projectOfFile.get(file);
        if (found === undefined){
            found = "";
            for (let folder = dirOf(file); ; folder = dirOf(folder)){
                if (projectFolders.has(folder)){
                    found = folder;
                    break;
                }
                if (folder === "") break;
            }
            projectOfFile.set(file, found);
        }
        return found;
    };

    // every declared type, extension method and namespace
    const typeFiles = new Map<string, string[]>();
    const simpleNames = new Set<string>();
    const extensions = new Map<string, Extension[]>();
    const qualifiers = new Set<string>();   // declared namespaces, their parents, and declared types: what a qualified name may start from
    const projectDeclares = new Map<string, Usings>();
    const sortedFiles = [...ctx.files.keys()].sort(byPath);
    for (const file of sortedFiles){
        const facts = ctx.files.get(file)!;
        for (const fact of facts.declares){
            if (fact.startsWith("type:")){
                const fullName = body(fact);
                const files = typeFiles.get(fullName);
                if (files === undefined) typeFiles.set(fullName, [file]);
                else files.push(file);
                simpleNames.add(fullName.slice(fullName.lastIndexOf(".") + 1));
                qualifiers.add(fullName);
            } else if (fact.startsWith("ext:")){
                const fullName = body(fact);
                const name = fullName.slice(fullName.lastIndexOf(".") + 1);
                const owner = fullName.slice(0, fullName.lastIndexOf("."));
                let entries = extensions.get(name);
                if (entries === undefined){
                    entries = [];
                    extensions.set(name, entries);
                }
                const entry = entries.find((e) => e.fullName === fullName);
                if (entry !== undefined) entry.files.push(file);
                else entries.push({ namespace: owner.includes(".") ? owner.slice(0, owner.lastIndexOf(".")) : "", fullName, files: [file] });
            } else if (/^(global|gstatic|galias):/.test(fact)){
                const project = projectOf(file);
                let usings = projectDeclares.get(project);
                if (usings === undefined){
                    usings = { namespaces: [], statics: [], aliases: new Map() };
                    projectDeclares.set(project, usings);
                }
                const text = body(fact);
                if (fact.startsWith("global:")) usings.namespaces.push(text);
                else if (fact.startsWith("gstatic:")) usings.statics.push(text);
                else{
                    const alias = aliasOf(text);
                    if (alias !== null && !usings.aliases.has(alias[0])) usings.aliases.set(alias[0], alias[1]);
                }
            }
        }
        for (const specifier of facts.importSpecifiers){
            if (!specifier.startsWith("ns:")) continue;
            const parts = body(specifier).split(".");
            for (let i = 1; i <= parts.length; i++) qualifiers.add(parts.slice(0, i).join("."));
        }
    }

    // the project files' and Directory.Build.props' <Using> items, read once per manifest list (the cache is emptied
    // whenever a manifest changes)
    const itemsKey = "csharp:using-items";
    let items = ctx.cache.get(itemsKey) as Map<string, Usings> | undefined;
    if (items === undefined){
        items = new Map();
        for (const manifest of manifests){
            const text = ctx.readText(manifest);
            if (text !== null) items.set(manifest, usingItems(text));
        }
        ctx.cache.set(itemsKey, items);
    }
    const projectUsingsCache = new Map<string, Usings>();
    const projectUsings = (project: string): Usings => {
        let usings = projectUsingsCache.get(project);
        if (usings !== undefined) return usings;
        usings = { namespaces: [], statics: [], aliases: new Map() };
        const sources: Usings[] = [];
        const own = projectDeclares.get(project);
        if (own !== undefined) sources.push(own);
        for (const [manifest, found] of items!){
            const folder = dirOf(manifest);
            const applies = manifest.endsWith(".csproj")
                ? folder === project
                : PROPS.test(manifest) && (folder === "" || folder === project || project.startsWith(`${folder}/`));
            if (applies) sources.push(found);
        }
        for (const source of sources){
            usings.namespaces.push(...source.namespaces);
            usings.statics.push(...source.statics);
            for (const [alias, target] of source.aliases) if (!usings.aliases.has(alias)) usings.aliases.set(alias, target);
        }
        projectUsingsCache.set(project, usings);
        return usings;
    };

    const views = new Map<string, FileView>();
    const viewOf = (file: string): FileView => {
        let view = views.get(file);
        if (view !== undefined) return view;
        const namespaces: string[][] = [];
        const own: Usings = { namespaces: [], statics: [], aliases: new Map() };
        for (const specifier of ctx.files.get(file)?.importSpecifiers ?? []){
            if (specifier.startsWith("ns:")){
                const parts = body(specifier).split(".");
                for (let i = parts.length; i >= 1; i--) namespaces.push(parts.slice(0, i));
            } else if (specifier.startsWith("using:")) own.namespaces.push(body(specifier));
            else if (specifier.startsWith("static:")) own.statics.push(body(specifier));
            else if (specifier.startsWith("alias:")){
                const alias = aliasOf(body(specifier));
                if (alias !== null && !own.aliases.has(alias[0])) own.aliases.set(alias[0], alias[1]);
            }
        }
        // innermost first: deeper namespaces before their parents, then the global namespace
        const enclosing = [...new Set(namespaces.sort((a, b) => b.length - a.length).map((p) => p.join(".")))];
        enclosing.push("");
        const project = projectOf(file);
        const shared = projectUsings(project);
        view = {
            project, enclosing,
            namespaces: [...own.namespaces, ...shared.namespaces],
            statics: [...own.statics, ...shared.statics],
            aliases: new Map([...shared.aliases, ...own.aliases]),   // the file's own alias wins over a project one
        };
        views.set(file, view);
        return view;
    };

    /** The files declaring one full name: the importer's project's when several projects declare it. */
    const filesFor = (fullName: string, project: string, files: readonly string[] = typeFiles.get(fullName) ?? []): readonly string[] => {
        if (files.length < 2) return files;
        const own = files.filter((f) => projectOf(f) === project);
        return own.length > 0 && own.length < files.length ? own : files;
    };
    const union = (lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())].sort(byPath);

    /** A (possibly dotted) name as C# looks it up from `view`: enclosing namespaces, then an alias, then the usings. */
    const lookUp = (view: FileView, name: string): readonly string[] => {
        for (const outer of view.enclosing){
            const fullName = join(outer, name);
            if (typeFiles.has(fullName)) return filesFor(fullName, view.project);
        }
        const dot = name.indexOf(".");
        const first = dot === -1 ? name : name.slice(0, dot);
        const target = view.aliases.get(first);
        if (target !== undefined){
            const fullName = dot === -1 ? target : `${target}${name.slice(dot)}`;
            return typeFiles.has(fullName) ? filesFor(fullName, view.project) : [];
        }
        const found: (readonly string[])[] = [];
        for (const scope of [...view.namespaces, ...view.statics]){
            const fullName = join(scope, name);
            if (typeFiles.has(fullName)) found.push(filesFor(fullName, view.project));
        }
        return union(found);
    };

    /** A using static's type as declared: as written, then under each enclosing namespace; null when the repo has none. */
    const staticType = (view: FileView, name: string): string | null => {
        for (const outer of ["", ...view.enclosing]){
            const fullName = join(outer, name);
            if (typeFiles.has(fullName)) return fullName;
        }
        return null;
    };

    /**
     * An attribute [N] is looked up as N and as NAttribute (both specifiers are written); C# binds it to the one that
     * exists, so the other one is only a lookup aid when its twin resolves.
     */
    const twinResolves = (importer: string, specifier: string): boolean => {
        const cls = specifier.slice(0, specifier.indexOf(":") + 1);
        const text = body(specifier);
        const twin = text.endsWith("Attribute") ? `${cls}${text.slice(0, -"Attribute".length)}` : `${cls}${text}Attribute`;
        return (ctx.files.get(importer)?.importSpecifiers.includes(twin) ?? false) && resolve(importer, twin).length > 0;
    };

    const resolved = new Map<string, string[]>();
    const resolve = (importer: string, specifier: string): string[] => {
        const key = `${importer}\0${specifier}`;
        const cached = resolved.get(key);
        if (cached !== undefined) return cached;
        let files: readonly string[];
        const view = viewOf(importer);
        const text = body(specifier);
        if (specifier.startsWith("type:") || specifier.startsWith("qtype:")) files = lookUp(view, text);
        else if (specifier.startsWith("static:") || specifier.startsWith("gstatic:")){
            const fullName = staticType(view, text);
            files = fullName === null ? [] : filesFor(fullName, view.project);
        } else if (specifier.startsWith("ext:")){
            // in scope: an extension class in an enclosing or imported namespace, or one a using static names (C#'s rule)
            const visible = new Set([...view.enclosing, ...view.namespaces]);
            const statics = new Set(view.statics.map((s) => staticType(view, s)));
            files = union((extensions.get(text) ?? [])
                .filter((e) => visible.has(e.namespace) || statics.has(e.fullName.slice(0, e.fullName.lastIndexOf("."))))
                .map((e) => filesFor(e.fullName, view.project, e.files)));
        } else{
            files = [];
        }
        const sorted = [...files].sort(byPath);
        resolved.set(key, sorted);
        return sorted;
    };

    return {
        resolve,
        kindOf(importer, specifier): ReferenceKind {
            if (resolve(importer, specifier).length > 0) return "internal";
            const text = body(specifier);
            if (specifier.startsWith("type:") || specifier.startsWith("qtype:")){
                const named = specifier.startsWith("type:")
                    ? simpleNames.has(text)
                    : viewOf(importer).enclosing.some((outer) => qualifiers.has(join(outer, text.slice(0, text.lastIndexOf(".")))));
                if (!named) return "external";
                return twinResolves(importer, specifier) ? "context" : "internal";
            }
            if (specifier.startsWith("ext:")) return extensions.has(text) ? "internal" : "external";
            if (specifier.startsWith("static:") || specifier.startsWith("gstatic:")) return "external";
            return "context";
        },
        entryPoints(){
            const out: { path: string; declaredBy: string }[] = [];
            for (const file of sortedFiles){
                const declares = ctx.files.get(file)!.declares;
                if (declares.includes("main:static")) out.push({ path: file, declaredBy: "static Main" });
                else if (declares.includes("main:top-level")) out.push({ path: file, declaredBy: "top-level statements" });
            }
            return out;
        },
    };
}
