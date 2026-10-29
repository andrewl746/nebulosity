"use client";

import { useEffect, useRef, type RefObject } from "react";

/** The popover's Escape, on its own so a test can press it without a page (useDismiss.test.ts). */
export function closeOnEscape(onDismiss: () => void): (event: Pick<KeyboardEvent, "key" | "stopPropagation">) => void {
    return (event) => {
        if (event.key === "Escape") onDismiss();
    };
}

/**
 * Closes a popover (the status menu, the repo picker) on a click anywhere outside it or on Escape. Left open, the
 * status menu sat over the details panel until its button was clicked again (owner review of the refresh). Returns the
 * ref to put on the element that holds both the button and the popover, so clicking the button still toggles it.
 */
export function useDismiss<T extends HTMLElement>(open: boolean, onDismiss: () => void): RefObject<T | null> {
    const ref = useRef<T>(null);
    const latest = useRef(onDismiss);
    useEffect(() => {
        latest.current = onDismiss;
    }, [onDismiss]);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: PointerEvent): void => {
            if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) latest.current();
        };
        const onKey = closeOnEscape(() => latest.current());
        document.addEventListener("pointerdown", onPointer);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onPointer);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return ref;
}
