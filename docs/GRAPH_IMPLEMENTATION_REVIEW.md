# GRAPH_IMPLEMENTATION_REVIEW.md — Dependency Graph Code Review

2026 07 10 Graph Review #1

**Status:** Review artifact (audit of code as of 2026-07-10)
**Scope:** `lib/scan.ts`, `lib/graph.ts`, `app/components/GraphCanvas.tsx`, `scripts/scan.ts` — the scan → transform → render pipeline
**Method:** line-level review framed as a senior-engineer interview: for each weakness, the evidence, the failure scenario, and what an interviewer would press on
**Companion:** fixes are mapped to `IMPLEMENTATION_ROADMAP.md` phases at the bottom — this review adds work items; it does not change the architecture.

---

# PART 1 — WEAKNESSES

Ordered by severity, not by file.

## W1 — The scanner is blind to multi-line imports (correctness bug, latent today)

**Evidence:** `lib/scan.ts:8` — `/import\s+.*?from\s+['"](.+?)['"]/g`. The `.` metacharacter does not match `\n`, and there is no `s` flag, so `.*?` cannot cross a line break.

**Failure scenario:** any import formatted like

```ts
import {
  ReactFlow,
  Background,
} from "@xyflow/react";
```

is invisible to the scanner. Prettier and ESLint produce exactly this format automatically once an import list gets long. Today the only multi-line import in the repo happens to be a bare package specifier (no edge lost), so **the graph looks correct by luck**. The first time a local import grows past the line-width limit, its edge silently disappears — the worst kind of bug in a tool whose entire promise is an *accurate* mental model.

