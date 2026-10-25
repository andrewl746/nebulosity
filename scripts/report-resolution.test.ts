import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../test/helpers/fixture";
import { makeTempDir } from "../test/helpers/temp";
import { toyAdapter } from "../test/helpers/toy-adapter";
import { getDb } from "../lib/db/client";
import { typescriptAdapter } from "../lib/index/languages/typescript-adapter";
import { repoKey } from "../lib/index/paths";
import { indexRepository } from "../lib/index/pipeline";
import { resolutionLines } from "./report-resolution";

describe("npm run report-resolution", () => {
    it("prints the mini-repo's TypeScript lines as before E4 (counted by hand from the V1.1 plan's files)", () => {
        // relative: the 10 relative specifiers of the 8 files, all resolving; bare: "@core/log" (tsconfig paths) and "react"
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        expect(resolutionLines(getDb(), root, repoId)).toEqual([
            `[resolution] ${repoKey(root)}: 8 files`,
            "[resolution] relative: 10/10 (100.0%)",
            "[resolution] bare: 1/2 (50.0%)",
            "[resolution]   unresolved react: 1",
        ]);
    });

    it("adds each other language's lines: the toy repo, counted by hand from its truth", () => {
        // 13 references, all internal; 10 resolved (lib/strings.toy's use of itself counts); classes name 3/4 and use 7/9
        const root = makeTempDir("neb-report-toy-");
        fs.cpSync(path.resolve("test/fixtures/toy-repo"), root, { recursive: true });
        const adapters = [typescriptAdapter, toyAdapter];
        const { repoId } = indexRepository(root, { adapters });
        expect(resolutionLines(getDb(), root, repoId, adapters)).toEqual([
            `[resolution] ${repoKey(root)}: 9 files`,
            "[resolution] relative: 0/0 (n/a)",
            "[resolution] bare: 0/0 (n/a)",
            "[resolution] toy: internal 10/13 (76.9%) · external 0 · context 0",
            "[resolution] toy name: internal 3/4 (75.0%)",
            "[resolution] toy use: internal 7/9 (77.8%)",
            "[resolution] toy miss app/broken.toy use:missing/thing",
            "[resolution] toy miss tests/check.toy name:nothing",
            "[resolution] toy miss tests/check.toy use:deps/vendored",
        ]);
    });
});
