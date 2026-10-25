# csharp-repo

A hand-designed C# repo for the C# adapter's conformance tests (`lib/index/languages/csharp/conformance.test.ts`, through
`test/helpers/adapter-conformance.ts`). Its ground truth is `test/helpers/csharp-repo-truth.ts`, derived by hand from these
files before the adapter's code: change a file here and re-derive the truth by hand.

Four projects: `src/Shop.Core`, `src/Shop.Web` (a `<Using Include>` in its `.csproj` and project-wide usings in
`GlobalUsings.cs`), `src/Shop.Web.IntegrationTests` and `tests/Shop.Core.Tests`, plus `tools/bin/Seed.cs`, which no project
owns. Two type names are deliberately not visible from where they are written (`PriceCalculator` in `CheckoutPage.cs`,
`ProductCode` in `PriceCalculatorTests.cs`): the truth's edits make them resolve. Extension-method calls (`AddShop`,
`IsNullOrEmpty`) are present but not linked: C# binds them by the receiver's and the arguments' types, which the index
doesn't read.

`src/Shop.Core/Boxes/` holds arity twins, one per file: `Box`, `Box<T>` and `Box<TFirst, TSecond>`, plus `Pair<TLeft, TRight>`,
which has no twin. Each reader in `src/Shop.Core/Shipping/` writes one arity (`new Box()`; `Box<int>` and `typeof(Box<>)`;
`Box<string, int>` and `typeof(Box<,>)`), so it reaches only that arity's file.

`src/Shop.Core/Logging/ILogger.cs` is the repo's own non-generic `ILogger`. `src/Shop.Core/Shipping/Dispatcher.cs` sees it
(`using Shop.Core.Logging;`) but writes `ILogger<Dispatcher>`, Microsoft.Extensions.Logging's generic one: C# can't bind a
name written with a type argument to a type without one (CS0308), so it links to nothing.

`src/Shop.Core/Money.cs` starts with a UTF-8 byte-order mark, as Visual Studio writes one. `src/Shop.Web/Pages/CartPage.cs`
has a syntax error. The files under `bin/` and `obj/` beside a `.csproj` are left out of the index.
