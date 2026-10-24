import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandOf, HELLO_INTERVAL_MS, HELLO_TIMEOUT_MS, startRelay } from "./relay";

/**
 * The webview's relay (V1.8 plan P9, P18, Review Focus 2), driven with fake timers and stand-ins for the iframe, the
 * document, the window and VS Code's API. The Map's page is at MAP; the extension's messages reach the webview from its
 * own host frame, at the webview's origin.
 */
const MAP = "http://localhost:3125";
const WEBVIEW = "vscode-webview://1me02rst9hnjb5loc48g7001bsu4m2hri0k7ho1fm8357hot9pl2";
const HELLO = { type: "nebulosity.hello", version: 1 };
const READY = { type: "nebulosity.ready", version: 1 };
const follow = (path: string) => ({ type: "nebulosity.follow", path });

type MessageListener = (e: { source: unknown; origin: string; data: unknown }) => void;

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
function harness(withFrame = true){
    const contentWindow = { postMessage: vi.fn<(m: unknown, origin: string) => void>() };
    const host = { name: "the webview's host frame" };
    const vscode = { postMessage: vi.fn<(m: unknown) => void>() };
    let onLoad: (() => void) | null = null;
    let onClick: ((e: { target: unknown }) => void) | null = null;
    let onMessage: MessageListener | null = null;

    startRelay({
        frame: withFrame ? { contentWindow, addEventListener: (_t, f) => { onLoad = f; } } : null,
        document: { addEventListener: (_t, f) => { onClick = f; } },
        window: { addEventListener: (_t, f) => { onMessage = f; } },
        vscode,
        mapOrigin: withFrame ? MAP : null,
        ...windowTimers(),
    });

    return {
        vscode,
        /** Everything posted into the iframe, in order. */
        toMap: () => contentWindow.postMessage.mock.calls,
        hellos: () => contentWindow.postMessage.mock.calls.filter(([m]) => (m as { type?: string }).type === "nebulosity.hello").length,
        /** What reached the Map since the call at `from`, without the hellos. */
        sentSince: (from: number) => contentWindow.postMessage.mock.calls.slice(from).filter(([m]) => (m as { type?: string }).type !== "nebulosity.hello"),
        load: () => onLoad?.(),
        fromMap: (data: unknown, origin = MAP, source: unknown = contentWindow) => onMessage?.({ source, origin, data }),
        fromExtension: (message: unknown) => onMessage?.({ source: host, origin: WEBVIEW, data: { to: "map", message } }),
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
        vi.advanceTimersByTime(1_000);
        expect(relay.hellos()).toBe(0);                       // nothing before the frame has loaded

        relay.load();
        expect(relay.toMap()).toEqual([[HELLO, MAP]]);        // 0 ms
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.toMap()).toEqual([[HELLO, MAP], [HELLO, MAP]]);                    // 250 ms
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.toMap()).toEqual([[HELLO, MAP], [HELLO, MAP], [HELLO, MAP]]);      // 500 ms

        relay.fromMap(READY);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY]]);
        vi.advanceTimersByTime(5_000);
        expect(relay.hellos()).toBe(3);
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
        expect(relay.hellos()).toBe(2);                       // still not ready

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
        expect(relay.hellos()).toBe(1);

        relay.load();                                         // the frame reloaded (P8, P9)
        expect(relay.hellos()).toBe(2);
        vi.advanceTimersByTime(HELLO_INTERVAL_MS);
        expect(relay.hellos()).toBe(3);
        const before = relay.toMap().length;
        relay.fromExtension(follow("src/a.ts"));
        expect(relay.sentSince(before)).toEqual([]);

        relay.fromMap(READY);
        expect(relay.sentSince(before)).toEqual([[follow("src/a.ts"), MAP]]);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[READY], [READY]]);
        vi.advanceTimersByTime(5_000);
        expect(relay.hellos()).toBe(3);
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
    it("stops the hellos at 60 s and tells the extension once", () => {
        const relay = harness();
        relay.load();
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
        expect(relay.hellos()).toBe(240);                     // 0, 250, …, 59,750 ms
        expect(relay.vscode.postMessage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(relay.vscode.postMessage.mock.calls).toEqual([[{ type: "relay.frameError" }]]);
        vi.advanceTimersByTime(2 * HELLO_TIMEOUT_MS);
        expect(relay.hellos()).toBe(240);
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
