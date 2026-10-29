"use client";

import { IconArrowLeft } from "@tabler/icons-react";

/**
 * Back, first inside VS Code's panel (owner review, 2026-10-25), whose webview has no browser Back, and since
 * 2026-10-29 in the browser and the demo too, so the Map has one Back everywhere (the owner). The Map's moves go into
 * the history (history.ts), so this goes back one of them. It's disabled at the Map's first entry (historyDepth 0),
 * where going back would take the webview off the Map, or a browser tab to the page before it.
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
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text hover:bg-node max-[360px]:w-6 disabled:opacity-35 disabled:hover:bg-transparent"
        >
            <IconArrowLeft aria-hidden size={18} stroke={2} />
        </button>
    );
}
