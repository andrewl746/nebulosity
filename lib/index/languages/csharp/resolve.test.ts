import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { csharpRepoTruth as truth } from "../../../../test/helpers/csharp-repo-truth";
import type { ResolveContext, StoredFacts } from "../adapter";
import { edgesOf } from "../resolution";
import { createCsharpResolver, usingItems } from "./resolve";

const FIXTURE = path.resolve("test", "fixtures", "csharp-repo");
/** The fixture's manifests, by hand: every .csproj and the root Directory.Build.props, sorted. */
const MANIFESTS = [
    "Directory.Build.props",
    "src/Shop.Core/Shop.Core.csproj",
    "src/Shop.Web.IntegrationTests/Shop.Web.IntegrationTests.csproj",
    "src/Shop.Web/Shop.Web.csproj",
    "tests/Shop.Core.Tests/Shop.Core.Tests.csproj",
];

/** A resolver over the truth's own specifiers and declares (hand-derived), so the resolver is tested apart from the parser. */
function fixtureResolver() {
    const files = new Map<string, StoredFacts>(truth.files.map((f) => [f.path, { importSpecifiers: truth.specifiers[f.path], declares: truth.declares[f.path] }]));
    return createCsharpResolver({
        root: FIXTURE, fileSet: new Set(files.keys()), files, manifests: MANIFESTS, cache: new Map(),
        readText: (rel) => (fs.existsSync(path.join(FIXTURE, rel)) ? fs.readFileSync(path.join(FIXTURE, rel), "utf8") : null),
    });
}

/** A resolver over a few hand-written files. */
function resolverOf(files: Record<string, { specifiers?: string[]; declares?: string[] }>, manifests: Record<string, string> = {}, reads: string[] = []) {
    const facts = new Map<string, StoredFacts>(Object.entries(files).map(([p, f]) => [p, { importSpecifiers: f.specifiers ?? [], declares: f.declares ?? [] }]));
    const context: ResolveContext = {
        root: "/repo", fileSet: new Set(facts.keys()), files: facts, manifests: Object.keys(manifests).sort(), cache: new Map(),
        readText: (rel) => {
            reads.push(rel);
            return manifests[rel] ?? null;
        },
    };
    return createCsharpResolver(context);
}

const P = {
    totals: "src/Shop.Core/Carts/Cart.Totals.cs", cart: "src/Shop.Core/Carts/Cart.cs", catalogItem: "src/Shop.Core/Catalog/Item.cs",
    productCode: "src/Shop.Core/Catalog/ProductCode.cs", modelItem: "src/Shop.Core/Models/Item.cs", order: "src/Shop.Core/Models/Order.cs",
    orderStatus: "src/Shop.Core/Models/OrderStatus.cs", money: "src/Shop.Core/Money.cs", calculator: "src/Shop.Core/Pricing/PriceCalculator.cs",
    priceMath: "src/Shop.Core/Pricing/PriceMath.cs", coreGuard: "src/Shop.Core/Shared/Guard.cs", iclock: "src/Shop.Core/Time/IClock.cs",
    systemClock: "src/Shop.Core/Time/SystemClock.cs", scenarios: "src/Shop.Web.IntegrationTests/CheckoutScenarios.cs",
    hostExtensions: "src/Shop.Web/Extensions/HostExtensions.cs", serviceExtensions: "src/Shop.Web/Extensions/ServiceCollectionExtensions.cs",
    globalUsings: "src/Shop.Web/GlobalUsings.cs", cartPage: "src/Shop.Web/Pages/CartPage.cs", checkout: "src/Shop.Web/Pages/CheckoutPage.cs",
    pageBase: "src/Shop.Web/Pages/PageBase.cs", receipt: "src/Shop.Web/Pages/ReceiptPage.cs", program: "src/Shop.Web/Program.cs",
    webGuard: "src/Shop.Web/Shared/Guard.cs", fakes: "tests/Shop.Core.Tests/Fakes/FakeServices.cs", tests: "tests/Shop.Core.Tests/PriceCalculatorTests.cs",
    seed: "tools/bin/Seed.cs",
} as const;

