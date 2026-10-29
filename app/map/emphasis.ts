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
 * How a line is drawn: the selection's in purple or gold (lineLook), the hovered box's brighter, the rest quieter while
 * something is selected. On a busy level the rest aren't drawn at all ("hidden").
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

/**
 * Each line's color and layer by its tone (the Workbench redesign, ADR-070), its width going by its imports whatever the
 * tone: the selection's lines out (what it uses) in the logo's spoke color and its lines in (what uses it) in gold, so a
 * glance tells the two apart (the owner, 2026-10-28, gold since 2026-10-29), the hovered box's a step brighter in both directions, and the rest
 * quiet, so the boxes lead and a dense level reads as structure until you point at a box (the owner, 2026-10-27: src/vs
 * was "so messy and unreadable" with every line in the bright gray). Its arrowhead is the line's own color. A higher
 * layer is drawn later, over the quieter lines it crosses or shares a run with.
 */
export function lineLook(tone: Exclude<EdgeTone, "hidden">, edge: Pick<MapEdge, "source" | "target">, selected: string | null): { color: string; layer: number } {
    if (tone === "selected") return { color: edge.target === selected ? "var(--used-by-edge)" : "var(--edge-strong)", layer: 2 };
    if (tone === "preview") return { color: "var(--text-2)", layer: 1 };
    return { color: "var(--edge-dim)", layer: 0 };
}

/** One line's id, the same one React Flow gets. */
export const edgeKey = (edge: Pick<MapEdge, "source" | "target">): string => `${edge.source}->${edge.target}`;

/**
 * Which of the selected box's lines are coloured (the owner, 2026-10-29): all of them, only its lines out to what it
 * uses ("uses"), or only its lines in from what uses it ("usedBy"), in the inspector's own words. There's no choice of
 * none. The other side isn't hidden but drawn gray like the rest of the page ("not completely gone"), so every line of
 * the selection stays drawn whichever is picked, and picking moves no line and no count.
 */
export type LineDirection = "all" | "uses" | "usedBy";

/** Whether `edge` is one of `box`'s lines on the side `direction` colours. */
const onSide = (edge: Pick<MapEdge, "source" | "target">, box: string, direction: LineDirection): boolean =>
    direction === "uses" ? edge.source === box
    : direction === "usedBy" ? edge.target === box
    : edge.source === box || edge.target === box;

/** The selected box's lines that `direction` colours, in the level's order: the explorer lights the boxes at their ends. */
export function selectionLines(edges: readonly MapEdge[], selected: string | null, direction: LineDirection): MapEdge[] {
    return selected === null ? [] : edges.filter((edge) => onSide(edge, selected, direction));
}

/**
 * The sides of `selected` with no line to another box on the page, which can't be picked: they'd colour nothing (src
 * on VS Code's top page uses nothing there). None with nothing selected.
 */
export function sidesWithoutLines(edges: readonly MapEdge[], selected: string | null): LineDirection[] {
    if (selected === null) return [];
    const out = edges.some((e) => e.source === selected && e.target !== selected);
    const into = edges.some((e) => e.target === selected && e.source !== selected);
    return [...(out ? [] : ["uses" as const]), ...(into ? [] : ["usedBy" as const])];
}

/** The boxes joined to `box` by a line on the side `direction` colours (by default either). */
function neighbours(edges: readonly MapEdge[], box: string | null, direction: LineDirection = "all"): Set<string> {
    const found = new Set<string>();
    if (box === null) return found;
    for (const edge of edges){
        if (!onSide(edge, box, direction)) continue;
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
 * `pinned` box (Claude Code's or the editor's highlights), whose lines always show. A `direction` other than "all"
 * colours only that side of the selection's lines: the other side is toned as a line of the rest would be, faded or the
 * hover's, but never hidden, and a box joined to the selection only by it fades.
 */
export function mapEmphasis(
    boxes: readonly string[],
    edges: readonly MapEdge[],
    selected: string | null,
    hovered: string | null,
    options: { quietLines?: boolean; strongOnly?: boolean; pinned?: ReadonlySet<string>; direction?: LineDirection } = {},
): { boxes: Map<string, BoxTone>; edges: Map<string, EdgeTone> } {
    const onLevel = new Set(boxes);
    const chosen = selected !== null && onLevel.has(selected) ? selected : null;
    const pointed = hovered !== null && onLevel.has(hovered) && hovered !== chosen ? hovered : null;
    const direction = options.direction ?? "all";
    const linked = neighbours(edges, chosen, direction);
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
        if (chosen !== null && onSide(edge, chosen, direction)) edgeTones.set(edgeKey(edge), "selected");
        // the side not picked stays drawn, whatever hides the rest, so picking a side never makes a line appear or go
        else if (touches(chosen)) edgeTones.set(edgeKey(edge), touches(pointed) ? "preview" : "faded");
        else if (touches(pointed)) edgeTones.set(edgeKey(edge), "preview");
        else if (options.quietLines && !lit) edgeTones.set(edgeKey(edge), "hidden");
        else if (options.strongOnly && edge.count < threshold && !lit) edgeTones.set(edgeKey(edge), "hidden");
        else edgeTones.set(edgeKey(edge), chosen === null ? "normal" : "faded");
    }

    return { boxes: boxTones, edges: edgeTones };
}
