import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "../contracts";
import { assignPages, buildPageView, mergedPortalPath, portalPath } from "./pages";

// Ground truth: docs/plans/2026-10-12-v1-3-1-page-portals.md, "Ground truth (hand-derived)".

const file = (p: string): MapNode => ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), kind: "file", fileCount: 1, summaryStatus: "pending" });

/** The example folder x: a–f in the Map's order, and its five lines. */
const X = ["x/a", "x/b", "x/c", "x/d", "x/e", "x/f"].map(file);
const X_EDGES: MapEdge[] = [
    { source: "x/a", target: "x/c", count: 4 },
    { source: "x/c", target: "x/e", count: 2 },
    { source: "x/b", target: "x/d", count: 3 },
    { source: "x/d", target: "x/f", count: 1 },
    { source: "x/e", target: "x/b", count: 1 },
];

describe("portal paths", () => {
    it("names a page's doorway <level>//page-<n> (n from 1) and the merged one <level>//pages; the root's start with //", () => {
        expect(portalPath("x", 1)).toBe("x//page-2");
        expect(mergedPortalPath("x")).toBe("x//pages");
        expect(portalPath("", 0)).toBe("//page-1");
        expect(mergedPortalPath("")).toBe("//pages");
    });
});

describe("assignPages", () => {
    it("grows each page by its strongest attachment: [[a, c, e], [b, d, f]], not size slices", () => {
        // page 1 seeds a, takes c (a–c 4), then e (c–e 2); page 2 seeds b, takes d (3), then f (1)
        expect(assignPages(X, X_EDGES, 3)).toEqual([["x/a", "x/c", "x/e"], ["x/b", "x/d", "x/f"]]);
    });

    it("adds both directions of a pair together", () => {
        // the Map's order is a, c, b. a→b and b→a make a–b weigh 2 against a–c's 1, so b joins a ahead of c;
        // counting one direction only would tie them at 1, and c would win on order
        const children = [file("x/a"), file("x/c"), file("x/b")];
        const edges: MapEdge[] = [
            { source: "x/a", target: "x/b", count: 1 },
            { source: "x/b", target: "x/a", count: 1 },
            { source: "x/a", target: "x/c", count: 1 },
        ];
        expect(assignPages(children, edges, 2)).toEqual([["x/a", "x/b"], ["x/c"]]);
    });

    it("takes the next box in the Map's order when nothing joins the page, so a folder with no lines pages by size", () => {
        expect(assignPages(X, [], 4)).toEqual([["x/a", "x/b", "x/c", "x/d"], ["x/e", "x/f"]]);
    });

    it("breaks a tie in attachment by the Map's order, and keeps each page in the Map's order", () => {
        // a–f and a–c both weigh 2: c comes first in the Map's order, so page 1 is {a, c}, written in the Map's order
        const edges: MapEdge[] = [
            { source: "x/a", target: "x/f", count: 2 },
            { source: "x/c", target: "x/a", count: 2 },
        ];
        expect(assignPages(X, edges, 2)).toEqual([["x/a", "x/c"], ["x/b", "x/d"], ["x/e", "x/f"]]);
    });

    it("puts everything on one page when it fits", () => {
        expect(assignPages(X, X_EDGES, 44)).toEqual([["x/a", "x/b", "x/c", "x/d", "x/e", "x/f"]]);
    });

    it("assigns 780 children with 2,000 lines in under 50 ms", () => {
        // a seeded generator (mulberry32), so the timing case is the same on every run
        let seed = 42;
        const random = (): number => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const children = Array.from({ length: 780 }, (_, i) => file(`big/f${String(i).padStart(3, "0")}.ts`));
        const edges: MapEdge[] = Array.from({ length: 2000 }, () => ({
            source: children[Math.floor(random() * 780)].path,
            target: children[Math.floor(random() * 780)].path,
            count: 1 + Math.floor(random() * 5),
        }));

        const started = performance.now();
        const pages = assignPages(children, edges, 44);
        const elapsed = performance.now() - started;

        expect(pages).toHaveLength(Math.ceil(780 / 44));
        expect(pages.flat().sort()).toEqual(children.map((c) => c.path));
        expect(elapsed).toBeLessThan(50);
    });
});

