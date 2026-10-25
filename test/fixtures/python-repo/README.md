# python-repo

A hand-designed Python repo for the Python adapter's conformance run (lib/index/languages/python/conformance.test.ts,
through test/helpers/adapter-conformance.ts). Its ground truth is test/helpers/python-repo-truth.ts, derived by hand
from these files and the E4 plan's Task P rules: change a file here and re-derive the truth by hand.

What it holds: a src-layout package (`src/shop`, found through pyproject's `where`) beside a flat one (`toolkit`), two
top-level packages named `app` under two roots (`services/alpha`, `services/beta/src`), a Django-style `tests/` root, a
namespace package (`src/vendors`), a folder that shadows a standard-library name (`email`), a pytest `pythonpath` root
(`scripts`), a `.pyi` beside its `.py` and one alone, every entry-point kind, a virtual environment (`.venv`, left out, with an editable checkout's `pyproject.toml` that
the resolver ignores),
a broken file and two empty `__init__.py` files.
