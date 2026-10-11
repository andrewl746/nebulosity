# ENGINEERING_DECISIONS.md — Architecture Decision Records

**Status:** Living document. Every non-obvious technical choice gets an ADR: context, the decision, alternatives *actually considered*, consequences accepted, and the concrete trigger that would reopen it. This file is also interview ammunition — each record is a rehearsed answer to "why did you do X?"

---

## ADR-001 — Single Next.js process with a core/adapter split

**Context:** An early sketch had a separate Node backend beside Next.js. The brief requires portability to a desktop runtime later.
**Decision:** One Next.js process. All business logic in framework-agnostic `lib/` (core); route handlers are thin adapters; UI talks only through JSON contracts (`ARCHITECTURE.md` §3).
**Alternatives:** (a) Separate Express/Fastify server — a second process, port, and CORS story with zero benefit at single-user scale. (b) Everything in route handlers — fast now, unportable later.
**Consequences:** Desktop migration = rewrite adapters only. Slight discipline tax: resisting `import fs` inside components.
**Revisit when:** a long-running background service is needed (e.g., a file watcher that outlives requests) — that may justify a worker process.

## ADR-002 — SSE for streaming, not WebSockets

**Context:** Agent responses, tool activity, and indexing progress must stream to the browser.
**Decision:** Server-Sent Events over plain HTTP responses from route handlers.
**Alternatives:** WebSockets — bidirectional, but Next.js route handlers can't upgrade connections (would force a custom server, violating ADR-001), and we have no server-initiated pushes: every stream is a response to a client request.
**Consequences:** `EventSource` can't POST, so the client uses `fetch` + a small stream parser (documented in `API_CONTRACTS.md` §1). One-directional only — fine for our flows.
**Revisit when:** a feature needs unsolicited server pushes (live file-watching updates to the graph).

## ADR-003 — Regex scanning stays for graph edges; AST is for chunking only

**Context:** The scanner (`lib/scan.ts`) finds imports by regex — it misses `export from`, dynamic `import()`, `require`. Phase 2 introduces real AST parsing anyway.
**Decision:** Keep the regex scanner for dependency *edges* in v1; use the AST exclusively for *chunking*. They are different jobs with different accuracy needs: a missed edge slightly degrades a picture; a mis-bounded chunk poisons retrieval.
**Alternatives:** AST-extract imports too while we're in there — correct, but couples two pipelines and grows Phase 2; the regex version is a known quantity that already ships.
**Consequences:** The graph can under-report edges (documented, visible, acceptable). Both passes read the same files; unifying them is a clean later optimization.
**Revisit when:** Phase 2 is stable — extracting imports from the AST during chunking is then a ~20-line addition to `chunk.ts`, plumbed behind the same `ScannedFile` interface so `graph.ts` never notices.

## ADR-004 — TypeScript Compiler API for AST parsing

**Context:** Chunking needs real syntax boundaries (`RAG_PIPELINE.md` §2).
**Decision:** Use the `typescript` package's compiler API directly (`ts.createSourceFile` + walking `sourceFile.statements`).
**Alternatives:** (a) **tree-sitter** — multi-language, but native modules are a known pain on Windows and we only parse TS/JS. (b) **ts-morph** — friendlier wrapper, but it's an extra dependency wrapping a tool we already ship, and the raw API is the more transferable skill (a stated project goal).
**Consequences:** More verbose code in `chunk.ts`; the verbosity is quarantined to one module. Multi-language support would require revisiting.
**Revisit when:** Nebulosity needs to scan non-TS/JS repos → tree-sitter becomes the answer.

## ADR-005 — Local embeddings (Transformers.js, MiniLM) with enriched embedding text

**Context:** RAG needs an embedding model; Anthropic does not offer embeddings.
**Decision:** `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`, in-process. Embed a constructed text (path + kind/name + doc comment + signature + truncated body), not raw source (`RAG_PIPELINE.md` §4).
**Alternatives:** Hosted embedding APIs (Voyage, OpenAI) — better quality, but adds a key, a cost, and a network dependency to the *indexing* path of a local-first tool.
**Consequences:** ~25 MB one-time model download; 256-token effective window forces the enriched-text design (which empirically helps retrieval anyway); embedding quality is "good enough" tier, not frontier.
**Revisit when:** Phase 4's five acceptance queries can't be made to pass by tuning §5 quality levers — then swap `lib/embed.ts` internals for Voyage `voyage-code-3` (the interface already fits) and wipe/rebuild the index (manifest model-mismatch rule handles this automatically).

## ADR-006 — JSON files + brute-force cosine search; no database

> **Superseded by ADR-013 (2026-07-12).** Kept for the record — the brute-force
> cosine search decision survives; the JSON *storage* does not.

**Context:** Chunks and vectors need to live somewhere queryable.
**Decision:** `.nebulosity/` JSON files, one storage module, exhaustive dot-product search in memory (`DATABASE_DESIGN.md`).
**Alternatives:** (a) SQLite (+sqlite-vec) — real DB semantics, but native dependency + SQL layer for data that fits in RAM ten times over. (b) Hosted/local vector DBs (LanceDB, Chroma) — infrastructure cosplay at 1k–5k vectors.
**Consequences & the honest math:** search is O(n·384) — ~1 ms per 1k chunks; JSON load ~35 MB at 10k chunks. Ceiling: ~50k chunks (~monorepo scale) where load time and memory get ugly.
**Revisit when:** a target repo exceeds ~10k chunks. Path: vectors to a `Float32Array` binary file first (10× smaller/faster, no new deps), sqlite-vec only after that.

## ADR-007 — Canonical ReAct graph, in-memory checkpointing

**Context:** LangGraph offers arbitrary graph shapes and pluggable persistence.
**Decision:** The minimal agent⇄tools loop (`LANGGRAPH_DESIGN.md` §3) with `MemorySaver`, `thread_id = sessionId`.
**Alternatives:** (a) Hand-rolled `while` loop — fewer deps, but forfeits checkpointing, event streaming, and the learning goal (LangGraph is named in the brief). (b) Multi-node graph with planner/summarizer up front — speculative complexity; nothing yet needs it. (c) File-backed checkpointing now — persistence work before there's a UI to benefit.
**Consequences:** Chat memory dies on server restart (acceptable single-user dev tool trade); the graph shape will need a summarize node if conversations get long enough to blow the context window.
**Revisit when:** restart-loss annoys in real use → v1.1 session files (schema already reserved in `DATABASE_DESIGN.md` §6).

## ADR-008 — UI actions are agent tools, not parsed from prose