**Interviewer angle:** "Your visualization tool's correctness depends on the code formatter's line-width setting. How would you even detect this regression?" (Answer: you couldn't, without tests — see W3.)

## W2 — Three more import forms the regex misses, plus false positives

**Evidence:** same regex, `lib/scan.ts:8`.

Missed entirely:
- **Side-effect imports** — `import "./globals.css"` (no `from` clause; `app/layout.tsx:3` contains one today)
- **Re-exports** — `export { x } from "./y"` (common in barrel/index files, which are precisely the "hub" files the tool should surface)
- **Dynamic imports and CommonJS** — `import("./x")`, `require("./x")`

False positives: the regex matches inside comments, strings, and template literals. Concrete future landmine: Phase 5's `lib/agent/prompts.ts` will likely contain example import statements *as text* — each would become a phantom edge.

**Interviewer angle:** "What's your false-negative *and* false-positive story?" Regex text-matching has both; an AST has neither. (ADR-003 already schedules AST unification — but the current state should be a documented, tested approximation, not an unquantified one.)

## W3 — Zero tests on the purest, most testable code in the project (highest-leverage gap)

**Evidence:** no test runner, no test files anywhere in the repo. Yet `resolveImport`, `resolveSegments`, `radialPosition` (`lib/graph.ts:37-122`) and `extractImports` (`lib/scan.ts:10-17`) are all pure functions — deterministic input → output, no I/O, no mocks needed. This is the cheapest possible testing surface, and it's the same code where W1/W2/W5 bugs live.

**Failure scenario:** every fix in this document risks a silent regression, because nothing pins current behavior. W1 literally cannot be caught today except by a human staring at the graph.

**Interviewer angle:** "You built path resolution and a layout algorithm by hand. How do you know they're right?" — the single most predictable senior interview question about this codebase, and currently unanswerable.

## W4 — One unreadable file crashes the entire page

**Evidence:** `lib/scan.ts:29-47` — `walk()` calls `fs.readdirSync`/`fs.readFileSync` with no try/catch anywhere; `scanProject()` is invoked during server-side render (`app/page.tsx:11`).

**Failure scenario:** a single `EACCES`/`EBUSY` file (locked by another process — routine on Windows), or a directory deleted mid-scan, throws → the whole route 500s. The graph for 199 readable files is discarded because file 200 hiccupped. Robust tools degrade; this one detonates.

## W5 — Edge direction is invisible, and every edge animates forever

**Evidence:** `lib/graph.ts:152-158` — edges carry `animated: true` and no `markerEnd`. React Flow draws no arrowhead by default.

Two distinct problems:
1. **Semantics:** users cannot tell whether `page.tsx → graph.ts` means "imports" or "is imported by". For an onboarding tool, dependency *direction* is half the information in the graph.
2. **Performance:** `animated: true` is a per-edge CSS dash animation, continuously repainting. Trivial at 8 edges; a measurable frame-time tax at 500+ — and it runs even when nothing is happening. Constant motion also contradicts the "quiet, professional" UX principle in CLAUDE.md.

## W6 — Layout positions are unstable across scans

**Evidence:** `lib/graph.ts:124-137` — position is a function of *array index*; array order comes from directory traversal order (`lib/scan.ts:30`).

**Failure scenario:** the user spends an hour building spatial memory ("scan.ts lives on the right"). They add one new file early in the traversal order → every subsequent index shifts → most of the graph reshuffles on reload. Spatial memory is the entire point of a map; this map redraws its coastline when you add a street. (Full fix is edge-aware layout — already backlogged; but *determinism* — same repo state, same picture, regardless of OS traversal quirks — is cheap and missing: files aren't even sorted before layout.)

## W7 — Presentation leaks into the core layer

**Evidence:** `lib/graph.ts:157` — `style: { stroke: "rgba(168, 85, 247, 0.45)", strokeWidth: 1 }` hardcoded in the transform; also `animated: true` (a rendering concern).

This violates the project's own dependency rule (`ARCHITECTURE.md` §3: core must be UI-agnostic) and the precedent already set when node styling was extracted into `FileNode.tsx`. A future CLI or desktop frontend reusing `toFlowGraph` inherits a web color string. Belongs in `GraphCanvas` via `defaultEdgeOptions`.

## W8 — Path-resolution edge cases that produce silent wrongness

All in `lib/graph.ts`:
- **`resolveSegments` under-pops past root** (`:37-45`): `..` on an empty stack is a silent no-op (`[].pop()`), so `../../../x` from the repo root resolves to a nonsense id and the edge silently drops. Should clamp and warn.
- **`@/` alias is hardcoded** (`:109-111`): the real mapping lives in `tsconfig.json` `paths`; if that config changes, every aliased edge silently vanishes. At minimum the constant should be centralized and documented; reading tsconfig is the real fix.
- **NodeNext-style `./x.js` → `x.ts` is unresolvable** (`:13-21`): `EXTENSION_CANDIDATES` never strips a `.js` suffix to try `.ts`, so ESM-style TS projects lose all their edges. Also missing: `.mjs`, `.mts`, `.cts` in both the candidates and the scanner's `SOURCE_EXTENSIONS`.
- **No duplicate-node guard** (`lib/scan.ts:23-26` + `lib/graph.ts:124`): `scanProject(root, ["app", "app/components"])` — overlapping dirs — yields duplicate ids → duplicate React keys → undefined render behavior. One `Set` check fixes it.

## W9 — Known, already-documented debts (listed for completeness, not re-scoped here)

- **Synchronous full rescan on every request**, no caching — documented as the "Gotcha #3" defense; caching design belongs to Phase 2's hash infrastructure (`DATABASE_DESIGN.md` §2), so building an interim cache now would be duplicate work.
- ~~`server-only` import inside core~~ **Resolved 2026-07-13** — removed outright during F1 setup once it provably broke Vitest imports; see `ENGINEERING_DECISIONS.md`'s inherited-debt note.
- **`ScannedFile` type duplicated** in `scripts/scan.ts` vs `lib/graph.ts` — drift risk; trivial dedupe.
- **`radialPosition` re-walks rings per node** — O(n√n) aggregate where O(n) is possible; micro-optimization, valuable only as an interview talking point.
- **Symlinked directories are silently skipped** (`Dirent.isDirectory()` is false for symlinks) — acceptable, but should be a documented behavior, not an accident.

---

# PART 2 — PRIORITIZED FIXES (impact × cost)

## The matrix

```
                        LOW COST                      HIGH COST
              ┌──────────────────────────────┬─────────────────────────────┐
 HIGH IMPACT  │  P0 — do immediately          │  P1 — schedule deliberately │
              │  F1 test harness (W3)         │  F5 hardened extractor (W1, │
              │  F2 per-file error handling   │     W2) — regex pattern set │
              │     (W4)                      │     now; AST lands Phase 2  │
              │  F3 arrowheads + kill         │     per ADR-003             │
              │     animation (W5)            │  F6 tsconfig-driven alias + │
              │  F4 deterministic ordering +  │     NodeNext resolution(W8) │
              │     dup guard (W6, W8)        │                             │
              ├──────────────────────────────┼─────────────────────────────┤
 LOW IMPACT   │  P2 — batch as polish         │  P3 — defer / backlog       │
              │  F7 edge style → UI (W7)      │  edge-aware layout (W6full) │
              │  F8 resolveSegments clamp,    │  full scan caching (W9 →    │
              │     ext sets, type dedupe     │     Phase 2 infra)          │
              │     (W8, W9)                  │  PageRank, O(n) rings (W9)  │
              └──────────────────────────────┴─────────────────────────────┘
```

## P0 — Quick wins (≈ one evening total, do before or at the start of Phase 1)

**F1. Stand up Vitest and pin current behavior (W3) (DONE).** `npm i -D vitest`; test `resolveImport` (relative/alias/bare/`..` cases — see 2026-07-13 note in PART 3 §3.3, its contract changed during F1 itself), `resolveSegments`, `radialPosition` (ring boundaries: indices 0, 1, 6, 7, 18, 19), `extractImports` (single-line, multi-line **as a currently-failing/documenting test**, side-effect, comment false-positive). Extension-candidate priority (which extension wins when several could match) is no longer part of `resolveImport` — cover it via the `toFlowGraph` integration vector (§3.6) instead. ~15 tests. Every subsequent fix in this list then ships with proof. **Expected values are precomputed in PART 3 below — transcribe those rows; do not derive expectations by running the code** (that would enshrine the very bugs W1/W2/W8 describe).
**F2. Per-file error tolerance in `walk()` (W4) (DONE).** Wrap the read of each file/dir in try/catch; collect `{ path, error }` warnings into the scan result (extend `ScannedFile[]` return to `{ files, warnings }`); surface warning count through `GraphResponse.stats`. One file failing must never cost more than that file.
**F3. Directional arrowheads; stop animating idle edges (W5) (DONE).** `markerEnd: { type: MarkerType.ArrowClosed }` via `defaultEdgeOptions` in `GraphCanvas`; drop `animated: true` from the transform. Re-purpose animation as a *state signal*: Phase 6 can animate exactly the edges the agent is currently discussing — motion regains meaning.
**F4. Determinism + duplicate guard (W6-partial, W8) (DONE).** Sort scanned files by path before returning; skip already-seen ids in `walk`. Same repo state now always renders the same picture on every OS.

## P1 — High impact, planned cost

**F5. Hardened import extractor (W1, W2) — interim, tested, honest. (DONE 2026-07-26, ADR-016.)** Replaced the single regex with a small pattern set over comment-stripped source: static (`[\s\S]*?` bounded form), side-effect, re-export, dynamic/`require`. Comment-stripping also removed the comment false-positive class (§3.4 row 209 flipped to `[]`). Documented residual risk narrowed to *string-literal* false positives, which remain until the AST unification ADR-003 schedules for post-Phase-2. The F1 test suite is what made this refactor safe and the later AST swap verifiable — same tests, two implementations.
**F6. Honest module resolution (W8). (DONE 2026-07-26, ADR-016.)** Reads `compilerOptions.paths` from tsconfig at scan time (`readTsconfigAliases`, server-side) and injects the alias map into the pure `resolveImport`/`toFlowGraph` instead of hardcoding `@/` — `graph.ts` stays filesystem-free. Extended candidates with `.mjs/.mts/.cts` and added the NodeNext `./x.js → x.ts` rewrite. Killed the "silently vanishing edges" class (verified live: `app → lib` `@/`-imports now produce edges).

## P2 — Cheap polish (batch into any nearby PR)

**F7.** Move edge styling to `GraphCanvas` `defaultEdgeOptions` (W7) — restores core purity per `ARCHITECTURE.md` §3.
**F8.** Clamp `resolveSegments` at root with a warning; dedupe `ScannedFile` (scripts imports from lib); document symlink behavior in a comment.

## P3 — Deliberately deferred

- **Edge-aware layout (dagre/d3-force):** the real W6 fix; now fully designed in `VISUALIZATION_DESIGN.md` / ADR-011. Don't half-build it.
- **Scan caching:** wait for Phase 2's manifest/hash infrastructure — building a second cache now creates two invalidation systems.
- **PageRank (ADR-010), O(n) ring precompute:** revisit triggers unchanged.

## Sequencing note

F1 → F2/F3/F4 → F5 → F6, with F7/F8 batched opportunistically. F1 deliberately comes first: it converts every other item from "change and hope" into "change and verify" — which is also the one-sentence answer if an interviewer asks how a senior engineer approaches inherited code.

---

# PART 3 — GOLDEN TEST VECTORS (appendix for F1, added 2026-07-12)

Every expected value below was **computed by hand from the algorithm's definition**, not by running the code. That direction matters: if a test written from this table fails against `lib/graph.ts` or `lib/scan.ts` on a row *not* marked as a known bug, **the code is wrong, not the table.** Rows marked ⚠ document current buggy/quirky behavior on purpose — write those as tests of *current* behavior with a comment naming the W-item, so they intentionally break (and get updated) when the fix lands.

Constants assumed: `RING_GAP = 240`, `FIRST_RING_CAPACITY = 6`, `EXTENSION_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]`.

## 3.1 `radialPosition(index, total)`

Derivation shown so a human can re-verify: ring/slot from the capacity walk; `angle = (slot/capacity)·2π + (ring odd ? π/capacity : 0)`; `radius = ring·240`; `x = round(cos·r)`, `y = round(sin·r)`.

| call | ring | slot | capacity | angle | expected |
|---|---|---|---|---|---|
| `radialPosition(0, 10)` | — | — | — | — | `{ x: 0, y: 0 }` |
| `radialPosition(1, 10)` | 1 | 0 | min(6, 9)=6 | 30° | `{ x: 208, y: 120 }` |
| `radialPosition(2, 10)` | 1 | 1 | 6 | 90° | `{ x: 0, y: 240 }` |
| `radialPosition(4, 10)` | 1 | 3 | 6 | 210° | `{ x: -208, y: -120 }` |
| `radialPosition(6, 10)` | 1 | 5 | 6 | 330° | `{ x: 208, y: -120 }` |
| `radialPosition(7, 10)` | 2 | 0 | min(12, 3)=3 | 0° (even ring: no offset) | `{ x: 480, y: 0 }` |
| `radialPosition(9, 10)` | 2 | 2 | 3 | 240° | `{ x: -240, y: -416 }` |
| `radialPosition(19, 30)` | 3 | 0 | min(18, 11)=11 | π/11 ≈ 16.36° | `{ x: 691, y: 203 }` |

Boundary intent: index 6 is the **last seat of ring 1**; index 7 is the **first seat of ring 2**; index 19 is the **first seat of ring 3** (ringStart walks 1 → 7 → 19).

**`-0` note, discovered 2026-07-13 while writing F1's tests:** none of the rows above happen to trigger it, but some angles that should land exactly on an axis (e.g. `radialPosition(2, 3)`'s 270°, used in the §3.6 integration vector) leave a tiny floating-point residual in `cos()`/`sin()` — because `Math.PI` only approximates π — and `Math.round()` of a small negative residual produces `-0`, not `0`. This was invisible to hand-computed expected values (which assumed ideal math) and only surfaced when the real function actually ran against a test. `radialPosition` now normalizes with `|| 0` on both axes; see the comment in `lib/graph.ts`. Lesson for future golden vectors: hand-computed trig expectations are a starting point, not a substitute for running the real code once before finalizing a table.

## 3.2 `resolveSegments(baseDir, relative)`

| call | expected | note |
|---|---|---|
| `("app", "./components/GraphCanvas")` | `"app/components/GraphCanvas"` | |
| `("app/components", "../../lib/graph")` | `"lib/graph"` | two pops then two pushes |
| `("lib", "../app/page")` | `"app/page"` | |
| `("app", "../../x")` | `"x"` | ⚠ W8: second `..` pops an empty stack silently — desired behavior is a warning/clamp; result value stays `"x"` |
| `("", "./x")` | `"/x"` | ⚠ quirk: `"".split("/")` is `[""]`, so a root-level importer gains a phantom leading slash and the id will never match. Unreachable today (all scanned files live in `app/` or `lib/`) — becomes reachable if root-level files are ever scanned. Fold the fix into F5/F6 |

## 3.3 `resolveImport(importerId, specifier)`

**Contract changed 2026-07-13, during F1 itself.** The project owner refactored `resolveImport` to stop doing file-existence/extension checking internally — it now only resolves a specifier down to a **base path** (no extension, no guarantee the file exists). The extension-candidate matching loop (`EXTENSION_CANDIDATES`, deciding e.g. that `.ts` wins over `/index.ts` when both could match) moved out to live inline in `toFlowGraph`'s edge-building loop instead, right next to `fileIds`, rather than being passed into `resolveImport` as a third parameter. Both are legitimate designs (see `ARCHITECTURE.md`'s closures-vs-explicit-params discussion) — this is simply the one that shipped. Consequence: `resolveImport` no longer needs a `fileIds` argument at all, and it can no longer tell you whether a resolved path is real. The rows below are updated for this contract; the extension-priority behavior itself is now covered by the `toFlowGraph` integration vector in §3.6.

