# LEARNING_NOTES.md — Study Guide & Interview Prep

**Status:** Study artifact, distilled 2026-07-12 from the architect sessions
**Audience:** the project owner. This is the *teaching* that would otherwise be lost when the chat ends — the explanations that made things click, the debugging stories, and the interview answers. The design docs say what to build; this says what you should *understand*.

---

## 1. The pipeline in one breath

Five stages, one-directional, each a plain function call into the next:

```
read files (fs) → extract imports (regex) → resolve to real files → nodes+edges+layout → React Flow paints
```

The sentence to be able to say cold: **"A server component scans the filesystem and computes the graph; only the finished JSON crosses to the browser; a client component renders it."**

### The server/client boundary (the #1 interview concept here)

- A file **without** `"use client"` is a Server Component: runs only on the server, may use `fs`, never ships as browser JS.
- A file **with** `"use client"` runs in the browser: may hold state and handle clicks, may never touch `fs` or secrets.
- Data crosses the boundary as **props, serialized to JSON** — so only plain data crosses; functions and class instances cannot.
- Corollary: `import type { X }` from a client file into core is fine — type-only imports are erased at compile time.

## 2. Regex, properly understood

The scanner's pattern: `/import\s+.*?from\s+['"](.+?)['"]/g`

- **Greedy vs lazy:** `.+` grabs as much as possible; `.+?` grabs as little as possible. On a line with two imports, a greedy group would swallow from the first quote to the *last* quote in the line, merging both statements into garbage. Lazy stops at the nearest quote that lets the rest of the pattern succeed. Mnemonic: greedy grabs the whole rope; lazy takes the smallest bite that still finishes the sentence.
- **`/g` is stateful:** the regex object carries a `lastIndex` cursor. `exec()` resumes from it each call and returns `null` at the end (which resets it). Forget the `/g` and the `while (exec())` loop never advances — infinite loop. Share one regex object across async code and the cursor gets corrupted.
- **`.` does not match `\n`:** which is exactly why multi-line imports are invisible to the scanner (bug W1 in the review). One character class (`[\s\S]`) fixes it; the honest fix is an AST.
- The categorical answer: regex *pattern-matches text*; a parser *understands structure*. Regex has both false negatives (multi-line, re-exports, dynamic imports) and false positives (imports inside comments/strings). An AST has neither.

## 3. `resolveSegments` — the stack machine (the `..` breakdown)

The function resolves `"../app/page"` starting from a folder. The mental model that finally makes it click:

- There are **two separate things**: the **list** (the trail of folders you're standing in — starts as the importer's folder) and the **queue** (the path pieces, processed left to right, one at a time).
- Each queue item does exactly one thing to the list on its way out: a **name pushes** (walk into a room), **`..` pops** (walk back out of the room you're in), **`.` does nothing**.
- The timing trap: for `("lib", "../app/page")`, when `..` runs, `app` and `page` **aren't in the list yet** — they're still waiting in the queue. So `..` pops the only thing there is: `lib`. The path is a sequence of moves played over time, not a list you edit all at once.
- Trace: `["lib"]` → `..` pops → `[]` → push `app` → `["app"]` → push `page` → `["app","page"]` → join → `"app/page"`.

This add/remove-at-the-end-only structure is a **stack**; you've implemented path resolution as a tiny stack machine — the same way an OS resolves `../`.

### Where the two arguments come from

- `relative` (`"../app/page"`) — the literal string a developer typed between quotes; the scanner copied it out. It's called the *specifier*.
- `baseDir` (`"lib"`) — computed: take the importing file's id, split on `/`, drop the last piece (the filename), rejoin. "Where am I standing" = the importer's folder, because `../` is relative to *that*.

## 4. `radialPosition` — concentric tables

Seat guests at round tables: table 1 seats 6, table 2 seats 12, table 3 seats 18 — capacity grows with ring number because circumference does, keeping density constant. The `while` loop doesn't precompute a seating chart; it walks table by table, subtracting capacities from a running counter until your index falls inside one. Then `slot/capacity × 2π` spreads seats evenly, odd rings get a half-seat rotation so spokes don't align (brick coursing), and `(cos·r, sin·r)` converts angle+distance to x,y — the one trig fact needed: any point on a circle is `(cos θ · r, sin θ · r)`.

Complexity: O(√n) per node (ring count grows like √index — triangular numbers). Its honest flaw: position encodes *scan order*, which is meaningless — the edge-aware replacement is designed in `VISUALIZATION_DESIGN.md`.

## 5. Recursion — `walk()`

A function that solves a smaller copy of its own problem by calling itself. `walk(folder)` loops a directory; for each subdirectory it calls `walk(subdir)`. The base case is implicit: a folder with no subfolders simply doesn't recurse, and no filesystem is infinitely deep. Whiteboard skill: draw the call stack for a 3-level folder tree by hand.

## 6. Closures — and a real example of un-closuring one

`toRelativeId` is still a function defined *inside* `toFlowGraph` so it can "remember" `root` without being passed it on every call. A function that captures variables from its surrounding scope is a **closure** — that's the whole concept.

`resolveImport` **used to** be exactly this kind of closure too (capturing `fileIds`), until the 2026-07-13 refactor pulled it out to a standalone top-level function with explicit parameters, specifically so it could be unit-tested outside of `toFlowGraph`. That's the real trade-off closures have: convenient (no parameter plumbing), but untestable in isolation — you can't call a closure without also invoking whatever created it. Explicit parameters cost a bit of plumbing but buy independent testability. `resolveImport` picked testability; `toRelativeId` hasn't needed to yet, since nothing currently needs to unit-test it on its own.

## 7. React Flow lessons (paid for in real bugs)

- **`nodeTypes` must be module-scope.** Defined inline in JSX it's a new object identity every render → React Flow remounts every node each frame (error #002).
- **Custom nodes need `<Handle>`s** — drop them and every edge silently disappears.
- **`memo` your node component** — React Flow re-renders nodes on every pan/zoom frame.
- **`defaultNodes` vs `nodes`:** uncontrolled vs controlled. Uncontrolled ignores prop updates after mount — fine for a one-shot server render, a landmine once the client refetches or the agent mutates highlight state (hence Phase 1 moves to controlled).
- **`<Background>` paints an opaque layer in dark mode** (`#141414`) that will hide anything you layered underneath — `bgColor="transparent"` was the fix that "made the stars appear."
- **`animated: true` per edge = perpetual CSS repaint.** Motion should be a *signal* (the edge being discussed), not a default.

