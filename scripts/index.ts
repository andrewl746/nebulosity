/**
 * npm run index -- <path-to-repo>
 *
 * Runs the structure stage on a repository, prints what it found and how long each
 * step took (the numbers recorded in docs/BENCHMARKS.md), and makes that repo the
 * active one for the Map and the MCP server.
 */
import path from "path";
import { indexRepository, repoKey } from "../lib/index/pipeline";
import { IndexLockedError } from "../lib/db/store/lock";
import { writeConfig } from "../lib/config";

const target = process.argv[2];

if (!target){
    console.error("usage: npm run index -- <path-to-repo>");
    process.exit(1);
}

const root = path.resolve(target);
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

console.log(`[index] ${root}`);

try{
    const result = indexRepository(root, {
        onProgress: (stage, done, total) => process.stdout.write(`\r[index] ${stage} ${done}/${total}   `),
    });
    process.stdout.write("\n");

    console.log(`[index] files ${result.files} (changed ${result.changed}, unchanged ${result.unchanged}, deleted ${result.deleted.length})`
        + ` · edges ${result.edges} · folders ${result.folders} · level edges ${result.levelEdges}`);
    console.log(`[index] discover ${seconds(result.timingsMs.discover)} · parse ${seconds(result.timingsMs.parse)}`
        + ` · write ${seconds(result.timingsMs.write)} · resolve ${seconds(result.timingsMs.resolve)}`
        + ` · aggregate ${seconds(result.timingsMs.aggregate)} · total ${seconds(result.totalMs)}`);

    if (result.skipped.length > 0){
        console.log(`[index] skipped ${result.skipped.length} (first: ${result.skipped[0].path}: ${result.skipped[0].reason})`);
    }
    if (result.errors.length > 0){
        console.log(`[index] ${result.errors.length} file errors (first: ${result.errors[0].path}: ${result.errors[0].error})`);
    }

    writeConfig({ activeRepo: repoKey(root) });
    console.log(`[index] active repo → ${repoKey(root)}`);
} catch (err){
    if (err instanceof IndexLockedError){
        console.error(`[index] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
        process.exit(2);
    }
    throw err;
}
