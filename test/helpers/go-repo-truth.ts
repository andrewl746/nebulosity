import type { SymbolKind, SymbolRow } from "../../lib/db/schema";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";

/**
 * test/fixtures/go-repo's ground truth, DERIVED BY HAND from the fixture's files and Task G of the E4 plan
 * (docs/plans/2026-10-24-e4-languages.md), before any Go adapter code existed: never by running the code (CLAUDE.md).
 * Change a fixture file and re-derive this by hand.
 *
 * The rules used (the plan's Task G, abridged):
 * - Specifiers, first occurrence order, each once:
 *   - `import:<path>` per import spec, plus ` as <alias>` for an explicit alias (`_` and `.` included);
 *   - `use:<x>.<Name>` per selector or qualified type whose operand x is a plain identifier neither bound in the
 *     enclosing function (parameter, result, receiver, `:=`, var, const, range, type switch, type parameter, label,
 *     anywhere in the outermost function) nor declared at the file's top level;
 *   - `name:<N>` per identifier in an expression or type position that is not bound, not declared at the file's top
 *     level, not a `use:` operand, not a keyed composite-literal element's key, not a label, not predeclared.
 * - Declares: `package:<name>` and the file's package-level funcs (not methods), types, vars and consts, without `_`
 *   and `init`; the whole list sorted (code-unit order, so upper-case names sort first).
 * - Modules: each go.mod's module path names its folder, except a go.mod in a folder the Go rules leave out (the plan's
 *   common rules: vendor/github.com/x/y/go.mod is ignored). An import path names the folder under the module whose
 *   path is its longest prefix, plus the rest, when that folder holds an indexed non-test .go file.
 * - A file's import aliases: the explicit alias, else the imported repo package's name (its non-test files' `package:`),
 *   else the path's last element with a /v<N> suffix dropped.
 * - `use:x.N` → the package's files declaring N when x is an import alias; otherwise read as `name:x`.
 *   `name:N` → the other files of the importer's folder with its `package:` declaring N (a non-test importer never
 *   reaches a _test.go file), and the dot-imported packages' files declaring N. Every declarer gets the edge.
 * - `import:` → as `_` or `.`: every non-test file of the package; otherwise `[importer]` (placed) when one of the
 *   file's uses of it resolves, else every non-test file of the package; outside the repo's modules, `[]`.
 * - Kinds: `import:` internal under a repo module, else external; `use:x.N` external when x is an external import's
 *   alias, else internal; `name:` internal.
 * - Entry points: a file declaring both `package:main` and `main`, "package main, func main".
 * - Symbols: func → function; method → method, parent its receiver's type (no `*`); struct → struct with its fields
 *   (property); interface → interface with its methods (method); any other type spec or alias → type; each const or var
 *   spec → const. Exported: an upper-case first letter. Lines are the declaration's own, its comments left out.
 * - Chunks: one per top-level declaration over its attached comments (leadingSpan): func → function `Name`, method →
 *   function `Type.Name`, a type declaration → class (struct), interface or type, a const/var declaration → const.
 *
 * Calls the plan left open, used here (each written in the ledger's progress-go.md):
 * - G-1: the blank identifier `_` is never a name (tree-sitter-go reads `_ = x`'s `_` as an identifier; Go can't
 *   refer to it). It decides internal/api/scope.go line 15.
 * - G-2: a const or var declaration's chunk is named by its specs' names joined by ", ", as a grouped type
 *   declaration's is (store.go's const block).
 * - G-3: a spec's symbol spans the spec's own lines (a grouped const's names each get their line), as TypeScript's
 *   variable declarators do.
 * - G-4: declaration sites are never names: parameter, result and receiver names, a func's, type's, const's or var's
 *   own name, a type parameter, a struct field or interface method name, an import's alias, the package clause.
 * - G-5: an imported package's files are its folder's non-test files only, so `use:` never reaches a _test.go file
 *   (cmd/shop/main.go's widgets.Missing is declared only by pkg/widgets/v2/widgets_test.go).
 * - G-7: a local type declaration binds its name in the function, as var and const do (scope.go's `type Handler int`).
 * - G-8: a generic type's type parameters bind inside its own spec, and a method's receiver type parameters
 *   (`func (b Box[T])`) bind inside the method, as a function's type parameters do (pkg/widgets/v2/widgets.go's T).
 */

