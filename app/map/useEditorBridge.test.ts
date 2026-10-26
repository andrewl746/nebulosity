import { describe, expect, it, vi } from "vitest";
import type { BridgeFromMap, BridgeToMap } from "@/lib/contracts";
import type { BridgeWindow } from "./embed";
import { createEditorLink, EMBEDDED } from "./useEditorBridge";

const HELLO = { type: "nebulosity.hello", version: 1 };
const READY = { type: "nebulosity.ready", version: 1 };
const DRAWN: BridgeFromMap = { type: "nebulosity.drawn", path: "src", page: 0, selected: null };
const FOLLOW = { type: "nebulosity.follow", path: "src/a.ts" };
const WEBVIEW = "vscode-webview://abc";

/** A window stand-in, as in embed.test.ts: `parent` records what is posted, and `fire` sends the parent's messages. */
function setup(){
    const parent = { postMessage: vi.fn() };
    const listeners = new Set<(e: MessageEvent) => void>();
    const win: BridgeWindow = {
        parent,
        addEventListener: (_type, fn) => { listeners.add(fn); },
        removeEventListener: (_type, fn) => { listeners.delete(fn); },
    };
    const fire = (data: unknown) => {
        for (const fn of [...listeners]) fn({ source: parent, origin: WEBVIEW, data } as unknown as MessageEvent);
    };
    return { parent, listeners, link: createEditorLink(win), fire };
}

/** A mounted Map's handlers: what it heard, and the drawn it answers a ready with. */
function map(drawn: BridgeFromMap | null = null){
    const heard: BridgeToMap[] = [];
    return { heard, handlers: { onMessage: (m: BridgeToMap) => { heard.push(m); }, onReady: () => drawn } };
}

describe("EMBEDDED (read once at module load)", () => {
    it("is false where there is no window: on the server", () => {
        expect(EMBEDDED).toBe(false);
    });
});

describe("createEditorLink (one bridge per page load: a Map that mounts again attaches to it)", () => {
    it("a Map mounted again is heard on the bridge the first one pinned, with no new hello", () => {
        const { parent, listeners, link, fire } = setup();
        const first = map();
        const detach = link.attach(first.handlers);
        fire(HELLO);
        expect(parent.postMessage).toHaveBeenCalledWith(READY, WEBVIEW);
        detach();
        const second = map();
        link.attach(second.handlers);
        // the webview says hello only until ready (V1.8 plan P9): no hello here, and the pin still holds
        fire(FOLLOW);
        expect(second.heard).toEqual([FOLLOW]);
        expect(first.heard).toEqual([]);
        parent.postMessage.mockClear();
        link.post(DRAWN);
        expect(parent.postMessage).toHaveBeenCalledWith(DRAWN, WEBVIEW);
        expect(listeners.size).toBe(1);
    });

    it("answers ready with the attached Map's drawn", () => {
        const { parent, link, fire } = setup();
        link.attach(map(DRAWN).handlers);
        fire(HELLO);
        expect(parent.postMessage.mock.calls).toEqual([[READY, WEBVIEW], [DRAWN, WEBVIEW]]);
    });

    it("while no Map is attached, a message is dropped and a hello gets its ready alone", () => {
        const { parent, link, fire } = setup();
        const gone = map(DRAWN);
        link.attach(gone.handlers)();
        fire(HELLO);
        fire(FOLLOW);
        expect(parent.postMessage.mock.calls).toEqual([[READY, WEBVIEW]]);
        expect(gone.heard).toEqual([]);
    });

    it("a Map that lets go late doesn't detach the one mounted after it", () => {
        const { link, fire } = setup();
        const detachFirst = link.attach(map().handlers);
        const second = map();
        link.attach(second.handlers);
        detachFirst();
        fire(HELLO);
        fire(FOLLOW);
        expect(second.heard).toEqual([FOLLOW]);
    });

    it("posts nothing before the handshake", () => {
        const { parent, link } = setup();
        link.attach(map().handlers);
        link.post(DRAWN);
        link.post({ type: "nebulosity.open", path: "src/a.ts" });
        expect(parent.postMessage).not.toHaveBeenCalled();
    });
});
