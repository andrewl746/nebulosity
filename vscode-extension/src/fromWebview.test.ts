import { describe, expect, it } from "vitest";
import { readFromWebview } from "./fromWebview";

describe("readFromWebview (what the relay posts to the extension)", () => {
    it("reads a button's command, and only the three", () => {
        expect(readFromWebview({ command: "start" })).toEqual({ kind: "command", command: "start" });
        expect(readFromWebview({ command: "showLog" })).toEqual({ kind: "command", command: "showLog" });
        expect(readFromWebview({ command: "indexRepo" })).toEqual({ kind: "command", command: "indexRepo" });
        expect(readFromWebview({ command: "other" })).toBeNull();
        expect(readFromWebview({ command: "toString" })).toBeNull();
    });

    it("reads the relay's frame error", () => {
        expect(readFromWebview({ type: "relay.frameError" })).toEqual({ kind: "frameError" });
    });

    it("never takes a message with a type for a command", () => {
        expect(readFromWebview({ type: "nebulosity.ready", version: 1, command: "indexRepo" })).toEqual({ kind: "map", message: { type: "nebulosity.ready", version: 1 } });
        expect(readFromWebview({ type: "nebulosity.other", command: "indexRepo" })).toBeNull();
    });

    it("reads ready, of bridge 1 only", () => {
        expect(readFromWebview({ type: "nebulosity.ready", version: 1 })).toEqual({ kind: "map", message: { type: "nebulosity.ready", version: 1 } });
        expect(readFromWebview({ type: "nebulosity.ready", version: 2 })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.ready" })).toBeNull();
    });

    it("reads open, with a 1-based line or none, keeping only its fields", () => {
        expect(readFromWebview({ type: "nebulosity.open", path: "src/a.ts", extra: true })).toEqual({ kind: "map", message: { type: "nebulosity.open", path: "src/a.ts" } });
        expect(readFromWebview({ type: "nebulosity.open", path: "src/a.ts", line: 12 })).toEqual({ kind: "map", message: { type: "nebulosity.open", path: "src/a.ts", line: 12 } });
        expect(readFromWebview({ type: "nebulosity.open", path: "src/a.ts", line: 0 })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.open", path: "src/a.ts", line: 1.5 })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.open", path: "src/a.ts", line: "3" })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.open", path: 3 })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.open", path: "a".repeat(1_025) })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.open", path: "a".repeat(1_024) })).toEqual({ kind: "map", message: { type: "nebulosity.open", path: "a".repeat(1_024) } });
    });

    it("reads drawn: a level's path, its page from 0, and the selection or null", () => {
        expect(readFromWebview({ type: "nebulosity.drawn", path: "src", page: 0, selected: null }))
            .toEqual({ kind: "map", message: { type: "nebulosity.drawn", path: "src", page: 0, selected: null } });
        expect(readFromWebview({ type: "nebulosity.drawn", path: "", page: 2, selected: "src/a.ts" }))
            .toEqual({ kind: "map", message: { type: "nebulosity.drawn", path: "", page: 2, selected: "src/a.ts" } });
        expect(readFromWebview({ type: "nebulosity.drawn", path: "src", page: -1, selected: null })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.drawn", path: "src", page: 0.5, selected: null })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.drawn", path: "src", page: 0 })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.drawn", path: "src", page: 0, selected: 7 })).toBeNull();
        expect(readFromWebview({ type: "nebulosity.drawn", path: null, page: 0, selected: null })).toBeNull();
    });

    it("refuses anything else", () => {
        expect(readFromWebview(null)).toBeNull();
        expect(readFromWebview("nebulosity.ready")).toBeNull();
        expect(readFromWebview([])).toBeNull();
        expect(readFromWebview({})).toBeNull();
        expect(readFromWebview({ type: "nebulosity.hello", version: 1 })).toBeNull();
    });
});
