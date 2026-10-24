/**
 * The Map at any window size (VISUAL_REFRESH.md, "Narrow windows (2026-10-24)"). At 1100 × 700 and up nothing here
 * changes how the Map looks. Narrower, each surface gives up secondary text first; below the floor the Map stops
 * shrinking and the page scrolls instead, with the theme's thin scrollbars. Pure, so each rule is tested on its own.
 */

/**
 * The floor: the smallest the Map lays itself out at. Narrower or shorter, the page scrolls sideways or down.
 * 360 px wide holds the top bar's essentials (logo, repo, search, help, status dot) and a canvas as wide as the floor
 * beside nothing. 320 px tall leaves a 200 px canvas under the bars (48 + 40 + 32 px), the least that stacks a paged
 * level's pill (16 + 44 px from the top) over the zoom controls (104 px, 15 px from the bottom) without them touching.
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
 * The panel's width in a Map area `mainWidth` px wide, and whether it covers the canvas. `null`, before the area is
 * measured, is the normal case: 400 px beside the canvas.
 */
export function panelLayout(mainWidth: number | null): { width: number; covers: boolean } {
    if (mainWidth === null || mainWidth - PANEL_WIDTH >= MIN_CANVAS_BESIDE_PANEL) return { width: PANEL_WIDTH, covers: false };
    return { width: mainWidth, covers: true };
}

/**
 * How much the page pill says, by the canvas width it sits in (`null`: not measured yet, the normal case):
 * "Page 2 of 5 · 44 of 182 folders and files" (about 370 px at most, plus 16 px each side), "Page 2 of 5", or "2 / 5".
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
