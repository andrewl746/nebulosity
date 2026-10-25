import type { SymbolRow } from "../../lib/db/schema";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";

/**
 * test/fixtures/python-repo's ground truth, DERIVED BY HAND from the fixture's files and the E4 plan's Task P rules
 * (docs/plans/2026-10-24-e4-languages.md), before any Python adapter code existed: never by running the code
 * (CLAUDE.md). Change a fixture file and re-derive this by hand.
 *
 * The roots (Task P, "Packages and roots"). The packages are the folders holding an __init__.py: services/alpha/app,
 * services/beta/src/app, src/shop, src/shop/payments, src/shop/plugins, tests/cart_tests, toolkit. The top-level ones
 * (parent not a package) are app (twice), shop, cart_tests and toolkit, so their parents are roots: services/alpha,
 * services/beta/src, src, tests, "". The manifests add their folders and src/: pyproject.toml, setup.cfg and setup.py
 * give "" and src; services/beta/pyproject.toml gives services/beta and services/beta/src. pyproject.toml names src
 * (`where`) and scripts (pytest's `pythonpath`); services/beta/pyproject.toml names services/beta/src (Poetry's
 * `from`). So: "", scripts, services/alpha, services/beta, services/beta/src, src, tests. extras is a root only after
 * edit (b). .venv/pyvenv.cfg and .venv/src/helper-tool/pyproject.toml add none: a pyvenv.cfg only marks a virtual
 * environment, and a manifest inside one (in the folder the exclusion leaves out) is ignored.
 *
 * A module a.b.c under a root r is the first indexed of r/a/b/c.py, r/a/b/c/__init__.py, r/a/b/c.pyi,
 * r/a/b/c/__init__.pyi. An absolute import from F tries the roots that contain F, deepest first ("" last), the first hit
 * winning; else it counts the hits among all the other roots, and exactly one resolves. `X:name` tries, in each root
 * that contains F (deepest first), the submodule X.name and then the module X, the first hit winning; only then the
 * other roots, a unique hit for X.name, else a unique hit for X. So F's own package X, which may define name as an
 * attribute, beats another root's X/name.py (Task P review #1, I1: services/alpha/app/views.py). A relative import
 * counts from F's folder, one folder up per extra dot.
 *
 * Standard-library names resolve only through F's own roots (the pre-ship pass's Task P, ruling R13, which amends R4):
 * when an absolute import's first segment X is a standard-library name (one on every Python from 3.10 to 3.14; `test`,
 * `parser` and `tomllib` aren't), only the roots that contain F are tried, and only those that hold X itself as a module
 * or a regular package (a namespace folder named X never does: the standard library's regular package beats it at run
 * time); no other root is tried. So tests/logging.py, directly in the root tests, is reached by tests/test_audit.py's
 * `import logging` (its own root) but never by package code's (the E4 review's M6, second half), and
 * scripts/release.py's `from secrets import TOKEN` reaches scripts/secrets.py beside it in the root scripts. Relative
 * imports are unchanged: src/shop/orders.py's `from . import logging` still names src/shop/logging.py, which no root
 * holds directly.
 *
 * Readings of points the plan leaves open, used below (each is in progress-python.md):
 * - "module-level" and "top-level" mean the module's own statements: an assignment inside a top-level try or if
 *   (cart.py's and text.py's `fast_* = None`) is neither a symbol nor a chunk;
 * - a member of an unexported class isn't exported, a dunder included (text.py's _Cache);
 * - one chunk per assignment statement, named by its targets joined with ", " (lib/chunks.ts's rule for
 *   `const a = 1, b = 2`), while each target is its own symbol (models.py's WIDTH, HEIGHT);
 * - `type X = …` is a top-level declaration, so it gets a chunk of kind type (models.py's PriceMap);
 * - an entry-point group's name is written unquoted in declaredBy (`[project.entry-points.shop.plugins]`);
 * - a path declared twice keeps the first: the manifests' entries, then `__main__.py`, then the `__main__` marker
 *   (src/shop/__main__.py has the marker too, and is declared by `__main__.py`).
 */

type Kind = SymbolRow["kind"];
const top = (name: string, kind: Kind, startLine: number, endLine: number, exported: boolean): SymbolRow => ({
    name, qualifiedName: name, kind, startLine, endLine, exported, parentQualifiedName: null,
});
const member = (parent: string, name: string, kind: Kind, startLine: number, endLine: number, exported: boolean): SymbolRow => ({
    name, qualifiedName: `${parent}.${name}`, kind, startLine, endLine, exported, parentQualifiedName: parent,
});
const edge = (source: string, target: string): TruthEdge => ({ source, target });

