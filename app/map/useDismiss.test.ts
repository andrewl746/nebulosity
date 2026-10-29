import { describe, expect, it } from "vitest";
import { mapShortcut } from "./shortcuts";
import { closeOnEscape } from "./useDismiss";

/** What the Map shows: a popover open, a box selected, Claude Code's highlights up. */
type Shown = { popover: boolean; selected: boolean; highlighted: boolean };

/**
 * The Map with a popover open (the toolbar's … menu, the status menu, the repo list), a box selected and Claude Code's
 * highlights up. A press goes up from the focused control as the browser carries it, written out by hand since the
 * tests have no page: the popover's listener on the document first (useDismiss, there while the popover is open), then
 * the Map's own on the window (MapView, through mapShortcut, with what it drew before the press), unless the first one
 * stopped it.
 */
function mapWithPopover(){
    const shown: Shown = { popover: true, selected: true, highlighted: true };
    return (key: string): Shown => {
        let stopped = false;
        const event = { key, ctrlKey: false, metaKey: false, stopPropagation: () => { stopped = true; } };
        if (shown.popover) closeOnEscape(() => { shown.popover = false; })(event);
        if (!stopped){
            const shortcut = mapShortcut(event, { typing: false, dialogOpen: false, levelPath: "src", page: 0, pageCount: 1, selected: shown.selected, highlighted: shown.highlighted });
            if (shortcut?.type === "deselect") shown.selected = false;
            if (shortcut?.type === "clear-highlights") shown.highlighted = false;
        }
        return { ...shown };
    };
}

describe("Escape with a popover open (useDismiss)", () => {
    it("closes just the popover, then lets go of the selection, then clears the highlights, one press each (the help's Keyboard list)", () => {
        const press = mapWithPopover();
        expect(press("Escape")).toEqual({ popover: false, selected: true, highlighted: true });
        expect(press("Escape")).toEqual({ popover: false, selected: false, highlighted: true });
        expect(press("Escape")).toEqual({ popover: false, selected: false, highlighted: false });
        expect(press("Escape")).toEqual({ popover: false, selected: false, highlighted: false });
    });

    it("lets every other key go on to the Map, so Backspace and the arrows still work with a popover open", () => {
        let dismissed = 0;
        let stopped = 0;
        const onKey = closeOnEscape(() => { dismissed++; });
        for (const key of ["Backspace", "ArrowLeft", "ArrowRight", "?", "k", "Enter"]) onKey({ key, stopPropagation: () => { stopped++; } });
        expect(dismissed).toBe(0);
        expect(stopped).toBe(0);
    });
});
