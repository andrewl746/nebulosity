# API_CONTRACTS.md — HTTP + SSE Contracts

> **Rewritten in slice V1.3 (2026-10-12; ADR-040).** Section numbers are stable, because code comments cite them: §2, §3 and §6 are retired, §4 was rewritten, and §9–§15 hold the pivot's endpoints. §5 (`/api/chat`) is E1's.

**Status:** Approved design. These contracts are **binding**: UI and server may only communicate through what is defined here.
**Single source of truth in code:** every type below lives in `lib/contracts.ts`, imported by both route handlers and UI components. If this doc and `lib/contracts.ts` ever disagree, fix the drift immediately — that file is the compiler-enforced version of this document. (Persistence shapes are separate: they live in `lib/db/schema.ts` per ADR-013 and are documented in `DATABASE_DESIGN.md`.)

---

## 1. Conventions

- Base path `/api`. All bodies are JSON. All routes are same-origin (no CORS needed).
- **Errors** (non-SSE routes): appropriate HTTP status + envelope
  `{ "error": { "code": string, "message": string } }`
  Codes: `BAD_REQUEST` (400), `FORBIDDEN` (403), `NOT_FOUND` (404), `INDEX_EMPTY` (404), `INDEX_LOCKED` (409), `NOT_READY` (409), `SUMMARIES_OFF` (409), `BUDGET_EXCEEDED` (429), `UPSTREAM` (502) and `INTERNAL` (500). Route handlers map engine errors to codes by their type (`lib/engine/errors.ts`). `UPSTREAM` means Anthropic refused the API key (`SummarizerAuthError`). Every `/api` route answers `403 FORBIDDEN` when the `Host` header doesn't name this machine (`localhost`, `127.0.0.1` or `[::1]`, any port; `proxy.ts`, ADR-039 amended).
- **SSE format:** standard `text/event-stream`:
  `event: <name>\ndata: <json>\n\n`
  Note for the UI implementer: the browser's `EventSource` API cannot send POST bodies. Consume SSE with `fetch` + `response.body.getReader()` and parse the stream manually (a small parser in the api-client module, ~30 lines).
- **Node ids = repo-relative paths.** Map boxes, `highlight_nodes`/`focus_node` arguments, panel links and search hits all use repo-relative forward-slash paths (`src/vs/base`, `""` for the repo root), files and folders alike.

## 2. GET /api/graph

> **Retired in V1.3** with the radial graph UI (ADR-040). The Map reads levels instead: §11.

## 3. GET /api/health

> **Retired in V1.3** (ADR-040). The index's state is `GET /api/status`: §9.

## 4. POST /api/index — SSE (rewritten in slice V1.3)

