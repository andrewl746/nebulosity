/**
 * The arguments runTest.ts launches VS Code with, for the integration tests or for the benchmark. A pure function, so
 * the list can be checked without launching anything.
 */

/**
 * The built-in extensions the benchmark turns off. It opens a real repo, ../vscode, where the git extension writes
 * `branch.<name>.vscode-merge-base` into `.git/config` as it opens the repo (it did in Editor Benchmark #1's first run).
 * git-base goes too, and github, which depends on git-base. The integration tests open a throwaway copy with no `.git`,
 * so they keep them.
 */
export const BENCH_DISABLED_EXTENSIONS = ["vscode.git", "vscode.git-base", "vscode.github"];

export function launchArgs(workspace: string, userDataDir: string, bench: boolean): string[] {
    return [
        workspace, "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", userDataDir,
        // a window behind others, or a hidden webview, draws no frames, so the Map would never send `drawn`
        "--disable-features=CalculateNativeWinOcclusion", "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
        // --disable-extensions leaves the built-in ones on, so each is named
        ...(bench ? BENCH_DISABLED_EXTENSIONS.flatMap((id) => ["--disable-extension", id]) : []),
    ];
}
