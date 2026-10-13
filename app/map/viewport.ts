import { BOX_HEIGHT, BOX_WIDTH, FIT_PADDING, type Position } from "./levelLayout";

/**
 * Where a level opens (owner, 2026-10-13: "when you first open it, it should be a readable size"). A level is fitted to
 * the canvas as before, unless fitting it whole would shrink it past MIN_READABLE_ZOOM. Then it opens as wide as the
 * canvas allows (less SIDE_ROOM each side), between that floor and 100%, from its top, centred across, and the rest is
 * a scroll or a drag away: the floor alone left wide empty margins on busy levels (an outside critique, owner's pick).
 * The zoom controls' fit button still shows the whole level, and zooming out by hand still works (MapCanvas's minZoom).
 */

/** Box names are 15 px, so at 0.75 they're 11.25 px: the smallest the Map opens a level at. */
export const MIN_READABLE_ZOOM = 0.75;
/** A small level isn't blown up past 100% (VISUAL_REFRESH.md §4). */
export const MAX_FIT_ZOOM = 1;
/** How far below the canvas's top edge a level too big to fit starts: clear of the page pill. */
const TOP_INSET = 64;
/**
 * The room left on each side of a level that opens filling the width: the owner's pick (sheet 1, B, 2026-10-13), which
 * opens VS Code's contrib, page 2, at 83% on a 1907 px screen instead of 75%.
 */
export const SIDE_ROOM = 72;

export type Bounds = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };

/** The rectangle every box of a level covers; positions are top-left corners (levelLayout.ts). */
export function boundsOf(positions: ReadonlyMap<string, Position>): Bounds {
    if (positions.size === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { x, y } of positions.values()){
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + BOX_WIDTH);
        bottom = Math.max(bottom, y + BOX_HEIGHT);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The viewport a level opens at: React Flow's fit (the same zoom and centring, with FIT_PADDING) when that's readable,
 * otherwise as wide as the canvas allows, from the level's top, never under MIN_READABLE_ZOOM or over MAX_FIT_ZOOM.
 * Pure, so the rule is tested apart from React Flow.
 */
export function initialViewport(bounds: Bounds, canvas: { width: number; height: number }): Viewport {
    const centre = (zoom: number): Viewport => ({
        x: canvas.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: canvas.height / 2 - (bounds.y + bounds.height / 2) * zoom,
        zoom,
    });
    if (bounds.width === 0 || bounds.height === 0 || canvas.width === 0 || canvas.height === 0) return centre(1);

    const fit = Math.min(
        MAX_FIT_ZOOM,
        canvas.width / (bounds.width * (1 + FIT_PADDING)),
        canvas.height / (bounds.height * (1 + FIT_PADDING)),
    );
    if (fit >= MIN_READABLE_ZOOM) return centre(fit);

    // a tall level reads top to bottom like a page, so its width decides the zoom
    const zoom = Math.min(MAX_FIT_ZOOM, Math.max(MIN_READABLE_ZOOM, (canvas.width - 2 * SIDE_ROOM) / bounds.width));
    return { x: canvas.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: TOP_INSET - bounds.y * zoom, zoom };
}
