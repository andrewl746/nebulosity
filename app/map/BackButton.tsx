"use client";

import { IconArrowLeft } from "@tabler/icons-react";

/**
 * Back, inside VS Code's panel (owner review, 2026-10-25). The webview has no browser Back, though the Map's moves go
 * into its history as in a browser tab (history.ts), so this goes back one of them. It's disabled at the Map's first
 * entry (historyDepth 0), where going back would take the webview off the Map. A browser tab keeps its own Back, so the
 * Map shows no button there.
 */
export default function BackButton({ enabled }: { enabled: boolean }){
    return (
        <button
            type="button"
            data-testid="back"
            disabled={!enabled}
            onClick={() => window.history.back()}
            aria-label="Back"
            title={enabled ? "Back to where you were" : "Back (nothing to go back to yet)"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-control hover:bg-surface disabled:opacity-35 disabled:hover:bg-transparent"
        >
            <IconArrowLeft aria-hidden size={18} stroke={2} />
        </button>
    );
}
