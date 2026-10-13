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

| Tool | First call | Warm calls | p50 | p95 | max | Largest answer (chars) |
|---|---|---|---|---|---|---|
| `overview` | 336 ms | 20 | 55 ms | 57 ms | 66 ms | 2,195 |
| `describe` | 58 ms | 20 | 46 ms | 62 ms | 66 ms | 3,403 |
| `search` | 1676 ms | 20 | 170 ms | 256 ms | 261 ms | 2,467 |
| `dependents` | 75 ms | 20 | 62 ms | 67 ms | 70 ms | 3,811 |
| `dependencies` | 61 ms | 20 | 68 ms | 80 ms | 89 ms | 2,491 |
| `path` | 75 ms | 20 | 67 ms | 77 ms | 83 ms | 323 |
| `show_on_map` | 66 ms | 20 | 64 ms | 78 ms | 79 ms | 167 |

**S5 (every warm call ≤ 500 ms): PASS (worst 261 ms, a `search`).** The first `search` (1,676 ms) loads the MiniLM model inside the server; the first `overview` (336 ms) loads the import graph and builds the reach index, which every later tool shares, so `describe`, `dependents`, `dependencies` and `path` show no cold cost because `overview` is the first call of the run. Every answer is far under the 40,000-character bound (largest 3,811). The model's only output was one line on stderr (`[embed] loading Xenova/all-MiniLM-L6-v2…`); stdout carried protocol messages only, and the run had no transport error.
- **Where a warm call's time goes:** the floor is a p50 of 46–68 ms even for a 167-character answer. About 38 ms of it is `setupCall`, which every call runs (measured in-process: min 37.4, median 38.8, max 44.8 ms over 20 calls): its `readIndexStatus` counts embedded and embeddable rows (about 19 ms each on the 12,939-vector index), and the rest of the setup (config, repo list, stages, version) takes under a millisecond.
- **The reach index** (ADR-045, in-process): graph load plus index build 75.5 ms cold (the build alone about 3 ms), then free; 139,580 imports in each direction; the five typed arrays total 1,294,776 bytes (1.29 MB); one `reach` of `src/vs/base/common/lifecycle.ts` for dependents (8,549 files) takes a median 1.7 ms (max 6.7 ms) warm.

## 2026 10 13 MCP Smoke Test #1 — every tool once through claude -p (V1.4)

- **Command:** `claude -p` from `../vscode` on Sonnet (`--model sonnet`; the transcript's init line names `claude-sonnet-5-5`), with only Nebulosity's server (`--strict-mcp-config`, live events off through `NEBULOSITY_LIVE=off`), no built-in tools (`--tools ""`, `ENABLE_TOOL_SEARCH=false`), and `--allowedTools mcp__nebulosity`. The prompt asks for each of the seven tools once, in order, then for seven lines saying OK or the error.
- **Claude Code** 2.1.296; registered with `claude mcp add --scope local` from `../vscode`. `claude mcp get nebulosity` and `claude mcp list` both showed it connected, and the run's init line showed the server connected with exactly the seven `mcp__nebulosity__*` tools offered.

| Tool | Called | Result |
|---|---|---|
| `overview` | yes | ok |
| `describe` | yes | ok |
| `search` | yes | ok |
| `dependents` | yes | ok |
| `dependencies` | yes | ok |
| `path` | yes | ok |
| `show_on_map` | yes | ok |

`show_on_map` answered that nothing was sent to the Map because live events were off (`NEBULOSITY_LIVE=off`), as intended for this run; it is the tool's no-Map answer, not an error.

8 turns; token usage as the run's result reported it: input 4, cache creation 10,596, cache read 6,221, output 748; wall time 6.2 s; Claude Code's estimate $0.05 (0.0504941). Runs used: 1 of the 1–2 the owner approved (no retry needed). No live run: the owner declined it.
