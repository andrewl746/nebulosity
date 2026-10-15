import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sample repositories the indexer tests read as data (they use require(), JSX, aliases…)
    "test/fixtures/**",
    // Planning and review scratch (gitignored, never shipped)
    ".superpowers/**",
    // The local data folder (gitignored): indexes, eval transcripts and the scripts eval runs wrote in their scratch folders
    ".nebulosity/**",
  ]),
]);

export default eslintConfig;
