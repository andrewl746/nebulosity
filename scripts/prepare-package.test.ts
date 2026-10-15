import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { leakNeedles } from "../lib/demo/privacy";
import { makeTempDir } from "../test/helpers/temp";
import { machineNeedles } from "./package-needles.mjs";

const SCRIPT = path.resolve("scripts", "prepare-package.mjs");
const HASHED = "better-sqlite3-0123456789abcdef";

/** The package folder the temp build's link points at: its own, so a removal that followed the link could only delete this. */
const FAKE_PACKAGE = path.join("fake-packages", "better-sqlite3");

/**
 * A built Map as Turbopack leaves it: a BUILD_ID, one server external linked under its hashed name (a junction on
 * Windows, as Turbopack makes it), the build folder's path in the server files manifest, and that path in the build
 * cache too, which the package never ships. The link points at a stand-in package folder inside the temp build, never at
 * the checkout's node_modules: a regression that removed through the link would otherwise delete the owner's package.
 * The folder is spelled with its links resolved, as `next build` writes it and the script reads it: both use their
 * working folder, which macOS and Linux give with links resolved. macOS's temp folder sits behind a link (/var is
 * /private/var), so a manifest holding the temp folder's unresolved spelling would be a path no real build writes.
 */
function turbopackBuild(): string {
    const root = fs.realpathSync.native(makeTempDir("neb-build-"));
    const next = path.join(root, ".next");
    fs.mkdirSync(path.join(next, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(next, "cache"));
    fs.writeFileSync(path.join(next, "BUILD_ID"), "build-1");
    fs.mkdirSync(path.join(root, FAKE_PACKAGE), { recursive: true });
    fs.writeFileSync(path.join(root, FAKE_PACKAGE, "package.json"), JSON.stringify({ name: "better-sqlite3", main: "index.js" }));
    fs.writeFileSync(path.join(root, FAKE_PACKAGE, "index.js"), "module.exports = {};\n");
    fs.symlinkSync(path.join(root, FAKE_PACKAGE), path.join(next, "node_modules", HASHED), process.platform === "win32" ? "junction" : "dir");
    const manifest = { config: { outputFileTracingRoot: root, turbopack: { root } }, appDir: root, relativeAppDir: "" };
    fs.writeFileSync(path.join(next, "required-server-files.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(next, "required-server-files.js"), `self.__SERVER_FILES_MANIFEST=${JSON.stringify(manifest, null, 2)};`);
    fs.writeFileSync(path.join(next, "cache", "notes.txt"), root);
    return root;
}

const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });

/** Whether a path is the folder or inside it, both resolved through their links (a junction's target is where it points). */
const inside = (p: string, folder: string): boolean => {
    const [a, b] = [fs.realpathSync.native(p), fs.realpathSync.native(folder)].map((x) => x.toLowerCase());
    return a === b || a.startsWith(`${b}${path.sep}`);
};

describe("the test's own build (sweep B, item 20)", () => {
    it("links the hashed name at a package folder inside the temp build, never at the checkout's node_modules", () => {
        const root = turbopackBuild();
        const link = path.join(root, ".next", "node_modules", HASHED);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(inside(link, root)).toBe(true);
        expect(inside(link, path.resolve("node_modules"))).toBe(false);
    });
});

describe("prepare-package (ADR-058: a built Map npm can pack, with nothing of the build machine in it)", () => {
    it("--check refuses a Turbopack build as it stands: the link and the build folder's path, never the cache", () => {
        const root = turbopackBuild();
        const result = run(root, "--check");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`${path.join(".next", "node_modules", HASHED)} is a link, which npm leaves out of the tarball`);
        expect(result.stderr).toContain(`${path.join(".next", "required-server-files.json")} names this machine's folders`);
        expect(result.stderr).toContain(`${path.join(".next", "required-server-files.js")} names this machine's folders`);
        expect(result.stderr).not.toContain("notes.txt");
        expect(fs.lstatSync(path.join(root, ".next", "node_modules", HASHED)).isSymbolicLink()).toBe(true);   // --check writes nothing
    });

    it("turns the link into a folder that loads the package by its real name, and the build folder into \".\"", () => {
        const root = turbopackBuild();
        const result = run(root);
        expect(result.status, result.stderr).toBe(0);

        const stub = path.join(root, ".next", "node_modules", HASHED);
        expect(fs.lstatSync(stub).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(path.join(stub, "index.cjs"), "utf8")).toBe('module.exports = require("better-sqlite3");\n');
        // better-sqlite3 is CommonJS, so an import of it has a default: its module.exports
        expect(fs.readFileSync(path.join(stub, "index.mjs"), "utf8")).toBe('export * from "better-sqlite3";\nexport { default } from "better-sqlite3";\n');
        expect(JSON.parse(fs.readFileSync(path.join(stub, "package.json"), "utf8")).exports).toEqual({ import: "./index.mjs", require: "./index.cjs" });
        // the link's target is untouched: only the link was removed
        expect(fs.readFileSync(path.join(root, FAKE_PACKAGE, "index.js"), "utf8")).toBe("module.exports = {};\n");

        const manifest = JSON.parse(fs.readFileSync(path.join(root, ".next", "required-server-files.json"), "utf8"));
        expect(manifest).toEqual({ config: { outputFileTracingRoot: ".", turbopack: { root: "." } }, appDir: ".", relativeAppDir: "" });
        expect(fs.readFileSync(path.join(root, ".next", "required-server-files.js"), "utf8")).not.toContain(path.basename(root));
        expect(run(root, "--check").status).toBe(0);
    });

    it("passes a folder with no built Map: the package works without one", () => {
        const result = run(makeTempDir("neb-unbuilt-"), "--check");
        expect(result.status).toBe(0);
    });

    it("refuses a .next with no BUILD_ID, and still scans what it holds (sweep B, item 18)", () => {
        const root = makeTempDir("neb-half-built-");
        fs.mkdirSync(path.join(root, ".next", "server"), { recursive: true });
        // the folder as the script sees it (its working folder, links resolved), written into a built file
        fs.writeFileSync(path.join(root, ".next", "server", "page.js"), `const dir = ${JSON.stringify(fs.realpathSync.native(root))};\n`);
        for (const args of [["--check"], []]){
            const result = run(root, ...args);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("prepare-package: .next has no BUILD_ID: a build that didn't finish, or a dev server's. Build the Map with npm run build:package, or remove .next.");
            expect(result.stderr).toContain(`${path.join(".next", "server", "page.js")} names this machine's folders`);
        }
    });

    it("finds the build folder however a file writes it: URL-encoded, with mixed separators, as Claude Code's folder name (sweep B, item 19)", () => {
        const root = makeTempDir("neb-built-");
        const next = path.join(root, ".next");
        fs.mkdirSync(path.join(next, "server"), { recursive: true });
        fs.writeFileSync(path.join(next, "BUILD_ID"), "build-1");
        const real = fs.realpathSync.native(root);
        const names = real.replace(/\\/g, "/").split("/");
        const back = String.fromCharCode(92);
        // every other separator a backslash: C:\Users/Ann\AppData/… (or \tmp/neb-built-… on a system whose paths start with /)
        const mixed = names.map((name, i) => (i === 0 ? name : `${i % 2 === 1 ? back : "/"}${name}`)).join("");
        fs.writeFileSync(path.join(next, "server", "encoded.js"), `const url = "file:///${encodeURIComponent(real)}";\n`);
        fs.writeFileSync(path.join(next, "server", "mixed.js"), `const dir = "${mixed}";\n`);
        // C:/Users/Ann becomes C--Users-Ann (lib/demo/privacy.ts's slug)
        fs.writeFileSync(path.join(next, "server", "slug.js"), `const project = "${real.replace(/\\/g, "/").replace(/[^a-zA-Z0-9]/g, "-")}";\n`);
        fs.writeFileSync(path.join(next, "server", "clean.js"), "const nothing = 1;\n");

        const result = run(root, "--check");
        expect(result.status).toBe(1);
        for (const file of ["encoded.js", "mixed.js", "slug.js"]) expect(result.stderr).toContain(`${path.join(".next", "server", file)} names this machine's folders`);
        expect(result.stderr).not.toContain("clean.js");
    });
});

describe("machineNeedles (sweep B fix round 1, item 5)", () => {
    it("throws when every folder is too shallow to scan for, rather than call every file clean", () => {
        // a build at /build with a home of /root (a container): both one segment deep, so privacy.ts would give no needle
        const notes: string[] = [];
        expect(() => machineNeedles(["/build", "/root"], leakNeedles, (note: string) => notes.push(note))).toThrow(
            "prepare-package: nothing to scan for: every folder (/build, /root) is too shallow, and scanning for nothing would call every file clean.",
        );
    });

    it("gives the deep folders' needles, and says which shallow one it left out", () => {
        const notes: string[] = [];
        const needles = machineNeedles(["/home/ann/build", "/home/ann/build", "/root"], leakNeedles, (note: string) => notes.push(note));
        // the build folder's own spelling and its slug (C:/Users/Ann becomes C--Users-Ann; here -home-ann-build)
        expect(needles).toContain("/home/ann/build");
        expect(needles).toContain("-home-ann-build");
        expect(needles.some((needle: string) => needle === "/root" || needle === "-root")).toBe(false);
        expect(notes).toEqual(["prepare-package: /root is too shallow to scan for, so it isn't"]);
    });
});
