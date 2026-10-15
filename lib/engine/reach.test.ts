import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { getDb } from "../db/client";
import { loadGraphEdges, loadGraphFiles } from "../db/store/map";
import { indexRepository } from "../index/pipeline";
import { applyFileChanges } from "../index/update";
import { BadInputError } from "./errors";
import { buildImportGraph, rangeOf } from "./graph";
import { PathNotFoundError } from "./level";
import { buildImportIndex, importChain, reach, reachFrom, shortestChain } from "./reach";

/** The fixture's import graph, ready to walk: 8 files, 11 imports. */
function fixtureIndex(){
    const { repoId } = indexRepository(copyFixture());
    return buildImportIndex(buildImportGraph(loadGraphFiles(getDb(), repoId), loadGraphEdges(getDb(), repoId)));
}

describe("the import index", () => {
    it("keeps both directions as rows in path order, and counts each file's importers", () => {
        // a.ts imports c.ts and b.ts; c.ts imports b.ts
        const index = buildImportIndex(buildImportGraph(
            [{ id: 1, path: "a.ts" }, { id: 2, path: "b.ts" }, { id: 3, path: "c.ts" }],
            [{ source: 1, target: 3 }, { source: 1, target: 2 }, { source: 3, target: 2 }],
        ));
        expect([...index.imports.offsets]).toEqual([0, 2, 2, 3]);
        expect([...index.imports.neighbours]).toEqual([1, 2, 1]);      // a: b, c (path order); c: b
        expect([...index.importedBy.offsets]).toEqual([0, 0, 2, 3]);
        expect([...index.importedBy.neighbours]).toEqual([0, 2, 0]);   // b: a, c; c: a
        expect([...index.inDegree]).toEqual([0, 2, 1]);
    });
});

describe("reachFrom", () => {
    it("lists what imports a file: nearest first, then the most imported, then by path", () => {
        expect(reachFrom(fixtureIndex(), "src/core/log.ts", "file", "dependents")).toEqual([
            { path: "src/app/main.ts", distance: 1 },
            { path: "src/core/index.ts", distance: 1 },
            { path: "src/index.ts", distance: 1 },
            { path: "src/util/strings.ts", distance: 2 },
            { path: "src/app/view.tsx", distance: 2 },
            { path: "scripts/build.js", distance: 2 },
            { path: "src/util/strings.test.ts", distance: 3 },
        ]);
    });

    it("starts from every file of a folder and never lists the folder's own", () => {
        expect(reachFrom(fixtureIndex(), "src/core", "folder", "dependents")).toEqual([
            { path: "src/app/main.ts", distance: 1 },
            { path: "src/util/strings.ts", distance: 1 },
            { path: "src/index.ts", distance: 1 },
            { path: "src/app/view.tsx", distance: 2 },
            { path: "scripts/build.js", distance: 2 },
            { path: "src/util/strings.test.ts", distance: 2 },
        ]);
    });

    it("follows what a file imports through a cycle without listing the file itself", () => {
        // src/app/main.ts and src/app/view.tsx import each other
        expect(reachFrom(fixtureIndex(), "src/app/main.ts", "file", "dependencies")).toEqual([
            { path: "src/core/log.ts", distance: 1 },
            { path: "src/util/strings.ts", distance: 1 },
            { path: "src/app/view.tsx", distance: 1 },
            { path: "src/core/index.ts", distance: 2 },
        ]);
    });

    it("finds nothing outside a folder whose imports stay inside it", () => {
        const index = fixtureIndex();
        expect(reachFrom(index, "src", "folder", "dependencies")).toEqual([]);
        expect(reachFrom(index, "src", "folder", "dependents")).toEqual([{ path: "scripts/build.js", distance: 1 }]);
    });

    it("never lists a file that imports itself", () => {
        // a.ts imports itself; b.ts imports a.ts
        const index = buildImportIndex(buildImportGraph(
            [{ id: 1, path: "a.ts" }, { id: 2, path: "b.ts" }],
            [{ source: 1, target: 1 }, { source: 2, target: 1 }],
        ));
        expect(reachFrom(index, "a.ts", "file", "dependents")).toEqual([{ path: "b.ts", distance: 1 }]);
    });
});

