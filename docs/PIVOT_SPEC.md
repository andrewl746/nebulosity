# PIVOT_SPEC.md — Nebulosity as a Code-Intelligence Companion for Massive Codebases

**Status:** Approved direction (owner brainstorm, 2026-10-10 → 11). This spec awaits owner review; once approved it is authoritative and the v1 implementation plan is written from it.
**Date:** 2026-10-11
**Supersedes:** `VISUALIZATION_DESIGN.md` §1–4 (radial layout, tier plan, and the "Tier XL is a product boundary" decision), ADR-014/015 (native scanner), and roadmap Phases 6 and S. Every other doc stays valid except where its banner points here (§16).
**Scope:** v1 in full detail; extras E1–E5 at design level. Each extra gets its own implementation plan when it starts.

---

## 0. In one paragraph

Claude Code understands a repository by searching it on demand (grep, read, reason) and forgets everything when the session ends. That works for small repos and local questions. On massive repos it struggles with three kinds of question: **big-picture** ("what are the subsystems and how do they talk?"), **complete-list** ("every file that depends on X") and **repeated** (every session pays for the same exploration again). Nebulosity does the expensive understanding **once**, keeps it **fresh incrementally**, and serves it two ways: to AI agents through an **MCP server**, and to people through a zoomable **Map**.

> *Claude Code searches your codebase. Nebulosity has already mapped it.*

---

## 1. Positioning and evidence