**Contract changed again 2026-07-26 (F6, ADR-016).** `resolveImport` gained a third parameter `aliases: Record<string, string> = {}` and no longer hardcodes `@/`. It applies whatever prefix→replacement map is injected (read from `tsconfig.compilerOptions.paths` server-side by `readTsconfigAliases`), keeping `graph.ts` filesystem-free. With the default empty map, an aliased specifier like `@/lib/graph` returns `null` — callers must pass the map (as `toFlowGraph(files, rootDir, aliases)` does).

| call | expected | note |
|---|---|---|
| `("app/page.tsx", "./components/GraphCanvas")` | `"app/components/GraphCanvas"` | no extension appended — that's `toFlowGraph`'s job now |
| `("app/components/GraphCanvas.tsx", "@/lib/graph", { "@/": "" })` | `"lib/graph"` | **F6 (2026-07-26):** alias resolved via the injected `aliases` map (3rd arg), not a hardcoded `@/`. With no `aliases` arg this now returns `null` (see the §3.3 contract note) |
| `("lib/graph.ts", "../app/page")` | `"app/page"` | relative up-and-over |
| `("lib/graph.ts", "./utils")` | `"lib/utils"` | no `/index.ts` fallback anymore — that's also `toFlowGraph`'s job |
| `("app/page.tsx", "react")` | `null` | bare specifier = npm package — still the only case that returns `null` |
| `("app/page.tsx", "./missing")` | `"app/missing"` | ⚠ **changed from `null`** — `resolveImport` can no longer detect a nonexistent file; it returns a base path unconditionally for any relative/alias specifier. Whether that path corresponds to a real file is now determined later, in `toFlowGraph`'s `fileIds.has(base + ext)` check |

