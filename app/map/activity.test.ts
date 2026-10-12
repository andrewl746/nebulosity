import { describe, expect, it } from "vitest";
import type { LiveEvent, MapNode } from "@/lib/contracts";
import { activityLabel, agentFocus, pushActivity } from "./activity";

const NOW = Date.parse("2026-10-12T20:00:00.000Z");
const event = (tool: string, paths: string[], secondsAgo = 0): LiveEvent =>
    ({ tool, paths, at: new Date(NOW - secondsAgo * 1000).toISOString() });

describe("pushActivity", () => {
    it("keeps Claude's last 3 actions, newest first (VISUAL_REFRESH.md §6)", () => {
        const [e1, e2, e3, e4] = ["a", "b", "c", "d"].map((p) => event("describe", [p]));
        expect(pushActivity([], e1)).toEqual([e1]);
        expect(pushActivity([e3, e2, e1], e4)).toEqual([e4, e3, e2]);
    });
});

describe("activityLabel", () => {
    it("says what each tool is doing, in words", () => {
        expect(activityLabel(event("describe", ["build/gulpfile.js"]))).toBe("Reading build/gulpfile.js");
        expect(activityLabel(event("mcp__nebulosity__describe", ["src/vs"]))).toBe("Reading src/vs");
        expect(activityLabel(event("describe", [""]))).toBe("Reading the repo");
        expect(activityLabel(event("overview", []))).toBe("Reading the repo overview");
        expect(activityLabel(event("search", ["a.ts", "b.ts", "c.ts"]))).toBe("Searching · a.ts +2");
        expect(activityLabel(event("search", []))).toBe("Searching");
        expect(activityLabel(event("dependents", ["x.ts"]))).toBe("Finding what uses x.ts");
        expect(activityLabel(event("dependencies", ["src/vs/editor"]))).toBe("Finding what src/vs/editor uses");
        expect(activityLabel(event("path", ["a.ts", "b.ts"]))).toBe("Tracing a.ts → b.ts");
        expect(activityLabel(event("show_on_map", ["src/vs", "src/main.ts"]))).toBe("Showing src/vs +1 on the map");
    });

    it("names a tool it doesn't know, with what it touched", () => {
        expect(activityLabel(event("grep_files", ["x"]))).toBe("grep_files · x");
        expect(activityLabel(event("grep_files", []))).toBe("grep_files");
    });
});

describe("agentFocus", () => {
    // level src: two boxes and "+N more" (src/typings is folded into it)
    const box = (path: string, kind: MapNode["kind"]): MapNode => ({ path, name: path, kind, fileCount: 1, summaryStatus: "fresh" });
    const level = { path: "src", nodes: [box("src/vs", "folder"), box("src/main.ts", "file"), box("src/", "more")] };

    it("outlines the box holding what a tool call touched in the last 30 s", () => {
        expect(agentFocus(level, [event("describe", ["src/vs/base/x.ts"], 1)], [], NOW)).toEqual(new Set(["src/vs"]));
    });

    it("lets go once the call is 30 s old", () => {
        expect(agentFocus(level, [event("describe", ["src/vs/base/x.ts"], 31)], [], NOW)).toEqual(new Set());
    });

    it("outlines show_on_map's highlights, folded ones on +N more", () => {
        expect(agentFocus(level, [], ["src/typings/a.d.ts"], NOW)).toEqual(new Set(["src/"]));
    });

    it("ignores what's outside the level", () => {
        expect(agentFocus(level, [event("describe", ["build/x.js"], 1)], [], NOW)).toEqual(new Set());
    });
});
