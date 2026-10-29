import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import { boxTitle, heaviestLink, lineLabel, noDeclarationsText, runWords } from "./labels";

const box = (path: string, extra: Partial<MapNode> = {}): MapNode =>
    ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "folder", fileCount: 3, summaryStatus: "fresh", ...extra });
const portal = (path: string, name: string, extra: Partial<MapNode>): MapNode =>
    ({ path, name, kind: "portal", fileCount: 9, summaryStatus: "skipped", ...extra });

describe("lineLabel (owner's three-task test: 'base depends on editor')", () => {
    it("says which box uses which, in words, with the import count", () => {
        expect(lineLabel(box("src/vs/editor"), box("src/vs/base"), 12)).toBe("editor uses base, 12 imports");
        expect(lineLabel(box("src/a.ts", { kind: "file" }), box("src/b.ts", { kind: "file" }), 1)).toBe("a.ts uses b.ts, 1 import");
    });

    it("names the boxes behind a portal instead of the doorway", () => {
        const page2 = portal("x//page-2", "Page 2", { page: 1 });
        expect(lineLabel(box("x/github"), page2, 3)).toBe("github uses boxes on Page 2, 3 imports");
        expect(lineLabel(page2, box("x/github"), 1)).toBe("Boxes on Page 2 use github, 1 import");
    });

    it("counts the pages behind a merged portal", () => {
        const merged = portal("x//pages", "+3 pages", { pages: [2, 3, 4] });
        expect(lineLabel(box("x/log"), merged, 40)).toBe("log uses boxes on 3 other pages, 40 imports");
        expect(lineLabel(merged, box("x/log"), 2)).toBe("Boxes on 3 other pages use log, 2 imports");
    });
});

describe("boxTitle", () => {
    it("shows a box's path and its one-line summary, so you can tell what it is before opening it", () => {
        expect(boxTitle(box(".vscode", { tagline: "Editor settings for working on this repo" }))).toBe(".vscode: Editor settings for working on this repo");
    });

    it("shows just the path when there's no summary yet", () => {
        expect(boxTitle(box("src/vs/editor"))).toBe("src/vs/editor");
    });
});

describe("noDeclarationsText (ADR-053, amended)", () => {
    it("says a file over the size cap had its declarations left unread, and otherwise that none were found", () => {
        expect(noDeclarationsText({ importsOnly: true })).toBe("Not read, since it's over the 1 MB size cap. Only its imports were.");
        expect(noDeclarationsText({})).toBe("None found.");
    });
});

describe("heaviestLink (the toolbar's finding)", () => {
    const named = (path: string) => box(path);
    it("names VS Code's root's heaviest line and the share of the level's imports it carries", () => {
        // the root's eleven lines add up to 2 + 2 + 2 + 16 + 1 + 1 + 1 + 665 + 16 + 1 + 1 = 708
        const nodes = ["src", "extensions", "build", "test", ".github", ".eslint-plugin-local", "eslint.config.js", "gulpfile.mjs"].map(named);
        const edges = [
            [".eslint-plugin-local", "src", 2], [".github", "src", 2], ["build", ".eslint-plugin-local", 2], ["build", "src", 16],
            ["eslint.config.js", ".eslint-plugin-local", 1], ["eslint.config.js", "extensions", 1], ["extensions", "build", 1],
            ["extensions", "src", 665], ["extensions", "test", 16], ["gulpfile.mjs", "build", 1], ["test", "build", 1],
        ].map(([source, target, count]) => ({ source: source as string, target: target as string, count: count as number }));
        expect(heaviestLink({ nodes, edges })).toEqual({ from: "extensions", to: "src", count: 665, total: 708 });
    });

    it("breaks a tie by source then target, and is null with no lines", () => {
        const nodes = ["a", "b", "c"].map(named);
        expect(heaviestLink({ nodes, edges: [{ source: "b", target: "c", count: 3 }, { source: "a", target: "c", count: 3 }] })).toEqual({ from: "a", to: "c", count: 3, total: 6 });
        expect(heaviestLink({ nodes, edges: [] })).toBeNull();
    });
});

describe("runWords (the owner, 2026-10-29: which line is the hover about, on merged lines?)", () => {
    const named = (path: string) => box(path);
    const line = (source: string, target: string, count: number) => ({ source, target, count });
    const byPath = (paths: string[], ...more: MapNode[]) => new Map([...paths.map(named), ...more].map((n) => [n.path, n]));

    it("says one line's sentence, in parts, where it has the stretch to itself", () => {
        const words = runWords([line(".eslint-plugin-local", "src", 2)], byPath([".eslint-plugin-local", "src"]));
        expect(words).toEqual({
            kind: "one",
            id: ".eslint-plugin-local->src",
            parts: { who: ".eslint-plugin-local", verb: "uses", whom: "src", imports: "2 imports" },
            sentence: ".eslint-plugin-local uses src, 2 imports",
        });
    });

    it("lists the lines into one box by the box each comes from, heaviest first (VS Code's root, into src)", () => {
        const words = runWords([line("build", "src", 16), line("extensions", "src", 665), line(".eslint-plugin-local", "src", 2)], byPath(["build", "extensions", ".eslint-plugin-local", "src"]));
        expect(words).toEqual({
            kind: "run",
            title: "Into src",
            rows: [
                { id: "extensions->src", name: "extensions", count: 665 },
                { id: "build->src", name: "build", count: 16 },
                { id: ".eslint-plugin-local->src", name: ".eslint-plugin-local", count: 2 },
            ],
        });
    });

    it("lists the lines out of one box by the box each goes to (src/vs, out of workbench)", () => {
        const paths = ["src/vs/workbench", "src/vs/base", "src/vs/platform", "src/vs/editor", "src/vs/nls.ts"];
        const words = runWords([
            line("src/vs/workbench", "src/vs/editor", 3652), line("src/vs/workbench", "src/vs/base", 20648),
            line("src/vs/workbench", "src/vs/nls.ts", 1579), line("src/vs/workbench", "src/vs/platform", 19171),
        ], byPath(paths));
        expect(words.kind === "run" && words.title).toBe("From workbench");
        expect(words.kind === "run" && words.rows.map((r) => `${r.name} ${r.count}`)).toEqual(["base 20648", "platform 19171", "editor 3652", "nls.ts 1579"]);
    });

    it("puts lines of the same weight in name order, and a doorway by the boxes behind it, with a capital", () => {
        const page2 = portal("x//page-2", "Page 2", { page: 1 });
        const words = runWords([line("x/b.ts", "x/u.ts", 1), line("x//page-2", "x/u.ts", 33), line("x/a.ts", "x/u.ts", 1)], byPath(["x/a.ts", "x/b.ts", "x/u.ts"], page2));
        expect(words.kind === "run" && words.rows.map((r) => r.name)).toEqual(["Boxes on Page 2", "a.ts", "b.ts"]);
    });

    it("names a doorway in the title without a capital, after Into", () => {
        const page2 = portal("x//page-2", "Page 2", { page: 1 });
        const words = runWords([line("x/a", "x//page-2", 3), line("x/b", "x//page-2", 2)], byPath(["x/a", "x/b"], page2));
        expect(words.kind === "run" && words.title).toBe("Into boxes on Page 2");
    });

    it("names both ends of each line where the run shares neither", () => {
        const words = runWords([line("a", "b", 2), line("c", "d", 5)], byPath(["a", "b", "c", "d"]));
        expect(words).toEqual({ kind: "run", title: "Lines here", rows: [{ id: "c->d", name: "c → d", count: 5 }, { id: "a->b", name: "a → b", count: 2 }] });
    });
});
