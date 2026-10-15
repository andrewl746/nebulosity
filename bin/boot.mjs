// What both of the package's launchers do before any of its TypeScript runs: bin/nebulosity.mjs (the command, ADR-058)
// and mcp/launch.mjs (the MCP server Claude Code starts, ADR-048). Plain JavaScript, so bare node imports it before tsx
// is loaded, and one copy of the data-folder rule serves both.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The package (or checkout) this file sits in: both launchers are one folder below it, as this file is. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Whether a launcher keeps the data in the user's data folder (ADR-044, amended): no NEBULOSITY_DATA given, and no .git
 * in the launcher's own package folder. A checkout (or a git worktree, whose .git is a file) keeps its data in its own
 * .nebulosity; an installed copy has no .git, and its folder may be read-only and is replaced on every upgrade. The test
 * is the package folder, never NEBULOSITY_HOME: mcp/stdio.test.ts points that at a temp folder with no .git.
 * @param {string} packageRoot
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {boolean}
 */
export function usesUserDataDir(packageRoot, env = process.env){
    return !env.NEBULOSITY_DATA && !fs.existsSync(path.join(packageRoot, ".git"));
}

/**
 * NEBULOSITY_HOME (the code root: migrations, the built Map) unless it's set, then tsx (so the TypeScript runs), then
 * NEBULOSITY_DATA when usesUserDataDir says so. userDataDir comes from lib/home.ts, which only tsx can load.
 * @param {string} [packageRoot]
 * @returns {Promise<void>}
 */
export async function boot(packageRoot = PACKAGE_ROOT){
    process.env.NEBULOSITY_HOME ??= packageRoot;
    // an import resolves from this file's folder, not the working folder, so tsx comes from the package's node_modules
    await import("tsx");
    if (usesUserDataDir(packageRoot)){
        const { userDataDir } = await import("../lib/home.ts");
        process.env.NEBULOSITY_DATA = userDataDir();
    }
}
