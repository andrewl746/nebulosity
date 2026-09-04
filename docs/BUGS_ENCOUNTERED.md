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

> **Correction, 2026-09-04 (RAG Review #1).** The diagnosis above is right and the fix above is wrong, which is the most dangerous combination a debugging log can record. `hasDefault` correctly detected the modifier — but it then routed to a handler that still did `node.parent as ts.ExportAssignment` and read *that* node's span. As this very entry states, the parent is the `SourceFile`. So `getStart()` was position 0 and `getEnd()` was EOF: every default-exported function's chunk silently became **the entire file**. Measured on real code, `app/components/StarField.tsx#default` spanned lines 1–84 of an 84-line file.
>
> Two things hid it. The `parentIsExport` fallback looked like it was doing work, but it is dead code — `ExportAssignment` holds an *expression*, so a `Statement` iterated from `sourceFile.statements` can never have one as its parent. And the test passed, because its fixture contained nothing but the function under test, making "the whole file" and "the function" byte-identical.
>
> **Real fix:** when `hasDefault` is true, use `node` itself. **Second takeaway:** a fixture with only one declaration in it cannot detect over-capture. A test asserting a *span* needs neighbours in the file, or it can only prove the span starts in the right place — never that it stops.

## 7. Every batch of embeddings collapsed into a single vector

- **Where:** `lib/embed.ts` → `embedTexts()`
- **Caught:** the first time the model could actually be downloaded (back in Canada, 2026-09-04) — `lib/embed.test.ts`'s "should batch multiple texts" failed with `expected [ …(2) ] to have a length of 20 but got 2`. Written in China, that test had never once been able to run.
- **Symptom:** 20 input texts produced 2 output "vectors" — one per *batch* rather than one per text — each 6144 floats long instead of 384. Downstream, `embedChunks` zipped `chunks[i]` with `vectors[i]`, so every chunk past the batch count got `undefined`.
- **Root cause:** transformers.js returns **one `Tensor` for the whole batch**, not one per input: `dims: [3, 384]` with a flat, row-major `data: Float32Array(1152)`. Nothing in the object separates the rows. The code guessed at the shape with a four-branch `Array.isArray`/`instanceof` ladder; a `Tensor` is not an `Array`, so control fell into the generic object branch, found `tensor.data instanceof Float32Array`, and pushed the entire flat buffer as one vector.
- **Fix:** read `dims`, slice `data` into `dims[0]` rows of `dims[1]`, and assert the shape rather than branching on it. The whole ladder was deleted.
- **Takeaway:** defensive branching against a contract you haven't actually checked isn't robustness — it's a machine for converting a loud crash into a quiet wrong answer. One `console.log(out.dims)` would have settled the shape in seconds. And a tensor is a flat buffer *plus a shape*; the shape isn't decoration, it's the only thing telling you where one row ends and the next begins.

## 8. Loading the graph page deleted the entire search index

- **Where:** `lib/db/graph-store.ts` → `saveScan()`, colliding with `lib/db/schema.ts`'s `chunks` cascade
- **Caught:** re-indexing from a clean database after fixing #7 — the run reported `changed: 0, skippedUnchanged: 27, chunkCount: 0`. Every file was being skipped as unchanged on a database that had never been indexed at all.
- **Symptom:** two symptoms, one cause. (1) `chunks` could never fill — the indexer skipped all 27 files on its very first run. (2) Any index that *did* exist was destroyed by the next `GET /api/graph`.
- **Root cause:** `saveScan` ran `DELETE FROM files` and reinserted every row on every scan, stamping each with the file's *current* content hash. Phase D wrote that, and it was correct in isolation. Phase 2 then added `chunks` as a child of `files` with `ON DELETE CASCADE`, and `vectors` as a child of `chunks`. Neither change was wrong alone. Together: the delete cascaded through chunks into vectors, so a plain page load wiped the index — and because `contentHash` means *"the hash the indexer last processed"*, writing it at **scan** time told the indexer every file was already up to date. One column had two writers with two different meanings.
- **Fix:** `saveScan` upserts on `(repoId, path)`, updates only `kind`, deletes only files that actually vanished, and no longer writes `contentHash` at all — the field was removed from its input type so the scan path cannot supply it by accident. `imports` is now cleared explicitly, since it used to be cleared as a side effect of the cascade. See ADR-022.
- **Takeaway:** the bug was in neither change — it was in their *interaction*, and it surfaced weeks after both had shipped. Adding a `CASCADE` retroactively changes the blast radius of every existing `DELETE` against the parent table. And a field with two writers and two meanings will eventually be written by the one that means something else; single ownership isn't tidiness, it's the invariant. Worth noting too that this stayed invisible only because a *different* bug (#7) meant nobody could get far enough to see it — fixing one bug is often what exposes the next.

## 9. Two inverse conversions, in two files, wrong in two directions

- **Where:** `lib/index-repo.ts` (write side) and `lib/retrieve.ts` (read side)
- **Caught:** by reading, then confirmed in a two-line Node script before either could ever run.
- **Symptom:** on the read side, `new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength)` throws `RangeError: Invalid typed array length: 1536` on the very first row. On the write side, no error at all — just every vector in a batch serializing identically.
- **Root cause:** the `Float32Array(buffer, byteOffset, length)` constructor's third argument counts **elements**, not bytes — 384 was needed where 1536 was passed. In the other direction, `vector.buffer` is the *whole* backing `ArrayBuffer`, not the view's window into it, so a vector that is a view over a batch tensor serializes the entire batch. A latent third problem sat underneath: Node serves small `Buffer`s from a shared pool, so `byteOffset` is frequently not 4-byte aligned, and that constructor rejects unaligned offsets — an *intermittent*, allocation-history-dependent failure, which is far worse than a deterministic one.
- **Fix:** one exported inverse pair, `encodeVector`/`decodeVector`, co-located in `lib/embed.ts`. Decode allocates and copies rather than aliasing, which removes the alignment trap entirely. See ADR-017.
- **Takeaway:** when two functions are meant to be exact inverses, putting them side by side in one file is a correctness measure, not a style preference — separated, these drifted immediately and in opposite directions. Also: a typed array is a *view* (buffer + offset + length), so every API that accepts one has to be asked which of those three it actually wants, and in what unit. Bytes vs elements is worth checking every single time.