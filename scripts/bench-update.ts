/**
 * npm run bench-update -- <path-to-repo> <repo-relative file> [--runs 5]
 *
 * S6 (PIVOT_SPEC.md §2): the time from saving a file until describe() shows the change, through the running server
 * and its background worker, as a user sees it. Each run appends an export to the file and polls GET /api/describe
 * every 25 ms until the new symbol shows. It then restores the file's exact bytes and waits until the symbol is gone.
 * Needs npm run dev with that repo active. The file is always restored, and the script checks it was.
 */
import fs from "fs";
import path from "path";
import { readConfig } from "../lib/config";

const args = process.argv.slice(2);
const [target, rel] = args;
const runsAt = args.indexOf("--runs");
const runs = runsAt === -1 ? 5 : Number(args[runsAt + 1]);
if (!target || !rel || rel.startsWith("--") || !Number.isInteger(runs) || runs < 1){
    console.error("usage: npm run bench-update -- <path-to-repo> <repo-relative file> [--runs 5]");
    process.exit(1);
}

const file = path.join(path.resolve(target), rel);
const original = fs.readFileSync(file);
const url = `http://127.0.0.1:${readConfig().port}/api/describe?path=${encodeURIComponent(rel)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function hasSymbol(name: string): Promise<boolean> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`describe answered ${response.status}: is npm run dev running with this repo active?`);
    const body = (await response.json()) as { symbols?: { name: string }[] };
    return (body.symbols ?? []).some((s) => s.name === name);
}

async function waitFor(name: string, present: boolean, limitMs: number): Promise<number> {
    const started = performance.now();
    while (performance.now() - started < limitMs){
        if ((await hasSymbol(name)) === present) return performance.now() - started;
        await sleep(25);
    }
    throw new Error(`gave up after ${limitMs} ms waiting for ${name} to ${present ? "appear" : "go"}`);
}

async function main(): Promise<void> {
    const timings: number[] = [];
    try{
        for (let i = 0; i < runs; i++){
            const name = `__nebulosityBench${i}`;
            fs.writeFileSync(file, Buffer.concat([original, Buffer.from(`\nexport const ${name} = ${i};\n`)]));
            timings.push(await waitFor(name, true, 30_000));
            fs.writeFileSync(file, original);
            await waitFor(name, false, 30_000);
            await sleep(500);
        }
    } finally{
        fs.writeFileSync(file, original);
    }
    if (!fs.readFileSync(file).equals(original)) throw new Error(`${rel} wasn't restored byte for byte`);

    const sorted = [...timings].sort((a, b) => a - b);
    const worst = sorted[sorted.length - 1];
    console.log(`[bench-update] ${rel}: save → describe shows it, ${runs} runs: ${timings.map((t) => `${Math.round(t)} ms`).join(", ")}`);
    console.log(`[bench-update] median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms · worst ${Math.round(worst)} ms · S6 (≤ 2,000 ms): ${worst <= 2_000 ? "PASS" : "FAIL"}`);
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
