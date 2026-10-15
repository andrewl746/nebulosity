import path from "path";
import { describe, expect, it } from "vitest";
import { indexRepository } from "../index/pipeline";
import { buildCallIndex, calls, hierarchyOf } from "./calls";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "di-repo");
indexRepository(root);
const F = "src/platform/files";

describe("calls: who calls a member", () => {
    it("IFileService.readFile: 8 files, 13 calls, on the type, a sub-interface and the implementations", () => {
        const a = calls(root, { symbol: "IFileService.readFile" });
        if (a.kind !== "member") throw new Error(a.kind);
        expect(a.type).toEqual({ name: "IFileService", kind: "interface", path: `${F}/common/files.ts`, line: 5 });
        expect(a.files.map((f) => [f.path, f.lines, f.receivers])).toEqual([
            ["src/workbench/commands/openCommand.ts", [8, 8, 12], []],
            ["src/workbench/editor/editorPane.ts", [15, 15], ["IFileService", "IWatchingFileService"]],
            ["src/workbench/history/history.ts", [4, 8], []],
            ["src/workbench/test/fileService.test.ts", [14, 14], ["FileService", "TestFileService"]],
            [`${F}/common/fileService.ts`, [10], ["FileService"]],
            [`${F}/node/watchingFileService.ts`, [6], ["WatchingFileService"]],
            ["src/workbench/editor/textEditor.ts", [5], []],
            ["src/workbench/search/searchModel.ts", [8], ["FileService"]],
        ]);
        expect([a.calls, a.tests]).toEqual([13, 1]);
        expect(a.categories).toEqual({ type: 4, subtype: 1, implementation: 4 });
        expect(a.declaring).toEqual([`${F}/browser/memoryFileService.ts`, `${F}/common/files.ts`]);
        expect(a.implementations.map((i) => [i.name, i.path, i.line, i.via, i.through, i.declares])).toEqual([
            ["MemoryFileService", `${F}/browser/memoryFileService.ts`, 3, "implements", null, true],
            ["FileService", `${F}/common/fileService.ts`, 4, "implements", null, true],
            ["WatchingFileService", `${F}/node/watchingFileService.ts`, 4, "sub-interface", "IWatchingFileService", false],
            ["TestFileService", "src/workbench/test/fileService.test.ts", 6, "test double", null, true],
        ]);
        expect(a.areas).toEqual([
            { path: "src/workbench", kind: "folder", count: 6 },
            { path: `${F}/common/fileService.ts`, kind: "file", count: 1 },
            { path: `${F}/node`, kind: "folder", count: 1 },
        ]);
    });

    it("doesn't see the call on an inferred receiver (inferred.ts)", () => {
        const a = calls(root, { symbol: "IFileService.readFile" });
        expect(a.kind === "member" && a.files.some((f) => f.path.endsWith("inferred.ts"))).toBe(false);
    });

    it("follows a namespace re-export to an implementation (IWatchingFileService.watch)", () => {
        const a = calls(root, { symbol: "IWatchingFileService.watch" });
        if (a.kind !== "member") throw new Error(a.kind);
        expect(a.files.map((f) => [f.path, f.lines, f.receivers])).toEqual([
            ["src/workbench/editor/editorPane.ts", [14], []],
            ["src/workbench/files/watchView.ts", [4], ["WatchingFileService"]],
        ]);
    });

    it("reads AFFiNE's hooks, Inversify's @inject and a workspace package (DialogService, CommandRegistry, Framework)", () => {
        const dialog = calls(root, { symbol: "DialogService.open" });
        if (dialog.kind !== "member") throw new Error(dialog.kind);
        expect(dialog.files.map((f) => [f.path, f.lines])).toEqual([["src/app/components/settingsButton.tsx", [6, 7, 9]]]);
        expect(dialog.declaring).toEqual(["src/app/dialogs/dialogService.ts"]);
        expect(dialog.subtypeWord).toBe("subclass");
        const registry = calls(root, { symbol: "CommandRegistry.register" });
        expect(registry.kind === "member" && registry.files.map((f) => [f.path, f.lines])).toEqual([["src/app/commands/commandContribution.ts", [10, 11]]]);
        const framework = calls(root, { symbol: "Framework.service" });
        expect(framework.kind === "member" && framework.files.map((f) => [f.path, f.lines])).toEqual([["src/app/dialogs/index.ts", [6]]]);
    });

    it("follows super, this and new on nested classes, members of declared types and declared returns (TaskRunner.run)", () => {
        const a = calls(root, { symbol: "TaskRunner.run" });
        if (a.kind !== "member") throw new Error(a.kind);
        expect(a.type).toEqual({ name: "TaskRunner", kind: "class", path: "src/workbench/tasks/taskRunner.ts", line: 1 });
        expect(a.files.map((f) => [f.path, f.lines, f.receivers])).toEqual([
            ["src/workbench/tasks/taskHost.ts", [18, 18, 18, 18, 27], []],
            ["src/workbench/tasks/runners.ts", [5, 12, 12, 16], ["(anonymous class)", "TaskRunner", "TwiceRunner"]],
        ]);
        expect(a.files[1].sites.map((s) => [s.line, s.category, s.receiver, s.receiverDeclares])).toEqual([
            [5, "type", "TaskRunner", true], [12, "subtype", "TwiceRunner", false], [12, "subtype", "TwiceRunner", false], [16, "subtype", "(anonymous class)", false],
        ]);
        // ITaskHost's runner property, TaskPanel's runner field (through that = this), the declared return and tuple: all TaskRunner
        expect(a.files[0].sites.every((s) => s.category === "type" && s.receiver === "TaskRunner" && s.receiverDeclares)).toBe(true);
        expect([a.calls, a.tests, a.categories, a.subtypeWord]).toEqual([9, 0, { type: 2, subtype: 1, implementation: 0 }, "subclass"]);
        expect([a.declaring, a.implementations]).toEqual([["src/workbench/tasks/taskRunner.ts"], []]);
        expect(a.areas).toEqual([
            { path: "src/workbench/tasks/runners.ts", kind: "file", count: 1 },
            { path: "src/workbench/tasks/taskHost.ts", kind: "file", count: 1 },
        ]);
    });

    it("keeps only files inside within, and groups by a folder's children", () => {
        const inside = calls(root, { symbol: "IFileService.readFile" }, { groupBy: null, within: "src/workbench" });
        if (inside.kind !== "member") throw new Error(inside.kind);
        expect(inside.files.map((f) => f.path)).toEqual([
            "src/workbench/commands/openCommand.ts", "src/workbench/editor/editorPane.ts", "src/workbench/history/history.ts",
            "src/workbench/test/fileService.test.ts", "src/workbench/editor/textEditor.ts", "src/workbench/search/searchModel.ts",
        ]);
        expect([inside.calls, inside.declaring, inside.implementations.map((i) => i.name)]).toEqual([11, [], ["TestFileService"]]);
        const grouped = calls(root, { symbol: "IFileService.readFile" }, { groupBy: "src/workbench" });
        if (grouped.kind !== "member") throw new Error(grouped.kind);
        expect([grouped.areas, grouped.elsewhere]).toEqual([[
            { path: "src/workbench/editor", kind: "folder", count: 2 },
            { path: "src/workbench/commands", kind: "folder", count: 1 },
            { path: "src/workbench/history", kind: "folder", count: 1 },
            { path: "src/workbench/search", kind: "folder", count: 1 },
            { path: "src/workbench/test", kind: "folder", count: 1 },
        ], 2]);
    });
});

