import path from "path";
import { getDb } from "../db/client";
import { loadEntryPointsDeclaredBy } from "../db/store/entries";
import { loadFolderInfo } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { childToward, lcaFolder } from "../index/aggregate";
import { isTestPath } from "../index/discover";
import { dirOf, repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { rangeOf } from "./graph";
import { importIndexFor, reach, type Direction, type ImportIndex, type ReachAnswer, type Reached } from "./reach";

export type ImpactArea = { path: string; kind: "folder" | "file"; count: number };
/**
 * Files nothing imports among those reached, tests left out: the declared entry points, and the others (R8, widened by
 * ADR-065). manifestOnly: every declared one came from a package.json, so the answer can say "a package.json".
 */
export type Roots = { declared: string[]; others: string[]; manifestOnly: boolean };

/** What depends on a place (or what it depends on), counted by area (ADR-055): "what breaks if I change this". */
export type Impact = {
    reach: ReachAnswer;
    /** The folder whose children are the areas; "" the repo's top level; null describe's used-by rule. */
    groupBy: string | null;
    areas: ImpactArea[];
    /** Files outside groupBy (always 0 when groupBy is null). */
    elsewhere: number;
    /** Test files among those reached. */
    tests: number;
    /** Only for dependents. */
    roots: Roots | null;
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Each reached file's area: the child of groupBy holding it (files outside it are "elsewhere"); or, with no groupBy,
 * describe's used-by rule, the child of the lowest folder holding both it and the target, on the way to it.
 */
export function areasOf(reached: readonly Reached[], target: { path: string; kind: "folder" | "file" }, groupBy: string | null): { areas: ImpactArea[]; elsewhere: number } {
    const home = target.kind === "file" ? dirOf(target.path) : target.path;
    const counts = new Map<string, ImpactArea>();
    let elsewhere = 0;
    for (const r of reached){
        let area: string;
        if (groupBy === null) area = childToward(lcaFolder(home, dirOf(r.path)), r.path);
        else if (groupBy === "" || r.path.startsWith(`${groupBy}/`)) area = childToward(groupBy, r.path);
        else{
            elsewhere++;
            continue;
        }
        const entry = counts.get(area) ?? { path: area, kind: area === r.path ? "file" as const : "folder" as const, count: 0 };
        entry.count++;
        counts.set(area, entry);
    }
    return { areas: [...counts.values()].sort((a, b) => b.count - a.count || compare(a.path, b.path)), elsewhere };
}

/**
 * The files among `reached` that nothing imports, tests left out, split by whether an entry point's declaration names
 * them (`entries`: path → declaredBy); each by path.
 */
export function rootsAmong(reached: readonly Reached[], inDegreeOf: (p: string) => number, entries: ReadonlyMap<string, string>): Roots {
    const roots = reached.map((r) => r.path).filter((p) => inDegreeOf(p) === 0 && !isTestPath(p)).sort(compare);
    const declared = roots.filter((p) => entries.has(p));
    return { declared, others: roots.filter((p) => !entries.has(p)), manifestOnly: declaredByPackageJson(declared, entries) };
}

/** Whether every one of these entry points came from a package.json (ADR-065): then the answers name it, as before E4. */
export function declaredByPackageJson(declared: readonly string[], entries: ReadonlyMap<string, string>): boolean {
    return declared.every((p) => entries.get(p)?.includes("package.json") === true);
}

/** How many files import a file, from the import index (0 for a path it doesn't hold). */
export function inDegreeIn(index: ImportIndex): (p: string) => number {
    return (p) => {
        const [at, end] = rangeOf(index, p, "file");
        return end > at ? index.inDegree[at] : 0;
    };
}

export function impact(repoRoot: string, targetPath: string, direction: Direction, options: { groupBy: string | null; within?: string }): Impact {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const groupBy = options.groupBy;
        if (groupBy !== null && groupBy !== "" && !loadFolderInfo(db, repoId, groupBy)){
            throw new BadInputError(`group_by takes a folder: nothing is indexed as a folder at "${groupBy}".`);
        }
        const answer = reach(repoRoot, targetPath, direction, { within: options.within });
        const { areas, elsewhere } = areasOf(answer.reached, { path: answer.path, kind: answer.kind }, groupBy);
        const tests = answer.reached.filter((r) => isTestPath(r.path)).length;
        const roots = direction === "dependents"
            ? rootsAmong(answer.reached, inDegreeIn(importIndexFor(db, repoId, answer.indexVersion)), loadEntryPointsDeclaredBy(db, repoId))
            : null;
        return { reach: answer, groupBy, areas, elsewhere, tests, roots };
    });
}
