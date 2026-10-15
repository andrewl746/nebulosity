# ARCHITECTURE.md — Nebulosity System Architecture

> **Updated in slice V1.3** for the pivot (`PIVOT_SPEC.md`): §2, §4, §5 and §6 below describe the Map, the background worker and the live channel. §3's layering rules hold unchanged.

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
┌──────────────────────────────── BROWSER ─────────────────────────────────┐
│  The Map (app/map): one level on a React Flow canvas, the detail panel,  │
│  ⌘K search, the status pill, the live dock                               │
└──────────────┬────────────────────────────────────────▲──────────────────┘
               │ HTTP (app/map/api.ts)                  │ SSE /api/live/stream
┌──────────────▼──────────── NEXT.JS SERVER (adapters, a reader) ─────────┴┐
│  app/api/{level, describe, search, status, summarize, index, repos,      │
│           live, live/stream}         instrumentation.ts → supervisor     │
└──────────────┬──────────────────────────────┬────────────────────────────┘
               │ plain function calls          │ fork + IPC (ADR-038)
┌──────────────▼────────────── CORE (lib/) ────▼────────────────────────────┐
│ engine/      level · describe · graph (areas) · search · status · repos   │
│ index/       discover → parse → resolve → aggregate · update · watch      │
│              summarize/ (plan, run, Claude) · embed                       │
│ background/  service (the worker's logic) · supervisor · protocol         │
│ live/        hub · guard · poster        db/  schema · client · store/*   │
└──────────────┬──────────────────────────────────────────┬─────────────────┘
               │                                          │
  .nebulosity/nebulosity.db (SQLite, WAL):          Anthropic API
  read by the server; written by the worker         (summaries, from the worker
  and the CLI                                        and the CLI)
```

The background worker is `scripts/background.ts`, forked by the server at start-up (`instrumentation.ts`, ADR-038). It runs `lib/background/service.ts`: the file watcher, incremental updates (ADR-037), summary refreshes and embeddings. The MCP server is a third process, one per Claude Code session: `node <checkout or package>/mcp/launch.mjs` (ADR-048; `nebulosity setup` registers it, ADR-058) serves `lib/tools/registry.ts` over stdio. It's read-only on the database (ADR-044), picks its repo from Claude Code's project folder (ADR-046), and posts live events to the Map's server.

The static demo (ADR-049) is two more adapters, and runs no server. `scripts/export-demo.ts` reads the database without writing and writes the Map's answers for every folder to files, with the repo named instead of rooted, then scans them for any path of this machine. `app/map/staticApi.ts` is the Map's transport in the demo build: it answers the same calls from those files (refusing the ones that need a server), searches in the browser with `lib/engine/staticSearch.ts`, and is chosen in place of `app/map/api.ts`'s HTTP calls when `npm run build-demo` builds the site.

---

## 3. The three layers and the dependency rule

This is the most important idea in the architecture. There are exactly three layers, and dependencies flow in **one direction only**:

```
UI (app/components, app/page.tsx)
  │  may import: contracts types, api-client helpers, pure browser-safe lib/ modules (rule 3)
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
3. **The UI never calls core directly.** Today `app/page.tsx` (a server component) calls `scanProject()` directly — that was expedient for the MVP and is scheduled to move behind `GET /api/graph` in Phase 1. After that, the UI's only knowledge of the backend is the contract types. *(Amended 2026-10-14, V1.5, ADR-052 and ADR-049: the UI may also import `lib/` modules that are pure and browser-safe, meaning they never touch a database, a disk or the network. Today that is three modules. `lib/engine/rank.ts` is the ranking core: the search palette uses it to name a hit's code, and the static demo's search ranks with it. `lib/engine/staticSearch.ts` is the static demo's search, which its transport `app/map/staticApi.ts` calls. `lib/index/identifiers.ts` splits identifiers into words, and the UI bundles it through the other two. The import-line test in `lib/engine/rank.test.ts` pins what each may import. Everything else under `lib/` stays behind the API.)*
4. **Shared request/response types live in `lib/contracts.ts`** — one file, imported by both UI and adapters, so the two sides cannot drift apart silently. Persistence shapes are the one exception: they live in `lib/db/schema.ts` (ADR-013), because the database schema is its own compiler-enforced contract.
5. **Only `lib/db/*` touches the database; only `lib/scanner-bridge.ts` chooses a scan engine.** The native C++ scanner (ADR-014) is an optional accelerator behind the same `ScannedFile[]` contract as the Node scanner — nothing above the bridge knows or cares which engine ran. Where the files live: `NEBULOSITY_HOME` is the code root (migrations, scripts), and `NEBULOSITY_DATA` is the data folder (database, config, demo export; `lib/home.ts` `dataDir()`), by default `<code root>/.nebulosity` and, for an installed copy, the user's own data folder (ADR-044, amended).

---

## 4. What runs where

| Concern | Where | Why |
|---|---|---|
| Filesystem scanning, AST parsing | Server (core) | Browsers cannot read the filesystem |
| Indexing, file watching, summaries, embeddings | Background worker process (ADR-038) | CPU-heavy and long-running; it must never stall the server's requests |
| LangGraph agent loop, tool execution | Server (core) | Holds API keys; calls Anthropic |
| `.nebulosity/` storage reads/writes | Server (core) | Filesystem |
| The Map: rendering, pan/zoom, the panel | Client | Interactivity requires browser events/state |
| Chat input, streamed message display | Client | Interactivity |
| Executing UI actions (highlight/focus) | Client | They mutate React Flow state |
| Secrets (`ANTHROPIC_API_KEY` in `.env.local`) | Server only | Never shipped to the browser |

---

## 5. Target directory layout

```
nebulosity/
├── app/
│   ├── api/                 # adapters: level, describe, search, status, summarize, index, repos, live, live/stream; _lib/respond.ts
│   ├── map/                 # the Map: MapView, MapCanvas, MapBox, Legend, DetailPanel, SearchPalette, StatusPill,
│   │                        #   ActivityBar, TopBar, Breadcrumb, RepoMenu, the api.ts client (staticApi.ts in the demo
│   │                        #   build, ADR-049), and pure helpers
│   │                        #   (levelLayout, emphasis, activity, text, paths, format, pulses, summaries)
│   └── layout.tsx · page.tsx · globals.css (the color tokens, VISUAL_REFRESH.md §2)
├── instrumentation.ts       # starts the background worker with the server
├── proxy.ts                 # every /api route: 403 unless the Host is this machine (ADR-039)
├── lib/
│   ├── contracts.ts · config.ts · home.ts · embed.ts · chunks.ts
│   ├── db/                  # schema, client, batch, store/{structure, summaries, summary-vectors, search, stages, lock, map, version}
│   ├── engine/              # level, describe, graph, freshness, search, rank, staticSearch, status, repos, git-remote, errors, reach, impact, architecture, docs
│   ├── demo/                # export (the static demo's files), privacy (the scanner for paths of this machine)
│   ├── index/               # discover, languages/, resolve, aggregate, pipeline, update, watch, embed, summarize/
│   ├── background/          # service, supervisor, protocol, child, start
│   ├── live/                # hub, event, sse, local, client
│   └── agent/               # E1: tools.ts (ported in V1.3), state.ts
├── bin/                     # nebulosity.mjs, the one command (ADR-058); boot.mjs, what both launchers do first
├── mcp/                     # launch.mjs and server.ts: the MCP server over stdio (ADR-048)
├── scripts/                 # cli.ts and commands/ (the nebulosity command), index, summarize, search, live,
│                            #   background (the worker), mcp-smoke, bench-map, bench-update,
│                            #   export-demo, build-demo, serve-demo (the static demo), …
├── test/                    # fixtures/mini-repo, helpers
└── docs/
```

---

## 6. The three data flows

### Flow A — Opening the Map
1. The page loads. `MapView` polls `GET /api/status` every 2 s and fetches `GET /api/level?path=` for the root.
2. The route calls `level()`: three indexed lookups (the children, their summaries, the level's `level_edges`). A folder of more than 50 children is paged by `lib/engine/pages.ts`: 44 related boxes and up to 6 portals to its other pages (ADR-036, ADR-042).
3. The canvas lays the boxes out with dagre and draws the lines. A click fetches `describe()` for the panel, and a missing summary is asked for once (`POST /api/summarize`, done by the worker).
4. When the index version moves (a saved file, a summary landing), the Map refetches what's on screen.

### Flow B — Indexing
1. A full run is `npm run index -- <repo>`, or `POST /api/index` (the status pill's re-index, run by the worker). While the Map is open, the worker's watcher applies incremental updates instead (ADR-037).
2. The structure stage: discover → parse changed files → write → resolve → aggregate (`lib/index/pipeline.ts`). Over HTTP, progress streams as SSE `progress` events, one per step (`API_CONTRACTS.md` §4).
3. Summaries and embeddings follow in the background (`npm run summarize`, or the worker's refresh). Each stage reports its state at `GET /api/status`.
4. Everything lands in SQLite (`DATABASE_DESIGN.md`). Nothing is held only in memory, so the server can restart without re-indexing.

### Flow C — Conversation (the core product loop)

1. User sends a message from the Guide's input (E1; `TerminalPanel` retired in V1.3) → `POST /api/chat` `{ sessionId, message }`.
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
