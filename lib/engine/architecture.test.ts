import path from "path";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { indexRepository } from "../index/pipeline";
import { repoKey } from "../index/paths";
import { architecture, conventionsOf, layersOf, shortestCycleThrough, stronglyConnected } from "./architecture";
import { buildImportGraph } from "./graph";
import { buildImportIndex, importIndexFor } from "./reach";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
const { repoId } = indexRepository(root);
const db = getDb();
const index = importIndexFor(db, requireRepository(db, repoKey(root)), readIndexVersion(db, repoId));
const at = (p: string): number => index.paths.indexOf(p);

describe("stronglyConnected", () => {
    it("finds the fixture's one group of three files", () => {
        const { group, sizes } = stronglyConnected(index);
        const big = sizes.flatMap((size, id) => (size > 1 ? [id] : []));
        expect(big).toHaveLength(1);
        expect(index.paths.filter((_, i) => group[i] === big[0])).toEqual(["src/editor/common/model.ts", "src/editor/common/textModel.ts", "src/editor/common/tokens.ts"]);
    });

    it("finds one group in a ring of 100,000 files, without overflowing the stack (Review Focus 4)", () => {
        const n = 100_000;
        const files = Array.from({ length: n }, (_, i) => ({ id: i, path: `f${String(i).padStart(6, "0")}.ts` }));
        const edges = files.map((f, i) => ({ source: f.id, target: (i + 1) % n }));
        expect(stronglyConnected(buildImportIndex(buildImportGraph(files, edges))).sizes).toEqual([n]);
    });
});

describe("shortestCycleThrough", () => {
    it("walks the group from the file back to it", () => {
        const { group } = stronglyConnected(index);
        expect(shortestCycleThrough(index, at("src/editor/common/model.ts"), group)?.map((i) => index.paths[i]))
            .toEqual(["src/editor/common/model.ts", "src/editor/common/tokens.ts", "src/editor/common/textModel.ts", "src/editor/common/model.ts"]);
        expect(shortestCycleThrough(index, at("src/platform/common/storage.ts"), group)).toBeNull();
    });
});

describe("layersOf, hand-built", () => {
    const part = (p: string) => ({ path: p, kind: "folder" as const });
    const examples = (from: { path: string }, to: { path: string }): [string, string][] => [[`${from.path}/x.ts`, `${to.path}/y.ts`]];

    it("orders the fixture's src by the direction most imports go, and lists the imports against it", () => {
        const layers = layersOf([part("src/app"), part("src/base"), part("src/editor"), part("src/platform")], [
            { source: "src/app", target: "src/base", count: 1 }, { source: "src/app", target: "src/editor", count: 2 },
            { source: "src/app", target: "src/platform", count: 1 }, { source: "src/editor", target: "src/base", count: 3 },
            { source: "src/editor", target: "src/platform", count: 2 }, { source: "src/platform", target: "src/base", count: 3 },
            { source: "src/platform", target: "src/editor", count: 1 },
        ], examples);
        expect(layers.levels.map((level) => level.map((p) => p.path))).toEqual([["src/base"], ["src/platform"], ["src/editor"], ["src/app"]]);
        expect(layers.against).toEqual([{ from: part("src/platform"), to: part("src/editor"), count: 1, examples: [["src/platform/x.ts", "src/editor/y.ts"]] }]);
        expect(layers.tangled).toEqual([]);
        expect(layers.unlinked).toEqual([]);
    });

    it("calls an even pair tangled, a loop of dominant directions a circle, and a part with no imports unlinked", () => {
        const layers = layersOf([part("a"), part("b"), part("c"), part("d"), part("e")], [
            { source: "a", target: "b", count: 2 }, { source: "b", target: "a", count: 2 },
            { source: "b", target: "c", count: 1 }, { source: "c", target: "d", count: 1 }, { source: "d", target: "b", count: 1 },
        ], examples);
        expect(layers.tangled).toEqual([{ a: part("a"), b: part("b"), count: 2 }]);
        expect(layers.circles).toEqual([[part("b"), part("c"), part("d")]]);
        expect(layers.unlinked).toEqual([part("e")]);
    });
});

