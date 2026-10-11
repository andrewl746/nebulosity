import { configDefaults, defineConfig } from "vitest/config";

// test/fixtures holds sample repositories that the indexer tests *index*. They are
// data, not tests: their own *.test.ts files must never be collected as suites.
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, "test/fixtures/**"],
    },
});
