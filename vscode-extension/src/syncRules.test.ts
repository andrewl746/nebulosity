import { describe, expect, it } from "vitest";
import type { ImportsResponse } from "../../lib/contracts";
import {
    highlightOf, importsPath, isFileUri, isNotFound, notIndexedText, openColumn, otherRepoText, readImports, repoPathOfUri, SHOW_ALL_LABEL, ShowHold,
    showAllOffered,
} from "./syncRules";

/** A dependents answer, from the plan's "Ground truth" (test/fixtures/mini-repo). */
function dependents(path: string, transitive: boolean, files: [string, number][], direct: number): ImportsResponse {
    return {
        path,
        kind: "file",
        direction: "dependents",
        transitive,
        files: files.map(([p, distance]) => ({ path: p, distance })),
        direct,
        total: files.length,
        offset: 0,
        indexVersion: 1,
    };
}

const LOG_DIRECT = dependents("src/core/log.ts", false, [["src/app/main.ts", 1], ["src/core/index.ts", 1], ["src/index.ts", 1]], 3);
const LOG_ALL = dependents("src/core/log.ts", true, [
    ["src/app/main.ts", 1], ["src/core/index.ts", 1], ["src/index.ts", 1],
    ["src/util/strings.ts", 2], ["src/app/view.tsx", 2], ["scripts/build.js", 2], ["src/util/strings.test.ts", 3],
], 3);
const BUILD_DIRECT = dependents("scripts/build.js", false, [], 0);

describe("the /api/imports request (API_CONTRACTS §19)", () => {
    it("asks one file for Show this file, the direct page for What depends, and 500 with indirect ones", () => {
        expect(importsPath({ path: "src/core/log.ts", limit: 1 })).toBe("/api/imports?path=src%2Fcore%2Flog.ts&limit=1");
        expect(importsPath({ path: "src/core/log.ts" })).toBe("/api/imports?path=src%2Fcore%2Flog.ts");
        expect(importsPath({ path: "src/core/log.ts", transitive: true, limit: 500 })).toBe("/api/imports?path=src%2Fcore%2Flog.ts&transitive=true&limit=500");
    });

    it("encodes a path's spaces, & # + and non-ASCII characters as a query value", () => {
        expect(importsPath({ path: "docs/a b&c#d+é.md", limit: 1 })).toBe("/api/imports?path=docs%2Fa+b%26c%23d%2B%C3%A9.md&limit=1");
    });

    it("tells NOT_FOUND from the other answers", () => {
        expect(isNotFound(404, { error: { code: "NOT_FOUND", message: "No file or folder src/new.ts in this repo." } })).toBe(true);
        expect(isNotFound(404, { error: { code: "INDEX_EMPTY", message: "Nothing is indexed." } })).toBe(false);
        expect(isNotFound(400, { error: { code: "NOT_FOUND", message: "x" } })).toBe(false);
        expect(isNotFound(404, "<!doctype html><h1>404</h1>")).toBe(false);
        expect(isNotFound(404, null)).toBe(false);
    });

    it("reads an answer of §19's shape, keeping only its fields", () => {
        expect(readImports(LOG_DIRECT)).toEqual(LOG_DIRECT);
        expect(readImports({ ...LOG_ALL, extra: "dropped" })).toEqual(LOG_ALL);
        expect(readImports(BUILD_DIRECT)).toEqual(BUILD_DIRECT);
    });

    it("refuses an answer of any other shape", () => {
        expect(readImports(null)).toBeNull();
        expect(readImports("text")).toBeNull();
        expect(readImports({})).toBeNull();
        expect(readImports({ ...LOG_DIRECT, files: "src/app/main.ts" })).toBeNull();
        expect(readImports({ ...LOG_DIRECT, files: [{ path: "src/app/main.ts" }] })).toBeNull();
        expect(readImports({ ...LOG_DIRECT, files: [{ path: 7, distance: 1 }] })).toBeNull();
        expect(readImports({ ...LOG_DIRECT, total: "3" })).toBeNull();
        expect(readImports({ ...LOG_DIRECT, transitive: "false" })).toBeNull();
        expect(readImports({ ...LOG_DIRECT, kind: "repo" })).toBeNull();
        expect(readImports({ ...LOG_DIRECT, direction: "both" })).toBeNull();
    });
});

