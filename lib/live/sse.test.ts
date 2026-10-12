import { describe, expect, it } from "vitest";
import { sseFrame } from "./sse";

describe("sseFrame", () => {
    it("writes one Server-Sent Events frame: the event's name, its data as JSON, a blank line", () => {
        expect(sseFrame("tool", { tool: "describe" })).toBe('event: tool\ndata: {"tool":"describe"}\n\n');
    });
});
