"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** An element's border box, in px. */
export type Size = { width: number; height: number };

/** The element's size, or `last` itself when that hasn't changed, so an unchanged size never re-renders. */
function measured(element: HTMLElement, last: Size | null): Size {
    const { width, height } = element.getBoundingClientRect();
    return last !== null && last.width === width && last.height === height ? last : { width, height };
}

/**
 * An element's size in px; null until it has been measured. Hand the returned callback to the element's `ref`. The
 * Map sizes its panel, its page pill's wording and its error banner by these (narrow.ts).
 *
 * It's read after every render, before the browser paints, so what React just changed (a new level, a pill that
 * appeared, a banner) never shows for a frame at the old size; a ResizeObserver catches what React didn't change (the
 * window resized, a font arrived).
 */
export function useSize<T extends HTMLElement>(): [(element: T | null) => void, Size | null] {
    const element = useRef<T | null>(null);
    const [attached, setAttached] = useState<T | null>(null);
    const [size, setSize] = useState<Size | null>(null);
    const ref = useCallback((next: T | null) => {
        element.current = next;
        setAttached(next);
    }, []);
    // no dependency list on purpose: any render may have changed the element's size, and an unchanged size sets nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read after every render, before the paint (see above)
    useLayoutEffect(() => {
        const el = element.current;
        if (el === null) return;
        const next = measured(el, size);
        if (next !== size) setSize(next);
    });
    useEffect(() => {
        if (attached === null) return;
        const observer = new ResizeObserver(() => setSize((last) => measured(attached, last)));
        observer.observe(attached);
        return () => observer.disconnect();
    }, [attached]);
    return [ref, size];
}