describe("What depends' highlight and its Show all item (P6)", () => {
    it("lights the listed files", () => {
        expect(highlightOf(LOG_DIRECT)).toEqual(["src/app/main.ts", "src/core/index.ts", "src/index.ts"]);
        expect(highlightOf(LOG_ALL)).toEqual([
            "src/app/main.ts", "src/core/index.ts", "src/index.ts",
            "src/util/strings.ts", "src/app/view.tsx", "scripts/build.js", "src/util/strings.test.ts",
        ]);
    });

    it("lights at most the first 50", () => {
        const many = dependents("src/vs/base/common/event.ts", true, Array.from({ length: 60 }, (_, i): [string, number] => [`src/f${i}.ts`, 1]), 60);
        expect(highlightOf(many)).toEqual(Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`));
    });

    it("offers the indirect importers only on a direct answer that has importers", () => {
        expect(SHOW_ALL_LABEL).toBe("Show all, including indirect");
        expect(showAllOffered(LOG_DIRECT)).toBe(true);
        expect(showAllOffered(LOG_ALL)).toBe(false);
        // nothing imports it directly, so nothing imports it at all
        expect(showAllOffered(BUILD_DIRECT)).toBe(false);
    });
});

describe("which documents are files of the repo (Task 8 Review I1)", () => {
    const ROOT = "C:/Users/Andrew/Programming/vscode";
    const EVENT = "c:\\Users\\Andrew\\Programming\\vscode\\src\\vs\\base\\common\\event.ts";

    it("takes a file on disk inside the root, as its repo-relative path", () => {
        expect(isFileUri({ scheme: "file" })).toBe(true);
        expect(repoPathOfUri(ROOT, { scheme: "file", fsPath: EVENT }, "win32")).toBe("src/vs/base/common/event.ts");
        expect(repoPathOfUri(ROOT, { scheme: "file", fsPath: "c:\\Users\\Andrew\\Programming\\other\\a.ts" }, "win32")).toBeNull();
    });

    it("refuses every other scheme, even one that keeps the file's own path", () => {
        // the HEAD side of a diff or Timeline, a notebook cell, a pull request's review copy: each keeps event.ts' path
        for (const scheme of ["git", "vscode-notebook-cell", "review", "gitlens"]){
            expect(isFileUri({ scheme })).toBe(false);
            expect(repoPathOfUri(ROOT, { scheme, fsPath: EVENT }, "win32")).toBeNull();
        }
        expect(repoPathOfUri(ROOT, { scheme: "untitled", fsPath: "Untitled-1" }, "win32")).toBeNull();
        expect(repoPathOfUri(ROOT, { scheme: "output", fsPath: "extension-output-andrewl746.nebulosity-vscode-#1-Nebulosity" }, "win32")).toBeNull();
    });
});

describe("the column a file from the Map opens in (design §4.4)", () => {
    const BESIDE = -2;   // vscode.ViewColumn.Beside
    it("is the most recent text editor's", () => {
        expect(openColumn(1, 2, BESIDE)).toBe(1);
        expect(openColumn(3, undefined, BESIDE)).toBe(3);
    });

    it("is the one beside the panel when that editor shares the panel's column, or there's none", () => {
        expect(openColumn(2, 2, BESIDE)).toBe(BESIDE);
        expect(openColumn(undefined, 2, BESIDE)).toBe(BESIDE);
        expect(openColumn(undefined, undefined, BESIDE)).toBe(BESIDE);
    });
});

describe("the messages (P5, P17)", () => {
    it("are the plan's words", () => {
        expect(notIndexedText("src/new.ts")).toBe("`src/new.ts` isn't in Nebulosity's index (new, ignored, or not a source file).");
        expect(otherRepoText("src/core/log.ts")).toBe("`src/core/log.ts` isn't in this workspace's repo (the Map shows another one; run Show Map to switch back)");
    });
});

describe("ShowHold: a show keeps the follow after ready off the Map (P16, Plan Review I4)", () => {
    it("lets the follow after ready through when no show was posted", () => {
        expect(new ShowHold().followOnReady(1)).toBe(true);
    });

    it("holds it after a show to that page, for a second ready of the same page too", () => {
        const hold = new ShowHold();
        hold.showPosted(1);
        expect(hold.followOnReady(1)).toBe(false);
        // a warm Map answers the boot hello and then fires load: two readies, and the show still stands
        expect(hold.followOnReady(1)).toBe(false);
    });

    it("lets it through again once a follow was posted", () => {
        const hold = new ShowHold();
        hold.showPosted(1);
        hold.followPosted();
        expect(hold.followOnReady(1)).toBe(true);
    });

    it("lets it through on a new page the extension loaded (P7), until a show is posted to that one", () => {
        const hold = new ShowHold();
        hold.showPosted(1);
        expect(hold.followOnReady(2)).toBe(true);
        hold.showPosted(2);
        expect(hold.followOnReady(2)).toBe(false);
    });
});
