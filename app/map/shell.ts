/**
 * The Map's layout at any window size (the Workbench redesign, ADR-070; the owner's picks of 2026-10-27). Around the
 * canvas sit the header, the explorer (the browser only), the toolbar, the legend sentence, the inspector and the
 * status bar. As the window narrows or shortens each gives way in a fixed order, so nothing is cut off, nothing sits on
 * anything else, and the page never scrolls sideways (the owner: "nothing should break at any size"). Only the canvas
 * pans. Pure, so every rule is tested on its own; MapView reads it from the window's size.
 *
 * Widths (collapse option C):
 * - the explorer is full from 1180 px, a 40 px rail from 600, and gone under 600 (search and the breadcrumb still reach
 *   every folder); VS Code's panel has none;
 * - the inspector stays beside the canvas while 560 px of canvas is left. With less it moves under the canvas in a window
 *   at least 640 px tall, so the selected box and its details are both in view; in a shorter one it opens over the
 *   canvas as a drawer, and where the window is narrow too it covers the canvas, the selected box keeping its Open and
 *   Details beside it (narrow.ts's actionsPlace).
 * Heights:
 * - the legend sentence goes under 560 px tall (the ? help still has it), and under a 420 px canvas or a drawer;
 * - the toolbar folds into the header under 420 px tall, one bar instead of two;
 * - the status bar's two dots move to the end of that bar under 300 px tall, and the status bar goes;
 * - the canvas keeps at least 160 px; below that the page scrolls down, never sideways.
 */

/** Where the inspector goes: beside the canvas, under it, over it as a drawer, over all of it, or nowhere. */
export type InspectorPlace = "beside" | "below" | "drawer" | "cover" | "none";

export type Shell = {
    explorer: "full" | "rail" | "none";
    inspector: InspectorPlace;
    /** The toolbar's controls sit in the header's row instead of a row of their own. */
    toolbarInHeader: boolean;
    /** The status bar, or its two dots at the end of the header's row, or (VS Code's panel, as the owner picked) its slim form. */
    status: "bar" | "inHeader";
    legend: boolean;
    /** The canvas's width, which the toolbar's steps go by. */
    canvasWidth: number;
    /** The least height the page keeps: the canvas's floor plus what's above and below it. Below it the page scrolls down. */
    minHeight: number;
};

export const EXPLORER_WIDTH = 236;
export const RAIL_WIDTH = 40;
export const INSPECTOR_WIDTH = 300;
/** The least canvas worth keeping beside the inspector. */
export const MIN_CANVAS_BESIDE = 560;
/** The explorer is full from this width, a rail from NARROW, and gone below. */
export const EXPLORER_FULL = 1180;
export const NARROW = 600;
/** A window at least this tall takes the inspector under the canvas rather than over it. */
export const BELOW_MIN_HEIGHT = 640;
/** The inspector under the canvas takes this share of the height. */
export const BELOW_SHARE = 0.42;
export const LEGEND_MIN_HEIGHT = 560;
export const LEGEND_MIN_CANVAS = 420;
export const TOOLBAR_FOLD_HEIGHT = 420;
export const STATUS_FOLD_HEIGHT = 300;
/** The least canvas, in px tall: below it the page scrolls down instead. */
export const MIN_CANVAS_HEIGHT = 160;

/** The bars' heights, in px. */
export const HEADER_HEIGHT = 42;
export const EMBEDDED_HEADER_HEIGHT = 38;
export const TOOLBAR_HEIGHT = 36;
export const STATUS_HEIGHT = 24;
export const LEGEND_HEIGHT = 44;

/**
 * The layout for a window `width` × `height` px. `embedded` is VS Code's panel (no explorer, the slim status bar);
 * `selected` says whether anything is selected: beside the canvas the inspector describes the folder on screen when
 * nothing is, and in the other places it shows only for a selection.
 */
export function shellLayout({ width, height, embedded, selected }: { width: number; height: number; embedded: boolean; selected: boolean }): Shell {
    const explorer = embedded ? "none" : width >= EXPLORER_FULL ? "full" : width >= NARROW ? "rail" : "none";
    const explorerWidth = explorer === "full" ? EXPLORER_WIDTH : explorer === "rail" ? RAIL_WIDTH : 0;
    const besideRoom = width - explorerWidth - INSPECTOR_WIDTH;
    const room: InspectorPlace = besideRoom >= MIN_CANVAS_BESIDE ? "beside"
        : height >= BELOW_MIN_HEIGHT ? "below"
        : width >= NARROW ? "drawer"
        : "cover";
    const inspector: InspectorPlace = room === "beside" || selected ? room : "none";
    const canvasWidth = width - explorerWidth - (inspector === "beside" ? INSPECTOR_WIDTH : 0);
    const toolbarInHeader = height < TOOLBAR_FOLD_HEIGHT;
    const status = height < STATUS_FOLD_HEIGHT ? "inHeader" : "bar";
    const legend = height >= LEGEND_MIN_HEIGHT && canvasWidth >= LEGEND_MIN_CANVAS && inspector !== "drawer" && inspector !== "cover";

    // what sits above and below the canvas, and the inspector under it, which takes its share of the page's height
    const chrome = (embedded ? EMBEDDED_HEADER_HEIGHT : HEADER_HEIGHT) + (toolbarInHeader ? 0 : TOOLBAR_HEIGHT)
        + (status === "bar" ? STATUS_HEIGHT : 0) + (legend ? LEGEND_HEIGHT : 0);
    const minHeight = inspector === "below"
        ? Math.ceil((chrome + MIN_CANVAS_HEIGHT) / (1 - BELOW_SHARE))
        : chrome + MIN_CANVAS_HEIGHT;
    return { explorer, inspector, toolbarInHeader, status, legend, canvasWidth, minHeight };
}
