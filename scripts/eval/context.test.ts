import { describe, expect, it } from "vitest";
import { cdTarget, pathTokens, relevantContext } from "./context";

const at = (s: number): string => `2026-10-20T10:00:${String(s).padStart(2, "0")}.000Z`;
const call = (id: string, name: string, input: Record<string, unknown>, s: number, msg = `m${id}`) =>
    ({ type: "assistant", timestamp: at(s), message: { id: msg, usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100 }, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, text: string, s: number, isError = false) =>
    ({ type: "user", timestamp: at(s), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] } });
const end = (s: number, durationMs: number) => [{ type: "assistant", timestamp: at(s), message: { id: "last", usage: {}, content: [{ type: "text", text: "ANSWER:" }] } }, { type: "result", duration_ms: durationMs }];
const jsonl = (events: unknown[]): string => events.map((e) => JSON.stringify(e)).join("\n");
const TRACKED = new Set(["src/vs/a.ts", "src/vs/b.ts", "src/vs/c.ts", "src/vs/x/longer/src/vs/a.ts", "readme.md"]);

describe("pathTokens and cdTarget", () => {
    it("reads Windows paths, the scrubbed root, ./ and :line, case folded", () => {
        expect(pathTokens("<vscode>\\src\\VS\\a.ts:12:import x\n./src/vs/b.ts.", "vscode")).toEqual(["src/vs/a.ts", "12", "import", "x", "src/vs/b.ts"]);
    });

    it("follows a cd from the root, a relative cd, and one that leaves the repo", () => {
        expect(cdTarget("cd <vscode>/src && grep -rn x .", "", "vscode")).toBe("src");
        expect(cdTarget("cd vs; ls", "src", "vscode")).toBe("src/vs");
        expect(cdTarget("cd <scratch> && node s.js", "src", "vscode")).toBeNull();
        expect(cdTarget("ls src", "src", "vscode")).toBeUndefined();
    });
});

describe("relevantContext", () => {
    const needed = { kind: "files" as const, files: ["src/vs/a.ts", "src/vs/b.ts"] };

    it("reaches when a Grep result printed from a moved folder names the last file, and counts the tokens before it once per message", () => {
        const events = [
            call("t1", "Bash", { command: "cd <vscode>/src && grep -rln foo vs" }, 2),
            result("t1", "vs\\a.ts", 3),
            call("t2", "Grep", { pattern: "foo", path: "<vscode>\\src" }, 4),
            call("t2b", "Glob", { pattern: "*" }, 4, "mt2"),    // t2's message again (usage repeats on each content block): counted once
            result("t2", "vs\\B.ts:7:foo()", 5),
            ...end(9, 6_000),
        ];
        expect(relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed, tracked: TRACKED })).toEqual({
            reached: true, ttrcMs: 5_000, ttrcQueryMs: 2_000, tokens: 222, coverage: 1,
            mostlyRelevant: { reached: true, ttrcMs: 5_000, ttrcQueryMs: 2_000 },
        });
    });

    it("doesn't take a refused command's paths, nor its cd, and doesn't match a longer path ending in a needed one", () => {
        const events = [
            call("t1", "Bash", { command: "cd <vscode>/src/vs && cat a.ts b.ts" }, 2),
            result("t1", "Permission to use Bash has been denied.", 3, true),
            call("t2", "Read", { file_path: "<vscode>\\src\\vs\\x\\longer\\src\\vs\\a.ts" }, 4),
            result("t2", "export const a = 1;", 5),
            call("t3", "Bash", { command: "ls" }, 6),
            result("t3", "a.ts\nb.ts", 7),    // relative to the working folder: still the root, since the refused cd never ran
            ...end(9, 6_000),
        ];
        const r = relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed, tracked: TRACKED });
        expect([r.reached, r.ttrcMs, r.coverage]).toEqual([false, null, 0]);
    });

    it("the mostly-relevant version needs half of a result's tracked files needed; a Read names its own file", () => {
        const events = [
            call("t1", "Glob", { pattern: "**/*" }, 2),
            result("t1", "src/vs/a.ts\nsrc/vs/b.ts\nsrc/vs/c.ts\nreadme.md\nsrc/vs/x/longer/src/vs/a.ts", 3),   // 2 of 5 needed
            call("t2", "Read", { file_path: "<vscode>/src/vs/a.ts" }, 4),
            result("t2", "import { b } from './b';", 5),
            call("t3", "Read", { file_path: "<vscode>/src/vs/b.ts" }, 6),
            result("t3", "export const b = 2;", 7),
            ...end(9, 6_000),
        ];
        const r = relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed, tracked: TRACKED });
        expect([r.ttrcMs, r.mostlyRelevant.ttrcMs]).toEqual([3_000, 7_000]);
    });

    it("reaches a chain once one shortest path's middle files are all seen", () => {
        const dag = { kind: "paths" as const, nodes: ["s", "m1", "m2", "n1", "t"], edges: [["s", "m1"], ["m1", "m2"], ["m2", "t"], ["s", "n1"], ["n1", "m2"]] as [string, string][], from: ["s"], to: ["t"] };
        // shortest paths s→m1→m2→t and s→n1→m2→t: seeing n1 and m2 completes the second
        const events = [call("t1", "Grep", { pattern: "x" }, 2), result("t1", "m2", 3), call("t2", "Grep", { pattern: "y" }, 4), result("t2", "n1", 5), ...end(9, 6_000)];
        const r = relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed: dag, tracked: new Set(["s", "m1", "m2", "n1", "t"]) });
        expect([r.ttrcMs, r.coverage]).toEqual([5_000, 1]);
    });
});
