# RAG_IMPLEMENTATION_REVIEW.md — Chunking / Embedding / Retrieval Code Review

2026 09 04 RAG Review #1

**Status:** Review artifact (audit of code as of 2026-09-04, commit `ccb0075`) — **ALL FINDINGS RESOLVED 2026-09-04.** See "Resolution" below.
**Scope:** Phases 2–4 as shipped — `lib/chunks.ts`, `lib/index-repo.ts`, `lib/embed.ts`, `lib/retrieve.ts`, `app/api/index/route.ts`, `app/api/search/route.ts`, `lib/db/migrations/`, plus the `lib/chunks.test.ts` / `lib/embed.test.ts` harnesses
**Context:** Phases 2, 3 and 4 were first written without being able to run them, outside this project's usual coached workflow: none of the Phase 2–4 code had ever been run (the embedding model could not be downloaded). The code typechecks and lints; this review is about whether it *works*, which is a different question and one nobody had been able to answer, because the embedding model could not be downloaded (see the header note in `lib/embed.test.ts`).
**Method:** every claim below is backed by something that was actually executed — `tsc`, `eslint`, `vitest`, direct SQL against `.nebulosity/nebulosity.db`, or a throwaway harness run against the real MiniLM model. Nothing here is inferred from reading alone. Measured outputs are reproduced in PART 3.
**Companion:** fixes are mapped to tiers in PART 2. This review adds work items; it does not change the architecture. Findings are numbered `R1`–`R18` to avoid colliding with `GRAPH_IMPLEMENTATION_REVIEW.md`'s `W`/`F` numbering.

---

## Verification baseline

| check | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean — one pre-existing warning (unused `setEdges`, `app/components/GraphCanvas.tsx:33`) |
| `npx vitest run` | **53 / 54** — `lib/embed.test.ts > embed > should batch multiple texts` fails: `expected [ …(2) ] to have a length of 20 but got 2` |
| `.nebulosity/nebulosity.db` | `repositories`=1, `files`=26, `imports`=28, `chunks`=51, `meta`=2, **`vectors` — table does not exist** |
| chunks per file | 51 chunks spread over **8 of 26** indexed files |

The headline: **Phase 3 and Phase 4 have never successfully executed even once.** Four independent bugs sit between `POST /api/index` and a populated `vectors` table, and a fifth guarantees `GET /api/search` throws on its first row. The clean `tsc`/`eslint` result is exactly the trap this project's rigorous-verification rule exists to catch — all five bugs are type-correct.

---

# PART 1 — FINDINGS

Ordered by severity, not by file.

## R1 — The Phase 2/3 tables were never migrated (blocker)

**Evidence:** `lib/db/migrations/` contains exactly one migration, `0000_lonely_steve_rogers.sql`, and its only `CREATE TABLE` statements are `files`, `imports`, `repositories`. `meta/_journal.json` has a single entry. But `lib/db/schema.ts` has since gained `chunks`, `meta` and `vectors`. `drizzle-kit generate` was never re-run after the Phase 2 and Phase 3 schema edits.

**Failure scenario:** the live database has `chunks` and `meta` (pushed by some out-of-band route) but **not `vectors`** — confirmed by querying `sqlite_master`. Every `db.insert(vectors)` in `indexRepo` therefore throws `no such table: vectors`, is swallowed by the per-file catch at `lib/index-repo.ts:214`, and is recorded as a per-file error while the run as a whole reports success and stamps `repositories.lastIndexAt`.

**Why the test suite never noticed:** `lib/db/client.ts:15-17` runs the migrations only for the `:memory:` Vitest database, and the only DB-touching test (`lib/db/graph-store.test.ts`) exercises `repositories`/`files`/`imports` — the three tables the one existing migration *does* create. A whole class of schema drift is invisible to a green suite.

**Interviewer angle:** "Your migrations are the schema's source of truth, but your ORM model drifted ahead of them and your tests only covered the tables that hadn't drifted. How would you make that impossible?" (A migration-freshness check in CI; a smoke test that touches every table.)

## R2 — `embedTexts` returns one vector per *batch*, not per text (blocker)

**Evidence:** `lib/embed.ts:148-190`. Confirmed against the real model:

