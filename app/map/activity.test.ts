import { describe, expect, it } from "vitest";
import type { LiveEvent, MapNode } from "@/lib/contracts";
import { activityLabel, activityTitle, agentFocus, highlightedNote, pushActivity } from "./activity";

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
        expect(activityLabel(event("imports", ["x.ts"]))).toBe("Following the imports of x.ts");
        expect(activityLabel(event("imports", ["a.ts", "b.ts"]))).toBe("Tracing a.ts → b.ts");
        expect(activityLabel(event("architecture", ["src"]))).toBe("Reading how src is organized");
        expect(activityLabel(event("architecture", [""]))).toBe("Reading how the repo is organized");
        expect(activityLabel(event("calls", ["src/a.ts", "b.ts"]))).toBe("Following the calls into src/a.ts +1");
        expect(activityLabel(event("calls", []))).toBe("Following calls");
        expect(activityLabel(event("show_on_map", ["src/vs", "src/main.ts"]))).toBe("Showing src/vs +1 on the map");
    });

    it("names a tool it doesn't know, with what it touched", () => {
        expect(activityLabel(event("grep_files", ["x"]))).toBe("grep_files · x");
        expect(activityLabel(event("grep_files", []))).toBe("grep_files");
    });
});

describe("activityTitle", () => {
    it("is the label itself when that already names the one path", () => {
        expect(activityTitle(event("describe", ["src/vs/base/common/event.ts"]))).toBe("Reading src/vs/base/common/event.ts");
        expect(activityTitle(event("overview", []))).toBe("Reading the repo overview");
    });

    it("adds every path, one per line, when the label shortens them", () => {
        expect(activityTitle(event("show_on_map", ["src/vs", "src/main.ts"]))).toBe("Showing src/vs +1 on the map\nsrc/vs\nsrc/main.ts");
        expect(activityTitle(event("imports", ["a.ts", "b.ts"]))).toBe("Tracing a.ts → b.ts\na.ts\nb.ts");
    });
});

describe("agentFocus", () => {
    // level src: two boxes and the portal to page 2, where src/typings is
    const box = (path: string, kind: MapNode["kind"]): MapNode => ({ path, name: path, kind, fileCount: 1, summaryStatus: "fresh" });
    const level = {
        path: "src",
        nodes: [box("src/vs", "folder"), box("src/main.ts", "file"), { ...box("src//page-2", "portal"), page: 1, members: ["src/typings"] }],
    };

    it("outlines the box holding what a tool call touched in the last 30 s", () => {
        expect(agentFocus(level, [event("describe", ["src/vs/base/x.ts"], 1)], [], NOW)).toEqual(new Set(["src/vs"]));
    });

    it("lets go once the call is 30 s old", () => {
        expect(agentFocus(level, [event("describe", ["src/vs/base/x.ts"], 31)], [], NOW)).toEqual(new Set());
    });

    it("outlines show_on_map's highlights, ones on another page on its portal", () => {
        expect(agentFocus(level, [], ["src/typings/a.d.ts"], NOW)).toEqual(new Set(["src//page-2"]));
    });

    it("lets go of the calls made before Clear, and still outlines a call made after it", () => {
        const before = event("show_on_map", ["src/vs/base"], 10);
        const after = event("describe", ["src/main.ts"], 2);
        // cleared 5 s before NOW: the call 10 s ago no longer counts, the one 2 s ago still does
        expect(agentFocus(level, [after, before], [], NOW, NOW - 5_000)).toEqual(new Set(["src/main.ts"]));
    });

    it("ignores what's outside the level", () => {
        expect(agentFocus(level, [event("describe", ["build/x.js"], 1)], [], NOW)).toEqual(new Set());
    });

    it("rings the editor's highlights (What depends, through the bridge) as it rings show_on_map's (PR #10 review, 3)", () => {
        expect(agentFocus(level, [], [], NOW, -Infinity, ["src/main.ts", "src/typings/a.d.ts"])).toEqual(new Set(["src/main.ts", "src//page-2"]));
        // beside Claude's own, each kept apart by the caller
        expect(agentFocus(level, [], ["src/vs/base/x.ts"], NOW, -Infinity, ["src/main.ts"])).toEqual(new Set(["src/vs", "src/main.ts"]));
    });

    it("keeps the editor's highlights through Clear, which lets go only of Claude's calls", () => {
        expect(agentFocus(level, [], [], NOW, NOW, ["src/main.ts"])).toEqual(new Set(["src/main.ts"]));
    });
});

describe("highlightedNote", () => {
    it("counts show_on_map's highlights for the activity bar, and is null with none", () => {
        expect(highlightedNote(0)).toBeNull();
        expect(highlightedNote(1)).toBe("1 highlighted");
        expect(highlightedNote(1_234)).toBe("1,234 highlighted");
    });
});
