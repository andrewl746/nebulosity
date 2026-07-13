# EXECUTION_PROMPTS.md — Paste-able Kickoff Prompts per Phase

**Status:** Utility doc, written 2026-07-12
**Purpose:** each block below is a complete prompt to paste into a fresh model session to start that phase. They front-load the reading list, the constraints models most often violate, and the exact verification commands — so a weaker model starts pointed the right way instead of rediscovering (or misremembering) the design.

**How to use:** paste one block verbatim. Run one phase per session. When the model claims it's done, *you* run the verification commands and check the phase's acceptance criteria in `IMPLEMENTATION_ROADMAP.md` yourself before accepting.

---

## The standing constraints (embedded in every prompt below)

1. Core (`lib/`) never imports from `app/` or `next` — see `docs/ARCHITECTURE.md` §3.
2. `lib/contracts.ts` already exists and is authoritative for API/domain shapes. Persistence shapes belong in `lib/db/schema.ts` once built (ADR-013). Only `lib/db/*` may touch the database; only `lib/scanner-bridge.ts` may choose a scan engine (ADR-014) — neither exists yet, see the note on Phases D/S below.
3. No UI redesign — the visual design is frozen (CLAUDE.md).
4. Update any affected doc in the same change set (maintenance rule, `docs/ARCHITECTURE.md`).
5. Done means: `npx tsc --noEmit` clean, `npm run lint` clean, app still runs, phase acceptance criteria pass.

---

## Prompt — P0 review fixes (run before Phase 1)

```text
You are implementing the P0 fixes (F1–F4) from docs/GRAPH_IMPLEMENTATION_REVIEW.md
in the Nebulosity repo. Read that file's PART 2 and PART 3 first, plus
docs/ARCHITECTURE.md §3 (dependency rule).

Tasks, strictly in order:
1. F1: npm i -D vitest; add a "test" script; create lib/graph.test.ts and
   lib/scan.test.ts by TRANSCRIBING the golden vectors in
   GRAPH_IMPLEMENTATION_REVIEW.md PART 3. Do not compute expectations by
   running the code. Rows marked ⚠ test current buggy behavior — add a
   comment naming the W-item on each. You will need to export the private
   helpers under test (resolveSegments, radialPosition, extractImports);
   export them directly — no test-only wrapper files.
2. F2: make walk() in lib/scan.ts tolerate per-file/per-dir read errors;
   collect { path, error } warnings; change scanProject to return
   { files, warnings }. Update the one caller (app/page.tsx) minimally.
3. F3: in app/components/GraphCanvas.tsx add defaultEdgeOptions with
   markerEnd ArrowClosed; remove animated:true from lib/graph.ts edges.
4. F4: sort files by id before layout in toFlowGraph; skip duplicate ids
   in walk().

Constraints: lib/ must not import from app/ or next. Do not touch styling
beyond F3. Do not fix the W1/W2 regex bugs yet (that is F5, out of scope).
Verify: npx tsc --noEmit && npm run lint && npx vitest run — all clean,
and the graph still renders at localhost:3000.
```

## Prompt — Phase 0 (foundations)

```text
Complete Phase 0 of docs/IMPLEMENTATION_ROADMAP.md for Nebulosity.
Note: lib/contracts.ts already exists (architect-authored) — do NOT recreate
it; read it and verify it typechecks. Remaining work: add .nebulosity/ to
.gitignore; create .env.local containing ANTHROPIC_API_KEY= (empty value).
Verify: npx tsc --noEmit clean; git status shows neither .nebulosity nor
.env.local.
```

## Prompt — Phase 1 (graph API + controllable canvas)

