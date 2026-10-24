import fs from "fs";
import os from "os";
import path from "path";
import { downloadAndUnzipVSCode, makeConsoleReporter, ProgressReportStage, runTests, type ProgressReport, type ProgressReporter } from "@vscode/test-electron";
import { BENCH_DISABLED_EXTENSIONS, launchArgs } from "./launchArgs";

/**
 * Runs the extension's integration tests (V1.8 plan Task 9) in a VS Code that @vscode/test-electron downloads, against a
 * real Map that the extension finds or starts itself; or, with NEB_BENCH=1, Editor Benchmark #1 (Task 10, test/bench)
 * instead. From the environment:
 *   NEB_TEST_WORKSPACE  the folder VS Code opens: a copy of test/fixtures/mini-repo, indexed with --no-activate; for the
 *                       benchmark, ../vscode itself, which the benchmark never writes into (the tests write a file);
 *   NEB_TEST_PORT       the Map's port (3125; the benchmark's 3126), given to the extension as its nebulosity.port setting;
 *   NEB_TEST_COMMAND    optional, a checkout's bin/nebulosity.mjs (nebulosity.command). Unset, the extension finds
 *                       `nebulosity` on PATH, the way a user's install is found;
 *   NEB_TEST_VSCODE     optional, the VS Code version to run ("stable" when unset);
 *   NEB_BENCH           optional, "1" runs the benchmark rather than the integration tests, with the built-in git
 *                       extensions off (launchArgs.ts), so nothing writes into the repo's .git;
 *   NEBULOSITY_DATA     the data folder the Map reads and writes. Required: the tests switch its active repo and the Map
 *                       saves its port there, which must never be someone's own data folder.
 * The settings go into a fresh user data dir, never into the workspace.
 */

function required(name: string, why: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") throw new Error(`${name} isn't set: ${why}`);
    return value;
}

/** Test-electron's console reporter, which also keeps the version the download resolved to ("stable" → its number). */
async function versionReporter(): Promise<{ reporter: ProgressReporter; resolved(): string | null }> {
    const printed = await makeConsoleReporter();
    let resolved: string | null = null;
    return {
        reporter: {
            report(report: ProgressReport): void {
                if (report.stage === ProgressReportStage.ResolvedVersion) resolved = report.version;
                printed.report(report);
            },
            error(err: unknown): void {
                printed.error(err);
            },
        },
        resolved: () => resolved,
    };
}

async function main(): Promise<void> {
    const workspace = path.resolve(required("NEB_TEST_WORKSPACE", "it names the copy of the mini-repo VS Code opens."));
    const port = Number(required("NEB_TEST_PORT", "it names the port of the Map the tests start (3125)."));
    // 3000 is the Map's default port, where someone's own Map may be running: the tests would switch its repo and send it a live event
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3000) throw new Error(`NEB_TEST_PORT must be a port from 1 to 65535 other than 3000, not ${process.env.NEB_TEST_PORT}.`);
    required("NEBULOSITY_DATA", "the Map the tests start must use a scratch data folder, since they switch its active repo.");
    if (!fs.existsSync(workspace)) throw new Error(`NEB_TEST_WORKSPACE (${workspace}) doesn't exist.`);
    const bench = process.env.NEB_BENCH === "1";
    const what = bench ? "Editor Benchmark #1" : "the integration tests";
    // the integration tests write a file into their workspace (test 6), so it must be a throwaway copy, never a repo
    // (the benchmark's ../vscode, with NEB_BENCH mistyped, say)
    if (!bench && fs.existsSync(path.join(workspace, ".git"))) throw new Error(`NEB_TEST_WORKSPACE (${workspace}) is a git repo, and the integration tests write into their workspace: give them a copy of test/fixtures/mini-repo. NEB_BENCH=1 runs the benchmark, which writes nothing.`);
    const command = process.env.NEB_TEST_COMMAND;
    const version = process.env.NEB_TEST_VSCODE ?? "stable";

    // out/test/runTest.js: the extension is two folders up, the runner and the suites beside this file. The runner runs
    // the test files of the folder it's given: the benchmark's, or the integration tests'
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
    const testsDir = path.resolve(__dirname, bench ? "bench" : "suite");

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-vscode-test-"));
    const settings: Record<string, unknown> = { "nebulosity.port": port };
    if (command !== undefined && command.trim() !== "") settings["nebulosity.command"] = command;
    fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, "User", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

    const { reporter, resolved } = await versionReporter();
    const vscodeExecutablePath = await downloadAndUnzipVSCode({ version, reporter, extensionDevelopmentPath });
    const ran = `VS Code ${resolved() ?? version} (${vscodeExecutablePath})`;
    console.log(`Running ${what} in ${ran}, on ${workspace}, with the Map on port ${port}.`);
    if (bench) console.log(`Built-in extensions off for the benchmark: ${BENCH_DISABLED_EXTENSIONS.join(", ")}.`);
    try{
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: launchArgs(workspace, userDataDir, bench),
            // the Map's background worker stays off, so a file the tests create is never indexed (test 6); NEB_TESTS_DIR
            // names the folder whose test files the runner loads
            extensionTestsEnv: { NEBULOSITY_WORKER: "off", NEB_TESTS_DIR: testsDir },
        });
    } finally{
        console.log(`Ran in ${ran}.`);
        try{
            fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        } catch{
            // VS Code's last processes may still hold a file in it for a moment: the temp folder is left for the OS
        }
    }
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
