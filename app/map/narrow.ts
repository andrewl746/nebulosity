/**
 * The Map at any window size (VISUAL_REFRESH.md, "Narrow windows (2026-10-24)"). At 1100 × 700 and up nothing here
 * changes how the Map looks. Narrower, each surface gives up secondary text first; below the floor the Map stops
 * shrinking and the page scrolls instead, with the theme's thin scrollbars. Pure, so each rule is tested on its own.
 */

import { TOP_INSET } from "./viewport";

/**
 * The floor: the smallest the Map lays itself out at. Narrower or shorter, the page scrolls sideways or down.
 * 360 px wide holds the top bar's essentials (logo, repo, search, help, status dot) and a canvas as wide as the floor
 * beside nothing. 320 px tall leaves a 200 px canvas under the bars (48 + 40 + 32 px), which stacks a paged level's
 * pill (16 + 44 px from the top) over the zoom controls (104 px, 15 px from the bottom) with about 20 px between them.
 */
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 320;

/** The details panel's width, when there's room beside it (VISUAL_REFRESH.md §5). */
export const PANEL_WIDTH = 400;
/**
 * The least canvas worth keeping beside the panel: the floor's own width. With less left, the panel covers the whole
 * canvas (its × closes it), since a sliver of Map beside it can't be read or used.
 */
export const MIN_CANVAS_BESIDE_PANEL = MIN_WIDTH;

/**
 * Whether the panel covers the whole canvas in a Map area `mainWidth` px wide; beside it, it's PANEL_WIDTH wide.
 * `null`, before the area is measured, is the normal case: beside the canvas.
 */
export function panelLayout(mainWidth: number | null): { covers: boolean } {
    return { covers: mainWidth !== null && mainWidth - PANEL_WIDTH < MIN_CANVAS_BESIDE_PANEL };
}

/**
 * Where a selected box's actions go while the panel would cover the canvas (owner review, 2026-10-25). A click then only
 * selects, so a double click still reaches the box and the Map stays in sight, and the box shows Open and Details beside
 * it. They go under a box whose middle is in the canvas's top half, clear of the page pill's band, and over one lower
 * down, clear of the legend and the zoom controls. `boxTop` and `boxHeight` are the box's on screen, in canvas px.
 */
export function actionsSide(boxTop: number, boxHeight: number, canvasHeight: number): "top" | "bottom" {
    return boxTop + boxHeight / 2 < canvasHeight / 2 ? "bottom" : "top";
}

/** The gap between a box and its actions, and the least room they keep from the canvas's sides. */
const ACTIONS_GAP = 8;

/**
 * Where the selected box's actions go on the canvas (their top-left corner, canvas px), given the box and the actions'
 * size on screen: on actionsSide's side, 8 px off the box, centred on it, but kept 8 px inside the canvas's sides, so a
 * box hanging off an edge (a level opened from its top at 75%) never takes them past it. Each axis is its own rule.
 */
