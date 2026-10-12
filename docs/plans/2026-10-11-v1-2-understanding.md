# V1.2 Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every indexed repo tiered summaries (Haiku 5.5 for files; Sonnet 5.5 for folders and the repo; the Batch API for the first pass, the regular API on demand), summary embeddings, code and summary full-text indexes, hybrid search fused with RRF, and a `GET /api/status` that reports each stage honestly. Fix the six V1.1 leftovers first.

**Architecture:** The structure stage now also fills a code FTS5 index. SQLite triggers keep both FTS indexes in sync with their source rows. Summaries are planned by a pure function (`planSummaries`) and sent in bottom-up waves. Each wave picks its own transport: the Batch API for 100+ requests, the regular API below that. Batch ids live on the summary rows, so an interrupted run resumes instead of resending. Claude sits behind a `Summarizer` interface, so tests use a stub and make no network calls. Embeddings reuse the Phase 3 MiniLM plumbing over summaries. Search fuses three ranked lists of files and folders with Reciprocal Rank Fusion. Every stage records its status in `meta`.

**Tech Stack:** TypeScript 5, better-sqlite3 + Drizzle (SQLite 3.53 with FTS5), `@anthropic-ai/sdk` 0.133 (the only new dependency), the existing MiniLM pipeline (`@huggingface/transformers`), zod 4, Vitest, tsx.

**Spec:** `docs/PIVOT_SPEC.md`: slice V1.2 (§12), §5.3 summaries, §5.4 embeddings, §5.7 status, §6.1 search. Decisions ADR-027 and ADR-028; this plan adds ADR-031 → ADR-033. It builds on the V1.1 plan (`docs/plans/2026-10-11-v1-1-engine-foundation.md`), whose fixture ground truth still holds.

## Global Constraints

