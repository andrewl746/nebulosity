# IMPLEMENTATION_ROADMAP.md — Build Order

> **2026-10-11 — the pivot (ADR-024, `PIVOT_SPEC.md`) replaces everything after Phase 4.** The current plan is the "Pivot roadmap" section directly below. Phases 0–4 and the P0/P1/D work stay here as history, and their acceptance criteria held. **Phase 5** is folded into extra E1 (the Guide). Its tool work in `lib/agent/tools.ts` seeds the new tool registry. **Phase 6** is superseded by the new Map (V1.3). **Phase S** is dropped (ADR-025). Ground rule 4 below ("no UI redesign") is lifted for the Map revamp (ADR-029).

## Pivot roadmap (current, 2026-10-11)

**Goal:** ship V1.1–V1.5 by **2026-10-18**, with a slip budget of 2–4 days, then V1.6 so other people can use Nebulosity on their own repos, then the extras in the order of ADR-043 (2026-10-13): **E4 → E5 → E1**, with E3 smaller and optional and E2 waiting on a measurement. The rows below are in that order; the labels are unchanged. Every slice ends demoable. "Done" means `PIVOT_SPEC.md` §2's success criteria are measured on VS Code at `cc3fec88`, plus `npx tsc --noEmit && npm run lint && npx vitest run` passing clean. **Working mode:** build-first (`PIVOT_SPEC.md` §13).

