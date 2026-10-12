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
