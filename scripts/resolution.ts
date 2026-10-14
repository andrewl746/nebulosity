import { packageNameOf } from "../lib/index/workspace";

/**
 * How much of a repo's import specifiers the index resolves (S10, PIVOT_SPEC.md §2): relative ones, which should all
 * resolve, and bare ones, which resolve only when they name the repo's own code (a workspace package, an alias, a
 * module id). Unresolved bare ones are listed by package name, so a reader tells "react" (outside the repo) from
 * "@affine/core" (a miss).
 */
export type ResolutionReport = {
    relative: { total: number; resolved: number };
    bare: { total: number; resolved: number };
    unresolvedBare: { name: string; count: number }[];
};

/** The package a bare specifier names (shared with the resolver, ADR-053). */
export { packageNameOf };

const isRelative = (s: string): boolean => s === "." || s === ".." || s.startsWith("./") || s.startsWith("../");

export function resolutionReport(
    files: readonly { path: string; specifiers: readonly string[] }[],
    resolve: (importer: string, specifier: string) => string | null,
    top = 15,
): ResolutionReport {
    const report: ResolutionReport = { relative: { total: 0, resolved: 0 }, bare: { total: 0, resolved: 0 }, unresolvedBare: [] };
    const misses = new Map<string, number>();
    for (const file of files){
        for (const specifier of file.specifiers){
            const resolved = resolve(file.path, specifier) !== null;
            const bucket = isRelative(specifier) ? report.relative : report.bare;
            bucket.total++;
            if (resolved) bucket.resolved++;
            else if (!isRelative(specifier)){
                const name = packageNameOf(specifier);
                misses.set(name, (misses.get(name) ?? 0) + 1);
            }
        }
    }
    report.unresolvedBare = [...misses]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, top);
    return report;
}