/** The 38 edges of a full run, sorted by source then target, each with the specifier and the rule that makes it. */
const EDGES: TruthEdge[] = [
    // shop.models:Product: no submodule shop.models.Product anywhere; shop.models in no root holding conftest.py
    // (only ""), and in exactly one other root (src)
    edge("conftest.py", "src/shop/models.py"),
    // helpers: the root scripts (pytest's pythonpath) contains the importer and holds scripts/helpers.py
    edge("scripts/deploy.py", "scripts/helpers.py"),
    // secrets:TOKEN (a standard-library name, a flat script beside its own secrets.py): the root scripts contains the
    // importer and holds secrets as a module, scripts/secrets.py; no submodule secrets.TOKEN there, so the module secrets
    edge("scripts/release.py", "scripts/secrets.py"),
    // app:config: the root services/alpha contains the importer, and services/alpha/app/config.py is the submodule
    edge("services/alpha/app/__init__.py", "services/alpha/app/config.py"),
    // app:db: in the root services/alpha, which contains the importer, there's no submodule app.db but there is the
    // module app, services/alpha/app/__init__.py (which defines db): it wins before any other root is tried, so
    // services/beta/src/app/db.py, the other app's submodule, is never reached
    edge("services/alpha/app/views.py", "services/alpha/app/__init__.py"),
    // app.config:SETTINGS: no submodule app.config.SETTINGS; app.config in the deepest root holding the importer,
    // services/beta/src
    edge("services/beta/src/app/__init__.py", "services/beta/src/app/config.py"),
    // .models:Product (one dot in an __init__.py): base src/shop; no module src/shop/models/Product, so src/shop/models
    edge("src/shop/__init__.py", "src/shop/models.py"),
    // shop.cli:main: no submodule shop.cli.main; shop.cli in the root src
    edge("src/shop/__main__.py", "src/shop/cli.py"),
    // .models:Product: base src/shop, the module src/shop/models (.py before .pyi)
    edge("src/shop/cart.py", "src/shop/models.py"),
    // shop.payments (import a.b as ab): the package src/shop/payments/__init__.py
    edge("src/shop/cart.py", "src/shop/payments/__init__.py"),
    // shop.payments.gateway (import a.b.c): one file, the module itself, no edge to the __init__.py files above it
    edge("src/shop/cart.py", "src/shop/payments/gateway.py"),
    // vendors:acme: src/vendors has no __init__.py (a namespace package); the submodule vendors.acme under src
    edge("src/shop/cart.py", "src/vendors/acme.py"),
    // toolkit.text:shout (an import inside a function): no submodule toolkit.text.shout; toolkit.text under ""
    edge("src/shop/cart.py", "toolkit/text.py"),
    // .:VERSION: no module src/shop/VERSION, so the package src/shop/__init__.py
    edge("src/shop/cli.py", "src/shop/__init__.py"),
    // .cart:Cart (and .cart:checkout, the same file): the module src/shop/cart
    edge("src/shop/cli.py", "src/shop/cart.py"),
    // shop.payments.gateway: import_module("…") with import_module imported from importlib
    edge("src/shop/cli.py", "src/shop/payments/gateway.py"),
    // shop.plugins.fancy: importlib.import_module("…") with one plain string literal
    edge("src/shop/cli.py", "src/shop/plugins/fancy.py"),
    // toolkit.text: __import__("…")
    edge("src/shop/cli.py", "toolkit/text.py"),
    // .cart:Cart: an import under `if TYPE_CHECKING:` counts
    edge("src/shop/models.py", "src/shop/cart.py"),
    // .:logging (one dot): base src/shop, the module src/shop/logging; relative, so the standard-library rule never applies
    edge("src/shop/orders.py", "src/shop/logging.py"),
    // .:gateway (one dot in an __init__.py): the module src/shop/payments/gateway
    edge("src/shop/payments/__init__.py", "src/shop/payments/gateway.py"),
    // ..models:Product (two dots): base src/shop, the module src/shop/models
    edge("src/shop/payments/gateway.py", "src/shop/models.py"),
    // ..:models: base src/shop, the module src/shop/models
    edge("src/shop/plugins/fancy.py", "src/shop/models.py"),
    // ..payments.gateway:charge (from ..m.n import c): no module src/shop/payments/gateway/charge, so
    // src/shop/payments/gateway
    edge("src/shop/plugins/fancy.py", "src/shop/payments/gateway.py"),
    // shop.cart:Cart and shop.cart:checkout (a parenthesized import over four lines): shop.cart under src, the one root
    // that has it
    edge("src/shop/tests.py", "src/shop/cart.py"),
    // shop.cart:Cart: shop.cart in no root holding the importer (tests, ""), in exactly one other (src)
    edge("tests/cart_tests/factories.py", "src/shop/cart.py"),
    // shop.models:Product: as conftest.py's, through the one other root src
    edge("tests/model_tests/test_models.py", "src/shop/models.py"),
    // cart_tests.factories:make_cart (a test package importing another absolutely): cart_tests.factories under the
    // Django-style root tests, which has no __init__.py of its own
    edge("tests/model_tests/test_models.py", "tests/cart_tests/factories.py"),
    // shop: no shop in tests or "", one in src (src/shop/__init__.py)
    edge("tests/runtests.py", "src/shop/__init__.py"),
    // cart_tests: the empty package tests/cart_tests/__init__.py under the root tests
    edge("tests/runtests.py", "tests/cart_tests/__init__.py"),
    // shop.audit:record (an ordinary absolute import of the repo's own package, beside a standard-library one): no
    // submodule shop.audit.record anywhere; shop.audit in no root holding the importer (tests, ""), in exactly one other (src)
    edge("tests/test_audit.py", "src/shop/audit.py"),
    // logging (a standard-library name): the root tests contains the importer and holds logging as a module,
    // tests/logging.py (the deepest root containing it; "" holds no logging)
    edge("tests/test_audit.py", "tests/logging.py"),
    // .text:shout: base toolkit; no module toolkit/text/shout, so toolkit/text
    edge("toolkit/__init__.py", "toolkit/text.py"),
    // toolkit:text, above the syntax error: the submodule toolkit.text
    edge("toolkit/broken.py", "toolkit/text.py"),
    // toolkit:slugify (from pkg import name): no submodule toolkit.slugify in any root, so the module toolkit, the
    // package's __init__.py
    edge("toolkit/test_text.py", "toolkit/__init__.py"),
    // toolkit:text (from pkg import submodule): the submodule toolkit.text
    edge("toolkit/test_text.py", "toolkit/text.py"),
    // ._speedups:fast_shout (inside a try): no module toolkit/_speedups/fast_shout; toolkit/_speedups is a stub alone,
    // toolkit/_speedups.pyi (the third candidate)
    edge("toolkit/text.py", "toolkit/_speedups.pyi"),
    // toolkit.text:* (from x import *): the module toolkit.text
    edge("toolkit/text_test.py", "toolkit/text.py"),
    // not edges:
    // - scripts/deploy.py's app:config: app.config is in two other roots (services/alpha, services/beta/src) and so is
    //   app, so nothing (internal: app is a top-level package's name); its email.utils:formatdate is a standard-library
    //   name, and neither root containing it (scripts, "") holds email as a module or a regular package (the stray
    //   email/ folder is a namespace folder, with no utils.py anyway): external; its import_module("toolkit.text") calls
    //   a local function, not importlib's (no specifier);
    // - src/shop/audit.py's logging and src/shop/receipts.py's logging:getLogger: the standard library's logging. The
    //   roots containing them (src, "") hold no logging, and tests/logging.py's root tests doesn't contain them, so it
    //   never captures them (without the rule, a unique hit among the other roots). Nor src/shop/logging.py, which no
    //   root holds directly;
    // - src/shop/cart.py's .speedups:fast_total names no file (a relative miss, internal);
    // - src/shop/gui.py's promo:DISCOUNT: no promo anywhere until edit (b) makes extras a root (external);
    // - src/shop/models.pyi beside src/shop/models.py: .py comes first, so nothing reaches the stub;
    // - .venv/lib/site.py is left out (the folder of a pyvenv.cfg), and so is every manifest under .venv/: the
    //   resolver ignores .venv/src/helper-tool/pyproject.toml (the plan's rule on manifests in excluded folders), so its
    //   folders are no roots and its helper-tool script (helpers:banner, which would find scripts/helpers.py) declares
    //   no entry point;
    // - setuptools, pytest, typing, requests, os, sys, json, importlib are outside the repo; from __future__ is nothing.
];

