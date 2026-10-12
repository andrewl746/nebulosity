# API_CONTRACTS.md — HTTP + SSE Contracts

> **2026-10-11 — pivot:** the v1 endpoints change (`/api/level`, `/api/describe`, `/api/status`, `/api/summarize`, `/api/live*`), and `/api/graph` and `/api/health` retire. See `PIVOT_SPEC.md` §7.1; this doc is rewritten in slice V1.3. §5 (`/api/chat`) still applies to E1, and §9 (`/api/status`) and §10 (search results) are live from slice V1.2.

**Status:** Approved design. These contracts are **binding**: UI and server may only communicate through what is defined here.
**Single source of truth in code:** every type below lives in `lib/contracts.ts`, imported by both route handlers and UI components. If this doc and `lib/contracts.ts` ever disagree, fix the drift immediately — that file is the compiler-enforced version of this document. (Persistence shapes are separate: they live in `lib/db/schema.ts` per ADR-013 and are documented in `DATABASE_DESIGN.md`.)

---

## 1. Conventions

- Base path `/api`. All bodies are JSON. All routes are same-origin (no CORS needed).
- **Errors** (non-SSE routes): appropriate HTTP status + envelope
  `{ "error": { "code": string, "message": string } }`
  Codes: `BAD_REQUEST`, `NOT_FOUND`, `INDEX_EMPTY`, `INDEX_LOCKED`, `INTERNAL`.
- **SSE format:** standard `text/event-stream`:
  `event: <name>\ndata: <json>\n\n`
  Note for the UI implementer: the browser's `EventSource` API cannot send POST bodies. Consume SSE with `fetch` + `response.body.getReader()` and parse the stream manually (a small parser in the api-client module, ~30 lines).
- **Node ids = file paths.** Graph node ids, `highlight_nodes` arguments, and `sources` entries are all project-relative forward-slash paths ("lib/graph.ts"). This single shared identifier is what lets every subsystem point at the same things.

## 2. GET /api/graph

Scans the repo and returns the dependency graph. Never requires an index or API key.

**Reserved query params (Tier L scaling, not implemented in v1 — see `VISUALIZATION_DESIGN.md` §4 / ADR-012):** `?root=<dir>` scopes the graph to a subtree; `?depth=<n>` controls directory-cluster expansion. v1 servers ignore them; clients must not send them until Tier L ships.

**Response 200 — `GraphResponse`:**
```ts
type GraphResponse = {
  nodes: FileNodeType[];   // exact React Flow node shape produced by lib/graph.ts
  edges: Edge[];           // exact React Flow edge shape
  stats: {
    fileCount: number;
    edgeCount: number;
    rootName: string;                       // "Nebulosity"
    warningCount: number;                   // per-file scan warnings (F2); 0 = clean scan
    centralFiles: { path: string; inDegree: number; outDegree: number }[]; // top 5
  };
};
```

## 3. GET /api/health

Powers the status bar and "do I need to reindex?" hints.

**Response 200 — `HealthResponse`:**
```ts
type HealthResponse = {
  ok: true;
  lastScanAt: string | null; // ISO timestamp of the repo's last dependency-graph scan (DB-backed, Phase D); null if never scanned
  index: {
    exists: boolean;
    indexedAt: string | null;
    chunkCount: number;
    staleFiles: number;      // files whose contentHash differs from disk (0 = fresh)
  };
  scannerEngine: "native" | "node"; // which scan engine will serve the next scan (ADR-014)
  agentReady: boolean;       // ANTHROPIC_API_KEY is present (never echo the key)
};
```

**Implemented for real as of Phase 2/3 (2026-09-04).** The `index` block was hardcoded to zeros through Phase D; it is now served by `getIndexStatus` (`lib/index-status.ts`), shared with `POST /api/index` so the two endpoints cannot disagree about what "indexed" means.

- `exists` is **`chunkCount > 0`**, not "a run happened" — a run that failed every file still stamps `lastIndexAt`, and the status pip must not call that indexed.
- `staleFiles` re-hashes every indexed file on each request. That is affordable because the status bar fetches health once on mount for one local repo; if health ever becomes polled, or targets a large repo, it needs an mtime fast-path first.

## 4. POST /api/index — SSE

