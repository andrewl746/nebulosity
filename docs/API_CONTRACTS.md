# API_CONTRACTS.md — HTTP + SSE Contracts

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

## 4. POST /api/index — SSE

Runs the indexing pipeline (`RAG_PIPELINE.md`). Body: `{}` (repo root is the server's project root in v1).

**SSE events, in order:**

| event | data | notes |
|---|---|---|
| `progress` | `{ phase: "scanning" \| "chunking" \| "embedding", done: number, total: number, currentFile?: string }` | emitted at least once per phase; embedding emits per ~10 files |
| `done` | `{ fileCount, chunkCount, skippedUnchanged, tookMs }` | terminal event on success |
| `error` | `{ code, message }` | terminal on failure; `INDEX_LOCKED` if another run holds the lock |

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