**Context:** The agent must highlight/focus graph nodes while explaining.
**Decision:** `highlight_nodes` / `focus_node` / `clear_highlights` are ordinary tools; their executions surface as `ui_action` SSE events the client executes (`AI_AGENT_DESIGN.md` §2–3).
**Alternatives:** (a) Parse special markup out of the answer text — brittle, invisible to validation, streams awkwardly. (b) Post-hoc LLM pass to decide highlights — doubles latency and cost, decouples the highlight from the moment of explanation.
**Consequences:** Tool schemas validate node ids server-side (bad ids are filtered and reported back to the model); actions stream in-order with the narration, which is exactly the "agent points while talking" UX the brief asks for.
**Revisit when:** never, probably — this one is load-bearing and clean.

## ADR-009 — Claude via `@langchain/anthropic`, two-tier models

**Context:** LangGraph needs a chat model binding; the project already lives in the Anthropic ecosystem.
**Decision:** `claude-sonnet-5` for agent turns; `claude-haiku-4-5-20251001` for cheap side tasks (session titles, quiz grading). All model config in one CONFIG block (`LANGGRAPH_DESIGN.md` §7).
**Alternatives:** Direct `@anthropic-ai/sdk` — fine, but LangGraph's ToolNode/streaming integrations assume LangChain model bindings; hand-wiring those re-implements the framework we chose for its wiring.
**Consequences:** LangChain dependency surface (mitigated by version pinning per the risk register). Model swap = one string.
**Revisit when:** cost data from real use suggests haiku can handle whole agent turns for simple structural questions (a router node would then pick the tier — that's the ADR-007 "grow the graph" moment).

## ADR-010 — Degree centrality before PageRank

**Context:** "Which files are important?" needs a ranking (`get_central_files`).
**Decision:** in-degree + out-degree counts from the existing edge list. ~10 lines, O(E), zero deps.
**Alternatives:** PageRank — better captures transitive importance (a file imported by *important* files matters), but is an iterative algorithm to implement, test, and explain, for marginal gain at ≤ a few hundred nodes.
**Consequences:** Hub detection is naive but transparent (the counts themselves are shown to users, which degree centrality makes legible).
**Revisit when:** tested on a 500+ file repo where degree ranking visibly surfaces junk (e.g., a constants file imported everywhere but architecturally boring). PageRank drops into the same tool contract untouched.

## ADR-011 — Pluggable layout engine; dagre is the first upgrade

**Context:** The radial layout is edge-blind and misleading past ~150 nodes (`VISUALIZATION_DESIGN.md` §1). Candidates: dagre, ELK, d3-force.
**Decision:** Layout becomes a pure, pluggable core function `(nodes, edges) → positions`, selected by config. First real engine: **dagre** (layered/Sugiyama, top-to-bottom rank). Heavy layouts run in a worker with the radial result as an instant fallback; results cached keyed by a graph hash (a small table in the ADR-013 SQLite database when built).
**Alternatives:** ELK — better output, much heavier dependency; adopt only if dagre disappoints. d3-force — beautiful and on-theme but non-deterministic without seeding; kept as an optional aesthetic mode, never the default (reproducibility beats beauty in an onboarding tool).
**Consequences:** One signature change (`radialPosition(index,total)` → `layout(nodes,edges)`), then the swap surface is frozen. Position caching also buys cross-session stability.
**Revisit when:** dagre output on a ~500-file test repo reads poorly → trial elkjs behind the same interface.

## ADR-012 — Scaling via hierarchical clustering and a hard node budget

**Context:** "What happens on a massive repo?" Everything breaks in sequence — animations, DOM count, payload size, scan time (`VISUALIZATION_DESIGN.md` §4.1). No renderer makes 50k nodes *comprehensible* anyway.
**Decision:** Above a **~400 visible-node budget** (enforced server-side), the graph aggregates directories into expandable super-nodes; `GET /api/graph` gains `?root=&depth=` (reserved now, built at Tier L). Comprehension and performance are solved by the same mechanism: progressive disclosure. Full tier plan (S/M/L/XL) in `VISUALIZATION_DESIGN.md` §4.3.
**Alternatives:** (a) WebGL renderer (sigma.js) — renders 50k dots nobody can read; recorded as a Tier-XL exit ramp only. (b) Pagination/search-only — abandons the map metaphor that is the product's identity.
**Consequences:** The server always bounds payloads (crash-proofing); the client never faces unbounded DOM. Costs an expand/collapse interaction model at Tier L.
**Revisit when:** a target repo exceeds ~3k files in real use — that activates Tier L work; until then only Tier M knobs (culling, LOD, worker layout) are scheduled.

## ADR-013 — Embedded SQLite via Drizzle replaces the JSON file store (2026-07-12)

**Context:** ADR-006 chose flat JSON for simplicity at single-repo scale. Re-architecting toward a flagship portfolio piece surfaced real (not cosmetic) wins for a relational store: transactional bulk writes (a crash mid-scan can never half-save a graph), schema-enforced dedupe (unique indexes replace application-side `Set`s), indexed graph queries for the agent's tools, multi-repo as a `WHERE` clause, and a stronger Electron story (SQLite is the natural desktop store).
**Decision:** `better-sqlite3` (synchronous, prebuilt Windows binaries) + Drizzle ORM. Normalized schema in `lib/db/schema.ts`: `repositories` → `files` → `imports` (edges), plus `chunks`, `vectors` (embeddings as `Float32Array` BLOBs — ~4× smaller than JSON, zero parse cost), `meta`, and a reserved `sessions`. One DB file: `.nebulosity/nebulosity.db`, WAL mode, `ON DELETE CASCADE` throughout. All access via `lib/db/client.ts`. Scans persist as one delete-then-insert transaction (`lib/db/graph-store.ts`). Migration workflow: `npx drizzle-kit push` (dev) / `generate` (versioned).
**Alternatives:** (a) Keep ADR-006 JSON — simpler, but no transactions, no indexes, and a weaker systems story. (b) Prisma — bigger resume name, but schema DSL + codegen daemon adds magic where Drizzle stays readable TS. (c) Raw SQL — maximal learning, minimal safety.
**Consequences:** Persistence shapes move out of `lib/contracts.ts` into `lib/db/schema.ts` (contracts keeps API + domain types). The Phase 2 `storage.ts` JSON design is replaced by DB operations; the manifest's job is absorbed by `files.contentHash` + `meta` rows. Retrieval is unchanged: vectors load into memory and brute-force cosine survives (ADR-006's search half still stands).
**Revisit when:** vector search outgrows in-memory brute force (~50k chunks) → `sqlite-vec` in the same database file.

