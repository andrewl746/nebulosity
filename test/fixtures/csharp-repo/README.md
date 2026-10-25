# csharp-repo

A hand-designed C# repo for the C# adapter's conformance tests (`lib/index/languages/csharp/conformance.test.ts`, through
`test/helpers/adapter-conformance.ts`). Its ground truth is `test/helpers/csharp-repo-truth.ts`, derived by hand from these
files before the adapter's code: change a file here and re-derive the truth by hand.

Four projects: `src/Shop.Core`, `src/Shop.Web` (a `<Using Include>` in its `.csproj` and project-wide usings in
`GlobalUsings.cs`), `src/Shop.Web.IntegrationTests` and `tests/Shop.Core.Tests`, plus `tools/bin/Seed.cs`, which no project
owns. Some references are deliberately not visible from where they are written (`PriceCalculator` in
`CheckoutPage.cs`, `ProductCode` and `AddShop` in `PriceCalculatorTests.cs`): the truth's edits make two of them resolve.

`src/Shop.Core/Money.cs` starts with a UTF-8 byte-order mark, as Visual Studio writes one. `src/Shop.Web/Pages/CartPage.cs`
has a syntax error. The files under `bin/` and `obj/` beside a `.csproj` are left out of the index.
