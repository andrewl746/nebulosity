# ARCHITECTURE.md — Nebulosity System Architecture

**Status:** Approved design, not yet fully implemented
**Date:** 2026-07-10
**Audience:** The project owner (learning-focused) and any LLM or developer implementing phases of `IMPLEMENTATION_ROADMAP.md`
**Reading order for the doc set:** this file → `RAG_PIPELINE.md` → `AI_AGENT_DESIGN.md` → `LANGGRAPH_DESIGN.md` → `DATABASE_DESIGN.md` → `API_CONTRACTS.md` → `VISUALIZATION_DESIGN.md` → `IMPLEMENTATION_ROADMAP.md` → `ENGINEERING_DECISIONS.md`
**Maintenance rule:** these documents are living. Any change to the design — a new decision, a renamed contract, a re-scoped phase — MUST update the affected doc(s) in the same commit as the change. Code reviews and audits live beside them (see `GRAPH_IMPLEMENTATION_REVIEW.md`).
**Auxiliary docs:** `GRAPH_IMPLEMENTATION_REVIEW.md` (dated audits + golden test vectors) · `RAG_IMPLEMENTATION_REVIEW.md` (dated audit of the Phase 2–4 chunk → embed → retrieve pipeline) · `EXECUTION_PROMPTS.md` (paste-able per-phase kickoff prompts for implementing models) · `LEARNING_NOTES.md` (study guide / interview prep). The compiler-enforced contracts live in `lib/contracts.ts` (authored 2026-07-12).

---

## 1. What Nebulosity is

An AI-powered codebase onboarding tool. It scans a repository, renders an interactive dependency graph, and hosts an AI "architect" agent that answers questions about the code using retrieved context (RAG) and can drive the graph UI (highlight nodes, focus the camera) while it explains.

It is a **local, single-user tool**. There is no auth, no multi-tenancy, no cloud storage. The only network dependency is the Anthropic API for the LLM.

---

## 2. The system at a glance

```
┌─────────────────────────────  BROWSER (client)  ─────────────────────────────┐
│                                                                              │
│   TerminalPanel ────────┐          GraphCanvas (React Flow)                  │
│   (chat UI, streams     │          (nodes, edges, highlights,                │
│    agent responses)     │           camera focus)                            │
│            │            │                    ▲                               │
│            │      UI actions executed here ──┘                               │
└────────────┼─────────────────────────────────────────────────────────────────┘
             │  HTTP + SSE (JSON contracts — see API_CONTRACTS.md)
┌────────────▼──────────────  NEXT.JS SERVER (adapters)  ──────────────────────┐
│   app/api/graph      app/api/index      app/api/chat       app/api/health    │
│   (thin route handlers: parse request → call core → serialize response)      │
└────────────┬──────────────────────────────────────────────────────────────── ┘
             │  plain function calls
┌────────────▼────────────────────  CORE (lib/)  ──────────────────────────────┐
│                                                                              │
│  scanner-bridge.ts ──► graph.ts       chunk.ts ──► embed.ts ──► retrieve.ts  │
│   │ prefers native,    (nodes/edges   (AST →       (text →      (top-k       │
│   │ falls back to       + layout)      chunks)      vectors)     search)     │
│   │ scan.ts (Node)                                                           │
│   │                                                                          │
│  agent/ ── state.ts · tools.ts · prompts.ts · graph.ts (LangGraph loop)      │
│   │                                                                          │
│  db/ ── schema.ts · client.ts · graph-store.ts  (Drizzle, ADR-013)           │
└───┬─────────────────────┬──────────────────────────────────┬─────────────────┘
    │ spawn + JSON        │                                  │
    │ over stdout (IPC)   │                                  │
┌───▼────────────────┐ ┌──▼─────────────────────┐  ┌─────────▼─────────┐
│ native/scanner     │ │ .nebulosity/           │  │  Anthropic API    │
│ (C++17 thread pool │ │ nebulosity.db (SQLite, │  │  (Claude models)  │
│  scanner, ADR-014) │ │ WAL) — the data layer  │  └───────────────────┘
└────────────────────┘ └────────────────────────┘
```

---

## 3. The three layers and the dependency rule

This is the most important idea in the architecture. There are exactly three layers, and dependencies flow in **one direction only**:

```
UI (app/components, app/page.tsx)
  │  may import: contracts types, api-client helpers
  ▼
ADAPTERS (app/api/*/route.ts)
  │  may import: core, contracts
  ▼
CORE (lib/*)
     may import: node stdlib, npm libraries, contracts
     MUST NOT import: anything from app/, next/*, react
```