```text
Implement Phase 1 of docs/IMPLEMENTATION_ROADMAP.md in the Nebulosity repo.
Read first: docs/ARCHITECTURE.md (§3 layering, §6 Flow A),
docs/API_CONTRACTS.md §2–3, lib/contracts.ts, and the Phase 1 task list.
Prerequisite: the P0 fixes from docs/GRAPH_IMPLEMENTATION_REVIEW.md are done.

Summary of the work: GET /api/graph and GET /api/health route handlers
returning GraphResponse/HealthResponse exactly as typed in lib/contracts.ts
(health index fields hardcoded to not-indexed for now); refactor app/page.tsx
so a client component fetches /api/graph and owns nodes/edges as controlled
state; node click → details strip; highlightedNodeIds state dims/brightens
FileNode via props; focusNode(id) via useReactFlow().fitView; migrate
FileNode.tsx and lib/graph.ts to import FileKind/FileNodeData/GraphFileNode
from lib/contracts.ts instead of local copies; move the server-only guard
out of lib/scan.ts into the route handler layer.

Constraints: route handlers stay under ~50 lines (logic lives in lib/);
no visual redesign — highlight/dim uses the existing amethyst palette;
lib/ never imports app/ or next. Update docs if you deviate from the design.
Verify: npx tsc --noEmit && npm run lint && npx vitest run; graph renders
via the API (check the network tab); clicking selects; a temporary dev
button can highlight and focus a node.
```

## Phases D and S — intentionally not auto-implement prompts

Unlike every other phase, Phases D (data layer) and S (native scanner) are
**deliberately excluded** from this paste-and-run format. The project owner
chose to hand-write both — the schema design, the transaction logic, the
thread pool, the IPC bridge — as the core learning content of this
re-architecture, coached step by step rather than generated.

If you are a future model session picking this up: do not write
`lib/db/*`, `lib/scanner-bridge.ts`, or `native/scanner/main.cpp` on the
project owner's behalf. Follow the incremental build order in
`IMPLEMENTATION_ROADMAP.md` Phase D / Phase S, explain each concept before
the code that implements it, and let them write it. This restriction is
scoped to these two phases only — Phases 2–6 below remain normal
implementation targets.

## Prompt — Phase 2 (indexing)

```text
Implement Phase 2 of docs/IMPLEMENTATION_ROADMAP.md in the Nebulosity repo.
Read first: docs/RAG_PIPELINE.md §2–3 and §6, docs/DATABASE_DESIGN.md,
docs/API_CONTRACTS.md §4, lib/contracts.ts (CodeChunk, IndexEventMap),
lib/db/schema.ts (chunks table, files.contentHash, meta).

Build: lib/chunk.ts using the TypeScript Compiler API from the
already-installed "typescript" package (ts.createSourceFile, walk
sourceFile.statements, map declaration kinds per RAG_PIPELINE.md §2, line
numbers via getLineAndCharacterOfPosition, one file-summary chunk per file,
split oversized declarations with 3-line overlap); lib/index-repo.ts — the
incremental pipeline per RAG_PIPELINE.md §6 (sha256 vs files.contentHash,
skip unchanged, transactional delete+re-chunk per changed file, a meta
"indexing" row as the in-progress flag); POST /api/index streaming
IndexEventMap events as SSE. Embedding is a no-op stub until Phase 3.

Constraints: all database access via lib/db only; chunk ids must be
`${filePath}#${name}#${partIndex}`; do not install ts-morph or tree-sitter
(ADR-004); drizzle statements execute with .get()/.all()/.run(). Verify:
curl -N -X POST localhost:3000/api/index streams progress then done; the
chunks table spot-check — 5 rows' line ranges open to exactly the named
declarations; second run reports all files skippedUnchanged; editing one
file re-chunks only it; npx tsc --noEmit && npm run lint && npx vitest run.
```

## Prompt — Phase 3 (embeddings)

```text
Implement Phase 3 of docs/IMPLEMENTATION_ROADMAP.md in the Nebulosity repo.
Read first: docs/RAG_PIPELINE.md §4, docs/DATABASE_DESIGN.md §2,
docs/ENGINEERING_DECISIONS.md ADR-005 + ADR-013, lib/db/schema.ts (vectors,
meta).

Build: npm i @huggingface/transformers; lib/embed.ts — lazy singleton
feature-extraction pipeline for "Xenova/all-MiniLM-L6-v2", batch size 16,
unit-normalized Float32Array output, and the enriched embedding-text builder
(path + kind/name + doc comment + signature + truncated body —
RAG_PIPELINE.md §4); persist vectors to the vectors table as BLOBs
(Buffer.from(vec.buffer)) with an in-memory Map cache keyed on
repositories.lastIndexAt; record embeddingModel/embeddingDim in meta
(mismatch at startup → wipe derived data); un-stub the Phase 2 pipeline so
indexing embeds changed chunks and emits the "embedding" progress phase.

