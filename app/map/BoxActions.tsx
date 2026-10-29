"use client";

import { useStore } from "@xyflow/react";
import type { MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH } from "./levelLayout";
import { actionsPlace } from "./narrow";
import { openingOf } from "./opening";
import { useSize } from "./useSize";

const BUTTON = "rounded-md px-2.5 py-1 text-[14px] text-text hover:bg-node";

/**
 * A selected box's actions while the panel would cover the canvas (owner review, 2026-10-25). In a narrow window, VS
 * Code's panel above all, the panel over the whole canvas hid the box a double click was aimed at, and every editor
 * follow covered the Map. So a click there only selects, and the box offers what the panel would have: Open (a folder,
 * or inside VS Code's panel a file, which opens in the editor), the page (a doorway) and Details, at screen size whatever
 * the zoom. Each opens the box as a double-click on it would (opening.ts). narrow.ts's actionsPlace puts them beside the
 * box and keeps them inside the canvas (React Flow's NodeToolbar can't be kept in: a box hanging off an edge took its
 * toolbar past it). Details opens the panel over the canvas; its × comes back to the Map with the box still selected.
 * A component of its own, so following the view as the canvas pans re-renders only this.
 */
export default function BoxActions({ box, position, onOpen, onTurnPage, onDetails, onOpenFile }: {
    box: MapNode;
    /** The box's top-left corner in the level's own coordinates, its layout position. */
    position: { x: number; y: number };
    onOpen: (folder: string) => void;
    onTurnPage: (page: number) => void;
    onDetails: (path: string) => void;
    /** Inside VS Code's panel only: opens a file in the editor. */
    onOpenFile?: (path: string) => void;
}){
    const [sizeRef, size] = useSize<HTMLDivElement>();
    // the transform is [x, y, zoom]: the box on screen, in the canvas's own px
    const [x, y, zoom] = useStore((s) => s.transform);
    const canvasWidth = useStore((s) => s.width);
    const canvasHeight = useStore((s) => s.height);
    const onScreen = { left: position.x * zoom + x, top: position.y * zoom + y, width: BOX_WIDTH * zoom, height: BOX_HEIGHT * zoom };
    // until it's measured it's laid out unseen, so its first frame is already in place
    const place = actionsPlace(onScreen, size ?? { width: 0, height: 0 }, canvasWidth, canvasHeight);
    const opening = openingOf(box, onOpenFile !== undefined);
    return (
        <div
            ref={sizeRef}
            data-box-actions={box.path}
            data-keep-clear
            style={{ left: place.left, top: place.top, visibility: size === null ? "hidden" : undefined }}
            className="absolute z-[6] flex items-center gap-1 rounded-lg bg-panel p-1"
        >
            {opening?.type === "folder" && (
                <button type="button" onClick={() => onOpen(opening.path)} title="Open this folder (or double-click it)" className={BUTTON}>Open</button>
            )}
            {opening?.type === "editor" && (
                <button type="button" onClick={() => onOpenFile?.(opening.path)} title="Open in VS Code (or double-click it)" className={BUTTON}>Open</button>
            )}
            {opening?.type === "page" && (
                <button type="button" onClick={() => onTurnPage(opening.page)} title={`Go to page ${opening.page + 1} (or double-click the doorway)`} className={BUTTON}>
                    Go to page {opening.page + 1}
                </button>
            )}
            <button type="button" onClick={() => onDetails(box.path)} title="Show its details over the Map" className={BUTTON}>Details</button>
        </div>
    );
}