- **Branch:** `pivot/v1`. **After every completed step that changes files (each fix, each task, each doc update), commit and push:** `git push origin pivot/v1`.
- **Stage only the files the step names** (`git add <paths>`). **Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`**: they're the owner's work in progress.
- **Commit messages** use a conventional prefix (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`). **No `Co-Authored-By` line and no Claude attribution of any kind.**
- **Gate before every commit:** `npx tsc --noEmit && npm run lint && npx vitest run`. Lint *warnings* are fine (the `setEdges` warning in `GraphCanvas` predates this plan); errors are not. The baseline is 126 passing tests; each task states the new total.
- **Test expectations are derived by hand** from the fixture and the "Summary ground truth" below. Never run the code and paste its output into a test.
- **No network in tests.** Claude goes through a stub `Summarizer` (`test/helpers/summarizer.ts`); new embedding tests pass a fake `EmbedFn`. (The existing `lib/embed.test.ts` still runs MiniLM from the local cache.)
- **Paths** stored or compared are repo-relative with forward slashes.
- **Layering:** nothing under `lib/` imports `app/`, `next` or `react`. **All SQL lives in `lib/db/*`** (ARCHITECTURE.md §3 rule 5); engine and index modules call store functions.
- **Parameter cap:** every bulk insert goes through `lib/db/batch.ts`.
- **Contracts:** extend `lib/contracts.ts` only together with the `docs/API_CONTRACTS.md` section that defines the shape (CLAUDE.md).
- **Models:** exactly `claude-haiku-5-5` (files) and `claude-sonnet-5-5` (folders, the repo), with no date suffix. Effort `low`; adaptive thinking (omit `thinking`, the models' default); structured outputs through `output_config.format`.
- **Real money:** only the calls this plan names:
  - the fixture smoke test in Task 8 (about 1¢);
  - the owner checkpoint in Task 11 (about $0.20);
  - **only after the owner approves the checkpoint**, Task 12's batch smoke test (about 1¢) and the full VS Code pass (S2: ≤ $15).
- **Old Phase 2–4 code keeps running untouched** (`lib/index-repo.ts`, `lib/retrieve.ts`, `lib/db/graph-store.ts`, `app/api/*` except the new `status` route). V1.3 retires it, together with the chunk `vectors` table.
- **Don't index the Nebulosity repo itself** (the old `saveScan` would fight it). The fixture and `../vscode` are the targets.
- **Docs change in the same commit as the design they describe** (maintenance rule); decisions get ADRs. Replace each `‹today›` with the commit's date (YYYY-MM-DD) and each `‹…›` measurement with the measured value.

## Review Focus

Five failure modes most likely to hurt a real user that the spec doesn't spell out. Each line names the task whose test covers it.

1. **A person types FTS5 syntax into search** (quotes, parentheses, `*`, `AND`/`OR`/`NOT`, a path like `src/vs/*`). It must not throw, and it should still return what the words find. Covered in Task 10 (`toFtsQuery` tests, plus "never throws on FTS5 syntax").
2. **The summarize run is interrupted mid-batch** (Ctrl+C, a sleeping laptop, a killed process). Running it again must collect the batches still at Anthropic, never resend them. `/api/status` must not say "running" forever, nor "failed" while batches are genuinely in progress. Covered in Task 8 (wait-false-then-resume test, status of an in-flight run) and Task 4 (the interrupted rule).
3. **A file is edited after indexing but before summarizing.** Its summary must not describe bytes the index never saw. It fails with "changed after it was indexed", and the next run after `npm run index` retries it. Covered in Task 8.
4. **No API key** (a fresh clone, or a CLI shell without `.env.local`, which tsx doesn't load). Structure and search still work, test-file templates are still written, and the summaries stage reports `off` with the reason. Covered in Task 8 (no-summarizer test) and Task 8's `scripts/env.ts`.
5. **Two summarize runs at once** (two terminals, or the CLI and the V1.3 server) would pay twice. A separate `summarizing` lock refuses the second run without blocking indexing. Covered in Task 8 (lock tests).

## File map

| File | Status | Responsibility |
|---|---|---|
| `test/helpers/temp.ts`, `fixture.ts`, `mini-repo-facts.ts`, `summarizer.ts` | create | self-cleaning temp dirs, the fixture copy, the fixture's planner facts, the stub `Summarizer` |
| `lib/db/client.ts` | modify | export `type Db` |
| `lib/db/schema.ts` + migrations `0003_v1_2_summaries.sql`, `0004_v1_2_search_index.sql` | modify / generate | row types; `summaries`, `summary_vectors`, `summary_usage`, `chunks.name_split`; FTS5 tables + triggers |
| `lib/db/store/lock.ts` | modify | race-safe locks; the `summarizing` lock |
| `lib/db/store/structure.ts` | modify | shared types, `nameSplit`, `findRepository`/`requireRepository` |
| `lib/db/store/stages.ts` | create | stage status rows in `meta` |
| `lib/db/store/summaries.ts` | create | summary rows, in-flight batches, results, usage, pruning |
| `lib/db/store/summary-vectors.ts` | create | summary vectors: what's missing, write, load, change stamp |
| `lib/db/store/search.ts` | create | FTS5 queries for code and summaries |
| `lib/index/paths.ts` | modify | `repoKey` moves here |
| `lib/index/discover.ts` | modify | walk mode skips `dist`, `out`, `build`, `coverage` |
| `lib/index/languages/typescript.ts` | modify | `languageOf`, `SymbolRow` |
| `lib/index/identifiers.ts` | create | `splitIdentifier` |
| `lib/index/pipeline.ts` | modify | every stage reports progress; language; name splits; stage status; prunes summaries |
| `lib/index/summarize/prompts.ts` | create | models, effort, prompt text and rendering, test-file template |
| `lib/index/summarize/plan.ts` | create | pure planner: states, `inputHash`, waves, queue order |
| `lib/index/summarize/types.ts` | create | `Summarizer`, `SummaryRequest`, `SummaryOutcome` |
| `lib/index/summarize/claude.ts` | create | the Anthropic-backed `Summarizer` |
| `lib/index/summarize/pricing.ts`, `concurrency.ts` | create | cost from tokens; `mapLimit` |
| `lib/index/summarize/run.ts` | create | `runSummaries` (waves, batches, resume), `summarizeNow` |
| `lib/index/summarize/compare.ts` | create | the owner checkpoint: sample and report |
| `lib/index/embed.ts` | create | `embedSummaries` |
| `lib/engine/status.ts` | create | `readIndexStatus` |
| `lib/engine/search.ts` | create | `toFtsQuery`, `fuseRankings`, `search` |
| `lib/contracts.ts` | modify | `IndexStatus` + stage types; `SearchHit`, `SearchResult` |
| `app/api/status/route.ts` | create | `GET /api/status` |
| `scripts/env.ts`, `summarize.ts`, `search.ts`, `compare-summaries.ts` + `package.json` | create / modify | CLIs |
| `docs/*` | modify | `DATABASE_DESIGN.md` §8, `API_CONTRACTS.md` §9–10, `RAG_PIPELINE.md` rewrite, ADR-031–033, `PIVOT_SPEC.md`, `BENCHMARKS.md`, `SUMMARY_REVIEW.md`, roadmap |

## Summary ground truth (hand-derived; tests transcribe these)

These extend the V1.1 plan's fixture ground truth (8 files, 11 edges, 6 folders, 10 level edges).

**Line counts and importers** (lines counted by hand; importers counted from the 11 edges):

| File | lines | imported by | test? |
|---|---|---|---|
| `scripts/build.js` | 3 | 0 | |
| `src/app/main.ts` | 8 | 3 (edges 2, 6, 8) | |
| `src/app/view.tsx` | 11 | 1 (edge 4) | |
| `src/core/index.ts` | 1 | 1 (edge 11) | |
| `src/core/log.ts` | 9 | 3 (edges 3, 7, 9) | |
| `src/index.ts` | 7 | 1 (edge 1) | |
| `src/util/strings.test.ts` | 3 | 0 | yes |
| `src/util/strings.ts` | 6 | 2 (edges 5, 10) | |

**Targets: 14.** 8 files, 5 folders (`scripts`, `src`, `src/app`, `src/core`, `src/util`) and the repo (`""`). 13 need a model (7 files on Haiku, 5 folders and the repo on Sonnet); 1 gets a template.

**Queue order** puts files first, most-imported first, ties by path. Folders follow, deepest first, then by file count (descending), then by path. The repo goes last. The first plan reads:

```
ready     src/app/main.ts, src/core/log.ts, src/util/strings.ts, src/app/view.tsx,
          src/core/index.ts, src/index.ts, scripts/build.js
template  src/util/strings.test.ts
waiting   src/app, src/core, src/util, src, scripts, ""
```

**Waves** (a folder is ready once none of its children still waits for a model): `[the 7 files]` → `[src/app, src/core, src/util, scripts]` → `[src]` → `[""]`. 13 requests in 4 waves.

**Folder sizes** (lines below, which order a folder's children): `src/app` 19, `src/core` 10, `src/util` 9, `scripts` 3, `src` 45 (all 7 files under it).

**The test file's template:** tagline `Tests for strings`, summary `Test code (3 lines) for strings. Test files get this template instead of a model-written summary.`

**Code search facts** (from the fixture's chunks):
- `shout` is a `const` chunk at lines 3–6 of `src/util/strings.ts`.
- The word `shout` appears in chunks of exactly 3 files: `strings.ts`, `main.ts` and `strings.test.ts`.
- `logger` appears in exactly 2 chunks, both in `src/core/log.ts`: the `Logger` class and the file-summary chunk (`Logger (class)`).
- After porter stemming, `logging` → `log`, which occurs in 5 files: `log.ts`, `main.ts`, `src/index.ts`, `strings.ts` and `core/index.ts`.

---

### Task 1: V1.1 cleanup (six fixes, one commit and push each)

**Files:**
- Create: `test/helpers/temp.ts`, `test/helpers/temp.test.ts`, `test/helpers/fixture.ts`
- Modify: `lib/db/client.ts`, `lib/db/schema.ts`, `lib/db/store/lock.ts`, `lib/db/store/lock.test.ts`, `lib/db/store/structure.ts`, `lib/index/aggregate.ts`, `lib/index/languages/typescript.ts`, `lib/index/languages/typescript.test.ts`, `lib/index/pipeline.ts`, `lib/index/pipeline.test.ts`, `lib/index/discover.ts`, `lib/index/discover.test.ts`, `lib/index/resolve.test.ts`, `lib/config.test.ts`, `docs/DATABASE_DESIGN.md`, `docs/PIVOT_SPEC.md`

**Interfaces:**
- Produces:
  - `type Db` (`lib/db/client.ts`)
  - `SymbolRow`, `FolderRow`, `LevelEdgeRow` (`lib/db/schema.ts`)
  - `FileError`, `ImportEdge` (`lib/db/store/structure.ts`)
  - `languageOf(path): "typescript" | "javascript"`
  - `makeTempDir(prefix)`, `FIXTURE`, `copyFixture()` (test helpers)
  - `IndexLockedError(startedAt, activity = "Indexing")`, and a private `acquireLock(db, key, activity)` in `lock.ts` that Task 8 reuses

#### Fix 1.1 — One definition per shared type

- [ ] **Step 1: Export the database handle type** — append to `lib/db/client.ts`:
```ts

/** The database handle every store function takes. */
export type Db = ReturnType<typeof getDb>;
```

- [ ] **Step 2: Derive the row types from the schema** — append to `lib/db/schema.ts`:
```ts

/** A symbol as the language adapter produces it and the store writes it: every column but the ids. */
export type SymbolRow = Omit<typeof symbols.$inferSelect, "id" | "fileId">;
/** A folder as the aggregator builds it and the store writes it. */
export type FolderRow = Omit<typeof folders.$inferSelect, "id" | "repoId">;
/** A level edge as the aggregator builds it and the store writes it. */
export type LevelEdgeRow = Omit<typeof levelEdges.$inferSelect, "id" | "repoId">;
```

- [ ] **Step 3: `lib/index/aggregate.ts`** — replace everything above `const compare =` (the `dirOf` import and the two local type definitions) with:
```ts
import type { FolderRow, LevelEdgeRow } from "../db/schema";
import { dirOf } from "./paths";

```

- [ ] **Step 4: `lib/index/languages/typescript.ts`**
  - Change `import type { SymbolKind } from "../../db/schema";` to `import type { SymbolKind, SymbolRow } from "../../db/schema";`.
  - Delete the whole `export type ParsedSymbol = { … };` block.
  - In `ParsedFile`, change `symbols: ParsedSymbol[];` to `symbols: SymbolRow[];`.
  - In `collectSymbols`, change the signature and first line to `function collectSymbols(sourceFile: ts.SourceFile): SymbolRow[] {` and `const symbols: SymbolRow[] = [];`.

- [ ] **Step 5: `lib/db/store/structure.ts`** — replace everything from the top through the `LevelEdgeInput` line with:
```ts
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import {
    chunks, files, folders, imports, levelEdges, repositories, symbols,
    type FolderRow, type LevelEdgeRow, type SymbolRow,
} from "../schema";
import { columnCount, forEachBatch } from "../batch";
import type { CodeChunk } from "../../contracts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A file that couldn't be read, parsed or written this run, and why. It keeps its previous row. */
export type FileError = { path: string; error: string };

/** One resolved import: `source` imports `target`, written as `specifier` in the source. */
export type ImportEdge = { source: string; target: string; specifier: string };

/** Everything one structure run knows about one changed file. */
export type FileRecord = {
    path: string;
    kind: (typeof files.$inferInsert)["kind"];
    contentHash: string;
    language: string;
    sizeBytes: number;
    lineCount: number;
    isTest: boolean;
    importSpecifiers: string[];
    chunks: CodeChunk[];
    symbols: SymbolRow[];
};

export type StoredFile = { id: number; contentHash: string; importSpecifiers: string[] };
```
Then change these signatures and locals:
  - `writeFileRecords(...): { path: string; error: string }[]` becomes `writeFileRecords(db: Db, repoId: number, records: readonly FileRecord[]): FileError[]`.
  - `const errors: { path: string; error: string }[] = [];` becomes `const errors: FileError[] = [];`.
  - `replaceImports(db: Db, repoId: number, edges: readonly { source: string; target: string; specifier: string }[])` becomes `replaceImports(db: Db, repoId: number, edges: readonly ImportEdge[])`.
  - `replaceAggregates(db: Db, repoId: number, folderRows: readonly FolderInput[], edgeRows: readonly LevelEdgeInput[])` becomes `replaceAggregates(db: Db, repoId: number, folderRows: readonly FolderRow[], edgeRows: readonly LevelEdgeRow[])`.

- [ ] **Step 6: `lib/db/store/lock.ts`** — replace `import type { getDb } from "../client";` and `type Db = ReturnType<typeof getDb>;` with the single line `import type { Db } from "../client";`.

- [ ] **Step 7: `lib/index/pipeline.ts`** — replace the structure-store and discover imports with:
```ts
import {
    deleteFilesNotIn, loadStoredFiles, markIndexed, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileError, type FileRecord, type ImportEdge,
} from "../db/store/structure";
import { buildFolders, buildLevelEdges } from "./aggregate";
import { discoverFiles, isTestPath, readGitHead, type SkippedFile } from "./discover";
```
Then make these replacements:
  - In `IndexResult`: `errors: FileError[];` and `skipped: SkippedFile[];`.
  - `const errors: { path: string; error: string }[] = [];` becomes `const errors: FileError[] = [];`.
  - `const edges: { source: string; target: string; specifier: string }[] = [];` becomes `const edges: ImportEdge[] = [];`.

- [ ] **Step 8: Check each shape now has exactly one definition**

Run: `git grep -n -e "type Db = " -e "path: string; error: string" -e "path: string; reason: string" -e "source: string; target: string; specifier: string" -e "FolderInput" -e "LevelEdgeInput" -e "ParsedSymbol" -- lib/index lib/db/store lib/db/client.ts lib/db/schema.ts`
Expected: exactly these four hits (line numbers vary):
```
lib/db/client.ts:…:export type Db = ReturnType<typeof getDb>;
lib/db/store/structure.ts:…:export type FileError = { path: string; error: string };
lib/db/store/structure.ts:…:export type ImportEdge = { source: string; target: string; specifier: string };
lib/index/discover.ts:…:export type SkippedFile = { path: string; reason: string };
```
(The old `lib/db/graph-store.ts` keeps its own copies until V1.3 deletes it.)

- [ ] **Step 9: Gate** — `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: PASS, 126 tests, unchanged.

- [ ] **Step 10: Commit and push**
```bash
git add lib/db/client.ts lib/db/schema.ts lib/db/store/structure.ts lib/db/store/lock.ts lib/index/aggregate.ts lib/index/languages/typescript.ts lib/index/pipeline.ts
git commit -m "refactor: one definition per shared type (Db, symbol/folder/level-edge rows, file errors, import edges)"
git push origin pivot/v1
```

#### Fix 1.2 — Tests delete the temp folders they create

- [ ] **Step 1: Count the leftovers** (239 when this plan was written):

Run: `node -e "console.log(require('fs').readdirSync(require('os').tmpdir()).filter((n) => n.startsWith('neb-')).length)"`
Note the number.

- [ ] **Step 2: Write the failing test** — `test/helpers/temp.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fs from "fs";
import { makeTempDir } from "./temp";

describe("makeTempDir", () => {
    let made = "";

    it("creates an empty folder whose name starts with the prefix", () => {
        made = makeTempDir("neb-temp-");
        expect(fs.readdirSync(made)).toEqual([]);
        expect(made).toMatch(/neb-temp-[^\\/]+$/);
    });

    it("deletes it once the test that made it has finished", () => {
        expect(made).not.toBe("");
        expect(fs.existsSync(made)).toBe(false);
    });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run test/helpers/temp.test.ts`
Expected: FAIL with `Failed to resolve import "./temp"`.

- [ ] **Step 4: Implement** — `test/helpers/temp.ts`:
```ts
import fs from "fs";
import os from "os";
import path from "path";
import { onTestFinished } from "vitest";

/**
 * A fresh folder under the OS temp directory, deleted again when the calling test
 * finishes, pass or fail. Call it from inside a test (`it`), not from a describe body.
 */
export function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
```
And `test/helpers/fixture.ts`:
```ts
import fs from "fs";
import path from "path";
import { makeTempDir } from "./temp";

/** test/fixtures/mini-repo: the hand-designed repo whose ground truth is in the V1.1 plan. */
export const FIXTURE = path.resolve("test/fixtures/mini-repo");

/** A private copy of the fixture, for tests that index or edit it. Deleted when the test ends. */
export function copyFixture(): string {
    const dir = makeTempDir("neb-fixture-");
    fs.cpSync(FIXTURE, dir, { recursive: true });
    return dir;
}
```

- [ ] **Step 5: Run it to make sure it passes** — `npx vitest run test/helpers/temp.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 6: Use the helpers everywhere a test makes a temp folder**
  - **`lib/index/pipeline.test.ts`:**
    - Delete the `os` import, the `FIXTURE` constant and the local `copyFixture` function.
    - Add `import { copyFixture } from "../../test/helpers/fixture";` and `import { makeTempDir } from "../../test/helpers/temp";`.
    - `fs.mkdtempSync(path.join(os.tmpdir(), "neb-empty-"))` becomes `makeTempDir("neb-empty-")`.
    - `path.join(fs.mkdtempSync(path.join(os.tmpdir(), "neb-missing-")), "no-such-repo")` becomes `path.join(makeTempDir("neb-missing-"), "no-such-repo")`.
  - **`lib/index/discover.test.ts`:**
    - Delete the `os` import, the `FIXTURE` constant and the local `tempDir` function.
    - Add `import { FIXTURE } from "../../test/helpers/fixture";` and `import { makeTempDir } from "../../test/helpers/temp";`.
    - Rename the three `tempDir(` calls to `makeTempDir(`.
  - **`lib/index/resolve.test.ts`:**
    - Delete the `os` import and the `FIXTURE` constant.
    - Add `import { FIXTURE } from "../../test/helpers/fixture";` and `import { makeTempDir } from "../../test/helpers/temp";`.
    - In `makeRepo`, `fs.mkdtempSync(path.join(os.tmpdir(), "neb-resolve-"))` becomes `makeTempDir("neb-resolve-")`.
  - **`lib/config.test.ts`:**
    - Delete the `os` import and add `import { makeTempDir } from "../test/helpers/temp";`.
    - Both `fs.mkdtempSync(path.join(os.tmpdir(), "neb-config-"))` calls become `makeTempDir("neb-config-")`.

- [ ] **Step 7: Gate, then recount** — `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: PASS, 128 tests. Run the Step 1 count again. Expected: the same number as before (nothing new left behind).

- [ ] **Step 8: Clear the old leftovers.** List them first and check that every name starts with `neb-`. They're debris from earlier test runs and V1.1 probes. Then run:
`node -e "const fs=require('fs'),os=require('os'),p=require('path');for(const n of fs.readdirSync(os.tmpdir()))if(n.startsWith('neb-'))fs.rmSync(p.join(os.tmpdir(),n),{recursive:true,force:true})"`
Expected: the Step 1 count is now 0.

- [ ] **Step 9: Commit and push**
```bash
git add test/helpers/temp.ts test/helpers/temp.test.ts test/helpers/fixture.ts lib/index/pipeline.test.ts lib/index/discover.test.ts lib/index/resolve.test.ts lib/config.test.ts
git commit -m "test: delete the temp folders tests create"
git push origin pivot/v1
```

#### Fix 1.3 — Two processes racing for the index lock get `IndexLockedError`, not a raw database error

Today `acquireIndexLock` reads the lock row and then inserts one. If two processes both read "no lock", the second INSERT dies with `SqliteError: UNIQUE constraint failed: meta.key`. That was verified on 2026-10-11 by simulating the race with the spy in the first test below.

- [ ] **Step 1: Write the failing tests** — replace `lib/db/store/lock.test.ts` with:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { META_KEYS, meta } from "../schema";
import { IndexLockedError, LOCK_STALE_AFTER_MS, acquireIndexLock, releaseIndexLock } from "./lock";

afterEach(() => {
    vi.restoreAllMocks();
    releaseIndexLock(getDb());
});

const lockValue = () => getDb().select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get()?.value;

describe("index lock", () => {
    it("refuses a second holder while the first is fresh", () => {
        const db = getDb();
        acquireIndexLock(db);
        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
    });

    it("clears a stale lock left by a crashed run", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: ancient }).run();
        expect(() => acquireIndexLock(db)).not.toThrow();
        expect(lockValue()).not.toBe(ancient);
    });

    it("reports IndexLockedError, not a database error, when another process takes the lock between our check and our write", () => {
        const db = getDb();
        const insert = db.insert.bind(db);
        // The race, made deterministic: the other process's row lands just before ours.
        vi.spyOn(db, "insert").mockImplementationOnce(((table: typeof meta) => {
            insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: new Date().toISOString() }).run();
            return insert(table);
        }) as unknown as typeof db.insert);

        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
    });

    it("never deletes a fresh lock that replaced a stale one a moment earlier", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        const fresh = new Date().toISOString();
        db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: ancient }).run();
        const remove = db.delete.bind(db);
        // Just before our delete runs, the other process clears the stale row and takes the lock.
        vi.spyOn(db, "delete").mockImplementationOnce(((table: typeof meta) => {
            remove(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
            db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: fresh }).run();
            return remove(table);
        }) as unknown as typeof db.delete);

        expect(() => acquireIndexLock(db)).toThrow(IndexLockedError);
        expect(lockValue()).toBe(fresh);
    });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/db/store/lock.test.ts`
Expected: the two new tests FAIL.
- The third gets `SqliteError: UNIQUE constraint failed: meta.key` instead of `IndexLockedError`.
- The fourth doesn't throw at all: the old code deletes the other process's fresh lock and takes it, so two runs would both think they hold it.

- [ ] **Step 3: Implement** — replace `lib/db/store/lock.ts` with:
```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { META_KEYS, meta } from "../schema";

/**
 * Thrown when another run holds a lock. A distinct type rather than a magic string:
 * routes map it to INDEX_LOCKED, and matching on `message` would break the moment
 * anyone rewords the sentence.
 */
export class IndexLockedError extends Error {
    constructor(startedAt: string, activity: string = "Indexing"){
        super(`${activity} already in progress (started ${startedAt}).`);
        this.name = "IndexLockedError";
    }
}

/**
 * How long a lock row may sit before it's assumed to be debris from a crashed run.
 * The lock is released in a `finally`, which doesn't run if the process is killed.
 */
export const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

export function acquireIndexLock(db: Db): void {
    acquireLock(db, META_KEYS.INDEXING_LOCK, "Indexing");
}

export function releaseIndexLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
}

/**
 * A lock is one `meta` row whose value is when its holder started. Two processes (the
 * CLI and the Next server) can get here at the same moment, so taking it must never be
 * "check, then write": both could see no row, and the second INSERT would die on the
 * UNIQUE constraint as a raw SqliteError. Every step below is one atomic statement.
 */
function acquireLock(db: Db, key: string, activity: string): void {
    const startedAt = new Date().toISOString();
    if (tryInsertLock(db, key, startedAt)) return;

    const holder = readLock(db, key);

    if (holder !== null){
        const heldSince = Date.parse(holder);
        const isStale = Number.isNaN(heldSince) || Date.now() - heldSince > LOCK_STALE_AFTER_MS;

        if (!isStale){
            throw new IndexLockedError(holder, activity);
        }

        console.warn(`[lock] clearing a stale ${activity.toLowerCase()} lock from ${holder}`);
        // Delete only the row we judged stale. If another process replaced it a moment
        // ago, this matches nothing and our insert below loses to theirs, as it should.
        db.delete(meta).where(and(eq(meta.key, key), eq(meta.value, holder))).run();
    }

    // (holder === null means the lock was released between our two statements: just try again)
    if (!tryInsertLock(db, key, startedAt)){
        throw new IndexLockedError(readLock(db, key) ?? startedAt, activity);
    }
}

/** True when this call created the lock row; false when someone else's row was already there. */
function tryInsertLock(db: Db, key: string, startedAt: string): boolean {
    return db.insert(meta).values({ key, value: startedAt }).onConflictDoNothing().run().changes === 1;
}

function readLock(db: Db, key: string): string | null {
    return db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value ?? null;
}
```

- [ ] **Step 4: Run them to make sure they pass** — `npx vitest run lib/db/store/lock.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Gate** — Expected: PASS, 130 tests.

- [ ] **Step 6: Commit and push**
```bash
git add lib/db/store/lock.ts lib/db/store/lock.test.ts
git commit -m "fix: two processes racing for the index lock now get IndexLockedError, not a database error"
git push origin pivot/v1
```

#### Fix 1.4 — `onProgress` reports every stage

- [ ] **Step 1: Write the failing test** — append to `lib/index/pipeline.test.ts`:
```ts

describe("indexRepository — progress", () => {
    it("reports every stage in order, each ending at its total", () => {
        const root = copyFixture();
        const events: string[] = [];
        indexRepository(root, { batchSize: 3, onProgress: (stage, done, total) => events.push(`${stage} ${done}/${total}`) });

        // 8 files in batches of 3 are parsed and written at 3, 6 and 8; then 8 files resolve and 6 folders aggregate
        expect(events).toEqual([
            "discover 8/8",
            "parse 3/8", "write 3/8",
            "parse 6/8", "write 6/8",
            "parse 8/8", "write 8/8",
            "resolve 8/8",
            "aggregate 6/6",
        ]);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails** — `npx vitest run lib/index/pipeline.test.ts -t "progress"`. Expected: FAIL. Only `parse 3/8`, `parse 6/8` and `parse 8/8` are reported.

- [ ] **Step 3: Implement** — in `lib/index/pipeline.ts`:
  1. Document the option: replace the `onProgress?:` line in `IndexOptions` with:
```ts
    /** Called at least once per stage, in order. done/total count files (folders for "aggregate"). */
    onProgress?: (stage: IndexStage, done: number, total: number) => void;
```
  2. After `timingsMs.discover = performance.now() - t;` add:
```ts
        options.onProgress?.("discover", discovered.files.length, discovered.files.length);
```
  3. In the batch loop, add `const processed = Math.min(i + batchSize, discovered.files.length);` as its first line.
     - After `timingsMs.parse += performance.now() - t;` add `options.onProgress?.("parse", processed, discovered.files.length);`.
     - After `timingsMs.write += performance.now() - t;` add `options.onProgress?.("write", processed, discovered.files.length);`.
     - Delete the old `options.onProgress?.("parse", Math.min(i + batchSize, …), …);` line.
  4. After `timingsMs.resolve = performance.now() - t;` add `options.onProgress?.("resolve", fileSet.size, fileSet.size);`.
  5. After `timingsMs.aggregate = performance.now() - t;` add `options.onProgress?.("aggregate", folderRows.length, folderRows.length);`.

- [ ] **Step 4: Run it to make sure it passes** — same command. Expected: PASS.

- [ ] **Step 5: Gate** — Expected: PASS, 131 tests. Then run `npm run index -- test/fixtures/mini-repo` and watch the progress line move through every stage.

- [ ] **Step 6: Commit and push**
```bash
git add lib/index/pipeline.ts lib/index/pipeline.test.ts
git commit -m "fix: report progress for every structure stage, not just parse"
git push origin pivot/v1
```

#### Fix 1.5 — `files.language` says `javascript` for JavaScript files

- [ ] **Step 1: Write the failing tests**
  - In `lib/index/languages/typescript.test.ts`, change the import to `import { countLines, languageOf, parseTypeScriptFile } from "./typescript";` and append:
```ts

describe("languageOf", () => {
    it("calls .js, .jsx, .mjs and .cjs files javascript and the rest typescript", () => {
        expect(["a.js", "a.jsx", "a.mjs", "a.cjs"].map(languageOf)).toEqual(["javascript", "javascript", "javascript", "javascript"]);
        expect(["a.ts", "a.tsx", "a.mts", "a.cts"].map(languageOf)).toEqual(["typescript", "typescript", "typescript", "typescript"]);
    });
});
```
  - In `lib/index/pipeline.test.ts`, inside `describe("indexRepository — first run on the fixture", …)`, add:
```ts
    it("records scripts/build.js as javascript and the seven .ts/.tsx files as typescript", () => {
        const { repoId } = indexRepository(copyFixture());
        const rows = getDb().select({ path: files.path, language: files.language }).from(files)
            .where(eq(files.repoId, repoId)).orderBy(files.path).all();
        expect(rows.filter((r) => r.language === "javascript").map((r) => r.path)).toEqual(["scripts/build.js"]);
        expect(rows.filter((r) => r.language === "typescript")).toHaveLength(7);
    });
```

- [ ] **Step 2: Run them to make sure they fail** — `npx vitest run lib/index/languages/typescript.test.ts lib/index/pipeline.test.ts`. Expected: FAIL. `languageOf` isn't exported, and `build.js` is stored as `typescript`.

- [ ] **Step 3: Implement**
  - In `lib/index/languages/typescript.ts`, after `TYPESCRIPT_EXTENSIONS`, add:
```ts

/** files.language for a path this adapter claims. TypeScript's parser reads both languages. */
export function languageOf(filePath: string): "typescript" | "javascript" {
    return /\.(js|jsx|mjs|cjs)$/.test(filePath) ? "javascript" : "typescript";
}
```
  - In `lib/index/pipeline.ts`:
    - Change the adapter import to `import { languageOf, TYPESCRIPT_EXTENSIONS, parseTypeScriptFile } from "./languages/typescript";`.
    - In the `records.push({ … })` call, `language: "typescript",` becomes `language: languageOf(file.path),`.
  - In `docs/DATABASE_DESIGN.md` §7, change the `files` bullet's `` gains `language`, `` to `` gains `language` (`typescript` or `javascript`, by extension), ``.

- [ ] **Step 4: Run them to make sure they pass** — same command. Expected: PASS.

- [ ] **Step 5: Gate** — Expected: PASS, 133 tests. (Rows already in a database correct themselves when Task 2's migration forces every file to be re-parsed.)

- [ ] **Step 6: Commit and push**
```bash
git add lib/index/languages/typescript.ts lib/index/languages/typescript.test.ts lib/index/pipeline.ts lib/index/pipeline.test.ts docs/DATABASE_DESIGN.md
git commit -m "fix: record .js/.jsx/.mjs/.cjs files as javascript"
git push origin pivot/v1
```

#### Fix 1.6 — A repo without `.git` skips `dist`, `out`, `build` and `coverage`

- [ ] **Step 1: Write the tests**
  - In `lib/index/discover.test.ts`, inside `describe("discoverFiles — walking (no .git)", …)`, add:
```ts
    it("skips build output and coverage (dist, out, build, coverage) at any depth", () => {
        const dir = makeTempDir("neb-discover-walk-");
        for (const rel of ["dist/a.js", "out/b.js", "build/c.js", "coverage/d.js", "packages/p/dist/e.js", "src/f.ts"]){
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), "export {};\n");
        }
        expect(discoverFiles(dir, { extensions: TS_EXTENSIONS }).files.map((f) => f.path)).toEqual(["src/f.ts"]);
    });
```
  - Inside `describe("discoverFiles — git repositories", …)`, add:
```ts
    it("keeps a build/ folder in a git repo, where .gitignore decides (VS Code's build scripts live there)", () => {
        const dir = makeTempDir("neb-discover-build-");
        execFileSync("git", ["init", "-q", dir]);
        fs.mkdirSync(path.join(dir, "build"));
        fs.writeFileSync(path.join(dir, "build", "gulpfile.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
        expect(discoverFiles(dir, { extensions: TS_EXTENSIONS }).files.map((f) => f.path)).toEqual(["a.ts", "build/gulpfile.ts"]);
    });
```

- [ ] **Step 2: Run them** — `npx vitest run lib/index/discover.test.ts`.
Expected: the walking test FAILS (it also returns `dist/a.js` and the others). The git test PASSES; it stays to stop the fix from reaching into git mode.

- [ ] **Step 3: Implement** — in `lib/index/discover.ts`:
  - After `IGNORED_DIRS`, add:
```ts

/**
 * Build output and coverage reports, skipped only when walking. In a git repo .gitignore
 * already decides, and a tracked folder with one of these names can be real source:
 * VS Code keeps its build scripts in build/.
 */
const WALK_ONLY_IGNORED_DIRS = new Set(["dist", "out", "build", "coverage"]);
```
  - In `listByWalking`'s loop, after `if (IGNORED_DIRS.has(entry.name)) continue;`, add:
```ts
            if (entry.isDirectory() && WALK_ONLY_IGNORED_DIRS.has(entry.name)) continue;
```
  - In `discoverFiles`'s doc comment, `it walks the tree and skips the usual heavy folders.` becomes `it walks the tree and skips the usual heavy folders and build output.`
  - In `docs/PIVOT_SPEC.md` §5.1, replace `otherwise walk the tree with the ignore list.` with ``otherwise walk the tree, skipping `node_modules`, `.git`, `.next` and `.nebulosity` (skipped in git mode too), plus `dist`, `out`, `build` and `coverage` (skipped only when walking: in a git repo `.gitignore` decides, and a tracked `build/` can be real source, as in VS Code).``

- [ ] **Step 4: Run them to make sure they pass** — same command. Expected: PASS.

- [ ] **Step 5: Gate** — Expected: PASS, 135 tests.

- [ ] **Step 6: Commit and push**
```bash
git add lib/index/discover.ts lib/index/discover.test.ts docs/PIVOT_SPEC.md
git commit -m "fix: skip dist, out, build and coverage when walking a repo without git"
git push origin pivot/v1
```

---

### Task 2: Summary tables and the two search indexes

**Files:**
- Modify: `lib/db/schema.ts`, `lib/db/schema.test.ts`, `docs/DATABASE_DESIGN.md`, `docs/PIVOT_SPEC.md` (§4.1), `docs/ENGINEERING_DECISIONS.md` (ADR-031)
- Generate: `lib/db/migrations/0003_v1_2_summaries.sql`, `lib/db/migrations/0004_v1_2_search_index.sql` (+ `meta/`)

**Interfaces:**
- Produces:
  - `SUMMARY_TARGET_KINDS`, `type SummaryTargetKind` (`"file" | "folder" | "repo"`)
  - `SUMMARY_STATUSES`, `type StoredSummaryStatus` (`"fresh" | "stale" | "pending" | "failed" | "skipped"`)
  - Drizzle tables `summaries`, `summaryVectors`, `summaryUsage`, and the column `chunks.nameSplit`
  - FTS5 tables `code_fts(path, name, name_split, text)` (rowid = `chunks.id`) and `summary_fts(path, tagline, summary)` (rowid = `summaries.id`), each with `ORDER BY rank` weights

- [ ] **Step 1: Write the failing tests** — in `lib/db/schema.test.ts`, change the imports to:
```ts
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { chunks, files, repositories, summaries } from "./schema";
```
and append:
```ts

describe("schema (V1.2)", () => {
    it("creates the summary tables, both search indexes and their triggers", () => {
        const names = getDb()
            .all<{ name: string }>(sql`select name from sqlite_master where type in ('table', 'trigger')`)
            .map((r) => r.name);
        expect(names).toEqual(expect.arrayContaining([
            "summaries", "summary_vectors", "summary_usage", "code_fts", "summary_fts",
            "chunks_fts_insert", "chunks_fts_delete", "summaries_fts_insert", "summaries_fts_update", "summaries_fts_delete",
        ]));
    });

    it("keeps code_fts in step with chunks, including when a file delete cascades", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/fts-code" }).returning().get();
        const file = db.insert(files).values({ repoId: repo.id, path: "fts-code/tabs.ts", kind: "module", contentHash: "" }).returning().get();
        db.insert(chunks).values({
            fileId: file.id, chunkId: "fts-code/tabs.ts#openEditor#0", kind: "function", name: "openEditor",
            nameSplit: "open editor", startLine: 1, endLine: 1, text: "function openEditor() {}", fileHash: "h",
        }).run();
        const matches = () => db.all<{ path: string }>(sql`select path from code_fts where code_fts match '"editor"' and path = 'fts-code/tabs.ts'`);

        expect(matches()).toEqual([{ path: "fts-code/tabs.ts" }]);   // found through name_split
        db.delete(files).where(eq(files.id, file.id)).run();          // cascades to chunks, whose trigger cleans code_fts
        expect(matches()).toEqual([]);
    });

    it("indexes a summary once it has text, follows rewrites, and forgets deleted ones", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/fts-summary" }).returning().get();
        const row = db.insert(summaries).values({ repoId: repo.id, targetKind: "file", targetPath: "fts-summary/a.ts", status: "pending" }).returning().get();
        const find = (word: string) => db.all<{ path: string }>(
            sql`select path from summary_fts where summary_fts match ${`"${word}"`} and path = 'fts-summary/a.ts'`);

        expect(find("tabs")).toEqual([]);                                   // no text yet: nothing indexed
        db.update(summaries).set({ tagline: "Editor tabs", summary: "Draws the tab strip.", status: "fresh" }).where(eq(summaries.id, row.id)).run();
        expect(find("tabs")).toEqual([{ path: "fts-summary/a.ts" }]);
        db.update(summaries).set({ tagline: "Status bar", summary: "Shows the cursor position." }).where(eq(summaries.id, row.id)).run();
        expect(find("tabs")).toEqual([]);
        expect(find("cursor")).toEqual([{ path: "fts-summary/a.ts" }]);
        db.delete(summaries).where(eq(summaries.id, row.id)).run();
        expect(find("cursor")).toEqual([]);
    });

    it("ranks a word in a declaration's name above the same word in another one's body", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/fts-rank" }).returning().get();
        const file = db.insert(files).values({ repoId: repo.id, path: "fts-rank/x.ts", kind: "module", contentHash: "" }).returning().get();
        const chunk = { fileId: file.id, kind: "function" as const, startLine: 1, endLine: 1, fileHash: "h" };
        db.insert(chunks).values([
            { ...chunk, chunkId: "a", name: "helper", nameSplit: "helper", text: "function helper() { // switch tabs\n}" },
            { ...chunk, chunkId: "b", name: "renderTabs", nameSplit: "render tabs", text: "function renderTabs() {}" },
        ]).run();
        const ranked = db.all<{ name: string }>(sql`
            select c.name as name from code_fts join chunks c on c.id = code_fts.rowid
            where code_fts match '"tabs"' and code_fts.path = 'fts-rank/x.ts' order by code_fts.rank`);
        expect(ranked.map((r) => r.name)).toEqual(["renderTabs", "helper"]);
    });
});
```

- [ ] **Step 2: Run them to make sure they fail** — `npx vitest run lib/db/schema.test.ts`. Expected: FAIL. `summaries` isn't exported, and the tables don't exist.

- [ ] **Step 3: Edit `lib/db/schema.ts`**
  1. In `chunks`, after the `name` column, add:
```ts
    // the name as separate lowercase words ("openEditor" → "open editor"), so word search finds it (code_fts)
    nameSplit: text("name_split").notNull().default(""),
```
  2. Append, before the row types added in Fix 1.1:
```ts

/** What a summary describes. "cluster" arrives with E5. */
export const SUMMARY_TARGET_KINDS = ["file", "folder", "repo"] as const;
export type SummaryTargetKind = (typeof SUMMARY_TARGET_KINDS)[number];

/**
 * fresh: the text matches the target's current input · stale: text from an older input,
 * kept on show until it's redone · pending: no text yet · failed: the last attempt
 * failed, retried next run · skipped: no model call on purpose, the text is a template
 * (test files). The API also reports "off" (no API key); that one is never stored.
 */
export const SUMMARY_STATUSES = ["fresh", "stale", "pending", "failed", "skipped"] as const;
export type StoredSummaryStatus = (typeof SUMMARY_STATUSES)[number];

/**
 * One summary per file, folder and the repo (PIVOT_SPEC.md §4.1, §5.3). Keyed by path,
 * never by a file or folder id: folders are rebuilt on every structure run, so their
 * ids don't last.
 */
export const summaries = sqliteTable("summaries", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    targetKind: text("target_kind", { enum: SUMMARY_TARGET_KINDS }).notNull(),
    targetPath: text("target_path").notNull(),   // "" for the repo itself
    tagline: text("tagline"),                     // ≤ 6 words; null until a summary exists
    summary: text("summary"),                     // 2–4 sentences
    model: text("model"),                         // the model that wrote it, or "template"
    inputHash: text("input_hash"),                // hash(model, prompt version, input) of the text above
    status: text("status", { enum: SUMMARY_STATUSES }).notNull(),
    error: text("error"),                         // why the last attempt failed
    // A Message Batch can take hours. These two say which batch carries this row's request and
    // which input it answers, so a later run collects the answer instead of paying for it twice.
    batchId: text("batch_id"),
    pendingHash: text("pending_hash"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
}, (t) => [
    uniqueIndex("summaries_target_unique").on(t.repoId, t.targetKind, t.targetPath),
    index("summaries_batch_idx").on(t.batchId)
]);

/** One MiniLM vector per model-written summary (ADR-027), stored with the ADR-017 encode/decode pair. */
export const summaryVectors = sqliteTable("summary_vectors", {
    id: integer().primaryKey({ autoIncrement: true }),
    summaryId: integer("summary_id").notNull().unique().references(() => summaries.id, { onDelete: "cascade" }),
    embedding: blob("embedding", { mode: "buffer" }).notNull()
});

/** API spend per repo, model and transport, added up as answers arrive. Success criterion S2 is read from here. */
export const summaryUsage = sqliteTable("summary_usage", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    transport: text("transport", { enum: ["direct", "batch"] }).notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0)
}, (t) => [
    uniqueIndex("summary_usage_unique").on(t.repoId, t.model, t.transport)
]);
```

- [ ] **Step 4: Generate the table migration**

Run: `npx drizzle-kit generate --name v1_2_summaries`
Expected: it creates `lib/db/migrations/0003_v1_2_summaries.sql` and updates `meta/`. Check that the SQL contains:
- `CREATE TABLE \`summaries\``, `CREATE TABLE \`summary_vectors\`` and `CREATE TABLE \`summary_usage\``, plus their indexes
- `ALTER TABLE \`chunks\` ADD \`name_split\` text DEFAULT '' NOT NULL`

If drizzle-kit asks whether something was renamed, answer that it was **created**.

- [ ] **Step 5: Write the search-index migration by hand**

Run: `npx drizzle-kit generate --custom --name v1_2_search_index`
Expected: it creates an empty `lib/db/migrations/0004_v1_2_search_index.sql`. Fill it with exactly this. Every `--> statement-breakpoint` chunk must hold one statement, because Drizzle runs each chunk as a single prepared statement.
```sql
-- Code search: one row per chunk, rowid = chunks.id. A regular FTS5 table (it keeps its own copy
-- of the text) so snippet() can quote the matching lines. porter: "rendered" finds "render".
CREATE VIRTUAL TABLE `code_fts` USING fts5(path, name, name_split, text, tokenize = 'porter unicode61');
--> statement-breakpoint
-- bm25 column weights (path, name, name_split, text): a word in a declaration's name says far more
-- about the chunk than the same word somewhere in its body. Stored as the table's rank.
INSERT INTO `code_fts`(`code_fts`, `rank`) VALUES ('rank', 'bm25(2.0, 10.0, 6.0, 1.0)');
--> statement-breakpoint
CREATE TRIGGER `chunks_fts_insert` AFTER INSERT ON `chunks` BEGIN
  INSERT INTO `code_fts`(rowid, path, name, name_split, text)
  VALUES (new.id, (SELECT path FROM files WHERE id = new.file_id), new.name, new.name_split, new.text);
END;
--> statement-breakpoint
-- Fires however a chunk disappears: a re-parse, a deleted file, a deleted repository
-- (ON DELETE CASCADE runs triggers too), or the old Phase 2 pipeline.
CREATE TRIGGER `chunks_fts_delete` AFTER DELETE ON `chunks` BEGIN
  DELETE FROM `code_fts` WHERE rowid = old.id;
END;
--> statement-breakpoint
-- Summary search: one row per summary that has text, rowid = summaries.id.
CREATE VIRTUAL TABLE `summary_fts` USING fts5(path, tagline, summary, tokenize = 'porter unicode61');
--> statement-breakpoint
-- bm25 column weights (path, tagline, summary)
INSERT INTO `summary_fts`(`summary_fts`, `rank`) VALUES ('rank', 'bm25(1.0, 4.0, 2.0)');
--> statement-breakpoint
CREATE TRIGGER `summaries_fts_insert` AFTER INSERT ON `summaries` WHEN new.tagline IS NOT NULL BEGIN
  INSERT INTO `summary_fts`(rowid, path, tagline, summary) VALUES (new.id, new.target_path, new.tagline, new.summary);
END;
--> statement-breakpoint
-- Only when the text changes: status-only updates (a batch id, a new status) leave the index alone.
CREATE TRIGGER `summaries_fts_update` AFTER UPDATE OF tagline, summary ON `summaries` BEGIN
  DELETE FROM `summary_fts` WHERE rowid = old.id;
  INSERT INTO `summary_fts`(rowid, path, tagline, summary)
  SELECT new.id, new.target_path, new.tagline, new.summary WHERE new.tagline IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `summaries_fts_delete` AFTER DELETE ON `summaries` BEGIN
  DELETE FROM `summary_fts` WHERE rowid = old.id;
END;
--> statement-breakpoint
-- Chunks written before this migration have no code_fts rows. Clearing every content hash makes
-- the next `npm run index` re-parse each file once, so the insert trigger fills the index
-- (and files.language is re-derived for .js files).
UPDATE `files` SET `content_hash` = '';
```

- [ ] **Step 6: Run them to make sure they pass** — `npx vitest run lib/db/schema.test.ts`. Expected: PASS (7 tests).

- [ ] **Step 7: Document it**
  - Append to `docs/DATABASE_DESIGN.md`:
```md

## 8. V1.2 additions (summaries and search, `PIVOT_SPEC.md` §4.1, §5.3–5.4)

- **`summaries`**: one row per file, folder and the repo (`target_kind` + `target_path`, unique per repo; `""` is the repo). It holds `tagline` (≤ 6 words), `summary` (2–4 sentences), `model` (the model that wrote it, or `template`), `input_hash` (the input that text answers), `status` and `error`. Statuses:
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
```
  - In the banner at the top of `docs/DATABASE_DESIGN.md`, replace `§7 documents the V1.1 additions.` with `§7 documents the V1.1 additions and §8 the V1.2 ones.`
  - In `docs/PIVOT_SPEC.md` §4.1, update these table rows:
    - **`chunks`:** replace `` `chunkId` is now unique per file |`` with `` `chunkId` is now unique per file; `nameSplit` is the name as words |``.
    - **`summaries`:** replace `` `status` (fresh, stale, pending, failed, skipped, off) |`` with `` `status` (fresh, stale, pending, failed, skipped; `off` is reported, never stored), `error`, and `batchId`/`pendingHash` so a Batch run can resume (§5.3) |``.
    - **`summary_vectors`:** replace `one embedding per fresh summary` with `one embedding per model-written summary`, then add this row directly below it: ``| `summary_usage` | new | API tokens per repo, model and transport (direct, batch); S2 is measured from it |``.
    - **`code_fts`:** append `; kept in sync by triggers (ADR-031)` before the final `|`.
    - **`summary_fts`:** replace `` `path`, `tagline`, `summary` |`` with `` `path`, `tagline`, `summary`; kept in sync by triggers (ADR-031) |``.
  - Append to `docs/ENGINEERING_DECISIONS.md`, after ADR-030 and before the `---` line that precedes "Decisions inherited…":
```md

## ADR-031 — Full-text indexes are kept in sync by triggers (‹today›)

**Context:** V1.2 adds two FTS5 indexes: code (`code_fts`, over chunks) and summaries (`summary_fts`). A chunk disappears in four ways: its file is re-parsed, its file is deleted, its repository is deleted, or the Phase 2 pipeline (`lib/index-repo.ts`, retired in V1.3) rewrites it. Only the first passes through the new structure store, and two of the others are `ON DELETE CASCADE` deletes that no application code sees.
**Decision:**
- Both indexes are regular FTS5 tables whose rowid is the source row's id.
- `AFTER INSERT`/`AFTER DELETE` triggers on `chunks` keep `code_fts` in sync. `AFTER INSERT`, `AFTER UPDATE OF tagline, summary` and `AFTER DELETE` triggers on `summaries` keep `summary_fts` in sync.
- The camelCase split of a chunk's name needs JavaScript, so it is computed once at write time and stored on the chunk (`chunks.name_split`), where the insert trigger can read it.
- Both tables use the `porter unicode61` tokenizer and keep their bm25 column weights as the `rank` setting.
**Alternatives:** (a) Explicit writes in the structure store: misses cascades and the old pipeline, so deleted code would keep turning up in search. (b) External-content tables: no duplicate text, but deleting a row needs its old values, which a cascade has already removed. (c) Contentless tables (`contentless_delete=1`): smaller, but `snippet()` stops working and snippets would need their own code.
**Consequences:** The search indexes can't drift from the data, whichever path changes it. The text is stored twice (the pivot spike measured 211 MB for VS Code's chunks), and every chunk insert also writes an FTS row (the spike measured 4.8 s for all of VS Code). Migration 0004 clears every content hash once, so existing chunks get indexed on the next run.
**Revisit when:** database size starts to matter, or the FTS writes push S1 past 60 s.
```

- [ ] **Step 8: Gate** — Expected: PASS, 139 tests.

- [ ] **Step 9: Commit and push**
```bash
git add lib/db/schema.ts lib/db/schema.test.ts lib/db/migrations docs/DATABASE_DESIGN.md docs/PIVOT_SPEC.md docs/ENGINEERING_DECISIONS.md
git commit -m "feat: summaries, summary vectors and usage tables; FTS5 code and summary indexes kept in sync by triggers"
git push origin pivot/v1
```

---

### Task 3: Code search in the structure stage (and S1 re-measured)

**Files:**
- Create: `lib/index/identifiers.ts`, `lib/index/identifiers.test.ts`
- Modify: `lib/db/store/structure.ts`, `lib/db/store/structure.test.ts`, `lib/index/pipeline.ts`, `lib/index/pipeline.test.ts`, `docs/BENCHMARKS.md`

**Interfaces:**
- Consumes: `chunks.nameSplit`, `code_fts` (Task 2).
- Produces:
  - `splitIdentifier(name: string): string`, which Task 10 also uses to split identifiers in queries.
  - `type ChunkRecord = CodeChunk & { nameSplit: string }`; `FileRecord.chunks` becomes `ChunkRecord[]`.

- [ ] **Step 1: Write the failing test** — `lib/index/identifiers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { splitIdentifier } from "./identifiers";

describe("splitIdentifier", () => {
    it("splits camelCase and PascalCase", () => {
        expect(splitIdentifier("openEditor")).toBe("open editor");
        expect(splitIdentifier("ICodeEditorService")).toBe("i code editor service");
    });

    it("keeps acronyms together", () => {
        expect(splitIdentifier("HTMLParser")).toBe("html parser");
        expect(splitIdentifier("parseHTML")).toBe("parse html");
    });

    it("splits snake_case, kebab-case and $-prefixed names", () => {
        expect(splitIdentifier("get_editor_value")).toBe("get editor value");
        expect(splitIdentifier("$scope")).toBe("scope");
        expect(splitIdentifier("data-uri")).toBe("data uri");
    });

    it("keeps digits on the word they follow and leaves plain words alone", () => {
        expect(splitIdentifier("utf8Decode")).toBe("utf8 decode");
        expect(splitIdentifier("log")).toBe("log");
        expect(splitIdentifier("{ start }")).toBe("start");
    });
});
```

- [ ] **Step 2: Run it to make sure it fails** — `npx vitest run lib/index/identifiers.test.ts`. Expected: FAIL with `Failed to resolve import "./identifiers"`.

- [ ] **Step 3: Implement** — `lib/index/identifiers.ts`:
```ts
/**
 * An identifier as separate lowercase words, so a word search can find it:
 * "openEditor" → "open editor", "HTMLParser" → "html parser", "get_value" → "get value".
 * The code search index stores this next to the raw name (PIVOT_SPEC.md §4.1, code_fts),
 * and search splits identifiers in queries the same way.
 */
export function splitIdentifier(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")       // fooBar → foo Bar, utf8Decode → utf8 Decode
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")    // HTMLParser → HTML Parser
        .replace(/[^\p{L}\p{N}]+/gu, " ")              // _ $ - . { } and anything else between words
        .trim()
        .toLowerCase();
}
```

- [ ] **Step 4: Run it to make sure it passes** — Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing store and pipeline tests**
  - In `lib/db/store/structure.test.ts`:
    - In the `record` helper's chunk, add `nameSplit: "a",` after `name: "a",`.
    - In the existing `isolates a file that fails to write` test, nothing else changes.
    - Append inside the `describe`:
```ts
    it("puts every written chunk into code search and takes it out again when the file changes or goes", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/fts");
        const withChunk = (name: string, nameSplit: string) => record("fts/widget.ts", {
            chunks: [{ id: `fts/widget.ts#${name}#0`, filePath: "fts/widget.ts", kind: "function", name, nameSplit, startLine: 1, endLine: 1, exported: true, partIndex: 0, text: `function ${name}() {}`, fileHash: "h" }],
        });
        const hits = (word: string) => db.all<{ path: string }>(sql`select path from code_fts where code_fts match ${`"${word}"`} and path = 'fts/widget.ts'`);

        writeFileRecords(db, repoId, [withChunk("openEditor", "open editor")]);
        expect(hits("editor")).toHaveLength(1);

        writeFileRecords(db, repoId, [withChunk("closeTab", "close tab")]);   // same file, new content
        expect(hits("editor")).toEqual([]);
        expect(hits("tab")).toHaveLength(1);

        deleteFilesNotIn(db, repoId, new Set());
        expect(hits("tab")).toEqual([]);
    });
```
  - In `lib/index/pipeline.test.ts`, change the drizzle import to `import { and, eq, sql } from "drizzle-orm";` and add `chunks` to the schema import. Then append inside `describe("indexRepository — first run on the fixture", …)`:
```ts
    it("makes the fixture's code searchable, with each chunk's name split into words", () => {
        const { repoId } = indexRepository(copyFixture());
        const db = getDb();
        const found = db.all<{ name: string }>(sql`
            select c.name as name from code_fts
            join chunks c on c.id = code_fts.rowid join files f on f.id = c.file_id
            where code_fts match '"logger"' and f.repo_id = ${repoId} order by code_fts.rank`);
        expect(found.map((r) => r.name)).toEqual(["Logger", "(file)"]);   // both in src/core/log.ts; the name match ranks first

        const logger = db.select({ nameSplit: chunks.nameSplit }).from(chunks).innerJoin(files, eq(files.id, chunks.fileId))
            .where(and(eq(files.repoId, repoId), eq(chunks.name, "Logger"))).get();
        expect(logger).toEqual({ nameSplit: "logger" });
    });
```

- [ ] **Step 6: Run them to make sure they fail** — `npx vitest run lib/db/store/structure.test.ts lib/index/pipeline.test.ts`.
Expected: FAIL.
- The `tsc`-level error is that `nameSplit` isn't in `CodeChunk`.
- At runtime, the store never writes `nameSplit` (`editor` isn't found), and the pipeline stores `""` instead of `logger`.

- [ ] **Step 7: Implement**
  - In `lib/db/store/structure.ts`:
    - After the `ImportEdge` type, add:
```ts

/** A chunk plus its name split into words for code search (lib/index/identifiers.ts). */
export type ChunkRecord = CodeChunk & { nameSplit: string };
```
    - In `FileRecord`, `chunks: CodeChunk[];` becomes `chunks: ChunkRecord[];`.
    - In `writeOne`'s `chunkRows` map, add `nameSplit: c.nameSplit,` after `name: c.name,`.
  - In `lib/index/pipeline.ts`:
    - Add `import { splitIdentifier } from "./identifiers";`.
    - In `records.push({ … })`, `chunks: parsed.chunks,` becomes `chunks: parsed.chunks.map((c) => ({ ...c, nameSplit: splitIdentifier(c.name) })),`.

- [ ] **Step 8: Run them to make sure they pass** — same command. Expected: PASS.

- [ ] **Step 9: Gate** — Expected: PASS, 145 tests.

- [ ] **Step 10: Re-measure S1 on VS Code.** Migration 0004 cleared every content hash, so this run re-parses all files and fills `code_fts`.

Run: `npm run index -- ../vscode`, then run it again.
Expected:
- First run: `changed` ≈ 14,844 and a `total` of **≤ 60.0 s**.
- Second run: `changed 0`, and about 5 s.

If the first total is over 60 s, **stop and report the per-stage timings to the owner** before optimizing anything.

Run: `node -e "console.log((require('fs').statSync('.nebulosity/nebulosity.db').size / 1e6).toFixed(0) + ' MB')"` and note the database size.

- [ ] **Step 11: Record the numbers** — append to `docs/BENCHMARKS.md`, filling each `‹…›` from the output above:
```md

## ‹today, as YYYY MM DD› Index Benchmark #2 — structure stage with the code search index

- **Target, machine:** as in #1 (VS Code @ `cc3fec88`, the owner's laptop)
- **Command:** `npm run index -- ../vscode`, twice. Migration 0004 had cleared every content hash, so the first run re-parses every file and fills `code_fts` through the chunk triggers (ADR-031).

| Run | Files | Changed | discover | parse | write | resolve | aggregate | **total** | DB size |
|---|---|---|---|---|---|---|---|---|---|
| full re-parse | ‹files› | ‹changed› | ‹s› | ‹s› | ‹s› | ‹s› | ‹s› | **‹s›** | ‹MB› |
| warm (no changes) | ‹files› | 0 | ‹s› | ‹s› | ‹s› | ‹s› | ‹s› | **‹s›** | ‹MB› |

**S1 (≤ 60 s): ‹PASS or FAIL›.** The FTS inserts land in the write column; compare it with #1's 13.1 s.
```

- [ ] **Step 12: Commit and push**
```bash
git add lib/index/identifiers.ts lib/index/identifiers.test.ts lib/db/store/structure.ts lib/db/store/structure.test.ts lib/index/pipeline.ts lib/index/pipeline.test.ts docs/BENCHMARKS.md
git commit -m "feat: code search index filled by the structure stage, with camelCase-split names; S1 re-measured"
git push origin pivot/v1
```

---

### Task 4: Stage status and `GET /api/status`

**Files:**
- Create: `lib/db/store/stages.ts`, `lib/db/store/stages.test.ts`, `lib/engine/status.ts`, `lib/engine/status.test.ts`, `app/api/status/route.ts`
- Modify: `lib/contracts.ts`, `lib/db/store/structure.ts`, `lib/index/paths.ts`, `lib/index/pipeline.ts`, `lib/index/pipeline.test.ts`, `scripts/index.ts`, `docs/API_CONTRACTS.md`, `docs/DATABASE_DESIGN.md`, `docs/PIVOT_SPEC.md` (§5.7), `docs/ENGINEERING_DECISIONS.md` (ADR-032)

**Interfaces:**
- Produces:
  - Contract types `StageName`, `StageState`, `StageStatus`, `IndexStatus`.
  - Stage store: `STAGE_NAMES`, `writeStage(db, repoId, stage, status)`, `readStages(db, repoId)`.
  - `findRepository(db, rootPath): number | null` (structure store).
  - `repoKey` now lives in `lib/index/paths.ts`.
  - `readIndexStatus(repoRoot, now?): IndexStatus | null` and `RUNNING_STALE_AFTER_MS`.
  - `GET /api/status`.

- [ ] **Step 1: Define the contract** — first the doc, then the types.
  - Append to `docs/API_CONTRACTS.md`:
````md

## 9. GET /api/status (slice V1.2)

What each indexing stage of the **active repo** is doing. The active repo is `activeRepo` in `.nebulosity/config.json`, which `npm run index` sets. This route replaces `/api/health` when the new Map lands (V1.3) and drives its status pill.

**Response 200 — `IndexStatus`:**
```ts
type StageName = "structure" | "summaries" | "embeddings";
type StageState = "idle" | "running" | "ready" | "off" | "failed";
type StageStatus = { state: StageState; done: number; total: number; note?: string };
type IndexStatus = { repo: string; stages: Record<StageName, StageStatus> };
```

- **`done`/`total`** count files for `structure`, summary targets (files, folders and the repo) for `summaries`, and model-written summaries with a vector for `embeddings`.
- **A stage that never ran** is `idle` with `0/0`.
- **`off`** means the stage can't run, and `note` says why (`summaries` without `ANTHROPIC_API_KEY`).
- **An honest `running`.** A running stage writes its row at least once a minute. A `running` row untouched for 5 minutes is reported as `failed`, with the note `interrupted: no progress since <time>`, because its process died (ADR-032).

**Error 404 `INDEX_EMPTY`** when no repo has been indexed yet.
````
  - In the banner at the top of `docs/API_CONTRACTS.md`, replace `§5 (`/api/chat`) still applies to E1.` with `` §5 (`/api/chat`) still applies to E1, and §9 (`/api/status`) is live from slice V1.2. ``
  - In `lib/contracts.ts`, after the Health section, add:
```ts
/* ─────────────────────────── Index status ────────────────────────── */

/** The stages a repo goes through (PIVOT_SPEC.md §5). E2, E3 and E5 add more. */
export type StageName = "structure" | "summaries" | "embeddings";

/** idle: never ran · running · ready: done and current · off: can't run (e.g. no API key) · failed */
export type StageState = "idle" | "running" | "ready" | "off" | "failed";

export type StageStatus = { state: StageState; done: number; total: number; note?: string };

/** GET /api/status — docs/API_CONTRACTS.md §9 */
export type IndexStatus = {
  /** The repo's root: absolute, forward slashes (repositories.rootPath). */
  repo: string;
  stages: Record<StageName, StageStatus>;
};
```

- [ ] **Step 2: Write the failing tests**
  - `lib/db/store/stages.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getDb } from "../client";
import { readStages, writeStage } from "./stages";
import { upsertRepository } from "./structure";

describe("stage status store", () => {
    it("reads back what was written, per repo and stage, with when it was written", () => {
        const db = getDb();
        const a = upsertRepository(db, "/stages/a");
        const b = upsertRepository(db, "/stages/b");
        writeStage(db, a, "structure", { state: "running", done: 3, total: 8 });
        writeStage(db, a, "structure", { state: "ready", done: 8, total: 8 });
        writeStage(db, b, "summaries", { state: "off", done: 0, total: 14, note: "no key" });

        const stagesA = readStages(db, a);
        expect(stagesA.structure).toMatchObject({ state: "ready", done: 8, total: 8 });
        expect(stagesA.structure?.updatedAt).toBeInstanceOf(Date);
        expect(stagesA.summaries).toBeUndefined();
        expect(readStages(db, b)).toEqual({ summaries: expect.objectContaining({ state: "off", note: "no key" }) });
    });
});
```
  - `lib/engine/status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import path from "path";
import { copyFixture } from "../../test/helpers/fixture";
import { makeTempDir } from "../../test/helpers/temp";
import { getDb } from "../db/client";
import { writeStage } from "../db/store/stages";
import { indexRepository } from "../index/pipeline";
import { readIndexStatus } from "./status";

describe("readIndexStatus", () => {
    it("is null for a repo that was never indexed", () => {
        expect(readIndexStatus(path.join(makeTempDir("neb-status-"), "nowhere"))).toBeNull();
    });

    it("after indexing: structure ready with every file counted, the later stages idle", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(readIndexStatus(root)?.stages).toEqual({
            structure: { state: "ready", done: 8, total: 8 },
            summaries: { state: "idle", done: 0, total: 0 },
            embeddings: { state: "idle", done: 0, total: 0 },
        });
    });

    it("reports a running stage that stopped writing as failed, saying since when", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        writeStage(getDb(), repoId, "summaries", { state: "running", done: 2, total: 14 });

        const sixMinutesLater = new Date(Date.now() + 6 * 60 * 1000);
        const later = readIndexStatus(root, sixMinutesLater)?.stages.summaries;
        expect(later).toMatchObject({ state: "failed", done: 2, total: 14 });
        expect(later?.note).toMatch(/^interrupted: no progress since \d{4}-/);
        expect(readIndexStatus(root)?.stages.summaries.state).toBe("running");   // right now it's still fine
    });
});
```

- [ ] **Step 3: Run them to make sure they fail** — `npx vitest run lib/db/store/stages.test.ts lib/engine/status.test.ts`. Expected: FAIL with `Failed to resolve import "./stages"` and `"./status"`.

- [ ] **Step 4: Implement**
  - `lib/db/store/stages.ts`:
```ts
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { meta } from "../schema";
import type { StageName, StageStatus } from "../../contracts";

/** Every stage, in pipeline order. */
export const STAGE_NAMES = ["structure", "summaries", "embeddings"] as const satisfies readonly StageName[];

/** A stage's status as stored, with when it was last written. */
export type StoredStage = StageStatus & { updatedAt: Date };

/** Stage status lives in `meta` (PIVOT_SPEC.md §4.1): one row per repo and stage. */
const stageKey = (repoId: number, stage: StageName): string => `stage:${repoId}:${stage}`;

export function writeStage(db: Db, repoId: number, stage: StageName, status: StageStatus): void {
    const value = JSON.stringify(status);
    const updatedAt = new Date();
    db.insert(meta)
        .values({ key: stageKey(repoId, stage), value, updatedAt })
        .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt } })
        .run();
}

/** Each stage's stored status. A stage that never wrote one is missing. */
export function readStages(db: Db, repoId: number): Partial<Record<StageName, StoredStage>> {
    const stages: Partial<Record<StageName, StoredStage>> = {};

    for (const stage of STAGE_NAMES){
        const row = db.select({ value: meta.value, updatedAt: meta.updatedAt }).from(meta).where(eq(meta.key, stageKey(repoId, stage))).get();
        if (row) stages[stage] = { ...(JSON.parse(row.value) as StageStatus), updatedAt: row.updatedAt };
    }

    return stages;
}
```
  - In `lib/db/store/structure.ts`, after `upsertRepository`, add:
```ts

/** The id of an indexed repo, or null if it was never indexed. */
export function findRepository(db: Db, rootPath: string): number | null {
    return db.select({ id: repositories.id }).from(repositories).where(eq(repositories.rootPath, rootPath)).get()?.id ?? null;
}
```
  - Move `repoKey` into `lib/index/paths.ts`, so readers don't load the whole pipeline. Add at the top of `paths.ts`:
```ts
import path from "path";
```
and append:
```ts

/** One spelling of a repo root everywhere (repositories.rootPath): absolute, forward slashes. */
export function repoKey(repoRoot: string): string {
    return normalizeSlashes(path.resolve(repoRoot));
}
```
Then delete `repoKey` from `lib/index/pipeline.ts`, and change its paths import to `import { repoKey } from "./paths";`. `normalizeSlashes` is no longer used there.
Update the two other importers:
    - In `scripts/index.ts`, import `repoKey` from `"../lib/index/paths"`.
    - In `lib/index/pipeline.test.ts`, import `repoKey` from `"./paths"`.
  - `lib/engine/status.ts`:
```ts
import type { IndexStatus, StageName, StageStatus } from "../contracts";
import { getDb } from "../db/client";
import { readStages, STAGE_NAMES, type StoredStage } from "../db/store/stages";
import { findRepository } from "../db/store/structure";
import { repoKey } from "../index/paths";

/** A running stage writes at least once a minute; five silent minutes means its process died. */
export const RUNNING_STALE_AFTER_MS = 5 * 60 * 1000;

/** GET /api/status: what each stage of one repo is doing, or null if that repo was never indexed. */
export function readIndexStatus(repoRoot: string, now: Date = new Date()): IndexStatus | null {
    const db = getDb();
    const repo = repoKey(repoRoot);
    const repoId = findRepository(db, repo);
    if (repoId === null) return null;

    const stored = readStages(db, repoId);
    const stages = {} as Record<StageName, StageStatus>;

    for (const name of STAGE_NAMES){
        stages[name] = honest(stored[name], now);
    }

    return { repo, stages };
}

/** What a stored row means now: a "running" row nobody has written for minutes is a crash, not progress (ADR-032). */
function honest(stage: StoredStage | undefined, now: Date): StageStatus {
    if (!stage) return { state: "idle", done: 0, total: 0 };

    const { updatedAt, ...status } = stage;
    const silent = status.state === "running" && now.getTime() - updatedAt.getTime() > RUNNING_STALE_AFTER_MS;
    if (!silent) return status;

    return { ...status, state: "failed", note: `interrupted: no progress since ${updatedAt.toISOString()}` };
}
```
  - The structure stage writes its status. In `lib/index/pipeline.ts`:
    1. Import the store and the `Db` type:
```ts
import { getDb, type Db } from "../db/client";
import { writeStage } from "../db/store/stages";
```
(This replaces the existing `getDb` import.)
    2. Replace
```ts
    acquireIndexLock(db);

    try{
        const repoId = upsertRepository(db, repoKey(root));
```
with
```ts
    acquireIndexLock(db);
    let stageRepoId: number | null = null;   // set once the repo row exists, so a failure can be reported on it

    try{
        const repoId = upsertRepository(db, repoKey(root));
        stageRepoId = repoId;
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: 0, note: "discovering files" });
```
    3. After the `discover` progress call, add:
```ts
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: discovered.files.length });
```
    4. After the `write` progress call in the batch loop, add:
```ts
            writeStage(db, repoId, "structure", { state: "running", done: processed, total: discovered.files.length });