```
pipe(["hello world", "goodbye world", "third one"], { pooling: "mean", normalize: true })
  → ctor: _Tensor   Array.isArray: false
  → dims: [3, 384]  data: Float32Array(1152)
```

Transformers.js returns a **single `Tensor`** whose `.data` is one flat, row-major `Float32Array` of `n × 384`. It is not an `Array`, so `Array.isArray(output)` at line 156 is false and control reaches the `typeof output === 'object'` branch at line 178, where `tensor.data instanceof Float32Array` is true and the **entire flat buffer is pushed as one "vector"** (line 182).

**Failure scenario:** 20 texts at `batchSize` 16 → 2 "vectors" of length 6144 and 5120. `embedChunks` (`lib/embed.ts:217-220`) then zips `chunks[i]` with `vectors[i]`, so every chunk past index 1 gets `undefined`, and `Buffer.from(undefined.buffer)` throws. `validateVector` would report `length: 6144` if it ever got that far. This is the bug `lib/embed.test.ts:42-50` already fails on.

**Interviewer angle:** "You wrote four defensive branches for output shapes you guessed at, and the real shape wasn't one of them. What should you have done instead?" — the shape was one `console.log(out.dims)` away. Defensive branching against an unknown contract is not robustness; it's a way to convert a crash into a silent wrong answer.

## R3 — `Buffer.from(vector.buffer)` ignores the view window (blocker, latent behind R2)

**Evidence:** `lib/index-repo.ts:205`. Once R2 is fixed, each vector is a *view* into the batch tensor's 1152-float buffer. `TypedArray.prototype.buffer` is the whole underlying `ArrayBuffer`, not the view's slice — so every row would serialize as 4608 bytes of the entire batch, and every stored vector would be identical.

**Fix shape:** `Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)`, or copy the row out before storing.

**Interviewer angle:** "What's the difference between a typed array and its backing buffer, and when does that difference bite?" — exactly here, and again in R4, in opposite directions.

## R4 — `new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength)` — wrong unit (blocker)

**Evidence:** `lib/retrieve.ts:73-78`. The third argument to the `Float32Array(buffer, byteOffset, length)` constructor is a **count of elements**, not bytes. Demonstrated:

```
new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength)
  → RangeError: Invalid typed array length: 1536
new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  → length 384
```

**Failure scenario:** `getVectorCache()` throws on the very first vector row, `GET /api/search?q=…` returns a 500 `INTERNAL` envelope for every query, forever. Note this is *unreachable today* only because R1 means no vector rows exist to decode.

**Second, quieter problem:** Node allocates small `Buffer`s out of a shared pool, so `buf.byteOffset` is not guaranteed to be a multiple of 4. `new Float32Array(buffer, byteOffset, …)` throws `RangeError: start offset … should be a multiple of 4` when it isn't. This would be an *intermittent* failure depending on allocation history — far worse than a deterministic one. Copy the bytes (e.g. via a slice of the buffer) rather than aliasing them.

## R5 — The chunker is fed absolute paths, breaking the project's one shared identifier

**Evidence:** `lib/index-repo.ts:153` — `extractChunksFromFile(fullPath, content)` where `fullPath = path.join(repoRoot, scanned.id)`. Live rows from `.nebulosity/nebulosity.db`:

```
chunks.chunk_id : <checkout>\lib\chunks.ts#parseFile#0
files.path      : lib/chunks.ts
```

**Failure scenario:** `lib/contracts.ts`'s header rule is explicit — node ids, chunk file paths, tool arguments and source citations are *all* project-relative forward-slash paths, and "one shared identifier is what lets every subsystem point at the same things." Chunk ids are currently machine-specific absolute Windows paths, so a Phase 5 citation can never be matched against a graph node id, and `highlight_nodes` can never light up the file a retrieved chunk came from. The whole `ui_action` premise (ADR-008) quietly stops working. Should be `extractChunksFromFile(scanned.id, content)`.

**Interviewer angle:** this is `BUGS_ENCOUNTERED.md #3` recurring in a new consumer — the same "new code path uses a raw path without going through normalization" shape. The takeaway recorded there ("fix path/format inconsistencies at the one place data is produced") predicted this exactly.

## R6 — `export default function` swallows the entire file