const without = (...dropped: TruthEdge[]): TruthEdge[] =>
    EDGES.filter((e) => !dropped.some((d) => d.source === e.source && d.target === e.target));
const byEdge = (a: TruthEdge, b: TruthEdge): number =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);

const PYPROJECT_WHERE_EXTRAS = `[project]
name = "shop"
version = "1.0.0"
dependencies = ["requests"]

[project.scripts]
shop = "shop.cli:main"
ghost = "shop.ghost:main"

[project.gui-scripts]
shop-gui = "shop.gui:run"

[project.entry-points."shop.plugins"]
fancy = "shop.plugins.fancy:FancyPlugin"

[tool.setuptools.packages.find]
where = ["src", "extras"]

[tool.pytest.ini_options]
pythonpath = ["scripts"]
`;

const HELPERS_WITH_MAIN = `def banner(text):
    return f"== {text} =="


if __name__ == "__main__":
    print(banner("helpers"))
`;

export const pythonRepoTruth: FixtureTruth = {
    files: [
        { path: "conftest.py", language: "python", isTest: true, lineCount: 8 },              // conftest.py
        { path: "email/templates.py", language: "python", isTest: false, lineCount: 2 },
        { path: "extras/promo.py", language: "python", isTest: false, lineCount: 1 },
        { path: "scripts/deploy.py", language: "python", isTest: false, lineCount: 20 },
        { path: "scripts/helpers.py", language: "python", isTest: false, lineCount: 2 },
        { path: "scripts/release.py", language: "python", isTest: false, lineCount: 5 },
        { path: "scripts/secrets.py", language: "python", isTest: false, lineCount: 1 },
        { path: "services/alpha/app/__init__.py", language: "python", isTest: false, lineCount: 4 },
        { path: "services/alpha/app/config.py", language: "python", isTest: false, lineCount: 1 },
        { path: "services/alpha/app/views.py", language: "python", isTest: false, lineCount: 5 },
        { path: "services/beta/src/app/__init__.py", language: "python", isTest: false, lineCount: 5 },
        { path: "services/beta/src/app/config.py", language: "python", isTest: false, lineCount: 1 },
        { path: "services/beta/src/app/db.py", language: "python", isTest: false, lineCount: 1 },
        { path: "setup.py", language: "python", isTest: false, lineCount: 3 },                // a manifest and a code file
        { path: "src/shop/__init__.py", language: "python", isTest: false, lineCount: 12 },
        { path: "src/shop/__main__.py", language: "python", isTest: false, lineCount: 4 },
        { path: "src/shop/audit.py", language: "python", isTest: false, lineCount: 5 },
        { path: "src/shop/cart.py", language: "python", isTest: false, lineCount: 23 },
        { path: "src/shop/cli.py", language: "python", isTest: false, lineCount: 19 },
        { path: "src/shop/gui.py", language: "python", isTest: false, lineCount: 5 },
        { path: "src/shop/logging.py", language: "python", isTest: false, lineCount: 2 },
        { path: "src/shop/models.py", language: "python", isTest: false, lineCount: 57 },
        { path: "src/shop/models.pyi", language: "python", isTest: false, lineCount: 10 },
        { path: "src/shop/orders.py", language: "python", isTest: false, lineCount: 6 },
        { path: "src/shop/payments/__init__.py", language: "python", isTest: false, lineCount: 1 },
        { path: "src/shop/payments/gateway.py", language: "python", isTest: false, lineCount: 6 },
        { path: "src/shop/plugins/__init__.py", language: "python", isTest: false, lineCount: 0 },   // empty
        { path: "src/shop/plugins/fancy.py", language: "python", isTest: false, lineCount: 7 },
        { path: "src/shop/receipts.py", language: "python", isTest: false, lineCount: 5 },
        { path: "src/shop/tests.py", language: "python", isTest: true, lineCount: 8 },          // tests.py
        { path: "src/vendors/acme.py", language: "python", isTest: false, lineCount: 1 },
        { path: "tests/cart_tests/__init__.py", language: "python", isTest: true, lineCount: 0 },   // empty; the tests/ folder
        { path: "tests/cart_tests/factories.py", language: "python", isTest: true, lineCount: 5 },
        { path: "tests/logging.py", language: "python", isTest: true, lineCount: 5 },          // the tests/ folder
        { path: "tests/model_tests/test_models.py", language: "python", isTest: true, lineCount: 8 },
        { path: "tests/runtests.py", language: "python", isTest: true, lineCount: 8 },
        { path: "tests/test_audit.py", language: "python", isTest: true, lineCount: 8 },
        { path: "toolkit/__init__.py", language: "python", isTest: false, lineCount: 5 },
        { path: "toolkit/_speedups.pyi", language: "python", isTest: false, lineCount: 1 },
        { path: "toolkit/broken.py", language: "python", isTest: false, lineCount: 10 },
        { path: "toolkit/test_text.py", language: "python", isTest: true, lineCount: 6 },       // test_*.py
        { path: "toolkit/text.py", language: "python", isTest: false, lineCount: 21 },
        { path: "toolkit/text_test.py", language: "python", isTest: true, lineCount: 5 },       // *_test.py
    ],
    excluded: [".venv/lib/site.py"],
    specifiers: {
        "conftest.py": ["pytest", "shop.models:Product"],
        "email/templates.py": [],
        "extras/promo.py": [],
        "scripts/deploy.py": ["sys", "email.utils:formatdate", "helpers", "app:config"],
        "scripts/helpers.py": [],
        "scripts/release.py": ["secrets:TOKEN"],
        "scripts/secrets.py": [],
        "services/alpha/app/__init__.py": ["app:config"],
        "services/alpha/app/config.py": [],
        "services/alpha/app/views.py": ["app:db"],
        "services/beta/src/app/__init__.py": ["app.config:SETTINGS"],
        "services/beta/src/app/config.py": [],
        "services/beta/src/app/db.py": [],
        "setup.py": ["setuptools:setup"],
        "src/shop/__init__.py": [".models:Product"],
        "src/shop/__main__.py": ["shop.cli:main"],                       // the alias run_cli is not part of it
        "src/shop/audit.py": ["logging"],
        "src/shop/cart.py": [
            // from __future__ gives nothing; the try block and the function's import count
            "shop.payments", "shop.payments.gateway", "vendors:acme", ".models:Product", ".speedups:fast_total", "toolkit.text:shout",
        ],
        "src/shop/cli.py": [
            "importlib", "os", "importlib:import_module", "requests", ".:VERSION", ".cart:Cart", ".cart:checkout",
            // the three literal dynamic imports; nothing for import_module(name) or the f-string
            "shop.plugins.fancy", "shop.payments.gateway", "toolkit.text",
        ],
        "src/shop/gui.py": ["promo:DISCOUNT"],
        "src/shop/logging.py": [],
        "src/shop/models.py": ["typing:TYPE_CHECKING", ".cart:Cart"],
        "src/shop/models.pyi": ["typing:ClassVar"],
        "src/shop/orders.py": [".:logging"],
        "src/shop/payments/__init__.py": [".:gateway"],
        "src/shop/payments/gateway.py": ["..models:Product"],
        "src/shop/plugins/__init__.py": [],
        "src/shop/plugins/fancy.py": ["..:models", "..payments.gateway:charge"],
        "src/shop/receipts.py": ["logging:getLogger"],
        "src/shop/tests.py": ["shop.cart:Cart", "shop.cart:checkout"],
        "src/vendors/acme.py": [],
        "tests/cart_tests/__init__.py": [],
        "tests/cart_tests/factories.py": ["shop.cart:Cart"],
        "tests/logging.py": [],
        "tests/model_tests/test_models.py": ["cart_tests.factories:make_cart", "shop.models:Product"],
        "tests/runtests.py": ["os", "sys", "cart_tests", "shop"],
        "tests/test_audit.py": ["logging", "shop.audit:record"],
        "toolkit/__init__.py": [".text:shout"],
        "toolkit/_speedups.pyi": [],
        "toolkit/broken.py": ["json", "toolkit:text"],
        "toolkit/test_text.py": ["toolkit:slugify", "toolkit:text"],
        "toolkit/text.py": ["._speedups:fast_shout"],
        "toolkit/text_test.py": ["toolkit.text:*"],
    },
    declares: {
        "conftest.py": [],
        "email/templates.py": [],
        "extras/promo.py": [],
        "scripts/deploy.py": ["__main__"],                    // if '__main__' == __name__: (single quotes, operands reversed)
        "scripts/helpers.py": [],
        "scripts/release.py": [],
        "scripts/secrets.py": [],
        "services/alpha/app/__init__.py": [],
        "services/alpha/app/config.py": [],
        "services/alpha/app/views.py": [],
        "services/beta/src/app/__init__.py": [],
        "services/beta/src/app/config.py": [],
        "services/beta/src/app/db.py": [],
        "setup.py": [],
        "src/shop/__init__.py": [],
        "src/shop/__main__.py": ["__main__"],                 // if __name__ == "__main__":
        "src/shop/audit.py": [],
        "src/shop/cart.py": [],
        "src/shop/cli.py": [],
        "src/shop/gui.py": [],
        "src/shop/logging.py": [],
        "src/shop/models.py": [],
        "src/shop/models.pyi": [],
        "src/shop/orders.py": [],
        "src/shop/payments/__init__.py": [],
        "src/shop/payments/gateway.py": [],
        "src/shop/plugins/__init__.py": [],
        "src/shop/plugins/fancy.py": [],
        "src/shop/receipts.py": [],
        "src/shop/tests.py": [],
        "src/vendors/acme.py": [],
        "tests/cart_tests/__init__.py": [],
        "tests/cart_tests/factories.py": [],
        "tests/logging.py": [],
        "tests/model_tests/test_models.py": [],
        "tests/runtests.py": ["__main__"],                    // if __name__ == '__main__': (single quotes)
        "tests/test_audit.py": [],
        "toolkit/__init__.py": [],
        "toolkit/_speedups.pyi": [],
        "toolkit/broken.py": [],
        "toolkit/test_text.py": [],
        "toolkit/text.py": [],
        "toolkit/text_test.py": [],
    },
    symbols: {
        "conftest.py": [top("product", "function", 6, 8, true)],                 // from its decorator
        "email/templates.py": [top("WELCOME", "const", 2, 2, true)],
        "extras/promo.py": [top("DISCOUNT", "const", 1, 1, true)],
        "scripts/deploy.py": [top("import_module", "function", 9, 11, true), top("main", "function", 14, 16, true)],
        "scripts/helpers.py": [top("banner", "function", 1, 2, true)],
        "scripts/release.py": [top("publish", "function", 4, 5, true)],
        "scripts/secrets.py": [top("TOKEN", "const", 1, 1, true)],
        "services/alpha/app/__init__.py": [top("NAME", "const", 3, 3, true), top("db", "const", 4, 4, true)],
        "services/alpha/app/config.py": [top("DEBUG", "const", 1, 1, true)],
        "services/alpha/app/views.py": [top("index", "function", 4, 5, true)],
        "services/beta/src/app/__init__.py": [top("run", "function", 4, 5, true)],
        "services/beta/src/app/config.py": [top("SETTINGS", "const", 1, 1, true)],
        "services/beta/src/app/db.py": [top("ENGINE", "const", 1, 1, true)],
        "setup.py": [],
        // __all__ lists Product and VERSION: exactly those are exported, so not __all__ itself, _registry or configure
        "src/shop/__init__.py": [
            top("__all__", "const", 4, 4, false),
            top("VERSION", "const", 7, 7, true),                                  // its comment above is left out
            top("_registry", "const", 8, 8, false),
            top("configure", "function", 11, 12, false),
        ],
        "src/shop/__main__.py": [],
        "src/shop/audit.py": [top("record", "function", 4, 5, true)],
        "src/shop/cart.py": [
            top("Cart", "class", 15, 17, true),
            member("Cart", "__init__", "constructor", 16, 17, true),
            top("checkout", "function", 20, 23, true),
            // not fast_total: its assignment is inside the try (and self.items is inside __init__)
        ],
        "src/shop/cli.py": [top("main", "function", 12, 19, true)],
        "src/shop/gui.py": [top("run", "function", 4, 5, true)],
        "src/shop/logging.py": [top("configure", "function", 1, 2, true)],
        "src/shop/models.py": [
            top("CURRENCY", "const", 9, 9, true),
            top("DEFAULT_PRICE", "const", 10, 10, true),                          // an annotated assignment
            top("WIDTH", "const", 11, 11, true),                                  // each name of a tuple target
            top("HEIGHT", "const", 11, 11, true),
            top("register", "function", 14, 16, true),
            top("Product", "class", 20, 49, true),                                // from @register; the comment above left out
            member("Product", "currency", "property", 24, 24, true),             // a class-level assignment
            member("Product", "name", "property", 25, 25, true),                 // a class-level annotation
            member("Product", "__init__", "constructor", 27, 29, true),
            member("Product", "label", "accessor", 31, 33, true),                // @property
            member("Product", "label", "accessor", 35, 37, true),                // @label.setter
            member("Product", "_cents", "method", 39, 40, false),
            member("Product", "__repr__", "method", 42, 43, true),               // a dunder
            member("Product", "refresh", "method", 45, 46, true),                // async def
            member("Product", "Meta", "class", 48, 49, true),                    // a nested class (its own members not listed)
            top("fetch_price", "function", 52, 54, true),                         // a decorated async def
            top("PriceMap", "type", 57, 57, true),                                // type X = …
        ],
        "src/shop/models.pyi": [
            top("Product", "class", 3, 8, true),
            member("Product", "currency", "property", 4, 4, true),
            member("Product", "name", "property", 5, 5, true),
            member("Product", "__init__", "constructor", 6, 6, true),
            member("Product", "label", "accessor", 7, 8, true),
            top("register", "function", 10, 10, true),
        ],
        "src/shop/orders.py": [top("place", "function", 4, 6, true)],
        "src/shop/payments/__init__.py": [],
        "src/shop/payments/gateway.py": [top("charge", "function", 4, 6, true)],
        "src/shop/plugins/__init__.py": [],
        "src/shop/plugins/fancy.py": [top("FancyPlugin", "class", 5, 7, true), member("FancyPlugin", "apply", "method", 6, 7, true)],
        "src/shop/receipts.py": [top("emit", "function", 4, 5, true)],
        "src/shop/tests.py": [top("test_checkout", "function", 7, 8, true)],
        "src/vendors/acme.py": [top("TAX", "const", 1, 1, true)],
        "tests/cart_tests/__init__.py": [],
        "tests/cart_tests/factories.py": [top("make_cart", "function", 4, 5, true)],
        "tests/logging.py": [top("captured", "function", 4, 5, true)],                  // the docstring above is no symbol
        "tests/model_tests/test_models.py": [top("test_product_label", "function", 5, 8, true)],
        "tests/runtests.py": [],
        "tests/test_audit.py": [top("test_record", "function", 6, 8, true)],
        "toolkit/__init__.py": [top("slugify", "function", 4, 5, true)],
        "toolkit/_speedups.pyi": [top("fast_shout", "function", 1, 1, true)],
        "toolkit/broken.py": [top("first", "function", 6, 7, true)],                // above the error
        "toolkit/test_text.py": [top("test_slugify", "function", 4, 6, true)],
        "toolkit/text.py": [
            top("_Cache", "class", 8, 13, false),
            member("_Cache", "__init__", "constructor", 9, 10, false),           // its class isn't exported
            member("_Cache", "get", "method", 12, 13, false),
            top("shout", "function", 16, 17, true),
            top("main", "function", 20, 21, true),
        ],
        "toolkit/text_test.py": [top("test_shout", "function", 4, 5, true)],
    },
    kinds: {
        "conftest.py": { pytest: "external", "shop.models:Product": "internal" },
        "email/templates.py": {},
        "extras/promo.py": {},
        "scripts/deploy.py": {
            sys: "external",
            "email.utils:formatdate": "external",   // email is a standard-library name (and the stray email/ folder is no top-level package)
            helpers: "internal",                    // resolves
            "app:config": "internal",               // unresolved, but app is a top-level package's name
        },
        "scripts/helpers.py": {},
        "scripts/release.py": { "secrets:TOKEN": "internal" },   // a standard-library name its own root holds: it resolves
        "scripts/secrets.py": {},
        "services/alpha/app/__init__.py": { "app:config": "internal" },
        "services/alpha/app/config.py": {},
        "services/alpha/app/views.py": { "app:db": "internal" },
        "services/beta/src/app/__init__.py": { "app.config:SETTINGS": "internal" },
        "services/beta/src/app/config.py": {},
        "services/beta/src/app/db.py": {},
        "setup.py": { "setuptools:setup": "external" },
        "src/shop/__init__.py": { ".models:Product": "internal" },
        "src/shop/__main__.py": { "shop.cli:main": "internal" },
        // a standard-library name: external, although tests/logging.py makes logging a root module's name
        "src/shop/audit.py": { logging: "external" },
        "src/shop/cart.py": {
            "shop.payments": "internal",
            "shop.payments.gateway": "internal",
            "vendors:acme": "internal",              // a namespace package's import: internal because it resolves
            ".models:Product": "internal",
            ".speedups:fast_total": "internal",      // relative: internal, resolved or not
            "toolkit.text:shout": "internal",
        },
        "src/shop/cli.py": {
            importlib: "external",
            os: "external",
            "importlib:import_module": "external",
            requests: "external",
            ".:VERSION": "internal",
            ".cart:Cart": "internal",
            ".cart:checkout": "internal",
            "shop.plugins.fancy": "internal",
            "shop.payments.gateway": "internal",
            "toolkit.text": "internal",
        },
        "src/shop/gui.py": { "promo:DISCOUNT": "external" },   // no top-level package or root module promo before edit (b)
        "src/shop/logging.py": {},
        "src/shop/models.py": { "typing:TYPE_CHECKING": "external", ".cart:Cart": "internal" },
        "src/shop/models.pyi": { "typing:ClassVar": "external" },
        "src/shop/orders.py": { ".:logging": "internal" },
        "src/shop/payments/__init__.py": { ".:gateway": "internal" },
        "src/shop/payments/gateway.py": { "..models:Product": "internal" },
        "src/shop/plugins/__init__.py": {},
        "src/shop/plugins/fancy.py": { "..:models": "internal", "..payments.gateway:charge": "internal" },
        "src/shop/receipts.py": { "logging:getLogger": "external" },   // a standard-library name, as audit.py's
        "src/shop/tests.py": { "shop.cart:Cart": "internal", "shop.cart:checkout": "internal" },
        "src/vendors/acme.py": {},
        "tests/cart_tests/__init__.py": {},
        "tests/cart_tests/factories.py": { "shop.cart:Cart": "internal" },
        "tests/logging.py": {},
        "tests/model_tests/test_models.py": { "cart_tests.factories:make_cart": "internal", "shop.models:Product": "internal" },
        "tests/runtests.py": { os: "external", sys: "external", cart_tests: "internal", shop: "internal" },
        // logging from inside the root that holds tests/logging.py: it resolves there, so internal
        "tests/test_audit.py": { logging: "internal", "shop.audit:record": "internal" },
        "toolkit/__init__.py": { ".text:shout": "internal" },
        "toolkit/_speedups.pyi": {},
        "toolkit/broken.py": { json: "external", "toolkit:text": "internal" },
        "toolkit/test_text.py": { "toolkit:slugify": "internal", "toolkit:text": "internal" },
        "toolkit/text.py": { "._speedups:fast_shout": "internal" },
        "toolkit/text_test.py": { "toolkit.text:*": "internal" },
    },
    edges: EDGES,
    entryPoints: [
        { path: "scripts/deploy.py", declaredBy: "if __name__ == \"__main__\"" },
        // app:run, tried in services/beta (no app) and then services/beta/src first
        { path: "services/beta/src/app/__init__.py", declaredBy: "services/beta/pyproject.toml [tool.poetry.scripts] beta" },
        { path: "src/shop/__main__.py", declaredBy: "__main__.py" },   // also declares __main__: the first met wins
        // shop.cli:main, tried in "" (no shop) and then src; pyproject's ghost (shop.ghost) names no file
        { path: "src/shop/cli.py", declaredBy: "pyproject.toml [project.scripts] shop" },
        { path: "src/shop/gui.py", declaredBy: "pyproject.toml [project.gui-scripts] shop-gui" },
        { path: "src/shop/plugins/fancy.py", declaredBy: "pyproject.toml [project.entry-points.shop.plugins] fancy" },
        { path: "tests/runtests.py", declaredBy: "if __name__ == \"__main__\"" },
        { path: "toolkit/text.py", declaredBy: "setup.cfg [options.entry_points] console_scripts shop-admin" },
    ],
    broken: { path: "toolkit/broken.py", specifiers: ["json", "toolkit:text"] },
    // the scan reads only imports at column 0, so the indented ones (a try, `if TYPE_CHECKING:`, a function) and the
    // dynamic ones aren't seen; from __future__ is nothing in both readings; the parenthesized list in src/shop/tests.py
    // is read to its ")" (the same as the full reading)
    scan: {
        "src/shop/cart.py": ["shop.payments", "shop.payments.gateway", "vendors:acme", ".models:Product"],
        "src/shop/cli.py": ["importlib", "os", "importlib:import_module", "requests", ".:VERSION", ".cart:Cart", ".cart:checkout"],
        "src/shop/models.py": ["typing:TYPE_CHECKING"],
        "toolkit/text.py": [],
    },
    chunks: {
        "conftest.py": [
            { kind: "function", name: "product", startLine: 6, endLine: 8 },    // the decorator included
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 8 },
        ],
        "src/shop/__init__.py": [
            { kind: "const", name: "__all__", startLine: 4, endLine: 4 },
            { kind: "const", name: "VERSION", startLine: 6, endLine: 7 },        // the comment directly above included
            { kind: "const", name: "_registry", startLine: 8, endLine: 8 },
            { kind: "function", name: "configure", startLine: 11, endLine: 12 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 12 },
        ],
        "src/shop/cart.py": [
            { kind: "class", name: "Cart", startLine: 15, endLine: 17 },
            { kind: "function", name: "checkout", startLine: 20, endLine: 23 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 23 },
        ],
        "src/shop/models.py": [
            { kind: "const", name: "CURRENCY", startLine: 9, endLine: 9 },
            { kind: "const", name: "DEFAULT_PRICE", startLine: 10, endLine: 10 },
            { kind: "const", name: "WIDTH, HEIGHT", startLine: 11, endLine: 11 },
            { kind: "function", name: "register", startLine: 14, endLine: 16 },
            { kind: "class", name: "Product", startLine: 19, endLine: 49 },      // the comment and the decorator included
            { kind: "function", name: "fetch_price", startLine: 52, endLine: 54 },
            { kind: "type", name: "PriceMap", startLine: 57, endLine: 57 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 57 },
        ],
        "src/shop/models.pyi": [
            { kind: "class", name: "Product", startLine: 3, endLine: 8 },
            { kind: "function", name: "register", startLine: 10, endLine: 10 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 10 },
        ],
        "src/shop/plugins/__init__.py": [{ kind: "file-summary", name: "(file)", startLine: 1, endLine: 1 }],   // empty
        "tests/runtests.py": [{ kind: "file-summary", name: "(file)", startLine: 1, endLine: 8 }],              // no declaration
        "toolkit/broken.py": [
            { kind: "function", name: "first", startLine: 6, endLine: 7 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 10 },
        ],
        "toolkit/text.py": [
            { kind: "class", name: "_Cache", startLine: 8, endLine: 13 },
            { kind: "function", name: "shout", startLine: 16, endLine: 17 },
            { kind: "function", name: "main", startLine: 20, endLine: 21 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 21 },
        ],
    },
    edits: [
        {
            // the file set changes; toolkit:slugify now finds the submodule toolkit.slugify first
            description: "(a) a new toolkit/slugify.py: test_text.py's `from toolkit import slugify` moves from the package's __init__.py to it",
            writes: { "toolkit/slugify.py": "def slugify(value):\n    return value.replace(\" \", \"-\")\n" },
            edgesAfter: [...without(edge("toolkit/test_text.py", "toolkit/__init__.py")), edge("toolkit/test_text.py", "toolkit/slugify.py")].sort(byEdge),
        },
        {
            // a manifest changes: extras becomes a root, the only one other than src and "" holding promo, so it resolves
            description: "(b) pyproject's where gains extras: src/shop/gui.py's `from promo import DISCOUNT` finds extras/promo.py",
            writes: { "pyproject.toml": PYPROJECT_WHERE_EXTRAS },
            edgesAfter: [...EDGES, edge("src/shop/gui.py", "extras/promo.py")].sort(byEdge),
        },
        {
            // the file set changes. toolkit.text, toolkit.text:shout, toolkit.text:* and .text:shout name nothing now;
            // toolkit:text falls back to the module toolkit, the package's __init__.py (test_text.py has that edge already)
            description: "(c) toolkit/text.py deleted: its edges go, and broken.py's `from toolkit import text` falls back to toolkit/__init__.py",
            writes: { "toolkit/text.py": null },
            edgesAfter: [
                ...without(
                    edge("src/shop/cart.py", "toolkit/text.py"),
                    edge("src/shop/cli.py", "toolkit/text.py"),
                    edge("toolkit/__init__.py", "toolkit/text.py"),
                    edge("toolkit/broken.py", "toolkit/text.py"),
                    edge("toolkit/test_text.py", "toolkit/text.py"),
                    edge("toolkit/text.py", "toolkit/_speedups.pyi"),
                    edge("toolkit/text_test.py", "toolkit/text.py"),
                ),
                edge("toolkit/broken.py", "toolkit/__init__.py"),
            ].sort(byEdge),
        },
        {
            // a file's declares change ([] → ["__main__"]): the edges stay, and it becomes an entry point (the kit compares
            // the update's entry points with a fresh run's)
            description: "(d) scripts/helpers.py gains an `if __name__ == \"__main__\":` block: no edge changes",
            writes: { "scripts/helpers.py": HELPERS_WITH_MAIN },
            edgesAfter: EDGES,
        },
    ],
};