Runs the indexing pipeline (`RAG_PIPELINE.md`). Body: `{}` (repo root is the server's project root in v1).

**SSE events, in order:**

| event | data | notes |
|---|---|---|
| `progress` | `{ phase: "scanning" \| "chunking" \| "embedding", done: number, total: number, currentFile?: string }` | emitted at least once per phase; `done`/`total` are **run-scoped** in every phase |
| `done` | `{ fileCount, chunkCount, skippedUnchanged, tookMs, changed, errors[], warnings[] }` | terminal event on success |
| `error` | `{ code, message }` | terminal on failure; `INDEX_LOCKED` if another run holds the lock |

**Phase semantics (Phase 2/3, 2026-09-04).** The pipeline runs `scanning` → `chunking` → `embedding` → commit, and embedding is a **single batched pass over the whole run**, not per file — so `done`/`total` count chunks across the entire job and rise monotonically. An earlier per-file loop reset the counters on every file, which no client can render as a progress bar. A warm re-index emits no `embedding` events at all.

**`done` carries per-file failures (ADR-021):** `errors[]` and `warnings[]` are `{ path, error }[]`, and `changed` is the number of files re-chunked. Indexing is per-file error-tolerant, so without these a run where every file failed looks identical to a clean one.

**`INDEX_LOCKED`** is raised from a typed `IndexLockedError`, not matched on message text. The lock is a `meta` row holding the run's ISO start time and is treated as stale after 30 minutes, so a crashed run cannot block indexing forever.

## 5. POST /api/chat — SSE (the main event)

**Request:**
```ts
type ChatRequest = {
  sessionId: string;   // client-generated UUID; stable across turns = memory works
  message: string;
};
```

**SSE events:**

| event | data type | meaning |
|---|---|---|
| `token` | `{ text: string }` | append to the assistant's message in the UI |
| `tool_start` | `{ tool: string, args: Record<string, unknown> }` | show activity line ("◈ search_code: …") |
| `tool_end` | `{ tool: string }` | mark the activity line finished |
| `ui_action` | `{ action: UIAction }` | **execute against the graph immediately** |
| `sources` | `{ files: string[] }` | render source chips under the finished message |
| `error` | `{ code: string, message: string }` | show inline; codes incl. `BUDGET_EXCEEDED`, `INDEX_EMPTY`, `UPSTREAM` |
| `done` | `{}` | always the final event, success or failure |

```ts
type UIAction =
  | { type: "highlight_nodes"; nodeIds: string[] }
  | { type: "focus_node"; nodeId: string }
  | { type: "clear_highlights" };
```

**Worked example** — user asks "what does lib/graph.ts do?":

```
event: tool_start
data: {"tool":"search_code","args":{"query":"graph nodes edges transform"}}

event: tool_end
data: {"tool":"search_code"}

event: tool_start
data: {"tool":"highlight_nodes","args":{"nodeIds":["lib/graph.ts"],"reason":"discussing this file"}}

event: tool_end
data: {"tool":"highlight_nodes"}

event: ui_action
data: {"action":{"type":"highlight_nodes","nodeIds":["lib/graph.ts"]}}

event: token
data: {"text":"`lib/graph.ts` is the transform layer: it converts the scanner's raw"}

event: token
data: {"text":" output into React Flow nodes and edges…"}

event: sources
data: {"files":["lib/graph.ts"]}

event: done
data: {}
```

## 6. GET /api/search?q=… — debug endpoint

Raw retrieval without the agent — exists so Phase 4 can be verified before Phase 5, and stays as a permanent debugging tool.

**Response 200:** `{ results: (CodeChunk & { score: number })[] }` (top-k, same pipeline the `search_code` tool uses).
**Error:** `INDEX_EMPTY` envelope if no index.

## 7. Reserved for v1.1 (designed, not built)

- `GET /api/sessions` → `{ sessions: { id, title, createdAt }[] }`
- `GET /api/sessions/:id` → full session with messages (backed by the reserved `sessions` table, `DATABASE_DESIGN.md` §2)
- `DELETE /api/sessions/:id`

## 8. Versioning policy

These are private, same-repo contracts — no URL versioning. The rule is simpler: **any change to `lib/contracts.ts` must update every consumer in the same commit.** TypeScript enforces most of it; the SSE event names (which are strings) are the one place the compiler can't help, which is why the tables above are exhaustive.

## 9. GET /api/status (slice V1.2)

What each indexing stage of the **active repo** is doing. The active repo is `activeRepo` in `.nebulosity/config.json`, which `npm run index` sets. This route replaces `/api/health` when the new Map lands (V1.3) and drives its status pill.

**Response 200 — `IndexStatus`:**
```ts
type StageName = "structure" | "summaries" | "embeddings";
type StageState = "idle" | "running" | "ready" | "off" | "failed";
type StageStatus = { state: StageState; done: number; total: number; note?: string };
type IndexStatus = { repo: string; stages: Record<StageName, StageStatus> };
```

- **`done`/`total`** count files for `structure`, summary targets (files, folders and the repo) for `summaries`, and model-written summaries with a vector for `embeddings`.
- **A stage that never ran** is `idle` with `0/0`.
- **`off`** means the stage can't run, and `note` says why (`summaries` without `ANTHROPIC_API_KEY`).
- **An honest `running`.** A running stage writes its row at least once a minute. A `running` row untouched for 5 minutes is reported as `failed`, with the note `interrupted: no progress since <time>`, because its process died (ADR-032). The one exception is `summaries` with requests still in a Message Batch at Anthropic: that work is in progress without any local process, so it stays `running`, and its note says how to collect it. A summary run that stops early while requests are at Anthropic, on an error or because its circuit breaker tripped or its spend cap was reached (the note then starts with `stopped:`; ADR-033, ADR-035), leaves the stage `running` for the same reason, with the note `<why it stopped>; <N> requests still at Anthropic; run npm run summarize to collect them`.

**Error 404 `INDEX_EMPTY`** when no repo has been indexed yet.

## 10. Search results (slice V1.2)

The hybrid search engine (`lib/engine/search.ts`, `RAG_PIPELINE.md` §6) returns a `SearchResult`. In V1.2 only `npm run search` shows it. `GET /api/search` serves it from V1.3, and the MCP `search` tool formats it as text in V1.4.

```ts
type SearchList = "code" | "summary" | "vector";
type SearchHit = {
  path: string;                 // repo-relative, forward slashes
  kind: "file" | "folder";
  score: number;                // RRF: Σ 1 / (60 + rank) over the lists that found it
  matchedBy: SearchList[];
  tagline?: string;             // the target's summary, when it has one
  summary?: string;
  code?: { symbol: string; startLine: number; endLine: number; snippet: string };  // best-matching chunk
};
type SearchResult = { query: string; hits: SearchHit[]; lists: Record<SearchList, number>; note?: string };
```

- **Hits are files and folders**, never chunks: a file's chunks are grouped before ranking, and `code` is its best one. The repo summary is never a hit.
- **`lists`** says how many files or folders each list contributed (at most 50 each).
- **`note`** is set when something limits the results: no summaries yet, no vectors yet, the embedding model unavailable, or a query made only of very common words.