## 3.4 `extractImports(fileContent)`

| input | expected | note |
|---|---|---|
| `import x from "./a";` | `["./a"]` | |
| `import a from "./a"; import b from "./b";` | `["./a", "./b"]` | lazy-quantifier test: greedy would merge into one garbage match |
| `import {\n  A,\n  B,\n} from "./multi";` | `["./multi"]` | ✅ **F5 (landed 2026-07-26)** — multi-line caught via the `[\s\S]*?` bounded form |
| `import "./globals.css";` | `["./globals.css"]` | ✅ **F5** — side-effect import pattern |
| `export { x } from "./y";` | `["./y"]` | ✅ **F5** — re-export pattern |
| `const m = await import("./dyn");` | `["./dyn"]` | ✅ **F5** — dynamic import / `require` pattern |
| `// import ghost from "./ghost"` | `[]` | ✅ **F5 strips comments (ADR-016)** — this **overrides** the prior "F5 does not fix this row" note: the comment is removed before matching |
| `const s = "import x from './fake'";` | `["./fake"]` | ⚠ **residual** — string-literal false positive: import-looking text inside a string. F5 does *not* fix this; only the AST (ADR-003) can. This is the honest replacement for the old comment-false-positive row |

## 3.5 `classifyFile(id)`

`"a.tsx"` → `"component"` · `"a.jsx"` → `"component"` · `"a.ts"` → `"module"` · `"a.js"` → `"module"`

