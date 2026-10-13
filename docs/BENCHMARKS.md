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

