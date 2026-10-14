import path from "path";
import { fileURLToPath } from "url";
import { configDefaults, defineConfig } from "vitest/config";

// test/fixtures holds sample repositories that the indexer tests *index*. They are
// data, not tests: their own *.test.ts files must never be collected as suites.
// "@/…" resolves to the project root here the way tsconfig's paths and Next resolve it, so app/ code that
// imports a value through the alias can be tested. The string alias matches "@" or "@/…" only, never "@scope/pkg".
export default defineConfig({
    resolve: {
        alias: { "@": path.dirname(fileURLToPath(import.meta.url)) },
    },
    test: {
        exclude: [...configDefaults.exclude, "test/fixtures/**"],
    },
});
