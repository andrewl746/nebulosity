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
 */
export function mapEmphasis(
    boxes: readonly string[],
    edges: readonly MapEdge[],
    selected: string | null,
    hovered: string | null,
    options: { quietLines?: boolean } = {},
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

    const edgeTones = new Map<string, EdgeTone>();
    for (const edge of edges){
        const touches = (box: string | null): boolean => box !== null && (edge.source === box || edge.target === box);
        if (touches(chosen)) edgeTones.set(edgeKey(edge), "selected");
        else if (touches(pointed)) edgeTones.set(edgeKey(edge), "preview");
        else if (options.quietLines) edgeTones.set(edgeKey(edge), "hidden");
        else edgeTones.set(edgeKey(edge), chosen === null ? "normal" : "faded");
    }

    return { boxes: boxTones, edges: edgeTones };
}
