import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandOf, HELLO_INTERVAL_MS, HELLO_TIMEOUT_MS, startRelay, themeKindOf, themeMessageOf, type RelayEnv } from "./relay";

/**
 * The webview's relay (V1.8 plan P9, P18, Review Focus 2), driven with fake timers and stand-ins for the iframe, the
 * document, the window and VS Code's API. The Map's page is at MAP; the extension's messages reach the webview from its
 * host frame (`window.parent`, VS Code's pre/index.html), at the webview's origin.
 */
const MAP = "http://localhost:3125";
const WEBVIEW = "vscode-webview://1me02rst9hnjb5loc48g7001bsu4m2hri0k7ho1fm8357hot9pl2";
const HELLO = { type: "nebulosity.hello", version: 1 };
const READY = { type: "nebulosity.ready", version: 1 };
const follow = (path: string) => ({ type: "nebulosity.follow", path });

type MessageListener = (e: { source: unknown; origin: string; data: unknown }) => void;
type Call = [unknown, string];

const isHello = ([m]: Call): boolean => (m as { type?: string }).type === "nebulosity.hello";

/**
 * The fake timers, behind the browser's receiver check: Chromium's setInterval and clearInterval throw "Illegal
 * invocation" when called as a method of anything but the window (seen in VS Code's webview), and Node's don't.
 */
function windowTimers(): { setInterval: typeof setInterval; clearInterval: typeof clearInterval } {
    const checked = <F extends (...args: never[]) => unknown>(fn: F): F => function (this: unknown, ...args: Parameters<F>){
        if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
        return fn(...args);
    } as F;
    return { setInterval: checked(setInterval), clearInterval: checked(clearInterval) };
}

/** Starts a relay on stand-ins and gives the handles a test drives it with. */
function harness(withFrame = true, theme: RelayEnv["theme"] = null){
    const contentWindow = { postMessage: vi.fn<(m: unknown, origin: string) => void>() };
    const host = { name: "the webview's host frame (window.parent)" };
    const vscode = { postMessage: vi.fn<(m: unknown) => void>() };
    let onLoad: (() => void) | null = null;
    let onClick: ((e: { target: unknown }) => void) | null = null;
    let onMessage: MessageListener | null = null;
    /** How many messages had reached the iframe when the last load fired. */
    let loadMark = 0;

    startRelay({
        frame: withFrame ? { contentWindow, addEventListener: (_t, f) => { onLoad = f; } } : null,
        document: { addEventListener: (_t, f) => { onClick = f; } },
        window: { addEventListener: (_t, f) => { onMessage = f; } },
        host,
        vscode,
        mapOrigin: withFrame ? MAP : null,
        ...windowTimers(),
        theme,
    });

    const calls = (): Call[] => contentWindow.postMessage.mock.calls;
    return {
        vscode,
        /** Everything posted into the iframe, in order. */
        toMap: calls,
        hellos: () => calls().filter(isHello).length,
        /** The hellos since the last load. */
        hellosSinceLoad: () => calls().slice(loadMark).filter(isHello).length,
        /** What reached the Map since the call at `from`, without the hellos. */
        sentSince: (from: number) => calls().slice(from).filter((call) => !isHello(call)),
        load: () => {
            loadMark = calls().length;
            onLoad?.();
        },
        fromMap: (data: unknown, origin = MAP, source: unknown = contentWindow) => onMessage?.({ source, origin, data }),
        fromExtension: (message: unknown, source: unknown = host) => onMessage?.({ source, origin: WEBVIEW, data: { to: "map", message } }),
        click: (target: unknown) => onClick?.({ target }),
        hasLoadListener: () => onLoad !== null,
    };
}

