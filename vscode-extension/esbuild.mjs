/**
 * Builds the extension's two programs:
 *   - dist/extension.js, which VS Code's extension host loads (CommonJS on Node; `vscode` is the host's own module);
 *   - dist/relay.js, the script the webview runs beside the Map's iframe (a browser script).
 * With --tests it builds the integration tests instead, into out/test/ at the same paths they have under test/. They're
 * bundled rather than compiled by tsc, so a test that reaches lib/contracts.ts through a type import never moves the
 * output's root (V1.8 plan P11); `tsc -p test --noEmit` type-checks them.
 */
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// every path below is relative to this folder, wherever the build is started from
const here = path.dirname(fileURLToPath(import.meta.url));

/** The .test.ts files directly in one of test/'s folders, or none while that folder doesn't exist yet. */
function testFiles(dir){
    if (!fs.existsSync(path.join(here, dir))) return [];
    return fs.readdirSync(path.join(here, dir)).filter((name) => name.endsWith(".test.ts")).map((name) => `${dir}/${name}`);
}

const node = { absWorkingDir: here, bundle: true, platform: "node", format: "cjs", target: "node22", logLevel: "info" };

if (process.argv.includes("--tests")){
    await build({
        ...node,
        entryPoints: ["test/runTest.ts", "test/suite/index.ts", ...testFiles("test/suite"), ...testFiles("test/bench")],
        outbase: "test",
        outdir: "out/test",
        // loaded at run time from node_modules (mocha, the test runner) or from the host (vscode)
        external: ["vscode", "mocha", "@vscode/test-electron"],
    });
} else{
    await build({ ...node, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] });
    await build({
        absWorkingDir: here,
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "es2022",
        logLevel: "info",
        entryPoints: ["src/webview/relay.ts"],
        outfile: "dist/relay.js",
    });
}
