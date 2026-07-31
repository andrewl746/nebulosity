import { describe, it, expect } from "vitest";
import { saveScan, loadGraph } from "./graph-store";

describe("test database", () => {
    it("store a small graph and check if duplicate edges collapse and an edge to an unscanned path doesn't crash", () => {
        saveScan("random-repo", [
            { path: "a", kind: "component", contentHash: "xxx" }, 
            { path: "b", kind: "component", contentHash: "xxx" },
            { path: "c", kind: "component", contentHash: "xxx" }
        ], [
            { source: "a", target: "b", specifier: "zzz" },
            { source: "a", target: "b", specifier: "yyy" }, 
            { source: "a", target: "c", specifier: "zzz" }, 
            { source: "c", target: "d", specifier: "zzz" }
        ])

        const res = loadGraph("random-repo");

        expect(res?.files.length).toBe(3);
        expect(res?.edges.length).toBe(2);
    });
});
