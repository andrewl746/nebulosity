import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { callPrompt } from "./prompts";

// eval3/questions.json is data the runner and the scorer both read; this pins it against D2 of V1.7's plan, by hand.
const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string): any => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));   // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON read field by field
const bytes = (p: string): Buffer => fs.readFileSync(path.join(ROOT, p));
const file = read("eval3/questions.json");
const eval2 = new Map(read("eval2/questions.json").questions.map((q: { id: string }) => [q.id, q]));
const CALL_AND_TASK_KINDS = ["callers", "breaks", "adopt", "injects", "task"];
const LIST_LINE = "End with a line that says ANSWER: and then every such file's path relative to the repository root, one per line, with nothing after the list.";
const TASK_LINE = "End with a line that says ANSWER CHANGE: and then every file to change, one path per line relative to the repository root; then a line that says ANSWER TESTS: and then every test file to run, one per line, with nothing after the list.";

// D2's table: per repo, how many questions of each kind (sessions' questions apart). R-X: a repo whose draw found no adopt
// candidate asks one more callers question; its line changes here with the ledger's record of it.
const MIX: Record<string, Record<string, number>> = {
    vscode: { callers: 2, breaks: 2, adopt: 1, injects: 1, task: 3, "list-direct": 1, "list-transitive": 1, chain: 1, impact: 1, cycle: 1, unused: 1, violations: 1, entries: 1, pairs: 1, bigPicture: 7 },
    // the draw's record (2026-10-16): R-X, no passing adopt, so a second callers question; R-AF, AFFiNE's third task shared a type, so two tasks
    affine: { callers: 2, breaks: 2, injects: 1, task: 2, "list-direct": 1, "list-transitive": 1, chain: 1, impact: 1, cycle: 1, unused: 1, violations: 1, entries: 1, pairs: 1, bigPicture: 6 },
    theia: { callers: 1, breaks: 2, injects: 1, task: 2, "list-direct": 1, "list-transitive": 1, chain: 1, cycle: 1, unused: 1, entries: 1, bigPicture: 2 },
};

describe("eval3/questions.json", () => {
    it("asks D2's mix on each repo", () => {
        for (const [repo, mix] of Object.entries(MIX)){
            const kinds: Record<string, number> = {};
            for (const q of file.questions.filter((x: { repo: string; session?: string }) => x.repo === repo && x.session === undefined)) kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
            expect(kinds, repo).toEqual(mix);
        }
    });

    it("copies Eval #2's questions unchanged, with their truths and rubrics byte for byte", () => {
        for (const q of file.questions.filter((x: { origin?: string }) => x.origin === "eval2")){
            const old = eval2.get(q.id) as Record<string, unknown>;
            expect({ ...q, origin: undefined, truth: undefined, rubric: undefined }, q.id).toEqual({ ...old, truth: undefined, rubric: undefined });
            for (const key of ["truth", "rubric"] as const) if (q[key] !== undefined) expect(bytes(q[key]).equals(bytes(old[key] as string)), q.id).toBe(true);
        }
    });

    it("builds every call and task prompt from its target with D2's templates, and gives it its format line", () => {
        expect([file.formats.callers, file.formats.breaks, file.formats.adopt, file.formats.injects, file.formats.task]).toEqual([LIST_LINE, LIST_LINE, LIST_LINE, LIST_LINE, TASK_LINE]);
        for (const q of file.questions.filter((x: { kind: string }) => CALL_AND_TASK_KINDS.includes(x.kind))){
            expect(q.prompt, q.id).toBe(callPrompt(q.kind, q.target, q.change));
            expect(q.family, q.id).toBe(q.kind);
            if (q.repo === "vscode") expect(q.target.within === "src" || q.target.within.startsWith("src/"), q.id).toBe(true);
            const truth = read(q.truth);
            expect([truth.kind, truth.type, truth.file, truth.member ?? undefined, truth.within ?? undefined], q.id).toEqual([q.kind, q.target.type, q.target.file, q.target.member, q.target.within]);
        }
    });

    it("builds the dev set's call and task prompts the same way, every dev question marked (Task 15)", () => {
        const dev = read("eval3/dev/questions.json");
        for (const q of dev.questions){
            expect(q.dev, q.id).toBe(true);
            if (CALL_AND_TASK_KINDS.includes(q.kind)) expect(q.prompt, q.id).toBe(callPrompt(q.kind, q.target, q.change));
        }
    });

    it("never names the tool, and every new question has a verified truth or a checked rubric", () => {
        for (const q of file.questions){
            expect(q.prompt, q.id).not.toMatch(/nebulosity/i);
            if (q.truth !== undefined) expect(read(q.truth).verified, q.id).toBe(true);
            else for (const p of read(q.rubric).points) expect(p.holds, `${q.id} ${p.id}`).not.toBeNull();
        }
    });
});
