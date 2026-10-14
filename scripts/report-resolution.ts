/**
 * npm run report-resolution -- <path-to-repo>
 *
 * The share of an indexed repo's import specifiers the resolver turns into files (S10). It reads the stored specifiers
 * and resolves each again with today's resolver, so a specifier whose target another specifier of the same file already
 * reached still counts as resolved. Read-only: it opens the database and writes nothing.
 */
import path from "path";
import { getDb } from "../lib/db/client";
import { loadStoredFiles, requireRepository } from "../lib/db/store/structure";
import { repoKey } from "../lib/index/paths";
import { createResolver } from "../lib/index/resolve";
import { resolutionReport } from "./resolution";

const target = process.argv[2];
if (!target){
    console.error("usage: npm run report-resolution -- <path-to-repo>");
    process.exit(1);
}
const root = path.resolve(target);
const db = getDb();
const stored = loadStoredFiles(db, requireRepository(db, repoKey(root)));
const resolve = createResolver(root, new Set(stored.keys()));
const report = resolutionReport([...stored].map(([p, f]) => ({ path: p, specifiers: f.importSpecifiers })), resolve);
const pct = (r: { total: number; resolved: number }): string => (r.total === 0 ? "n/a" : `${((100 * r.resolved) / r.total).toFixed(1)}%`);

console.log(`[resolution] ${repoKey(root)}: ${stored.size} files`);
console.log(`[resolution] relative: ${report.relative.resolved}/${report.relative.total} (${pct(report.relative)})`);
console.log(`[resolution] bare: ${report.bare.resolved}/${report.bare.total} (${pct(report.bare)})`);
for (const miss of report.unresolvedBare) console.log(`[resolution]   unresolved ${miss.name}: ${miss.count}`);
