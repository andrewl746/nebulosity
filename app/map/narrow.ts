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

/** The least room the card keeps from the canvas's sides. */
export const CARD_EDGE = 8;
/**
 * The tail a card points at its line with, a comic's speech bubble's (the owner, 2026-10-29): this wide at its base and
 * this long, one size whatever the line, its tip TAIL_GAP short of the line's edge, its middle TAIL_INSET along the
 * card's side from the corner nearest the line, so the card keeps the same distance from the spot it's about.
 */
export const TAIL_BASE = 12;
export const TAIL_LENGTH = 7;
const TAIL_GAP = 1;
const TAIL_INSET = 16;
/**
 * The bit of line right at the spot, each way from it, which the card covers in no window it fits, as wide as the
 * heaviest line is drawn.
 */
const CARD_SPOT = 6;

/** Which side of the card its tail comes out of. */
export type TailSide = "top" | "bottom" | "left" | "right";
/**
 * A card's place (its top-left corner, canvas px), and its tail: the side it comes out of and how far along that side
 * its middle is, from the card's left or top. No tail where the card couldn't keep its distance from the spot.
 * `rises` says the card runs up from its tail, so a pinned card grows up from it.
 */
export type BubblePlace = { left: number; top: number; tail: { side: TailSide; at: number } | null; rises: boolean };

const overlaps = (a: CanvasRect, b: CanvasRect): boolean =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** How far the card's side keeps from the middle of a line `half` px wide each side, its tail between them. */
const tailReach = (half: number): number => half + TAIL_GAP + TAIL_LENGTH;

/**
 * Where the card about the lines under the pointer goes, pointing at `spot`, the point of the line nearest the pointer
 * (canvas px), with its tail across the line, never along it. Beside a line that runs up and down there (`upright`),
 * the tail comes out of the card's side, and over or under a level one out of its bottom or top, so the card never
 * lies on the line it's about. `half` is half the line's width on screen. The places are tried above and left first
 * (the owner's pick of 2026-10-29, closest to the pointer's tip, where nothing of the pointer is, and clear of the box
 * a line runs down into): left of an upright line rising from the tail, then right of it, then left and right going
 * down; over a level line reaching left from the tail, then right, then under it. The first inside the canvas,
 * CARD_EDGE in from its sides, and clear of `line` (the bit of line pointed at and its arrowhead, as rectangles as wide
 * as they're drawn) and of `clear` (what's over the canvas: a drawer, a box's actions, the banner) wins, then the first
 * inside and clear of the rest that keeps off the line right at the spot. Where none fits, the first moved inside the
 * canvas that's clear, then the first moved inside that keeps off the spot, then just over or under the spot (a canvas
 * too narrow for the card beside an upright line), then the first moved inside: the card never leaves the canvas, and
 * moved, it can't keep its tail.
 */
