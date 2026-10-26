import { BRIDGE_VERSION, type BridgeFromMap, type BridgeToMap } from "@/lib/contracts";

/**
 * The Map's side of the editor bridge (docs/API_CONTRACTS.md §20): when the Map is framed in a VS Code webview
 * (`?embed=vscode`), the webview and the Map exchange window.postMessage messages. Everything here is pure or takes
 * the window it works on, so the guards can be tested without a browser. The Map's own pages never create a bridge:
 * without `?embed=vscode` nothing listens or posts.
 */

/** A webview's origin is `vscode-webview://<id>` (recorded by the V1.8 spike). */
const ORIGIN_PREFIX = "vscode-webview://";
const MAX_PATH_LENGTH = 1024;
const MAX_HIGHLIGHT = 50;
/**
 * A `highlight`'s entries read at most. Stopping at 50 kept isn't enough on its own: a sparse array of length 2^32 - 1
 * survives structured clone, and with fewer than 50 strings in it a scan to its end held the main thread for over two
 * minutes (measured in Node). The editor sends at most 50 (design §4.5), so a thousand leaves room to spare.
 */
const MAX_SCAN = 1000;

/** True only for `?embed=vscode`; the flag is what turns the bridge on. */
export function isEmbedded(search: string): boolean {
    return new URLSearchParams(search).get("embed") === "vscode";
}

const isPath = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_PATH_LENGTH;
/** A path to jump to, never "": the repo is no editor's file, and focus("") would push the top level onto the history. */
const isTarget = (value: unknown): value is string => isPath(value) && value !== "";

/**
 * Reads a message the editor sent, checking every field's type: anything that is not exactly one of §20's messages is
 * null, and a result carries only the fields checked. A `follow` or `show` with an empty path is null. A `highlight`
 * keeps its first 50 paths and drops entries that are not paths (not strings, or over 1,024 characters) rather than
 * refusing the message; it reads no further than its first 1,000 entries. A hello of another bridge version is null: a
 * Map that gets another version ignores the hello.
 */
export function parseToMap(data: unknown): BridgeToMap | null {
    if (typeof data !== "object" || data === null) return null;
    const message = data as Record<string, unknown>;
    switch (message.type){
        case "nebulosity.hello":
            return message.version === BRIDGE_VERSION ? { type: "nebulosity.hello", version: BRIDGE_VERSION } : null;
        case "nebulosity.follow":
            return isTarget(message.path) ? { type: "nebulosity.follow", path: message.path } : null;
        case "nebulosity.show":
            return isTarget(message.path) ? { type: "nebulosity.show", path: message.path } : null;
        case "nebulosity.highlight": {
            if (!Array.isArray(message.paths)) return null;
            const entries: unknown[] = message.paths;
            const paths: string[] = [];
            // the loop ends at 50 kept or 1,000 read, whichever comes first, whatever the array's length claims
            for (let i = 0; i < Math.min(entries.length, MAX_SCAN) && paths.length < MAX_HIGHLIGHT; i++){
                const entry = entries[i];
                if (isPath(entry)) paths.push(entry);
            }
            return { type: "nebulosity.highlight", paths };
        }
        case "nebulosity.clear":
            return { type: "nebulosity.clear" };
        default:
            return null;
    }
}

/** The parts of `window` the bridge uses; the real window fits it, and tests pass a stand-in. */
export type BridgeWindow = {
    parent: { postMessage(message: unknown, targetOrigin: string): void };
    addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
    removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
};

export type EditorBridge = {
    /** Posts to the webview; does nothing before the handshake. */
    post(message: BridgeFromMap): void;
    /** True once a hello has been answered. */
    connected(): boolean;
    dispose(): void;
};

/**
 * Starts listening for the editor. A `hello` counts only when it comes from `win.parent` at a `vscode-webview://` origin;
 * the bridge then keeps that origin, answers `ready` and, right after it, posts what `onReady` returns (the `drawn` of
 * the level on screen, for a hello that landed after the level was drawn; null posts nothing). From then on it posts only
 * to that origin and hears only that source and origin, passing every other message to `onMessage` once parsed. A later
 * hello from the parent re-handshakes (the webview reloaded), and so answers `ready` and `onReady` again.
 */
export function createBridge(win: BridgeWindow, onMessage: (message: BridgeToMap) => void, onReady?: () => BridgeFromMap | null): EditorBridge {
    let origin: string | null = null;

    const post = (message: BridgeFromMap): void => {
        // targetOrigin is the kept origin, so a message can't reach a page that replaced the webview
        if (origin !== null) win.parent.postMessage(message, origin);
    };

    const onWindowMessage = (event: MessageEvent): void => {
        // who sent it is checked before what it says, so nothing from another window or a non-webview origin is read
        if (event.source !== win.parent || !event.origin.startsWith(ORIGIN_PREFIX)) return;
        const message = parseToMap(event.data);
        if (message === null) return;
        if (message.type === "nebulosity.hello"){
            origin = event.origin;
            post({ type: "nebulosity.ready", version: BRIDGE_VERSION });
            const drawn = onReady?.() ?? null;
            if (drawn !== null) post(drawn);
            return;
        }
        if (origin === null || event.origin !== origin) return;
        onMessage(message);
    };

    win.addEventListener("message", onWindowMessage);
    return {
        post,
        connected: () => origin !== null,
        dispose(){
            win.removeEventListener("message", onWindowMessage);
            origin = null;                // a disposed bridge is inert, even to a caller still holding it
        },
    };
}
