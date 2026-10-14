/**
 * npm run export-demo -- <path-to-repo> [--out <folder>] [--name <public name>]
 *
 * Writes the static demo's data (ADR-049, API_CONTRACTS.md §18) to <Nebulosity>/.nebulosity/demo by default. It only
 * reads the database, so it runs while the Map is open. Exits 1 when any file holds a path of this machine or the git
 * email; the demo must never publish one (D7).
 */
import { execFileSync } from "child_process";
import path from "path";
import { useReadOnlyDatabase } from "../lib/db/client";
import { exportDemo, ExportRefusedError, IndexChangedError } from "../lib/demo/export";
import { nebulosityPath } from "../lib/home";

const args = process.argv.slice(2);
const USAGE = "usage: npm run export-demo -- <path-to-repo> [--out <folder>] [--name <public name>]";
const flag = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
};
// a flag with no value, or with another flag where its value belongs (--out --name x), is a mistake, not a default
const missingValue = ["--out", "--name"].some((name) => args.includes(name) && (flag(name) === undefined || flag(name)!.startsWith("--")));
const target = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--name");

function gitEmail(): string | null {
    try{
        return execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim() || null;
    } catch{
        return null;
    }
}

if (!target || missingValue){
    console.error(USAGE);
    process.exit(1);
}

// eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it makes this process open the database read-only (ADR-044)
useReadOnlyDatabase();
const out = path.resolve(flag("--out") ?? nebulosityPath(".nebulosity", "demo"));
const started = performance.now();
let report: ReturnType<typeof exportDemo>;
try{
    report = exportDemo(path.resolve(target), out, { publicName: flag("--name"), email: gitEmail() });
} catch (err){
    // the two failures with a plain remedy are one line, not a stack trace
    if (err instanceof ExportRefusedError || err instanceof IndexChangedError){
        console.error(`[export-demo] ${err.message}`);
        process.exit(1);
    }
    throw err;
}
console.log(`[export-demo] ${out}: ${report.files.toLocaleString("en-US")} files, ${(report.bytes / 1e6).toFixed(1)} MB`
    + ` (${report.levelFiles} level pages, ${report.bundles} describe bundles, ${report.pageIndexes} page indexes),`
    + ` index version ${report.indexVersion}, ${((performance.now() - started) / 1000).toFixed(1)} s`);
for (const leak of report.leaks) console.error(`[export-demo] LEAK in ${leak.file}: ${leak.needle}`);
process.exit(report.leaks.length === 0 ? 0 : 1);
