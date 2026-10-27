import { Position, type NodeHandle } from "@xyflow/react";
import type { MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, type Position as Point } from "./levelLayout";
import type { BoxData, BoxNode } from "./MapBox";
import type { RoutedEdgeType } from "./RoutedEdge";

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

/**
 * The next list of boxes or lines, keeping the previous object for each one that would draw the same (`same`), and the
 * previous list itself when nothing changed. A hover changes two or three boxes, but the canvas rebuilt every box and
 * line object on each one, so React Flow and React redrew them all (deferred minor; on src/vs/platform with all 441
 * lines shown a hover took ~47 ms to paint). React Flow keeps its work for a node whose object is the one it had.
 */
export function reuseUnchanged<T extends { id: string }>(previous: readonly T[], next: readonly T[], same: (a: T, b: T) => boolean): T[] {
    const before = new Map(previous.map((item) => [item.id, item]));
    let unchanged = previous.length === next.length;
    const out = next.map((item, i) => {
        const old = before.get(item.id);
        if (old !== undefined && same(old, item)){
            if (previous[i] !== old) unchanged = false;
            return old;
        }
        unchanged = false;
        return item;
    });
    return unchanged ? (previous as T[]) : out;
}

/** Whether two box nodes draw the same: the same box, place, tone, ring, pulse, dot and doorway caption. */
export function sameBoxNode(a: BoxNode, b: BoxNode): boolean {
    return a.position.x === b.position.x && a.position.y === b.position.y
        && a.data.box === b.data.box && a.data.tone === b.data.tone && a.data.agent === b.data.agent
        && a.data.pulseKey === b.data.pulseKey && a.data.dot === b.data.dot && a.data.portal === b.data.portal;
}

/** Whether two lines draw the same: the same ends, route, width, color, count and hover label. */
export function sameRoutedEdge(a: RoutedEdgeType, b: RoutedEdgeType): boolean {
    return a.source === b.source && a.target === b.target && a.data?.points === b.data?.points && a.label === b.label
        && a.data?.width === b.data?.width && a.data?.color === b.data?.color
        && a.data?.count === b.data?.count && a.data?.countStrong === b.data?.countStrong;
}
