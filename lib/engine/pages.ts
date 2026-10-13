import type { MapEdge, MapNode } from "../contracts";

/** No more than this many boxes are ever on screen, portals included (PIVOT_SPEC.md §2, S4). */
export const MAP_BOX_CAP = 50;

/**
 * Pages of a big folder (V1.3.1, owner review). A folder with more than MAP_BOX_CAP children is drawn a page at a
 * time, and every child is on some page. A page holds PAGE_SIZE boxes plus at most MAX_PORTALS portals, the doorways
 * to the other pages that its cross-page lines run into, so a page never draws more than 44 + 6 = 50 boxes (S4).
 */
export const PAGE_SIZE = 44;
export const MAX_PORTALS = 6;

/** A doorway to one page: "<level>//page-<n>", n counted from 1. Stored paths never hold "//", so it can't collide. */
export const portalPath = (levelPath: string, page: number): string => `${levelPath}//page-${page + 1}`;

/** The doorway standing for several pages, when a page links to more than MAX_PORTALS others. */
export const mergedPortalPath = (levelPath: string): string => `${levelPath}//pages`;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Puts a folder's children on pages of at most `pageSize`, keeping boxes that import each other together, so fewer
 * lines cross pages than if the folder were sliced by size.
 *
 * Greedy growth: a page seeds with the first unassigned child in the Map's order, then repeatedly takes the
 * unassigned child joined most strongly to the page so far (both directions of a pair add up; ties go to the Map's
 * order). When nothing unassigned joins the page, the next child in the Map's order goes in, so a folder with no
 * lines pages exactly by size. Each page is returned in the Map's order.
 *
 * To stay fast on wide folders (780 children), the attachment weights live in a "frontier": only children joined
 * to the current page have an entry, updated as each box lands, and it's cleared when the next page starts.
 */
export function assignPages(children: readonly MapNode[], edges: readonly MapEdge[], pageSize: number = PAGE_SIZE): string[][] {
    const indexOf = new Map(children.map((child, i) => [child.path, i]));

    // undirected weights between children, by index: a→b and b→a add up
    const neighbors: Map<number, number>[] = children.map(() => new Map());
    for (const edge of edges){
        const a = indexOf.get(edge.source);
        const b = indexOf.get(edge.target);
        if (a === undefined || b === undefined || a === b) continue;
        neighbors[a].set(b, (neighbors[a].get(b) ?? 0) + edge.count);
        neighbors[b].set(a, (neighbors[b].get(a) ?? 0) + edge.count);
    }

    const assigned = new Array<boolean>(children.length).fill(false);
    let nextInOrder = 0;   // every child before this index is assigned
    const pages: number[][] = [];

    for (let left = children.length; left > 0;){
        const page: number[] = [];
        const frontier = new Map<number, number>();   // unassigned child → its weight to this page

        const take = (i: number): void => {
            assigned[i] = true;
            frontier.delete(i);
            page.push(i);
            left--;
            for (const [j, weight] of neighbors[i]){
                if (!assigned[j]) frontier.set(j, (frontier.get(j) ?? 0) + weight);
            }
        };

        while (page.length < pageSize && left > 0){
            let best = -1;
            let bestWeight = 0;
            for (const [j, weight] of frontier){
                if (weight > bestWeight || (weight === bestWeight && j < best)){
                    best = j;
                    bestWeight = weight;
                }
            }
            if (best === -1){
                while (assigned[nextInOrder]) nextInOrder++;
                best = nextInOrder;
            }
            take(best);
        }

        pages.push(page.sort((a, b) => a - b));
    }

    return pages.map((page) => page.map((i) => children[i].path));
}

/**
 * One page of a big folder: its boxes in the Map's order, then a portal for each other page it has lines with, and
 * its lines with the far ends folded onto those portals.
 *
 * - A line with both ends on this page stays. A line with one end on another page now runs to (or from) that page's
 *   portal, and lines that then join the same two boxes are added up. A line with both ends elsewhere is dropped.
 * - A page with no lines to another page gets no portal for it; the page pill and the arrow keys still reach every page.
 * - Linked to more than `maxPortals` pages, the page keeps its own portal for the `maxPortals − 1` most linked
 *   (ties go to the lower page) and merges the rest into one "+N pages" portal, so S4 holds.
 */
