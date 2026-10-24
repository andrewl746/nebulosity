"use client";

import { useEffect, useState } from "react";

/**
 * An element's width in px, kept current by a ResizeObserver; null until it has been measured. Hand the returned
 * callback to the element's `ref`. The Map sizes its panel and its page pill by it (narrow.ts).
 */
export function useWidth<T extends HTMLElement>(): [(element: T | null) => void, number | null] {
    const [element, setElement] = useState<T | null>(null);
    const [width, setWidth] = useState<number | null>(null);
    useEffect(() => {
        if (element === null) return;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return [setElement, width];
}