describe("buildPageView", () => {
    const pages = [["x/a", "x/c", "x/e"], ["x/b", "x/d", "x/f"]];

    it("draws page 0 with a doorway to page 2, and e's import of b folded onto it", () => {
        expect(buildPageView("x", X, X_EDGES, pages, 0, 6)).toEqual({
            nodes: [
                file("x/a"), file("x/c"), file("x/e"),
                { path: "x//page-2", name: "Page 2", kind: "portal", page: 1, fileCount: 3, hiddenCount: 3, summaryStatus: "skipped", members: ["x/b", "x/d", "x/f"] },
            ],
            edges: [
                { source: "x/a", target: "x/c", count: 4 },
                { source: "x/c", target: "x/e", count: 2 },
                { source: "x/e", target: "x//page-2", count: 1 },
            ],
        });
    });

    it("draws page 1 with a doorway back to page 1, its line running in from the portal", () => {
        // "x//page-1" sorts first: "/" comes before every letter
        expect(buildPageView("x", X, X_EDGES, pages, 1, 6)).toEqual({
            nodes: [
                file("x/b"), file("x/d"), file("x/f"),
                { path: "x//page-1", name: "Page 1", kind: "portal", page: 0, fileCount: 3, hiddenCount: 3, summaryStatus: "skipped", members: ["x/a", "x/c", "x/e"] },
            ],
            edges: [
                { source: "x//page-1", target: "x/b", count: 1 },
                { source: "x/b", target: "x/d", count: 3 },
                { source: "x/d", target: "x/f", count: 1 },
            ],
        });
    });

    it("drops a line whose two ends are both on other pages", () => {
        // three pages; c → e joins pages 1 and 2, so page 0 doesn't draw it, portal-to-portal or otherwise
        const three = [["x/a", "x/b"], ["x/c", "x/d"], ["x/e", "x/f"]];
        const edges: MapEdge[] = [{ source: "x/c", target: "x/e", count: 2 }, { source: "x/a", target: "x/b", count: 1 }];
        expect(buildPageView("x", X, edges, three, 0, 6)).toEqual({
            nodes: [file("x/a"), file("x/b")],
            edges: [{ source: "x/a", target: "x/b", count: 1 }],
        });
    });

    it("gives a page with no links to another page no portal for it", () => {
        const view = buildPageView("x", X, [], pages, 0, 6);
        expect(view.nodes.map((n) => n.path)).toEqual(["x/a", "x/c", "x/e"]);
        expect(view.edges).toEqual([]);
    });

    it("merges the pages past maxPortals − 1 into one '+N pages' doorway, its lines added up", () => {
        // 4 pages; page 0 has 5 links to page 1, 1 to page 2 and 3 to page 3. With maxPortals 2, page 1 (the most
        // linked) keeps its own portal; pages 2 and 3 merge, and their lines (1 + 3) land together.
        const children = ["m/p0", "m/p1", "m/q1", "m/p2", "m/p3", "m/q3"].map(file);
        const four = [["m/p0"], ["m/p1", "m/q1"], ["m/p2"], ["m/p3", "m/q3"]];
        const edges: MapEdge[] = [
            { source: "m/p0", target: "m/p1", count: 2 },
            { source: "m/q1", target: "m/p0", count: 3 },
            { source: "m/p0", target: "m/p2", count: 1 },
            { source: "m/p0", target: "m/p3", count: 1 },
            { source: "m/p0", target: "m/q3", count: 2 },
            { source: "m/p1", target: "m/p3", count: 7 },   // both ends elsewhere: dropped
        ];
        expect(buildPageView("m", children, edges, four, 0, 2)).toEqual({
            nodes: [
                file("m/p0"),
                { path: "m//page-2", name: "Page 2", kind: "portal", page: 1, fileCount: 2, hiddenCount: 2, summaryStatus: "skipped", members: ["m/p1", "m/q1"] },
                { path: "m//pages", name: "+2 pages", kind: "portal", pages: [2, 3], fileCount: 3, hiddenCount: 3, summaryStatus: "skipped", members: ["m/p2", "m/p3", "m/q3"] },
            ],
            edges: [
                { source: "m//page-2", target: "m/p0", count: 3 },
                { source: "m/p0", target: "m//page-2", count: 2 },
                { source: "m/p0", target: "m//pages", count: 4 },
            ],
        });
    });

    it("breaks a tie in links by the lower page", () => {
        // page 0 links once each to pages 1, 2 and 3; with maxPortals 2, page 1 keeps its portal
        const children = ["t/a", "t/b", "t/c", "t/d"].map(file);
        const four = [["t/a"], ["t/b"], ["t/c"], ["t/d"]];
        const edges: MapEdge[] = [
            { source: "t/a", target: "t/d", count: 1 },
            { source: "t/a", target: "t/c", count: 1 },
            { source: "t/a", target: "t/b", count: 1 },
        ];
        const view = buildPageView("t", children, edges, four, 0, 2);
        expect(view.nodes.map((n) => n.path)).toEqual(["t/a", "t//page-2", "t//pages"]);
        expect(view.nodes[2]).toMatchObject({ name: "+2 pages", pages: [2, 3] });
    });

    it("adds up the files of the folders a portal stands for", () => {
        const children: MapNode[] = [
            { path: "r", name: "r", kind: "folder", fileCount: 9, summaryStatus: "fresh" },
            { path: "s", name: "s", kind: "folder", fileCount: 4, summaryStatus: "fresh" },
            { path: "u", name: "u", kind: "folder", fileCount: 3, summaryStatus: "fresh" },
        ];
        const view = buildPageView("", children, [{ source: "r", target: "u", count: 1 }], [["r"], ["s", "u"]], 0, 6);
        expect(view.nodes[1]).toEqual({
            path: "//page-2", name: "Page 2", kind: "portal", page: 1, fileCount: 7, hiddenCount: 2, summaryStatus: "skipped", members: ["s", "u"],
        });
        expect(view.edges).toEqual([{ source: "r", target: "//page-2", count: 1 }]);
    });
});
