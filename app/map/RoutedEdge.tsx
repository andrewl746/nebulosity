"use client";

import { memo } from "react";
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { midpointAlong, roundedPath, type Point } from "./routes";

/** A line that follows its route (routes.ts) instead of React Flow's straight curve. */
export type RoutedEdgeType = Edge<{ points: Point[] }, "routed">;

/**
 * One import line on the Map (VISUAL_REFRESH.md §4): drawn along the route the layout gave it, through the channels
 * and gutters between boxes, never across one. Without a route (it can't happen on a laid-out level, but React Flow
 * may draw before the routes arrive) it falls back to a straight line between the two handles.
 */
function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth }: EdgeProps<RoutedEdgeType>){
    const points = data && data.points.length >= 2 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    const middle = midpointAlong(points);
    return (
        <BaseEdge
            id={id}
            path={roundedPath(points)}
            labelX={middle.x}
            labelY={middle.y}
            label={label}
            labelStyle={labelStyle}
            labelBgStyle={labelBgStyle}
            labelBgPadding={labelBgPadding}
            labelBgBorderRadius={labelBgBorderRadius}
            style={style}
            markerEnd={markerEnd}
            interactionWidth={interactionWidth}
        />
    );
}

export default memo(RoutedEdge);
