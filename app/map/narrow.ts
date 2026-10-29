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

/** A rectangle on the canvas, in canvas px. */
export type CanvasRect = { left: number; top: number; width: number; height: number };

/**
 * How far the hover card keeps from the pointer's tip (the owner, 2026-10-29). The pointer's arrow, or its hand over a
 * line, hangs below and right of the tip, so a card below it keeps CARD_BELOW down and one right of it under the tip
 * CARD_RIGHT over, past it. Above the tip, and left of it, nothing of the pointer is there, so CARD_GAP is enough.
 */
const CARD_GAP = 8;
const CARD_RIGHT = 12;
const CARD_BELOW = 20;
/** The least room the card keeps from the canvas's sides, and from the line it's about. */
export const CARD_EDGE = 8;
const CARD_LINE_GAP = 4;
/**
 * The bit of line right at the pointer, each way from its tip, which the card covers in no window it fits: under
 * CARD_GAP, and as wide as the heaviest line is drawn.
 */
const CARD_SPOT = 6;

const overlaps = (a: CanvasRect, b: CanvasRect): boolean =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Where the hover card about the lines under the pointer goes (its top-left corner, canvas px). It's tried above and
 * left of the pointer (the owner's pick of 2026-10-29, the closest to the tip, and the card clear of the box a line
 * runs down into), then above and right, below and left, below and right. The first place that's inside the canvas,
 * CARD_EDGE in from its sides, and
 * clear of `line` (the bit of line pointed at, as rectangles as wide as it's drawn) and of `clear` (what's over the
 * canvas: a drawer, a box's actions, the banner) wins. A place over the line is slid off it first, sideways off an
 * upright run and down or up off a level one, since the pointer can be a few px beside the line it's on. Where no place
 * fits, the first that fits once moved inside the canvas and is still clear of the line and the rest; in a canvas too
 * small for that, the first moved inside that keeps off the line right at the pointer (CARD_SPOT), and failing that the
 * first, moved inside: the card never leaves the canvas.
 */
export function hoverCardPlace(
    pointer: { x: number; y: number },
    card: { width: number; height: number },
    canvas: { width: number; height: number },
    line: readonly CanvasRect[],
    clear: readonly CanvasRect[],
): { left: number; top: number } {
    const { width, height } = card;
    const tries = [
        { right: false, below: false, left: pointer.x - CARD_GAP - width, top: pointer.y - CARD_GAP - height },
        { right: true, below: false, left: pointer.x + CARD_GAP, top: pointer.y - CARD_GAP - height },
        { right: false, below: true, left: pointer.x - CARD_GAP - width, top: pointer.y + CARD_GAP },
        { right: true, below: true, left: pointer.x + CARD_RIGHT, top: pointer.y + CARD_BELOW },
    ];
    const slid = tries.map((t) => {
        let at = { left: t.left, top: t.top };
        // a slide a rectangle at most: each moves the card on, away from the pointer, so none loops back
        for (let pass = 0; pass < line.length; pass++){
            const hit = line.find((r) => overlaps({ ...at, width, height }, r));
            if (hit === undefined) break;
            at = hit.height >= hit.width
                ? { ...at, left: t.right ? hit.left + hit.width + CARD_LINE_GAP : hit.left - CARD_LINE_GAP - width }
                : { ...at, top: t.below ? hit.top + hit.height + CARD_LINE_GAP : hit.top - CARD_LINE_GAP - height };
        }
        return at;
    });
    const inside = (at: { left: number; top: number }): boolean =>
        at.left >= CARD_EDGE && at.top >= CARD_EDGE && at.left + width <= canvas.width - CARD_EDGE && at.top + height <= canvas.height - CARD_EDGE;
    const free = (at: { left: number; top: number }): boolean => [...line, ...clear].every((r) => !overlaps({ ...at, width, height }, r));
    const spot = { left: pointer.x - CARD_SPOT, top: pointer.y - CARD_SPOT, width: 2 * CARD_SPOT, height: 2 * CARD_SPOT };
    const offSpot = (at: { left: number; top: number }): boolean => !overlaps({ ...at, width, height }, spot) && clear.every((r) => !overlaps({ ...at, width, height }, r));
    const moveIn = (at: { left: number; top: number }) => ({
        left: Math.max(CARD_EDGE, Math.min(at.left, canvas.width - CARD_EDGE - width)),
        top: Math.max(CARD_EDGE, Math.min(at.top, canvas.height - CARD_EDGE - height)),
    });
    const movedIn = slid.map(moveIn);
    return slid.find((at) => inside(at) && free(at)) ?? movedIn.find(free) ?? movedIn.find(offSpot) ?? movedIn[0];
}

/**
 * The height the hover card has for itself in a canvas `canvasHeight` tall with the pointer at `pointerY`: the room
 * under the pointer or over it, whichever is more, inside the canvas's edges, so a card that fits it keeps off the
 * pointer (hoverCardPlace) in any window.
 */
export function hoverCardRoom(pointerY: number, canvasHeight: number): number {
    return Math.max(canvasHeight - CARD_EDGE - pointerY - CARD_BELOW, pointerY - CARD_GAP - CARD_EDGE);
}

/** The most lines the hover card lists before "and N more" (the owner, 2026-10-29), and each row's height (leading-[18px]). */
export const CARD_ROWS = 5;
export const CARD_ROW = 18;
/** The card's border and padding, top and bottom together (border and py-1). */
export const CARD_FRAME = 10;

/**
 * How many of a run's `total` lines the hover card lists in `room` px of height: CARD_ROWS, or all of them where one
 * more would only replace the "and 1 more" row, but no more than fit under the title with the "and N more" row.
 */
export function hoverCardRows(total: number, room: number): number {
    let rows = total <= CARD_ROWS + 1 ? total : CARD_ROWS;
    while (rows > 0 && CARD_FRAME + CARD_ROW * (1 + rows + (rows < total ? 1 : 0)) > room) rows--;
    return rows;
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