/** A clicked element whose closest("[data-command]") is an element carrying `command`. */
const inside = (command: string) => ({
    closest: (selector: string) => (selector === "[data-command]" ? { getAttribute: (name: string) => (name === "data-command" ? command : null) } : null),
});

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the hello loop (P9)", () => {
    it("says hello from the iframe's load, every 250 ms, until the Map is ready, and relays the ready", () => {
        const relay = harness();
        vi.advanceTimersByTime(100);
        relay.load();
        const atLoad = relay.toMap().length - 1;
        expect(relay.toMap().slice(atLoad)).toEqual([[HELLO, MAP]]);                              // 0 ms after the load
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.toMap().slice(atLoad)).toEqual([[HELLO, MAP], [HELLO, MAP]]);                // 250 ms
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.toMap().slice(atLoad)).toEqual([[HELLO, MAP], [HELLO, MAP], [HELLO, MAP]]);  // 500 ms

        relay.fromMap(READY);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);
        vi.advanceTimersByTime(5_000);
        expect(relay.hellosSinceLoad()).toBe(3);
    });

    it("says hello from the start too, so a load that came before the relay still ends in a ready", () => {
        const relay = harness();
        // no load ever fires: the Map loaded before this script ran
        expect(relay.toMap()).toEqual([[HELLO, MAP]]);
        vi.advanceTimersByTime(2 * HELLO_INTERVAL_MS);
        expect(relay.toMap()).toEqual([[HELLO, MAP], [HELLO, MAP], [HELLO, MAP]]);
        relay.fromExtension(follow("src/a.ts"));
        expect(relay.sentSince(0)).toEqual([]);

        const before = relay.toMap().length;
        relay.fromMap(READY);
        expect(relay.toMap().slice(before)).toEqual([[follow("src/a.ts"), MAP]]);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);
        vi.advanceTimersByTime(2 * HELLO_TIMEOUT_MS);
        expect(relay.hellos()).toBe(3);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);
    });

    it("relays nothing from another source or origin, and nothing from the Map that isn't the bridge's", () => {
        const relay = harness();
        relay.load();
        relay.fromMap(READY, "http://localhost:3126");
        relay.fromMap(READY, MAP, { postMessage: () => {} });
        // nor anything from the Map before its ready: like the Map, the relay passes nothing before the handshake
        relay.fromMap({ type: "nebulosity.drawn", path: "src", page: 0, selected: null });
        expect(relay.vscode.postMessage).not.toHaveBeenCalled();
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.hellosSinceLoad()).toBe(2);              // still not ready

        relay.fromMap(READY);
        relay.fromMap({ type: "nebulosity.drawn", path: "src", page: 0, selected: null }, "http://localhost:3126");
        // the Map's page can't pass for the relay or for a button
        relay.fromMap({ type: "relay.frameError" });
        relay.fromMap({ command: "indexRepo" });
        relay.fromMap("nebulosity.ready");
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);

        relay.fromMap({ type: "nebulosity.drawn", path: "src", page: 0, selected: null });
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY], [{ type: "nebulosity.drawn", path: "src", page: 0, selected: null }]]);
    });
});

describe("the extension's messages", () => {
    it("wait for ready, in order, and go straight through after it", () => {
        const relay = harness();
        relay.load();
        relay.fromExtension(follow("src/a.ts"));
        relay.fromExtension(follow("src/b.ts"));
        expect(relay.sentSince(0)).toEqual([]);

        const before = relay.toMap().length;
        relay.fromMap(READY);
        expect(relay.toMap().slice(before)).toEqual([[follow("src/a.ts"), MAP], [follow("src/b.ts"), MAP]]);

        relay.fromExtension(follow("src/c.ts"));
        expect(relay.toMap().at(-1)).toEqual([follow("src/c.ts"), MAP]);
    });

    it("keep only the 20 newest while they wait", () => {
        const relay = harness();
        relay.load();
        for (let i = 0; i < 25; i++) relay.fromExtension(follow(`f${i}.ts`));
        const before = relay.toMap().length;
        relay.fromMap(READY);
        expect(relay.toMap().slice(before)).toEqual(Array.from({ length: 20 }, (_, i) => [follow(`f${i + 5}.ts`), MAP]));
    });

    it("are held again after a reload, and the hellos start again", () => {
        const relay = harness();
        relay.load();
        relay.fromMap(READY);
        expect(relay.hellosSinceLoad()).toBe(1);

        relay.load();                                         // the frame reloaded (P8, P9)
        expect(relay.hellosSinceLoad()).toBe(1);
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.hellosSinceLoad()).toBe(2);
        const before = relay.toMap().length;
        relay.fromExtension(follow("src/a.ts"));
        expect(relay.sentSince(before)).toEqual([]);

        relay.fromMap(READY);
        expect(relay.sentSince(before)).toEqual([[follow("src/a.ts"), MAP]]);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY], [READY]]);
        vi.advanceTimersByTime(5_000);
        expect(relay.hellosSinceLoad()).toBe(2);
    });

    it("are delivered once when two hellos both get a ready, and only the first ready is relayed", () => {
        const relay = harness();
        relay.load();
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);            // two hellos out, so the Map can answer twice
        relay.fromExtension(follow("src/a.ts"));
        relay.fromMap(READY);
        relay.fromMap(READY);
        expect(relay.sentSince(0)).toEqual([[follow("src/a.ts"), MAP]]);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);
    });

    it("come only from the webview's host: another frame's message is neither held nor sent", () => {
        const relay = harness();
        relay.load();
        const otherFrame = { name: "another frame in VS Code's window (top[i][0])" };
        relay.fromExtension(follow("src/evil.ts"), otherFrame);
        relay.fromExtension(follow("src/a.ts"));
        const before = relay.toMap().length;
        relay.fromMap(READY);
        // only the host's message was held, so only it is flushed
        expect(relay.toMap().slice(before)).toEqual([[follow("src/a.ts"), MAP]]);

        relay.fromExtension(follow("src/evil.ts"), otherFrame);
        relay.fromExtension(follow("src/evil.ts"), null);
        expect(relay.sentSince(before + 1)).toEqual([]);
    });

    it("are not the Map's: a wrapped message from the iframe itself isn't sent back into it", () => {
        const relay = harness();
        relay.load();
        relay.fromMap(READY);
        const before = relay.toMap().length;
        relay.fromMap({ to: "map", message: follow("src/a.ts") });
        expect(relay.toMap().length).toBe(before);
    });
});

