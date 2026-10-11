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
