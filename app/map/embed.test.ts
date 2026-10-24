import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { BridgeFromMap, BridgeToMap } from "@/lib/contracts";
import { createBridge, isEmbedded, parseToMap, type BridgeWindow } from "./embed";

const HELLO = { type: "nebulosity.hello", version: 1 };
const READY = { type: "nebulosity.ready", version: 1 };
const DRAWN: BridgeFromMap = { type: "nebulosity.drawn", path: "", page: 0, selected: null };
const WEBVIEW = "vscode-webview://abc";

/** A window stand-in: `parent` records what is posted to it, and the listener is kept so a test can fire message events. */
function setup(onReady?: () => BridgeFromMap | null){
    const parent = { postMessage: vi.fn() };
    const listeners = new Set<(e: MessageEvent) => void>();
    const win: BridgeWindow = {
        parent,
        addEventListener: (_type, fn) => { listeners.add(fn); },
        removeEventListener: (_type, fn) => { listeners.delete(fn); },
    };
    const heard: BridgeToMap[] = [];
    const bridge = createBridge(win, (message) => heard.push(message), onReady);
    const fire = (source: unknown, origin: string, data: unknown) => {
        for (const fn of [...listeners]) fn({ source, origin, data } as unknown as MessageEvent);
    };
    return { parent, listeners, heard, bridge, fire };
}

describe("isEmbedded (the bridge listens and posts only inside the editor's panel)", () => {
    it("is true only for embed=vscode", () => {
        expect(isEmbedded("?embed=vscode")).toBe(true);
        expect(isEmbedded("?path=src&embed=vscode")).toBe(true);
        expect(isEmbedded("")).toBe(false);
        expect(isEmbedded("?embed=browser")).toBe(false);
        expect(isEmbedded("?embed=")).toBe(false);
    });
});

describe("parseToMap (API_CONTRACTS §20: every field's type is checked)", () => {
    it("reads each message the editor can send", () => {
        expect(parseToMap(HELLO)).toEqual(HELLO);
        expect(parseToMap({ type: "nebulosity.follow", path: "src/a.ts" })).toEqual({ type: "nebulosity.follow", path: "src/a.ts" });
        expect(parseToMap({ type: "nebulosity.show", path: "src/a.ts" })).toEqual({ type: "nebulosity.show", path: "src/a.ts" });
        expect(parseToMap({ type: "nebulosity.highlight", paths: ["a.ts", "b.ts"] })).toEqual({ type: "nebulosity.highlight", paths: ["a.ts", "b.ts"] });
        expect(parseToMap({ type: "nebulosity.clear" })).toEqual({ type: "nebulosity.clear" });
    });

    it("gives null for anything else", () => {
        expect(parseToMap(null)).toBeNull();
        expect(parseToMap(undefined)).toBeNull();
        expect(parseToMap("nebulosity.clear")).toBeNull();
        expect(parseToMap(42)).toBeNull();
        expect(parseToMap([])).toBeNull();
        expect(parseToMap({})).toBeNull();
        expect(parseToMap({ type: "nebulosity.unknown" })).toBeNull();
        expect(parseToMap({ type: "nebulosity.ready", version: 1 })).toBeNull();      // the Map's own message, not one it hears
        expect(parseToMap({ type: "nebulosity.hello", version: 2 })).toBeNull();      // another bridge version: ignored
        expect(parseToMap({ type: "nebulosity.hello" })).toBeNull();
        expect(parseToMap({ type: "nebulosity.hello", version: "1" })).toBeNull();
        expect(parseToMap({ type: "nebulosity.follow", path: 3 })).toBeNull();
        expect(parseToMap({ type: "nebulosity.follow" })).toBeNull();
        expect(parseToMap({ type: "nebulosity.show", path: null })).toBeNull();
        expect(parseToMap({ type: "nebulosity.highlight", paths: "a.ts" })).toBeNull();
        expect(parseToMap({ type: "nebulosity.highlight" })).toBeNull();
    });

    it("takes paths of at most 1,024 characters", () => {
        expect(parseToMap({ type: "nebulosity.follow", path: "a".repeat(1024) })).toEqual({ type: "nebulosity.follow", path: "a".repeat(1024) });
        expect(parseToMap({ type: "nebulosity.follow", path: "a".repeat(1025) })).toBeNull();
        expect(parseToMap({ type: "nebulosity.show", path: "a".repeat(1025) })).toBeNull();
        // in a highlight a path that is too long is dropped like a non-string, and the rest stay
        expect(parseToMap({ type: "nebulosity.highlight", paths: ["a.ts", "a".repeat(1025), "b.ts"] })).toEqual({ type: "nebulosity.highlight", paths: ["a.ts", "b.ts"] });
    });

    it("highlight keeps at most 50 paths, the first ones, and drops what isn't a string", () => {
        const sixty = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
        const parsed = parseToMap({ type: "nebulosity.highlight", paths: sixty });
        expect(parsed).toEqual({ type: "nebulosity.highlight", paths: sixty.slice(0, 50) });
        expect(parseToMap({ type: "nebulosity.highlight", paths: ["a.ts", 7, null, { x: 1 }, "b.ts"] }))
            .toEqual({ type: "nebulosity.highlight", paths: ["a.ts", "b.ts"] });
        // non-strings don't use up the 50
        expect(parseToMap({ type: "nebulosity.highlight", paths: [...Array.from({ length: 10 }, () => 0), ...sixty] }))
            .toEqual({ type: "nebulosity.highlight", paths: sixty.slice(0, 50) });
    });

    it("passes on nothing it didn't check", () => {
        expect(parseToMap({ type: "nebulosity.follow", path: "a.ts", extra: "x" })).toEqual({ type: "nebulosity.follow", path: "a.ts" });
        expect(parseToMap({ type: "nebulosity.clear", paths: ["a.ts"] })).toEqual({ type: "nebulosity.clear" });
    });
});

