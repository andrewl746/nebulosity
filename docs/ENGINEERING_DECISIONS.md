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

---

## Decisions inherited from the existing codebase (pre-dating this doc set)

- **Radial ring layout is a placeholder** — deterministic, overlap-free, edge-blind. Replacement path is now formalized in ADR-011 and `VISUALIZATION_DESIGN.md`; the swap surface is one pure function (`radialPosition`).
- **Node id = project-relative file path** — the quiet keystone: graph nodes, chunks, tool args, sources, and highlights all join on this key. Preserve it in every future subsystem.
- ~~`server-only` marker inside `lib/scan.ts`~~ **Resolved 2026-07-13.** Removed outright (not relocated) once F1's test setup proved it throws in any non-Next.js Node context, including Vitest — which would have equally broken the future CLI and Electron adapters if "moved to the adapter layer" as originally planned. See `ARCHITECTURE.md` §3 rule 1 for the full reasoning.
- **Visual design is frozen** per the brief — functionality only from here.
