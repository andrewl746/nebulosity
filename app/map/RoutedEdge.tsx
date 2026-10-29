"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { roundedPath, type Point } from "./routes";
import { arrowHead } from "./weights";

/**
 * A line that follows its route (routes.ts) instead of React Flow's straight curve. `width` goes by how many imports it
 * carries (weights.ts), `color` by its tone, and `count` is the number written on it at `labelAt`, when it's one of the
 * lines that carry theirs (weights.ts's labelledLines) and its count has a place clear of everything else (routes.ts's
 * placeCounts). `headWidth` is the width its box's one arrowhead is sized for (weights.ts's boxHeadWidths), shared by
 * every line into that box, else its own.
 */
export type RoutedEdgeData = { points: Point[]; width: number; color: string; count?: string; countStrong?: boolean; headWidth?: number; labelAt?: Point };
export type RoutedEdgeType = Edge<RoutedEdgeData, "routed">;

/** How far above the box's top edge the arrowhead's tip stops, so it never touches the border. */
const TIP_GAP = 3;

/**
 * One import line on the Map (the Workbench redesign, ADR-070): drawn along the route the layout gave it, through the
 * channels and gutters between boxes, never across one. Its head is filled and wider than the line on both sides, and
 * the line stops inside the head's base, so the two read as one arrow at any width. Every route ends going down into
 * its box's top, so the head always points down. Without a route (React Flow may draw before the routes arrive) it
 * falls back to a straight line between the two handles.
 *
 * The count is HTML above the boxes, not SVG beside the line: the lines sit under the boxes, and a label drawn with
 * them was cut off by any box it overlapped (owner review). What a hovered line means, in words, is the canvas's hover
 * card (LineCard), beside the pointer rather than on the line.
 */
function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, interactionWidth }: EdgeProps<RoutedEdgeType>){
    const route = data && data.points.length >= 2 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    const width = data?.width ?? 1;
    const color = data?.color ?? "var(--edge-dim)";
    // the lines into one box end at its one point under one head, so each draws that head, the same size whichever of
    // them are drawn, and they coincide (the owner, 2026-10-28: a line that appears never changes its box's head)
    const { half, length } = arrowHead(data?.headWidth ?? width);
    const end = route[route.length - 1];
    const tip = { x: end.x, y: end.y - TIP_GAP };
    // the line stops a pixel inside the head's base, so no gap shows between them
    const line = [...route.slice(0, -1), { x: tip.x, y: tip.y - length + 1 }];
    // a count goes only where the Map placed it, clear of every other line, count and box (the owner, 2026-10-28)
    const count = data?.labelAt !== undefined ? data.count : undefined;
    const head = `M ${tip.x - half} ${tip.y - length} L ${tip.x + half} ${tip.y - length} L ${tip.x} ${tip.y} Z`;
    return (
        <>
            <BaseEdge
                id={id}
                path={roundedPath(line)}
                style={{ stroke: color, strokeWidth: width, strokeLinecap: "butt", strokeLinejoin: "round" }}
                interactionWidth={Math.max(interactionWidth ?? 20, width + 10)}
            />
            <path d={head} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" className="pointer-events-none" />
            {count && data?.labelAt && (
                <EdgeLabelRenderer>
                    <div
                        data-edge-label={id}
                        data-edge-count={count}
                        style={{ transform: `translate(-50%, -50%) translate(${data.labelAt.x}px, ${data.labelAt.y}px)`, zIndex: 1001 }}
                        className={`pointer-events-none absolute whitespace-nowrap rounded-[4px] border border-divider bg-canvas px-1.5 text-[11.5px] leading-[16px] tabular-nums ${data.countStrong ? "text-text" : "text-text-3"}`}
                    >
                        {count}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

export default memo(RoutedEdge);