const sym = (name: string, kind: SymbolKind, startLine: number, endLine: number, exported: boolean, parent: string | null = null): SymbolRow => ({
    name, qualifiedName: parent === null ? name : `${parent}.${name}`, kind, startLine, endLine, exported, parentQualifiedName: parent,
});
const edge = (source: string, target: string): TruthEdge => ({ source, target });
/** A file's text, from its lines: each ended by "\n", tabs written "\t". */
const text = (...lines: string[]): string => lines.map((l) => `${l}\n`).join("");

const MAIN = "cmd/shop/main.go";
const API = "internal/api/api.go";
const API_TEST = "internal/api/api_test.go";
const BROKEN = "internal/api/broken.go";
const HANDLER = "internal/api/handler.go";
const SCOPE = "internal/api/scope.go";
const PATHS = "internal/paths/paths.go";
const SEP_LINUX = "internal/paths/sep_linux.go";
const SEP_WINDOWS = "internal/paths/sep_windows.go";
const EXTRA = "internal/store/extra.go";
const STORE = "internal/store/store.go";
const STORE_TEST = "internal/store/store_test.go";
const TEXT = "internal/text/text.go";
const COLORS = "pkg/go-colors/colors.go";
const WIDGETS = "pkg/widgets/v2/widgets.go";
const WIDGETS_TEST = "pkg/widgets/v2/widgets_test.go";
const PLUGINS = "plugins/plugins.go";
const REGISTER = "plugins/register.go";
const GEN = "tools/gen/main.go";
const LINT = "tools/lint/lint.go";
/** Edit (c)'s new file. */
const ROUTES = "internal/api/routes.go";

/** The 24 edges of a full run, sorted by source then target, each with the rule that makes it. */
const EDGES: TruthEdge[] = [
    edge(MAIN, API),                 // use:api.Open: internal/api's non-test files declaring Open
    edge(MAIN, HANDLER),             // use:api.Handler: the file declaring Handler
    edge(MAIN, PATHS),               // use:paths.Join (import:…/internal/paths is placed: its use resolves)
    edge(MAIN, TEXT),                // import:…/internal/text as .: every non-test file; name:Upper reaches it too, through the dot import
    edge(MAIN, COLORS),              // use:colors.Red: alias colors is the package's name, not the folder's (go-colors)
    edge(MAIN, WIDGETS),             // import:…/pkg/widgets/v2: its only use, widgets.Missing, resolves to nothing, so every non-test file
    edge(MAIN, PLUGINS),             // import:…/plugins as _: every non-test file of the package
    edge(MAIN, REGISTER),            // import:…/plugins as _: the package's second file
    edge(API, EXTRA),                // use:store.DefaultSize: extra.go declares DefaultSize
    edge(API, STORE),                // use:store.Store and use:store.New: store.go declares both
    edge(API_TEST, API),             // use:api.Open (package api_test imports api; import:…/internal/api is placed)
    edge(BROKEN, API),               // name:limit, read after the syntax error: api.go declares limit
    edge(BROKEN, TEXT),              // use:text.Upper, read before the syntax error
    edge(HANDLER, API),              // name:Version: another file of package api declares it
    edge(HANDLER, STORE),            // use:st.Getter: the aliased import st names internal/store; store.go declares Getter
    edge(PATHS, SEP_LINUX),          // name:sep: build-tag twins, both declare sep
    edge(PATHS, SEP_WINDOWS),        // name:sep: the second twin
    edge(EXTRA, STORE),              // name:Store (var Empty's &Store{} and the receiver of Len)
    edge(STORE, EXTRA),              // name:DefaultSize (New's fallback): extra.go declares it
    edge(STORE_TEST, EXTRA),         // name:DefaultSize, and use:Empty.Len read as name:Empty (Empty isn't an import alias)
    edge(STORE_TEST, STORE),         // name:New
    edge(WIDGETS_TEST, WIDGETS),     // name:Render: the same package's non-test file
    edge(REGISTER, PLUGINS),         // name:registered
    edge(GEN, LINT),                 // use:lint.Check: example.com/shop/tools/lint under the module example.com/shop/tools
    // not edges: placed imports ([importer]); every external import and its uses; handler.go's name:Routes and
    // main.go's use:widgets.Missing, which name nothing (Missing only in widgets_test.go, which no import reaches);
    // scope.go's names, all bound; handler.go's local limit (label's limit := 3), which isn't api.go's
];