describe("the C# resolver on csharp-repo's truth", () => {
    const resolver = fixtureResolver();

    it("makes every truth edge and no other", () => {
        const edges = truth.files.flatMap((f) => edgesOf(resolver, f.path, truth.specifiers[f.path])).map((e) => ({ source: e.source, target: e.target }));
        expect(edges.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : 1))).toEqual(truth.edges);
    });

    it("names every specifier's kind as the truth does", () => {
        for (const f of truth.files){
            for (const [specifier, kind] of Object.entries(truth.kinds[f.path])) expect(resolver.kindOf(f.path, specifier), `${f.path} ${specifier}`).toBe(kind);
        }
    });

    it("lists the entry points: top-level statements and a static Main", () => {
        expect(resolver.entryPoints()).toEqual(truth.entryPoints);
    });

    it("type:N, step 1: the innermost enclosing namespace that holds N wins, then its parents", () => {
        expect(resolver.resolve(P.order, "type:Item")).toEqual([P.modelItem]);          // Shop.Core.Models.Item, not Shop.Core.Catalog.Item
        expect(resolver.resolve(P.order, "type:Money")).toEqual([P.money]);             // Shop.Core.Money, a parent namespace
        expect(resolver.resolve(P.calculator, "type:Money")).toEqual([P.money]);        // through the nested block's Shop.Core
    });

    it("type:N, step 2: the file's usings and the project's (global usings, <Using> items) together", () => {
        expect(resolver.resolve(P.cart, "type:Item")).toEqual([P.catalogItem]);         // using Shop.Core.Catalog
        expect(resolver.resolve(P.checkout, "type:Item")).toEqual([P.modelItem]);       // Shop.Web.csproj's <Using Include="Shop.Core.Models" />
        expect(resolver.resolve(P.cartPage, "type:Cart")).toEqual([P.totals, P.cart]);  // GlobalUsings.cs's global using Shop.Core.Carts
        expect(resolver.resolve(P.scenarios, "type:Order")).toEqual([]);                // another project: Shop.Web's usings don't reach it
        expect(resolver.resolve(P.checkout, "type:PriceCalculator")).toEqual([]);       // Shop.Core.Pricing isn't visible there
    });

    it("type:N: an alias names its target (the file's, or the project's global alias)", () => {
        expect(resolver.resolve(P.receipt, "type:Receipt")).toEqual([P.order]);
        expect(resolver.resolve(P.checkout, "type:Clock")).toEqual([P.systemClock]);
    });

    it("type:N: types nested in static: and the project's gstatic: types count; static: and gstatic: name their type's file", () => {
        expect(resolver.resolve(P.calculator, "type:Rounding")).toEqual([P.priceMath]);
        expect(resolver.resolve(P.receipt, "type:Rounding")).toEqual([P.priceMath]);
        expect(resolver.resolve(P.calculator, "static:Shop.Core.Pricing.PriceMath")).toEqual([P.priceMath]);
        expect(resolver.resolve(P.globalUsings, "gstatic:Shop.Core.Pricing.PriceMath")).toEqual([P.priceMath]);
    });

    it("every file declaring the chosen name gets the edge (a partial class)", () => {
        expect(resolver.resolve(P.tests, "type:Cart")).toEqual([P.totals, P.cart]);
    });

    it("a name declared in two projects: the importer's project's file wins", () => {
        expect(resolver.resolve(P.calculator, "type:Guard")).toEqual([P.coreGuard]);
        expect(resolver.resolve(P.checkout, "type:Guard")).toEqual([P.webGuard]);
    });

    it("qtype: as written, and under each enclosing namespace", () => {
        expect(resolver.resolve(P.checkout, "qtype:Shop.Core.Models.Order")).toEqual([P.order]);
        expect(resolver.resolve(P.tests, "qtype:Catalog.Item")).toEqual([P.catalogItem]);
        expect(resolver.resolve(P.webGuard, "qtype:System.ArgumentException")).toEqual([]);
    });

    it("ext:M: an extension whose namespace is visible (a using) or enclosing; none when neither", () => {
        expect(resolver.resolve(P.program, "ext:AddShop")).toEqual([P.serviceExtensions]);
        expect(resolver.resolve(P.hostExtensions, "ext:AddShop")).toEqual([P.serviceExtensions]);
        expect(resolver.resolve(P.tests, "ext:AddShop")).toEqual([]);
    });

    it("no edge from using:, global:, alias:, galias: or ns:", () => {
        for (const [file, specifier] of [
            [P.cart, "using:Shop.Core.Catalog"], [P.globalUsings, "global:Shop.Core.Carts"], [P.receipt, "alias:Receipt=Shop.Core.Models.Order"],
            [P.globalUsings, "galias:Clock=Shop.Core.Time.SystemClock"], [P.order, "ns:Shop.Core.Models"],
        ] as const){
            expect(resolver.resolve(file, specifier), specifier).toEqual([]);
            expect(resolver.kindOf(file, specifier), specifier).toBe("context");
        }
    });
});

