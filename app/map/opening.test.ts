import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { openingOf } from "./opening";

const box = (kind: MapNode["kind"], path: string, extra: Partial<MapNode> = {}): MapNode => ({
    path,
    name: path.split("/").pop() ?? path,
    kind,
    fileCount: 1,
    summaryStatus: "skipped",
    ...extra,
});

const FILE = box("file", "src/vs/editor/editor.main.ts");
const FOLDER = box("folder", "src/vs/editor/common", { fileCount: 700 });
const DOORWAY = box("portal", "src/vs/platform//page-2", { page: 1 });
const MERGED = box("portal", "src/vs/platform//pages", { pages: [1, 2] });

describe("what opening a box does (a double-click, or the Open beside it in a narrow window)", () => {
    it("opens a folder on the Map, in VS Code's panel as in a browser tab", () => {
        expect(openingOf(FOLDER, true)).toEqual({ type: "folder", path: "src/vs/editor/common" });
        expect(openingOf(FOLDER, false)).toEqual({ type: "folder", path: "src/vs/editor/common" });
    });

    it("turns a doorway to its page", () => {
        expect(openingOf(DOORWAY, true)).toEqual({ type: "page", page: 1 });
        expect(openingOf(DOORWAY, false)).toEqual({ type: "page", page: 1 });
    });

    it("leaves the merged doorway selected, since it stands for several pages for its panel to pick from", () => {
        expect(openingOf(MERGED, true)).toBeNull();
        expect(openingOf(MERGED, false)).toBeNull();
    });

    it("opens a file in the editor inside VS Code's panel (the owner, 2026-10-29: a click only selects it)", () => {
        expect(openingOf(FILE, true)).toEqual({ type: "editor", path: "src/vs/editor/editor.main.ts" });
    });

    it("does nothing with a file in a browser tab, which has no editor to open it in", () => {
        expect(openingOf(FILE, false)).toBeNull();
    });
});
