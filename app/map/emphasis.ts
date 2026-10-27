import type { MapEdge } from "@/lib/contracts";

/**
 * How a box is drawn (VISUAL_REFRESH.md §4):
 * - selected: purple fill and border;
 * - linked: joined to the selection by a line, drawn plainly;
 * - preview: the hovered box or one joined to it, its border brighter;
 * - faded: unrelated while something is selected, at about 60% opacity.
 */
export type BoxTone = "normal" | "selected" | "linked" | "preview" | "faded";

/**
 * How a line is drawn: the selection's in purple, the hovered box's brighter, the rest quieter while something is
 * selected. On a busy level the rest aren't drawn at all ("hidden").
 */
export type EdgeTone = "normal" | "selected" | "preview" | "faded" | "hidden";

/**
 * A level with more lines than this is busy: it draws only the lines of the box under the pointer or selected, unless
 * the user asks for all of them (owner, 2026-10-12). On VS Code, 50 of 3,793 levels are busy; src/vs/platform's first
 * page has 441 lines, which nobody can follow at once.
 */
export const BUSY_LINES = 60;

export const isBusyLevel = (lineCount: number): boolean => lineCount > BUSY_LINES;

/**
 * "Strong links only" (the Workbench redesign, ADR-070, on unless turned off): a line is strong when it carries at least
 * STRONG_SHARE of the imports of the page's heaviest line. The weaker ones stay hidden unless they touch the selection,
 * the hovered box, or a box Claude Code or the editor has lit. There's no floor of 3 imports, as the spec had: in a
 * folder of files every line is 1 or 2 imports, and the floor hid them all (the owner's pick, 2026-10-27). So a page
 * whose heaviest line carries under 50 imports hides nothing.
 */
export const STRONG_SHARE = 0.02;

/** The fewest imports a strong line carries on a page whose heaviest line carries `maxImports`. */
export const strongThreshold = (maxImports: number): number => STRONG_SHARE * maxImports;

/** How many lines Strong links only hides on this page with `selected` selected and `pinned` lit, before any hover. */
export function weakLinesHidden(edges: readonly MapEdge[], selected: string | null, pinned: ReadonlySet<string> = new Set()): number {
    const threshold = strongThreshold(Math.max(0, ...edges.map((e) => e.count)));
    const touches = (edge: MapEdge, box: string): boolean => edge.source === box || edge.target === box;
    return edges.filter((e) => e.source !== e.target && e.count < threshold
        && !(selected !== null && touches(e, selected)) && !pinned.has(e.source) && !pinned.has(e.target)).length;
}

/** One line's id, the same one React Flow gets. */
export const edgeKey = (edge: Pick<MapEdge, "source" | "target">): string => `${edge.source}->${edge.target}`;

/** The boxes joined to `box` by a line, in either direction. */
function neighbours(edges: readonly MapEdge[], box: string | null): Set<string> {
    const found = new Set<string>();
    if (box === null) return found;
    for (const edge of edges){
        if (edge.source === box) found.add(edge.target);
        else if (edge.target === box) found.add(edge.source);
    }
    return found;
}

/**
 * What to emphasize on a level, given what's selected and what's under the pointer. Pure, so the rules are tested
 * apart from React Flow. The selection always wins over the hover: a box linked to the selection stays linked when a
 * hovered box also touches it. A selection or hover that isn't one of this level's boxes counts as none. With
 * `quietLines` (a busy level), only the selection's and the hovered box's lines are drawn; the boxes are toned as usual.
 * With `strongOnly`, a weak line (strongThreshold) is hidden too, unless it touches the selection, the hovered box or a
 * `pinned` box (Claude Code's or the editor's highlights), whose lines always show.
 */
export function mapEmphasis(
    boxes: readonly string[],
    edges: readonly MapEdge[],
    selected: string | null,
    hovered: string | null,
    options: { quietLines?: boolean; strongOnly?: boolean; pinned?: ReadonlySet<string> } = {},
): { boxes: Map<string, BoxTone>; edges: Map<string, EdgeTone> } {
    const onLevel = new Set(boxes);
    const chosen = selected !== null && onLevel.has(selected) ? selected : null;
    const pointed = hovered !== null && onLevel.has(hovered) && hovered !== chosen ? hovered : null;
    const linked = neighbours(edges, chosen);
    const previewed = neighbours(edges, pointed);

    const boxTones = new Map<string, BoxTone>();
    for (const box of boxes){
        if (box === chosen) boxTones.set(box, "selected");
        else if (linked.has(box)) boxTones.set(box, "linked");
        else if (box === pointed || previewed.has(box)) boxTones.set(box, "preview");
        else boxTones.set(box, chosen === null ? "normal" : "faded");
    }

    const threshold = strongThreshold(Math.max(0, ...edges.map((e) => e.count)));
    const pinned = options.pinned ?? new Set<string>();
    const edgeTones = new Map<string, EdgeTone>();
    for (const edge of edges){
        const touches = (box: string | null): boolean => box !== null && (edge.source === box || edge.target === box);
        const lit = pinned.has(edge.source) || pinned.has(edge.target);
        if (touches(chosen)) edgeTones.set(edgeKey(edge), "selected");
        else if (touches(pointed)) edgeTones.set(edgeKey(edge), "preview");
        else if (options.quietLines && !lit) edgeTones.set(edgeKey(edge), "hidden");
        else if (options.strongOnly && edge.count < threshold && !lit) edgeTones.set(edgeKey(edge), "hidden");
        else edgeTones.set(edgeKey(edge), chosen === null ? "normal" : "faded");
    }

    return { boxes: boxTones, edges: edgeTones };
}
