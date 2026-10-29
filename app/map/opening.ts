import type { MapNode } from "@/lib/contracts";

/** What opening a box does: a folder opens on the Map, a doorway turns to its page, a file opens in the editor. */
export type BoxOpening = { type: "folder"; path: string } | { type: "page"; page: number } | { type: "editor"; path: string };

/**
 * What opening `box` does, by a double-click on it or the Open beside it in a narrow window (BoxActions); null when it
 * has nothing to open. Inside VS Code's panel (`inEditor`) a click only selects a file, and opening it is how it reaches
 * the editor (the owner, 2026-10-29, ADR-062 amended); a browser tab has no editor to open it in. The merged doorway
 * stands for several pages, so it stays selected for its panel to pick one.
 */
export function openingOf(box: MapNode, inEditor: boolean): BoxOpening | null {
    if (box.kind === "folder") return { type: "folder", path: box.path };
    if (box.kind === "portal") return box.page === undefined ? null : { type: "page", page: box.page };
    return inEditor ? { type: "editor", path: box.path } : null;
}
