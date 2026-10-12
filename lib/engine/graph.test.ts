import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { getDb } from "../db/client";
import { loadGraphEdges, loadGraphFiles } from "../db/store/map";
import { readIndexVersion } from "../db/store/version";
import { indexRepository } from "../index/pipeline";
import { areaCounts, buildImportGraph, cachedAreaCounts, rangeOf } from "./graph";

function fixtureGraph(){
    const { repoId } = indexRepository(copyFixture());
    return buildImportGraph(loadGraphFiles(getDb(), repoId), loadGraphEdges(getDb(), repoId));
}

describe("import graph", () => {
    it("finds a folder's files as one range of the sorted paths, and a file as one position", () => {
        const graph = buildImportGraph(
            [{ id: 7, path: "b/z.ts" }, { id: 3, path: "ab.ts" }, { id: 9, path: "a/y.ts" }, { id: 1, path: "a/x.ts" }],
            [],
        );
        expect(graph.paths).toEqual(["a/x.ts", "a/y.ts", "ab.ts", "b/z.ts"]);
        expect(rangeOf(graph, "a", "folder")).toEqual([0, 2]);   // "ab.ts" is beside a/, not inside it
        expect(rangeOf(graph, "ab.ts", "file")).toEqual([2, 3]);
        expect(rangeOf(graph, "", "repo")).toEqual([0, 4]);
        expect(rangeOf(graph, "nope.ts", "file")).toEqual([4, 4]);   // empty, at the end: "nope.ts" sorts after "b/z.ts"
    });

    it("counts a folder's crossing imports by area: src/core is used by src/app, src/index.ts and src/util, and src by scripts", () => {
        const graph = fixtureGraph();
        expect(areaCounts(graph, "src/core", "folder")).toEqual({
            uses: [],
            usedBy: [
                { path: "src/app", kind: "folder", count: 1 },
                { path: "src/index.ts", kind: "file", count: 1 },
                { path: "src/util", kind: "folder", count: 1 },
            ],
        });
        expect(areaCounts(graph, "src", "folder")).toEqual({ uses: [], usedBy: [{ path: "scripts", kind: "folder", count: 2 }] });
        expect(areaCounts(graph, "", "repo")).toEqual({ uses: [], usedBy: [] });
    });

    it("counts a file's imports both ways, a neighbour in its own folder being its own area", () => {
        const graph = fixtureGraph();
        expect(areaCounts(graph, "src/app/main.ts", "file")).toEqual({
            uses: [
                { path: "src/app/view.tsx", kind: "file", count: 1 },
                { path: "src/core", kind: "folder", count: 1 },
                { path: "src/util", kind: "folder", count: 1 },
            ],
            usedBy: [
                { path: "scripts", kind: "folder", count: 1 },
                { path: "src/app/view.tsx", kind: "file", count: 1 },
                { path: "src/index.ts", kind: "file", count: 1 },
            ],
        });
        expect(areaCounts(graph, "scripts/build.js", "file")).toEqual({ uses: [{ path: "src", kind: "folder", count: 2 }], usedBy: [] });
    });

    it("groups a workbench-like folder's imports under the sibling areas they reach, most first", () => {
        const files = [
            "src/vs/workbench/a.ts", "src/vs/workbench/b/c.ts", "src/vs/base/common/x.ts", "src/vs/base/browser/y.ts",
            "src/vs/platform/p.ts", "src/vs/nls.ts", "extensions/e.ts",
        ].map((p, i) => ({ id: i + 1, path: p }));
        const id = (p: string) => files.find((f) => f.path === p)!.id;
        const edge = (s: string, t: string) => ({ source: id(s), target: id(t) });
        const graph = buildImportGraph(files, [
            edge("src/vs/workbench/a.ts", "src/vs/base/common/x.ts"),
            edge("src/vs/workbench/a.ts", "src/vs/base/browser/y.ts"),
            edge("src/vs/workbench/b/c.ts", "src/vs/base/common/x.ts"),
            edge("src/vs/workbench/b/c.ts", "src/vs/platform/p.ts"),
            edge("src/vs/workbench/b/c.ts", "src/vs/nls.ts"),
            edge("src/vs/workbench/b/c.ts", "src/vs/workbench/a.ts"),   // inside: not counted
            edge("extensions/e.ts", "src/vs/workbench/a.ts"),
        ]);
        expect(areaCounts(graph, "src/vs/workbench", "folder")).toEqual({
            uses: [
                { path: "src/vs/base", kind: "folder", count: 3 },
                { path: "src/vs/nls.ts", kind: "file", count: 1 },
                { path: "src/vs/platform", kind: "folder", count: 1 },
            ],
            usedBy: [{ path: "extensions", kind: "folder", count: 1 }],
        });
    });

    it("reuses the graph within an index version and reloads it when the version moves", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        const db = getDb();
        const before = cachedAreaCounts(db, repoId, readIndexVersion(db, repoId), "src/core", "folder");
        expect(before.usedBy.find((a) => a.path === "src/util")?.count).toBe(1);

        // strings.ts now imports log.ts directly as well: a second import from src/util into src/core
        const strings = path.join(root, "src/util/strings.ts");
        fs.writeFileSync(strings, `import { banner } from "../core/log";\n${fs.readFileSync(strings, "utf8")}`);
        indexRepository(root);
        const after = cachedAreaCounts(db, repoId, readIndexVersion(db, repoId), "src/core", "folder");
        expect(after.usedBy.find((a) => a.path === "src/util")?.count).toBe(2);
    });
});