```
    5. After `markIndexed(db, repoId, indexedHead);`, add:
```ts
        writeStage(db, repoId, "structure", {
            state: "ready",
            done: fileSet.size,
            total: fileSet.size,
            ...(errors.length > 0 ? { note: `${errors.length} files failed to index` } : {}),
        });
```
    6. Replace the final `} finally{` with:
```ts
    } catch (err){
        if (stageRepoId !== null) reportStructureFailure(db, stageRepoId, err);
        throw err;
    } finally{
```
and add this function next to `message`:
```ts
function reportStructureFailure(db: Db, repoId: number, err: unknown): void {
    try{
        writeStage(db, repoId, "structure", { state: "failed", done: 0, total: 0, note: message(err) });
    } catch{
        // the database itself may be what failed; the original error matters more
    }
}
```
  - `app/api/status/route.ts`:
```ts
import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { readIndexStatus } from "@/lib/engine/status";
import type { ErrorEnvelope, IndexStatus } from "@/lib/contracts";

export const runtime = "nodejs";

// GET /api/status — what each indexing stage of the active repo is doing (API_CONTRACTS.md §9)
export function GET(){
    const { activeRepo } = readConfig();
    const status = activeRepo ? readIndexStatus(activeRepo) : null;

    if (!status){
        return NextResponse.json<ErrorEnvelope>(
            { error: { code: "INDEX_EMPTY", message: "No repository indexed yet. Run npm run index -- <path-to-repo>." } },
            { status: 404 }
        );
    }

    return NextResponse.json<IndexStatus>(status);
}
```

- [ ] **Step 5: Run them to make sure they pass** — `npx vitest run lib/db/store/stages.test.ts lib/engine/status.test.ts lib/index/pipeline.test.ts`. Expected: PASS.

- [ ] **Step 6: Document the decision**
  - In `docs/PIVOT_SPEC.md` §5.7, after `It's exposed at `GET /api/status` and drives the UI's progress pill.`, add: `` v1's stages are `structure`, `summaries` and `embeddings` (`API_CONTRACTS.md` §9). A `running` stage that stops writing for 5 minutes reads as failed (ADR-032). ``
  - Append to `docs/DATABASE_DESIGN.md` §8:
```md
- **Stage status** lives in `meta` as `stage:<repoId>:<stage>` → `{ state, done, total, note? }`, written by each stage as it goes (`API_CONTRACTS.md` §9, ADR-032).
```
  - Append ADR-032 to `docs/ENGINEERING_DECISIONS.md`, after ADR-031:
```md

## ADR-032 — Stage status lives in `meta`, and a silent "running" means a crash (‹today›)

**Context:** `PIVOT_SPEC.md` §5.7 asks for `idle | running | ready | off | failed` per stage, with progress, at `GET /api/status`. Stages run in different processes: the CLI now, a server worker from V1.3. A killed process never gets to write "failed".
**Decision:** Each stage writes `stage:<repoId>:<stage>` in `meta` as it goes, at least once a minute while running. Readers report a `running` row untouched for 5 minutes as `failed`, with the note `interrupted: no progress since <time>`.
**Alternatives:** (a) Derive every state from the data: honest by construction, but it can't show a running stage's progress. (b) Record process ids and check them: breaks across reboots and machines.
**Consequences:** No state can stick at "running" forever, and the route needs no knowledge of which process runs which stage.
**Revisit when:** a stage legitimately goes quiet for minutes (it must then write a heartbeat), or V1.3's UI needs pushed updates instead of polling.
```

- [ ] **Step 7: Gate** — Expected: PASS, 149 tests.

- [ ] **Step 8: See the route work.**
  1. Start `npm run dev` in the background and wait for `Ready`.
  2. Run `curl -s http://localhost:3000/api/status`.

     Expected: JSON with `repo` ending in `/vscode` (Task 3 left VS Code as the active repo) and `"structure":{"state":"ready","done":‹files›,"total":‹files›}`. `‹files›` is the file count from Index Benchmark #2. `summaries` and `embeddings` are both `idle` with `0/0`.
  3. Stop the dev server.

- [ ] **Step 9: Commit and push**
```bash
git add lib/contracts.ts lib/db/store/stages.ts lib/db/store/stages.test.ts lib/db/store/structure.ts lib/engine/status.ts lib/engine/status.test.ts lib/index/paths.ts lib/index/pipeline.ts lib/index/pipeline.test.ts scripts/index.ts app/api/status/route.ts docs/API_CONTRACTS.md docs/DATABASE_DESIGN.md docs/PIVOT_SPEC.md docs/ENGINEERING_DECISIONS.md
git commit -m "feat: stage status in meta and GET /api/status, with interrupted runs reported honestly"
git push origin pivot/v1
```

---

### Task 5: The summary store

**Files:**
- Create: `lib/db/store/summaries.ts`, `lib/db/store/summaries.test.ts`, `test/helpers/mini-repo-facts.ts`
- Modify: `lib/index/pipeline.ts` (prune after aggregating)

**Interfaces:**
- Consumes: `summaries`, `summaryUsage`, `summaryVectors` (Task 2); `Db` (Task 1).
- Produces (everything later tasks use from `lib/db/store/summaries.ts`):
  - Types:
    - `SummaryText = { tagline: string; summary: string }`
    - `StoredSummary = { id; kind; path; tagline; summary; model; inputHash; status; batchId; error }`
    - `FileFacts = { path; contentHash; lineCount; isTest; importedBy }`
    - `FolderFacts = { path; parentPath; depth; name; fileCount; directFileCount }`
    - `TargetUpdate = { kind; path; inputHash; status: StoredSummaryStatus | null; templateText?: SummaryText }`
    - `SummaryResult = { id; batchId: string | null; inputHash; outcome: { ok: true; text; model } | { ok: false; error } }`
    - `UsageRow`
  - Functions:
    - `targetKey(kind, path)`: `"file:src/a.ts"`, `"folder:src"`, `"repo:"`
    - `loadFileFacts(db, repoId)` (path order), `loadFolderFacts(db, repoId)`, `loadSummaries(db, repoId)` (id order), `loadFileSummaryChunk(db, repoId, path)`
    - `applyTargetUpdates(db, repoId, updates): Map<targetKey, rowId>`
    - `markInFlight(db, batchId, rows: { id; inputHash }[])`, `inFlightBatches(db, repoId): string[]`, `countInFlight(db, repoId)`, `loadBatchRows(db, batchId): { id; kind; path; inputHash }[]`
    - `writeResults(db, results): number`
    - `addUsage(db, repoId, model, transport, { requests, inputTokens, outputTokens })`, `loadUsage(db, repoId)`
    - `pruneSummaries(db, repoId): number`

- [ ] **Step 1: Write the fixture's planner facts** — `test/helpers/mini-repo-facts.ts` (from the "Summary ground truth" table):
```ts
import type { FileFacts, FolderFacts } from "../../lib/db/store/summaries";

/**
 * The mini-repo fixture as the summary planner sees it, derived by hand. Line counts come
 * from the files themselves, importers from the 11 edges in the V1.1 plan's ground truth.
 * Content hashes are stand-ins; a test that "edits" a file changes its hash.
 */
export const FILES: FileFacts[] = [
    { path: "scripts/build.js", contentHash: "h-build", lineCount: 3, isTest: false, importedBy: 0 },
    { path: "src/app/main.ts", contentHash: "h-main", lineCount: 8, isTest: false, importedBy: 3 },
    { path: "src/app/view.tsx", contentHash: "h-view", lineCount: 11, isTest: false, importedBy: 1 },
    { path: "src/core/index.ts", contentHash: "h-core-index", lineCount: 1, isTest: false, importedBy: 1 },
    { path: "src/core/log.ts", contentHash: "h-log", lineCount: 9, isTest: false, importedBy: 3 },
    { path: "src/index.ts", contentHash: "h-index", lineCount: 7, isTest: false, importedBy: 1 },
    { path: "src/util/strings.test.ts", contentHash: "h-test", lineCount: 3, isTest: true, importedBy: 0 },
    { path: "src/util/strings.ts", contentHash: "h-strings", lineCount: 6, isTest: false, importedBy: 2 },
];

export const FOLDERS: FolderFacts[] = [
    { path: "", parentPath: null, depth: 0, name: "mini-repo", fileCount: 8, directFileCount: 0 },
    { path: "scripts", parentPath: "", depth: 1, name: "scripts", fileCount: 1, directFileCount: 1 },
    { path: "src", parentPath: "", depth: 1, name: "src", fileCount: 7, directFileCount: 1 },
    { path: "src/app", parentPath: "src", depth: 2, name: "app", fileCount: 2, directFileCount: 2 },
    { path: "src/core", parentPath: "src", depth: 2, name: "core", fileCount: 2, directFileCount: 2 },
    { path: "src/util", parentPath: "src", depth: 2, name: "util", fileCount: 2, directFileCount: 2 },
];
```

- [ ] **Step 2: Write the failing tests** — `lib/db/store/summaries.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { FILES } from "../../../test/helpers/mini-repo-facts";
import { getDb } from "../client";
import { summaryVectors } from "../schema";
import { indexRepository } from "../../index/pipeline";
import { upsertRepository } from "./structure";
import {
    addUsage, applyTargetUpdates, countInFlight, inFlightBatches, loadBatchRows, loadFileFacts, loadFileSummaryChunk,
    loadFolderFacts, loadSummaries, loadUsage, markInFlight, pruneSummaries, targetKey, writeResults,
} from "./summaries";

const ok = (tagline: string) => ({ ok: true as const, text: { tagline, summary: "S" }, model: "m" });

describe("summary store — facts for the planner", () => {
    it("loads every file with how many files import it, in path order", () => {
        const { repoId } = indexRepository(copyFixture());
        expect(loadFileFacts(getDb(), repoId).map((f) => [f.path, f.importedBy, f.isTest, f.lineCount]))
            .toEqual(FILES.map((f) => [f.path, f.importedBy, f.isTest, f.lineCount]));
    });

    it("loads the folder tree with its file counts", () => {
        const { repoId } = indexRepository(copyFixture());
        expect(loadFolderFacts(getDb(), repoId).map((f) => [f.path, f.parentPath, f.depth, f.fileCount, f.directFileCount])).toEqual([
            ["", null, 0, 8, 0],
            ["scripts", "", 1, 1, 1],
            ["src", "", 1, 7, 1],
            ["src/app", "src", 2, 2, 2],
            ["src/core", "src", 2, 2, 2],
            ["src/util", "src", 2, 2, 2],
        ]);
    });

    it("finds a file's generated imports/exports listing, which opens its summary prompt", () => {
        const { repoId } = indexRepository(copyFixture());
        const listing = loadFileSummaryChunk(getDb(), repoId, "src/core/log.ts");
        expect(listing?.split("\n")[0]).toBe("File: src/core/log.ts");
        expect(listing).toContain("Logger (class)");
        expect(loadFileSummaryChunk(getDb(), repoId, "src/nope.ts")).toBeNull();
    });
});

describe("summary store — rows", () => {
    it("creates rows for new targets, writes templates at once, and returns every row id by key", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/rows");
        const ids = applyTargetUpdates(db, repoId, [
            { kind: "file", path: "a.ts", inputHash: "h1", status: "pending" },
            { kind: "file", path: "a.test.ts", inputHash: "h2", status: "skipped", templateText: { tagline: "Tests for a", summary: "Test code." } },
            { kind: "repo", path: "", inputHash: "h3", status: "pending" },
        ]);

        expect([...ids.keys()].sort()).toEqual(["file:a.test.ts", "file:a.ts", "repo:"]);
        const rows = loadSummaries(db, repoId);
        expect(rows.find((r) => r.path === "a.ts")).toMatchObject({ status: "pending", tagline: null, inputHash: null });
        expect(rows.find((r) => r.path === "a.test.ts")).toMatchObject({ status: "skipped", tagline: "Tests for a", model: "template", inputHash: "h2" });
    });

    it("changes an existing row's status only when asked, and keeps its text", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/status");
        const id = applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h1", status: "pending" }]).get("file:a.ts")!;
        writeResults(db, [{ id, batchId: null, inputHash: "h1", outcome: ok("T") }]);

        applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h2", status: "stale" }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "stale", tagline: "T", inputHash: "h1" });
        applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h2", status: null }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "stale" });
    });

    it("tracks which rows a batch carries, and lets only that batch's answers land", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/batch");
        const ids = applyTargetUpdates(db, repoId, [
            { kind: "file", path: "a.ts", inputHash: "ha", status: "pending" },
            { kind: "file", path: "b.ts", inputHash: "hb", status: "pending" },
        ]);
        const a = ids.get("file:a.ts")!;
        const b = ids.get("file:b.ts")!;
        markInFlight(db, "batch-1", [{ id: a, inputHash: "ha" }, { id: b, inputHash: "hb" }]);

        expect(inFlightBatches(db, repoId)).toEqual(["batch-1"]);
        expect(countInFlight(db, repoId)).toBe(2);
        expect(loadBatchRows(db, "batch-1").map((r) => [r.path, r.inputHash])).toEqual([["a.ts", "ha"], ["b.ts", "hb"]]);

        // b.ts is redone through the regular API meanwhile, so batch-1's late answer for it must not land
        expect(writeResults(db, [{ id: b, batchId: null, inputHash: "hb", outcome: ok("Direct") }])).toBe(1);
        expect(writeResults(db, [
            { id: a, batchId: "batch-1", inputHash: "ha", outcome: ok("From batch") },
            { id: b, batchId: "batch-1", inputHash: "hb", outcome: ok("Late") },
        ])).toBe(1);

        expect(loadSummaries(db, repoId).map((r) => [r.path, r.tagline, r.status, r.batchId]))
            .toEqual([["a.ts", "From batch", "fresh", null], ["b.ts", "Direct", "fresh", null]]);
        expect(inFlightBatches(db, repoId)).toEqual([]);
    });

    it("a failure keeps the old text; a new summary drops the old vector", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/results");
        const id = applyTargetUpdates(db, repoId, [{ kind: "file", path: "a.ts", inputHash: "h1", status: "pending" }]).get("file:a.ts")!;
        writeResults(db, [{ id, batchId: null, inputHash: "h1", outcome: ok("Old") }]);
        db.insert(summaryVectors).values({ summaryId: id, embedding: Buffer.alloc(4) }).run();
        const vectors = () => db.select().from(summaryVectors).where(eq(summaryVectors.summaryId, id)).all();

        writeResults(db, [{ id, batchId: null, inputHash: "h2", outcome: { ok: false, error: "boom" } }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "failed", error: "boom", tagline: "Old", inputHash: "h1" });
        expect(vectors()).toHaveLength(1);

        writeResults(db, [{ id, batchId: null, inputHash: "h2", outcome: ok("New") }]);
        expect(loadSummaries(db, repoId)[0]).toMatchObject({ status: "fresh", error: null, tagline: "New", inputHash: "h2" });
        expect(vectors()).toEqual([]);
    });

    it("adds up API usage per model and transport", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/summaries/usage");
        addUsage(db, repoId, "claude-haiku-5-5", "batch", { requests: 2, inputTokens: 100, outputTokens: 10 });
        addUsage(db, repoId, "claude-haiku-5-5", "batch", { requests: 1, inputTokens: 50, outputTokens: 5 });
        addUsage(db, repoId, "claude-sonnet-5-5", "direct", { requests: 1, inputTokens: 7, outputTokens: 3 });
        expect(loadUsage(db, repoId)).toEqual([
            { model: "claude-haiku-5-5", transport: "batch", requests: 3, inputTokens: 150, outputTokens: 15 },
            { model: "claude-sonnet-5-5", transport: "direct", requests: 1, inputTokens: 7, outputTokens: 3 },
        ]);
    });
});

describe("summary store — pruning", () => {
    it("the structure stage deletes summaries whose file or folder is gone", () => {
        const root = copyFixture();
        const db = getDb();
        const { repoId } = indexRepository(root);
        applyTargetUpdates(db, repoId, [
            { kind: "file", path: "src/util/strings.test.ts", inputHash: "h", status: "pending" },
            { kind: "file", path: "src/util/strings.ts", inputHash: "h", status: "pending" },
            { kind: "folder", path: "src/util", inputHash: "h", status: "pending" },
            { kind: "folder", path: "src/gone", inputHash: "h", status: "pending" },
        ]);
        fs.rmSync(path.join(root, "src/util/strings.test.ts"));

        indexRepository(root);

        expect(loadSummaries(db, repoId).map((s) => targetKey(s.kind, s.path)).sort()).toEqual(["file:src/util/strings.ts", "folder:src/util"]);
        expect(pruneSummaries(db, repoId)).toBe(0);   // nothing left to prune
    });
});
```

- [ ] **Step 3: Run them to make sure they fail** — `npx vitest run lib/db/store/summaries.test.ts`. Expected: FAIL with `Failed to resolve import "./summaries"`.

- [ ] **Step 4: Implement** — `lib/db/store/summaries.ts`:
```ts
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
    chunks, files, folders, imports, summaries, summaryUsage, summaryVectors,
    type StoredSummaryStatus, type SummaryTargetKind,
} from "../schema";
import { columnCount, forEachBatch } from "../batch";

/** What a model (or a template) wrote about a target. */
export type SummaryText = { tagline: string; summary: string };

/** One row of the summaries table, as the planner and the CLI read it. */
export type StoredSummary = {
    id: number;
    kind: SummaryTargetKind;
    path: string;
    tagline: string | null;
    summary: string | null;
    model: string | null;
    inputHash: string | null;
    status: StoredSummaryStatus;
    batchId: string | null;
    error: string | null;
};

/** A file as the summary planner sees it. */
export type FileFacts = { path: string; contentHash: string; lineCount: number; isTest: boolean; importedBy: number };

/** A folder as the summary planner sees it. */
export type FolderFacts = { path: string; parentPath: string | null; depth: number; name: string; fileCount: number; directFileCount: number };

/** What the planner decided for one target, as far as the database needs to know. */
export type TargetUpdate = {
    kind: SummaryTargetKind;
    path: string;
    inputHash: string;
    /** The status the row shows from now on; null leaves the row's status as it is. */
    status: StoredSummaryStatus | null;
    /** Test files only: written right away, no model call. */
    templateText?: SummaryText;
};

/** One answer to write back: a summary, or why there isn't one. */
export type SummaryResult = {
    id: number;
    /** The batch the answer came from; null for the regular API. A batch answer only lands while that batch still owns the row. */
    batchId: string | null;
    /** The input the answer was written for. */
    inputHash: string;
    outcome: { ok: true; text: SummaryText; model: string } | { ok: false; error: string };
};

export type UsageRow = { model: string; transport: "direct" | "batch"; requests: number; inputTokens: number; outputTokens: number };

/** The one key a target goes by everywhere: "file:src/a.ts", "folder:src", "repo:". */
export const targetKey = (kind: SummaryTargetKind, targetPath: string): string => `${kind}:${targetPath}`;

/** Every file, in path order, with how many files import it (its importance, PIVOT_SPEC.md §5.2). */
export function loadFileFacts(db: Db, repoId: number): FileFacts[] {
    return db.select({
        path: files.path,
        contentHash: files.contentHash,
        lineCount: files.lineCount,
        isTest: files.isTest,
        importedBy: sql<number>`count(${imports.id})`,
    })
        .from(files)
        .leftJoin(imports, eq(imports.targetFileId, files.id))
        .where(eq(files.repoId, repoId))
        .groupBy(files.id)
        .orderBy(files.path)
        .all();
}

export function loadFolderFacts(db: Db, repoId: number): FolderFacts[] {
    return db.select({
        path: folders.path,
        parentPath: folders.parentPath,
        depth: folders.depth,
        name: folders.name,
        fileCount: folders.fileCount,
        directFileCount: folders.directFileCount,
    }).from(folders).where(eq(folders.repoId, repoId)).orderBy(folders.path).all();
}

export function loadSummaries(db: Db, repoId: number): StoredSummary[] {
    return db.select({
        id: summaries.id,
        kind: summaries.targetKind,
        path: summaries.targetPath,
        tagline: summaries.tagline,
        summary: summaries.summary,
        model: summaries.model,
        inputHash: summaries.inputHash,
        status: summaries.status,
        batchId: summaries.batchId,
        error: summaries.error,
    }).from(summaries).where(eq(summaries.repoId, repoId)).orderBy(summaries.id).all();
}

/** The imports/exports listing chunks.ts generates for every file (kind "file-summary"). */
export function loadFileSummaryChunk(db: Db, repoId: number, filePath: string): string | null {
    return db.select({ text: chunks.text })
        .from(chunks)
        .innerJoin(files, eq(files.id, chunks.fileId))
        .where(and(eq(files.repoId, repoId), eq(files.path, filePath), eq(chunks.kind, "file-summary")))
        .get()?.text ?? null;
}

/**
 * Persists a plan: creates rows for new targets, updates the status of existing ones when
 * the plan says so, and writes test-file templates. Returns every row id by targetKey;
 * the ids become the requests' custom ids.
 */
export function applyTargetUpdates(db: Db, repoId: number, updates: readonly TargetUpdate[]): Map<string, number> {
    const now = new Date();
    const existing = new Set(loadSummaries(db, repoId).map((s) => targetKey(s.kind, s.path)));

    db.transaction((tx) => {
        const created = updates
            .filter((u) => !existing.has(targetKey(u.kind, u.path)))
            .map((u) => ({
                repoId,
                targetKind: u.kind,
                targetPath: u.path,
                status: u.status ?? ("pending" as const),
                tagline: u.templateText?.tagline ?? null,
                summary: u.templateText?.summary ?? null,
                model: u.templateText ? "template" : null,
                inputHash: u.templateText ? u.inputHash : null,
                updatedAt: now,
            }));
        forEachBatch(created, columnCount(summaries), (batch) => { tx.insert(summaries).values(batch).run(); });

        for (const u of updates){
            if (!existing.has(targetKey(u.kind, u.path))) continue;
            const row = and(eq(summaries.repoId, repoId), eq(summaries.targetKind, u.kind), eq(summaries.targetPath, u.path));

            if (u.templateText){
                tx.update(summaries).set({
                    tagline: u.templateText.tagline, summary: u.templateText.summary, model: "template",
                    inputHash: u.inputHash, status: "skipped", error: null, updatedAt: now,
                }).where(row).run();
            } else if (u.status !== null){
                tx.update(summaries).set({ status: u.status, updatedAt: now }).where(row).run();
            }
        }
    });

    return new Map(loadSummaries(db, repoId).map((s) => [targetKey(s.kind, s.path), s.id]));
}

/** Records that a Message Batch now carries these rows' requests, and the input each one answers. */
export function markInFlight(db: Db, batchId: string, rows: readonly { id: number; inputHash: string }[]): void {
    db.transaction((tx) => {
        for (const row of rows){
            tx.update(summaries).set({ batchId, pendingHash: row.inputHash }).where(eq(summaries.id, row.id)).run();
        }
    });
}

/** Every batch still out at Anthropic for this repo. */
export function inFlightBatches(db: Db, repoId: number): string[] {
    return db.selectDistinct({ batchId: summaries.batchId }).from(summaries)
        .where(and(eq(summaries.repoId, repoId), isNotNull(summaries.batchId)))
        .all()
        .map((r) => r.batchId!)
        .sort();
}

/** How many requests are still out at Anthropic for this repo. */
export function countInFlight(db: Db, repoId: number): number {
    return db.select({ n: sql<number>`count(*)` }).from(summaries)
        .where(and(eq(summaries.repoId, repoId), isNotNull(summaries.batchId))).get()?.n ?? 0;
}

/** The rows one batch carries, with the input each request answers (markInFlight sets both columns together). */
export function loadBatchRows(db: Db, batchId: string): { id: number; kind: SummaryTargetKind; path: string; inputHash: string }[] {
    return db.select({ id: summaries.id, kind: summaries.targetKind, path: summaries.targetPath, pendingHash: summaries.pendingHash })
        .from(summaries).where(eq(summaries.batchId, batchId)).orderBy(summaries.id).all()
        .map((r) => ({ id: r.id, kind: r.kind, path: r.path, inputHash: r.pendingHash! }));
}

/**
 * Writes answers back and returns how many rows changed.
 * - A summary lands as "fresh" with its text and inputHash. Its old vector is deleted, so
 *   the embeddings stage redoes it.
 * - A failure becomes "failed" and keeps any older text on show.
 * - An answer from a batch that no longer owns the row (the row was redone some other way
 *   meanwhile) is dropped.
 */
export function writeResults(db: Db, results: readonly SummaryResult[]): number {
    const now = new Date();
    let written = 0;

    db.transaction((tx) => {
        for (const r of results){
            const owner = r.batchId === null ? eq(summaries.id, r.id) : and(eq(summaries.id, r.id), eq(summaries.batchId, r.batchId));
            const answer = r.outcome.ok
                ? { tagline: r.outcome.text.tagline, summary: r.outcome.text.summary, model: r.outcome.model, inputHash: r.inputHash, status: "fresh" as const, error: null }
                : { status: "failed" as const, error: r.outcome.error };

            const changed = tx.update(summaries).set({ ...answer, batchId: null, pendingHash: null, updatedAt: now }).where(owner).run().changes;
            if (changed > 0 && r.outcome.ok) tx.delete(summaryVectors).where(eq(summaryVectors.summaryId, r.id)).run();
            written += changed;
        }
    });

    return written;
}

/** Adds answers' tokens to the repo's running API spend (an upsert that increments). */
export function addUsage(db: Db, repoId: number, model: string, transport: "direct" | "batch", usage: { requests: number; inputTokens: number; outputTokens: number }): void {
    db.insert(summaryUsage)
        .values({ repoId, model, transport, ...usage })
        .onConflictDoUpdate({
            target: [summaryUsage.repoId, summaryUsage.model, summaryUsage.transport],
            set: {
                requests: sql`${summaryUsage.requests} + ${usage.requests}`,
                inputTokens: sql`${summaryUsage.inputTokens} + ${usage.inputTokens}`,
                outputTokens: sql`${summaryUsage.outputTokens} + ${usage.outputTokens}`,
            },
        })
        .run();
}

export function loadUsage(db: Db, repoId: number): UsageRow[] {
    return db.select({
        model: summaryUsage.model,
        transport: summaryUsage.transport,
        requests: summaryUsage.requests,
        inputTokens: summaryUsage.inputTokens,
        outputTokens: summaryUsage.outputTokens,
    }).from(summaryUsage).where(eq(summaryUsage.repoId, repoId)).orderBy(summaryUsage.model, summaryUsage.transport).all();
}

/** Deletes summaries whose file or folder no longer exists (their vectors and search rows follow). Returns how many. */
export function pruneSummaries(db: Db, repoId: number): number {
    return db.run(sql`
        delete from summaries where repo_id = ${repoId} and (
            (target_kind = 'file' and not exists (select 1 from files f where f.repo_id = ${repoId} and f.path = summaries.target_path))
            or (target_kind = 'folder' and not exists (select 1 from folders d where d.repo_id = ${repoId} and d.path = summaries.target_path))
        )`).changes;
}
```
Then make the structure stage prune. In `lib/index/pipeline.ts`:
- Add `import { pruneSummaries } from "../db/store/summaries";`.
- After `replaceAggregates(db, repoId, folderRows, levelRows);`, add:
```ts
        pruneSummaries(db, repoId);   // a deleted file or folder takes its summary with it
```

- [ ] **Step 5: Run them to make sure they pass** — `npx vitest run lib/db/store/summaries.test.ts`. Expected: PASS (9 tests).

- [ ] **Step 6: Gate** — Expected: PASS, 158 tests.

- [ ] **Step 7: Commit and push**
```bash
git add lib/db/store/summaries.ts lib/db/store/summaries.test.ts test/helpers/mini-repo-facts.ts lib/index/pipeline.ts
git commit -m "feat: summary store: rows, in-flight batches, results, usage, pruning"
git push origin pivot/v1
```

---

### Task 6: Prompts and the summary planner (pure)

**Files:**
- Create: `lib/index/summarize/prompts.ts`, `lib/index/summarize/prompts.test.ts`, `lib/index/summarize/plan.ts`, `lib/index/summarize/plan.test.ts`

**Interfaces:**
- Consumes: `FileFacts`, `FolderFacts`, `StoredSummary`, `SummaryText`, `targetKey` (Task 5); `countLines` (V1.1); `dirOf` (V1.1).
- Produces:
  - `prompts.ts`:
    - Constants: `PROMPT_VERSION = 1`, `SUMMARY_MODELS = { file: "claude-haiku-5-5", folder: "claude-sonnet-5-5", repo: "claude-sonnet-5-5" }`, `SUMMARY_EFFORT = "low"`, `MAX_OUTPUT_TOKENS = 4096`, `MAX_SOURCE_CHARS = 20_000`, `MAX_FOLDER_ITEMS = 50`
    - System prompts: `FILE_SYSTEM_PROMPT`, `FOLDER_SYSTEM_PROMPT`, `REPO_SYSTEM_PROMPT`
    - Type `FolderItem`
    - Functions: `renderFilePrompt(listing, lineCount, source, maxChars?)`, `renderFolderPrompt(folder, items, maxItems?)`, `renderRepoPrompt(repo, items, maxItems?)`, `truncateSource(source, maxChars?)`, `testFileSummary(path, lineCount)`, `plural(n, word)`
  - `plan.ts`:
    - Type `TargetState = "current" | "template" | "ready" | "waiting" | "lazy" | "in-flight" | "failed"`
    - Type `PlannedTarget = { kind; path; model; inputHash; state; status: StoredSummaryStatus | null; templateText?; prompt? }`. It's structurally a `TargetUpdate`, so it can go straight to `applyTargetUpdates`.
    - Type `PlanOptions = { models; refreshStaleFolders; failedThisRun }`
    - Functions: `inputHash(model, promptVersion, input)`, `planSummaries(files, folders, stored, options): PlannedTarget[]` (in queue order)

- [ ] **Step 1: Write the failing prompt tests** — `lib/index/summarize/prompts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderFilePrompt, renderFolderPrompt, renderRepoPrompt, testFileSummary, truncateSource, type FolderItem } from "./prompts";

describe("truncateSource", () => {
    it("leaves source within the limit alone", () => {
        expect(truncateSource("a\nb\n", 10)).toBe("a\nb\n");
    });

    it("cuts at the last line break before the limit and says how many lines are missing", () => {
        expect(truncateSource("aaaa\nbbbb\ncccc\n", 7)).toBe("aaaa\n… (truncated: 2 more lines)");
    });

    it("cuts a single enormous line (minified code) at the limit itself", () => {
        expect(truncateSource("x".repeat(30), 10)).toBe(`${"x".repeat(10)}\n… (truncated: 1 more line)`);
    });
});

describe("renderFilePrompt", () => {
    it("starts with the imports/exports listing, then the line count and the source", () => {
        expect(renderFilePrompt("File: src/a.ts\n\nImports:\n  (none)", 2, "const a = 1;\nexport { a };\n"))
            .toBe("File: src/a.ts\n\nImports:\n  (none)\n\nLines: 2\n\nSource:\nconst a = 1;\nexport { a };\n");
    });
});

describe("renderFolderPrompt", () => {
    const items: FolderItem[] = [
        { name: "index.ts", kind: "file", fileCount: 1, lineCount: 1, text: { tagline: "Barrel", summary: "Re-exports log." } },
        { name: "log.ts", kind: "file", fileCount: 1, lineCount: 9, text: { tagline: "Logging", summary: "Writes lines." } },
        { name: "deep", kind: "folder", fileCount: 3, lineCount: 40, text: null },
    ];

    it("lists children largest first, folders with a slash, and marks missing summaries", () => {
        expect(renderFolderPrompt({ path: "src/core", fileCount: 5, directFileCount: 2 }, items)).toBe([
            "Folder: src/core",
            "5 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- deep/ (3 files): (no summary yet)",
            "- log.ts (9 lines): Logging — Writes lines.",
            "- index.ts (1 line): Barrel — Re-exports log.",
        ].join("\n"));
    });

    it("folds whatever doesn't fit into a count", () => {
        expect(renderFolderPrompt({ path: "src/core", fileCount: 5, directFileCount: 2 }, items, 2).split("\n").slice(-3)).toEqual([
            "- deep/ (3 files): (no summary yet)",
            "- log.ts (9 lines): Logging — Writes lines.",
            "- …and 1 smaller item",
        ]);
    });
});

describe("renderRepoPrompt", () => {
    it("names the repo and its size, then its top-level contents", () => {
        expect(renderRepoPrompt({ name: "mini-repo", fileCount: 8, folderCount: 6 }, [
            { name: "src", kind: "folder", fileCount: 7, lineCount: 45, text: { tagline: "App source", summary: "Everything." } },
        ])).toBe("Repository: mini-repo\n8 source files in 6 folders.\n\nTop-level contents, largest first:\n- src/ (7 files): App source — Everything.");
    });
});

describe("testFileSummary", () => {
    it("says what the file tests, from its name alone", () => {
        expect(testFileSummary("src/util/strings.test.ts", 3)).toEqual({
            tagline: "Tests for strings",
            summary: "Test code (3 lines) for strings. Test files get this template instead of a model-written summary.",
        });
        expect(testFileSummary("src/vs/base/test/common/utils.ts", 1).tagline).toBe("Tests for utils");
    });
});
```

- [ ] **Step 2: Run them to make sure they fail** — `npx vitest run lib/index/summarize/prompts.test.ts`. Expected: FAIL with `Failed to resolve import "./prompts"`.

- [ ] **Step 3: Implement** — `lib/index/summarize/prompts.ts`:
```ts
import type { SummaryText } from "../../db/store/summaries";
import { countLines } from "../languages/typescript";

/** Part of every inputHash. Bump it to redo every summary on purpose (a better prompt, new settings). */
export const PROMPT_VERSION = 1;

/** Who writes what (ADR-028): Haiku for the many files, Sonnet for the folders and the repo people read first. */
export const SUMMARY_MODELS = {
    file: "claude-haiku-5-5",
    folder: "claude-sonnet-5-5",
    repo: "claude-sonnet-5-5",
} as const;

/** Summaries are short and factual, so low effort keeps thinking (and cost) small. Tunable (PIVOT_SPEC.md §5.3). */
export const SUMMARY_EFFORT = "low" as const;

/** Room for the reply plus whatever thinking low effort does. Unused tokens cost nothing. */
export const MAX_OUTPUT_TOKENS = 4096;

/** About 6k tokens of source (PIVOT_SPEC.md §5.3): code runs roughly 3.5 characters per token. */
export const MAX_SOURCE_CHARS = 20_000;

/** A folder's prompt lists at most this many of its children, largest first. */
export const MAX_FOLDER_ITEMS = 50;

export const FILE_SYSTEM_PROMPT = [
    "You write the summary a developer sees for one source file while exploring an unfamiliar codebase.",
    "Give a tagline of at most 6 words and a summary of 2 to 4 sentences.",
    "The summary says what the file is responsible for, names its most important exports, and says how other code uses it when the source makes that clear.",
    "Use real identifiers from the file. Don't narrate the code line by line, and don't guess beyond what you're shown; if the source is truncated, summarize what's there.",
].join("\n");

export const FOLDER_SYSTEM_PROMPT = [
    "You write the summary a developer sees for one folder while exploring an unfamiliar codebase. You're given the summaries of the files and subfolders inside it.",
    "Give a tagline of at most 6 words and a summary of 2 to 4 sentences.",
    "The summary says what the folder is responsible for as a whole, which parts matter most, and how they fit together.",
    "Don't list every item, and don't guess beyond the summaries you're given.",
].join("\n");

export const REPO_SYSTEM_PROMPT = [
    "You write the overview a developer sees first when opening an unfamiliar repository. You're given the summaries of its top-level folders and files.",
    "Give a tagline of at most 6 words and a summary of 2 to 4 sentences.",
    "The summary says what the project is, names its main areas, and says where a newcomer should start reading.",
    "Don't guess beyond the summaries you're given.",
].join("\n");

/** One child of a folder, as its prompt shows it. lineCount is a folder's total, used only for ordering. */
export type FolderItem = { name: string; kind: "file" | "folder"; fileCount: number; lineCount: number; text: SummaryText | null };

/** "1 line", "9 lines", "12,103 files". */
export function plural(n: number, word: string): string {
    return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * A file's prompt: the imports/exports listing chunks.ts generates (it opens with
 * "File: <path>"), the line count, then the source, cut to about 6k tokens.
 */
export function renderFilePrompt(listing: string, lineCount: number, source: string, maxChars: number = MAX_SOURCE_CHARS): string {
    return [listing, "", `Lines: ${lineCount}`, "", "Source:", truncateSource(source, maxChars)].join("\n");
}

export function renderFolderPrompt(
    folder: { path: string; fileCount: number; directFileCount: number },
    items: readonly FolderItem[],
    maxItems: number = MAX_FOLDER_ITEMS
): string {
    return [
        `Folder: ${folder.path}`,
        `${plural(folder.fileCount, "source file")} in total, ${folder.directFileCount} directly inside.`,
        "",
        "Contents, largest first:",
        ...listItems(items, maxItems),
    ].join("\n");
}

export function renderRepoPrompt(
    repo: { name: string; fileCount: number; folderCount: number },
    items: readonly FolderItem[],
    maxItems: number = MAX_FOLDER_ITEMS
): string {
    return [
        `Repository: ${repo.name}`,
        `${plural(repo.fileCount, "source file")} in ${plural(repo.folderCount, "folder")}.`,
        "",
        "Top-level contents, largest first:",
        ...listItems(items, maxItems),
    ].join("\n");
}

/** Largest first (by lines), ties by name; the overflow becomes one "…and N smaller items" line. */
function listItems(items: readonly FolderItem[], maxItems: number): string[] {
    const sorted = [...items].sort((a, b) => b.lineCount - a.lineCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const lines = sorted.slice(0, maxItems).map((item) => {
        const label = item.kind === "folder"
            ? `${item.name}/ (${plural(item.fileCount, "file")})`
            : `${item.name} (${plural(item.lineCount, "line")})`;
        return `- ${label}: ${item.text ? `${item.text.tagline} — ${item.text.summary}` : "(no summary yet)"}`;
    });

    const hidden = sorted.length - maxItems;
    if (hidden > 0) lines.push(`- …and ${plural(hidden, "smaller item")}`);
    return lines;
}

/** The first maxChars of a file, cut at a line break when there is one, plus a note saying how much is missing. */
export function truncateSource(source: string, maxChars: number = MAX_SOURCE_CHARS): string {
    if (source.length <= maxChars) return source;

    const cut = source.lastIndexOf("\n", maxChars);
    const kept = cut > 0 ? source.slice(0, cut) : source.slice(0, maxChars);
    const rest = source.slice(cut > 0 ? cut + 1 : maxChars);
    return `${kept}\n… (truncated: ${plural(countLines(rest), "more line")})`;
}

/** Test files skip the model (PIVOT_SPEC.md §5.3). This template says what they are from the path alone. */
export function testFileSummary(filePath: string, lineCount: number): SummaryText {
    const base = filePath.slice(filePath.lastIndexOf("/") + 1);
    const subject = base.replace(/\.(test|spec)(?=\.[cm]?[jt]sx?$)/, "").replace(/\.[cm]?[jt]sx?$/, "");
    return {
        tagline: `Tests for ${subject}`,
        summary: `Test code (${plural(lineCount, "line")}) for ${subject}. Test files get this template instead of a model-written summary.`,
    };
}
```

- [ ] **Step 4: Run them to make sure they pass** — Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing planner tests** — `lib/index/summarize/plan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FILES, FOLDERS } from "../../../test/helpers/mini-repo-facts";
import type { StoredSummary } from "../../db/store/summaries";
import { inputHash, planSummaries, type PlanOptions, type PlannedTarget } from "./plan";
import { PROMPT_VERSION, SUMMARY_MODELS } from "./prompts";

const options = (overrides: Partial<PlanOptions> = {}): PlanOptions => ({
    models: SUMMARY_MODELS, refreshStaleFolders: true, failedThisRun: new Set(), ...overrides,
});

const ALL_FILES = FILES.map((f) => f.path);
const states = (targets: PlannedTarget[]) => targets.map((t) => [t.path, t.state]);
const readyPaths = (targets: PlannedTarget[]) => targets.filter((t) => t.state === "ready").map((t) => t.path);

/** Pretends the listed targets were just written: a model summary "T:<path>" / "S:<path>", or the template. */
function written(targets: PlannedTarget[], paths: string[], earlier: StoredSummary[] = []): StoredSummary[] {
    const rows = new Map(earlier.map((s) => [`${s.kind}:${s.path}`, s]));

    for (const t of targets.filter((x) => paths.includes(x.path))){
        rows.set(`${t.kind}:${t.path}`, {
            id: 0, kind: t.kind, path: t.path, model: t.model, inputHash: t.inputHash, batchId: null, error: null,
            status: t.templateText ? "skipped" : "fresh",
            tagline: t.templateText?.tagline ?? `T:${t.path}`,
            summary: t.templateText?.summary ?? `S:${t.path}`,
        });
    }

    return [...rows.values()];
}

/** Plans, "writes" whatever is ready, and repeats until nothing is: every wave's plan, and the rows at the end. */
function allWaves(): { waves: PlannedTarget[][]; stored: StoredSummary[] } {
    const waves: PlannedTarget[][] = [];
    let stored: StoredSummary[] = [];

    for (;;){
        const plan = planSummaries(FILES, FOLDERS, stored, options());
        const go = plan.filter((t) => t.state === "ready" || t.state === "template").map((t) => t.path);
        if (go.length === 0) return { waves, stored };
        waves.push(plan);
        stored = written(plan, go, stored);
    }
}

describe("planSummaries — the first run", () => {
    it("queues files most-imported first, gives the test file its template, and holds every folder back", () => {
        expect(states(planSummaries(FILES, FOLDERS, [], options()))).toEqual([
            ["src/app/main.ts", "ready"],
            ["src/core/log.ts", "ready"],
            ["src/util/strings.ts", "ready"],
            ["src/app/view.tsx", "ready"],
            ["src/core/index.ts", "ready"],
            ["src/index.ts", "ready"],
            ["scripts/build.js", "ready"],
            ["src/util/strings.test.ts", "template"],
            ["src/app", "waiting"],
            ["src/core", "waiting"],
            ["src/util", "waiting"],
            ["src", "waiting"],
            ["scripts", "waiting"],
            ["", "waiting"],
        ]);
    });

    it("sends files to Haiku and folders and the repo to Sonnet, and marks new rows pending", () => {
        const byPath = new Map(planSummaries(FILES, FOLDERS, [], options()).map((t) => [t.path, t]));
        expect(byPath.get("src/core/log.ts")).toMatchObject({ kind: "file", model: "claude-haiku-5-5", status: "pending" });
        expect(byPath.get("src/core")).toMatchObject({ kind: "folder", model: "claude-sonnet-5-5", status: "pending" });
        expect(byPath.get("")).toMatchObject({ kind: "repo", model: "claude-sonnet-5-5" });
        expect(byPath.get("src/util/strings.test.ts")).toMatchObject({
            model: "template",
            status: "skipped",
            templateText: { tagline: "Tests for strings", summary: "Test code (3 lines) for strings. Test files get this template instead of a model-written summary." },
        });
    });
});

describe("planSummaries — bottom-up waves", () => {
    it("releases folders once their children are written: 7 files, then 4 folders, then src, then the repo", () => {
        expect(allWaves().waves.map(readyPaths)).toEqual([
            ["src/app/main.ts", "src/core/log.ts", "src/util/strings.ts", "src/app/view.tsx", "src/core/index.ts", "src/index.ts", "scripts/build.js"],
            ["src/app", "src/core", "src/util", "scripts"],
            ["src"],
            [""],
        ]);
    });

    it("builds each folder's prompt from its children's summaries, largest first", () => {
        const wave2 = allWaves().waves[1];
        const prompt = (p: string) => wave2.find((t) => t.path === p)?.prompt;
        expect(prompt("src/core")).toBe([
            "Folder: src/core",
            "2 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- log.ts (9 lines): T:src/core/log.ts — S:src/core/log.ts",
            "- index.ts (1 line): T:src/core/index.ts — S:src/core/index.ts",
        ].join("\n"));
        expect(prompt("src/util")).toBe([
            "Folder: src/util",
            "2 source files in total, 2 directly inside.",
            "",
            "Contents, largest first:",
            "- strings.ts (6 lines): T:src/util/strings.ts — S:src/util/strings.ts",
            "- strings.test.ts (3 lines): Tests for strings — Test code (3 lines) for strings. Test files get this template instead of a model-written summary.",
        ].join("\n"));
    });

    it("builds the repo's prompt from its top-level folders, and then everything is current", () => {
        const { waves, stored } = allWaves();
        expect(waves[3].find((t) => t.path === "")?.prompt).toBe(
            "Repository: mini-repo\n8 source files in 6 folders.\n\nTop-level contents, largest first:\n- src/ (7 files): T:src — S:src\n- scripts/ (1 file): T:scripts — S:scripts");
        expect(planSummaries(FILES, FOLDERS, stored, options()).every((t) => t.state === "current")).toBe(true);
    });
});

describe("planSummaries — after the first run", () => {
    it("redoes only an edited file; its folder stays current until the file's new summary changes the folder's input", () => {
        const edited = FILES.map((f) => (f.path === "src/core/log.ts" ? { ...f, contentHash: "h-log-2" } : f));
        const plan = planSummaries(edited, FOLDERS, allWaves().stored, options());
        expect(plan.filter((t) => t.state !== "current").map((t) => [t.path, t.state, t.status])).toEqual([["src/core/log.ts", "ready", "stale"]]);
    });

    it("leaves an out-of-date folder lazy on incremental runs, and redoes it on full runs", () => {
        const stored = allWaves().stored.map((s) => (s.path === "src/core/log.ts" ? { ...s, tagline: "T2:src/core/log.ts" } : s));
        const notCurrent = (refreshStaleFolders: boolean) =>
            states(planSummaries(FILES, FOLDERS, stored, options({ refreshStaleFolders })).filter((t) => t.state !== "current"));
        expect(notCurrent(false)).toEqual([["src/core", "lazy"]]);
        expect(notCurrent(true)).toEqual([["src/core", "ready"]]);
    });

    it("redoes every model-written file summary when the file model changes (inputHash covers the model)", () => {
        const plan = planSummaries(FILES, FOLDERS, allWaves().stored, options({ models: { ...SUMMARY_MODELS, file: "claude-sonnet-5-5" } }));
        expect(readyPaths(plan)).toEqual(["src/app/main.ts", "src/core/log.ts", "src/util/strings.ts", "src/app/view.tsx", "src/core/index.ts", "src/index.ts", "scripts/build.js"]);
    });

    it("comes back to current when an edit is undone", () => {
        const stored = allWaves().stored.map((s) => (s.path === "src/core/log.ts" ? { ...s, status: "stale" as const } : s));
        expect(planSummaries(FILES, FOLDERS, stored, options()).find((t) => t.path === "src/core/log.ts")).toMatchObject({ state: "current", status: "fresh" });
    });
});

describe("planSummaries — in flight and failed", () => {
    it("never requeues a target a batch is carrying, and its folder waits for it", () => {
        const stored: StoredSummary[] = [{ id: 1, kind: "file", path: "src/app/main.ts", tagline: null, summary: null, model: null, inputHash: null, status: "pending", batchId: "batch-1", error: null }];
        const plan = planSummaries(FILES, FOLDERS, stored, options());
        expect(plan.find((t) => t.path === "src/app/main.ts")?.state).toBe("in-flight");
        expect(plan.find((t) => t.path === "src/app")?.state).toBe("waiting");
    });

    it("parks a target that failed earlier in this run, and lets its folder go ahead without it", () => {
        const stored = written(planSummaries(FILES, FOLDERS, [], options()), ALL_FILES.filter((p) => p !== "src/core/log.ts"));
        const plan = planSummaries(FILES, FOLDERS, stored, options({ failedThisRun: new Set(["file:src/core/log.ts"]) }));
        expect(plan.find((t) => t.path === "src/core/log.ts")?.state).toBe("failed");
        const core = plan.find((t) => t.path === "src/core");
        expect(core?.state).toBe("ready");
        expect(core?.prompt).toContain("- log.ts (9 lines): (no summary yet)");
    });
});

describe("inputHash", () => {
    it("changes with the model, the prompt version and the input, and only with them", () => {
        const base = inputHash("claude-haiku-5-5", PROMPT_VERSION, "input");
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION, "input")).toBe(base);
        expect(inputHash("claude-sonnet-5-5", PROMPT_VERSION, "input")).not.toBe(base);
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION + 1, "input")).not.toBe(base);
        expect(inputHash("claude-haiku-5-5", PROMPT_VERSION, "input2")).not.toBe(base);
    });
});
```

- [ ] **Step 6: Run them to make sure they fail** — `npx vitest run lib/index/summarize/plan.test.ts`. Expected: FAIL with `Failed to resolve import "./plan"`.

- [ ] **Step 7: Implement** — `lib/index/summarize/plan.ts`:
```ts
import { createHash } from "crypto";
import type { StoredSummaryStatus, SummaryTargetKind } from "../../db/schema";
import { targetKey, type FileFacts, type FolderFacts, type StoredSummary, type SummaryText } from "../../db/store/summaries";
import { dirOf } from "../paths";
import { PROMPT_VERSION, renderFolderPrompt, renderRepoPrompt, testFileSummary, type FolderItem } from "./prompts";

/**
 * current: the text matches the current input · template: a test file whose template is
 * missing or out of date, written right away · ready: needs a model and can go now ·
 * waiting: needs a model, but a child isn't done yet · lazy: an out-of-date folder left
 * for later (redone when someone opens it) · in-flight: a batch already carries it ·
 * failed: failed earlier in this run; the next run retries it
 */
export type TargetState = "current" | "template" | "ready" | "waiting" | "lazy" | "in-flight" | "failed";

export type PlannedTarget = {
    kind: SummaryTargetKind;
    path: string;
    /** The model that would write it, or "template". */
    model: string;
    inputHash: string;
    state: TargetState;
    /** The row's status from now on; null leaves it as it is. */
    status: StoredSummaryStatus | null;
    templateText?: SummaryText;
    /** Folders and the repo. A file's prompt is built from disk when it's sent. */
    prompt?: string;
};

export type PlanOptions = {
    models: { readonly file: string; readonly folder: string; readonly repo: string };
    /** true redoes out-of-date folders now (a full run); false leaves them lazy until opened (incremental runs). */
    refreshStaleFolders: boolean;
    /** targetKeys that failed earlier in this run: they wait for the next run. */
    failedThisRun: ReadonlySet<string>;
};

/** hash(model, prompt version, input) (PIVOT_SPEC.md §5.3): identical input is never summarized twice. */
export function inputHash(model: string, promptVersion: number, input: string): string {
    return createHash("sha256").update(`${model}\n${promptVersion}\n${input}`).digest("hex");
}

/** A child in one of these states won't change again this wave, so its folder can be summarized. */
const SETTLED: ReadonlySet<TargetState> = new Set(["current", "template", "lazy", "failed"]);

/**
 * Decides, for every file, folder and the repo, whether its summary is current and, if
 * not, whether it can be (re)written now. Pure: same facts in, same plan out. The result
 * is in queue order: central files first (most-imported), then folders bottom-up, the
 * repo last.
 */
export function planSummaries(
    files: readonly FileFacts[],
    folders: readonly FolderFacts[],
    stored: readonly StoredSummary[],
    options: PlanOptions
): PlannedTarget[] {
    const storedByKey = new Map(stored.map((s) => [targetKey(s.kind, s.path), s]));
    const planned = new Map<string, PlannedTarget>();

    // the text a target shows right now: its fresh template, else whatever its row holds
    const textOf = (target: PlannedTarget): SummaryText | null => {
        if (target.templateText) return target.templateText;
        const row = storedByKey.get(targetKey(target.kind, target.path));
        return row?.tagline && row.summary !== null ? { tagline: row.tagline, summary: row.summary } : null;
    };

    // ---- files: independent of each other ---------------------------------------------
    for (const file of files){
        const key = targetKey("file", file.path);
        const row = storedByKey.get(key);

        if (file.isTest){
            const text = testFileSummary(file.path, file.lineCount);
            const hash = inputHash("template", PROMPT_VERSION, `${file.path}\n${text.tagline}\n${text.summary}`);
            const current = row?.inputHash === hash;
            planned.set(key, current
                ? { kind: "file", path: file.path, model: "template", inputHash: hash, state: "current", status: row.status === "skipped" ? null : "skipped" }
                : { kind: "file", path: file.path, model: "template", inputHash: hash, state: "template", status: "skipped", templateText: text });
            continue;
        }

        // A file's prompt is built from its bytes, so its content hash stands in for the prompt
        // here: same bytes, same prompt. Planning then never has to read source files.
        const hash = inputHash(options.models.file, PROMPT_VERSION, `file\n${file.path}\n${file.contentHash}`);
        planned.set(key, decide("file", file.path, options.models.file, hash, row, true, options));
    }

    // ---- folders, deepest first, so every child is planned before its parent ------------
    const filesIn = new Map<string, FileFacts[]>();
    for (const file of files) push(filesIn, dirOf(file.path), file);

    const foldersIn = new Map<string, FolderFacts[]>();
    for (const folder of folders) if (folder.parentPath !== null) push(foldersIn, folder.parentPath, folder);

    // a folder's size, for ordering its parent's list: the lines of every file under it
    const linesBelow = new Map<string, number>();
    for (const file of files){
        for (let dir: string | null = dirOf(file.path); dir !== null; dir = dir === "" ? null : dirOf(dir)){
            linesBelow.set(dir, (linesBelow.get(dir) ?? 0) + file.lineCount);
        }
    }

    for (const folder of [...folders].sort((a, b) => b.depth - a.depth || compare(a.path, b.path))){
        const kind: SummaryTargetKind = folder.path === "" ? "repo" : "folder";
        const items: FolderItem[] = [];
        let settled = true;

        for (const file of filesIn.get(folder.path) ?? []){
            const child = planned.get(targetKey("file", file.path))!;
            settled &&= SETTLED.has(child.state);
            items.push({ name: file.path.slice(file.path.lastIndexOf("/") + 1), kind: "file", fileCount: 1, lineCount: file.lineCount, text: textOf(child) });
        }
        for (const sub of foldersIn.get(folder.path) ?? []){
            const child = planned.get(targetKey("folder", sub.path))!;
            settled &&= SETTLED.has(child.state);
            items.push({ name: sub.name, kind: "folder", fileCount: sub.fileCount, lineCount: linesBelow.get(sub.path) ?? 0, text: textOf(child) });
        }

        const model = kind === "repo" ? options.models.repo : options.models.folder;
        const prompt = kind === "repo"
            ? renderRepoPrompt({ name: folder.name, fileCount: folder.fileCount, folderCount: folders.length }, items)
            : renderFolderPrompt(folder, items);
        const key = targetKey(kind, folder.path);
        planned.set(key, { ...decide(kind, folder.path, model, inputHash(model, PROMPT_VERSION, prompt), storedByKey.get(key), settled, options), prompt });
    }

    // ---- queue order --------------------------------------------------------------------
    const importedBy = new Map(files.map((f) => [f.path, f.importedBy]));
    const folderByPath = new Map(folders.map((f) => [f.path, f]));
    const tier = (t: PlannedTarget): number => (t.kind === "file" ? 0 : t.kind === "folder" ? 1 : 2);

    return [...planned.values()].sort((a, b) => {
        if (tier(a) !== tier(b)) return tier(a) - tier(b);
        if (a.kind === "file") return (importedBy.get(b.path) ?? 0) - (importedBy.get(a.path) ?? 0) || compare(a.path, b.path);
        const fa = folderByPath.get(a.path)!;
        const fb = folderByPath.get(b.path)!;
        return fb.depth - fa.depth || fb.fileCount - fa.fileCount || compare(a.path, b.path);
    });
}

/** The state of one model-written target, given its stored row and whether its children are settled. */
function decide(
    kind: SummaryTargetKind,
    path: string,
    model: string,
    hash: string,
    row: StoredSummary | undefined,
    childrenSettled: boolean,
    options: PlanOptions
): PlannedTarget {
    const base = { kind, path, model, inputHash: hash };

    if (row?.batchId) return { ...base, state: "in-flight", status: null };
    if (options.failedThisRun.has(targetKey(kind, path))) return { ...base, state: "failed", status: null };
    // the text on the row was written for exactly this input (an undone edit lands here too)
    if (row?.inputHash === hash) return { ...base, state: "current", status: row.status === "fresh" ? null : "fresh" };

    const hasText = Boolean(row?.tagline);
    const status: StoredSummaryStatus = hasText ? "stale" : "pending";
    const keep = (state: TargetState): PlannedTarget => ({ ...base, state, status: row?.status === status ? null : status });

    if (kind !== "file" && hasText && !options.refreshStaleFolders) return keep("lazy");
    return keep(childrenSettled ? "ready" : "waiting");
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
```

- [ ] **Step 8: Run them to make sure they pass** — `npx vitest run lib/index/summarize`. Expected: PASS (20 tests).

- [ ] **Step 9: Gate** — Expected: PASS, 178 tests.

- [ ] **Step 10: Commit and push**
```bash
git add lib/index/summarize/prompts.ts lib/index/summarize/prompts.test.ts lib/index/summarize/plan.ts lib/index/summarize/plan.test.ts
git commit -m "feat: summary prompts and a pure planner: inputHash, bottom-up waves, lazy folders, queue order"
git push origin pivot/v1
```

---

### Task 7: The Claude transport

**Files:**
- Create: `lib/index/summarize/types.ts`, `lib/index/summarize/claude.ts`, `lib/index/summarize/claude.test.ts`, `lib/index/summarize/pricing.ts`, `lib/index/summarize/pricing.test.ts`, `lib/index/summarize/concurrency.ts`, `lib/index/summarize/concurrency.test.ts`
- Modify: `package.json`, `package-lock.json` (new dependency)

**Interfaces:**
- Consumes: `SummaryText` (Task 5); `MAX_OUTPUT_TOKENS`, `SUMMARY_EFFORT` (Task 6).
- Produces:
  - Types:
    - `TokenUsage = { inputTokens; outputTokens }`
    - `SummaryRequest = { customId; model; system; prompt }`
    - `SummaryOutcome = { customId; ok: true; text; model; usage } | { customId; ok: false; error; model: string | null; usage: TokenUsage | null }`
    - `interface Summarizer { summarize(request); submitBatch(requests): Promise<string>; batchResults(batchId): Promise<SummaryOutcome[] | null> }`
  - `claude.ts`: `SUMMARY_SCHEMA`, `requestParams(request, effort?)`, `parseSummary(reply)`, `outcomeFromReply(customId, reply)`, `outcomeFromBatchItem(item)`, `createClaudeSummarizer(client, effort?)`
  - `pricing.ts`: `pricePerMTok(model)`, `costUsd(model, usage, transport): number | null`
  - `concurrency.ts`: `mapLimit(items, limit, fn)`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk@^0.133.0`
Then run: `npm ls @anthropic-ai/sdk`
Expected: the root has `0.133.x`, and `@langchain/anthropic` keeps its own nested `0.120.0`. Its range is `^0.120.0`, which for a 0.x version allows only 0.120.

- [ ] **Step 2: Write the failing tests**
  - `lib/index/summarize/claude.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeSummarizer, outcomeFromBatchItem, parseSummary, requestParams, SUMMARY_SCHEMA } from "./claude";