describe("calls: where a type is injected", () => {
    it("IFileService: 3 files, 5 places; not where IWatchingFileService is injected", () => {
        const a = calls(root, { symbol: "IFileService" });
        if (a.kind !== "type") throw new Error(a.kind);
        expect(a.files.map((f) => [f.path, f.lines, f.hows])).toEqual([
            ["src/workbench/commands/openCommand.ts", [5, 6, 7], ["accessor or hook"]],
            ["src/workbench/editor/baseEditor.ts", [4], ["constructor"]],
            ["src/workbench/editor/editorPane.ts", [6], ["constructor"]],
        ]);
        expect([a.places, a.tests, a.implementations.length]).toEqual([5, 0, 4]);
    });

    it("DialogService through hooks, CommandRegistry through @inject; framework.service is a registration, not an injection", () => {
        const dialog = calls(root, { symbol: "DialogService" });
        expect(dialog.kind === "type" && dialog.files.map((f) => [f.path, f.lines])).toEqual([["src/app/components/settingsButton.tsx", [5, 7, 8]]]);
        const registry = calls(root, { symbol: "CommandRegistry" });
        expect(registry.kind === "type" && registry.files.map((f) => [f.path, f.lines, f.hows])).toEqual([
            ["src/app/commands/commandContribution.ts", [5, 7], ["@inject field", "constructor"]],
        ]);
    });
});

describe("calls: names and errors", () => {
    it("lists both Loggers and asks for path; with path, each finds its own caller", () => {
        expect(calls(root, { symbol: "Logger.log" })).toEqual({ kind: "ambiguous", name: "Logger", candidates: [
            { kind: "class", path: "src/platform/log/logger.ts", line: 1 },
            { kind: "class", path: "src/workbench/log/logger.ts", line: 1 },
        ] });
        const platform = calls(root, { symbol: "Logger.log", path: "src/platform/log/logger.ts" });
        expect(platform.kind === "member" && platform.files.map((f) => [f.path, f.lines])).toEqual([["src/workbench/log/logView.ts", [6]]]);
        const workbench = calls(root, { symbol: "Logger.log", path: "src/workbench/log/logger.ts" });
        expect(workbench.kind === "member" && workbench.files.map((f) => [f.path, f.lines])).toEqual([["src/workbench/log/logView.ts", [5]]]);
    });

    it("refuses an unknown type, a missing member, a path that declares none, a bad symbol, and a file as within", () => {
        expect(() => calls(root, { symbol: "Nope.x" })).toThrow("No class or interface named Nope is indexed.");
        expect(() => calls(root, { symbol: "IFileService.save" })).toThrow("IFileService has no member save. Its members: readFile, writeFile.");
        expect(() => calls(root, { symbol: "Logger", path: "src/app/dialogs/index.ts" })).toThrow("src/app/dialogs/index.ts declares no class or interface named Logger.");
        expect(() => calls(root, { symbol: "a.b.c" })).toThrow('symbol takes a class or interface ("IFooService") or one of its members ("IFooService.save").');
        expect(() => calls(root, { symbol: "IFileService" }, { groupBy: null, within: "src/workbench/editor/textEditor.ts" })).toThrow("within takes a folder.");
    });
});

