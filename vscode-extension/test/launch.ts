/**
 * What runTest.ts launches VS Code with, for the integration tests or for the benchmark: its arguments and the user
 * settings it writes into the fresh user data dir. Pure functions, so both can be checked without launching anything.
 */

export function launchArgs(workspace: string, userDataDir: string): string[] {
    return [
        workspace, "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", userDataDir,
        // a window behind others, or a hidden webview, draws no frames, so the Map would never send `drawn`
        "--disable-features=CalculateNativeWinOcclusion", "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
    ];
}

/**
 * The settings that turn the built-in git extension off. The benchmark opens a real repo, ../vscode, where git writes
 * `branch.<name>.vscode-merge-base` into `.git/config` as it opens the repo (it did in Editor Benchmark #1's first run).
 * A flag can't do it: with --disable-extensions, VS Code ignores --disable-extension <id>, and built-ins stay on. With
 * `git.enabled` off when it activates, git opens no repository. The integration tests open a throwaway copy with no
 * `.git`, so they leave git as it is.
 */
export const GIT_OFF = { "git.enabled": false, "git.autoRepositoryDetection": false };

export function userSettings(port: number, command: string | undefined, bench: boolean): Record<string, unknown> {
    const settings: Record<string, unknown> = { "nebulosity.port": port };
    if (command !== undefined && command.trim() !== "") settings["nebulosity.command"] = command;
    return bench ? { ...settings, ...GIT_OFF } : settings;
}