**Why:** the project brief requires that Nebulosity can later become a desktop app (Electron/Tauri) or grow a CLI. If core logic never touches Next.js or React, migrating means writing a new thin adapter layer (Electron IPC handlers instead of route handlers) and reusing `lib/` unchanged. The UI already talks to the server only through JSON contracts, so it ports too.

Rules an implementer MUST follow:

1. **Core files never import from `app/` or `next`.** `lib/scan.ts` previously imported the `server-only` package as a defensive guard; it was removed 2026-07-13 while setting up F1's test harness, which surfaced the exact problem `ENGINEERING_DECISIONS.md`'s inherited-debt note predicted — the package throws when imported from any non-Next.js Node context, which includes a Vitest run. The original plan was to relocate the guard to the adapter layer instead of deleting it, but that turned out to be the wrong fix: this project's core is meant to be reusable from *multiple* future adapters (a web route handler, a CLI, an Electron main process), and none of those are "a real Next.js server" as far as `server-only` is concerned — it would have broken the CLI/Electron targets identically. The guard added no protection the architecture doesn't already provide (rule 3 below already forbids the UI from calling core directly), so it was deleted outright rather than moved.
2. **Route handlers contain no business logic.** They validate input, call one core function, and shape the response. If a route handler grows past ~50 lines, logic is leaking into the adapter.
3. **The UI never calls core directly.** Today `app/page.tsx` (a server component) calls `scanProject()` directly — that was expedient for the MVP and is scheduled to move behind `GET /api/graph` in Phase 1. After that, the UI's only knowledge of the backend is the contract types.
4. **Shared request/response types live in `lib/contracts.ts`** — one file, imported by both UI and adapters, so the two sides cannot drift apart silently. Persistence shapes are the one exception: they live in `lib/db/schema.ts` (ADR-013), because the database schema is its own compiler-enforced contract.
5. **Only `lib/db/*` touches the database; only `lib/scanner-bridge.ts` chooses a scan engine.** The native C++ scanner (ADR-014) is an optional accelerator behind the same `ScannedFile[]` contract as the Node scanner — nothing above the bridge knows or cares which engine ran.

---

## 4. What runs where

| Concern | Where | Why |
|---|---|---|
| Filesystem scanning, AST parsing | Server (core) | Browsers cannot read the filesystem |
| Chunking, embedding, vector search | Server (core) | CPU-heavy; embedding model runs in Node |
| LangGraph agent loop, tool execution | Server (core) | Holds API keys; calls Anthropic |
| `.nebulosity/` storage reads/writes | Server (core) | Filesystem |
| Graph rendering, pan/zoom, node drag | Client | Interactivity requires browser events/state |
| Chat input, streamed message display | Client | Interactivity |
| Executing UI actions (highlight/focus) | Client | They mutate React Flow state |
| Secrets (`ANTHROPIC_API_KEY` in `.env.local`) | Server only | Never shipped to the browser |

---

## 5. Target directory layout

```
nebulosity/
├── app/
│   ├── api/
│   │   ├── graph/route.ts        # GET  — build/return dependency graph
│   │   ├── index/route.ts        # POST — run indexing pipeline (SSE progress)
│   │   ├── chat/route.ts         # POST — agent conversation (SSE stream)
│   │   ├── search/route.ts       # GET  — debug: raw retrieval results
│   │   └── health/route.ts       # GET  — index status, counts, versions
│   ├── components/
│   │   ├── GraphCanvas.tsx       # exists — gains highlight/focus support (Phase 1)
│   │   ├── FileNode.tsx          # exists
│   │   ├── TerminalPanel.tsx     # exists — gains real streaming chat (Phase 6)
│   │   └── StarField.tsx         # exists
│   ├── layout.tsx / page.tsx / globals.css / icon.svg
├── lib/
│   ├── contracts.ts              # shared API + domain types (exists)
│   ├── scan.ts                   # exists — Node import scanner (fallback engine)
│   ├── scanner-bridge.ts         # exists — engine selection + IPC + fallback (ADR-014)
│   ├── graph.ts                  # exists — nodes/edges + layout
│   ├── chunk.ts                  # AST → code chunks (Phase 2)
│   ├── embed.ts                  # text → vectors (Phase 3)
│   ├── retrieve.ts               # query → top-k chunks (Phase 4)
│   ├── db/                       # exists — the data layer (ADR-013)
│   │   ├── schema.ts             #   tables: repositories/files/imports/chunks/vectors/meta/sessions
│   │   ├── client.ts             #   getDb(): WAL, FKs, hot-reload-safe singleton
│   │   └── graph-store.ts        #   saveScan (transactional) + loadGraph
│   └── agent/
│       ├── state.ts              # LangGraph state schema (Phase 5)
│       ├── tools.ts              # tool implementations (Phase 5)
│       ├── prompts.ts            # system prompt builder (Phase 5)
│       └── graph.ts              # LangGraph wiring (Phase 5)
├── native/scanner/               # exists — C++17 thread-pool scanner (ADR-014)
│   ├── main.cpp                  #   traversal + worker pool + JSON over stdout
│   ├── CMakeLists.txt
│   └── README.md                 #   build instructions (toolchain optional)
├── drizzle.config.ts             # exists — migration tooling config
├── scripts/scan.ts               # exists — standalone CLI demo of the scanner
├── docs/                         # this document set
└── .nebulosity/nebulosity.db     # SQLite database (gitignored, derived)
```

