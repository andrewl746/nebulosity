"use client";

import { useSyncExternalStore } from "react";
import type { ThemeKind } from "@/lib/contracts";

const KINDS: ReadonlySet<string> = new Set<ThemeKind>(["dark", "light", "hc", "hc-light"]);

/** The page's theme kind (`data-kind` on `<html>`, set by theme.ts), dark when none is set. */
function readKind(): ThemeKind {
    const kind = document.documentElement.getAttribute("data-kind");
    return kind !== null && KINDS.has(kind) ? (kind as ThemeKind) : "dark";
}

/** Calls `onChange` whenever `<html>`'s `data-kind` changes: the panel's theme message, or VS Code's theme switched. */
function subscribe(onChange: () => void): () => void {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-kind"] });
    return () => observer.disconnect();
}

/**
 * The theme kind the Map is drawn in, for what CSS can't follow by itself (React Flow's own color mode). Dark on the
 * server and in the browser; inside VS Code's panel, the person's kind, from its first paint (theme.ts's
 * earlyThemeScript) and again whenever the theme changes.
 */
export function useThemeKind(): ThemeKind {
    return useSyncExternalStore(subscribe, readKind, () => "dark");
}