export function buildPageView(
    levelPath: string,
    children: readonly MapNode[],
    edges: readonly MapEdge[],
    pages: readonly string[][],
    page: number,
    maxPortals: number = MAX_PORTALS,
): { nodes: MapNode[]; edges: MapEdge[] } {
    const childByPath = new Map(children.map((child) => [child.path, child]));
    const pageOfPath = new Map<string, number>();
    pages.forEach((members, p) => members.forEach((member) => pageOfPath.set(member, p)));

    // how strongly this page is linked to each other page, both directions
    const links = new Map<number, number>();
    for (const edge of edges){
        const from = pageOfPath.get(edge.source);
        const to = pageOfPath.get(edge.target);
        if (from === undefined || to === undefined || (from === page) === (to === page)) continue;
        const other = from === page ? to : from;
        links.set(other, (links.get(other) ?? 0) + edge.count);
    }

    const ranked = [...links.entries()].sort(([pa, wa], [pb, wb]) => wb - wa || pa - pb).map(([p]) => p);
    const keepCount = ranked.length > maxPortals ? maxPortals - 1 : ranked.length;
    const own = ranked.slice(0, keepCount).sort((a, b) => a - b);
    const merged = ranked.slice(keepCount).sort((a, b) => a - b);

    const portalFor = new Map<number, string>();
    own.forEach((p) => portalFor.set(p, portalPath(levelPath, p)));
    merged.forEach((p) => portalFor.set(p, mergedPortalPath(levelPath)));

    const portal = (path: string, name: string, behind: number[], extra: Pick<MapNode, "page" | "pages">): MapNode => {
        const members = behind.flatMap((p) => pages[p]);
        return {
            path,
            name,
            kind: "portal",
            ...extra,
            fileCount: members.reduce((sum, member) => sum + (childByPath.get(member)?.fileCount ?? 0), 0),
            hiddenCount: members.length,
            summaryStatus: "skipped",
            members,
        };
    };

    const nodes: MapNode[] = [
        ...pages[page].flatMap((member) => childByPath.get(member) ?? []),
        ...own.map((p) => portal(portalPath(levelPath, p), `Page ${p + 1}`, [p], { page: p })),
        ...(merged.length > 0 ? [portal(mergedPortalPath(levelPath), `+${merged.length} pages`, merged, { pages: merged })] : []),
    ];

    // fold each far end onto its portal, and add up lines that then join the same two boxes
    const folded = new Map<string, MapEdge>();
    for (const edge of edges){
        const from = pageOfPath.get(edge.source);
        const to = pageOfPath.get(edge.target);
        if (from === undefined || to === undefined || (from !== page && to !== page)) continue;
        const source = from === page ? edge.source : portalFor.get(from)!;
        const target = to === page ? edge.target : portalFor.get(to)!;

        const key = `${source}\0${target}`;
        const existing = folded.get(key);
        if (existing) existing.count += edge.count;
        else folded.set(key, { source, target, count: edge.count });
    }

    return { nodes, edges: [...folded.values()].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target)) };
}

/**
 * The page holding `targetPath`: the page of the box it is, or of the box it's inside ("x/f/deep.ts" is inside "x/f").
 * Null when no box on any page holds it.
 */
export function pageOf(pages: readonly string[][], targetPath: string): number | null {
    for (let p = 0; p < pages.length; p++){
        if (pages[p].some((member) => targetPath === member || targetPath.startsWith(`${member}/`))) return p;
    }
    return null;
}

export type PagedLevel = { nodes: MapNode[]; edges: MapEdge[]; hiddenCount: number; page: number; pageCount: number };

/**
 * One level's boxes and lines, paged when the folder is too big to draw at once (API_CONTRACTS.md §11). A folder of
 * up to MAP_BOX_CAP children is one page drawn as it is. A bigger one is split by assignPages, and the page drawn is
 * the one holding `focus` when it's on this level, otherwise `page`, a page past the last being the last.
 * `hiddenCount` counts the boxes on the other pages.
 */
export function paginateLevel(
    levelPath: string,
    children: readonly MapNode[],
    edges: readonly MapEdge[],
    options: { page?: number; focus?: string },
): PagedLevel {
    const pages = children.length <= MAP_BOX_CAP ? [children.map((child) => child.path)] : assignPages(children, edges);
    const focused = options.focus === undefined ? null : pageOf(pages, options.focus);
    const page = focused ?? Math.min(Math.max(0, Math.floor(options.page ?? 0)), pages.length - 1);
    const view = buildPageView(levelPath, children, edges, pages, page);
    return { ...view, hiddenCount: children.length - pages[page].length, page, pageCount: pages.length };
}
