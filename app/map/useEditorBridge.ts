"use client";

import { useEffect, useRef } from "react";
import type { BridgeFromMap, BridgeToMap } from "@/lib/contracts";
import { createBridge, isEmbedded, type BridgeWindow } from "./embed";
import { DEMO } from "./mode";

/**
 * True when the Map is framed in VS Code's panel (`?embed=vscode`, API_CONTRACTS §20). Read once, when the page loads:
 * the address keeps the flag through every move and reload (history.ts), so it holds for the page's life. Never on the
 * server, which has no address, and never in the static demo, which has no editor to talk to.
 */
export const EMBEDDED = !DEMO && typeof window !== "undefined" && isEmbedded(window.location.search);

type Handlers = { onMessage: (message: BridgeToMap) => void; onReady: () => BridgeFromMap | null };

export type EditorLink = {
    /** Makes these the handlers the bridge calls; the function returned lets go of them. */
    attach(handlers: Handlers): () => void;
    post(message: BridgeFromMap): void;
};

/**
 * The page's one bridge, and the Map it calls now. After `ready` the webview stops saying hello (V1.8 plan P9), so a
 * bridge made again (an effect that re-ran, a Map that mounted again) would never be pinned and the panel would stop
 * syncing without a word. So the bridge is made once and never disposed, and each Map that mounts only attaches to
 * it. While none is attached, the editor's messages are dropped and a hello gets its `ready` alone.
 */
export function createEditorLink(win: BridgeWindow): EditorLink {
    let current: Handlers | null = null;
    const bridge = createBridge(win, (message) => current?.onMessage(message), () => current?.onReady() ?? null);
    return {
        attach(handlers){
            current = handlers;
            // a Map that lets go after the next one attached leaves that one attached
            return () => { if (current === handlers) current = null; };
        },
        post: (message) => bridge.post(message),
    };
}

// Made by the first Map that mounts embedded, after its handlers exist: a `ready` sent sooner would let the
// messages the webview held for it (P9) arrive with nobody to hear them.
let link: EditorLink | null = null;
const poster = { post: (message: BridgeFromMap): void => link?.post(message) };

/**
 * The Map's end of the editor bridge: `onMessage` gets what the editor sends, and `onReady` gives what to post right
 * after each `ready` (the `drawn` of the level on screen, or null). Like `useLive`, it always calls the newest of each.
 * Null in a browser tab, where nothing listens or posts; inside VS Code's panel, the same `post` for the page's life.
 */
export function useEditorBridge(
    onMessage: (message: BridgeToMap) => void,
    onReady: () => BridgeFromMap | null,
): { post(message: BridgeFromMap): void } | null {
    const onMessageRef = useRef(onMessage);
    const onReadyRef = useRef(onReady);

    useEffect(() => {
        onMessageRef.current = onMessage;
        onReadyRef.current = onReady;
    }, [onMessage, onReady]);

    useEffect(() => {
        if (!EMBEDDED) return;
        link ??= createEditorLink(window);
        return link.attach({ onMessage: (message) => onMessageRef.current(message), onReady: () => onReadyRef.current() });
    }, []);

    return EMBEDDED ? poster : null;
}
