# DATABASE_DESIGN.md — Embedded Relational Storage (SQLite + Drizzle)

> **2026-10-11 — pivot:** the schema is extended (folders, level_edges, symbols, summaries, summary_vectors, FTS5), the chunk `vectors` table retires, and every write is batched under SQLite's 32,766-parameter cap. See `PIVOT_SPEC.md` §4; §7 documents the V1.1 additions and §8 the V1.2 ones.

**Status:** Approved design, implemented 2026-07-12 (schema live, wired to the app in Phase D)
**Supersedes:** the JSON file store (see ADR-006 → ADR-013 in `ENGINEERING_DECISIONS.md`)
**Source of truth in code:** `lib/db/schema.ts`. This doc explains the design; the schema file *is* the schema. Keep both in sync per the maintenance rule.

---

## 1. Shape of the layer

One embedded SQLite database at `.nebulosity/nebulosity.db` under `NEBULOSITY_HOME` (gitignored — derived data, like `node_modules`). Accessed exclusively through these modules:

| Module | Job |
|---|---|
| `lib/db/schema.ts` | Table definitions (Drizzle). The only place persistence shapes live. |
| `lib/db/client.ts` | The single connection factory (`getDb()`): WAL mode with `synchronous = NORMAL` (§7), foreign keys ON, paths resolved from `NEBULOSITY_HOME` (`lib/home.ts`), connection cached on `globalThis` to survive Next.js hot reload. `openDb(file, mode)`; the MCP server opens read-only, with no pragmas and no migrations, and refuses a file behind the checkout's migrations (ADR-044). |
| `lib/db/batch.ts` | Splits every bulk insert under SQLite's 32,766-parameter cap (§7). |
| `lib/db/store/lock.ts` | The shared indexing and summarizing locks. A row names its holder (`<started> pid <pid> on <host>`) and is abandoned at once when that process is gone, or after 30 minutes. |
| `lib/db/store/structure.ts` | Persistence for one structure run of the V1.1 engine: batched, failure-isolated file writes, the import graph, folders and level edges. |
| `lib/db/store/summaries.ts` | Summary rows, batches and usage. |
| `lib/db/store/summary-vectors.ts` | Search vectors and their counts. |
| `lib/db/store/search.ts` | The FTS queries. |
| `lib/db/store/stages.ts` | Stage rows. |
| `lib/db/store/map.ts` | The Map's reads. |
| `lib/db/store/version.ts` | The index version. |

No other file may open the database or embed SQL. This is the seam the whole layer swaps through.

**Why SQLite and not the old JSON files** (the interview version): transactions make a half-saved graph impossible, unique indexes enforce dedupe in the schema instead of application `Set`s, the agent's structural tools become indexed lookups, multi-repo support becomes a `WHERE` clause, and the future desktop app inherits its natural storage engine. Full trade-off record: ADR-013.

**Why `better-sqlite3` (synchronous)**: for an embedded single-user database, synchronous is a feature — no connection pool, no async ceremony, and transactions are plain function calls. Practical Drizzle note: with this driver, statements execute via `.get()` / `.all()` / `.run()`, not `await`.

## 2. The schema (normalized, three core tables + three support tables)

```
repositories 1 ──── * files 1 ──── * chunks (chunk vectors retired in V1.3)
                      │
                      * imports (source_file_id → target_file_id)
```

### repositories
One row per scanned codebase. `root_path` unique. Carries `last_scan_at` / `last_index_at` timestamps. Today there is one row (Nebulosity itself); the table is what makes multi-repo a query instead of a re-architecture.

### files — the graph nodes
`(repo_id, path)` unique. `path` is the project-relative forward-slash id used everywhere (React Flow node ids, tool args, citations — the "one shared identifier" law from `lib/contracts.ts`). `kind` is the component/module classification. `content_hash` (sha256) is the incremental-indexing diff key — the job the old JSON manifest used to do.

### imports — the graph edges
Directed: `source_file_id` imports `target_file_id`, with the raw `specifier` text preserved for debugging. Only *resolved* imports become rows (bare npm specifiers never enter, same rule as today). Two deliberate indexes: unique `(source, target)` enforces the one-edge-per-pair rule in the schema, and an index on `target_file_id` makes `get_importers()` — the agent's hottest structural query — an index scan.

### chunks (used from Phase 2)
Mirrors `CodeChunk` in `lib/contracts.ts`, keyed by the stable `${path}#${name}#${part}` id so vectors survive re-indexing of unchanged files. Cascades from `files`.

### vectors
Retired in V1.3 (migration 0005, ADR-040). Search vectors are per summary: `summary_vectors`, §8.

### meta + sessions
`meta` is key/value bookkeeping: the locks, each stage's status, and each repo's index version. `sessions` is reserved for v1.1 chat persistence.

## 3. Write discipline

