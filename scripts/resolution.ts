import { packageNameOf } from "../lib/index/workspace";

/**
 * How much of a repo's import specifiers the index resolves (S10, PIVOT_SPEC.md §2): relative ones, which should all
 * resolve, and bare ones, which resolve only when they name the repo's own code (a workspace package, an alias, a
 * module id). Unresolved bare ones are listed by package name, so a reader tells "react" (outside the repo) from
 * "@affine/core" (a miss). A relative specifier that resolves to nothing and names a file the index doesn't read (a style
 * sheet, JSON, an image, a font, a .vue component) can't become an edge, so it is counted apart, by extension, and left
 * out of the relative share.
 */
export type ResolutionReport = {
    relative: { total: number; resolved: number };
    bare: { total: number; resolved: number };
    unresolvedBare: { name: string; count: number }[];
    /** Unresolved relative specifiers naming a file the index doesn't read, by extension, most first: not in `relative`. */
    notCode: { total: number; byExtension: { extension: string; count: number }[] };
};

/** The package a bare specifier names (shared with the resolver, ADR-053). */
export { packageNameOf };

/**
 * Extensions of files an import can name that the index doesn't read: style sheets, data, images, fonts, media, binaries
 * (WebAssembly, native addons, archives), and other languages' components. A name with any other dot ("./app.service",
 * "./x.contribution") is code.
 */
export const NOT_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
    ".css", ".scss", ".sass", ".less", ".styl", ".stylus", ".sss", ".pcss",
    ".json", ".json5", ".jsonc", ".yaml", ".yml", ".toml", ".txt", ".md", ".mdx", ".html", ".xml", ".csv",
    ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".mp4", ".mov", ".webm", ".wav", ".ogg",
    ".wasm", ".node", ".zip", ".pdf", ".vue", ".svelte", ".astro", ".graphql", ".gql",
]);

const isRelative = (s: string): boolean => s === "." || s === ".." || s.startsWith("./") || s.startsWith("../");

/** A specifier's file extension, lowercased, a bundler's "?query" dropped: "./a.css?inline" → ".css"; "" when none. */
export function extensionOf(specifier: string): string {
    const query = specifier.indexOf("?");
    const file = (query > 0 ? specifier.slice(0, query) : specifier).split("/").pop() ?? "";
    const dot = file.lastIndexOf(".");
    return dot > 0 ? file.slice(dot).toLowerCase() : "";
}

export function resolutionReport(
    files: readonly { path: string; specifiers: readonly string[] }[],
    resolve: (importer: string, specifier: string) => string | null,
    top = 15,
): ResolutionReport {
    const report: ResolutionReport = {
        relative: { total: 0, resolved: 0 }, bare: { total: 0, resolved: 0 }, unresolvedBare: [], notCode: { total: 0, byExtension: [] },
    };
    const misses = new Map<string, number>();
    const notCode = new Map<string, number>();
    for (const file of files){
        for (const specifier of file.specifiers){
            if (isRelative(specifier)){
                const resolved = resolve(file.path, specifier) !== null;
                const extension = extensionOf(specifier);
                // only when it names no file the index holds: AFFiNE's "./styles.css" is the vanilla-extract file styles.css.ts
                if (!resolved && NOT_CODE_EXTENSIONS.has(extension)){
                    report.notCode.total++;
                    notCode.set(extension, (notCode.get(extension) ?? 0) + 1);
                    continue;
                }
                report.relative.total++;
                if (resolved) report.relative.resolved++;
                continue;
            }
            report.bare.total++;
            if (resolve(file.path, specifier) !== null) report.bare.resolved++;
            else{
                const name = packageNameOf(specifier);
                misses.set(name, (misses.get(name) ?? 0) + 1);
            }
        }
    }
    const mostFirst = (a: [string, number], b: [string, number]): number => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    report.unresolvedBare = [...misses].sort(mostFirst).slice(0, top).map(([name, count]) => ({ name, count }));
    report.notCode.byExtension = [...notCode].sort(mostFirst).map(([extension, count]) => ({ extension, count }));
    return report;
}
