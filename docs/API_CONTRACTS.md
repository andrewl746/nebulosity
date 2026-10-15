# API_CONTRACTS.md — HTTP + SSE Contracts

> **Rewritten in slice V1.3 (2026-10-12; ADR-040).** Section numbers are stable, because code comments cite them: §2, §3 and §6 are retired, §4 was rewritten, and §9–§15 hold the pivot's endpoints. §5 (`/api/chat`) is E1's. §17 holds V1.4's MCP tools. §18 holds V1.5's static demo files.

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

`CONTRACTS_VERSION` (2 since V1.3, 3 since V1.3.1's page portals) names this contract and moves on a breaking change to it. The database evolves through migrations, never through this number (ADR-040).

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
type SearchList = "code" | "summary" | "vector" | "name" | "file";   // "name" since V1.3.1, "file" since V1.5
type SearchHit = {
  path: string;                 // repo-relative, forward slashes
  kind: "file" | "folder";
  score: number;                // weighted RRF: Σ w / (60 + rank) over the lists that found it (w = 2 for "name" and "file", else 1)
  matchedBy: SearchList[];
  tagline?: string;             // the target's summary, when it has one
  summary?: string;
  code?: { symbol: string; startLine: number; endLine: number; snippet: string };  // best-matching chunk: a declaration when one matched, else the imports listing ("(file)"), its header removed
};
type SearchResult = { query: string; hits: SearchHit[]; lists: Record<SearchList, number>; note?: string };
```

- **Hits are files and folders**, never chunks: a file's chunks are grouped before ranking, and `code` is its best one. The repo summary is never a hit.
- **`lists`** says how many files or folders each list contributed (at most 50 each).
- **Folder names** *(V1.3.1, additive)*: the `name` list ranks folders whose name matches a query word (`RAG_PIPELINE.md` §6) and counts double in the fusion, so searching "terminal" finds the terminal folders. The Map's search palette shows every folder hit first, then every file hit, and asks for 40.
- **File names** *(V1.5, additive)*: the `file` list ranks files whose name is a query word (or that word plus an ending of up to 3 letters), or that export a top-level declaration named exactly like one, most imported first. It counts double, like folder names (ADR-052).
- **The repo's own name** is dropped from the query before searching when other meaningful words remain ("vscode terminal" searches "terminal" in VS Code). `query` in the answer is still the query as typed.
- **`note`** is set when something limits the results: no summaries yet, summaries off (no `ANTHROPIC_API_KEY`: "Summaries are off (no ANTHROPIC_API_KEY), so results come from code, folder names and file names only."), no vectors yet, the embedding model unavailable, or a query made only of very common words.

## 11. GET /api/level?path=&page=&focus= (slice V1.3; pages added in V1.3.1, portals and `focus` in contract v3)

One folder of the Map (`lib/engine/level.ts`, paging in `lib/engine/pages.ts`). `path` is repo-relative; empty or missing means the repo root. `page` is a whole number from 0 (missing means 0). `focus`, optional, is a repo-relative path: the answer is then the page holding it.

```ts
type SummaryStatus = "fresh" | "stale" | "pending" | "failed" | "skipped" | "off";
type MapNode = { path: string; name: string; kind: "folder" | "file" | "portal"; fileCount: number;
  tagline?: string; summaryStatus: SummaryStatus; hiddenCount?: number;
  page?: number; pages?: number[]; members?: string[] };   // the last four: portals only
type MapEdge = { source: string; target: string; count: number };
type LevelResponse = { repo: string; path: string; breadcrumb: string[]; nodes: MapNode[]; edges: MapEdge[];
  hiddenCount: number; page: number; pageCount: number; indexVersion: number };
```

- **Boxes** are the folder's subfolders and the files directly inside it, largest first. A file counts as 1; among equals the more-imported file comes first, then the path decides.
- **Pages** *(V1.3.1, owner review: every box is drawn on some page, and pages hold boxes that import each other)*. A folder with up to 50 children is one page, drawn as it is: `page: 0, pageCount: 1, hiddenCount: 0`, no portals. A bigger folder is split into pages of at most 44 boxes:
  - A page seeds with the first unplaced child in the Map's order, then repeatedly takes the unplaced child with the most imports to and from the boxes already on it (ties go to the Map's order). When none is linked, the next child in the Map's order goes in, so a folder with no lines pages by size.
  - Each page lists its boxes in the Map's order. The pages are the same for the same children and lines, so a page number stays put for an index version.
  - `page` past the last is the last; the answer's `page` says which one was drawn. With `focus`, the page holding that path wins over `page` (the path is a box on this level, or inside one); a `focus` that isn't on this level is ignored.
  - `hiddenCount` counts the folder's boxes on the other pages.
- **Portals** are doorway boxes to the other pages, drawn after the page's own boxes:
  - A page gets a portal for each other page it has lines with: `kind: "portal"`, `path` `<level>//page-<n>` (n from 1; `//page-<n>` at the root), `name` `Page <n>` (the Map titles the box "Lines to page <n>" itself, since V1.3.1's second critique; the name is unchanged for other clients), and `page` from 0. A page with no lines to another page gets no portal for it; the page pill and the arrow keys still reach every page.
  - Linked to more than 6 pages, a page keeps its own portal for the 5 most linked (by imports both ways; ties go to the lower page) and merges the rest into one `+N pages` portal: `path` `<level>//pages`, with `pages` listing them, ascending.
  - `fileCount` adds up the boxes behind a portal, `hiddenCount` counts them, `members` lists their paths in the Map's order (so a client can find the doorway for any path), and `summaryStatus` is `skipped`, since a portal has no summary of its own.
  - Stored paths never hold `//`, so portal paths can't collide. With at most 44 boxes and 6 portals, `nodes` never holds more than 50 (S4).
- **Lines** are the level's rows of `level_edges` (PIVOT_SPEC.md §4.2): each import is counted once, at the deepest folder holding both files. A line with one end on another page runs to (or from) that page's portal, and lines that then join the same two boxes are added up. A line with both ends on other pages is dropped. Lines are sorted by source, then target.
- **`summaryStatus`** is the stored status when the box has text. Without text it's `off` when there's no `ANTHROPIC_API_KEY`, otherwise the stored status, or `pending` when no row exists yet.
- **`breadcrumb`** lists the folder paths from the root down to `path`.
- **`indexVersion`** moves whenever anything the Map shows changes (ADR-036). A client caches levels per version and refetches when `GET /api/status` reports a new one.
- **Contract v3.** Portals replaced V1.3's `kind: "more"` box (`+N more`, path `<level>/`), a breaking change, so `CONTRACTS_VERSION` went 2 → 3 (ADR-040).

**Errors:**
- `400 BAD_REQUEST`: a `path` or `focus` that could leave the repo (`..`, absolute, a drive letter), a file's path (the Map opens folders), or a `page` that isn't a whole number.
- `404 NOT_FOUND`: nothing indexed at `path`.
- `404 INDEX_EMPTY`: no active repo yet.

## 12. GET /api/describe?path= (slice V1.3)

What a folder, file or the repo (`path` empty) is (`lib/engine/describe.ts`). The detail panel shows it, and V1.4's MCP `describe` tool formats it as text.

```ts
type SymbolInfo = { name: string; kind: string; startLine: number; endLine: number; exported: boolean };
type AreaCount = { path: string; kind: "folder" | "file"; count: number };
type DocPointer = { path: string; title: string;
  reason?: { kind: "applies" | "readme" | "mentions"; target: string; detail?: string; count: number } };
type DescribeResponse = { repo: string; path: string; kind: "repo" | "folder" | "file";
  tagline?: string; summary?: string; summaryStatus: SummaryStatus; summaryError?: string;
  docs?: DocPointer[];
  stats: { fileCount: number; lineCount: number };
  children?: MapNode[]; symbols?: SymbolInfo[]; importsOnly?: true;
  uses: AreaCount[]; usedBy: AreaCount[]; stalePaths: number; indexVersion: number };
```

- **`children`** (folders and the repo) lists every child in the Map's order, the order `level()` draws each page's boxes in. A client shows 20 at a time.
- **`symbols`** (files) are the top-level declarations and class members in line order, members by qualified name (`Logger.info`). The lines are the declaration's own, for jumping to it.
- **`importsOnly`** (files; ADR-053, amended, additive; `CONTRACTS_VERSION` stays 3) is `true` for a file over the 1 MB size cap, which the indexer read for its imports only. Its `symbols` is empty because they weren't read, not because it has none: the MCP answer says "Declarations: not read (over the 1 MB size cap; imports only).", and the detail panel says "Not read (over the 1 MB size cap; imports only).". It is set from the file's stored size and left out otherwise.
- **`uses` / `usedBy`** count imports across the target's boundary, grouped by the area on the other side (PIVOT_SPEC.md §4.2), most first. An area is a folder, or a file when the other file sits directly in the lowest folder both share. Test files count like any other file. A file's summary was written from an "Imported by" line that counts tests apart (RAG_PIPELINE.md), so the numbers in its text can differ; the detail panel labels both.
- **`docs`** (ADR-054, additive; `CONTRACTS_VERSION` stays 3) points at the repo's own Markdown. For a folder or file it is up to 5 docs linked to the target or the folders above it (the root left out), each by its strongest link, ranked by kind (`applies`, `readme`, `mentions`), deeper target, a plain-folder glob, a name about architecture, count, then path; `reason` always says why (`target` is the place the link names, `detail` the glob of an `applies` link). For the repo it is up to 5 docs to read first: the root README, then docs named for architecture, then docs that apply to a folder (`reason` only on those). Left out when none.
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
- **`GET /api/live/stream`** is Server-Sent Events: `ready` (`{}`) once, then `tool` (a `LiveEvent`) per call, and a `: keep-alive` comment every 15 s. It's a GET, so the browser's `EventSource` reads it directly. The Map closes its stream when the page is put away (`pagehide`) and opens a new one when it comes back from the back/forward cache (`pageshow`), so a page frozen for Back holds none of the browser's 6 connections to the server (ADR-039, amended).
- **`postLiveEvent`** (`lib/live/client.ts`) is the poster. It sends one POST to `http://127.0.0.1:<port>/api/live` with a 200 ms timeout and ignores every failure, since no Map being open is the normal case. `port` comes from `.nebulosity/config.json` (default 3000). V1.4's MCP tools call it, and `npm run live -- <tool> [path …] [--highlight | --focus | --clear]` sends one by hand.

## 15. GET /api/repos, POST /api/repos (slice V1.3)

The repo picker (PIVOT_SPEC.md §7.1).

```ts
type RepoRemote = { owner: string; name: string };
type RepoSummary = { root: string; name: string; indexedAt: string | null; remote?: RepoRemote };
type RepoList = { active: string | null; repos: RepoSummary[] };
```

- **`GET`** lists the repos the structure stage has indexed, by root, and the active one.
- **`remote`** (added in V1.3.1; optional, so `CONTRACTS_VERSION` stays 2) is the origin remote's owner and name, read from `<root>/.git/config` (`lib/engine/git-remote.ts`), so the top bar can say `microsoft / vscode` (VISUAL_REFRESH.md §6). The owner is everything before the last path segment, so a nested GitLab group stays whole; Azure DevOps's `_git` and `v3` markers are left out (`dev.azure.com/org/project/_git/repo` is `org/project` / `repo`), and scp-style urls may omit the user (`github.com:owner/repo`). A worktree's or submodule's `.git` pointer file is followed to the config that holds its remotes (since 2026-10-13). It's left out when there's no origin, when the url is a local path, or when the pointer leads nowhere, and the top bar then shows `name`.
- **`POST { root }`** makes an indexed repo the active one (`activeRepo` in `.nebulosity/config.json`) and points the background worker at it. It answers with the new `RepoList`. Localhost only. A root that was never indexed gets `404 NOT_FOUND`.

## 16. GET /api/source?path= (slice V1.3.1)

An indexed file's text, for the Map's source viewer (`lib/engine/source.ts`; the owner asked to inspect a file's code on the Map).

```ts
type SourceResponse = { repo: string; path: string; content: string; lineCount: number; truncated: boolean; language: string };
```

- **Only indexed files.** The path must be a file the structure stage indexed. So the route can't read anything else in the repo (a `.env`, a key, `.git/config`), and a path that resolves outside the repo through a symlink is refused too.
- **`content`** is the file's bytes as UTF-8, up to 1 MB (about 25,000 lines of TypeScript). Past that it stops, and `truncated` is `true`. Only the first 1 MB is read, and the cut never splits a character: it backs off to the start of one that would straddle it (2026-10-13). Line endings are left as stored; the viewer shows them as plain line breaks.
- **`lineCount`** counts the lines in `content` the way an editor does: a final line break doesn't start another line.
- **`language`** is `typescript`, `javascript` or `text`, by extension, for highlighting.
- Like every `/api` route, it answers only requests addressed to this machine (ADR-039). It reads and never writes.

**Errors:** `400 BAD_REQUEST` for a path that could leave the repo, or an empty one; `404 NOT_FOUND` for a folder, a file the index doesn't know, or a file deleted since; `404 INDEX_EMPTY`.

## 17. The MCP tools (slice V1.4; six tools since V1.6, ADR-056)

Claude Code and any MCP client reach the engine through `mcp/server.ts` over stdio (PIVOT_SPEC.md §6.2, ADR-030). Each tool is defined once in `lib/tools/registry.ts` (ADR-047). Claude Code shows them as `mcp__nebulosity__<name>`.

**Launch.** `node <checkout>/mcp/launch.mjs` (ADR-048), or `node <package>/mcp/launch.mjs` for an installed copy, as `nebulosity setup` registers it (ADR-058). It sets `NEBULOSITY_HOME` to the checkout or package unless it's set, and an installed copy's `NEBULOSITY_DATA` to the user's data folder unless it's set (ADR-044, amended). `NEBULOSITY_LIVE=off` stops every live event.

**Which repo.** The indexed repo holding the project folder (`CLAUDE_PROJECT_DIR`, else the server's working folder), the deepest when repos nest. Else the repo the Map shows, with a note first. Else an error (ADR-046).

| Tool | Input (default) | Answer |
|---|---|---|
| `overview` | none | the repo's size and summary, the docs to read first (up to 5), its top-level areas largest first (size and tagline; 30 at most), and the 10 most-imported files |
| `describe` | `path` | kind, files and lines; the summary; the docs about it (up to 5); what's inside (20 children) or the declarations (30, with lines); uses and used by (10 areas each, with import counts) |
| `search` | `query` (1–200 characters), `limit` 1–30 (10) | the best files and folders, each with its tagline and best-matching code (cut to 160 characters) |
| `imports` | `path`, `direction` (`dependents`: the files that import it; `dependencies`: the files it imports), `transitive` (false), `to`, `group_by`, `within`, `limit` 1–500 (50), `offset` (0) | see the modes below |
| `architecture` | `path` (""), `report`: summary, layers, conventions, cycles or unused (summary), `through`, `limit` 1–500 (20), `offset` (0) | a folder's organization computed from its imports (ADR-055); see below |
| `show_on_map` | `action`: highlight, focus or clear (highlight); `paths` (0–50) | what was sent, what was left out, and whether the Map took it |

**`imports`, by mode.** `to` wins over `group_by`, which wins over the plain list.
- *The list* (neither `to` nor `group_by`): the direct and total counts, then the files: nearest first, most imported next, by path last; grouped by distance when `transitive`. A transitive list of dependents ends its first page (offset 0) with the tests among them and the files nothing imports that load the target (a package.json's entry points first); later pages are the list's continuation. Pages: a cut list ends `… N more (next page: offset K)`, and a page past the end says how long the list is. `within` keeps only files inside a folder (the first line says which); both directions take it. A `within` that is a file, isn't indexed, or equals or sits inside a folder target is refused with a sentence naming `within`. When `within` leaves no direct file, the direct-only page reads "None of them imports it directly; list them with transitive."
- *`group_by`* (a folder whose children are the areas, "" the top level, or "auto" for describe's used-by rule): counts everything reached, so always transitive, by area, then the tests and entry points as above. No file list.
- *`to`* (a file or folder): the shortest chain of imports from `path` to `to`, each step with the import as written, the other direction when needed, or "no chain". Places that overlap, and the whole repo, are refused.
- The whole repo ("") is refused as `path`: it has no outside.

**`architecture`, by report.** `summary` is the four reports in brief (layers bottom first and the imports against that order; the recurring folder names; the cycle count and the largest; the files nothing imports). `layers`, `conventions`, `cycles` and `unused` give one in full; `cycles` with `through` (or with a file as `path`) gives the shortest import cycle through that file, or says it is in none. Every report fits the 40,000-character limit. Any other report on a file is refused.

**Always loaded.** Each tool's MCP `_meta` says how Claude Code loads it (ADR-056): `overview`, `describe`, `search`, `imports` and `architecture` carry `"anthropic/alwaysLoad": true`, so their definitions are in every session's prompt; `show_on_map` carries `"anthropic/searchHint": "map highlight focus show point visualize"` and stays deferred behind Claude Code's tool search. A registration carries no `alwaysLoad` of its own. The five definitions and the instructions together stay under 7,000 characters (a test).

**Paths.** Inputs are repo-relative, or absolute inside the repo, which is how Claude Code's own tools write them (Windows ignores case; ADR-046, amended). Backslashes, a leading `./` and a trailing `/` are accepted (`parseRepoPath`); `..`, and absolute paths outside the repo, are refused, and the refusal names the repo's root. Answers always write paths from the repo root, and a session started in a subfolder of the repo is told so on its answers' first line. `""` is the repo root; `imports` refuses it, since the whole repo has no outside.

**Answers.**
- Plain text with no Markdown. Repo-relative paths, folders ending in `/`.
- Exact counts with thousands separators. A count always covers everything, even when the list under it is cut.
- A cut list ends with `… N more`, plus `(next page: offset K)` where the tool pages.
- Every answer stays under 40,000 characters.
- Notes are lines starting `Note: `. When the project folder didn't pick the repo, or sits below the repo's root, that note comes first. Then the answer, then the tool's own notes, then the index note (an update in progress or failed), and the stale-summary note last.
- With no API key, the line where a summary would go reads `Summary: none — summaries are off (no ANTHROPIC_API_KEY); a key adds a short summary of every file and folder.`

**Errors.** An MCP error result (`isError: true`) with one sentence. The cases:
- nothing indexed yet (with Nebulosity's folder);
- an index older than the checkout;
- nothing indexed at a path;
- a path outside the repo;
- overlapping places for `imports` with `to`, and a `within` that cannot match;
- bad `show_on_map` input;
- the MCP SDK's "Input validation error" for input outside a schema.

**Live events** (§14). One per successful call: `tool` is the bare name and `paths` what the call touched. describe sends its path; search its hits; imports its target, or with `to` the target, `to`, then the chain between; architecture its path; show_on_map its paths and its `action`; overview none. None go out when the answer's repo isn't the one the Map shows, or with `NEBULOSITY_LIVE=off`. Pulses are fire-and-forget; show_on_map waits (at most 200 ms) to say whether the Map took it.

**Instructions.** The server's `instructions`, sent once per session (Claude Code keeps 4,096 characters since 2.1.296, 2,048 before), are `SERVER_INSTRUCTIONS` in the registry: when to reach for each tool, under 2,048 characters so older clients keep all of it.

## 18. The static demo's files (slice V1.5)

`npm run export-demo -- <repo>` writes these under `.nebulosity/demo/`, and `npm run build-demo` copies them to the built site's `demo/` (ADR-049). The Map's static transport (`app/map/staticApi.ts`) reads them in place of the HTTP API; the shapes are in `lib/contracts.ts`.

| File | Holds |
|---|---|
| `manifest.json` | `DemoManifest`: the format (`DEMO_FORMAT_VERSION`, 1), the repo's public name, its origin, the indexed commit, the status, every folder in path order (a folder's id is its position, the root 0) and the page counts of paged folders |
| `level/<id>-<page>.json` | the `LevelResponse` for that folder and page (§11), one per page |
| `pages/<id>.json` | `DemoPageIndex`: the box paths on each page of a paged folder, so a focus finds its page without the server |
| `describe/<id>.json` | `DemoDescribeBundle`: the `DescribeResponse` (§12) of the folder and of each file directly inside it, by path |
| `search.json` | `DemoSearchIndex`: summaries, folders, files with importer counts and test flags, and exported declaration names |
| `SOURCE-LICENSE.txt` | the indexed repo's own license file, when it has one, since the data is derived from its code |

- **The repo's name.** Every `repo` field (levels, describe answers, the status, the repo list the client builds) holds the public name, never an absolute root. The exporter fails on any file holding a spelling of a local folder or the git email.
- **The status.** `manifest.status` keeps each stage's state and counts and drops its note: a failed stage's note can hold an error message with a path.
- **The output folder.** The exporter empties only an earlier export: a `manifest.json` with a numeric `format` and a `folders` list, or the `EXPORTING` marker an unfinished run leaves. It refuses any other non-empty folder, and any folder that is or holds the repo, the Nebulosity folder, the home folder or the current folder. The marker is removed last and only when the scan found nothing, so an export that leaked reads as unfinished.
- **Errors.** The transport answers as §11 and §12 do: `404 NOT_FOUND` for a path nothing is indexed at, and `400 BAD_REQUEST` for a level asked of a file (the same message as the server's). A file that can't be read rejects with an `ApiError`. Each error case listed here shows the Map a message and never leaves it on "Loading…", except two: an aborted fetch (silent by design: the next request replaces it) and a file of the wrong shape (the last bullet). `<file>` is its path under `demo/`:
  - the host has no such file (HTTP 404): `404 NOT_FOUND`, "The demo has no `<file>`."
  - any other HTTP error: `INTERNAL`, "The demo's `<file>` didn't load (HTTP `<status>`)." It has no reload hint.
  - the request fails (offline, blocked): `NETWORK`, a message that says to check the connection and reload.
  - the body isn't JSON (a host answering a missing file with an HTML page, or a body cut off): `INTERNAL`, a message that says to reload.
  - a manifest of another `format`: `INTERNAL`, a message that says to reload.
  - a call that needs a server (the source viewer, summarize, switching repos, re-index): `404 NOT_FOUND`, "… isn't part of the static demo; it needs Nebulosity running on your machine."
  - a fetch the caller aborted rejects with the browser's `DOMException` named `AbortError`, not an `ApiError`.
  - a valid-JSON file of the wrong shape isn't checked. A `null` or malformed manifest or describe bundle makes the call reject with a plain `TypeError` (`index()` and `describe()` in `staticApi.ts`), and a `null` level file resolves and then throws inside the Map's own handler (`app/map/MapView.tsx`). Either way no `ApiError` reaches the Map's handlers, which show an error only for an `ApiError` (`MapView.tsx`, `DetailPanel.tsx`, `SourceViewer.tsx`, `SearchPalette.tsx`), so the Map stays on "Loading the map…".
- **What isn't here.** No source text (the demo links to GitHub at `commit`), no live events, no summarize or re-index, no code search index and no vectors: search ranks summaries and names only, and says so (`staticSearch.ts`).
