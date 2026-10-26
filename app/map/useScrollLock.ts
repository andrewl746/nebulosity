"use client";

import { useEffect } from "react";

/** How many open dialogs hold the page's scroll, and the page's own overflow from before the first. */
let holders = 0;
let before = "";

/**
 * Keeps the page itself from scrolling while a dialog is open (help, search, the source viewer). The dialogs are fixed
 * to the window and scroll inside themselves; below the floor (narrow.ts) the page under them scrolls too, and its
 * scrollbars beside the dialog's would only move what's hidden behind it. At normal sizes the page never scrolls, so
 * nothing changes there.
 */
export function useScrollLock(): void {
    useEffect(() => {
        const root = document.documentElement;
        if (holders === 0){
            before = root.style.overflow;
            root.style.overflow = "hidden";
        }
        holders++;
        return () => {
            holders--;
            if (holders === 0) root.style.overflow = before;
        };
    }, []);
}
