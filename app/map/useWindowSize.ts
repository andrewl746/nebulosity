"use client";

import { useSyncExternalStore } from "react";
import type { Size } from "./useSize";

/** What the server renders the layout for, and what hydration starts from: the size the Map was designed at. */
const SERVER_SIZE = "1440x900";

/**
 * The window's size as one string, so an unchanged size is the same snapshot. The width is the page's own, without a
 * vertical scrollbar (clientWidth): a short window scrolls down below the canvas's floor (shell.ts), and laying out for
 * the width with the scrollbar would push the page sideways by its width.
 */
function snapshot(): string {
    return `${document.documentElement.clientWidth}x${window.innerHeight}`;
}

function subscribe(onChange: () => void): () => void {
    window.addEventListener("resize", onChange);
    // the scrollbar coming or going changes clientWidth without a resize
    const observer = new ResizeObserver(onChange);
    observer.observe(document.documentElement);
    return () => {
        window.removeEventListener("resize", onChange);
        observer.disconnect();
    };
}

/**
 * The window's size in px, which the Map's layout goes by (shell.ts). Inside VS Code's panel the window is the panel.
 * The server and the first client render use 1440 × 900, then the real size, so hydration never mismatches.
 */
export function useWindowSize(): Size {
    const text = useSyncExternalStore(subscribe, snapshot, () => SERVER_SIZE);
    const [width, height] = text.split("x").map(Number);
    return { width, height };
}
