import { describe, expect, it } from "vitest";
import { extensionOf, packageNameOf, resolutionReport } from "./resolution";

describe("packageNameOf", () => {
    it("keeps a scope with its name, and drops a subpath", () => {
        expect(packageNameOf("@affine/core/modules/doc")).toBe("@affine/core");
        expect(packageNameOf("react-dom/client")).toBe("react-dom");
        expect(packageNameOf("vs/base/common/uri")).toBe("vs");
        expect(packageNameOf("react")).toBe("react");
    });
});

describe("resolutionReport", () => {
    const files = [
        { path: "src/a.ts", specifiers: ["./b", "../outside", "react", "@x/ui/button"] },
        { path: "src/b.ts", specifiers: ["@x/ui", "react", "vs/base/common/uri"] },
    ];
    // resolves ./b and @x/ui only
    const resolve = (importer: string, specifier: string): string | null =>
        specifier === "./b" ? "src/b.ts" : specifier === "@x/ui" ? "packages/ui/src/index.ts" : null;

    it("counts relative and bare specifiers apart, each with how many resolved", () => {
        const report = resolutionReport(files, resolve);
        expect(report.relative).toEqual({ total: 2, resolved: 1 });
        expect(report.bare).toEqual({ total: 5, resolved: 1 });
    });

    it("lists the unresolved bare specifiers by package name, most first, ties by name", () => {
        expect(resolutionReport(files, resolve).unresolvedBare).toEqual([
            { name: "react", count: 2 },
            { name: "@x/ui", count: 1 },
            { name: "vs", count: 1 },
        ]);
    });

    it("keeps only the top names asked for", () => {
        expect(resolutionReport(files, resolve, 1).unresolvedBare).toEqual([{ name: "react", count: 2 }]);
    });
});

describe("relative specifiers naming files the index doesn't read", () => {
    const files = [{ path: "src/a.ts", specifiers: ["./b", "./style.css", "./logo.svg?url", "./theme.css", "./app.service", "react"] }];
    // "./theme.css" is the vanilla-extract file theme.css.ts, which the index holds
    const resolve = (importer: string, specifier: string): string | null =>
        specifier === "./b" ? "src/b.ts" : specifier === "./theme.css" ? "src/theme.css.ts" : null;

    it("are counted apart, by extension, when they resolve to nothing, and left out of the relative share", () => {
        const report = resolutionReport(files, resolve);
        expect(report.relative).toEqual({ total: 3, resolved: 2 });
        expect(report.notCode).toEqual({ total: 2, byExtension: [{ extension: ".css", count: 1 }, { extension: ".svg", count: 1 }] });
        expect(report.bare).toEqual({ total: 1, resolved: 0 });
    });

    it("reads the extension from the last name only, lowercased, without a query", () => {
        expect(extensionOf("./a.CSS?inline")).toBe(".css");
        expect(extensionOf("./worker?worker")).toBe("");
        expect(extensionOf("../v1.2/file")).toBe("");
        expect(extensionOf("./.env")).toBe("");
    });
});
