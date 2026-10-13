import type { LevelResponse, MapEdge, MapNode } from "@/lib/contracts";
import { formatCount } from "./format";

/**
 * Portals (API_CONTRACTS.md §11): the doorway boxes on a page of a big folder that stand for its other pages. Lines
 * to boxes on another page end at that page's portal; double-clicking it turns to that page.
 */

/** Which way a doorway leads from the page on screen: back to a lower page, on to a higher one, or to several. */
export function portalDirection(box: Pick<MapNode, "page" | "pages">, currentPage: number): "previous" | "next" | "many" {
    if (box.page === undefined) return "many";
    return box.page < currentPage ? "previous" : "next";
}

/** How many imports run along a doorway's lines, both ways. */
export function portalLinks(edges: readonly MapEdge[], portalPath: string): number {
    return edges.reduce((sum, edge) => sum + (edge.source === portalPath || edge.target === portalPath ? edge.count : 0), 0);
}

const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Under a doorway's name: "44 boxes · 6 links". */
export function portalCaption(box: Pick<MapNode, "hiddenCount">, links: number): string {
    return `${plural(box.hiddenCount ?? 0, "box", "boxes")} · ${plural(links, "link", "links")}`;
}

/**
 * The boxes on this page with lines to or from a doorway, each with its imports both ways: most first, ties in the
 * Map's order. The portal's panel lists them.
 */
export function linkedFrom(level: Pick<LevelResponse, "nodes" | "edges">, portalPath: string): { path: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const edge of level.edges){
        const other = edge.source === portalPath ? edge.target : edge.target === portalPath ? edge.source : null;
        if (other !== null) counts.set(other, (counts.get(other) ?? 0) + edge.count);
    }
    const order = new Map(level.nodes.map((n, i) => [n.path, i]));
    return [...counts.entries()]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count || (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
}

/** "Page 2 of 5 · 44 of 182 boxes": which page of a big folder is on screen. Portals aren't the folder's boxes. */
export function pageNote(level: Pick<LevelResponse, "nodes" | "hiddenCount" | "page" | "pageCount">): string {
    const drawn = level.nodes.filter((n) => n.kind !== "portal").length;
    return `Page ${level.page + 1} of ${level.pageCount} · ${formatCount(drawn)} of ${formatCount(drawn + level.hiddenCount)} boxes`;
}
