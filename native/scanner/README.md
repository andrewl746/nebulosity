# nebulosity-scanner (native systems layer)

> **Retired 2026-10-11 (ADR-025).** The C++ scanner was never built, and this directory is removed in pivot slice V1.1.

A standalone C++17 executable that walks a repository, extracts import
dependencies with a physical thread pool (one worker per hardware core), and
streams the structural data back to the Node.js host as JSON over stdout.

The app does **not** require this binary. `lib/scanner-bridge.ts` prefers it
when present and silently falls back to the TypeScript scanner otherwise
(ADR-014 in `docs/ENGINEERING_DECISIONS.md`). Both engines produce identical
output by contract — the golden vectors in
`docs/GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 apply to both.

## Building on Windows

One-time setup: install the C++ toolchain (neither is currently installed on
this machine).

1. Install **Visual Studio Build Tools** (free): winget install
   Microsoft.VisualStudio.2022.BuildTools — during setup select the
   "Desktop development with C++" workload (includes MSVC and CMake).
2. Open a **Developer PowerShell for VS** and from `native/scanner/` run:

```powershell
cmake -S . -B build-cmake
cmake --build build-cmake --config Release
```

The binary lands at `native/scanner/build/nebulosity-scanner.exe`, which is
exactly where the bridge looks. Delete it at any time to fall back to the
Node scanner.

## Building on macOS / Linux

```bash
cmake -S . -B build-cmake && cmake --build build-cmake
```

## Verifying

```bash
./build/nebulosity-scanner ../.. app lib
```

should print the same `{"files":[...]}` JSON the Node scanner produces for
this repository. `GET /api/health` reports which engine served the last scan
once Phase D lands.