describe("a frame that never answers (P18)", () => {
    it("stops the hellos 60 s after the load and tells the extension once", () => {
        const relay = harness();
        relay.load();
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
        expect(relay.hellosSinceLoad()).toBe(240);            // 0, 250, …, 59,750 ms after the load
        expect(relay.vscode.postMessage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ type: "relay.frameError" }]]);
        vi.advanceTimersByTime(2 * HELLO_TIMEOUT_MS);
        expect(relay.hellosSinceLoad()).toBe(240);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ type: "relay.frameError" }]]);
    });

    it("stops them 60 s after the start when no load ever fires, and tells the extension once", () => {
        const relay = harness();
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
        expect(relay.hellos()).toBe(240);
        expect(relay.vscode.postMessage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ type: "relay.frameError" }]]);
        vi.advanceTimersByTime(2 * HELLO_TIMEOUT_MS);
        expect(relay.hellos()).toBe(240);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ type: "relay.frameError" }]]);
    });

    it("counts the 60 s again from a load, not from the start", () => {
        const relay = harness();
        vi.advanceTimersByTime(30_000);
        relay.load();
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
        expect(relay.vscode.postMessage).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ type: "relay.frameError" }]]);
    });

    it("says nothing when the ready came in time", () => {
        const relay = harness();
        relay.load();
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
        relay.fromMap(READY);
        vi.advanceTimersByTime(2 * HELLO_TIMEOUT_MS);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);
    });
});

describe("the panel's buttons", () => {
    it("post the command of the button clicked", () => {
        const relay = harness();
        relay.click(inside("start"));
        relay.click(inside("showLog"));
        relay.click(inside("indexRepo"));
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ command: "start" }], [{ command: "showLog" }], [{ command: "indexRepo" }]]);
    });

    it("post nothing for another command, or a target with no closest", () => {
        const relay = harness();
        relay.click(inside("other"));
        relay.click({});
        relay.click(null);
        relay.click({ closest: () => null });
        expect(relay.vscode.postMessage).not.toHaveBeenCalled();
    });

    it("commandOf keeps only the three commands", () => {
        expect(commandOf(inside("start"))).toBe("start");
        expect(commandOf(inside("showLog"))).toBe("showLog");
        expect(commandOf(inside("indexRepo"))).toBe("indexRepo");
        expect(commandOf(inside("other"))).toBeNull();
        expect(commandOf(inside("constructor"))).toBeNull();
        expect(commandOf({ closest: "not a function" })).toBeNull();
        expect(commandOf({ closest: () => ({}) })).toBeNull();
        expect(commandOf(undefined)).toBeNull();
    });
});

describe("a state without the Map", () => {
    it("says no hello, and still relays the buttons", () => {
        const relay = harness(false);
        expect(relay.hasLoadListener()).toBe(false);
        relay.fromExtension(follow("src/a.ts"));
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
        expect(relay.toMap()).toEqual([]);
        relay.click(inside("start"));
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ command: "start" }]]);
    });
});

