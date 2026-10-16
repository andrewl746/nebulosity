import path from "path";
import { describe, expect, it } from "vitest";
import { buildRepoGraphs, taskTests } from "./build-truth";
import { callTruth, programFor } from "./ts-calls";

const root = path.resolve("test/fixtures/di-repo");
const { program } = programFor(root);
const files = (kind: "callers" | "breaks" | "injects", type: string, file: string, member?: string) =>
    callTruth(program, root, kind, { type, file, ...(member ? { member } : {}) }).files;
const F = "src/platform/files";

describe("callTruth on the calls fixture (the ground truth's checker side)", () => {
    it("callers of IFileService.readFile: the index's eight and the inferred call", () => {
        expect(files("callers", "IFileService", `${F}/common/files.ts`, "readFile")).toEqual([
            `${F}/common/fileService.ts`, `${F}/node/watchingFileService.ts`, "src/workbench/commands/openCommand.ts", "src/workbench/editor/editorPane.ts",
            "src/workbench/editor/textEditor.ts", "src/workbench/history/history.ts", "src/workbench/history/inferred.ts",
            "src/workbench/search/searchModel.ts", "src/workbench/test/fileService.test.ts",
        ]);
    });

    it("breaks of IFileService.readFile adds the files that declare it: 11", () => {
        const breaks = files("breaks", "IFileService", `${F}/common/files.ts`, "readFile");
        expect(breaks).toHaveLength(11);
        expect(breaks).toEqual(expect.arrayContaining([`${F}/browser/memoryFileService.ts`, `${F}/common/files.ts`]));
    });

    it("injects of IFileService, DialogService and CommandRegistry", () => {
        expect(files("injects", "IFileService", `${F}/common/files.ts`)).toEqual([
            "src/workbench/commands/openCommand.ts", "src/workbench/editor/baseEditor.ts", "src/workbench/editor/editorPane.ts",
        ]);
        expect(files("injects", "DialogService", "src/app/dialogs/dialogService.ts")).toEqual(["src/app/components/settingsButton.tsx"]);
        expect(files("injects", "CommandRegistry", "src/app/commands/commandRegistry.ts")).toEqual(["src/app/commands/commandContribution.ts"]);
    });

    it("callers through a namespace re-export, hooks, @inject and a workspace package", () => {
        expect(files("callers", "IWatchingFileService", `${F}/common/files.ts`, "watch")).toEqual(["src/workbench/editor/editorPane.ts", "src/workbench/files/watchView.ts"]);
        expect(files("callers", "DialogService", "src/app/dialogs/dialogService.ts", "open")).toEqual(["src/app/components/settingsButton.tsx"]);
        expect(files("callers", "CommandRegistry", "src/app/commands/commandRegistry.ts", "register")).toEqual(["src/app/commands/commandContribution.ts"]);
        expect(files("callers", "Framework", "packages/infra/src/framework.ts", "service")).toEqual(["src/app/dialogs/index.ts"]);
    });

    it("callers of TaskRunner.run (Task 5's cases)", () => {
        expect(files("callers", "TaskRunner", "src/workbench/tasks/taskRunner.ts", "run")).toEqual(["src/workbench/tasks/runners.ts", "src/workbench/tasks/taskHost.ts"]);
    });

    it("plans the task on IFileService.readFile: the 11 files to change, and the one test to run", () => {
        const change = callTruth(program, root, "breaks", { type: "IFileService", file: `${F}/common/files.ts`, member: "readFile" }).files;
        const { graph } = buildRepoGraphs(root, "di", [], { resolveBare: true });
        expect([change.length, taskTests(change, graph)]).toEqual([11, ["src/workbench/test/fileService.test.ts"]]);
    });
}, 60_000);