- **One scan = one transaction** (`saveScan`): upsert the repo row, delete its files (cascade clears edges, and later chunks/vectors), bulk-insert files, map paths → ids, bulk-insert edges. Any throw anywhere rolls the whole thing back — the previous graph survives untouched. Delete-then-insert over diffing is deliberate at v1 scale; revisit only if scans get slow on huge repos.
- **WAL journal mode** so a page load can read while an index run writes.
- **Foreign keys ON** (SQLite defaults them off) so the cascade rules in the schema actually fire.
- Edges referencing unscanned paths are skipped, not fatal — mirrors the resolver's silent-drop rule. Duplicate edges are swallowed by `onConflictDoNothing` against the unique index.

## 4. Migrations

Dev loop: edit `lib/db/schema.ts` → `npx drizzle-kit push`. When the schema stabilizes (Phase D done), switch to `npx drizzle-kit generate` for versioned migration files in `lib/db/migrations/`. Config: `drizzle.config.ts`.

## 5. Corruption and recovery

Everything in `.nebulosity/` is derived. Recovery from any corruption, version mismatch, or doubt: delete the directory, re-run scan/index. Never attempt partial repair. (This property is why sessions — the one *non*-derived table — stays empty until v1.1 makes a deliberate decision about it.)

## 6. What deliberately does NOT get stored

- **React Flow node positions for the radial layout** — derived deterministically, same input → same picture. When ADR-011's dagre layout lands, cached positions get a small table here, keyed by graph hash.
- **API keys or user config** — `.env.local` only. The database stays secret-free, always safe to zip as a debug artifact.
- **The rendered graph shape** (`GraphResponse`) — assembled per request from `loadGraph` + `lib/graph.ts`; storing it would just add an invalidation problem.

## 7. Pivot additions (slice V1.1, `PIVOT_SPEC.md` §4)

- **`files`** gains `language` (`typescript` or `javascript`, by extension), `size_bytes`, `line_count`, `is_test` and `import_specifiers` (a JSON array of the raw specifiers). Storing the specifiers lets an incremental run re-resolve *every* file's imports, because a new or deleted file can change what `"../core"` points at, while re-parsing only the files whose hash changed.
- **`chunks.chunk_id`** is unique per file (`(file_id, chunk_id)`), not globally. With many repos in one database, two of them can both contain `src/index.ts#start#0`.
- **`symbols`** has one row per top-level declaration and per class member: `name`, `qualified_name` (`Logger.info`), `kind`, `start_line`/`end_line`, `exported` and `parent_qualified_name`. The line range covers the declaration itself, excluding its doc comment, because it's used for jumping to a definition.
- **`folders`** is the folder tree of the indexed files: `path` (`""` is the repo root), `parent_path`, `depth`, `name`, `file_count` (recursive) and `direct_file_count`.
- **`level_edges`** holds the Map's lines, precomputed. Each file→file import is counted exactly once, at the deepest folder containing both files: `level_path`, `source_node`/`target_node` (children of that folder: a subfolder, or the file itself when it sits directly inside) and `count`.
- **`repositories.indexed_head`** records the git commit the last run saw.
- **Write discipline.** Every bulk insert goes through `lib/db/batch.ts`, which splits rows so no statement exceeds SQLite's 32,766 bound parameters. Drizzle binds every column, defaults included, so the cost per row is the table's column count. Repo-wide deletes use a subquery, never an `IN (...)` list of every id.
- **Durability.** `client.ts` pairs WAL with `synchronous = NORMAL`, SQLite's recommended setting for WAL: commits stop waiting for an fsync, which matters for an indexer that commits a batch every 500 files. A power cut or OS crash can roll back the last few commits but never corrupts the file. That trade is safe because everything here is derived: a lost commit means its content hashes were never written either, so the next run re-indexes those files (ADR-022).

## 8. V1.2 additions (summaries and search, `PIVOT_SPEC.md` §4.1, §5.3–5.4)

