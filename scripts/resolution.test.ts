import { describe, expect, it } from "vitest";
import type { LanguageResolver } from "../lib/index/languages/adapter";
import { adapterReportLines, adapterResolutionReport, extensionOf, packageNameOf, resolutionReport } from "./resolution";

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

describe("a language adapter's report (E4: every language but TypeScript)", () => {
    // a resolver from a table: "x" resolves, "self" names the importer (placed: resolved), "ext" is external, "ctx" context
    const resolver: LanguageResolver = {
        resolve: (importer, specifier) => (specifier.endsWith(":x") ? ["t.k"] : specifier.endsWith(":self") ? [importer] : []),
        kindOf: (_importer, specifier) => (specifier.startsWith("ext:") ? "external" : specifier.startsWith("ctx:") ? "context" : "internal"),
        entryPoints: () => [],
    };
    const files = [
        { path: "b.k", specifiers: ["use:x", "use:gone", "name:self", "ext:lib", "ctx:ns"] },
        { path: "a.k", specifiers: ["name:missing", "use:x", "ext:other"] },
    ];

    it("counts internal references resolved (the importer itself counts), external and context apart, per class, and the misses in order", () => {
        expect(adapterResolutionReport(files, resolver)).toEqual({
            internal: { total: 5, resolved: 3 },
            external: 2,
            context: 1,
            classes: [
                { name: "ctx", total: 0, resolved: 0 },
                { name: "ext", total: 0, resolved: 0 },
                { name: "name", total: 2, resolved: 1 },
                { name: "use", total: 3, resolved: 2 },
            ],
            misses: [{ importer: "a.k", specifier: "name:missing" }, { importer: "b.k", specifier: "use:gone" }],
        });
    });

    it("takes the resolver's own class when it has one", () => {
        const classed: LanguageResolver = { ...resolver, classOf: (importer) => (importer === "a.k" ? "orphan" : "tree") };
        expect(adapterResolutionReport(files, classed).classes).toEqual([
            { name: "orphan", total: 2, resolved: 1 },
            { name: "tree", total: 3, resolved: 2 },
        ]);
    });

    it("prints a line for the language, one per class and up to 20 misses", () => {
        expect(adapterReportLines("k", adapterResolutionReport(files, resolver))).toEqual([
            "[resolution] k: internal 3/5 (60.0%) · external 2 · context 1",
            "[resolution] k ctx: internal 0/0 (n/a)",
            "[resolution] k ext: internal 0/0 (n/a)",
            "[resolution] k name: internal 1/2 (50.0%)",
            "[resolution] k use: internal 2/3 (66.7%)",
            "[resolution] k miss a.k name:missing",
            "[resolution] k miss b.k use:gone",
        ]);
        const many = Array.from({ length: 25 }, (_, i) => ({ path: `f${String(i).padStart(2, "0")}.k`, specifiers: ["use:gone"] }));
        const lines = adapterReportLines("k", adapterResolutionReport(many, resolver));
        expect(lines.filter((l) => l.includes(" miss "))).toHaveLength(20);
        expect(lines.at(-1)).toBe("[resolution] k miss f19.k use:gone");
    });
});
