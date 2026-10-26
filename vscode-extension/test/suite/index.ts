import fs from "fs";
import Mocha from "mocha";
import path from "path";
import * as vscode from "vscode";

/**
 * The test runner VS Code loads from --extensionTestsPath, inside the extension host: mocha, in the tdd style (`suite`,
 * `test`), over the bundled test files of one folder: the one runTest.ts names in NEB_TESTS_DIR (out/test/bench for
 * the benchmark), else the integration tests beside this one (out/test/suite/*.test.js). A run that finds no test, a
 * moved or renamed file say, fails rather than passing with nothing tested.
 */
export function run(): Promise<void> {
    console.log(`The extension host: VS Code ${vscode.version}, Electron ${process.versions.electron}, Node ${process.versions.node}, ${process.platform}.`);
    const dir = process.env.NEB_TESTS_DIR ?? __dirname;
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".test.js")).sort();
    if (files.length === 0) return Promise.reject(new Error(`No *.test.js in ${dir}: nothing to test.`));
    console.log(`Running ${files.join(", ")} from ${dir}.`);
    // the longest wait is a cold Map's first draw (90 s); no test should take longer than two minutes. failZero: a file
    // that registers no test fails the run too
    const mocha = new Mocha({ ui: "tdd", color: true, timeout: 120_000, failZero: true });
    for (const name of files) mocha.addFile(path.join(dir, name));
    return new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) reject(new Error(`${failures} of the extension's integration tests failed (or none ran).`));
            else resolve();
        });
    });
}
