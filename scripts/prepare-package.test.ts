import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test/helpers/temp";

const SCRIPT = path.resolve("scripts", "prepare-package.mjs");
const HASHED = "better-sqlite3-0123456789abcdef";

/**
 * A built Map as Turbopack leaves it: a BUILD_ID, one server external linked under its hashed name (a junction on
 * Windows, as Turbopack makes it), the build folder's path in the server files manifest, and that path in the build
 * cache too, which the package never ships.
 */
function turbopackBuild(): string {
    const root = makeTempDir("neb-build-");
    const next = path.join(root, ".next");
    fs.mkdirSync(path.join(next, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(next, "cache"));
    fs.writeFileSync(path.join(next, "BUILD_ID"), "build-1");
    fs.symlinkSync(path.resolve("node_modules", "better-sqlite3"), path.join(next, "node_modules", HASHED), process.platform === "win32" ? "junction" : "dir");
    const manifest = { config: { outputFileTracingRoot: root, turbopack: { root } }, appDir: root, relativeAppDir: "" };
    fs.writeFileSync(path.join(next, "required-server-files.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(next, "required-server-files.js"), `self.__SERVER_FILES_MANIFEST=${JSON.stringify(manifest, null, 2)};`);
    fs.writeFileSync(path.join(next, "cache", "notes.txt"), root);
    return root;
}

const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });

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
        expect(fs.existsSync(path.resolve("node_modules", "better-sqlite3", "package.json"))).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(path.join(root, ".next", "required-server-files.json"), "utf8"));
        expect(manifest).toEqual({ config: { outputFileTracingRoot: ".", turbopack: { root: "." } }, appDir: ".", relativeAppDir: "" });
        expect(fs.readFileSync(path.join(root, ".next", "required-server-files.js"), "utf8")).not.toContain(path.basename(root));
        expect(run(root, "--check").status).toBe(0);
    });

    it("passes a folder with no built Map: the package works without one", () => {
        const result = run(makeTempDir("neb-unbuilt-"), "--check");
        expect(result.status).toBe(0);
    });
});
