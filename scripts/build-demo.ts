/**
 * npm run build-demo [-- --data <folder>]
 *
 * The static demo (ADR-049): builds the Map in demo mode into out/, copies the exported data (npm run export-demo)
 * into out/demo/, refuses the result if any file holds a path of this machine or the git email (D7), and checks it
 * against the host: Vercel's Hobby plan takes 15,000 files and 100 MB per CLI deployment, so this refuses more than
 * 14,000 files or 95 MB (demo-limits.ts), and says why. Then it says how to look at it and how to deploy it (the owner
 * deploys). Next builds in the Nebulosity home, the folder out/ and the scan are about.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { DEMO_FORMAT_VERSION, type DemoManifest } from "../lib/contracts";
import { readConfig } from "../lib/config";
import { leakNeedles, scanForLeaks } from "../lib/demo/privacy";
import { dataPath, nebulosityHome, nebulosityPath } from "../lib/home";
import { MAX_BYTES, MAX_FILES, refusals } from "./demo-limits";
import { gitEmail } from "./git-email";

const USAGE = "usage: npm run build-demo [-- --data <folder>]";

function walk(dir: string): { files: number; bytes: number; byTop: Map<string, number> } {
    const byTop = new Map<string, number>();
    let files = 0;
    let bytes = 0;
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })){
        if (!entry.isFile()) continue;
        const size = fs.statSync(path.join(entry.parentPath, entry.name)).size;
        const top = path.relative(dir, entry.parentPath).split(path.sep)[0] || ".";
        files++;
        bytes += size;
        byTop.set(top, (byTop.get(top) ?? 0) + size);
    }
    return { files, bytes, byTop };
}

const args = process.argv.slice(2);
const dataFlag = args.indexOf("--data");
// a flag with no value, or with another flag where its value belongs, is a mistake, not a default
if (dataFlag !== -1 && (args[dataFlag + 1] === undefined || args[dataFlag + 1].startsWith("--"))){
    console.error(USAGE);
    process.exit(1);
}
const data = path.resolve(dataFlag === -1 ? dataPath("demo") : args[dataFlag + 1]);
const manifestFile = path.join(data, "manifest.json");
if (!fs.existsSync(manifestFile)){
    console.error(`[build-demo] no export at ${data}: run npm run export-demo -- <path-to-repo> first.`);
    process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as DemoManifest;
if (manifest.format !== DEMO_FORMAT_VERSION){
    console.error(`[build-demo] the export is format ${manifest.format}; this checkout writes ${DEMO_FORMAT_VERSION}. Export again.`);
    process.exit(1);
}

const next = path.join(nebulosityHome(), "node_modules", "next", "dist", "bin", "next");
const built = spawnSync(process.execPath, [next, "build"], {
    stdio: "inherit", cwd: nebulosityHome(), env: { ...process.env, NEBULOSITY_DEMO: "1", NEBULOSITY_WORKER: "off" },
});
if (built.status !== 0) process.exit(built.status ?? 1);

const out = nebulosityPath("out");
if (fs.existsSync(path.join(out, "api"))){
    console.error("[build-demo] out/api exists: the server's routes were built into the static site (R9). Stopping.");
    process.exit(1);
}
if (!fs.existsSync(path.join(out, "index.html"))){
    console.error(`[build-demo] next build finished but ${path.join(out, "index.html")} is missing: no static page was written. Nothing was copied.`);
    process.exit(1);
}
fs.rmSync(path.join(out, "demo"), { recursive: true, force: true });
fs.cpSync(data, path.join(out, "demo"), { recursive: true });

const activeRepo = readConfig().activeRepo;
const leaks = scanForLeaks(out, leakNeedles({ folders: [nebulosityHome(), ...(activeRepo ? [activeRepo] : [])], email: gitEmail("build-demo"), home: os.homedir() }));
const size = walk(out);
console.log(`[build-demo] out/: ${size.files.toLocaleString("en-US")} files, ${(size.bytes / 1e6).toFixed(1)} MB`
    + ` (limits ${MAX_FILES.toLocaleString("en-US")} files, ${MAX_BYTES / 1e6} MB)`);
for (const [top, bytes] of [...size.byTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${top}: ${(bytes / 1e6).toFixed(1)} MB`);
for (const leak of leaks) console.error(`[build-demo] LEAK in ${leak.file}: ${leak.needle}`);
const reasons = refusals(size, leaks.length);
if (reasons.length > 0){
    for (const reason of reasons) console.error(`[build-demo] REFUSED: ${reason}`);
    console.error("[build-demo] out/ must not be deployed.");
    process.exit(1);
}
console.log("[build-demo] ready. Look at it: npm run serve-demo. Deploy it (the owner): npx vercel deploy out --prod");
