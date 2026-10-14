import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { QUESTION_ORDER } from "./run-config";

// eval/questions.json is data the runner and the scorer both read; this pins it against D2 (docs/plans/2026-10-13-v1-5-ship.md),
// transcribed by hand: the order, the families, the three format lines, the definition sentence and the files each question names.
const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string): any => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));   // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON read field by field
const file = read("eval/questions.json");

const DEFINITION = "Count a file if any of its import, export … from, side-effect import, import() or require() statements refers to it; type-only imports and test files count.";

// D2's question texts, copied by hand from the plan's D2 tables (not from questions.json), so a changed word fails here
const STEMS: Record<string, string> = {
    bp1: "What are the main layers of VS Code's core code under `src/vs`, what is each one for, and which layers may depend on which?",
    bp2: "Inside each layer of `src/vs`, code is split into folders by the environment it runs in. What are those environments, and what may code in each one import?",
    bp3: "How does VS Code define a service, make an implementation available, and get it into the classes that use it? Name the functions and conventions involved.",
    bp4: "How is `src/vs/workbench` organized, and what rules govern the feature code in `src/vs/workbench/contrib`?",
    bp5: "How do the desktop and web builds of the workbench share code, and what decides whether a feature's code gets loaded at all?",
    cl1: "List every file that directly imports `src/vs/workbench/contrib/search/common/search.ts`.",
    cl2: "List every file outside `src/vs/workbench/contrib/debug` that directly imports a file inside it.",
    cl3: "List every file outside `src/vs/editor/standalone` that directly imports a file inside it.",
    cl4: "List every file that depends on `src/vs/workbench/contrib/markers/common/markers.ts`, directly or through other files.",
    cl5: "List every file outside `src/vs/platform/undoRedo` that directly imports a file inside it.",
    cn1: "How does `src/vs/workbench/workbench.desktop.main.ts` end up loading `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts`? Give the shortest chain of imports.",
    cn2: "Give the shortest chain of imports from `src/vs/workbench/workbench.web.main.ts` to `src/vs/workbench/contrib/debug/browser/debugSession.ts`.",
    cn3: "Does `src/vs/workbench/api/common/extHost.api.impl.ts` depend on `src/vs/editor/common/model/textModel.ts`, directly or through other files? If it does, give the shortest chain of imports.",
    cn4: "Does `src/vs/base/common/strings.ts` depend on any file in `src/vs/workbench`, directly or through other files? If it does, give the chain.",
    cn5: "Give the shortest chain of imports from `src/vs/workbench/contrib/scm/browser/scmViewPane.ts` to `src/vs/platform/undoRedo/common/undoRedo.ts`.",
};

describe("eval/questions.json", () => {
    it("asks D2's questions word for word, the list ones followed by the definition of an import after one space", () => {
        expect(Object.keys(STEMS)).toEqual(QUESTION_ORDER);
        for (const q of file.questions) expect(q.prompt, q.id).toBe(q.family === "list" ? `${STEMS[q.id]} ${DEFINITION}` : STEMS[q.id]);
    });

    it("holds the fifteen questions in D2's order, for microsoft/vscode at cc3fec88", () => {
        expect(file.questions.map((q: { id: string }) => q.id)).toEqual(QUESTION_ORDER);
        expect(file.repo).toBe("microsoft/vscode");
        expect(file.commit).toBe("cc3fec8846d0e678357e476fa611774da26d7e24");
    });

    it("has D2's three answer formats, and every question's family is one of them", () => {
        expect(file.formats).toEqual({
            list: "End with a line that says ANSWER: and then every such file's path relative to the repository root, one per line, with nothing after the list.",
            chain: "End with a line that says ANSWER: and then either the word none, or the chain as file paths relative to the repository root, one per line, from the first file to the last, where each file imports the next.",
            bigPicture: "Answer in at most 400 words.",
        });
        for (const q of file.questions) expect(Object.keys(file.formats), q.id).toContain(q.family);
    });

    it("makes bp* big-picture, cl* lists and cn* chains", () => {
        const family = { bp: "bigPicture", cl: "list", cn: "chain" };
        for (const q of file.questions) expect(q.family, q.id).toBe(family[q.id.slice(0, 2) as keyof typeof family]);
    });

    it("points every list and chain question at an existing truth, and every big-picture question at an existing rubric", () => {
        for (const q of file.questions){
            if (q.family === "bigPicture"){
                expect(q.rubric, q.id).toBe(`eval/rubric/${q.id}.json`);
                expect(q.truth, q.id).toBeUndefined();
                expect(fs.existsSync(path.join(ROOT, q.rubric)), q.rubric).toBe(true);
            } else {
                expect(q.truth, q.id).toBe(`eval/truth/${q.id}.json`);
                expect(q.rubric, q.id).toBeUndefined();
                expect(fs.existsSync(path.join(ROOT, q.truth)), q.truth).toBe(true);
            }
        }
    });

    it("ends every list prompt with the definition of an import, one space after the question, and no other prompt does", () => {
        for (const q of file.questions) {
            if (q.family === "list") expect(q.prompt.endsWith(` ${DEFINITION}`), q.id).toBe(true);
            else expect(q.prompt, q.id).not.toContain("Count a file");
            expect(q.prompt, q.id).not.toMatch(/nebulosity/i);   // the prompts are the same in both arms and never name the tool
        }
    });

    it("asks about the files each truth is built for: every path the truth names is in the prompt, in backticks", () => {
        for (const q of file.questions.filter((x: { family: string }) => x.family !== "bigPicture")){
            const truth = read(q.truth);
            expect(truth.id, q.id).toBe(q.id);
            expect(truth.kind, q.id).toBe(q.family);
            for (const p of truth.kind === "list" ? [truth.target] : [truth.from, truth.to]) expect(q.prompt, `${q.id} ${p}`).toContain(`\`${p}\``);
        }
    });
});

describe("eval/rubric/*.json", () => {
    it("has D2's number of points for each big-picture question, numbered BP<n>.<i>", () => {
        const counts = { bp1: 8, bp2: 6, bp3: 6, bp4: 8, bp5: 6 };
        for (const [id, count] of Object.entries(counts)){
            const rubric = read(`eval/rubric/${id}.json`);
            expect(rubric.id).toBe(id);
            expect(rubric.source).toBe("VS Code wiki, Source Code Organization (edited 2025-10-11)");
            expect(rubric.points.map((p: { id: string }) => p.id), id).toEqual(Array.from({ length: count }, (_, i) => `${id.toUpperCase()}.${i + 1}`));
            for (const p of rubric.points) expect(p.text, p.id).not.toBe("");
        }
    });
});