**Evidence:** `lib/chunks.ts:92-115`. `processDefaultExportFunction` does `const parent = node.parent as ts.ExportAssignment` and takes `parent.getStart()`, `parent.getEnd()` and `parent.getFullText()`. But `BUGS_ENCOUNTERED.md #6` already established the correct fact: **for `export default function foo() {}` the parent is the `SourceFile`.** So `getStart()` is position 0 and `getEnd()` is EOF. Measured against real project code:

```
app/components/StarField.tsx  →  kind=function  name=default  lines 1-84   (the file is 84 lines)
app/page.tsx                  →  kind=function  name=default  lines 1-9    (the whole file)
```

The chunk's `text` is the complete file — imports, unrelated declarations and all.

**The test passes by coincidence.** `lib/chunks.test.ts:173-185` uses a fixture containing nothing but the default-exported function, so "the whole file" and "the function" are byte-identical. The project owner flagged exactly this risk in the test header ("make sure all test cases GENUINELY work and it's not by pure coincidence") and in `BUGS_ENCOUNTERED.md #5`'s takeaway ("A test that passes by coincidence is a ticking time bomb"). It was the right instinct.

**Also in this function:** the `parentIsExport` fallback (`lib/chunks.ts:53`) is dead code. `ts.ExportAssignment` holds an *expression*, so a `Statement` iterated out of `sourceFile.statements` can never have one as its parent. And a default-exported component in a `.tsx` never reaches `isReactComponent`, so it is always `kind: "function"`, never `"component"`.

**Documentation drift:** `BUGS_ENCOUNTERED.md #6` states the root cause correctly and then reproduces a fix that contradicts it. The entry should be corrected in place — a debugging log that records a wrong fix under a right diagnosis is worse than no entry.

## R7 — The content hash is committed before the work that justifies it, with no transaction

**Evidence:** `lib/index-repo.ts:129-133` updates `files.contentHash` to the new hash. Chunk insertion happens at 156-172, embedding at 195-211. All are separate statements; there is no `db.transaction()` anywhere in `indexRepo`. The roadmap (Phase 2, Task 2) specifies "one transaction per file batch."

**Failure scenario:** anything that throws after line 133 is caught at 214 and logged as a per-file error — but the hash is already persisted. On the next run, `existing.contentHash === hash` at line 112 is true, the file is counted as `skippedUnchanged`, and it is **never re-indexed again**. The failure is permanently self-concealing.

**This has already happened.** 26 files are recorded in `files`, but only 8 have any chunks. The remaining 18 hit R1's missing-`vectors` error, were marked clean, and are now unreachable by any amount of re-running `POST /api/index`. Recovery requires deleting `.nebulosity/nebulosity.db*` (or clearing the hashes) after the blockers are fixed — a fix alone will not heal the existing database.

**Interviewer angle:** "Your incremental pipeline's skip condition is a hash written before the work succeeded. What invariant did you break?" — the hash means *"this file's derived data is up to date."* Writing it before producing that data makes it a lie, and an idempotent-looking retry can never correct it.

## R8 — `splitOversizedChunks` has four distinct defects

**Evidence:** `lib/chunks.ts:402-433`. All four were measured; see PART 3 §3.2.

1. **Tail lines are dropped.** `parts = Math.ceil(lines.length / MAX_CHUNK_LINES)` (line 414) assumes non-overlapping windows, but line 417 shifts each window back by `OVERLAP - 1`. A 599-line function yields parts covering 1–200, 199–398, 399–598 — **line 599, the closing brace, is in no chunk.**
2. **Overlap only exists at the first boundary.** `start = i * 200 - OVERLAP + 1` but `end = start + 200` (lines 417-418), so part 2 ends at 397 and part 3 starts at 398. Measured: `199-398` followed by `399-598`. The stated 3-line overlap is actually 2 lines, once, and 0 lines thereafter.
3. **File-summary chunks are split spuriously.** `lineCount` (line 406) is derived from `endLine - startLine + 1`, but a file-summary's *range* spans the whole file while its *text* is ~7 synthetic lines. Every file over 200 lines therefore gets its summary "split" into one bogus part. Measured on `lib/graph.ts` (206 lines): `(file)` emitted with `partIndex: 1` and range `1-17`.
4. **`partIndex` starts at 1.** `lib/contracts.ts` documents `partIndex` as "0 unless a large declaration was split", and the id format as `${filePath}#${name}#${partIndex}`. A split declaration therefore has parts 1..n and no part 0, which reads like a missing chunk. Pick 0-based and make the contract comment say so, or keep 1-based and fix the contract — but they must agree.

