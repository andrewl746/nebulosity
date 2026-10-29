import type { MapEdge } from "@/lib/contracts";
import { edgeKey } from "./emphasis";
import { BOX_HEIGHT, BOX_WIDTH, FIT_PADDING, type Position } from "./levelLayout";
import type { Point } from "./routes";
import { arrowHead, boxHeadWidths, lineWidth, maxImportsOf } from "./weights";

/**
 * Where a level opens (owner, 2026-10-13: "when you first open it, it should be a readable size"). A level is fitted to
 * the canvas as before, unless fitting it whole would shrink it past MIN_READABLE_ZOOM. Then it opens as wide as the
 * canvas allows (less SIDE_ROOM each side), between that floor and 100%, from its top, centred across, and the rest is
 * a scroll or a drag away: the floor alone left wide empty margins on busy levels (an outside critique, owner's pick).
 * The toolbar's Fit still shows the whole level, and zooming out by hand still works (MapCanvas's minZoom).
 *
 * Both frame the drawn lines too (the owner, 2026-10-28): a lane beside the boxes ran off under the inspector. The
 * boxes win, so framing the lines never shrinks them past LINES_FRAME_LEAST of their own fit, nor a level that opens
 * fitted past MIN_READABLE_ZOOM. Lines cut off after a pan or a zoom are the person's doing, and stay.
 */

/** Box names are 15 px, so at 0.75 they're 11.25 px: the smallest the Map opens a level at. */
export const MIN_READABLE_ZOOM = 0.75;
/** A small level isn't blown up past 100% (VISUAL_REFRESH.md §4). */
export const MAX_FIT_ZOOM = 1;
/**
 * How far below the canvas's top edge a level too big to fit starts, clear of the page pill; on a paged level, the band a
 * fitted level is kept below too.
 */
export const TOP_INSET = 64;
/**
 * The room left on each side of a level that opens filling the width: the owner's pick (sheet 1, B, 2026-10-13), which
 * opens VS Code's contrib, page 2, at 83% on a 1907 px screen instead of 75%.
 */
export const SIDE_ROOM = 72;
/** The room framed past the drawn lines' extent, so the outermost lane doesn't run along the canvas's edge. */
export const LINES_MARGIN = 16;
/**
 * The least of the boxes' own fit that framing the lines may zoom out to: past it the boxes are framed alone and the
 * outermost lines run off. Over VS Code, Fit then frames the lines on every page at rest, and with every line drawn
 * keeps the boxes' fit on the densest few only (the merged-lines plan, fit4-final.log).
 */
export const LINES_FRAME_LEAST = 0.85;

export type Bounds = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };
type Canvas = { width: number; height: number };

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
 * How far drawn lines reach: each line's corners grown by half its width, and its head's half-width either side of its
 * tip. Every route ends going down into its box's top (RoutedEdge.tsx), so the head reaches across there, not past it.
 * Null when no line has a route.
 */
