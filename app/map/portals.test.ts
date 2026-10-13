import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import { linkedFrom, pageNote, portalCaption, portalDirection, portalLinks } from "./portals";

const box = (p: string): MapNode => ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), kind: "file", fileCount: 1, summaryStatus: "fresh" });
const portal = (p: string, fields: Partial<MapNode>): MapNode => ({ path: p, name: p, kind: "portal", fileCount: 1, summaryStatus: "skipped", ...fields });

// page 2 of 5 of folder x: three boxes, the doorway back to page 1, and the merged doorway to pages 3–5
const BACK = portal("x//page-1", { name: "Page 1", page: 0, hiddenCount: 44 });
const ONWARD = portal("x//pages", { name: "+3 pages", pages: [2, 3, 4], hiddenCount: 135 });
const EDGES: MapEdge[] = [
    { source: "x//page-1", target: "x/b", count: 1 },
    { source: "x//page-1", target: "x/f", count: 1 },
    { source: "x//pages", target: "x/f", count: 1 },
    { source: "x/b", target: "x//pages", count: 2 },
    { source: "x/b", target: "x/d", count: 3 },
    { source: "x/d", target: "x//pages", count: 4 },
];
const LEVEL = { nodes: [box("x/b"), box("x/d"), box("x/f"), BACK, ONWARD], edges: EDGES, hiddenCount: 179, page: 1, pageCount: 5 };

describe("portals", () => {
    it("points a doorway back to a lower page, on to a higher one, and a merged one at many", () => {
        expect(portalDirection(BACK, 1)).toBe("previous");
        expect(portalDirection(portal("x//page-4", { page: 3 }), 1)).toBe("next");
        expect(portalDirection(ONWARD, 1)).toBe("many");
    });

    it("counts the imports on a doorway's lines, both ways", () => {
        expect(portalLinks(EDGES, "x//pages")).toBe(7);   // x/f 1 in, x/b 2 and x/d 4 out
        expect(portalLinks(EDGES, "x//page-1")).toBe(2);
    });

    it("says how many folders and files are behind a doorway and how many links it has, in the singular when it's one", () => {
        expect(portalCaption(ONWARD, 7)).toBe("135 folders and files · 7 links");
        expect(portalCaption(portal("x//page-3", { hiddenCount: 1 }), 1)).toBe("1 folder or file · 1 link");
        expect(portalCaption(portal("x//page-3", { hiddenCount: 1200 }), 0)).toBe("1,200 folders and files · 0 links");
    });

    it("lists this page's boxes linked to a doorway, most imports first, ties in the Map's order", () => {
        expect(linkedFrom(LEVEL, "x//pages")).toEqual([{ path: "x/d", count: 4 }, { path: "x/b", count: 2 }, { path: "x/f", count: 1 }]);
        expect(linkedFrom(LEVEL, "x//page-1")).toEqual([{ path: "x/b", count: 1 }, { path: "x/f", count: 1 }]);
    });

    it("notes which page is on screen and how many of the folder's boxes it draws, portals not counted", () => {
        expect(pageNote(LEVEL)).toBe("Page 2 of 5 · 3 of 182 folders and files");
        expect(pageNote({ nodes: Array.from({ length: 44 }, (_, i) => box(`y/${i}`)), hiddenCount: 1236, page: 0, pageCount: 30 }))
            .toBe("Page 1 of 30 · 44 of 1,280 folders and files");
    });
});
