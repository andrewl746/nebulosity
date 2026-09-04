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
**Revisit when:** Nebulosity ever runs as more than one process against one database file, where concurrent migration needs a lock.

---

## Decisions inherited from the existing codebase (pre-dating this doc set)

- **Radial ring layout is a placeholder** — deterministic, overlap-free, edge-blind. Replacement path is now formalized in ADR-011 and `VISUALIZATION_DESIGN.md`; the swap surface is one pure function (`radialPosition`).
- **Node id = project-relative file path** — the quiet keystone: graph nodes, chunks, tool args, sources, and highlights all join on this key. Preserve it in every future subsystem.
- **Scan scope is a hardcoded top-level allowlist** (`scanProject`'s `dirs` default `["app", "lib"]`) — an MVP shortcut for scanning Nebulosity's *own* repo, not a design decision. The rest of the doc set assumes **repo-root** scanning (`API_CONTRACTS.md` §4 "repo root is the server's project root"; the agent's `safePath` boundary in `AI_AGENT_DESIGN.md` §6). Exit path: when Nebulosity scans arbitrary repos (~Phase D, or the first external repo), walk from the repo root and filter via the `IGNORE_LIST` blocklist + `SOURCE_EXTENSIONS` instead of an allowlist — arbitrary projects use `src/`, `packages/`, etc. and may have no `app/`/`lib/` at all. The `dirs` parameter is already the seam (a default, so callers can override it). Not to be confused with `?root=<dir>` (ADR-012, Tier L): that scopes a *large* repo to a subtree, a different concern from which files count as source.
- ~~`server-only` marker inside `lib/scan.ts`~~ **Resolved 2026-07-13.** Removed outright (not relocated) once F1's test setup proved it throws in any non-Next.js Node context, including Vitest — which would have equally broken the future CLI and Electron adapters if "moved to the adapter layer" as originally planned. See `ARCHITECTURE.md` §3 rule 1 for the full reasoning.
- **Visual design is frozen** per the brief — functionality only from here.
