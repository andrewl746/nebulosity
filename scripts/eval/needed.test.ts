import { describe, expect, it } from "vitest";
import { chainDag, cycleDag, neededFor } from "./needed";

describe("chainDag", () => {
    it("keeps the nodes and edges on a shortest path, with the ends as from and to", () => {
        const g = { files: ["a", "b", "c", "d", "e"], edges: [["a", "b"], ["b", "d"], ["a", "c"], ["c", "d"], ["d", "e"]] as [string, string][] };
        expect(chainDag(g, "a", "e")).toEqual({
            kind: "paths", nodes: ["a", "b", "c", "d", "e"],
            edges: [["a", "b"], ["b", "d"], ["a", "c"], ["c", "d"], ["d", "e"]], from: ["a"], to: ["e"],
        });
    });

    it("leaves a longer path out, and gives null when nothing lies between the ends or nothing connects", () => {
        const g = { files: ["a", "b", "e", "z"], edges: [["a", "b"], ["b", "e"], ["a", "e"]] as [string, string][] };
        expect(chainDag(g, "a", "e")).toBeNull();           // direct edge: nothing between
        expect(chainDag({ files: ["a", "b"], edges: [] }, "a", "b")).toBeNull();
        const h = { files: ["a", "b", "c", "e", "x"], edges: [["a", "b"], ["b", "e"], ["a", "x"], ["x", "c"], ["c", "e"]] as [string, string][] };
        expect(chainDag(h, "a", "e")).toEqual({ kind: "paths", nodes: ["a", "b", "e"], edges: [["a", "b"], ["b", "e"]], from: ["a"], to: ["e"] });
    });

    it("takes a folder's files as the targets", () => {
        const g = { files: ["a", "m", "d/x", "d/y"], edges: [["a", "m"], ["m", "d/x"], ["m", "d/y"]] as [string, string][] };
        expect(chainDag(g, "a", "d")).toEqual({
            kind: "paths", nodes: ["a", "m", "d/x", "d/y"], edges: [["a", "m"], ["m", "d/x"], ["m", "d/y"]], from: ["a"], to: ["d/x", "d/y"],
        });
    });
});

describe("cycleDag", () => {
    it("writes the cycle's end as <file>#", () => {
        const g = { files: ["x", "y", "z"], edges: [["x", "y"], ["y", "z"], ["z", "x"], ["y", "x"]] as [string, string][] };
        expect(cycleDag(g, "x", 2)).toEqual({ kind: "paths", nodes: ["x", "y", "x#"], edges: [["x", "y"], ["y", "x#"]], from: ["x"], to: ["x#"] });
    });

    it("gives null for a cycle with nothing in it between", () => {
        expect(cycleDag({ files: ["x", "y"], edges: [["x", "x"]] }, "x", 1)).toBeNull();
    });
});

describe("neededFor", () => {
    const g = { files: ["a", "b", "c", "d", "e"], edges: [["a", "b"], ["b", "d"], ["a", "c"], ["c", "d"], ["d", "e"]] as [string, string][] };
    const checked = { verified: true, notes: [] };

    it("gives a list truth's files, and null for an empty set or an impact", () => {
        expect(neededFor({ id: "q", kind: "list", target: "d", scope: "direct", files: ["b", "c"], ...checked } as never, g)).toEqual({ kind: "files", files: ["b", "c"] });
        expect(neededFor({ id: "q", kind: "unused", folder: "", files: [], ...checked } as never, g)).toBeNull();
        expect(neededFor({ id: "q", kind: "impact", target: "d", counts: [], elsewhere: 0, total: 3, ...checked } as never, g)).toBeNull();
    });

    it("gives a connected chain's DAG, throws when the length disagrees, and null for no chain", () => {
        const chain = { id: "q", kind: "chain", from: "a", to: "e", connected: true, shortest: 3, example: ["a", "b", "d", "e"], ...checked };
        expect(neededFor(chain as never, g)).toEqual(chainDag(g, "a", "e"));
        expect(() => neededFor({ ...chain, shortest: 2 } as never, g)).toThrow(/q/);
        expect(neededFor({ ...chain, connected: false, shortest: null, example: null } as never, g)).toBeNull();
    });

    it("gives a cycle's DAG, and null for none", () => {
        const cyc = { files: ["x", "y", "z"], edges: [["x", "y"], ["y", "z"], ["z", "x"], ["y", "x"]] as [string, string][] };
        expect(neededFor({ id: "q", kind: "cycle", file: "x", shortest: 2, example: ["x", "y", "x"], ...checked } as never, cyc)).toEqual(cycleDag(cyc, "x", 2));
        expect(neededFor({ id: "q", kind: "cycle", file: "x", shortest: null, example: null, ...checked } as never, cyc)).toBeNull();
    });
});

describe("neededFor, the call kinds and tasks", () => {
    const g = { files: ["a", "b"], edges: [] as [string, string][] };
    const checked = { verified: true, notes: [] };
    const call = { type: "IFoo", file: "foo.ts", member: "save", within: null };

    it("gives a call truth's files, and null for none", () => {
        expect(neededFor({ id: "q", kind: "callers", ...call, files: ["x.ts", "y.ts"], ...checked } as never, g)).toEqual({ kind: "files", files: ["x.ts", "y.ts"] });
        expect(neededFor({ id: "q", kind: "injects", ...call, member: null, files: ["x.ts"], ...checked } as never, g)).toEqual({ kind: "files", files: ["x.ts"] });
        expect(neededFor({ id: "q", kind: "breaks", ...call, files: [], ...checked } as never, g)).toBeNull();
    });

    it("gives a task's files to change and its tests together, each once, sorted", () => {
        const task = { id: "t", kind: "task", ...call, change: ["src/b.ts", "src/test/b.test.ts"], tests: ["src/test/a.test.ts", "src/test/b.test.ts"], ...checked };
        expect(neededFor(task as never, g)).toEqual({ kind: "files", files: ["src/b.ts", "src/test/a.test.ts", "src/test/b.test.ts"] });
    });
});