- **Companion, not competitor.** Nebulosity does not replace any agent's loop. It gives every MCP client (Claude Code, Claude Desktop, Cursor, VS Code's agent mode) a precomputed map. Its own agent, the Guide (E1), exists for guided onboarding inside the Map.
- **Why not "better RAG".** Claude Code's team tried a local vector index early on and found agentic search better, largely because indexes go stale. Nebulosity answers staleness with incremental re-indexing (§5.6). Its value is answers that exist in no single file: summaries of whole areas, exact dependency sets, connection paths.
- **Measured feasibility** (owner's laptop, 2026-10-10, VS Code at commit `cc3fec88`, existing code, single-threaded):

| Measurement | Result |
|---|---|
| Files / TypeScript files | 20,342 / 14,615 (4.65M lines, 199 MB) |
| Read every TS file | 2.4 s |
| Parse + chunk (existing chunker) | 22.3 s — 101,603 chunks, 0 errors |
| Import scan | 4.6 s |
| FTS5 insert of every chunk | 4.8 s (211 MB) |
| **Structure ready** | **≈ 35 s** |
| Existing MiniLM embedder | ~18 chunks/s → all chunks ≈ 94 min (rejected; see §5.4) |
| Cross-area import statements in `src/vs` alone | ~65,800 |

- **Two scale bugs this pivot must fix**, both verified by running them: SQLite caps one statement at 32,766 bound parameters and Drizzle does not split inserts, so `saveScan` throws "too many SQL variables" past **10,922 import edges** (3 params each) or **8,191 files** (4 each), and `loadGraph`/`getCentralFiles` fail past 32,766 files (`inArray` over every id).

---

## 2. Goals, non-goals, success criteria

**v1 goals.** G1: index any local TypeScript/JavaScript repo at VS Code scale. G2: the Map UI. G3: the MCP server. G4: a hosted static demo of VS Code's map. G5: an evaluation against Claude Code alone. G6: ship (public repo, README, demo video).

**Non-goals.** Editing code. Replacing Claude Code. Multi-user, SaaS or paid tiers (CLAUDE.md's non-goals stand). Non-TS/JS languages before E4. The native C++ scanner (dropped, ADR-025).

**Success criteria.** v1 is done when every row holds, measured on VS Code at `cc3fec88`:

| # | Criterion | Threshold |
|---|---|---|
| S1 | Structure stage (discover → parse → resolve → aggregate → write) | ≤ 60 s |
| S2 | Full summary pass, tiered, via the Batch API | ≤ $15 |
| S3 | Map interaction (click, zoom, level change → rendered) | ≤ 100 ms; level API ≤ 50 ms |
| S4 | Boxes on screen at once, counting the "+N more" box | ≤ 50 |
| S5 | MCP tool latency, warm (after the first call of a session) | ≤ 500 ms |
| S6 | From saving one file until `level`/`describe` reflect the change | ≤ 2 s |
| S7 | Evaluation run and published, losses included | done |
| S8 | Public repo, README, video, live demo link | done |

---

## 3. Architecture

```
┌──────────────────────────────── ENGINE (lib/) ────────────────────────────────┐
│ index/    discover → parse (language adapters) → resolve → aggregate         │
│           → summarize → embed          (+ E2 calls, E3 history, E5 clusters)  │
│ db/       SQLite store: files, symbols, imports, folders, summaries, FTS, …   │
│ engine/   level · describe · search (RRF) · dependents · path · freshness     │
│ tools/    registry — every tool defined once                                  │
└──────┬─────────────────────────┬─────────────────────────┬───────────────────┘
       │ stdio                   │ HTTP + SSE              │ files
  mcp/server.ts            app/api/* + Map UI       scripts/export-demo.ts
       │                         │                         │
  Claude Code, any         people (+ the Guide,     hosted static demo
  MCP client               E1, in-process)          (no API calls)
```

**Rules.** ARCHITECTURE.md §3 still holds and matters more now that several adapters depend on it.
1. Core (`lib/`) never imports `app/`, `next` or React. Fix on the way in: `lib/graph.ts` imports types from `app/components/FileNode` today, which breaks this rule.
2. Adapters are thin. The MCP server, route handlers, static exporter and CLI scripts each validate input, call one engine function, and format the result.
3. `lib/contracts.ts` becomes renderer-agnostic. React Flow's `Node`/`Edge` types leave the contract, and the UI maps a `LevelResponse` into whatever renderer it uses.
4. **Paths resolve from the install directory, not `cwd`.** `lib/db/client.ts` opens `.nebulosity/nebulosity.db` and the migrations folder relative to `process.cwd()`. Claude Code launches the MCP server from the *user's* repo, so both must resolve from `NEBULOSITY_HOME`, falling back to `process.cwd()` when it's unset. That fallback is correct for Next.js, the CLI and Vitest, which all run from the checkout. The MCP launcher (V1.4) always sets it.
5. One database, many repos. The `repositories` table already supports this. WAL lets the MCP server read while the indexer writes. **The MCP server opens the database read-only and never runs migrations.** Only the Next server and CLI own the schema. Running two processes against one database file is exactly ADR-023's revisit trigger, and this is the answer to it.

**Processes.** The Next.js server runs the UI, the API, the live channel, and background indexing on a worker thread. The MCP server is spawned once per Claude Code session, is read-only on the database, and posts live events over HTTP. CLI scripts cover index, export, bench and eval.

**Target layout and where today's files go:**

```
lib/contracts.ts            renderer-agnostic shared types (CONTRACTS_VERSION → 2)
lib/db/                     client.ts (NEBULOSITY_HOME paths), schema.ts, store/*.ts
lib/index/discover.ts       ← lib/scan.ts (git ls-files + fallback walk)
lib/index/languages/        adapter.ts (interface), typescript.ts ← lib/chunks.ts + AST imports
lib/index/resolve.ts        ← resolveImport & co. from lib/graph.ts, + per-package tsconfig
lib/index/aggregate.ts      folders + level edges (§4.2)
lib/index/summarize.ts      tiered summaries, Batch + on-demand
lib/index/embed.ts          ← lib/embed.ts (plumbing unchanged; embeds summaries)
lib/index/pipeline.ts       ← lib/index-repo.ts (stages, lock, progress)
lib/index/watch.ts          file watcher + debounce
lib/engine/                 level.ts, describe.ts, search.ts ← lib/retrieve.ts, graph.ts, freshness.ts
lib/tools/registry.ts       ← lib/agent/tools.ts logic, split from its LangChain wrappers
lib/agent/                  E1 only: state.ts, graph.ts, prompts.ts
mcp/server.ts               MCP adapter
scripts/                    index.ts, export-demo.ts, bench-index.ts, eval/
test/fixtures/mini-repo/    hand-designed fixture repo (excluded from tsconfig)
```

---

## 4. Data model

Persistence shapes live in `lib/db/schema.ts` (ADR-013). The spec fixes their meaning; exact column types are settled in code.

### 4.1 Tables

| Table | Status | Purpose |
|---|---|---|
| `repositories` | kept | one row per indexed repo; gains `indexedHead` (git commit at last index) |
| `files` | extended | adds `language`, `sizeBytes`, `lineCount`, `isTest`, `importSpecifiers` (raw specifiers as JSON, so unchanged files are re-resolved without re-parsing). `contentHash` keeps its single owner and meaning (ADR-022) |
| `imports` | kept | file → file edges; now produced from the AST |
| `chunks` | kept | retrieval units (existing chunker); feeds the code FTS index; `chunkId` is now unique per file; `nameSplit` is the name as words |
| `vectors` | **retired** | chunk embeddings; replaced by `summary_vectors` (§5.4) |
| `meta` | kept | lock, model ids, schema version, per-stage status (§5.7) |
| `folders` | new | `path` (unique per repo), `parentPath`, `depth`, `name`, `fileCount` (recursive), `directFileCount` |
| `level_edges` | new | aggregated edges per level (§4.2): `levelPath`, `sourceNode`, `targetNode`, `count` |
| `symbols` | new | top-level declarations **and class members**: `name`, `qualifiedName` (`Class.method`), `kind`, `startLine`, `endLine`, `exported`, `parentQualifiedName` (a string, so whole batches insert without needing ids first) |
| `summaries` | new | `targetKind` (file, folder, repo, cluster), `targetPath`, `tagline` (≤ 6 words), `summary` (2–4 sentences), `model`, `inputHash`, `status` (fresh, stale, pending, failed, skipped; `off` is reported, never stored), `error`, and `batchId`/`pendingHash` so a Batch run can resume (§5.3) |
| `summary_vectors` | new | one embedding per model-written summary (encode/decode pair, ADR-017) |
| `summary_usage` | new | API tokens per repo, model and transport (direct, batch); S2 is measured from it |
| `code_fts` | new (FTS5) | `path`, `name`, `nameSplit` (camelCase split, so "editor" finds `openEditor`), `text` over chunks; kept in sync by triggers (ADR-031) |
| `summary_fts` | new (FTS5) | `path`, `tagline`, `summary`; kept in sync by triggers (ADR-031) |
| E2 `calls` | later | `callerSymbolId`, `calleeSymbolId`, `count`, `resolution` (typed, heuristic) |
| E3 `file_history`, `co_changes` | later | churn, last change, first commit, top authors; co-change pairs with confidence |
| E5 `clusters`, `file_clusters` | later | cluster id, label, size; file → cluster |

### 4.2 Level edges (how 65,800 imports become one line)

For every import edge `a → b`, take `L = LCA(dir(a), dir(b))`, the deepest folder containing both. The source node is the child of `L` on the way to `a` (a folder, or `a` itself if it sits directly in `L`); the target node is found the same way. Increment `(L, sourceNode, targetNode)`. Every import is counted **exactly once**, at the level where it crosses between siblings. Viewing folder `L` reads its children plus `level_edges WHERE levelPath = L` — one indexed lookup, no computation at click time.

**"Uses" and "used by" for a node X:** imports that cross X's boundary, each grouped under the child of `LCA(X, other side)` on the way to the other side. For `src/vs/workbench` that yields `base 20.6k · platform 19.2k`. For a deep folder it yields its nearest meaningful neighbours. These are computed on demand with a prefix-range query on the path index and cached per index version.

### 4.3 Write discipline

- **Batched statements.** Every bulk write is split into statements of at most `floor(32,766 / columns)` rows, inside one transaction per batch of files. A regression test inserts more rows than one statement can hold.
- **No `inArray` over every id.** Repo-scoped reads use joins on `repoId`.
- Per-file transactions keep the existing atomicity: derived rows and the content hash land together or not at all (ADR-022).
- `CONTRACTS_VERSION` → 2. A schema version mismatch triggers a rebuild, which is the existing rule.

---

## 5. Indexing pipeline

### 5.1 Discover
Use `git ls-files` when `.git` exists, so `.gitignore` is respected for free; otherwise walk the tree, skipping `node_modules`, `.git`, `.next` and `.nebulosity` (skipped in git mode too), plus `dist`, `out`, `build` and `coverage` (skipped only when walking: in a git repo `.gitignore` decides, and a tracked `build/` can be real source, as in VS Code). Keep files the active language adapters claim (v1: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`). Never index `.env*`. Files larger than 1 MB are recorded as skipped. The scan is no longer limited to `app/` and `lib/`.

### 5.2 Structure (blocking; target S1 ≤ 60 s)
1. Hash every file and skip unchanged ones (ADR-022's contentHash rule).
2. Parse changed files with the **TypeScript adapter** (`ts.createSourceFile`, no type checker):
   - **Chunks.** The existing chunker, keeping ADR-018/019/020.
   - **Symbols.** Top-level declarations plus class members.
   - **Imports, read from the AST.** Static, side-effect, re-export, dynamic `import()` and `require`. This retires the regex extractor and its string-literal false positives (ADR-003/016 revisit triggers).
   - **Metadata.** Line count, and whether it's a test file (`/test/`, `.test.`, `.spec.`).
3. Resolve imports:
   - relative paths
   - `tsconfig` `paths`, read from the **nearest** `tsconfig.json` up the tree so monorepos work
   - NodeNext `.js → .ts`
   - `index` files
4. Write files, symbols, chunks, imports and FTS rows in batched transactions (§4.3).
5. Aggregate: rebuild `folders` and `level_edges` in full each run (cheap at VS Code scale), then compute in-degree for importance.
6. Mark the stage `ready`. **The Map is usable from this point.**

### 5.3 Summaries (background)
- **Order.** Most-imported files first, so central code lands early. When the UI opens a path that has no summary yet, it jumps the queue through the regular API (`POST /api/summarize`).
- **File summaries** use Claude Haiku 5.5 (`claude-haiku-5-5`). Input: path, the file-summary chunk (imports/exports), and the file text capped at about 6k tokens. Output (structured): `{ tagline, summary }`. **Test files get a templated summary with no API call.**
- **Folder summaries** use Claude Sonnet 5.5 (`claude-sonnet-5-5`), built bottom-up once all children are fresh. Input: the folder path plus its children's taglines and summaries, capped at the 50 largest plus "N more". Same output shape.
- **The repo summary** uses Sonnet 5.5, from the top-level folder summaries.
- **Transport.** The first full pass uses the Message Batches API (half price), submitted in chunks of up to 5,000 requests, with results keyed by `custom_id`, never by position. Incremental and on-demand work uses the regular Messages API with a concurrency limit and honours `retry-after`.
- **Cache key.** `inputHash = hash(model, promptVersion, input)`, so identical input is never re-summarized. Bumping `promptVersion` invalidates everything deliberately.
- **Effort.** Low by default, tunable. On day 1, 20 VS Code files go through both models side by side, and the owner checks quality before the full run.
- **No API key** sets the stage to `off` with a reason. Everything else still works.
- API usage follows the `claude-api` skill's TypeScript reference (official `@anthropic-ai/sdk`). Nothing is guessed.

### 5.4 Embeddings (background, worker thread)
Embed `tagline + summary + path` for each fresh summary with the existing MiniLM pipeline (ADR-005), storing results in `summary_vectors`. That's roughly 15–20k vectors, about 15 minutes at the measured 18/s. It runs in the background and never blocks the Map. Chunk-level embeddings are dropped: 94 minutes is unaffordable, and summaries carry meaning better than raw code chunks (ADR-027).

### 5.5 Later stages
The call graph (E2), git history (E3) and clusters (E5) plug into the same stage and status mechanism.

### 5.6 Incremental updates and freshness
- **Watcher.** While the Next server runs, a watcher (chokidar) covers the repo root, ignoring `.git` and `node_modules`. Structure updates are debounced by 1 s. A file's summary refreshes only after 60 s with no further change to that file.
- **Startup check.** Size and modification time act as a fast filter, and only candidates get re-hashed. Even a full re-read is cheap: 2.4 s for VS Code.
- **When file F changes:**
  - Re-parse F and replace its rows.
  - Re-resolve F's imports.
  - Re-resolve imports **into** F's path only when F is created, deleted or renamed.
  - Rebuild the aggregates.
  - F's summary becomes `stale` and is redone after the debounce.
  - Ancestor folder summaries become `stale` and are refreshed lazily, when viewed or by a periodic sweep, so a `git pull` doesn't trigger hundreds of Sonnet calls.
  - Re-embed whatever was re-summarized.
  - Untouched files are never re-read, re-parsed or re-summarized.
- **E2 nuance.** Call edges *into* F's symbols are re-resolved in files that import F. A rename in F changes what those links point at.
- **Honest answers.** Every MCP/engine answer that touches stale paths says so, e.g. "2 files in this area changed since indexing; update in progress".
- **Concurrency.** One indexer at a time (the existing `meta` lock with its staleness timeout). Readers never block (WAL).

### 5.7 Errors and status
- Per-file failures are recorded and reported, and never abort a run (ADR-021).
- API failures retry three times with backoff, then become `failed` and are retried on the next run.
- Stage status is `idle | running | ready | off | failed`, with `done/total` and a note. It's exposed at `GET /api/status` and drives the UI's progress pill.

---

## 6. Engine queries and the tool registry

### 6.1 Queries (pure functions over the store, unit-tested, cached per index version)
- **`level(path)`**: breadcrumb, at most 50 nodes plus a "+N more" node, that level's edges, and the hidden count.
- **`describe(path)`**: tagline, summary, status, stats, children (folder) or symbols (file), uses and used-by (§4.2), freshness.
- **`search(query, opts)`**: hybrid. Three ranked lists: BM25 over `code_fts`, BM25 over `summary_fts`, and cosine similarity over `summary_vectors`. They're merged with **Reciprocal Rank Fusion**, `score(d) = Σᵢ 1 / (60 + rankᵢ(d))`, then grouped by file with the best snippet.
- **`dependents(path, { transitive, limit })` and `dependencies(…)`**: BFS over an in-memory adjacency list built from `imports` and cached per index version. VS Code's graph is a few MB. The result has an exact total, then the top entries by distance.
- **`path(from, to)`**: the shortest import chain by BFS, in either direction, or "no path".
- **E2** `callers`, `callees`, `callFlow`. **E3** `history`, `hotspots`, `coupling`. **E5** `clusters`.

### 6.2 Registry
Each tool is defined once in `lib/tools/registry.ts` as `{ name, description, zod input schema, handler }`. Descriptions are written for an LLM: when to use the tool and what it returns. Adapters wrap the entries: MCP registers them in v1, and LangGraph wraps the same entries in E1. Output is compact plain text with repo-relative paths, exact totals, truncation markers ("… 4,231 more") and a freshness note last.

| v1 tool | Purpose |
|---|---|
| `overview` | Repo summary plus top areas with tagline and size. The first call on any unfamiliar repo |
| `describe` | What a folder or file is, what's inside it, what it uses, what uses it |
| `search` | Find code or concepts by keyword or meaning |
| `dependents` | Everything that imports X, directly or transitively, with complete counts |
| `dependencies` | Everything X imports, directly or transitively |
| `path` | How A reaches B through imports |
| `show_on_map` | Highlight paths on the open Map. Does nothing if the Map isn't open |

Claude Code shows these as `mcp__nebulosity__<name>`. Nebulosity does not duplicate file reading; agents keep using their own Read/Grep for source text.

**Safety.** Every tool is read-only. Paths are validated against the repo root (today's `safePath`, generalized). The MCP server listens on nothing (stdio), and the live endpoint accepts only localhost.

---

## 7. The Map UI

- **Regions:**
  - top bar: repo name, a ⌘K search palette, and a lens switcher that shows only the lenses that exist
  - breadcrumb plus index-status pill
  - the canvas
  - a detail panel that opens on selection
  - a bottom dock: the live Claude Code pill in v1, plus the Guide input in E1
- **Levels.** Repo root → folders → files. A leaf folder shows its files and the imports between them. The file panel lists symbols and, from E2, opens a call flow per function.
- **Cap.** At most 50 boxes. Overflow folds into "+N more" (the smallest by file count), and opening it lists them in the panel instead of drawing more boxes.
- **Boxes** show the name, file count and tagline. While the summary is pending they show a quiet placeholder.
- **Edges** come from `level_edges`, with thickness ∝ √count. Only the selected box's edges are drawn at full strength; the rest are ghosted. Hovering shows the count.
- **Layout.** dagre (ADR-011), layered by dependency direction, computed client-side, deterministic. 50 nodes take milliseconds.
- **Lenses, one at a time.** Structure (v1), History (E3), Clusters (E5).
- **Search.** ⌘K over files, symbols and summaries. Picking a result moves the canvas to that item's level and selects it.
- **Live.** `GET /api/live/stream` (SSE). Each MCP tool call pulses the box that contains the touched path at the current level and updates the pill. Throttled.
- **Open in editor.** File panels link to `vscode://file/<absolute path>:<line>`.
- **Look.** The existing dark amethyst theme and starfield stay; the layout is new (the owner explicitly requested a revamp, overriding the "visual design is frozen" note). React Flow remains the renderer, and 50 nodes is well inside its comfort zone. The StrictMode workaround stays.
- **Performance budget.** Click, zoom or level change ≤ 100 ms, measured in the browser on VS Code. The level API takes ≤ 50 ms. Long lists show 20 entries plus "load more".
- **Static demo mode.** A build-time flag switches the data source to JSON exported per level and per path (`scripts/export-demo.ts`). Search uses a lazy-loaded compact index (paths, taglines, summaries). There's no live channel and no Guide. It's hosted on Vercel, and the owner deploys it.

### 7.1 Contract sketch (finalized in `API_CONTRACTS.md` during the UI slice)

```ts
type MapNode = { path: string; name: string; kind: "folder" | "file" | "more";
  fileCount: number; tagline?: string; summaryStatus: SummaryStatus; hiddenCount?: number };
type MapEdge = { source: string; target: string; count: number };
type LevelResponse = { repo: string; path: string; breadcrumb: string[];
  nodes: MapNode[]; edges: MapEdge[]; hiddenCount: number; indexVersion: number };
type DescribeResponse = { path: string; kind: "repo" | "folder" | "file"; tagline?: string;
  summary?: string; summaryStatus: SummaryStatus; stats: { fileCount: number; lineCount: number };
  children?: MapNode[]; symbols?: { name: string; kind: string; startLine: number; endLine: number }[];
  uses: { path: string; count: number }[]; usedBy: { path: string; count: number }[]; stalePaths: number };
type IndexStatus = { repo: string; stages: Record<StageName, { state: StageState; done: number; total: number; note?: string }> };
type LiveEvent = { tool: string; paths: string[]; at: string };
```

**v1 endpoints:**

| Endpoint | Notes |
|---|---|
| `GET /api/level?path=` | |
| `GET /api/describe?path=` | |
| `GET /api/search?q=` | existing route, repurposed |
| `GET /api/status` | replaces `/api/health` |
| `POST /api/index` | existing SSE route |
| `POST /api/summarize?path=` | on-demand summary, jumps the queue |
| `GET /api/live/stream` | SSE |
| `POST /api/live` | localhost only |

`GET /api/graph` is retired. The active repo comes from `.nebulosity/config.json` (`activeRepo`), with a picker when more than one repo is indexed.

---

## 8. The live channel

An MCP tool handler fires a request at `POST http://127.0.0.1:<port>/api/live` with `{ tool, paths, at }`, a 200 ms timeout, and errors ignored. If the Map isn't running, nothing happens. The server fans the event out over SSE to open Map tabs. `show_on_map` reuses the `UIAction` contract (ADR-008): `highlight_nodes`, `focus_node`, `clear_highlights`. The port comes from config.

---

## 9. Evaluation (v1)

- **Repo:** VS Code at `cc3fec88`, pinned.
- **Questions:** about 15, in three families: big-picture (5), complete-list (5), connection (5). The owner reviews them before any run.
- **Ground truth independent of Nebulosity's index**, so the eval isn't circular:
  - complete-list: `git grep` over import statements, then manual verification
  - connection: a manual trace
  - big-picture: a rubric built from VS Code's own "Source Code Organization" wiki page
- **Conditions:** Claude Code headless (`claude -p --output-format json`) with the same pinned model, with and without the Nebulosity MCP config. Two runs each if usage limits allow.
- **Metrics:** correctness (rubric score or recall %), input and output tokens, tool calls, wall time.
- **Output:** `docs/EVAL_RESULTS.md` plus a README table; raw transcripts in `eval/runs/`. **Losses are reported, not hidden.**

---

## 10. Extras, in order (design level; each gets its own plan)

**E1 — The Guide (LangGraph).**
- Orchestration follows `LANGGRAPH_DESIGN.md`, which is still valid: state, ReAct loop, `MemorySaver`, the SSE event translation, and `/api/chat` per `API_CONTRACTS.md` §5.
- Tools are the registry plus UI tools: `focus`, `highlight`, `set_lens`, `open_call_flow`.
- The system prompt is updated from `AI_AGENT_DESIGN.md` Appendix A for map-first navigation.
- The owner picks the model at E1 kickoff (ADR-009 predates the current model lineup).
- It runs on the user's own API key, and it is never in the hosted demo.

**E2 — Call graph.**
- The TypeScript type checker (`ts.createProgram` per tsconfig project) resolves call expressions to declarations. That includes dependency-injected services, resolved from interface types to their `implements` classes, labeled `typed`. A name-based heuristic is the fallback, labeled `heuristic`.
- **Measure first:** type-checking all of VS Code may take several GB. The fallbacks are per-project programs or heuristic only.
- Tools: `callers`, `callees`, `call_flow`. UI: a call-flow view (callers ← function → callees, one hop at a time, expandable, ≤ 50 boxes).

**E3 — Git-history overlays.**
- Needs full history (`git fetch --unshallow`, about 1.5 GB). The owner approves that at kickoff.
- One pass of `git log --numstat` fills `file_history` and `co_changes`, skipping commits that touch more than 50 files and requiring a minimum co-change support of 5.
- The History lens colors boxes by churn percentile. Hidden coupling (co-change without an import) appears as dashed edges. The panel shows owners and the first commit ("why does this exist").
- Tools: `history`, `hotspots`, `coupling`. Updates are incremental from `lastHistoryCommit`.

**E4 — tree-sitter.**
- `web-tree-sitter` (WASM, which avoids the Windows native-build pain cited in ADR-004) plugs in behind the language adapter interface.
- Python and Go come first, with per-language query files for definitions, imports and calls, and per-language import resolution.
- TypeScript stays on the compiler API for precision.

**E5 — Clustering.**
- Louvain (`graphology-communities-louvain`) runs on the undirected, weighted file graph, adding co-change weights when E3 exists.
- Clusters are summarized with Sonnet 5.5 and named. The Clusters lens regroups the boxes, and a folder-vs-cluster "drift" view shows where they disagree.
- PageRank replaces degree as the importance measure (ADR-010's revisit trigger). Tool: `clusters`.

---

## 11. Testing strategy

- **Expectation rule (CLAUDE.md).** Test expectations come from the fixture's design, derived by hand, never by running the implementation.
- **Unit tests (Vitest):**
  - resolver cases
  - LCA aggregation
  - folding at the cap
  - BFS `dependents`/`path`
  - RRF
  - staleness propagation
  - batched writes beyond 32,766 parameters (regression for the measured bug)
  - `inputHash` invalidation
  - freshness notes
- **Fixture repo.** `test/fixtures/mini-repo/` has about 30 files over three levels with a known import graph, excluded from `tsconfig`. End-to-end indexing runs on an in-memory database with a **stubbed summarizer**, so tests make no network calls.
- **Existing tests.** Kept where behavior is unchanged. The regex-scanner golden vectors (`GRAPH_IMPLEMENTATION_REVIEW.md` PART 3 §3.4) retire with the regex extractor, and that retirement is recorded in the review doc.
- **Benchmark.** `scripts/bench-index.ts` on VS Code records per-stage timings against S1, S3 and S6.
- **UI performance.** Click-to-render time measured in the browser on VS Code with the Performance API, and recorded.
- **MCP smoke test.** `claude -p` exercises every tool once.
- **Gate for every task:** `npx tsc --noEmit && npm run lint && npx vitest run`, all clean.

---

## 12. Delivery plan

Each v1 slice ends demoable:

| Slice | Contents |
|---|---|
| V1.1 Engine foundation | `NEBULOSITY_HOME` paths, repo config, discovery, TS adapter (AST imports + class members), resolver, batched store, `folders` + `level_edges`, `npm run index`, benchmark on VS Code |
| V1.2 Understanding | tiered summaries (Batch + on-demand), summary embeddings, FTS indexes, hybrid search with RRF, `/api/status` |
| V1.3 Map | level/describe/search APIs, new Map UI (levels, panel, ⌘K, status pill), live channel |
| V1.4 MCP | tool registry, `mcp/server.ts`, `claude mcp add` instructions, smoke test |
| V1.5 Ship | static export + hosted demo, eval, README, demo-video script |

**Target:** v1 by **2026-10-18** (end of reading week), with a slip budget of 2–4 days. The extras follow in order E1 → E5 over about 1–2 weeks, and each one updates the live demo and README. Context: Shopify applications open around late October or early November 2026.

---

## 13. Working mode for this sprint

**Build-first**, by owner decision on 2026-10-10:
- Claude implements and verifies by running things: `tsc`, lint, tests, benchmarks, the browser.
- The owner reviews demos, makes the product calls, records the video, and deploys.
- Learning comes after shipping. The owner writes a detailed public explainer, and lessons or quizzes happen on request.
- This overrides CLAUDE.md's default "coach, don't write" for the duration of the sprint. Coaching resumes when the owner asks for it.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Max 5x usage limits | slices sized to finish in a session; eval run count adjustable |
| Batch turnaround (up to 24 h) | progressive UI, on-demand summaries for whatever is opened |
| Summary quality | day-1 side-by-side of Haiku vs Sonnet on 20 files, reviewed by the owner |
| E2 type-check memory on VS Code | measure before building; per-project or heuristic fallback |
| Windows path separators | forward-slash normalization at every boundary (existing convention) |
| Target repo inside the project dir would be swept into `tsc` | target repos live outside the Nebulosity checkout (VS Code is at `../vscode`) |
| Public-repo hygiene | `CLAUDE.md` is gitignored (verified) and never published. The Phase 2–4 provenance story *does* appear in tracked docs (`IMPLEMENTATION_ROADMAP.md`, `RAG_IMPLEMENTATION_REVIEW.md`, `BUGS_ENCOUNTERED.md`), so the owner reviews `docs/` before release |
| API cost creep | `inputHash` caching, test files templated, input caps, lazy folder refresh |

---

## 15. Decisions recorded with this spec

`ENGINEERING_DECISIONS.md`:

| ADR | Decision |
|---|---|
| ADR-024 | Pivot to a code-intelligence companion for massive codebases; reverses the Tier XL product boundary |
| ADR-025 | Drop the native C++ scanner (supersedes ADR-014/015) |
| ADR-026 | TypeScript Compiler API behind a language-adapter seam; AST imports retire the regex extractor; tree-sitter in E4 |
| ADR-027 | Retrieval backbone: summaries + FTS5 + graph; embeddings over summaries only; RRF fusion |
| ADR-028 | Tiered summaries (Haiku 5.5 files, Sonnet 5.5 folders), Batch for the first pass, lazy folder refresh |
| ADR-029 | The Map: levels, lenses and on-demand panels, with a 50-box cap; aggregated `level_edges` |
| ADR-030 | One tool registry, two adapters (MCP for external agents, in-process for the Guide); install-relative paths |

## 16. Doc migration

This spec wins wherever it conflicts with an older doc. Superseded docs carry a one-line banner pointing here. Each slice rewrites the docs it touches (`ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_CONTRACTS.md`, `RAG_PIPELINE.md`, `VISUALIZATION_DESIGN.md`, `AI_AGENT_DESIGN.md`) in the same change set, per the maintenance rule. `LEARNING_NOTES.md` and `BUGS_ENCOUNTERED.md` stay the owner's.
