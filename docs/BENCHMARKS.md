# BENCHMARKS.md — Measured Performance

Every number here was measured, not estimated. Each entry records the machine, the
target and the exact command, so it can be re-run.

## 2026 10 11 Index Benchmark #1 — V1.1 structure stage on VS Code

- **Target:** `microsoft/vscode` @ `cc3fec88` (shallow clone at `../vscode`)
- **Machine:** the owner's Windows 11 laptop
- **Command:** `npm run index -- ../vscode` (single-threaded, batches of 500 files)

| Run | Files | Changed | Edges | Folders | Level edges | discover | parse | write | resolve | aggregate | **total** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cold | 14844 | 14844 | 139580 | 3793 | 19345 | 0.9 s | 20.2 s | 13.1 s | 2.0 s | 0.8 s | **37.0 s** |
| warm (no changes) | 14844 | 0 | 139580 | 3793 | 19345 | 0.8 s | 1.3 s | 0.0 s | 2.0 s | 0.7 s | **4.8 s** |

**S1 (≤ 60 s): PASS.** Compare with the pre-pivot baseline from 2026-10-10
(`PIVOT_SPEC.md` §1): read 2.4 s + parse/chunk 22.3 s + import scan 4.6 s.

Also measured on these runs: 0 file errors, and 5 files skipped as larger than 1 MB. The
database file is 242 MB afterwards. On the warm run, discover plus read-and-hash (the
`parse` column) take 2.1 s, and re-resolving every import plus rebuilding the aggregates
take 2.7 s. That fixed cost is what S6 (≤ 2 s from saving one file, measured in V1.3)
has to get under.

## 2026 10 11 Index Benchmark #2 — structure stage with the code search index

- **Target, machine:** as in #1 (VS Code @ `cc3fec88`, the owner's laptop)
- **Command:** `npm run index -- ../vscode`, three runs that differ in the starting state. The chunk triggers fill `code_fts` as chunks are written (ADR-031).
  - **cold (fresh database):** `NEBULOSITY_HOME` pointed at a throwaway folder holding only the migrations, so the database started empty and nothing had to be deleted, as in #1's cold row.
  - **full re-parse (existing index, after migration 0004):** run on the owner's real database, where migration 0004 had cleared every content hash, so every file was re-parsed over its old chunks and symbols.
  - **warm (no changes):** the same command again straight after the re-parse, with every hash current.

| Run | Files | Changed | discover | parse | write | resolve | aggregate | **total** | DB size |
|---|---|---|---|---|---|---|---|---|---|
| cold (fresh database) | 14844 | 14844 | 0.6 s | 25.1 s | 27.4 s | 2.4 s | 0.9 s | **56.4 s** | 446 MB |
| full re-parse (existing index, after migration 0004) | 14844 | 14844 | 0.9 s | 26.0 s | 32.9 s | 2.5 s | 1.0 s | **63.3 s** | 447 MB |
| warm (no changes) | 14844 | 0 | 0.7 s | 1.2 s | 0.0 s | 2.1 s | 0.9 s | **4.9 s** | 447 MB |

**S1 (≤ 60 s), judged on the cold row: PASS (56.4 s).** The FTS inserts land in the write column: 27.4 s cold, against #1's 13.1 s.

The re-parse row is slower than the cold row (write 32.9 s against 27.4 s) because it deletes every old chunk and symbol before re-inserting them, which a fresh database never does. Parse runs no search-index code, yet it took 25.1 s cold and 26.0 s on the re-parse against #1's 20.2 s, and no parse-path change since #1 could cost seconds, so that gap points at machine variance between sessions, not the index.

## 2026 10 12 Summary Benchmark #1 — full summary pass on VS Code

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop.
- **Command:** `npm run summarize -- ../vscode`. The transport is chosen per wave: the Batch API for 100+ requests, the regular API below that (ADR-033). The spend cap is $15 (ADR-035).
- **Models:** files `claude-haiku-5-5`; folders and the repo `claude-sonnet-5-5`. Effort low, prompt version 2 (ADR-034). Test files and test-only folders get templates, with no API call.

| | Files | Folders + repo | Templates | Failed (end) | Waves | Batches | Run time |
|---|---|---|---|---|---|---|---|
| first pass, 4 runs | 10,412 | 2,527 | 5,698 (4,432 test files + 1,266 test-only folders) | 0 | 21 | 11 (8 succeeded, 3 errored) | 31 min (39 min wall, 23:43–00:22) |

**How the pass ran.** It finished in four runs, because the account hit two limits on the way:
1. **Run 1.** All 10,412 files and 514 folders were summarized. Then the credit balance ran out: batches of 1,117 and 143 folders came back fully errored, and the circuit breaker stopped the run.
2. **Run 2.** It resent the 143 folders and the 2 files that the cut-off guard had rejected. It then collected the errored batch of 1,117, which tripped the breaker again.
3. **Run 3.** It collected those 145 and resent the 1,115 remaining folders. That batch errored on the account's $5 monthly limit.
4. **Run 4.** After the limit was raised, it sent those 1,115, then went up the tree to the repo.

Errored batch requests aren't billed. Nothing that succeeded was ever sent twice. A tiny probe batch, unrelated to VS Code, checked access before run 4.

| Model | Transport | Requests | Input tokens | Output tokens | Cost |
|---|---|---|---|---|---|
| claude-haiku-5-5 | batch | 10,414 | 41,506,175 | 2,570,733 | $2.7180 |
| claude-sonnet-5-5 | batch | 2,390 | 3,752,358 | 553,291 | $6.5188 |
| claude-sonnet-5-5 | direct | 137 | 378,504 | 31,067 | $1.0677 |

