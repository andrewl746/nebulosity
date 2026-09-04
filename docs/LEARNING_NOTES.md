# LEARNING_NOTES.md — Study Guide & Interview Prep

**Status:** Study artifact, distilled 2026-07-12 from the architect sessions; §2/§6/old-§11 updated 2026-07-26 for F5/F6 (ADR-016); §11 added 2026-07-29 for Phase D (`saveScan`); §§12–16 added 2026-09-04 for Phases 2–4 (typed arrays, tensors, comments-as-index, hash ordering, cascades), self-test renumbered to §17
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

**F5 (2026-07-26) replaced the single scanner regex with a small pattern set over comment-stripped source.** The original was `/import\s+.*?from\s+['"](.+?)['"]/g`; it's now three patterns — static+re-export, side-effect (`import "./x"`), dynamic+`require` — run over source that's had its comments removed first. The lessons below outlive that change; they're *why* the new patterns look the way they do.

- **Greedy vs lazy:** `.+`/`[\s\S]*` grab as much as possible; `.+?`/`[\s\S]*?` grab as little as possible. On a line with two imports, a greedy group swallows from the first quote to the *last* quote, merging both statements into garbage. Lazy stops at the nearest quote that lets the rest of the pattern succeed. Mnemonic: greedy grabs the whole rope; lazy takes the smallest bite that still finishes the sentence.
- **`/g` is stateful:** the regex object carries a `lastIndex` cursor. `exec()` resumes from it each call and returns `null` at the end (which resets it). Forget the `/g` and the `while (exec())` loop never advances — infinite loop. Share one regex object across async code and the cursor gets corrupted. (This is why each F5 pattern's `exec` loop runs fully to `null` before the next pattern starts.)
- **`.` does not match `\n`:** this is why the *old* single-line regex missed multi-line imports (bug W1). The F5 static pattern uses `[\s\S]*?` — "any char *including* newlines, lazily" — precisely to span the lines between `import` and `from`. **W1 is now fixed.**
- **Comment-stripping (F5):** comments (`//` and `/* */`) are deleted from the source *before* matching, which killed the comment false-positive class — a commented-out import no longer counts (this overrode a golden vector; see ADR-016).
- **The categorical answer (still the headline):** regex *pattern-matches text*; a parser *understands structure*. Even after F5, **one** false-positive class survives — an import mentioned inside a **string literal** (`const s = "import x from './fake'"`), because a string's contents are byte-identical to real code to a text matcher. Only an AST (ADR-003, Phase 2) can tell code from code-shaped text. That surviving residual is the concrete, point-at-able argument for building the AST.

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

`resolveImport` **used to** be exactly this kind of closure too (capturing `fileIds`), until the 2026-07-13 refactor pulled it out to a standalone top-level function with explicit parameters, specifically so it could be unit-tested outside of `toFlowGraph`. That's the real trade-off closures have: convenient (no parameter plumbing), but untestable in isolation — you can't call a closure without also invoking whatever created it. Explicit parameters cost a bit of plumbing but buy independent testability. `resolveImport` picked testability; `toRelativeId` hasn't needed to yet, since nothing currently needs to unit-test it on its own. **F6 (2026-07-26) doubled down on this:** `resolveImport` gained a third explicit param, an injected `aliases` map read from `tsconfig` *server-side* rather than read inside the function — same principle (dependency injection), and it's *why* the function can be unit-tested by handing it a fake alias map with no filesystem at all.

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

## 11. Transactions, upsert, delete-then-insert (`lib/db/graph-store.ts`, Phase D)

- **Transaction** — group several writes into one all-or-nothing unit. If any write inside throws, the database rolls back *everything* done so far in that transaction, leaving prior data untouched. Motivating failure case: without one, a crash between "delete old files" and "insert new files" would leave the graph with **zero files** — worse than not scanning at all. `saveScan` wraps its whole write sequence (upsert repo → delete files → insert files → insert edges) in one `db.transaction((tx) => {...})`. Interview framing: this is the "atomicity" part of ACID, made concrete with a real failure mode instead of the textbook definition.
- **Upsert** — insert a row, or update it instead if a unique column would otherwise conflict. `saveScan` needs this *only* for the `repositories` row: the first scan of a repo inserts it; every scan after that would collide with the already-unique `rootPath`, so `.onConflictDoUpdate({ target: repositories.rootPath, set: { lastScanAt: ... } })` handles both cases in one call. Only the columns in `set` change (here, `lastScanAt`) — the unique column and the id are never touched, which is *why* a repo keeps a stable id across every rescan.
- **Delete-then-insert (over diffing)** — instead of computing exactly which files/edges changed, delete everything the repo currently owns and reinsert the fresh scan. `DELETE FROM files WHERE repo_id = X` (scoped to *one* repo — never the whole table, which is what makes multi-repo safe: other repos' rows are untouched by the `WHERE`). Because `imports` rows reference `files.id` with `onDelete: cascade`, deleting a repo's files auto-deletes any edges pointing at them — no separate edge cleanup. Consequence worth knowing cold: file ids **change on every rescan** (old rows are deleted, not updated), so any path→id mapping has to be rebuilt fresh each save, never cached across scans. Deliberately simple over diffing — correct at v1 scale, revisit only if scans get slow on huge repos.

## 12. Typed arrays are views, not buffers (Phases 3–4)

A `Float32Array` is three things: a backing `ArrayBuffer`, a **byteOffset** into it, and a **length**. Almost every bug in the vector storage path came from forgetting one of the three.

- `vector.buffer` is the *whole* backing buffer, not your slice of it. `Buffer.from(vector.buffer)` on a view over a 16×384 batch tensor serializes all 6144 floats, so every vector in the batch stores identically. You want `Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)`.
- `new Float32Array(buffer, byteOffset, length)` — that third argument counts **elements, not bytes**. Passing `byteLength` asks for 4× too many and throws `RangeError`.
- `.slice()` **copies**; `.subarray()` returns a **view** sharing the buffer. Choosing between them decides whether downstream code has to think about offsets at all.
- Node hands out small `Buffer`s from a shared pool, so `buf.byteOffset` is often *not* 4-byte aligned — and the typed-array constructor rejects unaligned offsets. Aliasing a pooled Buffer gives you a failure that depends on allocation history. Allocating and copying makes it impossible.

**The pattern worth generalizing:** two functions that are exact inverses belong in the same file, next to each other. Split across `index-repo.ts` and `retrieve.ts`, these drifted immediately — and in *opposite* directions, so neither could catch the other.

## 13. A tensor is a flat buffer plus a shape

`pipeline("feature-extraction")(["a","b","c"])` does **not** return three vectors. It returns one `Tensor`:

```
dims: [3, 384]      data: Float32Array(1152)     // row-major, rows end to end
```

Row `r` lives at `data[r*384 … (r+1)*384)`. Nothing in the object separates the rows — `dims` is the only thing that tells you where the boundaries are. Treating `.data` as a single vector is how a whole batch collapses into one 6144-float row (`BUGS_ENCOUNTERED.md` #7).

The transferable lesson is about *how* that bug was written: four defensive `Array.isArray`/`instanceof` branches guessing at a shape nobody had checked. Defensive branching against an unverified contract doesn't add robustness — it converts a loud crash into a quiet wrong answer. Check the shape once, assert it, and delete the branches.

## 14. Once you embed code, your comments are part of the search index

The best find of the Phase 2–4 audit. Retrieval for *"convert scan output to react flow"* returned `ResolvedEdge` — a three-field type alias — while `toFlowGraph`, the function that literally does that, didn't appear in the top 8.

Nothing was wrong with `retrieve.ts`. During the F5/F6 refactor, `toFlowGraph`'s JSDoc had drifted ~50 lines up the file and come to rest above `export type ResolvedEdge`. The chunker attaches a leading comment to the declaration below it, so the type alias inherited a description of a function it has nothing to do with — and outranked it. Moving the comment back put `toFlowGraph` at rank 1 (0.576).

**Why this matters beyond one bug:** in a RAG system over code, a misplaced or stale comment is no longer a readability nit — it is a *retrieval* bug, and an invisible one, because retrieval quality degrades without anything failing. It also explains why chunk boundaries are a design decision rather than an implementation detail: what a chunk includes decides what it can be found by.

Related: the same reasoning drives ADR-018. `getStart()` drops the doc comment (bad for retrieval); `getFullText()` swallows blank lines and detached comments (bad for line numbers). The fix is one span used for `startLine`, `endLine` *and* `text` — attached comments in, detached comments out.

## 15. A hash is a claim, and claim ordering is the whole game

`files.contentHash` means *"the derived data for this file is up to date."* Two separate bugs came from writing that claim before it was true:

1. **Written before the work** (`BUGS_ENCOUNTERED.md`, R7 in the review): the hash was saved, then chunking and embedding ran. Anything that threw in between left a file marked clean with no chunks — and every later run skipped it, *forever*. The failure erased its own evidence.
2. **Written by the wrong component** (`BUGS_ENCOUNTERED.md` #8): `saveScan` stamped the current hash at *scan* time, so the indexer concluded every file was already done before it had ever run.

Two rules fall out, both general:

- **Commit the claim in the same transaction as the thing it claims.** better-sqlite3 transactions are synchronous, so no `await` may appear inside one — which forces the slow async work (embedding) to finish *before* the commit. That constraint is a feature: it keeps network and CPU work out of a held write lock.
- **One writer per field.** A column with two writers and two meanings will eventually be written by the one that means something else.

## 16. Cascades change the blast radius of deletes you already wrote

`saveScan`'s `DELETE FROM files` was correct when Phase D shipped. Phase 2 added `chunks` as a child of `files` with `ON DELETE CASCADE`, and `vectors` as a child of `chunks`. Neither change was wrong on its own; together, a plain page load destroyed the entire search index.

Adding a foreign key with `ON DELETE CASCADE` retroactively changes what every *existing* `DELETE` against the parent table does. Nothing in the old code changes, nothing fails to compile, no test breaks — the semantics move underneath it. When you add a cascade, the review question is "what already deletes from this table, and does it still mean what it meant?"

Interview framing: the strongest version of this story isn't "I fixed a delete." It's *"the bug existed in neither change — it was created by their interaction, weeks apart, and was masked by an unrelated bug that stopped anyone reaching it."*

## 17. Self-test (if you can answer these cold, you own the codebase)

1. `resolveImport("app/page.tsx", "./components/GraphCanvas")` returns `"app/components/GraphCanvas"` — no `.tsx`. Where did the extension get added before, and which function does that job now? And since F6, what third argument does `resolveImport` take, why is it *passed in* instead of read from disk inside the function, and what does it return for `@/lib/graph` if you *don't* pass it?
2. What two bugs does the `seen` Set in the edge loop prevent, and what breaks visibly without it?
3. Why can't `TerminalPanel` call `scanProject()` directly?
4. A greedy version of the import regex meets `import a from "./a"; import b from "./b";` — what exactly goes wrong?
5. Trace `resolveSegments("app/components", "../../lib/graph")` — list and queue at every step.
6. Why is index 7 the first node of ring 2, and where does its `(480, 0)` come from?
7. Your graph shows no edges after a refactor that moved files into `src/` under a new `@app/*` tsconfig alias. Name the two most likely culprits. *(Hint: is the alias being read? are the extension candidates right?)* Since F6, which function reads the alias map, and what happens if that repo's `tsconfig.json` contains comments?
8. Why do we embed an enriched text instead of the raw chunk source?
9. After F5, `extractImports` still reports a phantom `./fake` for `const s = "import x from './fake'"`. Why is comment-stripping powerless here, and what's the only thing that fixes it?
10. F6 reads `tsconfig` in `lib/scan.ts` (server-side) but applies the aliases in `lib/graph.ts`. Why not just read the file directly inside `graph.ts`? *(Answer names a specific architectural constraint.)*