export function actionsPlace(
    box: { left: number; top: number; width: number; height: number },
    actions: { width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
): { left: number; top: number } {
    const top = actionsSide(box.top, box.height, canvasHeight) === "bottom" ? box.top + box.height + ACTIONS_GAP : box.top - ACTIONS_GAP - actions.height;
    const centred = box.left + box.width / 2 - actions.width / 2;
    const left = Math.min(Math.max(centred, ACTIONS_GAP), canvasWidth - ACTIONS_GAP - actions.width);
    return { left, top };
}

/**
 * How much the page pill says, by the canvas width it sits in (`null`: not measured yet, the normal case):
 * "Page 2 of 5 · 44 of 182 folders and files", "Page 2 of 5", or "2 / 5". The whole note is about 350 px, 370 at
 * most with four-digit counts; with its 16 px inset on the right and as much again on its left that's about 400 px,
 * and 440 leaves room for a wider font.
 */
export type PillForm = "full" | "page" | "numbers";
const FULL_PILL_ROOM = 440;
const PAGE_PILL_ROOM = 240;

export function pillForm(room: number | null): PillForm {
    if (room === null || room >= FULL_PILL_ROOM) return "full";
    return room >= PAGE_PILL_ROOM ? "page" : "numbers";
}

/**
 * The first breadcrumb step to show so the trail fits in `available` px: the steps before it fold into one "…" step
 * (`ellipsis` px), so the trail truncates from its start and the current folder stays. `widths` are the steps' natural
 * widths, `gap` the space between steps. The last step always shows, and truncates itself if it alone is too wide.
 */
export function trailStart(widths: readonly number[], available: number, ellipsis: number, gap: number): number {
    const last = widths.length - 1;
    if (last <= 0) return 0;
    let needed = widths.reduce((sum, w) => sum + w, 0) + gap * last;
    if (needed <= available) return 0;
    // drop steps from the start, one at a time; the "…" stands in for all of them
    needed += ellipsis + gap;
    for (let start = 1; start < last; start++){
        needed -= widths[start - 1] + gap;
        if (needed <= available) return start;
    }
    return last;
}

/** The space a popover keeps from the Map's edges. */
const POPOVER_GUTTER = 16;

/**
 * A popover (the repo list, the status menu) placed to stay inside the Map: aligned with its anchor's start or end
 * edge as at normal sizes, moved in only as far as it takes to keep 16 px from the Map's edges, and narrowed only when
 * the Map is narrower than the popover and both margins. `shift` is how far it moved from that alignment (px, + is
 * right): a start-aligned popover's `left`, an end-aligned one's `right` negated.
 */
export function fitPopover(
    anchor: { left: number; right: number },
    container: { left: number; right: number },
    width: number,
    align: "start" | "end",
): { shift: number; width: number } {
    const fitted = Math.min(width, container.right - container.left - 2 * POPOVER_GUTTER);
    const natural = align === "start" ? anchor.left : anchor.right - fitted;
    const left = Math.min(Math.max(natural, container.left + POPOVER_GUTTER), container.right - POPOVER_GUTTER - fitted);
    return { shift: left - natural, width: fitted };
}

/*
 * The Map's error line (a failed jump, a level that wouldn't load), over the canvas beside the panel. Its place at
 * normal sizes is the one it always had: 24 px down, in the page pill's band, centred, now over the canvas you can
 * see rather than under an open panel, and keeping clear of the pill. Where that band can't hold it, it's a solid card
 * in the canvas's top-left corner instead, clear of the pill and the zoom controls. Over a panel that covers the
 * canvas it's the panel's own last row (DetailPanel). It never takes a click.
 */

/** The overlays' inset from the canvas's edges (the pill's right-4, the legend's left-4 and bottom-4). */
const OVERLAY_INSET = 16;
/** The gap the banner keeps from the pill and the legend. */
const OVERLAY_GAP = 8;
/** React Flow's zoom controls: 26 px wide, 15 px in from the canvas's right edge. */
const ZOOM_COLUMN = 15 + 26;
/** The banner's distance from the canvas's top: as a line in the pill's band (top-6), and as a card (top-4). */
export const BANNER_TOP = 24;
export const CARD_TOP = OVERLAY_INSET;

export type BannerForm = "band" | "card";

/**
 * Which form the banner takes, by the height it has as a line in the band (`null`: not measured yet, the normal case):
 * the band while it ends inside the pill's 64 px band, where a paged level's boxes don't open (two lines), else the card.
 */
export function bannerForm(bandHeight: number | null): BannerForm {
    return bandHeight === null || BANNER_TOP + bandHeight <= TOP_INSET ? "band" : "card";
}

/**
 * The room the line keeps on its right for the pill, past the band's own 16 px padding: the pill's width and a gap,
 * and as much on its left, so it stays centred over the canvas while it can (`null`: no pill, or not measured yet).
 */
export function bandClear(pillWidth: number | null): number {
    return pillWidth === null ? 0 : pillWidth + OVERLAY_GAP;
}

/** How far the card's right edge keeps from the canvas's right edge: past the pill, and always past the zoom controls. */
export function cardClear(pillWidth: number | null): number {
    return Math.max(ZOOM_COLUMN + OVERLAY_GAP, pillWidth === null ? 0 : OVERLAY_INSET + pillWidth + OVERLAY_GAP);
}

/**
 * The open legend's greatest height on a canvas `canvasHeight` px tall (`0`: not measured yet, then no cap). It sits
 * 16 px from the bottom and stops short of what's above it: 16 px from the top, a paged level's pill band, or the
 * banner's bottom (`bannerBottom`, 0 with none) and a gap. Its rows scroll inside.
 */
export function legendMaxHeight(canvasHeight: number, pillBand: number, bannerBottom: number): number | undefined {
    if (canvasHeight <= 0) return undefined;
    return canvasHeight - OVERLAY_INSET - Math.max(OVERLAY_INSET, pillBand, bannerBottom > 0 ? bannerBottom + OVERLAY_GAP : 0);
}
