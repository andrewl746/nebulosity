import { describe, expect, it, vi } from "vitest";
import { isolateDataFolder } from "../../test/helpers/data-folder";
import { copyFixture } from "../../test/helpers/fixture";
import { getDb } from "../../lib/db/client";
import { readStages } from "../../lib/db/store/stages";
import { findRepository } from "../../lib/db/store/structure";
import { isPrepared } from "../../lib/index/languages/treesitter";
import { typescriptAdapter } from "../../lib/index/languages/typescript-adapter";
import { repoKey } from "../../lib/index/paths";
import { runIndex } from "./index-command";

// index re-derives the summaries stage with the summary models in config.json (ADR-066): only this test's own, never the developer's
isolateDataFolder();

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

    it("prints a file whose parse threw and the scan read, and the stage note counts it (the E4 final review's B-I1)", async () => {
        // TypeScript's adapter too: its full and parse readings throw on the mini-repo's src/core/log.ts, its scan doesn't
        const parse = typescriptAdapter.parse.bind(typescriptAdapter);
        vi.spyOn(typescriptAdapter, "parse").mockImplementation((p, text, reading) => {
            if (p === "src/core/log.ts" && reading !== "scan") throw new RangeError("Maximum call stack size exceeded");
            return parse(p, text, reading);
        });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const root = copyFixture();
        await expect(runIndex([root, "--no-activate"])).resolves.toBe(0);

        const printed = log.mock.calls.map((call) => String(call[0]));
        expect(printed).toContain("[index] 1 file read by the scan (their parse failed): src/core/log.ts (first error: Maximum call stack size exceeded)");
        expect(printed.some((line) => line.includes("file errors"))).toBe(false);   // indexed, not failed
        expect(warn.mock.calls).toEqual([["[index] the typescript parse of src/core/log.ts failed (Maximum call stack size exceeded), so the scan read its imports only"]]);
        expect(readStages(getDb(), findRepository(getDb(), repoKey(root))!).structure)
            .toMatchObject({ state: "ready", note: "1 file read by the scan (their parse failed): src/core/log.ts" });
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