export function linesBounds(lines: readonly { points: readonly Point[]; width: number; headHalf: number }[]): Bounds | null {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { points, width, headHalf } of lines){
        if (points.length === 0) continue;
        for (const { x, y } of points){
            left = Math.min(left, x - width / 2);
            top = Math.min(top, y - width / 2);
            right = Math.max(right, x + width / 2);
            bottom = Math.max(bottom, y + width / 2);
        }
        const tip = points[points.length - 1];
        left = Math.min(left, tip.x - headHalf);
        right = Math.max(right, tip.x + headHalf);
    }
    return left === Infinity ? null : { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The routed lines' reach (linesBounds), each as wide as MapCanvas draws it and under its box's one head (weights.ts),
 * so what's framed is what's on screen.
 */
export function drawnLinesBounds(routes: ReadonlyMap<string, readonly Point[]>, edges: readonly MapEdge[]): Bounds | null {
    const max = maxImportsOf(edges);
    const heads = boxHeadWidths(edges);
    const byKey = new Map(edges.map((e) => [edgeKey(e), e]));
    return linesBounds([...routes].flatMap(([key, points]) => {
        const edge = byKey.get(key);
        if (edge === undefined) return [];
        const width = lineWidth(edge.count, max);
        return [{ points, width, headHalf: arrowHead(heads.get(edge.target) ?? width).half }];
    }));
}

/** What a fit frames, by its middle and its size. */
type Frame = { middle: Point; width: number; height: number };

/**
 * One side to side (or top to bottom) span of a frame, from the boxes' middle, as React Flow centres its fit: half the
 * boxes and FIT_PADDING's share each way, or as far as the lines and LINES_MARGIN reach past that. Worked out from the
 * middle, so lines inside the boxes' frame leave it exactly as it was.
 */
function span(start: number, size: number, lines?: { start: number; size: number }): { middle: number; size: number } {
    const middle = start + size / 2;
    const boxes = size / 2 + (size * FIT_PADDING) / 2;
    if (lines === undefined) return { middle, size: 2 * boxes };
    const before = Math.max(boxes, middle - (lines.start - LINES_MARGIN));
    const after = Math.max(boxes, lines.start + lines.size + LINES_MARGIN - middle);
    return { middle: middle + (after - before) / 2, size: before + after };
}

/** The boxes as React Flow's fit frames them, and with `lines`, as far as they reach past them too. */
function frameOf(boxes: Bounds, lines?: Bounds): Frame {
    const across = span(boxes.x, boxes.width, lines && { start: lines.x, size: lines.width });
    const down = span(boxes.y, boxes.height, lines && { start: lines.y, size: lines.height });
    return { middle: { x: across.middle, y: down.middle }, width: across.size, height: down.size };
}

const zoomFor = (frame: Frame, room: Canvas): number => Math.min(MAX_FIT_ZOOM, room.width / frame.width, room.height / frame.height);

/** The boxes' frame, grown to the lines when that keeps LINES_FRAME_LEAST of the boxes' own fit (the boxes win). */
function framed(boxes: Bounds, lines: Bounds | null, room: Canvas): Frame {
    const own = frameOf(boxes);
    if (lines === null) return own;
    const both = frameOf(boxes, lines);
    return zoomFor(both, room) >= LINES_FRAME_LEAST * zoomFor(own, room) ? both : own;
}

/**
 * The toolbar's Fit: the level's boxes and its drawn lines (linesBounds) centred in the canvas, never past 100%, with
 * no readable floor, since the person asked to see it whole. React Flow's own fit frames the boxes alone, and floors
 * its padding to whole pixels, so a level without lines fits within a pixel of it.
 */
export function fitViewport(boxes: Bounds, lines: Bounds | null, canvas: Canvas): Viewport {
    if (boxes.width === 0 || boxes.height === 0 || canvas.width === 0 || canvas.height === 0){
        return { x: canvas.width / 2 - (boxes.x + boxes.width / 2), y: canvas.height / 2 - (boxes.y + boxes.height / 2), zoom: 1 };
    }
    const frame = framed(boxes, lines, canvas);
    const zoom = zoomFor(frame, canvas);
    return { x: canvas.width / 2 - frame.middle.x * zoom, y: canvas.height / 2 - frame.middle.y * zoom, zoom };
}

/**
 * The viewport a level opens at: React Flow's fit (the same zoom and centring, with FIT_PADDING) when that's readable,
 * otherwise as wide as the canvas allows, from the level's top, never under MIN_READABLE_ZOOM or over MAX_FIT_ZOOM.
 * `topBand` keeps a fitted level below a strip at the top: on a paged level the page pill sits there, and a level
 * centred in the whole canvas could open with its top-right box under the pill (deferred minor). `lines` is the drawn
 * lines' reach (drawnLinesBounds), framed as Fit frames it while the fit stays readable, and across a level that opens
 * from its top. Pure, so the rule is tested apart from React Flow.
 */
export function initialViewport(bounds: Bounds, canvas: Canvas, topBand = 0, lines: Bounds | null = null): Viewport {
    const below = canvas.height - topBand;
    const centre = (frame: Frame, zoom: number): Viewport => ({
        x: canvas.width / 2 - frame.middle.x * zoom,
        y: topBand + below / 2 - frame.middle.y * zoom,
        zoom,
    });
    if (bounds.width === 0 || bounds.height === 0 || canvas.width === 0 || canvas.height === 0) return centre(frameOf(bounds), 1);

    const room = { width: canvas.width, height: below };
    const own = frameOf(bounds);
    const fit = zoomFor(own, room);
    if (fit >= MIN_READABLE_ZOOM){
        // the lines may not take a page that fits readably under the floor: then it keeps the boxes' view
        const frame = framed(bounds, lines, room);
        const zoom = zoomFor(frame, room);
        return zoom >= MIN_READABLE_ZOOM ? centre(frame, zoom) : centre(own, fit);
    }

    // a tall level reads top to bottom like a page, so its width decides the zoom
    const wide = (width: number): number => Math.min(MAX_FIT_ZOOM, Math.max(MIN_READABLE_ZOOM, (canvas.width - 2 * SIDE_ROOM) / width));
    let zoom = wide(bounds.width);
    let middle = bounds.x + bounds.width / 2;
    if (lines !== null){
        // the boxes and the lines across, SIDE_ROOM their margin, unless that shrinks the boxes past LINES_FRAME_LEAST
        const left = Math.min(bounds.x, lines.x);
        const right = Math.max(bounds.x + bounds.width, lines.x + lines.width);
        if (wide(right - left) >= LINES_FRAME_LEAST * zoom){
            zoom = wide(right - left);
            middle = (left + right) / 2;
        }
    }
    return { x: canvas.width / 2 - middle * zoom, y: TOP_INSET - bounds.y * zoom, zoom };
}
