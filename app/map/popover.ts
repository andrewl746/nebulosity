import { useEffect, type CSSProperties } from "react";
import { fitPopover } from "./narrow";

/** How far below its anchor's top a popover opens (top-9), and the room it keeps from the Map's bottom edge. */
const POPOVER_TOP = 36;
const POPOVER_BOTTOM_ROOM = 8;

/**
 * Where a popover opened from `anchor` goes, read from the page as it opens (narrow.ts's fitPopover): aligned with the
 * anchor's start or end edge, kept 16 px inside the Map's sides, and no taller than the Map leaves below it, above the
 * activity bar, which is drawn over it (it then scrolls). At normal sizes that's exactly where it always opened. The
 * Map's box is the top bar's parent, MapView's column, which spans the Map down to the floor.
 */
export function placePopover(anchor: HTMLElement, width: number, align: "start" | "end"): CSSProperties {
    const column = anchor.closest("header")?.parentElement ?? document.documentElement;
    const map = column.getBoundingClientRect();
    const bottom = column.querySelector(":scope > footer")?.getBoundingClientRect().top ?? map.bottom;
    const box = anchor.getBoundingClientRect();
    const fitted = fitPopover(box, map, width, align);
    const maxHeight = bottom - box.top - POPOVER_TOP - POPOVER_BOTTOM_ROOM;
    return align === "start"
        ? { left: fitted.shift, width: fitted.width, maxHeight }
        : { right: -fitted.shift, width: fitted.width, maxHeight };
}

/**
 * Places an open popover again whenever the window resizes: VS Code's panel can be dragged narrower with a popover
 * open, and one placed for the old width would run past the Map's edge, or keep a height cap it no longer needs.
 */
export function usePlaceOnResize(open: boolean, place: () => void): void {
    useEffect(() => {
        if (!open) return;
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [open, place]);
}
