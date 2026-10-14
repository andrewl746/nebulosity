import { describe, expect, it } from "vitest";
import { packageNameOf, resolutionReport } from "./resolution";

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
