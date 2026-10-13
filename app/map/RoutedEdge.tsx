"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { midpointAlong, roundedPath, type Point } from "./routes";

/** A line that follows its route (routes.ts) instead of React Flow's straight curve. */
export type RoutedEdgeType = Edge<{ points: Point[] }, "routed">;

/**
 * One import line on the Map (VISUAL_REFRESH.md §4): drawn along the route the layout gave it, through the channels
 * and gutters between boxes, never across one. Without a route (it can't happen on a laid-out level, but React Flow
 * may draw before the routes arrive) it falls back to a straight line between the two handles.
 *
 * The hover label ("16 imports") is HTML above the boxes, not SVG beside the line: the lines sit under the boxes, and
 * a label drawn with them was cut off by any box it overlapped (owner review).
 */
function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd, label, interactionWidth }: EdgeProps<RoutedEdgeType>){
    const points = data && data.points.length >= 2 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    const middle = midpointAlong(points);
    return (
        <>
            <BaseEdge id={id} path={roundedPath(points)} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        data-edge-label={id}
                        style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)`, zIndex: 1001 }}
                        className="pointer-events-none absolute rounded-md border border-border bg-surface px-1.5 py-0.5 text-[12px] text-text"
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

export default memo(RoutedEdge);
