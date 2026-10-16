import { describe, expect, it } from "vitest";
import { callPrompt } from "./prompts";

const target = { type: "IFooService", file: "src/vs/platform/foo/common/foo.ts", member: "save", within: "src" };

describe("callPrompt (D2's templates and rule sentences)", () => {
    it("writes a callers prompt: the stem, the call rule, the scope", () => {
        expect(callPrompt("callers", target)).toBe(
            "List every file that calls `IFooService.save` (`IFooService` is declared in `src/vs/platform/foo/common/foo.ts`). "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class); test files count. "
            + "Count only files under src/.");
    });

    it("writes a task prompt: the change in its source's words, the breaks rule, the tests rule, the scope over both lists", () => {
        expect(callPrompt("task", { ...target, within: "src/vs/workbench" }, "it gains an options argument (owner/repo#123).")).toBe(
            "I'm changing the signature of `IFooService.save` (`IFooService` is declared in `src/vs/platform/foo/common/foo.ts`): it gains an options argument (owner/repo#123). Plan it: which files will I have to change, and which tests should I run? "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class), or if it declares `IFooService`, a type that extends `IFooService`, a class that implements `IFooService` or a class that extends `mock<IFooService>()`, where that declaration defines `save`; test files count. "
            + "A test file should run if it is among the files to change or directly imports one of them, counting imports by this rule: any import, export … from, side-effect import, import() or require() statement that refers to the file counts, type-only imports included. A test file has a folder named test, tests or __tests__ on its path, or .test. or .spec. in its name. "
            + "Count only files under src/vs/workbench/, in both lists.");
    });

    it("writes an injects prompt, with no scope when the question has none", () => {
        expect(callPrompt("injects", { type: "BarService", file: "packages/core/src/bar.ts" })).toBe(
            "List every file that has `BarService` injected (`BarService` is declared in `packages/core/src/bar.ts`). "
            + "Count a file if it receives `BarService` through a constructor parameter typed `BarService`, a field decorated `@inject(BarService)`, or a call that asks a service container or hook for it (`get(BarService)`, `getOptional(BarService)`, `useService(BarService)`, `useServiceOptional(BarService)` or `useServices({ BarService })`); test files count.");
    });

    it("writes breaks and adopt prompts", () => {
        expect(callPrompt("breaks", { type: "IFooService", file: "src/foo.ts", member: "save" })).toBe(
            "If the signature of `IFooService.save` changes (`IFooService` is declared in `src/foo.ts`), which files have to change? List them. "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class), or if it declares `IFooService`, a type that extends `IFooService`, a class that implements `IFooService` or a class that extends `mock<IFooService>()`, where that declaration defines `save`; test files count.");
        expect(callPrompt("adopt", { type: "IFooService", file: "src/foo.ts", member: "save" }, "Saves should now pass a reason (owner/repo#7).")).toBe(
            "Saves should now pass a reason (owner/repo#7). List every file with a call to `IFooService.save` that would have to adopt it (`IFooService` is declared in `src/foo.ts`). "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class); test files count.");
    });

    it("refuses an adopt question without its change, and a member kind without its member", () => {
        expect(() => callPrompt("adopt", target)).toThrow("an adopt question needs the change, in its source's words");
        expect(() => callPrompt("breaks", { type: "IFooService", file: "src/foo.ts" })).toThrow("a breaks question needs a member");
    });
});