A full structure run of the active repo, in the background worker (ADR-038), with its progress as SSE. Localhost only (§14's guard: `403 FORBIDDEN` otherwise); `404 INDEX_EMPTY` without an active repo. Body: none.

| event | data | notes |
|---|---|---|
| `progress` | `{ stage: "discover" \| "parse" \| "write" \| "resolve" \| "aggregate", done, total }` | at least once per stage, in order |
| `done` | `{ files, changed, deleted, edges, folders, levelEdges, errors[], skipped, totalMs }` | terminal on success; `errors` are per-file failures (ADR-021) |
| `error` | `{ code, message }` | terminal on failure: `INDEX_LOCKED` while another run holds the lock or the worker is still switching to the active repo (ADR-038, amended), `INTERNAL` if the worker stopped |

The run goes on in the worker if the client leaves.

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

> **Retired in V1.3** (ADR-040). `GET /api/search` serves §10's `SearchResult`.

## 7. Reserved for v1.1 (designed, not built)

- `GET /api/sessions` → `{ sessions: { id, title, createdAt }[] }`
- `GET /api/sessions/:id` → full session with messages (backed by the reserved `sessions` table, `DATABASE_DESIGN.md` §2)
- `DELETE /api/sessions/:id`

## 8. Versioning policy

These are private, same-repo contracts — no URL versioning. The rule is simpler: **any change to `lib/contracts.ts` must update every consumer in the same commit.** TypeScript enforces most of it; the SSE event names (which are strings) are the one place the compiler can't help, which is why the tables above are exhaustive.

`CONTRACTS_VERSION` (2 since V1.3) names this contract and moves on a breaking change to it. The database evolves through migrations, never through this number (ADR-040).

## 9. GET /api/status (slice V1.2)

What each indexing stage of the **active repo** is doing. The active repo is `activeRepo` in `.nebulosity/config.json`, which `npm run index` sets. This route replaces `/api/health` when the new Map lands (V1.3) and drives its status pill.

**Response 200 — `IndexStatus`:**
```ts
type StageName = "structure" | "summaries" | "embeddings";
type StageState = "idle" | "running" | "ready" | "off" | "failed";
type StageStatus = { state: StageState; done: number; total: number; note?: string };
type IndexStatus = { repo: string; stages: Record<StageName, StageStatus>; indexVersion: number };
```

- **`done`/`total`** count files for `structure`, summary targets (files, folders and the repo) for `summaries`, and model-written summaries with a vector for `embeddings`.
- **`idle`** means nothing is running for that stage. Either it never ran (`0/0`), or there's work waiting and the note says how much: `N waiting to be summarized`, `N summaries without a vector yet`.
- The summaries stage is re-derived after every structure change and every "summarize now" (ADR-032, amended). The embeddings counts are always counted live.
- **`off`** means the stage can't run, and `note` says why (`summaries` without `ANTHROPIC_API_KEY`).
- **An honest `running`.** A running stage writes its row at least once a minute. A `running` row untouched for 5 minutes is reported as `failed`, with the note `interrupted: no progress since <time>`, because its process died (ADR-032). The one exception is `summaries` with requests still in a Message Batch at Anthropic: that work is in progress without any local process, so it stays `running`, and its note says how to collect it. A summary run that stops early while requests are at Anthropic, on an error or because its circuit breaker tripped or its spend cap was reached (the note then starts with `stopped:`; ADR-033, ADR-035), leaves the stage `running` for the same reason, with the note `<why it stopped>; <N> requests still at Anthropic; run npm run summarize to collect them`.
- **`indexVersion`**: see §11. A client polling this route refetches its levels when it moves.

**Error 404 `INDEX_EMPTY`** when no repo has been indexed yet.

## 10. Search results (slice V1.2)

The hybrid search engine (`lib/engine/search.ts`, `RAG_PIPELINE.md` §6) returns a `SearchResult`. `GET /api/search?q=&limit=` serves it (V1.3; `limit` 1–50, default 10), and V1.4's MCP `search` tool formats it as text. `400 BAD_REQUEST` without `q`, `404 INDEX_EMPTY` without an active repo.

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

## 11. GET /api/level?path= (slice V1.3)

One folder of the Map (`lib/engine/level.ts`). `path` is repo-relative; empty or missing means the repo root.

```ts
type SummaryStatus = "fresh" | "stale" | "pending" | "failed" | "skipped" | "off";
type MapNode = { path: string; name: string; kind: "folder" | "file" | "more"; fileCount: number;
  tagline?: string; summaryStatus: SummaryStatus; hiddenCount?: number };
type MapEdge = { source: string; target: string; count: number };
type LevelResponse = { repo: string; path: string; breadcrumb: string[]; nodes: MapNode[]; edges: MapEdge[];
  hiddenCount: number; indexVersion: number };
```

- **Boxes** are the folder's subfolders and the files directly inside it, largest first. A file counts as 1; among equals the more-imported file comes first, then the path decides.
- **The cap.** With more than 50 children, the first 49 are drawn and the rest fold into one `kind: "more"` box named `+N more`. Its `path` is the level's path plus `/` (`/` at the root), which no stored path can be. Its `fileCount` adds up the folded boxes', `hiddenCount` is N, and its `summaryStatus` is `skipped`, since it has no summary of its own. So `nodes` never holds more than 50 (S4).
- **Lines** are the level's rows of `level_edges` (PIVOT_SPEC.md §4.2): each import is counted once, at the deepest folder holding both files. A folded end points at the `+N more` box, lines that then join the same two boxes are added up, and lines between two folded children are dropped.
- **`summaryStatus`** is the stored status when the box has text. Without text it's `off` when there's no `ANTHROPIC_API_KEY`, otherwise the stored status, or `pending` when no row exists yet.
- **`breadcrumb`** lists the folder paths from the root down to `path`.
- **`indexVersion`** moves whenever anything the Map shows changes (ADR-036). A client caches levels per version and refetches when `GET /api/status` reports a new one.

**Errors:**
- `400 BAD_REQUEST`: a path that could leave the repo (`..`, absolute, a drive letter), or a file's path (the Map opens folders).
- `404 NOT_FOUND`: nothing indexed at `path`.
- `404 INDEX_EMPTY`: no active repo yet.

## 12. GET /api/describe?path= (slice V1.3)

What a folder, file or the repo (`path` empty) is (`lib/engine/describe.ts`). The detail panel shows it, and V1.4's MCP `describe` tool formats it as text.

```ts
type SymbolInfo = { name: string; kind: string; startLine: number; endLine: number; exported: boolean };
type AreaCount = { path: string; kind: "folder" | "file"; count: number };
type DescribeResponse = { repo: string; path: string; kind: "repo" | "folder" | "file";
  tagline?: string; summary?: string; summaryStatus: SummaryStatus; summaryError?: string;
  stats: { fileCount: number; lineCount: number };
  children?: MapNode[]; symbols?: SymbolInfo[];
  uses: AreaCount[]; usedBy: AreaCount[]; stalePaths: number; indexVersion: number };
```

- **`children`** (folders and the repo) lists every child in the Map's order, so the boxes a level folds into "+N more" are exactly those after the first 49. A client shows 20 at a time.
- **`symbols`** (files) are the top-level declarations and class members in line order, members by qualified name (`Logger.info`). The lines are the declaration's own, for jumping to it.
- **`uses` / `usedBy`** count imports across the target's boundary, grouped by the area on the other side (PIVOT_SPEC.md §4.2), most first. An area is a folder, or a file when the other file sits directly in the lowest folder both share. Test files count like any other file. A file's summary was written from an "Imported by" line that counts tests apart (RAG_PIPELINE.md), so the numbers in its text can differ; the detail panel labels both.
- **`summaryStatus`** follows §11's rule. **`summaryError`** says why the last attempt failed, and only appears when the status is `failed`.
- **`stalePaths`** counts files at or under the target whose summary is out of date with their bytes. It's non-zero between a file's edit and the refresh of its summary (`PIVOT_SPEC.md` §5.6).
- **Caching.** The server keeps each answer until the index version moves (ADR-036, amended in V1.3.1), so a repeat is about 0.1 ms. The answer doesn't change shape.

**Errors:** `400 BAD_REQUEST` for a path that could leave the repo; `404 NOT_FOUND`; `404 INDEX_EMPTY`.

## 13. POST /api/summarize?path= (slice V1.3)

Summarizes one file or folder now through the regular API, jumping the queue (PIVOT_SPEC.md §5.3). The Map sends it when it opens a target whose summary is `pending` or `stale`; it never sends it when summaries are `off`. Localhost only, because it spends money.

```ts
type SummarizeResponse = { path: string; kind: "repo" | "folder" | "file"; tagline?: string; summary?: string;
  summaryStatus: SummaryStatus; summaryError?: string };
```

- **Current summaries.** A current summary comes back as it is, with no API call.
- **Duplicates.** Concurrent requests for one target share one request (ADR-033, amended).
- **Status codes.**
  - `409 NOT_READY`: a folder whose files or subfolders aren't all summarized yet. Its summary would be written over "(no summary yet)".
  - `409 SUMMARIES_OFF`: no API key.
  - `409 INDEX_LOCKED`: the background worker is still switching to the active repo (ADR-038, amended); try again in a moment. It never summarizes another repo's path.
  - `502 UPSTREAM`: Anthropic refused the API key.
  - `404 NOT_FOUND`, `400 BAD_REQUEST` and `403 FORBIDDEN` as usual.
  - `500 INTERNAL` when the background worker stopped before answering.
- **Afterwards.** The summary lands in the index, so the index version moves and the Map refetches. Its vector follows within seconds.

## 14. The live channel (slice V1.3)

`POST /api/live` takes a tool call, and `GET /api/live/stream` sends each one to the open Maps (`PIVOT_SPEC.md` §8, ADR-039).

```ts
type LiveEvent = { tool: string; paths: string[]; at: string; action?: UIAction };
```

- **`POST /api/live`** takes a `LiveEvent` as its body and answers `204`.
  - `at` and `paths` are optional. `paths` holds at most 50 repo-relative paths; others are dropped. `action` is a `UIAction`, whose node ids may be folders.
  - **Localhost only.** The `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (any port), and an `Origin`, if present, must be the Map's own page: the same host and port as the `Host` header. Anything else gets `403 FORBIDDEN`, including a page served from another local port.
  - A body that isn't a live event gets `400 BAD_REQUEST`.
  - At most 20 events a second are passed on; the rest are dropped.
- **`GET /api/live/stream`** is Server-Sent Events: `ready` (`{}`) once, then `tool` (a `LiveEvent`) per call, and a `: keep-alive` comment every 15 s. It's a GET, so the browser's `EventSource` reads it directly.
- **`postLiveEvent`** (`lib/live/client.ts`) is the poster. It sends one POST to `http://127.0.0.1:<port>/api/live` with a 200 ms timeout and ignores every failure, since no Map being open is the normal case. `port` comes from `.nebulosity/config.json` (default 3000). V1.4's MCP tools call it, and `npm run live -- <tool> [path …] [--highlight | --focus | --clear]` sends one by hand.

## 15. GET /api/repos, POST /api/repos (slice V1.3)

The repo picker (PIVOT_SPEC.md §7.1).

```ts
type RepoRemote = { owner: string; name: string };
type RepoSummary = { root: string; name: string; indexedAt: string | null; remote?: RepoRemote };
type RepoList = { active: string | null; repos: RepoSummary[] };
```

- **`GET`** lists the repos the structure stage has indexed, by root, and the active one.
- **`remote`** (added in V1.3.1; optional, so `CONTRACTS_VERSION` stays 2) is the origin remote's owner and name, read from `<root>/.git/config` (`lib/engine/git-remote.ts`), so the top bar can say `microsoft / vscode` (VISUAL_REFRESH.md §6). The owner is everything before the last path segment, so a nested GitLab group stays whole. It's left out when there's no origin, when the url is a local path, or when `.git` is a file (a worktree or submodule), and the top bar then shows `name`.
- **`POST { root }`** makes an indexed repo the active one (`activeRepo` in `.nebulosity/config.json`) and points the background worker at it. It answers with the new `RepoList`. Localhost only. A root that was never indexed gets `404 NOT_FOUND`.