describe("the C# resolver on hand-written files", () => {
    it("a name declared in several projects, none of them the importer's: every declaring file", () => {
        const resolver = resolverOf({
            "a/X.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Guard"] },
            "b/X.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Guard"] },
            "c/Use.cs": { specifiers: ["using:Lib", "ns:App", "type:Guard"] },
        }, { "a/A.csproj": "<Project />", "b/B.csproj": "<Project />", "c/C.csproj": "<Project />" });
        expect(resolver.resolve("c/Use.cs", "type:Guard")).toEqual(["a/X.cs", "b/X.cs"]);
    });

    it("a Directory.Build.props' <Using> items reach the projects at and below its folder only", () => {
        const resolver = resolverOf({
            "lib/Models.cs": { specifiers: ["ns:Lib.Models"], declares: ["type:Lib.Models.Order"] },
            "src/App/Use.cs": { specifiers: ["ns:App", "type:Order"] },
            "tools/Tool/Use.cs": { specifiers: ["ns:Tool", "type:Order"] },
        }, {
            "src/Directory.Build.props": "<Project><ItemGroup><Using Include=\"Lib.Models\" /></ItemGroup></Project>",
            "src/App/App.csproj": "<Project />", "tools/Tool/Tool.csproj": "<Project />",
        });
        expect(resolver.resolve("src/App/Use.cs", "type:Order")).toEqual(["lib/Models.cs"]);
        expect(resolver.resolve("tools/Tool/Use.cs", "type:Order")).toEqual([]);
    });

    it("an alias wins over the usings, and an extension in the global namespace is visible everywhere", () => {
        const resolver = resolverOf({
            "A.cs": { specifiers: ["ns:A"], declares: ["type:A.Clock"] },
            "B.cs": { specifiers: ["ns:B"], declares: ["type:B.SystemClock"] },
            "Ext.cs": { declares: ["ext:Helpers.Tidy", "type:Helpers"] },
            "Use.cs": { specifiers: ["using:A", "alias:Clock=B.SystemClock", "ns:C", "type:Clock", "ext:Tidy"] },
        });
        expect(resolver.resolve("Use.cs", "type:Clock")).toEqual(["B.cs"]);
        expect(resolver.resolve("Use.cs", "ext:Tidy")).toEqual(["Ext.cs"]);
    });

    it("ignores a .csproj under a folder C# leaves out (bin/, obj/ beside a project) and reads each manifest once per cache", () => {
        const reads: string[] = [];
        const resolver = resolverOf({ "src/App/Use.cs": { specifiers: ["ns:App"] } }, {
            "src/App/App.csproj": "<Project />", "src/App/bin/Debug/App.csproj": "<Project><ItemGroup><Using Include=\"X\" /></ItemGroup></Project>",
        }, reads);
        resolver.resolve("src/App/Use.cs", "type:Anything");
        resolver.resolve("src/App/Use.cs", "type:Other");
        expect(reads).toEqual(["src/App/App.csproj"]);
    });

    it("kinds: qtype is internal when its qualifier is a repo namespace (or a parent of one), even unresolved", () => {
        const resolver = resolverOf({
            "M.cs": { specifiers: ["ns:Shop.Core.Models"], declares: ["type:Shop.Core.Models.Order"] },
            "Use.cs": { specifiers: ["ns:Shop.Web", "qtype:Core.Models.Missing", "qtype:Shop.Gone", "qtype:System.Text.StringBuilder"] },
        });
        expect(resolver.kindOf("Use.cs", "qtype:Core.Models.Missing")).toBe("internal");   // Shop.Core.Models under the enclosing Shop
        expect(resolver.kindOf("Use.cs", "qtype:Shop.Gone")).toBe("internal");             // Shop is a parent of a repo namespace
        expect(resolver.kindOf("Use.cs", "qtype:System.Text.StringBuilder")).toBe("external");
    });
});

describe("usingItems", () => {
    it("reads Include, Alias and Static, and leaves out MSBuild properties and Remove", () => {
        const items = usingItems([
            "<ItemGroup>", "  <Using Include=\"A.B\" />", "  <Using Include=\"global::C\" />", "  <Using Include=\"D.E\" Alias=\"F\" />",
            "  <Using Include=\"G.H\" Static=\"True\" />", "  <Using Include=\"$(RootNamespace).Models\" />", "  <Using Remove=\"System.Linq\" />", "</ItemGroup>",
        ].join("\n"));
        expect(items).toEqual({ namespaces: ["A.B", "C"], statics: ["G.H"], aliases: new Map([["F", "D.E"]]) });
    });
});