Verify: after POST /api/index, COUNT(vectors) === COUNT(chunks); every
decoded vector has length 384 and magnitude ≈ 1.0 (assert in a small
vitest); re-index of an unchanged repo does zero embedding work; first-run
model download (~25 MB) is logged so it doesn't look like a hang;
npx tsc --noEmit && npm run lint && npx vitest run clean.
```

## Prompt — Phase 4 (retrieval)

```text
Implement Phase 4 of docs/IMPLEMENTATION_ROADMAP.md in the Nebulosity repo.
Read first: docs/RAG_PIPELINE.md §5, docs/API_CONTRACTS.md §6,
lib/contracts.ts (RetrievedChunk, SearchResponse).

Build: lib/retrieve.ts — embed query, dot-product against all vectors,
top-k=8, drop scores < 0.25, return RetrievedChunk[]; plus the context
formatter with [n] path:start-end headers per RAG_PIPELINE.md §5; and
GET /api/search?q= returning SearchResponse (INDEX_EMPTY envelope when
unindexed).

Verify with the five acceptance queries in IMPLEMENTATION_ROADMAP.md Phase 4
— each listed target must appear in the top 3. If one misses, tune per
RAG_PIPELINE.md §5 quality levers (embedding text first) rather than
changing k. npx tsc --noEmit && npm run lint && npx vitest run clean.
```

## Prompt — Phase 5 (LangGraph agent)

```text
Implement Phase 5 of docs/IMPLEMENTATION_ROADMAP.md in the Nebulosity repo.
Read first (all of): docs/AI_AGENT_DESIGN.md including Appendix A,
docs/LANGGRAPH_DESIGN.md, docs/API_CONTRACTS.md §5, lib/contracts.ts
(ChatRequest, ChatEventMap, UIAction, ErrorCode).

Build: npm i @langchain/langgraph @langchain/anthropic @langchain/core zod
(pin exact versions); lib/agent/tools.ts — all nine tools per
AI_AGENT_DESIGN.md §3 sharing one safePath() guard (reject paths resolving
outside repo root, the scanner ignore list, and .env*); lib/agent/state.ts
and lib/agent/graph.ts exactly per LANGGRAPH_DESIGN.md §2–3 and §7 CONFIG;
lib/agent/prompts.ts — TRANSCRIBE the system prompt from AI_AGENT_DESIGN.md
Appendix A verbatim, filling the placeholder table; POST /api/chat route
translating streamEvents to SSE per the LANGGRAPH_DESIGN.md §5 mapping table.

Constraints: tool errors return structured strings, never throw through the
graph; recursionLimit 25; the LangChain APIs in the docs may have drifted —
trust the installed package's own .d.ts types over both the docs and your
memory, and note any deviation in docs/LANGGRAPH_DESIGN.md (maintenance rule).
Verify with the five curl -N acceptance conversations in
IMPLEMENTATION_ROADMAP.md Phase 5, including the unset-API-key case;
npx tsc --noEmit && npm run lint && npx vitest run clean.
```

## Prompt — Phase 6 (UI wiring)

```text
Implement Phase 6 of docs/IMPLEMENTATION_ROADMAP.md in the Nebulosity repo.
Read first: docs/API_CONTRACTS.md §1 (SSE-via-fetch note) and §5,
docs/ARCHITECTURE.md §6 Flow C, lib/contracts.ts (ChatEvent, IndexEvent).

Build: app/lib/api-client.ts — typed fetch wrappers plus a ~30-line SSE
reader (fetch + getReader, parse "event:/data:" frames into ChatEvent);
rewrite TerminalPanel's submit to stream /api/chat (tokens append live,
tool_start renders as an activity line, sources render as clickable chips
that call focusNode, error renders inline; sessionId =
crypto.randomUUID() once per page load); route ui_action events into the
Phase 1 graph-controls hook and delete the Phase 1 dev button; add the
index-status hint driven by /api/health with an "index now" affordance that
streams /api/index progress lines into the terminal.

Constraints: keep the existing visual design exactly — you are wiring
behavior into existing components, not restyling them; the client never
imports from lib/ except lib/contracts.ts. Verify: the full demo script in
IMPLEMENTATION_ROADMAP.md Phase 6 acceptance — tour request highlights and
focuses nodes while streaming, source chip click focuses, follow-up
question proves memory; npx tsc --noEmit && npm run lint && npx vitest run.
```