**S2 (≤ $15): PASS at $10.30.**
- **Folder prompts.** Sonnet's batch folders averaged 1,570 input tokens, more than Review #3's fitted 1,369. That's because templating took away the small test-only folders. The top-level folders that went direct averaged 2,763.
- **Not included:** the checkpoint reviews (#1–#3, about $0.74) and the fixture smoke tests (about $0.03) never reach `summary_usage`.
- **Embeddings:** 12,939 vectors (10,924 in run 1 in about 5 min, then 150 and 1,865).

| Search query | Top-5 expectation | Result | Warm time |
|---|---|---|---|
| `integrated terminal` | something under `src/vs/workbench/contrib/terminal/` | miss. The top 5 are terminal code in `workbench/api/common`, `contrib/externalTerminal` and `platform/terminal`. | 51 ms |
| `editor tabs` | something under `src/vs/workbench/browser/parts/editor/` | pass (rank 1) | 59 ms |
| `extension host` | under `src/vs/workbench/services/extensions/` or `src/vs/workbench/api/` | pass (rank 1) | 85 ms |
| `file watcher` | something under `src/vs/platform/files/` | pass (rank 1) | 81 ms |
| `keybinding resolution` | something under `src/vs/platform/keybinding/` | pass (rank 1) | 42 ms |

**The miss, investigated (2026-10-12):** ranking, not wording and not a bug.
- **The expected folders lead two of the three lists.** `src/vs/workbench/contrib/terminal/` is #1 by summary keywords (its tagline is "Integrated terminal feature core"), and its `browser/` folder is #1 by meaning (cosine 0.539).
- **Folders can never be in the third list.** Code search indexes file chunks only. Reciprocal Rank Fusion rewards appearing in all three lists, so files that sit mid-list in all three (`extHostTerminalShellIntegration.ts`: code #4, in the summary and meaning lists too) outscore folders that lead two. `contrib/terminal/browser/` lands at #10 and `contrib/terminal/` at #11.
- **The folder's own files don't make up for it.** `terminal.contribution.ts` is in the meaning list only (#44); `terminalInstance.ts` is code #17 and meaning #79.
- **Deferred to V1.5**, whose eval brings the query set a ranking change needs (for example, scoring folders over the two lists they can appear in, or giving a folder its files' best code rank). One query is too few to tune RRF against. A related case from building V1.3's search route: `lifecycle` ranks `src/vs/base/common/lifecycle.ts` 6th, behind five other files about lifecycles.

## 2026 10 12 Map Benchmark #1 — levels, panels and zoom on VS Code (S3, S4)

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, every summary written (Summary Benchmark #1).
- **Server side** (`npm run bench-map -- ../vscode`, in process, no HTTP):

| Call | Calls | p50 | p95 | max |
|---|---|---|---|---|
| `level()`, every folder, warm | 3,793 | 0.6 ms | 1.1 ms | 14.3 ms |
| `describe()`, every folder, first time each | 3,793 | 1.2 ms | 2.2 ms | 32.8 ms |
| `describe()`, ~500 files, first time each | 512 | 1.4 ms | 2.2 ms | 5.0 ms |

The first `describe()` loads the import graph: 101 ms, once per index version. **Most boxes on any level: 50 (S4 ≤ 50: PASS).**

- **In the browser** (`window.__nebulosityPerf`, marked at the interaction and measured after the frame that painted it). The desktop app's browser pane wasn't available to this session, so headless Chrome was driven over the DevTools protocol instead: 15 level changes (root → `src` → `vs` → `workbench` → `contrib` → `chat`, back up with Backspace, `src/vs/platform`, `src/vs/editor`, `common`), after one warm-up pass, and 10 clicks on folders and files. Production build (`next build`, `next start`):

| Interaction | n | p50 | p95 | max |
|---|---|---|---|---|
| level change (`map:level`) | 15 | 29.6 ms | 66.3 ms | 66.3 ms |
| click → panel with data (`map:select`) | 10 | 31.6 ms | 37.1 ms | 37.1 ms |
| zoom (frame interval during 20 wheel steps) | 60 | 6.9 ms | 7.1 ms | 7.2 ms |

**S3 (≤ 100 ms per interaction; the level API ≤ 50 ms): PASS** on the production build. The slowest warm interactions are the densest levels (`src/vs/platform`: 50 boxes, 390 lines). The first level after a page load is cold (315 ms) and reported apart.

- **On the dev server** (`next dev`, development React), the same walk measured level changes p50 42 ms, p95 148 ms; clicks p50 83 ms, p95 104 ms; zoom frames p95 35 ms. Only the densest levels go over 100 ms there.
- **What measuring changed.** The first dev-server run had level changes at p95 487 ms. Dagre took 0.5–0.65 s to lay out `src/vs/platform`'s 390 lines, so layouts now use each level's 100 heaviest lines (30–45 ms). It also found that a level served from the Map's cache kept the previous level's viewport. Both are fixed (ADR-036, amended).

## 2026 10 12 Update Benchmark #1 — one saved file to an updated describe (S6)

- **Command:** `npm run bench-update -- ../vscode <file>` against `npm run dev`: the watcher (1 s debounce) → `applyFileChanges` (ADR-037) → `GET /api/describe` showing the new export, polled every 25 ms.

| File | Runs | Each run | Median | Worst |
|---|---|---|---|---|
| `src/vs/base/common/strings.ts` | 5 | 1,144, 1,203, 1,193, 1,194, 1,185 ms | 1,193 ms | 1,203 ms |
| `src/vs/editor/common/model/textModel.ts` | 5 | 1,206, 1,218, 1,146, 1,228, 1,235 ms | 1,218 ms | 1,235 ms |

`applyFileChanges` alone took 115–224 ms per update (the worker's log; Task 10's probe measured 222 ms and 141 ms). **S6 (≤ 2 s): PASS.** About 1 s of each run is the debounce the spec asks for. The summary's stale status follows about a second later, because the worker re-plans the summaries after each update (0.5–0.9 s on VS Code).

## 2026 10 12 Index Benchmark #3 — S1's margin

- **Target and machine:** as in #1 and #2. **Command:** `npm run index -- ../vscode` with `NEBULOSITY_HOME` on a throwaway folder holding only the migrations (a cold database each run), three runs before and three after deferring the code search fill.

| Run | discover | parse | write | resolve | aggregate | **structure (S1)** | code search fill |
|---|---|---|---|---|---|---|---|
| before, 1 | 0.9 s | 33.0 s | 33.7 s | 2.8 s | 1.0 s | **71.5 s** | in write |
| before, 2 | 0.7 s | 32.2 s | 34.1 s | 2.8 s | 1.0 s | **70.9 s** | in write |
| before, 3 | 0.7 s | 31.8 s | 34.0 s | 2.9 s | 1.0 s | **70.5 s** | in write |
| after, 1 | 0.9 s | 31.6 s | 22.0 s | 2.9 s | 1.0 s | **58.5 s** | 7.0 s |
| after, 2 | 0.8 s | 30.8 s | 22.2 s | 2.8 s | 1.0 s | **57.7 s** | 6.8 s |
| after, 3 | 0.8 s | 31.3 s | 22.3 s | 2.8 s | 1.0 s | **58.3 s** | 7.0 s |

**S1 (≤ 60 s): PASS at 58.5 s worst of three**, but without the 10% headroom (≤ 54 s) this task aimed for.
- **Why Part B ran.** Before it, all three runs failed S1 at 70.5–71.5 s.
- **What deferring bought.** Filling code search in one statement after the structure stage took 12–13 s off the stage: the write step fell from 34 s to 22 s, and the fill takes 7 s.
- **Where the margin went.** The machine was about a quarter slower than for #2. The same parse code took 31 s, against 25.1 s then, and a warm run on the owner's database took 6.1 s, against 4.9 s. At #2's speed these totals would be about 47 s.
- **What's left.** Parse is now the biggest step. Parsing in worker threads is the next lever if S1 needs more room.

## 2026 10 12 Map Benchmark #2 — the V1.3.1 Map on VS Code: pages with portals, the `src` panel, S3 and S4

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, every summary written. The UI is V1.3.1's (violet slate, routed lines, pages of related boxes with portals, ADR-041 and ADR-042).
- **The `src` panel, profiled before the fix** (`VISUAL_REFRESH.md` §8 reported about 5 s; ADR-036, amended): the 5 s didn't reproduce.

| Where | `describe("src")` |
|---|---|
| In process | 30–32 ms: stale summaries inside 13 ms, lines inside 8 ms (the area counts come from the in-memory graph) |
| Over HTTP, V1.3 production server | 48–82 ms |
| In the browser, production build | 53–141 ms |
| In the browser, dev server | 233 ms the first time (with the route's compile), 53–95 ms after |

  The answers are now kept per index version, so a repeat is a lookup.
- **Server side** (`npm run bench-map -- ../vscode`, in process, no HTTP, after the page portals):

| Call | Calls | p50 | p95 | max |
|---|---|---|---|---|
| `level()`, every folder, warm | 3,793 | 1.0 ms | 1.8 ms | 11.2 ms |
| `describe()`, every folder, first time each | 3,793 | 1.9 ms | 3.3 ms | 61.1 ms |
| `describe()`, ~500 files, first time each | 512 | 1.7 ms | 2.6 ms | 6.1 ms |
| `describe()`, every folder, repeated (cached per version) | 3,793 | 0.1 ms | 0.2 ms | 4.4 ms |

  The first `describe()` loads the import graph: 94 ms. The machine ran slower than for #1: the old `level()` (V1.3.1 before portals), timed in the same session, gave p50 1.0 ms, p95 1.7 ms and max 14.3 ms, so paging by connection costs nothing measurable. **36 folders are paged (111 pages in all), and the most boxes on any level or page is 50 (S4 ≤ 50: PASS).** S4 is now checked on every page, not just the first.
- **In the browser** (the desktop app's browser pane, visible, on the production build: `next build`, `next start`). The walk ran one warm-up pass, then the measured pass, read from `window.__nebulosityPerf`:
  - **Level changes (18):** root → `src` → `vs` → `workbench` → `contrib` → `chat`, back up with Backspace ×5, then `src` → `vs` → `platform`, a portal double-click to `platform`'s page 2 and ← back, then Backspace, `src/vs/editor` and `common`.
  - **Clicks (10):** the first 10 boxes of `src/vs/editor/common`.
  - **The `src` panel (10):** opened 10 times at the root.
  - **Zoom:** 20 wheel steps (scale 0.76 → 2 → 0.5), timed by the interval between frames.

| Interaction | n | p50 | p95 | max |
|---|---|---|---|---|
| level change (`map:level`) | 18 | 36.5 ms | 87.8 ms | 87.8 ms |
| click → panel with data (`map:select`) | 10 | 32.2 ms | 37.1 ms | 37.1 ms |
| the `src` panel, warm (`map:select`) | 10 | 20.1 ms | 22.2 ms | 22.2 ms |
| zoom (frame interval during 20 wheel steps) | 154 | 6.9 ms | 7.2 ms | 7.8 ms |

**S3 (≤ 100 ms per interaction): PASS** on the production build. **The `src` panel (≤ 300 ms warm): PASS** at 22 ms. The slowest level changes are the dense or paged ones: `src/vs/platform`'s page turns took 65 ms (page 2) and 88 ms (back to page 1, 44 boxes, 2 portals, 441 lines). In the warm-up pass, `platform`'s first draw took 101.6 ms. Frames ran at the display's 144 Hz (6.9 ms) throughout the zoom.
- **After busy levels went quiet** (more than 60 lines draw only the hovered or selected box's lines, ADR-042 amended): the same walk on a fresh production build, with a frame monitor (longest gap between frames over the measured pass: 28 ms, so nothing was throttled). A first attempt was thrown away: the app window had gone behind another window, frames dropped to 1 a second, and panels "took" 1,000 ms.

| Interaction | n | p50 | p95 | max |
|---|---|---|---|---|
| level change (`map:level`) | 18 | 33.7 ms | 62.0 ms | 62.0 ms |
| click → panel with data (`map:select`) | 10 | 19.9 ms | 37.3 ms | 37.3 ms |
| the `src` panel, warm (`map:select`) | 10 | 20.0 ms | 21.2 ms | 21.2 ms |
| zoom (frame interval during 20 wheel steps) | 153 | 6.9 ms | 7.1 ms | 7.3 ms |

  The busy levels drew fastest of all: `src/vs/platform` 46 ms (78.7 before), its page turns 47 ms each way (65 and 88 before), `src/vs/editor/common` 56 ms (70 before). The warm-up pass's slowest level was 68.9 ms (101.6 before). **S3: PASS**, with more room.

## 2026 10 13 Map Benchmark #3 — S3 after the two outside critiques: the tighter layout, the readable opening size, the divider

- **Why again:** since #2 the layout tightened (56 px boxes, 8 a row on wide canvases), levels open at a readable size and then as wide as the canvas allows, the side page arrows went, and a divider sits over the unlinked boxes (ADR-042, amended twice on 2026-10-13). Each changes what a level change draws.
- **Target and machine:** VS Code @ `cc3fec88`, the owner's laptop, a fresh production build (`next build`, `next start`).
- **How:** the same walk as #2 (18 level changes, 10 clicks, the `src` panel 10 times, 20 wheel zoom steps; a warm-up pass, then the measured pass), in headless Chrome over the DevTools protocol rather than the app's browser pane, so frames never stall behind another window. A frame monitor ran alongside: the longest gap between frames was 42 ms at 1907 × 998 and 28 ms at 1440 × 900, so nothing was throttled.

| Interaction | 1907 × 998: n | p50 | p95 | max | 1440 × 900: n | p50 | p95 | max |
|---|---|---|---|---|---|---|---|---|
| level change (`map:level`) | 18 | 33.5 ms | 55.4 ms | 55.4 ms | 18 | 29.2 ms | 53.8 ms | 53.8 ms |
| click → panel with data (`map:select`) | 10 | 20.1 ms | 22.9 ms | 22.9 ms | 10 | 19.8 ms | 21.9 ms | 21.9 ms |
| the `src` panel, warm (`map:select`) | 10 | 18.0 ms | 21.3 ms | 21.3 ms | 10 | 15.6 ms | 20.1 ms | 20.1 ms |
| zoom (frame interval during 20 wheel steps) | 151 | 6.9 ms | 7.1 ms | 7.3 ms | 152 | 6.9 ms | 7.2 ms | 8.0 ms |

**S3 (≤ 100 ms per interaction): PASS** at both sizes, with the slowest level change at 55 ms (62 ms in #2). **The `src` panel (≤ 300 ms warm): PASS** at 21 ms. The script itself had a bug carried over from #2's first run (3 Backspaces from a folder 4 deep, so it looked for `src` inside `src`); fixed before these numbers.

## 2026 10 13 Map Benchmark #4 — S3 after the deferred minors

- **Why again:** the fixes after PR #4 touch every interaction S3 times: level changes go through the new address-bar rule, clicks through the shown selection, and hovers now redraw only what they change.
- **How:** #3's walk, unchanged, on a fresh production build, headless Chrome at 1907 × 998, three runs.

| Run | level change p50 / p95 | click p50 / p95 | the `src` panel p50 / p95 | zoom p50 / p95 | longest frame gap |
|---|---|---|---|---|---|
| 1 | 34.5 / 62.0 ms | 21.6 / 78.4 ms | 20.2 / 22.8 ms | 6.9 / 7.1 ms | 76.5 ms |
| 2 | 34.5 / 63.4 ms | 20.3 / 22.1 ms | 20.3 / 61.7 ms | 6.9 / 7.3 ms | 55.6 ms |
| 3 | 34.4 / 62.1 ms | 20.5 / 24.1 ms | 20.2 / 21.4 ms | 6.9 / 7.1 ms | 55.7 ms |

**S3 (≤ 100 ms): PASS** in every run. With 10 clicks, p95 is the slowest one: run 1's 78 ms click and run 2's 62 ms panel were single outliers that didn't repeat, beside a frame gap of the same size, so the machine paused rather than the Map. Level changes sit at #2's 62 ms (#3 measured 55 ms in another session).
- **A hover on the busiest view** (`src/vs/platform` page 1, all 441 lines shown, 40 hovers, mouseover until the frame after it paints): p50 46–47 → 40–41 ms, p95 54 → 45–48 ms, from redrawing only the boxes and lines a hover changes.

## 2026 10 13 MCP Benchmark #1 — tool latency through the MCP server on VS Code (S5)

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, every summary written (Summary Benchmark #1: structure, summaries and embeddings all `ready`, index version 129, 12,939 vectors). The Map's server was up (the owner's dev server on port 3000, which owned the database; the bench only reads).
- **Command:** `npm run bench-mcp -- ../vscode`. The MCP SDK's stdio client starts `node mcp/launch.mjs` in VS Code's folder with `NEBULOSITY_LIVE=off` and times each call from request to answer. The inputs are fixed (`scripts/bench-mcp.ts`). Each tool's first call is reported apart; 20 warm calls follow.
- **Server start** (spawn → initialized): 683 ms. Seven more starts, timed the same way by hand: 658–803 ms, median 732 ms.
- **Where the figures come from:** the table and the start of 683 ms are `npm run bench-mcp`'s output. The in-process figures below (the reach index's size and times, `setupCall`'s timing) and the seven hand-timed starts came from scratch scripts that aren't committed, not from `npm run bench-mcp`.

| Tool | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 336 ms | 20 | 55 ms | 57 ms | 66 ms | 2,195 |
| `describe` | 58 ms | 20 | 46 ms | 62 ms | 66 ms | 3,403 |
| `search` | 1676 ms | 20 | 170 ms | 256 ms | 261 ms | 2,467 |
| `dependents` | 75 ms | 20 | 62 ms | 67 ms | 70 ms | 3,811 |
| `dependencies` | 61 ms | 20 | 68 ms | 80 ms | 89 ms | 2,491 |
| `path` | 75 ms | 20 | 67 ms | 77 ms | 83 ms | 323 |
| `show_on_map` | 66 ms | 20 | 64 ms | 78 ms | 79 ms | 167 |

**S5 (every warm call ≤ 500 ms): PASS (worst 261 ms, a `search`).** The first `search` (1,676 ms) loads the MiniLM model inside the server; the first `overview` (336 ms) loads the import graph and builds the reach index, which every later tool shares, so `describe`, `dependents`, `dependencies` and `path` show no cold cost because `overview` is the first call of the run. At these inputs' default limits every answer is far under 40,000 characters (largest 3,811); that is a measurement, not a bound. The `show_on_map` row ran with live events off; with a Map open the call also waits for its POST, at most 200 ms more (79 + 200 < 500), so S5 holds there too. The model's only output was one line on stderr (`[embed] loading Xenova/all-MiniLM-L6-v2…`); stdout carried protocol messages only, and the run had no transport error.
- **Where a warm call's time goes:** the floor is a p50 of 46–68 ms even for a 167-character answer. About 38 ms of it is `setupCall`, which every call runs (measured in-process: min 37.4, median 38.8, max 44.8 ms over 20 calls): its `readIndexStatus` counts embedded and embeddable rows (about 19 ms each on the 12,939-vector index), and the rest of the setup (config, repo list, stages, version) takes under a millisecond.
- **The reach index** (ADR-045, in-process): graph load plus index build 75.5 ms cold (the build alone about 3 ms), then free; 139,580 imports in each direction; the five typed arrays total 1,294,776 bytes (1.29 MB); one `reach` of `src/vs/base/common/lifecycle.ts` for dependents (8,549 files) takes a median 1.7 ms (max 6.7 ms) warm.

## 2026 10 13 MCP Smoke Test #1 — every tool once through claude -p (V1.4)

- **Command:** `claude -p` from `../vscode` on Sonnet (`--model sonnet`; the transcript's init line names `claude-sonnet-5-5`), with only Nebulosity's server (`--strict-mcp-config`, live events off through `NEBULOSITY_LIVE=off`), no built-in tools (`--tools ""`, `ENABLE_TOOL_SEARCH=false`), and `--allowedTools mcp__nebulosity`. The prompt asks for each of the seven tools once, in order, then for seven lines saying OK or the error. The config, the prompt, the command and the checker are in the plan's Task 10, Steps 3–4 (`docs/plans/2026-10-13-v1-4-mcp.md`).
- **Claude Code** 2.1.296; registered with `claude mcp add --scope local` from `../vscode`. `claude mcp get nebulosity` and `claude mcp list` both showed it connected, and the run's init line showed the server connected with exactly the seven `mcp__nebulosity__*` tools offered.

| Tool | Called | Result |
|---|---|---|
| `overview` | yes | ok |
| `describe` | yes | ok |
| `search` | yes | ok |
| `dependents` | yes | ok |
| `dependencies` | yes | ok |
| `path` | yes | ok |
| `show_on_map` | yes | ok (live off: no event sent) |

`show_on_map` answered that nothing was sent to the Map because live events were off (`NEBULOSITY_LIVE=off`), as intended for this run; it is the tool's no-Map answer, not an error.

The model issued all seven calls in one parallel batch, then wrote one reply, so the server answered seven concurrent calls on one stdio connection (the MiniLM load included). "ok" means the server returned no error; the answers weren't graded. "8 turns" is Claude Code's `num_turns` for the run. The token and cost figures include the owner's own plugins, skills and hooks in the prompt, so $0.05 isn't Nebulosity's cost alone.

8 turns; token usage as the run's result reported it: input 4, cache creation 10,596, cache read 6,221, output 748; wall time 6.2 s; Claude Code's estimate $0.05 (0.0504941). Runs used: 1 of the 1–2 the owner approved (no retry needed). No live run: the owner declined it.

## 2026 10 14 Search Benchmark #2 — the V1.5 tuning set

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, every summary written (Summary Benchmark #1: structure, summaries and embeddings all `ready`). The Map's server stayed up on port 3000; the benchmark only reads the database.
- **Command:** `npm run bench-search -- ../vscode` (`scripts/bench-search.ts`, queries in `scripts/bench-search-queries.json`). It runs the real engine, the meaning list included, asks for the top 10 and records where the first acceptable result lands. A folder target (ending in `/`) accepts itself or anything inside it. The tables are hit@1/3/5 and MRR@10 (mean of 1/rank, 0 outside the top 10) per group.
- **How the expectations were set:** by hand, from VS Code's tree at `cc3fec88` (every one of the 32 distinct expected paths checked with `git ls-files`), in the commit that added the set (`9421fdc`), before any search change was measured; the file has not changed since. None names a file or folder the eval scores. Two names queries, `registerSingleton` and `createDecorator`, are words BP3's rubric asks answers to name (ADR-052). The set has 10 names queries (identifiers and file words), 12 features queries (the five of V1.2's checks plus seven more) and 10 questions in plain language.
- **Three runs, one engine each:**
  - **before:** `9421fdc`, search as V1.3.1 left it (code, summary, meaning and folder-name lists);
  - **after C1:** `70cdfff`, a fifth list of file names and exported declaration names, weight 2 (ADR-052);
  - **after C2:** `6ed73db`, tests damped to half their score unless the query asks for them, and declaration snippets. A last run at `acf3d9f`, the engine as it freezes for the eval, is byte-identical to this one.
- **A caution about the set.** The changes were designed after a planning probe on a few of these queries (`lifecycle`, `Disposable`, `registerSingleton`, `terminal`), and the same 32 queries judge them. There is no held-out set, and one query is 0.1 of a 10-query group's hit rate. Read the table as "did the changes do what they were for", not as a forecast of a new repo.

**Before** (`search-before`):

| Group | Queries | hit@1 | hit@3 | hit@5 | MRR@10 |
|---|---|---|---|---|---|
| names | 10 | 0.30 | 0.50 | 0.70 | 0.451 |
| features | 12 | 0.42 | 0.83 | 1.00 | 0.653 |
| questions | 10 | 0.70 | 0.90 | 0.90 | 0.783 |
| all | 32 | 0.47 | 0.75 | 0.88 | 0.630 |

**After C1** (the file-name list):

| Group | Queries | hit@1 | hit@3 | hit@5 | MRR@10 |
|---|---|---|---|---|---|
| names | 10 | 0.50 | 0.90 | 1.00 | 0.687 |
| features | 12 | 0.75 | 0.83 | 1.00 | 0.833 |
| questions | 10 | 0.60 | 0.90 | 1.00 | 0.742 |
| all | 32 | 0.63 | 0.88 | 1.00 | 0.759 |

**After C2** (tests damped, declaration snippets): the same numbers as C1, digit for digit, and the same top 3 for all 32 queries.

| Group | Queries | hit@1 | hit@3 | hit@5 | MRR@10 |
|---|---|---|---|---|---|
| names | 10 | 0.50 | 0.90 | 1.00 | 0.687 |
| features | 12 | 0.75 | 0.83 | 1.00 | 0.833 |
| questions | 10 | 0.60 | 0.90 | 1.00 | 0.742 |
| all | 32 | 0.63 | 0.88 | 1.00 | 0.759 |

**V1.2's five checks** (each must stay in the top 5; rank of the first acceptable result):

| Query | Before | After C1 | After C2 |
|---|---|---|---|
| integrated terminal | 2 | 2 | 2 |
| editor tabs | 4 | 4 | 4 |
| extension host | 1 | 1 | 1 |
| file watcher | 2 | 1 | 1 |
| keybinding resolution | 1 | 1 | 1 |

All five held. Overall: hit@5 0.88 → 1.00, MRR 0.630 → 0.759, names hit@1 0.30 → 0.50, names MRR 0.451 → 0.687, features hit@1 0.42 → 0.75.

**What got worse.** The questions group's hit@1 fell from 0.70 to 0.60 and its MRR from 0.783 to 0.742, and the features query `diff editor` fell from 2 to 4. The group's hit@5 did rise, from 0.90 to 1.00, because the Electron main process question came back from outside the top 10. Four queries lost a place or two:
- `where are editor tabs rendered` 2 → 3, `where is the color theme applied` 1 → 2, `how are settings read and written` 3 → 4, and `diff editor` 2 → 4.
- The cause is the same each time. A common query word equal to a file's name now takes the file list's weight of 2: `where are editor tabs rendered` leads with `src/vs/workbench/browser/editor.ts`, `diff editor` has `src/vs/workbench/common/editor.ts` second, the color theme question leads with `src/vs/workbench/common/theme.ts`, and the settings question has a generated `Settings.ts` second. The first result at or inside the folder the query wanted (`parts/editor/`, `widget/diffEditor/`, `services/themes/`, `platform/configuration/`) moves down a place or two behind them.
- The weight stays 2, as the folder list's is, and nothing was tuned to win these back. The names group's gain is the other side of the same rule.

**Every query whose rank moved** (rank of the first acceptable result; 16 of 32 moved, the other 16 did not):

| Query | Before | After C1 | After C2 |
|---|---|---|---|
| `lifecycle` | 9 | 3 | 3 |
| `Disposable` | 9 | 2 | 2 |
| `registerSingleton` | 2 | 1 | 1 |
| `URI` | 4 | 2 | 2 |
| `Emitter` | 5 | 3 | 3 |
| `Range` | outside the top 10 | 5 | 5 |
| `IConfigurationService` | 3 | 1 | 1 |
| `file watcher` | 2 | 1 | 1 |
| `quick pick` | 4 | 1 | 1 |
| `telemetry` | 3 | 1 | 1 |
| `git extension` | 2 | 1 | 1 |
| `how does the desktop app start in the electron main process` | outside the top 10 | 3 | 3 |
| `diff editor` | 2 | 4 | 4 |
| `where are editor tabs rendered` | 2 | 3 | 3 |
| `where is the color theme applied` | 1 | 2 | 2 |
| `how are settings read and written` | 3 | 4 | 4 |

Before the changes, two queries were outside the top 10: `Range` and the Electron main process question. After them, none is: all 32 first expected results are in the top 5.

**What C2 and C3 did and did not change.**
- **C2 (tests damped) and C3 (snippets) do not move this set's numbers.** No query asks for tests, and none of the 32 top-3 lists contained a path in a `test/` directory or a `.test.` or `.spec.` file. Snippets change what a hit shows, not its rank. So the set cannot show either change; its evidence is elsewhere.
- **C2's evidence is `terminal`,** the query that motivated it. In V1.5's planning probe a smoke-test folder (`test/smoke/src/areas/terminal`) was second. After C1 the top 3 were `test/automation/src/terminal.ts` (a test helper), `src/vs/workbench/contrib/terminal/common/terminal.ts` and `src/vs/workbench/contrib/terminal`. After C2 they are `contrib/terminal/common/terminal.ts`, `contrib/terminal` and `contrib/terminal/common/remote/terminal.ts`: no test file or test folder in the top 10. A query that asks for tests still finds them: `terminal smoke test` leads with `test/smoke/src/areas/terminal/terminal.test.ts`. VS Code has 4,432 test files of 14,844 and 1,266 test-only folders.
- **Fixture folders are not test targets,** so they are not damped. `Disposable` still leads with a Copilot fixture's `disposable.ts` (`extensions/copilot/.../fixtures/context/testbed/src/disposable.ts`), and `URI` and `Emitter` still show a chat-simulation fixture in their top 3 (`scripts/chat-simulation/fixtures/_chatperf_uri.ts`, `_chatperf_event.ts`). Copilot's copy of `uri.ts` (`extensions/copilot/src/util/vs/base/common/uri.ts`) still ranks above the core `uri.ts` for `URI`, and for `Emitter` the core `event.ts` is third, behind another Copilot `event.ts` and that fixture.
- **C3 (snippets),** checked by eye in Task 6 on `lifecycle`, `registerSingleton`, `editor tabs`, `file watcher` and `Disposable`: they now show declarations (for example `ILifecycleService`, `registerSingleton`); where only a file's imports listing matched, the snippet reads "imports and exports". In that sample 8 of 39 snippets were still listings.

**What the file-name list costs.** Its facts (every file's name and importer count, every top-level exported declaration, the test file and test-only folder sets) are read once per index version and cached. Timed with a scratch script that is not committed, read only, the same calls the engine makes on a cache miss, three loads in each of two fresh processes:
- **first load: 181–204 ms in the first timing, up to 227 ms in a re-run, so about 190–230 ms,** on VS Code (14,844 files, 44,620 declarations): `loadFileFacts` 101–124 ms, the declarations 65–71 ms, the test sets 9–13 ms. It happens again after every index-version bump, summary-only bumps included, because the cache is keyed to the version (ADR-036).
- **ranking over the cached facts: 6–19 ms per search** (about 7–8 ms typically, over 20 queries), every search.
- A whole `search()` with the embedding model switched off took 354–364 ms the first time in a fresh process and 45–60 ms for the next four queries. That first-search difference is the facts (about 190–230 ms) plus the vector index and cold statements; the part beyond the facts wasn't separated.

## 2026 10 14 MCP Benchmark #2 — S5 after search tuning, and right after a write

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, every summary written, the engine as frozen for the eval (`acf3d9f` plus this commit's bench and docs only). The Map's server was up on port 3000 with its background worker; the bench reads, apart from the one warm index run below.
- **Command:** `npm run bench-mcp -- ../vscode --after-write`. The first table is MCP Benchmark #1's, unchanged: the SDK's stdio client starts `node mcp/launch.mjs` in VS Code's folder with `NEBULOSITY_LIVE=off`, times each call from request to answer, reports each tool's first call apart and then 20 warm calls. `--after-write` then runs `npm run index -- ../vscode` once more (a warm structure run: it edits no file in the repo and calls no API; it writes the config's activeRepo and bumps the index version, ADR-036) and measures the whole table again against the same running server. Each tool's first call there is its first after the write: the import graph, the reach index and the search's name facts rebuild for the new version.
- **Server start** (spawn → initialized): 788 ms (a second run: 838 ms).
- **Where the figures come from:** both tables, the server start and the S5 lines are `npm run bench-mcp -- ../vscode --after-write`'s own output, from the first of two runs; the second run's differences are listed below. The name-facts figures are from Search Benchmark #2's scratch script, not from `npm run bench-mcp`. The index run met no lock and took 13.8 s (5.2 s in the second run). It reported 14,844 files, changed 0.

**Before the write** (the same table as MCP Benchmark #1, measured again after Tasks 5–6):

| Tool | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 303 ms | 20 | 61 ms | 64 ms | 65 ms | 2,195 |
| `describe` | 63 ms | 20 | 51 ms | 61 ms | 66 ms | 3,403 |
| `search` | 1011 ms | 20 | 132 ms | 168 ms | 192 ms | 2,440 |
| `dependents` | 58 ms | 20 | 49 ms | 54 ms | 55 ms | 3,811 |
| `dependencies` | 46 ms | 20 | 48 ms | 52 ms | 52 ms | 2,491 |
| `path` | 54 ms | 20 | 61 ms | 71 ms | 73 ms | 323 |
| `show_on_map` | 57 ms | 20 | 51 ms | 61 ms | 62 ms | 167 |

**S5 (every warm call ≤ 500 ms): PASS (worst 192 ms, a `search`).** MCP Benchmark #1's worst was 261 ms. The first `search` (1,011 ms; #1: 1,676 ms) loads the MiniLM model inside the server. Between the two benchmarks `npm audit fix` moved `onnxruntime-node` from 1.24.3 to 1.30.0 under `@huggingface/transformers` 4.3.1 (V1.5 Task 1); the load took 1,011 ms in the first run and 1,140 ms in the second, against #1's single 1,676 ms, but two runs on a laptop don't show the upgrade made it faster. The warm `search` p50 is 128–132 ms against #1's 170 ms. The fifth list adds 6–19 ms to every search, so the drop isn't the tuning's; I didn't find its cause (a quieter machine and the onnxruntime upgrade are both possible), and the other tools' p50s moved both ways.

**After a write** (a warm `npm run index` between the tables):

| Tool | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 304 ms | 20 | 90 ms | 99 ms | 102 ms | 2,245 |
| `describe` | 90 ms | 20 | 60 ms | 76 ms | 91 ms | 3,403 |
| `search` | 450 ms | 20 | 144 ms | 181 ms | 187 ms | 2,440 |
| `dependents` | 68 ms | 20 | 59 ms | 64 ms | 64 ms | 3,811 |
| `dependencies` | 59 ms | 20 | 54 ms | 62 ms | 62 ms | 2,491 |
| `path` | 53 ms | 20 | 57 ms | 68 ms | 86 ms | 323 |
| `show_on_map` | 57 ms | 20 | 62 ms | 74 ms | 75 ms | 167 |

**S5 after a write (every call ≤ 500 ms, first calls included): PASS (worst 450 ms, the first `search`).** It is informative; the exit code is S5's, which judges the warm calls. Reading it:
- The first `search` after the write took 450 ms against a 128–144 ms warm p50 (second run: 336 ms). About 190–230 ms of the extra is the name facts reloading (above); the rest wasn't separated. The margin to 500 ms is 50 ms in the first run and 164 ms in the second, so this is the one number here that could cross the line on a slower machine.
- The first `overview` after the write took 304 ms (second run: 192 ms), about its first-call cost before the write: the import graph and the reach index rebuild (Benchmark #1: 75.5 ms for the graph and index in process, 336 ms for the first `overview` call).
- The after-write table runs on a server that already has MiniLM loaded. A server that starts right after a write pays both: about 1 s for the first `search`.
- The `overview` answer grew from 2,195 to 2,245 characters because the warm index run re-derived the summaries stage and its line now ends "1 out of date (redone when opened)": one of 18,637 summaries is out of date with its file. The second run's tables start at 2,245.
- A batch of summaries landing in the database also bumps the index version (ADR-036), so while a summary pass runs, a search made after each landing pays the name facts' reload (about 190–230 ms). That wasn't measured as such.

**Second run** (same command; the tables are in the working notes, kept locally and not published): S5 PASS, worst warm 171 ms (a `search`); first `search` 1,140 ms; after a write PASS, worst 336 ms (the first `search`); every other first call after the write was 192 ms or less.

## 2026 10 14 Map Benchmark #5 — S3 on the static demo

- **Why:** the static demo (ADR-049) draws the same Map from exported files. S3's 100 ms limit has to hold there too, and its transport is new: files fetched once and kept in the page, a lookup in the manifest for every folder, and search built in the browser.
- **Target and machine:** VS Code @ `cc3fec88`, the provisional export (7,700 files, 75.5 MB, index version 133; made before the refresh of two summaries, so `test/` still reads "Tests for test"; the final export of 2026-10-14, index version 135, `test/` "Tests for vscode", differs by 37 bytes, and S3 was not re-run on it), built with `npm run build-demo` in a separate worktree at commit `90e12c8`, on the owner's laptop. Other jobs of the same session (reviewers) were running on the machine during the runs.
- **How:** `npm run serve-demo` on 127.0.0.1:3200, headless Chrome (`--headless=new`) at 1907 × 998 over the DevTools protocol, one browser per run. The walk is #2–#4's, unchanged: 18 level changes, 10 clicks, the `src` panel 10 times and 20 wheel zoom steps, a warm-up pass and then the measured pass. Three runs, then three more to see the tail. The files load from loopback, so this measures the Map, not the network. The measured pass is warm: the warm-up pass ran first, so the files the walk needs are already fetched. It does not measure a first visit's fetch latency on a real host; the first-visit figures are the first level and first search below. The harness's "p95" is `sorted[min(n − 1, floor(0.95 × n))]`, which is the last, slowest sample at these sizes (n = 18 level changes, n = 10 clicks, n = 10 `src` panel opens): those three p95s are worst cases. The zoom column has 133–156 frames a run, so its p95 is a true p95 (run 1: 7.3 ms against a 13.8 ms maximum).

| Run | level change p50 / p95 | click p50 / p95 | the `src` panel p50 / p95 | zoom p50 / p95 | longest frame gap |
|---|---|---|---|---|---|
| 1 | 41.4 / 88.3 ms | 20.6 / 21.5 ms | 13.6 / 15.2 ms | 6.9 / 7.3 ms | 83.3 ms |
| 2 | 38.4 / 97.0 ms | 19.3 / 20.8 ms | 13.7 / 16.5 ms | 7.0 / 13.9 ms | 83.3 ms |
| 3 | 35.3 / 82.7 ms | 19.5 / 23.8 ms | 18.6 / 19.4 ms | 7.0 / 13.8 ms | 97.3 ms |
| 4 (extra) | 41.7 / 83.2 ms | 20.5 / 25.9 ms | 13.8 / 20.4 ms | 7.0 / 7.5 ms | 83.3 ms |
| 5 (extra) | 39.2 / 84.6 ms | 20.6 / 26.5 ms | 13.8 / 20.4 ms | 6.9 / 7.3 ms | 83.3 ms |
| 6 (extra) | 41.4 / 89.9 ms | 16.5 / 26.4 ms | 13.4 / 21.3 ms | 7.0 / 7.1 ms | 76.3 ms |

All six runs are published: runs 1–3 are the planned three, and runs 4–6 were added to see the tail. **S3 (≤ 100 ms per interaction): PASS** in all six. In the planned three the slowest level change was 97.0 ms (run 2) and the slowest click 23.8 ms; the three extra runs stayed within 89.9 and 26.5 ms, so over all six the worst level change is 97.0 ms and the worst click 26.5 ms. **The `src` panel (≤ 300 ms warm): PASS** at 21.3 ms at worst. The same level changes are the slow ones in every run: the `contrib` level (77–88 ms), going Back from `chat` (66–86 ms), the `platform` level (step 13, 60–77 ms), its page turns (steps 14–15, 51–71 ms) and `src/vs/editor/common` (69–97 ms).

**The build** (`npm run build-demo`, 22.6 s, exit 0; limits 14,000 files and 95 MB, the host's being 15,000 and 100 MB): its output gives the sizes, and the file counts are of the finished `out/`.

| Folder | Files | Size |
|---|---|---|
| `demo/` (the exported data) | 7,700 | 75.5 MB |
| `_next/` (scripts, styles, fonts) | 32 | 1.2 MB |
| the site's root files (`index.html`, `404.html`, icons, five unused template SVGs) | 15 | 0.1 MB |
| `_not-found/` | 3 | 0.0 MB |
| `out/` | 7,750 | 76.8 MB |

`demo/` holds 3,868 level pages (8.5 MB), 3,793 describe bundles (53.1 MB), 36 page indexes (0.3 MB), `search.json` (13.4 MB), `manifest.json` (0.2 MB) and the repo's license. The build made `/` and no `/api` route, and the leak scan found nothing.

**Load and first search** (headless Chrome at 1907 × 998, a `MutationObserver` for the first drawn box, the Network log for requests). These are the first-visit figures, which the warm walk above doesn't give: the first level at 163 ms and the first search at 1.6 s, both with the files coming from loopback and not from a real host.
- **First level drawn:** 163 ms after navigation on a first load in a fresh browser, 57–62 ms on four repeat loads (cache disabled), and 112–203 ms for a deep link to `src/vs/platform` (46 boxes). The manifest and the root level had both arrived by about 47 ms.
- **First ⌘K search** ("lifecycle", from typing to the first hit drawn, so it includes the palette's 150 ms debounce): 1,616 and 1,633 ms in two runs. `search.json` arrived in 49–52 ms from loopback; the other 1.4 s or so is parsing it, building the index and the query. The palette shows an empty list meanwhile, with no loading sign. A second search ("terminal") took 188–191 ms, the debounce plus about 40 ms. In Node the index builds in 909 ms and each search takes 8–27 ms (8.2 s to build before the posting lists were built in one pass).
- **Requests in the six-check session:** 28, all GETs: the page, `/_next/*`, `/demo/*.json` and the icon. No `/api` request, no `EventSource`, no console message. That is a statement about requests, not about text: the demo's script still holds the HTTP client's `/api/…` strings as dead code (`api.ts` falls back to it, `staticApi ?? serverApi`), and nothing runs them.

Two things to read this with:
- **Level changes are slower here than in #3 and #4, and the gap was not isolated.** The p50 is a few ms higher (35–42 against 33.5 and 34.5 ms). The level p95 is 82.7–97.0 ms here (runs 1–3), against 62 ms in #2, 55 ms in #3 and about 62 ms in #4, and the `platform` level takes 59.6–77.2 ms to open here (step 13) against 46 ms in #2, and its page turns 50.7–70.8 ms (steps 14–15) against 47 ms each way. No run of the server build's walk was made in the same session: it would have opened the owner's database from a second server, so it wasn't run. The machine was also running the port-3000 server, its worker and other jobs of the session. So whether the extra ~30 ms comes from the machine's state, the static transport or the static build is unexplained. What was measured: in run 6 the whole walk (two passes, 36 level changes) fetched 10 `level/*.json` files at a median of 5.3 ms (max 7.6 ms) and 11 describe bundles at a median of 3.7 ms (max 6.2 ms), and most levels came from the Map's own memory, so the fetches are short. The repeated 83 ms gaps between frames fall at the slow steps and show the main thread busy there; #4 saw 76 ms at its worst.
- **One run left 3 ms of margin** (run 2: 97.0 ms against 100). The display runs at 144 Hz (the zoom frame interval's median is 6.9–7.0 ms in every run), so 3 ms is under half a frame. It passes, but a slower machine or a busier moment could push a level change over. The static build's tail is the number to watch if the Map's drawing changes.

## 2026 10 14 Eval #1 — Claude Code with and without Nebulosity's MCP server on VS Code (S7)

This is the evaluation `PIVOT_SPEC.md` §9 asks for. The method, every run's score, what happened per question and the losses are in `docs/EVAL_RESULTS.md`.
- **Target and machine:** VS Code @ `cc3fec88` (`../vscode`), with Nebulosity's engine at `EVAL_ENGINE` (`8d7d485`) and index version 135. It ran on the owner's laptop on 2026-10-14, 17:01–17:47 UTC, with the machine kept quiet.
- **How:** `npm run eval:run -- --pilot`, then `-- --repeat 1` and `-- --repeat 2`: 15 questions, twice each, in three arms, 90 runs in all. A is Claude Code alone. B adds Nebulosity's MCP server at Claude Code's default tool search, and A against B is the headline. U loads Nebulosity's tools up front. Every run used Claude Code 2.1.299 headless, `claude-sonnet-5-5` at medium effort, and read-only tools. `npm run eval:score` scored the runs; the big-picture answers were graded blind (`eval/grading/`).
- **Result:** Nebulosity raised no family's score; it lowered big-picture's (0.82 against 0.91) and, through one run, the complete lists' (0.94 against 0.97). Its tools were used in 12 of 30 B runs, never on a big-picture question. Where they were used, the connection answers cost about a third of A's estimate and time, at the same score. **S7: done.**

| Family | Arm | Score | Precision | Median input (uncached) | Median cache writes | Median cache reads | Median output | Median tokens, all | Median cost est. | Median wall | Median tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Big-picture | A | 0.91 | – | 3 | 1,921 | 30,793 | 1,119 | 32,397 | $0.021 | 13.2 s | 1 |
| Big-picture | B | 0.82 | – | 2 | 2,398 | 21,004 | 1,214 | 22,222 | $0.022 | 13.0 s | 0 |
| Big-picture | U | 0.77 | – | 2 | 2,154 | 34,074 | 1,150 | 35,271 | $0.023 | 12.7 s | 0 |
| Complete-list | A | 0.97 | 1.00 | 7 | 12,237 | 77,696 | 2,692 | 92,645 | $0.082 | 24.6 s | 3.5 |
| Complete-list | B | 0.94 | 1.00 | 6 | 9,455 | 70,777 | 2,572 | 81,696 | $0.067 | 24.5 s | 2.5 |
| Complete-list | U | 0.97 | 1.00 | 8 | 6,694 | 139,752 | 2,406 | 147,720 | $0.062 | 18.9 s | 4 |
| Connection | A | 1.00 | – | 11 | 6,572 | 134,509 | 2,413 | 143,958 | $0.065 | 23.2 s | 7 |
| Connection | B | 1.00 | – | 6 | 2,603 | 62,705 | 405 | 65,150 | $0.020 | 8.4 s | 2 |
| Connection | U | 1.00 | – | 4 | 1,494 | 67,166 | 313 | 69,073 | $0.016 | 7.1 s | 1 |

Each row covers 10 runs. The score is the mean share of rubric points for big-picture, the mean recall for lists, and the mean chain score for connections. The medians are over the same 10 runs, with halves rounded up. Tokens are summed over every model, the cost is Claude Code's own list-price estimate, and the tool calls include ToolSearch. All 90 runs together came to $4.88 by that estimate. A later probe (2026-10-14, V1.6 Task 3) corrected the up-front token figure: most of the 13,000 tokens were Claude Code's own deferred tools, not Nebulosity's (docs/EVAL_RESULTS.md, "The losses").

## 2026 10 14 Typecheck Benchmark #1 — E2's measurement: type-checking VS Code

`npm run measure-typecheck -- ../vscode` (scripts/measure-typecheck.ts) on VS Code at `cc3fec88`, the project `src/tsconfig.json`, Node 24.14.0 with a 16 GB heap cap, on the owner's laptop (31.3 GB of RAM).

| What | Result |
|---|---|
| Root files / source files in the program | 10,237 / 10,326 |
| Building the program | 18.2 s |
| Peak memory (rss) | 5,067 MB |
| Method calls in VS Code's own files | 778,624 |
| Sampled, resolved to a declaration | 1,750 of 2,000, 4.74 ms each |
| …to an interface method (these include the injected services) | 768: one implementing class 114, several 175, none 479 |
| …to a class method / other / unresolved | 880 / 102 / 250 |

**Limits:** `../vscode` has no `node_modules`, so calls into outside types (Node, Electron) don't resolve. "Implementing class" is counted by name from `implements` clauses, which is what a heuristic fallback would see. The 4.74 ms per call is the whole second phase divided by 2,000 calls, so it includes walking all 10,237 files once and the checker's first-use work; the true cost per call is lower.
**What it means for E2:** The program for VS Code's main project built in 18.2 s and peaked at 5.1 GB of memory, well under the 16 GB cap and this machine's 31.3 GB, so a type-checked call graph fits here. A full pass over all 778,624 method calls at 4.74 ms each would take about 3,700 s (about 62 minutes); that is an upper estimate, because the per-call figure includes the one-time walk. Of the 2,000 sampled calls, 768 (38%) resolved to an interface method. Of those 768, 114 (15%) have exactly one implementing class by name, 175 (23%) have several, and 479 (62%) have none we could see. Those 479 are not all injected services: they can be interfaces from TypeScript's lib files (the DOM's, say) or from elsewhere outside VS Code's sources, which no VS Code class implements by name, and the benchmark didn't tell them apart *(wording corrected 2026-10-15, V1.6's final review: this table first called every interface-method call "the injected-service case")*. So a unique-implementer rule would settle about 6% of all sampled calls (114 of 2,000), and calls to interface methods, which include the injected services, would mostly need the type-checker's own answer or stay unresolved. Memory of 5 GB is a heavy cost to ask of a user's machine. The owner decides E2's fate after Eval #2 (ADR-043).

## 2026 10 14 Index Benchmark #4 — the structure stage with V1.6's resolution

- **Targets and machine:** VS Code @ `cc3fec88` and AFFiNE @ `0b69a6da` (repo 2), the owner's laptop, Node 24.14.0.
- **Commands:**
  - S1, cold: `NEBULOSITY_HOME=<scratch folder holding only the migrations> npx tsx scripts/index.ts ../vscode`, three runs with ADR-053 in, and one with the code before it (`0656955`, run from a `git archive` copy) in the same session.
  - The owner's index: `npm run index -- ../vscode`, then `npm run index -- ../affine --no-activate`, then `npm run report-resolution -- <repo>` for each.
  - The lists: a read-only script in the V1.6 ledger that compares `reach()` on the owner's index with Eval #1's `eval/truth/cl1.json` … `cl5.json`.

| Run | Edges | discover | parse | write | resolve | aggregate | **structure (S1)** | code search fill |
|---|---|---|---|---|---|---|---|---|
| before (`0656955`) | 139580 | 0.7 s | 18.2 s | 12.5 s | 1.6 s | 0.5 s | **33.6 s** | 3.7 s |
| after, 1 | 140248 | 0.7 s | 16.0 s | 11.1 s | 2.0 s | 0.6 s | **30.4 s** | 3.5 s |
| after, 2 | 140248 | 0.7 s | 16.8 s | 11.5 s | 1.9 s | 0.6 s | **31.5 s** | 3.4 s |
| after, 3 | 140248 | 0.7 s | 16.7 s | 11.8 s | 1.9 s | 0.5 s | **31.8 s** | 3.5 s |

**S1 (≤ 60 s): PASS at 31.8 s worst of three.**
- Resolving costs 0.3–0.4 s more than before. Every bare specifier that no alias or package explains is now tried as a module id against VS Code's 65 tsconfig folders.
- The machine was faster this session than for #3 (parse 16–18 s against 31 s), so these totals don't compare with #3's; the before row does.
- Three earlier cold runs, made before the adapter version (below) was added, took 33.6, 36.4 and 35.4 s, with the same edges.

**Edges.** VS Code went from 139,580 to 140,248: 668 added, none removed, no specifier changed.
- 665 are module ids (`vs/…`) from 35 Copilot test and fixture files, under `extensions/copilot/src/extension/prompts/node/test/fixtures/` and `extensions/copilot/test/simulation/fixtures/`.
- 3 come from computed `import()` loaders: `src/vs/code/electron-browser/workbench/workbench.ts` and `src/vs/sessions/electron-browser/sessions.ts` load their desktop mains, and `src/vs/code/node/cli.ts` loads `cliProcessMain.ts`. The adapter found 5 computed sites. The other two name npm packages (`@vscode/vsce-sign`, `vsda`) and stay unresolved.
- Entry points stored: 50 for VS Code (its extensions' and test packages' mains), 100 for AFFiNE.

**Eval #1's lists**, on the owner's re-indexed VS Code:

| List | Target | Truth | Index | Result |
|---|---|---|---|---|
| CL1 | dependents (direct) of `src/vs/workbench/contrib/search/common/search.ts` | 22 | 22 | match |
| CL2 | `src/vs/workbench/contrib/debug`, direct | 41 | 41 | match |
| CL3 | `src/vs/editor/standalone`, direct | 3 | 3 | match |
| CL4 | transitive dependents of `src/vs/workbench/contrib/markers/common/markers.ts` | 66 | 66 | match |
| CL5 | `src/vs/platform/undoRedo`, direct | 57 | 57 | match |

**Package names resolve only for declared workspaces.** VS Code declares no workspaces, so only its root package resolves by name. No edge comes from a `@vscode/prompt-tsx` specifier into `extensions/copilot/test/simulation/fixtures/codeMapper/`, a test fixture whose package.json carries that name, and none goes from `build/` into `extensions/gulp/`.

**report-resolution:**

| Repo | relative, before | relative, after | bare, before | bare, after |
|---|---|---|---|---|
| VS Code | 138,690/140,249 (98.9%) | 138,692/140,253 (98.9%) | 891/11,278 (7.9%) | 1,558/11,282 (13.8%) |
| AFFiNE | 14,471/15,108 (95.8%) | 14,471/15,108 (95.8%) | 2,202/20,665 (10.7%) | 11,790/20,665 (57.1%) |

- VS Code's before is the code before this change on a cold scratch index. AFFiNE's is V1.6 Task 1's probe.
- VS Code's totals grew by the computed literals the adapter now reads.
- AFFiNE's index went from 16,667 edges to 26,254. Its biggest unresolved names are now all outside packages (`lit` 1,637, `react` 924, `@toeverything/theme` 719, `@blocksuite/icons` 606). `@toeverything/infra`, `@blocksuite/affine`, `@blocksuite/std` and `@affine/component`, among the biggest misses before, are the repo's own packages and now resolve.

**The owner's index.** The first `npm run index -- ../vscode` ran warm (6.0 s) and kept 140,245 edges. Its files were unchanged, so their stored specifiers were kept and the three loaders' computed literals were never read; CL4 found 63 of 66. ADR-053's adapter version fixes that. The next run parsed every file once (70.9 s: discover 1.0, parse 20.0, write 46.9, resolve 2.3, aggregate 0.7; it writes over every existing row) and stored 140,248 edges, as the cold runs did. Summaries stayed ready (18,637/18,637). AFFiNE indexed in 9.8 s (6,986 files, 26,254 edges, 1,982 folders), and the active repo stayed VS Code.

**The incremental update's fixed cost** (`applyFileChanges` on an unchanged VS Code file, six runs in scratch homes): 66–104 ms before, 346–401 ms after. Each update now lists the manifests (`git ls-files`, about 0.26 s on VS Code) and reads the workspace (about 30 ms). ADR-053 discusses what that means for S6.

## 2026 10 14 MCP Benchmark #3 — S5 with the six tools (imports, architecture)

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, the owner's index as it stood (read-only through the server), the engine as of V1.6 Task 12. `NEBULOSITY_LIVE=off`: nothing was sent to any port.
- **Command:** `npm run bench-mcp -- ../vscode`, one run: the SDK's stdio client starts `node mcp/launch.mjs` in VS Code's folder, times each call from request to answer, reports each row's first call apart and then 20 warm calls. `imports` now has four rows, one per mode, and `architecture` two:
  - `imports (group_by)` is `src/vs/platform/storage/common/storage.ts` by area under `src/vs` (one input, repeated). Each call walks every file that reaches `storage.ts` through imports (thousands on VS Code), counts them by area, and finds the tests among them and the files nothing imports that load it, checked against the entry points the index held (Tasks 4 and 5 had re-indexed it, so they were stored). Only the import index is kept between calls, per index version, so every warm call redoes the walk;
  - `architecture (summary)` is `src/vs`, and `architecture (cycles)` is `src/vs/workbench/contrib` (one input each).
- **Server start** (spawn → initialized): 778 ms.

| Row | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 248 ms | 20 | 63 ms | 72 ms | 72 ms | 2,611 |
| `describe` | 60 ms | 20 | 59 ms | 85 ms | 87 ms | 3,991 |
| `search` | 2701 ms | 20 | 173 ms | 245 ms | 256 ms | 2,440 |
| `imports (dependents)` | 84 ms | 20 | 69 ms | 87 ms | 87 ms | 5,944 |
| `imports (dependencies)` | 67 ms | 20 | 62 ms | 69 ms | 69 ms | 2,491 |
| `imports (to)` | 65 ms | 20 | 68 ms | 73 ms | 73 ms | 323 |
| `imports (group_by)` | 81 ms | 20 | 76 ms | 82 ms | 83 ms | 2,035 |
| `architecture (summary)` | 176 ms | 20 | 198 ms | 228 ms | 229 ms | 449 |
| `architecture (cycles)` | 74 ms | 20 | 64 ms | 73 ms | 76 ms | 7,788 |
| `show_on_map` | 65 ms | 20 | 65 ms | 75 ms | 78 ms | 167 |

**S5 (every warm call ≤ 500 ms): PASS (worst 256 ms, a `search`).** Every row's worst warm call is under 500 ms; the slowest new row is `architecture (summary)` (p50 198 ms, max 229 ms), which does four reports in one call. The first `search` (2,701 ms against #2's 1,011 ms) loads the MiniLM model inside the server; it was a single run on a laptop, and I did not look for the cause of the slower load. The `search` rows' warm times (p50 173 ms) are also above #2's (132 ms), with everything else near #2. This run had no after-a-write table.

## 2026 10 14 MCP Dev Set #1 — tool use and per-turn cost before Eval #2

- **Purpose (R1 of V1.6's plan):** before Eval #2's questions exist, check two things on 16 dev questions whose targets Eval #2 may not use:
  - whether Claude Code calls Nebulosity's tools on graph questions;
  - how much the server adds to each turn's context.

  Nothing is scored.
- **Setup:**
  - Claude Code 2.1.300, claude-sonnet-5-5 at medium effort.
  - Isolated as Eval #2's runs are (`eval2/eval.json`; scripts allowed under a fresh scratch folder).
  - Nebulosity's arm only, one run per question: `npm run eval:run -- --eval eval2 --dev`.
  - Nebulosity is registered as `nebulosity setup` registers it: no `alwaysLoad`, and the five question tools load through their own `_meta`.
  - The owner's index: VS Code version 138, AFFiNE version 3. Live events off.
  - Every init had `apiKeySource: "none"`.
  - The tools' wording is ADR-056's, unchanged.
- **The questions** (`eval2/dev/questions.json`):
  - Eight per repo, one of each kind: impact, a transitive list, a cycle, files nothing imports, violations, entries, pairs and a chain.
  - Prompts and format lines are Task 14's (Eval #1's for lists and chains).
  - VS Code's targets are the plan's.
  - AFFiNE's (at `0b69a6da`) were picked with the eval's own scanner and truth resolver (`scripts/eval/scan.ts`, `resolve-truth.ts`, `truth.ts`), never with Nebulosity's index. Each one's size by that scan is in the table below. No AFFiNE file has 200–700 dependents spread over three or more top folders, so the impact target is the smallest spread-out one: anything `packages/frontend/core/src`'s 405-file import cycle imports has 680 or more.

| AFFiNE question | Target | Size by the eval's scan |
|---|---|---|
| impact | `blocksuite/affine/blocks/bookmark/src/bookmark-block.ts`, per `blocksuite/affine`, `blocksuite/integration-test`, `packages/frontend`, `tests` | 37 / 21 / 681 / 199, 9 elsewhere, 947 in all |
| transitive list | dependents of `packages/frontend/admin/src/use-query.ts` | 40 (9 direct) |
| cycle | `packages/frontend/apps/electron/src/main/events.ts` | 3 steps |
| unused | `packages/frontend/core/src/components/hooks` | 3 of 41 |
| violations | `packages/frontend/core/src/modules` → `packages/frontend/core/src/desktop` | 4 files |
| entries | `packages/frontend/apps/mobile-shared/src/auth/endpoint.ts` | 5 roots |
| pairs | the folders directly inside `packages/common` | 11 pairs |
| chain | `packages/backend/server/src/index.ts` → `packages/common/realtime/src/index.ts` | 5 steps |

**Round 1: 16 of 16 runs called a Nebulosity tool (1.00, against gate 5a's 0.90). ToolSearch was called 0 times.** The 16 runs cost $1.70 (Claude Code's estimate at list price). One run was most of it: listing 1,843 files cost $1.07.

| Run | Nebulosity tools called | Turns | Cost est. | First-call context |
|---|---|---|---|---|
| vscode-dev-impact | imports (group_by) | 2 | $0.106 | 23,630 |
| vscode-dev-transitive | imports (transitive) ×5, paging | 6 | $1.069 | 23,521 |
| vscode-dev-cycle | architecture (cycles, through) | 2 | $0.020 | 23,530 |
| vscode-dev-unused | architecture (unused) | 4 | $0.047 | 23,505 |
| vscode-dev-violations | imports (within) | 4 | $0.039 | 23,504 |
| vscode-dev-entries | imports (transitive), imports ×3 | 5 | $0.031 | 23,532 |
| vscode-dev-pairs | architecture (conventions) | 5 | $0.050 | 23,541 |
| vscode-dev-chain | imports (to) | 2 | $0.018 | 23,499 |
| affine-dev-impact | imports (group_by) ×3 | 4 | $0.034 | 23,406 |
| affine-dev-transitive | imports (transitive) | 2 | $0.032 | 23,280 |
| affine-dev-cycle | architecture (cycles, through) | 2 | $0.018 | 23,310 |
| affine-dev-unused | architecture (unused) | 5 | $0.038 | 23,287 |
| affine-dev-violations | imports (within) | 4 | $0.047 | 23,289 |
| affine-dev-entries | imports (transitive), architecture (unused) | 4 | $0.080 | 23,302 |
| affine-dev-pairs | imports ×13 (one per folder) | 16 | $0.055 | 23,234 |
| affine-dev-chain | imports (to) | 2 | $0.017 | 23,276 |

**Per-turn cost.** These are one-turn probes ("Reply with the single word ready.") through `npm run eval:probe -- --eval eval2 --config a,n --repo <id>`. A is Claude Code alone; N is with Nebulosity.

| Repo | A first call | N first call | N − A |
|---|---|---|---|
| VS Code | 21,239 | 23,330 | **+2,091** |
| AFFiNE | 21,017 | 23,108 | **+2,091** |

N − A is within gate 5b's 2,500 tokens on both repos. The probes cost $0.12, so the round cost $1.82.

**Wording:** none changed. Both targets were met in round 1, so there was no second round.

**Two observations:**
- **Scripts were hard to use as configured.** 6 runs hit a denial. 5 tried a script through Bash, as a heredoc (`mkdir -p … && cd … && cat > s.js <<'EOF' … node s.js`), and affine-dev-unused tried a `for` loop that ran `git grep` once per file:
  - all 6 were denied under `--permission-mode dontAsk`, because the allowlist holds only `Bash(node:*)` and read-only commands;
  - no run wrote a script with Write and then ran `node`, so every scratch folder was empty.

  Nebulosity's tools answered in those runs. In Eval #2's arm without them, scripting as configured would likely fail the same way; the pilot checks it.
- **The plan's VS Code dev picks share `src/vs/platform` with Eval #2's planned violations question** (`src/vs/platform` → `src/vs/editor`). The dev set uses `src/vs/platform` twice: as the imported folder of its violations question (`src/vs/base` → `src/vs/platform`), and as its pairs folder. Task 14 therefore moves that Eval #2 question.

## 2026 10 15 Index Benchmark #5 — the structure stage after the two index gaps

- **Targets and machine:** VS Code @ `cc3fec88` and AFFiNE @ `0b69a6da`, the owner's laptop, Node 24.14.0.
- **The change:** ADR-053's amendment, made before Eval #2's freeze at the owner's decision (2026-10-14). Import type expressions (`typeof import("x")`) count, and a code file over 1 MB is indexed for its imports only, up to 20 MB.
- **Commands:**
  - S1, cold: `NEBULOSITY_HOME=<scratch folder holding only the migrations> NEBULOSITY_DATA=<scratch>/.nebulosity npx tsx scripts/index.ts ../vscode`. Three runs with the change's first version (every file over 1 MB token-scanned), then three with the code before it (`2b79d71`, from a `git archive` copy), in the same session. The final code's runs are under "The final code" below.
  - The owner's index: `npm run index -- ../vscode`, then `npm run index -- ../affine --no-activate`.
  - Index vs truth: Task 14a's read-only script in the V1.6 ledger (`task-14a-index.ts`), run before and after the re-index. It runs the eval's own truth functions over each repo's import graph as the engine holds it, and compares the result with the 44 truths in `eval2/truth/`. A second read-only script does the same for Eval #1's ten list and chain truths.

| Run | Files | Edges | discover | parse | write | resolve | aggregate | **structure (S1)** | code search fill |
|---|---|---|---|---|---|---|---|---|---|
| before (`2b79d71`), 1 | 14844 | 140248 | 0.8 s | 25.4 s | 19.2 s | 3.2 s | 1.2 s | **49.8 s** | 6.0 s |
| before, 2 | 14844 | 140248 | 0.8 s | 25.4 s | 18.9 s | 3.0 s | 1.0 s | **49.2 s** | 5.4 s |
| before, 3 | 14844 | 140248 | 0.9 s | 27.2 s | 19.5 s | 3.1 s | 1.3 s | **51.9 s** | 5.4 s |
| after, 1 | 14849 | 140583 | 0.7 s | 27.5 s | 19.8 s | 3.2 s | 1.2 s | **52.6 s** | 5.8 s |
| after, 2 | 14849 | 140583 | 0.8 s | 27.8 s | 20.1 s | 2.7 s | 1.0 s | **52.5 s** | 5.7 s |
| after, 3 | 14849 | 140583 | 0.8 s | 27.4 s | 19.7 s | 2.9 s | 1.2 s | **52.1 s** | 5.4 s |

**S1 (≤ 60 s): PASS at 52.6 s worst of three.**
- **The machine was much slower this session than for #4.** The code before this change took 49.2–51.9 s here, where #4's runs took 30.4–31.8 s for nearly the same work. Compare rows within this table, not with #4. The margin to 60 s is 7.4 s on this session's machine.
- **The change costs about 2 s on average here** (52.4 s against 50.3 s): parse +1.6 s, write +0.7 s, resolve −0.2 s.
  - The five files over 1 MB (13.7 MB in all) took 0.18–0.23 s to read, hash and read for imports, timed apart.
  - The adapter's new branch was timed apart too: four alternating passes of the old and new adapters over the same 10,073 `src/vs` files, in one process. They differed by −0.3, +1.3, +2.3 and 0.0 s on passes of 18–20 s (mean +0.8 s). That is within this session's spread between runs of the same code (parse 25.4–27.2 s before).

**Edges.**

| Repo | Files before → after | Edges before → after | From files over 1 MB | Into a file now indexed | From import types |
|---|---|---|---|---|---|
| VS Code | 14,844 → 14,849 | 140,248 → 140,583 (+335) | 297 (3 files) | 1 | 37 (26 files) |
| AFFiNE | 6,986 → 6,987 | 26,254 → 26,261 (+7) | 0 | 0 | 7 (3 files) |

No edge was removed, and no code file in either repo is over 20 MB, so nothing is skipped for size now (VS Code skipped 5 files before).

**The files now indexed for their imports only** (read by the final code: the full adapter up to 5 MB, the token scan past it):

| File | Bytes | Read by | Specifiers | Edges |
|---|---|---|---|---|
| `extensions/vscode-colorize-perf-tests/test/colorize-fixtures/test-checker.ts` | 8,535,324 | token scan | 3 | 0 |
| `src/vs/platform/agentHost/test/node/agentService.test.ts` | 1,560,935 | full parse | 97 | 88 |
| `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts` | 1,377,567 | full parse | 0 | 0, and 1 into it from `extHostDocumentData.test.ts` |
| `src/vs/platform/agentHost/test/node/copilotAgentSession.test.ts` | 1,202,919 | full parse | 109 | 103 |
| `src/vs/platform/agentHost/test/node/copilotAgent.test.ts` | 1,027,075 | full parse | 114 | 106 |
| AFFiNE's `.yarn/releases/yarn-4.18.0.cjs` | 3,784,908 | full parse | 0 | 0 |

The first version of the change token-scanned every one of these. The scan gave the same specifiers for the five VS Code files. For the yarn release it read `require('fs')` and `require('path')` from template literals of generated code, which the full parse rightly leaves out.

**The import-type edges:**
- VS Code's 37 come from 26 files. 11 are in the two desktop loaders: `src/vs/code/electron-browser/workbench/workbench.ts` has 6 (sandbox types, globals, theme service, both window modules, `desktop.main.ts`) and `src/vs/sessions/electron-browser/sessions.ts` has 5. The rest are mostly in Copilot's tests (5 of them reach its `vscode` types shim) and the agent-host tests and helpers.
- AFFiNE's 7 come from 3 files: `tests/blocksuite/e2e/utils/declare-test-window.ts` (5), `packages/backend/native/dts-header.d.ts` (1) and `packages/backend/server/src/global.d.ts` (1).

**Index vs Eval #2's truths:**

| Truth | Index before | Index after | Truth |
|---|---|---|---|
| vscode-impact | 4,501 | 4,503 | 4,503 |
| vscode-s3-impact | 56 (agentHost 51) | 59 (agentHost 54) | 59 (agentHost 54) |
| affine-s1-impact | 1,446 (tests 12) | 1,546 (tests 112) | 1,546 (tests 112) |
| the other 41 | the same | the same | |

**44 of 44 identical** (41 before). Eval #1's ten list and chain truths (`eval/truth/cl1.json` … `cn5.json` and their copies in `eval2/truth/`) still match the index: no file is missing or extra.

**The owner's index:**
- **VS Code, with the first version of the change.** `npm run index -- ../vscode` parsed every file once, because the adapter version moved to 3. It took 87.0 s (discover 1.6, parse 28.1, write 52.0, resolve 3.8, aggregate 1.4), since it writes over every existing row, then filled code search in 8.2 s. Index version 140.
- **VS Code's summaries:** 18,633 of 18,642 ready. 9 are out of date: 8 folders above the newly indexed files (`src`, `src/vs`, `src/vs/platform`, `src/vs/platform/agentHost`, `src/vs/workbench`, `src/vs/workbench/api`, `extensions`, `extensions/vscode-colorize-perf-tests`) and the repo. Their child lists changed, so they are redone when opened.
- **AFFiNE** took 20.5 s (discover 0.6, parse 4.6, write 13.2, resolve 1.6, aggregate 0.5), then code search in 1.7 s. Index version 5. The active repo stayed VS Code.

**The final code** (the review's fix round: files of 1–5 MB parsed in full for their imports, adapter version 4):
- **The owner's index, re-indexed.** VS Code took 69.1 s (discover 1.1, parse 29.1, write 34.4, resolve 3.2, aggregate 1.3), then code search in 7.8 s; index version 141. AFFiNE took 20.8 s (0.5, 5.4, 12.5, 1.8, 0.5), then code search in 3.1 s; index version 6.
- **Edges:** unchanged on both, 140,583 and 26,261. Index vs truth is still **44 of 44**.
- **S1, cold, three runs:**

| Run | discover | parse | write | resolve | aggregate | **structure (S1)** | code search fill |
|---|---|---|---|---|---|---|---|
| final, 1 | 0.8 s | 28.6 s | 20.9 s | 3.0 s | 1.2 s | **54.6 s** | 5.8 s |
| final, 2 | 0.8 s | 29.6 s | 20.8 s | 3.4 s | 1.1 s | **55.7 s** | 5.6 s |
| final, 3 | 0.8 s | 29.2 s | 20.3 s | 3.2 s | 1.0 s | **54.5 s** | 5.3 s |

**S1 (≤ 60 s): PASS at 55.7 s worst of three.**
- **The machine kept slowing through the session.** Two later runs of the code before the change took 53.8 and 50.0 s. Two interleaved pairs, before then after, took 56.3 / 57.9 s and then 71.7 / 69.2 s: the second pair is over 60 s with either code. This build session's own runaway shell command, a `python -` probe started 2026-10-14 at 18:43 that never exited, had been using one of the 16 logical processors fully since then, and Chrome and other apps were busy. *(Corrected 2026-10-15, V1.6's final review: this note first called it a stray process left by another shell. It was ours. It ran through this benchmark, MCP Benchmark #4, Task 20's summaries and all of Eval #2, and was still running at the final review; the owner has been asked to stop it.)*
- **Timed apart, the change adds about 0.6 s:** the full parse of the four 1.0–1.6 MB files (88–148 ms each) and the token scan of the 8.5 MB fixture. Between runs of the same code this machine varied by 2–4 s. S1 should be measured again on a quiet machine.

## 2026 10 15 MCP Benchmark #4 — S5 after the pre-freeze sweep

- **Target and machine:** VS Code @ `cc3fec88`, on the owner's laptop, Node 24.14.0. The owner's index after the sweep's re-index (index version 143: 14,849 files, 140,583 edges, the same as before it), read-only through the server. The engine as of `3e8083d`, the sweep's code (ADR-053, ADR-054, ADR-056 and ADR-058 amended). `NEBULOSITY_LIVE=off`: nothing was sent to any port.
- **Command:** `npm run bench-mcp -- ../vscode`, twice. The rows and inputs are MCP Benchmark #3's: each row's first call apart, then 20 warm calls.
- **Server start** (spawn → initialized): 716 ms (second run: 689 ms).
- **Where the figures come from:** the table is the first run's own output; the second run's differences are listed below it.

| Row | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 200 ms | 20 | 54 ms | 58 ms | 62 ms | 2,661 |
| `describe` | 68 ms | 20 | 46 ms | 57 ms | 72 ms | 3,991 |
| `search` | 3430 ms | 20 | 221 ms | 383 ms | 388 ms | 2,440 |
| `imports (dependents)` | 86 ms | 20 | 88 ms | 119 ms | 124 ms | 5,944 |
| `imports (dependencies)` | 79 ms | 20 | 68 ms | 92 ms | 97 ms | 2,491 |
| `imports (to)` | 79 ms | 20 | 82 ms | 90 ms | 92 ms | 323 |
| `imports (group_by)` | 93 ms | 20 | 85 ms | 103 ms | 105 ms | 2,035 |
| `architecture (summary)` | 236 ms | 20 | 204 ms | 288 ms | 298 ms | 449 |
| `architecture (cycles)` | 74 ms | 20 | 71 ms | 90 ms | 91 ms | 7,788 |
| `show_on_map` | 79 ms | 20 | 75 ms | 90 ms | 91 ms | 167 |

**S5 (every warm call ≤ 500 ms): PASS (worst 388 ms, a `search`).** The second run also passed, at worst 291 ms (an `architecture (summary)`).
- **`search` varied most between the runs:** p50 221 ms and max 388 ms in the first, 187 ms and 256 ms in the second (#3: 173 ms and 256 ms). Its first call, which loads the MiniLM model inside the server, took 3,430 ms and then 1,424 ms. This build session's own runaway `python -` command, noted under Index Benchmark #5, was still using one of the 16 logical processors fully through both runs.
- **The other rows** stayed near #3's: every warm p50 within 25 ms of it, `architecture (summary)` the slowest at p50 204–223 ms (#3: 198 ms).
- **Answers:** the same sizes as #3 except `overview`, 2,661 characters against 2,611. The repo's summary has been out of date since Task 14e's re-index (Index Benchmark #5), so its line now ends "(Out of date: changed since it was summarized.)". Task 20 is to refresh it.

## 2026 10 15 Summary Benchmark #2 — AFFiNE's summaries against their estimate

- **Target and machine:** AFFiNE @ `0b69a6da` (repo 2), on the owner's laptop. Its index after sweep A's re-index had 8,036 summaries never written.
- **The estimate before the run** (Task 17's estimator; nothing sent): about 8,036 requests, 6,250 files to `claude-haiku-5-5` and 1,785 folders and the repo to `claude-sonnet-5-5`, about **$5.86** at list prices by the Batch API.
- **Command:** `npm run summarize -- ../affine --yes --budget 9`, in the background. The budget is $9, 1.5 × the estimate rounded up (the plan's rule), within the owner's approved $12 ("Task 20: summaries ≤ $12"). The transport is chosen per wave, as in #1: the Batch API for 100+ requests, the regular API below that (ADR-033).

| | Summarized | Failed | Templated | Waves | Batches | Run time |
|---|---|---|---|---|---|---|
| AFFiNE, one run (2026-10-15) | 8,036 | 0 | 0 | 16 | 6 | about 23 min (02:38:49 → 03:01:35) |

Afterwards 8,971/8,971 summaries were up to date, and all 8,036 new ones were embedded.

| Model | Transport | Requests | Cost |
|---|---|---|---|
| claude-haiku-5-5 | batch | 6,250 | $0.9753 |
| claude-sonnet-5-5 | batch | 1,669 | $4.3032 |
| claude-sonnet-5-5 | direct | 117 | $0.7395 |
| **total** | | **8,036** | **$6.02** |

**Against the estimate: $6.02 for $5.86, +2.7%, under the $9 budget.**
- **The requests matched the estimate exactly:** 6,250 files, and 1,669 + 117 = 1,786 folders and the repo.
- **Why it cost a little more:** the estimate prices every request at the Batch API's rate. The 117 requests in waves under 100 went direct, at twice that rate.

**VS Code's refresh, in the same session before the AFFiNE run.** The re-indexes had left 9 VS Code summaries out of date: 8 folders and the repo.
- **Estimate:** 9 requests to `claude-sonnet-5-5`, about $0.0502.
- **Run:** `--yes --budget 11` (the budget is the repo's recorded total). 9 summarized, 0 failed, 18,642/18,642 up to date, and 9 embedded (12,939 vectors).
- **Recorded spend:** VS Code's total went from $10.40 to $10.41.

With it, Task 20 spent about $6.03 of the owner's $12.

## 2026 10 15 Variety Benchmark #1 — five real repos

- **Targets and machine:** the owner's laptop, Node 24.14.0, the TypeScript adapter at version 4.

  | Repo | Commit | Shape |
  |---|---|---|
  | express | `a419aa73` | plain JavaScript (CommonJS), one package, no TypeScript and no workspaces |
  | vite | `bd325338` | pnpm monorepo (`packages/*`, `playground/**`, `docs`), 303 package.json files, packages built by a bundler (rolldown, tsdown) with no tsconfig `outDir`, package.json `imports` (`#types/*`) |
  | excalidraw | `4c37956b` | yarn workspaces (`excalidraw-app`, `packages/*`, `examples/*`), a React app in TypeScript, tsconfig `paths` for each of its packages |
  | AFFiNE | `0b69a6da` | yarn 4 workspaces, 124 package.json files, a large TypeScript monorepo with dependency injection (repo 2) |
  | VS Code | `cc3fec88` | one large repo with no declared workspaces: extensions with their own package.json, module ids (`vs/…`) |

  express, vite and excalidraw are shallow clones in `../repos/`.
- **Commands:** with `NEBULOSITY_DATA` set to a scratch folder, for each repo `npx tsx scripts/index.ts <repo> --no-activate`, then `npm run report-resolution -- <repo>`. The owner's index wasn't touched.
  - The structure times are each repo's first, cold run in that folder, made with the code before ADR-053's amendment of this day. The amendment changes only how imports resolve, and resolving VS Code's specifiers took 0.6–1.3 s with either version (three alternating passes).
  - After the amendment, each repo was indexed again in the same folder, and report-resolution run. The rows below are those runs.
- **Counting:**
  - "relative" counts relative specifiers (`./x`, `../y`) that name code;
  - "not code" counts relative specifiers that resolve to nothing and name a file the index doesn't read (a style sheet, JSON, an image, a font, a `.vue` component). report-resolution prints these on a line of their own, by extension, and leaves them out of the relative share (ADR-053, amended);
  - "bare" counts everything else (`react`, `@affine/core`, `vs/…`, `#types/hot`). It resolves only when it names the repo's own code, so a repo that imports many npm packages has a low bare share by design.

| Repo | Files | Edges | Structure | Relative resolved | Not code | Bare resolved | Top unresolved bare names |
|---|---|---|---|---|---|---|---|
| express | 141 | 153 | 0.3 s | 153/153 (100%) | 0 | 0/240 (0%) | supertest 80, node:assert 31, node:path 21, node:buffer 13, after 10 |
| vite | 1,599 | 2,059 | 1.9 s | 1,745/1,760 (99.1%) | 222 (.css 129, .svg 37, .json 16, .png 15, .vue 8) | 318/1,725 (18.4%) | node:path 203, vitest 191, vite 170, rolldown 108, node:fs 105 |
| excalidraw | 710 | 3,678 | 2.9 s | 2,530/2,530 (100%) | 323 (.woff2 230, .scss 85, .css 4, .json 4) | 1,150/1,736 (66.2%) | react 225, clsx 80, vitest 48, radix-ui 25, @testing-library/react 20 |
| AFFiNE | 6,987 | 26,261 | 17.3 s | 14,473/14,475 (99.99%) | 636 (.svg 472, .json 69, .png 39, .node 30, .jpg 9) | 11,795/20,671 (57.1%) | lit 1,637, react 924, @toeverything/theme 719, @blocksuite/icons 606, @vanilla-extract/css 431 |
| VS Code | 14,849 | 140,583 | 62.7 s * | 139,022/139,763 (99.5%) | 822 (.css 773, .json 49) | 1,563/11,350 (13.8%) | assert 2,921, vscode 725, fs 684, path 552, vitest 468 |

\* The machine was shared with another job during this run, and this build session's own runaway shell command (a `python -` probe started 2026-10-14 at 18:43 that never exited) was using one of its 16 logical processors fully. S1's latest figure, Index Benchmark #5's 55.7 s at worst of three, was measured on a loaded machine too, with the same process running; a measurement on a quiet machine is still owed. *(Corrected 2026-10-15, V1.6's final review: this note first said S1 was measured on a quiet machine.)*

**S10: every repo indexed without a crash, and every repo resolves at least 99% of its relative imports of code.**
- **Every unresolved bare name above is outside the repo,** except vite's own `vite` (below). The others are Node's built-ins, npm packages and VS Code's extension API (`vscode`). Among the next names, VS Code's `@vscode/prompt-tsx` (292) is an npm package that a test fixture's package.json also carries. The fixture is no declared workspace, so it doesn't capture the name (ADR-053).
- **Two repos were under 95% on the old counting**, which put style sheets, fonts and images among relative imports: vite at 1,720/1,982 (86.8%) and excalidraw at 2,530/2,853 (88.7%). Every miss was read:

| vite's 262 unresolved relative specifiers, before the amendment | Count | Now |
|---|---|---|
| not code: styles, images, JSON, `.vue`/`.svelte`, `.wasm`, media | 222 | counted apart |
| a bundler's query on a code file (`./worker?worker`, `./x.js?url`) | 26 | 25 resolve; 1 names its own file |
| build output the checkout doesn't have (`../dist/node/cli.js`, `./dist/app.js`) | 6 | unresolved (a limit) |
| `playground/resolve/browser-field`: paths a package.json `browser` field remaps | 3 | unresolved (a limit) |
| fixtures that import a missing file on purpose (`./non-existent.js`) | 2 | unresolved, rightly |
| a folder imported through its package.json `main` (`./bar`, `./`) | 2 | unresolved (a limit) |
| `./foo` naming `foo.json` | 1 | unresolved (JSON isn't indexed) |

  excalidraw's 323 are all not code: fonts (230 `.woff2`, from `packages/excalidraw/fonts/`), style sheets (89) and JSON (4).
- **vite's bare misses that name its own code:**
  - `#types/*`, `#dep-types/*` and `#module-sync-enabled` (77, plus 3 in config fixtures) are subpath imports that `packages/vite/package.json` declares in `imports`. They now resolve.
  - `vite` (170) is its own package, a declared workspace (`packages/*` in pnpm-workspace.yaml). Its `exports` point at `./dist/node/index.js`, which rolldown builds from `src/node/index.ts` with no tsconfig `outDir`, so ADR-053's compiled → source mapping doesn't apply. The 170 are mostly the playground's and the templates' configs (`import { defineConfig } from 'vite'`).
  - Reading a package's missing `dist/` as its `src/` would resolve 168 of them, with no edge changed on VS Code or AFFiNE and one more VS Code entry point. It is a limit for now (ADR-053's revisit).
- **The amendment moved nothing on the eval's repos.** Each repo's stored edges (source, target and specifier) and entry points were dumped before and after the second run, and compared line by line:
  - VS Code (140,583 edges, 50 entry points), AFFiNE (26,261, 100), express and excalidraw are identical;
  - vite gained 103 edges, with none removed: 80 from `#…` specifiers, and 23 from the 25 queries that now resolve (a file that imports one file twice, with two different queries, has one edge to it).
- **What VS Code's and AFFiNE's relative misses are:**
  - VS Code's 741:
    - 669 name files that don't exist at this commit: 483 in Copilot's test fixtures, which are copies of VS Code files without their neighbours, 76 in the colorizer's perf-test fixtures, and the rest mostly other Copilot tests and files the build generates and git ignores (`build/lib/policies/policyDto.ts`, `test/automation/src/driver.d.ts`);
    - 63 are `test/mcp`'s imports of the folder `test/scenario` through its package.json `main`, the limit above;
    - 9 name scripts or other endings (`.ps1`, a diff fixture's `./gulpfile.compile`).
  - AFFiNE's 2: a declaration file that imports its own name (`packages/backend/native/index.d.ts`), and `affine.wasi.cjs`, which isn't in the repo.
- **Against Index Benchmark #4:** VS Code's relative share read 98.9% there, and AFFiNE's 95.8%. The difference is the counting (822 and 636 specifiers now counted apart), plus the import types and over-cap files ADR-053's earlier amendment added.

## 2026 10 15 Variety Benchmark #2 — Theia, held out

Eval #3's held-out repo, indexed once so its resolution share is known before any question is drawn (V1.7 plan, Task 17). Nothing about how either arm does on it has been seen.
- **Target and machine:** Eclipse Theia @ `81ea5f93`, a shallow clone at `../theia` (4,530 tracked files, clean tree). The owner's laptop, Node 24, the TypeScript adapter. Indexed into the owner's database with `npx tsx scripts/index.ts ../theia --no-activate` (the Map stays on VS Code), structure only, free mode with no summaries; then `npm run report-resolution -- ../theia`.
- **Shape:** a Lerna/npm-workspaces monorepo (`packages/*`, `dev-packages/*`, `examples/*`) in TypeScript with Inversify dependency injection. Packages import one another by their compiled paths (`@theia/core/lib/browser/…`), which ADR-053's compiled to source mapping reads as `src/`.

| Repo | Files | Edges | Structure | Relative resolved | Not code | Bare resolved | Top unresolved bare names |
|---|---|---|---|---|---|---|---|
| Theia | 3,772 | 19,979 | 12.2 s | 9,642/9,648 (99.9%) | 127 (.css 78, .json 47, .node 2) | 10,431/13,187 (79.1%) | chai 518, @theia/monaco-editor-core 517, inversify 301, path 165, fs 91 |

- **Structure time:** discover 0.2 s, parse 4.4 s, write 6.8 s, resolve 0.5 s, aggregate 0.2 s. The code search filled in a further 12.1 s after the stage. 753 folders, 6,433 folder-level edges.
- **Theia's own code:** 10,444 bare specifiers name an `@theia/…` package other than `@theia/monaco-editor-core`, and 10,430 of them (99.9%) resolve. The 14 that don't:
  - 13 import `@theia/core/shared/@theia/application-package/lib/environment` (or `/lib/api`), the re-export shim in `packages/core/shared/`, which points at another package's compiled output;
  - 1 imports the JSON file `@theia/core/src/common/i18n/nls.metadata.json`, which the index doesn't read.
  - So the compiled to source mapping covers Theia's package imports; the one pattern it misses is a package reached through core's `shared/` shim.
- **The other unresolved bare names are outside the repo:** `chai`, `inversify`, `sinon`, Node's built-ins, and `@theia/monaco-editor-core` (517), which is a published fork of Monaco that no package.json in the checkout declares.
- **The 6 unresolved relative specifiers of code** were not itemised; the misses seen while checking name build-time files the checkout doesn't have (`gen-esbuild.*.mjs`, `ffmpeg.node`).
- **Call facts** (ADR-059), rows for Theia's repo: 5,812 type_decls, 13,658 call_bindings, 62,937 typed_calls. No `calls` answer was read.

## 2026 10 15 Eval #2 — Claude Code with and without Nebulosity's MCP server on VS Code and AFFiNE (S12)

This is the re-measured eval that ADR-051 waits for (ADR-057). The method, the gate, every run's score, what happened per question and the losses are in `docs/EVAL_RESULTS.md`.
- **Targets and machine:** VS Code @ `cc3fec88` and AFFiNE @ `0b69a6da`, with Nebulosity's engine frozen at `EVAL2_ENGINE` (`90f9f63`) and index versions 152 and 131. It ran on the owner's laptop on 2026-10-15, 08:36–10:57 UTC, with the machine otherwise kept quiet: this build session's own runaway `python -` command (Index Benchmark #5) used one of the 16 logical processors fully throughout, in both arms alike.
- **How:**
  - `npm run eval:run -- --eval eval2 --pilot` and `-- --eval eval2 --sessions --pilot`, then the full schedules (`--eval eval2` and `--eval eval2 --sessions`).
  - 39 single questions and 6 four-question task sessions, three repeats, in two arms: A, Claude Code alone, and N, with Nebulosity. 270 runs in all.
  - Every run used Claude Code 2.1.300 headless and `claude-sonnet-5-5` at medium effort, with Node.js scripts allowed in both arms.
  - `npm run eval:score -- --eval eval2` scored them and computed the gate. The big-picture answers were graded blind (`eval2/grading/`).
- **Result: the ship gate failed** on conditions 1, 2, 3a and 5a; 3b, 4 and 5b passed. **S12: not met.**

How fast Claude Code got the context a question needs (medians, A / N; the score is the mean):

| Questions | Repo | Runs per arm | Score | Time | Cost est. | Context read | Turns |
|---|---|---|---|---|---|---|---|
| Big-picture | VS Code | 15 | 0.93 / 0.84 | 13.9 / 11.5 s | $0.033 / $0.031 | 44,618 / 48,652 | 3 / 3 |
| Big-picture | AFFiNE | 12 | 0.70 / 0.68 | 20.5 / 20.9 s | $0.054 / $0.065 | 93,811 / 116,017 | 6 / 8 |
| Direct lists | VS Code | 12 | 0.96 / 0.98 | 28.0 / 22.7 s | $0.073 / $0.073 | 96,943 / 101,801 | 4 / 4 |
| Direct lists | AFFiNE | 9 | 1.00 / 1.00 | 22.4 / 12.0 s | $0.059 / $0.043 | 97,078 / 53,686 | 6 / 3 |
| Graph questions (chains, transitive lists, grep-hard) | VS Code | 36 | 0.94 / 1.00 | 20.9 / 8.7 s | $0.048 / $0.027 | 92,119 / 48,542 | 4.5 / 2 |
| Graph questions | AFFiNE | 33 | 0.93 / 1.00 | 31.5 / 7.5 s | $0.079 / $0.034 | 147,245 / 50,318 | 8 / 2 |
| Task sessions (4 questions) | VS Code | 9 | 0.98 / 1.00 | 76.7 / 26.1 s | $0.168 / $0.079 | 376,843 / 240,347 | 16 / 10 |
| Task sessions (4 questions) | AFFiNE | 9 | 0.91 / 1.00 | 106.3 / 25.1 s | $0.319 / $0.156 | 782,464 / 374,599 | 26 / 11 |

- **The measures:** time is `duration_ms` and the cost is Claude Code's own list-price estimate. "Context read" is input + cache writes + cache reads over every model call of the run. A session's row is the whole session.
- **The totals:** the 270 runs came to $22.26 by that estimate. The 5-hour window went from 0.18 to 0.71 and the 7-day from 0.31 to 0.37 (upper bounds).
- **A confound in the cost:** the runs' permission rules refused shell commands outside an allowlist. Claude Code alone had commands refused in 42 of its 69 graph runs and in all 18 of its sessions. On the graph runs without a refusal, N's time ratio was 0.37 (VS Code) and 0.38 (AFFiNE), and its cost ratio 0.63 and 0.72 (0.39 and 0.74 pooled), scoring 1.00 against 0.995 and 0.86. The time advantage holds; part of the cost advantage is the refusals.
- **The losses**, named in the results:
  - VS Code's big-picture questions (−0.083);
  - the grep-hard margin (+0.088 against +0.15);
  - VS Code's graph-question cost (0.57 of A's against 0.5);
  - tool use (80 of 90 against 0.90).

  It was also slower and costlier on VSCODE-PAIRS (1.73 times the time, 1.92 times the cost, at 0.99 against 1.00). The conventions report skips rare folder names, and two of N's three runs then had their scripts refused and grepped by hand. The third was faster and cheaper than every A run.

## 2026 10 15 Update Benchmark #2 — S6 after V1.6's per-update workspace read

- **Command:** `npm run bench-update -- ../vscode <file>` (five runs each) against `npx next dev -p 3130`, as in Update Benchmark #1: the watcher (1 s debounce) → `applyFileChanges` → `GET /api/describe` showing the new export, polled every 25 ms.
- **Setup:** the sandbox worktree `../Nebulosity-build` at `ddc3975`, port 3130 (port 3000 untouched), a scratch data folder (`NEBULOSITY_DATA`) holding a fresh cold index of VS Code @ `cc3fec88` and a `config.json` with `port: 3130`; no API key, so summaries off. VS Code was clean afterwards.
- **Machine:** One of 16 logical processors was fully used throughout by a runaway `python -` process left by this build session's own shell (PID 39512); see Index Benchmark #5. The cold index for this run took structure 66.9 s on that loaded machine (discover 1.0 s, parse 36.5 s, write 24.0 s, resolve 3.7 s, aggregate 1.5 s; code search filled 6.8 s later): an extra S1 data point, not an S1 verdict.

| Batch | File | Each run | Median | Worst |
|---|---|---|---|---|
| 1, first after server start | `src/vs/base/common/strings.ts` | 4,189, 3,597, 11,029, 1,975, 1,900 ms | 3,597 ms | 11,029 ms |
| 2 | `src/vs/editor/common/model/textModel.ts` | 1,904, 1,951, 1,847, 1,953, 1,844 ms | 1,904 ms | 1,953 ms |
| 3, repeat of batch 1's file | `src/vs/base/common/strings.ts` | 1,964, 1,975, 1,906, 1,842, 1,918 ms | 1,918 ms | 1,975 ms |

- `applyFileChanges` alone took 0.55–0.72 s per update (the worker's log; 115–224 ms in Update Benchmark #1), so the V1.6 workspace read roughly added 0.4–0.5 s on this loaded machine.
- **Batch 1's first three runs were the dev server's cold start** (the first requests compile the routes; the log printed "watching" only during that batch), not steady state. Batches 2 and 3 are warm.
- **S6 (≤ 2 s): FAIL as first run (worst 11,029 ms, the cold start); PASS warm (worst 1,975 ms, median 1,904 ms), with only 25–155 ms of margin.** The README quotes the warm worst.

## 2026 10 15 Update Benchmark #3 — S6 with the workspace kept per worker run

- **Command:** `npm run bench-update -- ../vscode <file>` (five runs each) against `npx next dev -p 3130`, as in Update Benchmark #2: the watcher (1 s debounce) → `applyFileChanges` → `GET /api/describe` showing the new export, polled every 25 ms.
- **Setup:** the sandbox worktree `../Nebulosity-build` at `00e3293` (the commit that keeps the workspace), port 3130 (port 3000 untouched), a scratch data folder holding a fresh cold index of VS Code @ `cc3fec88` (structure 59.3 s on this run) and a `config.json` with `port: 3130`; no API key, so summaries off. VS Code was clean afterwards and the scratch folder and server were removed.
- **Change measured:** the worker passes the workspace it read back into `applyFileChanges`, which reads the manifests again only when a tsconfig or package.json, `pnpm-workspace.yaml`, `lerna.json` or the file set changed (ADR-053, amended). Nothing else differs from #2's code.

| Batch | File | Each run | Median | Worst |
|---|---|---|---|---|
| 1, first after server start | `src/vs/base/common/strings.ts` | 1,787, 1,399, 1,359, 1,355, 1,371 ms | 1,371 ms | 1,787 ms |
| 2 | `src/vs/editor/common/model/textModel.ts` | 1,501, 1,374, 1,379, 1,424, 1,415 ms | 1,415 ms | 1,501 ms |
| 3, repeat of batch 1's file | `src/vs/base/common/strings.ts` | 1,458, 1,382, 1,403, 1,352, 1,364 ms | 1,382 ms | 1,458 ms |

- `applyFileChanges` alone (the worker's log, 31 updates: each run saves the file and restores it): the first update after the server started took 507 ms, which reads the manifests; every later one took 112–250 ms (typically 130–180 ms), against 0.55–0.72 s per update in Update Benchmark #2 and 115–224 ms in #1, before V1.6 read the workspace each time.
- The remaining time is the watcher's 1 s debounce plus the poll and the route.
- **S6 (≤ 2 s): PASS, warm (worst 1,501 ms, median 1,415 ms) and on the first batch after start (worst 1,787 ms; its first run, 1,787 ms, includes the dev server's first compile and the 507 ms manifest read).** Margin is 213 ms on the first batch and about 500 ms warm, against 25 ms in #2. The manifest cache for full runs stays recommended.

## 2026 10 15 Index Benchmark #6 — S1 on a quiet machine

- **Target and machine:** VS Code @ `cc3fec88`, the owner's laptop, Node 24.14.0, code at `11e031e`. This is the quiet-machine S1 that #5 and Update Benchmark #2 asked for.
- **The machine:** the build session's runaway `python -` process (PID 39512, one of 16 logical processors fully busy since 2026-10-14 18:43) was stopped by the owner just before these runs, and the processor load read 2–17% beforehand. Chrome and VS Code were open.
- **Command:** `NEBULOSITY_DATA=<a fresh scratch folder per run> npx tsx scripts/index.ts ../vscode`, three runs back to back (a cold database each run; the owner's index untouched).

| Run | Files | Edges | discover | parse | write | resolve | aggregate | **structure (S1)** | code search fill |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 14849 | 140583 | 1.3 s | 19.1 s | 12.7 s | 2.0 s | 0.7 s | **35.9 s** | 5.6 s |
| 2 | 14849 | 140583 | 0.7 s | 28.6 s | 18.3 s | 2.3 s | 0.7 s | **50.7 s** | 3.8 s |
| 3 | 14849 | 140583 | 0.7 s | 16.9 s | 11.2 s | 1.7 s | 0.6 s | **31.3 s** | 3.4 s |

**S1 (≤ 60 s): PASS at 50.7 s worst of three** (median 35.9 s). Run 2 was slower in parse and write alike, which points to the machine rather than the code: the same work took 31–36 s on either side of it. The loaded-machine figures before it (55.7 s in #5, 66.9 s in Update Benchmark #2's cold index) carried the runaway process. Files and edges match #5's final code exactly.

## 2026 10 15 Calls Benchmark #1 — calls through declared types against TypeScript's checker (S14)

- **Command:** `npm run bench-calls -- --repo ../vscode --checker <checker.json>` and `npm run bench-calls -- --repo ../affine --sites <affine-sites.json> --verdicts <verdicts.json>` (`scripts/bench-calls.ts`), read-only on the owner's index. It writes `.nebulosity/measure/calls-<repo>.json`.
- **The index:** VS Code @ `cc3fec88` and AFFiNE @ `0b69a6d`, re-indexed in the owner's database three times (R-AC, each announced): adapter version 5, then 6 and 7 after the two rounds below. Files and edges were the same every time: VS Code 14,849 and 140,583 (Index Benchmark #6), AFFiNE 6,987 and 26,261 (Eval #2). The `calls` answer for each method is asked as `calls { symbol: "<Type>.<member>", path: <declaring file> }`, VS Code's `within: "src"`.
- **The reference on VS Code:** the type checker's run from V1.7's design check, kept in the V1.7 ledger as `evidence/e2/out/checker.json`. It built `src/tsconfig.json`'s program (10,237 roots, 21.5 s, 4,998 MB, 0 errors) and asked the checker which declaration each of the 7,347 calls named `readFile`, `store`, `getValue`, `executeCommand` or `openEditor` resolves to. Both sides are kept to the program's own files: the tsconfig's `fileNames` without `.d.ts`, 10,037 files, read without building a program.
- **The sets (R-AB):**
  - "Interface calls": the files with a call the checker resolves to the interface's member. On the index's side, the files with a call on the interface, or on a sub-interface that doesn't declare the member.
  - "Interface + implementation": those files, plus calls on a class that implements the interface. The checker side counts a class whose heritage reaches the interface; the index side counts its implementations, test doubles included.
  - A call on a sub-interface that redeclares the member is counted apart.
- **The bar (S14, R-AL):** recall ≥ 0.98 and precision ≥ 0.99, file level, pooled over the five methods, on both sets.

**Result (adapter version 7): PASS.** Interface calls 0.999 / 1.000; interface + implementation 0.987 / 0.999, pooled.

Interface calls:

| Method | Checker files | Index files | Both | Recall | Precision |
|---|---|---|---|---|---|
| IFileService.readFile | 180 | 180 | 180 | 1.000 | 1.000 |
| IStorageService.store | 326 | 325 | 325 | 0.997 | 1.000 |
| IConfigurationService.getValue | 726 | 725 | 725 | 0.999 | 1.000 |
| ICommandService.executeCommand | 327 | 327 | 327 | 1.000 | 1.000 |
| IEditorService.openEditor | 194 | 194 | 194 | 1.000 | 1.000 |
| **Pooled** | **1,753** | **1,751** | **1,751** | **0.999** | **1.000** |

Interface + implementation calls:

| Method | Checker files | Index files | Both | Recall | Precision |
|---|---|---|---|---|---|
| IFileService.readFile | 214 | 213 | 213 | 0.995 | 1.000 |
| IStorageService.store | 397 | 388 | 388 | **0.977** | 1.000 |
| IConfigurationService.getValue | 768 | 758 | 758 | 0.987 | 1.000 |
| ICommandService.executeCommand | 330 | 330 | 329 | 0.997 | 0.997 |
| IEditorService.openEditor | 205 | 202 | 202 | 0.985 | 1.000 |
| **Pooled** | **1,914** | **1,891** | **1,890** | **0.987** | **0.999** |

`IStorageService.store` is under 0.98 on its own. Its 9 missed files are all tests: 8 take the storage from a test helper's undeclared return, and 1 from a conditional (class 1 and the conditional of class 3 below).

**Rounds** (pooled; the bar first failed on interface + implementation recall):

| Adapter | Change | Interface R / P | Interface + implementation R / P |
|---|---|---|---|
| 5 | none (Tasks 1–4) | 0.995 / 1.000 | 0.969 / 1.000 |
| 6 | Round 1: `super.m()`, and `this` or `new` on a nested or nameless class | 0.996 / 1.000 | 0.978 / 0.999 |
| 7 | Round 2: a member of a declared type, and a same-file function's declared return type | 0.999 / 1.000 | 0.987 / 0.999 |

- **Round 1** fixed the most common miss class: 16 of the 59 files missed at version 5.
  - `super.m()` is typed by its class's extends clause; `extends mock<I>()` gives `I`.
  - `this` in a nested or nameless class, and `new class … {}`, name the class as `@<line>`, the key R-O gives it. The engine reads that as the file's own type at that line.
  - It recovered 16 files, plus 1 that had been missed only as an interface call. It added the one extra below.
  - The fixture case is `src/workbench/tasks/taskRunner.ts` and `runners.ts`.
- **Round 2** fixed the most common class left inside ADR-059's rules: a same-file function's declared return type, 12 files. Half of those also reach a member of a declared type (`accessor.editorService.openEditor(…)`), and the same rule covered the 6 files of that class.
  - The member rules: `x.f.m()`, `const { f } = x`, `({ f }: IServices)` and `const that = this`. The engine reads the field through the type's declaration and its bases. An interface's property types are now recorded as fields, the way a class's are.
  - The return rules: a function declared in the same file, `await` taking `Promise<T>` to `T`, and a declared tuple or type literal destructured.
  - It recovered 19 files, 5 of them interface misses too, and added no extra.
  - The fixture case is `src/workbench/tasks/taskHost.ts`.
- **Round 3 wasn't run:** the bar passed.
- **Not done:** following a helper's undeclared return was left out, although it is the largest class left (15 files). ADR-059 keeps inferred types unseen, and the fixture's `inferred.ts` pins that.

**What the index still misses** (interface + implementation, 24 files; the 2 interface misses are among them):

1. **A test helper's undeclared return** (15 files, all tests). Example: `src/vs/platform/chat/test/common/agentsWindowInvitation.test.ts:252`, `h.storage.store(…)`, where `const h = createHarness()` and `createHarness` returns an object literal with no annotation. It is one of the 2 interface misses: `agentHostRemoteByokNotification.test.ts:436`.
2. **`instantiationService.createInstance(C, …)`** (4 files, all tests). Example: `src/vs/workbench/test/browser/quickAccess.test.ts:438`, after `editorService = disposables.add(instantiationService.createInstance(EditorService, undefined))`.
3. **One file each** (5):
   - a conditional, `options.showDetails ? disposableStore.add(new InMemoryStorageService()) : undefined` (`suggestWidget.fixture.ts:46`);
   - a parameter property typed only by its default, `private configurationService = new TestConfigurationService()` (`workbenchTestServices.ts:1262`);
   - a chained assignment, `a = b = new TestConfigurationService(…)` (`aiCustomizationManagementEditor.fixture.ts:1209`);
   - `services?.configurationService ?? testConfigurationService` (`chatInputModeValidation.test.ts:125`);
   - the contextually typed parameter of an object literal's method, `bindTo(service)` (`src/vs/workbench/browser/parts/editor/breadcrumbs.ts:98`). This is the one production file, and the other interface miss.

- **The one extra:** `src/vs/workbench/contrib/chat/test/browser/voiceClient/voiceSessionController.test.ts:766`, `super.executeCommand(…)` in `AdoptingCommandService extends TestCommandService`, where `TestCommandService extends mock<ICommandService>()`. The index counts a test double as an implementation (ADR-059). The checker run's "implements" check follows only heritage clauses that name a symbol, so it doesn't count `mock<I>()`.
- **Counted apart:** 6 files call `store` on `IApplicationStorageMainService`, which redeclares it. Example: `src/vs/platform/native/electron-main/auth.ts:279`. The checker files these under that interface too.

**AFFiNE** (reported, not judged), against the design check's syntactic L3 sets for its three planning methods:

| Method | L3 files | Verdicts | Reference | Index files | Both | Recall | Precision |
|---|---|---|---|---|---|---|---|
| WorkspaceDialogService.open | 45 | 2 in | 47 | 47 | 47 | 1.000 | 1.000 |
| GlobalDialogService.open | 25 | 1 in | 26 | 26 | 26 | 1.000 | 1.000 |
| GraphQLService.gql | 18 | 1 in | 19 | 19 | 19 | 1.000 | 1.000 |
| **Pooled** | **88** | **4** | **92** | **92** | **92** | **1.000** | **1.000** |

- **Before the verdicts:** recall 1.000 and precision 0.957 (88 of 92). The index had 4 files the L3 sets lack, and all 4 are real calls, each read in the source:
  - three are calls on a destructured parameter whose type literal names the service: `commands/affine-help.tsx:39`, `affine-navigation.tsx:98` and `affine-creation.tsx:66`. The design check's report names all three as calls its pass missed;
  - one is `this.gql(…)` inside `GraphQLService` (`modules/cloud/services/graphql.ts:25`), since the L3 sets leave `this.m()` calls out.
- The verdicts, each with its deciding line, are `calls-benchmark-affine-verdicts.json` in the V1.7 ledger.
- **Neither side has two more real calls** the design check found by grep: `audio-transcription-job-store.ts:49` and `:103`. Each calls through a getter with no annotation (class 1's kind), so the reference holds only the calls that one side found.

**Rows stored** (the three call tables; the counts are read-only, after each re-index):

| Repo | Adapter | `type_decls` | `call_bindings` | `typed_calls` (calls + injection sites) |
|---|---|---|---|---|
| VS Code | 5 | 37,072 | 68,362 | 395,763 (353,014 + 42,749) |
| VS Code | 6 | 37,072 | 68,362 | 399,811 (357,062 + 42,749) |
| VS Code | 7 | 37,072 | 75,690 | 452,239 (409,490 + 42,749) |
| AFFiNE | 5 | 4,839 | 11,939 | 32,789 (28,406 + 4,383) |
| AFFiNE | 6 | 4,839 | 11,939 | 35,717 (31,334 + 4,383) |
| AFFiNE | 7 | 4,839 | 12,787 | 39,829 (35,446 + 4,383) |

Version 7 keeps more bindings because a member fact names the type it goes through, and that type's import is kept.

**The re-index runs** (the owner's database, so warm and with summaries kept: these aren't S1 figures; Index Benchmark #7 measures S1):

| Repo | Adapter | discover | parse | write | resolve | aggregate | structure |
|---|---|---|---|---|---|---|---|
| VS Code | 5 | 1.3 s | 27.0 s | 55.5 s | 2.6 s | 1.0 s | 87.4 s |
| VS Code | 7 | 0.9 s | 26.8 s | 33.2 s | 2.0 s | 0.7 s | 63.7 s |
| AFFiNE | 5 | 0.5 s | 5.6 s | 9.7 s | 1.2 s | 0.4 s | 17.5 s |
| AFFiNE | 6 | 0.5 s | 5.7 s | 10.3 s | 1.0 s | 0.3 s | 17.8 s |
| AFFiNE | 7 | 0.5 s | 5.9 s | 10.4 s | 1.1 s | 0.3 s | 18.2 s |

VS Code's version 6 run printed the same files and edges, but its stage times weren't kept. The benchmark run took 1.2 s on VS Code (the tsconfig read and five answers, the first of them building the call index) and 0.2 s on AFFiNE. S14's speed half, the first answer in a fresh MCP process, is MCP Benchmark #5's.

## 2026 10 15 Index Benchmark #7 — S1 with the call facts

- **Target and machine:** VS Code @ `cc3fec88`, the owner's laptop, Node 24.14.0, `ADAPTER_VERSION` 7 (the call facts of ADR-059, after Calls Benchmark #1's two rounds). Before the runs: port 3000 free, no `python.exe`, no `node.exe` busy (the five running had 0.4–2.9 s of CPU in total); the owner's Map and index untouched.
- **Command:** `NEBULOSITY_DATA=<a fresh scratch folder per run> npx tsx scripts/index.ts ../vscode`, three runs back to back (a cold database each run; the folders were deleted afterwards).

| Run | Files | Edges | discover | parse | write | resolve | aggregate | **structure (S1)** | code search fill |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 14849 | 140583 | 0.8 s | 25.0 s | 21.4 s | 1.7 s | 0.6 s | **49.7 s** | 3.7 s |
| 2 | 14849 | 140583 | 0.7 s | 25.5 s | 21.5 s | 1.8 s | 0.6 s | **50.2 s** | 3.7 s |
| 3 | 14849 | 140583 | 0.7 s | 28.9 s | 23.9 s | 2.2 s | 1.0 s | **56.7 s** | 4.8 s |

**S1 (≤ 60 s): PASS at 56.7 s worst of three** (median 50.2 s). Files and edges match Index Benchmark #6 exactly (14,849 and 140,583).

- **Against #6** (31.3–50.7 s, median 35.9 s): the median is 14.3 s higher. Parse is 25.0–28.9 s against 16.9–28.6 s (median 19.1 s) and write is 21.4–23.9 s against 11.2–18.3 s (median 12.7 s). Parse carries the call facts' extraction; write carries three more tables' rows per file. #6's own spread (31 to 51 s for the same code) is wider than the gap between runs here, so part of the difference is the machine, but all three runs here are above #6's median, so the call facts cost something real: about 6 s of parse and 9 s of write at the medians. The margin to the 60 s bar is 3.3 s at the worst run.
- **Not recorded:** the script prints no count of call rows, and the scratch databases were deleted before they could be counted. Calls Benchmark #1's index-side counts are the only row counts this task holds.

## 2026 10 15 MCP Benchmark #5 — S5 with seven tools, and the first calls answer in a fresh process (S14)

- **Target and machine:** VS Code @ `cc3fec88`, the owner's laptop, Node 24.14.0. The owner's index as it stood after Calls Benchmark #1's re-index (adapter version 7), read-only through the server. `NEBULOSITY_LIVE=off`: nothing was sent to any port.
- **Command:** `npm run bench-mcp -- ../vscode` for the table (once) and `npm run bench-mcp -- ../vscode --fresh-calls` for S14's speed half. The `calls` row's inputs are five methods and five types, each with its declaring file as `path`, so every timed answer is the full one; the fresh-process check refuses an answer whose first line is the list of candidates, and stopped for none of its five.
- **Server start** (spawn → initialized): 776 ms.

| Row | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 228 ms | 20 | 61 ms | 74 ms | 78 ms | 2,632 |
| `describe` | 75 ms | 20 | 54 ms | 64 ms | 66 ms | 4,036 |
| `search` | 1646 ms | 20 | 138 ms | 169 ms | 177 ms | 2,440 |
| `imports (dependents)` | 59 ms | 20 | 60 ms | 76 ms | 80 ms | 5,944 |
| `imports (dependencies)` | 51 ms | 20 | 46 ms | 48 ms | 50 ms | 2,491 |
| `imports (to)` | 50 ms | 20 | 47 ms | 58 ms | 58 ms | 323 |
| `imports (group_by)` | 66 ms | 20 | 56 ms | 71 ms | 72 ms | 2,035 |
| `architecture (summary)` | 142 ms | 20 | 136 ms | 147 ms | 148 ms | 1,065 |
| `architecture (cycles)` | 54 ms | 20 | 47 ms | 53 ms | 55 ms | 8,404 |
| `calls` | 804 ms | 20 | 73 ms | 96 ms | 99 ms | 15,951 |
| `show_on_map` | 47 ms | 20 | 47 ms | 52 ms | 62 ms | 167 |

**S5 (every warm call ≤ 500 ms): PASS (worst 177 ms, a `search`).** The `calls` row's warm calls peak at 99 ms; its first call, 804 ms, builds the call index (it is the first `calls` call in the process).

**S14's speed half (the first `calls` call on a fresh server ≤ 1.5 s): PASS, worst 902 ms.** The five fresh servers, each asked `IConfigurationService.getValue` with its declaring file as `path` (a 15,951-character answer): 902, 888, 899, 869 and 875 ms. No fallback (R-B's index-time resolution) is needed, so migration 0010 and the owner's re-index stay unwritten.

- **Against #4:** the rows are the same inputs; the warm worst is 177 ms against #4's 388 ms (#4 ran beside the build session's runaway process), `architecture (summary)` 136 ms p50 against 204 ms. `imports` and `show_on_map` are as fast or faster than #4's.

## 2026 10 16 MCP Dev Set #2 — the shell check and tool use before Eval #3

- **Purpose (V1.7 Tasks 14–16):** before Eval #3's questions exist, check three things on 19 dev questions whose targets Eval #3 does not use (`eval3/dev/questions.json`: 10 on VS Code, 9 on AFFiNE):
  - whether the rules sentence in the prompt stops Claude Code's refused commands (D2's validity condition: at most 1 refused command per arm in 19 runs);
  - whether Claude Code calls Nebulosity's tools, now that `calls` exists;
  - how many tokens the server adds to the first call of a session (gate condition 6: at most 2,500).

  Nothing is scored.
- **Setup:** Claude Code 2.1.301, claude-sonnet-5-5 at medium effort, permission mode `dontAsk`, isolated as Eval #2's runs are, `apiKeySource: "none"`, no owner plugins in any init. Both arms ran each question once (A alone, N with Nebulosity); N's init lists the server connected with seven tools. VS Code at `cc3fec88`, AFFiNE at `0b69a6d`; both repos were clean after every batch. The transcripts are in `eval3/dev/runs/` (round 1 in `round-1/`, round 2 in `round-2/`, round 3 in the folder itself, with `index.jsonl`); each was scrubbed of machine paths by the runner, and `scanForLeaks` over every file found 0 leaks.
- **The guard probe (Task 14, ADR-060):** one live run of `cd /c/…/vscode; git ls-files | wc -l`. It was refused: "Permission to use Bash has been denied because Claude Code is running in don't ask mode." The model stopped there with no workaround. Cost $0.09; kept apart from the dev runs below.

### The shell check

| | alone (A) | with Nebulosity (N) |
|---|---|---|
| Round 1, 19 runs each | 5 refused | 3 refused |
| Round 2, the 6 questions with refusals re-run (plus 3 extra N runs) | 0 in 6 | 1 in 9 (1 in the 6 re-run) |
| **Current state, 19 each** (round 2 where re-run, round 1 otherwise) | **0** | **1** |

D2's bar is at most 1 per arm: round 1 FAILED, the current state PASSES. In no run did a refusal end in a give-up: every refusing run finished with its answer line, and none said it could not do what the refused command was for. Four round-1 runs did say they had not checked every file after swapping the refused loop for Grep (a thoroughness cost).

- **Round 1's eight refusals, by cause:** shell loops 4 (A: VS Code callers, VS Code task, AFFiNE task; N: VS Code transitive, after a `cd` to the scratch folder), `cd` then `git` 2 (VS Code adopt, both arms: `cd src/vs/workbench/services; git grep …`), a pipe into `sed` 1 (N, VS Code task), `cd` plus `node -e` plus a redirect 1 (A, VS Code transitive). No file writes and no `..`. Seven of the eight were on VS Code.
- **Round 2's one refusal:** N, VS Code task, a pipe into `awk` (`… | awk 'NR>0' 2>/dev/null | head -0; git grep …`). The model re-ran the second `git grep` alone and answered. The causes of round 1 did not recur.
- **Round 3's five runs:** 0 refusals.
- **The rules sentence** (placeholders `<repo root>` and `<scratch>`; D2's one allowed rewording, R-L, aimed at round 1's causes).
  - Old: "You're at the repository root, <repo root>: run grep, git grep, git ls-files, ls, cat, head and the like from here, without cd. To compute anything, write a Node.js script into <scratch> with the Write tool (the folder exists) and run it with node, or use node -e. Shell writes (redirects, heredocs, tee, sed -i, mkdir), loops, sed, awk, xargs and paths through .. are refused here. Don't change any file in the repository."
  - New: "You're at the repository root, <repo root>, and every command runs from there: never use cd, not even into a subfolder or the scratch folder, and name paths from the root instead (git grep -n foo -- src/a src/b). Allowed: grep, rg, git grep, git ls-files, git log, git show, ls, cat, head, tail, wc, sort, uniq, find and node, alone or piped into one another. Refused: cd, shell loops (for, while), echo, sed, awk, cut, xargs, redirects, heredocs, tee, mkdir and any path with .. in it. To check many files or compute anything, write a Node.js script into <scratch> with the Write tool (the folder exists) and run it with node and its full path, or use node -e. Don't change any file in the repository."
  - It adds about 90 to 103 tokens to the first call in both arms (the alone arm differs from round 1 only by it), so it cancels in a paired difference.

### Tool use

Share of the 17 non-big-picture questions where the N run called at least one Nebulosity tool (target 16 of 17):

| Round | Runs | Share | ToolSearch calls |
|---|---|---|---|
| 1 | 38 (19 per arm) | 12 of 17 (big-picture: 1 of 2, AFFiNE `search`) | 0 of 38 runs |
| 2 | 15 (9 N) | 12 of 17 (current state) | 0 of 15 |
| 3 | 5 | **13 of 17 (0.76)** | 0 of 5 |

Across all 31 non-big-picture N runs of the three rounds, 17 called a tool (0.55). Claude Code never needed ToolSearch: the six tools are always loaded.

- **The four stable misses** used no Nebulosity tool in any run they had: 0 of 12 across three wordings. Each read the question as "find the lines containing X" and took grep, or its own Node script, as the cheap first move; the transcripts' thinking blocks are empty, and none mentions the tools or the instructions.
  - VS Code task: grepped `openEditor` and `IEditorService`, then wrote a script for which tests import the files (the question is `calls` and `imports`).
  - VS Code injects: one `git grep ICommandService` over the folder, then reads; judged grep enough for injection forms.
  - AFFiNE unused: `git ls-files` plus its own import-resolution script; never considered `architecture` or `imports`.
  - AFFiNE violations: two `git grep desktop` passes over `modules`; never considered `imports`.
- **The questions that flip:** VS Code adopt (miss in round 1, `calls` in round 2) and AFFiNE task (`calls`, miss, `calls`): run-to-run variation, not wording. Wording gained adopt and nothing else.
- **Other notes:** the VS Code breaks run in round 1 got "2 types are named IConfigurationService; pass path …" and never retried with a path (callers did; round 2's callers runs passed `path` first time). Big-picture was not re-run (VS Code bp used no tool).
- **R-J's outcome: the condition was not met.** No `calls` answer had a later page left unread (they listed every file: 19, 22, 26 and 47 files in round 1); the default `limit` stays 50. (Other tools did truncate: `imports` transitive, `architecture` unused and conventions.)
- **The owner's choice at the stop, verbatim:** "ill go with b) asw". Option (b): run Eval #3 as it is and report the tool-use share, instead of (a) more wording. The share is therefore a result of Eval #3 to report, not something the tools were tuned to.

### The first-call difference, paired

The difference is N minus A in the first assistant message's input, cache-creation and cache-read tokens (`firstCallContext`, which the scorer also reads). It is taken per question, within one round. Medians of all N runs minus medians of all A runs are misleading after a rewording: after round 2, N's median (9 round-2 runs) was compared with A's (6 round-2 runs, 13 round-1 runs), a longer prompt against a shorter one, and read +2,415.5 on VS Code and +2,468 on AFFiNE. Paired, the same runs gave +2,393.5 and +2,397.5.

| | VS Code | AFFiNE |
|---|---|---|
| Round 1 (all questions) | +2,398.5 | +2,401 |
| Round 2 (the re-run questions) | +2,393.5 | +2,397.5 |
| Round 3 (the two or five re-run questions) | +2,401 | +2,390 direct; about +2,403 by the round-2 pairing |
| **After this task's trim (estimate)** | **about +2,373** | **about +2,362 to +2,375** |

Run-to-run noise on one question is about 6 tokens. Round 3's 22 extra characters moved the VS Code difference by about 7 tokens, as 2.75 characters a token predicts. All rows are under gate condition 6's 2,500; the trim brings both repos under R-AA's 2,400.

### Every wording change, with the budget after it

The budget is the six always-loaded definitions plus the instructions, in characters, as `registry.test.ts` measures it (bound 6,650; about 2.75 characters a token).

| Change | Budget |
|---|---|
| Task 4 (the planned texts) | 6,614 |
| Round 2 (5a0ce52): the rules sentence reworded; the instructions' second line "before grep or reading many files" became "before grep, a script of your own or reading many files" (four misses wrote their own scripts), and the `calls` bullet gained "even through injected services, where a type is injected"; `calls`' `within` and `offset` descriptions dropped to pay for it | 6,602 |
| Round 3 (1259bc7): the instructions' second line names the question kinds (who calls or injects something, what a change touches and which tests to run, imports against the layers, cycles, files nothing imports); the docs sentence shortened to "Open the docs these answers name before saying how the code is organized or why: they are the maintainers' own account."; `search`'s description cut to "Find where a feature or concept lives: the best files and folders, with their best-matching code." | 6,624 |
| This task: the instructions' closing sentence "Paths are relative to the repo root ("" is the root) or absolute inside it." dropped, because every path input's description says it | **6,548** (instructions 1,339, was 1,415; the definitions 5,209) |
| 2026-10-22, after Eval #3: `calls`' `path`, `group_by` and `within` gain their 1,024-character limit (`"maxLength":1024,` in the schema, 17 characters each; ADR-056 amended) | 6,599 (calls 1,058, was 1,007) |

About 6,548 characters is about 2,380 tokens, so the README's "about 2,400 tokens" stands; 6,599 is about 2,400.

### Runs and cost

58 runs in the three rounds (38, then 15, then 5): $9.29 list price (round 1 $5.04, round 2 $3.65, round 3 $0.60), plus the guard probe's $0.09: 59 runs, about $9.38 in all. The last rate-limit event read 5-hour 0.53, 7-day 0.64.

**In Eval #3** the first-call difference came out at +2,368 (VS Code), +2,369.5 (AFFiNE) and +2,372 (Theia), within 7 tokens of the estimate above. Tool use was 80 of 138 runs (0.58), below the dev set's 13 of 17. The kinds of the dev set's four stable misses went without a tool again (VS Code's tasks, every injects question, files nothing imports and violations), and so did the adopt question and most breaks runs (docs/EVAL_RESULTS.md, Eval #3, "Tool use").

## 2026 10 16 Eval #3 — Claude Code with and without Nebulosity's MCP server on VS Code, AFFiNE and Theia (S13)

The eval V1.7 was measured by (ADR-060). The method, the gate, every run's score, what happened per question and the losses are in `docs/EVAL_RESULTS.md`, Eval #3.
- **Targets and machine:** VS Code @ `cc3fec88`, AFFiNE @ `0b69a6da` and Theia @ `81ea5f93` (held out, free mode), with Nebulosity's engine frozen at `EVAL3_ENGINE` (`2f913ad`) and index versions 155, 134 and 2. It ran on the owner's laptop on 2026-10-16, 06:58–10:17 UTC.
- **How:** `npm run eval:run -- --eval eval3 --pilot` (and `--sessions --pilot`), then the full schedules in batches. 61 single questions and 2 four-question task sessions, three repeats, in two arms: A, Claude Code alone, and N, with Nebulosity. 378 runs in all (384 planned; AFFiNE drew no adopt question and 2 tasks, not 3). Claude Code 2.1.301 headless, `claude-sonnet-5-5` at medium effort, Node.js scripts allowed in both arms, and the same rules sentence at the end of every prompt. `npm run eval:score -- --eval eval3` scored them and computed the gate; the big-picture answers were graded blind (`eval3/grading/`).
- **Result: the ship gate failed** on conditions 1, 2, 3 and 5; V, 4 and 6 passed. **S13: not met.**

| Questions | Repo | Runs per arm | Score A / N | Median time A / N | Time ratio | Median cost A / N | Cost ratio |
|---|---|---|---|---|---|---|---|
| Call and task questions (new) | VS Code | 27 | 0.987 / 0.987 | 35.7 / 35.6 s | 0.98 | $0.132 / $0.132 | 0.98 |
| Call and task questions (new) | AFFiNE | 21 | 1.000 / 0.999 | 35.7 / 34.6 s | 0.93 | $0.138 / $0.119 | 1.01 |
| Call and task questions (new) | Theia | 18 | 0.963 / 0.964 | 37.9 / 38.8 s | 0.88 | $0.247 / $0.241 | 0.98 |
| Theia's graph questions (new) | Theia | 18 | 1.000 / 0.978 | 20.5 / 14.9 s | 0.58 | $0.169 / $0.164 | 0.95 |
| Eval #2's graph questions | VS Code | 27 | 0.979 / 1.000 | 21.1 / 14.1 s | 0.63 | $0.048 / $0.047 | 0.92 |
| Eval #2's graph questions | AFFiNE | 27 | 0.982 / 1.000 | 24.4 / 11.3 s | 0.38 | $0.066 / $0.043 | 0.56 |
| Big-picture | all three | 45 | 0.789 / 0.818 | 16.2 / 15.7 s | 0.94 | $0.049 / $0.049 | 1.00 |

- **The measures:** time is `duration_ms` and the cost is Claude Code's own list-price estimate. The ratios are N over A per question, then the median over the questions (the gate's way).
- **Time to relevant context** (condition 1, the new file-set questions, from process start): median per-question ratios 0.98 [0.90–1.27] on VS Code, 1.01 [0.86–1.14] on AFFiNE and 1.04 [0.33–never] on Theia, against 0.25. On Eval #2's file-set questions, not gated: 0.41 [0.19–0.84] pooled.
- **Refused commands:** 9 of A's 189 runs and 8 of N's, under V's 5% (Eval #2: 81 and 18 of 135), so the comparison is not confounded by them.
- **The totals:** $42.78 by Claude Code's estimate. The 5-hour window read 0.49 at the first run and 0.31 at the last, across one reset; the 7-day went from 0.71 to 0.76.
- **The losses**, named in the results: no faster to the relevant context on the new questions; no faster or cheaper on the call and task questions; 1.36 times A's error on them instead of half (0.983 against 0.988); tools used in 58% of the runs that need them; Theia's direct list (0.87 against 1.00) and what-breaks questions (0.958 against 0.977); and the calls index missing most callers of AFFiNE's drawn methods.

## 2026 10 24 Editor Benchmark #1 — the Map in VS Code: Show Map and follow (V1.8, E1–E2)

- **Why:** V1.8's two bars for the VS Code extension (the V1.8 plan's "The benchmark bars", design §8 step 6). E1 is Show Map, from the command to the first drawn Map. E2 is an editor switch, until the Map shows that file selected.
- **Target and machine:** VS Code @ `cc3fec88`, opened as the workspace. Its working tree, index and HEAD were not changed. In the first run, VS Code's built-in git extension wrote one key into `.git/config`; runs 4 and 5 turned git off and wrote nothing (see "The VS Code" below). The owner's laptop: AMD Ryzen 7 260 (8 cores, 16 threads), 31.3 GB, Windows 11 Home 10.0.26200, on mains power, a 1920 × 1200 display at 144 Hz, Node 24.14.0. The machine was otherwise quiet (13% CPU load before the runs). The owner's VS Code and the servers on ports 3000 and 3200 were running, and none of them was touched.
- **The VS Code:** 1.143.1, with Electron 43.7.7 and Node 24.21.0 in its extension host.
  - It's the stable version `@vscode/test-electron` downloaded for Task 9, pinned with `NEB_TEST_VSCODE=1.143.1`, so nothing new was downloaded.
  - It ran with a fresh user data dir, `--disable-extensions` and the harness's four Chromium flags against throttling. The built-in TypeScript extension ran, as it does in anyone's window. The built-in git extension ran too, and opened the repo in runs 0–3.
  - **The git extension wrote into `../vscode/.git/config`.** It added `vscode-merge-base = origin/main` to `[branch "main"]` at 01:49:54 −04:00, 3.5 s after the first run's VS Code started, as it does when it opens a repo. The working tree, `.git/index` and `.git/HEAD` are unchanged. The key was left in place for the owner to keep or remove.
  - **Since then, the bench's user settings turn git off,** with `"git.enabled": false` and `"git.autoRepositoryDetection": false` (`vscode-extension/test/launch.ts`). Runs 4 and 5 ran that way.
    - A flag can't do it. The harness passes `--disable-extensions`, and with it VS Code 1.143.1 ignores `--disable-extension <id>` (its `disableExtensions` is then `true`, not the list), so built-in extensions stay on.
    - With `git.enabled` off, git still activates but opens no repository. Its own API reported `enabled: false` at the start and the end of both runs, and the bench now fails at the start if it doesn't.
    - `.git/config`'s sha256 (`12939de9…`) and modified time (01:49:54) were the same before and after both runs, and `find ../vscode -newer <marker>` listed nothing.
    - The key was already there, so an unchanged hash alone couldn't show that git stayed off; git's own `enabled: false` is the check.
    - The integration tests leave git as it is, since their copy has no `.git`.
  - Its window stayed in front throughout.
- **The Map:** the V1.8 sandbox at `76c949c`, a production build (`next build`). The extension started it itself, as `node <sandbox>/bin/nebulosity.mjs map --port 3126` with `NEBULOSITY_WORKER=off`.
  - Its data folder was a scratch folder under `%TEMP%` (`NEBULOSITY_DATA`).
  - That folder held a fresh index of `../vscode` made for this benchmark in free mode (no API key, nothing spent): 14,849 files, 87.3 s.
- **Command** (in `vscode-extension/`, with `NEBULOSITY_HOME` unset): `NEB_BENCH=1 NEB_TEST_WORKSPACE=<…>/vscode NEB_TEST_COMMAND=<sandbox>/bin/nebulosity.mjs NEB_TEST_PORT=3126 NEB_TEST_VSCODE=1.143.1 NEBULOSITY_DATA=<scratch> NEBULOSITY_WORKER=off NEBULOSITY_LIVE=off npm run test:integration`.
  - `NEB_TEST_WORKSPACE` has to be an absolute path (here `C:/Users/Andrew/Programming/vscode`). `runTest.ts` resolves it against `vscode-extension/`, where `../vscode` names no folder.
  - With `NEB_BENCH=1`, `runTest.ts` runs `test/bench/bench.test.ts` instead of the integration tests. It refuses a git repo as the integration tests' workspace, since those tests write a file.
  - Runs 1–3 ran one after another (01:51–01:52), about 24 s each, with git on. Runs 4 and 5 ran at 02:15 and 02:17, with git off and the Map's sandbox and scratch index unchanged.
- **How it's timed:** in the extension host, with `performance.now()`. Every wait for a `nebulosity.drawn` starts before its action, and a message's time is taken as it arrives. In order:
  - **Cold (no bar):** nothing on 3126, then Show Map → the first `drawn`. The extension starts the Map, and that server stays up for the rest of the run.
  - **E1, 5 times:** the panel is closed (`api.closePanel()`, then 1 s), then `nebulosity.showMap` is executed and timed to the first `drawn`.
    - Nothing was open in the editor, so each Show Map split the editor area and opened the panel in column 2 (Task 9's fix), and each first `drawn` was the one sent after `ready` (P1's case c) for the top level.
    - So E1 times the top-level draw only. With a file open, the Map then follows it and draws that file's level with a second `drawn`, which E1 doesn't count; that follow is E2's kind of step. "Show Map in 130 ms" means the Map is on screen, not that it shows your file yet.
  - **E2, the files:** 20 of `src/vs/base/common/event.ts`' 8,586 dependents, from `GET /api/imports?path=src/vs/base/common/event.ts&transitive=true`, in its order (nearest first). The 10 inside the folder the Map draws come first (in `src/vs/base/common`: `async`, `cancellation`, `actions`, `scrollable`, `paging`, `history`, `sequence`, `ime`, `arrays`, `errorMessage`). Then the first 10 in other folders: `platform/log/common/log`, `platform/configuration/common/configuration`, `base/browser/dom`, `platform/contextkey/common/contextkey`, `platform/files/common/files`, `platform/storage/common/storage`, `platform/actions/common/actions`, `platform/commands/common/commands`, `editor/common/model` and `workbench/services/editor/common/editorService`, all under `src/vs/`.
  - **E2, the timing:** each switch is timed from `showTextDocument(file)` resolved (focused, in the active column, which is column 1) to the `drawn` whose `selected` is that file.
    - Each pass starts with a switch to `event.ts` that isn't timed, so the 10 switches inside its folder start on that folder.
    - There are two passes, and the second is the measured one; the first is the cold one.
    - p50 and p95 are nearest-rank, as `bench-mcp.ts` takes them: of 20, the 10th and the 19th; of 10, p95 is the slowest.

| Run | E1: Show Map → first `drawn`, 5 times | Worst | Cold Show Map (no bar) |
|---|---|---|---|
| 1 | 128.0, 119.3, 122.0, 129.9, 117.9 ms | 129.9 ms | 2,115.7 ms |
| 2 | 122.5, 118.6, 124.2, 126.9, 119.4 ms | 126.9 ms | 2,103.9 ms |
| 3 | 152.6, 123.6, 132.0, 123.8, 128.2 ms | 152.6 ms | 2,020.8 ms |
| 4 (git off) | 184.6, 192.7, 193.7, 202.2, 185.8 ms | 202.2 ms | 2,217.8 ms |
| 5 (git off) | 134.9, 138.6, 151.1, 175.4, 140.8 ms | 175.4 ms | 2,063.8 ms |

**E1 (worst of 5 ≤ 2,000 ms): PASS** in every run. The worst was 202.2 ms (run 4).

| Run | Pass | p50 | p95 | max | Inside `common`: p50 / p95 | Other folders: p50 / p95 |
|---|---|---|---|---|---|---|
| 1 | second (E2) | 179.8 ms | 216.5 ms | 227.9 ms | 173.5 / 216.5 ms | 182.5 / 227.9 ms |
| 2 | second (E2) | 181.6 ms | 216.1 ms | 220.8 ms | 175.9 / 216.1 ms | 183.4 / 220.8 ms |
| 3 | second (E2) | 181.7 ms | 215.3 ms | 216.7 ms | 176.1 / 215.3 ms | 184.0 / 216.7 ms |
| 4 (git off) | second (E2) | 188.3 ms | 259.7 ms | 277.5 ms | 173.5 / 277.5 ms | 188.3 / 251.6 ms |
| 5 (git off) | second (E2) | 184.2 ms | 234.9 ms | 240.0 ms | 172.2 / 234.9 ms | 184.9 / 240.0 ms |
| 1 | first, cold (no bar) | 186.9 ms | 380.9 ms | 419.3 ms | 167.4 / 244.3 ms | 186.9 / 419.3 ms |
| 2 | first, cold (no bar) | 195.4 ms | 353.2 ms | 388.2 ms | 162.4 / 246.0 ms | 211.5 / 388.2 ms |
| 3 | first, cold (no bar) | 186.4 ms | 286.4 ms | 419.7 ms | 169.5 / 246.1 ms | 196.7 / 419.7 ms |
| 4 (git off) | first, cold (no bar) | 196.4 ms | 477.8 ms | 805.5 ms | 173.1 / 805.5 ms | 196.4 / 280.9 ms |
| 5 (git off) | first, cold (no bar) | 193.8 ms | 354.8 ms | 568.7 ms | 167.3 / 337.3 ms | 195.0 / 568.7 ms |

**E2 (p95 of 20 switches ≤ 500 ms, the second pass): PASS** in every run. The p95 was 259.7 ms at worst (run 4).

The same switches counted from the `showTextDocument` call, which is the wait a person sees (no bar; the bar counts from resolved):

| Run | Pass | p50 | p95 | max |
|---|---|---|---|---|
| 1 | second | 201.1 ms | 241.5 ms | 247.2 ms |
| 2 | second | 203.4 ms | 237.9 ms | 242.0 ms |
| 3 | second | 203.1 ms | 239.0 ms | 241.9 ms |
| 4 (git off) | second | 221.0 ms | 289.9 ms | 309.8 ms |
| 5 (git off) | second | 211.6 ms | 263.2 ms | 268.0 ms |
| 1 | first, cold | 235.2 ms | 692.6 ms | 698.5 ms |
| 2 | first, cold | 244.7 ms | 682.4 ms | 704.4 ms |
| 3 | first, cold | 236.6 ms | 584.1 ms | 658.3 ms |
| 4 (git off) | first, cold | 271.8 ms | 1,134.1 ms | 1,667.1 ms |
| 5 (git off) | first, cold | 250.9 ms | 944.4 ms | 950.0 ms |

From the call, the cold pass goes over 500 ms (p95 584–693 ms in runs 1–3, 944–1,134 ms in runs 4–5), because `showTextDocument` itself took up to 372 ms on a file's first open in runs 1–3 and up to 976 ms in runs 4–5.

To read this with:
- **Most of E2 is the debounce.** In runs 1–3 every warm switch took 159–228 ms, and 150 ms of that is the follow debounce (`FOLLOW_DEBOUNCE_MS`). The debounce starts at VS Code's editor change, no later than `showTextDocument` resolves, so the rest takes at least 9–78 ms: the follow is posted, the Map draws the level or page and sends `drawn`. Counted from the `showTextDocument` call, the warm passes' slowest switch was 247.2 ms (the call itself took at most 32 ms).
- **Runs 4 and 5 (git off) came out somewhat slower:** E1 worst 202.2 and 175.4 ms against 126.9–152.6, and E2 p95 259.7 and 234.9 ms against 215.3–216.5.
  - They ran 25 minutes later on a busier machine at moments: a CPU sample just before run 5 read 59%, against 13% before run 1, and Windows Search's indexer was working right after it.
  - The two differ from each other by as much as from runs 1–3, so nothing ties the change to git being off.
  - Both bars hold in both runs, by about 10× for E1 and 2× for E2.
- **What each switch drew:** 14 of the 20 drew a new level or page, and 6 only moved the selection, the same in every pass of every run. `src/vs/base/common` is paged (pages 0–2), so 4 of the 10 switches inside it turned a page. All 10 others drew another folder.
- **The cold pass:**
  - Its slowest switches were the first visits to busy folders: `src/vs/base/browser` (388–420 ms), then `platform/contextkey/common` and `platform/configuration/common` (270–381 ms).
  - There, `showTextDocument` took up to 372 ms itself in runs 1–3 (976 ms in runs 4–5), and VS Code's editor change came before it resolved. So switches timed from resolved can come in under the 150 ms debounce (107–126 ms at the least).
  - The cold Show Map, 2.0–2.1 s, covers `nebulosity map`'s start through `next start`, the start poll (every 500 ms), the repo step, the page and the first level. The disk cache was warm from the index build, so a first start after a reboot would be slower.
- **A first run** with the bench file before a log-only change (the built-in extensions' line) gave the same: cold 2,148.7 ms, E1 worst 148.8 ms, E2 p95 216.5 ms. Its log is in the V1.8 ledger beside the three above (`evidence/task-10/`).
- **Afterwards:**
  - After every run, nothing listened on 3126: the bench stops the Map in its teardown, and VS Code's exit would stop it too.
  - The checkout's `.nebulosity/config.json` was byte-identical to the copy taken before V1.8's runs (`cmp`).
  - `git --no-optional-locks status` in `../vscode` was unchanged, still at `cc3fec88`, and no data folder was written there. The one write into `../vscode` was the git extension's `.git/config` key in run 0, above. `git status` doesn't show it, and the review found it from the file's modified time. Runs 4 and 5 left the file's hash and modified time as they were.
