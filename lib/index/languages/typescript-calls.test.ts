import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseSourceFile } from "../../chunks";
import { collectCallFacts } from "./typescript-calls";

const facts = (source: string, file = "src/x.ts") => collectCallFacts(parseSourceFile(file, source));
const fixture = (rel: string) => facts(fs.readFileSync(path.join("test/fixtures/di-repo", rel), "utf8"), rel);
const lines = (...l: string[]): string => `${l.join("\n")}\n`;

describe("collectCallFacts: declarations", () => {
    it("reads a class's heritage, members and field types, constructor parameter properties included", () => {
        expect(fixture("src/workbench/editor/editorPane.ts").types).toEqual([{
            name: "EditorPane", kind: "class", line: 4, exported: true, nested: false, extendsRefs: ["Disposable"], implementsRefs: [],
            testDoubleOf: null, members: ["fileService", "load", "watcher"], fields: { fileService: "IFileService", watcher: "IWatchingFileService" },
        }]);
    });

    it("reads a test double from extends mock<IFoo>()", () => {
        expect(fixture("src/workbench/test/fileService.test.ts").types).toEqual([{
            name: "TestFileService", kind: "class", line: 6, exported: false, nested: false, extendsRefs: [], implementsRefs: [],
            testDoubleOf: "IFileService", members: ["readFile"], fields: {},
        }]);
    });

    it("merges an interface declared twice in one file (Review Focus 2)", () => {
        const source = lines(
            "export interface IFoo extends IBase { a(): void; }",
            "export interface IFoo extends ns.IOther { b: string; }",
        );
        expect(facts(source).types).toEqual([{
            name: "IFoo", kind: "interface", line: 1, exported: true, nested: false, extendsRefs: ["IBase", "ns.IOther"], implementsRefs: [],
            testDoubleOf: null, members: ["a", "b"], fields: {},
        }]);
    });

    it("records a nameless or nested class with a heritage clause as nested (R-O), and skips one without", () => {
        const source = lines(
            "export function make() {",
            "    const double = new class extends mock<IFoo>() { run(): void {} }();",
            "    class Local implements IBar { go(): void {} }",
            "    class Plain { x(): void {} }",
            "    return [double, Local, Plain];",
            "}",
        );
        expect(facts(source).types).toEqual([
            { name: null, kind: "class", line: 2, exported: false, nested: true, extendsRefs: [], implementsRefs: [], testDoubleOf: "IFoo", members: ["run"], fields: {} },
            { name: "Local", kind: "class", line: 3, exported: false, nested: true, extendsRefs: [], implementsRefs: ["IBar"], testDoubleOf: null, members: ["go"], fields: {} },
        ]);
    });

    it("reads a field's type from new C() and from x.add(new C()) or this._register(new C())", () => {
        const source = lines(
            "export class A extends Base {",
            "    private readonly a = new Alpha();",
            "    private readonly b = this._register(new Beta());",
            "    private readonly c = store.add(new Gamma());",
            "    private readonly d = compute();",
            "    get e(): IEps { return this.a as never; }",
            "}",
        );
        expect(facts(source).types[0].fields).toEqual({ a: "Alpha", b: "Beta", c: "Gamma", e: "IEps" });
    });
});

