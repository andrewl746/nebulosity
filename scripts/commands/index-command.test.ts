import { describe, expect, it, vi } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { getDb } from "../../lib/db/client";
import { findRepository } from "../../lib/db/store/structure";
import { isPrepared } from "../../lib/index/languages/treesitter";
import { repoKey } from "../../lib/index/paths";
import { runIndex } from "./index-command";

describe("runIndex (nebulosity index)", () => {
    it("loads the grammars, then indexes the mini-repo and resolves to 0", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const root = copyFixture();
        await expect(runIndex([root, "--no-activate"])).resolves.toBe(0);
        expect(findRepository(getDb(), repoKey(root))).not.toBeNull();
        for (const id of ["python", "go", "java", "csharp", "rust"]) expect(isPrepared(id)).toBe(true);
        vi.restoreAllMocks();
    });

    it("resolves to 1 for bad arguments, before loading anything", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(runIndex([])).resolves.toBe(1);
        await expect(runIndex(["--no-activate"])).resolves.toBe(1);
        expect(error).toHaveBeenCalled();
        vi.restoreAllMocks();
    });
});
