/**
 * npm run bench-map -- <path-to-repo>
 *
 * S3's server side and S4 (PIVOT_SPEC.md §2). It calls level() for every folder of an indexed repo, and describe() for
 * every folder and about 500 files, in this process (no HTTP), then a repeat of each folder from the per-version cache.
 * It prints p50, p95 and max for each, and checks that no level or page draws more than 50 boxes. It writes nothing.
 */
import path from "path";
import { getDb } from "../lib/db/client";
import { requireRepository } from "../lib/db/store/structure";
import { loadFileFacts, loadFolderFacts } from "../lib/db/store/summaries";
import { describe } from "../lib/engine/describe";
import { level, MAP_BOX_CAP } from "../lib/engine/level";
import { repoKey } from "../lib/index/paths";

const target = process.argv[2];
if (!target){
    console.error("usage: npm run bench-map -- <path-to-repo>");
    process.exit(1);
}

const root = path.resolve(target);
const db = getDb();
const repoId = requireRepository(db, repoKey(root));
const folders = loadFolderFacts(db, repoId).map((f) => f.path);
const files = loadFileFacts(db, repoId).map((f) => f.path);
const step = Math.max(1, Math.floor(files.length / 500));
const sample = files.filter((_, i) => i % step === 0);   // about 500, spread over the repo

const timed = (fn: () => void): number => {
    const started = performance.now();
    fn();
    return performance.now() - started;
};

function report(label: string, ms: readonly number[]): string {
    const sorted = [...ms].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return `${label}: ${ms.length} calls · p50 ${at(0.5).toFixed(1)} ms · p95 ${at(0.95).toFixed(1)} ms · max ${sorted[sorted.length - 1].toFixed(1)} ms`;
}

// the first describe() loads the import graph, once per index version: timed on its own
const graphLoad = timed(() => describe(root, ""));

// level(): one pass to warm up, every page of a big folder included (S4 holds on each), then the measured pass
// (level() caches nothing)
let widest = 0;
let pagedFolders = 0;
let pageTotal = 0;
for (const folder of folders){
    const first = level(root, folder);
    widest = Math.max(widest, first.nodes.length);
    if (first.pageCount === 1) continue;
    pagedFolders++;
    pageTotal += first.pageCount;
    for (let page = 1; page < first.pageCount; page++) widest = Math.max(widest, level(root, folder, { page }).nodes.length);
}
const levelMs = folders.map((folder) => timed(() => level(root, folder)));

// describe(): one pass each, the way a first click on each target costs (area counts are cached per path)
const folderMs = folders.map((folder) => timed(() => describe(root, folder)));
const fileMs = sample.map((file) => timed(() => describe(root, file)));
// and a second click on each, right after the first: served from the answers cached for this index version (ADR-036,
// amended in V1.3.1). A whole second sweep would measure misses: 3,793 folders overflow the cache's 2,000-answer bound.
const cachedMs = folders.map((folder) => {
    describe(root, folder);
    return timed(() => describe(root, folder));
});

console.log(`[bench-map] ${root}: ${folders.length} folders, ${sample.length} of ${files.length} files`);
console.log(`[bench-map] first describe (loads the import graph): ${graphLoad.toFixed(0)} ms`);
console.log(`[bench-map] ${report("level", levelMs)}`);
console.log(`[bench-map] ${report("describe, folders", folderMs)}`);
console.log(`[bench-map] ${report("describe, files", fileMs)}`);
console.log(`[bench-map] ${report("describe, folders, repeated (cached)", cachedMs)}`);
console.log(`[bench-map] paged folders: ${pagedFolders} (${pageTotal} pages in all)`);
console.log(`[bench-map] most boxes on any level or page: ${widest} (S4, at most ${MAP_BOX_CAP}: ${widest <= MAP_BOX_CAP ? "PASS" : "FAIL"})`);
