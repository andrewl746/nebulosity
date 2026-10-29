"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The popover's Escape. It closes the popover and stops the press at the document, before it reaches the window, where
 * the Map's own Escape (MapView) would let go of the selection too. The help promises one press each, the popover, then
 * the selection, then Claude Code's highlights. It stays on the document rather than catching the press first, on the
 * way down, as the help and the source viewer do, so either of them opened over a popover still closes alone. On its
 * own so a test can press it without a page (useDismiss.test.ts).
 */
export function closeOnEscape(onDismiss: () => void): (event: Pick<KeyboardEvent, "key" | "stopPropagation">) => void {
    return (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onDismiss();
    };
}

/**
 * Closes a popover (the toolbar's … menu, the status menu, the repo picker, the breadcrumb's folded folders) on a click
 * anywhere outside it or on Escape, which goes no further (closeOnEscape). Left open, the status menu sat over the
 * details panel until its button was clicked again (owner review of the refresh). Returns the ref to put on the element
 * that holds both the button and the popover, so clicking the button still toggles it.
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
