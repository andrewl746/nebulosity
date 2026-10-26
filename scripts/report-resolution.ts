/**
 * npm run report-resolution -- <path-to-repo>
 *
 * The share of an indexed repo's import specifiers the resolver turns into files (S10). It reads the stored specifiers
 * and resolves each again with today's resolver, reading the repo's workspace as a full run does (ADR-053), so a
 * specifier whose target another specifier of the same file already reached still counts as resolved. A relative one
 * that resolves to nothing and names a file the index doesn't read (a style sheet, JSON, an image, a font) is counted on
 * a line of its own, out of the relative share. Read-only: it opens the database read-only (ADR-044) and writes nothing.
 *
 * Then each other language with files (E4, ADR-065): its internal references and the share resolved, the external and
 * context ones, the same per class (each L3 bar is per class), and its first 20 misses in a fixed order.
 */
import path from "path";
import { getDb, useReadOnlyDatabase, type Db } from "../lib/db/client";
import { loadStoredFiles, requireRepository } from "../lib/db/store/structure";
import { listManifests } from "../lib/index/discover";
import type { LanguageAdapter } from "../lib/index/languages/adapter";
import { ADAPTERS, adapterFor } from "../lib/index/languages/registry";
import { createResolvers } from "../lib/index/languages/resolution";
import { repoKey } from "../lib/index/paths";
import { repoTextReader } from "../lib/index/pipeline";
import { adapterReportLines, adapterResolutionReport, resolutionReport } from "./resolution";

/** The report's lines for an indexed repo: TypeScript's as before E4, then every other language with files. */
export function resolutionLines(db: Db, root: string, repoId: number, adapters: readonly LanguageAdapter[] = ADAPTERS): string[] {
    const stored = loadStoredFiles(db, repoId);
    // the manifests as discoverFiles lists them (listManifests is that list without the rest of discovery)
    const resolvers = createResolvers(adapters, {
        root, fileSet: new Set(stored.keys()), manifests: listManifests(root, adapters), readText: repoTextReader(root), cache: new Map(),
    }, stored);
    const filesOf = (adapter: LanguageAdapter) => [...stored].filter(([p]) => adapterFor(p, adapters) === adapter)
        .map(([p, f]) => ({ path: p, specifiers: f.importSpecifiers }));

    const ts = adapters.find((a) => a.id === "typescript");
    const tsResolver = resolvers.get("typescript");
    const report = resolutionReport(ts === undefined ? [] : filesOf(ts), (importer, specifier) => tsResolver?.resolve(importer, specifier)[0] ?? null);
    const pct = (r: { total: number; resolved: number }): string => (r.total === 0 ? "n/a" : `${((100 * r.resolved) / r.total).toFixed(1)}%`);

    const lines = [
        `[resolution] ${repoKey(root)}: ${stored.size} files`,
        `[resolution] relative: ${report.relative.resolved}/${report.relative.total} (${pct(report.relative)})`,
    ];
    if (report.notCode.total > 0){
        const top = report.notCode.byExtension.slice(0, 6).map((e) => `${e.extension} ${e.count}`).join(", ");
        lines.push(`[resolution] relative, not code: ${report.notCode.total} name files the index doesn't read (${top}${report.notCode.byExtension.length > 6 ? ", …" : ""}), left out above`);
    }
    lines.push(`[resolution] bare: ${report.bare.resolved}/${report.bare.total} (${pct(report.bare)})`);
    for (const miss of report.unresolvedBare) lines.push(`[resolution]   unresolved ${miss.name}: ${miss.count}`);

    for (const adapter of adapters){
        const resolver = resolvers.get(adapter.id);
        if (adapter.id === "typescript" || resolver === undefined) continue;
        lines.push(...adapterReportLines(adapter.id, adapterResolutionReport(filesOf(adapter), resolver)));
    }
    return lines;
}

function main(): void {
    const target = process.argv[2];
    if (!target){
        console.error("usage: npm run report-resolution -- <path-to-repo>");
        process.exit(1);
    }
    const root = path.resolve(target);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it makes this process open the database read-only (ADR-044)
    useReadOnlyDatabase();
    const db = getDb();
    for (const line of resolutionLines(db, root, requireRepository(db, repoKey(root)))) console.log(line);
}

if (/[\\/]report-resolution\.ts$/.test(process.argv[1] ?? "")) main();
