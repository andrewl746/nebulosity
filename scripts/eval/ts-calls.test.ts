import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
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

    it("callers of an inherited member by the receiver's type: IWatchingFileService.readFile (declared on IFileService)", () => {
        // editorPane's this.watcher is an IWatchingFileService; WatchingFileService implements it and calls this.readFile (inherited from FileService).
        // FileService's own this.readFile and every IFileService-typed receiver are not.
        expect(files("callers", "IWatchingFileService", `${F}/common/files.ts`, "readFile")).toEqual([`${F}/node/watchingFileService.ts`, "src/workbench/editor/editorPane.ts"]);
    });

    it("plans the task on IFileService.readFile: the 11 files to change, and the one test to run", () => {
        const change = callTruth(program, root, "breaks", { type: "IFileService", file: `${F}/common/files.ts`, member: "readFile" }).files;
        const { graph } = buildRepoGraphs(root, "di", [], { resolveBare: true });
        expect([change.length, taskTests(change, graph)]).toEqual([11, ["src/workbench/test/fileService.test.ts"]]);
    });
}, 60_000);

// Shapes the fixture lacks, in hand-written sources (expectations read from them, not run).
describe("callTruth by the receiver's type (inherited members), on sources written here", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-calls-"));
    const write = (name: string, lines: string[]): void => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`); };
    write("src/ifaces.ts", [
        "export interface IFoo { m(): void; }", "export interface IOther { m(): void; }", "export interface IBase { read(): string; }",
        "export interface ISub extends IBase {}", "export interface IBoth extends IOther, IFoo {}", "export class PlainBase { m(): void {} }",
    ]);
    write("src/c.ts", ['import { IFoo, PlainBase } from "./ifaces";', "export class C extends PlainBase implements IFoo { run(): void { this.m(); } }"]);
    write("src/use-sub.ts", ['import { ISub } from "./ifaces";', "export function f(x: ISub): string { return x.read(); }"]);
    write("src/use-c.ts", ['import { C } from "./c";', "export function f(c: C): void { c.m(); }"]);
    write("src/use-both.ts", ['import { IBoth } from "./ifaces";', "export function f(b: IBoth): void { b.m(); }"]);
    write("src/use-other.ts", ['import { IOther } from "./ifaces";', "export function f(o: IOther): void { o.m(); }"]);
    write("src/use-plain.ts", ['import { PlainBase } from "./ifaces";', "export function f(p: PlainBase): void { p.m(); }"]);
    const made = programFor(dir);
    const callers = (type: string, member: string): string[] => callTruth(made.program, dir, "callers", { type, file: "src/ifaces.ts", member }).files;
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("counts a call on an empty-body sub-interface of the interface that declares the member", () => {
        expect(callers("ISub", "read")).toEqual(["src/use-sub.ts"]);
        expect(callers("IBase", "read")).toEqual(["src/use-sub.ts"]);
    });

    it("counts a class that implements the interface but inherits the member from an unrelated base: c.m() and this.m()", () => {
        // not o.m() on IOther, and not p.m() on the plain base
        expect(callers("IFoo", "m")).toEqual(["src/c.ts", "src/use-both.ts", "src/use-c.ts"]);
    });

    it("counts a call on a sub-interface with several bases for each base that declares the member", () => {
        expect(callers("IOther", "m")).toEqual(["src/use-both.ts", "src/use-other.ts"]);
        expect(callers("IBoth", "m")).toEqual(["src/use-both.ts"]);
    });

    it("throws when the type has no such member, inherited ones included", () => {
        expect(() => callers("IFoo", "nope")).toThrow("IFoo in src/ifaces.ts has no member nope");
        expect(() => callers("ISub", "nope")).toThrow(/no member nope/);
    });
}, 60_000);
