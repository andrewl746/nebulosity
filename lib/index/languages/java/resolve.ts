/**
 * Java's resolver (ADR-065, the E4 plan's Task J): names to files, through what every file declares (parse.ts). Java
 * reads no manifest to resolve: a type's qualified name is its package plus its name, wherever the file sits, so the
 * pom.xml and Gradle files only decide which files are left out (rules.ts).
 */
import { dirOf } from "../../paths";
import type { LanguageResolver, ReferenceKind, ResolveContext } from "../adapter";

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What every file declares, gathered once per run. */
type JavaIndex = {
    /** A qualified type name → the files declaring it, sorted. */
    declarers: Map<string, string[]>;
    /** Every package some file declares ("" for the default package). */
    packages: Set<string>;
    /** Every top-level type's simple name. */
    simpleNames: Set<string>;
    /** Each file's package ("" for the default package). */
    packageOf: Map<string, string>;
    /** The files declaring a main:, sorted. */
    mains: string[];
};

function buildIndex(ctx: ResolveContext): JavaIndex {
    const index: JavaIndex = { declarers: new Map(), packages: new Set(), simpleNames: new Set(), packageOf: new Map(), mains: [] };
    for (const file of [...ctx.files.keys()].sort(byPath)){
        for (const fact of ctx.files.get(file)!.declares){
            if (fact.startsWith("package:")){
                const pkg = fact.slice("package:".length);
                index.packages.add(pkg);
                index.packageOf.set(file, pkg);
            } else if (fact.startsWith("type:")){
                const name = fact.slice("type:".length);
                const files = index.declarers.get(name);
                if (files === undefined) index.declarers.set(name, [file]);
                else files.push(file);
                index.simpleNames.add(name.slice(name.lastIndexOf(".") + 1));
            } else if (fact.startsWith("main:") && index.mains.at(-1) !== file){
                index.mains.push(file);   // once per file, though two of its types may have a main
            }
        }
    }
    return index;
}

/** The leading folder segments two folders share ("a/b/c" and "a/b/d" share 2). */
function sharedSegments(a: string, b: string): number {
    const x = a === "" ? [] : a.split("/");
    const y = b === "" ? [] : b.split("/");
    let n = 0;
    while (n < x.length && n < y.length && x[n] === y[n]) n++;
    return n;
}

/**
 * The importer's source root: its folder minus its package's path (app/src/main/java for
 * app/src/main/java/com/example/app/App.java in com.example.app), or null when its folder doesn't end with that path.
 */
function sourceRootOf(file: string, pkg: string): string | null {
    const folder = dirOf(file);
    if (pkg === "") return folder;
    const packagePath = pkg.replace(/\./g, "/");
    if (folder === packagePath) return "";
    return folder.endsWith(`/${packagePath}`) ? folder.slice(0, -(packagePath.length + 1)) : null;
}

export function createJavaResolver(ctx: ResolveContext): LanguageResolver {
    const index = buildIndex(ctx);
    const onDemandCache = new Map<string, string[]>();

    /** The importer's on-demand imports (`import a.b.*;` → a.b), in its source order. */
    const onDemandOf = (importer: string): string[] => {
        let found = onDemandCache.get(importer);
        if (found === undefined){
            found = (ctx.files.get(importer)?.importSpecifiers ?? [])
                .filter((s) => s.startsWith("import:") && s.endsWith(".*"))
                .map((s) => s.slice("import:".length, -".*".length));
            onDemandCache.set(importer, found);
        }
        return found;
    };

    /**
     * One file among a name's declarers: the only one; else the one under the importer's source root; else the one
     * sharing the most leading folders with the importer. A tie names nothing.
     */
    const pick = (files: readonly string[], importer: string): string[] => {
        if (files.length === 1) return [files[0]];
        const root = sourceRootOf(importer, index.packageOf.get(importer) ?? "");
        const inRoot = root === null || root === "" ? [] : files.filter((f) => f.startsWith(`${root}/`));
        if (inRoot.length === 1) return inRoot;
        const candidates = inRoot.length > 1 ? inRoot : files;
        const folder = dirOf(importer);
        let best: string[] = [];
        let most = -1;
        for (const f of candidates){
            const shared = sharedSegments(folder, dirOf(f));
            if (shared > most){
                most = shared;
                best = [f];
            } else if (shared === most){
                best.push(f);
            }
        }
        return best.length === 1 ? best : [];
    };

    /** A qualified name's file: the files declaring it, else its outer types', dropping a segment at a time. */
    const resolveQualified = (name: string, importer: string): string[] => {
        for (let current = name; current !== ""; current = current.includes(".") ? current.slice(0, current.lastIndexOf(".")) : ""){
            const files = index.declarers.get(current);
            if (files !== undefined) return pick(files, importer);
        }
        return [];
    };

    /** A simple type name in Java's order: the importer's own package, then its on-demand imports (one level). */
    const resolveSimple = (simple: string, importer: string): string[] => {
        const pkg = index.packageOf.get(importer) ?? "";
        const own = index.declarers.get(pkg === "" ? simple : `${pkg}.${simple}`);
        if (own !== undefined) return pick(own, importer);

        // two on-demand imports that both hold the name are ambiguous (a compile error in Java): nothing
        let hit: string[] | null = null;
        for (const w of onDemandOf(importer)){
            const files = index.declarers.get(`${w}.${simple}`);
            if (files === undefined) continue;
            if (hit !== null) return [];
            hit = files;
        }
        return hit === null ? [] : pick(hit, importer);
    };

    const resolve = (importer: string, specifier: string): string[] => {
        const colon = specifier.indexOf(":");
        const kind = specifier.slice(0, colon);
        const name = specifier.slice(colon + 1);
        if (kind === "import" && name.endsWith(".*")) return [];    // an on-demand import is a lookup aid, never an edge
        if (kind === "import" || kind === "static" || kind === "qualified") return resolveQualified(name, importer);
        if (kind === "type") return resolveSimple(name, importer);
        return [];
    };

    /** A qualified name's package: the name minus its last segment, then minus segments while it names a declared type. */
    const packageOfName = (name: string): string | null => {
        if (!name.includes(".")) return null;
        let pkg = name.slice(0, name.lastIndexOf("."));
        while (index.declarers.has(pkg)){
            if (!pkg.includes(".")) return null;
            pkg = pkg.slice(0, pkg.lastIndexOf("."));
        }
        return pkg;
    };

    const kindOf = (importer: string, specifier: string): ReferenceKind => {
        const colon = specifier.indexOf(":");
        const kind = specifier.slice(0, colon);
        const name = specifier.slice(colon + 1);
        if (kind === "import" && name.endsWith(".*")) return "context";
        if (resolve(importer, specifier).length > 0) return "internal";   // whatever resolves is internal (the plan)
        if (kind === "import" || kind === "static" || kind === "qualified"){
            const pkg = packageOfName(name);
            return pkg !== null && index.packages.has(pkg) ? "internal" : "external";
        }
        if (kind === "type") return index.simpleNames.has(name) ? "internal" : "external";
        return "external";
    };

    return {
        resolve,
        kindOf,
        entryPoints: () => index.mains.map((p) => ({ path: p, declaredBy: "public static void main" })),
    };
}
