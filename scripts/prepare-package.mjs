#!/usr/bin/env node
// Makes a built Map (.next) fit to ship in the package (ADR-058). Run in the checkout or worktree that packs, after
// `next build` (`npm run build:package` does both); npm's prepack runs the check alone, so a build that would ship broken
// or with a machine path in it is never packed:
//   node scripts/prepare-package.mjs           fix the two things below, then check
//   node scripts/prepare-package.mjs --check   check only, writing nothing
//
// Two things in a Turbopack build don't survive `npm pack`:
// 1. The server's external packages (better-sqlite3, typescript, @huggingface/transformers) are loaded by a hashed name,
//    `.next/node_modules/<name>-<hash>`, which Turbopack makes as a link to node_modules/<name> (a junction with an
//    absolute target on Windows). npm leaves links out of a tarball, so an installed Map failed every API call with
//    "Cannot find module 'better-sqlite3-<hash>'". Each link becomes a small folder whose entry loads the package by its
//    real name, which Node then finds wherever npm installed it (nested in the package, or hoisted above it).
// 2. `.next/required-server-files.json` (and its .js twin) records the build folder's absolute path: appDir,
//    outputFileTracingRoot, repoRoot and turbopack.root. `next start` reads only its config flags, so each becomes ".":
//    nothing of the build machine goes into anything published (ADR-051).
// The check then reads every file under .next that package.json's `files` ships (cache and dev left out) and fails on
// any link or any spelling of the build folder or the home folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const NEXT = path.join(ROOT, ".next");
const SHIPPED_OUT = new Set(["cache", "dev"]);   // package.json's files leaves .next/cache and .next/dev out
const HASHED = /^(.+)-[0-9a-f]{16}$/;
const checkOnly = process.argv.includes("--check");

/** Each folder in .next/node_modules that stands for a package (scoped ones one level down), with its real name. */
function externals(){
    const dir = path.join(NEXT, "node_modules");
    if (!fs.existsSync(dir)) return [];
    const found = [];
    for (const entry of fs.readdirSync(dir)){
        const names = entry.startsWith("@") ? fs.readdirSync(path.join(dir, entry)).map((child) => `${entry}/${child}`) : [entry];
        for (const name of names){
            const match = HASHED.exec(name);
            found.push({ hashed: name, real: match ? match[1] : null, at: path.join(dir, ...name.split("/")) });
        }
    }
    return found;
}

/** Replaces Turbopack's link with a folder that loads the real package, for require (CJS) and import (ESM) alike. */
async function replaceLink(external){
    // what the package exports to an import: a default (a CommonJS package's module.exports, or an ESM default) or not
    const namespace = await import(external.real);
    const esm = [`export * from ${JSON.stringify(external.real)};`];
    if ("default" in namespace) esm.push(`export { default } from ${JSON.stringify(external.real)};`);

    fs.rmSync(external.at, { recursive: false, force: true });   // the link itself, never what it points at
    fs.mkdirSync(external.at, { recursive: true });
    fs.writeFileSync(path.join(external.at, "package.json"), `${JSON.stringify({
        name: external.hashed,
        private: true,
        description: `Loads ${external.real} under the name Turbopack's server bundle asks for (scripts/prepare-package.mjs).`,
        exports: { import: "./index.mjs", require: "./index.cjs" },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(external.at, "index.cjs"), `module.exports = require(${JSON.stringify(external.real)});\n`);
    fs.writeFileSync(path.join(external.at, "index.mjs"), `${esm.join("\n")}\n`);
}

/** Every spelling of a folder a built file might hold: as given, with forward slashes, and with JSON's escaped backslashes. */
function spellings(folder){
    const forward = folder.replace(/\\/g, "/");
    return [...new Set([folder, forward, folder.replace(/\\/g, "\\\\")])];
}

/** The build folder's path in the server files manifest becomes "." (see 2. above). */
function scrubServerFiles(){
    for (const name of ["required-server-files.json", "required-server-files.js"]){
        const file = path.join(NEXT, name);
        if (!fs.existsSync(file)) continue;
        let text = fs.readFileSync(file, "utf8");
        // the JSON-escaped spelling first: it's how both files write a Windows path
        for (const spelling of spellings(ROOT).sort((a, b) => b.length - a.length)) text = text.split(spelling).join(".");
        fs.writeFileSync(file, text);
    }
}

/** The files under .next that the package ships. */
function shippedFiles(dir = NEXT, top = true){
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })){
        if (top && SHIPPED_OUT.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) files.push({ file: full, link: true });
        else if (entry.isDirectory()) files.push(...shippedFiles(full, false));
        else files.push({ file: full, link: false });
    }
    return files;
}

/** Links (npm drops them) and machine paths (ADR-051) in what the package would ship. */
function problems(){
    const found = [];
    const machine = [...new Set([...spellings(ROOT), ...spellings(os.homedir())])];
    const windows = process.platform === "win32";
    const needles = windows ? machine.map((m) => m.toLowerCase()) : machine;
    for (const { file, link } of shippedFiles()){
        const shown = path.relative(ROOT, file);
        if (link){
            found.push(`${shown} is a link, which npm leaves out of the tarball`);
            continue;
        }
        // latin1 keeps every byte, so a path inside a binary file is found too
        const text = fs.readFileSync(file, "latin1");
        const haystack = windows ? text.toLowerCase() : text;
        if (needles.some((needle) => haystack.includes(needle))) found.push(`${shown} names this machine's folders`);
    }
    return found;
}

if (!fs.existsSync(path.join(NEXT, "BUILD_ID"))){
    // no built Map: the package works without one (`nebulosity map` says so, and doctor warns)
    console.log("prepare-package: no built Map (.next/BUILD_ID) to prepare or check");
    process.exit(0);
}

if (!checkOnly){
    for (const external of externals()){
        if (external.real === null || !fs.lstatSync(external.at).isSymbolicLink()) continue;
        await replaceLink(external);
        console.log(`prepare-package: .next/node_modules/${external.hashed} now loads ${external.real}`);
    }
    scrubServerFiles();
}

const found = problems();
for (const external of externals()){
    if (external.real === null) found.push(`.next/node_modules/${external.hashed} isn't a package Turbopack names <name>-<hash>`);
}
if (found.length > 0){
    for (const problem of found) console.error(`prepare-package: ${problem}`);
    console.error(checkOnly
        ? "prepare-package: this build can't be packed as it is. Run npm run build:package (next build, then this script) first."
        : "prepare-package: the build still can't be packed (above).");
    process.exit(1);
}
console.log(`prepare-package: ok (${externals().length} external packages, no links, no machine paths)`);
