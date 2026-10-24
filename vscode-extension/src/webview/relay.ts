/**
 * The webview's own script (design §4.4, V1.8 plan P9, P18). The panel's page loads it in every state:
 * - in the `map` state it carries the editor bridge (API_CONTRACTS §20) between the extension and the Map's iframe, which
 *   is cross-origin to the webview, so the two can only talk by postMessage;
 * - in every state it turns a click on a button's `data-command` into a message to the extension, since the CSP allows
 *   no inline handler.
 * startRelay takes everything it touches as arguments, so it's tested in Node with stand-ins; the lines at the bottom
 * start it on the real page.
 */

/** How often the relay says hello until the Map answers: the iframe's `load` fires before React's listener exists. */
export const HELLO_INTERVAL_MS = 250;

/** How long it keeps trying. A frame that loaded and never answers is a Map that's gone (P18). */
export const HELLO_TIMEOUT_MS = 60_000;

/** The extension's messages kept while the Map isn't ready: the newest 20, in order. */
const HELD_LIMIT = 20;

/** What the panel's buttons ask the extension to do. */
export type RelayCommand = "start" | "showLog" | "indexRepo";

/** The commands as a record, so adding one to RelayCommand and not here (or the reverse) doesn't compile. */
const COMMANDS: Record<RelayCommand, true> = { start: true, showLog: true, indexRepo: true };

/** The parts of the page the relay uses. `frame` and `mapOrigin` are null outside the `map` state. */
export type RelayEnv = {
    frame: { contentWindow: { postMessage(m: unknown, origin: string): void } | null; addEventListener(t: "load", f: () => void): void } | null;
    document: { addEventListener(t: "click", f: (e: { target: unknown }) => void): void };
    window: { addEventListener(t: "message", f: (e: { source: unknown; origin: string; data: unknown }) => void): void };
    vscode: { postMessage(m: unknown): void };
    mapOrigin: string | null;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The `data-command` of the clicked element's nearest `[data-command]` ancestor (or itself), when it's one of the three. */
export function commandOf(target: unknown): RelayCommand | null {
    if (!isObject(target) || typeof target.closest !== "function") return null;
    const element: unknown = target.closest("[data-command]");
    if (!isObject(element) || typeof element.getAttribute !== "function") return null;
    const command: unknown = element.getAttribute("data-command");
    return typeof command === "string" && Object.hasOwn(COMMANDS, command) ? (command as RelayCommand) : null;
}

/** A message from the Map's page that the relay passes on: one of the bridge's (API_CONTRACTS §20), by its type's prefix. */
const isBridgeMessage = (data: unknown): data is { type: string } => isObject(data) && typeof data.type === "string" && data.type.startsWith("nebulosity.");

export function startRelay(env: RelayEnv): void {
    // the timers are taken out of env and called on their own: called as env.setInterval(…), the window's own timer
    // throws "Illegal invocation" in Chromium (its receiver must be the window), which stopped every hello
    const { frame, mapOrigin, vscode, setInterval: every, clearInterval: stopEvery } = env;

    env.document.addEventListener("click", (e) => {
        const command = commandOf(e.target);
        if (command !== null) vscode.postMessage({ command });
    });

    if (frame === null || mapOrigin === null) return;

    /** True from the Map's first `ready` after a load until the next load. */
    let ready = false;
    let held: unknown[] = [];
    let hello: ReturnType<typeof setInterval> | null = null;
    let giveUp: ReturnType<typeof setInterval> | null = null;

    const toMap = (message: unknown): void => frame.contentWindow?.postMessage(message, mapOrigin);
    const stopHello = (): void => {
        if (hello !== null) stopEvery(hello);
        if (giveUp !== null) stopEvery(giveUp);
        hello = giveUp = null;
    };

    // Every load is a new page (the first one, a reload in the panel, a Map restarted under it), so the handshake starts
    // again, and the extension's messages wait for it. The timers are intervals, and the timeout is one too, set before
    // the hellos so that at 60 s it runs first: a hidden webview runs its timers about once a second, so the time is
    // kept by the timer, never by counting hellos.
    frame.addEventListener("load", () => {
        stopHello();
        ready = false;
        giveUp = every(() => {
            stopHello();
            vscode.postMessage({ type: "relay.frameError" });
        }, HELLO_TIMEOUT_MS);
        hello = every(() => toMap({ type: "nebulosity.hello", version: 1 }), HELLO_INTERVAL_MS);
        toMap({ type: "nebulosity.hello", version: 1 });
    });

    env.window.addEventListener("message", (e) => {
        if (e.source === frame.contentWindow && e.source !== null){
            // the Map's page, at its own origin, and only the bridge's messages: it can't pass for a button or the relay
            if (e.origin !== mapOrigin || !isBridgeMessage(e.data)) return;
            if (e.data.type === "nebulosity.ready"){
                // the hellos still in flight can get a second answer: one ready per load, so the queue is sent once and
                // the extension follows once
                if (ready) return;
                ready = true;
                stopHello();
                for (const message of held) toMap(message);
                held = [];
            } else if (!ready) return;
            vscode.postMessage(e.data);
            return;
        }
        // anything else is the extension, through the webview's host: { to: "map", message }
        const data = e.data;
        if (!isObject(data) || data.to !== "map" || !isObject(data.message)) return;
        if (ready){
            toMap(data.message);
            return;
        }
        held.push(data.message);
        if (held.length > HELD_LIMIT) held.shift();
    });
}

/**
 * The page's own globals, typed here so this file needs no DOM types. In a webview `acquireVsCodeApi` exists; in Node
 * (the tests) it doesn't, so nothing below runs there.
 */
type WebviewGlobals = {
    acquireVsCodeApi?: () => RelayEnv["vscode"];
    document: RelayEnv["document"] & {
        querySelector(selector: "iframe"): RelayEnv["frame"];
        querySelector(selector: "script[data-map-origin]"): { getAttribute(name: string): string | null } | null;
    };
    window: RelayEnv["window"];
};

const page = globalThis as unknown as WebviewGlobals;
if (typeof page.acquireVsCodeApi === "function"){
    startRelay({
        // the script tag comes after the iframe, so the frame is already in the document
        frame: page.document.querySelector("iframe"),
        document: page.document,
        window: page.window,
        vscode: page.acquireVsCodeApi(),
        // the relay's own tag names the Map's origin; only the map state's tag carries the attribute
        mapOrigin: page.document.querySelector("script[data-map-origin]")?.getAttribute("data-map-origin") ?? null,
        setInterval,
        clearInterval,
    });
}