describe("buildCallIndex: loops end (Review Focus 1), one name is one type (Review Focus 2)", () => {
    const decl = (pathName: string, name: string, extendsRefs: string[] = [], members: string[] = []) => ({
        path: pathName, isTest: false, name, kind: "class" as const, line: 1, exported: true, nested: false,
        extendsRefs, implementsRefs: [], testDoubleOf: null, members, fields: {},
    });

    it("an extends cycle and an export * cycle answer, each type once", () => {
        const index = buildCallIndex(
            [decl("a.ts", "A", ["B"]), decl("b.ts", "B", ["A"])],
            [
                { path: "a.ts", kind: "import", local: "B", imported: "B", specifier: "./b" },
                { path: "b.ts", kind: "import", local: "A", imported: "A", specifier: "./a" },
                { path: "x.ts", kind: "reexport", local: "*", imported: "*", specifier: "./y" },
                { path: "y.ts", kind: "reexport", local: "*", imported: "*", specifier: "./x" },
                { path: "c.ts", kind: "import", local: "Z", imported: "Z", specifier: "./x" },
            ],
            [
                { source: "a.ts", target: "b.ts", specifier: "./b" }, { source: "b.ts", target: "a.ts", specifier: "./a" },
                { source: "x.ts", target: "y.ts", specifier: "./y" }, { source: "y.ts", target: "x.ts", specifier: "./x" },
                { source: "c.ts", target: "x.ts", specifier: "./x" },
            ],
        );
        expect(index.resolve("c.ts", "Z")).toBeNull();
        const { subtypes } = hierarchyOf(index, "a.ts#A");
        expect([...subtypes]).toEqual(["b.ts#B"]);
    });

    // barrel.ts does `export *` from w1..w6; each wN does `import { X } from "./barrel"; export { X }`; c.ts imports X from the barrel
    const barrelFacts = (extra: string[]) => {
        const ws = ["w1.ts", "w2.ts", "w3.ts", "w4.ts", "w5.ts", "w6.ts", ...extra];
        const bindings = [
            ...ws.map((w) => ({ path: "barrel.ts", kind: "reexport" as const, local: "*", imported: "*", specifier: "./" + w.replace(".ts", "") })),
            ...ws.filter((w) => w.startsWith("w")).flatMap((w) => [
                { path: w, kind: "import" as const, local: "X", imported: "X", specifier: "./barrel" },
                { path: w, kind: "export" as const, local: "X", imported: "X", specifier: null },
            ]),
            { path: "c.ts", kind: "import" as const, local: "X", imported: "X", specifier: "./barrel" },
        ];
        const edges = [
            ...ws.map((w) => ({ source: "barrel.ts", target: w, specifier: "./" + w.replace(".ts", "") })),
            ...ws.filter((w) => w.startsWith("w")).map((w) => ({ source: w, target: "barrel.ts", specifier: "./barrel" })),
            { source: "c.ts", target: "barrel.ts", specifier: "./barrel" },
        ];
        return { bindings, edges };
    };

    it("a cycle through local re-exports of a name that is no class or interface answers null at once", () => {
        const { bindings, edges } = barrelFacts([]);
        const index = buildCallIndex([], bindings, edges);
        expect(index.resolve("c.ts", "X")).toBeNull();
    });

    it("a name reached through that cycle is still found down another export * branch", () => {
        const { bindings, edges } = barrelFacts(["real.ts"]);
        const index = buildCallIndex([decl("real.ts", "X")], bindings, edges);
        expect(index.resolve("c.ts", "X")).toBe("real.ts#X");
    });

    it("merges two declarations of one name in a file", () => {
        const index = buildCallIndex([decl("f.ts", "IFoo", ["IA"], ["a"]), decl("f.ts", "IFoo", ["IB"], ["b"])], [], []);
        expect([...index.types.get("f.ts#IFoo")!.members].sort()).toEqual(["a", "b"]);
        expect(index.types.get("f.ts#IFoo")!.extendsRefs).toEqual(["IA", "IB"]);
        expect(index.byName.get("IFoo")).toEqual(["f.ts#IFoo"]);
    });
});
