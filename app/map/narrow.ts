/**
 * The Map's small placements at any window size (VISUAL_REFRESH.md, "Narrow windows"): a selected box's actions, a
 * folded breadcrumb, a popover kept inside the window, and the error line's form. The layout itself, what gives way as
 * the window narrows or shortens, is shell.ts's (the Workbench redesign, ADR-070). Pure, so each rule is tested alone.
 */

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
 * The Map's error line (a failed jump, a level that wouldn't load), over the canvas: 24 px down, centred, and where
 * that can't hold it in two lines, a solid card in the canvas's top-left corner. Over an inspector that covers the
 * canvas it's the inspector's own last row (DetailPanel). It never takes a click.
 */

/** The card's inset from the canvas's edges. */
const CARD_INSET = 16;
/** The line's distance from the canvas's top (top-6), and how tall it may grow before it becomes the card. */
export const BANNER_TOP = 24;
const BANNER_BAND = 64;

export type BannerForm = "band" | "card";

/**
 * Which form the banner takes, by the height it has as a line (`null`: not measured yet, the normal case): the line
 * while it ends inside the canvas's top 64 px (two lines), else the card.
 */
export function bannerForm(bandHeight: number | null): BannerForm {
    return bandHeight === null || BANNER_TOP + bandHeight <= BANNER_BAND ? "band" : "card";
}

/** How far the card keeps from the canvas's sides, together: its inset on the left and as much on the right. */
export const CARD_CLEAR = 2 * CARD_INSET;