## R9 — `getFullText()` and the line range describe different regions

**Evidence:** every `process*` helper in `lib/chunks.ts` computes `startLine` from `node.getStart(sourceFileAST)` (which *skips* leading trivia) but sets `text` to `node.getFullText(sourceFileAST)` (which *includes* it). Measured:

```
function `documented`:  startLine=6  endLine=8  →  3 lines
                        text = 8 lines, first line is ""
```

**Three consequences:**
1. The Phase 2 acceptance criterion — "line ranges open in the editor to exactly the declarations named" — cannot be satisfied.
2. `buildEmbeddingText` (`lib/embed.ts:46-49`) takes `chunk.text.split("\n")[0]` as the `Signature:` line. For any declaration preceded by a blank line or a comment, that field is blank or a comment fragment, and the real signature is buried in the body. The single most identifying line of a chunk is being thrown away for most chunks.
3. It is the direct cause of R8's line arithmetic being wrong — `splitOversizedChunks` maps offsets in a `getFullText()` string onto a `getStart()`-derived `startLine`.

**Note the trade-off honestly:** including the leading JSDoc is *good* for retrieval quality — `RAG_PIPELINE.md` §4 wants the doc comment in the embedding text, and `extractDocComment` depends on it being in `chunk.text`. So the fix is not "use `getText()`". It is to pick one region and make `startLine`/`endLine`/`text` all describe it — most likely keep `getFullText()` and derive `startLine` from `getFullStart()`, then trim leading blank lines before computing the signature.

## R10 — Whole declaration kinds produce no chunks

**Evidence:** `processStatement` (`lib/chunks.ts:38-85`) handles function, class, variable, interface and type alias. Measured — a file containing only:

```ts
export enum E { A, B }
export namespace N { export const x = 1; }
export { foo } from "./foo";
```

