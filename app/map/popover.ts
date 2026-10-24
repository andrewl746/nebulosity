import type { CSSProperties } from "react";
import { fitPopover } from "./narrow";

/** How far below its anchor's top a popover opens (top-9), and the room it keeps from the Map's bottom edge. */
const POPOVER_TOP = 36;
const POPOVER_BOTTOM_ROOM = 8;

/**
 * Where a popover opened from `anchor` goes, read from the page as it opens (narrow.ts's fitPopover): aligned with the
 * anchor's start or end edge, kept 16 px inside the Map's sides, and no taller than the Map leaves below it (it then
 * scrolls). At normal sizes that's exactly where it always opened. The Map's box is the top bar's parent, MapView's
 * column, which spans the Map down to the floor.
 */
export function placePopover(anchor: HTMLElement, width: number, align: "start" | "end"): CSSProperties {
    const map = (anchor.closest("header")?.parentElement ?? document.documentElement).getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    const fitted = fitPopover(box, map, width, align);
    const maxHeight = map.bottom - box.top - POPOVER_TOP - POPOVER_BOTTOM_ROOM;
    return align === "start"
        ? { left: fitted.shift, width: fitted.width, maxHeight }
        : { right: -fitted.shift, width: fitted.width, maxHeight };
}
