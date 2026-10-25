import { describe, expect, it } from "vitest";
import { javaRepoTruth as truth } from "../../../../test/helpers/java-repo-truth";
import type { LanguageResolver, StoredFacts } from "../adapter";
import { edgesOf } from "../resolution";
import { createJavaResolver } from "./resolve";

/** A resolver over hand-written facts: each file's specifiers and declares, as a full run would store them. */
function resolverOver(facts: Record<string, { specifiers?: string[]; declares: string[] }>): LanguageResolver {
    const files = new Map<string, StoredFacts>(Object.entries(facts).map(([p, f]) => [p, { importSpecifiers: f.specifiers ?? [], declares: f.declares }]));
    return createJavaResolver({ root: "", fileSet: new Set(files.keys()), files, manifests: [], readText: () => null, cache: new Map() });
}

/** The fixture's resolver, over the truth's own specifiers and declares (test/helpers/java-repo-truth.ts, by hand). */
const fixture = resolverOver(Object.fromEntries(truth.files.map((f) => [f.path, { specifiers: truth.specifiers[f.path], declares: truth.declares[f.path] }])));
const targetsOf = (source: string): string[] => truth.edges.filter((e) => e.source === source).map((e) => e.target).sort();

const A = "app/src/main/java/com/example/app/";
const L = "lib/src/main/java/com/example/lib/";

describe("Java's resolver, on the fixture's truth", () => {
    it("gives every file exactly the truth's edges", () => {
        for (const { path } of truth.files){
            expect(edgesOf(fixture, path, truth.specifiers[path]).map((e) => e.target).sort(), path).toEqual(targetsOf(path));
        }
    });

    it("names every specifier's kind as the truth does", () => {
        for (const { path } of truth.files){
            for (const [specifier, kind] of Object.entries(truth.kinds[path])) expect(fixture.kindOf(path, specifier), `${path} ${specifier}`).toBe(kind);
        }
    });

    it("lists the files with a main as entry points", () => {
        expect(fixture.entryPoints()).toEqual(truth.entryPoints);
    });

    it("resolves a single-type import to the file declaring it", () => {
        expect(fixture.resolve(`${A}App.java`, "import:com.example.lib.Greeter")).toEqual([`${L}Greeter.java`]);
    });

    it("resolves a static import to its class's file, for a member and for *", () => {
        expect(fixture.resolve(`${A}App.java`, "static:com.example.lib.Strings")).toEqual([`${L}Strings.java`]);
        expect(fixture.resolve(`${A}App.java`, "static:com.example.lib.Constants")).toEqual([`${L}Constants.java`]);
    });

    it("resolves a nested type's import to its outer type's file", () => {
        expect(fixture.resolve(`${A}App.java`, "import:com.example.lib.Outer.Inner")).toEqual([`${L}Outer.java`]);
    });

    it("makes no edge of an on-demand import, and calls it context", () => {
        expect(fixture.resolve(`${A}App.java`, "import:com.example.lib.*")).toEqual([]);
        expect(fixture.kindOf(`${A}App.java`, "import:com.example.lib.*")).toBe("context");
    });

    it("resolves a simple name in the importer's package first", () => {
        expect(fixture.resolve(`${A}App.java`, "type:Service")).toEqual([`${A}Service.java`]);
        expect(fixture.resolve(`${L}Formatter.java`, "type:Widget")).toEqual([`${L}Widget.java`]);
    });

    it("resolves a simple name through an on-demand import when its package has none", () => {
        expect(fixture.resolve(`${A}Registry.java`, "type:Audited")).toEqual([`${L}Audited.java`]);
        expect(fixture.resolve(`${A}Registry.java`, "type:Widget")).toEqual([`${L}Widget.java`]);
    });

    it("resolves a qualified name in code like an import", () => {
        expect(fixture.resolve(`${A}Service.java`, "qualified:com.example.lib.Formatter")).toEqual([`${L}Formatter.java`]);
        expect(fixture.resolve(`${A}Service.java`, "qualified:com.example.lib.Strings")).toEqual([`${L}Strings.java`]);
    });

    it("resolves a duplicate name within the importer's source root, and to nothing on a tie", () => {
        expect(fixture.resolve("app/src/test/java/com/example/SampleTest.java", "type:Sample")).toEqual(["app/src/test/java/com/example/Sample.java"]);
        expect(fixture.resolve("lib/src/test/java/com/example/lib/StringsTest.java", "import:com.example.Sample")).toEqual(["lib/src/test/java/com/example/Sample.java"]);
        expect(fixture.resolve("tools/src/main/java/com/example/tools/Check.java", "import:com.example.Sample")).toEqual([]);
        expect(fixture.kindOf("tools/src/main/java/com/example/tools/Check.java", "import:com.example.Sample")).toBe("internal");
    });

    it("resolves from the default package, and names external what no repo type or package holds", () => {
        expect(fixture.resolve("tools/src/main/java/Launcher.java", "import:com.example.tools.Check")).toEqual(["tools/src/main/java/com/example/tools/Check.java"]);
        expect(fixture.resolve("tools/src/main/java/Launcher.java", "type:String")).toEqual([]);
        expect(fixture.kindOf("tools/src/main/java/Launcher.java", "type:String")).toBe("external");
        expect(fixture.kindOf(`${A}App.java`, "import:java.util.List")).toBe("external");
    });
});

