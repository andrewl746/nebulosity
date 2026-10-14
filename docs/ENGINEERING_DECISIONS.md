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
**Revisit when:** Nebulosity ever runs as more than one process against one database file, where concurrent migration needs a lock. *(Fired 2026-10-11: the MCP server is a second process. Answered by ADR-030: the MCP server opens read-only and never migrates.)* *(Amended 2026-10-13 by ADR-044: the MCP server opens read-only and never migrates.)*

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

> *(Amended 2026-10-12 in slice V1.3, from V1.2's review: a vector must describe its row's current text. A vector is stored only if the summary still has the `inputHash` it was computed for, inside one immediate transaction. A template written over model text deletes the old vector. Before this, a summary rewritten while it was being embedded kept its old text's vector for good.)*

**Alternatives:** (a) Chunk embeddings in sqlite-vec: fixes the memory problem but not the 94-minute embedding cost. (b) Keyword search only: misses conceptual questions. (c) A hosted embedding model: adds an API key and a network dependency to indexing.
**Consequences:** Keyword search works seconds after the structure stage, and results improve as summaries and their vectors arrive. About 15–20k summary vectors stay comfortably within brute-force range. RRF combines lists without calibrating their scores against each other. *(Amended 2026-10-11 in slice V1.2: fusion works on files and folders. Code hits are grouped by file before ranking, so a file with ten matching chunks counts once per list. Each list contributes its top 50, and vector matches below cosine 0.25 are dropped. Queries keep their non-stopword words, quoted and ORed, plus the parts of identifiers. See `RAG_PIPELINE.md` §6.)*
**Revisit when:** the eval shows conceptual questions failing. Then try a code-specific embedding model, or chunk embeddings for the most-used areas only.

**Amended (2026-10-13, V1.3.1): a fourth list, folder names, counted double.** Testing the three-task test's first task, the owner searched "terminal" and found files about terminals but no terminal folder: VS Code's `src/vs/workbench/contrib/terminal` ranked 57th, because a folder could only compete through its summary, and RRF rewards files that every list finds. Folders whose names match a query word now form a fourth ranked list (exact or a short ending apart, then prefix, then contains, then the word starting with the name; ties by size), weighted 2 in the fusion. On VS Code: "terminal" puts `contrib/terminal` 1st; "integrated terminal", V1.2's one miss, puts `platform/terminal` 1st and `contrib/terminal` 2nd; the other four V1.2 checks still pass in the top 5; "debugger" brings `contrib/debug` into the results. The palette lists every folder hit before every file hit. Weights are a lever for V1.5's eval, which should check that questions in plain language still lead with files. The same day, the three-task test's tester searched "vscode terminal" and got an extension's terminal folder: the repo's own name matched extension code importing the `vscode` API. Search now drops the repo's name when other words remain.

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
*(Look amended by ADR-041: refined dark theme.)* **Consequences:** Performance is bounded by design (≤ 50 nodes, ≤ 50 ms level loads), and there's a measured acceptance budget of ≤ 100 ms per interaction. Very large folders depend on the "+N more" behavior being good. The owner lifted the visual-design-frozen rule for this revamp.
**Revisit when:** users regularly need to compare boxes from different branches of the tree side by side. A pinned multi-level view would be the next step.

## ADR-030 — One tool registry, two adapters, and install-relative paths (2026-10-11)

**Context:** Two agents need the same knowledge. Claude Code connects from outside through MCP, launched from the user's repo; the Guide (E1) runs in-process on LangGraph. `lib/agent/tools.ts` mixes tool logic with LangChain wrappers. `lib/db/client.ts` resolves the database and migrations relative to `process.cwd()`, and when Claude Code launches the MCP server, that directory is the user's repo. ADR-023's multi-process revisit trigger also fires here.
**Decision:**
- Each tool is defined once in `lib/tools/registry.ts`: a name, a description written for LLMs, a zod schema, and a handler that calls the engine. *(Amended 2026-10-13, ADR-047: a handler takes `(input, context)` and returns `{ text, paths, action? }`; adapters post live events or emit UI actions.)*
- The MCP server registers those entries, and the Guide wraps the same entries as LangChain tools.
- The database, migrations and config resolve from `NEBULOSITY_HOME`. When it's unset they fall back to `process.cwd()`, which is correct for Next.js, the CLI and Vitest because all three run from the checkout. The MCP launcher (V1.4) always sets it. *(Amended 2026-10-11 in slice V1.1: the original default, the module's own location, breaks under Next.js, which bundles server modules into `.next/`.)*
- The MCP server opens the database read-only and never migrates. *(Amended 2026-10-13, ADR-044: the read-only open is `openDb(file, "readonly")`, which also refuses a database behind the checkout's migrations.)*
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

> *(Amended 2026-10-12 in slice V1.3, for S1's margin: Index Benchmark #3. A run with at least 2,000 files to parse (a first index, or a forced re-parse) sets a `meta` row that a `WHEN NOT EXISTS` clause on the chunk insert trigger respects. After the structure stage, one `INSERT … SELECT` fills `code_fts`, about 3 times faster than a trigger per chunk, and clears the row. A run that dies before filling leaves the row; the next run, under the same index lock, fills first. Search adds a note while the fill is pending. Incremental updates keep the trigger.)*

**Alternatives:** (a) Explicit writes in the structure store: misses cascades and the old pipeline, so deleted code would keep turning up in search. (b) External-content tables: no duplicate text, but deleting a row needs its old values, which a cascade has already removed. (c) Contentless tables (`contentless_delete=1`): smaller, but `snippet()` stops working and snippets would need their own code.
**Consequences:** The search indexes can't drift from the data, whichever path changes it. The text is stored twice (the pivot spike measured 211 MB for VS Code's chunks), and every chunk insert also writes an FTS row: measured on VS Code, the cold write stage went from 13.1 s to 27.4 s, and the structure stage still passed S1 at 56.4 s (BENCHMARKS.md, Index Benchmark #2). Migration 0004 clears every content hash once, so existing chunks get indexed on the next run.
**Revisit when:** database size starts to matter, or the FTS writes push S1 past 60 s.

## ADR-032 — Stage status lives in `meta`, and a silent "running" means a crash (2026-10-11)

**Context:** `PIVOT_SPEC.md` §5.7 asks for `idle | running | ready | off | failed` per stage, with progress, at `GET /api/status`. Stages run in different processes: the CLI now, a server worker from V1.3. A killed process never gets to write "failed".
**Decision:** Each stage writes `stage:<repoId>:<stage>` in `meta` as it goes, at least once a minute while running. Readers report a `running` row untouched for 5 minutes as `failed`, with the note `interrupted: no progress since <time>`. The one exception is a summaries stage with requests still at Anthropic: that work goes on without any local process, so it stays running (added with ADR-033).

> *(Amended 2026-10-12 in slice V1.3, from V1.2's review: stage rows went stale. A stored row describes the moment it was written, and later changes left it wrong. After an edit and a re-index, `summaries` still read `ready 14/14`. After a summary was rewritten, `embeddings` still counted its deleted vector.*
>
> *Now the summaries stage is re-derived by `refreshSummaryStatus` whenever something other than a summary run changes what's planned: `npm run index`, the background worker's structure updates, and `summarizeNow`. It plans like a run that sends nothing (new rows, statuses, test templates) and writes the stage from the same pure `summaryStageStatus` a finishing run uses. While a live run holds the summarizing lock it leaves the row to that run. It keeps a failed run's note while its targets still wait. A new reading, `idle` with `N waiting to be summarized`, means nothing is running but work is known.*
>
> *The embeddings stage's counts are read live (two counts per request); only `running` and `failed` come from its row.)*

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
- **Templates and hashing.** Test files get a template (status `skipped`, model `template`). A file's `inputHash` hashes its content hash instead of its rendered prompt. That's equivalent, because the prompt is a pure function of the bytes and `PROMPT_VERSION`, and it means planning never reads source files. *(Amended 2026-10-11 in slice V1.2: from prompt v2 the prompt also names the file's importers, which stay out of the hash on purpose; see ADR-034.)*
- **Request settings.** Effort `low` with adaptive thinking (the models' default), structured outputs for `{ tagline, summary }`, and `max_tokens` 4,096 (a cut-off answer is retried once at 8,192). Sonnet requests on the regular API carry the server-side refusal fallback (`fallbacks: "default"`). The Batches API rejects that parameter, and Haiku 5.5 has no fallback.
- **"Summarize now" can't pay twice.** *(Added 2026-10-12 in slice V1.3, from V1.2's review.)* Concurrent `summarizeNow` calls for one target in one process share one promise and one request. The Map's requests all go through the one background worker (ADR-038), so a double click or two tabs pay once. A CLI `--path` running at the same moment is a separate process and isn't covered; it's rare, and costs one request. A folder whose children aren't all summarized is refused (`TargetNotReadyError`): it would otherwise be written over "(no summary yet)" lines for the price of a Sonnet call. Every call ends by refreshing the summaries stage (ADR-032).
- **A way out for a batch that keeps erroring.** *(Added 2026-10-12 in slice V1.3, from V1.2's review.)* A batch whose results can't be read (not a 404, which `BatchGoneError` already handles) used to fail every run at the same point, its rows claimed forever. When a run gives up on polling, the stage note now names the batches and the command: `npm run summarize -- "<repo>" --release-batch <id>` (repeatable). That marks their rows failed, so the run sends them again, and they're paid for again. A `--no-wait` run that couldn't check a batch prints the same hint. Release stays a decision the owner makes: Anthropic keeps results for 29 days, and an outage looks the same as a broken batch, so an automatic release would pay twice for answers that were only late.

**Alternatives:** (a) One batch for everything, with folders summarized from raw file text: no bottom-up synthesis, and much bigger folder inputs. (b) A jobs table: more state to keep consistent with the rows it describes. (c) Batch-only: each of the dozen top waves could wait hours.
**Consequences:** A crash costs the requests in flight on the regular API; batch requests are collected rather than resent. The one gap is a batch caught between Anthropic accepting it and the run recording it: a failed recording names the batch, but a killed process or a lost reply leaves a batch nothing here can name, and its requests are paid for again when the next run resends them. A wave or batch where most requests fail (at least 10) stops the run before any folder is summarized over those failures. API spend is recorded per model and transport (`summary_usage`), which is how S2 is measured.
**Revisit when:** waves cost too much wall time on a deeper repo (then submit folders speculatively), or refusals become common.

## ADR-034 — Summary prompt v2, from the owner's checkpoint (2026-10-11)

**Context:** The owner read Review #1 (`SUMMARY_REVIEW.md`: 20 VS Code files, each written by Haiku 5.5 and by Sonnet 5.5) before the full run.
- Haiku was close to Sonnet at about 1/20 the price.
- The 6-word clamp cut 7–8 of the 20 Haiku taglines mid-phrase.
- Summaries hedged with "truncated" and "not shown", and a file's summary couldn't say who used it ("the source does not show which modules import these exports").

**Decision:**
- **Models.** Haiku 5.5 writes the file summaries, and effort stays low.
- **Prompt v2** (`PROMPT_VERSION` 2):
  - The tagline is a noun phrase of 3 to 6 plain words, with an example that isn't from VS Code, so the model can't copy it into a summary.
  - "Don't mention truncation or code you weren't shown" replaces "if the source is truncated, summarize what's there".
  - A file's prompt gets one line from the import graph: how many files import it, and the 3 folders with the most of them (`Imported by: 7 files in 5 folders: a (2), b (2), c (1), and 2 other folders`). Test files are counted apart (`, plus 2 test files`), because on VS Code the biggest importer folders of central files such as `log.ts` and `uri.ts` are test folders (a preview put `src/vs/platform/agentHost/test/node` first for `log.ts`, with 138 importers), which would skew how the file's use looks. *(Amended 2026-10-11 in slice V1.2, after the owner's Review #2 response: the line groups importers by area, not by leaf folder, and reads `Imported by: 10 files: src/vs/workbench (3), src/vs/base/browser (2), build.js (1), and 4 files elsewhere, plus 1 test file`. An importer's group is the child of the lowest common folder of the two files toward the importer, or the importer itself when it sits directly in that folder: spec §4.2's used-by rule, with `lcaFolder` and `childToward` from `lib/index/aggregate.ts` shared with the Map's level edges. The reason: leaf folders named arbitrary deep folders for central files, whereas area groups say where in the codebase a file is used. The hidden groups fold into `, and N files elsewhere`; the test tally and the totals are as before. `PROMPT_VERSION` stays 2, since no v2 summary had been stored yet.)*
  - Identifiers in the summary go in backticks.
- **Taglines** are asked for in 3–6 words and kept whole up to 8. A longer one is cut at a word boundary, minus dangling connector words (`and`, `of`, `the`…). Backticks are stripped, since the UI shows taglines as plain text.
- **Importers go in the file prompt but not in the input hash.** The planner still hashes the model, the prompt version, the path and the content hash.
- **Whole summaries only.** *(Amended 2026-10-11 in slice V1.2, after the owner's Review #3 response.)* Review #3's `common/configurationService.ts` summary ended "…applyEdits. The". The output limit wasn't the cause: `parseSummary` already failed every `max_tokens` reply, and three fresh runs of the same prompt came back whole (`end_turn`, about 280 output tokens, one text block). Haiku had returned well-formed JSON whose summary simply stopped, and only `refusal` and `max_tokens` were checked, so every other stop reason passed too.
  - **Completeness.** A reply is whole only when its stop reason is `end_turn`, its summary isn't empty, and the trimmed summary ends a sentence (`/[.!?]["'`)\]]*$/`). A refusal keeps its error; every other incomplete reply fails with `the summary was cut off (stop reason: …)`. Before the check, a trailing run of two or more periods becomes one (`..` → `.`).
  - **One retry.** A cut-off answer is asked for once more on the regular API with `RETRY_MAX_OUTPUT_TOKENS` (8,192), whichever transport sent it: `summarize` retries its own, and `batchResults` retries a batch's cut-off items before returning the results, so the runner (which only sees outcomes) needed no change. Doubling the limit removes the one known cause of a cut, and costs nothing unused. If the retry is cut off too, or fails, the outcome is failed: nothing is stored, the folder above gets "(no summary yet)", and the next run resends it. Never more than one retry per answer, and a failed retry is an outcome, never a throw.
  - **Accounting.** Both attempts are billed, so the outcome's usage sums both, per model. The runner records a batch's outcomes at batch prices, so a retried batch item's regular-API tokens are counted at half their price. Retries are rare, so the gap is accepted rather than splitting one outcome's usage across transports. A retried answer still counts as one request in `summary_usage` while both attempts' tokens are summed, so the per-request mean the spend cap uses (ADR-035) errs high, which is safe for the cap.
  - **Memory.** A batch's results don't carry the prompts, so the summarizer keeps each batch's requests from submission until its results are collected: on the order of 100 MB for VS Code's file pass. A batch submitted by another process (a run resumed after a restart) has no requests there. Only the process that submitted a batch retries its cut-off items in-process: when another process collects the batches (after a restart, or in `--no-wait` runs), those items fail, are never stored, and are resent on the next run.
  - **No heartbeat during retries.** Retries of a collected batch run inside one poll, without a lock heartbeat (ADR-033). A mass cut-off could outlast the 5-minute "running means alive" window (ADR-032). This is a known limit, accepted because cut-offs are rare.
- **Test-only folders get a template.** *(Amended 2026-10-11 in slice V1.2, after the owner's Review #3 response.)* The owner chose to skip the model for folders that hold only test files, as test files already do. A folder (never the repo) whose subtree holds at least one file and no non-test file is planned like a test file: model `template`, status `skipped`, ``inputHash("template", PROMPT_VERSION, `${path}\n${tagline}\n${summary}`)``, and settled at once, so its parent isn't held back. The text comes from `testFolderSummary`: `Tests for <subject>`, where the subject is the path segment before the first `test`, `tests` or `__tests__` segment, else the folder's own name. Measured scale: VS Code has 1,266 of 3,793 folders that are test-only, and templating them saves an estimated $2.20.

**Alternatives:** (a) Keep the hard 6-word clamp: a firm promise to the UI, but it cut 7–8 of 20 taglines mid-phrase. (b) Sonnet for files: about 20 times the price (Review #1 estimated $60.39 against $3.06 for the file pass) for summaries that were close. (c) Put the importers in the hash: the usage sentence would follow the live graph, but a new importer would re-summarize a central file on every pull.
**Consequences:**
- v2 invalidates every stored summary, but VS Code has none yet.
- The usage sentence reflects the graph as it was when the file was summarized.
- The file prompt grows by about 100 tokens, roughly $0.05 over a VS Code pass.
- The UI's tagline promise becomes ≤ 8 words.

**Revisit when:** Review #2 (the same 20 files) still shows taglines cut or summaries hedged, or usage sentences go stale enough to mislead. Then redo the most-imported files on a schedule.

**Amended (2026-10-14, V1.5): a top-level test folder takes the repo's name.** VS Code's `test/` read "Tests for test" in the overview and on the Map: no segment comes before a top-level test folder, so the template fell back to the folder's own name. It now names the repo ("Tests for vscode"). The template's text is in its input hash, so the next plan rewrites the row for free. The repo summary's prompt lists that tagline, so the repo summary is redone once (one Sonnet request).

## ADR-035 — A spend cap on summary runs (2026-10-11)

**Context:** The owner approved the full VS Code pass with one condition: "Before submitting each further batch, stop if the spend so far plus the remaining estimate would pass $15". Review #2 estimated the pass at about $11.70 (Haiku files, Sonnet folders and the repo, by batch), and $15 is S2's ceiling. Until now a run learned what it had spent only after paying: `summary_usage` records each answer's tokens as it lands.

**Decision:**
- **The projection.** Before every submission, and before any of its prompts is built, a run projects **spent + at Anthropic + this submission + the rest**. A submission is each batch and each regular-API wave. The math is pure (`projectSpend`, `lib/index/summarize/budget.ts`).
  - **Spent:** every `summary_usage` row of the repo, each at its own transport's price.
  - **At Anthropic:** the requests in flight, at batch prices. A pass's plan lists the ones in flight when it started. Each batch the wave submits joins them once it's recorded, so a later batch of the same wave counts the earlier ones. Leaving them out would make every later check more lenient than the first.
  - **This submission:** at its own transport's price.
  - **The rest:** every target still `ready` or `waiting` after it, at batch prices, or direct ones when the run's transport is `direct`.
  - **Tokens per request:** the model's mean on this repo (Σ tokens ÷ Σ requests, both transports). Until a model has any usage, `ASSUMED_TOKENS` for the target's kind: files 4,600 in and 260 out (Review #1's Haiku means), folders and the repo 1,000 and 250. The checkpoint's estimate (`compare.ts`) takes its folder input from the same constant.
  - A model with no price on file counts as $0 and is named in the progress line.
- **Under the budget** the run prints `budget: spent $… + at Anthropic ≈ $… + this wave ≈ $… + the rest ≈ $… = $… of $…` and sends.
- **Over it** the run stops sending, but keeps collecting what's already at Anthropic.
  - That submission and everything after it stay pending (not failed, not claimed).
  - A wave whose first submission is over budget is never announced or counted. A later batch over budget ends its wave's submissions.
  - The batches already at Anthropic are still collected: as each one ends, with `wait`; the ones that have ended, with `--no-wait`. Meanwhile the stage note reads `over budget, so nothing new goes out; collecting the N batches already at Anthropic`, so a long wait isn't mistaken for an ordinary one. After each collection the run plans and checks again, with the real usage in place of the estimates, and sends normally if the projection now fits.
  - This ends: nothing new is sent while over budget, so each pass collects a batch (taking it out of flight), finds none left, or finishes.
  - The run finishes over budget only when nothing more can happen: nothing is in flight, or `--no-wait` collected nothing. It reports the stop as the circuit breaker does (ADR-033): `stopped: true`, and the stage `failed`, or `running` while batches are still at Anthropic. The note is the latest failing check's: `stopped: the next batch would bring the projected spend to $…, over the $… budget (spent $…, at Anthropic ≈ $…, this batch ≈ $…, the rest ≈ $…); run again with --budget <usd> to go on` ("wave" for a regular-API wave).
  - A budget that isn't a number stops the sending too, rather than lifting the cap.
- **The budget** is `SummaryRunOptions.budgetUsd`. Undefined means no cap, and `summarizeNow` (one request) has none. The CLI's `--budget <usd>` takes a positive number and defaults to $15 (`DEFAULT_BUDGET_USD`, S2).
- **Ruled choices**, from the owner's verdict:
  - **Cumulative per repo.** "Spent" is every usage row of the repo, so the default bounds the repo's total recorded summary spend (see Consequences for what isn't recorded), not one run's.
  - **Every submission,** regular-API waves included: "each further batch" was read as every send.
  - **The rest at batch prices,** the transport of the big waves where nearly all the money goes, unless the run is `--direct`.
  - **A budget stop stops sending, not collecting.** The owner's condition is about submitting, and the batches already at Anthropic are paid for.

**Alternatives:** (a) A per-run budget: simpler, but a first pass can take several runs (`--no-wait`, an interruption), and the owner's condition is about the total. (b) Check batches only: the small regular-API waves at the top of the tree would go out unchecked. (c) Predict which later waves go direct (under 100 requests) and price them that way: wave sizes depend on how the tree fills in and on what fails, so that is a guess too, with more code to keep honest. (d) Re-read the in-flight rows from the database before each batch: the same count unless something else touches those rows mid-wave. A row that `summarizeNow` redoes meanwhile leaves the database's count, though Anthropic still bills its batch request. (e) End the run at once, the way the circuit breaker does (this ADR's first version): a run sends what's ready before it collects, so every re-run under the same budget stopped at the same check, and the paid-for batches were never collected.

**Consequences:**
- A run stops sending before its projection passes the budget, so it can overspend only by what the projection misses.
- **What the cap can't see:** spend that never reaches `summary_usage`. That covers the owner's checkpoint reviews (`compare-summaries`, about $0.49 on VS Code, and the `preview-folders` folder preview, about $0.24), and a batch Anthropic accepted but the run couldn't record, whose rows are later resent and paid for again.
- **The known gap:** the rest prices every remaining target at batch rates, but a wave under 100 requests goes through the regular API at full price. Such waves come at the top of the tree, and also mid-run, when file batches land at different times and leave only a few folders ready at once. So the projection runs a little low, by an estimated under $1 on VS Code. That can only delay a stop, never cause an overspend: each regular-API wave is priced at direct rates in its own check, before it goes.
- A model is priced from the assumption until its first answers are recorded (a batch's, when it's collected), and from its measured mean after that. An unpriced fallback model makes the total a lower bound, and the progress line says so.
- A later run on the same repo (an incremental update, say) starts from everything already spent, so past $15 it needs `--budget`.
- With `wait`, a run over budget keeps running until the batches it's waiting on have ended, which can take hours. Everything paid for lands, and a re-run under the same budget collects whatever has ended since.

**Revisit when:** the assumed tokens prove far off on a new repo before its first answers land (then seed the means from the checkpoint's sample), or the regular-API gap grows past a dollar (then price the waves under 100 requests at direct rates).

**Amended (2026-10-12, V1.3): a per-run scope.** The cap above is cumulative: it counts every `summary_usage` row the repo has. That suits the CLI, but not the background worker (ADR-038). VS Code's first pass already spent $10.30 of the $15, so the worker would have refreshed about $4.70 of summaries and then refused every refresh for good, quietly. A run can now be capped on its own spend (`budgetScope: "run"`): usage recorded before it began is a baseline, left out of `spent`, while each model's mean still comes from all of it. Each worker refresh and sweep runs under $1 that way (`INCREMENTAL_BUDGET_USD`). At VS Code's measured means, 50 Haiku files cost about $0.03 and 20 Sonnet folders $0.11–0.16, so the cap only stops a run gone wrong; the file and folder limits bound the normal case. The CLI keeps the cumulative cap.

## ADR-036 — The Map reads one level at a time: the fold, its order, and an index version (2026-10-12)

**Context:** ADR-029 fixed the Map's shape: levels, a 50-box cap with "+N more", and precomputed level edges. Building it raised four questions: which boxes fold, what the "+N more" box is called, how a client knows its copy is old, and how "uses / used by" (§4.2) is computed.
**Decision:**
- **Order and fold.** A level's children are sorted by file count (a file counts 1), then by importer count, then by path. Past 50, the first 49 stay and the rest fold into one box, so exactly 50 are drawn. The "+N more" box's path is the level's path plus `/` (`/` at the root): no stored path ends in a slash, so the id can't collide. Lines into folded children are redirected to it and added up; lines between two folded children are dropped.
- **An index version.** A counter per repo in `meta` (`indexVersion:<repoId>`) is bumped by one SQL statement by every write the Map can see: a structure run, an incremental update, and any summary write that changes a row. Level and describe answers carry it, and `GET /api/status` reports it, so a client caches per version and refetches when it moves, and a server cache keyed on it can't serve stale data.
- **Areas from memory.** "Uses / used by" needs every import across a boundary: about 65,000 for `src/vs/workbench`. They're counted from an in-memory import graph (files sorted by path, so a folder is one contiguous range; imports as pairs of positions), loaded once per index version (about 60 ms on VS Code) and cached per path.
**Alternatives:**
- (a) Fold alphabetically: a 780-file folder would hide its most-imported files behind "+731 more".
- (b) A timestamp version: two writes in the same millisecond look like one.
- (c) Area counts in SQL: a join over 139,580 imports per click, about 3 times slower than the in-memory scan and not cacheable across paths.
**Consequences:** A level costs three indexed lookups (0.25 ms for VS Code's busiest level's lines). The first describe after a change pays for loading the graph. A client that polls the version sees changes from any process: the CLI, the background worker, or the MCP server.
**Revisit when:** users want a different order (for example, recently changed first, with E3).

**Amended (2026-10-12, V1.3): layout from the heaviest lines, and a fit that waits for the boxes.** Measuring S3 on VS Code found two things. Dagre's crossing reduction grows with the lines: `src/vs/platform`'s 50 boxes and 390 lines took 0.5–0.65 s to lay out, `src/vs/workbench/contrib`'s 217 lines 0.2 s. The layout now uses each level's 100 heaviest lines (`LAYOUT_MAX_LINES`; ties broken by path, so a level always draws the same), which takes 30–45 ms; every line is still drawn, and a box joined only by lighter lines stays in the layers. Second, a level served from the client's cache kept the previous level's viewport: the fit ran in the frame after the level changed, before its boxes reached React Flow. The fit now waits until React Flow holds the new level's boxes, and still runs once per level, so a refetch of the same level keeps the user's pan and zoom.

**Amended (2026-10-12, V1.3.1): layers drawn as centred tiers that wrap, loose boxes beside them.** On VS Code, dagre's own x positions made two levels unreadable once fitted to a 1440 × 900 screen.
- **The root** is a 6-layer chain with four boxes that have no lines. With those boxes in a grid below the chain, the level fit at 64% zoom, so 15 px names drew at about 10 px.
- **`…/codex/protocol/generated`** has 49 files that all import one barrel. They made a single layer about 13,000 px wide, which fit at about 9%: a row of slivers.

Dagre still decides each box's layer and its order within the layer (the order that crosses fewest lines). Its x positions are dropped: each layer is centred, and one wider than 6 boxes wraps into balanced rows (13 → 5, 5, 3). Boxes with no line go in a grid either beside the tiers (as tall as them) or below them (square-ish, centred), whichever fits the level larger on a nominal 1440 × 780 canvas; a tie stays beside.

The final review measured why both are needed. Always beside was worse than below on 105 of VS Code's levels: `src/vs/editor/browser/viewParts` fit at 0.33 beside and 0.95 below. Always below costs the root (0.68 against 0.91).

The root now fits at 91–95%, `viewParts` at 95% and `generated` at 50%. Fifty boxes can't all be full size on that screen, and 6 per row is about the best shape for it. Lines between tiers stay drawn from box to box; a parent is no longer placed right over its children. *(2026-10-13: a divider, a line with "Not linked to anything on this page" in its middle, now sets the loose grid apart, by the owner's design after a critique read it as randomly placed cards. A grid below starts 120 px under the tiers instead of 80, the line halfway; a column beside starts 64 px down, the line in that band. `looseDivider` in `app/map/levelLayout.ts`.)*

**Amended (2026-10-12, V1.3.1): describe answers are cached per index version.**
- **Why.** `VISUAL_REFRESH.md` §8 reported that the `src` panel took about 5 s to open and asked for the answer to be cached per index version. Profiling on today's code did not reproduce the 5 s:
  - `describe("src")` takes 30–32 ms in process. Most of that is two scans: stale summaries inside (13 ms) and lines inside (8 ms). The area counts already come from the in-memory graph.
  - Over HTTP on the V1.3 production server it took 48–82 ms.
  - In the browser it took 53–141 ms on the production build. On the dev server it was 233 ms the first time (including the route's compile) and 53–95 ms after.
  - The likely sources of the 5 s are a cold dev-server compile, or the on-demand summary refresh landing seconds after the panel opened, with nothing saying it was coming. The panel now says "Refreshing…".
- **Decision.** `describe()` keeps every answer for the current index version, keyed by repo (its id and key), path and whether summaries are off. It reads the version and returns a kept answer before any other query. A new version empties the answers, and past 2,000 the map starts over, as the area cache does.
- **Consequences.** On VS Code a repeat costs 0.1 ms at p50 and p95 (a first describe of a folder is 1.3 ms p50 and 2.4 ms p95, with a 35 ms max). Callers share the answer, so they treat it as read-only. A writer that changes what describe shows without bumping the version would now be served stale data. Every writer bumps it today, and the cache test pins the contract.

## ADR-037 — Incremental structure updates write only what changed (2026-10-12)

**Context:** S6 asks for ≤ 2 s from saving a file until `level`/`describe` reflect it, and the watcher's 1 s debounce (PIVOT_SPEC.md §5.6) uses half of that. A warm full run takes 4.9 s on VS Code. Measured while planning V1.3, re-resolving all 151,527 specifiers in memory takes about 0.33 s and rebuilding the level edges 0.25 s. The rest of the run's 2.7 s of resolve and aggregate is the database rewriting 139,580 import rows and 19,345 level-edge rows, nearly all unchanged.
**Decision:** `applyFileChanges(root, paths)` looks at each reported path as it is now.
- **Edits.** An edited file is re-parsed, and only its own imports are re-resolved and diffed against its stored ones.
- **Creates, deletes, tsconfigs.** When a file is created or deleted, or a tsconfig changes, every file's imports are re-resolved in memory, because a new file can be what `../core` now means. The result is diffed against all stored imports.
- **Writes.** Only the differences are written. Import rows are deleted and inserted. Each level-edge count moves by its delta: an import is counted on a row decided by its two paths alone, so −1 per removed import and +1 per added one, netted, equals a rebuild. Folder rows are synced; summaries of vanished targets are pruned.
- **One rule.** Edges come from one shared rule (`edgesFrom`) and records from one builder (`toFileRecord`), both used by the full run too.
- **Exclusions.** A path is excluded exactly as discovery would exclude it (`isExcludedPath`). New paths are checked against `.gitignore` with one `git check-ignore --stdin` call.
- **Folders as one path.** A path the index doesn't hold may be a deleted folder (a watcher's `unlinkDir`); every indexed file under it is looked at.
**Alternatives:** (a) Run the full pipeline on every save: 4.9 s, so S6 fails. (b) Find the files that could import a new file by their specifiers, without re-resolving everything: faster, but every resolver rule (aliases, `baseUrl`, `index` files, NodeNext) would need an inverse, and an inverse that's wrong silently drops edges.
**Consequences:** A single-file edit costs tens of milliseconds on VS Code (measured in Task 22); a create or delete about half a second. The tests check every kind of change against a full run of the same tree, so the two paths can't drift apart.
**Revisit when:** a repo is big enough that the in-memory re-resolve of a create or delete passes 1 s (then index files by the specifier stems they could satisfy), or E2's call edges need the same treatment.

## ADR-038 — A background worker process owns the index while the Map is open (2026-10-12)

**Context:** PIVOT_SPEC.md §3 has the Next server run "background indexing on a worker thread". §5.6 asks for a watcher, debounced structure updates, a summary refresh 60 s after a file's last change, a periodic sweep of out-of-date folders, and re-embedding. On VS Code a warm full run takes 4.9 s and planning the summaries about 0.2 s. On the server's event loop, either would stall every request behind it, and S3 allows 100 ms per interaction. The server is bundled by Turbopack, so a worker thread would have to load the TypeScript engine through the bundle, or through a loader that isn't known to apply inside threads.
**Decision:**
- **A forked child process, not a worker thread.** The server forks `scripts/background.ts` through tsx (`--import tsx`, resolved from the checkout), the way every CLI script runs. The child owns every write while the Map is open. The server stays a reader: level, describe, search and status read the shared SQLite file (WAL). "Summarize now" and "re-index" go to the child as requests over the IPC channel.
- **One job at a time.** Structure updates, summary refreshes, sweeps and embedding slices run one after another. "Summarize now" runs at once beside them, deduplicated per target (ADR-033, amended). *(Split into two lanes by the amendment below.)*
- **Structure.** A batch of watched paths goes through `applyFileChanges` (ADR-037). Over 500 paths, or a changed `.gitignore`, gets one full run instead. Every update ends by re-deriving the summaries stage (ADR-032, amended).
- **Summaries.** Each changed file waits 60 s, and another save restarts its wait. Files that changed together wait on one timer, so they come due as one refresh (a timer per file would start a refresh each). Due files are refreshed through the regular API: most-imported first, at most 50 per refresh (per 10 minutes since the amendment below), under a $1 cap on that refresh's own spend (ADR-035, amended). Their folders turn stale and wait.
- **The sweep.** Every 10 minutes it redoes out-of-date folders whose children are settled, deepest first, at most 20, under the same per-run cap. A pull can't set off hundreds of Sonnet calls at once.
- **Embeddings.** Whatever lacks a vector is embedded in slices of 64, so a structure update never waits more than a few seconds.
- **Startup.** On start and on every repo switch, the watcher starts first; once its first crawl is ready, one warm full run catches what changed while nothing watched (4.9 s on VS Code, in the child). The other order would lose edits made during the crawl, which takes seconds on VS Code. Size-and-mtime filtering (§5.6) waits until that grows.
- **Locks.** Work another process holds a lock on is retried after 30 s.
- **Crashes.** The server's supervisor restarts a crashed child after growing delays (1, 2, 5, 10, then 30 s) and answers anything it owed with an error. The child exits when the server does, because its IPC channel closes.
**Alternatives:**
- (a) Everything on the server's event loop: simplest, but a save on VS Code would freeze the Map for up to a second, and a branch switch for tens of seconds.
- (b) A worker thread, as the spec first said: loading TypeScript inside one under Turbopack is unproven, and a crash in a thread can take the server with it.
- (c) Refresh every changed file however many there are: a branch switch could send thousands of requests silently.
**Consequences:**
- The Map never waits on indexing.
- A second Node process costs about 100–200 MB.
- The child needs tsx at run time, a devDependency: fine for a local tool, and noted for the desktop build.
- When more than 50 files change at once, the rest keep stale summaries until opened, swept, or summarized by the CLI.
**Revisit when:** the desktop app (Electron or Tauri) replaces Next as the host; the worker becomes its background process.

**Amended (2026-10-12, V1.3 final review): the worker follows the active repo.** `npm run index` rewrites `activeRepo` in the config without telling the server, and the Map's empty state tells a new user to do exactly that. The read routes and the Map followed the config, but the worker kept the repo it started with. Live updates then stopped silently, and "summarize now" or re-index could run on a repo other than the one on screen, paying for the wrong target.
- **Following.** Every route that talks to the worker, and the status route the Map polls every 2 s, first tells the supervisor the config's repo (`workerOn`). The supervisor passes on only a change, so the poll costs nothing.
- **Refusing.** Each `summarize` and `index` request names its repo, and the worker refuses one meant for another (`RepoSwitchingError`, `409 INDEX_LOCKED`, "try again in a moment"). A request that beats the switch can't act on the wrong repo.
- **Waiting for an index.** A repo that isn't indexed yet is checked again every 30 s, and the worker starts on it once it is, instead of logging once and idling.

**Amended (2026-10-12, V1.3 final review): the worker survives what it will meet.**
- **Watcher errors.** chokidar reports an error (Linux's inotify limit, too many open files) as an EventEmitter `error` event, which throws when nothing listens. That killed the worker, and every restart met the same error. The watcher now passes errors to the worker's log and keeps going, and folders this user can't read are skipped (`ignorePermissionErrors`).
- **Locks a killed process leaves.** The worker shares the server's terminal, so Ctrl+C kills it on the spot, mid-update or mid-refresh, and its `finally` never runs. A lock was judged by its age alone (30 minutes), so for half an hour after the next start every update failed on the lock. A lock row now names its holder's PID and machine, and a lock whose process is gone (on this machine) is abandoned at once. A reused PID only makes a dead holder look alive, and the 30 minutes still apply. This covers a killed CLI run too, so the worker needs no signal handlers.
- **Two lanes, not one queue.** Structure work (updates, the startup check, re-index) and maintenance (summary refreshes, the sweep, embedding slices) each run one job at a time, but apart. In one queue a save waited behind whatever was running: a refresh of 50 files (about 40 s), a sweep up a deep folder chain (30–100 s), an embedding slice (3.5 s). S6 then held only for an idle worker. Structure jobs are synchronous, so one runs between a maintenance job's awaits and never half-way through a write. A refresh sends each file only for the content whose quiet minute is up: a file saved again mid-refresh plans with a new input hash and isn't sent again in that run. Its update restarted its own minute, and its row reads stale until then.
- **50 files per 10 minutes, not per refresh.** The watcher hands a long burst over in batches at most 5 s apart: a formatter over the tree, a rebase. Each batch was its own wait group, so each got its own 50, and a minute-long burst on VS Code could send hundreds of Haiku requests unasked. Automatic refreshes now share 50 files per rolling 10 minutes (`AUTO_REFRESH_WINDOW_MS`). Files past it keep their old summaries, marked stale, until opened or summarized by the CLI.

**Amended (2026-10-13, V1.5): a server started only to measure forks no worker.** S3 and the static demo's checks start a production server beside the owner's `next dev`. Its worker would watch the same repo and run a warm full run at start, a second writer beside the Map's. `NEBULOSITY_WORKER=off` makes the server skip the worker; it then only reads. Two places honor it: `instrumentation.ts` returns before starting the worker, and `backgroundSupervisor()` hands out a supervisor that forks nothing. The second is the one that matters: `/api/status`, `/api/repos`, `/api/index` and `/api/summarize` tell the supervisor the repo on every request, which starts a worker on first use, so the first poll would have forked one anyway (found by the smoke test: a worker appeared under the measuring server after one `curl /api/status`). With no worker, summarize and re-index answer `INTERNAL`, "started with NEBULOSITY_WORKER=off".

## ADR-039 — The live channel: SSE out, localhost-only POST in, the server on loopback (2026-10-12)

**Context:** PIVOT_SPEC.md §8 has MCP tool handlers notify the open Map, with `show_on_map` reusing ADR-008's UI actions. The routes that spend money (summarize), change the index (re-index, switch repo) or drive the Map (live events) are reachable from any web page the user has open: a page can POST to `localhost:3000`, and DNS rebinding can make a foreign host name resolve to 127.0.0.1. `next dev` listens on every interface, so the GET routes would serve code snippets and summaries to the local network.
**Decision:**
- **The event.** A tool call is `{ tool, paths, at, action? }`. The Map pulses the box holding each path at its current level and runs `action` if there is one, so `show_on_map` is just a tool event with an action.
- **The stream.** `GET /api/live/stream` sends events as SSE (ADR-002), with a keep-alive comment every 15 s. The hub that fans events out lives in the server process (`lib/live/hub.ts`), kept on `globalThis` across hot reloads, and passes on at most 20 events a second.
- **The guard.** Every state-changing route checks `isLocalRequest`: the Host header must name this machine, and an Origin, if present, too. Programs send no Origin; a foreign page always does.
- **Loopback.** `npm run dev` and `npm run start` bind to 127.0.0.1.
- **The poster.** It fires and forgets: a 200 ms timeout, failures ignored, the port from the config.
**Alternatives:** (a) A shared secret in a header: the MCP server would need to read it from disk, and it guards nothing a loopback bind and the Host/Origin check don't. (b) WebSockets: two-way, which nothing here needs (ADR-002's reasoning holds).
**Consequences:** No other machine can reach the Map, and no web page can make it spend money or move. Opening the Map from another device (a phone on the same network) would need a deliberate `-H 0.0.0.0` and a token, which is out of scope.
**Revisit when:** the desktop app hosts the Map: the server then lives inside it and the guard moves to its IPC.

**Amended (2026-10-12, V1.3 final review): every API route checks the Host.** Binding to loopback closes the network, but not DNS rebinding. A page whose host name rebinds to 127.0.0.1 is same-origin with itself, so it could read the whole index through the GET routes: Claude-written summaries, the file tree, symbol names and every indexed repo's absolute root. `allowedDevOrigins` covers only dev assets, and nothing under `next start`. A proxy (`proxy.ts`, Next 16's renamed middleware) runs before every `/api` route and answers `403 FORBIDDEN` unless the Host header names this machine (`isLocalHost`). The routes that change things still check the Origin as well, and it must now be the Map's own page: the same host and port the request is addressed to. Before, any localhost port passed. That let another local web page spend money or drive the Map: another dev server, or the app of the very repo being explored.

**Amended (2026-10-13): the Map lets go of its stream while a page is frozen for Back.** After 5–8 full page loads in one tab, the Map stopped drawing: its level, status and repo requests waited forever. Measured in headless Chrome: with the back/forward cache on, connections to the server grew by one per load and the 7th load stalled; with the cache off they stayed at 5 through 12 loads. Chrome keeps a page you leave frozen in that cache, its EventSource still connected, and over plain HTTP/1.1 it allows 6 connections to one server, so the frozen pages' streams used them all. The client now closes its stream on `pagehide` and opens a new one on `pageshow` when the page comes back from the cache (`app/map/liveConnection.ts`): 14 loads stayed at 5 connections, and Back restored a page with a fresh stream. The alternatives were worse: `Cache-Control: no-store` on the page would keep it out of the cache (a full reload on Back), and HTTP/2, which multiplexes, isn't what `next start` serves.

## ADR-040 — Renderer-agnostic contracts (CONTRACTS_VERSION 2): the version names the API, migrations carry the data (2026-10-12)

**Context:** `lib/contracts.ts` imported React Flow's `Node` and `Edge` for the old graph (`GraphResponse`), which tied the API to one renderer (PIVOT_SPEC.md §3, rule 3). V1.3 retires that graph, its routes and the Phase 2–4 chunk pipeline. The spec also said "a schema version mismatch triggers a rebuild": `meta.schemaVersion` was meant to wipe derived data on a contract change. Nothing ever implemented it, and the database now holds summaries that cost money to rebuild ($10.30 for VS Code).
**Decision:**
- **Data, not drawing.** `lib/contracts.ts` describes data: `LevelResponse`, `MapNode`, `MapEdge`, `DescribeResponse`, `SummarizeResponse`, `SearchResult`, `IndexStatus`, `LiveEvent`, `RepoList` and `IndexEventMap`. The UI maps them onto React Flow itself.
- **Retired types.** `GraphResponse`, `HealthResponse`, `FileNodeData`, `GraphFileNode`, `FileKind`, `RetrievedChunk` and `SearchResponse` are deleted, with `GET /api/graph`, `GET /api/health`, the radial graph UI, `lib/graph.ts`, `lib/scan.ts`, `lib/retrieve.ts`, `lib/index-repo.ts`, `lib/index-status.ts` and `lib/db/graph-store.ts`.
- **The version.** `CONTRACTS_VERSION` is 2. It names the HTTP and SSE contract, and moves on a breaking change to it; it never touches the database.
- **The data.** Stored data changes only through Drizzle migrations, which carry their own data fixes. 0004 cleared content hashes to force a re-parse; 0005 drops the chunk `vectors` table, whose last writer was `lib/index-repo.ts`. Nothing wipes the database on a version change. Summaries are keyed by path, so they survive any structure rebuild anyway.
- **The tools.** `lib/agent/tools.ts`, the owner's Phase 5 tools, is ported onto the new engine as-is. V1.4 moves its logic into the tool registry.
**Alternatives:** (a) Implement the wipe-and-rebuild: a contract change would throw away paid-for summaries for no gain. (b) Keep the React Flow types next to the new ones: the very coupling the adapter split exists to remove.
**Consequences:** A static export (V1.5), the MCP server (V1.4) and a desktop shell can all serve the same shapes. The regex scanner's golden vectors (`GRAPH_IMPLEMENTATION_REVIEW.md` PART 3) retire with the code they tested.
**Revisit when:** a second renderer (a WebGL overview, say) needs layout data the contract doesn't carry; then it becomes a separate, renderer-neutral shape.
**Amended (2026-10-12, V1.3.1): `CONTRACTS_VERSION` 3.** Portals replaced the `"more"` box kind (ADR-042), a breaking change to `MapNode`, so the version moved 2 → 3. Nothing in the database changed.

---

## Decisions inherited from the existing codebase (pre-dating this doc set)

- **Radial ring layout is a placeholder** — deterministic, overlap-free, edge-blind. Replacement path is now formalized in ADR-011 and `VISUALIZATION_DESIGN.md`; the swap surface is one pure function (`radialPosition`).
- **Node id = project-relative file path** — the quiet keystone: graph nodes, chunks, tool args, sources, and highlights all join on this key. Preserve it in every future subsystem.
- **Scan scope is a hardcoded top-level allowlist** (`scanProject`'s `dirs` default `["app", "lib"]`) — an MVP shortcut for scanning Nebulosity's *own* repo, not a design decision. The rest of the doc set assumes **repo-root** scanning (`API_CONTRACTS.md` §4 "repo root is the server's project root"; the agent's `safePath` boundary in `AI_AGENT_DESIGN.md` §6). Exit path: when Nebulosity scans arbitrary repos (~Phase D, or the first external repo), walk from the repo root and filter via the `IGNORE_LIST` blocklist + `SOURCE_EXTENSIONS` instead of an allowlist — arbitrary projects use `src/`, `packages/`, etc. and may have no `app/`/`lib/` at all. The `dirs` parameter is already the seam (a default, so callers can override it). Not to be confused with `?root=<dir>` (ADR-012, Tier L): that scopes a *large* repo to a subtree, a different concern from which files count as source.
- ~~`server-only` marker inside `lib/scan.ts`~~ **Resolved 2026-07-13.** Removed outright (not relocated) once F1's test setup proved it throws in any non-Next.js Node context, including Vitest — which would have equally broken the future CLI and Electron adapters if "moved to the adapter layer" as originally planned. See `ARCHITECTURE.md` §3 rule 1 for the full reasoning.
- ~~**Visual design is frozen** per the brief — functionality only from here.~~ **Lifted 2026-10-11** by the owner for the Map revamp (ADR-029). The dark amethyst identity stays and the layout is new.
- **Scan scope allowlist (`app/`, `lib/`): resolved by the pivot.** Discovery starts at the repo root via `git ls-files` (`PIVOT_SPEC.md` §5.1).

## ADR-041 — The Map's dark theme is refined for readability: quiet canvas, larger boxes, one meaning per color (2026-10-12) — amends ADR-029

**Context:** ADR-029 kept the original dark amethyst look. On the real V1.3 screen, the owner found it hard to read:
- a starfield, grid, purple haze and glowing edges competing with the content;
- 9–10 px monospace box text, with a description in every box;
- purple used for everything;
- a details panel that was one dense monospace paragraph showing literal backticks, and took about 5 s to open for `src`.

Light themes were mocked up in five rounds (pastel paper, then bold technical with signal orange). They were dropped the same day, before implementation, because they changed the styling without fixing the hierarchy, and the offset-card style read as generated.
**Decision:** keep the dark identity and fix hierarchy and interaction, fully specified in `VISUAL_REFRESH.md`:
- **Canvas:** a flat charcoal canvas with no stars, haze or glow.
- **Boxes:** larger, simpler boxes (name plus count plus a folder or file icon); summaries move to the panel.
- **Colors, one meaning each:** purple for the selection and its links, orange for Claude Code's activity, slate for neutral, green for indexing status only.
- **Map behavior:** unrelated boxes fade to about 60%, every edge has a directional arrow, hover previews a box's connections, double click drills into a folder.
- **Panel:** a structured, actionable panel with clickable relationships, child folders and expandable summaries.
- **Top bar and activity:** a clearer top bar, and a slim activity bar that's always visible and shows Claude's last 3 actions.
- **One system** of radius, type scale and spacing.
- **Speed:** opening the `src` panel goes from about 5 s to ≤ 300 ms warm.
**Alternatives:** (a) The light technical theme (the first draft of this ADR): cleaner than V1.3, but it treated the problem as a palette problem. (b) Keep V1.3 as is: unreadable at a glance, which defeats the product's purpose. (c) A collapsible activity panel: hides the demo's differentiator, so it's kept slim and always visible instead.
**Consequences:** One slice, V1.3.1: tokens in `app/globals.css`, restyled Map components, interaction additions (hover, double click, focus from panel chips, reset), and a `describe` speed fix. S3 must still hold. A three-task test with an unfamiliar user is part of acceptance.
**Revisit when:** the three-task test shows people still can't tell what an edge means, at which point the problem is the data shown, not the styling.

## ADR-042 — The owner's review of V1.3.1: routed lines, pages of related boxes with portals, Back, a source viewer, help, and the violet-slate theme (2026-10-12) — amends ADR-036, ADR-040 and ADR-041

**Context:** The owner looked at the first V1.3.1 build on VS Code and listed what still got in the way (the ledger's "Polish 1–5" and the page-portals plan):
- lines cut straight through boxes, and some went missing until the window was touched;
- a big folder showed 49 boxes and a "+N more" box, so most of `src/vs/platform` (112 children) or the 780 generated protocol files were never drawn; when paging was added by size, boxes on different pages still imported each other, and each page read as an island;
- the browser's Back left the Map, and a reload forgot the folder;
- there was no way to read a file's code from the panel;
- the first look read as monotone gray, and Geist as plain.
**Decision:** the slice takes these on, and the docs carry them (VISUAL_REFRESH.md §2, §4, §6; API_CONTRACTS.md §11, §16):
- **Routed lines** (`app/map/routes.ts`, a custom edge): every line leaves its box's bottom, runs along the channel under that row and a lane in the gutter, and drops into its target's top, with 8 px corners. No line crosses a box. Nodes are handed their size and attach points up front (`flowNodes.ts`), so lines never wait for React Flow to measure.
- **Pages of related boxes, with portals** (`lib/engine/pages.ts`). A folder of more than 50 children is split into pages of 44. A page grows by strongest attachment: it seeds with the first unplaced child in the Map's order and takes the unplaced child with the most imports to and from it, ties by the Map's order; with nothing linked, the next child in order goes in, so a folder with no lines pages by size. Up to 6 **portals** (dashed doorway boxes, `<level>//page-<n>`) stand for the other pages a page has lines with, and the lines to boxes there end at them; past 6 linked pages the 5 most linked keep their own and the rest merge into one `+N pages` portal (`<level>//pages`). So every box is drawn on some page and S4 holds: 44 + 6 = 50. The owner picked this ("A, page portals, plus smart pages") over page badges and a page strip.
- **Focus finds the page.** `GET /api/level?focus=<path>` answers with the page holding that path, so search, the panel's links and `focus_node` land on the right page with the target selected. The Map moves once, when that answer arrives, so Back undoes the jump in one step (the plan had it load page 0, then replace the page). A target already drawn is just selected.
- **Portals list their boxes.** A portal carries `members`, the paths behind it, so a live pulse or a highlight on a box on another page lights that page's doorway (`boxFor`).
- **Keys stay put under a dialog.** While the source viewer or the help is open, Backspace, ← and → and ? leave the Map alone (`app/map/shortcuts.ts`); before, an arrow turned the page and closed the viewer with its panel (second review).
- **Back and the address bar** (`app/map/history.ts`): `/?path=src/vs&page=2` names the Map's place; every move to another folder or page is a history entry, and a reload or a pasted link opens the same place.
- **A read-only source viewer** (`GET /api/source`, `SourceViewer.tsx`): only files the index holds, whose real path stays inside the repo, up to 1 MB. A declaration in the panel opens it at its lines. Code is colored with VS Code's Dark+ palette (highlight.js core with TypeScript and JavaScript, loaded on first use).
- **Help** (`HelpDialog.tsx`): the ? button, the ? key, and a first visit open "How to use the Map".
- **The look**, by the owner's picks: violet-slate surfaces, lavender names and code, the selection still vivid purple; IBM Plex Sans and Plex Mono; hand cursors on everything clickable; thin themed scrollbars; 18 px arrowheads brighter than quiet lines.
**Alternatives:** (a) Keep "+N more" and list the folded boxes in the panel (V1.3): most of a big folder is never seen on the Map. (b) Slice pages by size: simpler, but on `x` in the plan's ground truth it crosses 3 lines of weight 6 where grouping crosses 1 of weight 1, and pages read as islands. (c) Page badges on boxes, or a page strip, instead of portals: they say a line leaves the page but not where it goes, and add chrome. (d) Optimal graph partitioning (for example Kernighan–Lin): better cuts, but costlier and harder to explain, and the greedy cut is deterministic and fast (780 children with 2,000 lines in well under 50 ms).
**Consequences:**
- `MapNodeKind` swaps `"more"` for `"portal"`, a breaking change, so `CONTRACTS_VERSION` goes 2 → 3 (ADR-040, amended below). Portals carry `page` or `pages`, and `members` (the paths behind them) so a client can find the doorway for any path; that's about 60 KB on the 780-child level.
- A page's number is stable for an index version, but a change to the imports can move a box to another page; a saved link then opens the same folder on a page that may hold different boxes.
- Lines between two boxes that are both on other pages aren't drawn on this page, and a page with no lines to another gets no portal for it; the page arrows and the page note still reach every page.
- On VS Code, 36 folders are paged (111 pages), and no page draws more than 50 boxes.
**Revisit when:** a folder of many thousands of children makes the greedy step slow, or the three-task test shows people get lost between pages (then badges or a page strip on top of portals).
**Amended (2026-10-12): busy levels draw lines on demand.** Looking at the portals, the owner found it still hard to see what links to what. The cause was density more than paging: the folders a newcomer opens draw hundreds of lines (`src/vs/platform`'s first page 441, `workbench/services` 235, `workbench/contrib` 220), which nobody can follow with or without portals. A level with more than 60 lines (`BUSY_LINES`, `app/map/emphasis.ts`; 50 levels on VS Code) now draws only the hovered box's lines and the selection's, so a portal lights up only when the box picked links to its page. "Show all lines" restores the rest, and the layout doesn't change, so toggling doesn't move a box. The owner picked this over naming the pages as groups (extra E5, clustering, kept for later) and over leaving it as it was.
**Amended (2026-10-13): the three-task test.** A tester with no programming experience read an arrow backwards, missed the page controls and the panel's "Depends on", and clicked the repo's name expecting to go home (`VISUAL_REFRESH.md` §9 has the run). A hovered line now reads as a sentence, the legend and panel say which arrows are "depends on" and which "used by", arrowheads are 26 px, a page bar sits on the canvas with solid side arrows, the repo's name goes to the top level, and boxes show their summary on hover. The owner then found the page bar loud and camouflaged and the legend running into the boxes: the page indicator became a small pill in the canvas's top-right corner, the legend collapses to a button and opens as a narrow card, and all three overlays (with the zoom controls) became solid cards with no outline, after a light outline was mistaken for lines. The legend's "arrows out / arrows in" rows became one sentence ("A → B: A uses B. The arrow points at what's being used."), and the panel says the same in concrete words under Depends on and Used by.
**Amended (2026-10-13): night violet + cyan, from the logo.** The grey overlays read as monotone, and so, the owner said, did the whole violet-slate theme. From whole-screen renders he picked the logo's colours throughout: night-violet surfaces (`--canvas` `#0E0A1C`, `--surface` `#1B1333`), the logo's violet `#4C1D95` for the overlays, and its cyan `#67E8F9` as a new single-meaning color, `--control`: something you click (links, text buttons, page arrows, overlay buttons). Purple still means the selection only, lavender names and code, orange Claude Code. Every text pair stays above WCAG AA (VISUAL_REFRESH.md §2).
**Amended (2026-10-13): content first.** The owner ran the screen past an outside critique and kept what fit: the controls outshouted the content, boxes were too small to read on busy levels, and the panel was too text-heavy. The overlays became one quiet control style (raised night violet, cyan icons; the page arrows joined it), boxes got brighter with a dot grid behind them, selection lines thinned to 1.5 px, and a bug that made a whole paragraph the panel's lead was fixed. (Code names lost their chips too, until the owner asked for them back; and every panel expander now folds back.) The layout tightened (56 px boxes, layers 64 apart, 8 a row on wide canvases), measured on VS Code at 1907 × 998: `src/vs/platform`'s names from 8.8 to 11.7 px, `services` 7.0 → 9.1, `contrib` 6.5 → 7.8. Kept from the critique's list but declined: a neutral charcoal theme (the owner rejected grey three times) and clusters instead of pages (extra E5, later). The densest levels still fitted at 7–9 px, so, by the owner's choice, a level now never opens smaller than 75% (`app/map/viewport.ts`): one too big to read whole opens from its top, and the fit button still shows it all.
**Amended (2026-10-13): a second outside critique.** The owner ran the Map past another critique (ChatGPT) and kept what fit, picking each change from options rendered on the real Map. A level too big to fit opens as wide as the canvas allows (less 72 px each side, 75–100%), not at the 75% floor: on VS Code's `contrib`, page 2, names went from 11 to 12.4 px on a 1907 px screen. The big page arrows at the canvas's sides went: they duplicated the page pill's buttons (now 36 px), and the right one sat on a box while the panel was open. Doorways read "Lines to page 2" and are unfilled, where "Page 2" on a filled box read like the page pill (the server's portal names are unchanged). The boxes with no line on a page now sit under a divider, a line with "Not linked to anything on this page" in its middle, the owner's own design: across the level when they're below the linked boxes, over the column when they're beside them (the top level), and none when nothing or everything is linked. Declined: the critique's palette (its box border measured 1.6:1 against its canvas, ours 2.1:1, and its fill was greyer), a brighter border (the owner kept today's), and collapsing the legend (it already starts collapsed; the critique saw it open because it remembers being left open). A "focus view" of a box's links across folders moved to extra E5: the panel already lists them, so it improves something that works rather than fixing something broken.

**Amended (2026-10-13, after the merge): the deferred history and focus minors.** A link naming a place another way, or a page past the last, is rewritten in the address bar instead of pushed (`historyStep` in `app/map/history.ts`; the level's own page wins over the asked-for one), so Back takes one press; Back and a repo switch cancel a jump still on its way; a failed jump's message belongs to the place it failed at and goes when the Map moves or after 6 s, instead of a level error that stayed over a good Map; and a doorway taken away by an index update stops being selected (`selectionShown` in `app/map/portals.ts`). The source viewer reads only the first 1 MB of a file and never cuts a character in two (`cutAtCharacter`), and shows a file over 200,000 characters plain rather than freeze the Map while coloring it (`tooLargeToColor`). A hover no longer outlives its level, and a paged level that fits is fitted below the page pill's band (`initialViewport`'s `topBand`), so no box opens under the pill. A hover redraws only the boxes and lines it changes (`reuseUnchanged` in `app/map/flowNodes.ts`): on `src/vs/platform` with all 441 lines shown, a hover painted in a p50 of 40–41 ms instead of 46–47 (p95 45–48 instead of 54).

## ADR-043 — Shipped for other people's repos: a "works on your repo" slice with a free mode, and the extras reordered (2026-10-13) — amends ADR-024 and `PIVOT_SPEC.md` §2, §10 and §12

**Context:** The plan was v1 (the VS Code demo), then all five extras in order, E1 → E5, "over about 1–2 weeks". On 2026-10-13 the owner asked which extras earn their time, and added a goal: other people should be able to use Nebulosity on their own repos. Today nobody else can:
- the package is private, with no command to run and no license;
- it has only run on VS Code and the fixture repo, and only on Windows;
- summaries need an Anthropic API key. The cost is small (VS Code's ~13,000 files and folders were $10.30, so about $1 per 1,000 files), but many Claude Code users are on a subscription and have no key at all;
- it reads TypeScript and JavaScript only, so a Python or Go developer can't use it.

The owner also asked why anyone wouldn't just use Claude Code. The answer recorded here: Nebulosity plugs into Claude Code over MCP instead of replacing it. Its edge should show on big repos (complete dependency answers, summaries of whole areas) and in the Map, which is for people and has no Claude Code equivalent. V1.5's eval tests that claim, losses published. The target user is someone new to a big codebase, not someone in their own small project.

**Decision:**
- **A new slice, V1.6 "Works on your repo",** after V1.5 and before any extra:
  - an installable package: one command each to index a repo, open the Map and connect Claude Code. The owner picks the package name and the license at kickoff;
  - it runs cleanly on a set of real repos of different shapes (named in the slice's plan), on Windows, macOS and Linux;
  - **free mode:** with no API key, the Map, structure and stats, the dependency tools (`dependents`, `dependencies`, `path`), keyword search and `show_on_map` all work, and each place a summary would go says what a key adds. Summaries and meaning-based search are the paid upgrade. The strongest answers, complete dependency sets, need no model at all;
  - the cost is shown and confirmed before any paid run (ADR-035's cap still holds);
  - the README says who it's for, and that summaries send code to Anthropic.
- **The extras run E4 → E5 → E1.** E4 is Python first and Go if there's time: it decides who can use Nebulosity at all. E5 suits the big repos Nebulosity is for. E1 stays for the owner's learning goal and as an interview story; for users, Claude Code with the MCP tools is already the agent that drives the Map.
- **E3 shrinks and becomes optional:** "often changes with…" and the first commit in the panel, from the repo's own history. The History lens and the dashed coupling lines wait. Users' repos usually have full history; the 1.5 GB unshallow fetch is needed only to show it on VS Code.
- **E2 waits on a measurement:** half a day measuring the memory and time of type-checking VS Code, then the owner decides.
- The labels E1–E5 stay as they are, so references across the docs still hold; only the order changes.

**Alternatives:** (a) The plan as written, all five in order: the call graph's risks (type-checker memory on VS Code, resolving injected services, a new view) and the git lens's design rounds come before anything users need, and Python or Go developers still can't use it. (b) v1, then E1 and E5, and stop (the owner's first idea, before users were a goal): right for a demo-only project, but there's no path to other people's repos. (c) Require an API key, with no free mode: the money is small, but needing a key at all loses subscription users at install.

**Consequences:**
- v1 gains three success criteria, S9–S11 (install, repo variety, free mode; `PIVOT_SPEC.md` §2). V1.6's plan sets the repo list and the thresholds.
- Free mode makes "no key" a normal state rather than an error. How the status, the panel and the MCP tools say so is designed in V1.6's plan, and any contract change lands in `API_CONTRACTS.md` then.
- Timeline: V1.6 adds about 3–4 days after V1.5; E4, E5 and E1 take about 2–4 days each.
- Users bring issues and support, which comes out of the owner's time.

**Revisit when:** V1.5's eval shows Nebulosity doesn't help Claude Code on big repos (then the positioning is the question, not the order), or users ask for something this order puts last.

## ADR-044 — The MCP server opens the database read-only (2026-10-13) — amends ADR-023 and ADR-030

**Context:** ADR-030 and PIVOT_SPEC.md §3 (rule 5) said the MCP server reads the database and never migrates, without saying how. Claude Code starts the server once per session, and it may outlive many writes by the Map's background worker (ADR-038) or the CLI. ADR-023 migrates on every open, which a reader must not do: two processes owning one schema is the revisit trigger ADR-023 named.
**Decision:**
- `openDb(file, "readonly")` opens with better-sqlite3's `readonly` and `fileMustExist`, sets no pragmas and runs no migrations. The database itself is never written, but SQLite creates its `-wal` and `-shm` side files beside it when either is missing, so the folder must be writable at those times (with both already there, SQLite reads without writing anything). The file is already in WAL mode (a writer set it, and the mode persists), so it reads while the worker writes, and each query sees the newest commit.
- It checks the file is current: this checkout's newest migration must be in drizzle's `__drizzle_migrations`. If not, `DatabaseOutdatedError` tells the user to start the Map (`npm run dev`) or run `npm run index -- <path-to-repo>` once in the Nebulosity folder, since both migrate (the bare command would migrate nothing: the script exits on a missing path before it opens the database). Any other failure of that check (a file that isn't a database, a busy or unreadable file) is rethrown as it is, since "start the Map" would not help.
- No file is `DatabaseMissingError`: nothing indexed yet. A failed open isn't kept, so the server recovers without a restart once something is indexed.
- The MCP entry point calls `useReadOnlyDatabase()` before anything opens the database. Tests keep their in-memory database.
**Alternatives:** (a) A normal open plus `pragma query_only`: the open would still set WAL and migrate. (b) Let the MCP server migrate as well: a Claude Code session could change the schema under a running Map. (c) A copy of the database per session: stale at once.
**Consequences:** A long-lived reader's caches stay correct only because they're keyed on the index version (ADR-036) or the vector stamp; new caches must follow that rule (ADR-045's import index does). After a pull that brings a migration, the tools answer with the update sentence until the Map or the CLI runs once.
**Revisit when:** the data moves out of the checkout (V1.6's package or the desktop app), so the migrations folder and the database no longer share `NEBULOSITY_HOME`, or the database folder becomes read-only.

## ADR-045 — Import reach: folders as well as files, exact totals, nearest and most-imported first, paged (2026-10-13) — amends PIVOT_SPEC.md §6.1

**Context:** §6.1 asks for `dependents`/`dependencies` (a breadth-first search over an in-memory adjacency list, cached per index version, with an exact total and then the top entries by distance) and `path` (the shortest chain, in either direction, or "no path"). Building them raised four questions: can a target be a folder, how entries at one distance are ordered, how an agent gets more than one answer's worth, and which chain comes back when several are equally short.
**Decision:**
- **Targets.** A file or a folder. A folder's files are the start, and none of them is ever listed, so "what imports `src/vs/base`" means files outside it. The whole repo has no outside and is refused.
- **Totals.** Every answer counts all the files reached and the direct ones, however many are listed.
- **Order.** Nearest first, then the most imported (in-degree, ADR-010), then by path, so a cut list shows the most central files.
- **Paging.** `limit` (1–500, default 50) and `offset`. The cut line names the next offset.
- **Chains.** Breadth-first from every file of `from` at once, neighbours in path order, so the same chain comes back every time. When `from` doesn't reach `to`, the other direction is tried, and the answer says which way the chain runs. Places that overlap are refused.
- **The index.** Both directions as compressed rows (offsets plus neighbours, in `Int32Array`s), built from the import graph describe already loads once per index version (ADR-036), and kept beside it.
**Alternatives:** (a) Files only: an agent asking about an area would have to list its files first. (b) Path order within a distance: a cut list of a hub's thousands of importers would show `build/` and `extensions/` first, whatever matters. (c) No paging and a larger cap: Claude Code moves results of 50,000 characters or more to a file, and a complete list is the point of the tool.
**Consequences:** On VS Code the rows add about 1.3 MB beside the graph, built once per version, and a search over 139,580 imports takes milliseconds (about 2 ms warm; MCP Benchmark #1). Totals are exact for the index, which is as current as the background worker keeps it.
**Revisit when:** agents ask for a subset (the dependents under one folder): add an `under` filter rather than a bigger page.

## ADR-046 — An MCP call answers about the repo Claude Code is in, else the Map's repo (2026-10-13)

**Context:** Claude Code starts the MCP server once per session, in whatever project the user opened, and sets `CLAUDE_PROJECT_DIR` to that project's root for the servers it starts. The index can hold several repos; the Map shows one, the config's `activeRepo` (PIVOT_SPEC.md §7.1). Live events carry paths but no repo (API_CONTRACTS.md §14), so an event about one repo lights boxes with the same paths in another.
**Decision:**
- Each call reads the indexed repos and the config afresh. It answers about the repo holding the project folder (`CLAUDE_PROJECT_DIR`, else the working folder), the deepest when indexed repos nest. Folders compare by forward-slash spelling without a trailing slash, and case-insensitively on Windows.
- Otherwise it answers about the Map's repo, and the answer's first line says so, naming both folders. Otherwise it's an error: nothing indexed yet.
- Live events go to the config's port, read per call, and only when the answering repo is the Map's. `show_on_map` says when the Map shows another repo.
- Free mode is the stored summaries stage: `off` means no key (ADR-043), so the server never loads `.env.local` or holds the key.
- An index update in progress or failed is noted after every answer.
**Alternatives:** (a) Always the Map's repo: Claude Code opened in another indexed repo would get answers about the wrong one, with nothing said. (b) A `repo` argument on every tool: more for the model to get wrong. (c) A repo fixed per registration (`-e`): one registration per repo. (d) A `repo` field on live events, with the Map ignoring others': a contract change for a case this rule already prevents.
**Consequences:** One user-scope registration serves every indexed repo *(the README registers per repo with `--scope local` since the owner's check: ADR-048, amended)*, and `npm run index` or the Map's repo menu take effect without restarting Claude Code. Each call pays a few reads (about 39 ms on VS Code, nearly all of it the two row counts behind the embeddings stage: MCP Benchmark #1).
**Revisit when:** someone runs two Maps on different ports, or wants the Map to follow Claude Code's repo by itself, or setupCall's status read dominates a call (it runs the embeddings counts it doesn't use; MCP Benchmark #1: about 39 ms).

**Amended (2026-10-13, the owner's check of V1.4): absolute paths, and a session below the root.** Two gaps:
- Claude Code's own tools write absolute paths, and the tools refused them, so a model had to retry with a repo-relative one.
- A session started in a subfolder of an indexed repo (a monorepo's package, `vscode/extensions/git`) read every relative path from the repo's root, with nothing saying so: `src/main.ts` would describe the root's file, not the package's.

Now an absolute path inside the repo becomes a repo-relative one (`repoPathFrom`; Windows ignores case). One outside the repo, in a sibling that shares its prefix, or climbing out with `..` is refused, and the refusal names the root. A session below the root gets a first line saying paths count from the repo root, and that its own files start with `<subfolder>/`. One rule, `insideRoot`, decides "inside" for picking the repo, for paths and for that note.

## ADR-047 — One registry entry per tool, answering in compact text (2026-10-13) — amends ADR-030

**Context:** ADR-030 puts each tool in `lib/tools/registry.ts` once, wrapped by MCP now and by LangGraph in E1. Two things weren't settled. What a handler returns, given that the MCP server must also tell the Map (§8) and the Guide will turn UI actions into `ui_action` events (API_CONTRACTS.md §5). And what the answer text looks like: PIVOT_SPEC.md §6.2 asks for compact plain text, exact totals, truncation markers and a freshness note last.
**Decision:**
- An entry is `{ name, description, inputSchema (zod), handler(input, context) }`. The context names the repo, says whether summaries are off, and carries any repo or index note (ADR-046). The handler returns `{ text, paths, action? }`: the answer, the paths it touched, and show_on_map's UI action. It never touches the network: the MCP adapter posts the live event, and E1's adapter will emit `ui_action`.
- The text rules are API_CONTRACTS.md §17: plain text; repo-relative paths, folders ending in "/"; exact counts with separators; lists cut with "… N more" and the next offset where the tool pages; under 40,000 characters; notes last, with the stale-summary note very last, except the repo note, which comes first.
- Free mode answers everything (ADR-043). Where a summary would go, the answer says summaries are off and what a key adds; search says it used code and folder names.
- One pure builder per tool (`lib/tools/answers.ts`) turns engine results into text, so the format is tested without a database.
- `lib/agent/tools.ts` (the owner's Phase 5 tools) stays as it is until E1 replaces it with wrappers over this registry.
**Alternatives:** (a) JSON answers (`structuredContent`): exact, but larger, and a model skims prose faster. (b) Handlers that post live events themselves: the Guide's in-process adapter would then make HTTP calls to its own server. (c) Markdown: tokens spent on syntax.
**Consequences:** A new tool is one entry and one builder. The text is a contract (§17), tested on the fixture.
**Revisit when:** a client wants structured results (an IDE view of a dependents list, say): add an `outputSchema` beside the text.

## ADR-048 — The MCP server starts as `node <checkout>/mcp/launch.mjs` (2026-10-13)

**Context:** Claude Code runs an MCP config's command from the user's project folder. The engine is TypeScript run by tsx, a devDependency that only the checkout has. On Windows, `npx` is a `.cmd` batch file, so a config that starts `npx` needs `cmd /c`.
**Decision:**
- A plain-JavaScript launcher, `mcp/launch.mjs`, run by `node`. It sets `NEBULOSITY_HOME` to the checkout it sits in unless that's already set, imports tsx from the checkout (an ESM import resolves next to the importing file, not from the working folder), then runs `mcp/server.ts`'s `main()`.
- The server speaks MCP over stdio through `@modelcontextprotocol/sdk` 1.32.1, pinned exactly. Before anything else, it sends `console.log`, `info`, `debug`, `dir` and `dirxml` to stderr: stdout carries protocol messages only.
- It exits when the client closes stdin. On Windows, Claude Code (2.1.296) kills the process tree 300 ms after closing it.
- One line registers it on every OS: `claude mcp add --scope user --transport stdio nebulosity -- node <checkout>/mcp/launch.mjs`. *(Amended 2026-10-13 after the owner's check: per repo with `--scope local`, run in the repo's folder; see the amendment below.)*
**Alternatives:** (a) `cmd /c npx tsx …/mcp/server.ts`: a Windows-only line, npx's lookup on every start, and tsx found only if the working folder has it. (b) Compile to `dist/` and run plain JavaScript: no tsx at run time, but a build step before every use. V1.6's package decides that.
**Consequences:** Start-up costs tsx's load plus the engine's transpile: about 0.7 s from spawn to initialized, measured with tsx's cache warm (MCP Benchmark #1). A first-ever start, with a cold tsx cache, wasn't measured. The server needs the checkout's `node_modules`, a local tool's normal state.
**Revisit when:** V1.6 ships an installable package (a `bin` entry replaces the launcher), or Node runs the engine's TypeScript without tsx.

**Amended (2026-10-13, the owner's check of V1.4): registered per repo, with `--scope local`.** Under `--scope user`, Claude Code starts the server in every project. A session in a project Nebulosity hasn't indexed was still told "Nebulosity has already indexed this repository", got answers about the Map's repo (ADR-046's fallback, said on each answer's first line), and its calls lit up the Map. The README now registers the server in each indexed repo's folder with `--scope local`, the way the owner registered it for VS Code, and says why not `--scope user`. This is docs only: the server and ADR-046's rule are unchanged. V1.6's installer revisits a single registration.