## 8. Two debugging stories worth retelling in interviews

**The invisible starfield.** Stars were painted (verified by reading the canvas's own pixels — ~8k lit pixels) yet invisible on screen. Guessing "make it brighter" failed. The systematic move: walk the composited layer stack with `elementFromPoint` checking each ancestor's computed `backgroundColor` — found React Flow's Background SVG painting opaque `#141414` over everything. **Lesson: when something renders but isn't visible, verify each layer with evidence instead of iterating on the thing you already control.**

**The "small" favicon.** The icon looked tiny next to other tabs at identical pixel size. Cause: a dark circle on a transparent margin over a dark tab bar — most of the tile read as empty. Fix: full-bleed background, fewer/bolder details sized to survive downscaling (a 0.5px hairline is invisible at 16px). Verified by rendering the real SVG onto actual 16/32/48px canvases rather than eyeballing the large version. **Lesson: contrast and full-bleed beat detail; test at the size that ships.**

## 9. Interview defense card (the three predictable attacks)

1. **"Your regex scanner is wrong."** — "Correct: documented false negatives (multi-line, re-exports, dynamic imports) and false positives (comments). It's a v0 heuristic chosen for zero dependencies; extraction is isolated behind one function so the AST swap (TypeScript Compiler API, already scheduled) is a single-module change verified by the same golden-vector tests."
2. **"Your layout ignores the edges."** — "Deliberately: radial gave overlap-free determinism with zero deps to unblock the pipeline end-to-end. The swap surface is one pure function; dagre-in-a-worker with cached positions is fully designed (ADR-011), gated on an actual trigger (~300 files) instead of speculation."
3. **"You rescan synchronously on every request."** — "Acceptable at single-user local scale; the real cost is blocking Node's event loop. The fix is scheduled where it belongs: async I/O plus content-hash incremental caching that Phase 2's index infrastructure provides anyway — building an interim cache would mean two invalidation systems."

Big-O answers on tap: regex scan O(file size); `radialPosition` O(√n)/node; resolution O(1) amortized via the `Set` (constant 7-candidate probe); brute-force retrieval O(n·384) ≈ 1 ms per 1k chunks.

And the meta-answer that outranks all three: **the risky pieces (extraction, layout, storage, embeddings) each sit behind a narrow swappable interface, with the limitation, the trigger, and the replacement written down before anyone asked.**

## 10. RAG & agent concepts — pointers, not repeats

Already taught in the design docs (read those, they were written to teach): embeddings and cosine-as-dot-product (`RAG_PIPELINE.md` §4–5), why chunk boundaries follow syntax (§2), the ReAct loop and why LangGraph makes it an explicit state machine (`LANGGRAPH_DESIGN.md` §1), UI-actions-as-tools (ADR-008), SSE vs WebSockets (ADR-002).

## 11. Self-test (if you can answer these cold, you own the codebase)

1. As of 2026-07-13, `resolveImport("app/page.tsx", "./components/GraphCanvas")` returns `"app/components/GraphCanvas"` — no `.tsx`. Where did the extension get added before, and which function does that job now?
2. What two bugs does the `seen` Set in the edge loop prevent, and what breaks visibly without it?
3. Why can't `TerminalPanel` call `scanProject()` directly?
4. A greedy version of the import regex meets `import a from "./a"; import b from "./b";` — what exactly goes wrong?
5. Trace `resolveSegments("app/components", "../../lib/graph")` — list and queue at every step.
6. Why is index 7 the first node of ring 2, and where does its `(480, 0)` come from?
7. Your graph shows no edges at all after a refactor that moved files into `src/`. Name the two most likely culprits. *(Hint: alias mapping; extension candidates.)*
8. Why do we embed an enriched text instead of the raw chunk source?
