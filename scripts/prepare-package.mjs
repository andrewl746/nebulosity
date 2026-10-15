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
// any link or any spelling of the build folder or the home folder. It runs whenever .next exists, and a .next without a
// BUILD_ID (a build that didn't finish, or a dev server's) is refused, not passed as "no Map": it would ship as it is.
//
// Before any of that, in a git checkout, it refuses a file git doesn't track in a folder the package ships whole (bin,
// lib, mcp, app, public, scripts/commands): npm packs what is on disk, so a work-in-progress file there would ship.
//
// The spellings are lib/demo/privacy.ts's, the rules the demo export and the eval's transcripts are held to (ADR-049,
// ADR-051): forward and back slashes, JSON's escapes, URL-encoded either way (Ann%20Lee), Git Bash's /c/…, Claude Code's
// folder name (C--Users-Ann), and any mix of separators or deeper escaping. This script loads that file through tsx (a
// dependency, which bin/boot.mjs loads the same way) rather than keeping a plain-JS copy: one copy of the rules can't drift.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { machineNeedles } from "./package-needles.mjs";

await import("tsx");
const { findLeak, leakNeedles } = await import("../lib/demo/privacy.ts");

const ROOT = process.cwd();
const NEXT = path.join(ROOT, ".next");
const SHIPPED_OUT = new Set(["cache", "dev"]);   // package.json's files leaves .next/cache and .next/dev out
const HASHED = /^(.+)-[0-9a-f]{16}$/;
const checkOnly = process.argv.includes("--check");
/** The folders package.json's `files` ships whole; its other entries are single files, which a stray file can't join. */
const SHIPPED_FOLDERS = ["bin", "lib", "mcp", "app", "public", "scripts/commands"];

/**
 * The files git doesn't track in the folders the package ships whole (ignored ones left out, as npm leaves them out
 * too). Nothing outside a git checkout. It throws when git can't answer, rather than call the folders clean.
 */
function untrackedShipped(){
    if (!fs.existsSync(path.join(ROOT, ".git"))) return [];   // a folder or, in a worktree, a file
    // -z: one NUL after each path, written as it is (no quoting of unusual characters)
    const git = spawnSync("git", ["ls-files", "-z", "--others", "--exclude-standard", "--", ...SHIPPED_FOLDERS], { cwd: ROOT, encoding: "utf8" });
    if (git.error || git.status !== 0){
        throw new Error(`prepare-package: git couldn't list the untracked files (${git.error?.message ?? git.stderr.trim()}), so nothing can be called clean.`);
    }
    return git.stdout.split("\0").filter(Boolean);
}

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

/**
 * How Next writes the build folder in its server files manifest: as given, with forward slashes, and with JSON's escaped
 * backslashes. These are what the fix rewrites to "."; the check after it looks for every spelling privacy.ts knows.
 */
function manifestSpellings(folder){
    const forward = folder.replace(/\\/g, "/");
    return [...new Set([folder, forward, folder.replace(/\\/g, "\\\\")])];
}

/** The build folder's path in the server files manifest becomes "." (see 2. above). */
function scrubServerFiles(){
    const folders = [...new Set([ROOT, fs.realpathSync.native(ROOT)])];
    for (const name of ["required-server-files.json", "required-server-files.js"]){
        const file = path.join(NEXT, name);
        if (!fs.existsSync(file)) continue;
        let text = fs.readFileSync(file, "utf8");
        // the longest spelling first (the JSON-escaped one, how both files write a Windows path)
        for (const spelling of folders.flatMap(manifestSpellings).sort((a, b) => b.length - a.length)) text = text.split(spelling).join(".");
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

/**
 * Links (npm drops them) and machine paths (ADR-051) in what the package would ship. The machine's folders are the build
 * folder (as the working folder and with its links resolved) and the home folder; machineNeedles leaves out one too
 * shallow to scan for, and throws when none is left, rather than call every file clean.
 */
function problems(){
    const found = [];
    // the home folder also names the pair a path cut off at its front still holds (privacy.ts), when it's deep enough to scan for
    const home = os.homedir();
    const needles = machineNeedles([ROOT, fs.realpathSync.native(ROOT), home], (input) => leakNeedles({ ...input, home: input.folders.includes(home) ? home : null }));
    for (const { file, link } of shippedFiles()){
        const shown = path.relative(ROOT, file);
        if (link){
            found.push(`${shown} is a link, which npm leaves out of the tarball`);
            continue;
        }
        // as privacy.ts's scanForLeaks reads a file: UTF-8, latin1 (every byte, so a path inside a binary file is found
        // too) and latin1 without its NULs (UTF-16 text)
        const bytes = fs.readFileSync(file);
        const latin1 = bytes.toString("latin1");
        const leak = findLeak(bytes.toString("utf8"), needles) ?? findLeak(latin1, needles) ?? findLeak(latin1.replace(/\0/g, ""), needles);
        if (leak !== null) found.push(`${shown} names this machine's folders`);
    }
    return found;
}

let untracked;
try{
    untracked = untrackedShipped().map((file) => `${file} isn't tracked by git, so npm would ship it: commit it, or move it out of ${SHIPPED_FOLDERS.join(", ")}`);
} catch (err){
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}

if (!fs.existsSync(NEXT)){
    if (untracked.length > 0){
        for (const problem of untracked) console.error(`prepare-package: ${problem}`);
        console.error("prepare-package: this can't be packed as it is (above).");
        process.exit(1);
    }
    // no built Map: the package works without one (`nebulosity map` says so, and doctor warns)
    console.log("prepare-package: no built Map (.next) to prepare or check");
    process.exit(0);
}
const built = fs.existsSync(path.join(NEXT, "BUILD_ID"));

if (!checkOnly && built){
    for (const external of externals()){
        if (external.real === null || !fs.lstatSync(external.at).isSymbolicLink()) continue;
        await replaceLink(external);
        console.log(`prepare-package: .next/node_modules/${external.hashed} now loads ${external.real}`);
    }
    scrubServerFiles();
}

let found;
try{
    found = problems();
} catch (err){
    // no needles: nothing can be called clean, so nothing is packed
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}
found.unshift(...untracked);
if (!built) found.unshift(".next has no BUILD_ID: a build that didn't finish, or a dev server's. Build the Map with npm run build:package, or remove .next.");
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
console.log(`prepare-package: ok (${externals().length} external packages, no links, no machine paths, no untracked files)`);