describe("collectCallFacts: calls and injection sites", () => {
    it("reads the fields, the alias and the constructor's injection sites of a class (editorPane.ts)", () => {
        expect(fixture("src/workbench/editor/editorPane.ts").calls).toEqual([
            { line: 6, member: null, receiver: "type", ref: "IFileService", inClass: "EditorPane", how: "ctor-param" },
            { line: 7, member: null, receiver: "type", ref: "IWatchingFileService", inClass: "EditorPane", how: "ctor-param" },
            { line: 14, member: "watch", receiver: "field", ref: "watcher", inClass: "EditorPane", how: "field" },
            { line: 15, member: "readFile", receiver: "field", ref: "fileService", inClass: "EditorPane", how: "alias" },
            { line: 15, member: "readFile", receiver: "field", ref: "watcher", inClass: "EditorPane", how: "field" },
        ]);
    });

    it("reads providers, a namespace ref and a cast, in source order (openCommand.ts)", () => {
        const call = (line: number, member: string | null, ref: string, how: string) => ({ line, member, receiver: "type", ref, inClass: null, how });
        expect(fixture("src/workbench/commands/openCommand.ts").calls).toEqual([
            call(5, "get", "ServicesAccessor", "param"),
            call(5, null, "files.IFileService", "provider"),
            call(5, "writeFile", "files.IFileService", "provider"),
            call(6, "get", "ServicesAccessor", "param"),
            call(6, null, "files.IFileService", "provider"),
            call(7, "getOptional", "ServicesAccessor", "param"),
            call(7, null, "files.IFileService", "provider"),
            call(8, "readFile", "files.IFileService", "provider"),
            call(8, "readFile", "files.IFileService", "provider"),
            call(12, "readFile", "files.IFileService", "cast"),
        ]);
    });

    it("reads a type parameter's constraint and a typed destructuring (history.ts)", () => {
        expect(fixture("src/workbench/history/history.ts").calls).toEqual([
            { line: 4, member: "readFile", receiver: "type", ref: "IFileService", inClass: null, how: "constraint" },
            { line: 8, member: "readFile", receiver: "type", ref: "IFileService", inClass: null, how: "destructure" },
        ]);
    });

    it("sees nothing on an inferred receiver (inferred.ts)", () => {
        expect(fixture("src/workbench/history/inferred.ts").calls).toEqual([]);
    });

    it("reads AFFiNE's hooks: useService, useServiceOptional(…)?., useServices destructured (settingsButton.tsx)", () => {
        const at = (line: number, member: string | null) => ({ line, member, receiver: "type", ref: "DialogService", inClass: null, how: "provider" });
        expect(fixture("src/app/components/settingsButton.tsx").calls).toEqual([
            at(5, null), at(6, "open"), at(7, null), at(7, "open"), at(8, null), at(9, "open"),
        ]);
    });

    it("reads Inversify's @inject field and an @inject constructor parameter property (commandContribution.ts)", () => {
        expect(fixture("src/app/commands/commandContribution.ts").calls).toEqual([
            { line: 5, member: null, receiver: "type", ref: "CommandRegistry", inClass: "CommandContribution", how: "inject-field" },
            { line: 7, member: null, receiver: "type", ref: "CommandRegistry", inClass: "CommandContribution", how: "ctor-param" },
            { line: 10, member: "register", receiver: "field", ref: "commands", inClass: "CommandContribution", how: "field" },
            { line: 11, member: "register", receiver: "field", ref: "registry", inClass: "CommandContribution", how: "field" },
        ]);
    });

    it("reads new C() through store.add, and a this-call (fileService.test.ts, searchModel.ts)", () => {
        expect(fixture("src/workbench/test/fileService.test.ts").calls).toEqual([
            { line: 13, member: "add", receiver: "type", ref: "DisposableStore", inClass: null, how: "param" },
            { line: 14, member: "readFile", receiver: "type", ref: "FileService", inClass: null, how: "new" },
            { line: 14, member: "readFile", receiver: "type", ref: "TestFileService", inClass: null, how: "new" },
        ]);
        expect(fixture("src/workbench/search/searchModel.ts").calls).toEqual([
            { line: 5, member: "_register", receiver: "this", ref: null, inClass: "SearchModel", how: "this" },
            { line: 8, member: "readFile", receiver: "field", ref: "reader", inClass: "SearchModel", how: "field" },
        ]);
    });

    it("leaves out a provider asked for a local value (map.get(key)) and a this-call inside a plain function, and keeps a cast", () => {
        const source = lines(
            "export class A {",
            "    run(key: string, map: Map<string, IFoo>): void {",
            "        map.get(key);",
            "        const f = function (this: unknown) { (this as never as IBar).go(); };",
            "        const g = function () { this.helper(); };",
            "        f(); g();",
            "    }",
            "}",
        );
        // line 3: a typed call on a parameter, but no provider fact (key is a value, not a type); line 4: the cast's call;
        // line 5: `this` in a plain function isn't A's instance, so helper() is no this-call; line 6: plain calls
        expect(facts(source).calls).toEqual([
            { line: 3, member: "get", receiver: "type", ref: "Map", inClass: "A", how: "param" },
            { line: 4, member: "go", receiver: "type", ref: "IBar", inClass: "A", how: "cast" },
        ]);
    });
});

describe("collectCallFacts: scopes", () => {
    it("takes the first of two declarations of a name in one scope, and lets a nested block shadow an outer name", () => {
        const source = lines(
            "export function f(): void {",
            "    var a: IOne = make();",
            "    var a: ITwo = make();",
            "    const b: IOuter = make();",
            "    {",
            "        const b: IInner = make();",
            "        b.run();",
            "    }",
            "    a.go();",
            "    b.stop();",
            "}",
        );
        expect(facts(source).calls).toEqual([
            { line: 7, member: "run", receiver: "type", ref: "IInner", inClass: null, how: "local" },
            { line: 9, member: "go", receiver: "type", ref: "IOne", inClass: null, how: "local" },
            { line: 10, member: "stop", receiver: "type", ref: "IOuter", inClass: null, how: "local" },
        ]);
    });
});

describe("collectCallFacts: bindings", () => {
    it("keeps the imports the facts name, and every re-export and export (openCommand.ts, the barrel)", () => {
        expect(fixture("src/workbench/commands/openCommand.ts").bindings).toEqual([
            { kind: "import", local: "ServicesAccessor", imported: "ServicesAccessor", specifier: "../../platform/instantiation/instantiation" },
            { kind: "import", local: "files", imported: "*", specifier: "../../platform/files/common/files" },
        ]);
        expect(fixture("src/platform/files/index.ts").bindings).toEqual([
            { kind: "reexport", local: "*", imported: "*", specifier: "./common/files" },
            { kind: "reexport", local: "DefaultFileService", imported: "FileService", specifier: "./common/fileService" },
            { kind: "reexport", local: "watching", imported: "*", specifier: "./node/watchingFileService" },
        ]);
    });

    it("keeps an import a local export names, and a renamed import", () => {
        expect(fixture("src/app/dialogs/index.ts").bindings).toEqual([
            { kind: "import", local: "Framework", imported: "Framework", specifier: "@di/infra" },
            { kind: "import", local: "DialogService", imported: "DialogService", specifier: "./dialogService" },
            { kind: "export", local: "DialogService", imported: "DialogService", specifier: null },
        ]);
        expect(fixture("src/workbench/log/logView.ts").bindings).toEqual([
            { kind: "import", local: "Logger", imported: "Logger", specifier: "./logger" },
            { kind: "import", local: "PlatformLogger", imported: "Logger", specifier: "../../platform/log/logger" },
        ]);
    });

    it("reads a default import and the default exports", () => {
        const source = lines(
            "import Base from \"./base\";",
            "export default class Child extends Base {}",
        );
        expect(facts(source).bindings).toEqual([
            { kind: "import", local: "Base", imported: "default", specifier: "./base" },
            { kind: "export", local: "default", imported: "Child", specifier: null },
        ]);
    });
});