produces **one chunk**: the file summary. Missing: `ts.EnumDeclaration`, `ts.ModuleDeclaration` (namespaces), `ts.ExportDeclaration` (re-export barrels — precisely the hub files an onboarding tool should surface, per `GRAPH_IMPLEMENTATION_REVIEW.md` W2), and `ts.ExportAssignment` (`export default Thing;` — the const is chunked, but the fact that it is the module's default export is invisible).

## R11 — Only the first declarator of a variable statement survives

**Evidence:** `lib/chunks.ts:204` — `node.declarationList.declarations[0]`. `export const a = 1, b = 2;` yields a chunk named `a`; `b` is unretrievable, and the chunk's text silently contains a declaration its name doesn't mention.

## R12 — Naive uppercase test misclassifies constants as components

**Evidence:** `lib/chunks.ts:211-212` — `name[0] === name[0].toUpperCase()` is true for digits, `_`, `$`, and all SCREAMING_SNAKE_CASE. Live misclassification in this repo: `app/components/StarField.tsx#STAR_COUNT` is stored with `kind: "component"`. The same test appears in `isReactComponent` (`lib/chunks.ts:302`).

## R13 — Chunk ids are globally unique, so one collision kills a whole file

**Evidence:** `lib/db/schema.ts` declares `chunkId: text("chunk_id").notNull().unique()`. Two same-named top-level declarations in one file — overload signatures, a declaration-merged interface + namespace, an ambient `.d.ts` — generate identical ids. The batch insert at `lib/index-repo.ts:156` then throws for the *entire file*, which R7 converts into a permanent skip.

## R14 — `/api/health` still reports a hardcoded empty index

**Evidence:** `app/api/health/route.ts:10-15` returns `exists: false, indexedAt: null, chunkCount: 0, staleFiles: 0` as literals. `IMPLEMENTATION_ROADMAP.md` Phase D Task 7 explicitly deferred these to Phase 2 ("still zero until Phase 2"); Phase 2 shipped without them.

**User-visible symptom:** `app/components/GraphView.tsx:55-57` drives the status-bar dot off `health.index.exists`, so it renders a red "Unindexed" pip no matter how much indexing has run. This is the "indexing symbol on the ui near the top bar" noted in `lib/index-repo.ts`'s header comment.

## R15 — `INDEX_LOCKED` is unreachable

**Evidence:** `lib/index-repo.ts:44` throws `new Error("Indexing is already in progress. Please try again later.")`. `app/api/index/route.ts:28` classifies it with `error.message.includes("INDEX_LOCKED")`. The string never matches, so a genuinely locked run reports `INTERNAL` — contradicting `API_CONTRACTS.md` §4, which specifies `INDEX_LOCKED` as the terminal error when another run holds the lock. Matching on error *message text* is the underlying smell; a typed error or an error `code` property survives rewording.

## R16 — The indexing lock is not crash-safe

**Evidence:** `lib/index-repo.ts:37-49`. The lock is a `meta` row removed in a `finally`. A `finally` does not run if the process is killed, the container stops, or the dev server is restarted mid-index — and indexing is the longest operation in the product, so it is the most likely thing to be interrupted. The stale row then makes **every future run** throw at line 44 with no way out short of hand-editing SQLite.

The row already stores `new Date().toISOString()` (line 48), so the information needed to expire it is present and simply unused.

## R17 — Progress events drift from the contract

**Evidence:**
- `lib/index-repo.ts:32` types the callback as `phase: string`, not the `IndexPhase` union that `lib/contracts.ts` defines. The compiler cannot catch a typo'd phase name.
- `"scanning"` is emitted exactly once, with `done: 0` (line 88), and never completed.
- `"embedding"` is emitted **inside the per-file loop** (line 196) with `total` = that file's chunk count, so `done`/`total` reset on every file. A client cannot render a progress bar from this. `API_CONTRACTS.md` §4 expects embedding progress "per ~10 files", i.e. run-scoped.
- The `done` event (`app/api/index/route.ts:48-58`) adds `changed`, `errors` and `warnings` beyond the four fields §4 specifies. Harmless and arguably useful — but it is an undocumented contract extension, and this project's maintenance rule says the doc changes in the same commit.

## R18 — No documentation was updated for three phases

**Evidence:** `IMPLEMENTATION_ROADMAP.md` carries `**DONE**` status lines for the P0 fixes, the P1 fixes and Phase D. Phases 2, 3 and 4 have none. `ENGINEERING_DECISIONS.md` ends at ADR-016; no ADR records the `lib/chunk.ts` → `lib/chunks.ts` rename, the 200-line/3-line split policy, the `partIndex` base, or the embedding-text construction. `API_CONTRACTS.md` was not touched despite R17's extensions.

The maintenance rule in `ARCHITECTURE.md` and `CLAUDE.md` is not a style preference — it is the mechanism that keeps `docs/` usable as the system's source of truth. Three phases of undocumented drift is how a design doc set stops being trustworthy.

---

# PART 2 — PRIORITIZED FIXES

## Tier 0 — Blockers (nothing downstream can be evaluated until these land)

Do these strictly in order; each unblocks the next.

1. **R1 — regenerate migrations.** `npx drizzle-kit generate`, review the emitted SQL, commit it. Consider adding a test that asserts a fresh migrated DB contains every table in `schema.ts`, so this can never silently recur.
2. **R2 — decode the tensor.** Read `dims`, slice `.data` into `dims[0]` rows of `dims[1]`. The whole `Array.isArray` / `instanceof` ladder at `lib/embed.ts:156-190` collapses to a few lines once the real shape is known — delete it rather than adding a fifth branch. `lib/embed.test.ts` goes green when this lands, which is the signal that R2 is actually fixed.
3. **R3 — serialize the view, not the buffer.** `Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)`.
4. **R4 — decode with the right unit,** and copy rather than alias so pool alignment can't bite.
5. **Wipe and re-index.** Delete `.nebulosity/nebulosity.db*`, re-run `POST /api/index`. R7 means the existing DB's stale hashes will otherwise hide the fix.
6. **Verify the Phase 3 acceptance criteria for real:** `SELECT COUNT(*) FROM vectors` equals `SELECT COUNT(*) FROM chunks`; every decoded vector has length 384 and magnitude ≈ 1.0 (`validateVector` already does this); a warm re-index does zero embedding work.

## Tier 1 — Correctness (the pipeline runs but stores wrong data without these)

7. **R5 — pass `scanned.id`, not `fullPath`,** into `extractChunksFromFile`. One-line change; restores the shared-identifier invariant that Phase 5 depends on.
8. **R6 — fix the default-export handler** to use `node` itself when `hasDefault` is true, drop the dead `parentIsExport` branch, and route through the component check. Then **rewrite the test with a fixture that has other declarations around the default export**, so it can no longer pass by coincidence. Correct `BUGS_ENCOUNTERED.md #6` in the same change.
9. **R7 — wrap each file's work in `db.transaction()`** so the hash and the derived rows commit or roll back together.
10. **R9 — settle the text/range question** before touching R8, since R8's arithmetic depends on it.
11. **R8 — rewrite the splitter** against the decision from R9. Cover the tail line, every interior boundary's overlap, and the file-summary case in tests — the current `splits oversized chunks with overlap` test only asserts the one boundary that happens to work.
12. **R13 — disambiguate colliding chunk ids** (append an occurrence index, or scope uniqueness to `(fileId, chunkId)`).

## Tier 2 — Coverage and contract hygiene

13. **R10** — add `EnumDeclaration`, `ModuleDeclaration`, `ExportDeclaration`, `ExportAssignment`.
14. **R11** — iterate all declarators, or name the chunk after all of them.
15. **R12** — require `/^[A-Z]/` and reject all-caps identifiers.
16. **R14** — make `/api/health` report real `chunkCount` / `indexedAt` / `exists`, so the status pip stops lying. Extend `API_CONTRACTS.md` §3 in the same change if the shape moves.
17. **R15** — give `indexRepo` a typed/coded lock error and match on the code, not the message.
18. **R16** — expire the lock using the timestamp already stored in the row.
19. **R17** — type the callback as `IndexPhase`, make embedding progress run-scoped, and document the extra `done` fields in `API_CONTRACTS.md` §4.

## Tier 3 — Documentation debt

20. **R18** — add `DONE` status lines for Phases 2/3/4 to `IMPLEMENTATION_ROADMAP.md` once Tier 0 and Tier 1 land (they are not done until then), and record ADRs for the decisions Phases 2–4 made silently: the `chunks.ts` filename, the split policy and `partIndex` base, and the embedding-text construction.

## Deliberately not in scope

- **`lib/chunks.ts`'s `FOR CLAUDE` note about `ChunkKind`.** No action needed: `CodeChunk["kind"]` *is* `ChunkKind`, so every literal in the file is already compiler-checked and all seven kinds are reachable. The only loose thread is the local `getKind()` helper returning `string` instead of the union — cosmetic.
- **The `warnings` array in `IndexStats`.** Keep it. It is already surfaced in the `done` event and it is the right place for R7's per-file errors to become visible once the UI grows an indexing panel.
- **AST unification of the import extractor (ADR-003).** Still correctly deferred; `lib/scan.ts` and `lib/chunks.ts` now both parse the same files by different means, which strengthens the case, but it is not a Phase 2–4 defect.

---

# PART 3 — MEASURED EVIDENCE (appendix, 2026-09-04)

> **These are observations of buggy code, not golden vectors.** Unlike `GRAPH_IMPLEMENTATION_REVIEW.md` PART 3, nothing in this section should be transcribed into a test as an expected value — several of these numbers *are* the bugs. They exist so the fixes can be checked against a known "before".

## 3.1 Embedding pipeline, real model

```
pipe(["hello world", "goodbye world", "third one"], { pooling: "mean", normalize: true })
  ctor           : _Tensor
  Array.isArray  : false
  dims           : [3, 384]
  data           : Float32Array, length 1152
  tolist()       : 3 rows × 384
  row 0 magnitude: 1.000000035148579
```

Decoded correctly (`data.slice(r*384, (r+1)*384)`), MiniLM's own normalization is sound — magnitude is within 4e-8 of 1, comfortably inside `validateVector`'s 1e-3 tolerance. The model itself was never the problem.

## 3.2 Chunker, measured on real project files

| input | observed output | finding |
|---|---|---|
| `app/components/StarField.tsx` (84 lines) | `function default` spanning **1-84** | R6 |
| `app/page.tsx` (9 lines) | `function default` spanning **1-9** | R6 |
| `StarField.tsx` `STAR_COUNT` | `kind: "component"` | R12 |
| `lib/graph.ts` (206 lines) | `(file)` summary emitted as `partIndex: 1`, range `1-17` | R8.3 |
| 599-line function | parts `1-200`, `199-398`, `399-598` — line 599 lost; no overlap after the first boundary | R8.1, R8.2 |
| function at lines 6-8 preceded by JSDoc | `text` is 8 lines and starts with `""` | R9 |
| file of only `enum` + `namespace` + `export {…} from` | 1 chunk (the file summary) | R10 |

## 3.3 Phase 4 acceptance queries — actually run

Method: all 26 scanned files chunked with **relative** ids (i.e. R5 pre-fixed), embedded with a **correct** tensor decode (R2 pre-fixed), scored by dot product against the query embedding, threshold 0.25, top-8 — using the project's own `buildEmbeddingText` and `retrieve`'s algorithm unmodified. 146 chunks total.

| query | rank 1 | score | verdict |
|---|---|---|---|
| "how are imports extracted from files" | `lib/scan.ts#extractImports` | 0.547 | pass |
| "circular ring layout positions" | `lib/graph.ts#radialPosition` | 0.541 | pass |
| "draw the star background" | `StarField.tsx#default` | 0.514 | pass |
| "chat input box" | `TerminalPanel.tsx#default` | 0.329 | pass |
| "convert scan output to react flow" | `lib/graph.ts#ResolvedEdge` | 0.657 | **fail** — `toFlowGraph` absent from top 8 |

**`lib/retrieve.ts`'s algorithm is sound.** Dot-product scoring, the 0.25 threshold, top-k slicing and the `lastIndexAt`-keyed cache invalidation all behave correctly. Four of five acceptance queries hit at rank 1 the moment the blockers are removed.

**The fifth failure is not a retrieval bug — it is a stray comment in `lib/graph.ts`.** The JSDoc reading "Transform the scanner's raw output into React Flow's Node[] / Edge[]" sits at **lines 118-124**, directly above `export type ResolvedEdge` (line 126), while the function it documents, `toFlowGraph`, is at line 175 with no doc comment at all. So a three-field type alias inherits the description of a function 50 lines away and outranks it. Verified fix: with the JSDoc moved back above `toFlowGraph`, it takes rank 1 at **0.576** and all five acceptance queries pass.

This is pre-existing drift from the F5/F6 refactor, not a Phase 2–4 defect — but it is a good illustration of a property worth internalizing: **once you embed code, your comments become part of your search index.** A misplaced comment is now a retrieval bug, and this one was invisible until retrieval existed to expose it. Worth an entry in `LEARNING_NOTES.md`.

## 3.4 A hypothesis that did *not* hold

Before finding the misplaced JSDoc, the working theory was that R9 (leading trivia polluting the `Signature:` field) caused the query-5 miss. It was tested by trimming leading blank/comment lines before building the embedding text and re-ranking. Result: `ResolvedEdge`'s false top hit disappeared, but `toFlowGraph` still did not surface — so R9 was *a* contributor to the noise, not the cause of the miss. Recorded because a review that only lists its confirmed hypotheses hides how the confirmed ones were found.

---

# PART 4 — RESOLUTION (2026-09-04)

All 18 findings fixed in one pass, at the project owner's explicit request to implement rather than coach. Two further defects surfaced *during* the fixes — both invisible to the original audit because they could only manifest once earlier blockers were cleared.

## Findings the audit missed

### R19 — `saveScan` destroyed the index on every page load, and pre-empted the indexer

**Found:** re-indexing from a clean database after R1–R4 were fixed. The run reported `changed: 0, skippedUnchanged: 27, chunkCount: 0` — every file skipped as unchanged on a database that had never been indexed.

**Two failures, one cause.** `saveScan` ran `DELETE FROM files` and reinserted every row on every `GET /api/graph`, stamping each with the file's current content hash. Phase 2 had since added `chunks` as a cascading child of `files`, and `vectors` as a child of `chunks`. So (1) loading the graph page cascaded straight through the index and deleted it, and (2) writing `contentHash` at *scan* time told the indexer every file was already up to date, so `chunks` could never fill.

This is the same invariant R7 breaks — a hash claiming derived data exists when it does not — but from a completely different writer, in a file the audit had scoped out as finished Phase D work. Fixed by upserting and by giving `contentHash` a single owner (ADR-022, `BUGS_ENCOUNTERED.md` #8).

**Why the audit missed it:** the review reasoned about `index-repo.ts` in isolation. The defect existed in the *interaction* between two files written six weeks apart, and was masked by R1/R2 — nobody could get far enough to observe it.

### R20 — Migrations never ran for the file database

**Found:** deleting `.nebulosity/nebulosity.db` as R1's remediation step produced a database with no tables at all.

`lib/db/client.ts` called `migrate()` only when the path was `:memory:`. Two consequences: Phase D's acceptance criterion "deleting the DB file self-heals on next request" was false, and the R1 schema drift was structurally undetectable — the tests were the only thing running migrations, and they only touched tables the one existing migration created. Fixed by migrating unconditionally (ADR-023).

## Verification

Everything below was run against the live dev server after a full wipe and rebuild.

| check | result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean (same single pre-existing `setEdges` warning) |
| `npx vitest run` | **63 / 63** (was 53/54; 9 tests added) |
| cold index | 27 files → **161 chunks**, 0 errors, 0 warnings, 7.9 s |
| `COUNT(vectors)` vs `COUNT(chunks)` | 161 = 161 |
| vector dimensions | all 384 |
| vector magnitudes | all within `0.999999596 – 1.000000312` |
| **distinct** embeddings | 161 of 161 — the check that proves R3 is fixed |
| absolute-path chunk ids | 0 |
| warm re-index | 27 skipped, 0 changed, **no `embedding` phase**, 16 ms |
| single-file edit | `changed: 1`, `skipped: 26`, 2 chunks re-embedded, only that file's rows replaced |
| index survives `GET /api/graph` | 161 chunks / 161 vectors before and after (R19) |
| `GET /api/health` | `exists: true, chunkCount: 161, staleFiles: 0` |
| status-bar pip | reads **INDEXED** |
| Phase 4 acceptance | **5 / 5 at rank 1** |

Six randomly-sampled chunks were opened against their source files; every `startLine`/`endLine` landed exactly on the named declaration, including the two whose spans begin at an attached comment (ADR-018 behaving as designed).

## Final retrieval scores

| query | rank 1 | score | before |
|---|---|---|---|
| "how are imports extracted from files" | `lib/scan.ts#extractImports` | 0.532 | rank 1 |
| "circular ring layout positions" | `lib/graph.ts#radialPosition` | 0.460 | rank 1 |
| "draw the star background" | `StarField.tsx#Star` (top 3 all StarField) | 0.468 | rank 1 |
| "chat input box" | `TerminalPanel.tsx#default` | 0.326 | rank 1 |
| "convert scan output to react flow" | `lib/graph.ts#toFlowGraph` | 0.564 | **absent from top 8** |

The last row is the one that moved, and it moved because a comment was relocated in `lib/graph.ts` — not because anything in `retrieve.ts` changed. See `LEARNING_NOTES.md` §14.

## Decisions recorded

ADR-017 (vector serialization as one inverse pair) · ADR-018 (chunk span = declaration + attached comment) · ADR-019 (`~n` id disambiguation) · ADR-020 (declaration-kind coverage; re-exports live in the file summary) · ADR-021 (`done` event carries per-file failures) · ADR-022 (`saveScan` upserts; `contentHash` has one owner) · ADR-023 (migrations run on every database open).

`BUGS_ENCOUNTERED.md` gained entries #7–#9 and a correction to #6, whose recorded fix contradicted its own (correct) diagnosis.

## Appendix — the original §3.4 note



Before finding the misplaced JSDoc, the working theory was that R9 (leading trivia polluting the `Signature:` field) caused the query-5 miss. It was tested by trimming leading blank/comment lines before building the embedding text and re-ranking. Result: `ResolvedEdge`'s false top hit disappeared, but `toFlowGraph` still did not surface — so R9 was *a* contributor to the noise, not the cause of the miss. Recorded here because a review that only lists its confirmed hypotheses hides how the confirmed ones were found.
