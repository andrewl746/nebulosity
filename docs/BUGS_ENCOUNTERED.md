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

## 3. Component defined inside another component → remounts every render

- **Where:** `app/components/GraphView.tsx`
- **Caught:** during review in the Task 5 session (2026-07-25), before it shipped — flagged while splitting `GraphView` to add the `ReactFlowProvider`.
- **Symptom:** first, a compile error (`GraphView` returned `void` — the wrapping JSX wasn't `return`ed). The deeper, invisible problem: `GraphViewInner` had been written *inside* `GraphView`'s body. That would have thrown away `GraphViewInner`'s state (`graph`, `selectedId`) and re-fired the `/api/graph` fetch on *every* render.
- **Root cause:** defining a component inside another component's body creates a **new function identity on every render**. React identifies components by reference, so each render it sees a "different" component type and unmounts the old subtree + mounts a fresh one — wiping all its state.
- **Fix:** move `GraphViewInner` out to module scope as a top-level sibling; `GraphView` just returns `<ReactFlowProvider><GraphViewInner /></ReactFlowProvider>`.
- **Takeaway:** never define a component inside another component. Hoist it to module scope (or pass it as a prop/child). React reconciliation keys on component *identity by reference* — a new function each render is a new component to React. Same reasoning is why inline object/array props can defeat memoization.
