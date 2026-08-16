# BUGS_ENCOUNTERED.md — Debugging Log

A running log of real bugs hit while building Nebulosity: what broke, how it
was found, the root cause, the fix, and the reusable lesson.

**Purpose:** this is interview ammunition. "Tell me about a hard bug you
debugged" is one of the most common questions, and a specific, well-told bug
story beats any amount of memorization. Keep entries short and honest — one
paragraph each, root-cause-first.

**Format per entry:** Where · When/how caught · Symptom · Root cause · Fix ·
Takeaway (the transferable lesson).

---

## 1. `radialPosition` returned `-0` on axis-aligned angles

- **Where:** `lib/graph.ts` → `radialPosition()`
- **Caught:** while writing the F1 Vitest harness (2026-07-13) — a test asserting a node's position failed.
- **Symptom:** an assertion expecting `{ x: 0 }` received `{ x: -0 }`, even though the two are visually identical on the canvas. `toEqual` flagged them as different.
- **Root cause:** `Math.PI` only approximates π, so an angle that should land exactly on an axis (e.g. `3π/2`) leaves a tiny floating-point residual. `Math.cos()`/`Math.sin()` return a value extremely close to but not exactly `0`, and `Math.round()` of a small *negative* residual produces `-0`. Meaningless for a pixel position, but `Object.is` / deep-equality distinguish `-0` from `0`, so the test broke.
- **Fix:** `|| 0` on each coordinate — `-0` is falsy, so it normalizes to `0`.
- **Takeaway:** IEEE-754 has a signed zero. `-0 === 0` is `true`, but `Object.is(-0, 0)` and most deep-equal helpers say they differ. And "this should be exactly 0" usually isn't, once floating point is involved. Normalize at the boundary where exact equality matters.

## 2. `fileIds` lookup set rebuilt on every iteration instead of once

- **Where:** `lib/graph.ts` → `toFlowGraph()` (edge-resolution loop)
- **Caught:** while writing the F1 tests (2026-07-13) — noticed by reading through the function closely enough to write assertions for it.
- **Symptom:** no wrong output — the graph was correct — but the `Set` of all file ids (used to check whether an import resolves to a real file) was being constructed *inside* the per-file loop, so it was rebuilt from scratch for every file.
- **Root cause:** loop-invariant work placed inside the loop. The set never changes across iterations, yet it was recomputed each time → wasteful `O(files × files)` construction for what should be a one-time build.
- **Fix:** hoist the `new Set(files.map(...))` above the loops so it's built exactly once (now `lib/graph.ts:124`), then just `.has()` inside the loop.
- **Takeaway:** the whole point of a lookup `Set`/`Map` is to build once and query many times. Watch for loop-invariant computation — a "correct" function can still be quietly quadratic. Tests catch wrong answers; *reading* the code catches wrong performance.

## 3. Silent slash-direction mismatch dropped every edge on Windows (Phase D, Task 6)