const without = (...dropped: TruthEdge[]): TruthEdge[] =>
    EDGES.filter((e) => !dropped.some((d) => d.source === e.source && d.target === e.target));

/** store.go after edit (a): DefaultSize moves in from extra.go, after the const block. */
const STORE_WITH_DEFAULT = text(
    "// Package store keeps the shop's items.",
    "package store",
    "",
    "// MaxItems caps a store; minItems is its floor.",
    "const (",
    "\tMaxItems = 100",
    "\tminItems = 1",
    ")",
    "",
    "// DefaultSize is the size New falls back to.",
    "var DefaultSize = 16",
    "",
    "// Key names an item.",
    "type Key = string",
    "",
    "// Store holds items by key.",
    "type Store struct {",
    "\titems map[Key]int",
    "\tSize  int",
    "}",
    "",
    "// Getter reads one item.",
    "type Getter interface {",
    "\tGet(key Key) (int, bool)",
    "\tLen() int",
    "}",
    "",
    "// New makes an empty store of at least minItems.",
    "func New(size int) *Store {",
    "\tif size < minItems {",
    "\t\tsize = DefaultSize",
    "\t}",
    "\treturn &Store{items: make(map[Key]int), Size: size}",
    "}",
    "",
    "// Get reads one item.",
    "func (s *Store) Get(key Key) (int, bool) {",
    "\tv, ok := s.items[key]",
    "\treturn v, ok",
    "}",
);

/** extra.go after edit (a): DefaultSize gone. */
const EXTRA_WITHOUT_DEFAULT = text(
    "package store",
    "",
    "// Empty is a store with nothing in it.",
    "var Empty = &Store{}",
    "",
    "// Len counts the items.",
    "func (s *Store) Len() int {",
    "\treturn len(s.items)",
    "}",
);