// facts written for one rule each; every expectation is read off the facts by hand
describe("Java's resolver, on hand-written facts", () => {
    it("places a reference to the importer's own file with no edge", () => {
        const r = resolverOver({ "a/Outer.java": { specifiers: ["import:a.Outer.Kind"], declares: ["package:a", "type:a.Outer"] } });
        expect(r.resolve("a/Outer.java", "import:a.Outer.Kind")).toEqual(["a/Outer.java"]);
        expect(edgesOf(r, "a/Outer.java", ["import:a.Outer.Kind"])).toEqual([]);
    });

    it("drops more than one segment to reach a doubly nested type's outer file", () => {
        const r = resolverOver({ "a/Outer.java": { declares: ["package:a", "type:a.Outer"] }, "b/X.java": { declares: ["package:b", "type:b.X"] } });
        expect(r.resolve("b/X.java", "import:a.Outer.Mid.Inner")).toEqual(["a/Outer.java"]);
        expect(r.kindOf("b/X.java", "import:a.Outer.Mid.Inner")).toBe("internal");
    });

    it("calls a missing type in a repo package internal (a miss), and one in another package external", () => {
        const r = resolverOver({ "com/example/A.java": { declares: ["package:com.example", "type:com.example.A"] } });
        expect(r.resolve("com/example/A.java", "import:com.example.Gone")).toEqual([]);
        expect(r.kindOf("com/example/A.java", "import:com.example.Gone")).toBe("internal");
        expect(r.kindOf("com/example/A.java", "import:com.example.vendor.Thing")).toBe("external");   // its package is com.example.vendor
        expect(r.kindOf("com/example/A.java", "type:Gone")).toBe("external");                          // no repo type is named Gone
    });

    it("prefers the importer's package over its on-demand imports", () => {
        const r = resolverOver({
            "src/a/User.java": { specifiers: ["import:b.*", "type:W"], declares: ["package:a", "type:a.User"] },
            "src/a/W.java": { declares: ["package:a", "type:a.W"] },
            "src/b/W.java": { declares: ["package:b", "type:b.W"] },
        });
        expect(r.resolve("src/a/User.java", "type:W")).toEqual(["src/a/W.java"]);
    });

    it("resolves a name two on-demand imports both hold to nothing", () => {
        const r = resolverOver({
            "src/a/User.java": { specifiers: ["import:b.*", "import:c.*", "type:W"], declares: ["package:a", "type:a.User"] },
            "src/b/W.java": { declares: ["package:b", "type:b.W"] },
            "src/c/W.java": { declares: ["package:c", "type:c.W"] },
        });
        expect(r.resolve("src/a/User.java", "type:W")).toEqual([]);
        expect(r.kindOf("src/a/User.java", "type:W")).toBe("internal");
    });

    it("counts shared folders in whole segments, so app/ and apps/ share nothing", () => {
        const r = resolverOver({
            "x/apps/U.java": { declares: ["package:p", "type:p.U"] },        // misplaced: no source root
            "x/app/p/D.java": { declares: ["package:p", "type:p.D"] },
            "x/apps/q/p/D.java": { declares: ["package:p", "type:p.D"] },
        });
        expect(r.resolve("x/apps/U.java", "type:D")).toEqual(["x/apps/q/p/D.java"]);   // x/apps shares 2 segments, x/app 1
    });

    it("lists a file once though two of its types have a main", () => {
        const r = resolverOver({ "a/M.java": { declares: ["main:a.M", "main:a.N", "package:a", "type:a.M", "type:a.N"] } });
        expect(r.entryPoints()).toEqual([{ path: "a/M.java", declaredBy: "public static void main" }]);
    });
});