- **Where:** `lib/scan.ts` (`scanProject`'s `id` computation) → surfaced in `app/api/graph/route.ts` (`scanFileInputs`) → `lib/db/graph-store.ts` (`saveScan`'s path→id map).
- **Caught:** live-verifying the first full read-through pipeline (scan → resolveEdges → saveScan → loadGraph → response) against the running dev server, 2026-07-30 — `stats.edgeCount` came back `0` despite the repo obviously having real imports between files, and node ids in the response used backslashes (`"app\\api\\graph\\route.ts"`) instead of the project's forward-slash convention.
- **Root cause:** `scanProject`'s `id` came straight from `path.relative(rootDir, fullPath)`, which returns **OS-native separators** — backslashes on Windows, never normalized. This had been harmless for years because every existing consumer (`resolveEdges`, `toFlowGraph`) defensively normalizes on the way in via their own internal `toRelativeId`. `saveScan`'s edge-resolution path was the **first** consumer to use a raw scanned id directly (`scanFileInputs`'s `path: f.id`) without going through that normalization — so file rows got inserted with backslash paths while `resolveEdges`'s already-normalized forward-slash edges could never match a key in the path→id map. Every edge silently tripped the (correct, by-design) "edge to an unscanned path" guard and got dropped — no crash, no warning, just a quietly wrong `edgeCount: 0`.
- **Fix:** normalized at the true source instead of patching the one call site — exported the existing `normalizeSlashes` from `lib/graph.ts` and applied it in `scanProject` itself, right where `id` is computed, so every current and future consumer gets a consistently forward-slash id from the start.
- **Takeaway:** a defensive normalization step at every *consumer* can mask an inconsistency at the *source* for a long time — it only breaks once a new consumer forgets to defend itself the same way. Fix path/format inconsistencies at the one place data is produced, not at every place it's read. Also a good example of a bug with zero error output: nothing crashed, a "silent drop" safety guard just did exactly what it was designed to do, on data that should never have needed dropping in the first place.

## 4. Component defined inside another component → remounts every render

- **Where:** `app/components/GraphView.tsx`
- **Caught:** during review in the Task 5 session (2026-07-25), before it shipped — flagged while splitting `GraphView` to add the `ReactFlowProvider`.
- **Symptom:** first, a compile error (`GraphView` returned `void` — the wrapping JSX wasn't `return`ed). The deeper, invisible problem: `GraphViewInner` had been written *inside* `GraphView`'s body. That would have thrown away `GraphViewInner`'s state (`graph`, `selectedId`) and re-fired the `/api/graph` fetch on *every* render.
- **Root cause:** defining a component inside another component's body creates a **new function identity on every render**. React identifies components by reference, so each render it sees a "different" component type and unmounts the old subtree + mounts a fresh one — wiping all its state.
- **Fix:** move `GraphViewInner` out to module scope as a top-level sibling; `GraphView` just returns `<ReactFlowProvider><GraphViewInner /></ReactFlowProvider>`.
- **Takeaway:** never define a component inside another component. Hoist it to module scope (or pass it as a prop/child). React reconciliation keys on component *identity by reference* — a new function each render is a new component to React. Same reasoning is why inline object/array props can defeat memoization.

## 5. Vitest template literal off-by-one errors

- **Where:** `lib/chunks.test.ts` — class and function declaration tests
- **Caught:** Test assertions for `endLine` kept failing by 1 line
- **Symptom:** The `endLine` value from `extractChunksFromFile()` was consistently 1 more than the test expected for class declarations
- **Root cause:** The test content used template literals with indentation (backtick + enter before the actual class content began). The indentation and newlines in the template literal caused the actual source to have more lines than the test author expected. Specifically, the newline after the opening backtick added an empty line at the start. The function declaration test passed by coincidence because its content had fewer lines of indentation.
- **Fix:** Removed indentation from the test content so the line numbers matched the code.
- **Takeaway:** When writing tests with template literals, the whitespace and indentation are part of the source text. The opening newline after the backtick adds an empty line. Always check the actual line count of the test content, not what it looks like visually. A test that passes by coincidence is a ticking time bomb.

## 6. Default exports parsed as FunctionDeclaration with modifier

- **Where:** `lib/chunks.ts` → `processStatement()`
- **Caught:** Vitest test for default exports failed — chunks with name `"default"` were never created
- **Symptom:** `export default function() { ... }` didn't produce any chunk. The test expected a chunk named `"default"` but got `undefined`.
- **Root cause:** TypeScript parses `export default function() { ... }` as a `FunctionDeclaration` with a `DefaultKeyword` modifier, **not** as an `ExportAssignment` node. The function's parent is the `SourceFile`, not an `ExportAssignment`. The initial logic only checked for `ExportAssignment` parents and missed default exports entirely.
- **Fix:** Added a check for the `DefaultKeyword` modifier on the function declaration itself:
    ```typescript
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const hasDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) || false;
    ```

    Also kept the parent check as a fallback:
    ```typescript
    const parentIsExport = parent && ts.isExportAssignment(parent);

    if (hasDefault || parentIsExport) {
        return processDefaultExportFunction(node, sourceFileAST, filePath, fileHash);
    }
    ```
- **Takeaway:** Default exports are tricky — they can show up as different node types depending on the syntax. `export default function() {}` is a `FunctionDeclaration` with a modifier, while `export default function() {}` inside a variable assignment is a `FunctionExpression`. The AST structure is the only source of truth — always check with `console.log` before assuming how something is parsed.