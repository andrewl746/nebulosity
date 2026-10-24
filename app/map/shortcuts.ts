/** What a key press does on the Map; null when it does nothing. */
export type MapShortcut =
    | { type: "search" }
    | { type: "help" }
    | { type: "deselect" }
    | { type: "clear-highlights" }
    | { type: "up" }
    | { type: "page"; page: number }
    | null;

export type ShortcutState = {
    /** Focus is in a text field. */
    typing: boolean;
    /** A dialog is open over the Map: the source viewer, the help, or the search palette. */
    dialogOpen: boolean;
    levelPath: string;
    page: number;
    pageCount: number;
    /** A box is selected. */
    selected: boolean;
    /** Claude Code has highlighted something with show_on_map. */
    highlighted: boolean;
};

/**
 * The Map's keyboard (HelpDialog's "Keyboard" list). Ctrl K or ⌘K opens search from anywhere. Every other key is the
 * Map's only while nothing is being typed and no dialog is open: with the source viewer open, Backspace or an arrow
 * would otherwise move the Map underneath and close the viewer with the panel it belongs to (second review I2).
 * Escape inside a dialog closes just that dialog; the dialogs handle it themselves.
 */
export function mapShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }, state: ShortcutState): MapShortcut {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") return { type: "search" };
    if (state.typing || state.dialogOpen) return null;
    switch (event.key){
        case "?": return { type: "help" };
        // Esc lets go of one thing at a time: the selection first, then Claude Code's highlights
        case "Escape": return state.selected ? { type: "deselect" } : state.highlighted ? { type: "clear-highlights" } : null;
        case "Backspace": return state.levelPath !== "" ? { type: "up" } : null;
        case "ArrowLeft": return state.page > 0 ? { type: "page", page: state.page - 1 } : null;
        case "ArrowRight": return state.page < state.pageCount - 1 ? { type: "page", page: state.page + 1 } : null;
        default: return null;
    }
}