export const goRepoTruth: FixtureTruth = {
    files: [
        { path: MAIN, language: "go", isTest: false, lineCount: 22 },
        { path: API, language: "go", isTest: false, lineCount: 20 },
        { path: API_TEST, language: "go", isTest: true, lineCount: 13 },
        { path: BROKEN, language: "go", isTest: false, lineCount: 15 },
        { path: HANDLER, language: "go", isTest: false, lineCount: 22 },
        { path: SCOPE, language: "go", isTest: false, lineCount: 17 },
        { path: PATHS, language: "go", isTest: false, lineCount: 6 },
        { path: SEP_LINUX, language: "go", isTest: false, lineCount: 5 },
        { path: SEP_WINDOWS, language: "go", isTest: false, lineCount: 5 },
        { path: EXTRA, language: "go", isTest: false, lineCount: 12 },
        { path: STORE, language: "go", isTest: false, lineCount: 37 },
        { path: STORE_TEST, language: "go", isTest: true, lineCount: 10 },
        { path: TEXT, language: "go", isTest: false, lineCount: 14 },
        { path: COLORS, language: "go", isTest: false, lineCount: 5 },
        { path: WIDGETS, language: "go", isTest: false, lineCount: 17 },
        { path: WIDGETS_TEST, language: "go", isTest: true, lineCount: 12 },
        { path: PLUGINS, language: "go", isTest: false, lineCount: 8 },
        { path: REGISTER, language: "go", isTest: false, lineCount: 6 },
        { path: GEN, language: "go", isTest: false, lineCount: 13 },
        { path: LINT, language: "go", isTest: false, lineCount: 7 },
    ],
    // under the root go.mod's folder's vendor/ (the go.mod beside it is a manifest, which the resolver ignores)
    excluded: ["vendor/github.com/x/y/y.go"],
    specifiers: {
        [MAIN]: [
            "import:fmt",
            "import:example.com/shop/internal/api",
            "import:example.com/shop/internal/paths",
            "import:example.com/shop/internal/text as .",
            "import:example.com/shop/pkg/go-colors",
            "import:example.com/shop/pkg/widgets/v2",
            "import:example.com/shop/plugins as _",
            "import:github.com/other/kit/v2",
            "use:api.Handler",          // line 18, the composite literal's type (its key Store is no name)
            "use:api.Open",             // line 18
            "use:fmt.Println",          // line 20
            "name:Upper",               // line 20 (v and n are bound by :=)
            "use:colors.Red",           // line 20
            "use:paths.Join",           // line 20
            "use:kit.Run",              // line 21
            "use:widgets.Missing",      // line 21
        ],
        [API]: [
            "import:fmt",
            "import:example.com/shop/internal/store",
            "import:github.com/other/lib",
            "use:store.Store",          // line 17, the result type
            "use:lib.Log",              // line 18
            "use:fmt.Sprintf",          // line 18
            "use:store.DefaultSize",    // line 18
            "use:store.New",            // line 19 (limit is declared at this file's top level)
        ],
        [API_TEST]: ["import:testing", "import:example.com/shop/internal/api", "use:testing.T", "use:api.Open"],
        [BROKEN]: ["import:example.com/shop/internal/text", "use:text.Upper", "name:limit"],
        [HANDLER]: [
            "import:example.com/shop/internal/store as st",
            "use:st.Getter",            // line 9, a field's type
            "name:Version",             // line 15 (h, key, n bound; h.Store.Get's operand isn't a plain identifier)
            "name:Routes",              // line 15; label's limit (line 21) is bound by its own :=
        ],
        // every name bound: type parameter (Version), parameters (limit, items), result (total), a local type (Handler,
        // G-7), var (Open), const (Shout), range (Width), type switch (Routes); line 15's _ is no name (G-1)
        [SCOPE]: [],
        [PATHS]: ["name:sep"],
        [SEP_LINUX]: [],
        [SEP_WINDOWS]: [],
        [EXTRA]: ["name:Store"],        // line 7, and the receiver's type on line 10
        [STORE]: ["name:DefaultSize"],  // line 28; Key, Store, minItems are this file's own, make is predeclared, items: and Size: are keys
        [STORE_TEST]: ["import:testing", "use:testing.T", "name:New", "name:DefaultSize", "use:Empty.Len"],
        [TEXT]: ["import:strings", "import:github.com/x/y", "use:y.Do", "use:strings.ToUpper"],   // y.Do on line 12, before line 13
        [COLORS]: [],
        [WIDGETS]: [],                  // Box's T: bound by the type's own type parameter, and in Unwrap by its receiver's (G-8)
        [WIDGETS_TEST]: ["import:testing", "name:Render", "use:testing.T"],   // Render on line 6 comes before testing.T on line 8
        [PLUGINS]: [],                  // registered is this file's own, append predeclared
        [REGISTER]: ["name:registered"],
        [GEN]: ["import:os", "import:example.com/shop/tools/lint", "use:lint.Check", "use:os.Args", "use:os.Exit"],
        [LINT]: [],
    },
    declares: {
        [MAIN]: ["main", "package:main"],
        [API]: ["Open", "Version", "limit", "package:api"],
        [API_TEST]: ["TestOpen", "package:api_test"],
        [BROKEN]: ["Shout", "Width", "package:api"],
        [HANDLER]: ["Handler", "label", "package:api"],          // Serve is a method
        [SCOPE]: ["Scope", "package:api"],                       // its Handler, Open, Shout, Width, Routes are locals
        [PATHS]: ["Join", "package:paths"],
        [SEP_LINUX]: ["package:paths", "sep"],
        [SEP_WINDOWS]: ["package:paths", "sep"],
        [EXTRA]: ["DefaultSize", "Empty", "package:store"],      // Len is a method
        [STORE]: ["Getter", "Key", "MaxItems", "New", "Store", "minItems", "package:store"],   // Get is a method
        [STORE_TEST]: ["TestNew", "package:store"],
        [TEXT]: ["Upper", "package:text"],
        [COLORS]: ["Red", "package:colors"],
        [WIDGETS]: ["Box", "Render", "package:widgets"],        // Unwrap is a method
        [WIDGETS_TEST]: ["Missing", "TestRender", "package:widgets"],
        [PLUGINS]: ["package:plugins", "registered"],            // init left out
        [REGISTER]: ["Register", "package:plugins"],
        [GEN]: ["main", "package:main"],
        [LINT]: ["Check", "package:lint"],
    },
    symbols: {
        [MAIN]: [sym("main", "function", 17, 22, false)],
        [API]: [sym("Version", "const", 12, 12, true), sym("limit", "const", 14, 14, false), sym("Open", "function", 17, 20, true)],
        [API_TEST]: [sym("TestOpen", "function", 9, 13, true)],
        [BROKEN]: [sym("Shout", "function", 6, 8, true), sym("Width", "function", 13, 15, true)],
        [HANDLER]: [
            sym("Handler", "struct", 8, 10, true),
            sym("Store", "property", 9, 9, true, "Handler"),
            sym("Serve", "method", 13, 16, true, "Handler"),
            sym("label", "function", 19, 22, false),
        ],
        [SCOPE]: [sym("Scope", "function", 4, 17, true)],
        [PATHS]: [sym("Join", "function", 4, 6, true)],
        [SEP_LINUX]: [sym("sep", "function", 5, 5, false)],
        [SEP_WINDOWS]: [sym("sep", "function", 5, 5, false)],
        [EXTRA]: [
            sym("DefaultSize", "const", 4, 4, true),
            sym("Empty", "const", 7, 7, true),
            sym("Len", "method", 10, 12, true, "Store"),          // its parent is declared in store.go
        ],
        [STORE]: [
            sym("MaxItems", "const", 6, 6, true),                 // G-3: each spec of the block on its own line
            sym("minItems", "const", 7, 7, false),
            sym("Key", "type", 11, 11, true),                     // a type alias
            sym("Store", "struct", 14, 17, true),
            sym("items", "property", 15, 15, false, "Store"),
            sym("Size", "property", 16, 16, true, "Store"),
            sym("Getter", "interface", 20, 23, true),
            sym("Get", "method", 21, 21, true, "Getter"),
            sym("Len", "method", 22, 22, true, "Getter"),
            sym("New", "function", 26, 31, true),
            sym("Get", "method", 34, 37, true, "Store"),          // receiver *Store, so parent Store
        ],
        [STORE_TEST]: [sym("TestNew", "function", 5, 10, true)],
        [TEXT]: [sym("Upper", "function", 11, 14, true)],
        [COLORS]: [sym("Red", "const", 5, 5, true)],
        [WIDGETS]: [
            sym("Render", "function", 5, 7, true),
            sym("Box", "struct", 10, 12, true),
            sym("Item", "property", 11, 11, true, "Box"),
            sym("Unwrap", "method", 15, 17, true, "Box"),        // receiver Box[T]: parent Box, without its type parameters
        ],
        [WIDGETS_TEST]: [sym("Missing", "function", 6, 6, true), sym("TestRender", "function", 8, 12, true)],
        [PLUGINS]: [sym("registered", "const", 4, 4, false), sym("init", "function", 6, 8, false)],   // init is left out of declares only
        [REGISTER]: [sym("Register", "function", 4, 6, true)],
        [GEN]: [sym("main", "function", 9, 13, false)],
        [LINT]: [sym("Check", "function", 5, 7, true)],
    },
    kinds: {
        [MAIN]: {
            "import:fmt": "external",
            "import:example.com/shop/internal/api": "internal",
            "import:example.com/shop/internal/paths": "internal",
            "import:example.com/shop/internal/text as .": "internal",
            "import:example.com/shop/pkg/go-colors": "internal",
            "import:example.com/shop/pkg/widgets/v2": "internal",
            "import:example.com/shop/plugins as _": "internal",
            "import:github.com/other/kit/v2": "external",
            "use:api.Handler": "internal",
            "use:api.Open": "internal",
            "use:fmt.Println": "external",
            "name:Upper": "internal",
            "use:colors.Red": "internal",
            "use:paths.Join": "internal",
            "use:kit.Run": "external",          // kit: github.com/other/kit/v2's last element with /v2 dropped
            "use:widgets.Missing": "internal",
        },
        [API]: {
            "import:fmt": "external",
            "import:example.com/shop/internal/store": "internal",
            "import:github.com/other/lib": "external",
            "use:store.Store": "internal",
            "use:lib.Log": "external",
            "use:fmt.Sprintf": "external",
            "use:store.DefaultSize": "internal",
            "use:store.New": "internal",
        },
        [API_TEST]: {
            "import:testing": "external",
            "import:example.com/shop/internal/api": "internal",
            "use:testing.T": "external",
            "use:api.Open": "internal",
        },
        [BROKEN]: { "import:example.com/shop/internal/text": "internal", "use:text.Upper": "internal", "name:limit": "internal" },
        [HANDLER]: {
            "import:example.com/shop/internal/store as st": "internal",
            "use:st.Getter": "internal",
            "name:Version": "internal",
            "name:Routes": "internal",
        },
        [SCOPE]: {},
        [PATHS]: { "name:sep": "internal" },
        [SEP_LINUX]: {},
        [SEP_WINDOWS]: {},
        [EXTRA]: { "name:Store": "internal" },
        [STORE]: { "name:DefaultSize": "internal" },
        [STORE_TEST]: {
            "import:testing": "external",
            "use:testing.T": "external",
            "name:New": "internal",
            "name:DefaultSize": "internal",
            "use:Empty.Len": "internal",        // Empty isn't an import alias, so it reads as name:Empty
        },
        [TEXT]: {
            "import:strings": "external",
            // vendor/github.com/x/y/go.mod names the module github.com/x/y, but it sits in a folder the root go.mod
            // leaves out, so the resolver ignores it: the import stays outside the repo
            "import:github.com/x/y": "external",
            "use:y.Do": "external",
            "use:strings.ToUpper": "external",
        },
        [COLORS]: {},
        [WIDGETS]: {},
        [WIDGETS_TEST]: { "import:testing": "external", "name:Render": "internal", "use:testing.T": "external" },
        [PLUGINS]: {},
        [REGISTER]: { "name:registered": "internal" },
        [GEN]: {
            "import:os": "external",
            "import:example.com/shop/tools/lint": "internal",
            "use:lint.Check": "internal",
            "use:os.Args": "external",
            "use:os.Exit": "external",
        },
        [LINT]: {},
    },
    edges: EDGES,
    entryPoints: [
        { path: MAIN, declaredBy: "package main, func main" },
        { path: GEN, declaredBy: "package main, func main" },
    ],
    // line 10's ")))" is the error, between two whole functions: the import and Shout's use come before it, Width's
    // name:limit after it
    broken: { path: BROKEN, specifiers: ["import:example.com/shop/internal/text", "use:text.Upper", "name:limit"] },
    // the scan reading reads only import lines: every file with a use: or name: differs, deliberately
    scan: {
        [MAIN]: [
            "import:fmt",
            "import:example.com/shop/internal/api",
            "import:example.com/shop/internal/paths",
            "import:example.com/shop/internal/text as .",
            "import:example.com/shop/pkg/go-colors",
            "import:example.com/shop/pkg/widgets/v2",
            "import:example.com/shop/plugins as _",
            "import:github.com/other/kit/v2",
        ],
        [API]: ["import:fmt", "import:example.com/shop/internal/store", "import:github.com/other/lib"],
        [API_TEST]: ["import:testing", "import:example.com/shop/internal/api"],
        [BROKEN]: ["import:example.com/shop/internal/text"],
        [HANDLER]: ["import:example.com/shop/internal/store as st"],
        [PATHS]: [],
        [EXTRA]: [],
        [STORE]: [],
        [STORE_TEST]: ["import:testing"],
        [TEXT]: ["import:strings", "import:github.com/x/y"],
        [WIDGETS_TEST]: ["import:testing"],
        [REGISTER]: [],
        [GEN]: ["import:os", "import:example.com/shop/tools/lint"],
    },
    chunks: {
        [MAIN]: [
            { kind: "function", name: "main", startLine: 17, endLine: 22 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 22 },
        ],
        [API]: [
            { kind: "const", name: "Version", startLine: 11, endLine: 12 },
            { kind: "const", name: "limit", startLine: 14, endLine: 14 },
            { kind: "function", name: "Open", startLine: 16, endLine: 20 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 20 },
        ],
        [BROKEN]: [
            { kind: "function", name: "Shout", startLine: 5, endLine: 8 },
            { kind: "function", name: "Width", startLine: 12, endLine: 15 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 15 },
        ],
        [HANDLER]: [
            { kind: "class", name: "Handler", startLine: 7, endLine: 10 },
            { kind: "function", name: "Handler.Serve", startLine: 12, endLine: 16 },
            { kind: "function", name: "label", startLine: 18, endLine: 22 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 22 },
        ],
        [SEP_LINUX]: [
            { kind: "function", name: "sep", startLine: 5, endLine: 5 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 5 },
        ],
        [EXTRA]: [
            { kind: "const", name: "DefaultSize", startLine: 3, endLine: 4 },
            { kind: "const", name: "Empty", startLine: 6, endLine: 7 },
            { kind: "function", name: "Store.Len", startLine: 9, endLine: 12 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 12 },
        ],
        [STORE]: [
            { kind: "const", name: "MaxItems, minItems", startLine: 4, endLine: 8 },   // G-2
            { kind: "type", name: "Key", startLine: 10, endLine: 11 },
            { kind: "class", name: "Store", startLine: 13, endLine: 17 },
            { kind: "interface", name: "Getter", startLine: 19, endLine: 23 },
            { kind: "function", name: "New", startLine: 25, endLine: 31 },
            { kind: "function", name: "Store.Get", startLine: 33, endLine: 37 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 37 },
        ],
        [WIDGETS]: [
            { kind: "function", name: "Render", startLine: 4, endLine: 7 },
            { kind: "class", name: "Box", startLine: 9, endLine: 12 },
            { kind: "function", name: "Box.Unwrap", startLine: 14, endLine: 17 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 17 },
        ],
        [WIDGETS_TEST]: [
            { kind: "function", name: "Missing", startLine: 5, endLine: 6 },
            { kind: "function", name: "TestRender", startLine: 8, endLine: 12 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 12 },
        ],
        [PLUGINS]: [
            { kind: "const", name: "registered", startLine: 4, endLine: 4 },
            { kind: "function", name: "init", startLine: 6, endLine: 8 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 8 },
        ],
    },
    edits: [
        {
            // store.go now declares DefaultSize itself, so its name:DefaultSize is gone (no edges from it at all);
            // api.go, unchanged, reaches store.go alone; store_test.go keeps extra.go through use:Empty.Len
            description: "(a) DefaultSize moves from extra.go into store.go (both files' declares change): api.go and store.go lose their edges to extra.go",
            writes: { [STORE]: STORE_WITH_DEFAULT, [EXTRA]: EXTRA_WITHOUT_DEFAULT },
            edgesAfter: without(edge(API, EXTRA), edge(STORE, EXTRA)),
        },
        {
            // no module's path is a prefix of example.com/shop/internal/… or …/pkg/… or …/plugins any more, so those
            // imports are outside the repo: they and their uses give nothing (colors isn't an alias now: go-colors is,
            // so colors.Red reads as name:colors, which nothing in cmd/shop declares). Same-package names stay, and
            // example.com/shop/tools still names tools/, so tools/gen/main.go keeps lint.go.
            description: "(b) go.mod's module path changes to example.com/market (a manifest changes): only same-package names and the tools module's import keep their edges",
            writes: { "go.mod": text("module example.com/market", "", "go 1.22") },
            edgesAfter: [
                edge(BROKEN, API),
                edge(HANDLER, API),
                edge(PATHS, SEP_LINUX),
                edge(PATHS, SEP_WINDOWS),
                edge(EXTRA, STORE),
                edge(STORE, EXTRA),
                edge(STORE_TEST, EXTRA),
                edge(STORE_TEST, STORE),
                edge(WIDGETS_TEST, WIDGETS),
                edge(REGISTER, PLUGINS),
                edge(GEN, LINT),
            ],
        },
        {
            // handler.go's name:Routes, which named nothing, now names the new file; the new file's name:Version names
            // api.go
            description: "(c) a new file internal/api/routes.go declares Routes (the file set changes): handler.go, unchanged, gains an edge to it",
            writes: {
                [ROUTES]: text(
                    "package api",
                    "",
                    "// Routes lists the API's paths, the first one versioned.",
                    "func Routes() []string {",
                    "\treturn []string{\"/\" + Version}",
                    "}",
                ),
            },
            edgesAfter: [
                edge(MAIN, API),
                edge(MAIN, HANDLER),
                edge(MAIN, PATHS),
                edge(MAIN, TEXT),
                edge(MAIN, COLORS),
                edge(MAIN, WIDGETS),
                edge(MAIN, PLUGINS),
                edge(MAIN, REGISTER),
                edge(API, EXTRA),
                edge(API, STORE),
                edge(API_TEST, API),
                edge(BROKEN, API),
                edge(BROKEN, TEXT),
                edge(HANDLER, API),
                edge(HANDLER, ROUTES),           // name:Routes, new
                edge(HANDLER, STORE),
                edge(ROUTES, API),               // the new file's name:Version
                edge(PATHS, SEP_LINUX),
                edge(PATHS, SEP_WINDOWS),
                edge(EXTRA, STORE),
                edge(STORE, EXTRA),
                edge(STORE_TEST, EXTRA),
                edge(STORE_TEST, STORE),
                edge(WIDGETS_TEST, WIDGETS),
                edge(REGISTER, PLUGINS),
                edge(GEN, LINT),
            ],
        },
    ],
};