- **`summaries`**: one row per file, folder and the repo (`target_kind` + `target_path`, unique per repo; `""` is the repo). It holds `tagline` (3–6 words asked for; up to 8 kept whole), `summary` (2–4 sentences), `model` (the model that wrote it, or `template`), `input_hash` (the input that text answers), `status` and `error`. Statuses:
  - `fresh`: the text matches the current input.
  - `stale`: text from an older input, kept on show until it's redone.
  - `pending`: no text yet.
  - `failed`: the last attempt failed; the next run retries it.
  - `skipped`: test files, which get a template instead of a model call.

  Rows are keyed by path, never by id, because folders are rebuilt wholesale on every structure run. Two more columns make long Batch runs resumable without a jobs table: `batch_id` (the Message Batch carrying this row's request) and `pending_hash` (the input that request answers). An answer only lands if its batch still owns the row.
- **`summary_vectors`**: one MiniLM vector per model-written summary (`summary_id` unique, cascading), stored with the ADR-017 encode/decode pair. Rewriting a summary deletes its vector; the embeddings stage refills whatever is missing.
- **`summary_usage`**: API tokens per repo, model and transport (`direct` or `batch`), added up with an upsert as answers arrive. Success criterion S2 is read from here.
- **`chunks.name_split`**: the chunk's name as lowercase words (`openEditor` → `open editor`), so a word search finds camelCase names.
- **Search indexes.** `code_fts` (FTS5 over `path`, `name`, `name_split`, `text`; rowid = `chunks.id`) and `summary_fts` (FTS5 over `path`, `tagline`, `summary`; rowid = `summaries.id`), both with the `porter unicode61` tokenizer.
  - **Triggers keep them in sync (ADR-031).** Every chunk insert adds its row. Every chunk delete removes it, whatever caused the delete: a re-parse, a deleted file, a deleted repository (`ON DELETE CASCADE` fires triggers too).
  - A summary is indexed once it has text and re-indexed when the text changes (`AFTER UPDATE OF tagline, summary`), so status-only updates cost nothing.
  - Each table stores its `bm25` column weights as its `rank` (code: path 2, name 10, name_split 6, text 1; summaries: path 1, tagline 4, summary 2), so queries just `ORDER BY rank`.
- **Migration 0004 clears every `files.content_hash`, once.** Chunks written before it have no `code_fts` rows, so the next `npm run index` re-parses every file and the triggers fill the index.
- **Stage status** lives in `meta` as `stage:<repoId>:<stage>` → `{ state, done, total, note? }`, written by each stage as it goes (`API_CONTRACTS.md` §9, ADR-032).
- **The `summarizing` lock** is a second `meta` lock row, taken by summary runs (ADR-033). Indexing can go on during a summary run; two summary runs can't, because both would pay for the same summaries. A run waiting on batches refreshes it, so it never looks abandoned.

## 9. V1.3 additions (the Map, incremental updates, `PIVOT_SPEC.md` §5.6, §7)

- **The index version** is a `meta` row per repo, `indexVersion:<repoId>`: a counter bumped by one statement whenever anything the Map shows changes. That covers the end of a structure run, an incremental update, and any summary write that creates, rewrites or prunes a row or changes its status. Level and describe answers carry it, so readers cache per version and the Map refetches when it moves (ADR-036).
- **Stage rows stay current.** The summaries stage's row is rewritten from a fresh plan after every structure change and every "summarize now" (`refreshSummaryStatus`). The embeddings stage's counts are read live from `summaries` and `summary_vectors`, not from its row (ADR-032, amended).
- **A vector always matches its summary's text.** It's stored only if the summary's `input_hash` is still the one it was computed for, and a template written over model text deletes the old vector (ADR-027, amended).
- **Incremental writes** (ADR-037). The background worker's structure updates write only differences: import rows deleted and inserted, `level_edges` counts moved by ±1 per import (a row that reaches 0 is deleted), folder rows synced, and summaries of vanished targets pruned. All of it in one transaction, apart from the file rows themselves.
- **Chunk vectors dropped** (migration 0005): their only writer, the Phase 2 pipeline, is gone (ADR-040).

## 10. V1.6 additions (works on your repo)

- **`entry_points`** (migration 0007, ADR-053): the files a `package.json` names as entry points, one row per file per repo (`(repo_id, path)` unique, cascading with the repo). Columns: `path` (the source file, repo-relative) and `declared_by` (the manifest and field that named it: `packages/core/package.json main`, `packages/ui/package.json exports "."`, `package.json bin`). The fields read are the `"."` export, `main`, `module`, `types`, `typings` and `bin`, each mapped from a compiled path to its source through any tsconfig that sets both `outDir` and `rootDir`; a target with no source file in the index gives no row, and the first field to name a file is the one kept. Every `package.json` outside `node_modules` counts here, declared workspace or not. No other file is called an entry point (R8): a file nothing imports is reported as that, never as dead.
  - **Written wholesale** (`replaceEntryPoints`): by every full run, and by an incremental update that re-resolves every file (the file set changed, or a tsconfig, a `package.json` or a workspace declaration did). It's derived data, like everything here.
  - **Read** as a set of paths (`loadEntryPoints`): the impact and unused-files answers tell an entry point from a file nothing imports.
- **`docs` and `doc_links`** (migration 0008, ADR-054): the repo's Markdown docs and which folders and files they talk about. `docs` has one row per doc (`(repo_id, path)` unique, cascading with the repo): `path` and `title` (the first level-one heading, else the file name). `doc_links` has one row per doc and target and kind: `doc_path`, `target_path` (a folder or file; "" is the repo), `kind` (`applies`, `readme`, `mentions`), `count` (mentions of that path) and `detail` (the glob, for `applies`), indexed on `(repo_id, target_path)`. Both are replaced wholesale (`replaceDocs`) by every full run, which reads every doc whatever the adapter version (R7); an incremental update leaves them alone.
- **The adapter version** is a `meta` row per repo, `adapterVersion:<repoId>`: the TypeScript adapter's `ADAPTER_VERSION` that the repo's last full run parsed its files with (ADR-053). A full run that finds an older one, or none, parses every file again whatever its content hash and then records the current one. Without it, a file whose bytes haven't changed would keep what an older adapter stored for it: after computed `import()` was added, VS Code's warm re-index kept 140,245 edges instead of 140,248. Content hashes are left as they are, so summaries, whose inputs are keyed on them, stay fresh. (Migration 0004 forced its re-parse by clearing every hash; that would now mark every file summary failed in a summary run that came before the next index.)
