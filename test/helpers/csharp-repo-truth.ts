import type { SymbolKind, SymbolRow } from "../../lib/db/schema";
import type { ReferenceKind } from "../../lib/index/languages/adapter";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";

/**
 * test/fixtures/csharp-repo's ground truth, DERIVED BY HAND from the fixture's files and the plan's Task C rules
 * (docs/plans/2026-10-24-e4-languages.md, "Task C: C#", and "The language tasks"), before the C# adapter's code
 * existed: never by running the code (CLAUDE.md). Change a fixture file and re-derive this by hand.
 *
 * Projects (a file's project is the folder of the nearest .csproj above it, else the repo root):
 * - src/Shop.Core (no Using items), src/Shop.Web (<Using Include="Shop.Core.Models" />, and GlobalUsings.cs's
 *   global:Shop.Core.Carts, gstatic:Shop.Core.Pricing.PriceMath and galias:Clock=Shop.Core.Time.SystemClock),
 *   src/Shop.Web.IntegrationTests, tests/Shop.Core.Tests; tools/bin/Seed.cs belongs to the repo root's.
 * - The root Directory.Build.props has no Using items, so it changes nothing.
 * - Excluded: the .cs files under src/Shop.Core/bin/, src/Shop.Core/obj/ and src/Shop.Web/obj/ (beside a .csproj).
 *   tools/bin/ has no .csproj beside it, so tools/bin/Seed.cs is indexed.
 *
 * How the plan's rules were read where it is silent (each a choice, recorded in progress-csharp.md):
 * 1. Source order: each specifier sits where its name starts (the `using`/`global` keyword for a using directive, the
 *    namespace's name, a type's first identifier), each once, at its first place. An
 *    attribute [N] gives type:N then type:NAttribute.
 * 2. The names inside using directives and namespace names give only their using/ns specifier. Keywords give nothing
 *    (string, int, decimal, void, var, default, a target-typed new()).
 * 3. Static access N.Member: N is the identifier a member access starts with. The file's locals, parameters (a
 *    positional record's and a lambda's too), fields and properties are its exclusions, by name over the whole file.
 *    nameof(N) follows the same rule. Item.cs's `Price.Amount` (a record parameter) and Order.cs's `Total.Amount`
 *    (a property) give nothing.
 * 4. An invoked member (`x.M(…)`, `x?.M(…)`) gives no specifier of its own (choice 14): only its receiver can, through
 *    static access (`Guard.NotNull(…)` gives type:Guard). An unqualified call `M(…)` gives nothing.
 * 5. "Names the file declares" are the types it declares, nested ones included; type parameters are left out too.
 * 6. Symbols: a constructor is named as written (the type's name: qualifiedName `Order.Order`), an indexer `this`; a
 *    const field is a field (property). Enum members and a positional record's parameters are not symbols. Exported
 *    (ADR-065's one rule, the final review's B-I2): a top-level type with its own `public`; a member, or a nested type,
 *    only when its owner is exported and it is `public` itself (so Guard.NotNull, public in an internal class, is not
 *    exported); an interface's members take the interface's flag.
 * 7. type:N's steps meet no conflict in this fixture (no alias shares a name with a visible type, no two usings hold
 *    the same name), so their order between the alias and the usings doesn't change any edge here.
 * 8. qtype:'s kind: internal when it resolves, or when its qualifier, as written or under an enclosing namespace, is a
 *    namespace the repo declares (a declared namespace or a prefix of one). qtype:System.ArgumentException: external.
 * 9. The scan reading reads `using …;` and `namespace …` lines as written, with no tree, so a nested block's
 *    `namespace Pricing` gives ns:Pricing, where the full reading gives ns:Shop.Core.Pricing.
 *
 * Added after jellyfin's first measurement (Step 6, round 1; the case and its truth were written before the code):
 * 12. An attribute's two lookup names (N and NAttribute): the one that doesn't resolve is context when the other one
 *     resolves, since C# binds the attribute to the one that exists. ReceiptPage.cs's qtype:Core.Auditing.Audited.
 *
 * The controller's rulings of 2026-10-25 (rounds 2 and 3, made for the owner; the evidence is in ADR-065):
 * 14. No ext: specifier and no extension method in declares: C# extension-method calls are not linked. Binding one
 *     needs the receiver's and the arguments' types (an applicable instance method or overload always wins), and by name
 *     alone 19 of 30 sampled links on jellyfin were right. Round 1's choices 10 (a predefined type's static call) and 11
 *     (a using static's extension methods) and round 2's 13 (ext:'s kind) were about ext: and retire with it. The
 *     fixture's extension cases (CollectionExtensions.cs, HostExtensions.cs, the AddShop and IsNullOrEmpty calls) stay:
 *     they give no specifier and no edge.
 *
 * Added in the pre-ship pass (docs/plans/2026-10-25-pre-ship-pass.md, Task C; the controller's ruling R5: exact arity
 * first, else by name as today), with the arity twins src/Shop.Core/Boxes/ (Box, Box<T>, Box<TFirst, TSecond>, and Pair,
 * which has no twin) and their readers in src/Shop.Core/Shipping/; then, for R23, src/Shop.Core/Logging/ILogger.cs (the
 * repo's own non-generic ILogger) and src/Shop.Core/Shipping/Dispatcher.cs (Microsoft.Extensions.Logging's ILogger<T>):
 * 15. Generic arity, in the CLR's backtick form. A type declared with n type parameters declares type:<ns>.N`n (a generic
 *     outer type carries its own: O`1.In); a name written with n type arguments is type:N`n, or qtype:A.N`n, each generic
 *     segment with its own; typeof(Box<>) counts 1 and typeof(Box<,>) 2; with none, no suffix, so every non-generic name
 *     reads as before. A using static's or an alias's target carries it too. A file's own names are left out by name and
 *     arity, so BoxOfT.cs's base type Box is a reference (to Box.cs) and BoxOfTwo.cs's Box<TFirst> one (to BoxOfT.cs).
 * 16. A reference resolves to the files declaring its name with its arity when C#'s lookup (choice 7's steps) finds any.
 *     When it finds none, the name's form decides (the controller's ruling R23, amending R5, after the pass's final
 *     review, B-I3):
 *     - written without type arguments, it resolves by name at any arity, as before the pass (edit (f)): the parser can
 *       drop type arguments (a named tuple's, on jellyfin), but it never invents them;
 *     - written with n type arguments, or through an alias's or a using static's target written with them, it resolves
 *       to nothing, since C# can't bind X<T> to a type of another arity (CS0308): edit (e), and Dispatcher.cs's
 *       ILogger<Dispatcher> beside the repo's non-generic Shop.Core.Logging.ILogger.
 *     Partial types (one name, one arity, several files) still reach every part. Kinds: a type: name written with n type
 *     arguments is a repo name only when a repo type has that name with arity n (Review C's M1, paired with R23); without
 *     any, at any arity, as before. qtype:'s kind is choice 8's, unchanged.
 */