import { FILE_SYSTEM_PROMPT } from "./prompts";
import type { SummaryRequest } from "./types";

const GOOD = JSON.stringify({ tagline: "Logging helpers", summary: "Writes log lines." });
const reply = (text: string, overrides: Record<string, unknown> = {}) => ({
    model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text }],
    usage: { input_tokens: 120, output_tokens: 30 }, ...overrides,
});
const request = (model: string): SummaryRequest => ({ customId: "s7", model, system: FILE_SYSTEM_PROMPT, prompt: "File: src/core/log.ts" });

describe("requestParams", () => {
    it("asks for the {tagline, summary} JSON at low effort, leaving thinking at the model's default", () => {
        expect(requestParams(request("claude-haiku-5-5"))).toEqual({
            model: "claude-haiku-5-5",
            max_tokens: 4096,
            system: FILE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: "File: src/core/log.ts" }],
            output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
        });
    });
});

describe("parseSummary", () => {
    it("reads the tagline and summary, trimming them and clamping the tagline to six words", () => {
        expect(parseSummary(reply(JSON.stringify({ tagline: "The central logging helpers for the core layer.", summary: " Writes log lines. " }))))
            .toEqual({ tagline: "The central logging helpers for the", summary: "Writes log lines." });
    });

    it("explains every way a reply can be unusable", () => {
        expect(() => parseSummary(reply(GOOD, { stop_reason: "refusal" }))).toThrow("the model declined to summarize this");
        expect(() => parseSummary(reply(GOOD, { stop_reason: "max_tokens" }))).toThrow("the reply ran past 4096 output tokens");
        expect(() => parseSummary(reply(GOOD, { content: [{ type: "thinking" }] }))).toThrow("the reply had no text");
        expect(() => parseSummary(reply("{not json"))).toThrow("the reply wasn't valid JSON");
        expect(() => parseSummary(reply(JSON.stringify({ tagline: "x" })))).toThrow("the reply didn't have a tagline and a summary");
    });
});

describe("outcomeFromBatchItem", () => {
    const item = (result: unknown) => ({ custom_id: "s1", result }) as Anthropic.Messages.MessageBatchIndividualResponse;

    it("turns each kind of batch result into a summary or a reason", () => {
        expect(outcomeFromBatchItem(item({ type: "succeeded", message: reply(GOOD) }))).toEqual({
            customId: "s1", ok: true, text: { tagline: "Logging helpers", summary: "Writes log lines." }, model: "claude-haiku-5-5",
            usage: { inputTokens: 120, outputTokens: 30 },
        });
        expect(outcomeFromBatchItem(item({ type: "errored", error: { type: "error", error: { type: "api_error", message: "overloaded" }, request_id: null } })))
            .toMatchObject({ ok: false, error: "batch request errored: overloaded" });
        expect(outcomeFromBatchItem(item({ type: "expired" }))).toMatchObject({ ok: false, error: "the batch expired before this request ran" });
        expect(outcomeFromBatchItem(item({ type: "canceled" }))).toMatchObject({ ok: false, error: "the batch was canceled" });
    });

    it("keeps the token count of a reply it couldn't use, so spend stays honest", () => {
        expect(outcomeFromBatchItem(item({ type: "succeeded", message: reply("{not json") }))).toEqual({
            customId: "s1", ok: false, error: "the reply wasn't valid JSON", model: "claude-haiku-5-5", usage: { inputTokens: 120, outputTokens: 30 },
        });
    });
});

describe("createClaudeSummarizer", () => {
    function fakeClient(){
        const calls: { endpoint: string; params: Record<string, unknown> }[] = [];
        const state = { ended: false, fail: false };
        const client = {
            messages: {
                create: async (params: Record<string, unknown>) => {
                    calls.push({ endpoint: "messages", params });
                    if (state.fail) throw new Error("connection reset");
                    return reply(GOOD, { model: params.model });
                },
                batches: {
                    create: async (params: Record<string, unknown>) => { calls.push({ endpoint: "batches", params }); return { id: "msgbatch_1" }; },
                    retrieve: async () => ({ processing_status: state.ended ? "ended" : "in_progress" }),
                    results: async () => (async function* (){
                        yield { custom_id: "s1", result: { type: "succeeded", message: reply(GOOD) } };
                        yield { custom_id: "s2", result: { type: "expired" } };
                    })(),
                },
            },
            beta: {
                messages: {
                    create: async (params: Record<string, unknown>) => { calls.push({ endpoint: "beta", params }); return reply(GOOD, { model: params.model }); },
                },
            },
        };
        return { client: client as unknown as Anthropic, calls, state };
    }

    it("sends Haiku requests to the regular endpoint, exactly as requestParams builds them", async () => {
        const { client, calls } = fakeClient();
        const outcome = await createClaudeSummarizer(client).summarize(request("claude-haiku-5-5"));
        expect(calls).toEqual([{ endpoint: "messages", params: requestParams(request("claude-haiku-5-5")) }]);
        expect(outcome).toMatchObject({ customId: "s7", ok: true, model: "claude-haiku-5-5" });
    });

    it("adds the server-side refusal fallback to Sonnet requests", async () => {
        const { client, calls } = fakeClient();
        await createClaudeSummarizer(client).summarize(request("claude-sonnet-5-5"));
        expect(calls).toEqual([{ endpoint: "beta", params: { ...requestParams(request("claude-sonnet-5-5")), betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } }]);
    });

    it("turns a thrown error into a failed outcome instead of throwing", async () => {
        const { client, state } = fakeClient();
        state.fail = true;
        expect(await createClaudeSummarizer(client).summarize(request("claude-haiku-5-5")))
            .toEqual({ customId: "s7", ok: false, error: "connection reset", model: null, usage: null });
    });

    it("submits a batch with custom ids, reports null until it ends, then one outcome per result", async () => {
        const { client, calls, state } = fakeClient();
        const summarizer = createClaudeSummarizer(client);
        expect(await summarizer.submitBatch([request("claude-haiku-5-5")])).toBe("msgbatch_1");
        expect(calls[0].params).toEqual({ requests: [{ custom_id: "s7", params: requestParams(request("claude-haiku-5-5")) }] });
        expect(await summarizer.batchResults("msgbatch_1")).toBeNull();
        state.ended = true;
        expect((await summarizer.batchResults("msgbatch_1"))?.map((o) => [o.customId, o.ok])).toEqual([["s1", true], ["s2", false]]);
    });
});
```
  - `lib/index/summarize/pricing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { costUsd } from "./pricing";

describe("costUsd", () => {
    it("prices tokens at list price, half for batches", () => {
        const million = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
        expect(costUsd("claude-haiku-5-5", million, "direct")).toBeCloseTo(0.6, 10);
        expect(costUsd("claude-haiku-5-5", million, "batch")).toBeCloseTo(0.3, 10);
        expect(costUsd("claude-sonnet-5-5", million, "direct")).toBeCloseTo(12, 10);
    });

    it("matches a longer model id to its family's price, and says when it has no price", () => {
        expect(costUsd("claude-sonnet-5-5-20261001", { inputTokens: 1_000_000, outputTokens: 0 }, "direct")).toBeCloseTo(2, 10);
        expect(costUsd("claude-opus-5-5", { inputTokens: 1, outputTokens: 1 }, "direct")).toBeNull();
    });
});
```
  - `lib/index/summarize/concurrency.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
    it("keeps results in input order and never runs more than the limit at once", async () => {
        let running = 0;
        let peak = 0;
        const results = await mapLimit([30, 10, 20, 0, 5], 2, async (ms) => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, ms));
            running--;
            return ms * 2;
        });
        expect(results).toEqual([60, 20, 40, 0, 10]);
        expect(peak).toBe(2);
    });

    it("returns an empty list for no items", async () => {
        expect(await mapLimit([], 4, async (x: number) => x)).toEqual([]);
    });
});
```

- [ ] **Step 3: Run them to make sure they fail** — `npx vitest run lib/index/summarize`. Expected: the three new files FAIL to resolve their imports.

- [ ] **Step 4: Implement**
  - `lib/index/summarize/types.ts`:
```ts
import type { SummaryText } from "../../db/store/summaries";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** One summary request. The custom id ("s<row id>") ties the answer back to its summaries row. */
export type SummaryRequest = { customId: string; model: string; system: string; prompt: string };

/** A request's answer. A failure keeps the model and tokens when a reply arrived but couldn't be used. */
export type SummaryOutcome =
    | { customId: string; ok: true; text: SummaryText; model: string; usage: TokenUsage }
    | { customId: string; ok: false; error: string; model: string | null; usage: TokenUsage | null };

/**
 * Everything the summary stage needs from Claude. createClaudeSummarizer (claude.ts)
 * talks to the real API; tests pass a stub, so no test makes a network call
 * (PIVOT_SPEC.md §11).
 */
export interface Summarizer {
    /** One request on the regular Messages API. Never throws: a failure is an outcome. */
    summarize(request: SummaryRequest): Promise<SummaryOutcome>;
    /** Submits requests as one Message Batch and returns its id. */
    submitBatch(requests: readonly SummaryRequest[]): Promise<string>;
    /** Every outcome once the batch has ended; null while it's still processing. */
    batchResults(batchId: string): Promise<SummaryOutcome[] | null>;
}
```
  - `lib/index/summarize/claude.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SummaryText } from "../../db/store/summaries";
import { MAX_OUTPUT_TOKENS, SUMMARY_EFFORT } from "./prompts";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "./types";

/** The reply we ask for, enforced by structured outputs (output_config.format). */
export const SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        tagline: { type: "string", description: "What this is, in at most 6 words." },
        summary: { type: "string", description: "2 to 4 sentences." },
    },
    required: ["tagline", "summary"],
    additionalProperties: false,
};

const replySchema = z.object({ tagline: z.string().trim().min(1), summary: z.string().trim().min(1) });

type Effort = "low" | "medium" | "high";

/**
 * Sonnet 5.5 on the regular API: if a safety classifier declines a request, the API runs
 * it again on a fallback model it picks by category. The Batches API rejects this
 * parameter, and Haiku 5.5 has no server-side fallback.
 */
const SONNET_FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/** What we read from a reply. Both Message (regular, batch) and BetaMessage fit. */
type Reply = {
    model: string;
    stop_reason: string | null;
    content: ReadonlyArray<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
};

/** One request's parameters, the same on the regular API and inside a batch. Thinking stays at the model's default (adaptive). */
export function requestParams(request: SummaryRequest, effort: Effort = SUMMARY_EFFORT) {
    return {
        model: request.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.system,
        messages: [{ role: "user" as const, content: request.prompt }],
        output_config: { effort, format: { type: "json_schema" as const, schema: SUMMARY_SCHEMA } },
    };
}

/** The tagline and summary in a reply, or an Error saying what was wrong with it. */
export function parseSummary(reply: Pick<Reply, "stop_reason" | "content">): SummaryText {
    if (reply.stop_reason === "refusal") throw new Error("the model declined to summarize this");
    if (reply.stop_reason === "max_tokens") throw new Error(`the reply ran past ${MAX_OUTPUT_TOKENS} output tokens`);

    const text = reply.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("the reply had no text");

    let json: unknown;
    try{
        json = JSON.parse(text);
    } catch{
        throw new Error("the reply wasn't valid JSON");
    }

    const parsed = replySchema.safeParse(json);
    if (!parsed.success) throw new Error("the reply didn't have a tagline and a summary");

    // "≤ 6 words" (PIVOT_SPEC.md §4.1) is a promise to the UI, so it's enforced here, not just asked for
    const tagline = parsed.data.tagline.split(/\s+/).slice(0, 6).join(" ").replace(/\.+$/, "");
    return { tagline, summary: parsed.data.summary };
}

export function outcomeFromReply(customId: string, reply: Reply): SummaryOutcome {
    const usage = { inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens };

    try{
        return { customId, ok: true, text: parseSummary(reply), model: reply.model, usage };
    } catch (err){
        return { customId, ok: false, error: messageOf(err), model: reply.model, usage };
    }
}