describe("createBridge (API_CONTRACTS §20: the handshake and its guards)", () => {
    it("accepts a hello only from the parent and a vscode-webview origin, and answers ready", () => {
        const { parent, bridge, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        expect(parent.postMessage).toHaveBeenCalledTimes(1);
        expect(parent.postMessage).toHaveBeenCalledWith(READY, WEBVIEW);
        expect(bridge.connected()).toBe(true);
    });

    it("refuses a hello from another source, another origin or another version", () => {
        const refused: [string, unknown, string, unknown][] = [
            ["another source", {}, WEBVIEW, HELLO],
            ["no source", null, WEBVIEW, HELLO],
            ["a page on the Map's own origin", "parent", "http://localhost:3000", HELLO],
            ["a lookalike host", "parent", "https://vscode-webview.evil.com", HELLO],
            ["a lookalike scheme", "parent", "xvscode-webview://abc", HELLO],
            ["bridge version 2", "parent", WEBVIEW, { type: "nebulosity.hello", version: 2 }],
        ];
        for (const [, source, origin, data] of refused){
            const { parent, bridge, fire } = setup();
            fire(source === "parent" ? parent : source, origin, data);
            expect(parent.postMessage).not.toHaveBeenCalled();
            expect(bridge.connected()).toBe(false);
        }
    });

    it("posts nothing before the handshake", () => {
        const { parent, bridge } = setup();
        bridge.post({ type: "nebulosity.open", path: "a.ts" });
        bridge.post(DRAWN);
        expect(parent.postMessage).not.toHaveBeenCalled();
        expect(bridge.connected()).toBe(false);
    });

    it("posts to the kept origin after the handshake, and never to another", () => {
        const { parent, bridge, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        parent.postMessage.mockClear();
        bridge.post({ type: "nebulosity.open", path: "a.ts", line: 3 });
        expect(parent.postMessage).toHaveBeenCalledTimes(1);
        expect(parent.postMessage).toHaveBeenCalledWith({ type: "nebulosity.open", path: "a.ts", line: 3 }, WEBVIEW);
    });

    it("after the hello, the on-ready drawn is posted once to the kept origin", () => {
        const { parent, fire } = setup(() => DRAWN);
        fire(parent, WEBVIEW, HELLO);
        expect(parent.postMessage).toHaveBeenCalledTimes(2);
        expect(parent.postMessage).toHaveBeenNthCalledWith(1, READY, WEBVIEW);
        expect(parent.postMessage).toHaveBeenNthCalledWith(2, DRAWN, WEBVIEW);
    });

    it("posts only the ready when no level is on screen yet", () => {
        const { parent, fire } = setup(() => null);
        fire(parent, WEBVIEW, HELLO);
        expect(parent.postMessage).toHaveBeenCalledTimes(1);
        expect(parent.postMessage).toHaveBeenCalledWith(READY, WEBVIEW);
    });

    it("asks for the level again at each hello, so the drawn it posts is the one on screen then", () => {
        let level = 0;
        const { parent, fire } = setup(() => ({ type: "nebulosity.drawn", path: "src", page: level++, selected: null }));
        fire(parent, WEBVIEW, HELLO);
        fire(parent, WEBVIEW, HELLO);
        const drawn = (page: number) => ({ type: "nebulosity.drawn", path: "src", page, selected: null });
        expect(parent.postMessage.mock.calls.map(([message]) => message)).toEqual([READY, drawn(0), READY, drawn(1)]);
    });

    it("after the handshake, only that source and origin are heard", () => {
        const { parent, heard, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        fire(parent, WEBVIEW, { type: "nebulosity.follow", path: "src/a.ts" });
        expect(heard).toEqual([{ type: "nebulosity.follow", path: "src/a.ts" }]);
        fire(parent, "vscode-webview://other", { type: "nebulosity.follow", path: "src/b.ts" });
        fire({}, WEBVIEW, { type: "nebulosity.follow", path: "src/c.ts" });
        fire(parent, "http://localhost:3000", { type: "nebulosity.show", path: "src/d.ts" });
        expect(heard).toHaveLength(1);
    });

    it("hears nothing but the hello before the handshake", () => {
        const { parent, heard, fire } = setup();
        fire(parent, WEBVIEW, { type: "nebulosity.follow", path: "src/a.ts" });
        fire(parent, WEBVIEW, { type: "nebulosity.clear" });
        expect(heard).toEqual([]);
    });

    it("drops a malformed message from the right origin", () => {
        const { parent, heard, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        fire(parent, WEBVIEW, { type: "nebulosity.follow", path: 3 });
        fire(parent, WEBVIEW, "nebulosity.clear");
        fire(parent, WEBVIEW, null);
        expect(heard).toEqual([]);
    });

    it("doesn't hand the hello on: it is the handshake, not a message for the Map", () => {
        const { parent, heard, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        fire(parent, WEBVIEW, HELLO);
        expect(heard).toEqual([]);
    });

    it("a second hello from the parent re-handshakes (the webview reloaded)", () => {
        const { parent, bridge, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        fire(parent, WEBVIEW, HELLO);
        expect(parent.postMessage).toHaveBeenCalledTimes(2);
        expect(parent.postMessage).toHaveBeenNthCalledWith(2, READY, WEBVIEW);
        expect(bridge.connected()).toBe(true);
    });

    it("a second hello and its on-ready drawn are posted again", () => {
        const { parent, fire } = setup(() => DRAWN);
        fire(parent, WEBVIEW, HELLO);
        fire(parent, WEBVIEW, HELLO);
        expect(parent.postMessage.mock.calls).toEqual([[READY, WEBVIEW], [DRAWN, WEBVIEW], [READY, WEBVIEW], [DRAWN, WEBVIEW]]);
    });

    it("a hello from another source after the handshake changes nothing", () => {
        const { parent, bridge, fire } = setup();
        fire(parent, WEBVIEW, HELLO);
        parent.postMessage.mockClear();
        fire({}, "vscode-webview://other", HELLO);
        fire(parent, "http://localhost:3000", HELLO);
        expect(parent.postMessage).not.toHaveBeenCalled();
        bridge.post(DRAWN);
        expect(parent.postMessage).toHaveBeenCalledWith(DRAWN, WEBVIEW);
    });

    it("dispose removes the listener, and a disposed bridge posts nothing", () => {
        const { parent, listeners, heard, bridge, fire } = setup();
        expect(listeners.size).toBe(1);
        fire(parent, WEBVIEW, HELLO);
        bridge.dispose();
        expect(listeners.size).toBe(0);
        parent.postMessage.mockClear();
        fire(parent, WEBVIEW, { type: "nebulosity.follow", path: "a.ts" });
        bridge.post(DRAWN);
        expect(heard).toEqual([]);
        expect(parent.postMessage).not.toHaveBeenCalled();
        expect(bridge.connected()).toBe(false);
    });

    it("takes the real window (a compile-time check: Task 5 passes `window` to createBridge)", () => {
        expectTypeOf<Window>().toExtend<BridgeWindow>();
    });
});