---

## 6. The three data flows

### Flow A — Page load (graph display)

1. Browser requests `/`. The page fetches `GET /api/graph`.
2. The route handler calls `scanProject()` → `toFlowGraph()` in core.
3. Response: `{ nodes, edges, stats }` (see `API_CONTRACTS.md`).
4. `GraphCanvas` renders it. No AI, no index required — the graph works even if the user never indexes or configures an API key.

### Flow B — Indexing (one-time per repo, re-run after changes)

1. User triggers `POST /api/index` (a button in the UI, Phase 6, or curl before that).
2. Core pipeline per file: hash → skip if unchanged → AST-chunk → embed → persist.
3. Progress streams back as SSE events (`scanning`, `chunking`, `embedding`, counts).
4. Result lands in the SQLite database as one transaction per stage (see `DATABASE_DESIGN.md`). Nothing is held only in memory, so the server can restart without re-indexing.

### Flow C — Conversation (the core product loop)

1. User sends a message from `TerminalPanel` → `POST /api/chat` `{ sessionId, message }`.
2. The route handler invokes the LangGraph agent (see `LANGGRAPH_DESIGN.md`).
3. The agent loops: reason → call tools (`search_code`, `read_file`, `get_importers`, `highlight_nodes`, …) → reason → answer.
4. Everything streams to the browser as SSE events: `token` (answer text), `tool_start`/`tool_end` (visible activity), `ui_action` (graph commands), `sources` (cited files), `done`.
5. The client renders tokens into the chat and **executes `ui_action` events against React Flow** — this is how the agent "points at" the graph while explaining.

---

## 7. Desktop migration path (why this shape survives)

When Nebulosity moves to Electron or Tauri:

- `lib/` (core) moves unchanged — it is plain Node + npm.
- `app/api/*` route handlers are replaced by IPC handlers or a tiny embedded HTTP server exposing the **same contracts** from `lib/contracts.ts`.
- React components move nearly unchanged; only the fetch base URL / transport changes, isolated in one small api-client module.
- `.nebulosity/` storage works identically (it's just files).

The discipline that makes this cheap is bought now, at design time: contracts in one file, no framework imports in core, no logic in adapters.

---

## 8. Glossary (plain-language, for the learner)

- **AST (Abstract Syntax Tree):** the tree structure a compiler builds from source code. Instead of seeing `function foo() {...}` as text, you see a `FunctionDeclaration` node with a name and a body. Parsing to an AST is how you find "real" function boundaries instead of guessing with regex.
- **Chunk:** a bite-sized piece of code (one function, one component) stored with metadata. The unit of retrieval.
- **Embedding:** a list of numbers (here: 384 of them) representing the *meaning* of a piece of text. Texts with similar meaning get numerically similar vectors.
- **Vector store:** the place embeddings live, with a way to search them. Here: a JSON file plus a loop that computes similarity.
- **Cosine similarity:** a score (−1 to 1) of how similar two vectors point. With normalized vectors it reduces to a dot product.
- **RAG (Retrieval-Augmented Generation):** instead of asking the LLM from memory, first *retrieve* relevant chunks, then ask the LLM to answer *using them*. Kills hallucination for codebase questions.
- **ReAct loop:** the agent pattern of alternating **Rea**soning and **Act**ing (tool calls) until it can answer.
- **SSE (Server-Sent Events):** a plain-HTTP way for the server to stream many small messages over one response. Simpler than WebSockets when traffic is one-directional (server → client).
- **Adapter:** a thin translation layer between the outside world (HTTP, IPC) and your real logic. Adapters are disposable; core is not.
- **IPC (Inter-Process Communication):** how two separate programs talk. The native scanner uses the oldest, most portable form: the child writes JSON to stdout, the parent reads the pipe.
- **WAL (Write-Ahead Logging):** SQLite journal mode where writes append to a log instead of locking the main file — readers keep reading while a write is in flight.
