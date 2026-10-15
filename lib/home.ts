import os from "os";
import path from "path";

/**
 * Where Nebulosity keeps its own files: the database, the migrations, the config.
 *
 * Not process.cwd() alone. The MCP server (slice V1.4) is launched by Claude Code
 * from inside the *user's* repository, so cwd there is the wrong directory, and
 * the launcher sets NEBULOSITY_HOME explicitly. Next.js, the CLI scripts and
 * Vitest all run from the checkout, where cwd is already correct.
 */
export function nebulosityHome(): string {
    return path.resolve(process.env.NEBULOSITY_HOME ?? process.cwd());
}

export function nebulosityPath(...segments: string[]): string {
    return path.join(nebulosityHome(), ...segments);
}

/**
 * Where Nebulosity keeps its data (ADR-044, amended): the index, the config, the demo export. NEBULOSITY_DATA, else
 * <code root>/.nebulosity, where a checkout always kept it. An installed copy's launchers set NEBULOSITY_DATA to the
 * user's data folder (userDataDir), because the package folder may be read-only and is replaced on every upgrade.
 */
export function dataDir(): string {
    return path.resolve(process.env.NEBULOSITY_DATA ?? nebulosityPath(".nebulosity"));
}

export function dataPath(...segments: string[]): string {
    return path.join(dataDir(), ...segments);
}

/** The user's data folder on each system: %LOCALAPPDATA%\Nebulosity, ~/Library/Application Support/Nebulosity, $XDG_DATA_HOME/nebulosity. */
export function userDataDir(
    platform: NodeJS.Platform = process.platform,
    env: Readonly<Record<string, string | undefined>> = process.env,
    home: string = os.homedir(),
): string {
    if (platform === "win32") return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local"), "Nebulosity");
    if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Nebulosity");
    return path.posix.join(env.XDG_DATA_HOME ?? path.posix.join(home, ".local", "share"), "nebulosity");
}
