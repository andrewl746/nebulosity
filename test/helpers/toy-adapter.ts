import type { LanguageAdapter, LanguageResolver, LanguageRules, ParsedFile, Reading, ResolveContext } from "../../lib/index/languages/adapter";
import { assembleChunks, type Declaration } from "../../lib/index/languages/chunking";
import { countLines } from "../../lib/index/languages/typescript";
import { emptyCallFacts } from "../../lib/index/languages/typescript-calls";
import { dirOf, joinRepoPath } from "../../lib/index/paths";

/**
 * The toy language: a test language for the seam's shared code (Task F of the E4 plan), so discovery, the pipeline,
 * the incremental update and the conformance kit are tested without any real language.
 * - extension .toy; a test file ends _test.toy;
 * - manifests: toy.json (anywhere) and setup.toy, which is a code file too, as setup.py will be;
 * - a toy.json leaves out every .toy file under the deps/ folder beside it.
 */
export const toyRules: LanguageRules = {
    id: "toy",
    extensions: [".toy"],
    languageOf: () => "toy",
    isTest: (path) => /_test\.toy$/.test(path),
    manifest: /(^|\/)(toy\.json|setup\.toy)$/,
    excluded(manifests){
        const deps = manifests.filter((m) => /(^|\/)toy\.json$/.test(m)).map((m) => (dirOf(m) === "" ? "deps/" : `${dirOf(m)}/deps/`));
        return (path) => deps.some((prefix) => path.startsWith(prefix));
    },
};

/**
 * A toy file is read line by line (a line's "\r" and the text's leading U+FEFF dropped):
 * - `use <p>`: the specifier `use:<p>`, an import statement (the summary lists it);
 * - `name <N>`: the specifier `name:<N>`, a reference to a name some file of the same folder defines;
 * - `def <N>`: declares `def:<N>`, and is a function `N` (a symbol and a chunk on that line; exported unless N starts "_");
 * - `main`: declares `main` (an entry point);
 * - a blank line or one starting `#`: nothing. Any other line is a syntax error, parsed around: it gives nothing.
 * Readings: "parse" keeps the imports and declares (no chunks, no symbols); "scan" reads only the `use` lines.
 */
function parseToy(path: string, text: string, reading: Reading): ParsedFile {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const imports: string[] = [];
    const useLines: string[] = [];
    const declares = new Set<string>();
    const declarations: Declaration[] = [];
    body.split("\n").forEach((raw, i) => {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        const ref = /^(use|name) (\S+)$/.exec(line);
        if (ref !== null){
            if (reading === "scan" && ref[1] !== "use") return;
            imports.push(`${ref[1]}:${ref[2]}`);
            if (ref[1] === "use") useLines.push(line.trim());
            return;
        }
        if (reading === "scan") return;
        const def = /^def (\S+)$/.exec(line);
        if (def !== null){
            declares.add(`def:${def[1]}`);
            declarations.push({ kind: "function", name: def[1], startLine: i + 1, endLine: i + 1, exported: !def[1].startsWith("_") });
        } else if (line === "main"){
            declares.add("main");
        }
    });

    const full = reading === "full";
    return {
        chunks: full ? assembleChunks(path, text, declarations, {
            imports: useLines,
            exports: declarations.filter((d) => d.exported).map((d) => `${d.name} (function)`),
        }) : [],
        symbols: full ? declarations.map((d) => ({
            name: d.name, qualifiedName: d.name, kind: "function" as const, startLine: d.startLine, endLine: d.endLine, exported: d.exported, parentQualifiedName: null,
        })) : [],
        imports: [...new Set(imports)],
        declares: [...declares].sort(),
        calls: emptyCallFacts(),
        lineCount: countLines(body),
    };
}

/** What toy.json files say: { "root": "<folder>" } adds a folder, relative to the toy.json, that `use` paths are read in too. */
function toyRoots(ctx: ResolveContext): string[] {
    const cached = ctx.cache.get("toy:roots");
    if (cached !== undefined) return cached as string[];
    const roots: string[] = [];
    for (const manifest of ctx.manifests){
        if (!/(^|\/)toy\.json$/.test(manifest)) continue;
        try{
            const root = (JSON.parse(ctx.readText(manifest) ?? "{}") as { root?: unknown }).root;
            const joined = typeof root === "string" ? joinRepoPath(dirOf(manifest), root) : null;
            if (joined !== null) roots.push(joined);
        } catch{
            // a toy.json that isn't JSON names no root
        }
    }
    roots.sort();
    ctx.cache.set("toy:roots", roots);
    return roots;
}

/**
 * - `use:<p>`: the file `<p>.toy`, else `<root>/<p>.toy` for each toy.json root in order, the first that is indexed; the
 *   importer's own path is placed with no edge (`[importer]`);
 * - `name:<N>`: the other files of the importer's folder declaring `def:<N>`, sorted; when only the importer declares
 *   it, `[importer]`;
 * - kinds: internal for both; anything else external. Entry points: the files declaring `main`, by "toy main".
 */
function createToyResolver(ctx: ResolveContext): LanguageResolver {
    const roots = toyRoots(ctx);
    const definers = new Map<string, string[]>();   // "<folder>\0<N>" → files, sorted
    for (const [file, facts] of [...ctx.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))){
        for (const fact of facts.declares){
            if (!fact.startsWith("def:")) continue;
            const key = `${dirOf(file)}\0${fact.slice(4)}`;
            definers.set(key, [...(definers.get(key) ?? []), file]);
        }
    }

    return {
        resolve(importer, specifier){
            if (specifier.startsWith("use:")){
                const p = specifier.slice(4);
                for (const base of ["", ...roots]){
                    const candidate = joinRepoPath(base, `${p}.toy`);
                    if (candidate !== null && ctx.files.has(candidate)) return [candidate];
                }
                return [];
            }
            if (specifier.startsWith("name:")){
                const found = definers.get(`${dirOf(importer)}\0${specifier.slice(5)}`) ?? [];
                const others = found.filter((f) => f !== importer);
                return others.length > 0 ? others : found.length > 0 ? [importer] : [];
            }
            return [];
        },
        kindOf: (_importer, specifier) => (specifier.startsWith("use:") || specifier.startsWith("name:") ? "internal" : "external"),
        entryPoints: () => [...ctx.files].filter(([, f]) => f.declares.includes("main")).map(([p]) => ({ path: p, declaredBy: "toy main" }))
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };
}

export const toyAdapter: LanguageAdapter = {
    ...toyRules,
    version: 1,
    grammar: null,
    parse: parseToy,
    createResolver: createToyResolver,
};
