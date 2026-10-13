import { BOX_HEIGHT, BOX_WIDTH, FIT_PADDING, type Position } from "./levelLayout";

/**
 * Where a level opens (owner, 2026-10-13: "when you first open it, it should be a readable size"). A level is fitted to
 * the canvas as before, unless fitting it whole would shrink it past MIN_READABLE_ZOOM: then it opens at that zoom,
 * from its top, centred across, and the rest is a scroll or a drag away. The zoom controls' fit button still shows the
 * whole level, and zooming out by hand still works (MapCanvas's minZoom).
 */

/** Box names are 15 px, so at 0.75 they're 11.25 px: the smallest the Map opens a level at. */
export const MIN_READABLE_ZOOM = 0.75;
/** A small level isn't blown up past 100% (VISUAL_REFRESH.md §4). */
export const MAX_FIT_ZOOM = 1;
/** How far below the canvas's top edge a level that opens at the readable floor starts: clear of the page pill. */
const TOP_INSET = 64;

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
 * otherwise MIN_READABLE_ZOOM from the level's top. Pure, so the rule is tested apart from React Flow.
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

    const zoom = MIN_READABLE_ZOOM;
    return { x: canvas.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: TOP_INSET - bounds.y * zoom, zoom };
}