export function bubblePlace(
    spot: { x: number; y: number },
    upright: boolean,
    half: number,
    card: { width: number; height: number },
    canvas: { width: number; height: number },
    line: readonly CanvasRect[],
    clear: readonly CanvasRect[],
): BubblePlace {
    const { width, height } = card;
    const reach = tailReach(half);
    const tries: BubblePlace[] = upright ? [
        { left: spot.x - reach - width, top: spot.y + TAIL_INSET - height, tail: { side: "right", at: height - TAIL_INSET }, rises: true },
        { left: spot.x + reach, top: spot.y + TAIL_INSET - height, tail: { side: "left", at: height - TAIL_INSET }, rises: true },
        { left: spot.x - reach - width, top: spot.y - TAIL_INSET, tail: { side: "right", at: TAIL_INSET }, rises: false },
        { left: spot.x + reach, top: spot.y - TAIL_INSET, tail: { side: "left", at: TAIL_INSET }, rises: false },
    ] : [
        { left: spot.x + TAIL_INSET - width, top: spot.y - reach - height, tail: { side: "bottom", at: width - TAIL_INSET }, rises: true },
        { left: spot.x - TAIL_INSET, top: spot.y - reach - height, tail: { side: "bottom", at: TAIL_INSET }, rises: true },
        { left: spot.x + TAIL_INSET - width, top: spot.y + reach, tail: { side: "top", at: width - TAIL_INSET }, rises: false },
        { left: spot.x - TAIL_INSET, top: spot.y + reach, tail: { side: "top", at: TAIL_INSET }, rises: false },
    ];
    const box = (at: { left: number; top: number }): CanvasRect => ({ ...at, width, height });
    const inside = (at: BubblePlace): boolean =>
        at.left >= CARD_EDGE && at.top >= CARD_EDGE && at.left + width <= canvas.width - CARD_EDGE && at.top + height <= canvas.height - CARD_EDGE;
    const free = (at: { left: number; top: number }): boolean => [...line, ...clear].every((r) => !overlaps(box(at), r));
    const near = { left: spot.x - CARD_SPOT, top: spot.y - CARD_SPOT, width: 2 * CARD_SPOT, height: 2 * CARD_SPOT };
    const offSpot = (at: { left: number; top: number }): boolean => !overlaps(box(at), near) && clear.every((r) => !overlaps(box(at), r));
    const movedIn = tries.map((at): BubblePlace => ({ ...insideCanvas(at, card, canvas), tail: null, rises: at.rises }));
    const overUnder = [spot.y - CARD_SPOT - 1 - height, spot.y + CARD_SPOT + 1]
        .map((top): BubblePlace => ({ ...insideCanvas({ left: spot.x - width / 2, top }, card, canvas), tail: null, rises: top < spot.y }));
    return tries.find((at) => inside(at) && free(at)) ?? tries.find((at) => inside(at) && offSpot(at))
        ?? movedIn.find(free) ?? [...movedIn, ...overUnder].find(offSpot) ?? movedIn[0];
}

/** Whether a card `cardWidth` wide fits beside an upright line at `spotX`, its tail between them, on either side. */
const fitsBeside = (spotX: number, half: number, cardWidth: number, canvasWidth: number): boolean =>
    Math.max(spotX - tailReach(half) - CARD_EDGE, canvasWidth - CARD_EDGE - spotX - tailReach(half)) >= cardWidth;

/**
 * A card's place moved inside the canvas, CARD_EDGE in from its sides, the least it takes: a pinned card the wheel's
 * zoom took to the canvas's edge stays in sight (LineCard), as a card with no place that fits does.
 */
export function insideCanvas(at: { left: number; top: number }, card: { width: number; height: number }, canvas: { width: number; height: number }): { left: number; top: number } {
    return {
        left: Math.max(CARD_EDGE, Math.min(at.left, canvas.width - CARD_EDGE - card.width)),
        top: Math.max(CARD_EDGE, Math.min(at.top, canvas.height - CARD_EDGE - card.height)),
    };
}

/**
 * The height a card `cardWidth` wide has for itself on `canvas`, pointing at `spot` (bubblePlace): over or under a level
 * line, past its tail, or beside an upright one, rising from the tail or going down from it, whichever has more, inside
 * the canvas's edges. Beside an upright line in a canvas too narrow for the card there, it's the room just over or under
 * the spot. So a card that fits it stays off the line at the spot in any window, and keeps its tail wherever it can.
 */
export function bubbleRoom(spot: { x: number; y: number }, upright: boolean, half: number, cardWidth: number, canvas: { width: number; height: number }): number {
    if (!upright) return Math.max(spot.y - tailReach(half) - CARD_EDGE, canvas.height - CARD_EDGE - spot.y - tailReach(half));
    return fitsBeside(spot.x, half, cardWidth, canvas.width)
        ? Math.max(spot.y + TAIL_INSET - CARD_EDGE, canvas.height - CARD_EDGE - spot.y + TAIL_INSET)
        : Math.max(spot.y - CARD_SPOT - 1 - CARD_EDGE, canvas.height - CARD_EDGE - spot.y - CARD_SPOT - 1);
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