export function outcomeFromBatchItem(item: Anthropic.Messages.MessageBatchIndividualResponse): SummaryOutcome {
    const { custom_id: customId, result } = item;

    switch (result.type){
        case "succeeded":
            return outcomeFromReply(customId, result.message);
        case "errored":
            return { customId, ok: false, error: `batch request errored: ${result.error.error.message}`, model: null, usage: null };
        case "expired":
            return { customId, ok: false, error: "the batch expired before this request ran", model: null, usage: null };
        case "canceled":
            return { customId, ok: false, error: "the batch was canceled", model: null, usage: null };
    }
}

/**
 * The real Summarizer. Pass a client made with `new Anthropic({ maxRetries: 3 })`: the
 * SDK then retries connection errors, 408/409/429 and 5xx three times with backoff,
 * honouring retry-after (PIVOT_SPEC.md §5.7), before a request counts as failed.
 */
export function createClaudeSummarizer(client: Anthropic, effort: Effort = SUMMARY_EFFORT): Summarizer {
    return {
        async summarize(request){
            try{
                const params = requestParams(request, effort);
                const reply = request.model.startsWith("claude-sonnet")
                    ? await client.beta.messages.create({ ...params, ...SONNET_FALLBACK })
                    : await client.messages.create(params);
                return outcomeFromReply(request.customId, reply);
            } catch (err){
                return { customId: request.customId, ok: false, error: messageOf(err), model: null, usage: null };
            }
        },

        async submitBatch(requests){
            const batch = await client.messages.batches.create({
                requests: requests.map((r) => ({ custom_id: r.customId, params: requestParams(r, effort) })),
            });
            return batch.id;
        },

        async batchResults(batchId){
            const batch = await client.messages.batches.retrieve(batchId);
            if (batch.processing_status !== "ended") return null;

            // results arrive in any order: they're matched by custom_id, never by position
            const outcomes: SummaryOutcome[] = [];
            for await (const item of await client.messages.batches.results(batchId)){
                outcomes.push(outcomeFromBatchItem(item));
            }
            return outcomes;
        },
    };
}

function messageOf(err: unknown): string {
    if (err instanceof Anthropic.APIError) return `API error ${err.status ?? "(no status)"}: ${err.message}`;
    return err instanceof Error ? err.message : String(err);
}
```
  - `lib/index/summarize/pricing.ts`:
```ts
import type { TokenUsage } from "./types";

/**
 * USD per million tokens at Claude API list prices (claude-api skill, prices cached
 * 2026-10-06; check platform.claude.com/pricing before trusting them for money). Haiku's
 * prices hold for prompts up to 100K tokens, and ours stay far below that. Batch requests
 * cost half.
 */
const PRICES: Record<string, { input: number; output: number }> = {
    "claude-haiku-5-5": { input: 0.10, output: 0.50 },
    "claude-sonnet-5-5": { input: 2.00, output: 10.00 },
};

/** A model's prices, matching a longer id (a dated snapshot) to its family. Null when there's no price on file. */
export function pricePerMTok(model: string): { input: number; output: number } | null {
    if (PRICES[model]) return PRICES[model];
    const family = Object.keys(PRICES).find((known) => model.startsWith(known));
    return family ? PRICES[family] : null;
}

export function costUsd(model: string, usage: TokenUsage, transport: "direct" | "batch"): number | null {
    const price = pricePerMTok(model);
    if (!price) return null;

    const full = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
    return transport === "batch" ? full / 2 : full;
}
```
  - `lib/index/summarize/concurrency.ts`:
```ts
/**
 * Runs fn over items with at most `limit` calls in flight at once, keeping results in input
 * order. The regular API is rate limited, and a wave can hold up to 99 requests.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    // each worker takes the next unclaimed index; claiming is synchronous, so no two take the same one
    const worker = async (): Promise<void> => {
        while (next < items.length){
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
```

- [ ] **Step 5: Run them to make sure they pass** — `npx vitest run lib/index/summarize`. Expected: PASS (33 tests in that folder).

- [ ] **Step 6: Gate** — Expected: PASS, 191 tests.

- [ ] **Step 7: Commit and push**
```bash
git add package.json package-lock.json lib/index/summarize/types.ts lib/index/summarize/claude.ts lib/index/summarize/claude.test.ts lib/index/summarize/pricing.ts lib/index/summarize/pricing.test.ts lib/index/summarize/concurrency.ts lib/index/summarize/concurrency.test.ts
git commit -m "feat: Claude summarizer: structured {tagline, summary}, batches, Sonnet refusal fallback; pricing and a concurrency limit"
git push origin pivot/v1
```

---

### Task 8: The summary runner and `npm run summarize`

**Files:**
- Create: `lib/index/summarize/run.ts`, `lib/index/summarize/run.test.ts`, `test/helpers/summarizer.ts`, `scripts/env.ts`, `scripts/summarize.ts`
- Modify: `lib/db/schema.ts` (`META_KEYS`), `lib/db/store/lock.ts`, `lib/db/store/lock.test.ts`, `lib/db/store/structure.ts`, `lib/engine/status.ts`, `package.json`, `docs/API_CONTRACTS.md`, `docs/DATABASE_DESIGN.md`, `docs/ENGINEERING_DECISIONS.md` (ADR-033, ADR-028 note, ADR-032 note), `docs/PIVOT_SPEC.md` (§3, §5.3)

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces:
  - `acquireSummaryLock`, `releaseSummaryLock`, `touchSummaryLock`
  - `RepoNotIndexedError`, `requireRepository(db, rootPath): number`
  - `runSummaries(repoRoot, options): Promise<SummaryRunResult>`, `summarizeNow(repoRoot, targetPath, summarizer): Promise<StoredSummary>`, `buildFilePrompt(db, repoId, root, file)`
  - `type Transport = "auto" | "direct" | "batch"`, `BATCH_THRESHOLD = 100`, `MAX_BATCH_REQUESTS = 5_000`, `TargetNotFoundError`
  - The stub `stubSummarizer(options)` (test helper)
  - `npm run summarize`

- [ ] **Step 1: Write the stub** — `test/helpers/summarizer.ts`:
```ts
import type { SummaryText } from "../../lib/db/store/summaries";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "../../lib/index/summarize/types";

export type StubOptions = {
    /** Fixed texts by target path ("" is the repo). Everything else gets "About <subject>". */
    texts?: Record<string, SummaryText>;
    /** Target paths whose requests fail. */
    failPaths?: string[];
    /** How many polls a batch answers null before its results are ready. */
    pollsBeforeDone?: number;
};

/**
 * Stands in for Claude in tests (PIVOT_SPEC.md §11: tests make no network calls). It
 * answers from the prompt's first line ("File: src/a.ts", "Folder: src", "Repository:
 * mini-repo") and numbers each summary, so a redone summary always reads differently.
 */
export function stubSummarizer(options: StubOptions = {}){
    const requests: SummaryRequest[] = [];
    const batches = new Map<string, { requests: SummaryRequest[]; polls: number }>();
    let written = 0;

    const answer = (request: SummaryRequest): SummaryOutcome => {
        const subject = request.prompt.split("\n")[0];
        const target = subject.startsWith("Repository: ") ? "" : subject.slice(subject.indexOf(": ") + 2);

        if (options.failPaths?.includes(target)){
            return { customId: request.customId, ok: false, error: "stub failure", model: request.model, usage: { inputTokens: 10, outputTokens: 0 } };
        }

        written++;
        const text = options.texts?.[target] ?? { tagline: `About ${subject}`, summary: `Summary ${written} for ${subject}.` };
        return { customId: request.customId, ok: true, text, model: request.model, usage: { inputTokens: 100, outputTokens: 20 } };
    };

    const summarizer: Summarizer = {
        async summarize(request){
            requests.push(request);
            return answer(request);
        },
        async submitBatch(batch){
            const id = `batch-${batches.size + 1}`;
            requests.push(...batch);
            batches.set(id, { requests: [...batch], polls: 0 });
            return id;
        },
        async batchResults(id){
            const batch = batches.get(id);
            if (!batch) throw new Error(`no batch ${id}`);
            batch.polls++;
            return batch.polls > (options.pollsBeforeDone ?? 0) ? batch.requests.map(answer) : null;
        },
    };

    return { summarizer, requests, batches, subjects: () => requests.map((r) => r.prompt.split("\n")[0]) };
}
```

- [ ] **Step 2: Write the failing tests**
  - `lib/index/summarize/run.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { copyFixture } from "../../../test/helpers/fixture";
import { stubSummarizer } from "../../../test/helpers/summarizer";
import { getDb } from "../../db/client";
import { requireRepository } from "../../db/store/structure";
import { loadSummaries, loadUsage } from "../../db/store/summaries";
import { readIndexStatus } from "../../engine/status";
import { repoKey } from "../paths";
import { indexRepository } from "../pipeline";
import { runSummaries, summarizeNow, TargetNotFoundError } from "./run";

function indexedFixture(): string {
    const root = copyFixture();
    indexRepository(root);
    return root;
}

const rows = (root: string) => loadSummaries(getDb(), requireRepository(getDb(), repoKey(root)));
const row = (root: string, p: string) => rows(root).find((r) => r.path === p);

describe("runSummaries — the regular API", () => {
    it("summarizes the fixture in four bottom-up waves, central files first", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toEqual({
            total: 14, upToDate: 14, summarized: 13, templated: 1, failed: 0, lazy: 0, inFlight: 0, needModel: 0, batches: 0, waves: 4,
        });
        expect(stub.subjects()).toEqual([
            "File: src/app/main.ts", "File: src/core/log.ts", "File: src/util/strings.ts", "File: src/app/view.tsx",
            "File: src/core/index.ts", "File: src/index.ts", "File: scripts/build.js",
            "Folder: src/app", "Folder: src/core", "Folder: src/util", "Folder: scripts",
            "Folder: src",
            `Repository: ${path.basename(root)}`,
        ]);
        expect(row(root, "src/core/log.ts")).toMatchObject({ status: "fresh", model: "claude-haiku-5-5", tagline: "About File: src/core/log.ts" });
        expect(row(root, "")).toMatchObject({ kind: "repo", status: "fresh", model: "claude-sonnet-5-5" });
        expect(row(root, "src/util/strings.test.ts")).toMatchObject({ status: "skipped", model: "template", tagline: "Tests for strings" });
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "ready", done: 14, total: 14 });
        expect(loadUsage(getDb(), requireRepository(getDb(), repoKey(root)))).toEqual([
            { model: "claude-haiku-5-5", transport: "direct", requests: 7, inputTokens: 700, outputTokens: 140 },
            { model: "claude-sonnet-5-5", transport: "direct", requests: 6, inputTokens: 600, outputTokens: 120 },
        ]);
    });

    it("does nothing the second time: every inputHash still matches", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toMatchObject({ summarized: 0, templated: 0, waves: 0, upToDate: 14 });
        expect(stub.requests).toHaveLength(13);
    });

    it("isolates a failure: its folder goes ahead without it, and the next run redoes it and everything above", async () => {
        const root = indexedFixture();
        const failing = stubSummarizer({ failPaths: ["src/core/log.ts"] });

        expect(await runSummaries(root, { summarizer: failing.summarizer, transport: "direct" })).toMatchObject({ summarized: 12, failed: 1, upToDate: 13 });
        expect(row(root, "src/core/log.ts")).toMatchObject({ status: "failed", error: "stub failure" });
        expect(failing.requests.find((r) => r.prompt.startsWith("Folder: src/core"))?.prompt).toContain("- log.ts (9 lines): (no summary yet)");
        expect(readIndexStatus(root)?.stages.summaries).toEqual({ state: "ready", done: 13, total: 14, note: "1 failed this run (retried next run)" });

        // log.ts, then src/core (its input now has log.ts's summary), then src, then the repo
        expect(await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" })).toMatchObject({ summarized: 4, failed: 0, waves: 4 });
    });

    it("fails a file that changed on disk after indexing, without sending it", async () => {
        const root = indexedFixture();
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" })).toMatchObject({ failed: 1, summarized: 12 });
        expect(stub.subjects()).not.toContain("File: src/core/log.ts");
        expect(row(root, "src/core/log.ts")?.error).toBe("src/core/log.ts changed after it was indexed; run npm run index first");
    });

    it("without an API key writes the test template only and reports the stage off", async () => {
        const root = indexedFixture();

        expect(await runSummaries(root, { summarizer: null })).toMatchObject({ templated: 1, needModel: 13, summarized: 0, upToDate: 1 });
        expect(readIndexStatus(root)?.stages.summaries).toEqual({
            state: "off", done: 1, total: 14, note: "ANTHROPIC_API_KEY is not set, so 13 of 14 summaries can't be written",
        });
    });
});

describe("runSummaries — the Batch API", () => {
    it("sends one batch per wave and polls until each one ends", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer({ pollsBeforeDone: 1 });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, batches: 4, waves: 4, inFlight: 0 });
        expect([...stub.batches.values()].map((b) => [b.requests.length, b.polls])).toEqual([[7, 2], [4, 2], [1, 2], [1, 2]]);
    });

    it("with wait: false submits and returns; a later run collects that batch instead of resending it", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", wait: false }))
            .toMatchObject({ batches: 1, waves: 1, inFlight: 7, summarized: 0, upToDate: 1 });

        // the run that submitted is long gone, but the batch is still at Anthropic: still running, not crashed
        const muchLater = new Date(Date.now() + 6 * 60 * 1000);
        expect(readIndexStatus(root, muchLater)?.stages.summaries).toEqual({
            state: "running", done: 1, total: 14, note: "7 requests at Anthropic in batches; run npm run summarize to collect them",
        });

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "batch", pollIntervalMs: 0 }))
            .toMatchObject({ summarized: 13, batches: 3, waves: 3, inFlight: 0 });
        expect(stub.requests).toHaveLength(13);   // the 7 files were sent once, in batch-1
    });
});

describe("runSummaries — incremental runs and summarizeNow", () => {
    it("on an incremental run redoes the edited file and leaves its folder lazy until it's opened", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        indexRepository(root);

        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false }))
            .toMatchObject({ summarized: 1, lazy: 1 });
        expect(row(root, "src/core")?.status).toBe("stale");

        // opening src/core redoes it; that makes src lazy in turn
        expect(await summarizeNow(root, "src/core", stub.summarizer)).toMatchObject({ status: "fresh" });
        expect(await runSummaries(root, { summarizer: stub.summarizer, transport: "direct", refreshStaleFolders: false }))
            .toMatchObject({ summarized: 0, lazy: 1 });
        expect(row(root, "src")?.status).toBe("stale");
    });

    it("summarizeNow writes one file's summary, a test file's template without a call, and rejects unknown paths", async () => {
        const root = indexedFixture();
        const stub = stubSummarizer();

        expect(await summarizeNow(root, "src/core/log.ts", stub.summarizer)).toMatchObject({ status: "fresh", tagline: "About File: src/core/log.ts" });
        expect(await summarizeNow(root, "src/util/strings.test.ts", stub.summarizer)).toMatchObject({ status: "skipped", tagline: "Tests for strings" });
        expect(stub.requests).toHaveLength(1);
        await expect(summarizeNow(root, "src/nope.ts", stub.summarizer)).rejects.toThrow(TargetNotFoundError);
    });
});
```
  - Append to `lib/db/store/lock.test.ts`:
    - Add `acquireSummaryLock, releaseSummaryLock, touchSummaryLock` to its import from `"./lock"`.
    - Make the `afterEach` also call `releaseSummaryLock(getDb());`.
    - Add:
```ts

describe("summary lock", () => {
    it("is independent of the index lock, but refuses a second summary run", () => {
        const db = getDb();
        acquireIndexLock(db);
        expect(() => acquireSummaryLock(db)).not.toThrow();
        expect(() => acquireSummaryLock(db)).toThrow(/^Summarizing already in progress/);
    });

    it("stays fresh while its holder keeps touching it", () => {
        const db = getDb();
        const ancient = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000).toISOString();
        db.insert(meta).values({ key: META_KEYS.SUMMARIZING_LOCK, value: ancient }).run();
        touchSummaryLock(db);
        expect(() => acquireSummaryLock(db)).toThrow(IndexLockedError);
    });
});
```

- [ ] **Step 3: Run them to make sure they fail** — `npx vitest run lib/index/summarize/run.test.ts lib/db/store/lock.test.ts`. Expected: FAIL. `./run` and the summary-lock exports don't exist.

- [ ] **Step 4: Implement**
  - In `lib/db/schema.ts`, add `SUMMARIZING_LOCK: "summarizing"` to `META_KEYS` (after `INDEXING_LOCK`).
  - Append to `lib/db/store/lock.ts`:
```ts

/** Summary runs take a lock of their own: indexing may go on meanwhile, but two summary runs would pay twice. */
export function acquireSummaryLock(db: Db): void {
    acquireLock(db, META_KEYS.SUMMARIZING_LOCK, "Summarizing");
}

export function releaseSummaryLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.SUMMARIZING_LOCK)).run();
}

/** A batch wait can last hours. Refreshing the timestamp keeps a live run's lock from ever looking abandoned. */
export function touchSummaryLock(db: Db): void {
    db.update(meta).set({ value: new Date().toISOString(), updatedAt: new Date() }).where(eq(meta.key, META_KEYS.SUMMARIZING_LOCK)).run();
}
```
  - In `lib/db/store/structure.ts`, after `findRepository`, add:
```ts

/** Thrown when a command needs a repo that `npm run index` hasn't indexed yet. */
export class RepoNotIndexedError extends Error {
    constructor(rootPath: string){
        super(`${rootPath} isn't indexed yet. Run npm run index -- ${rootPath} first.`);
        this.name = "RepoNotIndexedError";
    }
}

/** The id of an indexed repo; throws RepoNotIndexedError if it was never indexed. */
export function requireRepository(db: Db, rootPath: string): number {
    const id = findRepository(db, rootPath);
    if (id === null) throw new RepoNotIndexedError(rootPath);
    return id;
}
```
  - In `lib/engine/status.ts`:
    1. Add `import { countInFlight } from "../db/store/summaries";`.
    2. Change the loop body to `stages[name] = honest(name, stored[name], now, () => countInFlight(db, repoId));`.
    3. Replace `honest` with:
```ts
/**
 * What a stored row means now: a "running" row nobody has written for minutes is a crash,
 * not progress (ADR-032). The exception is summaries with batches still at Anthropic: that
 * work goes on without any local process, so it stays running.
 */
function honest(name: StageName, stage: StoredStage | undefined, now: Date, inFlight: () => number): StageStatus {
    if (!stage) return { state: "idle", done: 0, total: 0 };

    const { updatedAt, ...status } = stage;
    const silent = status.state === "running" && now.getTime() - updatedAt.getTime() > RUNNING_STALE_AFTER_MS;
    if (!silent || (name === "summaries" && inFlight() > 0)) return status;

    return { ...status, state: "failed", note: `interrupted: no progress since ${updatedAt.toISOString()}` };
}
```
  - `lib/index/summarize/run.ts`:
```ts
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { SummaryTargetKind } from "../../db/schema";
import { getDb, type Db } from "../../db/client";
import { acquireSummaryLock, releaseSummaryLock, touchSummaryLock } from "../../db/store/lock";
import { writeStage } from "../../db/store/stages";
import { requireRepository } from "../../db/store/structure";
import {
    addUsage, applyTargetUpdates, countInFlight, inFlightBatches, loadBatchRows, loadFileFacts, loadFileSummaryChunk,
    loadFolderFacts, loadSummaries, markInFlight, targetKey, writeResults,
    type FileFacts, type StoredSummary, type SummaryResult,
} from "../../db/store/summaries";
import { repoKey } from "../paths";
import { mapLimit } from "./concurrency";
import { planSummaries, type PlannedTarget, type TargetState } from "./plan";
import { FILE_SYSTEM_PROMPT, FOLDER_SYSTEM_PROMPT, plural, REPO_SYSTEM_PROMPT, renderFilePrompt, SUMMARY_MODELS } from "./prompts";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "./types";

/** auto: the Batch API for waves of BATCH_THRESHOLD requests or more, the regular API below that. */
export type Transport = "auto" | "direct" | "batch";

export type SummaryRunOptions = {
    /** null without an API key: test-file templates are still written; everything else waits for a key. */
    summarizer: Summarizer | null;
    transport?: Transport;
    /** false: submit batches and return at once; running again collects them. */
    wait?: boolean;
    /** Redo out-of-date folders now (default). Incremental runs pass false: those wait until someone opens them. */
    refreshStaleFolders?: boolean;
    pollIntervalMs?: number;
    concurrency?: number;
    onProgress?: (message: string) => void;
};

export type SummaryRunResult = {
    /** Every target: files, folders and the repo. */
    total: number;
    /** Targets whose text matches their current input when the run ended. */
    upToDate: number;
    /** Summaries a model wrote during this run. */
    summarized: number;
    /** Test files given their template during this run. */
    templated: number;
    /** Requests that failed during this run; the next run retries them. */
    failed: number;
    /** Out-of-date folders left for later (refreshStaleFolders: false). */
    lazy: number;
    /** Requests still at Anthropic (wait: false). */
    inFlight: number;
    /** Targets that need a model and had none to go to (no API key). */
    needModel: number;
    batches: number;
    waves: number;
};

/** A wave this big goes through the Batch API at half price. A smaller one answers in seconds through the regular API. */
export const BATCH_THRESHOLD = 100;
/** Requests per Message Batch (PIVOT_SPEC.md §5.3), so one failed upload loses little. */
export const MAX_BATCH_REQUESTS = 5_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_MS = 60_000;

const SYSTEM_PROMPTS: Record<SummaryTargetKind, string> = {
    file: FILE_SYSTEM_PROMPT,
    folder: FOLDER_SYSTEM_PROMPT,
    repo: REPO_SYSTEM_PROMPT,
};

/** Thrown by summarizeNow for a path that's neither an indexed file nor a folder. */
export class TargetNotFoundError extends Error {
    constructor(targetPath: string){
        super(`Nothing indexed at "${targetPath}". Pass a repo-relative file or folder path ("" for the repo itself).`);
        this.name = "TargetNotFoundError";
    }
}

/** One planning pass: the plan, and the file facts it was made from. */
type Snapshot = { targets: PlannedTarget[]; files: Map<string, FileFacts> };

type Tally = { summarized: number; templated: number; failed: number; batches: number; waves: number };

type RunContext = {
    db: Db;
    repoId: number;
    root: string;
    failedThisRun: Set<string>;
    tally: Tally;
    say: (message: string) => void;
};

/** Where an answer goes: its row, and the input it answers. */
type Destination = { id: number; kind: SummaryTargetKind; path: string; inputHash: string; batchId: string | null };

/**
 * The summary stage (PIVOT_SPEC.md §5.3, ADR-033). Plans every target, sends whatever is
 * ready, and repeats. Folders become ready bottom-up as their children's summaries land:
 * VS Code's first pass takes about a dozen waves. Each wave picks its transport, and
 * batch ids are stored on the rows, so an interrupted run resumes instead of resending.
 */
export async function runSummaries(repoRoot: string, options: SummaryRunOptions): Promise<SummaryRunResult> {
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const summarizer = options.summarizer;
    const ctx: RunContext = {
        db, repoId, root,
        failedThisRun: new Set(),
        tally: { summarized: 0, templated: 0, failed: 0, batches: 0, waves: 0 },
        say: options.onProgress ?? (() => {}),
    };
    let last: PlannedTarget[] = [];

    acquireSummaryLock(db);
    try{
        for (;;){
            const snap = snapshot(db, repoId, options.refreshStaleFolders ?? true, ctx.failedThisRun);
            last = snap.targets;
            const ids = applyTargetUpdates(db, repoId, snap.targets);
            ctx.tally.templated += snap.targets.filter((t) => t.state === "template").length;

            const ready = snap.targets.filter((t) => t.state === "ready");
            const progress = (note: string) =>
                writeStage(db, repoId, "summaries", { state: "running", done: upToDate(snap.targets), total: snap.targets.length, note });

            if (summarizer && ready.length > 0){
                ctx.tally.waves++;
                const transport = options.transport ?? "auto";
                const useBatch = transport === "batch" || (transport === "auto" && ready.length >= BATCH_THRESHOLD);
                const how = useBatch ? "through the Batch API" : "through the regular API";
                progress(`wave ${ctx.tally.waves}: ${ready.length} to summarize ${how}`);
                ctx.say(`wave ${ctx.tally.waves}: ${ready.length} to summarize ${how}`);

                if (useBatch) await submitInBatches(ctx, summarizer, snap, ready, ids);
                else await sendDirect(ctx, summarizer, snap, ready, ids, options.concurrency ?? DEFAULT_CONCURRENCY);
                continue;
            }

            const batches = inFlightBatches(db, repoId);
            if (summarizer && batches.length > 0 && (options.wait ?? true)){
                await collectNextBatch(ctx, summarizer, options.pollIntervalMs ?? DEFAULT_POLL_MS,
                    () => progress(`waiting on ${plural(batches.length, "batch")} at Anthropic`));
                continue;
            }

            return finish(ctx, snap.targets, summarizer !== null);
        }
    } catch (err){
        writeStage(db, repoId, "summaries", { state: "failed", done: upToDate(last), total: last.length, note: messageOf(err) });
        throw err;
    } finally{
        releaseSummaryLock(db);
    }
}

/**
 * Summarizes one file or folder right now through the regular API, jumping the queue
 * (PIVOT_SPEC.md §5.3: the Map calls this when someone opens a path that has no summary,
 * or an out-of-date one). A current summary comes back as it is, without an API call.
 */
export async function summarizeNow(repoRoot: string, targetPath: string, summarizer: Summarizer): Promise<StoredSummary> {
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const snap = snapshot(db, repoId, true, new Set());
    const target = snap.targets.find((t) => t.path === targetPath);
    if (!target) throw new TargetNotFoundError(targetPath);

    const ids = applyTargetUpdates(db, repoId, [target]);

    if (target.state !== "current" && target.state !== "template"){
        const ctx: RunContext = { db, repoId, root, failedThisRun: new Set(), tally: { summarized: 0, templated: 0, failed: 0, batches: 0, waves: 0 }, say: () => {} };
        const built = buildRequest(ctx, snap, target, ids);
        const outcome = "failure" in built ? built.failure : await summarizer.summarize(built.request);
        const destinations = destinationsFor([target], ids);
        ingest(ctx, [outcome], "direct", (customId) => destinations.get(customId));
    }

    return loadSummaries(db, repoId).find((s) => s.kind === target.kind && s.path === target.path)!;
}

/**
 * A file's prompt, built from exactly the bytes the index saw. Null when the file changed
 * on disk after indexing, or vanished: a summary of different bytes would contradict the
 * structure the index holds for it.
 */
export function buildFilePrompt(db: Db, repoId: number, root: string, file: Pick<FileFacts, "path" | "contentHash" | "lineCount">): string | null {
    let source: string;
    try{
        source = fs.readFileSync(path.join(root, file.path), "utf8");
    } catch{
        return null;
    }

    if (createHash("sha256").update(source).digest("hex") !== file.contentHash) return null;

    const listing = loadFileSummaryChunk(db, repoId, file.path);
    return listing === null ? null : renderFilePrompt(listing, file.lineCount, source);
}

function snapshot(db: Db, repoId: number, refreshStaleFolders: boolean, failedThisRun: ReadonlySet<string>): Snapshot {
    // One read transaction: a structure run committing meanwhile can't hand us half of its changes.
    // (better-sqlite3 has one connection, so reads through `db` inside the callback belong to it.)
    return db.transaction(() => {
        const files = loadFileFacts(db, repoId);
        const targets = planSummaries(files, loadFolderFacts(db, repoId), loadSummaries(db, repoId), {
            models: SUMMARY_MODELS,
            refreshStaleFolders,
            failedThisRun,
        });
        return { targets, files: new Map(files.map((f) => [f.path, f])) };
    });
}

function buildRequest(ctx: RunContext, snap: Snapshot, target: PlannedTarget, ids: ReadonlyMap<string, number>): { request: SummaryRequest } | { failure: SummaryOutcome } {
    const customId = `s${ids.get(targetKey(target.kind, target.path))}`;
    let prompt = target.prompt ?? null;

    if (target.kind === "file"){
        const file = snap.files.get(target.path);
        prompt = file ? buildFilePrompt(ctx.db, ctx.repoId, ctx.root, file) : null;
    }

    if (prompt === null){
        return { failure: { customId, ok: false, error: `${target.path} changed after it was indexed; run npm run index first`, model: null, usage: null } };
    }

    return { request: { customId, model: target.model, system: SYSTEM_PROMPTS[target.kind], prompt } };
}

function destinationsFor(targets: readonly PlannedTarget[], ids: ReadonlyMap<string, number>): Map<string, Destination> {
    return new Map(targets.map((t) => {
        const id = ids.get(targetKey(t.kind, t.path))!;
        return [`s${id}`, { id, kind: t.kind, path: t.path, inputHash: t.inputHash, batchId: null }];
    }));
}

/** The regular API, a few at a time; each answer is written as it arrives, so a crash loses at most the ones in flight. */
async function sendDirect(ctx: RunContext, summarizer: Summarizer, snap: Snapshot, ready: readonly PlannedTarget[], ids: ReadonlyMap<string, number>, concurrency: number): Promise<void> {
    const destinations = destinationsFor(ready, ids);

    const outcomes = await mapLimit(ready, concurrency, async (target) => {
        const built = buildRequest(ctx, snap, target, ids);
        const outcome = "failure" in built ? built.failure : await summarizer.summarize(built.request);
        ingest(ctx, [outcome], "direct", (customId) => destinations.get(customId));
        return outcome;
    });

    const failed = outcomes.filter((o) => !o.ok).length;
    ctx.say(`wave ${ctx.tally.waves} done: ${outcomes.length - failed} summarized, ${failed} failed`);
}

/** Submits ready targets as Message Batches of up to MAX_BATCH_REQUESTS and records which batch carries each row. */
async function submitInBatches(ctx: RunContext, summarizer: Summarizer, snap: Snapshot, ready: readonly PlannedTarget[], ids: ReadonlyMap<string, number>): Promise<void> {
    const destinations = destinationsFor(ready, ids);

    for (let i = 0; i < ready.length; i += MAX_BATCH_REQUESTS){
        const requests: SummaryRequest[] = [];
        const failures: SummaryOutcome[] = [];

        // built one chunk at a time, so at most 5,000 prompts sit in memory at once
        for (const target of ready.slice(i, i + MAX_BATCH_REQUESTS)){
            const built = buildRequest(ctx, snap, target, ids);
            if ("failure" in built) failures.push(built.failure);
            else requests.push(built.request);
        }
        ingest(ctx, failures, "direct", (customId) => destinations.get(customId));
        if (requests.length === 0) continue;

        try{
            const batchId = await summarizer.submitBatch(requests);
            markInFlight(ctx.db, batchId, requests.map((r) => {
                const destination = destinations.get(r.customId)!;
                return { id: destination.id, inputHash: destination.inputHash };
            }));
            ctx.tally.batches++;
            ctx.say(`submitted ${batchId} with ${plural(requests.length, "request")}`);
        } catch (err){
            // nothing went out for this chunk: its targets wait for the next run
            const error = `couldn't submit the batch: ${messageOf(err)}`;
            ingest(ctx, requests.map((r) => ({ customId: r.customId, ok: false, error, model: null, usage: null })), "batch",
                (customId) => destinations.get(customId));
        }
    }
}