const P = {
    audited: "src/Shop.Core/Auditing/AuditedAttribute.cs",
    box: "src/Shop.Core/Boxes/Box.cs",
    boxOfT: "src/Shop.Core/Boxes/BoxOfT.cs",
    boxOfTwo: "src/Shop.Core/Boxes/BoxOfTwo.cs",
    pair: "src/Shop.Core/Boxes/Pair.cs",
    totals: "src/Shop.Core/Carts/Cart.Totals.cs",
    cart: "src/Shop.Core/Carts/Cart.cs",
    catalogItem: "src/Shop.Core/Catalog/Item.cs",
    productCode: "src/Shop.Core/Catalog/ProductCode.cs",
    logger: "src/Shop.Core/Logging/ILogger.cs",
    modelItem: "src/Shop.Core/Models/Item.cs",
    order: "src/Shop.Core/Models/Order.cs",
    orderStatus: "src/Shop.Core/Models/OrderStatus.cs",
    money: "src/Shop.Core/Money.cs",
    calculator: "src/Shop.Core/Pricing/PriceCalculator.cs",
    priceMath: "src/Shop.Core/Pricing/PriceMath.cs",
    coreGuard: "src/Shop.Core/Shared/Guard.cs",
    crate: "src/Shop.Core/Shipping/Crate.cs",
    dispatcher: "src/Shop.Core/Shipping/Dispatcher.cs",
    pallet: "src/Shop.Core/Shipping/Pallet.cs",
    parcel: "src/Shop.Core/Shipping/Parcel.cs",
    iclock: "src/Shop.Core/Time/IClock.cs",
    systemClock: "src/Shop.Core/Time/SystemClock.cs",
    scenarios: "src/Shop.Web.IntegrationTests/CheckoutScenarios.cs",
    collectionExtensions: "src/Shop.Web/Extensions/CollectionExtensions.cs",
    hostExtensions: "src/Shop.Web/Extensions/HostExtensions.cs",
    serviceExtensions: "src/Shop.Web/Extensions/ServiceCollectionExtensions.cs",
    globalUsings: "src/Shop.Web/GlobalUsings.cs",
    cartPage: "src/Shop.Web/Pages/CartPage.cs",
    checkout: "src/Shop.Web/Pages/CheckoutPage.cs",
    pageBase: "src/Shop.Web/Pages/PageBase.cs",
    receipt: "src/Shop.Web/Pages/ReceiptPage.cs",
    program: "src/Shop.Web/Program.cs",
    webGuard: "src/Shop.Web/Shared/Guard.cs",
    fakes: "tests/Shop.Core.Tests/Fakes/FakeServices.cs",
    tests: "tests/Shop.Core.Tests/PriceCalculatorTests.cs",
    seed: "tools/bin/Seed.cs",
} as const;

/** A top-level declaration (parent null) or a member of a top-level type. */
const sym = (name: string, kind: SymbolKind, startLine: number, endLine: number, exported: boolean, parent: string | null = null): SymbolRow => ({
    name, qualifiedName: parent === null ? name : `${parent}.${name}`, kind, startLine, endLine, exported, parentQualifiedName: parent,
});
const edge = (source: string, target: string): TruthEdge => ({ source, target });
const byEdge = (a: TruthEdge, b: TruthEdge): number =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
/** One file's kinds, grouped (the kit checks they name exactly the file's specifiers). */
function kinds(groups: { context?: string[]; internal?: string[]; external?: string[] }): Record<string, ReferenceKind> {
    const out: Record<string, ReferenceKind> = {};
    for (const s of groups.context ?? []) out[s] = "context";
    for (const s of groups.internal ?? []) out[s] = "internal";
    for (const s of groups.external ?? []) out[s] = "external";
    return out;
}

/**
 * The 51 edges of a full run, sorted by source then target, each with the rule that makes it. "type:N, step 1" is an
 * enclosing namespace (innermost out), "step 2" a visible using (the file's and the project's), "alias" an alias's
 * target, "static" a type nested in a static:/gstatic: type. "`n" is the arity the name is written and declared with
 * (choices 15 and 16).
 */
const EDGES: TruthEdge[] = [
    edge(P.boxOfT, P.box),                          // type:Box (Box<T>'s base type, arity 0), step 1: Shop.Core.Boxes.Box; not its own Box`1
    edge(P.boxOfTwo, P.boxOfT),                     // type:Box`1 (Box<TFirst, TSecond>'s base type Box<TFirst>), step 1: Shop.Core.Boxes.Box`1
    edge(P.totals, P.money),                       // type:Money, step 1: Shop.Core.Money (the parent of Shop.Core.Carts)
    edge(P.cart, P.catalogItem),                    // type:Item, step 2: using Shop.Core.Catalog (Shop.Core.Models.Item isn't visible)
    edge(P.catalogItem, P.productCode),             // type:ProductCode, step 1: Shop.Core.Catalog.ProductCode (same namespace)
    edge(P.catalogItem, P.money),                   // type:Money, step 1: Shop.Core.Money
    edge(P.modelItem, P.money),                     // type:Money (a record parameter's type), step 1: Shop.Core.Money
    edge(P.order, P.modelItem),                     // type:Item, step 1: Shop.Core.Models.Item (same namespace; not Catalog's)
    edge(P.order, P.orderStatus),                   // type:OrderStatus, step 1: Shop.Core.Models.OrderStatus
    edge(P.order, P.money),                         // type:Money, step 1: Shop.Core.Money (parent namespace)
    edge(P.calculator, P.totals),                   // type:Cart, step 2: Shop.Core.Carts.Cart, the partial class's second part
    edge(P.calculator, P.cart),                     // type:Cart, the first part
    edge(P.calculator, P.catalogItem),              // type:Item, step 2: using Shop.Core.Catalog
    edge(P.calculator, P.money),                    // type:Money, step 1: Shop.Core.Money (enclosing: Shop.Core.Pricing, Shop.Core)
    edge(P.calculator, P.priceMath),                // static:Shop.Core.Pricing.PriceMath; type:Rounding (static) reaches it too
    edge(P.calculator, P.coreGuard),                // type:Guard, step 2: Shop.Shared.Guard, declared in two projects: Shop.Core's wins
    edge(P.crate, P.boxOfT),                        // type:Box`1 (a field Box<int>, typeof(Box<>)), step 2: using Shop.Core.Boxes; qtype:Shop.Core.Boxes.Box`1 as written
    edge(P.pallet, P.boxOfTwo),                     // type:Box`2 (Box<string, int>, typeof(Box<,>)), step 2: using Shop.Core.Boxes
    edge(P.pallet, P.pair),                         // type:Pair`2, step 2: the one Pair (no twin), as before the pass
    edge(P.parcel, P.box),                          // type:Box (new Box()), step 2: using Shop.Core.Boxes
    edge(P.systemClock, P.iclock),                  // type:IClock (base list), step 1: Shop.Core.Time.IClock
    edge(P.scenarios, P.systemClock),               // qtype:Shop.Core.Time.SystemClock, as written
    edge(P.scenarios, P.checkout),                  // type:CheckoutPage, step 2: using Shop.Web.Pages
    edge(P.serviceExtensions, P.iclock),            // type:IClock (a generic argument), step 2: using Shop.Core.Time
    edge(P.serviceExtensions, P.systemClock),       // type:SystemClock (a generic argument), step 2: using Shop.Core.Time
    edge(P.globalUsings, P.priceMath),              // gstatic:Shop.Core.Pricing.PriceMath
    edge(P.cartPage, P.totals),                     // type:Cart, step 2: the project's global using Shop.Core.Carts
    edge(P.cartPage, P.cart),                       // type:Cart
    edge(P.cartPage, P.order),                      // type:Order, after the syntax error: step 2, the .csproj's <Using> Shop.Core.Models
    edge(P.cartPage, P.iclock),                     // type:IClock, step 2: using Shop.Core.Time
    edge(P.cartPage, P.pageBase),                   // type:PageBase, step 1: Shop.Web.Pages.PageBase
    edge(P.checkout, P.audited),                    // [Audited] → type:AuditedAttribute, step 2: using Shop.Core.Auditing
    edge(P.checkout, P.totals),                     // type:Cart (nameof, a parameter), step 2: global using Shop.Core.Carts
    edge(P.checkout, P.cart),                       // type:Cart
    edge(P.checkout, P.modelItem),                  // type:Item (typeof), step 2: the .csproj's <Using> Shop.Core.Models
    edge(P.checkout, P.order),                      // type:Order (generic base, return type), the <Using>; qtype:Shop.Core.Models.Order too
    edge(P.checkout, P.systemClock),                // type:Clock, alias: the project's galias Clock=Shop.Core.Time.SystemClock
    edge(P.checkout, P.collectionExtensions),       // static:Shop.Web.Extensions.CollectionExtensions (a using static names its type's file)
    edge(P.checkout, P.pageBase),                   // type:PageBase (base list), step 1: Shop.Web.Pages.PageBase
    edge(P.checkout, P.webGuard),                   // type:Guard (static access), step 2: Shop.Shared.Guard: Shop.Web's own wins
    edge(P.receipt, P.audited),                     // [Core.Auditing.Audited] → qtype:Core.Auditing.AuditedAttribute, under the enclosing Shop
    edge(P.receipt, P.order),                       // type:Receipt, alias: using Receipt = Shop.Core.Models.Order
    edge(P.receipt, P.priceMath),                   // type:Rounding, static: nested in the project's gstatic PriceMath
    edge(P.receipt, P.pageBase),                    // type:PageBase, step 1
    edge(P.tests, P.totals),                        // type:Cart, step 2: using Shop.Core.Carts
    edge(P.tests, P.cart),                          // type:Cart
    edge(P.tests, P.catalogItem),                   // qtype:Catalog.Item, under the enclosing Shop.Core: Shop.Core.Catalog.Item
    edge(P.tests, P.money),                         // type:Money (static access Money.Zero), step 1: Shop.Core.Money
    edge(P.tests, P.calculator),                    // type:PriceCalculator, step 2: using Shop.Core.Pricing
    edge(P.tests, P.fakes),                         // type:FakeServices, step 2: using Shop.Core.Tests.Fakes
    edge(P.seed, P.order),                          // type:Order, step 2: using Shop.Core.Models (the repo root's project)
    // not edges:
    // - no using:, global:, alias:, galias: or ns: makes one by itself;
    // - CheckoutPage.cs's type:PriceCalculator: Shop.Core.Pricing isn't visible there (edit d makes it visible);
    // - PriceCalculatorTests.cs's type:ProductCode: Shop.Core.Catalog isn't visible there (edit b makes it visible);
    // - no extension-method call (choice 14): Program.cs's and HostExtensions.cs's AddShop, HostExtensions.cs's and
    //   CheckoutPage.cs's IsNullOrEmpty, PriceCalculatorTests.cs's AddShop (FakeServices' own method) give no specifier;
    // - CheckoutPage.cs's type:Audited: no repo type is named Audited (AuditedAttribute is the attribute's class);
    //   ReceiptPage.cs's qtype:Core.Auditing.Audited likewise (context: its twin resolves);
    // - every external name (System, Microsoft.Extensions.DependencyInjection, Xunit, ASP.NET Core's WebApplication);
    // - from Parcel.cs, Crate.cs or Pallet.cs to another arity's Box file, and from BoxOfTwo.cs to Box.cs (choice 16: its
    //   one Box reference is Box<TFirst>, arity 1); before the pass every Box reference reached all three files;
    // - Dispatcher.cs's type:ILogger`1 (ILogger<Dispatcher>, Microsoft.Extensions.Logging's): no file declares ILogger`1,
    //   and it is written with a type argument, so it doesn't fall back to Shop.Core.Logging's non-generic ILogger, which
    //   C# can't bind it to (choice 16, R23); before R23 it reached ILogger.cs by name. Its own name Dispatcher, the
    //   type argument, is left out (choice 5).
];