describe("the theme (ADR-070)", () => {
    const DARK = { type: "nebulosity.theme", kind: "dark", colors: { editor: "#121314", side: "#191a1b", fg: "#bfbfbf" } };
    const LIGHT = { type: "nebulosity.theme", kind: "light", colors: { editor: "#ffffff", side: "#fafafd", fg: "#202020" } };

    /** A page whose theme the test changes, as VS Code does when the person picks another. */
    function themed(){
        let current: unknown = DARK;
        let onChange: (() => void) | null = null;
        const relay = harness(true, { read: () => current, watch: (fn) => { onChange = fn; } });
        return { relay, change: (next: unknown) => { current = next; onChange?.(); } };
    }
    const themesSent = (calls: [unknown, string][]): unknown[] => calls.map(([m]) => m).filter((m) => (m as { type?: string }).type === "nebulosity.theme");

    it("sends the theme right after the ready, after the messages held for it, and never before", () => {
        const { relay } = themed();
        relay.load();
        relay.fromExtension(follow("src/a.ts"));
        expect(themesSent(relay.toMap())).toEqual([]);
        const before = relay.toMap().length;
        relay.fromMap(READY);
        expect(relay.toMap().slice(before)).toEqual([[follow("src/a.ts"), MAP], [DARK, MAP]]);
    });

    it("sends it again when VS Code changes the theme, once for each real change", () => {
        const { relay, change } = themed();
        relay.load();
        relay.fromMap(READY);
        change(LIGHT);
        change(LIGHT);
        change(DARK);
        expect(themesSent(relay.toMap())).toEqual([DARK, LIGHT, DARK]);
    });

    it("holds a change made before the Map is ready, and sends the newest at the ready", () => {
        const { relay, change } = themed();
        relay.load();
        change(LIGHT);
        expect(themesSent(relay.toMap())).toEqual([]);
        relay.fromMap(READY);
        expect(themesSent(relay.toMap())).toEqual([LIGHT]);
    });

    it("sends it again to a Map that loaded again, even when the theme is the same", () => {
        const { relay } = themed();
        relay.load();
        relay.fromMap(READY);
        relay.load();
        relay.fromMap(READY);
        expect(themesSent(relay.toMap())).toEqual([DARK, DARK]);
    });

    it("sends nothing while the page has no theme to read", () => {
        const relay = harness(true, { read: () => null, watch: () => {} });
        relay.load();
        relay.fromMap(READY);
        expect(themesSent(relay.toMap())).toEqual([]);
    });
});

describe("themeKindOf", () => {
    it("reads VS Code's data-vscode-theme-kind first, then the body's class", () => {
        expect(themeKindOf("vscode-light", "")).toBe("light");
        expect(themeKindOf("vscode-dark", "vscode-light")).toBe("dark");
        expect(themeKindOf("vscode-high-contrast", "")).toBe("hc");
        expect(themeKindOf("vscode-high-contrast-light", "")).toBe("hc-light");
        expect(themeKindOf(null, "vscode-light")).toBe("light");
        // a high contrast light body carries both classes
        expect(themeKindOf(null, "vscode-high-contrast vscode-high-contrast-light")).toBe("hc-light");
        expect(themeKindOf(null, "vscode-high-contrast")).toBe("hc");
        expect(themeKindOf(null, "")).toBe("dark");
    });
});

describe("themeMessageOf", () => {
    /** A page's --vscode-* variables, as getComputedStyle reads them (with the spaces it may leave in). */
    const page = (vars: Record<string, string>) => (name: string): string => vars[name] ?? "";

    it("reads the colors the Map takes, and leaves out the ones the theme doesn't set", () => {
        const read = page({
            "--vscode-editor-background": " #121314", "--vscode-sideBar-background": "#191a1b", "--vscode-foreground": "#bfbfbf",
            "--vscode-widget-border": "#2a2b2c", "--vscode-panel-border": "#333333", "--vscode-descriptionForeground": "#8c8c8c",
        });
        expect(themeMessageOf(read, "dark")).toEqual({
            type: "nebulosity.theme", kind: "dark",
            colors: { editor: "#121314", side: "#191a1b", fg: "#bfbfbf", border: "#2a2b2c", desc: "#8c8c8c" },
        });
    });

    it("takes the panel's border, then the side bar's, when a widget's isn't set", () => {
        const base = { "--vscode-editor-background": "#002b36", "--vscode-sideBar-background": "#00212b", "--vscode-foreground": "#cccccc" };
        expect(themeMessageOf(page({ ...base, "--vscode-panel-border": "rgba(128, 128, 128, 0.35)", "--vscode-sideBar-border": "#111111" }), "dark")?.colors.border)
            .toBe("rgba(128, 128, 128, 0.35)");
        expect(themeMessageOf(page({ ...base, "--vscode-sideBar-border": "#111111" }), "dark")?.colors.border).toBe("#111111");
        expect(themeMessageOf(page(base), "dark")?.colors.border).toBeUndefined();
    });

    it("takes the high contrast border first on a high contrast theme, and only there", () => {
        const vars = { "--vscode-editor-background": "#000000", "--vscode-sideBar-background": "#000000", "--vscode-foreground": "#ffffff",
            "--vscode-contrastBorder": "#6fc3df", "--vscode-widget-border": "#222222" };
        expect(themeMessageOf(page(vars), "hc")?.colors.border).toBe("#6fc3df");
        expect(themeMessageOf(page(vars), "dark")?.colors.border).toBe("#222222");
    });

    it("gives null without the editor's, the side bar's or the text's color", () => {
        const full = { "--vscode-editor-background": "#000000", "--vscode-sideBar-background": "#000000", "--vscode-foreground": "#ffffff" };
        for (const missing of Object.keys(full)){
            const vars: Record<string, string> = { ...full, [missing]: "  " };
            expect(themeMessageOf(page(vars), "dark"), missing).toBeNull();
        }
    });
});
