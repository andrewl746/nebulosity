import fs from "fs";
import Mocha from "mocha";
import path from "path";
import * as vscode from "vscode";

/**
 * The test runner VS Code loads from --extensionTestsPath, inside the extension host: mocha, in the tdd style (`suite`,
 * `test`), over the bundled test files beside this one (out/test/suite/*.test.js).
 */
export function run(): Promise<void> {
    console.log(`The extension host: VS Code ${vscode.version}, Electron ${process.versions.electron}, Node ${process.versions.node}, ${process.platform}.`);
    // the longest wait is a cold Map's first draw (90 s); no test should take longer than two minutes
    const mocha = new Mocha({ ui: "tdd", color: true, timeout: 120_000 });
    for (const name of fs.readdirSync(__dirname).filter((file) => file.endsWith(".test.js")).sort()) mocha.addFile(path.join(__dirname, name));
    return new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) reject(new Error(`${failures} of the extension's integration tests failed.`));
            else resolve();
        });
    });
}