## 3.6 `toFlowGraph(files)` — integration vector

Input:

```json
[
  { "id": "app/page.tsx", "imports": ["./components/GraphCanvas", "react"] },
  { "id": "app/components/GraphCanvas.tsx", "imports": ["@/lib/graph"] },
  { "id": "lib/graph.ts", "imports": [] }
]
```

Expected nodes (order preserved; capacity of ring 1 is `min(6, 3−1) = 2` here, so angles are 90°/270°):

| id | position | data |
|---|---|---|
| `app/page.tsx` | `{ x: 0, y: 0 }` | `{ fileName: "page.tsx", dir: "app", kind: "component" }` |
| `app/components/GraphCanvas.tsx` | `{ x: 0, y: 240 }` | `{ fileName: "GraphCanvas.tsx", dir: "app/components", kind: "component" }` |
| `lib/graph.ts` | `{ x: 0, y: -240 }` | `{ fileName: "graph.ts", dir: "lib", kind: "module" }` |

Expected edges — exactly two (the `"react"` import produces none):
`app/page.tsx->app/components/GraphCanvas.tsx` and `app/components/GraphCanvas.tsx->lib/graph.ts`, each with matching `source`/`target`.

Dedupe vector: a file with `imports: ["./a", "./a"]` (where `a.ts` exists) yields **one** edge. Self-import vector: `{ id: "lib/a.ts", imports: ["./a"] }` yields **zero** edges.

**Extension-priority vector** (moved here 2026-07-13 from §3.3, since extension matching now lives inline in `toFlowGraph`, not in `resolveImport`): given scanned files `lib/b.ts` (`imports: ["./a"]`), `lib/a.ts`, and `lib/a/index.ts` (both present), the resulting edge must target `lib/a.ts` — the loop's `for (const ext of EXTENSION_CANDIDATES)` tries `.ts` before `/index.ts`, so the first one wins. If this ever regresses to matching `lib/a/index.ts` instead, `EXTENSION_CANDIDATES`'s order was changed or the loop stopped breaking on first match.