describe("shortestChain", () => {
    it("finds the shortest chain, the same one every time", () => {
        const index = fixtureIndex();
        // through src/index.ts is as short, but src/app/main.ts comes first in path order
        expect(shortestChain(index, rangeOf(index, "scripts/build.js", "file"), rangeOf(index, "src/core/log.ts", "file")))
            .toEqual(["scripts/build.js", "src/app/main.ts", "src/core/log.ts"]);
        expect(shortestChain(index, rangeOf(index, "src/app", "folder"), rangeOf(index, "src/core", "folder")))
            .toEqual(["src/app/main.ts", "src/core/log.ts"]);
    });

    it("returns null when imports never lead there", () => {
        const index = fixtureIndex();
        expect(shortestChain(index, rangeOf(index, "src/core/log.ts", "file"), rangeOf(index, "scripts/build.js", "file"))).toBeNull();
        expect(shortestChain(index, rangeOf(index, "src/app/view.tsx", "file"), rangeOf(index, "src/util/strings.test.ts", "file"))).toBeNull();
    });
});

describe("reach and importChain over an indexed repo", () => {
    it("answers for a file or a folder and counts the direct files", () => {
        const root = copyFixture();
        indexRepository(root);
        const log = reach(root, "src/core/log.ts", "dependents");
        expect(log).toMatchObject({ path: "src/core/log.ts", kind: "file", direction: "dependents", direct: 3 });
        expect(log.reached).toHaveLength(7);
        expect(reach(root, "src/app", "dependencies")).toMatchObject({ kind: "folder", direct: 2 });
    });

    it("refuses the whole repo, and a path with nothing indexed", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(() => reach(root, "", "dependents")).toThrow(BadInputError);
        expect(() => reach(root, "src/nope.ts", "dependents")).toThrow(PathNotFoundError);
    });

    it("follows a new import once the index version moves", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(reach(root, "src/util/strings.ts", "dependents").direct).toBe(2);   // main.ts and strings.test.ts
        fs.appendFileSync(path.join(root, "scripts", "build.js"), '\nrequire("../src/util/strings");\n');
        applyFileChanges(root, ["scripts/build.js"]);
        expect(reach(root, "src/util/strings.ts", "dependents").direct).toBe(3);
    });

    it("gives a chain with each step's import, says which way it runs, or that there is none", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(importChain(root, "scripts/build.js", "src/core/log.ts")).toEqual({
            from: "scripts/build.js", fromKind: "file", to: "src/core/log.ts", toKind: "file", found: "forward",
            files: ["scripts/build.js", "src/app/main.ts", "src/core/log.ts"], specifiers: ["../src/app/main", "../core/log"],
        });
        expect(importChain(root, "src/core/log.ts", "scripts/build.js"))
            .toMatchObject({ found: "reverse", files: ["scripts/build.js", "src/app/main.ts", "src/core/log.ts"] });
        expect(importChain(root, "src/app/view.tsx", "src/util/strings.test.ts")).toMatchObject({ found: "none", files: [], specifiers: [] });
        expect(importChain(root, "src/app", "src/core")).toMatchObject({
            fromKind: "folder", toKind: "folder", found: "forward", files: ["src/app/main.ts", "src/core/log.ts"], specifiers: ["../core/log"],
        });
    });

    it("refuses places that overlap, and the whole repo", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(() => importChain(root, "src", "src/core/log.ts")).toThrow(BadInputError);
        expect(() => importChain(root, "src/core", "src/core")).toThrow(BadInputError);
        expect(() => importChain(root, "", "src")).toThrow(BadInputError);
    });
});

describe("reach within a folder (ADR-045, amended)", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    indexRepository(root);

    it("keeps only the files inside the folder, and counts them alone", () => {
        const answer = reach(root, "src/editor", "dependents", { within: "src/platform" });
        expect(answer.reached).toEqual([{ path: "src/platform/node/storageFile.ts", distance: 1 }]);
        expect(answer.direct).toBe(1);
        expect(answer.within).toBe("src/platform");
    });

    it("refuses a folder target's own inside, which can hold none of its importers, and a within that isn't indexed, naming within", () => {
        expect(() => reach(root, "src/editor", "dependents", { within: "src/editor" })).toThrow(BadInputError);
        expect(() => reach(root, "src/editor", "dependents", { within: "src/editor/common" })).toThrow(/within "src\/editor\/common"/);
        expect(() => reach(root, "src/editor", "dependencies", { within: "src/editor/node" })).toThrow(BadInputError);
        expect(() => reach(root, "src/editor", "dependents", { within: "src/nope" })).toThrow(/within "src\/nope" isn't a folder/);
        // a file target is not a folder: within its own folder is a real question
        expect(reach(root, "src/editor/common/model.ts", "dependents", { within: "src/editor" }).reached.length).toBeGreaterThan(0);
    });

    it("refuses a file as the folder", () => {
        expect(() => reach(root, "src/editor", "dependents", { within: "src/app/main.ts" })).toThrow("within takes a folder.");
    });
});
