import { describe, expect, it } from "vitest";
import { parseLiveEvent } from "./event";

const now = new Date("2026-10-12T10:00:00.000Z");

describe("parseLiveEvent", () => {
    it("takes a tool call, puts its paths in the stored spelling, drops ones outside the repo, and fills in the time", () => {
        expect(parseLiveEvent({ tool: "describe", paths: ["src\\a.ts", "./src/b/", "../etc/passwd"] }, now))
            .toEqual({ tool: "describe", paths: ["src/a.ts", "src/b"], at: "2026-10-12T10:00:00.000Z" });
        expect(parseLiveEvent({ tool: "show_on_map", paths: ["src"], at: "2026-10-12T09:00:00.000Z", action: { type: "highlight_nodes", nodeIds: ["src/a.ts", "../x"] } }, now))
            .toEqual({ tool: "show_on_map", paths: ["src"], at: "2026-10-12T09:00:00.000Z", action: { type: "highlight_nodes", nodeIds: ["src/a.ts"] } });
        expect(parseLiveEvent({ tool: "show_on_map", action: { type: "clear_highlights" } }, now))
            .toEqual({ tool: "show_on_map", paths: [], at: "2026-10-12T10:00:00.000Z", action: { type: "clear_highlights" } });
    });

    it("refuses what isn't a live event", () => {
        for (const raw of [null, "describe", {}, { tool: "" }, { tool: "x".repeat(65) }, { tool: "t", paths: Array(51).fill("a.ts") },
            { tool: "t", action: { type: "explode" } }, { tool: "t", action: { type: "focus_node", nodeId: "../x" } }]){
            expect(parseLiveEvent(raw, now)).toBeNull();
        }
    });
});
