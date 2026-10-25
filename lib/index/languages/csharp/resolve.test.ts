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
    collectionExtensions: "src/Shop.Web/Extensions/CollectionExtensions.cs", audited: "src/Shop.Core/Auditing/AuditedAttribute.cs",
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

    it("extension-method calls aren't linked: an extension class is reached only by naming it (here a using static)", () => {
        expect(edgesOf(resolver, P.program, truth.specifiers[P.program])).toEqual([]);              // its AddShop call gives no specifier
        expect(edgesOf(resolver, P.hostExtensions, truth.specifiers[P.hostExtensions])).toEqual([]);  // nor its AddShop and IsNullOrEmpty
        expect(resolver.resolve(P.checkout, "static:Shop.Web.Extensions.CollectionExtensions")).toEqual([P.collectionExtensions]);
    });

    it("an attribute's lookup name that doesn't resolve is context when its twin does", () => {
        expect(resolver.resolve(P.receipt, "qtype:Core.Auditing.AuditedAttribute")).toEqual([P.audited]);
        expect(resolver.kindOf(P.receipt, "qtype:Core.Auditing.Audited")).toBe("context");
        expect(resolver.kindOf(P.checkout, "type:Audited")).toBe("external");   // no repo type is named Audited at all
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

    it("an alias wins over the usings", () => {
        const resolver = resolverOf({
            "A.cs": { specifiers: ["ns:A"], declares: ["type:A.Clock"] },
            "B.cs": { specifiers: ["ns:B"], declares: ["type:B.SystemClock"] },
            "Use.cs": { specifiers: ["using:A", "alias:Clock=B.SystemClock", "ns:C", "type:Clock"] },
        });
        expect(resolver.resolve("Use.cs", "type:Clock")).toEqual(["B.cs"]);
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

    it("a name with n type arguments: the files declaring it with arity n (partial parts all), else none (R23)", () => {
        const resolver = resolverOf({
            "Lib/Box.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Box"] },
            "Lib/BoxOfT.Part.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Box`1"] },
            "Lib/BoxOfT.cs": { specifiers: ["ns:Lib", "type:Box"], declares: ["type:Lib.Box`1"] },
            "Lib/BoxOfTwo.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Box`2"] },
            "Use.cs": { specifiers: ["using:Lib", "ns:App", "type:Box", "type:Box`1", "type:Box`2", "type:Box`3", "qtype:Lib.Box`1", "qtype:Lib.Box`3"] },
        });
        expect(resolver.resolve("Use.cs", "type:Box")).toEqual(["Lib/Box.cs"]);
        expect(resolver.resolve("Use.cs", "type:Box`1")).toEqual(["Lib/BoxOfT.Part.cs", "Lib/BoxOfT.cs"]);   // a generic partial type's two parts
        expect(resolver.resolve("Use.cs", "type:Box`2")).toEqual(["Lib/BoxOfTwo.cs"]);
        expect(resolver.resolve("Use.cs", "qtype:Lib.Box`1")).toEqual(["Lib/BoxOfT.Part.cs", "Lib/BoxOfT.cs"]);
        expect(resolver.resolve("Lib/BoxOfT.cs", "type:Box")).toEqual(["Lib/Box.cs"]);
        // no Box`3 anywhere: C# can't bind Box<A, B, C> to another arity (CS0308), so nothing, where R5 reached every Box
        expect(resolver.resolve("Use.cs", "type:Box`3")).toEqual([]);
        expect(resolver.resolve("Use.cs", "qtype:Lib.Box`3")).toEqual([]);
        expect(edgesOf(resolver, "Use.cs", ["type:Box`3", "qtype:Lib.Box`3"])).toEqual([]);
        // kinds: no repo type is Box with three type parameters, so type:Box`3 is outside the repo; qtype:'s kind is its
        // qualifier's (Lib is a repo namespace), as before
        expect(resolver.kindOf("Use.cs", "type:Box`3")).toBe("external");
        expect(resolver.kindOf("Use.cs", "qtype:Lib.Box`3")).toBe("internal");

        // the arity is looked for through every step: a using's Box<T> beats the enclosing namespace's Box, and a name of
        // an arity declared nowhere doesn't stop at the enclosing namespace's Box either
        const nearer = resolverOf({
            "App/Box.cs": { specifiers: ["ns:App"], declares: ["type:App.Box"] },
            "Lib/BoxOfT.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Box`1"] },
            "App/Use.cs": { specifiers: ["using:Lib", "ns:App", "type:Box`1", "type:Box`2"] },
        });
        expect(nearer.resolve("App/Use.cs", "type:Box`1")).toEqual(["Lib/BoxOfT.cs"]);
        expect(nearer.resolve("App/Use.cs", "type:Box`2")).toEqual([]);
        expect(nearer.kindOf("App/Use.cs", "type:Box`2")).toBe("external");
    });

    it("an outside generic beside a repo type of its name with another arity: no edge, and outside the repo (R23, the final review's B-I3)", () => {
        // Microsoft.Extensions.Logging's ILogger<T> and Azure's Response<T>, beside the repo's own non-generic ILogger and Response
        const resolver = resolverOf({
            "src/App/Logging/ILogger.cs": { specifiers: ["ns:App.Logging"], declares: ["type:App.Logging.ILogger"] },
            "src/App/Http/Response.cs": { specifiers: ["ns:App.Http"], declares: ["type:App.Http.Response"] },
            "src/App/Service.cs": {
                specifiers: ["using:Microsoft.Extensions.Logging", "using:Azure", "using:App.Logging", "using:App.Http", "ns:App", "type:ILogger`1", "type:Response`1"],
            },
            "src/App/Plain.cs": { specifiers: ["using:App.Logging", "using:App.Http", "ns:App", "type:ILogger", "type:Response"] },
        });
        const service = "src/App/Service.cs";
        expect(resolver.resolve(service, "type:ILogger`1")).toEqual([]);
        expect(resolver.resolve(service, "type:Response`1")).toEqual([]);
        expect(edgesOf(resolver, service, ["type:ILogger`1", "type:Response`1"])).toEqual([]);
        expect(resolver.kindOf(service, "type:ILogger`1")).toBe("external");
        expect(resolver.kindOf(service, "type:Response`1")).toBe("external");
        // the repo's own types, named as they're declared, still resolve
        expect(resolver.resolve("src/App/Plain.cs", "type:ILogger")).toEqual(["src/App/Logging/ILogger.cs"]);
        expect(resolver.resolve("src/App/Plain.cs", "type:Response")).toEqual(["src/App/Http/Response.cs"]);
    });

    it("a name written without type arguments that no file declares at arity 0: by name, at any arity, as before (R23 keeps R5's fallback there)", () => {
        // what the parser makes of `new QueryResult<(BaseItem Item, ItemCounts ItemCounts)>(…)` on jellyfin: no type arguments
        const resolver = resolverOf({
            "Lib/QueryResult.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.QueryResult`1"] },
            "Lib/Pair.cs": { specifiers: ["ns:Lib"], declares: ["type:Lib.Pair`2"] },
            "Use.cs": { specifiers: ["using:Lib", "ns:App", "type:QueryResult", "qtype:Lib.Pair", "type:Missing"] },
        });
        expect(resolver.resolve("Use.cs", "type:QueryResult")).toEqual(["Lib/QueryResult.cs"]);
        expect(resolver.resolve("Use.cs", "qtype:Lib.Pair")).toEqual(["Lib/Pair.cs"]);
        expect(resolver.kindOf("Use.cs", "type:QueryResult")).toBe("internal");
        expect(resolver.kindOf("Use.cs", "type:Missing")).toBe("external");   // no repo type of that name at any arity
    });

    it("a using static's and an alias's target, and a type nested in a generic one: their arity, else by name only when written without type arguments", () => {
        const resolver = resolverOf({
            "Box.cs": { specifiers: ["ns:N"], declares: ["type:N.Box", "type:N.Box.Hinge", "type:N.Box.Lid"] },
            "BoxOfT.cs": { specifiers: ["ns:N"], declares: ["type:N.Box`1", "type:N.Box`1.Lid"] },
            "Bag.cs": { specifiers: ["ns:N"], declares: ["type:N.Bag`1"] },
            "Use.cs": {
                specifiers: ["static:N.Box`1", "static:N.Box`2", "static:N.Bag", "alias:B=N.Box`1", "alias:C=N.Box`3", "alias:D=N.Bag", "ns:App", "type:Lid", "type:Hinge", "type:B", "type:C", "type:D"],
            },
        });
        expect(resolver.resolve("Use.cs", "static:N.Box`1")).toEqual(["BoxOfT.cs"]);
        expect(resolver.resolve("Use.cs", "static:N.Box`2")).toEqual([]);                       // no Box`2: nothing (R23)
        expect(resolver.resolve("Use.cs", "static:N.Bag")).toEqual(["Bag.cs"]);                 // no arity written: by name
        expect(resolver.resolve("Use.cs", "type:Lid")).toEqual(["BoxOfT.cs"]);                  // nested in the static N.Box`1
        expect(resolver.resolve("Use.cs", "type:Hinge")).toEqual([]);                           // only the non-generic Box has one: N.Box<T> imports none
        expect(resolver.resolve("Use.cs", "type:B")).toEqual(["BoxOfT.cs"]);
        expect(resolver.resolve("Use.cs", "type:C")).toEqual([]);                               // the alias's target has three type arguments: nothing
        expect(resolver.resolve("Use.cs", "type:D")).toEqual(["Bag.cs"]);                       // the alias's target has none: by name
        expect(resolver.kindOf("Use.cs", "static:N.Box`2")).toBe("external");
    });

    it("a generic attribute's two lookup names keep its arity: the one that doesn't resolve is context when its twin does", () => {
        const resolver = resolverOf({
            "Marker.cs": { specifiers: ["ns:N"], declares: ["type:N.MarkerAttribute`1"] },
            "Use.cs": { specifiers: ["ns:App", "qtype:N.Marker`1", "qtype:N.MarkerAttribute`1"] },
        });
        expect(resolver.resolve("Use.cs", "qtype:N.MarkerAttribute`1")).toEqual(["Marker.cs"]);
        expect(resolver.resolve("Use.cs", "qtype:N.Marker`1")).toEqual([]);
        expect(resolver.kindOf("Use.cs", "qtype:N.Marker`1")).toBe("context");
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
