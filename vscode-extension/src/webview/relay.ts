import { isObjectLike } from "../guards";

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

/** The theme kinds the Map knows (lib/contracts.ts's ThemeKind). */
type ThemeKind = "dark" | "light" | "hc" | "hc-light";

/**
 * The theme's kind as VS Code marks the webview's body: its `data-vscode-theme-kind`, else its class
 * (`vscode-high-contrast-light` before `vscode-high-contrast`, since a high contrast light body carries both). Dark when
 * neither says.
 */
export function themeKindOf(kindAttribute: string | null, className: string): ThemeKind {
    const NAMED: Record<string, ThemeKind> = {
        "vscode-high-contrast-light": "hc-light", "vscode-high-contrast": "hc", "vscode-light": "light", "vscode-dark": "dark",
    };
    if (kindAttribute !== null && Object.hasOwn(NAMED, kindAttribute)) return NAMED[kindAttribute];
    const classes = ` ${className} `;
    const marked = Object.keys(NAMED).find((name) => classes.includes(` ${name} `));
    return marked === undefined ? "dark" : NAMED[marked];
}

/**
 * The theme message for the Map (API_CONTRACTS §20's `nebulosity.theme`, ADR-070): VS Code's colors read from the
 * webview's `--vscode-*` variables by `read` (an empty string for one the theme doesn't set). The border is the high
 * contrast border on a high contrast theme, else the first of a widget's, the panel's and the side bar's that's set.
 * Null without the editor's, the side bar's or the text's color, which every theme sets.
 */
export function themeMessageOf(read: (name: string) => string, kind: ThemeKind): { type: "nebulosity.theme"; kind: ThemeKind; colors: Record<string, string> } | null {
    const value = (name: string): string => read(`--vscode-${name}`).trim();
    const first = (...names: string[]): string => names.map(value).find((v) => v !== "") ?? "";
    const colors: Record<string, string> = { editor: value("editor-background"), side: value("sideBar-background"), fg: value("foreground") };
    if (colors.editor === "" || colors.side === "" || colors.fg === "") return null;
    const hc = kind === "hc" || kind === "hc-light";
    const optional = {
        border: hc ? first("contrastBorder", "widget-border", "panel-border", "sideBar-border") : first("widget-border", "panel-border", "sideBar-border"),
        desc: value("descriptionForeground"),
        focus: value("focusBorder"),
    };
    for (const [name, color] of Object.entries(optional)) if (color !== "") colors[name] = color;
    return { type: "nebulosity.theme", kind, colors };
}

/**
 * The parts of the page the relay uses. `frame` and `mapOrigin` are null outside the `map` state. `host` is the window
 * of VS Code's own frame around this page (pre/index.html), which delivers the extension's messages. `theme` reads the
 * theme message as it is now and calls back whenever VS Code changes the theme; null where there's none to read.
 */
export type RelayEnv = {
    frame: { contentWindow: { postMessage(m: unknown, origin: string): void } | null; addEventListener(t: "load", f: () => void): void } | null;
    document: { addEventListener(t: "click", f: (e: { target: unknown }) => void): void };
    window: { addEventListener(t: "message", f: (e: { source: unknown; origin: string; data: unknown }) => void): void };
    host: unknown;
    vscode: { postMessage(m: unknown): void };
    mapOrigin: string | null;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    theme?: { read(): unknown; watch(onChange: () => void): void } | null;
};

/** The `data-command` of the clicked element's nearest `[data-command]` ancestor (or itself), when it's one of the three. */
export function commandOf(target: unknown): RelayCommand | null {
    if (!isObjectLike(target) || typeof target.closest !== "function") return null;
    const element: unknown = target.closest("[data-command]");
    if (!isObjectLike(element) || typeof element.getAttribute !== "function") return null;
    const command: unknown = element.getAttribute("data-command");
    return typeof command === "string" && Object.hasOwn(COMMANDS, command) ? (command as RelayCommand) : null;
}

/** A message from the Map's page that the relay passes on: one of the bridge's (API_CONTRACTS §20), by its type's prefix. */
const isBridgeMessage = (data: unknown): data is { type: string } => isObjectLike(data) && typeof data.type === "string" && data.type.startsWith("nebulosity.");

