import { describe, expect, it } from "vitest";
import { csharpRules, projectFiles } from "./rules";

describe("csharpRules", () => {
    it("claims .cs files only, as csharp", () => {
        expect(csharpRules.extensions).toEqual([".cs"]);
        expect(csharpRules.languageOf("src/A/B.cs")).toBe("csharp");
    });

    it.each([
        ["tests/Shop.Core.Tests/PriceTests.cs", true],               // both rules
        ["src/Shop.Web.IntegrationTests/Scenarios.cs", true],        // a folder *.IntegrationTests
        ["src/Api.Test/Helpers.cs", true],                           // a folder *.Test
        ["src/Api.UnitTests/Fakes/Clock.cs", true],                  // a folder *.UnitTests, any depth above
        ["src/Api.FunctionalTests/Flow.cs", true],                   // a folder *.FunctionalTests
        ["src/Shop.Core/OrderTests.cs", true],                       // a name *Tests.cs
        ["src/Shop.Core/OrderTest.cs", true],                        // a name *Test.cs
    ])("%s is a test file", (path, expected) => {
        expect(csharpRules.isTest(path)).toBe(expected);
    });

    it.each([
        ["src/Shop.Core/Order.cs"],
        ["src/Shop.Core/Latest.cs"],                                 // "test" in lower case: not the name rule
        ["src/Shop.Core/Contest.cs"],
        ["src/Shop.Testing/Order.cs"],                               // the folder doesn't end .Tests
        ["src/Tests/Order.cs"],                                      // no dot before Tests (and not the shared lower-case rule)
        ["src/Shop.Core/OrderTests.cs.bak"],                         // not a .cs file's name
        ["src/Shop.Tests.Core/Order.cs"],                            // .Tests in the middle of the segment
    ])("%s is not a test file by C#'s rules", (path) => {
        expect(csharpRules.isTest(path)).toBe(false);
    });

    it("counts a .csproj anywhere and a Directory.Build.props as manifests, and nothing else", () => {
        for (const path of ["Shop.csproj", "src/Shop.Core/Shop.Core.csproj", "Directory.Build.props", "src/Directory.Build.props"]){
            expect(csharpRules.manifest.test(path), path).toBe(true);
        }
        for (const path of ["Shop.sln", "Directory.Packages.props", "src/Shop.Core/obj/Shop.Core.csproj.nuget.g.props", "MyDirectory.Build.props",
            "src/Shop.csproj.user", "Program.cs"]){
            expect(csharpRules.manifest.test(path), path).toBe(false);
        }
    });

    it("leaves out bin/ and obj/ beside each .csproj, and nothing else", () => {
        const excluded = csharpRules.excluded(["Directory.Build.props", "src/Shop.Core/Shop.Core.csproj", "src/Shop.Web/Shop.Web.csproj"]);
        expect(excluded("src/Shop.Core/obj/Debug/net8.0/Shop.Core.AssemblyInfo.cs")).toBe(true);
        expect(excluded("src/Shop.Core/bin/Debug/Gen.cs")).toBe(true);
        expect(excluded("src/Shop.Web/obj/x.cs")).toBe(true);
        expect(excluded("src/Shop.Core/Models/Order.cs")).toBe(false);
        expect(excluded("src/Shop.Core/Models/obj/Order.cs")).toBe(false);   // obj/ deeper down isn't beside the project file
        expect(excluded("tools/bin/Seed.cs")).toBe(false);                   // no .csproj beside tools/
        expect(excluded("src/Shop.Web.Tests/bin/x.cs")).toBe(false);         // another folder that only starts like src/Shop.Web
        expect(excluded("bin/x.cs")).toBe(false);                            // no .csproj at the root
    });

    it("leaves out the root's bin/ and obj/ when a .csproj sits at the root", () => {
        const excluded = csharpRules.excluded(["Shop.csproj"]);
        expect(excluded("bin/Debug/x.cs")).toBe(true);
        expect(excluded("obj/x.cs")).toBe(true);
        expect(excluded("src/bin/x.cs")).toBe(false);
    });

    it("finds the project files among the manifests", () => {
        expect(projectFiles(["Directory.Build.props", "a/A.csproj", "b/Directory.Build.props", "c/C.csproj"])).toEqual(["a/A.csproj", "c/C.csproj"]);
    });
});

describe("C#'s specifiers as written (displaySpecifier, B-I3)", () => {
    it("shows a using or a namespace as its statement, and a type name as the code writes it", () => {
        const shown = (s: string) => csharpRules.displaySpecifier!(s);
        expect(shown("using:Shop.Core.Models")).toBe("using Shop.Core.Models");
        expect(shown("global:Shop.Core.Carts")).toBe("global using Shop.Core.Carts");
        expect(shown("static:Shop.Core.Pricing.PriceMath")).toBe("using static Shop.Core.Pricing.PriceMath");
        expect(shown("gstatic:Shop.Core.Pricing.PriceMath")).toBe("global using static Shop.Core.Pricing.PriceMath");
        expect(shown("alias:Clock=Shop.Core.Time.SystemClock")).toBe("using Clock = Shop.Core.Time.SystemClock");
        expect(shown("galias:Clock=Shop.Core.Time.SystemClock")).toBe("global using Clock = Shop.Core.Time.SystemClock");
        expect(shown("ns:Shop.Core.Pricing")).toBe("namespace Shop.Core.Pricing");
        expect(shown("type:Guard")).toBe("Guard");
        expect(shown("qtype:Core.Auditing.Audited")).toBe("Core.Auditing.Audited");
        expect(shown("alias:NoEquals")).toBe("alias:NoEquals");      // not one it writes: unchanged
        expect(shown("constructor:x")).toBe("constructor:x");
    });
});
