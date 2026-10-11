# DATABASE_DESIGN.md — Embedded Relational Storage (SQLite + Drizzle)

> **2026-10-11 — pivot:** the schema is extended (folders, level_edges, symbols, summaries, summary_vectors, FTS5), the chunk `vectors` table retires, and every write is batched under SQLite's 32,766-parameter cap. See `PIVOT_SPEC.md` §4; this doc is rewritten in slice V1.1.

**Status:** Approved design, implemented 2026-07-12 (schema live, wired to the app in Phase D)
**Supersedes:** the JSON file store (see ADR-006 → ADR-013 in `ENGINEERING_DECISIONS.md`)
**Source of truth in code:** `lib/db/schema.ts`. This doc explains the design; the schema file *is* the schema. Keep both in sync per the maintenance rule.

---

## 1. Shape of the layer

One embedded SQLite database at `.nebulosity/nebulosity.db` (gitignored — derived data, like `node_modules`). Accessed exclusively through three modules:

| Module | Job |
|---|---|
| `lib/db/schema.ts` | Table definitions (Drizzle). The only place persistence shapes live. |
| `lib/db/client.ts` | The single connection factory (`getDb()`): WAL mode, foreign keys ON, connection cached on `globalThis` to survive Next.js hot reload. |
| `lib/db/graph-store.ts` | Graph persistence operations: `saveScan` (transactional replace) and `loadGraph`. RAG operations join it in Phases 2–4. |

No other file may open the database or embed SQL. This is the seam the whole layer swaps through.

**Why SQLite and not the old JSON files** (the interview version): transactions make a half-saved graph impossible, unique indexes enforce dedupe in the schema instead of application `Set`s, the agent's structural tools become indexed lookups, multi-repo support becomes a `WHERE` clause, and the future desktop app inherits its natural storage engine. Full trade-off record: ADR-013.

**Why `better-sqlite3` (synchronous)**: for an embedded single-user database, synchronous is a feature — no connection pool, no async ceremony, and transactions are plain function calls. Practical Drizzle note: with this driver, statements execute via `.get()` / `.all()` / `.run()`, not `await`.

## 2. The schema (normalized, three core tables + three support tables)

```
repositories 1 ──── * files 1 ──── * chunks 1 ──── 1 vectors
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

### vectors (used from Phase 3)
One BLOB per chunk: the raw bytes of a `Float32Array` (384 × 4 = 1,536 bytes/row — roughly 4× smaller than the JSON encoding and zero parse cost). Retrieval is unchanged from the original design: load into memory once, brute-force dot products (that half of ADR-006 still stands).

### meta + sessions
`meta` is key/value bookkeeping (`schemaVersion`, `embeddingModel`, `embeddingDim`); a mismatch at startup means wipe-and-rebuild derived data — the same invalidation contract the manifest carried. `sessions` is reserved for v1.1 chat persistence.

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
