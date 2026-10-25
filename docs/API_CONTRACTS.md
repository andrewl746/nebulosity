# API_CONTRACTS.md — HTTP + SSE Contracts

> **Rewritten in slice V1.3 (2026-10-12; ADR-040).** Section numbers are stable, because code comments cite them: §2, §3 and §6 are retired, §4 was rewritten, and §9–§15 hold the pivot's endpoints. §5 (`/api/chat`) is E1's. §17 holds V1.4's MCP tools. §18 holds V1.5's static demo files. §19 and §20 hold V1.8's route and editor bridge for the VS Code extension, and §15 its `server` field. §21 is the settings file, `config.json` (the pre-ship pass, ADR-066).

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
| `done` | `{ files, changed, deleted, edges, folders, levelEdges, errors[], scanned?[], skipped, totalMs }` | terminal on success; `errors` are per-file failures (ADR-021); `scanned` (`{ path, error }[]`, additive since E4's final review, B-I1; `CONTRACTS_VERSION` stays 3) lists the files whose parse threw and that the scan read instead, indexed for their imports only (ADR-065) |
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
  - **`kind`** is one of `SYMBOL_KINDS` (`lib/db/schema.ts`): `function`, `class`, `interface`, `type`, `enum`, `const`, `method`, `property`, `accessor`, `constructor`, `namespace`, and since E4 (ADR-065, additive; `CONTRACTS_VERSION` stays 3) **`struct`** (a Go or Rust struct, a Rust union, a C# struct or record struct) and **`trait`** (a Rust trait). Each language maps its own declarations onto these (the E4 plan's per-language Symbols): a Python class is `class`, a Java record `class` and an annotation type `interface`, a Go struct's fields and a Rust struct's named fields `property`, a Rust `impl` block's functions `method` under the self type's name. A constructor is named as the language writes it: TypeScript's `constructor`, a C# or Java one by its type's name (`Order.Order`). A Python decorator or a Rust attribute above a declaration starts its lines.
    - **Constructs that are symbols in some languages only** (the E4 final review's B-M5; a later version may align them):
      - Enum members are properties in Java and Python (as class attributes), but no symbol in C#, Rust or TypeScript.
      - Java's interface constants are properties, while Rust's associated consts and types (in a trait or an `impl`) are no symbol, only its fns.
      - Python's definitions inside a top-level `if` or `try` (the `TYPE_CHECKING` and `ImportError` fallback idioms) are no symbol, while C# lifts the declarations in `#if` blocks.
  - **`exported`** follows one rule in every language *(since E4's final review, B-I2, ADR-065)*. A top-level declaration is exported by its language's own marker: TypeScript `export`; Python no leading `_`, or listed in `__all__`; Go an upper-case name; Java and C# `public`; Rust exactly `pub`. A member is exported only when its owner is exported and its own marker says so. A member with no marker of its own takes its owner's flag (C# and Java interface members, Rust trait fns). Go's methods and Rust's `impl` fns are gated by their receiver or self type only when the file declares it, since a parse sees one file. The MCP `describe` prints `(not exported)` after each symbol that isn't.
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
  - `409 SUMMARIES_OFF`: no API key, or the repo's summaries were never confirmed (no yes recorded by `nebulosity summarize`, and no summary written by a model). The message says to run `nebulosity summarize`, which shows the estimate and asks first; nothing is sent (S11, ADR-038 amended). Also a `summaryModels` setting that can't be used (§21, ADR-066): the message says which fields are wrong, and in which file.
  - `409 INDEX_LOCKED`: the background worker is still switching to the active repo (ADR-038, amended); try again in a moment. It never summarizes another repo's path.
  - `502 UPSTREAM`: Anthropic refused the API key, or doesn't serve the model to it (a 404 naming it: retired, or not open to this key; ADR-066). Then the message names the model and says to choose another under `summaryModels` in `config.json` (§21), and the stored summary is left as it was.
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
- **`postLiveEvent`** (`lib/live/client.ts`) is the poster. It sends one POST to `http://127.0.0.1:<port>/api/live` with a 200 ms timeout and ignores every failure, since no Map being open is the normal case. `port` comes from `.nebulosity/config.json` (default 3000; the data folder's `config.json` for an installed copy), which `nebulosity map` sets to the port it starts the Map on (since V1.6's final review, ADR-058 amended). V1.4's MCP tools call it, and `npm run live -- <tool> [path …] [--highlight | --focus | --clear]` sends one by hand.

## 15. GET /api/repos, POST /api/repos (slice V1.3)

The repo picker (PIVOT_SPEC.md §7.1).

```ts
type RepoRemote = { owner: string; name: string };
type RepoSummary = { root: string; name: string; indexedAt: string | null; remote?: RepoRemote };
type RepoList = { active: string | null; repos: RepoSummary[]; server?: { version: string; bridge: number } };
```

- **`GET`** lists the repos the structure stage has indexed, by root, and the active one.
- **`remote`** (added in V1.3.1; optional, so `CONTRACTS_VERSION` stays 2) is the origin remote's owner and name, read from `<root>/.git/config` (`lib/engine/git-remote.ts`), so the top bar can say `microsoft / vscode` (VISUAL_REFRESH.md §6). The owner is everything before the last path segment, so a nested GitLab group stays whole; Azure DevOps's `_git` and `v3` markers are left out (`dev.azure.com/org/project/_git/repo` is `org/project` / `repo`), and scp-style urls may omit the user (`github.com:owner/repo`). A worktree's or submodule's `.git` pointer file is followed to the config that holds its remotes (since 2026-10-13). It's left out when there's no origin, when the url is a local path, or when the pointer leads nowhere, and the top bar then shows `name`.
- **`POST { root }`** makes an indexed repo the active one (`activeRepo` in `.nebulosity/config.json`) and points the background worker at it. It answers with the new `RepoList`. Localhost only. A root that was never indexed gets `404 NOT_FOUND`.
- **`server`** (slice V1.8, ADR-062; optional, so `CONTRACTS_VERSION` stays 3; on `GET` only, POST's answer is unchanged): `RepoList` gains `server?: { version: string; bridge: number }`, the package's version and the editor bridge's (§20, 1). The VS Code extension reads it to tell a current server from an older one (no `server`) and from another app on the port (no `RepoList` at all). It's on this route because `GET /api/repos` answers with nothing indexed, where `/api/status` gives `404 INDEX_EMPTY`.

## 16. GET /api/source?path= (slice V1.3.1)

An indexed file's text, for the Map's source viewer (`lib/engine/source.ts`; the owner asked to inspect a file's code on the Map).

```ts
type SourceResponse = { repo: string; path: string; content: string; lineCount: number; truncated: boolean; language: string };
```

- **Only indexed files.** The path must be a file the structure stage indexed. So the route can't read anything else in the repo (a `.env`, a key, `.git/config`), and a path that resolves outside the repo through a symlink is refused too.
- **`content`** is the file's bytes as UTF-8, up to 1 MB (about 25,000 lines of TypeScript). Past that it stops, and `truncated` is `true`. Only the first 1 MB is read, and the cut never splits a character: it backs off to the start of one that would straddle it (2026-10-13). Line endings are left as stored; the viewer shows them as plain line breaks.
- **`lineCount`** counts the lines in `content` the way an editor does: a final line break doesn't start another line.
- **`language`** is `typescript`, `javascript` or `text`, by extension, for highlighting. *(E4, ADR-065: also `python` (`.py`, `.pyi`), `go`, `java`, `csharp` (`.cs`) and `rust`, the language the index's rules give the file, so the same as `files.language`; the Map's viewer colors each with highlight.js's own grammar, in the same palette.)*
- Like every `/api` route, it answers only requests addressed to this machine (ADR-039). It reads and never writes.

**Errors:** `400 BAD_REQUEST` for a path that could leave the repo, or an empty one; `404 NOT_FOUND` for a folder, a file the index doesn't know, or a file deleted since; `404 INDEX_EMPTY`.

## 17. The MCP tools (slice V1.4; six tools since V1.6, ADR-056; seven since V1.7, ADR-059)

Claude Code and any MCP client reach the engine through `mcp/server.ts` over stdio (PIVOT_SPEC.md §6.2, ADR-030). Each tool is defined once in `lib/tools/registry.ts` (ADR-047). Claude Code shows them as `mcp__nebulosity__<name>`.

**Launch.** `node <checkout>/mcp/launch.mjs` (ADR-048), or `node <package>/mcp/launch.mjs` for an installed copy, as `nebulosity setup` registers it (ADR-058). It sets `NEBULOSITY_HOME` to the checkout or package unless it's set, and an installed copy's `NEBULOSITY_DATA` to the user's data folder unless it's set (ADR-044, amended). `NEBULOSITY_LIVE=off` stops every live event.

**Which repo.** The indexed repo holding the project folder (`CLAUDE_PROJECT_DIR`, else the server's working folder), the deepest when repos nest. Else the repo the Map shows, with a note first. Else an error (ADR-046).

| Tool | Input (default) | Answer |
|---|---|---|
| `overview` | none | the repo's size and summary, the docs to read first (up to 5), its top-level areas largest first (size and tagline; 30 at most), and the 10 most-imported files |
| `describe` | `path` | kind, files and lines; the summary; the docs about it (up to 5); what's inside (20 children) or the declarations (30, with lines); uses and used by (10 areas each, with import counts) |
| `search` | `query` (1–200 characters), `limit` 1–30 (10) | the best files and folders, each with its tagline and best-matching code (cut to 160 characters) |
| `imports` | `path`, `direction` (`dependents`: the files that import it; `dependencies`: the files it imports), `transitive` (false), `to`, `group_by`, `within`, `limit` 1–500 (50), `offset` (0) | see the modes below |
| `architecture` | `path` (""), `report`: summary, layers, conventions, cycles or unused (summary), `through`, `limit` 1–500 (20), `offset` (0) | a folder's organization computed from its imports (ADR-055), then the docs about the place (up to 5); with `through` or a file as `path`, the default report answers as `cycles`; see below |
| `calls` | `symbol`, `path`, `group_by`, `within`, `limit` 1–500 (50), `offset` (0) | see `calls` below |
| `show_on_map` | `action`: highlight, focus or clear (highlight); `paths` (0–50) | what was sent, what was left out, and whether the Map took it |

`imports` replaces V1.4's `dependents`, `dependencies` and `path` (ADR-056): `dependents` is `imports` with `direction: "dependents"` (the default), `dependencies` is `direction: "dependencies"`, and the `path` tool's `from` and `to` are `imports`' `path` and `to`.

**`imports`, by mode.** `to` wins over `group_by`, which wins over the plain list.
- *The list* (neither `to` nor `group_by`): the direct and total counts, then the files: nearest first, most imported next, by path last; grouped by distance when `transitive`. A transitive list of dependents ends its first page (offset 0) with the tests among them and the files nothing imports that load the target (the declared entry points first, worded as below); later pages are the list's continuation. Pages: a cut list ends `… N more (next page: offset K)`, and a page past the end says how long the list is. `within` keeps only files inside a folder (the first line says which); both directions take it. A `within` that is a file, isn't indexed, or equals or sits inside a folder target is refused with a sentence naming `within`. When `within` leaves no direct file, the direct-only page reads "None of them imports it directly; list them with transitive."
- *`group_by`* (a folder whose children are the areas, "" the top level, or "auto" for describe's used-by rule): counts everything reached, so always transitive, by area, then the tests and entry points as above. No file list.
- *`to`* (a file or folder): the shortest chain of imports from `path` to `to`, each step with the import as written, the other direction when needed, or "no chain". Places that overlap, and the whole repo, are refused. A chain ignores `within`, `group_by` and `transitive`; given any of them (`transitive: true`), the answer ends with the note "within, group_by and transitive don't apply to a chain." (since V1.6's final review).
- The whole repo ("") is refused as `path`: it has no outside.

**A step's import, as written** *(E4's final review, B-I3, ADR-065)*. A chain's step (`imports` with `to`) and a cycle's step (`architecture`'s `cycles`) name the import that makes the edge as the importer's source writes it. An edge stores the specifier in its language's own encoding (`use:|shop_core::model::Order`). The importer's language turns it back with its rules' optional `displaySpecifier`, applied once in `reach.ts`' `specifiersAlong`, so `ChainAnswer.specifiers` holds the import as written.
- **TypeScript and JavaScript** have no `displaySpecifier`: the specifier is already the module path as written, and the step reads `→ src/b.ts  (import "./b")`, as before E4.
- **Every other language** shows its form bare, in parentheses:
  - Python: `a.b` → `import a.b`; `a.b:c` → `from a.b import c`; `.m:c` → `from .m import c` (an alias isn't kept; a dynamic `import_module("a.b")` reads `import a.b`).
  - Go: `import:p` → `import "p"`; `import:p as x` → `import x "p"`; `use:api.Open` → `api.Open`; `name:N` → `N`.
  - Java: `import:a.b.C` → `import a.b.C`; `static:a.b.C` → `import static a.b.C` (the class, not the member); `type:C` → `C`; `qualified:a.b.C` → `a.b.C`.
  - C#: `using:A.B` → `using A.B`; `global:A.B` → `global using A.B`; `static:` and `gstatic:` → `using static A.B.C` and `global using static A.B.C`; `alias:` and `galias:X=A.B` → `using X = A.B` and `global using X = A.B`; `ns:A.B` → `namespace A.B`; `type:N` → `N`; `qtype:A.B.N` → `A.B.N`. A generic name carries its arity in the CLR's backtick form, which the display drops: `` type:Box`1 `` → `Box`, `` alias:M=A.Box`2 `` → `using M = A.Box` (the pre-ship pass; ADR-065 amended).
  - Rust: `use:|p as a` → `use p as a` (the inline module a reference sits in isn't written, so it's dropped); `mod:|x` → `mod x`; `mod:|x@y.rs` → `#[path = "y.rs"] mod x`; `extern:a` → `extern crate a`; `path:|crate::f` → `crate::f`.

  For example: `→ crates/core/src/model.rs  (use shop_core::model::Order)`, `→ internal/api/api.go  (api.Open)`, `→ src/shop/__init__.py  (from . import VERSION)`. A string a language didn't write comes back unchanged.

**Entry points, worded by who declared them** *(E4, ADR-065)*. An entry point is a file the language's build tool or runtime starts from (`entry_points.declared_by`: a package.json's field, a `Cargo.toml` target, a Go `package main` with `func main`, …). The answers name a package.json only when every entry point they list came from one, so TypeScript answers read as before; otherwise they drop it. Breadth differs by language, by design: each follows what its build tool starts from (the E4 final review's B-M12). Rust's Cargo targets include `[lib]`, `build.rs` and the tests, examples and benches roots, so a crate's `lib.rs` and its `tests/*.rs` are listed. Go, Java, C# and Python count only programs, so a Go `_test.go` or a Java test class never is. The three phrases:

| Where | Every entry point from a package.json | Otherwise |
|---|---|---|
| `imports`' dependents (the list and `group_by`) | `Entry points a package.json names that load it (N):` | `Entry points that load it (N):` |
| `architecture`'s `unused` | `Named as entry points by a package.json (N):` | `Entry points (N):` |
| `architecture`'s `summary` | `(N entry point(s) named by a package.json)` | `(N entry point(s))` |

**`architecture`, by report.** `summary` is the four reports in brief (layers bottom first and the imports against that order; the recurring folder names; the cycle count and the largest; the files nothing imports). `layers`, `conventions`, `cycles` and `unused` give one in full; `cycles` with `through` (or with a file as `path`) gives the shortest import cycle through that file, or says it is in none. `summary` with `through`, or on a file, is read as that question and answered as `cycles` (since 2026-10-15). `through`, or a file as `path`, with `layers`, `conventions` or `unused` is refused. A page of `unused` past the end of its list says how long the list is. Every report, and a file's cycle, ends with the docs about the place, the ones `describe` names for it (the repo's: the docs to read first), since 2026-10-15 (ADR-054, amended). Every report fits the 40,000-character limit: a page of cycles or of files nothing imports takes the docs lines out of its list's budget.

**`calls`** *(V1.7, ADR-059)*.
- **Description:** `Who calls a method of a class or interface, through declared types: injected services, fields, parameters, locals and base classes. With a method: its callers, its implementations and what changing it touches; with a type: where it is injected. Prefer it to grep.`
- **Input:**
  - `symbol` (required, at most 200 characters): `"IFooService", or a method: "IFooService.save".`;
  - `path`: `Its file, if two types share the name.`;
  - `group_by`: `Count by area: a folder ("" the top level) or "auto".`;
  - `within`: no description (trimmed in V1.7 to hold the first-call budget, R-AA);
  - `limit` 1–500 (50): `Files to list, 1 to 500.`;
  - `offset` ≥ 0 (0): no description (trimmed likewise).
  - `path`, `group_by` and `within` take at most 1,024 characters each, as the other tools' path inputs do (since 2026-10-22).
- **The instructions' bullet,** after `imports`': `- calls: who calls a method, even through injected services, where a type is injected, and what changing it touches (give the type's file as path);` The instructions' opening line reads "Call these tools first, before grep, a script of your own or reading many files, for any question about how the code is organized or connected: …" and names the questions (who calls or injects something, what a change touches and which tests to run, imports against the layers, cycles, files nothing imports); `search`'s description is "Find where a feature or concept lives: the best files and folders, with their best-matching code." (V1.7 tool-use round 3, R-AA).
- **The answer, for a method** (a fictional example):
```
IFooService.save (interface IFooService, src/platform/foo/common/foo.ts:12): called in 3 files, 4 calls in all.
On IFooService itself in 2 files, on an implementation in 1. Tests among the files: 1.
By area:
  src/workbench/  2
  src/platform/foo/common/fooService.ts  1
Files, most calls first (lines):
  src/workbench/editor/fooEditor.ts  40, 52
  src/platform/foo/common/fooService.ts  88  (on FooService)
  src/workbench/test/foo.test.ts  17
If save's signature changes, 5 files change: these 3, and 2 that declare it:
  src/platform/foo/browser/memoryFooService.ts
  src/platform/foo/common/foo.ts
Implementations of IFooService (2; 2 declare save):
  MemoryFooService  src/platform/foo/browser/memoryFooService.ts:5  implements IFooService, declares save
  FooService  src/platform/foo/common/fooService.ts:9  implements IFooService, declares save
Note: found through declared types: fields, constructor parameters, parameters, locals, X.get(T), useService(T), new C(), base classes and aliases. A call on a value whose type is only inferred isn't seen.
```
- **For a type alone,** the header says where it is injected (`injected in N files, M places in all`), the files list each place's line and how (constructor, `@inject` field, accessor or hook), and the implementations follow without the "declares" column.
- **Paging:** the totals always cover everything. The signature-change list and the implementations come on the first page only, and a cut list ends with `… N more (next page: offset K)`. A file whose row alone is longer than a page (thousands of calls in one generated file) keeps the first line numbers that fit and ends them with `… N more lines`, and the next page starts after it (since 2026-10-22; before, the page listed nothing and named its own offset as the next).
- **Ambiguous names** list the candidates, one per line with the kind, path and line, and ask for `path`.
- **Another language's file** *(E4, ADR-065, design C4: calls stays TypeScript and JavaScript)*. A `path` the index's rules give to Python, Go, Java, C# or Rust is refused before the symbol is read, with `Calls are indexed for TypeScript and JavaScript only; <path> is <Language>.` (`Python`, `Go`, `Java`, `C#`, `Rust`). Without `path`, a name the calls index doesn't hold but another language's file declares as a type (a class, interface, struct or trait among its symbols, at any depth) gets the same sentence for each such file, by path, at most five and then `, and N more` (`Calls are indexed for TypeScript and JavaScript only; src/shop/models.py is Python, src/shop/models.pyi is Python.`), never "No class or interface named X is indexed" *(E4's final review, A-I3: on a Java or Python repo that read as "the type doesn't exist")*. A name no file declares as a type keeps that answer.
- **Live event:** the declaring file, then up to 49 of the page's files (the Map takes 50 paths at most).

**Always loaded.** Each tool's MCP `_meta` says how Claude Code loads it (ADR-056): `overview`, `describe`, `search`, `imports`, `architecture` and `calls` carry `"anthropic/alwaysLoad": true`, so their definitions are in every session's prompt; `show_on_map` carries `"anthropic/searchHint": "map highlight focus show point visualize"` and stays deferred behind Claude Code's tool search. A registration carries no `alwaysLoad` of its own. The six definitions and the instructions together stay under 6,650 characters (a test; they measure 6,599 since `calls`' path inputs gained their 1,024-character limit on 2026-10-22, 6,548 before, ADR-056 amended).

**Paths.** Inputs are repo-relative, or absolute inside the repo, which is how Claude Code's own tools write them (Windows ignores case; ADR-046, amended). Backslashes, a leading `./` and a trailing `/` are accepted (`parseRepoPath`); `..`, and absolute paths outside the repo, are refused, and the refusal names the repo's root. Answers always write paths from the repo root, and a session started in a subfolder of the repo is told so on its answers' first line. `""` is the repo root; `imports` refuses it, since the whole repo has no outside.

**Answers.**
- Plain text with no Markdown. Repo-relative paths, folders ending in `/`.
- Exact counts with thousands separators. A count always covers everything, even when the list under it is cut.
- A cut list ends with `… N more`, plus `(next page: offset K)` where the tool pages.
- Every answer stays under 40,000 characters.
- Notes are lines starting `Note: `. When the project folder didn't pick the repo, or sits below the repo's root, that note comes first. Then the answer, then the tool's own notes, then the index note (an update in progress or failed), and the stale-summary note last.
- With no API key, the line where a summary would go reads `Summary: none — summaries are off (no ANTHROPIC_API_KEY); a key adds a short summary of every file and folder.`
- Docs (ADR-054): a header, then one line per doc, `  <path> — <title> (<why>)`. The header is `Docs to read first:` for the repo (`overview`, and `describe` or `architecture` of "") and `Docs to read before answering how this is organized or why:` for a folder or file (`describe` and `architecture`). Before 2026-10-15 `describe`'s read `Docs about it:` and `architecture` named no docs. `describe` puts them after the summary line; `architecture` after the report.

**Errors.** An MCP error result (`isError: true`) with one sentence. The cases:
- nothing indexed yet (with Nebulosity's folder);
- an index older than the checkout;
- nothing indexed at a path;
- a path outside the repo;
- overlapping places for `imports` with `to`, and a `within` that cannot match;
- `calls`' refusals: a `path` of a file in another language (below); a `symbol` that is not a class or interface name or one of its members; no class or interface by that name in the index (with `path`: none declared in that file); `X has no member m` (with the type's members listed, up to 30); a `within` that is not a folder in the index, or is a file; a `group_by` that is not a folder;
- `architecture`'s `through` with `layers`, `conventions` or `unused`;
- bad `show_on_map` input;
- the MCP SDK's "Input validation error" for input outside a schema.

**Live events** (§14). One per successful call: `tool` is the bare name and `paths` what the call touched. describe sends its path; search its hits; imports its target, or with `to` the target, `to`, then the chain between; architecture its path; calls the declaring file, then up to 49 of the page's files (the Map takes 50 paths at most); show_on_map its paths and its `action`; overview none. None go out when the answer's repo isn't the one the Map shows, or with `NEBULOSITY_LIVE=off`. Pulses are fire-and-forget; show_on_map waits (at most 200 ms) to say whether the Map took it.

**Instructions.** The server's `instructions`, sent once per session (Claude Code keeps 4,096 characters since 2.1.296, 2,048 before), are `SERVER_INSTRUCTIONS` in the registry: when to reach for each tool, under 2,048 characters so older clients keep all of it. Since 2026-10-15 their last sentence says the docs the answers name are the maintainers' own account, to open before answering how the code is organized or why (ADR-054, amended). The closing sentence on paths went in V1.7 Task 16 (every path input says it); the instructions are 1,339 characters.

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

## 19. GET /api/imports?path=&direction=&transitive=&limit=&offset= (slice V1.8, ADR-062)

The files that import a file or folder, or that it imports, for the VS Code extension's "What depends on this file?" (`lib/engine/reach.ts`'s `reach()`, the engine behind the MCP `imports` tool's plain list, §17).

```ts
type ImportsResponse = { path: string; kind: "folder" | "file"; direction: "dependents" | "dependencies";
  transitive: boolean; files: { path: string; distance: number }[];
  direct: number; total: number; offset: number; indexVersion: number };
```

- **`direction`** defaults to `dependents`. **`transitive`** (`false` by default) keeps only distance 1 when false; when true, every file reached, nearest first, as `reach()` orders them.
- **`total`** counts the files the answer has across all pages (after `transitive`), `files` the page: `limit` 1–500 (50), `offset` ≥ 0 (0). `direct` counts distance-1 files whatever `transitive` is.
- A read route: `proxy.ts`'s Host check covers it, with no Origin check (§14's rule is for routes that change things). Answers are cached by index version like `describe`.
- **Errors:** `400 BAD_REQUEST` for a missing `path`, a path that could leave the repo, more than 1,024 characters, or a bad `direction`, `limit` or `offset`; `404 NOT_FOUND`; `404 INDEX_EMPTY`.

## 20. The editor bridge (slice V1.8, ADR-062)

Messages between the Map, framed in a VS Code webview with `?embed=vscode`, and that webview, which relays them to and from the extension. They travel by `window.postMessage`; nothing here is HTTP. Without `?embed=vscode` the Map never listens or posts.

```ts
type BridgeToMap =
  | { type: "nebulosity.hello"; version: 1 }
  | { type: "nebulosity.follow"; path: string }     // the active editor changed: focus, replacing the history entry
  | { type: "nebulosity.show"; path: string }       // a deliberate jump: focus, pushing a history entry
  | { type: "nebulosity.highlight"; paths: string[] }
  | { type: "nebulosity.clear" };
type BridgeFromMap =
  | { type: "nebulosity.ready"; version: 1 }        // the answer to hello
  | { type: "nebulosity.open"; path: string; line?: number }    // a file box or a declaration was picked
  | { type: "nebulosity.drawn"; path: string; page: number; selected: string | null };   // a level is on screen (below)
```

- **The handshake.** The Map accepts a `hello` only when `event.source === window.parent` and `event.origin` starts with `vscode-webview://` (every hello in V1.8's spike carried that prefix, in VS Code, in Cursor and over WSL; the id after it differs per window). It keeps that origin, answers `ready`, and from then on posts only to it (`targetOrigin`) and drops every message from any other source or origin. Before the handshake it posts nothing.
- **Paths** are repo-relative, as everywhere (§1). A `follow` or `show` for a path the index doesn't hold is ignored, and one with an empty path (the repo, which is no editor's file) is refused like a malformed message (amended 2026-10-24, PR #10's review); `highlight` takes at most 50 paths, like §14, and the Map reads no further than its first 1,000 entries (a sparse array's length can claim 2^32 - 1).
- **`open`** is posted for a file box clicked on the Map and for a declaration row in its panel, and for nothing else (not a search pick, a panel link, `focus_node` or a `follow`). Its `line`, when present, is **1-based**: the declaration's first line as the panel shows it ("line 272"), which the extension opens with the cursor at that line's start. A file box sends no `line`.
- **`version`** is the bridge's, 1; `GET /api/repos`' `server.bridge` (§15) names the one a server speaks. A Map that gets another version ignores the hello.
- **`drawn`** is posted when a new level is drawn, when the selection changes on the level drawn, and once after each `ready` while a level is on screen; the extension's test and benchmarks read it (V1.8 plan P1). `path` and `page` name the level on screen (page 0 is the first) and `selected` the selected path, or `null`. Like every message from the Map, it comes only after the handshake.

## 21. The settings file (`config.json`) (the pre-ship pass, 2026-10-25, ADR-066)

`config.json` in the data folder (`NEBULOSITY_DATA`, else `.nebulosity/` in a checkout; `lib/home.ts`) holds the few settings that outlive a run. `lib/config.ts` reads and writes it; nothing here is HTTP.

```ts
type NebulosityConfig = {
  activeRepo: string | null;   // the repo the Map and the MCP server show (§15's POST, nebulosity index)
  port: number;                // the Map's port (nebulosity map --port), where live events go (§14)
  summaryModels?: unknown;     // as found in the file; resolveSummaryModels checks it (below)
};
type ConfigRead = { config: NebulosityConfig; problem: string | null };   // readConfigFile(); readConfig() is its config
type SummaryModelSetting = { model: string; inputPerMTok?: number; outputPerMTok?: number };
type SummaryModelsSetting = Partial<Record<"file" | "folder" | "repo", SummaryModelSetting>>;
```

- **`activeRepo`** is a string or `null`; anything else reads as `null`. **`port`** is an integer from 1 to 65535; anything else reads as 3000.
- **Reading the file** (`readConfigFile`; the final review's A-I2, ruling R25). A leading UTF-8 byte-order mark is skipped, and the file is read as UTF-16 when a UTF-16 mark leads, little- or big-endian: Windows PowerShell 5.1 (`Set-Content -Encoding utf8`, `>`) and Notepad's "UTF-8 with BOM" write them.
  - A file that's missing, or holds nothing but whitespace, has no settings: both defaults.
  - A file that's there but isn't one JSON object (invalid JSON such as a trailing comma, another JSON value, or a read that fails) reads as both defaults too, so the Map and the MCP server start. But it isn't taken for "no settings": the read's `problem` names the file and what's wrong (the parse error), the summary models can't be used (below), and `nebulosity doctor` fails.
- **Rewriting the file** (`writeConfig`). A file that couldn't be read is never written over. It's renamed to `config.json.invalid-<time>` beside it first (the UTC time, with `-` for `:` and `.`, such as `config.json.invalid-2026-10-25T13-50-12-345Z`), the move is said on stderr, and then the new file is written; a rename that fails throws, and nothing is written. `nebulosity doctor` lists each moved-aside file as a WARN.
- **Kept as found.** `readConfig()` returns `summaryModels`, and any key this version doesn't know, exactly as the file holds them, valid or not, so a rewrite (`writeConfig({ ...readConfig(), activeRepo })`, the repo picker's and `nebulosity index`'s) keeps them. It never throws over them: the Map starts with a setting it can't use.
- **`summaryModels`** sets the model that writes each kind's summaries (`SummaryModelsSetting`). A kind left out, or the whole key left out or `null`, keeps its default (`SUMMARY_MODELS`, ADR-028: `claude-haiku-5-5` for files, `claude-sonnet-5-5` for folders and the repo). For example:
  ```json
  { "summaryModels": { "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 } } }
  ```
  - `model` is a string, trimmed of surrounding whitespace. The trimmed id is what's sent and hashed, and it has 1 to 200 characters, so a blank one is refused.
  - The prices are the model's list prices in US dollars per million input and output tokens, finite numbers from 0 up.
  - The prices are required for a model the built-in price table doesn't have (an exact id, or a dated snapshot of one, `<id>-YYYYMMDD`; any other longer id is a different model), and optional for one it has; a given price wins over the table's, field by field. A price another kind gives the same model counts, and one model given two different prices is refused, since spend is recorded per model.
  - Any other kind or field, a wrong type, or a missing price is refused with one message that names each field (such as `summaryModels.file.inputPerMTok`) and this file's path.
- **Who reads `summaryModels`.** `resolveSummaryModels(setting, configPath)` (`lib/index/summarize/models.ts`) turns it into the models, every model's price and which kinds are set. `configuredSummaryModels()` reads the file and resolves it; a file that can't be read is a setting that can't be used, with the file and the parse error as the message, since what it sets is unknown. `nebulosity summarize` reads it before it estimates or sends anything, and refuses one it can't use; the background worker and the Map's `POST /api/summarize` read it at each job, so a change applies without a restart. While it can't be used, the summaries stage isn't re-derived, `nebulosity summarize` writes no templates (with a key or without), the worker sends nothing, and §13 answers `409 SUMMARIES_OFF` with the message. `nebulosity doctor` prints the models in use and which are set, and fails on a setting it can't use.
- **What a change costs, and who pays it (ADR-066, R17).** The worker's automatic jobs (a refresh after a save, the sweep of out-of-date folders) send only targets whose text the model now in use wrote, or that no model has written. Text another model wrote waits for `nebulosity summarize`'s estimate and yes, or for §13 when a panel opens it. A batch left at Anthropic for a model the setting no longer names stops nothing: its rows are released for the model now in use.
