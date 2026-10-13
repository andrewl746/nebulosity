import { Position, type NodeHandle } from "@xyflow/react";
import type { MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, type Position as Point } from "./levelLayout";
import type { BoxData, BoxNode } from "./MapBox";

/**
 * Where a box's lines attach: a 1 px point in the middle of its top edge (lines arrive) and of its bottom edge (lines
 * leave). Given to React Flow up front, so it never has to find them by measuring the page.
 */
const BOX_HANDLES: NodeHandle[] = [
    { type: "target", position: Position.Top, x: BOX_WIDTH / 2 - 0.5, y: 0, width: 1, height: 1 },
    { type: "source", position: Position.Bottom, x: BOX_WIDTH / 2 - 0.5, y: BOX_HEIGHT - 1, width: 1, height: 1 },
];

/**
 * One box as React Flow takes it. The owner found lines missing "sometimes": React Flow draws a line only once it
 * knows both ends' attach points, and it forgets them whenever it's handed a node without `measured`, then waits for
 * the next frame to measure the page again. The canvas rebuilds every node on each hover, selection and pulse, so
 * the lines blinked out each time, and stayed out when no frame came (a window in the background, a page still
 * loading). With its size and attach points given here, a box's lines never wait for, or lose, a measurement.
 */
export function toBoxNode(box: MapNode, position: Point, data: BoxData): BoxNode {
    return {
        id: box.path,
        type: "box",
        position,
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
        measured: { width: BOX_WIDTH, height: BOX_HEIGHT },
        handles: BOX_HANDLES,
        draggable: false,
        connectable: false,
        data,
    };
}
