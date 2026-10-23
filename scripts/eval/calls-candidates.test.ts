import { describe, expect, it } from "vitest";
import { decisionNote, differences, indexFiles } from "./calls-candidates";
import type { CallsAnswer } from "../../lib/engine/calls";

// Hand-built answers: only the fields indexFiles reads.
const member = {
    kind: "member",
    files: [
        { path: "src/a.ts", lines: [3, 9], receivers: [], isTest: false, sites: [{ line: 3, category: "type", receiver: "f", receiverDeclares: false }, { line: 9, category: "type", receiver: "f", receiverDeclares: false }] },
        { path: "src/b.ts", lines: [5], receivers: [], isTest: false, sites: [{ line: 5, category: "implementation", receiver: "g", receiverDeclares: true }] },
    ],
    declaring: ["src/b.ts", "src/c.ts"],
} as unknown as CallsAnswer;

describe("the index's side of the call disagreements", () => {
    it("takes a member answer's files for callers and adopt, and adds the declaring files for breaks and tasks", () => {
        expect([...indexFiles(member, "callers").keys()]).toEqual(["src/a.ts", "src/b.ts"]);
        expect([...indexFiles(member, "adopt").keys()]).toEqual(["src/a.ts", "src/b.ts"]);
        expect([...indexFiles(member, "breaks").keys()]).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
        expect(indexFiles(member, "task").get("src/c.ts")).toBe("declares the member");
        expect(indexFiles(member, "callers").get("src/a.ts")).toBe("L3, L9 (type)");
    });

    it("takes a type answer's files for injects, and refuses an ambiguous answer or the wrong shape, naming it", () => {
        const type = { kind: "type", files: [{ path: "src/x.ts", lines: [2], hows: ["constructor"], isTest: false }] } as unknown as CallsAnswer;
        expect(indexFiles(type, "injects").get("src/x.ts")).toBe("L2 (constructor)");
        expect(() => indexFiles(type, "callers")).toThrow(/needs a member/);
        expect(() => indexFiles(member, "injects")).toThrow(/member answer/);
        const ambiguous = { kind: "ambiguous", name: "IFoo", candidates: [{ kind: "interface", path: "a.ts", line: 1 }, { kind: "class", path: "b.ts", line: 4 }] } as CallsAnswer;
        expect(() => indexFiles(ambiguous, "callers")).toThrow(/"IFoo" is ambiguous: a\.ts:1, b\.ts:4/);
    });

    it("lists the files only one side has, sorted", () => {
        expect(differences(new Set(["b", "a", "c"]), new Set(["c", "d", "0"]))).toEqual({ indexOnly: ["a", "b"], checkerOnly: ["0", "d"] });
        expect(differences(new Set(["a"]), new Set(["a"]))).toEqual({ indexOnly: [], checkerOnly: [] });
    });

    it("marks a disagreement decided, with its verdict, or undecided", () => {
        const verdicts = [{ id: "q", file: "src/a.ts", decision: "out" as const, line: 7, why: "a comment" }];
        expect(decisionNote(verdicts, "q", "src/a.ts")).toEqual({ decided: true, text: "decided out (L7): a comment" });
        expect(decisionNote(verdicts, "q", "src/b.ts")).toEqual({ decided: false, text: "undecided" });
        expect(decisionNote(verdicts, "other", "src/a.ts").decided).toBe(false);
    });
});
