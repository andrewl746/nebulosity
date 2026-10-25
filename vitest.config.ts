import path from "path";
import { fileURLToPath } from "url";
import { configDefaults, defineConfig } from "vitest/config";

// test/fixtures holds sample repositories that the indexer tests *index*. They are
// data, not tests: their own *.test.ts files must never be collected as suites.
// The VS Code extension's pure modules (vscode-extension/src) are tested here; its integration tests (mocha inside
// VS Code), their compiled copies, its bundle, the VS Code it downloads and its own node_modules are not (V1.8 plan P11).
// "@/…" resolves to the project root here the way tsconfig's paths and Next resolve it, so app/ code that
// imports a value through the alias can be tested. The string alias matches "@" or "@/…" only, never "@scope/pkg".
// test/setup.ts gives every test file a data folder of its own (NEBULOSITY_DATA), so a suite run with that variable
// exported in the shell never writes the folder it names (ruling R26).
export default defineConfig({
    resolve: {
        alias: { "@": path.dirname(fileURLToPath(import.meta.url)) },
    },
    test: {
        setupFiles: ["test/setup.ts"],
        exclude: [
            ...configDefaults.exclude,
            "test/fixtures/**",
            "vscode-extension/test/**",
            "vscode-extension/out/**",
            "vscode-extension/dist/**",
            "vscode-extension/.vscode-test/**",
            "vscode-extension/node_modules/**",
        ],
    },
});