/** Polls the batches still at Anthropic until one has ended, then writes its answers. */
async function collectNextBatch(ctx: RunContext, summarizer: Summarizer, pollIntervalMs: number, heartbeat: () => void): Promise<void> {
    for (;;){
        for (const batchId of inFlightBatches(ctx.db, ctx.repoId)){
            const outcomes = await summarizer.batchResults(batchId);
            if (outcomes === null) continue;

            const destinations = new Map(loadBatchRows(ctx.db, batchId).map((r) => [`s${r.id}`, { ...r, batchId }]));
            ingest(ctx, outcomes, "batch", (customId) => destinations.get(customId));

            // a row the results never mention would otherwise stay "in flight" forever
            const answered = new Set(outcomes.map((o) => o.customId));
            const missing = [...destinations.keys()].filter((customId) => !answered.has(customId));
            ingest(ctx, missing.map((customId) => ({ customId, ok: false, error: "missing from the batch's results", model: null, usage: null })),
                "batch", (customId) => destinations.get(customId));

            const ok = outcomes.filter((o) => o.ok).length;
            ctx.say(`collected ${batchId}: ${ok} summarized, ${outcomes.length - ok + missing.length} failed`);
            return;
        }

        touchSummaryLock(ctx.db);
        heartbeat();
        ctx.say(`waiting on Anthropic (next check in ${Math.round(pollIntervalMs / 1000)} s)`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}

/** Writes outcomes to their rows and adds their tokens to the repo's spend. */
function ingest(ctx: RunContext, outcomes: readonly SummaryOutcome[], transport: "direct" | "batch", destinationOf: (customId: string) => Destination | undefined): void {
    const results: SummaryResult[] = [];
    const usage = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();

    for (const outcome of outcomes){
        const destination = destinationOf(outcome.customId);
        if (!destination) continue;   // its row is gone: the file or folder was deleted meanwhile

        results.push({
            id: destination.id,
            batchId: destination.batchId,
            inputHash: destination.inputHash,
            outcome: outcome.ok ? { ok: true, text: outcome.text, model: outcome.model } : { ok: false, error: outcome.error },
        });

        if (outcome.ok){
            ctx.tally.summarized++;
        } else{
            ctx.tally.failed++;
            ctx.failedThisRun.add(targetKey(destination.kind, destination.path));
        }

        if (outcome.model && outcome.usage){
            const sum = usage.get(outcome.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
            sum.requests++;
            sum.inputTokens += outcome.usage.inputTokens;
            sum.outputTokens += outcome.usage.outputTokens;
            usage.set(outcome.model, sum);
        }
    }

    writeResults(ctx.db, results);
    for (const [model, sum] of usage) addUsage(ctx.db, ctx.repoId, model, transport, sum);
}

function finish(ctx: RunContext, targets: readonly PlannedTarget[], hasSummarizer: boolean): SummaryRunResult {
    const count = (state: TargetState) => targets.filter((t) => t.state === state).length;
    const result: SummaryRunResult = {
        total: targets.length,
        upToDate: upToDate(targets),
        ...ctx.tally,
        lazy: count("lazy"),
        inFlight: countInFlight(ctx.db, ctx.repoId),
        needModel: hasSummarizer ? 0 : count("ready") + count("waiting"),
    };

    let state: "ready" | "running" | "off" = "ready";
    const notes: string[] = [];

    if (result.needModel > 0){
        state = "off";
        notes.push(`ANTHROPIC_API_KEY is not set, so ${result.needModel} of ${result.total} summaries can't be written`);
    } else if (result.inFlight > 0){
        state = "running";
        notes.push(`${plural(result.inFlight, "request")} at Anthropic in batches; run npm run summarize to collect them`);
    } else{
        if (result.failed > 0) notes.push(`${result.failed} failed this run (retried next run)`);
        if (result.lazy > 0) notes.push(`${result.lazy} out of date (redone when opened)`);
    }

    writeStage(ctx.db, ctx.repoId, "summaries", {
        state,
        done: result.upToDate,
        total: result.total,
        ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    });
    return result;
}

function upToDate(targets: readonly PlannedTarget[]): number {
    return targets.filter((t) => t.state === "current" || t.state === "template").length;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
```
  - `scripts/env.ts`:
```ts
import { nebulosityPath } from "../lib/home";

/** tsx doesn't read .env.local the way Next does, and that's where ANTHROPIC_API_KEY lives. */
export function loadLocalEnv(): void {
    try{
        process.loadEnvFile(nebulosityPath(".env.local"));
    } catch{
        // no .env.local: the key may still come from the shell
    }
}

/** Summaries need a key. Without one the stage reports "off", and everything else still works. */
export function hasAnthropicKey(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}
```
  - `scripts/summarize.ts`:
```ts
/**
 * npm run summarize -- <path-to-repo> [--direct | --batch] [--no-wait] [--path <repo-relative path>]
 *
 * Writes summaries for an indexed repository (PIVOT_SPEC.md §5.3).
 * - A big first pass goes through the Message Batches API at half price and can take hours.
 *   --no-wait submits and exits; running the command again collects what finished and
 *   carries on.
 * - --path summarizes one file or folder right now through the regular API (an empty path
 *   means the repo itself).
 */
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { getDb } from "../lib/db/client";
import { IndexLockedError } from "../lib/db/store/lock";
import { RepoNotIndexedError, requireRepository } from "../lib/db/store/structure";
import { loadUsage } from "../lib/db/store/summaries";
import { repoKey } from "../lib/index/paths";
import { createClaudeSummarizer } from "../lib/index/summarize/claude";
import { costUsd } from "../lib/index/summarize/pricing";
import { runSummaries, summarizeNow, TargetNotFoundError, type Transport } from "../lib/index/summarize/run";
import { hasAnthropicKey, loadLocalEnv } from "./env";

loadLocalEnv();

const args = process.argv.slice(2);
const target = args[0];

if (!target || target.startsWith("--")){
    console.error("usage: npm run summarize -- <path-to-repo> [--direct | --batch] [--no-wait] [--path <repo-relative path>]");
    process.exit(1);
}

const root = path.resolve(target);
const pathFlag = args.indexOf("--path");
const onePath = pathFlag === -1 ? null : (args[pathFlag + 1] ?? "");
const transport: Transport = args.includes("--direct") ? "direct" : args.includes("--batch") ? "batch" : "auto";
const say = (message: string): void => console.log(`[summarize] ${message}`);
const summarizer = hasAnthropicKey() ? createClaudeSummarizer(new Anthropic({ maxRetries: 3 })) : null;

async function main(): Promise<void> {
    if (onePath !== null){
        if (!summarizer){
            console.error("[summarize] ANTHROPIC_API_KEY is not set (put it in .env.local).");
            process.exit(1);
        }
        const row = await summarizeNow(root, onePath, summarizer);
        say(`${row.kind} ${row.path || "(repo)"}: ${row.status}${row.error ? ` (${row.error})` : ""}`);
        if (row.tagline) say(`${row.tagline} — ${row.summary}`);
    } else{
        if (!summarizer) say("ANTHROPIC_API_KEY is not set: writing test-file templates only (put the key in .env.local).");
        const result = await runSummaries(root, { summarizer, transport, wait: !args.includes("--no-wait"), onProgress: say });
        say(`up to date ${result.upToDate}/${result.total} · summarized ${result.summarized} · templated ${result.templated}`
            + ` · failed ${result.failed} · lazy ${result.lazy} · at Anthropic ${result.inFlight}`
            + ` · waves ${result.waves} · batches ${result.batches}`);
    }

    printSpend();
}

/** What this repo's summaries have cost so far, per model and transport (success criterion S2). */
function printSpend(): void {
    const db = getDb();
    let total = 0;

    for (const row of loadUsage(db, requireRepository(db, repoKey(root)))){
        const cost = costUsd(row.model, row, row.transport);
        total += cost ?? 0;
        say(`spend: ${row.model} ${row.transport} · ${row.requests} requests · ${row.inputTokens.toLocaleString("en-US")} in`
            + ` · ${row.outputTokens.toLocaleString("en-US")} out · ${cost === null ? "no price on file" : `$${cost.toFixed(4)}`}`);
    }

    say(`spend so far on this repo: $${total.toFixed(2)}`);
}

main().catch((err: unknown) => {
    if (err instanceof RepoNotIndexedError || err instanceof TargetNotFoundError){
        console.error(`[summarize] ${err.message}`);
        process.exit(1);
    }
    if (err instanceof IndexLockedError){
        console.error(`[summarize] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
        process.exit(2);
    }
    console.error(err);
    process.exit(1);
});
```
  - In `package.json` `"scripts"`, after `"index"`, add `"summarize": "tsx scripts/summarize.ts"`.

- [ ] **Step 5: Run them to make sure they pass** — `npx vitest run lib/index/summarize/run.test.ts lib/db/store/lock.test.ts`. Expected: PASS.

- [ ] **Step 6: Gate** — Expected: PASS, 202 tests.

- [ ] **Step 7: Document the decision**
  - Append ADR-033 to `docs/ENGINEERING_DECISIONS.md`, after ADR-032:
```md

## ADR-033 — Summary runs: bottom-up waves, a transport per wave, batch ids on the rows (‹today›)

**Context:** ADR-028 fixed the models, the Batch API for the first pass, `inputHash` caching and lazy folder refresh. Implementing it raised three questions:
- Folders need their children's summaries first, so the first pass can't be a single batch.
- A batch takes minutes to hours, and the process waiting on it may die.
- Two runs at once would pay twice.

**Decision:**
- **Waves.** A run is a loop of waves. Each wave plans every target with a pure function (`planSummaries`), sends whatever is ready, then waits for batches still at Anthropic.
  - Files are always ready.
  - A folder is ready when none of its children still waits for a model. A child that failed this run counts as done, shown as "no summary yet".
  - VS Code's first pass takes about a dozen waves, as many as its folder tree is deep.
- **A transport per wave.** 100 or more requests go through the Batch API, in batches of up to 5,000. Smaller waves use the regular API with 4 requests in flight and the SDK's own retries (`maxRetries: 3`, honouring `retry-after`). The small waves at the top of the tree then take seconds instead of a batch round-trip each.
- **Batch ids on the rows.** A submitted request is recorded on its summary row (`batch_id`, `pending_hash`), not in a jobs table. Any later run finds the batches still at Anthropic, collects them and carries on; `--no-wait` exits right after submitting. An answer only lands if its batch still owns the row.
- **A lock.** A `summarizing` lock (the same race-safe `meta` row as the index lock, refreshed while waiting) stops a second run from paying twice. It doesn't block indexing.
- **Templates and hashing.** Test files get a template (status `skipped`, model `template`). A file's `inputHash` hashes its content hash instead of its rendered prompt. That's equivalent, because the prompt is a pure function of the bytes and `PROMPT_VERSION`, and it means planning never reads source files.
- **Request settings.** Effort `low` with adaptive thinking (the models' default), structured outputs for `{ tagline, summary }`, and `max_tokens` 4,096. Sonnet requests on the regular API carry the server-side refusal fallback (`fallbacks: "default"`). The Batches API rejects that parameter, and Haiku 5.5 has no fallback.

**Alternatives:** (a) One batch for everything, with folders summarized from raw file text: no bottom-up synthesis, and much bigger folder inputs. (b) A jobs table: more state to keep consistent with the rows it describes. (c) Batch-only: each of the dozen top waves could wait hours.
**Consequences:** A crash costs at most the requests in flight on the regular API, and batch requests are collected rather than resent. API spend is recorded per model and transport (`summary_usage`), which is how S2 is measured.
**Revisit when:** waves cost too much wall time on a deeper repo (then submit folders speculatively), or refusals become common.
```
  - At the end of ADR-028's **Consequences:** line, add: `*(Amended ‹today› in slice V1.2: the run mechanics are ADR-033.)*`
  - At the end of ADR-032's **Decision:** line, add: `The one exception is a summaries stage with requests still at Anthropic: that work goes on without any local process, so it stays running (added with ADR-033).`
  - In `docs/API_CONTRACTS.md` §9, at the end of the "An honest `running`" bullet, add: ``The one exception is `summaries` with requests still in a Message Batch at Anthropic: that work is in progress without any local process, so it stays `running`, and its note says how to collect it.``
  - Append to `docs/DATABASE_DESIGN.md` §8:
```md
- **The `summarizing` lock** is a second `meta` lock row, taken by summary runs (ADR-033). Indexing can go on during a summary run; two summary runs can't, because both would pay for the same summaries. A run waiting on batches refreshes it, so it never looks abandoned.
```
  - In `docs/PIVOT_SPEC.md`:
    - In §3's target layout, replace `lib/index/summarize.ts      tiered summaries, Batch + on-demand` with `lib/index/summarize/        tiered summaries: prompts, planner, Claude transport, runner (Batch + on demand)`.
    - In §5.3, at the end of the **Transport.** bullet, add: `In practice the transport is chosen per wave (ADR-033): a run plans, sends what's ready and repeats as folders become ready bottom-up. Waves of 100+ requests go by batch and smaller ones by the regular API. Batch ids are stored on the summary rows, so an interrupted run resumes instead of resending.`
    - In §5.3, replace `**Test files get a templated summary with no API call.**` with `` **Test files get a templated summary with no API call** (status `skipped`). ``

- [ ] **Step 8: Smoke-test against the real API on the fixture** (needs `ANTHROPIC_API_KEY` in `.env.local`; 13 small requests, about 1¢):

Run: `npm run index -- test/fixtures/mini-repo` (migration 0004 cleared its hashes, so this re-parses it).
Then run: `npm run summarize -- test/fixtures/mini-repo --direct`
Expected:
- `wave 1` through `wave 4` with 7, 4, 1 and 1 requests.
- `up to date 14/14 · summarized 13 · templated 1 · failed 0`.
- Two `spend:` lines (one `claude-haiku-5-5 direct`, one `claude-sonnet-5-5 direct`).

Read a few of the summaries. `npm run summarize -- test/fixtures/mini-repo --path src/core/log.ts` prints a summary that's already current without making a new call; try `--path src/core` and `--path ""` too. Check that they name real identifiers.

If a request fails, read its error and fix the cause before going on. **Don't proceed with a broken transport.**

Then run: `npm run index -- ../vscode` (warm, about 5 s), so VS Code is the active repo again.

- [ ] **Step 9: Commit and push**
```bash
git add lib/index/summarize/run.ts lib/index/summarize/run.test.ts test/helpers/summarizer.ts scripts/env.ts scripts/summarize.ts package.json lib/db/schema.ts lib/db/store/lock.ts lib/db/store/lock.test.ts lib/db/store/structure.ts lib/engine/status.ts docs/ENGINEERING_DECISIONS.md docs/API_CONTRACTS.md docs/DATABASE_DESIGN.md docs/PIVOT_SPEC.md
git commit -m "feat: summary runs in bottom-up waves, batch or direct per wave, resumable; summarizeNow; npm run summarize"
git push origin pivot/v1
```

---

### Task 9: Summary embeddings

**Files:**
- Create: `lib/db/store/summary-vectors.ts`, `lib/index/embed.ts`, `lib/index/embed.test.ts`
- Modify: `scripts/summarize.ts`

**Interfaces:**
- Consumes: `summaryVectors` (Task 2), `writeStage` (Task 4), `requireRepository` (Task 8), `embedTexts`/`encodeVector` (`lib/embed.ts`, Phase 3).
- Produces:
  - Store functions: `loadSummariesWithoutVectors(db, repoId)`, `countEmbeddable(db, repoId)` (model-written summaries with text), `writeSummaryVectors(db, rows)`, `loadSummaryVectors(db, repoId)` (files and folders only), `summaryVectorStamp(db, repoId)`.
  - `lib/index/embed.ts`: `type EmbedFn`, `summaryEmbeddingText(s)`, `embedSummaries(repoRoot, options): Promise<{ embedded; total }>`.

- [ ] **Step 1: Write the failing tests** — `lib/index/embed.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { loadSummaries, writeResults } from "../db/store/summaries";
import { loadSummaryVectors } from "../db/store/summary-vectors";
import { readIndexStatus } from "../engine/status";
import { embedSummaries, summaryEmbeddingText, type EmbedFn } from "./embed";
import { repoKey } from "./paths";
import { indexRepository } from "./pipeline";
import { runSummaries } from "./summarize/run";

const fakeEmbed: EmbedFn = async (texts) => texts.map(() => Float32Array.from([1, 0, 0]));

async function summarizedFixture(): Promise<string> {
    const root = copyFixture();
    indexRepository(root);
    await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
    return root;
}

describe("embedSummaries", () => {
    it("embeds every model-written summary once, skips templates, and marks the stage ready", async () => {
        const root = await summarizedFixture();
        const repoId = requireRepository(getDb(), repoKey(root));

        expect(await embedSummaries(root, { embed: fakeEmbed })).toEqual({ embedded: 13, total: 13 });
        expect(await embedSummaries(root, { embed: fakeEmbed })).toEqual({ embedded: 0, total: 13 });
        expect(loadSummaryVectors(getDb(), repoId)).toHaveLength(12);   // the repo's own vector is left out of search
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "ready", done: 13, total: 13 });
    });

    it("re-embeds a rewritten summary, and only that one", async () => {
        const root = await summarizedFixture();
        await embedSummaries(root, { embed: fakeEmbed });
        const db = getDb();
        const log = loadSummaries(db, requireRepository(db, repoKey(root))).find((s) => s.path === "src/core/log.ts")!;
        writeResults(db, [{ id: log.id, batchId: null, inputHash: "new", outcome: { ok: true, text: { tagline: "New", summary: "S" }, model: "m" } }]);

        expect(await embedSummaries(root, { embed: fakeEmbed })).toEqual({ embedded: 1, total: 13 });
    });

    it("embeds what a summary says, then where it lives", () => {
        expect(summaryEmbeddingText({ path: "src/core/log.ts", tagline: "Logging", summary: "Writes lines." })).toBe("Logging\nWrites lines.\nsrc/core/log.ts");
    });

    it("marks the stage failed when the model can't load, and says why", async () => {
        const root = await summarizedFixture();
        const broken: EmbedFn = async () => { throw new Error("model unavailable"); };

        await expect(embedSummaries(root, { embed: broken })).rejects.toThrow("model unavailable");
        expect(readIndexStatus(root)?.stages.embeddings).toEqual({ state: "failed", done: 0, total: 13, note: "model unavailable" });
    });
});
```

- [ ] **Step 2: Run them to make sure they fail** — `npx vitest run lib/index/embed.test.ts`. Expected: FAIL with `Failed to resolve import "./embed"`.

- [ ] **Step 3: Implement**
  - `lib/db/store/summary-vectors.ts`:
```ts
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client";
import { summaries, summaryVectors, type SummaryTargetKind } from "../schema";
import { columnCount, forEachBatch } from "../batch";

/** The summaries worth a vector: written by a model (a template says little a keyword can't find). */
const embeddable = (repoId: number) => and(eq(summaries.repoId, repoId), isNotNull(summaries.tagline), ne(summaries.model, "template"));

export type SummaryToEmbed = { id: number; path: string; tagline: string; summary: string };

export function loadSummariesWithoutVectors(db: Db, repoId: number): SummaryToEmbed[] {
    return db.select({ id: summaries.id, path: summaries.targetPath, tagline: summaries.tagline, summary: summaries.summary })
        .from(summaries)
        .leftJoin(summaryVectors, eq(summaryVectors.summaryId, summaries.id))
        .where(and(embeddable(repoId), isNull(summaryVectors.id)))
        .orderBy(summaries.id)
        .all()
        .map((r) => ({ id: r.id, path: r.path, tagline: r.tagline!, summary: r.summary ?? "" }));
}

export function countEmbeddable(db: Db, repoId: number): number {
    return db.select({ n: sql<number>`count(*)` }).from(summaries).where(embeddable(repoId)).get()?.n ?? 0;
}

export function writeSummaryVectors(db: Db, rows: readonly { summaryId: number; embedding: Buffer }[]): void {
    db.transaction((tx) => {
        // onConflictDoNothing: a second embedder racing this one must not crash on summary_id's uniqueness
        forEachBatch(rows, columnCount(summaryVectors), (batch) => { tx.insert(summaryVectors).values(batch).onConflictDoNothing().run(); });
    });
}

export type StoredVector = { kind: SummaryTargetKind; path: string; embedding: Buffer };

/** Every file and folder vector of a repo. The repo's own summary is never a search hit, so its vector is left out. */
export function loadSummaryVectors(db: Db, repoId: number): StoredVector[] {
    return db.select({ kind: summaries.targetKind, path: summaries.targetPath, embedding: summaryVectors.embedding })
        .from(summaryVectors)
        .innerJoin(summaries, eq(summaries.id, summaryVectors.summaryId))
        .where(and(eq(summaries.repoId, repoId), ne(summaries.targetKind, "repo")))
        .orderBy(summaryVectors.id)
        .all();
}

/** Changes whenever a vector is added or removed (ids only grow), so a cache can tell when it's out of date. */
export function summaryVectorStamp(db: Db, repoId: number): string {
    const row = db.select({ n: sql<number>`count(*)`, maxId: sql<number | null>`max(${summaryVectors.id})` })
        .from(summaryVectors)
        .innerJoin(summaries, eq(summaries.id, summaryVectors.summaryId))
        .where(eq(summaries.repoId, repoId))
        .get();
    return `${row?.n ?? 0}:${row?.maxId ?? 0}`;
}
```
  - `lib/index/embed.ts`:
```ts
import path from "path";
import { getDb } from "../db/client";
import { writeStage } from "../db/store/stages";
import { requireRepository } from "../db/store/structure";
import { countEmbeddable, loadSummariesWithoutVectors, writeSummaryVectors } from "../db/store/summary-vectors";
import { embedTexts, encodeVector } from "../embed";
import { repoKey } from "./paths";

/** Texts → unit vectors. Tests pass a fake; the default is the local MiniLM model (ADR-005). */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export type EmbedRunOptions = {
    embed?: EmbedFn;
    /** Summaries embedded and committed together. */
    groupSize?: number;
    onProgress?: (done: number, total: number) => void;
};

/** What a summary's vector is made from (PIVOT_SPEC.md §5.4): what it is, what it does, then where it lives. */
export function summaryEmbeddingText(s: { path: string; tagline: string; summary: string }): string {
    return `${s.tagline}\n${s.summary}\n${s.path}`;
}

/**
 * The embeddings stage: a vector for every model-written summary that lacks one. A
 * summary loses its vector when its text is rewritten (writeResults), so re-running this
 * redoes exactly what changed. VS Code's ~15–20k summaries take about 15 minutes at
 * MiniLM's measured ~18 a second; V1.3 moves this onto a worker thread.
 */
export async function embedSummaries(repoRoot: string, options: EmbedRunOptions = {}): Promise<{ embedded: number; total: number }> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    const embed = options.embed ?? ((texts: string[]) => embedTexts(texts));
    const groupSize = options.groupSize ?? 256;
    const pending = loadSummariesWithoutVectors(db, repoId);
    const total = countEmbeddable(db, repoId);
    let done = total - pending.length;

    try{
        for (let i = 0; i < pending.length; i += groupSize){
            writeStage(db, repoId, "embeddings", { state: "running", done, total });
            const group = pending.slice(i, i + groupSize);
            const vectors = await embed(group.map(summaryEmbeddingText));
            writeSummaryVectors(db, group.map((s, j) => ({ summaryId: s.id, embedding: encodeVector(vectors[j]) })));
            done += group.length;
            options.onProgress?.(done, total);
        }
    } catch (err){
        writeStage(db, repoId, "embeddings", { state: "failed", done, total, note: err instanceof Error ? err.message : String(err) });
        throw err;
    }

    writeStage(db, repoId, "embeddings", { state: "ready", done, total });
    return { embedded: pending.length, total };
}
```
  - In `scripts/summarize.ts`:
    - Add `import { embedSummaries } from "../lib/index/embed";`.
    - In `main`, right before `printSpend();`, add:
```ts
    const embedded = await embedSummaries(root, {
        onProgress: (done, total) => process.stdout.write(`\r[summarize] embedding ${done}/${total}   `),
    });
    if (embedded.embedded > 0) process.stdout.write("\n");
    say(`embedded ${embedded.embedded} summaries; ${embedded.total} now have vectors`);
```
    - Update the header comment's first sentence to: `Writes summaries for an indexed repository (PIVOT_SPEC.md §5.3), then embeds them for search (§5.4).`

- [ ] **Step 4: Run them to make sure they pass** — `npx vitest run lib/index/embed.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Gate** — Expected: PASS, 206 tests. Then run `npm run summarize -- test/fixtures/mini-repo`. It's up to date, so it makes no API calls. Expected: `embedded 13 summaries; 13 now have vectors` (the real MiniLM model, from its local cache).

- [ ] **Step 6: Commit and push**
```bash
git add lib/db/store/summary-vectors.ts lib/index/embed.ts lib/index/embed.test.ts scripts/summarize.ts
git commit -m "feat: summary embeddings stage, redone exactly where summaries changed"
git push origin pivot/v1
```

---

### Task 10: Hybrid search

**Files:**
- Create: `lib/db/store/search.ts`, `lib/engine/search.ts`, `lib/engine/search.test.ts`, `scripts/search.ts`
- Modify: `lib/contracts.ts`, `package.json`, `docs/API_CONTRACTS.md` (§10), `docs/RAG_PIPELINE.md` (rewrite), `docs/ENGINEERING_DECISIONS.md` (ADR-027 note), `docs/PIVOT_SPEC.md` (§6.1)

**Interfaces:**
- Consumes: `code_fts`/`summary_fts` (Task 2), `splitIdentifier` (Task 3), the summary-vectors store and `EmbedFn` (Task 9), `targetKey` (Task 5), `decodeVector`/`embedTexts` (Phase 3).
- Produces:
  - Contract types: `SearchList`, `SearchHit`, `SearchResult`.
  - Store functions: `searchCode(db, repoId, ftsQuery, limit): CodeMatch[]`, `searchSummaries(db, repoId, ftsQuery, limit)`, `loadSummaryText(db, repoId, kind, path)`.
  - Engine (`lib/engine/search.ts`): `RRF_K = 60`, `LIST_DEPTH = 50`, `MIN_SIMILARITY = 0.25`, `toFtsQuery(query): string | null`, `fuseRankings(lists, k?)`, `search(repoRoot, query, { limit?, embed? }): Promise<SearchResult>`.
  - `npm run search`. V1.3's `GET /api/search` and V1.4's MCP `search` tool call `search`.

- [ ] **Step 1: Define the contract**
  - Append to `docs/API_CONTRACTS.md`:
````md

## 10. Search results (slice V1.2)

The hybrid search engine (`lib/engine/search.ts`, `RAG_PIPELINE.md` §6) returns a `SearchResult`. In V1.2 only `npm run search` shows it. `GET /api/search` serves it from V1.3, and the MCP `search` tool formats it as text in V1.4.

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
````
  - In the `docs/API_CONTRACTS.md` banner, change `§9 (`/api/status`) is live from slice V1.2.` to `§9 (`/api/status`) and §10 (search results) are live from slice V1.2.`
  - In `lib/contracts.ts`, after the "RAG: chunks" section's `SearchResponse` line, add:
```ts

/* ───────────────────────────── Search ────────────────────────────── */

/** The three ranked lists hybrid search fuses (ADR-027). */
export type SearchList = "code" | "summary" | "vector";

/** One file or folder in a search result — docs/API_CONTRACTS.md §10 */
export type SearchHit = {
  path: string;
  kind: "file" | "folder";
  /** Reciprocal Rank Fusion: Σ 1 / (60 + rank) over the lists that found it. */
  score: number;
  matchedBy: SearchList[];
  tagline?: string;
  summary?: string;
  /** The best-matching chunk, when the code list found this file. */
  code?: { symbol: string; startLine: number; endLine: number; snippet: string };
};

/** What search(query) returns — docs/API_CONTRACTS.md §10 */
export type SearchResult = {
  query: string;
  hits: SearchHit[];
  /** How many files or folders each list contributed before fusion. */
  lists: Record<SearchList, number>;
  /** Set when something limits the results, e.g. no summaries yet. */
  note?: string;
};
```

- [ ] **Step 2: Write the failing tests** — `lib/engine/search.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { fuseRankings, search, toFtsQuery } from "./search";

/**
 * A stand-in for MiniLM where "meaning" is hand-checkable: one dimension per group of
 * words that mean the same thing.
 */
const GROUPS = [["paint", "draw", "draws", "render", "renders"], ["log", "logs", "logging", "logger"]];
const fakeEmbed: EmbedFn = async (texts) => texts.map((text) => {
    const words = text.toLowerCase().split(/[^a-z]+/);
    const v = Float32Array.from(GROUPS.map((group) => words.filter((w) => group.includes(w)).length));
    const norm = Math.hypot(...v);
    return norm === 0 ? v : v.map((x) => x / norm);
});
const neverEmbed: EmbedFn = async () => { throw new Error("the model should not load: there are no vectors"); };

const TEXTS = {
    "src/core/log.ts": { tagline: "Console logging helpers", summary: "Defines log and the Logger class." },
    "src/core": { tagline: "Core services", summary: "Logging and the core barrel." },
    "src/app/view.tsx": { tagline: "Draws the app view", summary: "Renders the View component." },
};

function indexedFixture(): string {
    const root = copyFixture();
    indexRepository(root);
    return root;
}

async function summarizedFixture(): Promise<string> {
    const root = indexedFixture();
    await runSummaries(root, { summarizer: stubSummarizer({ texts: TEXTS }).summarizer, transport: "direct" });
    await embedSummaries(root, { embed: fakeEmbed });
    return root;
}

describe("toFtsQuery", () => {
    it("keeps the meaningful words of a question, each quoted, ORed", () => {
        expect(toFtsQuery("Where are editor tabs rendered?")).toBe('"editor" OR "tabs" OR "rendered"');
    });

    it("adds the words inside an identifier next to the identifier itself", () => {
        expect(toFtsQuery("openEditor")).toBe('"openeditor" OR "open" OR "editor"');
        expect(toFtsQuery("ICodeEditorService")).toBe('"icodeeditorservice" OR "code" OR "editor" OR "service"');
    });

    it("neutralizes FTS5 syntax, and returns null when nothing searchable is left", () => {
        expect(toFtsQuery('src/vs/* AND "tabs"')).toBe('"src" OR "vs" OR "tabs"');
        expect(toFtsQuery('" OR NOT (')).toBeNull();
        expect(toFtsQuery("the")).toBeNull();
    });
});

describe("fuseRankings", () => {
    it("adds 1 / (60 + rank) for every list that ranks a target, best total first", () => {
        const fused = fuseRankings({ code: ["a", "b", "c"], summary: ["b"], vector: ["c", "b"] });
        expect(fused.map((f) => [f.key, f.matchedBy])).toEqual([
            ["b", ["code", "summary", "vector"]],
            ["c", ["code", "vector"]],
            ["a", ["code"]],
        ]);
        expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61 + 1 / 62, 12);
        expect(fused[1].score).toBeCloseTo(1 / 63 + 1 / 61, 12);
        expect(fused[2].score).toBeCloseTo(1 / 61, 12);
    });

    it("breaks ties by key, so the order never depends on luck", () => {
        expect(fuseRankings({ code: ["file:y"], summary: ["file:x"] }).map((f) => f.key)).toEqual(["file:x", "file:y"]);
    });
});

describe("search", () => {
    it("finds a declaration by name with code keywords alone, before any summary exists", async () => {
        const result = await search(indexedFixture(), "shout", { embed: neverEmbed });
        expect(result.hits[0]).toEqual({
            path: "src/util/strings.ts", kind: "file", score: 1 / 61, matchedBy: ["code"],
            code: { symbol: "shout", startLine: 3, endLine: 6, snippet: expect.stringContaining("shout") },
        });
        expect(result.lists).toEqual({ code: 3, summary: 0, vector: 0 });
        expect(result.note).toBe("Summaries aren't ready yet, so results come from code keywords only.");
    });

    it("ranks the file every list agrees on first, and finds the folder through its summary and meaning", async () => {
        const result = await search(await summarizedFixture(), "logging", { embed: fakeEmbed });
        expect(result.hits[0]).toMatchObject({ path: "src/core/log.ts", kind: "file", matchedBy: ["code", "summary", "vector"], tagline: "Console logging helpers" });
        expect(result.hits[1]).toMatchObject({ path: "src/core", kind: "folder", matchedBy: ["summary", "vector"], tagline: "Core services" });
        expect(result.note).toBeUndefined();
    });

    it("finds by meaning a summary that shares no word with the query", async () => {
        const result = await search(await summarizedFixture(), "paint", { embed: fakeEmbed });
        expect(result.hits).toEqual([{
            path: "src/app/view.tsx", kind: "file", score: 1 / 61, matchedBy: ["vector"],
            tagline: "Draws the app view", summary: "Renders the View component.",
        }]);
        expect(result.lists).toEqual({ code: 0, summary: 0, vector: 1 });
    });

    it("never throws on FTS5 syntax in the query", async () => {
        const result = await search(indexedFixture(), 'shout(" OR NOT *', { embed: neverEmbed });
        expect(result.hits[0].path).toBe("src/util/strings.ts");
    });

    it("keeps the keyword results when the embedding model fails, and says so", async () => {
        const offline: EmbedFn = async () => { throw new Error("offline"); };
        const result = await search(await summarizedFixture(), "shout", { embed: offline });
        expect(result.hits[0].path).toBe("src/util/strings.ts");
        expect(result.note).toBe("Meaning search is unavailable (offline), so results come from keywords only.");
    });
});
```

- [ ] **Step 3: Run them to make sure they fail** — `npx vitest run lib/engine/search.test.ts`. Expected: FAIL with `Failed to resolve import "./search"`.

- [ ] **Step 4: Implement**
  - `lib/db/store/search.ts`:
```ts
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { summaries, type SummaryTargetKind } from "../schema";
import type { SummaryText } from "./summaries";

export type CodeMatch = { path: string; symbol: string; startLine: number; endLine: number; snippet: string };

/** Chunks matching an FTS5 query, best first (bm25 with the weights migration 0004 stored as `rank`). */
export function searchCode(db: Db, repoId: number, ftsQuery: string, limit: number): CodeMatch[] {
    return db.all<CodeMatch>(sql`
        select f.path as path, c.name as symbol, c.start_line as startLine, c.end_line as endLine,
               snippet(code_fts, 3, '', '', '…', 24) as snippet
        from code_fts
        join chunks c on c.id = code_fts.rowid
        join files f on f.id = c.file_id
        where code_fts match ${ftsQuery} and f.repo_id = ${repoId}
        order by code_fts.rank
        limit ${limit}`);
}

/** File and folder summaries matching an FTS5 query, best first. The repo's own summary is never a hit. */
export function searchSummaries(db: Db, repoId: number, ftsQuery: string, limit: number): { kind: SummaryTargetKind; path: string }[] {
    return db.all<{ kind: SummaryTargetKind; path: string }>(sql`
        select s.target_kind as kind, s.target_path as path
        from summary_fts
        join summaries s on s.id = summary_fts.rowid
        where summary_fts match ${ftsQuery} and s.repo_id = ${repoId} and s.target_kind != 'repo'
        order by summary_fts.rank
        limit ${limit}`);
}

export function loadSummaryText(db: Db, repoId: number, kind: SummaryTargetKind, targetPath: string): SummaryText | null {
    const row = db.select({ tagline: summaries.tagline, summary: summaries.summary })
        .from(summaries)
        .where(and(eq(summaries.repoId, repoId), eq(summaries.targetKind, kind), eq(summaries.targetPath, targetPath)))
        .get();
    return row?.tagline ? { tagline: row.tagline, summary: row.summary ?? "" } : null;
}
```
  - `lib/engine/search.ts`:
```ts
import path from "path";
import type { SearchHit, SearchList, SearchResult } from "../contracts";
import { getDb, type Db } from "../db/client";
import { loadSummaryText, searchCode, searchSummaries, type CodeMatch } from "../db/store/search";
import { requireRepository } from "../db/store/structure";
import { targetKey } from "../db/store/summaries";
import { countEmbeddable, loadSummaryVectors, summaryVectorStamp } from "../db/store/summary-vectors";
import { decodeVector, embedTexts } from "../embed";
import type { EmbedFn } from "../index/embed";
import { splitIdentifier } from "../index/identifiers";
import { repoKey } from "../index/paths";

/** RRF's k (ADR-027): rank 1 scores 1/61 and rank 50 scores 1/110, so no single list dominates. */
export const RRF_K = 60;
/** How many files or folders each list contributes to the fusion. */
export const LIST_DEPTH = 50;
/** Cosine similarity below this is noise for MiniLM (the threshold Phase 4 measured). */
export const MIN_SIMILARITY = 0.25;
/** Chunks fetched from code search before they're grouped by file. */
const CODE_CHUNKS = 200;

/** Words that only make a natural-language question longer. */
const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "if", "in",
    "is", "it", "its", "me", "my", "not", "of", "on", "or", "should", "so", "that", "the", "their", "then", "there",
    "these", "this", "those", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

type Target = { kind: "file" | "folder"; path: string };

export type SearchOptions = { limit?: number; embed?: EmbedFn };

/**
 * Turns free text into a safe FTS5 query. Every word is quoted, so nothing the user types
 * is read as FTS5 syntax. Identifiers also contribute their parts ("openEditor" adds "open"
 * and "editor"). The words are ORed, and bm25 ranks documents matching more and rarer
 * words higher. Null when nothing searchable is left.
 */
export function toFtsQuery(query: string): string | null {
    const terms: string[] = [];
    const add = (term: string): void => {
        if (term.length > 1 && !STOPWORDS.has(term) && !terms.includes(term)) terms.push(term);
    };

    for (const token of query.match(/[\p{L}\p{N}_]+/gu) ?? []){
        add(token.toLowerCase());
        for (const part of splitIdentifier(token).split(" ")) add(part);
    }

    return terms.length === 0 ? null : terms.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Reciprocal Rank Fusion (ADR-027): score(d) = Σ 1 / (k + rank), rank 1-based, over every
 * list that contains d. It combines lists whose own scores (bm25, cosine) aren't comparable,
 * using only positions. Ties break by key, so the order is deterministic.
 */
export function fuseRankings(lists: Partial<Record<SearchList, readonly string[]>>, k: number = RRF_K): { key: string; score: number; matchedBy: SearchList[] }[] {
    const fused = new Map<string, { key: string; score: number; matchedBy: SearchList[] }>();

    for (const list of ["code", "summary", "vector"] as const){
        (lists[list] ?? []).forEach((key, i) => {
            const entry = fused.get(key) ?? { key, score: 0, matchedBy: [] };
            entry.score += 1 / (k + i + 1);
            entry.matchedBy.push(list);
            fused.set(key, entry);
        });
    }

    return [...fused.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Hybrid search (PIVOT_SPEC.md §6.1, RAG_PIPELINE.md §6). Three ranked lists of files
 * and folders are fused with RRF:
 * 1. bm25 over code, grouped by file;
 * 2. bm25 over summaries;
 * 3. cosine similarity between the query and every summary vector.
 */
export async function search(repoRoot: string, query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    const limit = options.limit ?? 10;
    const embed = options.embed ?? ((texts: string[]) => embedTexts(texts));
    const notes: string[] = [];
    const targets = new Map<string, Target>();
    const remember = (target: Target): string => {
        const key = targetKey(target.kind, target.path);
        targets.set(key, target);
        return key;
    };

    // 1. keywords in code: the best chunk of each file stands for the file
    const fts = toFtsQuery(query);
    const bestChunk = new Map<string, CodeMatch>();
    for (const match of fts ? searchCode(db, repoId, fts, CODE_CHUNKS) : []){
        if (!bestChunk.has(match.path)) bestChunk.set(match.path, match);
    }
    const code = [...bestChunk.keys()].slice(0, LIST_DEPTH).map((p) => remember({ kind: "file", path: p }));

    // 2. keywords in summaries
    const summary = (fts ? searchSummaries(db, repoId, fts, LIST_DEPTH) : [])
        .map((m) => remember({ kind: m.kind === "folder" ? "folder" : "file", path: m.path }));

    // 3. meaning (the model only loads when there are vectors to compare against)
    let vector: string[] = [];
    const index = vectorsFor(db, repoId);
    if (index.targets.length > 0){
        try{
            const [queryVector] = await embed([query]);
            vector = rankByCosine(queryVector, index).slice(0, LIST_DEPTH).map(remember);
        } catch (err){
            notes.push(`Meaning search is unavailable (${err instanceof Error ? err.message : String(err)}), so results come from keywords only.`);
        }
    }

    if (countEmbeddable(db, repoId) === 0) notes.unshift("Summaries aren't ready yet, so results come from code keywords only.");
    else if (index.targets.length === 0) notes.unshift("Summaries aren't embedded yet, so results come from keywords only.");

    const hits: SearchHit[] = fuseRankings({ code, summary, vector }).slice(0, limit).map(({ key, score, matchedBy }) => {
        const target = targets.get(key)!;
        const text = loadSummaryText(db, repoId, target.kind, target.path);
        const chunk = target.kind === "file" ? bestChunk.get(target.path) : undefined;
        return {
            path: target.path,
            kind: target.kind,
            score,
            matchedBy,
            ...(text ? { tagline: text.tagline, summary: text.summary } : {}),
            ...(chunk ? { code: { symbol: chunk.symbol, startLine: chunk.startLine, endLine: chunk.endLine, snippet: chunk.snippet.replace(/\s+/g, " ").trim() } } : {}),
        };
    });

    if (fts === null && hits.length === 0) notes.push("The query has only very common words; try more specific ones.");

    return {
        query,
        hits,
        lists: { code: code.length, summary: summary.length, vector: vector.length },
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
}

/** Every summary vector of a repo in one flat matrix, reloaded only when the set of vectors changes. */
type VectorIndex = { stamp: string; targets: Target[]; dims: number; matrix: Float32Array };
const vectorCache = new Map<number, VectorIndex>();

function vectorsFor(db: Db, repoId: number): VectorIndex {
    const stamp = summaryVectorStamp(db, repoId);
    const cached = vectorCache.get(repoId);
    if (cached?.stamp === stamp) return cached;

    const rows = loadSummaryVectors(db, repoId);
    const vectors = rows.map((r) => decodeVector(r.embedding));
    const dims = vectors[0]?.length ?? 0;
    const matrix = new Float32Array(rows.length * dims);
    vectors.forEach((v, i) => matrix.set(v, i * dims));

    const index: VectorIndex = {
        stamp,
        dims,
        matrix,
        targets: rows.map((r): Target => ({ kind: r.kind === "folder" ? "folder" : "file", path: r.path })),
    };
    vectorCache.set(repoId, index);
    return index;
}

/** Targets by cosine similarity to the query, best first, noise dropped. Vectors are unit length, so cosine is a dot product. */
function rankByCosine(query: Float32Array, index: VectorIndex): Target[] {
    const scored: { target: Target; key: string; score: number }[] = [];

    for (let row = 0; row < index.targets.length; row++){
        let dot = 0;
        for (let d = 0; d < index.dims; d++) dot += query[d] * index.matrix[row * index.dims + d];
        if (dot >= MIN_SIMILARITY){
            const target = index.targets[row];
            scored.push({ target, key: targetKey(target.kind, target.path), score: dot });
        }
    }

    return scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((s) => s.target);
}
```
  - `scripts/search.ts`:
```ts
/**
 * npm run search -- <path-to-repo> "<query>" [--limit 10]
 *
 * Hybrid search over an indexed repo (RAG_PIPELINE.md §6): code keywords, summary
 * keywords and summary meaning, fused with Reciprocal Rank Fusion. Runs the query twice
 * and prints both timings. The first includes loading the embedding model.
 */
import path from "path";
import { RepoNotIndexedError } from "../lib/db/store/structure";
import { search } from "../lib/engine/search";

const args = process.argv.slice(2);
const [target, query] = args;

if (!target || !query){
    console.error('usage: npm run search -- <path-to-repo> "<query>" [--limit 10]');
    process.exit(1);
}

const limitFlag = args.indexOf("--limit");
const limit = limitFlag === -1 ? 10 : Number(args[limitFlag + 1]);
const root = path.resolve(target);

async function main(): Promise<void> {
    let started = performance.now();
    const result = await search(root, query, { limit });
    const firstMs = performance.now() - started;
    started = performance.now();
    await search(root, query, { limit });
    const warmMs = performance.now() - started;

    console.log(`[search] "${query}": ${result.hits.length} hits · lists: code ${result.lists.code}, summary ${result.lists.summary},`
        + ` vector ${result.lists.vector} · first ${firstMs.toFixed(0)} ms, warm ${warmMs.toFixed(0)} ms`);
    if (result.note) console.log(`[search] note: ${result.note}`);

    result.hits.forEach((hit, i) => {
        console.log(`${String(i + 1).padStart(2)}. ${hit.path}${hit.kind === "folder" ? "/" : ""}  (${hit.score.toFixed(4)} · ${hit.matchedBy.join("+")})`);
        if (hit.tagline) console.log(`    ${hit.tagline} — ${hit.summary ?? ""}`);
        if (hit.code) console.log(`    ${hit.code.symbol}, lines ${hit.code.startLine}–${hit.code.endLine}: ${hit.code.snippet}`);
    });
}

main().catch((err: unknown) => {
    console.error(err instanceof RepoNotIndexedError ? `[search] ${err.message}` : err);
    process.exit(1);
});
```
  - In `package.json` `"scripts"`, add `"search": "tsx scripts/search.ts"` after `"summarize"`.

- [ ] **Step 5: Run them to make sure they pass** — `npx vitest run lib/engine/search.test.ts`. Expected: PASS (10 tests).

- [ ] **Step 6: Gate** — Expected: PASS, 216 tests. Then try it:
  - Run `npm run search -- test/fixtures/mini-repo "logging"`. Expected: `src/core/log.ts` at or near the top, found by all three lists. These are real MiniLM vectors over the real summaries from Task 8, so the exact order may vary.
  - Run `npm run search -- ../vscode "editor tabs"`. Expected: code-keyword hits only (no summaries yet), and the note `Summaries aren't ready yet…`.

- [ ] **Step 7: Rewrite `docs/RAG_PIPELINE.md`** for the pivot (its banner promised this in V1.2).
  - Replace everything above `## 2. Why chunking matters` with the new header and §1.
  - Keep §2 and §3 exactly as they are.
  - Replace everything from `## 4. Embeddings` to the end of the file with the new §4–§8.

The new header and §1:
````md
# RAG_PIPELINE.md — Understanding and Search

> **‹today› — rewritten in slice V1.2** for the pivot (`PIVOT_SPEC.md` §5.3–5.4, §6.1; ADR-027, ADR-028, ADR-031, ADR-033). Chunk-level embeddings are gone. Search fuses code keywords, summary keywords and summary meaning. §2–3 (chunking) carry over unchanged from the Phase 2 design.

**Status:** Implemented (V1.2)
**Depends on:** `DATABASE_DESIGN.md` §7–8, `ENGINEERING_DECISIONS.md` ADR-004/005/017/027/028/031/033

---

## 1. The pipeline

```
repo files
   │  structure stage: npm run index                         lib/index/pipeline.ts
   ├─► chunks + symbols + imports ─► code_fts (triggers)     lib/db/store/structure.ts
   ▼
summaries: npm run summarize                                 lib/index/summarize/
   │  files: Haiku 5.5 · folders and the repo: Sonnet 5.5 · test files: a template
   ├─► summary_fts (triggers)
   ▼
summary vectors (MiniLM, local)                              lib/index/embed.ts
   ▼
search(query) = RRF(code_fts, summary_fts, cosine)           lib/engine/search.ts
```

Every stage is incremental and records its status in `meta` (`GET /api/status`). Each leaves the earlier stages usable: keyword search works seconds after the structure stage, and results improve as summaries and their vectors arrive.

````
The new §4–§8:
````md
## 4. Summaries

**What gets one.** Every file, every folder, and the repo itself (`PIVOT_SPEC.md` §5.3).
- **Files** go to `claude-haiku-5-5`. The prompt is the file's generated imports/exports listing (the file-summary chunk), its line count, and its source cut to about 6k tokens (20,000 characters, at a line break).
- **Folders** go to `claude-sonnet-5-5`, written bottom-up from their children's taglines and summaries. The 50 largest children are listed (by lines of code), plus "…and N smaller items".
- **The repo** goes to `claude-sonnet-5-5`, from its top-level folders and files.
- **Test files** skip the model and get a template (`Tests for strings`, status `skipped`).

**Settings.** Effort `low` and adaptive thinking (the models' default). Structured outputs force `{ tagline, summary }`, and the tagline is cut to 6 words in code. `max_tokens` is 4,096.

**inputHash = hash(model, PROMPT_VERSION, input).** Identical input is never summarized twice, and bumping `PROMPT_VERSION` redoes everything on purpose. For a file, the content hash stands in for the prompt (the prompt is a pure function of the bytes), so planning never reads source files.

**States** come from a pure planner (`planSummaries`): `current`, `template`, `ready`, `waiting` (a child isn't done yet), `lazy`, `in-flight` and `failed`. Stored statuses: `fresh`, `stale`, `pending`, `failed` and `skipped`; the API adds `off` when there's no key.

**Runs (ADR-033).** A run plans, sends whatever is ready, and repeats. Folders become ready as their children's summaries land, bottom-up.
- **Transport.** A wave of 100+ requests goes through the Message Batches API at half price, in batches of up to 5,000. Smaller waves use the regular API, 4 at a time.
- **Resuming.** Batch ids are stored on the rows, so an interrupted run resumes. Answers are matched by `custom_id` (the row id), never by position.
- **Failures.** A failure doesn't block its folder ("no summary yet" stands in), and the next run retries it.
- **Locking.** A `summarizing` lock prevents two paying runs.

**Lazy folders.** When a file's summary changes, its folder's input changes and the folder goes `stale`. Full runs (`npm run summarize`) redo stale folders. Incremental runs leave them `lazy` until someone opens them (`summarizeNow`, the Map's "jump the queue"); V1.3 adds a periodic sweep.

**Cost.** Every answer's tokens go to `summary_usage`, per model and transport. That's how S2 (≤ $15 for VS Code's full pass) is measured. The owner reviewed Haiku against Sonnet on 20 VS Code files before the first full run (`SUMMARY_REVIEW.md`).

---

## 5. Embeddings

### What an embedding is (for the learner)

An embedding model reads text and outputs a fixed-length list of numbers, a point in 384-dimensional space, positioned so that *semantically similar* texts land near each other. "Where do we parse imports?" lands near a summary that says "reads import statements from the AST" even though they share almost no words. That near-ness is what makes search semantic instead of keyword-based.

### Model choice

- **Model:** `Xenova/all-MiniLM-L6-v2`, running locally through `@huggingface/transformers` (ADR-005). 384 dimensions, unit-normalized, so cosine similarity is a plain dot product.
- **Why local:** zero cost, no key, works offline. The first run downloads about 25 MB of weights.

### What gets embedded

Model-written summaries only, as `tagline \n summary \n path` (`summaryEmbeddingText`). Code chunks aren't embedded any more (ADR-027): at ~18 chunks/s, VS Code's 101,603 chunks would take 94 minutes, and summaries carry meaning better than raw code. Templates aren't embedded either; they say nothing a keyword can't find. Rewriting a summary deletes its vector, so `embedSummaries` always redoes exactly what changed.

---

## 6. Search

### The three lists

1. **Code keywords:** bm25 over `code_fts` (path 2, name 10, name_split 6, text 1). The top 200 chunks are grouped by file, and a file's best chunk stands for it.
2. **Summary keywords:** bm25 over `summary_fts` (path 1, tagline 4, summary 2), over files and folders. The repo summary is never a hit.
3. **Meaning:** cosine similarity between the query's MiniLM vector and every summary vector, held in memory as one flat matrix and reloaded only when the set of vectors changes. Matches below 0.25 are dropped.

Each list contributes at most 50 files or folders.

### Building the keyword query

`toFtsQuery` keeps the query's words and drops stopwords and single letters. Each identifier also contributes its parts (`openEditor` adds `open` and `editor`). Every word is quoted, so nothing the user types is read as FTS5 syntax, and the words are ORed. `"Where are editor tabs rendered?"` becomes `"editor" OR "tabs" OR "rendered"`, and porter stemming lets `rendered` match `render`.

### Reciprocal Rank Fusion

`score(d) = Σ 1 / (60 + rankᵢ(d))` over every list that ranks `d`, with ranks starting at 1. A worked example: lists code `[a, b, c]`, summary `[b]`, vector `[c, b]` give
- `b` = 1/62 + 1/61 + 1/62 ≈ 0.0487,
- `c` = 1/63 + 1/61 ≈ 0.0323,
- `a` = 1/61 ≈ 0.0164.

Agreement between lists beats a single first place. RRF uses positions only, so bm25 scores and cosines never need to be put on one scale. Ties break by key.

### What a hit looks like

`SearchHit` (`API_CONTRACTS.md` §10) carries the path, the kind (file or folder), the score, which lists matched, the summary when there is one, and for code matches the best chunk's symbol, lines and snippet. A `note` says when something limits the results: no summaries yet, no vectors yet, the embedding model unavailable, or only common words in the query.

### Quality levers (tune in this order)

1. **The summaries themselves**: the prompt, the model per tier, the effort. They feed two of the three lists.
2. **Column weights**: name vs. body in code, tagline vs. summary in summaries (stored as each FTS table's `rank`).
3. **List depth and the cosine floor** (50 and 0.25).
4. **Graph-aware boost** (later): weight hits near the Map's current focus.

---

## 7. Incremental updates

- **Structure:** a changed file's chunks are replaced, and the triggers replace its `code_fts` rows. A deleted file or folder takes its summary (and that summary's vector and search row) with it.
- **Summaries:** a changed file has a new content hash, so a new inputHash, so it's ready again. Its folders follow as described in §4. Nothing whose input is unchanged is ever re-summarized.
- **Vectors:** deleted when their summary's text changes, refilled by the next embeddings run.

---

## 8. Failure modes and honest limitations

| Failure | Symptom | Mitigation |
|---|---|---|
| No API key | No summaries | Stage `off` with the reason; templates, structure and code search still work |
| Batch takes hours | Summaries arrive late | Keyword search works meanwhile; `--no-wait` and resume; `summarizeNow` for what someone opens |
| File edited after indexing | Summary would describe bytes the index never saw | That target fails with "changed after it was indexed" and is retried after `npm run index` |
| Model refusal | A summary fails | Sonnet's regular-API requests fall back server-side; batch refusals are retried next run, in a small wave that goes direct |
| Embedding model can't load | No meaning search | Keyword lists still answer, and the `note` says so |
| Vocabulary mismatch | A concept finds nothing by keyword | The meaning list, and summaries written in plain words |
````

- [ ] **Step 8: The rest of the docs**
  - In `docs/PIVOT_SPEC.md` §6.1, at the end of the `search(query, opts)` bullet, add: ``Results are files and folders (the repo summary is left out). Each list contributes its top 50 after grouping, vector matches below cosine 0.25 are dropped, and a note says when summaries or vectors aren't ready yet (`RAG_PIPELINE.md` §6).``
  - At the end of ADR-027's **Consequences:** line in `docs/ENGINEERING_DECISIONS.md`, add: ``*(Amended ‹today› in slice V1.2: fusion works on files and folders. Code hits are grouped by file before ranking, so a file with ten matching chunks counts once per list. Each list contributes its top 50, and vector matches below cosine 0.25 are dropped. Queries keep their non-stopword words, quoted and ORed, plus the parts of identifiers. See `RAG_PIPELINE.md` §6.)*``

- [ ] **Step 9: Commit and push**
```bash
git add lib/db/store/search.ts lib/engine/search.ts lib/engine/search.test.ts scripts/search.ts package.json lib/contracts.ts docs/API_CONTRACTS.md docs/RAG_PIPELINE.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md
git commit -m "feat: hybrid search: code and summary FTS plus summary vectors, fused with RRF; npm run search"
git push origin pivot/v1
```

---

### Task 11: Owner checkpoint — Haiku 5.5 vs Sonnet 5.5 on 20 VS Code files, then STOP

**Files:**
- Create: `lib/index/summarize/compare.ts`, `lib/index/summarize/compare.test.ts`, `scripts/compare-summaries.ts`, `docs/SUMMARY_REVIEW.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `FileFacts` (Task 5), `PROMPT_VERSION`, `plural`, `FILE_SYSTEM_PROMPT`, `SUMMARY_MODELS` (Task 6), `SummaryOutcome`, `costUsd`, `pricePerMTok`, `mapLimit` (Task 7), `buildFilePrompt` (Task 8).
- Produces: `pickSample(files, count)`, `renderComparison(report)`, `npm run compare-summaries`, and the review document.

- [ ] **Step 1: Write the failing tests** — `lib/index/summarize/compare.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FILES } from "../../../test/helpers/mini-repo-facts";
import { pickSample, renderComparison } from "./compare";

describe("pickSample", () => {
    it("takes the most-imported half, then spreads the rest evenly through the tree, never a test file", () => {
        // non-test files 7; the 2 most imported (main.ts and log.ts, 3 each), then 2 of the other 5 at positions 1 and 3
        expect(pickSample(FILES, 4).map((f) => f.path)).toEqual(["src/app/main.ts", "src/core/log.ts", "src/app/view.tsx", "src/index.ts"]);
    });
});

describe("renderComparison", () => {
    it("shows the cost per model, the full-pass estimate and each file's two summaries", () => {
        const file = FILES.find((f) => f.path === "src/core/log.ts")!;
        const ok = (model: string, tagline: string) => ({
            customId: "s1", ok: true as const, text: { tagline, summary: `${tagline} in detail.` }, model, usage: { inputTokens: 2_000, outputTokens: 200 },
        });
        const markdown = renderComparison({
            title: "2026 10 12 Summary Review #1",
            repo: "C:/code/vscode",
            effort: "low",
            models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
            rows: [{ file, outcomes: { "claude-haiku-5-5": ok("claude-haiku-5-5", "Logging helpers"), "claude-sonnet-5-5": ok("claude-sonnet-5-5", "Core logging") } }],
            fullPass: { files: 1_000, folders: 100 },
        });

        expect(markdown).toContain("## 2026 10 12 Summary Review #1");
        expect(markdown).toContain("| claude-haiku-5-5 | 1 | 2,000 | 200 | $0.0003 |");
        expect(markdown).toContain("| claude-sonnet-5-5 | 1 | 2,000 | 200 | $0.0060 |");
        expect(markdown).toContain("- **Files:** 1,000 × $0.0003 (claude-haiku-5-5's mean) × ½ = **$0.15**");
        expect(markdown).toContain("- **Folders and the repo:** 100 × (1,000 input tokens + 200 output tokens at claude-sonnet-5-5's price) × ½ = **$0.20**");
        expect(markdown).toContain("- **Total ≈ $0.35** against S2's $15.");
        expect(markdown).toContain("- If claude-sonnet-5-5 wrote the file summaries too: 1,000 × $0.0060 × ½ = **$3.00**");
        expect(markdown).toContain("#### 1. `src/core/log.ts` (9 lines · imported by 3 files)");
        expect(markdown).toContain("- **claude-haiku-5-5:** *Logging helpers* — Logging helpers in detail.");
    });
});
```
These numbers are derived by hand:
- Haiku: (2,000 × $0.10 + 200 × $0.50) / 1M = $0.0003.
- Sonnet: (2,000 × $2 + 200 × $10) / 1M = $0.0060.
- Files estimate: 1,000 × 0.0003 / 2 = $0.15.
- Folders estimate: 100 × (1,000 × $2 + 200 × $10) / 1M / 2 = $0.20.
- Sonnet for files: 1,000 × 0.006 / 2 = $3.00.

- [ ] **Step 2: Run them to make sure they fail** — `npx vitest run lib/index/summarize/compare.test.ts`. Expected: FAIL with `Failed to resolve import "./compare"`.

- [ ] **Step 3: Implement**
  - `lib/index/summarize/compare.ts`:
```ts
import type { FileFacts } from "../../db/store/summaries";
import { costUsd, pricePerMTok } from "./pricing";
import { plural, PROMPT_VERSION } from "./prompts";
import type { SummaryOutcome } from "./types";

/** Folder inputs, assumed for the estimate: a folder lists its children's taglines and summaries. */
const ASSUMED_FOLDER_INPUT_TOKENS = 1_000;

export type ComparisonRow = { file: FileFacts; outcomes: Record<string, SummaryOutcome | undefined> };

export type ComparisonReport = {
    title: string;
    repo: string;
    effort: string;
    /** [the file model, the folder model], as in SUMMARY_MODELS. */
    models: [string, string];
    rows: ComparisonRow[];
    /** What the real first pass will send: model-written files, and folders plus the repo. */
    fullPass: { files: number; folders: number };
};

/**
 * The checkpoint's sample (PIVOT_SPEC.md §5.3): the most-imported half (central code is
 * read first), then the rest spread evenly through the path-sorted tree. Test files are
 * left out, because they get a template. Expects files in path order, as loadFileFacts
 * returns them.
 */
export function pickSample(files: readonly FileFacts[], count: number): FileFacts[] {
    const candidates = files.filter((f) => !f.isTest);
    const central = [...candidates]
        .sort((a, b) => b.importedBy - a.importedBy || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .slice(0, Math.ceil(count / 2));
    const chosen = new Set(central.map((f) => f.path));
    const rest = candidates.filter((f) => !chosen.has(f.path));
    const k = Math.min(count - central.length, rest.length);

    // the middle of each of k equal slices of the remaining files
    const spread = Array.from({ length: k }, (_, i) => rest[Math.floor(((i + 0.5) * rest.length) / k)]);
    return [...central, ...spread];
}

export function renderComparison(report: ComparisonReport): string {
    const [fileModel, folderModel] = report.models;
    const stats = report.models.map((model) => modelStats(model, report.rows));
    const [fileStats, folderStats] = stats;
    const central = Math.ceil(report.rows.length / 2);

    const filesTotal = (report.fullPass.files * fileStats.meanCost) / 2;
    const folderPrice = pricePerMTok(folderModel) ?? { input: 0, output: 0 };
    const meanFolderOutput = Math.round(folderStats.meanOutputTokens);
    const perFolder = (ASSUMED_FOLDER_INPUT_TOKENS * folderPrice.input + meanFolderOutput * folderPrice.output) / 1_000_000;
    const foldersTotal = (report.fullPass.folders * perFolder) / 2;
    const allSonnetFiles = (report.fullPass.files * folderStats.meanCost) / 2;

    const lines = [
        `## ${report.title}`,
        "",
        `- **Repo:** \`${report.repo}\` · **effort** ${report.effort} · **prompt version** ${PROMPT_VERSION} · the regular Messages API`,
        `- **Sample:** the ${central} most-imported files, then ${report.rows.length - central} more spread evenly through the tree. Test files are left out: they get a template.`,
        "",
        "### Cost on this sample",
        "",
        "| Model | Requests | Input tokens | Output tokens | Cost |",
        "|---|---|---|---|---|",
        ...stats.map((s) => `| ${s.model} | ${s.requests} | ${s.inputTokens.toLocaleString("en-US")} | ${s.outputTokens.toLocaleString("en-US")} | ${usd(s.cost)} |`),
        "",
        "### Full-pass estimate (Batch API, half price)",
        "",
        `- **Files:** ${report.fullPass.files.toLocaleString("en-US")} × ${usd(fileStats.meanCost)} (${fileModel}'s mean) × ½ = **${usd(filesTotal)}**`,
        `- **Folders and the repo:** ${report.fullPass.folders.toLocaleString("en-US")} × (${ASSUMED_FOLDER_INPUT_TOKENS.toLocaleString("en-US")} input tokens + ${meanFolderOutput.toLocaleString("en-US")} output tokens at ${folderModel}'s price) × ½ = **${usd(foldersTotal)}**`,
        `- **Total ≈ ${usd(filesTotal + foldersTotal)}** against S2's $15.`,
        `- If ${folderModel} wrote the file summaries too: ${report.fullPass.files.toLocaleString("en-US")} × ${usd(folderStats.meanCost)} × ½ = **${usd(allSonnetFiles)}**`,
        "",
        `Folder inputs are assumed to be about ${ASSUMED_FOLDER_INPUT_TOKENS.toLocaleString("en-US")} tokens each, since a folder lists its children's taglines and summaries. The full run measures the real number.`,
        "",
        "### The summaries",
    ];

    report.rows.forEach((row, i) => {
        lines.push("", `#### ${i + 1}. \`${row.file.path}\` (${plural(row.file.lineCount, "line")} · imported by ${plural(row.file.importedBy, "file")})`, "");
        for (const model of report.models){
            const outcome = row.outcomes[model];
            lines.push(outcome?.ok
                ? `- **${model}:** *${outcome.text.tagline}* — ${outcome.text.summary}`
                : `- **${model}:** failed: ${outcome ? outcome.error : "no answer"}`);
        }
    });

    lines.push("", "### Owner's verdict", "",
        "_To fill in: which model writes the file summaries, whether the prompt or the effort needs changing first, and go or no-go for the full Batch run._");
    return lines.join("\n") + "\n";
}

function modelStats(model: string, rows: readonly ComparisonRow[]){
    let requests = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const row of rows){
        const usage = row.outcomes[model]?.usage;
        if (!usage) continue;
        requests++;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
    }

    const cost = costUsd(model, { inputTokens, outputTokens }, "direct") ?? 0;
    return {
        model, requests, inputTokens, outputTokens, cost,
        meanCost: requests > 0 ? cost / requests : 0,
        meanOutputTokens: requests > 0 ? outputTokens / requests : 0,
    };
}

function usd(x: number): string {
    return `$${x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
}
```
  - `scripts/compare-summaries.ts`:
```ts
/**
 * npm run compare-summaries -- <path-to-repo> [--count 20] [--effort low|medium|high]
 *
 * The owner checkpoint before the first full summary pass (PIVOT_SPEC.md §5.3). It
 * summarizes a sample of files with both models through the regular API, then appends the
 * side-by-side, its cost and a full-pass estimate to docs/SUMMARY_REVIEW.md. Nothing is
 * written to the index: the real run starts only after the owner's verdict.
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { getDb } from "../lib/db/client";
import { requireRepository } from "../lib/db/store/structure";
import { loadFileFacts, loadFolderFacts } from "../lib/db/store/summaries";
import { nebulosityPath } from "../lib/home";
import { repoKey } from "../lib/index/paths";
import { createClaudeSummarizer } from "../lib/index/summarize/claude";
import { pickSample, renderComparison, type ComparisonRow } from "../lib/index/summarize/compare";
import { mapLimit } from "../lib/index/summarize/concurrency";
import { FILE_SYSTEM_PROMPT, SUMMARY_EFFORT, SUMMARY_MODELS } from "../lib/index/summarize/prompts";
import { buildFilePrompt } from "../lib/index/summarize/run";
import type { SummaryOutcome } from "../lib/index/summarize/types";
import { hasAnthropicKey, loadLocalEnv } from "./env";

loadLocalEnv();

const args = process.argv.slice(2);
const target = args[0];
const flag = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

if (!target || target.startsWith("--")){
    console.error("usage: npm run compare-summaries -- <path-to-repo> [--count 20] [--effort low|medium|high]");
    process.exit(1);
}
if (!hasAnthropicKey()){
    console.error("[compare] ANTHROPIC_API_KEY is not set (put it in .env.local).");
    process.exit(1);
}

const count = Number(flag("--count") ?? 20);
const effort = (flag("--effort") ?? SUMMARY_EFFORT) as "low" | "medium" | "high";
const root = path.resolve(target);
const out = nebulosityPath("docs", "SUMMARY_REVIEW.md");

async function main(): Promise<void> {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const files = loadFileFacts(db, repoId);
    const sample = pickSample(files, count);
    const summarizer = createClaudeSummarizer(new Anthropic({ maxRetries: 3 }), effort);
    const models: [string, string] = [SUMMARY_MODELS.file, SUMMARY_MODELS.folder];

    const rows: ComparisonRow[] = sample.map((file) => ({ file, outcomes: {} }));
    for (const model of models){
        console.log(`[compare] ${model}: ${sample.length} files…`);
        const outcomes = await mapLimit(sample, 4, async (file): Promise<SummaryOutcome> => {
            const prompt = buildFilePrompt(db, repoId, root, file);
            if (prompt === null) return { customId: file.path, ok: false, error: "changed after it was indexed", model: null, usage: null };
            return summarizer.summarize({ customId: file.path, model, system: FILE_SYSTEM_PROMPT, prompt });
        });
        outcomes.forEach((outcome, i) => { rows[i].outcomes[model] = outcome; });
    }

    const existing = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    const reviewNumber = (existing.match(/Summary Review #\d+/g) ?? []).length + 1;
    const today = new Date();
    const date = `${today.getFullYear()} ${String(today.getMonth() + 1).padStart(2, "0")} ${String(today.getDate()).padStart(2, "0")}`;
    const title = `${date} Summary Review #${reviewNumber} — ${models[0]} vs ${models[1]} on ${sample.length} files of ${path.basename(root)}`;

    const header = "# SUMMARY_REVIEW.md — Summary quality reviews\n\nThe owner's checks of model-written summaries before they're generated at scale. Each review is a dated, numbered section; the newest is last.\n";
    const section = renderComparison({
        title, repo: repoKey(root), effort, models, rows,
        fullPass: { files: files.filter((f) => !f.isTest).length, folders: loadFolderFacts(db, repoId).length },
    });
    fs.writeFileSync(out, `${existing || header}\n${section}`);
    console.log(`[compare] wrote "${title}" to ${out}`);
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
```
(`loadFolderFacts(...).length` counts every folder including the root, which is the repo target: folders plus the repo, as the estimate wants.)
  - In `package.json` `"scripts"`, add `"compare-summaries": "tsx scripts/compare-summaries.ts"` after `"search"`.

- [ ] **Step 4: Run them to make sure they pass** — `npx vitest run lib/index/summarize/compare.test.ts`. Expected: PASS (2 tests). Then gate: PASS, 218 tests.

- [ ] **Step 5: Commit and push the tool**
```bash
git add lib/index/summarize/compare.ts lib/index/summarize/compare.test.ts scripts/compare-summaries.ts package.json
git commit -m "feat: owner checkpoint tool: compare Haiku and Sonnet summaries on a sample, with cost and a full-pass estimate"
git push origin pivot/v1
```

- [ ] **Step 6: Run the checkpoint on VS Code** (40 regular-API requests, about $0.20):

Run: `npm run compare-summaries -- ../vscode`
Expected:
- `[compare] claude-haiku-5-5: 20 files…`, then the same for `claude-sonnet-5-5`.
- `wrote "‹date› Summary Review #1 — claude-haiku-5-5 vs claude-sonnet-5-5 on 20 files of vscode"`.

Open `docs/SUMMARY_REVIEW.md` and check:
- 20 file sections, each with two answers.
- A cost table.
- A full-pass total. If it's over $15, say so prominently to the owner.

If any answer failed, include its error in the message to the owner.

- [ ] **Step 7: Commit and push the review**
```bash
git add docs/SUMMARY_REVIEW.md
git commit -m "docs: summary review #1, Haiku 5.5 vs Sonnet 5.5 on 20 VS Code files, for the owner"
git push origin pivot/v1
```

- [ ] **Step 8: STOP. Do not start Task 12.** Send the owner:
  - A link to `docs/SUMMARY_REVIEW.md`.
  - The full-pass estimate.
  - Four questions:
    1. Which model writes the file summaries: Haiku 5.5 (the plan) or Sonnet 5.5?
    2. Does the prompt need changes? (Any change bumps `PROMPT_VERSION`.)
    3. Is effort `low` right?
    4. Go or no-go for the full Batch run on VS Code.

  Wait for the answers. Record them in the review's "Owner's verdict" section in the owner's words.

---

### Task 12: The full summary pass on VS Code (only after the owner's go-ahead)

**Files:**
- Modify: `docs/BENCHMARKS.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `docs/SUMMARY_REVIEW.md` (verdict), and, only if the owner changed them, `lib/index/summarize/prompts.ts` + `docs/ENGINEERING_DECISIONS.md` (ADR-028 amendment)

- [ ] **Step 1: Apply the owner's verdict.** Record it in `docs/SUMMARY_REVIEW.md` under "Owner's verdict".
  - **If the file model changes:** edit `SUMMARY_MODELS.file` and add an amendment note to ADR-028 saying who chose what, when, and on which evidence.
  - **If the prompt or effort changes:** edit `prompts.ts`, bump `PROMPT_VERSION`, and re-run `npm run compare-summaries -- ../vscode`. That appends Review #2. Then stop again for the owner.
  - Gate, then commit and push: `git commit -m "docs: owner's verdict on summary review #1"` (plus the code change, if any).

- [ ] **Step 2: Smoke-test the Batch path on a scratch copy of the fixture** (13 requests, about 1¢, usually done in minutes):

Run: `node -e "require('fs').cpSync('test/fixtures/mini-repo', require('path').join(require('os').tmpdir(), 'neb-batch-smoke'), { recursive: true })"`
Then run: `npm run index -- "<the printed temp dir>/neb-batch-smoke"`
Then run: `npm run summarize -- "<same path>" --batch`
Expected:
- 4 waves, each `submitted msgbatch_… with N requests`, then `collected msgbatch_…`.
- `up to date 14/14`.
- `spend:` lines for `batch`.

Then delete the copy, and run `npm run index -- ../vscode` to make VS Code active again.

- [ ] **Step 3: Run the full pass on VS Code.** Start it in the background and keep its output in a log: `npm run summarize -- ../vscode > .nebulosity/summarize-vscode.log 2>&1`. Note the start time.
  - **First wave:** about 12,000 file requests in 3 batches (≤ 5,000 each).
  - **Folders:** then come up wave by wave, by batch while a wave has 100+ requests, and directly once waves get small.
  - **Monitoring:** check progress with `curl -s http://localhost:3000/api/status` (with `npm run dev` running) or by reading the log.
  - **Interruptions are safe:** running the same command again collects the batches still at Anthropic instead of resending them.
  - **Blockers:** if a wave fails wholesale (for example authentication, or every request rejected), stop and report to the owner.

- [ ] **Step 4: When it finishes**, the log ends with:
  - the run summary,
  - `embedded … summaries`,
  - the `spend:` lines,
  - `spend so far on this repo: $‹total›`.

  Note the wall time. If the total is over $15, **S2 has failed: report it to the owner as such**, with the per-model numbers.

- [ ] **Step 5: Try search on VS Code**, with these hand-picked expectations about VS Code's layout:

| Query | Expected among the top 5 |
|---|---|
| `integrated terminal` | something under `src/vs/workbench/contrib/terminal/` |
| `editor tabs` | something under `src/vs/workbench/browser/parts/editor/` |
| `extension host` | something under `src/vs/workbench/services/extensions/` or `src/vs/workbench/api/` |
| `file watcher` | something under `src/vs/platform/files/` |
| `keybinding resolution` | something under `src/vs/platform/keybinding/` |

Run: `npm run search -- ../vscode "<query>"` for each. Record pass or fail and the warm timing. Don't tune anything to make a row pass: a miss is a finding for the eval.

- [ ] **Step 6: Record it** — append to `docs/BENCHMARKS.md`, filling each `‹…›`:
```md

## ‹today, as YYYY MM DD› Summary Benchmark #1 — full summary pass on VS Code

- **Target, machine:** VS Code @ `cc3fec88` on the owner's laptop
- **Command:** `npm run summarize -- ../vscode` (transport chosen per wave: Batch API for 100+ requests, regular API below; ADR-033)
- **Models:** files `‹model›`, folders and the repo `claude-sonnet-5-5`; effort low; prompt version ‹n›

| | Files | Folders + repo | Templates (tests) | Failed | Waves | Batches | Wall time |
|---|---|---|---|---|---|---|---|
| first pass | ‹n› | ‹n› | ‹n› | ‹n› | ‹n› | ‹n› | ‹h:mm› |

| Model | Transport | Requests | Input tokens | Output tokens | Cost |
|---|---|---|---|---|---|
| ‹one row per `spend:` line› | | | | | |

**S2 (≤ $15): ‹PASS or FAIL› at $‹total›.** Embeddings: ‹n› vectors in ‹m› min.

| Search query | Top-5 expectation | Result | Warm time |
|---|---|---|---|
| ‹the five rows of Step 5› | | ‹pass / miss› | ‹ms› |
```

- [ ] **Step 7: Mark V1.2 done** — in `docs/IMPLEMENTATION_ROADMAP.md`'s pivot table, change the V1.2 row's first cell to `**V1.2 Understanding** — DONE ‹date› (see BENCHMARKS.md)`.

- [ ] **Step 8: Gate, commit and push**
```bash
git add docs/BENCHMARKS.md docs/IMPLEMENTATION_ROADMAP.md
git commit -m "docs: full summary pass on VS Code measured (S2); V1.2 done"
git push origin pivot/v1
```

- [ ] **Step 9: Update the local project brief** (`CLAUDE.md` is gitignored, so there's nothing to commit). In its "Current state" block, add: `V1.2 done: summaries for VS Code cost $‹total› (S2 ‹PASS/FAIL›), npm run search works; next is the V1.3 plan (Map: level/describe/search APIs, the new UI, live channel).`

---

## What comes next (not part of this plan)

The V1.3 plan (the Map) is written with superpowers:writing-plans at the start of that slice. These are carried forward on purpose:

- **`POST /api/summarize?path=`.** It's a thin route over `summarizeNow` plus `embedSummaries`. It lands with the Map, which is its caller, together with `DescribeResponse` (which reports `summaryStatus`, including `off`).
- **The periodic sweep** of lazy folders, and **watcher-driven incremental summaries** (a file's summary refreshes after 60 s without changes). Both live in V1.3's server process.
- **Embeddings on a worker thread** in the Next server (`PIVOT_SPEC.md` §5.4).
- **Retiring the old Phase 2–4 code:** `lib/index-repo.ts`, `lib/retrieve.ts`, the old `/api/search` and `/api/index`, `lib/db/graph-store.ts` and the chunk `vectors` table. `GET /api/search` then serves `SearchResult`.
- **`indexVersion`** for HTTP caching of level and describe responses.

---

## Addendum (2026-10-11): the owner's checkpoint verdict

The owner's answers to Review #1 (`docs/SUMMARY_REVIEW.md`):

1. **File model.** Haiku 5.5 writes the file summaries.
2. **Prompt v2** (`PROMPT_VERSION` 2) comes first:
   - a 3–6 word noun-phrase tagline, with an example;
   - "don't mention truncation or code you weren't shown" replaces the truncation instruction;
   - each file's import count and a few example importer folders from the graph;
   - identifiers in backticks;
   - the parser stops cutting taglines mid-phrase and keeps them whole up to 8 words, with the spec updated to match.

   Then Review #2 runs on the same 20 files, and the run stops for the owner.
3. **Effort** stays low.
4. **Go**, once Review #2 is approved: Haiku for files, Sonnet for folders and the repo, through the Batch API.
   - Before submitting each further batch, stop if the spend so far plus the remaining estimate would pass $15.
   - At wrap-up, add ADR-031 → ADR-033 to PIVOT_SPEC §15.

Two tasks implement this, in order:
- **Task 11b**: prompt v2. It is reviewed before any money is spent; then Review #2 runs and the run stops for the owner.
- **Task 12a**: the spend cap.

Task 12 runs only after the owner approves Review #2. Its wrap-up also lists this slice's ADRs, ADR-031 → ADR-035, in PIVOT_SPEC §15.

### Task 11b: Summary prompt v2

**Files:**
- Modify: `lib/index/summarize/prompts.ts`, `lib/index/summarize/claude.ts`, `lib/index/summarize/run.ts` (`buildFilePrompt`), `lib/db/store/summaries.ts`, `lib/db/schema.ts` (one comment)
- Test: `lib/index/summarize/prompts.test.ts`, `lib/index/summarize/claude.test.ts`, the summaries store test
- Docs:
  - `docs/PIVOT_SPEC.md`: the §4.1 `summaries` row and the §5.3 file input
  - `docs/DATABASE_DESIGN.md`: the `summaries` tagline
  - `docs/RAG_PIPELINE.md`: the prompt input and the tagline rule
  - `docs/ENGINEERING_DECISIONS.md`: ADR-034
  - `docs/SUMMARY_REVIEW.md`: Review #1's verdict

**Interfaces:**
- `renderFilePrompt(listing: string, lineCount: number, importers: readonly string[], source: string, maxChars?: number): string`
- `importerLine(importers: readonly string[], maxFolders?: number): string` and `MAX_IMPORTER_FOLDERS = 3`, in prompts.ts
- `loadImporterPaths(db: Db, repoId: number, filePath: string): string[]`, in the summaries store
- `cleanTagline(raw: string): string` and `MAX_TAGLINE_WORDS = 8`, in claude.ts

**Requirements:**

1. `PROMPT_VERSION = 2`.

2. The three system prompts, verbatim. Their examples are deliberately not from VS Code, so the model can't copy one into a summary.
   ```ts
   export const FILE_SYSTEM_PROMPT = [
       "You write the summary a developer sees for one source file while exploring an unfamiliar codebase.",
       "Give a tagline and a summary. The tagline is a noun phrase of 3 to 6 plain words, like \"Retry policy with exponential backoff\". The summary is 2 to 4 sentences.",
       "The summary says what the file is responsible for, names its most important exports, and says how other code uses it. The \"Imported by\" line comes from the repository's import graph; use it to say how widely and where the file is used.",
       "In the summary, write identifiers (functions, classes, types, variables and file names) in backticks, like `parseConfig`.",
       "Use real identifiers from the file. Don't narrate the code line by line, and don't guess beyond what you're shown. Don't mention truncation or code you weren't shown.",
   ].join("\n");

   export const FOLDER_SYSTEM_PROMPT = [
       "You write the summary a developer sees for one folder while exploring an unfamiliar codebase. You're given the summaries of the files and subfolders inside it.",
       "Give a tagline and a summary. The tagline is a noun phrase of 3 to 6 plain words, like \"Payment provider integrations\". The summary is 2 to 4 sentences.",
       "The summary says what the folder is responsible for as a whole, which parts matter most, and how they fit together.",
       "In the summary, write file, folder, function and class names in backticks, like `retry.ts`.",
       "Don't list every item, and don't guess beyond the summaries you're given.",
   ].join("\n");

   export const REPO_SYSTEM_PROMPT = [
       "You write the overview a developer sees first when opening an unfamiliar repository. You're given the summaries of its top-level folders and files.",
       "Give a tagline and a summary. The tagline is a noun phrase of 3 to 6 plain words, like \"Distributed task scheduling service\". The summary is 2 to 4 sentences.",
       "The summary says what the project is, names its main areas, and says where a newcomer should start reading.",
       "In the summary, write folder and file names in backticks, like `src/server`.",
       "Don't guess beyond the summaries you're given.",
   ].join("\n");
   ```

3. `renderFilePrompt` adds one line right after `Lines: <n>`:
   ```ts
   [listing, "", `Lines: ${lineCount}`, importerLine(importers), "", "Source:", truncateSource(source, maxChars)].join("\n")
   ```

4. `importerLine` is pure. Its rules:
   - **Folder of an importer.** The folder of `a/b/c.ts` is `a/b`. A file at the top level sits in the repo root, which is shown as `the repo root`.
   - **Ordering.** Count importers per folder, most first; break ties by folder path in code-point order. Show the first `maxFolders` as `<folder> (<count>)`, joined by `, `.
   - **No importers:** `Imported by: no other indexed file`.
   - **k ≤ maxFolders folders:** `` `Imported by: ${plural(n, "file")} in ${plural(k, "folder")}: ${list}` ``.
   - **k > maxFolders folders:** the same line, followed by `` `, and ${plural(k - maxFolders, "other folder")}` ``.

   Tests, with each expected string verbatim:
   - `[]` gives `Imported by: no other indexed file`.
   - `["src/app/main.ts"]` gives `Imported by: 1 file in 1 folder: src/app (1)`.
   - `["src/app/main.ts", "src/app/view.tsx", "index.ts"]` gives `Imported by: 3 files in 2 folders: src/app (2), the repo root (1)`.
   - `["a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts", "c/x.ts", "d/x.ts", "e/x.ts"]` gives `Imported by: 7 files in 5 folders: a (2), b (2), c (1), and 2 other folders`.
   - Every existing `renderFilePrompt` expectation gains the importer line and otherwise keeps its meaning.

5. `loadImporterPaths` returns the paths of the files in that repo that import `filePath`, sorted by path.
   - Each importer appears once, because imports are unique per source/target.
   - An unknown path returns `[]`.
   - Test it against the mini-repo fixture with hand-derived expectations: read the fixture's import statements to find a file with at least 2 importers. Don't derive the expectation by running the code.
   - All SQL stays in `lib/db/*`.

6. `buildFilePrompt` passes `loadImporterPaths(db, repoId, file.path)`.
   - The importers are **not** part of a file's input hash, because the planner hashes only path and content.
   - So a new importer doesn't re-summarize a central file on every pull. Say so in a one-line comment.

7. **Taglines** (claude.ts).
   - The schema's tagline description becomes `A noun phrase of 3 to 6 plain words.`
   - `cleanTagline` works in this order:
     1. Remove backticks, since the UI shows taglines as plain text.
     2. Split on whitespace.
     3. Keep 8 words or fewer whole.
     4. For more than 8, keep the first 8, then drop trailing words while the last one is one of `a an the and or of for to in on with via by from at as` (case-insensitive). Never drop the first word.
     5. Strip trailing `.`, `,`, `;` and `:`.
   - An empty result is the existing "the reply didn't have a tagline and a summary" error.
   - Tests, verbatim:
     - `Typed event emitter and listener registry helpers` (7 words) stays unchanged.
     - `Core DOM utilities for the browser workbench and its helpers` gives `Core DOM utilities for the browser workbench`.
     - `Registry of commands for the workbench and for all extensions` gives `Registry of commands for the workbench`.
     - `` `URI` parsing and formatting. `` gives `URI parsing and formatting`.
   - The old six-word clamp expectation goes. Report which existing assertions changed, and why.

8. **Docs.**
   - The tagline wording is `tagline` (3–6 words asked for; up to 8 kept whole) in three places:
     - PIVOT_SPEC's `summaries` row;
     - DATABASE_DESIGN's `summaries` tagline;
     - the schema comment.
   - PIVOT_SPEC §5.3's file input becomes: "path, the file-summary chunk (imports/exports), its importers from the graph (how many, and the top 3 folders they sit in), and the file text capped at about 6k tokens".
   - RAG_PIPELINE: the prompt input and the new tagline rule.
   - **ADR-034, "Summary prompt v2, from the owner's checkpoint (2026-10-11)":**
     - **Context.** Review #1 found Haiku close to Sonnet at about 1/20 the price. The 6-word clamp cut 7–8 of 20 Haiku taglines mid-phrase. Summaries hedged with "truncated" and "not shown".
     - **Decision.**
       - Haiku for files, and effort stays low.
       - The prompt v2 items.
       - Taglines are asked for in 3–6 words and kept whole up to 8. A longer one is cut at a word boundary, minus dangling connector words.
       - Backticks are stripped from taglines.
       - Importers go in the file prompt but not in the input hash.
     - **Consequences.**
       - v2 invalidates every stored summary, but VS Code has none yet.
       - The usage sentence reflects the graph as it was when the file was summarized.
       - The file prompt grows by about 100 tokens, roughly $0.05 over a VS Code pass.
       - The UI's tagline promise becomes ≤ 8 words.
   - In Review #1, replace the "Owner's verdict" placeholder line with:
     > **Owner's verdict (2026-10-11):** Haiku 5.5 writes the file summaries; effort stays low. Before the full run, prompt v2 (`PROMPT_VERSION` 2): a 3–6 word noun-phrase tagline with an example; "don't mention truncation or code you weren't shown" replaces the truncation instruction; each file's import count and top importer folders from the graph; identifiers in backticks; taglines kept whole up to 8 words instead of cut at 6 (ADR-034). Then Review #2 on the same 20 files. Go for the full Batch run (Haiku files, Sonnet folders and the repo) once Review #2 is approved, stopping before any batch that would take the spend so far plus the remaining estimate past $15.

9. **Commit.** Run the gate: `npx tsc --noEmit && npm run lint && npx vitest run`. Commit as `feat: summary prompt v2 from the owner's checkpoint: 3-6 word taglines kept whole up to 8, importers in the file prompt, identifiers in backticks`, then push.
   - **Don't run `compare-summaries`.** After the task review, the controller runs Review #2 (`npm run compare-summaries -- ../vscode`), commits and pushes `docs/SUMMARY_REVIEW.md`, and STOPS for the owner.

**Ruled during execution (2026-10-11).** A read-only preview on VS Code's graph showed central files' example folders were mostly test folders. For example, `log.ts`'s top folder was `src/vs/platform/agentHost/test/node` (138). So `loadImporterPaths` became `loadImporters(db, repoId, filePath): { path: string; isTest: boolean }[]`, and `importerLine` builds its counts and examples from non-test importers only. It reports tests as `, plus N test files`, or `only N test files` when nothing else imports the file (ADR-034). A connector is also dropped at the cut when trailing punctuation is attached to it (`and,`).

### Task 12a: The spend cap

**Files:**
- Create: `lib/index/summarize/budget.ts`, `lib/index/summarize/budget.test.ts`
- Modify:
  - `lib/index/summarize/run.ts`
  - `lib/index/summarize/pricing.ts` (`formatUsd`)
  - `lib/index/summarize/compare.ts` (to use the shared `formatUsd` and the shared folder-token assumption)
  - `scripts/summarize.ts`
  - the summaries store, if it needs a per-model count of in-flight rows
- Test: `lib/index/summarize/run.test.ts`
- Docs: `docs/PIVOT_SPEC.md` §5.3, `docs/ENGINEERING_DECISIONS.md` (ADR-035), `docs/RAG_PIPELINE.md` §4 and §8

**Requirements:**

1. **The budget module.** `budget.ts` is pure. It exports `ASSUMED_TOKENS`, the tokens per request assumed for a model with no recorded usage:
   - file: 4,600 input and 260 output (Review #1's Haiku means);
   - folder and repo: 1,000 input and 250 output.

   compare.ts takes its folder-input assumption from here.

2. **The projection.** Before **every** submission, including the first and before any prompt is built, the run projects: spent + at Anthropic + this submission + the rest. A submission is each batch chunk and each regular-API wave.
   - **Spent:** every `summary_usage` row of the repo, priced at its own transport. This is cumulative across runs, so the cap bounds the repo's total summary spend.
   - **At Anthropic:** the rows in flight, at batch prices.
   - **This submission:** at its own transport.
   - **The rest:** targets still `ready` or `waiting` after this submission, at batch prices, or at direct prices when the run's transport is `direct`.
   - **Tokens per request for a model:** the repo's recorded mean for that model (Σ tokens ÷ Σ requests, over both transports) once it has any; until then, `ASSUMED_TOKENS` for the target's kind.
   - **A model with no price:** counted as $0, and named in the progress line.

3. **Money format.** Move `usd` from compare.ts to pricing.ts as the exported `formatUsd`: 4 decimals below $0.10, otherwise 2. compare's tests must not change.

4. **The option.** `SummaryRunOptions.budgetUsd?: number`; undefined means no cap. `summarizeNow` gets no cap.

5. **Under the budget:** `` ctx.say(`budget: spent ${S} + at Anthropic ≈ ${F} + this ${batch|wave} ≈ ${W} + the rest ≈ ${R} = ${T} of ${B}`) ``, with every amount formatted by `formatUsd`.

6. **Over the budget:**
   - Set `` ctx.stopped = `stopped: the next ${batch|wave} would bring the projected spend to ${T}, over the ${B} budget (spent ${S}, at Anthropic ≈ ${F}, this ${batch|wave} ≈ ${W}, the rest ≈ ${R}); run again with --budget <usd> to go on` ``.
   - Send nothing. The rows stay pending: not failed, not claimed.
   - The run ends through `finish` with `stopped: true`. The stage is `failed`, or `running` while batches are at Anthropic, exactly as the circuit breaker leaves it.

7. **CLI.**
   - `--budget <usd>` takes a positive number. Anything else prints the usage line and exits 1.
   - The default is `DEFAULT_BUDGET_USD = 15`, the S2 ceiling, exported from run.ts.
   - Update the header comment and the usage line.
   - When a run stops, print the summaries stage's note.

8. **Tests, hand-derived.**

   Prices per MTok, input/output: Haiku 0.10/0.50, Sonnet 2/10; batch is half. The stub answers 100 input and 20 output tokens per ok request. The fixture plans 7 file targets (Haiku), then waves of 4, 1 and 1 Sonnet targets, all through the regular API under `auto`.

   **budget.test.ts:**
   - **No usage yet.** 3 file requests at batch, and a rest of 2 folders at batch.
     - The files cost 3 × (4,600×0.10 + 260×0.50)/1M/2 = 3 × 0.000295 = 0.000885.
     - The folders cost 2 × (1,000×2 + 250×10)/1M/2 = 2 × 0.00225 = 0.0045.
     - Total 0.005385.
   - **Recorded usage replaces the assumption.** One Haiku batch row: 4 requests, 8,000 input and 400 output tokens.
     - Spent = (8,000×0.10 + 400×0.50)/1M/2 = 0.0005.
     - The mean is 2,000 input and 100 output, so 2 file requests at batch cost 2 × (2,000×0.10 + 100×0.50)/1M/2 = 0.00025.
     - A rest of 1 folder at batch costs 0.00225.
     - Total 0.003.
   - **At Anthropic.** 3 Haiku rows in flight with no usage cost 3 × 0.000295 = 0.000885.
   - **Unpriced.** A usage row for a model with no price is counted as $0 and named.

   **run.test.ts:**
   - **`budgetUsd: 0.01`, auto.**
     - The wave-1 projection is 7 × (4,600×0.10 + 260×0.50)/1M = 0.00413, plus a rest of 6 × 0.00225 = 0.0135, for 0.01763. That is over budget.
     - The run stops before wave 1: the stub gets 0 requests, `summarized` 0, `stopped` true, stage `failed`.
     - The note starts with `stopped: the next wave would bring the projected spend to $0.0176, over the $0.0100 budget`.
   - **`budgetUsd: 0.02`, auto.**
     - Wave 1 is sent (0.01763 ≤ 0.02).
     - The wave-2 projection is spent 7 × (100×0.10 + 20×0.50)/1M = 0.00014, this wave 4 × (1,000×2 + 250×10)/1M = 0.018, and the rest 2 × 0.00225 = 0.0045, for 0.02264. That stops the run.
     - `summarized` 7, and the stub got 7 requests.
     - The note starts with `stopped: the next wave would bring the projected spend to $0.0226, over the $0.0200 budget`.
   - **`budgetUsd: 0.01`, `transport: "batch"`.**
     - This batch is 7 × 0.000295 = 0.002065, and the rest 0.0135, for 0.015565. That stops the run.
     - No batch was submitted, and the 7 file rows are still `pending`.
     - The note starts with `stopped: the next batch would bring the projected spend to $0.0156, over the $0.0100 budget`.
   - **No `budgetUsd`.** The existing tests pass unchanged.

9. **Docs.**
   - PIVOT_SPEC §5.3 gets a **Spend cap** bullet: "Before each submission the run projects spent + at Anthropic + this submission + the rest and stops if that passes the budget (`--budget`, default $15 = S2)".
   - **ADR-035.**
     - The formula.
     - The ruled choices: cumulative per repo; every submission, including regular-API waves; the rest at batch prices.
     - The known gap: the last small regular-API waves are priced at batch rates in the rest, so the projection runs a little low (under $1 on VS Code). The next check catches it.
   - RAG_PIPELINE §4 (cost), and a §8 row: "a run would pass its budget".

10. **Commit.** Run the gate. Commit as `feat: a spend cap: stop before any submission that would take the projected summary spend past the budget (default $15)`, then push.

**Ruled during execution (2026-10-11).**

- **A budget stop stops sending, not collecting.** When the run goes over budget, it sends nothing new. It still collects the batches already at Anthropic, which are paid for, and re-checks after each collection, because recorded usage replaces the estimates. It finishes as stopped only when nothing is left in flight, or when `--no-wait` collected nothing.
- **Wave checks.** A wave's first check runs before the wave is counted.
- **Status note.** While over budget, the stage note says sending stopped.
- **CLI arguments.** The summarize CLI refuses arguments it doesn't know. Before this, `--budget=5` silently applied the default $15, and `--path=src/x.ts` started a full run (ADR-035).

### Task 12 (amended)

Task 12 runs after the owner approves Review #2: `npm run summarize -- ../vscode`, under the $15 default. At wrap-up:
- add rows for ADR-031 → ADR-035 to PIVOT_SPEC §15 (the owner's instruction);
- fill in Review #2's verdict with the owner's words.

---

## Addendum 2 (2026-10-11): the owner's Review #2 response

The owner asked for two things before Task 12:

1. **Group the "Imported by" examples by area,** using spec §4.2's "used by" rule: count the importers under the child of the LCA folder, instead of under the biggest leaf folders. Central files should then read, for example, "mostly `src/vs/workbench` and `src/vs/platform`".
2. **Preview the folder prompt.** Pick 10 varied VS Code folders, summarize their files with Haiku and then the folders with Sonnet through the direct API, write both up as Summary Review #3, and stop for the owner.

Two tasks implement this, in order: **Task 11c** (area grouping) and **Task 11d** (the folder preview tool). After 11d's review, the controller runs the preview (about $0.25) and stops. Task 12 waits for the owner's "go".

`PROMPT_VERSION` stays 2. No v2 summary has been stored for VS Code yet (its index holds 0 summaries), so nothing stored can go stale.

### Task 11c: "Imported by" grouped by area (§4.2's used-by rule)

**Files:**
- Modify: `lib/index/summarize/prompts.ts`, `lib/index/summarize/run.ts` (`buildFilePrompt`)
- Test: `lib/index/summarize/prompts.test.ts`, `lib/index/summarize/run.test.ts`
- Docs: `docs/PIVOT_SPEC.md` (§5.3 file input), `docs/RAG_PIPELINE.md`, `docs/ENGINEERING_DECISIONS.md` (an ADR-034 amendment, in the style of earlier amendments)

**Interfaces:**
- `importerLine(filePath: string, importers: readonly Importer[], maxGroups = MAX_IMPORTER_GROUPS): string`. `MAX_IMPORTER_GROUPS = 3` replaces `MAX_IMPORTER_FOLDERS`.
- `renderFilePrompt(listing: string, lineCount: number, importedBy: string, source: string, maxChars?: number): string` takes the rendered line. `buildFilePrompt` computes `importerLine(file.path, loadImporters(db, repoId, file.path))`.

**Requirements:**

1. **The group of an importer `a` of file `X`** is `childToward(lcaFolder(dirOf(X), dirOf(a)), a)`. Reuse `lcaFolder` and `childToward` from `lib/index/aggregate.ts`, and `dirOf` from `lib/index/paths.ts`: one implementation of §4.2, shared with the Map's level edges. The group is a folder, or the importer file itself when it sits directly in the LCA folder. A sibling in X's own folder is its own group.
2. **Counting.** Counts come from non-test importers only. Groups are ordered by count, most first, with ties broken by path in code-point order. The first `maxGroups` are shown as `<group> (<count>)`.
3. **The line, in each case:**
   - **No importers:** `Imported by: no other indexed file`. Unchanged.
   - **Only test importers:** `Imported by: only <N test file(s)>`. Unchanged.
   - **Otherwise:** `` `Imported by: ${plural(n, "file")}: ${list}` ``, followed by:
     - `` `, and ${plural(rest, "file")} elsewhere` `` when groups are hidden, where `rest` is n minus the shown counts;
     - `` `, plus ${plural(tests, "test file")}` `` when tests > 0.
4. **Tests,** each expected string verbatim and hand-derived:
   - `importerLine("src/vs/base/common/lifecycle.ts", …)` with these non-test importers:
     - `src/vs/base/common/async.ts`, `src/vs/base/common/worker/w.ts`;
     - `src/vs/base/browser/dom.ts`, `src/vs/base/browser/ui/list.ts`;
     - `src/vs/workbench/a/x.ts`, `src/vs/workbench/b/y.ts`, `src/vs/workbench/c.ts`;
     - `src/vs/platform/p/z.ts`, `extensions/e/src/m.ts`, `build.js`;

     plus the test importer `src/vs/base/test/common/lifecycle.test.ts`. The groups are:
     - `src/vs/workbench` with 3;
     - `src/vs/base/browser` with 2;
     - 1 each for `build.js`, `extensions`, `src/vs/base/common/async.ts`, `src/vs/base/common/worker` and `src/vs/platform`.

     Expected: `Imported by: 10 files: src/vs/workbench (3), src/vs/base/browser (2), build.js (1), and 4 files elsewhere, plus 1 test file`.
   - `importerLine("src/app/util.ts", [src/app/main.ts, src/app/view.tsx, src/index.ts])`, all non-test, gives `Imported by: 3 files: src/app/main.ts (1), src/app/view.tsx (1), src/index.ts (1)`.
   - `importerLine("src/core/log.ts", [src/app/main.ts])` gives `Imported by: 1 file: src/app (1)`.
   - `importerLine(x, [])` gives `Imported by: no other indexed file`.
   - `importerLine("src/app/main.ts", [{ path: "src/app/main.test.ts", isTest: true }])` gives `Imported by: only 1 test file`.
   - **Prompt shape.** Every existing `renderFilePrompt` and `buildFilePrompt` expectation is adjusted to the new line, derived by hand from the fixture's import statements, and otherwise keeps its meaning. Report each change.
5. **Docs:**
   - PIVOT_SPEC §5.3's file input says the importers are grouped by §4.2's used-by rule (the top 3 groups; test files counted separately).
   - RAG_PIPELINE says the same.
   - The ADR-034 amendment gives the reason: leaf folders named arbitrary deep folders for central files, whereas area groups say where in the codebase a file is used.
6. **Commit.** Run the gate, then commit as `feat: "Imported by" groups importers by area with spec §4.2's used-by rule` and push. Make no API call.

### Task 11d: Folder preview, Summary Review #3

**Files:**
- Create: `lib/index/summarize/preview.ts` (pure helpers), `lib/index/summarize/preview.test.ts`, `scripts/preview-folders.ts`
- Modify: `package.json` (`"preview-folders": "tsx scripts/preview-folders.ts"`)
- Docs: a one-line pointer in `docs/RAG_PIPELINE.md`. `docs/SUMMARY_REVIEW.md` is written by the run, not by this task.

**The sample** is fixed in the script as `REVIEW_3_FOLDERS`, each with a one-line reason the review prints. That gives 128 non-test files plus about 25 folders, roughly $0.25 on the direct API.

| Folder | Why |
|---|---|
| `src/vs/base/browser/ui/scrollbar` | a leaf UI widget (8 files) |
| `src/vs/base/parts/contextmenu` | VS Code's common/browser/electron layering: 3 one-file subfolders |
| `src/vs/platform/configuration` | a platform service with more test files than code |
| `src/vs/editor/common/model/tokens` | files plus a subfolder |
| `src/vs/editor/contrib/folding` | an editor contribution with tests |
| `src/vs/workbench/contrib/terminal/browser/xterm` | a leaf integration with a third-party library |
| `src/vs/workbench/services/remote` | a workbench service split by layer (3 subfolders) |
| `src/vs/workbench/contrib/chat/browser/aiCustomization` | a big leaf (55 files) that exercises the 50-item cap |
| `extensions/mermaid-markdown-features/src` | a built-in extension |
| `build/npm` | build tooling, not product code |

**Requirements:**

1. **Read-only.** The preview **never writes the index**: no store write function is called. It reads facts with `loadFileFacts`, `loadFolderFacts`, `loadSummaries` and `buildFilePrompt`, and sends requests with `createClaudeSummarizer(...).summarize` (regular API, concurrency 4 via `mapLimit`). It records nothing in `summary_usage`.
2. **Files.** Every non-test file under a sample folder is summarized with `SUMMARY_MODELS.file` and `FILE_SYSTEM_PROMPT`, using exactly the prompt `buildFilePrompt` builds. Test files get their template through the planner, as in a real run.
3. **Folders,** bottom-up, deepest first. Every folder at or under a sample folder gets an in-memory `StoredSummary` row for each answer received. The `inputHash` is the planner's hash for that target, so the planner sees it as current.
   - Then call the pure `planSummaries(files, folders, rows, options)`. Take each folder's planned `prompt` once it's `ready`, and send it with `SUMMARY_MODELS.folder` and `FOLDER_SYSTEM_PROMPT`.
   - These are exactly the folder prompts the real run will build.
   - A failed child is settled (as in the runner), so its folder still goes out, with "(no summary yet)" for that child. The review lists every failure.
4. **The review.** Append `## <date> Summary Review #<n> — folder preview: <file model> files and <folder model> folders on 10 folders of <repo>` to `docs/SUMMARY_REVIEW.md`. Number it as compare-summaries does. It contains:
   - **Header:** a metadata line (repo, effort, prompt version, the regular Messages API) and the sample table with the reasons.
   - **"Imported by" grouped by area:** the new line for each of Review #1's 20 sample files (`pickSample(files, 20)`), computed from the graph with no API call.
   - **Cost on this sample:** one row per model with requests, input and output tokens, mean input and output tokens per request, and cost. It uses `formatUsd`, and "at least" when unpriced, like compare.
   - **Full-pass estimate (Batch API, half price):**
     - files at Haiku's measured mean;
     - folders and the repo at Sonnet's **measured folder mean**, input and output, replacing the 1,000-token assumption;
     - the total against S2's $15.
     - Note that this sample skews toward small folders, and give the measured mean for the 55-file folder on its own line.
   - **The folders:** one section per sample folder, the folder's own summary first.
     - Each subfolder summary is indented beneath it, deepest last.
     - Its file summaries go in a `<details><summary>N file summaries (model)</summary> … </details>` block, so the folder summaries stay readable.
     - Failures are shown inline as `failed: <error>`.
   - **Owner's verdict:** a placeholder line, `_To fill in: go or no-go for the full run, and any prompt changes first._`
5. **Pure, tested helpers** in `preview.ts`:
   - the subtree selection (which files and folders a sample covers);
   - the bottom-up order;
   - the in-memory row construction;
   - the review rendering.

   Test them on the mini-repo fixture with hand-derived expectations: a sample of one folder with a subfolder covers the right files, plans the folder only after its subfolder, and renders a small review with exact strings.
6. **The CLI** accepts only `<path-to-repo>`. Anything else prints the usage line and exits 1, with the same strictness as `summarize`. It prints progress and the review's title.
7. **Commit.** Run the gate, then commit as `feat: a folder preview tool: Haiku files then Sonnet folders on 10 sample folders, written up as a summary review` and push. Don't run the tool. The controller runs `npm run preview-folders -- ../vscode` after the task review, commits the review, and STOPS for the owner.

---

## Addendum 3 (2026-10-11): the owner's Review #3 response

The owner chose to template test-only folders and asked for two fixes before the run:

- **A cut-off summary.** Review #3's `common/configurationService.ts` summary ends mid-sentence ("…applyEdits. The"). The owner asked us to find the cause, never store a cut-off summary, detect it, retry with a higher limit, add a test, and re-run that file to confirm.
- **The ".." ending.**

Then Task 12 runs, with no new review.

**Diagnosis (controller, 2026-10-11).** The cut-off was not the output-token limit.
- `parseSummary` already fails every `max_tokens` reply, and this answer was stored.
- Three fresh runs of the same prompt all came back complete, with stop reason `end_turn`, about 280 output tokens, and a single text block.
- So Haiku returned well-formed JSON whose summary string simply stopped at "The".

Only refusal and max_tokens are checked today, so any other stop reason also passes through unchecked.

### Task 11e: Never store a cut-off summary; the ".." ending

**Files:** `lib/index/summarize/claude.ts`, `lib/index/summarize/prompts.ts` (a constant), `lib/index/summarize/claude.test.ts`, and the docs: `docs/RAG_PIPELINE.md` (§4 settings and the §8 failure table) and `docs/ENGINEERING_DECISIONS.md` (an ADR-034 amendment).

**Requirements:**

1. **Completeness.** A reply is complete only when all three hold:
   - `stop_reason === "end_turn"`;
   - the parsed summary, trimmed, ends in sentence punctuation: `/[.!?]["'`)\]]*$/`;
   - the parsed summary isn't empty.

   Refusals keep their existing error. Every other incomplete reply fails with an error that starts `the summary was cut off` and names the stop reason.
2. **The ".." ending.** Before the completeness check, `parseSummary` collapses a trailing run of two or more periods to one.
3. **Retry with a higher limit.**
   - When a regular-API answer is cut off, `summarize` retries once with `RETRY_MAX_OUTPUT_TOKENS = 8192` (prompts.ts, with a "why" comment).
   - The outcome's usage lists both attempts' tokens per model, because both are billed.
   - If the retry is cut off too, the outcome is failed, so nothing is stored and the next run resends it.
   - Never more than one retry.
4. **Batch answers.** In `batchResults`, each cut-off item is re-requested once through the same regular-API path with the higher limit, before results go back to the runner.
   - The batch attempt's usage and the retry's usage are both kept on the outcome.
   - Document the accounting gap: the runner records a batch outcome at batch rates, so a retried item's direct tokens are counted at half price. Retries are rare.
5. **Tests.** Use the fake client in `claude.test.ts`; the expectations are verbatim and hand-derived.
   - **Regular API, cut off, then complete.** A first reply with `end_turn` and the summary `"Writes go through ConfigurationEditing. The"`, then a complete reply.
     - The outcome is ok with the second text.
     - The second request has `max_tokens: 8192`.
     - The usage holds both attempts.
   - **Cut off twice.** The outcome is failed, the error starts with `the summary was cut off`, and exactly 2 requests were sent.
   - **Unchecked stop reason.** A reply with stop reason `pause_turn` and a complete-looking summary is treated as cut off, so it is retried.
   - **The ".." ending.** `parseSummary` turns `"…in one place.."` into `"…in one place."`.
   - **Batch.** One cut-off item and one complete item come back. Only the cut-off one is re-requested, at 8192, and its outcome is ok.
6. **Commit:** gate, then `fix: a cut-off summary is retried once with a higher limit and never stored; trailing ".." becomes "."`, then push.
   - After the review, the controller re-runs `src/vs/platform/configuration/common/configurationService.ts` alone, through `createClaudeSummarizer`, to confirm it comes back complete.

### Task 11f: Test-only folders get a template

**Files:** `lib/index/summarize/plan.ts`, `lib/index/summarize/prompts.ts`, the tests (`plan.test.ts`, `prompts.test.ts`), and the docs: `docs/PIVOT_SPEC.md` §5.3 (next to the test-file sentence), `docs/RAG_PIPELINE.md` (next to its test-file templating), and `docs/ENGINEERING_DECISIONS.md` (an ADR-034 amendment).

**Requirements:**

1. **Which folders.** A folder (never the repo) whose subtree holds at least one file and no non-test file gets a template summary, with no API call. It is planned exactly like a test file:
   - model `"template"`;
   - state `template`, then `current`;
   - status `skipped`;
   - `inputHash = inputHash("template", PROMPT_VERSION, `${path}\n${tagline}\n${summary}`)`.

   It's settled at once, so its parent can go out in the first folder wave.
2. **The template.** `testFolderSummary(folderPath, testFileCount)` in prompts.ts, pure:
   - **subject:** the path segment just before the first `test`, `tests` or `__tests__` segment, if there is one; otherwise the folder's own name;
   - **tagline:** `Tests for ${subject}`;
   - **summary:** `` `Test code (${plural(n, "test file")}) for ${subject}. Test-only folders get this template instead of a model-written summary.` ``

   Tests, verbatim:
   - `("src/vs/editor/contrib/folding/test/browser", 6)` gives `{ tagline: "Tests for folding", summary: "Test code (6 test files) for folding. Test-only folders get this template instead of a model-written summary." }`.
   - `("src/vs/platform/configuration/test", 8)` gives the tagline `Tests for configuration`.
   - `("src/fixtures", 1)` gives `{ tagline: "Tests for fixtures", summary: "Test code (1 test file) for fixtures. Test-only folders get this template instead of a model-written summary." }`.
3. **Planner tests** on synthetic `FileFacts`/`FolderFacts`, hand-derived:
   - **The parent waits on nothing.** Take a folder `a` with a non-test file `a/x.ts`, plus the test-only subfolders `a/test` and `a/test/unit`, the latter holding `a/test/unit/x.test.ts`.
     - Both `a/test` and `a/test/unit` are planned `template`, with model `"template"`.
     - `a` is `waiting` until `a/x.ts` is current, then `ready`.
     - `a`'s prompt lists `test/` with the template text.
   - **Mixed folders aren't templated.** A folder with one test file and one non-test file is not templated.
   - **The repo is never templated.**
4. **Docs.**
   - **PIVOT_SPEC §5.3:** "**Test files, and folders that hold only test files, get a templated summary with no API call** (status `skipped`)".
   - **RAG_PIPELINE:** the same.
   - **ADR-034 amendment:** the owner's reason and the measured scale. VS Code has 1,266 of 3,793 folders that are test-only; templating them saves an estimated $2.20.
5. **Commit:** gate, then `feat: test-only folders get a template instead of a Sonnet summary`, then push. No API call.

### Task 12 (amended again)

Run Task 12 after 11e and 11f are reviewed, with no new review. Its estimate is about $13.02 minus the test-folder saving, so about $10.8, against the $15 cap.
