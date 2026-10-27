"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { longestSideMiddle, roundedPath, type Point } from "./routes";
import { arrowHead } from "./weights";

/**
 * A line that follows its route (routes.ts) instead of React Flow's straight curve. `width` goes by how many imports it
 * carries (weights.ts), `color` by its tone, and `count` is the number written on it, when it's one of the lines that
 * carry theirs (weights.ts's labelledLines).
 */
export type RoutedEdgeData = { points: Point[]; width: number; color: string; count?: string; countStrong?: boolean };
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
 * The labels are HTML above the boxes, not SVG beside the line: the lines sit under the boxes, and a label drawn with
 * them was cut off by any box it overlapped (owner review). The hover label says what the line means in words and
 * replaces the count while it shows.
 */
function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, label, interactionWidth }: EdgeProps<RoutedEdgeType>){
    const route = data && data.points.length >= 2 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    const width = data?.width ?? 1;
    const color = data?.color ?? "var(--edge-dim)";
    const { half, length } = arrowHead(width);
    const end = route[route.length - 1];
    const tip = { x: end.x, y: end.y - TIP_GAP };
    // the line stops a pixel inside the head's base, so no gap shows between them
    const line = [...route.slice(0, -1), { x: tip.x, y: tip.y - length + 1 }];
    const middle = longestSideMiddle(line);
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
            {(label || data?.count) && (
                <EdgeLabelRenderer>
                    <div
                        data-edge-label={id}
                        data-edge-count={label ? undefined : data?.count}
                        style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)`, zIndex: 1001 }}
                        className={`pointer-events-none absolute whitespace-nowrap rounded-[4px] border border-divider bg-canvas px-1.5 leading-[16px] tabular-nums ${label ? "text-[12px] text-text" : `text-[11.5px] ${data?.countStrong ? "text-text" : "text-text-3"}`}`}
                    >
                        {label ?? data?.count}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

export default memo(RoutedEdge);