const without = (...dropped: TruthEdge[]): TruthEdge[] =>
    EDGES.filter((e) => !dropped.some((d) => d.source === e.source && d.target === e.target));
/** The edges with these added, sorted as the kit compares them (a mechanical sort of hand-derived edges). */
const withAdded = (...added: TruthEdge[]): TruthEdge[] => [...EDGES, ...added].sort(byEdge);
/** The edges without the dropped ones and with the added ones, sorted likewise. */
const changed = (dropped: TruthEdge[], added: TruthEdge[]): TruthEdge[] => [...without(...dropped), ...added].sort(byEdge);

export const csharpRepoTruth: FixtureTruth = {
    files: [
        { path: P.audited, language: "csharp", isTest: false, lineCount: 10 },
        { path: P.box, language: "csharp", isTest: false, lineCount: 6 },
        { path: P.boxOfT, language: "csharp", isTest: false, lineCount: 6 },
        { path: P.boxOfTwo, language: "csharp", isTest: false, lineCount: 6 },
        { path: P.pair, language: "csharp", isTest: false, lineCount: 3 },
        { path: P.totals, language: "csharp", isTest: false, lineCount: 8 },
        { path: P.cart, language: "csharp", isTest: false, lineCount: 13 },
        { path: P.catalogItem, language: "csharp", isTest: false, lineCount: 15 },
        { path: P.productCode, language: "csharp", isTest: false, lineCount: 3 },
        { path: P.logger, language: "csharp", isTest: false, lineCount: 6 },
        { path: P.modelItem, language: "csharp", isTest: false, lineCount: 7 },
        { path: P.order, language: "csharp", isTest: false, lineCount: 41 },
        { path: P.orderStatus, language: "csharp", isTest: false, lineCount: 8 },
        { path: P.money, language: "csharp", isTest: false, lineCount: 21 },             // starts with a UTF-8 BOM: no extra line
        { path: P.calculator, language: "csharp", isTest: false, lineCount: 20 },
        { path: P.priceMath, language: "csharp", isTest: false, lineCount: 21 },
        { path: P.coreGuard, language: "csharp", isTest: false, lineCount: 12 },
        { path: P.crate, language: "csharp", isTest: false, lineCount: 13 },
        { path: P.dispatcher, language: "csharp", isTest: false, lineCount: 11 },
        { path: P.pallet, language: "csharp", isTest: false, lineCount: 13 },
        { path: P.parcel, language: "csharp", isTest: false, lineCount: 8 },
        { path: P.iclock, language: "csharp", isTest: false, lineCount: 8 },
        { path: P.systemClock, language: "csharp", isTest: false, lineCount: 8 },
        { path: P.scenarios, language: "csharp", isTest: true, lineCount: 14 },          // a folder segment *.IntegrationTests (no test/ folder)
        { path: P.collectionExtensions, language: "csharp", isTest: false, lineCount: 9 },
        { path: P.hostExtensions, language: "csharp", isTest: false, lineCount: 12 },
        { path: P.serviceExtensions, language: "csharp", isTest: false, lineCount: 13 },
        { path: P.globalUsings, language: "csharp", isTest: false, lineCount: 3 },
        { path: P.cartPage, language: "csharp", isTest: false, lineCount: 15 },
        { path: P.checkout, language: "csharp", isTest: false, lineCount: 32 },
        { path: P.pageBase, language: "csharp", isTest: false, lineCount: 9 },
        { path: P.receipt, language: "csharp", isTest: false, lineCount: 13 },
        { path: P.program, language: "csharp", isTest: false, lineCount: 9 },
        { path: P.webGuard, language: "csharp", isTest: false, lineCount: 9 },
        { path: P.fakes, language: "csharp", isTest: true, lineCount: 13 },              // the folder rule (tests/, Shop.Core.Tests)
        { path: P.tests, language: "csharp", isTest: true, lineCount: 18 },              // the folder rule and the name *Tests.cs
        { path: P.seed, language: "csharp", isTest: false, lineCount: 13 },
    ],
    excluded: [
        "src/Shop.Core/bin/Debug/net8.0/Shop.Core.Generated.cs",
        "src/Shop.Core/obj/Debug/net8.0/Shop.Core.AssemblyInfo.cs",
        "src/Shop.Web/obj/Debug/net8.0/Shop.Web.GlobalUsings.g.cs",
    ],
    specifiers: {
        [P.audited]: ["using:System", "ns:Shop.Core.Auditing", "type:AttributeUsage", "type:AttributeUsageAttribute", "type:AttributeTargets", "type:Attribute"],
        [P.box]: ["ns:Shop.Core.Boxes"],
        [P.boxOfT]: ["ns:Shop.Core.Boxes", "type:Box"],                                // T is a type parameter; Box`1 is its own
        [P.boxOfTwo]: ["ns:Shop.Core.Boxes", "type:Box`1"],                            // TFirst, TSecond: type parameters
        [P.pair]: ["ns:Shop.Core.Boxes"],
        [P.totals]: ["using:System.Linq", "ns:Shop.Core.Carts", "type:Money"],
        [P.cart]: ["using:System.Collections.Generic", "using:Shop.Core.Catalog", "ns:Shop.Core.Carts", "type:List`1", "type:Item", "type:IReadOnlyList`1"],
        [P.catalogItem]: ["ns:Shop.Core.Catalog", "type:ProductCode", "type:Money"],
        [P.productCode]: ["ns:Shop.Core.Catalog"],
        [P.logger]: ["ns:Shop.Core.Logging"],                                          // string and void are keywords; message a parameter
        [P.modelItem]: ["ns:Shop.Core.Models", "type:Money"],
        [P.order]: [
            "using:System", "using:System.Collections.Generic", "ns:Shop.Core.Models",
            "type:List`1", "type:Item", "type:Guid", "type:Money", "type:OrderStatus",
        ],
        [P.orderStatus]: ["ns:Shop.Core.Models"],
        [P.money]: ["using:System", "ns:Shop.Core", "type:IEquatable`1"],
        [P.calculator]: [
            "using:Shop.Core.Carts", "using:Shop.Core.Catalog", "using:Shop.Shared", "static:Shop.Core.Pricing.PriceMath",
            "ns:Shop.Core", "ns:Shop.Core.Pricing", "type:Money", "type:Cart", "type:Item", "type:Guard", "type:Rounding",
        ],
        [P.priceMath]: ["using:System", "ns:Shop.Core.Pricing", "type:MidpointRounding"],
        [P.coreGuard]: ["using:System", "ns:Shop.Shared", "type:ArgumentNullException"],
        [P.crate]: ["using:System", "using:Shop.Core.Boxes", "ns:Shop.Core.Shipping", "type:Box`1", "qtype:Shop.Core.Boxes.Box`1", "type:Type"], // typeof(Box<>): Box`1 again
        // ILogger<Dispatcher> twice (the parameter, the property): one specifier; Dispatcher is its own name, Log a property and log a parameter
        [P.dispatcher]: ["using:Microsoft.Extensions.Logging", "using:Shop.Core.Logging", "ns:Shop.Core.Shipping", "type:ILogger`1"],
        [P.pallet]: ["using:System", "using:Shop.Core.Boxes", "ns:Shop.Core.Shipping", "type:Box`2", "type:Type", "type:Pair`2"],         // typeof(Box<,>): Box`2 again
        [P.parcel]: ["using:Shop.Core.Boxes", "ns:Shop.Core.Shipping", "type:Box"],
        [P.iclock]: ["using:System", "ns:Shop.Core.Time", "type:DateTimeOffset"],
        [P.systemClock]: ["using:System", "ns:Shop.Core.Time", "type:IClock", "type:DateTimeOffset"],
        [P.scenarios]: [
            "using:Shop.Web.Pages", "using:Xunit", "ns:Shop.Web.IntegrationTests", "type:Fact", "type:FactAttribute",
            "type:CheckoutPage", "qtype:Shop.Core.Time.SystemClock", "type:Assert",
        ],
        [P.collectionExtensions]: ["using:System.Collections.Generic", "using:System.Linq", "ns:Shop.Web.Extensions", "type:IEnumerable`1"],
        [P.hostExtensions]: ["using:Microsoft.Extensions.DependencyInjection", "ns:Shop.Web.Extensions", "type:IServiceCollection"],
        [P.serviceExtensions]: [
            "using:Microsoft.Extensions.DependencyInjection", "using:Shop.Core.Time", "ns:Shop.Web.Extensions",
            "type:IServiceCollection", "type:IClock", "type:SystemClock",
        ],
        [P.globalUsings]: ["global:Shop.Core.Carts", "gstatic:Shop.Core.Pricing.PriceMath", "galias:Clock=Shop.Core.Time.SystemClock"],
        [P.cartPage]: ["using:Shop.Core.Time", "ns:Shop.Web.Pages", "type:PageBase`1", "type:Cart", "type:IClock", "type:Order"],
        [P.checkout]: [
            "using:System", "using:Shop.Core.Auditing", "using:Shop.Shared", "static:Shop.Web.Extensions.CollectionExtensions", "ns:Shop.Web.Pages",
            "type:Audited", "type:AuditedAttribute", "type:PageBase`1", "type:Order", "type:Clock", "type:DateTimeOffset",
            "type:Cart", "type:Type", "type:Item", "type:PriceCalculator", "type:Guard",
            "qtype:Shop.Core.Models.Order", "type:Guid",
        ],
        [P.pageBase]: ["ns:Shop.Web.Pages"],
        [P.receipt]: [
            "alias:Receipt=Shop.Core.Models.Order", "ns:Shop.Web.Pages", "qtype:Core.Auditing.Audited", "qtype:Core.Auditing.AuditedAttribute",
            "type:PageBase`1", "type:Receipt", "type:Rounding",
        ],
        [P.program]: ["using:Shop.Web.Extensions", "type:WebApplication"],
        [P.webGuard]: ["ns:Shop.Shared", "qtype:System.ArgumentException"],
        [P.fakes]: ["ns:Shop.Core.Tests.Fakes"],
        [P.tests]: [
            "using:Shop.Core.Carts", "using:Shop.Core.Pricing", "using:Shop.Core.Tests.Fakes", "using:Xunit", "ns:Shop.Core.Tests",
            "type:Fact", "type:FactAttribute", "type:FakeServices", "type:PriceCalculator", "type:Cart",
            "qtype:Catalog.Item", "type:ProductCode", "type:Money", "type:Assert",
        ],
        [P.seed]: ["using:System", "using:Shop.Core.Models", "ns:Shop.Tools", "type:Order", "type:Guid", "type:Console"],
    },
    declares: {
        [P.audited]: ["type:Shop.Core.Auditing.AuditedAttribute"],
        [P.box]: ["type:Shop.Core.Boxes.Box"],
        [P.boxOfT]: ["type:Shop.Core.Boxes.Box`1"],
        [P.boxOfTwo]: ["type:Shop.Core.Boxes.Box`2"],
        [P.pair]: ["type:Shop.Core.Boxes.Pair`2"],
        [P.totals]: ["type:Shop.Core.Carts.Cart"],
        [P.cart]: ["type:Shop.Core.Carts.Cart"],
        [P.catalogItem]: ["type:Shop.Core.Catalog.Item"],
        [P.productCode]: ["type:Shop.Core.Catalog.ProductCode"],
        [P.logger]: ["type:Shop.Core.Logging.ILogger"],                                 // no type parameters: no arity
        [P.modelItem]: ["type:Shop.Core.Models.Item"],
        [P.order]: ["type:Shop.Core.Models.Order", "type:Shop.Core.Models.OrderPlacedHandler"],
        [P.orderStatus]: ["type:Shop.Core.Models.OrderStatus"],
        [P.money]: ["type:Shop.Core.Money"],
        [P.calculator]: ["type:Shop.Core.Pricing.PriceCalculator"],
        [P.priceMath]: ["type:Shop.Core.Pricing.PriceMath", "type:Shop.Core.Pricing.PriceMath.Rounding"],
        [P.coreGuard]: ["type:Shop.Shared.Guard"],
        [P.crate]: ["type:Shop.Core.Shipping.Crate"],
        [P.dispatcher]: ["type:Shop.Core.Shipping.Dispatcher"],
        [P.pallet]: ["type:Shop.Core.Shipping.Pallet"],
        [P.parcel]: ["type:Shop.Core.Shipping.Parcel"],
        [P.iclock]: ["type:Shop.Core.Time.IClock"],
        [P.systemClock]: ["type:Shop.Core.Time.SystemClock"],
        [P.scenarios]: ["type:Shop.Web.IntegrationTests.CheckoutScenarios"],
        [P.collectionExtensions]: ["type:Shop.Web.Extensions.CollectionExtensions"],
        [P.hostExtensions]: ["type:Shop.Web.Extensions.HostExtensions"],
        [P.serviceExtensions]: ["type:Shop.Web.Extensions.ServiceCollectionExtensions"],
        // the project-wide usings, exactly as the specifiers write them (C18), sorted
        [P.globalUsings]: ["galias:Clock=Shop.Core.Time.SystemClock", "global:Shop.Core.Carts", "gstatic:Shop.Core.Pricing.PriceMath"],
        [P.cartPage]: ["type:Shop.Web.Pages.CartPage"],
        [P.checkout]: ["type:Shop.Web.Pages.CheckoutPage"],
        [P.pageBase]: ["type:Shop.Web.Pages.PageBase`1"],                               // PageBase<TModel>: arity 1 (choice 15)
        [P.receipt]: ["type:Shop.Web.Pages.ReceiptPage"],
        [P.program]: ["main:top-level"],
        [P.webGuard]: ["type:Shop.Shared.Guard"],
        [P.fakes]: ["type:Shop.Core.Tests.Fakes.FakeServices"],
        [P.tests]: ["type:Shop.Core.Tests.PriceCalculatorTests"],
        [P.seed]: ["main:static", "type:Shop.Tools.Seeder"],
    },
    symbols: {
        [P.audited]: [
            sym("AuditedAttribute", "class", 6, 10, true),                              // its attribute line in, its doc comment out
            sym("Reason", "property", 9, 9, true, "AuditedAttribute"),
        ],
        [P.box]: [
            sym("Box", "class", 3, 6, true),
            sym("IsEmpty", "property", 5, 5, true, "Box"),
        ],
        [P.boxOfT]: [
            sym("Box", "class", 3, 6, true),                                            // a symbol is named without its arity
            sym("Content", "property", 5, 5, true, "Box"),
        ],
        [P.boxOfTwo]: [
            sym("Box", "class", 3, 6, true),
            sym("Second", "property", 5, 5, true, "Box"),
        ],
        [P.pair]: [sym("Pair", "class", 3, 3, true)],                                   // a positional record: Left and Right are parameters
        [P.totals]: [
            sym("Cart", "class", 5, 8, true),
            sym("Subtotal", "property", 7, 7, true, "Cart"),
        ],
        [P.cart]: [
            sym("Cart", "class", 6, 13, true),
            sym("_lines", "property", 8, 8, false, "Cart"),
            sym("Lines", "property", 10, 10, true, "Cart"),
            sym("Add", "method", 12, 12, true, "Cart"),
        ],
        [P.catalogItem]: [
            sym("Item", "class", 3, 14, true),
            sym("Item", "constructor", 5, 9, true, "Item"),
            sym("Code", "property", 11, 11, true, "Item"),
            sym("ListPrice", "property", 13, 13, true, "Item"),
        ],
        [P.productCode]: [sym("ProductCode", "struct", 3, 3, true)],                  // a record struct
        [P.logger]: [
            sym("ILogger", "interface", 3, 6, true),
            sym("Write", "method", 5, 5, true, "ILogger"),                              // the interface's flag
        ],
        [P.modelItem]: [
            sym("Item", "class", 4, 7, true),                                           // a record; Sku and Price are parameters, not members
            sym("IsFree", "property", 6, 6, true, "Item"),
        ],
        [P.order]: [
            sym("OrderPlacedHandler", "type", 6, 6, true),                              // a delegate
            sym("Order", "class", 9, 41, true),
            sym("_items", "property", 11, 11, false, "Order"),
            sym("Order", "constructor", 13, 17, true, "Order"),
            sym("Placed", "property", 19, 19, true, "Order"),                           // an event
            sym("Id", "property", 21, 21, true, "Order"),
            sym("Total", "property", 23, 23, true, "Order"),
            sym("Status", "property", 25, 25, true, "Order"),
            sym("this", "accessor", 27, 27, true, "Order"),                             // the indexer
            sym("Add", "method", 29, 32, true, "Order"),
            sym("Place", "method", 34, 38, true, "Order"),
            sym("ToString", "method", 40, 40, true, "Order"),
        ],
        [P.orderStatus]: [sym("OrderStatus", "enum", 3, 8, true)],                    // its members are not symbols
        [P.money]: [
            sym("Money", "struct", 6, 21, true),
            sym("Zero", "property", 8, 8, true, "Money"),
            sym("Money", "constructor", 10, 14, true, "Money"),
            sym("Amount", "property", 16, 16, true, "Money"),
            sym("Currency", "property", 18, 18, true, "Money"),
            sym("Equals", "method", 20, 20, true, "Money"),
        ],
        [P.calculator]: [
            sym("PriceCalculator", "class", 10, 18, true),                              // inside the nested block namespace
            sym("Total", "method", 12, 17, true, "PriceCalculator"),
        ],
        [P.priceMath]: [
            sym("PriceMath", "class", 5, 21, true),
            sym("Rounding", "enum", 7, 11, true, "PriceMath"),                          // a nested type, a member
            sym("Decimals", "property", 13, 13, true, "PriceMath"),                     // a const field
            sym("Round", "method", 15, 20, true, "PriceMath"),
        ],
        [P.coreGuard]: [
            sym("Guard", "class", 5, 12, false),                                        // internal
            sym("NotNull", "method", 7, 11, false, "Guard"),                            // public, but in an internal class
        ],
        [P.crate]: [
            sym("Crate", "class", 6, 13, true),
            sym("_count", "property", 8, 8, false, "Crate"),
            sym("Spare", "property", 10, 10, true, "Crate"),
            sym("Kind", "property", 12, 12, true, "Crate"),
        ],
        [P.dispatcher]: [
            sym("Dispatcher", "class", 6, 11, true),
            sym("Dispatcher", "constructor", 8, 8, true, "Dispatcher"),                 // expression-bodied: one line
            sym("Log", "property", 10, 10, true, "Dispatcher"),
        ],
        [P.pallet]: [
            sym("Pallet", "class", 6, 13, true),
            sym("Load", "property", 8, 8, true, "Pallet"),
            sym("Kind", "property", 10, 10, true, "Pallet"),
            sym("Label", "property", 12, 12, true, "Pallet"),
        ],
        [P.parcel]: [
            sym("Parcel", "class", 5, 8, true),
            sym("Wrapping", "property", 7, 7, true, "Parcel"),
        ],
        [P.iclock]: [
            sym("IClock", "interface", 5, 8, true),
            sym("Now", "property", 7, 7, true, "IClock"),                               // the interface is public
        ],
        [P.systemClock]: [
            sym("SystemClock", "class", 5, 8, true),
            sym("Now", "property", 7, 7, true, "SystemClock"),
        ],
        [P.scenarios]: [
            sym("CheckoutScenarios", "class", 6, 14, true),
            sym("PageIsTitledForTheCart", "method", 8, 13, true, "CheckoutScenarios"), // from its [Fact] line
        ],
        [P.collectionExtensions]: [
            sym("CollectionExtensions", "class", 6, 9, true),
            sym("IsNullOrEmpty", "method", 8, 8, true, "CollectionExtensions"),
        ],
        [P.hostExtensions]: [
            sym("HostExtensions", "class", 5, 12, true),
            sym("AddShopDefaults", "method", 8, 11, true, "HostExtensions"),            // its comment out
        ],
        [P.serviceExtensions]: [
            sym("ServiceCollectionExtensions", "class", 6, 13, true),
            sym("AddShop", "method", 8, 12, true, "ServiceCollectionExtensions"),
        ],
        [P.globalUsings]: [],
        [P.cartPage]: [
            sym("CartPage", "class", 5, 15, true),
            sym("Title", "property", 7, 7, true, "CartPage"),
            sym("Refresh", "method", 9, 12, true, "CartPage"),                          // holds the syntax error
            sym("Last", "property", 14, 14, true, "CartPage"),
        ],
        [P.checkout]: [
            sym("CheckoutPage", "class", 9, 32, true),
            sym("CheckoutPage", "constructor", 12, 15, true, "CheckoutPage"),
            sym("StartedAt", "property", 17, 17, true, "CheckoutPage"),
            sym("Title", "property", 19, 19, true, "CheckoutPage"),
            sym("ModelType", "property", 21, 21, true, "CheckoutPage"),
            sym("Calculator", "property", 23, 23, true, "CheckoutPage"),
            sym("CanPlace", "method", 25, 25, true, "CheckoutPage"),
            sym("Place", "method", 27, 31, true, "CheckoutPage"),
        ],
        [P.pageBase]: [
            sym("PageBase", "class", 3, 9, true),
            sym("Title", "property", 6, 6, true, "PageBase"),
            sym("Model", "property", 8, 8, true, "PageBase"),
        ],
        [P.receipt]: [
            sym("ReceiptPage", "class", 5, 13, true),                                   // from its attribute's line
            sym("Title", "property", 8, 8, true, "ReceiptPage"),
            sym("Mode", "property", 10, 10, true, "ReceiptPage"),
            sym("Describe", "method", 12, 12, true, "ReceiptPage"),
        ],
        [P.program]: [],                                                                // top-level statements only
        [P.webGuard]: [
            sym("Guard", "class", 3, 9, false),
            sym("NotBlank", "method", 5, 8, false, "Guard"),                            // public, but its class is internal
        ],
        [P.fakes]: [
            sym("FakeServices", "class", 4, 13, true),
            sym("Registrations", "property", 6, 6, true, "FakeServices"),
            sym("AddShop", "method", 8, 12, true, "FakeServices"),
        ],
        [P.tests]: [
            sym("PriceCalculatorTests", "class", 8, 18, true),
            sym("AFreeExtraItemCostsNothing", "method", 10, 17, true, "PriceCalculatorTests"),
        ],
        [P.seed]: [
            sym("Seeder", "class", 6, 13, false),
            sym("Main", "method", 8, 12, false, "Seeder"),                              // private
        ],
    },
    kinds: {
        [P.audited]: kinds({
            context: ["using:System", "ns:Shop.Core.Auditing"],
            external: ["type:AttributeUsage", "type:AttributeUsageAttribute", "type:AttributeTargets", "type:Attribute"],
        }),
        [P.box]: kinds({ context: ["ns:Shop.Core.Boxes"] }),
        [P.boxOfT]: kinds({ context: ["ns:Shop.Core.Boxes"], internal: ["type:Box"] }),
        [P.boxOfTwo]: kinds({ context: ["ns:Shop.Core.Boxes"], internal: ["type:Box`1"] }),
        [P.pair]: kinds({ context: ["ns:Shop.Core.Boxes"] }),
        [P.totals]: kinds({ context: ["using:System.Linq", "ns:Shop.Core.Carts"], internal: ["type:Money"] }),
        [P.cart]: kinds({
            context: ["using:System.Collections.Generic", "using:Shop.Core.Catalog", "ns:Shop.Core.Carts"],
            internal: ["type:Item"],
            external: ["type:List`1", "type:IReadOnlyList`1"],
        }),
        [P.catalogItem]: kinds({ context: ["ns:Shop.Core.Catalog"], internal: ["type:ProductCode", "type:Money"] }),
        [P.productCode]: kinds({ context: ["ns:Shop.Core.Catalog"] }),
        [P.logger]: kinds({ context: ["ns:Shop.Core.Logging"] }),
        [P.modelItem]: kinds({ context: ["ns:Shop.Core.Models"], internal: ["type:Money"] }),
        [P.order]: kinds({
            context: ["using:System", "using:System.Collections.Generic", "ns:Shop.Core.Models"],
            internal: ["type:Item", "type:Money", "type:OrderStatus"],
            external: ["type:List`1", "type:Guid"],
        }),
        [P.orderStatus]: kinds({ context: ["ns:Shop.Core.Models"] }),
        [P.money]: kinds({ context: ["using:System", "ns:Shop.Core"], external: ["type:IEquatable`1"] }),
        [P.calculator]: kinds({
            context: ["using:Shop.Core.Carts", "using:Shop.Core.Catalog", "using:Shop.Shared", "ns:Shop.Core", "ns:Shop.Core.Pricing"],
            internal: ["static:Shop.Core.Pricing.PriceMath", "type:Money", "type:Cart", "type:Item", "type:Guard", "type:Rounding"],
        }),
        [P.priceMath]: kinds({ context: ["using:System", "ns:Shop.Core.Pricing"], external: ["type:MidpointRounding"] }),
        [P.coreGuard]: kinds({ context: ["using:System", "ns:Shop.Shared"], external: ["type:ArgumentNullException"] }),
        [P.crate]: kinds({
            context: ["using:System", "using:Shop.Core.Boxes", "ns:Shop.Core.Shipping"],
            internal: ["type:Box`1", "qtype:Shop.Core.Boxes.Box`1"],
            external: ["type:Type"],
        }),
        [P.dispatcher]: kinds({
            context: ["using:Microsoft.Extensions.Logging", "using:Shop.Core.Logging", "ns:Shop.Core.Shipping"],
            external: ["type:ILogger`1"],                                               // no repo type is ILogger with one type parameter (choice 16)
        }),
        [P.pallet]: kinds({
            context: ["using:System", "using:Shop.Core.Boxes", "ns:Shop.Core.Shipping"],
            internal: ["type:Box`2", "type:Pair`2"],
            external: ["type:Type"],
        }),
        [P.parcel]: kinds({ context: ["using:Shop.Core.Boxes", "ns:Shop.Core.Shipping"], internal: ["type:Box"] }),
        [P.iclock]: kinds({ context: ["using:System", "ns:Shop.Core.Time"], external: ["type:DateTimeOffset"] }),
        [P.systemClock]: kinds({ context: ["using:System", "ns:Shop.Core.Time"], internal: ["type:IClock"], external: ["type:DateTimeOffset"] }),
        [P.scenarios]: kinds({
            context: ["using:Shop.Web.Pages", "using:Xunit", "ns:Shop.Web.IntegrationTests"],
            internal: ["type:CheckoutPage", "qtype:Shop.Core.Time.SystemClock"],
            external: ["type:Fact", "type:FactAttribute", "type:Assert"],
        }),
        [P.collectionExtensions]: kinds({
            context: ["using:System.Collections.Generic", "using:System.Linq", "ns:Shop.Web.Extensions"],
            external: ["type:IEnumerable`1"],
        }),
        [P.hostExtensions]: kinds({
            context: ["using:Microsoft.Extensions.DependencyInjection", "ns:Shop.Web.Extensions"],
            external: ["type:IServiceCollection"],
        }),
        [P.serviceExtensions]: kinds({
            context: ["using:Microsoft.Extensions.DependencyInjection", "using:Shop.Core.Time", "ns:Shop.Web.Extensions"],
            internal: ["type:IClock", "type:SystemClock"],
            external: ["type:IServiceCollection"],
        }),
        [P.globalUsings]: kinds({
            context: ["global:Shop.Core.Carts", "galias:Clock=Shop.Core.Time.SystemClock"],
            internal: ["gstatic:Shop.Core.Pricing.PriceMath"],
        }),
        [P.cartPage]: kinds({ context: ["using:Shop.Core.Time", "ns:Shop.Web.Pages"], internal: ["type:PageBase`1", "type:Cart", "type:IClock", "type:Order"] }),
        [P.checkout]: kinds({
            context: ["using:System", "using:Shop.Core.Auditing", "using:Shop.Shared", "ns:Shop.Web.Pages"],
            internal: [
                "static:Shop.Web.Extensions.CollectionExtensions",
                "type:AuditedAttribute", "type:PageBase`1", "type:Order",
                "type:Clock",                                                           // no repo type is named Clock, but it resolves (the alias)
                "type:Cart", "type:Item",
                "type:PriceCalculator",                                                 // a repo type's name, not visible here: unresolved
                "type:Guard", "qtype:Shop.Core.Models.Order",
            ],
            external: ["type:Audited", "type:DateTimeOffset", "type:Type", "type:Guid"],
        }),
        [P.pageBase]: kinds({ context: ["ns:Shop.Web.Pages"] }),
        [P.receipt]: kinds({
            context: [
                "alias:Receipt=Shop.Core.Models.Order", "ns:Shop.Web.Pages",
                "qtype:Core.Auditing.Audited",                                          // the attribute's other lookup name: its twin resolves (choice 12)
            ],
            internal: ["qtype:Core.Auditing.AuditedAttribute", "type:PageBase`1", "type:Receipt", "type:Rounding"], // type:Receipt: the alias
        }),
        [P.program]: kinds({
            context: ["using:Shop.Web.Extensions"],
            external: ["type:WebApplication"],
        }),
        [P.webGuard]: kinds({ context: ["ns:Shop.Shared"], external: ["qtype:System.ArgumentException"] }),
        [P.fakes]: kinds({ context: ["ns:Shop.Core.Tests.Fakes"] }),
        [P.tests]: kinds({
            context: ["using:Shop.Core.Carts", "using:Shop.Core.Pricing", "using:Shop.Core.Tests.Fakes", "using:Xunit", "ns:Shop.Core.Tests"],
            internal: [
                "type:FakeServices", "type:PriceCalculator", "type:Cart", "qtype:Catalog.Item",
                "type:ProductCode",                                                     // a repo type's name, not visible here: unresolved
                "type:Money",
            ],
            // PriceCalculatorTests.cs's AddShop gives no specifier (choice 14): FakeServices.AddShop is its own method
            external: ["type:Fact", "type:FactAttribute", "type:Assert"],
        }),
        [P.seed]: kinds({
            context: ["using:System", "using:Shop.Core.Models", "ns:Shop.Tools"],
            internal: ["type:Order"],
            external: ["type:Guid", "type:Console"],
        }),
    },
    edges: EDGES,
    entryPoints: [
        { path: P.program, declaredBy: "top-level statements" },
        { path: P.seed, declaredBy: "static Main" },
    ],
    // `var shown = clock.Now +;` on line 11; the reference after it (Order, line 14) is still read
    broken: { path: P.cartPage, specifiers: ["using:Shop.Core.Time", "ns:Shop.Web.Pages", "type:PageBase`1", "type:Cart", "type:IClock", "type:Order"] },
    // the scan reading reads only `using …;` and `namespace …` lines: every file with another specifier differs, and the
    // nested block namespace reads as written (ns:Pricing)
    scan: {
        [P.audited]: ["using:System", "ns:Shop.Core.Auditing"],
        [P.boxOfT]: ["ns:Shop.Core.Boxes"],
        [P.boxOfTwo]: ["ns:Shop.Core.Boxes"],
        [P.totals]: ["using:System.Linq", "ns:Shop.Core.Carts"],
        [P.cart]: ["using:System.Collections.Generic", "using:Shop.Core.Catalog", "ns:Shop.Core.Carts"],
        [P.catalogItem]: ["ns:Shop.Core.Catalog"],
        [P.modelItem]: ["ns:Shop.Core.Models"],
        [P.order]: ["using:System", "using:System.Collections.Generic", "ns:Shop.Core.Models"],
        [P.money]: ["using:System", "ns:Shop.Core"],
        [P.calculator]: ["using:Shop.Core.Carts", "using:Shop.Core.Catalog", "using:Shop.Shared", "static:Shop.Core.Pricing.PriceMath", "ns:Shop.Core", "ns:Pricing"],
        [P.priceMath]: ["using:System", "ns:Shop.Core.Pricing"],
        [P.coreGuard]: ["using:System", "ns:Shop.Shared"],
        [P.crate]: ["using:System", "using:Shop.Core.Boxes", "ns:Shop.Core.Shipping"],
        [P.dispatcher]: ["using:Microsoft.Extensions.Logging", "using:Shop.Core.Logging", "ns:Shop.Core.Shipping"],
        [P.pallet]: ["using:System", "using:Shop.Core.Boxes", "ns:Shop.Core.Shipping"],
        [P.parcel]: ["using:Shop.Core.Boxes", "ns:Shop.Core.Shipping"],
        [P.iclock]: ["using:System", "ns:Shop.Core.Time"],
        [P.systemClock]: ["using:System", "ns:Shop.Core.Time"],
        [P.scenarios]: ["using:Shop.Web.Pages", "using:Xunit", "ns:Shop.Web.IntegrationTests"],
        [P.collectionExtensions]: ["using:System.Collections.Generic", "using:System.Linq", "ns:Shop.Web.Extensions"],
        [P.hostExtensions]: ["using:Microsoft.Extensions.DependencyInjection", "ns:Shop.Web.Extensions"],
        [P.serviceExtensions]: ["using:Microsoft.Extensions.DependencyInjection", "using:Shop.Core.Time", "ns:Shop.Web.Extensions"],
        [P.cartPage]: ["using:Shop.Core.Time", "ns:Shop.Web.Pages"],
        [P.checkout]: ["using:System", "using:Shop.Core.Auditing", "using:Shop.Shared", "static:Shop.Web.Extensions.CollectionExtensions", "ns:Shop.Web.Pages"],
        [P.receipt]: ["alias:Receipt=Shop.Core.Models.Order", "ns:Shop.Web.Pages"],
        [P.program]: ["using:Shop.Web.Extensions"],
        [P.webGuard]: ["ns:Shop.Shared"],
        [P.tests]: ["using:Shop.Core.Carts", "using:Shop.Core.Pricing", "using:Shop.Core.Tests.Fakes", "using:Xunit", "ns:Shop.Core.Tests"],
        [P.seed]: ["using:System", "using:Shop.Core.Models", "ns:Shop.Tools"],
    },
    // chunks: each type declaration at file or namespace level (struct, record and record struct → class, a delegate →
    // type), from its attached comment; then the file summary. Nested types are inside their parent's chunk.
    chunks: {
        [P.audited]: [
            { kind: "class", name: "AuditedAttribute", startLine: 5, endLine: 10 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 10 },
        ],
        // a generic type's chunk is named without its arity, as its symbol is
        [P.boxOfT]: [
            { kind: "class", name: "Box", startLine: 3, endLine: 6 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 6 },
        ],
        [P.boxOfTwo]: [
            { kind: "class", name: "Box", startLine: 3, endLine: 6 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 6 },
        ],
        [P.pair]: [
            { kind: "class", name: "Pair", startLine: 3, endLine: 3 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 3 },
        ],
        [P.productCode]: [
            { kind: "class", name: "ProductCode", startLine: 3, endLine: 3 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 3 },
        ],
        [P.modelItem]: [
            { kind: "class", name: "Item", startLine: 3, endLine: 7 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 7 },
        ],
        [P.order]: [
            { kind: "type", name: "OrderPlacedHandler", startLine: 6, endLine: 6 },
            { kind: "class", name: "Order", startLine: 8, endLine: 41 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 41 },
        ],
        [P.orderStatus]: [
            { kind: "enum", name: "OrderStatus", startLine: 3, endLine: 8 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 8 },
        ],
        [P.money]: [
            { kind: "class", name: "Money", startLine: 5, endLine: 21 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 21 },
        ],
        [P.calculator]: [
            { kind: "class", name: "PriceCalculator", startLine: 10, endLine: 18 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 20 },
        ],
        [P.priceMath]: [
            { kind: "class", name: "PriceMath", startLine: 5, endLine: 21 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 21 },
        ],
        [P.iclock]: [
            { kind: "interface", name: "IClock", startLine: 5, endLine: 8 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 8 },
        ],
        [P.globalUsings]: [{ kind: "file-summary", name: "(file)", startLine: 1, endLine: 3 }],
        [P.checkout]: [
            { kind: "class", name: "CheckoutPage", startLine: 8, endLine: 32 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 32 },
        ],
        [P.program]: [{ kind: "file-summary", name: "(file)", startLine: 1, endLine: 9 }],
        [P.tests]: [
            { kind: "class", name: "PriceCalculatorTests", startLine: 8, endLine: 18 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 18 },
        ],
    },
    edits: [
        {
            // Cart.cs's and PriceCalculator.cs's type:Item now find nothing visible (Shop.Core.Models.Item isn't visible to
            // them), and PriceCalculatorTests.cs's qtype:Catalog.Item names nothing; Catalog/Item.cs keeps its own two edges
            description: "(a) src/Shop.Core/Catalog/Item.cs renames its class Item to Product (its declares change): three unchanged importers lose their edges to it",
            writes: {
                [P.catalogItem]: "namespace Shop.Core.Catalog\n{\n    public class Product\n    {\n        public Product(ProductCode code, Money listPrice)\n        {\n"
                    + "            Code = code;\n            ListPrice = listPrice;\n        }\n\n        public ProductCode Code { get; }\n\n"
                    + "        public Money ListPrice { get; }\n    }\n}\n",
            },
            edgesAfter: without(edge(P.cart, P.catalogItem), edge(P.calculator, P.catalogItem), edge(P.tests, P.catalogItem)),
        },
        {
            // the test project's usings gain Shop.Core.Catalog: PriceCalculatorTests.cs's type:ProductCode (step 2) resolves.
            // Nothing else of that project changes (FakeServices.cs has no type name; Cart, PriceCalculator, FakeServices and
            // Money resolve as before, Money still at step 1)
            description: "(b) tests/Shop.Core.Tests/Shop.Core.Tests.csproj gains <Using Include=\"Shop.Core.Catalog\" /> (a manifest changes): PriceCalculatorTests.cs's ProductCode resolves",
            writes: {
                "tests/Shop.Core.Tests/Shop.Core.Tests.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\">\n\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n"
                    + "    <IsPackable>false</IsPackable>\n  </PropertyGroup>\n\n  <ItemGroup>\n    <PackageReference Include=\"xunit\" Version=\"2.9.2\" />\n"
                    + "  </ItemGroup>\n\n  <ItemGroup>\n    <Using Include=\"Shop.Core.Catalog\" />\n  </ItemGroup>\n\n  <ItemGroup>\n"
                    + "    <ProjectReference Include=\"..\\..\\src\\Shop.Core\\Shop.Core.csproj\" />\n  </ItemGroup>\n\n</Project>\n",
            },
            edgesAfter: withAdded(edge(P.tests, P.productCode)),
        },
        {
            // the partial class's second part goes (the file set changes): every reader of type:Cart keeps only Cart.cs, and
            // Cart.Totals.cs's own edge to Money.cs goes with it
            description: "(c) src/Shop.Core/Carts/Cart.Totals.cs, one part of the partial class Cart, is deleted",
            writes: { [P.totals]: null },
            edgesAfter: without(
                edge(P.totals, P.money), edge(P.calculator, P.totals), edge(P.cartPage, P.totals), edge(P.checkout, P.totals), edge(P.tests, P.totals)
            ),
        },
        {
            // GlobalUsings.cs's declares gain global:Shop.Core.Pricing, so every C# file re-resolves: CheckoutPage.cs's
            // type:PriceCalculator (step 2, the project's usings) now resolves. No other Shop.Web name changes: Rounding is
            // PriceMath's nested type (Shop.Core.Pricing.Rounding is no type), and the rest resolved before step 2 or name
            // nothing in Shop.Core.Pricing
            description: "(d) src/Shop.Web/GlobalUsings.cs gains global using Shop.Core.Pricing (a project-wide using, through declares): CheckoutPage.cs's PriceCalculator resolves",
            writes: {
                [P.globalUsings]: "global using Shop.Core.Carts;\nglobal using Shop.Core.Pricing;\nglobal using static Shop.Core.Pricing.PriceMath;\n"
                    + "global using Clock = Shop.Core.Time.SystemClock;\n",
            },
            edgesAfter: withAdded(edge(P.checkout, P.calculator)),
        },
        {
            // no file declares Box`1 any more, and the names that named it are written with one type argument (Crate.cs's
            // Box<int>, typeof(Box<>) and Shop.Core.Boxes.Box<string>; BoxOfTwo.cs's base type Box<TFirst>), so they resolve
            // to nothing (choice 16, R23): C# can't bind them to Box or to Box<TFirst, TSecond>. Before R23 they fell back to
            // every Box file left. BoxOfT.cs's own edge goes with it; Parcel.cs's Box and Pallet.cs's Box<string, int> still
            // find their own arity's file
            description: "(e) src/Shop.Core/Boxes/BoxOfT.cs, Box<T>, is deleted (the file set changes): its readers, written with one type argument, lose their edges and gain none",
            writes: { [P.boxOfT]: null },
            edgesAfter: without(edge(P.boxOfT, P.box), edge(P.boxOfTwo, P.boxOfT), edge(P.crate, P.boxOfT)),
        },
        {
            // no file declares Box (arity 0) any more, and the two names that named it are written without type arguments
            // (BoxOfT.cs's base type Box, Parcel.cs's new Box()), so they resolve by name at any arity, as before the pass
            // (choice 16): BoxOfT.cs through its enclosing namespace, Parcel.cs through its using Shop.Core.Boxes, each to
            // every Box file left, BoxOfT.cs and BoxOfTwo.cs (BoxOfT.cs's own is a self edge, dropped). Crate.cs's and
            // BoxOfTwo.cs's Box<…> and Pallet.cs's Box<string, int> keep their own arity's file
            description: "(f) src/Shop.Core/Boxes/Box.cs, Box, is deleted (the file set changes): its readers, written without type arguments, fall back to the name, at any arity",
            writes: { [P.box]: null },
            edgesAfter: changed(
                [edge(P.boxOfT, P.box), edge(P.parcel, P.box)],
                [edge(P.boxOfT, P.boxOfTwo), edge(P.parcel, P.boxOfT), edge(P.parcel, P.boxOfTwo)],
            ),
        },
    ],
};
