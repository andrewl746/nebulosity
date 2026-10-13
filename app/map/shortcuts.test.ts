import { describe, expect, it } from "vitest";
import { mapShortcut, type ShortcutState } from "./shortcuts";

// a paged folder, page 2 of 3, nothing open and nothing being typed
const STATE: ShortcutState = { typing: false, dialogOpen: false, levelPath: "src/vs/platform", page: 1, pageCount: 3 };
const press = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, ...extra });

describe("mapShortcut", () => {
    it("maps the Map's keys: ? help, Esc lets go, Backspace up, ← and → turn the page", () => {
        expect(mapShortcut(press("?"), STATE)).toEqual({ type: "help" });
        expect(mapShortcut(press("Escape"), STATE)).toEqual({ type: "deselect" });
        expect(mapShortcut(press("Backspace"), STATE)).toEqual({ type: "up" });
        expect(mapShortcut(press("ArrowLeft"), STATE)).toEqual({ type: "page", page: 0 });
        expect(mapShortcut(press("ArrowRight"), STATE)).toEqual({ type: "page", page: 2 });
        expect(mapShortcut(press("a"), STATE)).toBeNull();
    });

    it("opens search with Ctrl K or ⌘K, even while typing or with a dialog open", () => {
        expect(mapShortcut(press("k", { ctrlKey: true }), STATE)).toEqual({ type: "search" });
        expect(mapShortcut(press("K", { metaKey: true }), { ...STATE, typing: true, dialogOpen: true })).toEqual({ type: "search" });
    });

    it("leaves every other key alone while a dialog (the source viewer, help) is open, so the Map can't move under it", () => {
        const open = { ...STATE, dialogOpen: true };
        for (const key of ["?", "Escape", "Backspace", "ArrowLeft", "ArrowRight"]) expect(mapShortcut(press(key), open)).toBeNull();
    });

    it("leaves keys alone while the user is typing", () => {
        const typing = { ...STATE, typing: true };
        for (const key of ["?", "Backspace", "ArrowLeft", "ArrowRight"]) expect(mapShortcut(press(key), typing)).toBeNull();
    });

    it("doesn't go up from the root or turn past the first and last pages", () => {
        expect(mapShortcut(press("Backspace"), { ...STATE, levelPath: "" })).toBeNull();
        expect(mapShortcut(press("ArrowLeft"), { ...STATE, page: 0 })).toBeNull();
        expect(mapShortcut(press("ArrowRight"), { ...STATE, page: 2 })).toBeNull();
    });
});