## ADR-014 — Native C++ scanner as a benchmarked accelerator, never a replacement (2026-07-12)

**Context:** The portfolio goal calls for a true systems layer: compiled C++, physical threads, OS-level filesystem work, IPC. The engineering truth: scanning a few thousand files is I/O-bound and Node does it in milliseconds, so a *replacement* would be unjustifiable in review ("why C++?" → "speed" → lost). It would also make the app's correctness depend on a compiled artifact existing.
**Decision:** `native/scanner/` — a standalone C++17 executable: single-threaded traversal, then a physical thread pool (atomic-counter work claiming, preallocated result slots, no locks on the hot path) for reads + import extraction, JSON streamed to the Node host over stdout (pipe IPC). `lib/scanner-bridge.ts` prefers the binary when present and healthy and **falls back to `lib/scan.ts` automatically on any failure** — same `ScannedFile[]` contract from both engines, semantics kept identical on purpose (the C++ matcher ports the Node regex faithfully, shared golden vectors in `GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 apply to both). Every scan reports `engine` + timing, and Phase S requires a published benchmark of both engines — the interview story is the measurement, not the rewrite.
**Alternatives:** (a) Full replacement — rejected: fragile, indefensible. (b) Rust + napi-rs in-process addon — no IPC story, heavier build coupling with Node ABI. (c) Node `worker_threads` — parallelism without any systems-layer learning.
**Consequences:** Two implementations must stay semantically identical — any extractor bug fix (e.g. review items W1/W2 via F5) must land in both engines and the shared vectors. The toolchain (MSVC Build Tools + CMake) is optional: no compiler, no binary, app runs on Node engine forever.
**Revisit when:** parity between engines breaks twice in one phase — that's the signal maintaining two extractors costs more than the story earns, and the C++ scanner should either own extraction outright or be retired to a benchmark artifact.

## ADR-015 — Phase S (native scanner) resequenced to run last (2026-07-20)

**Context:** The original roadmap ran Phase S (C++ scanner) immediately after Phase D, before the indexing/embeddings/retrieval/agent/UI phases (2–6). That ordering optimized for building the two extractor implementations close together (F5 → Node hardening → C++ port). But the project owner is an incoming Waterloo CS student whose first co-op application cycle (~Jan 2027) sets a real deadline: the highest-value outcome is a *demoable end-to-end product* before then. Phase S is the one remaining phase that is both learning-heavy (its bottleneck is concepts clicking, not hours, so it resists a faster summer pace) and **not on the critical path to a working product** — `lib/scanner-bridge.ts` falls back to `lib/scan.ts` (ADR-014), so nothing in Phases 2–6 depends on the binary existing.
**Decision:** Move Phase S to the end of the roadmap: 0 → P0 → 1 → P1 → D → 2 → 3 → 4 → 5 → 6 → **S**. Phase D stays before Phase 2 (the data layer *is* on the critical path). Phase S's only hard prerequisite is unchanged — the P1 fixes (F5/F6) must land first so the parity harness diffs against the hardened extractor, not against bugs slated for removal.
**Alternatives:** (a) Keep S right after D — clean "build both extractors together" narrative, but it parks a wall-hitting, non-demo-critical phase directly in front of the product work, risking a stalled path to demo exactly when coursework slows the pace. (b) Drop S entirely — loses the flagship systems-programming interview piece for a marginal schedule gain; the fallback design means deferring costs nothing, so cutting is strictly worse.
**Consequences:** The window in which two extractors (Node + C++) are maintained in parallel opens later and is shorter — strictly safer for drift (ADR-014's revisit trigger). The interview story is unchanged: S is deferred, not dropped. `IMPLEMENTATION_ROADMAP.md`, `CLAUDE.md`, and `EXECUTION_PROMPTS.md` were updated in the same change set per the maintenance rule.
**Revisit when:** Phase 6 ships demoable well ahead of schedule and there's appetite to start the systems layer sooner — pulling S earlier is always safe, since it depends only on F5/F6.

## ADR-016 — Hardened regex extractor (F5) + injected tsconfig aliases (F6) (2026-07-26)

**Context:** The P1 fixes (`GRAPH_IMPLEMENTATION_REVIEW.md` F5/F6) closed the last known gaps in the regex scanner before any downstream layer builds on it. The single import regex missed multi-line, side-effect (`import "./x"`), re-export (`export … from`), and dynamic/`require` imports; module resolution hardcoded the `@/` alias and couldn't resolve NodeNext `./x.js → x.ts`. This ADR records two sub-decisions with consequences beyond "fix the bug."
**Decision:** (1) **F5 strips comments.** The extractor is now a small pattern set (static+re-export / side-effect / dynamic+require) run over *comment-stripped* source. Comment-stripping deliberately **overrides golden vector `§3.4` row 209**, which had predicted F5 would leave the `// import …` comment false-positive unfixed — stripping fixes that whole class cheaply, so the row now expects `[]`. The documented residual is narrower: *string-literal* false positives (import-looking text inside a string), which only the AST can resolve — squarely under ADR-003. (2) **F6 injects aliases; `graph.ts` stays filesystem-free.** `tsconfig.compilerOptions.paths` is read *server-side* (`readTsconfigAliases` in `lib/scan.ts`) and the resulting alias map is passed as data into the pure `resolveImport`/`toFlowGraph` (new third `aliases` param). The pure resolution module never imports `fs`, preserving its client-importability (ADR-001 discipline).
**Alternatives:** (a) Read `tsconfig` inside `graph.ts` — rejected: pulls `fs` into the module the whole architecture keeps pure/client-safe. (b) Don't strip comments (honor row 209 as-is) — rejected: leaves a false-positive class the F5 spec already called to remove, for no saving. (c) Full JSONC parsing of `tsconfig` — deferred: `JSON.parse` in a try/catch is enough for clean configs; a repo using comments/trailing commas in `tsconfig.json` currently falls back to no aliases (relative + bare imports still resolve).
**Consequences:** Golden vectors and F1 tests were updated in the same change set (`§3.4` comment row → `[]`, a string-literal residual row added; `§3.3` gains the `aliases` third arg). `resolveImport`'s signature changed (contract note in `§3.3`). String-literal false positives remain the one documented extractor gap — the concrete evidence for why the ADR-003 AST unification is worth building. The old duplicate `scripts/scan.ts` was deleted (closes the F8 "scripts imports from lib" dedupe by removal, not extraction).
**Revisit when:** ADR-003's AST unification lands — the exact parser retires this regex set and closes the string-literal residual; or enough scanned repos use JSONC `tsconfig.json` to justify a real JSONC parser in `readTsconfigAliases`.

## ADR-017 — Vector serialization lives in one encode/decode pair (2026-09-04)

**Context:** Phases 3 and 4 each converted between `Float32Array` and SQLite BLOB inline, at their own call site, and each got it wrong in a different direction (`RAG_IMPLEMENTATION_REVIEW.md` R3/R4). The write side passed `vector.buffer` — the *whole* backing ArrayBuffer, not the view's window — so a batched vector would have serialized its entire batch. The read side passed `buf.byteLength` as the `Float32Array` constructor's third argument, which counts **elements**, not bytes, throwing `RangeError` on the first row ever decoded. Separately, `embedTexts` guessed at the pipeline's output shape with a four-branch `Array.isArray`/`instanceof` ladder; transformers.js actually returns one `Tensor` per *batch* with `dims: [rows, 384]` and a flat row-major `data`, so the ladder fell into its object branch and pushed the whole batch as a single 6144-float "vector".
**Decision:** One exported inverse pair in `lib/embed.ts` — `encodeVector` (passes offset+length so a view serializes only itself) and `decodeVector` (allocates a fresh `Float32Array` and copies the bytes in). Both call sites use them; neither does its own conversion. `embedTexts` reads `dims` and slices `data` into rows, asserting the shape rather than branching on it, and uses `.slice()` (a copy) not `.subarray()` (a view) so each vector owns its memory.
**Alternatives:** (a) Keep the conversions inline but fix them — rejected: the bug was *duplication*, not arithmetic; two inverse operations in two files drift. (b) Decode as a view over the Buffer for speed — rejected: Node serves small Buffers from a shared pool, so `byteOffset` is frequently not 4-byte aligned, and that constructor rejects unaligned offsets. The failure would be intermittent and allocation-history-dependent, which is far worse than a deterministic one. (c) Store vectors as JSON arrays — 4× larger with a parse cost, already rejected by ADR-013.
**Consequences:** Vector storage format is now stated in exactly one place. The copy in `decodeVector` costs one allocation per chunk at cache-build time, which is negligible against the model inference that produced it. Any future storage change (quantization, `sqlite-vec`) has a single seam.
**Revisit when:** vectors move into `sqlite-vec` (ADR-013's revisit trigger) — that owns its own serialization and retires this pair.

## ADR-018 — A chunk spans its declaration *and* its attached leading comment (2026-09-04)

**Context:** The chunker computed `startLine` from `node.getStart()` (which skips leading trivia) but `text` from `node.getFullText()` (which includes it), so the two described different regions. Consequences compounded: the Phase 2 acceptance criterion "line ranges open to exactly the declarations named" was unsatisfiable; `buildEmbeddingText` took `text.split("\n")[0]` as the signature and got a blank line or `/**` for every documented declaration, discarding the single most identifying line in the chunk; and the splitter mapped offsets in a `getFullText()` string onto a `getStart()`-derived line number.
**Decision:** One span function, `chunkSpan`, used for `startLine`, `endLine` **and** `text`. It returns the declaration plus its attached leading comment block: walk `ts.getLeadingCommentRanges` backwards, keeping only comments separated from what follows by at most one line break. A blank line means the comment is detached and belongs to whatever preceded it. `buildEmbeddingText` finds the signature as the first line that is actual code rather than assuming line 0.
**Alternatives:** (a) `getStart()` everywhere — consistent, but drops the doc comment, which `RAG_PIPELINE.md` §4 explicitly wants in the embedding text and which `extractDocComment` reads out of `chunk.text`. (b) `getFullStart()` everywhere — consistent, but swallows blank lines and any detached comment above them, so a file header would be absorbed into the first declaration. (c) Keep `getFullText()` for text and widen the line range to match — same over-capture as (b).
**Consequences:** Retrieval keeps the doc comments it depends on while line ranges stay honest enough to open in an editor. Only JSDoc and contiguous `//` blocks are captured; a comment deliberately separated by a blank line is treated as not belonging to the declaration, which is a judgement call the blank line makes explicit.
**Revisit when:** a source style shows up where blank lines routinely separate a doc comment from its declaration — then attachment needs a smarter rule than line-break counting.

## ADR-019 — Chunk ids disambiguate repeated names with a `~n` marker (2026-09-04)

**Context:** `chunks.chunk_id` is UNIQUE and ids are `${filePath}#${name}#${partIndex}`. TypeScript legitimately repeats a top-level name — overload signatures, interface/namespace/function declaration merging, ambient `.d.ts`. A collision failed the batch insert for the *entire file*, which the pre-ADR-022 hash ordering then converted into a permanent skip.
**Decision:** After chunk extraction, walk the file's chunks and give the second and later occurrences of a name a `~n` suffix **on the id segment only** — `lib/x.ts#foo~2#0`. The `name` field is untouched, so nothing user-facing changes.
**Alternatives:** (a) Scope the unique index to `(fileId, chunkId)` — doesn't help; the collision is *within* one file. (b) Put the start line in the id — unique, but no longer stable across runs for an unchanged file, which is the property the id contract promises. (c) Suffix the display name — leaks a storage concern into what the agent shows the user.
**Consequences:** Ids stay stable and human-readable for the overwhelmingly common single-declaration case, and only degrade in the rare merged case. The contract comment in `lib/contracts.ts` documents the marker.
**Revisit when:** the chunker starts descending into nested scopes, where name repetition becomes normal rather than exceptional and a path-based id would beat an occurrence counter.

## ADR-020 — Re-exports live only in the file-summary chunk (2026-09-04)

**Context:** The chunker handled function/class/variable/interface/type and silently produced nothing for `enum`, `namespace`, `export default <expression>`, or `export { x } from "./y"`. A file of only those yielded one chunk: the file summary.
**Decision:** Add `enum` and `namespace` to `ChunkKind` and chunk both; chunk `export default <expression>` as a `const` named `default`. Deliberately do **not** give `export { x } from "./y"` a chunk of its own — it carries no implementation, and the file-summary chunk already lists every re-export, which is the genuinely useful retrieval unit for a barrel file.
**Alternatives:** (a) Map enums and namespaces onto existing kinds (`type`/`const`) — avoids touching the contract, but loses the distinction the agent would want when explaining a file. Extending the union turned out to be free: Drizzle's SQLite `text({ enum })` is a TypeScript-level constraint that emits no `CHECK`, so no migration was needed. (b) Chunk each re-export line — produces many near-identical one-line chunks that compete with the summary for the same query.
**Consequences:** `ChunkKind` gains two members; the DB column needed no change. A barrel file is represented by exactly one chunk, which is the right granularity but means a query naming a specific re-exported symbol matches the whole barrel rather than that line.
**Revisit when:** retrieval evaluation shows barrel files being retrieved for symbols they only forward — that's the signal re-exports need their own chunks after all.

## ADR-021 — The index `done` event reports per-file failures (2026-09-04)

**Context:** Indexing is per-file error-tolerant (one unreadable file must not sink a run, per F2). But `API_CONTRACTS.md` §4's `done` payload carried only `fileCount`/`chunkCount`/`skippedUnchanged`/`tookMs`, so a run in which *every file failed* was indistinguishable from a clean one. That is exactly what happened when the `vectors` table was missing: the run reported success and stamped `lastIndexAt` while 100% of files errored.
**Decision:** Extend the `done` payload with `changed`, `errors[]` and `warnings[]`, typed in `lib/contracts.ts` and documented in `API_CONTRACTS.md` §4. Error tolerance without error *reporting* is just silent data loss.
**Alternatives:** (a) Emit a separate `error` event per failed file — but §4 defines `error` as terminal, and these runs are not terminal. (b) Log server-side only — invisible to the client that asked for the work.
**Consequences:** `done` is wider than the original spec. Clients reading only the four original fields are unaffected.
**Revisit when:** a UI indexing panel exists — it may want incremental per-file failure events rather than a batch at the end.

## ADR-022 — `saveScan` upserts; `contentHash` is owned by the indexer (2026-09-04)

**Context:** `saveScan` (Phase D) ran `DELETE FROM files` and reinserted every row on **every** `GET /api/graph`, stamping each row with the file's current content hash. Phase 2 then added `chunks` as a child of `files` with `ON DELETE CASCADE`, and `vectors` as a child of `chunks`. Neither phase was wrong alone; together they were fatal in two ways. First, loading the graph page destroyed the entire search index. Second, writing the current hash at *scan* time told the indexer every file was already up to date, so `chunks` could never fill — the indexer skipped all 27 files on its first real run. This was invisible for weeks because embedding was independently broken (ADR-017), so nobody ever got far enough to notice.
**Decision:** `saveScan` upserts on `(repoId, path)`, updating only `kind`, and deletes only files that actually vanished from disk. It no longer writes `contentHash` at all — new rows get `""`. `contentHash` now has exactly one writer, `indexRepo`, and exactly one meaning: **the hash the indexer last successfully processed**. `ScanFileInput` dropped the field so the scan path cannot supply it by accident. Because file rows now survive a scan, `imports` is cleared explicitly rather than relying on the cascade.
**Alternatives:** (a) Keep delete-and-reinsert and re-index after every scan — turns a page load into a full embedding run. (b) Give scanning its own `scanHash` column beside `contentHash` — two hashes of the same bytes, and the ambiguity that caused this bug returns the first time someone reads the wrong one. (c) Drop the cascade from `chunks.fileId` — breaks genuine deletion, where chunks describing a removed file *should* go.
**Consequences:** File ids are now stable across scans instead of churning every request, which is a precondition for anything that references a file row over time. A field with two writers and two meanings was the root cause here; the fix is single ownership, stated in the schema comment and enforced by the input type.
**Revisit when:** a second producer legitimately needs to record file state (e.g. a watcher marking files dirty without indexing them) — that wants its own column, decided deliberately rather than by overload.

## ADR-023 — Migrations run on every database open (2026-09-04)

**Context:** `lib/db/client.ts` ran `migrate()` only when the path was `:memory:`, i.e. only under Vitest. The file database was migrated out-of-band by hand. Two failures followed. Phase D's acceptance criterion "deleting the DB file self-heals on next request" was false — a fresh file had no tables at all. And when Phases 2/3 added `chunks`/`meta`/`vectors` to the schema without running `drizzle-kit generate`, the drift was undetectable: the tests were the only thing running migrations, and they only touched the three tables the one existing migration created. The live database ended up with `chunks` but no `vectors`.
**Decision:** Call `migrate()` unconditionally in `createDb`. Drizzle records applied migrations in its own table, so this is idempotent and near-free on an already-current database.
**Alternatives:** (a) A separate `npm run migrate` step — correct for a deployed multi-instance service, but this is a single-user local tool where a forgotten step is the whole failure mode. (b) `drizzle-kit push` in dev — no versioned history, and it is what let the schema drift in the first place.
**Consequences:** The schema is now self-healing and migrations are exercised on every run, including by the test suite against a real migration file. `drizzle-kit generate` after a schema edit is still required — the guard against forgetting it is that the tests now fail rather than silently passing.
**Revisit when:** Nebulosity ever runs as more than one process against one database file, where concurrent migration needs a lock. *(Fired 2026-10-11: the MCP server is a second process. Answered by ADR-030: the MCP server opens read-only and never migrates.)*

## ADR-024 — Pivot to a code-intelligence companion for massive codebases (2026-10-11)

**Context:** On small repos Claude Code already does everything Nebulosity v0 did (chat over retrieved chunks plus a file graph), so only the visualization was distinctive. Claude Code's per-session agentic search is strong on local questions and weak on big-picture, complete-list and repeated questions over massive repos. Measured on VS Code (14,615 TS files): with existing code, structure is ready in ~35 s, and tiered summaries cost about $10 once. `VISUALIZATION_DESIGN.md` §4.3 had declared repos over 50k files a product boundary.
**Decision:** Nebulosity becomes an engine that precomputes a persistent, hierarchical, exact model of a repo: structure, summaries, search and the dependency graph, with calls, history and clusters later. It's exposed to agents through an MCP server and to people through the Map. It's a companion to Claude Code, not a competitor, and VS Code is the demo repo. Scale is handled by aggregation (ADR-029), not by declining big repos, which reverses the Tier XL boundary. Full design: `PIVOT_SPEC.md`.
**Alternatives:** (a) A standalone Claude Code replacement: it would compete on the agent loop, where Anthropic's harness and models win, and it's harder to adopt. (b) A map-only explorer: no agent integration and no measurable proof. (c) Continue Phases 5/6: that ships a product strictly weaker than Claude Code on its own repo.
**Consequences:** Phases 6 and S are superseded. Phase 5's orchestration design survives as extra E1 (the Guide). Most `lib/` implementation files are rewritten (`PIVOT_SPEC.md` §3), while the layering, the contracts discipline, the SQLite store, the incremental-indexing pattern and UI-actions-as-tools carry over. An evaluation against Claude Code alone is part of v1's definition of done.
**Revisit when:** the eval shows Nebulosity's tools don't improve Claude Code's answers on VS Code. At that point the value proposition itself, not just the tuning, needs rethinking.

## ADR-025 — Drop the native C++ scanner (2026-10-11) — supersedes ADR-014 and ADR-015

**Context:** ADR-014 justified the C++ scanner only as a benchmarked accelerator, and ADR-015 deferred it to last. v1 parses with the TypeScript Compiler API (all of VS Code in 22.3 s, single-threaded), so there's no measured bottleneck for a native scanner to remove. The regex extractor it was meant to port is being retired anyway (ADR-026).
**Decision:** Drop Phase S. Remove `native/` and the never-built `scanner-bridge` design. If indexing ever becomes CPU-bound, parallelize in Node with worker threads first.
**Alternatives:** (a) Keep it as a learning showcase. The owner decided it isn't worth the time before applications. (b) Rebuild it on tree-sitter's C API. Possible later, but only if a measurement demands it.
**Consequences:** The C++ systems-programming talking point is gone; worker threads can bring back a concurrency story. `HealthResponse.scannerEngine` goes away along with `/api/health`, which is replaced by `/api/status`. Docs that mention the bridge are corrected as their slices land.
**Revisit when:** a profile on a real target repo shows parsing dominates and worker threads aren't enough.

## ADR-026 — TypeScript Compiler API behind a language-adapter seam; imports come from the AST (2026-10-11)

**Context:** Two earlier decisions carried revisit triggers this pivot fires. ADR-003 kept the regex scanner for edges ("revisit once Phase 2 is stable"). ADR-004 chose the TS Compiler API for chunking ("non-TS repos → tree-sitter"). ADR-016 documented the regex extractor's remaining gap: false positives from string literals. The first target, VS Code, is TypeScript.
**Decision:** v1 parses every file once through a single TypeScript adapter (`ts.createSourceFile`, no type checker), producing chunks, symbols (class members included), imports and metadata. The regex extractor is retired. A `LanguageAdapter` interface (parse → chunks, symbols, imports, and later calls) is where tree-sitter adapters plug in (E4). Import resolution reads the nearest `tsconfig.json` so monorepos work.
**Alternatives:** (a) tree-sitter for everything now: multi-language from day one, but it adds WASM grammar setup and buys nothing VS Code needs. Deferred to E4. (b) Keep regex imports: known false positives, and a second pass over every file.
**Consequences:** One parse per file instead of parse plus regex. The regex-extractor golden vectors (`GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 §3.4) retire, while the resolver vectors (§3.3) stay relevant. The type checker is reserved for E2's call graph.
**Revisit when:** E4 starts, or a TS/JS repo turns up that the syntax-only adapter misreads.

## ADR-027 — Search backbone: summaries + FTS5 + graph, embeddings over summaries, merged with RRF (2026-10-11)

**Context:** ADR-005/006/013 built chunk-level vector RAG with brute-force search, with a revisit trigger at about 50k chunks. VS Code has 101,603 chunks. At the measured ~18 chunks/s, embedding them takes about 94 minutes, and the in-memory cache would hold every vector and every chunk's text. Code questions mix exact identifiers, where keyword search wins, with concepts, where embeddings win.
**Decision:** Search merges three ranked lists with Reciprocal Rank Fusion (k = 60): BM25 over a code FTS5 index (with camelCase-split names), BM25 over a summary FTS5 index, and cosine similarity over embeddings of **summaries, not chunks**. The existing MiniLM pipeline and the ADR-017 encode/decode pair are reused unchanged. The chunk `vectors` table retires.
**Alternatives:** (a) Chunk embeddings in sqlite-vec: fixes the memory problem but not the 94-minute embedding cost. (b) Keyword search only: misses conceptual questions. (c) A hosted embedding model: adds an API key and a network dependency to indexing.
**Consequences:** Keyword search works seconds after the structure stage, and results improve as summaries and their vectors arrive. About 15–20k summary vectors stay comfortably within brute-force range. RRF combines lists without calibrating their scores against each other. *(Amended 2026-10-11 in slice V1.2: fusion works on files and folders. Code hits are grouped by file before ranking, so a file with ten matching chunks counts once per list. Each list contributes its top 50, and vector matches below cosine 0.25 are dropped. Queries keep their non-stopword words, quoted and ORed, plus the parts of identifiers. See `RAG_PIPELINE.md` §6.)*
**Revisit when:** the eval shows conceptual questions failing. Then try a code-specific embedding model, or chunk embeddings for the most-used areas only.

## ADR-028 — Tiered summaries through the Batch API, with lazy folder refresh (2026-10-11)

**Context:** The Map and the MCP tools are only as useful as their summaries. VS Code is ~199 MB of TypeScript, about 50M tokens if every file were summarized in full. The owner chose the model split: Haiku 5.5 for most of the work, and Sonnet 5.5 for the folder summaries people read first.
**Decision:**
- File summaries use `claude-haiku-5-5`. Input is capped at about 6k tokens per file. Test files get a template summary and no API call.
- Folder and repo summaries use `claude-sonnet-5-5`, built bottom-up from the summaries of their contents.
- The first full pass goes through the Message Batches API at half price. Incremental and on-demand work uses the regular API.
- Output is structured as `{ tagline, summary }`.
- `inputHash` (model + prompt version + input) stops identical input from being summarized twice.
- After an edit, a file's summary refreshes once the file has been quiet for 60 s. Its parent folders are marked stale and refresh lazily, when someone views them or during a periodic sweep.
**Alternatives:** (a) Haiku everywhere (~$3): cheapest, but weaker synthesis exactly where it's most visible. (b) Sonnet or Opus everywhere (~$60 / ~$120): declined by the owner on cost. (c) Refresh folders eagerly: one `git pull` would trigger hundreds of Sonnet calls.
**Consequences:** The full pass is estimated at ~$8–10 for VS Code. Each edited file costs a fraction of a cent, plus about 1 cent per folder that's actually viewed. Indexing without an API key still produces structure, search and dependencies; summaries just show as `off`. *(Amended 2026-10-11 in slice V1.2: the run mechanics are ADR-033.)*
**Revisit when:** the day-1 side-by-side shows Haiku's file summaries are too generic, or Batch turnaround routinely exceeds a few hours.

## ADR-029 — The Map: levels, lenses, on-demand panels, a 50-box cap and pre-aggregated level edges (2026-10-11) — supersedes ADR-012's tier plan; keeps ADR-011's dagre choice

**Context:** A file-level graph of VS Code is unreadable (`workbench → base` alone is 20,648 import statements) and too large for a DOM-based canvas. ADR-012 proposed directory clustering with a ~400-node budget and ruled Tier XL out of scope. The owner wants a revamped UI that stays uncluttered as features are added.
**Decision:**
- The Map shows one level of the folder tree at a time: repo → folders → files, with functions reached through E2's call flow.
- No more than 50 boxes are ever on screen; the overflow folds into a "+N more" box.
- Edges between sibling boxes come from a precomputed `level_edges` table. Each import is counted once, at the level of the deepest folder containing both ends, so a click costs one indexed lookup.
- Only the selected box's edges are drawn at full strength.
- New features arrive as lenses (Structure, History, Clusters), one active at a time, never as extra panels. Panels open only when needed.
- The dark amethyst look stays, and React Flow + dagre stay.
**Alternatives:** (a) Draw the whole graph with WebGL (sigma.js): it would render 100k dots nobody can read. (b) ADR-012's clustering above a 400-node budget: still allows 400 boxes, which is too dense to read. (c) A search-only UI: abandons the map, which is the product's identity.
**Consequences:** Performance is bounded by design (≤ 50 nodes, ≤ 50 ms level loads), and there's a measured acceptance budget of ≤ 100 ms per interaction. Very large folders depend on the "+N more" behavior being good. The owner lifted the visual-design-frozen rule for this revamp.
**Revisit when:** users regularly need to compare boxes from different branches of the tree side by side. A pinned multi-level view would be the next step.

## ADR-030 — One tool registry, two adapters, and install-relative paths (2026-10-11)

**Context:** Two agents need the same knowledge. Claude Code connects from outside through MCP, launched from the user's repo; the Guide (E1) runs in-process on LangGraph. `lib/agent/tools.ts` mixes tool logic with LangChain wrappers. `lib/db/client.ts` resolves the database and migrations relative to `process.cwd()`, and when Claude Code launches the MCP server, that directory is the user's repo. ADR-023's multi-process revisit trigger also fires here.
**Decision:**
- Each tool is defined once in `lib/tools/registry.ts`: a name, a description written for LLMs, a zod schema, and a handler that calls the engine.
- The MCP server registers those entries, and the Guide wraps the same entries as LangChain tools.
- The database, migrations and config resolve from `NEBULOSITY_HOME`. When it's unset they fall back to `process.cwd()`, which is correct for Next.js, the CLI and Vitest because all three run from the checkout. The MCP launcher (V1.4) always sets it. *(Amended 2026-10-11 in slice V1.1: the original default, the module's own location, breaks under Next.js, which bundles server modules into `.next/`.)*
- The MCP server opens the database read-only and never migrates.
- MCP tool calls notify the open Map through a localhost-only live channel, and `show_on_map` reuses the UIAction contract (ADR-008).
**Alternatives:** (a) Route the Guide through the MCP server too: guaranteed parity, but an extra process and protocol hop for what is an in-process call. (b) A separate tool set per agent: the drift this ADR exists to prevent.
**Consequences:** Each new capability (call graph, history, clusters) reaches both agents from one definition. The MCP server runs correctly from any working directory because its launcher sets `NEBULOSITY_HOME`, and schema changes have a single owner.
**Revisit when:** a third interface needs the tools (for example a REST API for another app). It becomes a third adapter over the same registry.

## ADR-031 — Full-text indexes are kept in sync by triggers (2026-10-11)

**Context:** V1.2 adds two FTS5 indexes: code (`code_fts`, over chunks) and summaries (`summary_fts`). A chunk disappears in four ways: its file is re-parsed, its file is deleted, its repository is deleted, or the Phase 2 pipeline (`lib/index-repo.ts`, retired in V1.3) rewrites it. Only the first passes through the new structure store, and two of the others are `ON DELETE CASCADE` deletes that no application code sees.
**Decision:**
- Both indexes are regular FTS5 tables whose rowid is the source row's id.
- `AFTER INSERT`/`AFTER DELETE` triggers on `chunks` keep `code_fts` in sync. `AFTER INSERT`, `AFTER UPDATE OF tagline, summary` and `AFTER DELETE` triggers on `summaries` keep `summary_fts` in sync.
- The camelCase split of a chunk's name needs JavaScript, so it is computed once at write time and stored on the chunk (`chunks.name_split`), where the insert trigger can read it.
- Both tables use the `porter unicode61` tokenizer and keep their bm25 column weights as the `rank` setting.
**Alternatives:** (a) Explicit writes in the structure store: misses cascades and the old pipeline, so deleted code would keep turning up in search. (b) External-content tables: no duplicate text, but deleting a row needs its old values, which a cascade has already removed. (c) Contentless tables (`contentless_delete=1`): smaller, but `snippet()` stops working and snippets would need their own code.
**Consequences:** The search indexes can't drift from the data, whichever path changes it. The text is stored twice (the pivot spike measured 211 MB for VS Code's chunks), and every chunk insert also writes an FTS row: measured on VS Code, the cold write stage went from 13.1 s to 27.4 s, and the structure stage still passed S1 at 56.4 s (BENCHMARKS.md, Index Benchmark #2). Migration 0004 clears every content hash once, so existing chunks get indexed on the next run.
**Revisit when:** database size starts to matter, or the FTS writes push S1 past 60 s.

## ADR-032 — Stage status lives in `meta`, and a silent "running" means a crash (2026-10-11)

**Context:** `PIVOT_SPEC.md` §5.7 asks for `idle | running | ready | off | failed` per stage, with progress, at `GET /api/status`. Stages run in different processes: the CLI now, a server worker from V1.3. A killed process never gets to write "failed".
**Decision:** Each stage writes `stage:<repoId>:<stage>` in `meta` as it goes, at least once a minute while running. Readers report a `running` row untouched for 5 minutes as `failed`, with the note `interrupted: no progress since <time>`. The one exception is a summaries stage with requests still at Anthropic: that work goes on without any local process, so it stays running (added with ADR-033).
**Alternatives:** (a) Derive every state from the data: honest by construction, but it can't show a running stage's progress. (b) Record process ids and check them: breaks across reboots and machines.
**Consequences:** No state can stick at "running" forever, and the route needs no knowledge of which process runs which stage.
**Revisit when:** a stage legitimately goes quiet for minutes (it must then write a heartbeat), or V1.3's UI needs pushed updates instead of polling.

## ADR-033 — Summary runs: bottom-up waves, a transport per wave, batch ids on the rows (2026-10-11)

**Context:** ADR-028 fixed the models, the Batch API for the first pass, `inputHash` caching and lazy folder refresh. Implementing it raised three questions:
- Folders need their children's summaries first, so the first pass can't be a single batch.
- A batch takes minutes to hours, and the process waiting on it may die.
- Two runs at once would pay twice.

**Decision:**
- **Waves.** A run is a loop of waves. Each wave plans every target with a pure function (`planSummaries`), sends whatever is ready, then waits for batches still at Anthropic.
  - Files are always ready.
  - A folder is ready when none of its children still waits for a model. A child that failed this run counts as done, shown as "no summary yet".
  - VS Code's first pass takes about a dozen waves, as many as its folder tree is deep.
- **A transport per wave.** 100 or more requests go through the Batch API, in batches of up to 5,000. Smaller waves use the regular API with 4 requests in flight and the SDK's own retries (`maxRetries: 3`, honouring `retry-after`). The small waves at the top of the tree then take seconds instead of a batch round-trip each.
- **Batch ids on the rows.** A submitted request is recorded on its summary row (`batch_id`, `pending_hash`), not in a jobs table. Any later run finds the batches still at Anthropic, collects them and carries on. `--no-wait` never sleeps: it collects the batches that have already ended, submits what that makes ready, and exits. An answer only lands if its batch still owns the row. A batch Anthropic no longer has (404) has its rows marked failed and is resent on the next run.
- **Polling.** A poll that errors (a dropped connection, a laptop waking from sleep) is a missed poll: the run says so and asks again on its next pass. A pass in which no batch could be checked counts as one miss, however many batches are in flight, and any answer (still processing, ended, or gone) resets the count. The run stops after 5 missed passes in a row (`MAX_MISSED_POLLS`), or at once when Anthropic rejects the key (401/403). The batches are still at Anthropic then, so the stage stays `running`, with a note saying how to collect them. `--no-wait` doesn't sleep, so a batch it couldn't check waits for the next run.
- **Submitting.** A batch that can't be submitted ends the run. Its rows stay pending (not failed, not claimed), batches submitted earlier stay at Anthropic for the next run, and no folder is summarized over placeholders. If Anthropic accepted the batch but recording it on its rows fails (SQLITE_BUSY while `npm run index` holds the write lock, say), the run prints the batch id and puts it in the error before stopping. Creating a batch is never retried automatically (`maxRetries: 0`): after a lost reply, a retry would create a second batch that's billed and never collected, so the run stops instead and the next run resubmits once.
- **Structure first.** A run refuses to start while the structure stage is running or failed. A repo indexed before stage status existed has no structure row; that counts as ready.
- **A circuit breaker.** After every wave and every collected batch (a released 404 batch included), if at least 10 requests failed and they were more than half of it, the run stops before planning another wave. The cause is then almost certainly shared (a rejected key, an outage, files edited since indexing), and failed children count as settled, so carrying on would summarize their folders over "no summary yet" and pay for those folders again. The stage reads `failed`, or `running` with batches still at Anthropic, with a note starting `stopped:`; the failures are retried next run.
- **A lock.** A `summarizing` lock (the same race-safe `meta` row as the index lock, refreshed while waiting) stops a second run from paying twice. It doesn't block indexing.
- **Templates and hashing.** Test files get a template (status `skipped`, model `template`). A file's `inputHash` hashes its content hash instead of its rendered prompt. That's equivalent, because the prompt is a pure function of the bytes and `PROMPT_VERSION`, and it means planning never reads source files.
- **Request settings.** Effort `low` with adaptive thinking (the models' default), structured outputs for `{ tagline, summary }`, and `max_tokens` 4,096. Sonnet requests on the regular API carry the server-side refusal fallback (`fallbacks: "default"`). The Batches API rejects that parameter, and Haiku 5.5 has no fallback.

**Alternatives:** (a) One batch for everything, with folders summarized from raw file text: no bottom-up synthesis, and much bigger folder inputs. (b) A jobs table: more state to keep consistent with the rows it describes. (c) Batch-only: each of the dozen top waves could wait hours.
**Consequences:** A crash costs the requests in flight on the regular API; batch requests are collected rather than resent. The one gap is a batch caught between Anthropic accepting it and the run recording it: a failed recording names the batch, but a killed process or a lost reply leaves a batch nothing here can name, and its requests are paid for again when the next run resends them. A wave or batch where most requests fail (at least 10) stops the run before any folder is summarized over those failures. API spend is recorded per model and transport (`summary_usage`), which is how S2 is measured.
**Revisit when:** waves cost too much wall time on a deeper repo (then submit folders speculatively), or refusals become common.

---

## Decisions inherited from the existing codebase (pre-dating this doc set)

- **Radial ring layout is a placeholder** — deterministic, overlap-free, edge-blind. Replacement path is now formalized in ADR-011 and `VISUALIZATION_DESIGN.md`; the swap surface is one pure function (`radialPosition`).
- **Node id = project-relative file path** — the quiet keystone: graph nodes, chunks, tool args, sources, and highlights all join on this key. Preserve it in every future subsystem.
- **Scan scope is a hardcoded top-level allowlist** (`scanProject`'s `dirs` default `["app", "lib"]`) — an MVP shortcut for scanning Nebulosity's *own* repo, not a design decision. The rest of the doc set assumes **repo-root** scanning (`API_CONTRACTS.md` §4 "repo root is the server's project root"; the agent's `safePath` boundary in `AI_AGENT_DESIGN.md` §6). Exit path: when Nebulosity scans arbitrary repos (~Phase D, or the first external repo), walk from the repo root and filter via the `IGNORE_LIST` blocklist + `SOURCE_EXTENSIONS` instead of an allowlist — arbitrary projects use `src/`, `packages/`, etc. and may have no `app/`/`lib/` at all. The `dirs` parameter is already the seam (a default, so callers can override it). Not to be confused with `?root=<dir>` (ADR-012, Tier L): that scopes a *large* repo to a subtree, a different concern from which files count as source.
- ~~`server-only` marker inside `lib/scan.ts`~~ **Resolved 2026-07-13.** Removed outright (not relocated) once F1's test setup proved it throws in any non-Next.js Node context, including Vitest — which would have equally broken the future CLI and Electron adapters if "moved to the adapter layer" as originally planned. See `ARCHITECTURE.md` §3 rule 1 for the full reasoning.
- ~~**Visual design is frozen** per the brief — functionality only from here.~~ **Lifted 2026-10-11** by the owner for the Map revamp (ADR-029). The dark amethyst identity stays and the layout is new.
- **Scan scope allowlist (`app/`, `lib/`): resolved by the pivot.** Discovery starts at the repo root via `git ls-files` (`PIVOT_SPEC.md` §5.1).