describe("conventionsOf on the fixture's src", () => {
    it("names the folder names that recur in 3 or more folders, and counts what each one's files import", () => {
        const c = conventionsOf(index, "src");
        expect(c.names).toEqual([{ name: "browser", folders: 3 }, { name: "common", folders: 4 }, { name: "node", folders: 3 }]);
        expect(c.pairs.map((p) => `${p.from}>${p.to} ${p.count}`)).toEqual(["browser>browser 2", "browser>common 2", "common>browser 1", "common>common 8", "node>common 4", "node>node 3"]);
        expect(c.pairs.find((p) => p.from === "common" && p.to === "browser")!.examples).toEqual([["src/platform/common/storage.ts", "src/platform/browser/storageView.ts"]]);
        expect(c.pairs.find((p) => p.from === "common" && p.to === "common")!.examples).toEqual([]);
    });
});

describe("conventionsOf, the threshold relative to the place", () => {
    // place "p": 160 folders p/gNNN, each with a leaf folder (160 more), and "rare" under g000, g001, g002: 323 folders in all
    const dirs = Array.from({ length: 160 }, (_, i) => `p/g${String(i).padStart(3, "0")}`);
    const paths = [...dirs.map((d) => `${d}/leaf/f.ts`), ...dirs.slice(0, 3).map((d) => `${d}/rare/f.ts`)].sort();
    const big = buildImportIndex(buildImportGraph(paths.map((p, id) => ({ id, path: p })), []));

    it("is 1% of the folders under the place when that's above 3: 323 folders need 4", () => {
        const c = conventionsOf(big, "p");
        expect(c.minFolders).toBe(4);
        expect(c.names).toEqual([{ name: "leaf", folders: 160 }]);   // rare is in 3 folders: below 4
    });

    it("an explicit minFolders wins", () => {
        const c = conventionsOf(big, "p", 3);
        expect(c.minFolders).toBe(3);
        expect(c.names).toEqual([{ name: "leaf", folders: 160 }, { name: "rare", folders: 3 }]);
    });

    it("stays 3 on the fixture's places", () => {
        expect(conventionsOf(index, "src").minFolders).toBe(3);
        expect(conventionsOf(index, "").minFolders).toBe(3);
    });
});

describe("architecture(), against the ground truth", () => {
    it("files nothing imports in src: one an entry point, one not named, one test", () => {
        expect(architecture(root, "src", "unused").unused).toEqual({ declared: ["src/app/loader.ts"], others: ["src/app/legacy.ts"], tests: 1 });
    });

    it("refuses a file except for cycles", () => {
        expect(() => architecture(root, "src/app/main.ts", "layers")).toThrow('architecture reads a folder ("" for the repo); for one file, ask for report "cycles".');
        expect(architecture(root, "src/editor/common/model.ts", "cycles").through?.cycle).toHaveLength(4);
    });

    it("reads through, or a file, on the default summary as a cycles question; with any other report it refuses through", () => {
        // model.ts → tokens.ts → textModel.ts → model.ts: the ground truth's one cycle, 3 steps, 4 entries
        const cycle = ["src/editor/common/model.ts", "src/editor/common/tokens.ts", "src/editor/common/textModel.ts", "src/editor/common/model.ts"];
        const viaThrough = architecture(root, "src", "summary", { through: "src/editor/common/model.ts" });
        expect(viaThrough).toMatchObject({ report: "cycles", through: { file: "src/editor/common/model.ts", cycle } });
        expect(viaThrough.cycles).toBeUndefined();   // no summary that would read "Import cycles: none"
        expect(architecture(root, "src/editor/common/model.ts", "summary")).toMatchObject({ report: "cycles", kind: "file", through: { cycle } });

        const sentence = 'through goes with report "cycles": ask again with report "cycles" for the shortest import cycle through that file.';
        expect(() => architecture(root, "src", "layers", { through: "src/editor/common/model.ts" })).toThrow(sentence);
        expect(() => architecture(root, "src", "conventions", { through: "src/editor/common/model.ts" })).toThrow(sentence);
        expect(() => architecture(root, "src", "unused", { through: "src/editor/common/model.ts" })).toThrow(sentence);
        expect(() => architecture(root, "src/app/main.ts", "unused")).toThrow('architecture reads a folder ("" for the repo); for one file, ask for report "cycles".');
        // the summary of src with no through counts its one group of three files
        expect(architecture(root, "src", "summary")).toMatchObject({ report: "summary", cycles: [{ size: 3, files: ["src/editor/common/model.ts", "src/editor/common/textModel.ts", "src/editor/common/tokens.ts"] }] });
    });
});