| Slice | Contents | Acceptance (spec §2) |
|---|---|---|
| **V1.1 Engine foundation** — DONE 2026-10-11 (see BENCHMARKS.md) | `NEBULOSITY_HOME` paths; repo config; `git ls-files` discovery; TS adapter (AST imports + class members); resolver (nearest tsconfig); batched store; `folders` + `level_edges`; `npm run index`; benchmark | S1 ≤ 60 s on VS Code; batching regression test passes |
| **V1.2 Understanding** — DONE 2026-10-12 (see BENCHMARKS.md) | tiered summaries (Batch for the first pass, regular API on demand); summary embeddings; code and summary FTS; hybrid search with RRF; `/api/status` | S2 ≤ $15; day-1 Haiku vs Sonnet side-by-side reviewed by the owner |
| **V1.3 Map** — DONE 2026-10-12 (see BENCHMARKS.md) | level/describe/search APIs; new Map UI (levels, 50-box cap, panel, ⌘K, status pill); live channel | S3, S4, S6 measured |
| **V1.3.1 Visual refresh** — DONE 2026-10-13: the three-task test run, two outside critiques taken in, the owner's visual sign-off (plans: `docs/plans/2026-10-12-v1-3-1-visual-refresh.md`, `docs/plans/2026-10-12-v1-3-1-page-portals.md`; BENCHMARKS.md Map Benchmarks #2 and #3) | the refined dark theme of `VISUAL_REFRESH.md` (ADR-041): tokens, a flat canvas, larger boxes, one meaning per color, a structured panel, the top bar and an always-visible activity bar; the `describe` speed fix | S3 re-measured on the production build; the `src` panel ≤ 300 ms warm; the three-task test; the owner's visual sign-off |
| **V1.4 MCP** — DONE 2026-10-13 (plan: `docs/plans/2026-10-13-v1-4-mcp.md`; BENCHMARKS.md MCP Benchmark #1, MCP Smoke Test #1) | tool registry; `mcp/server.ts` (read-only DB); `claude mcp add` instructions; smoke test | S5; every tool exercised through `claude -p` |
| **V1.5 Ship** — DONE 2026-10-14 (plan: `docs/plans/2026-10-13-v1-5-ship.md`; BENCHMARKS.md Search Benchmark #2, MCP Benchmark #2, Map Benchmark #5; EVAL_RESULTS.md Eval #1: 90 runs in three arms, accuracy not improved, dependency questions cheaper and faster). S8's last parts are the owner's: deploy the demo (built, in the sandbox worktree's `out/`), make the repo public, record the video; the README's demo and video links get added then. **Held by the owner (2026-10-14):** none of these happens until V1.6 re-measures better results and efficiency (ADR-051 amended) | static export + hosted demo; eval vs Claude Code alone, and search ranking tuned against its own query set (folders can't appear in the code list, so RRF under-ranks them: the "integrated terminal" miss, BENCHMARKS.md Summary Benchmark #1; by V1.5's planning probe "lifecycle" and "Disposable" leave VS Code's `lifecycle.ts` outside the top 8); README; demo-video script; the pre-public docs review, the LICENSE and npm audit's critical advisory | S7, S8 |
| **V1.6 Works on your repo** (ADR-043) — DONE 2026-10-15 (plan: `docs/plans/2026-10-14-v1-6-works-on-your-repo.md`; BENCHMARKS.md Variety Benchmark #1; EVAL_RESULTS.md Eval #2: 270 runs on VS Code and AFFiNE, **the ship gate FAILED** on conditions 1, 2, 3a and 5a; 3b, 4 and 5b passed). **The hold of ADR-051 stays:** nothing is deployed, published or made public until the owner chooses among the options at the end of Eval #2 | As built: the engine resolves more imports (workspace packages, module ids, computed `import()`, bundler queries, `#` imports; ADR-053), reads the repo's Markdown docs and points to them (ADR-054), and computes impact and architecture facts from the import graph (ADR-055); six tools, five always loaded into Claude Code's prompt (ADR-056); an installable package with the `nebulosity` command, data in the user's folder, **free mode** with no API key, and the cost confirmed (a yes) before any spend (ADR-058); CI on Windows, macOS and Linux; five real repos of different shapes; Eval #2 under a gate fixed before its first run (ADR-057) | S9, S10, S11 met; S12 failed |
| **E4 tree-sitter** — first extra (ADR-043) | `web-tree-sitter` adapters: Python first, Go if there's time | own plan |
| **E5 Clustering** | Louvain + cluster summaries + Clusters lens; PageRank importance; a focus view of a box's links across folders (moved from V1.3.1, PIVOT_SPEC §10) | own plan |
| **E1 Guide** | LangGraph agent per `LANGGRAPH_DESIGN.md`, using registry tools and map tools; owner picks the model at kickoff | own plan |
| **E3 Git overlays** — optional, smaller (ADR-043) | "often changes with…" and the first commit in the panel, from the repo's own history; the History lens and hidden-coupling lines wait. Showing it on VS Code needs `git fetch --unshallow` (owner approval) | own plan |
| **E2 Call graph** — deferred (ADR-043) | first, half a day measuring the memory and time of type-checking VS Code; then the owner decides. If built: type-checker resolution (typed vs heuristic), call-flow view, `callers`/`callees`/`call_flow` | own plan |

---

## Original phases (history)

**Status:** Approved plan. Execute phases strictly in order — each depends on the last.
**Timeline:** ~7–10 weeks part-time (Phases D and S, added 2026-07-12 per ADR-013/014, add roughly 1.5 weeks). Estimates assume a developer learning as they go (that's the point).
**Phase order:** 0 → P0 fixes → 1 → **P1 fixes (F5/F6)** → **D (data layer)** → **2** → **3** → **4** → 5 → 6 → **S (systems layer)**. *(0 through 4 are all complete as of 2026-09-04; **Phase 5, the LangGraph agent, is next**.)* *(S resequenced from between D and 2 to run last, 2026-07-20 — ADR-015. Its only hard prerequisite is F5/F6, and nothing in Phases 2–6 depends on it because the Node scanner is the always-available fallback — so deferring it protects the path to a demoable product.)*
**Ground rules for every phase:**
1. The app must still run at the end of every phase (`npm run dev`, graph visible).
2. `npx tsc --noEmit` and `npm run lint` pass before a phase is "done".
3. Do not start the next phase until the current phase's acceptance criteria all pass.
4. No UI redesign — the visual design is complete (per CLAUDE.md).
5. **F7/F8** (`GRAPH_IMPLEMENTATION_REVIEW.md` P2 — edge style → UI, `resolveSegments` clamp, `ScannedFile` dedupe) are intentionally *not* gated behind any phase's acceptance criteria — batch them into whichever nearby phase happens to touch that file. They're cheap and low-impact; don't let them block anything, but don't forget them either. *(F8's `ScannedFile`/scripts dedupe is now closed — `scripts/scan.ts` was deleted during the P1 fixes, 2026-07-26. Still open: F7 edge-style move to `GraphCanvas` `defaultEdgeOptions`; F8's `resolveSegments` root clamp + symlink comment.)*

---

## Phase 0 — Foundations (one evening)

**Goal:** the seams every later phase plugs into.

- ~~Create `lib/contracts.ts`~~ **Done 2026-07-12** — `lib/contracts.ts` was authored by the architect and typechecks. Phase 0 work is now just: read it, and verify it matches `API_CONTRACTS.md` if either has changed since.
- Add `.nebulosity/` to `.gitignore`.
- Create `.env.local` with `ANTHROPIC_API_KEY=` (empty is fine until Phase 5) and confirm `.env*` is gitignored.
- Install nothing yet — each phase installs its own deps so failures are attributable.

**Acceptance:** typecheck passes with the new contracts file; `git status` shows no `.nebulosity` or `.env.local`.
**You learn:** contract-first design — writing the types before the code that fulfills them.

---

## Phase 1 — Finish graph visualization (~1 week)

**Goal:** the graph becomes a controllable instrument (which the agent will play in Phase 6).

> Also absorb the **P0 fixes (F1–F4)** from `GRAPH_IMPLEMENTATION_REVIEW.md` at the start of this phase: test harness, per-file scan error tolerance, edge arrowheads, deterministic ordering. F5/F6 (hardened extractor, tsconfig-driven resolution) get their own step next — see **P1 fixes** below, right after this phase.
>
> **P0 fixes (F1–F4) status: all done (F1 2026-07-13; F2–F4 2026-07-21).** `lib/graph.test.ts` now has 33 passing tests, hand-written by the project owner (not generated). F1 (harness) covers `resolveSegments`, `radialPosition`, `resolveImport`, `classifyFile`, and a `toFlowGraph` integration case — and caught two real bugs along the way (`fileIds` rebuilt every loop iteration instead of once; `radialPosition` emitting `-0` instead of `0` on axis-aligned angles — see the `-0` note in PART 3 §3.1). **F2** (per-file error tolerance): `scanProject` now returns `{ files, warnings }`, guards each `readdirSync`/`readFileSync` in try/catch, and is covered by a `vi.spyOn`-mocked test proving a throwing read is skipped-and-warned without sinking the scan; `GraphResponse.stats.warningCount` reserved in `contracts.ts` (populated once `/api/graph` exists in Phase 1 Task 1). **F3** (arrowheads + no idle animation): `animated: true` dropped from the edge transform, `markerEnd`/`defaultEdgeOptions` added in `GraphCanvas`, edge opacity nudged for legibility. **F4** (determinism + dedupe): files sorted by id before return, plus a `Set`-based duplicate guard, both tested. F5/F6 remain the next step (P1 fixes below).

Tasks:
1. **`GET /api/graph`** route handler wrapping `scanProject()` + `toFlowGraph()` + degree-centrality stats. (The `server-only` guard was already removed from `lib/scan.ts` during F1 setup — see `ARCHITECTURE.md` §3 rule 1 — nothing left to do here.)
2. **Refactor `app/page.tsx`** to a lightweight shell; a client component fetches `/api/graph` on mount and owns graph state (nodes/edges move from `defaultNodes` to controlled state — required for highlighting).
3. **Selection:** clicking a node shows a small details strip (path, kind, dependencies in/out) — reuse data already in the response; no new endpoints.
4. **Highlight mechanism:** a `highlightedNodeIds: Set<string>` state; highlighted `FileNode`s get the brighter treatment (existing amethyst border at full opacity), non-highlighted dim slightly. Implemented as a prop threading through `GraphCanvas`, exposed via a `useGraphControls()` hook.
5. **Focus mechanism:** `focusNode(id)` using React Flow's `useReactFlow().fitView({ nodes: [{id}], duration: 600 })`.
6. **`GET /api/health`** (index fields hardcoded to `exists: false` until Phase 2) wired into the status bar.

**Acceptance:**
- Graph loads via the API (network tab shows `/api/graph`), renders identically to today.
- Clicking a node selects + shows details; a temporary dev button can highlight and focus an arbitrary node (this button is deleted in Phase 6 when the agent takes over).
**You learn:** controlled vs. uncontrolled React Flow, lifting state, designing UI affordances for a *machine* user (the agent) as well as a human.

---

## P1 fixes — hardened extractor & resolution (~2–4 hours) *(added 2026-07-13, closes F5/F6)* — **DONE 2026-07-26 (ADR-016)**

**Status:** F5 + F6 both landed and verified (35/35 F1 tests, `tsc`/lint clean, live `/api/graph` shows `@/`-alias edges). F5 strips comments (overriding golden-vector §3.4 row 209 — see ADR-016); residual is now string-literal false positives only. F6 reads `tsconfig.paths` server-side and injects the alias map into the pure resolver, keeping `graph.ts` filesystem-free. The duplicate `scripts/scan.ts` was deleted (closes F8's scripts-dedupe by removal). Next: **Phase D**.

**Goal:** close the two P1 gaps from `GRAPH_IMPLEMENTATION_REVIEW.md` before either downstream layer builds on top of today's `extractImports`/`resolveImport` behavior. **Ordering is load-bearing, not arbitrary:** Phase S's native scanner is bound by the golden test vectors, several of which are marked "flips after F5" in `GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 §3.4 — building the C++ port before F5 lands means faithfully porting bugs you're about to fix anyway, then redoing the C++ side. Do this now, once, before Phase S exists.

Tasks:
1. **F5 — hardened import extractor** (`lib/scan.ts`): replace the single regex with a small pattern set over comment-stripped source — static imports (bounded, safe across multiple lines), side-effect imports (`import "./x"`), re-exports (`export { x } from "./y"`), dynamic import / `require`. Residual known gap stays documented: string-literal false positives (an import mentioned inside a comment) remain until the AST unification ADR-003 already schedules for Phase 2 — don't try to fix that here.
2. **F6 — honest module resolution** (`lib/graph.ts`): read `compilerOptions.paths` from `tsconfig.json` instead of hardcoding the `@/` alias; extend `EXTENSION_CANDIDATES` with `.mjs`/`.mts`/`.cts` and the NodeNext `./x.js → x.ts` rewrite.
3. **Update the golden vectors and your F1 tests together**: every ⚠-marked row in `GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 §3.4 that says "flips after F5" gets its expected value updated in both the doc and the test file — they must never drift apart.

**Acceptance:** all F1 tests pass, including the rows that previously documented bugs on purpose; a manual check confirms an import using a `.js` extension pointing at a real `.ts` file still resolves (NodeNext case); `npx tsc --noEmit && npm run lint && npx vitest run` clean.
**You learn:** the real gap between "pattern-matching text" and "understanding structure" — this is your best first-hand evidence for why the AST chunker in Phase 2 is worth building, not just a bullet point in a design doc. Also: why sequencing matters the moment you have two independently-maintained implementations of the same logic (Node + the C++ scanner coming in Phase S).

## Phase D — Data layer (~1–1.5 weeks) *(added 2026-07-12, ADR-013)* — **DONE 2026-08-01**

**Status:** All 7 tasks complete, hand-written, live-verified end to end. `.nebulosity/nebulosity.db` holds real rows via a transactional `saveScan`/`loadGraph`; `/api/graph` is a full read-through (scan → resolveEdges → saveScan → loadGraph → toFlowGraph → getCentralFiles, the last via a real SQL `GROUP BY`); `/api/health` reports a real DB-backed `lastScanAt` (contract extended in the same change set, see `API_CONTRACTS.md` §3). Caught and fixed a real bug along the way: `scanProject`'s unnormalized Windows path separators silently dropped every edge on first live integration — see `BUGS_ENCOUNTERED.md` #3. `tsc`/lint/vitest (36/36) all clean. Next: **Phase 2**. *(Post-note, 2026-09-04: `saveScan`'s delete-and-reinsert was correct in isolation but became destructive once Phase 2 added `chunks` as a cascading child of `files` — every page load wiped the index. Rewritten as an upsert; see ADR-022 and `BUGS_ENCOUNTERED.md` #8.)*

**Goal:** build the SQLite/Drizzle data layer by hand and wire it in. **Deliberately hand-written, not generated** — the schema design and transaction logic are the learning target. See `docs/DATABASE_DESIGN.md` for the full design (tables, indexes, invalidation rules) to translate into code yourself; don't skip straight to the acceptance criteria.

Tasks:
1. **`lib/db/schema.ts`** — write the Drizzle table definitions from `DATABASE_DESIGN.md` §2 yourself: `repositories`, `files`, `imports` (get the unique/foreign-key/index choices right on your own first, then compare against the doc's reasoning).
2. **`lib/db/client.ts`** — `getDb()`: open the SQLite file, enable WAL mode and foreign keys, cache the connection so Next.js hot reload doesn't pile up handles.
3. **`lib/db/graph-store.ts`** — `saveScan` (one transaction: upsert repo, delete-then-insert files/edges) and `loadGraph`. Note for the synchronous `better-sqlite3` driver: Drizzle builders execute via `.get()`/`.all()`/`.run()`, not `await` — you will likely hit this the same way the architect draft did; that's expected, not a sign you did something wrong.
4. **Write your own smoke test** before wiring anything into the app: save a small graph, reload it, verify duplicate edges collapse and an edge to an unscanned path doesn't crash. Don't trust it until you've watched it fail once and fixed it.
5. **Extract edge resolution from `toFlowGraph`** into an exported `resolveEdges(files: ScannedFile[]): ResolvedEdge[]` in `lib/graph.ts`, and make `toFlowGraph` consume `(files, edges)`.
6. **Rewire `GET /api/graph`** as read-through: scan → `resolveEdges` → `saveScan` → build `GraphResponse` from the transaction result. `stats.centralFiles` via a SQL GROUP BY on `imports`.
7. **`GET /api/health`**: report repo `lastScanAt` and DB-backed index fields (still zero until Phase 2).

**Acceptance:** graph renders identically to Phase 1; `.nebulosity/nebulosity.db` contains real rows (verify with `npx drizzle-kit studio` or your own select script); repeated requests neither duplicate rows nor grow the DB; your smoke test passes; deleting the DB file self-heals on next request.
**You learn:** transactions, upserts, unique-index dedupe, read-through caching, and why "derived data" changes how you think about recovery.

## Phase 2 — Repository indexing (~1–1.5 weeks) — **DONE 2026-09-04**

**Status:** All 3 tasks complete and live-verified. `lib/chunks.ts` (AST chunker), `lib/index-repo.ts` (incremental pipeline) and `POST /api/index` (SSE) produce **161 chunks over 27 files** with zero errors. Every acceptance criterion checked against the running server: the stream ends with `done`; six randomly-sampled chunks open to exactly the declarations they name; an immediate second run reports all 27 `skippedUnchanged` in 16 ms with no embedding phase; editing one file re-chunked and re-embedded only that file (`changed: 1, skipped: 26`, 2 chunks embedded, only that file's rows replaced).

**Caveat on provenance:** Phases 2–4 were first written without being able to run them (the embedding model could not be downloaded), so none of it had ever executed. The audit found 18 defects including four blockers, plus two more found while fixing (`saveScan` destroying the index, migrations never running for the file DB). See `RAG_IMPLEMENTATION_REVIEW.md` for the full record and ADR-017 through ADR-023 for the decisions. The repair pass was assistant-written at the owner's explicit request, and all of it is documented.

**Goal:** the `chunks` table fills with real, correctly-bounded chunks.

Tasks:
1. **`lib/chunk.ts`:** AST chunker using the **TypeScript Compiler API** (`import ts from "typescript"` — already a dependency). Walk top-level statements of each source file; map declaration kinds to `CodeChunk.kind`; capture line ranges via `sourceFile.getLineAndCharacterOfPosition`; build the file-summary chunk; split oversized declarations (`RAG_PIPELINE.md` §2–3).
2. **Index pipeline** (`lib/index-repo.ts`): per file — sha256 → compare `files.contentHash` → skip if unchanged, else delete that file's chunks (cascade clears vectors), re-chunk, insert, update the hash. One transaction per file batch; a `meta` row (`indexing = <startedAt>`) serves as the in-progress flag instead of a lock file. Embedding is stubbed as a no-op until Phase 3.
3. **`POST /api/index`** with SSE progress events per `API_CONTRACTS.md` §4.

**Acceptance:**
- `curl -N -X POST localhost:3000/api/index` streams progress and ends with `done`.
- The `chunks` table is populated; spot-check 5 rows: line ranges open in the editor to exactly the declarations named.
- Immediate second run reports all files `skippedUnchanged` (hashes match).
- Edit one file, re-run: only that file's chunks are replaced.
**You learn:** AST parsing (the single most transferable skill in this project), content-hash invalidation, incremental pipelines over a relational store.

---

## Phase 3 — Embeddings (~0.5–1 week) — **DONE 2026-09-04**

**Status:** All 4 tasks complete and live-verified. `COUNT(vectors) === COUNT(chunks) === 161`; every decoded vector is length 384 with magnitude in `0.999999596 – 1.000000312`; all 161 embeddings are **distinct** (the check that proves vectors are serialized per-row rather than each carrying its whole batch); a warm re-index emits no `embedding` events. Model load now logs the ~25 MB first-run download so a cold start doesn't look like a hang. See ADR-017 for the tensor-decode and BLOB serialization contract.

**Goal:** every chunk has a vector.

Tasks:
1. `npm install @huggingface/transformers`.
2. **`lib/embed.ts`:** load `Xenova/all-MiniLM-L6-v2` as a lazily-initialized singleton pipeline; `embedTexts(texts: string[]): Promise<Float32Array[]>` with batching (batch 16) and unit-normalization. Build the enriched *embedding text* per `RAG_PIPELINE.md` §4.
3. **Vector persistence:** store each embedding in the `vectors` table as the `Float32Array`'s bytes (`Buffer.from(vec.buffer)`); load-all into an in-memory `Map` cached against `repositories.lastIndexAt`; record `embeddingModel`/`embeddingDim` in `meta` (mismatch → wipe derived data and rebuild, `DATABASE_DESIGN.md` §2).
4. Un-stub the pipeline: index now chunks **and** embeds; progress events include the `embedding` phase.

**Acceptance:**
- After indexing: `SELECT COUNT(*)` of `vectors` === count of `chunks`; every decoded vector has length 384 and magnitude ≈ 1.0.
- Warm re-index of an unchanged repo does zero embedding work.
- Note first-run model download (~25 MB) in the console output so it doesn't look like a hang.
**You learn:** what embeddings actually are, running an ML model in Node, batching, lazy singletons, binary serialization of typed arrays.

---

## Phase 4 — Retrieval (~0.5 week) — **DONE 2026-09-04**

**Status:** Both tasks complete. **All five acceptance queries pass at rank 1** against the live `GET /api/search`:

| query | rank 1 | score |
|---|---|---|
| "how are imports extracted from files" | `lib/scan.ts#extractImports` | 0.532 |
| "circular ring layout positions" | `lib/graph.ts#radialPosition` | 0.460 |
| "draw the star background" | `StarField.tsx#Star` (top 3 all StarField) | 0.468 |
| "chat input box" | `TerminalPanel.tsx#default` | 0.326 |
| "convert scan output to react flow" | `lib/graph.ts#toFlowGraph` | 0.564 |

`lib/retrieve.ts`'s algorithm needed no changes — dot products, the 0.25 threshold, top-k and the `lastIndexAt`-keyed cache were all correct; only the BLOB decode was wrong (ADR-017). The last query originally failed for a reason worth remembering: `toFlowGraph`'s JSDoc had drifted 50 lines up the file during the F5/F6 refactor and was sitting above `export type ResolvedEdge`, so a three-field type alias inherited the description of a function it had nothing to do with and outranked it. **Once code is embedded, a misplaced comment is a retrieval bug** — see `LEARNING_NOTES.md`.

**Goal:** semantic search works and is measurably sane — *before* any agent exists.

Tasks:
1. **`lib/retrieve.ts`:** the exact algorithm in `RAG_PIPELINE.md` §5 (embed query → dot products → top-8 → threshold 0.25 → formatted context).
2. **`GET /api/search?q=`** debug endpoint (`API_CONTRACTS.md` §6).

**Acceptance — run these five queries against Nebulosity's own code and eyeball the top-3:**
| query | must appear in top 3 |
|---|---|
| "how are imports extracted from files" | `extractImports` (lib/scan.ts) |
| "circular ring layout positions" | `radialPosition` (lib/graph.ts) |
| "draw the star background" | StarField chunk(s) |
| "chat input box" | TerminalPanel chunk(s) |
| "convert scan output to react flow" | `toFlowGraph` (lib/graph.ts) |

**You learn:** cosine similarity in practice, why top-k + threshold beats "best match", evaluating retrieval quality empirically.

---

## Phase 5 — LangGraph agent (~1.5–2 weeks, the big one)

**Goal:** a conversing agent with tools, streaming over SSE — testable entirely with `curl`, before any UI work.

Tasks:
1. `npm install @langchain/langgraph @langchain/anthropic @langchain/core zod`. Pin exact versions in package.json (LangChain moves fast; see risk register).
2. **`lib/agent/tools.ts`:** all nine tools from `AI_AGENT_DESIGN.md` §3, sharing one `safePath()` guard. Knowledge tools wrap `retrieve.ts` / `fs` / graph lookups; UI tools return their `UIAction`.
3. **`lib/agent/state.ts` + `graph.ts`:** state schema, agent/tools nodes, `shouldContinue`, `MemorySaver`, CONFIG block — exactly per `LANGGRAPH_DESIGN.md`.
4. **`lib/agent/prompts.ts`:** transcribe the verbatim system prompt from `AI_AGENT_DESIGN.md` **Appendix A** (placeholder table included there) — do not compose a new prompt.
5. **`POST /api/chat`:** `streamEvents` → SSE translation table (`LANGGRAPH_DESIGN.md` §5).

**Acceptance (scripted `curl -N` conversation against Nebulosity's own repo):**
- "Where should I start reading this codebase?" → response cites real files, includes ≥1 `ui_action` event, `sources` non-empty.
- "Which files import lib/graph.ts?" → uses `get_importers` (visible in `tool_start`), answer matches reality.
- "How does the star background avoid lagging the canvas?" → `search_code` fires; answer cites StarField with line numbers.
- Same `sessionId`, follow-up "explain that second file in more detail" → memory works (no re-asking which file).
- With `ANTHROPIC_API_KEY` unset: clean `error` event, no crash.
**You learn:** the ReAct loop for real, tool schema design, streaming architectures, prompt engineering with policies instead of vibes.

---

## Phase 6 — Connect the UI (~1 week)

**Goal:** the product moment — chat drives the graph.

Tasks:
1. **api-client module** (`app/lib/api-client.ts`): typed fetch wrappers + the ~30-line SSE reader (`API_CONTRACTS.md` §1 note).
2. **`TerminalPanel`:** replace the placeholder submit with real `/api/chat` streaming — render `token`s incrementally, `tool_start` as activity lines, `sources` as clickable chips (click → `focus_node`), `error` inline. Generate `sessionId` once per page load (`crypto.randomUUID()`).
3. **Wire `ui_action` events** into the Phase 1 `useGraphControls()` hook — the agent now highlights and focuses for real. Delete the Phase 1 dev button.
4. **Index affordance:** if `/api/health` says no index / stale, show a one-line hint in the terminal with an "index now" command that runs `/api/index` and prints progress lines in the terminal.

**Acceptance — the demo script (also your portfolio video):** open app → graph renders → type "give me a tour of this codebase" → agent highlights hub files, focuses each as it explains, cites sources; clicking a source chip focuses that node; follow-up question remembers context.
**You learn:** consuming streams in React, optimistic UI, the full loop you designed in `ARCHITECTURE.md` §6 Flow C running end to end.

---

## Phase S — Systems layer: native scanner (~1.5–2 weeks) *(added 2026-07-12, ADR-014; resequenced to run last 2026-07-20, ADR-015)*

> **Why this phase is last (ADR-015):** it is the one remaining phase that is both learning-heavy and *not* on the critical path to a working product — `lib/scanner-bridge.ts` falls back to `lib/scan.ts`, so Phases 2–6 never depend on the binary existing. Building a demoable product first (through Phase 6) and treating the C++ scanner as the deferred systems-programming showcase is the deliberate order. Its only hard prerequisite remains the P1 fixes (F5/F6).

**Goal:** hand-write a C++17 scanner with a real thread pool, compile it, prove it matches the Node scanner byte-for-byte, and benchmark it honestly. **This is the flagship learning phase of the whole project** — build it incrementally, don't write it in one sitting.

**Prerequisite:** the P1 fixes (F5/F6) must already be done. The parity harness in step 6 below diffs the C++ extractor against `lib/scan.ts`'s *current* behavior — if F5 hasn't landed yet, "parity" just means faithfully cloning bugs you'll fix later, and you'd have to redo the C++ side.

Suggested build order (each step should run and be understood before the next):
1. **Toolchain first:** `winget install Microsoft.VisualStudio.2022.BuildTools` (workload: "Desktop development with C++"), verify with a "hello world" `cmake` build before touching the real scanner.
2. **Single-threaded traversal:** walk a directory recursively with `std::filesystem`, print every source file path. Get this fully working and understood before adding any concurrency.
3. **Single-threaded import extraction:** port the Node regex's *behavior* (not its syntax — C++ doesn't have JS regex semantics) to plain string scanning. Verify against a handful of the golden vectors in `GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 §3.4 before moving on.
4. **Add the thread pool last:** an atomic counter for work-claiming, one worker per hardware core, each worker writing into its own preallocated result slot (no shared mutable state, no locks needed on the hot path — understand *why* that design avoids a mutex before you write it). This is where the real systems-programming learning is.
5. **JSON output over stdout** — the IPC half. `lib/scanner-bridge.ts` (also to be hand-written): spawn the binary, read stdout, parse JSON, and fall back to `lib/scan.ts` on any failure so the app never depends on the binary existing.
6. **Parity harness** (`scripts/parity-scan.ts`): run both engines over this repo, normalize order, diff — byte-identical `ScannedFile[]` or the phase isn't done.
7. **Benchmark harness** (`scripts/bench-scan.ts`): N warm iterations of each engine on this repo and one large repo, report medians, and write down the honest interpretation (I/O-bound vs CPU-bound) in `native/scanner/README.md` and `LEARNING_NOTES.md`.
8. Confirm `/api/health` flips `scannerEngine` native↔node when the binary is added/removed.

**Acceptance:** parity diff empty; benchmark table recorded with your own interpretation; fallback verified in both directions; `npx tsc --noEmit && npm run lint && npx vitest run` clean.
**You learn:** thread pools, atomic work-claiming, IPC over pipes, cross-engine contract testing, and how to benchmark honestly — the interview centerpiece of the systems layer.

---

## Post-v1 backlog (do not start before Phase 6 ships)

Ordered by value: session persistence (v1.1, schemas already reserved) → **file read-state tracking** (mark files read/unread as you explore — a progress overlay on the graph for onboarding; builds directly on session persistence, so it comes right after it. Open design question: what counts as "read" — auto-mark on visit vs. explicit "mark as understood" vs. a hybrid where visits auto-track and the user promotes to understood; both states user-reversible. Could feed the agent's "what to read next" so it skips already-read files) → **read-only source preview on node selection** (clicking a node reveals the file's source inline — a natural extension of the Phase 1 details strip. Supports the "understand this file" goal, but **weigh against the "Nebulosity is NOT a VS Code replacement" principle in CLAUDE.md** — keep it a *quiet, read-only peek* (no editing, syntax highlight optional, collapsible), not an IDE panel. Note the agent's `read_file` tool already reads files server-side, so the read path exists; this is purely a UI affordance) → **UI polish pass** (two known gaps from Phase 1: (1) **selected-node visual feedback** — clicking a node opens the details strip but doesn't mark *which* node on the graph; add a subtle ring/glow on the selected node, driven by `selectedId` or React Flow's built-in `.selected` class. Keep it visually *distinct* from the highlight glow — selection = "you clicked," highlight = "the agent is pointing" — e.g. a thin ring vs. the full amethyst glow, so they don't get confused when both apply to one node. (2) **overflow audit** — node labels already truncate (`FileNode` uses `truncate` + `max-w-56`), but the details strip renders the full `selectedNode.id` with no `max-width`, so a long path can stretch it off-screen; audit all text-bearing UI (strip, status bar, terminal) and truncate/wrap/scroll so nothing overflows) → graph-aware retrieval boost (`RAG_PIPELINE.md` §5) → quiz mode polish → PageRank centrality (ADR-010) → **layout upgrade + scaling tiers** (dagre in a worker, LOD/culling, directory clustering — the full plan lives in `VISUALIZATION_DESIGN.md` §3–4 / ADR-011/012; activate Tier M knobs only when a target repo exceeds ~300 files) → Electron/Tauri spike (`ARCHITECTURE.md` §7).

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| LangChain/LangGraph API churn | Phase 5 code doesn't match docs | Pin exact versions; read the installed package's own docs/types, not the web, when they disagree |
| Node/C++ extractor drift | Engines disagree silently → graph differs by engine | Golden vectors (review PART 3) apply to both; the Phase S parity harness gates every extractor change; ADR-014's revisit trigger fires on repeat breakage |
| better-sqlite3 native ABI vs Node upgrades | `npm run dev` fails after a Node version bump | Reinstall (`npm rebuild better-sqlite3`); avoid casual Node major upgrades mid-phase |
| Transformers.js first-run download | Looks like a hang | Log download progress; document in README |
| Windows path separators | Subtle id mismatches (edges/highlights silently missing) | Normalize to forward slashes at every boundary — already the convention in `lib/graph.ts`; `contracts.ts` comments make it law |
| Anthropic API cost during dev | Money | `maxTokens: 2048`, `recursionLimit: 25`, temperature 0.2; use haiku for side tasks; test tools with mocked model where possible |
| Scope creep (it's a fun project) | v1 never ships | The backlog above is the only place new ideas go |