export function startRelay(env: RelayEnv): void {
    // the timers are taken out of env and called on their own: called as env.setInterval(…), the window's own timer
    // throws "Illegal invocation" in Chromium (its receiver must be the window), which stopped every hello
    const { frame, mapOrigin, host, vscode, setInterval: every, clearInterval: stopEvery } = env;

    env.document.addEventListener("click", (e) => {
        const command = commandOf(e.target);
        if (command !== null) vscode.postMessage({ command });
    });

    if (frame === null || mapOrigin === null) return;

    /** True from the Map's first `ready` after a load until the next load. */
    let ready = false;
    let held: unknown[] = [];
    /** The theme message the Map was last sent since its `ready`, as JSON: a change VS Code reports twice is sent once. */
    let themeSent: string | null = null;
    let hello: ReturnType<typeof setInterval> | null = null;
    let giveUp: ReturnType<typeof setInterval> | null = null;

    const toMap = (message: unknown): void => frame.contentWindow?.postMessage(message, mapOrigin);
    // The theme goes to a ready Map only: right after each `ready`, then whenever VS Code changes it. Before that it would
    // land on the frame's blank page or a Map not listening yet.
    const sendTheme = (): void => {
        if (!ready || !env.theme) return;
        const message = env.theme.read();
        if (message === null || message === undefined) return;
        const json = JSON.stringify(message);
        if (json === themeSent) return;
        themeSent = json;
        toMap(message);
    };
    env.theme?.watch(sendTheme);
    const stopHello = (): void => {
        if (hello !== null) stopEvery(hello);
        if (giveUp !== null) stopEvery(giveUp);
        hello = giveUp = null;
    };

    // The handshake (re)starts the hellos and the 60 s give-up. The timers are intervals, and the give-up is one too, set
    // before the hellos so that at 60 s it runs first: a hidden webview runs its timers about once a second, so the time
    // is kept by the timer, never by counting hellos.
    const startHello = (): void => {
        stopHello();
        ready = false;
        giveUp = every(() => {
            stopHello();
            vscode.postMessage({ type: "relay.frameError" });
        }, HELLO_TIMEOUT_MS);
        hello = every(() => toMap({ type: "nebulosity.hello", version: 1 }), HELLO_INTERVAL_MS);
        toMap({ type: "nebulosity.hello", version: 1 });
    };

    // Every load is a new page (the first one, a reload in the panel, a Map restarted under it), so the handshake starts
    // again, and the extension's messages wait for it. It also starts now: the script comes after the iframe, and a warm
    // Map can finish loading before the script has run, a load nobody heard. Until the Map's page is there, those hellos
    // go to the frame's blank page, whose origin doesn't match, and the browser drops them (with a console line).
    frame.addEventListener("load", startHello);
    startHello();

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
                // every load is a new page with Dark 2026 again, so it gets the theme again
                themeSent = null;
                sendTheme();
            } else if (!ready) return;
            vscode.postMessage(e.data);
            return;
        }
        // the extension's messages, { to: "map", message }, come only from the webview's host. Any other frame in VS Code's
        // window can reach this one (top[i][0]) and post here too, and must not drive the Map as if it were the editor.
        if (e.source !== host || host === null || host === undefined) return;
        const data = e.data;
        if (!isObjectLike(data) || data.to !== "map" || !isObjectLike(data.message)) return;
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
type PageElement = { getAttribute(name: string): string | null; className: string };
type WebviewGlobals = {
    acquireVsCodeApi?: () => RelayEnv["vscode"];
    document: RelayEnv["document"] & {
        querySelector(selector: "iframe"): RelayEnv["frame"];
        querySelector(selector: "script[data-map-origin]"): { getAttribute(name: string): string | null } | null;
        documentElement: PageElement;
        body: PageElement;
    };
    window: RelayEnv["window"] & { parent: unknown; frameElement: { ownerDocument: { defaultView: unknown } | null } | null };
    getComputedStyle(element: PageElement): { getPropertyValue(name: string): string };
    MutationObserver: new (callback: () => void) => { observe(target: PageElement, options: { attributes: true; attributeFilter: string[] }): void };
};

/**
 * The page's theme, read and watched (ADR-070). VS Code writes the theme's colors as `--vscode-*` variables in `<html>`'s
 * style and marks its kind on `<body>`, and rewrites both when the theme changes, so the watch is on those attributes.
 */
function pageTheme(globals: WebviewGlobals): NonNullable<RelayEnv["theme"]> {
    const { document: doc } = globals;
    return {
        read: () => {
            const style = globals.getComputedStyle(doc.documentElement);
            return themeMessageOf((name) => style.getPropertyValue(name), themeKindOf(doc.body.getAttribute("data-vscode-theme-kind"), doc.body.className));
        },
        watch: (onChange) => {
            const observer = new globals.MutationObserver(onChange);
            observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["style"] });
            observer.observe(doc.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-kind"] });
        },
    };
}

/**
 * The window that holds this page's frame: the extension's messages come from it. Not `window.parent`: VS Code writes
 * this page into its frame with document.write, and in VS Code 1.143.1 the host's messages came from the frame
 * element's owner window, which wasn't `window.parent` as this page saw it (measured over CDP: a `source ===
 * window.parent` check dropped every message from the extension). `window.parent` stays the fallback for a host
 * that's cross-origin, where frameElement is null.
 */
function hostWindow(win: WebviewGlobals["window"]): unknown {
    return win.frameElement?.ownerDocument?.defaultView ?? win.parent;
}

const page = globalThis as unknown as WebviewGlobals;
if (typeof page.acquireVsCodeApi === "function"){
    startRelay({
        // the script tag comes after the iframe, so the frame is already in the document
        frame: page.document.querySelector("iframe"),
        document: page.document,
        window: page.window,
        host: hostWindow(page.window),
        vscode: page.acquireVsCodeApi(),
        // the relay's own tag names the Map's origin; only the map state's tag carries the attribute
        mapOrigin: page.document.querySelector("script[data-map-origin]")?.getAttribute("data-map-origin") ?? null,
        setInterval,
        clearInterval,
        theme: pageTheme(page),
    });
}
