import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { askedOfQuestion, askedOfSpec, overlapReport, overlaps, targetsOfPrompt } from "./overlap";

const RULE = "Count a file if any of its import, export … from, side-effect import, import() or require() statements refers to it; type-only imports and test files count.";

describe("targetsOfPrompt: the file or folder a question asks about, read from its backticked paths", () => {
    it("takes only the first path of an impact question: the folders it counts by aren't targets", () => {
        expect(targetsOfPrompt("impact", `If I change \`src/a/b.ts\`, which code could it affect? Count every file that depends on it, directly or through other files, and say how many of those files are inside each of these folders: \`src/a\`, \`src/c\`, and how many are elsewhere. ${RULE}`))
            .toEqual(["src/a/b.ts"]);
    });

    it("takes only the folder of a pairs question: its names aren't targets", () => {
        expect(targetsOfPrompt("pairs", "Code under `src/vs` sits in folders named `common`, `browser`. For each of these names, which of the names do its files import from?")).toEqual(["src/vs"]);
        expect(targetsOfPrompt("pairs", "Which of the folders directly inside `packages/common` import from which others?")).toEqual(["packages/common"]);
    });

    it("takes every path of the other kinds: a chain's two ends, a violation's two folders, a big-picture question's folders", () => {
        expect(targetsOfPrompt("chain", "Give the shortest chain of imports from `a/main.ts` to `./b/log.ts`.")).toEqual(["a/main.ts", "b/log.ts"]);
        expect(targetsOfPrompt("violations", `List every file in \`src/a/\` that directly imports a file in \`src/b\`. ${RULE}`)).toEqual(["src/a", "src/b"]);
        expect(targetsOfPrompt("bigPicture", "How is `src/vs/workbench` organized, and what rules govern the feature code in `src/vs/workbench/contrib`?"))
            .toEqual(["src/vs/workbench", "src/vs/workbench/contrib"]);
        expect(targetsOfPrompt(undefined, "List every file that directly imports `x/y.ts`.")).toEqual(["x/y.ts"]);
    });
});

describe("the targets of a truth spec and of a question", () => {
    it("names each kind's own fields, and nothing an impact's folders or a pairs' names hold", () => {
        expect(askedOfSpec({ id: "i", repo: "r", kind: "impact", target: "a.ts", folders: ["x", "y"] }).targets).toEqual(["a.ts"]);
        expect(askedOfSpec({ id: "p", repo: "r", kind: "pairs", folder: "src", names: ["common"] }).targets).toEqual(["src"]);
        expect(askedOfSpec({ id: "c", repo: "r", kind: "chain", from: "a.ts", to: "dir/" }).targets).toEqual(["a.ts", "dir"]);
        expect(askedOfSpec({ id: "v", repo: "r", kind: "violations", from: "a", to: "b" }).targets).toEqual(["a", "b"]);
        expect(askedOfSpec({ id: "l", repo: "r", kind: "list", target: "t.ts", scope: "outside" }).targets).toEqual(["t.ts"]);
        expect(askedOfSpec({ id: "y", repo: "r", kind: "cycle", file: "c.ts" }).targets).toEqual(["c.ts"]);
        expect(askedOfSpec({ id: "u", repo: "r", kind: "unused", folder: "f" }).targets).toEqual(["f"]);
        expect(askedOfSpec({ id: "e", repo: "r", kind: "entries", target: "e.ts" }).targets).toEqual(["e.ts"]);
        expect(askedOfSpec({ id: "s", repo: "r", kind: "cycle", file: "c.ts", session: "r-s1" })).toEqual({ id: "s", repo: "r", session: "r-s1", targets: ["c.ts"] });
    });

    it("reads a question's prompt, and its truth's fields too when it names one", () => {
        expect(askedOfQuestion({ id: "q", repo: "r", kind: "cycle", prompt: "Is `c.ts` part of an import cycle?" })).toEqual({ id: "q", repo: "r", targets: ["c.ts"] });
        // a question without a repo is the eval's only repo's (Eval #1's), and a truth's fields join the prompt's paths
        const readTruth = (): Record<string, unknown> => ({ kind: "chain", from: "a.ts", to: "b.ts" });
        expect(askedOfQuestion({ id: "q", kind: "chain", prompt: "How does `a.ts` end up loading `b.ts`?", truth: "t.json", session: "s" }, "vscode", readTruth))
            .toEqual({ id: "q", repo: "vscode", session: "s", targets: ["a.ts", "b.ts"] });
    });
});

describe("overlaps", () => {
    const dev = [
        { id: "d-impact", repo: "vscode", targets: ["src/vs/x.ts"] },
        { id: "d-viol", repo: "vscode", targets: ["src/vs/base", "src/vs/platform"] },
        { id: "d-chain", repo: "affine", targets: ["p/index.ts", "q/index.ts"] },
    ];

    it("prints nothing when no question shares a target with the dev set, or a session with a single question", () => {
        expect(overlaps([
            { id: "e1", repo: "vscode", targets: ["src/vs/y.ts"] },
            { id: "s1-a", repo: "vscode", session: "s1", targets: ["src/vs/z.ts"] },
            { id: "s1-b", repo: "vscode", session: "s1", targets: ["src/vs/z.ts"] },
        ], dev)).toEqual([]);
    });

    it("names each shared path once per pair of questions, in the same repo only", () => {
        expect(overlaps([
            { id: "e1", repo: "vscode", targets: ["src/vs/platform", "src/vs/editor"] },
            // the same path in another repo is another file
            { id: "e2", repo: "affine", targets: ["src/vs/x.ts"] },
            { id: "e3", repo: "affine", targets: ["q/index.ts"] },
        ], dev)).toEqual([
            "vscode: src/vs/platform is a target of e1 and of the dev set's d-viol",
            "affine: q/index.ts is a target of e3 and of the dev set's d-chain",
        ]);
    });

    it("names a session question's target that a single question also asks about", () => {
        expect(overlaps([
            { id: "single", repo: "vscode", targets: ["src/vs/a.ts"] },
            { id: "s1-impact", repo: "vscode", session: "s1", targets: ["src/vs/a.ts"] },
        ], [])).toEqual(["vscode: src/vs/a.ts is a target of s1-impact (session s1) and of the single question single"]);
    });
});

describe("overlapReport on an eval folder", () => {
    it("reads the dev set and truth-specs.json while there is no questions.json, then questions.json", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-overlap-"));
        try {
            fs.mkdirSync(path.join(dir, "dev"));
            fs.writeFileSync(path.join(dir, "dev", "questions.json"), JSON.stringify({ questions: [
                { id: "vscode-dev-unused", repo: "vscode", kind: "unused", prompt: `List every file in \`src/vs/platform/files\` that no other file in the repository imports. ${RULE}` },
            ] }));
            fs.writeFileSync(path.join(dir, "truth-specs.json"), JSON.stringify([
                { id: "vscode-unused", repo: "vscode", kind: "unused", folder: "src/vs/sessions/browser" },
            ]));
            expect(overlapReport(dir)).toEqual([]);
            fs.writeFileSync(path.join(dir, "questions.json"), JSON.stringify({ questions: [
                { id: "vscode-unused", repo: "vscode", kind: "unused", prompt: `List every file in \`src/vs/platform/files\` that no other file in the repository imports. ${RULE}` },
            ] }));
            expect(overlapReport(dir)).toEqual(["vscode: src/vs/platform/files is a target of vscode-unused and of the dev set's vscode-dev-unused"]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
