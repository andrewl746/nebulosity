import path from "path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { writeConfig } from "../config";
import { getDb } from "../db/client";
import { writeStage } from "../db/store/stages";
import { requireRepository } from "../db/store/structure";
import { NoActiveRepoError } from "../engine/errors";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { refreshSummaryStatus } from "../index/summarize/status";
import { chooseRepo, setupCall } from "./repo";

// Open the test database before any test moves NEBULOSITY_HOME (as repos.test.ts does): a temp home has no migrations.
beforeAll(() => { getDb(); });
const original = process.env.NEBULOSITY_HOME;
afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
});

describe("chooseRepo (ADR-046)", () => {
    const roots = ["/r/vscode", "/r/vscode/extensions/git", "/r/other"];

    it("picks the indexed repo holding the project folder, the deepest when repos nest, over the Map's", () => {
        expect(chooseRepo("/r/vscode/src/vs", roots, "/r/other", "linux")).toEqual({ root: "/r/vscode", how: "project" });
        expect(chooseRepo("/r/vscode/extensions/git/src", roots, "/r/other", "linux")).toEqual({ root: "/r/vscode/extensions/git", how: "project" });
        expect(chooseRepo("/r/vscode", roots, null, "linux")).toEqual({ root: "/r/vscode", how: "project" });
    });

    it("doesn't count a sibling that only shares a prefix", () => {
        expect(chooseRepo("/r/vscode-docs", roots, "/r/other", "linux")).toEqual({ root: "/r/other", how: "map" });
    });

    it("ignores case and slashes on Windows, but not elsewhere", () => {
        const windows = ["C:/Users/A/vscode"];
        expect(chooseRepo("c:\\users\\a\\vscode\\src\\", windows, null, "win32")).toEqual({ root: "C:/Users/A/vscode", how: "project" });
        expect(chooseRepo("/R/VSCODE/src", ["/r/vscode"], null, "linux")).toBeNull();
    });

    it("falls back to the Map's repo, and to nothing when that isn't indexed either", () => {
        expect(chooseRepo("/home/me", roots, "/r/other", "linux")).toEqual({ root: "/r/other", how: "map" });
        expect(chooseRepo("/home/me", roots, "/r/gone", "linux")).toBeNull();
        expect(chooseRepo("/home/me", [], null, "linux")).toBeNull();
    });
});

describe("setupCall", () => {
    function indexed(): string {
        const root = copyFixture();
        indexRepository(root);
        return root;
    }

    it("answers about the project's repo, and lets live events through when the Map shows it", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-call-");
        const root = indexed();
        writeConfig({ activeRepo: repoKey(root), port: 4321 });
        expect(setupCall(path.join(root, "src"))).toEqual({
            context: { repoRoot: repoKey(root), summariesOff: false },
            live: { allowed: true, port: 4321, mapRepo: path.basename(root) },
        });
    });

    it("falls back to the Map's repo with a note first, and keeps live events off another repo's Map", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-call-");
        const a = indexed();
        const b = indexed();
        writeConfig({ activeRepo: repoKey(b), port: 3000 });
        const elsewhere = makeTempDir("neb-elsewhere-");
        expect(setupCall(elsewhere).context.repoNote)
            .toBe(`Answering about ${path.basename(b)} (${repoKey(b)}), the repo the Map shows: the project folder ${repoKey(elsewhere)} isn't inside an indexed repo.`);
        expect(setupCall(a).live).toEqual({ allowed: false, port: 3000, mapRepo: path.basename(b) });
    });

    it("reads free mode from the stored summaries stage", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-call-");
        const root = indexed();
        writeConfig({ activeRepo: repoKey(root), port: 3000 });
        refreshSummaryStatus(root, { summarizerAvailable: false });
        expect(setupCall(root).context.summariesOff).toBe(true);
    });

    it("notes an index update in progress or failed", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-call-");
        const root = indexed();
        writeConfig({ activeRepo: repoKey(root), port: 3000 });
        const repoId = requireRepository(getDb(), repoKey(root));
        writeStage(getDb(), repoId, "structure", { state: "running", done: 3, total: 8 });
        expect(setupCall(root).context.indexNote).toBe("The index is being updated (3/8 files), so answers may miss the newest changes.");
        writeStage(getDb(), repoId, "structure", { state: "failed", done: 3, total: 8, note: "disk full" });
        expect(setupCall(root).context.indexNote).toBe("The last index update failed (disk full), so answers may be out of date. Running npm run index in the Nebulosity folder redoes it.");
    });

    it("says nothing is indexed when no repo is chosen", () => {
        process.env.NEBULOSITY_HOME = makeTempDir("neb-call-");
        writeConfig({ activeRepo: null, port: 3000 });
        expect(() => setupCall(makeTempDir("neb-elsewhere-"))).toThrow(NoActiveRepoError);
    });
});
