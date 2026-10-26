/**
 * npm run sample-edges -- <path-to-repo> --language <files.language> [--count 30] [--seed 1] [--unresolved 20]
 *
 * E4's L4 (precision, ADR-065): a fixed-seed sample of one language's stored import edges for a reader to check in the
 * source, then a sample of its unresolved internal references for the reader to explain. Read-only (ADR-044).
 *
 * The draw: the edges whose source has that language, sorted by source then target, shuffled (Fisher–Yates, from the
 * last place down, the swap partner floor(random() * (i + 1))) with mulberry32(seed), the first `count` kept; the
 * unresolved internal references (re-resolved from the stored specifiers, as report-resolution does), sorted by file
 * then specifier, shuffled the same way with a fresh mulberry32(seed), the first `unresolved` kept. The same seed on the
 * same index always draws the same sample.
 */
import { eq } from "drizzle-orm";
import path from "path";
import { getDb, useReadOnlyDatabase, type Db } from "../lib/db/client";
import { files } from "../lib/db/schema";
import { loadImportEdges, loadStoredFiles, requireRepository, type ImportEdge } from "../lib/db/store/structure";
import { listManifests } from "../lib/index/discover";
import type { LanguageAdapter } from "../lib/index/languages/adapter";
import { ADAPTERS, adapterFor } from "../lib/index/languages/registry";
import { createResolvers } from "../lib/index/languages/resolution";
import { repoKey } from "../lib/index/paths";
import { repoTextReader } from "../lib/index/pipeline";
import { mulberry32 } from "./eval/stats";

export type EdgeSample = {
    edges: ImportEdge[];
    edgesTotal: number;
    unresolved: { importer: string; specifier: string }[];
    unresolvedTotal: number;
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The list's first n after a seeded Fisher–Yates shuffle (scripts/eval/draw.ts's draw). */
function drawn<T>(sorted: readonly T[], seed: number, n: number): T[] {
    const pool = [...sorted];
    const random = mulberry32(seed);
    for (let i = pool.length - 1; i > 0; i--){
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

export function sampleEdges(
    db: Db, root: string, repoId: number,
    options: { language: string; count?: number; seed?: number; unresolved?: number; adapters?: readonly LanguageAdapter[] }
): EdgeSample {
    const adapters = options.adapters ?? ADAPTERS;
    const seed = options.seed ?? 1;
    const ofLanguage = new Set(db.select({ path: files.path, language: files.language }).from(files).where(eq(files.repoId, repoId)).all()
        .filter((f) => f.language === options.language).map((f) => f.path));

    const edges = loadImportEdges(db, repoId).filter((e) => ofLanguage.has(e.source))
        .sort((a, b) => byText(a.source, b.source) || byText(a.target, b.target));

    const stored = loadStoredFiles(db, repoId);
    const resolvers = createResolvers(adapters, {
        root, fileSet: new Set(stored.keys()), manifests: listManifests(root, adapters), readText: repoTextReader(root), cache: new Map(),
    }, stored);
    const misses: { importer: string; specifier: string }[] = [];
    for (const [importer, file] of stored){
        if (!ofLanguage.has(importer)) continue;
        const resolver = resolvers.get(adapterFor(importer, adapters)?.id ?? "");
        if (resolver === undefined) continue;
        for (const specifier of file.importSpecifiers){
            if (resolver.kindOf(importer, specifier) === "internal" && resolver.resolve(importer, specifier).length === 0) misses.push({ importer, specifier });
        }
    }
    misses.sort((a, b) => byText(a.importer, b.importer) || byText(a.specifier, b.specifier));

    return {
        edges: drawn(edges, seed, options.count ?? 30),
        edgesTotal: edges.length,
        unresolved: drawn(misses, seed, options.unresolved ?? 20),
        unresolvedTotal: misses.length,
    };
}

function main(): void {
    const args = process.argv.slice(2);
    const target = args[0];
    const flag = (name: string): string | undefined => {
        const at = args.indexOf(`--${name}`);
        return at === -1 ? undefined : args[at + 1];
    };
    const number = (name: string, fallback: number): number => {
        const value = flag(name);
        return value === undefined ? fallback : Number(value);
    };
    const language = flag("language");
    const count = number("count", 30);
    const seed = number("seed", 1);
    const unresolved = number("unresolved", 20);
    if (!target || target.startsWith("--") || !language || ![count, seed, unresolved].every((n) => Number.isInteger(n) && n >= 0)){
        console.error("usage: npm run sample-edges -- <path-to-repo> --language <files.language> [--count 30] [--seed 1] [--unresolved 20]");
        process.exit(1);
    }

    const root = path.resolve(target);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it makes this process open the database read-only (ADR-044)
    useReadOnlyDatabase();
    const db = getDb();
    const sample = sampleEdges(db, root, requireRepository(db, repoKey(root)), { language, count, seed, unresolved });

    console.log(`[sample] ${repoKey(root)} ${language}: ${sample.edges.length} of ${sample.edgesTotal} edges (seed ${seed})`);
    for (const e of sample.edges) console.log(`${e.source} -> ${e.target}  (${e.specifier})`);
    console.log(`[sample] unresolved internal references: ${sample.unresolved.length} of ${sample.unresolvedTotal} (seed ${seed})`);
    for (const m of sample.unresolved) console.log(`${m.importer}  ${m.specifier}`);
}

if (/[\\/]sample-edges\.ts$/.test(process.argv[1] ?? "")) main();
