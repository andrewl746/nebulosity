# V1.1 Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index any local TypeScript/JavaScript repo at VS Code scale into SQLite: files, symbols, chunks, resolved imports, a folder tree, and pre-aggregated per-level edges. The structure stage must finish in ≤ 60 s on VS Code.

**Architecture:** New engine modules live in `lib/index/` (discover → parse → resolve → aggregate → pipeline) and `lib/db/store/` (persistence). They're added next to the old Phase 2–4 code, which keeps running untouched until slice V1.3 retires it. Each file is parsed once with the TypeScript Compiler API and yields chunks, symbols and imports from one AST. Every bulk write is batched under SQLite's bound-parameter cap.

**Tech Stack:** TypeScript 5, `typescript` Compiler API, better-sqlite3 + Drizzle ORM (migrations via drizzle-kit), Vitest, tsx. No new dependencies.

**Spec:** `docs/PIVOT_SPEC.md` (slice V1.1, §3–§5). Decisions: ADR-024, ADR-026, ADR-030 in `docs/ENGINEERING_DECISIONS.md`.

## Global Constraints

- **Branch:** `pivot/v1`. **Stage only the files a task names** (`git add <paths>`). **Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`**: they're the owner's work in progress.
- **Commit messages** use a conventional prefix (`feat:`, `test:`, `refactor:`, `docs:`, `chore:`). **No `Co-Authored-By` line and no Claude attribution of any kind.**
- **Gate before every commit:** `npx tsc --noEmit && npm run lint && npx vitest run`. Lint *warnings* are acceptable (the `setEdges` warning in `GraphCanvas` predates this plan); errors are not.
- **Test expectations come from the "Fixture ground truth" section, derived by hand.** Never run the code and paste its output into a test.
- **Paths:** every path stored or compared is repo-relative with forward slashes (`src/app/main.ts`).
- **Layering:** nothing under `lib/` imports from `app/`, `next` or `react` (ARCHITECTURE.md §3, rule 1).
- **Parameter cap:** no SQLite statement may exceed 32,766 bound parameters. Every bulk insert goes through `lib/db/batch.ts`.
- **Don't index the Nebulosity repo itself before V1.3.** The old `GET /api/graph` (`saveScan`) only scans `app/` and `lib/` and deletes every other file row for that repo.
- **Success criterion S1:** the structure stage takes ≤ 60 s on VS Code at commit `cc3fec88`, cloned at `../vscode` (`C:\Users\Andrew\Programming\vscode`).
- **Out of scope for V1.1:** summaries, FTS, embeddings, API routes, UI, MCP. Those are V1.2–V1.4.

## Review Focus

The five failure modes most likely to hurt a real user. Each line names the task whose test covers it.

1. **The user points the indexer at the wrong or an empty directory.** Expect a clean result (0 files, a root folder only), not a crash. Covered in Task 10.
2. **Windows backslashes leaking into stored paths.** Every edge lookup would silently miss (BUGS_ENCOUNTERED #3 was exactly this). Discovery must return forward slashes only. Covered in Task 5.
3. **File names with spaces or non-ASCII characters in a git repo.** They must come through unquoted and intact. Covered in Task 5.
4. **A malformed `tsconfig.json`.** Alias resolution degrades to "unresolved" while relative imports still resolve, and nothing throws. Covered in Task 7.
5. **A source file that starts with a UTF-8 BOM.** Its imports and symbols must still be found. Covered in Task 6.

## File map

| File | Status | Responsibility |
|---|---|---|
| `vitest.config.ts` | create | exclude `test/fixtures/**` from test collection |
| `tsconfig.json`, `eslint.config.mjs`, `.gitignore` | modify | exclude fixtures from type-check/lint; drop native-build ignore |
| `test/fixtures/mini-repo/**` | create | hand-designed sample repo (ground truth below) |
| `native/` | delete | C++ scanner retired (ADR-025) |
| `lib/home.ts` | create | `NEBULOSITY_HOME` resolution |
| `lib/db/client.ts` | modify | home-relative paths, `synchronous = NORMAL` |
| `lib/db/schema.ts` + `lib/db/migrations/0002_pivot_v1_1.sql` | modify / generate | new tables and columns, per-file chunk uniqueness |
| `lib/db/batch.ts` | create | split bulk inserts under the parameter cap |
| `lib/index/paths.ts` | create | `normalizeSlashes`, `dirOf`, `joinRepoPath` |
| `lib/index/discover.ts` | create | `git ls-files` / walk, size cap, test-file detection, git HEAD |
| `lib/chunks.ts` | modify | export `parseSourceFile` + `extractChunksFromSourceFile` (parse once) |
| `lib/index/languages/typescript.ts` | create | one parse → chunks, symbols, imports, line count |
| `lib/index/resolve.ts` | create | specifier → repo file (relative, tsconfig paths/baseUrl/extends, NodeNext, index) |
| `lib/index/aggregate.ts` | create | folder tree + level edges (LCA rule) |
| `lib/db/store/lock.ts` | create | shared indexing lock (extracted from `lib/index-repo.ts`) |
| `lib/db/store/structure.ts` | create | persistence for one structure run |
| `lib/index/pipeline.ts` | create | `indexRepository()` orchestration + stats + timings |
| `lib/config.ts` | create | `.nebulosity/config.json` (`activeRepo`) |
| `scripts/index.ts` + `package.json` | create / modify | `npm run index -- <repo>` |
| `docs/DATABASE_DESIGN.md`, `docs/PIVOT_SPEC.md`, `docs/BENCHMARKS.md`, `docs/IMPLEMENTATION_ROADMAP.md` | modify / create | docs in the same change set (maintenance rule) |

## Fixture ground truth (hand-derived; tests transcribe these)

`test/fixtures/mini-repo` contains these **8 source files**, sorted. `README.md` and `tsconfig.json` aren't source files.

```
scripts/build.js
src/app/main.ts
src/app/view.tsx
src/core/index.ts
src/core/log.ts
src/index.ts
src/util/strings.test.ts     (isTest = true; every other file is false)
src/util/strings.ts
```

**11 resolved import edges** (source → target, with the specifier that produced each):

| # | Source | Target | Specifier |
|---|---|---|---|
| 1 | `scripts/build.js` | `src/index.ts` | `../src/index` (require) |
| 2 | `scripts/build.js` | `src/app/main.ts` | `../src/app/main` (dynamic import) |
| 3 | `src/app/main.ts` | `src/core/log.ts` | `../core/log` |
| 4 | `src/app/main.ts` | `src/app/view.tsx` | `./view` |
| 5 | `src/app/main.ts` | `src/util/strings.ts` | `../util/strings.js` (NodeNext `.js` → `.ts`) |
| 6 | `src/app/view.tsx` | `src/app/main.ts` | `./main` |
| 7 | `src/core/index.ts` | `src/core/log.ts` | `./log` (re-export) |
| 8 | `src/index.ts` | `src/app/main.ts` | `./app/main` |
| 9 | `src/index.ts` | `src/core/log.ts` | `@core/log` (tsconfig `paths`) |
| 10 | `src/util/strings.test.ts` | `src/util/strings.ts` | `./strings` |
| 11 | `src/util/strings.ts` | `src/core/index.ts` | `../core` (directory → `index.ts`) |

`react` in `view.tsx` is external, so it produces no edge. The string `"import fake from './not-real'"` in `log.ts` is not an import.

**6 folders.** The root's name is the repo directory's basename.

| path | parentPath | depth | fileCount | directFileCount |
|---|---|---|---|---|
| `""` | `null` | 0 | 8 | 0 |
| `scripts` | `""` | 1 | 1 | 1 |
| `src` | `""` | 1 | 7 | 1 |
| `src/app` | `src` | 2 | 2 | 2 |
| `src/core` | `src` | 2 | 2 | 2 |
| `src/util` | `src` | 2 | 2 | 2 |

**10 level edges.** The rule for each import: take `L` = the deepest folder containing both files. Each end is represented by its child of `L` (a subfolder, or the file itself when it sits directly in `L`). The counts sum to 11.

| levelPath | sourceNode | targetNode | count | from edge(s) |
|---|---|---|---|---|
| `""` | `scripts` | `src` | 2 | 1, 2 |
| `src` | `src/app` | `src/core` | 1 | 3 |
| `src` | `src/app` | `src/util` | 1 | 5 |
| `src` | `src/index.ts` | `src/app` | 1 | 8 |
| `src` | `src/index.ts` | `src/core` | 1 | 9 |
| `src` | `src/util` | `src/core` | 1 | 11 |
| `src/app` | `src/app/main.ts` | `src/app/view.tsx` | 1 | 4 |
| `src/app` | `src/app/view.tsx` | `src/app/main.ts` | 1 | 6 |
| `src/core` | `src/core/index.ts` | `src/core/log.ts` | 1 | 7 |
| `src/util` | `src/util/strings.test.ts` | `src/util/strings.ts` | 1 | 10 |

**Symbols of `src/core/log.ts`** (9 lines). Line numbers are the declaration itself, not its doc comment.

| qualifiedName | kind | startLine | endLine | exported | parentQualifiedName |
|---|---|---|---|---|---|
| `log` | function | 2 | 2 | true | null |
| `Logger` | class | 4 | 7 | true | null |
| `Logger.info` | method | 5 | 5 | true | `Logger` |
| `Logger.warn` | method | 6 | 6 | false (private) | `Logger` |
| `banner` | const | 9 | 9 | true | null |

---

### Task 1: Test infrastructure, fixture repo, and retiring `native/`

**Files:**
- Create: `vitest.config.ts`, `test/fixtures/mini-repo/` (10 files below)
- Modify: `tsconfig.json`, `eslint.config.mjs`, `.gitignore`
- Delete: `native/scanner/README.md` (the only file in `native/`)

**Interfaces:**
- Produces: the fixture at `test/fixtures/mini-repo`, used by Tasks 5, 7 and 10.

- [ ] **Step 1: Create the fixture files** (exact contents; line numbers in `log.ts` and `view.tsx` matter)

`test/fixtures/mini-repo/README.md`:
```md
# mini-repo

A hand-designed sample repository for Nebulosity's indexer tests. Every expected
value in those tests (files, import edges, folders, level edges, symbols) was
derived by hand from this exact layout; see "Fixture ground truth" in
`docs/plans/2026-10-11-v1-1-engine-foundation.md`. Change a file here and you
must re-derive the expectations by hand.
```

`test/fixtures/mini-repo/tsconfig.json` (JSONC on purpose, with comments and trailing commas):
```jsonc
{
  // JSONC on purpose: the resolver must read tsconfig the way TypeScript does.
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["src/core/*"],
    },
  },
}
```

`test/fixtures/mini-repo/src/index.ts`:
```ts
import { main } from "./app/main";
import { log } from "@core/log";

export function start(): void {
    log("start");
    main();
}
```

`test/fixtures/mini-repo/src/app/main.ts`:
```ts
import { log } from "../core/log";
import { render } from "./view";
import { shout } from "../util/strings.js";

export function main(): void {
    log(shout("main"));
    render();
}
```

`test/fixtures/mini-repo/src/app/view.tsx`:
```tsx
import { useState } from "react";
import { main } from "./main";

export function render(): void {
    void useState;
    void main;
}

export function View() {
    return <div>view</div>;
}
```

`test/fixtures/mini-repo/src/core/log.ts` (exactly 9 lines):
```ts
/** Writes a message. */
export function log(message: string): void { console.log(message); }

export class Logger {
    info(message: string): void { log(message); }
    private warn(message: string): void { log("warn: " + message); }
}

export const banner = "import fake from './not-real'";
```

`test/fixtures/mini-repo/src/core/index.ts`:
```ts
export * from "./log";
```

`test/fixtures/mini-repo/src/util/strings.ts`:
```ts
import { log } from "../core";

export const shout = (s: string): string => {
    log(s);
    return s.toUpperCase();
};
```

`test/fixtures/mini-repo/src/util/strings.test.ts`:
```ts
import { shout } from "./strings";

export const checks = [shout("a") === "A"];
```

`test/fixtures/mini-repo/scripts/build.js`:
```js
const { start } = require("../src/index");

import("../src/app/main").then(() => start());
```

- [ ] **Step 2: Watch the gates fail** — the fixture is data, but the tools don't know that yet.

Run: `npx vitest run`
Expected: FAIL — `test/fixtures/mini-repo/src/util/strings.test.ts` is collected and reports "No test suite found".

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@core/log'` (the fixture's alias isn't in the root tsconfig).

- [ ] **Step 3: Exclude fixtures from Vitest, tsc and ESLint**

Create `vitest.config.ts`:
```ts
import { configDefaults, defineConfig } from "vitest/config";

// test/fixtures holds sample repositories that the indexer tests *index*. They are
// data, not tests: their own *.test.ts files must never be collected as suites.
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, "test/fixtures/**"],
    },
});
```

In `tsconfig.json`, change the `exclude` line from:
```json
  "exclude": ["node_modules"]
```
to:
```json
  "exclude": ["node_modules", "test/fixtures"]
```

In `eslint.config.mjs`, change the `globalIgnores` block to:
```js
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sample repositories the indexer tests read as data (they use require(), JSX, aliases…)
    "test/fixtures/**",
  ]),
```

- [ ] **Step 4: Retire `native/` (ADR-025)**

Run: `git rm -r native`
Then delete these two lines at the end of `.gitignore`:
```
# native scanner build output
native/scanner/build/
```

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — `Tests  63 passed (63)` (unchanged count; the fixture is no longer collected).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tsconfig.json eslint.config.mjs .gitignore test/fixtures/mini-repo
git commit -m "test: add mini-repo fixture and retire native scanner (ADR-025)"
```
(`git rm` already staged the `native/` deletion.)

---

### Task 2: `NEBULOSITY_HOME` and faster commits

**Files:**
- Create: `lib/home.ts`, `lib/home.test.ts`
- Modify: `lib/db/client.ts`, `docs/PIVOT_SPEC.md` (§3 rule 4)

**Interfaces:**
- Produces: `nebulosityHome(): string`, `nebulosityPath(...segments: string[]): string` (used by Task 11 and by the V1.4 MCP server).

- [ ] **Step 1: Write the failing test** — `lib/home.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { nebulosityHome, nebulosityPath } from "./home";

const original = process.env.NEBULOSITY_HOME;

afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
});

describe("nebulosityHome", () => {
    it("uses NEBULOSITY_HOME when it is set", () => {
        process.env.NEBULOSITY_HOME = path.join(os.tmpdir(), "neb-home");
        expect(nebulosityHome()).toBe(path.resolve(os.tmpdir(), "neb-home"));
    });

    it("falls back to the current working directory", () => {
        delete process.env.NEBULOSITY_HOME;
        expect(nebulosityHome()).toBe(path.resolve(process.cwd()));
    });

    it("joins paths under home", () => {
        process.env.NEBULOSITY_HOME = path.join(os.tmpdir(), "neb-home");
        expect(nebulosityPath(".nebulosity", "nebulosity.db"))
            .toBe(path.join(path.resolve(os.tmpdir(), "neb-home"), ".nebulosity", "nebulosity.db"));
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/home.test.ts`
Expected: FAIL — `Failed to resolve import "./home"`.

- [ ] **Step 3: Implement** — `lib/home.ts`:
```ts
import path from "path";

/**
 * Where Nebulosity keeps its own files: the database, the migrations, the config.
 *
 * Not process.cwd() alone. The MCP server (slice V1.4) is launched by Claude Code
 * from inside the *user's* repository, so cwd there is the wrong directory, and
 * the launcher sets NEBULOSITY_HOME explicitly. Next.js, the CLI scripts and
 * Vitest all run from the checkout, where cwd is already correct.
 */
export function nebulosityHome(): string {
    return path.resolve(process.env.NEBULOSITY_HOME ?? process.cwd());
}

export function nebulosityPath(...segments: string[]): string {
    return path.join(nebulosityHome(), ...segments);
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run lib/home.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Point the database client at home** — replace the top of `lib/db/client.ts` through the end of `createDb` with:
```ts
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "./schema";
import { nebulosityPath } from "../home";

function createDb(){
    // Vitest gets a throwaway in-memory database. Everything else opens the real file
    // under NEBULOSITY_HOME (lib/home.ts), never relative to cwd, because the MCP
    // server is launched from inside the user's repository.
    const dbPath = process.env.VITEST ? ":memory:" : nebulosityPath(".nebulosity", "nebulosity.db");

    if (dbPath !== ":memory:"){
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    // NORMAL is SQLite's recommended pairing for WAL: still corruption-safe, but a
    // commit no longer waits for an fsync. Indexing VS Code commits ~30 batches, and
    // FULL would make every one of them wait on the disk.
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, {schema});

    // Migrate every database, not just the in-memory test one. Drizzle records
    // applied migrations in its own table, so this is idempotent and cheap on an
    // already-current file, and it is what makes "delete the .db file and it
    // self-heals on the next request" (Phase D's acceptance criterion) actually
    // true. Migrating only :memory: also meant schema drift could never be
    // caught by the test suite, because the tests were the only thing running
    // the migrations at all.
    migrate(db, { migrationsFolder: nebulosityPath("lib", "db", "migrations") });

    return db;
}
```
(Leave `globalForDb` and `getDb` below it unchanged.)

- [ ] **Step 6: Update the spec** — in `docs/PIVOT_SPEC.md` §3 rule 4, replace:
```
so both must resolve from `NEBULOSITY_HOME`, which defaults to the Nebulosity checkout (derived from the module's own location).
```
with:
```
so both must resolve from `NEBULOSITY_HOME`, falling back to `process.cwd()` when it's unset. That fallback is correct for Next.js, the CLI and Vitest, which all run from the checkout. The MCP launcher (V1.4) always sets it.
```

- [ ] **Step 7: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 66 tests.

- [ ] **Step 8: Commit**
```bash
git add lib/home.ts lib/home.test.ts lib/db/client.ts docs/PIVOT_SPEC.md
git commit -m "feat: resolve database paths from NEBULOSITY_HOME; WAL synchronous=NORMAL"
```

---

### Task 3: Schema additions and migration

**Files:**
- Modify: `lib/db/schema.ts`, `docs/DATABASE_DESIGN.md`, `docs/PIVOT_SPEC.md` (§4.1)
- Generate: `lib/db/migrations/0002_pivot_v1_1.sql` (+ `meta/` snapshot and journal)
- Test: `lib/db/schema.test.ts`

**Interfaces:**
- Produces (Drizzle tables, imported by Tasks 4, 9 and 10):
  - `files`, now with `language`, `sizeBytes`, `lineCount`, `isTest`, `importSpecifiers` (a JSON string)
  - `repositories.indexedHead`
  - `chunks`, unique on `(fileId, chunkId)`
  - `symbols`
  - `folders`
  - `levelEdges`
  - `SYMBOL_KINDS`
  - `type SymbolKind`

- [ ] **Step 1: Write the failing test** — `lib/db/schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { chunks, files, repositories } from "./schema";

describe("schema (V1.1)", () => {
    it("creates the pivot tables", () => {
        const names = getDb()
            .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
            .map((r) => r.name);
        expect(names).toEqual(expect.arrayContaining(["folders", "level_edges", "symbols"]));
    });

    it("adds the new files columns with defaults", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/schema-test/defaults" }).returning().get();
        const row = db.insert(files).values({ repoId: repo.id, path: "a.ts", kind: "module", contentHash: "" }).returning().get();
        expect(row).toMatchObject({ language: "typescript", sizeBytes: 0, lineCount: 0, isTest: false, importSpecifiers: "[]" });
    });

    it("lets two repos hold the same chunk id (unique per file, not globally)", () => {
        const db = getDb();
        const repoA = db.insert(repositories).values({ rootPath: "/schema-test/a" }).returning().get();
        const repoB = db.insert(repositories).values({ rootPath: "/schema-test/b" }).returning().get();
        const fileA = db.insert(files).values({ repoId: repoA.id, path: "src/index.ts", kind: "module", contentHash: "" }).returning().get();
        const fileB = db.insert(files).values({ repoId: repoB.id, path: "src/index.ts", kind: "module", contentHash: "" }).returning().get();
        const chunk = { chunkId: "src/index.ts#start#0", kind: "function" as const, name: "start", startLine: 1, endLine: 2, text: "x", fileHash: "h" };
        db.insert(chunks).values([{ ...chunk, fileId: fileA.id }, { ...chunk, fileId: fileB.id }]).run();
        const count = db.all<{ c: number }>(sql`select count(*) as c from chunks where chunk_id = 'src/index.ts#start#0'`)[0].c;
        expect(count).toBe(2);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: FAIL. The first two tests fail because the tables and columns are missing, and the third fails with `UNIQUE constraint failed: chunks.chunk_id`.

- [ ] **Step 3: Edit `lib/db/schema.ts`**

1. Add `indexedHead` as the last field of `repositories`:
```ts
    lastIndexAt: integer("last_index_at", { mode: "timestamp" }),
    // the git commit the last index run saw (null outside git); lets later runs ask git what changed
    indexedHead: text("indexed_head")
```
2. Add these fields after `contentHash` in `files`:
```ts
    contentHash: text("content_hash").notNull(),
    language: text("language").notNull().default("typescript"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    lineCount: integer("line_count").notNull().default(0),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    // Raw import specifiers as a JSON array. Every run re-resolves every file's imports
    // (a new or deleted file changes what "../core" points at) without re-parsing the
    // files whose content hash is unchanged.
    importSpecifiers: text("import_specifiers").notNull().default("[]")
```
3. In `chunks`, drop `.unique()` from `chunkId` and add a table-level unique index. The whole definition becomes:
```ts
export const chunks = sqliteTable("chunks", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    // unique per FILE (index below), not globally: many repos share one database and
    // two of them can both contain "src/index.ts#start#0"
    chunkId: text("chunk_id").notNull(),
    kind: text("kind", {
        enum: ["function", "class", "component", "interface", "type", "const", "enum", "namespace", "file-summary"]
    }).notNull(),
    name: text("name").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    partIndex: integer("part_index").notNull().default(0), // if the function is HUGE (e.g., 500 lines), split it into parts (0 for normal chunks, 1 for second part, 2 for third, etc.)
    text: text("text").notNull(), // the actual source code of this chunk (what the AI will read)
    fileHash: text("file_hash").notNull(), // sha256 of the whole source file at index time
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
}, (t) => [
    uniqueIndex("chunks_file_chunk_unique").on(t.fileId, t.chunkId)
]);
```
4. Append the new tables at the end of the file:
```ts
export const SYMBOL_KINDS = [
    "function", "class", "method", "property", "accessor", "constructor",
    "interface", "type", "enum", "const", "namespace"
] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/** One row per top-level declaration and per class member. */
export const symbols = sqliteTable("symbols", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    qualifiedName: text("qualified_name").notNull(),   // "Logger.info" for members
    kind: text("kind", { enum: SYMBOL_KINDS }).notNull(),
    // the declaration itself, excluding its doc comment: these lines are for jumping to a definition
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    parentQualifiedName: text("parent_qualified_name")  // null for top-level declarations
}, (t) => [
    index("symbols_file_idx").on(t.fileId),
    index("symbols_name_idx").on(t.name)
]);

/** The folder tree of the indexed files. "" is the repo root. */
export const folders = sqliteTable("folders", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    parentPath: text("parent_path"),                         // null only for the root
    depth: integer("depth").notNull(),                       // root = 0
    name: text("name").notNull(),                            // the root uses the repo directory's name
    fileCount: integer("file_count").notNull(),              // source files anywhere below
    directFileCount: integer("direct_file_count").notNull()  // source files directly inside
}, (t) => [
    uniqueIndex("folders_repo_path_unique").on(t.repoId, t.path),
    index("folders_repo_parent_idx").on(t.repoId, t.parentPath)
]);

/**
 * The Map's lines, precomputed (PIVOT_SPEC.md §4.2). Each file→file import is
 * counted exactly once, at levelPath = the deepest folder containing both files;
 * sourceNode/targetNode are children of that folder (a subfolder, or the file
 * itself when it sits directly inside). Opening a folder is one indexed lookup.
 */
export const levelEdges = sqliteTable("level_edges", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    levelPath: text("level_path").notNull(),
    sourceNode: text("source_node").notNull(),
    targetNode: text("target_node").notNull(),
    count: integer("count").notNull()
}, (t) => [
    uniqueIndex("level_edges_unique").on(t.repoId, t.levelPath, t.sourceNode, t.targetNode)
]);
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate --name pivot_v1_1`
Expected: it creates `lib/db/migrations/0002_pivot_v1_1.sql` and updates `meta/`. Open the SQL and confirm it contains:
- `CREATE TABLE \`folders\``, `CREATE TABLE \`level_edges\``, `CREATE TABLE \`symbols\`` and their indexes
- `ALTER TABLE \`files\` ADD \`language\` text DEFAULT 'typescript' NOT NULL`, plus `size_bytes`, `line_count`, `is_test` and `import_specifiers`
- `ALTER TABLE \`repositories\` ADD \`indexed_head\` text`
- `DROP INDEX \`chunks_chunk_id_unique\`` and `CREATE UNIQUE INDEX \`chunks_file_chunk_unique\``

If drizzle-kit asks whether something was renamed, answer that it was **created**, not renamed. Nothing is renamed in this change.

- [ ] **Step 5: Run it to make sure it passes**

Run: `npx vitest run lib/db/schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Document it**

Append to `docs/DATABASE_DESIGN.md`:
```md

## 8. Pivot additions (slice V1.1, `PIVOT_SPEC.md` §4)

- **`files`** gains `language`, `size_bytes`, `line_count`, `is_test` and `import_specifiers` (a JSON array of the raw specifiers). Storing the specifiers lets an incremental run re-resolve *every* file's imports, because a new or deleted file can change what `"../core"` points at, while re-parsing only the files whose hash changed.
- **`chunks.chunk_id`** is unique per file (`(file_id, chunk_id)`), not globally. With many repos in one database, two of them can both contain `src/index.ts#start#0`.
- **`symbols`** has one row per top-level declaration and per class member: `name`, `qualified_name` (`Logger.info`), `kind`, `start_line`/`end_line`, `exported` and `parent_qualified_name`. The line range covers the declaration itself, excluding its doc comment, because it's used for jumping to a definition.
- **`folders`** is the folder tree of the indexed files: `path` (`""` is the repo root), `parent_path`, `depth`, `name`, `file_count` (recursive) and `direct_file_count`.
- **`level_edges`** holds the Map's lines, precomputed. Each file→file import is counted exactly once, at the deepest folder containing both files: `level_path`, `source_node`/`target_node` (children of that folder: a subfolder, or the file itself when it sits directly inside) and `count`.
- **`repositories.indexed_head`** records the git commit the last run saw.
- **Write discipline.** Every bulk insert goes through `lib/db/batch.ts`, which splits rows so no statement exceeds SQLite's 32,766 bound parameters. Drizzle binds every column, defaults included, so the cost per row is the table's column count. Repo-wide deletes use a subquery, never an `IN (...)` list of every id.
```

In the banner at the top of `docs/DATABASE_DESIGN.md`, replace `this doc is rewritten in slice V1.1.` with `§8 documents the V1.1 additions.`

In `docs/PIVOT_SPEC.md` §4.1:
- **`files` row:** replace ``adds `language`, `sizeBytes`, `lineCount`, `isTest`, `folderId`.`` with ``adds `language`, `sizeBytes`, `lineCount`, `isTest`, `importSpecifiers` (raw specifiers as JSON, so unchanged files are re-resolved without re-parsing).``
- **`symbols` row:** replace `` `parentSymbolId` `` with `` `parentQualifiedName` (a string, so whole batches insert without needing ids first) ``.
- **`chunks` row:** replace `retrieval units (existing chunker); feeds the code FTS index` with `retrieval units (existing chunker); feeds the code FTS index; `chunkId` is now unique per file`.

- [ ] **Step 7: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 69 tests.

- [ ] **Step 8: Commit**
```bash
git add lib/db/schema.ts lib/db/schema.test.ts lib/db/migrations docs/DATABASE_DESIGN.md docs/PIVOT_SPEC.md
git commit -m "feat: add folders, level_edges and symbols tables; per-file chunk uniqueness"
```

---

### Task 4: Batched writes (the 32,766-parameter fix)

**Files:**
- Create: `lib/db/batch.ts`, `lib/db/batch.test.ts`

**Interfaces:**
- Produces:
  - `SQLITE_MAX_PARAMS = 32_766`
  - `chunkRows<T>(rows: readonly T[], paramsPerRow: number, maxParams?: number): T[][]`
  - `forEachBatch<T>(rows: readonly T[], paramsPerRow: number, write: (batch: T[]) => void): void`
  - `columnCount(table: Table): number`

- [ ] **Step 1: Write the failing test** — `lib/db/batch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { files, imports, repositories } from "./schema";
import { chunkRows, columnCount, forEachBatch } from "./batch";

describe("chunkRows", () => {
    it("splits rows so no batch exceeds the parameter budget", () => {
        // 12 params / 4 per row = 3 rows per batch
        expect(chunkRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, 12)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
    });

    it("returns no batches for no rows", () => {
        expect(chunkRows([], 3)).toEqual([]);
    });

    it("still makes progress when one row alone exceeds the budget", () => {
        expect(chunkRows(["a", "b"], 20, 12)).toEqual([["a"], ["b"]]);
    });

    it("rejects a non-positive row width", () => {
        expect(() => chunkRows([1], 0)).toThrow("paramsPerRow must be >= 1");
    });
});

describe("columnCount", () => {
    it("counts every column of a table, the autoincrement id included", () => {
        expect(columnCount(imports)).toBe(4); // id, source_file_id, target_file_id, specifier
    });
});

describe("forEachBatch against SQLite", () => {
    it("writes 11,000 import rows, more than one statement can hold, without 'too many SQL variables'", () => {
        const db = getDb();
        const repo = db.insert(repositories).values({ rootPath: "/batch-test" }).returning().get();
        const fileRows = Array.from({ length: 120 }, (_, i) => ({ repoId: repo.id, path: `f${i}.ts`, kind: "module" as const, contentHash: "" }));
        const ids = db.insert(files).values(fileRows).returning({ id: files.id }).all().map((r) => r.id);

        const pairs: { sourceFileId: number; targetFileId: number; specifier: string }[] = [];
        for (const s of ids) for (const t of ids) if (s !== t && pairs.length < 11_000) pairs.push({ sourceFileId: s, targetFileId: t, specifier: "./x" });

        db.transaction((tx) => forEachBatch(pairs, columnCount(imports), (batch) => { tx.insert(imports).values(batch).run(); }));

        const count = db.all<{ c: number }>(sql`select count(*) as c from imports i join files f on f.id = i.source_file_id where f.repo_id = ${repo.id}`)[0].c;
        expect(count).toBe(11_000);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/db/batch.test.ts`
Expected: FAIL — `Failed to resolve import "./batch"`.

- [ ] **Step 3: Implement** — `lib/db/batch.ts`:
```ts
import { getTableColumns, type Table } from "drizzle-orm";

/**
 * SQLite refuses any statement with more than 32,766 bound parameters, and Drizzle
 * turns one `.values([...])` call into one statement. Measured 2026-10-10: the old
 * saveScan threw "too many SQL variables" past 10,922 import rows (3 params each).
 * Every bulk write goes through here.
 */
export const SQLITE_MAX_PARAMS = 32_766;

/** Splits rows into batches whose total parameter count stays within maxParams. */
export function chunkRows<T>(rows: readonly T[], paramsPerRow: number, maxParams: number = SQLITE_MAX_PARAMS): T[][] {
    if (paramsPerRow < 1){
        throw new Error(`paramsPerRow must be >= 1, got ${paramsPerRow}`);
    }

    // Math.max(1, …): a row wider than the whole budget still goes out alone,
    // rather than the loop never advancing
    const size = Math.max(1, Math.floor(maxParams / paramsPerRow));
    const batches: T[][] = [];

    for (let i = 0; i < rows.length; i += size){
        batches.push(rows.slice(i, i + size));
    }

    return batches;
}

export function forEachBatch<T>(rows: readonly T[], paramsPerRow: number, write: (batch: T[]) => void): void {
    for (const batch of chunkRows(rows, paramsPerRow)){
        write(batch);
    }
}

/**
 * Parameters one inserted row can cost. Drizzle binds a value for every column,
 * including columns left to their defaults, so the honest per-row width is the
 * table's column count. The autoincrement id is rendered as a literal `null`,
 * which makes this an overestimate by one: safe, and simpler than special-casing it.
 */
export function columnCount(table: Table): number {
    return Object.keys(getTableColumns(table)).length;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run lib/db/batch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 75 tests.

- [ ] **Step 6: Commit**
```bash
git add lib/db/batch.ts lib/db/batch.test.ts
git commit -m "feat: batch bulk inserts under SQLite's 32,766-parameter cap"
```

---

### Task 5: Path helpers and file discovery

**Files:**
- Create: `lib/index/paths.ts`, `lib/index/paths.test.ts`, `lib/index/discover.ts`, `lib/index/discover.test.ts`

**Interfaces:**
- Produces:
  - `normalizeSlashes(p: string): string`
  - `dirOf(relPath: string): string`
  - `joinRepoPath(baseDir: string, relative: string): string | null`
  - `type DiscoveredFile = { path: string; sizeBytes: number }`
  - `type SkippedFile = { path: string; reason: string }`
  - `type DiscoveryResult = { files: DiscoveredFile[]; skipped: SkippedFile[]; usedGit: boolean }`
  - `discoverFiles(repoRoot: string, opts: { extensions: readonly string[]; maxBytes?: number }): DiscoveryResult`
  - `DEFAULT_MAX_FILE_BYTES = 1_000_000`
  - `isTestPath(relPath: string): boolean`
  - `readGitHead(repoRoot: string): string | null`

- [ ] **Step 1: Write the failing path-helper tests** — `lib/index/paths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dirOf, joinRepoPath, normalizeSlashes } from "./paths";

describe("paths", () => {
    it("normalizes Windows separators", () => {
        expect(normalizeSlashes("src\\app\\main.ts")).toBe("src/app/main.ts");
    });

    it("dirOf returns the folder, or '' at the repo root", () => {
        expect(dirOf("src/app/main.ts")).toBe("src/app");
        expect(dirOf("index.ts")).toBe("");
    });

    it("joinRepoPath collapses . and ..", () => {
        expect(joinRepoPath("src/app", "../core/log")).toBe("src/core/log");
        expect(joinRepoPath("", "./a")).toBe("a");
        expect(joinRepoPath("src", "./x/../y")).toBe("src/y");
    });

    it("joinRepoPath returns null when the path climbs above the repo root", () => {
        expect(joinRepoPath("src", "../../outside")).toBeNull();
    });
});
```

- [ ] **Step 2: Write the failing discovery tests** — `lib/index/discover.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { discoverFiles, isTestPath, readGitHead } from "./discover";

const FIXTURE = path.resolve("test/fixtures/mini-repo");
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function tempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("discoverFiles — walking (no .git)", () => {
    it("finds the fixture's 8 source files, sorted, and nothing else", () => {
        const result = discoverFiles(FIXTURE, { extensions: TS_EXTENSIONS });
        expect(result.usedGit).toBe(false);
        expect(result.skipped).toEqual([]);
        expect(result.files.map((f) => f.path)).toEqual([
            "scripts/build.js",
            "src/app/main.ts",
            "src/app/view.tsx",
            "src/core/index.ts",
            "src/core/log.ts",
            "src/index.ts",
            "src/util/strings.test.ts",
            "src/util/strings.ts",
        ]);
    });

    it("never returns a backslash in a path, even on Windows", () => {
        const result = discoverFiles(FIXTURE, { extensions: TS_EXTENSIONS });
        expect(result.files.filter((f) => f.path.includes("\\"))).toEqual([]);
    });
});

describe("discoverFiles — git repositories", () => {
    it("respects .gitignore, keeps spaces and non-ASCII names intact, skips oversized files and .env files", () => {
        const dir = tempDir("neb-discover-git-");
        execFileSync("git", ["init", "-q", dir]);
        fs.writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
        fs.mkdirSync(path.join(dir, "ignored"));
        fs.writeFileSync(path.join(dir, "ignored", "b.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "with space.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "ünïcode.ts"), "export {};\n");
        fs.writeFileSync(path.join(dir, "notes.md"), "# notes\n");
        fs.writeFileSync(path.join(dir, ".env.ts"), "export const secret = 1;\n");
        fs.writeFileSync(path.join(dir, "big.ts"), `export const big = '${"x".repeat(60)}';\n`);

        const result = discoverFiles(dir, { extensions: TS_EXTENSIONS, maxBytes: 40 });

        expect(result.usedGit).toBe(true);
        expect(result.files.map((f) => f.path)).toEqual(["a.ts", "with space.ts", "ünïcode.ts"]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].path).toBe("big.ts");
        expect(result.skipped[0].reason).toMatch(/^too large/);
    });

    it("readGitHead is null for a repository with no commits and for a non-git folder", () => {
        const dir = tempDir("neb-head-");
        execFileSync("git", ["init", "-q", dir]);
        expect(readGitHead(dir)).toBeNull();
        expect(readGitHead(FIXTURE)).toBeNull();
    });
});

describe("isTestPath", () => {
    it("recognizes test files by name and by folder", () => {
        expect(isTestPath("src/util/strings.test.ts")).toBe(true);
        expect(isTestPath("src/x.spec.tsx")).toBe(true);
        expect(isTestPath("src/vs/base/test/common/x.ts")).toBe(true);
        expect(isTestPath("__tests__/x.js")).toBe(true);
    });

    it("does not mistake a word containing 'test' for a test folder", () => {
        expect(isTestPath("src/latest/x.ts")).toBe(false);
        expect(isTestPath("src/attest.ts")).toBe(false);
    });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run lib/index`
Expected: FAIL — `Failed to resolve import "./paths"` and `"./discover"`.

- [ ] **Step 4: Implement** — `lib/index/paths.ts`:
```ts
/** Windows backslashes → forward slashes, so every path compares equal everywhere. */
export function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, "/");
}

/** The folder part of a repo-relative path ("" for a file at the repo root). */
export function dirOf(relPath: string): string {
    const slash = relPath.lastIndexOf("/");
    return slash === -1 ? "" : relPath.slice(0, slash);
}

/**
 * Joins a repo-relative directory with a relative path, collapsing "." and "..".
 * Returns null when the result would climb above the repo root: such an import
 * points outside the indexed tree, so it can never become an edge.
 */
export function joinRepoPath(baseDir: string, relative: string): string | null {
    const segments = baseDir === "" ? [] : baseDir.split("/");

    for (const part of normalizeSlashes(relative).split("/")){
        if (part === "" || part === ".") continue;

        if (part === ".."){
            if (segments.length === 0) return null;
            segments.pop();
        } else{
            segments.push(part);
        }
    }

    return segments.join("/");
}
```

`lib/index/discover.ts`:
```ts
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { normalizeSlashes } from "./paths";

export type DiscoveredFile = { path: string; sizeBytes: number };
export type SkippedFile = { path: string; reason: string };
export type DiscoveryResult = { files: DiscoveredFile[]; skipped: SkippedFile[]; usedGit: boolean };

/** Bigger than this is almost always generated or minified code, not something to read. */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

/** Folders never worth walking when there is no .gitignore to consult. */
const WALK_IGNORE = new Set(["node_modules", ".git", ".next", ".nebulosity"]);

/**
 * Lists a repository's source files as sorted, repo-relative, forward-slash paths.
 *
 * In a git repo this asks git (`ls-files`), which honours .gitignore for free. That's
 * what keeps build output and vendored code out of a big repo's index. Without git,
 * it walks the tree and skips the usual heavy folders.
 */
export function discoverFiles(
    repoRoot: string,
    opts: { extensions: readonly string[]; maxBytes?: number }
): DiscoveryResult {
    const usedGit = fs.existsSync(path.join(repoRoot, ".git"));
    const skipped: SkippedFile[] = [];
    const candidates = usedGit ? listWithGit(repoRoot) : listByWalking(repoRoot, skipped);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    const files: DiscoveredFile[] = [];

    for (const rel of candidates){
        const base = rel.slice(rel.lastIndexOf("/") + 1);

        if (base.startsWith(".env")) continue; // never index secrets, whatever the extension
        if (!opts.extensions.some((ext) => rel.endsWith(ext))) continue;

        let size: number;
        try{
            size = fs.statSync(path.join(repoRoot, rel)).size;
        } catch (err){
            // e.g. deleted from the working tree but still tracked by git
            skipped.push({ path: rel, reason: `unreadable: ${err instanceof Error ? err.message : String(err)}` });
            continue;
        }

        if (size > maxBytes){
            skipped.push({ path: rel, reason: `too large (${size} bytes)` });
            continue;
        }

        files.push({ path: rel, sizeBytes: size });
    }

    // plain code-unit order: deterministic on every OS and locale
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files, skipped, usedGit };
}

function listWithGit(repoRoot: string): string[] {
    // --cached: tracked files. --others --exclude-standard: new files .gitignore doesn't exclude.
    // -z: NUL-separated, so names with spaces or non-ASCII characters arrive unquoted.
    const out = execFileSync(
        "git",
        ["-C", repoRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { maxBuffer: 512 * 1024 * 1024 }
    );

    return out.toString("utf8").split("\0").filter(Boolean).map(normalizeSlashes);
}

function listByWalking(repoRoot: string, skipped: SkippedFile[]): string[] {
    const out: string[] = [];

    const walk = (dirRel: string): void => {
        let entries: fs.Dirent[];

        try{
            entries = fs.readdirSync(path.join(repoRoot, dirRel), { withFileTypes: true });
        } catch (err){
            skipped.push({ path: dirRel || ".", reason: `unreadable directory: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }

        for (const entry of entries){
            if (WALK_IGNORE.has(entry.name)) continue;

            // built with "/" by hand: path.join would put backslashes in on Windows
            const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;

            // Dirent reports symlinks as neither file nor directory, so links are
            // skipped rather than followed (no symlink cycles)
            if (entry.isDirectory()) walk(rel);
            else if (entry.isFile()) out.push(rel);
        }
    };

    walk("");
    return out;
}

/** Test code is indexed, but later stages treat it differently (e.g. no LLM summary). */
export function isTestPath(relPath: string): boolean {
    return /(^|\/)(test|tests|__tests__)\//.test(relPath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);
}

/** The commit the working tree is on, or null outside git or before the first commit. */
export function readGitHead(repoRoot: string): string | null {
    if (!fs.existsSync(path.join(repoRoot, ".git"))) return null;

    try{
        const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
        return head || null;
    } catch{
        return null;
    }
}
```

- [ ] **Step 5: Run them to make sure they pass**

Run: `npx vitest run lib/index`
Expected: PASS (4 path tests + 6 discovery tests).

- [ ] **Step 6: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 85 tests.

- [ ] **Step 7: Commit**
```bash
git add lib/index/paths.ts lib/index/paths.test.ts lib/index/discover.ts lib/index/discover.test.ts
git commit -m "feat: discover source files via git ls-files with a walking fallback"
```

---

### Task 6: TypeScript language adapter (one parse → chunks, symbols, imports)

**Files:**
- Modify: `lib/chunks.ts` (export the parse step; chunk from an existing AST)
- Create: `lib/index/languages/typescript.ts`, `lib/index/languages/typescript.test.ts`

**Interfaces:**
- Consumes: `SymbolKind` from `lib/db/schema.ts` (Task 3); `CodeChunk` from `lib/contracts.ts`.
- Produces:
  - `TYPESCRIPT_EXTENSIONS: readonly string[]`
  - `type ParsedSymbol = { name: string; qualifiedName: string; kind: SymbolKind; startLine: number; endLine: number; exported: boolean; parentQualifiedName: string | null }`
  - `type ParsedFile = { chunks: CodeChunk[]; symbols: ParsedSymbol[]; imports: string[]; lineCount: number }`
  - `parseTypeScriptFile(filePath: string, text: string): ParsedFile`
  - `countLines(text: string): number`
  - `parseSourceFile(filePath: string, text: string): ts.SourceFile` and `extractChunksFromSourceFile(filePath: string, sourceFile: ts.SourceFile): CodeChunk[]`, both exported from `lib/chunks.ts`

- [ ] **Step 1: Write the failing test** — `lib/index/languages/typescript.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { countLines, parseTypeScriptFile } from "./typescript";

const LOG_TS = [
    "/** Writes a message. */",
    "export function log(message: string): void { console.log(message); }",
    "",
    "export class Logger {",
    "    info(message: string): void { log(message); }",
    "    private warn(message: string): void { log(\"warn: \" + message); }",
    "}",
    "",
    "export const banner = \"import fake from './not-real'\";",
    "",
].join("\n");

describe("parseTypeScriptFile — symbols", () => {
    it("lists top-level declarations and class members with exact lines", () => {
        expect(parseTypeScriptFile("src/core/log.ts", LOG_TS).symbols).toEqual([
            { name: "log", qualifiedName: "log", kind: "function", startLine: 2, endLine: 2, exported: true, parentQualifiedName: null },
            { name: "Logger", qualifiedName: "Logger", kind: "class", startLine: 4, endLine: 7, exported: true, parentQualifiedName: null },
            { name: "info", qualifiedName: "Logger.info", kind: "method", startLine: 5, endLine: 5, exported: true, parentQualifiedName: "Logger" },
            { name: "warn", qualifiedName: "Logger.warn", kind: "method", startLine: 6, endLine: 6, exported: false, parentQualifiedName: "Logger" },
            { name: "banner", qualifiedName: "banner", kind: "const", startLine: 9, endLine: 9, exported: true, parentQualifiedName: null },
        ]);
    });

    it("treats an arrow function held in a const as a function", () => {
        const symbols = parseTypeScriptFile("s.ts", "export const shout = (s: string): string => s.toUpperCase();\n").symbols;
        expect(symbols).toEqual([
            { name: "shout", qualifiedName: "shout", kind: "function", startLine: 1, endLine: 1, exported: true, parentQualifiedName: null },
        ]);
    });

    it("parses .tsx (JSX) files", () => {
        const viewTsx = [
            "import { useState } from \"react\";",
            "import { main } from \"./main\";",
            "",
            "export function render(): void {",
            "    void useState;",
            "    void main;",
            "}",
            "",
            "export function View() {",
            "    return <div>view</div>;",
            "}",
            "",
        ].join("\n");
        const parsed = parseTypeScriptFile("src/app/view.tsx", viewTsx);
        expect(parsed.imports).toEqual(["react", "./main"]);
        expect(parsed.symbols.map((s) => [s.qualifiedName, s.startLine, s.endLine])).toEqual([["render", 4, 7], ["View", 9, 11]]);
    });
});

describe("parseTypeScriptFile — imports", () => {
    it("finds every import form, in source order, and ignores import-looking strings", () => {
        const source = [
            "import a from \"./a\";",
            "import type { B } from \"../b\";",
            "import \"./side-effect\";",
            "export { c } from \"./c\";",
            "export * from \"./d\";",
            "import e = require(\"./e\");",
            "const f = require(\"./f\");",
            "async function g() { await import(\"./g\"); }",
            "const notAnImport = \"import x from './h'\";",
            "",
        ].join("\n");
        expect(parseTypeScriptFile("src/x.ts", source).imports).toEqual(["./a", "../b", "./side-effect", "./c", "./d", "./e", "./f", "./g"]);
    });

    it("finds require and dynamic import in plain JavaScript", () => {
        const buildJs = "const { start } = require(\"../src/index\");\n\nimport(\"../src/app/main\").then(() => start());\n";
        expect(parseTypeScriptFile("scripts/build.js", buildJs).imports).toEqual(["../src/index", "../src/app/main"]);
    });

    it("reports each specifier once even when imported twice", () => {
        expect(parseTypeScriptFile("x.ts", "import { a } from \"./a\";\nimport { b } from \"./a\";\n").imports).toEqual(["./a"]);
    });

    it("still finds imports in a file that starts with a UTF-8 BOM", () => {
        expect(parseTypeScriptFile("bom.ts", "\uFEFFimport { a } from \"./a\";\n").imports).toEqual(["./a"]);
    });
});

describe("parseTypeScriptFile — chunks and lines", () => {
    it("still produces the chunker's chunks (one parse serves both)", () => {
        expect(parseTypeScriptFile("src/core/log.ts", LOG_TS).chunks.map((c) => c.name)).toEqual(["log", "Logger", "banner", "(file)"]);
    });

    it("counts lines the way an editor shows them", () => {
        expect(countLines(LOG_TS)).toBe(9);
        expect(countLines("a\nb")).toBe(2);
        expect(countLines("")).toBe(0);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/index/languages`
Expected: FAIL — `Failed to resolve import "./typescript"`.

- [ ] **Step 3: Let the chunker accept an existing AST** — in `lib/chunks.ts`, replace the `parseFile` function and `extractChunksFromFile`'s first two lines:

Replace:
```ts
// parse the file into a TypeScript AST
function parseFile(filePath: string, fileText: string): ts.SourceFile {
    return ts.createSourceFile(
        filePath,
        fileText,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
    );
}

export function extractChunksFromFile(filePath: string, fileText: string): CodeChunk[] {
    const sourceFileAST = parseFile(filePath, fileText);
    const fileHash = crypto.createHash("sha256").update(fileText).digest("hex");
    const chunks: CodeChunk[] = [];
```
with:
```ts
// parse the file into a TypeScript AST (script kind — TS, TSX, JS, JSX — comes from the extension)
export function parseSourceFile(filePath: string, fileText: string): ts.SourceFile {
    return ts.createSourceFile(
        filePath,
        fileText,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
    );
}

export function extractChunksFromFile(filePath: string, fileText: string): CodeChunk[] {
    return extractChunksFromSourceFile(filePath, parseSourceFile(filePath, fileText));
}

/**
 * The same as extractChunksFromFile, for a caller that has already parsed the file.
 * The indexer parses each file exactly once and derives chunks, symbols and imports
 * from that single AST, because parsing is the expensive part (PIVOT_SPEC.md §1).
 */
export function extractChunksFromSourceFile(filePath: string, sourceFileAST: ts.SourceFile): CodeChunk[] {
    const fileHash = crypto.createHash("sha256").update(sourceFileAST.text).digest("hex");
    const chunks: CodeChunk[] = [];
```
(The rest of the function body stays exactly as it is.)

- [ ] **Step 4: Implement the adapter** — `lib/index/languages/typescript.ts`:
```ts
import ts from "typescript";
import { extractChunksFromSourceFile, parseSourceFile } from "../../chunks";
import type { CodeChunk } from "../../contracts";
import type { SymbolKind } from "../../db/schema";

/** Every extension this adapter claims (TypeScript parses JavaScript too). */
export const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export type ParsedSymbol = {
    name: string;
    qualifiedName: string;
    kind: SymbolKind;
    startLine: number;
    endLine: number;
    exported: boolean;
    parentQualifiedName: string | null;
};

export type ParsedFile = {
    chunks: CodeChunk[];
    symbols: ParsedSymbol[];
    /** Raw specifiers in source order, each once: "./a", "@core/log", "react". */
    imports: string[];
    lineCount: number;
};

/** One parse, three products. This is the adapter seam tree-sitter adapters plug into later (E4). */
export function parseTypeScriptFile(filePath: string, text: string): ParsedFile {
    const sourceFile = parseSourceFile(filePath, text);

    return {
        chunks: extractChunksFromSourceFile(filePath, sourceFile),
        symbols: collectSymbols(sourceFile),
        imports: collectImports(sourceFile),
        lineCount: countLines(text),
    };
}

/** Lines as an editor numbers them: a trailing newline does not start an extra line. */
export function countLines(text: string): number {
    if (text === "") return 0;
    const parts = text.split("\n").length;
    return text.endsWith("\n") ? parts - 1 : parts;
}

/**
 * Every module this file depends on, read from the AST, so an import-looking string
 * like "import x from './y'" is (correctly) just a string. That was the regex
 * extractor's known false-positive class (ADR-016), which this retires (ADR-026).
 */
function collectImports(sourceFile: ts.SourceFile): string[] {
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)){
            found.push(node.moduleSpecifier.text);                      // import … from "x" · export … from "x" · import "x"
        } else if (ts.isImportEqualsDeclaration(node)
            && ts.isExternalModuleReference(node.moduleReference)
            && ts.isStringLiteral(node.moduleReference.expression)){
            found.push(node.moduleReference.expression.text);           // import x = require("x")
        } else if (ts.isCallExpression(node) && node.arguments.length === 1){
            // bind first: TypeScript does not reliably narrow a re-read of node.arguments[0]
            const arg = node.arguments[0];
            const callee = node.expression;
            const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(callee) && callee.text === "require";

            if ((isDynamicImport || isRequire) && ts.isStringLiteralLike(arg)){
                found.push(arg.text);                                    // import("x") · require("x")
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return [...new Set(found)];
}

function collectSymbols(sourceFile: ts.SourceFile): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

    const add = (node: ts.Node, name: string, kind: SymbolKind, exported: boolean, parent: string | null): void => {
        symbols.push({
            name,
            qualifiedName: parent ? `${parent}.${name}` : name,
            kind,
            // getStart skips leading trivia, so the doc comment is excluded: the range
            // is for jumping to the declaration (chunks keep the comment, ADR-018)
            startLine: lineOf(node.getStart(sourceFile)),
            endLine: lineOf(node.getEnd()),
            exported,
            parentQualifiedName: parent,
        });
    };

    for (const statement of sourceFile.statements){
        const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);

        if (ts.isFunctionDeclaration(statement) && statement.name){
            add(statement, statement.name.text, "function", exported, null);
        } else if (ts.isClassDeclaration(statement) && statement.name){
            const className = statement.name.text;
            add(statement, className, "class", exported, null);

            for (const member of statement.members){
                const memberName = simpleName(member.name);
                const isPrivate = hasModifier(member, ts.SyntaxKind.PrivateKeyword) || (!!member.name && ts.isPrivateIdentifier(member.name));
                const memberExported = exported && !isPrivate;

                if (ts.isConstructorDeclaration(member)) add(member, "constructor", "constructor", memberExported, className);
                else if (memberName === null) continue;   // computed names like [Symbol.iterator]
                else if (ts.isMethodDeclaration(member)) add(member, memberName, "method", memberExported, className);
                else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) add(member, memberName, "accessor", memberExported, className);
                else if (ts.isPropertyDeclaration(member)) add(member, memberName, "property", memberExported, className);
            }
        } else if (ts.isInterfaceDeclaration(statement)){
            add(statement, statement.name.text, "interface", exported, null);
        } else if (ts.isTypeAliasDeclaration(statement)){
            add(statement, statement.name.text, "type", exported, null);
        } else if (ts.isEnumDeclaration(statement)){
            add(statement, statement.name.text, "enum", exported, null);
        } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)){
            add(statement, statement.name.text, "namespace", exported, null);
        } else if (ts.isVariableStatement(statement)){
            for (const declaration of statement.declarationList.declarations){
                if (!ts.isIdentifier(declaration.name)) continue;   // destructuring patterns have no single name

                const init = declaration.initializer;
                const isFunction = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
                add(declaration, declaration.name.text, isFunction ? "function" : "const", exported, null);
            }
        }
    }

    return symbols;
}

function simpleName(name: ts.PropertyName | undefined): string | null {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((m) => m.kind === kind);
}
```

- [ ] **Step 5: Run it to make sure it passes**

Run: `npx vitest run lib/index/languages lib/chunks.test.ts`
Expected: PASS (9 adapter tests; every existing chunker test still green).

- [ ] **Step 6: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 94 tests.

- [ ] **Step 7: Commit**
```bash
git add lib/chunks.ts lib/index/languages/typescript.ts lib/index/languages/typescript.test.ts
git commit -m "feat: TypeScript adapter, one parse for chunks, symbols and AST imports (ADR-026)"
```

---

### Task 7: Import resolver

**Files:**
- Create: `lib/index/resolve.ts`, `lib/index/resolve.test.ts`

**Interfaces:**
- Consumes: `normalizeSlashes`, `dirOf`, `joinRepoPath` (Task 5).
- Produces: `type Resolver = (importer: string, specifier: string) => string | null` and `createResolver(repoRoot: string, fileSet: ReadonlySet<string>): Resolver`.

- [ ] **Step 1: Write the failing test** — `lib/index/resolve.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createResolver } from "./resolve";

const FIXTURE = path.resolve("test/fixtures/mini-repo");
const FIXTURE_FILES = new Set([
    "scripts/build.js", "src/app/main.ts", "src/app/view.tsx", "src/core/index.ts",
    "src/core/log.ts", "src/index.ts", "src/util/strings.test.ts", "src/util/strings.ts",
]);

function makeRepo(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neb-resolve-"));
    for (const [rel, content] of Object.entries(files)){
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
}

describe("createResolver — the fixture's edges", () => {
    const resolve = createResolver(FIXTURE, FIXTURE_FILES);

    it("resolves relative imports by trying extensions", () => {
        expect(resolve("src/index.ts", "./app/main")).toBe("src/app/main.ts");
        expect(resolve("scripts/build.js", "../src/index")).toBe("src/index.ts");
    });

    it("resolves tsconfig paths aliases (read as JSONC, like TypeScript)", () => {
        expect(resolve("src/index.ts", "@core/log")).toBe("src/core/log.ts");
    });

    it("maps NodeNext .js specifiers onto .ts files", () => {
        expect(resolve("src/app/main.ts", "../util/strings.js")).toBe("src/util/strings.ts");
    });

    it("resolves a directory import to its index file", () => {
        expect(resolve("src/util/strings.ts", "../core")).toBe("src/core/index.ts");
    });

    it("returns null for packages, for paths that leave the repo, and for self-imports", () => {
        expect(resolve("src/app/view.tsx", "react")).toBeNull();
        expect(resolve("src/index.ts", "../../outside")).toBeNull();
        expect(resolve("src/core/index.ts", "./index")).toBeNull();
    });
});

describe("createResolver — tsconfig edge cases", () => {
    it("follows a relative `extends` to inherit paths", () => {
        const dir = makeRepo({
            "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "~/*": ["lib/*"] } } }),
            "packages/app/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json" }),
            "lib/x.ts": "export {};\n",
            "packages/app/main.ts": "export {};\n",
        });
        const resolve = createResolver(dir, new Set(["lib/x.ts", "packages/app/main.ts"]));
        expect(resolve("packages/app/main.ts", "~/x")).toBe("lib/x.ts");
    });

    it("survives a malformed tsconfig: aliases stay unresolved, relative imports still work", () => {
        const dir = makeRepo({ "tsconfig.json": "{ not json", "a.ts": "export {};\n", "b.ts": "export {};\n" });
        const resolve = createResolver(dir, new Set(["a.ts", "b.ts"]));
        expect(resolve("a.ts", "./b")).toBe("b.ts");
        expect(resolve("a.ts", "@x/y")).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/index/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`.

- [ ] **Step 3: Implement** — `lib/index/resolve.ts`:
```ts
import fs from "fs";
import path from "path";
import ts from "typescript";
import { dirOf, joinRepoPath, normalizeSlashes } from "./paths";

/** Tried, in order, after a specifier that names no file directly. */
const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** NodeNext style: the source imports "./x.js" but the file on disk is x.ts. */
const JS_TO_TS: Record<string, string[]> = {
    ".js": [".ts", ".tsx", ".d.ts"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
};

type PathPattern = { prefix: string; suffix: string; exact: boolean; targets: string[] };

/** What one tsconfig contributes to resolution. All paths are repo-relative. */
type PathsConfig = { baseDir: string | null; patterns: PathPattern[] };

/** importer + specifier → the repo file it points at, or null (a package, outside the repo, or missing). */
export type Resolver = (importer: string, specifier: string) => string | null;

export function createResolver(repoRoot: string, fileSet: ReadonlySet<string>): Resolver {
    // nearest-tsconfig lookups are cached per directory: VS Code has ~15k files but few tsconfigs
    const configByDir = new Map<string, PathsConfig | null>();

    const nearestConfig = (dir: string): PathsConfig | null => {
        const cached = configByDir.get(dir);
        if (cached !== undefined) return cached;

        const configFile = dir === "" ? "tsconfig.json" : `${dir}/tsconfig.json`;
        const config = fs.existsSync(path.join(repoRoot, configFile))
            ? loadPathsConfig(repoRoot, configFile, new Set())
            : dir === "" ? null : nearestConfig(dirOf(dir));

        configByDir.set(dir, config);
        return config;
    };

    const findFile = (base: string): string | null => {
        if (fileSet.has(base)) return base;

        for (const [js, tsExtensions] of Object.entries(JS_TO_TS)){
            if (!base.endsWith(js)) continue;
            const stem = base.slice(0, -js.length);
            for (const ext of tsExtensions) if (fileSet.has(stem + ext)) return stem + ext;
        }

        for (const ext of EXTENSIONS) if (fileSet.has(base + ext)) return base + ext;

        const indexPrefix = base === "" ? "index" : `${base}/index`;
        for (const ext of EXTENSIONS) if (fileSet.has(indexPrefix + ext)) return indexPrefix + ext;

        return null;
    };

    return (importer, rawSpecifier) => {
        const specifier = normalizeSlashes(rawSpecifier);
        const isRelative = specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
        const candidates: string[] = [];

        if (isRelative){
            const joined = joinRepoPath(dirOf(importer), specifier);
            if (joined !== null) candidates.push(joined);
        } else{
            const config = nearestConfig(dirOf(importer));
            if (config) candidates.push(...aliasCandidates(config, specifier));
        }

        for (const base of candidates){
            const hit = findFile(base);
            if (hit !== null && hit !== importer) return hit;   // a file importing itself is no edge
        }

        return null;
    };
}

type RawTsconfig = { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };

/**
 * Reads a tsconfig with TypeScript's own reader, which accepts comments and trailing
 * commas (ADR-016's JSONC gap). It follows a relative `extends` chain because
 * monorepo packages usually inherit `paths` from a shared base config.
 */
function loadPathsConfig(repoRoot: string, configRel: string, seen: Set<string>): PathsConfig | null {
    if (seen.has(configRel)) return null;   // extends cycle
    seen.add(configRel);

    const { config, error } = ts.readConfigFile(path.join(repoRoot, configRel), ts.sys.readFile);
    if (error || !config) return null;

    const raw = config as RawTsconfig;
    const configDir = dirOf(configRel);
    const options = raw.compilerOptions ?? {};

    let inherited: PathsConfig | null = null;
    if (typeof raw.extends === "string" && raw.extends.startsWith(".")){
        let parentRel = joinRepoPath(configDir, raw.extends);
        if (parentRel !== null){
            if (!parentRel.endsWith(".json")) parentRel += ".json";
            inherited = loadPathsConfig(repoRoot, parentRel, seen);
        }
    }

    // baseUrl resolves against the config that declares it; a child without one inherits the parent's
    const ownBaseDir = typeof options.baseUrl === "string" ? joinRepoPath(configDir, options.baseUrl) : null;
    const baseDir = ownBaseDir ?? inherited?.baseDir ?? null;

    // `paths` replaces the parent's wholesale (tsconfig merges compilerOptions shallowly).
    // Its targets resolve against baseUrl when there is one, else against this config's folder.
    const patterns = options.paths && typeof options.paths === "object"
        ? parsePatterns(options.paths as Record<string, unknown>, baseDir ?? configDir)
        : inherited?.patterns ?? [];

    if (baseDir === null && patterns.length === 0) return null;
    return { baseDir, patterns };
}

function parsePatterns(paths: Record<string, unknown>, targetBase: string): PathPattern[] {
    const patterns: PathPattern[] = [];

    for (const [pattern, targets] of Object.entries(paths)){
        if (!Array.isArray(targets)) continue;

        const resolvedTargets = targets
            .filter((t): t is string => typeof t === "string")
            .map((t) => joinRepoPath(targetBase, t))   // a "*" survives as part of its segment
            .filter((t): t is string => t !== null);

        const star = pattern.indexOf("*");
        patterns.push(star === -1
            ? { prefix: pattern, suffix: "", exact: true, targets: resolvedTargets }
            : { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), exact: false, targets: resolvedTargets });
    }

    return patterns;
}

function aliasCandidates(config: PathsConfig, specifier: string): string[] {
    const candidates: string[] = [];

    for (const p of config.patterns){
        if (p.exact){
            if (specifier === p.prefix) candidates.push(...p.targets);
            continue;
        }

        const fits = specifier.startsWith(p.prefix)
            && specifier.endsWith(p.suffix)
            && specifier.length >= p.prefix.length + p.suffix.length;

        if (fits){
            const middle = specifier.slice(p.prefix.length, specifier.length - p.suffix.length);
            candidates.push(...p.targets.map((t) => t.replace("*", middle)));
        }
    }

    // baseUrl also lets bare specifiers resolve from it (older VS Code: "vs/base/common/uri")
    if (config.baseDir !== null){
        const fromBase = joinRepoPath(config.baseDir, specifier);
        if (fromBase !== null) candidates.push(fromBase);
    }

    return candidates;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run lib/index/resolve.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 101 tests.

- [ ] **Step 6: Commit**
```bash
git add lib/index/resolve.ts lib/index/resolve.test.ts
git commit -m "feat: resolve imports via relative paths, tsconfig paths/baseUrl/extends and NodeNext"
```

---

### Task 8: Folder tree and level edges

**Files:**
- Create: `lib/index/aggregate.ts`, `lib/index/aggregate.test.ts`

**Interfaces:**
- Consumes: `dirOf` (Task 5).
- Produces:
  - `type FolderRow = { path: string; parentPath: string | null; depth: number; name: string; fileCount: number; directFileCount: number }`
  - `type LevelEdgeRow = { levelPath: string; sourceNode: string; targetNode: string; count: number }`
  - `buildFolders(filePaths: readonly string[], rootName: string): FolderRow[]`
  - `buildLevelEdges(edges: readonly { source: string; target: string }[]): LevelEdgeRow[]`
  - `lcaFolder(a: string, b: string): string`
  - `childToward(level: string, filePath: string): string`

- [ ] **Step 1: Write the failing test** — `lib/index/aggregate.test.ts` (every expectation is copied from "Fixture ground truth"):
```ts
import { describe, expect, it } from "vitest";
import { buildFolders, buildLevelEdges, childToward, lcaFolder } from "./aggregate";

const FILES = [
    "scripts/build.js", "src/app/main.ts", "src/app/view.tsx", "src/core/index.ts",
    "src/core/log.ts", "src/index.ts", "src/util/strings.test.ts", "src/util/strings.ts",
];

const EDGES = [
    { source: "scripts/build.js", target: "src/index.ts" },
    { source: "scripts/build.js", target: "src/app/main.ts" },
    { source: "src/app/main.ts", target: "src/core/log.ts" },
    { source: "src/app/main.ts", target: "src/app/view.tsx" },
    { source: "src/app/main.ts", target: "src/util/strings.ts" },
    { source: "src/app/view.tsx", target: "src/app/main.ts" },
    { source: "src/core/index.ts", target: "src/core/log.ts" },
    { source: "src/index.ts", target: "src/app/main.ts" },
    { source: "src/index.ts", target: "src/core/log.ts" },
    { source: "src/util/strings.test.ts", target: "src/util/strings.ts" },
    { source: "src/util/strings.ts", target: "src/core/index.ts" },
];

describe("lcaFolder", () => {
    it("finds the deepest common folder, comparing whole segments", () => {
        expect(lcaFolder("src/app", "src/core")).toBe("src");
        expect(lcaFolder("scripts", "src")).toBe("");
        expect(lcaFolder("src", "src2")).toBe("");
        expect(lcaFolder("src/app", "src/app")).toBe("src/app");
        expect(lcaFolder("", "src")).toBe("");
    });
});

describe("childToward", () => {
    it("is the file itself when it sits directly in the level, else the child folder that contains it", () => {
        expect(childToward("src", "src/index.ts")).toBe("src/index.ts");
        expect(childToward("", "src/app/main.ts")).toBe("src");
        expect(childToward("src", "src/app/main.ts")).toBe("src/app");
        expect(childToward("", "index.ts")).toBe("index.ts");
    });
});

describe("buildFolders", () => {
    it("builds the fixture's 6 folders with recursive and direct counts", () => {
        expect(buildFolders(FILES, "mini-repo")).toEqual([
            { path: "", parentPath: null, depth: 0, name: "mini-repo", fileCount: 8, directFileCount: 0 },
            { path: "scripts", parentPath: "", depth: 1, name: "scripts", fileCount: 1, directFileCount: 1 },
            { path: "src", parentPath: "", depth: 1, name: "src", fileCount: 7, directFileCount: 1 },
            { path: "src/app", parentPath: "src", depth: 2, name: "app", fileCount: 2, directFileCount: 2 },
            { path: "src/core", parentPath: "src", depth: 2, name: "core", fileCount: 2, directFileCount: 2 },
            { path: "src/util", parentPath: "src", depth: 2, name: "util", fileCount: 2, directFileCount: 2 },
        ]);
    });

    it("always has a root, even with no files", () => {
        expect(buildFolders([], "empty")).toEqual([
            { path: "", parentPath: null, depth: 0, name: "empty", fileCount: 0, directFileCount: 0 },
        ]);
    });
});

describe("buildLevelEdges", () => {
    it("counts each of the fixture's 11 imports exactly once, at its LCA level", () => {
        expect(buildLevelEdges(EDGES)).toEqual([
            { levelPath: "", sourceNode: "scripts", targetNode: "src", count: 2 },
            { levelPath: "src", sourceNode: "src/app", targetNode: "src/core", count: 1 },
            { levelPath: "src", sourceNode: "src/app", targetNode: "src/util", count: 1 },
            { levelPath: "src", sourceNode: "src/index.ts", targetNode: "src/app", count: 1 },
            { levelPath: "src", sourceNode: "src/index.ts", targetNode: "src/core", count: 1 },
            { levelPath: "src", sourceNode: "src/util", targetNode: "src/core", count: 1 },
            { levelPath: "src/app", sourceNode: "src/app/main.ts", targetNode: "src/app/view.tsx", count: 1 },
            { levelPath: "src/app", sourceNode: "src/app/view.tsx", targetNode: "src/app/main.ts", count: 1 },
            { levelPath: "src/core", sourceNode: "src/core/index.ts", targetNode: "src/core/log.ts", count: 1 },
            { levelPath: "src/util", sourceNode: "src/util/strings.test.ts", targetNode: "src/util/strings.ts", count: 1 },
        ]);
    });

    it("never loses or double-counts an import (the counts sum to the edge count)", () => {
        expect(buildLevelEdges(EDGES).reduce((sum, row) => sum + row.count, 0)).toBe(EDGES.length);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/index/aggregate.test.ts`
Expected: FAIL — `Failed to resolve import "./aggregate"`.

- [ ] **Step 3: Implement** — `lib/index/aggregate.ts`:
```ts
import { dirOf } from "./paths";

export type FolderRow = {
    path: string;
    parentPath: string | null;
    depth: number;
    name: string;
    fileCount: number;
    directFileCount: number;
};

export type LevelEdgeRow = { levelPath: string; sourceNode: string; targetNode: string; count: number };

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const depthOf = (folder: string): number => (folder === "" ? 0 : folder.split("/").length);

/** Every folder that contains a source file (plus all its ancestors), with file counts. */
export function buildFolders(filePaths: readonly string[], rootName: string): FolderRow[] {
    const rows = new Map<string, FolderRow>();

    const ensure = (folder: string): FolderRow => {
        let row = rows.get(folder);

        if (!row){
            row = {
                path: folder,
                parentPath: folder === "" ? null : dirOf(folder),
                depth: depthOf(folder),
                name: folder === "" ? rootName : folder.slice(folder.lastIndexOf("/") + 1),
                fileCount: 0,
                directFileCount: 0,
            };
            rows.set(folder, row);

            if (folder !== "") ensure(dirOf(folder));
        }

        return row;
    };

    ensure("");

    for (const file of filePaths){
        const dir = dirOf(file);
        ensure(dir).directFileCount++;

        // every folder from the file's own up to the root counts it once
        for (let folder: string | null = dir; folder !== null; folder = folder === "" ? null : dirOf(folder)){
            ensure(folder).fileCount++;
        }
    }

    return [...rows.values()].sort((a, b) => compare(a.path, b.path));
}

/** The deepest folder containing both folders, compared segment by segment ("src" is not inside "src2"). */
export function lcaFolder(a: string, b: string): string {
    if (a === "" || b === "") return "";

    const as = a.split("/");
    const bs = b.split("/");
    let shared = 0;

    while (shared < as.length && shared < bs.length && as[shared] === bs[shared]) shared++;

    return as.slice(0, shared).join("/");
}

/** How filePath appears when viewing folder `level`: the file itself if it's directly inside, else the child folder that contains it. */
export function childToward(level: string, filePath: string): string {
    const dir = dirOf(filePath);
    if (dir === level) return filePath;
    return dir.split("/").slice(0, depthOf(level) + 1).join("/");
}

/**
 * The Map's lines (PIVOT_SPEC.md §4.2). Each import is counted exactly once, at the
 * level where it crosses between siblings, so opening any folder needs one indexed
 * lookup and no computation. VS Code's 20,648 workbench → base imports become one row.
 */
export function buildLevelEdges(edges: readonly { source: string; target: string }[]): LevelEdgeRow[] {
    const rows = new Map<string, LevelEdgeRow>();

    for (const { source, target } of edges){
        const levelPath = lcaFolder(dirOf(source), dirOf(target));
        const sourceNode = childToward(levelPath, source);
        const targetNode = childToward(levelPath, target);
        const key = `${levelPath}\0${sourceNode}\0${targetNode}`;

        const row = rows.get(key);
        if (row) row.count++;
        else rows.set(key, { levelPath, sourceNode, targetNode, count: 1 });
    }

    return [...rows.values()].sort((a, b) =>
        compare(a.levelPath, b.levelPath) || compare(a.sourceNode, b.sourceNode) || compare(a.targetNode, b.targetNode));
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run lib/index/aggregate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 107 tests.

- [ ] **Step 6: Commit**
```bash
git add lib/index/aggregate.ts lib/index/aggregate.test.ts
git commit -m "feat: build the folder tree and LCA-aggregated level edges"
```

---

### Task 9: Shared index lock and the structure store

**Files:**
- Create: `lib/db/store/lock.ts`, `lib/db/store/lock.test.ts`, `lib/db/store/structure.ts`, `lib/db/store/structure.test.ts`
- Modify: `lib/index-repo.ts` (use the shared lock; re-export `IndexLockedError` so `app/api/index/route.ts` is untouched)

**Interfaces:**
- Consumes: the tables (Task 3), `forEachBatch` and `columnCount` (Task 4), `CodeChunk` (contracts), `SymbolKind` (schema).
- Produces:
  - from `lock.ts`: `IndexLockedError`, `acquireIndexLock(db)`, `releaseIndexLock(db)`, `LOCK_STALE_AFTER_MS`
  - from `structure.ts`: `type FileRecord`, `type StoredFile`
  - `upsertRepository(db, rootPath: string): number`
  - `loadStoredFiles(db, repoId): Map<string, StoredFile>`
  - `writeFileRecords(db, repoId, records): { path: string; error: string }[]`
  - `deleteFilesNotIn(db, repoId, keep: ReadonlySet<string>): string[]`
  - `replaceImports(db, repoId, edges): number`
  - `replaceAggregates(db, repoId, folders, levelEdges): void`
  - `markIndexed(db, repoId, indexedHead: string | null): void`

- [ ] **Step 1: Write the failing lock test** — `lib/db/store/lock.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { META_KEYS, meta } from "../schema";
import { IndexLockedError, LOCK_STALE_AFTER_MS, acquireIndexLock, releaseIndexLock } from "./lock";

afterEach(() => releaseIndexLock(getDb()));

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
        expect(db.select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get()?.value).not.toBe(ancient);
    });
});
```

- [ ] **Step 2: Write the failing store test** — `lib/db/store/structure.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { chunks, folders, imports, levelEdges, symbols } from "../schema";
import {
    deleteFilesNotIn, loadStoredFiles, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileRecord,
} from "./structure";

const record = (p: string, overrides: Partial<FileRecord> = {}): FileRecord => ({
    path: p, kind: "module", contentHash: `hash-${p}`, language: "typescript", sizeBytes: 10, lineCount: 1, isTest: false,
    importSpecifiers: [],
    chunks: [{ id: `${p}#a#0`, filePath: p, kind: "function", name: "a", startLine: 1, endLine: 1, exported: true, partIndex: 0, text: "function a() {}", fileHash: `hash-${p}` }],
    symbols: [{ name: "a", qualifiedName: "a", kind: "function", startLine: 1, endLine: 1, exported: true, parentQualifiedName: null }],
    ...overrides,
});

describe("structure store", () => {
    it("upsertRepository returns the same id for the same root", () => {
        const db = getDb();
        expect(upsertRepository(db, "/store/a")).toBe(upsertRepository(db, "/store/a"));
    });

    it("writes file rows with chunks and symbols, and a rewrite replaces rather than duplicates", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/b");
        expect(writeFileRecords(db, repoId, [record("x.ts"), record("y.ts", { importSpecifiers: ["./x"] })])).toEqual([]);
        expect(writeFileRecords(db, repoId, [record("x.ts", { contentHash: "new" })])).toEqual([]);

        const stored = loadStoredFiles(db, repoId);
        expect([...stored.keys()].sort()).toEqual(["x.ts", "y.ts"]);
        expect(stored.get("x.ts")?.contentHash).toBe("new");
        expect(stored.get("y.ts")?.importSpecifiers).toEqual(["./x"]);

        const xId = stored.get("x.ts")!.id;
        expect(db.select().from(chunks).where(eq(chunks.fileId, xId)).all()).toHaveLength(1);
        expect(db.select().from(symbols).where(eq(symbols.fileId, xId)).all()).toHaveLength(1);
    });

    it("isolates a file that fails to write, so the rest of its batch still lands", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/c");
        const chunk = record("bad.ts").chunks[0];
        const bad = record("bad.ts", { chunks: [chunk, chunk] }); // same chunk id twice in one file → unique violation

        const errors = writeFileRecords(db, repoId, [record("good.ts"), bad]);

        expect(errors.map((e) => e.path)).toEqual(["bad.ts"]);
        expect([...loadStoredFiles(db, repoId).keys()]).toEqual(["good.ts"]);
    });

    it("replaceImports drops edges with unknown ends and replaces the previous set", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/d");
        writeFileRecords(db, repoId, [record("a.ts"), record("b.ts"), record("c.ts")]);

        expect(replaceImports(db, repoId, [
            { source: "a.ts", target: "b.ts", specifier: "./b" },
            { source: "a.ts", target: "zzz.ts", specifier: "./zzz" },
        ])).toBe(1);
        expect(replaceImports(db, repoId, [{ source: "b.ts", target: "c.ts", specifier: "./c" }])).toBe(1);

        const rows = db.all<{ s: string; t: string }>(sql`
            select fs.path as s, ft.path as t from imports i
            join files fs on fs.id = i.source_file_id
            join files ft on ft.id = i.target_file_id
            where fs.repo_id = ${repoId}`);
        expect(rows).toEqual([{ s: "b.ts", t: "c.ts" }]);
    });

    it("deleteFilesNotIn removes vanished files and cascades their chunks, symbols and imports", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/e");
        writeFileRecords(db, repoId, [record("keep.ts"), record("gone.ts")]);
        replaceImports(db, repoId, [{ source: "gone.ts", target: "keep.ts", specifier: "./keep" }]);
        const goneId = loadStoredFiles(db, repoId).get("gone.ts")!.id;

        expect(deleteFilesNotIn(db, repoId, new Set(["keep.ts"]))).toEqual(["gone.ts"]);
        expect(db.select().from(chunks).where(eq(chunks.fileId, goneId)).all()).toEqual([]);
        expect(db.select().from(symbols).where(eq(symbols.fileId, goneId)).all()).toEqual([]);
        expect(db.select().from(imports).where(eq(imports.sourceFileId, goneId)).all()).toEqual([]);
    });

    it("replaceAggregates swaps the folder tree and level edges wholesale", () => {
        const db = getDb();
        const repoId = upsertRepository(db, "/store/f");
        replaceAggregates(db, repoId,
            [{ path: "", parentPath: null, depth: 0, name: "f", fileCount: 1, directFileCount: 1 }],
            [{ levelPath: "", sourceNode: "a.ts", targetNode: "b.ts", count: 1 }]);
        replaceAggregates(db, repoId,
            [{ path: "", parentPath: null, depth: 0, name: "f", fileCount: 2, directFileCount: 2 }],
            []);

        expect(db.select({ fileCount: folders.fileCount }).from(folders).where(eq(folders.repoId, repoId)).all()).toEqual([{ fileCount: 2 }]);
        expect(db.select().from(levelEdges).where(eq(levelEdges.repoId, repoId)).all()).toEqual([]);
    });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run lib/db/store`
Expected: FAIL — `Failed to resolve import "./lock"` / `"./structure"`.

- [ ] **Step 4: Implement the lock** — `lib/db/store/lock.ts` (the logic moves unchanged from `lib/index-repo.ts`, made synchronous because better-sqlite3 already is):
```ts
import { eq } from "drizzle-orm";
import type { getDb } from "../client";
import { META_KEYS, meta } from "../schema";

type Db = ReturnType<typeof getDb>;

/**
 * Thrown when another run holds the indexing lock. A distinct type rather than a
 * magic string: routes map it to INDEX_LOCKED, and matching on `message` would
 * break the moment anyone rewords the sentence.
 */
export class IndexLockedError extends Error {
    constructor(startedAt: string){
        super(`Indexing already in progress (started ${startedAt}).`);
        this.name = "IndexLockedError";
    }
}

/**
 * How long a lock row may sit before it's assumed to be debris from a crashed run.
 * The lock is released in a `finally`, which doesn't run if the process is killed.
 */
export const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;

export function acquireIndexLock(db: Db): void {
    const lockRow = db.select().from(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).get();

    if (lockRow){
        const startedAt = Date.parse(lockRow.value);
        const isStale = Number.isNaN(startedAt) || Date.now() - startedAt > LOCK_STALE_AFTER_MS;

        if (!isStale){
            throw new IndexLockedError(lockRow.value);
        }

        console.warn(`[index] clearing stale indexing lock from ${lockRow.value}`);
        db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
    }

    db.insert(meta).values({ key: META_KEYS.INDEXING_LOCK, value: new Date().toISOString() }).run();
}

export function releaseIndexLock(db: Db): void {
    db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();
}
```

- [ ] **Step 5: Point the old indexer at the shared lock** — in `lib/index-repo.ts`:
1. Delete the `IndexLockedError` class, the `LOCK_STALE_AFTER_MS` constant (with its comment), and the whole `async function acquireLock(...)` at the bottom.
2. Add these lines after the other imports:
```ts
import { acquireIndexLock, releaseIndexLock } from "@/lib/db/store/lock";

// re-exported so app/api/index/route.ts keeps importing it from here
export { IndexLockedError } from "@/lib/db/store/lock";
```
3. Replace `await acquireLock(db);` with `acquireIndexLock(db);`
4. Replace `await db.delete(meta).where(eq(meta.key, META_KEYS.INDEXING_LOCK)).run();` (in the `finally`) with `releaseIndexLock(db);`

Then run `npx tsc --noEmit`. If it reports `meta` or `META_KEYS` as unused imports in `lib/index-repo.ts`, keep both: `recordEmbeddingModel` still uses them. Remove only whatever tsc or lint actually flags.

- [ ] **Step 6: Implement the store** — `lib/db/store/structure.ts`:
```ts
import { eq, inArray } from "drizzle-orm";
import type { getDb } from "../client";
import { chunks, files, folders, imports, levelEdges, repositories, symbols, type SymbolKind } from "../schema";
import { columnCount, forEachBatch } from "../batch";
import type { CodeChunk } from "../../contracts";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Everything one structure run knows about one changed file. */
export type FileRecord = {
    path: string;
    kind: "component" | "module";
    contentHash: string;
    language: string;
    sizeBytes: number;
    lineCount: number;
    isTest: boolean;
    importSpecifiers: string[];
    chunks: CodeChunk[];
    symbols: {
        name: string;
        qualifiedName: string;
        kind: SymbolKind;
        startLine: number;
        endLine: number;
        exported: boolean;
        parentQualifiedName: string | null;
    }[];
};

export type StoredFile = { id: number; contentHash: string; importSpecifiers: string[] };

type FolderInput = { path: string; parentPath: string | null; depth: number; name: string; fileCount: number; directFileCount: number };
type LevelEdgeInput = { levelPath: string; sourceNode: string; targetNode: string; count: number };

export function upsertRepository(db: Db, rootPath: string): number {
    return db.insert(repositories)
        .values({ rootPath })
        .onConflictDoUpdate({ target: repositories.rootPath, set: { rootPath } })
        .returning({ id: repositories.id })
        .get().id;
}

/** path → what the last successful run stored. */
export function loadStoredFiles(db: Db, repoId: number): Map<string, StoredFile> {
    const rows = db
        .select({ id: files.id, path: files.path, contentHash: files.contentHash, importSpecifiers: files.importSpecifiers })
        .from(files)
        .where(eq(files.repoId, repoId))
        .all();

    return new Map(rows.map((r) => [r.path, {
        id: r.id,
        contentHash: r.contentHash,
        importSpecifiers: JSON.parse(r.importSpecifiers) as string[],
    }]));
}

/**
 * Writes a batch of changed files in ONE transaction: with ~30 batches for VS Code
 * instead of ~15,000 per-file commits, the disk is touched ~30 times. If the batch
 * fails, it's retried file by file so one bad file can't sink its neighbours, and
 * that file keeps its old hash and is retried on the next run (ADR-022).
 */
export function writeFileRecords(db: Db, repoId: number, records: readonly FileRecord[]): { path: string; error: string }[] {
    const errors: { path: string; error: string }[] = [];

    try{
        db.transaction((tx) => {
            for (const record of records) writeOne(tx, repoId, record);
        });
    } catch{
        for (const record of records){
            try{
                db.transaction((tx) => writeOne(tx, repoId, record));
            } catch (err){
                errors.push({ path: record.path, error: err instanceof Error ? err.message : String(err) });
            }
        }
    }

    return errors;
}

function writeOne(tx: Tx, repoId: number, r: FileRecord): void {
    const fields = {
        kind: r.kind,
        contentHash: r.contentHash,
        language: r.language,
        sizeBytes: r.sizeBytes,
        lineCount: r.lineCount,
        isTest: r.isTest,
        importSpecifiers: JSON.stringify(r.importSpecifiers),
    };

    const { id: fileId } = tx.insert(files)
        .values({ repoId, path: r.path, ...fields })
        .onConflictDoUpdate({ target: [files.repoId, files.path], set: fields })
        .returning({ id: files.id })
        .get();

    tx.delete(chunks).where(eq(chunks.fileId, fileId)).run();   // cascades to the old vectors
    tx.delete(symbols).where(eq(symbols.fileId, fileId)).run();

    const chunkRows = r.chunks.map((c) => ({
        fileId,
        chunkId: c.id,
        kind: c.kind,
        name: c.name,
        startLine: c.startLine,
        endLine: c.endLine,
        exported: c.exported,
        partIndex: c.partIndex,
        text: c.text,
        fileHash: c.fileHash,
    }));
    forEachBatch(chunkRows, columnCount(chunks), (batch) => { tx.insert(chunks).values(batch).run(); });

    const symbolRows = r.symbols.map((s) => ({ fileId, ...s }));
    forEachBatch(symbolRows, columnCount(symbols), (batch) => { tx.insert(symbols).values(batch).run(); });
}

/** Deletes files that are no longer on disk (cascading their chunks, symbols and imports) and returns their paths. */
export function deleteFilesNotIn(db: Db, repoId: number, keep: ReadonlySet<string>): string[] {
    const stored = db.select({ id: files.id, path: files.path }).from(files).where(eq(files.repoId, repoId)).all();
    const gone = stored.filter((f) => !keep.has(f.path));

    db.transaction((tx) => {
        for (const f of gone) tx.delete(files).where(eq(files.id, f.id)).run();
    });

    return gone.map((f) => f.path);
}

/** Replaces the repo's whole import graph and returns how many edges were stored. */
export function replaceImports(db: Db, repoId: number, edges: readonly { source: string; target: string; specifier: string }[]): number {
    const idByPath = new Map(
        db.select({ id: files.id, path: files.path }).from(files).where(eq(files.repoId, repoId)).all().map((f) => [f.path, f.id])
    );

    const rows = edges.flatMap((e) => {
        const sourceFileId = idByPath.get(e.source);
        const targetFileId = idByPath.get(e.target);
        return sourceFileId !== undefined && targetFileId !== undefined
            ? [{ sourceFileId, targetFileId, specifier: e.specifier }]
            : [];
    });

    db.transaction((tx) => {
        // a subquery, never an IN-list of every id: that list is what blew the parameter cap before
        tx.delete(imports)
            .where(inArray(imports.sourceFileId, tx.select({ id: files.id }).from(files).where(eq(files.repoId, repoId))))
            .run();
        forEachBatch(rows, columnCount(imports), (batch) => { tx.insert(imports).values(batch).onConflictDoNothing().run(); });
    });

    return rows.length;
}

/** Folder tree + level edges are fully derived from the file set and the edges, so they're rebuilt wholesale. */
export function replaceAggregates(db: Db, repoId: number, folderRows: readonly FolderInput[], edgeRows: readonly LevelEdgeInput[]): void {
    db.transaction((tx) => {
        tx.delete(folders).where(eq(folders.repoId, repoId)).run();
        tx.delete(levelEdges).where(eq(levelEdges.repoId, repoId)).run();
        forEachBatch(folderRows.map((f) => ({ repoId, ...f })), columnCount(folders), (batch) => { tx.insert(folders).values(batch).run(); });
        forEachBatch(edgeRows.map((e) => ({ repoId, ...e })), columnCount(levelEdges), (batch) => { tx.insert(levelEdges).values(batch).run(); });
    });
}

export function markIndexed(db: Db, repoId: number, indexedHead: string | null): void {
    const now = new Date();
    db.update(repositories).set({ lastIndexAt: now, lastScanAt: now, indexedHead }).where(eq(repositories.id, repoId)).run();
}
```

- [ ] **Step 7: Run them to make sure they pass**

Run: `npx vitest run lib/db/store`
Expected: PASS (2 lock tests + 6 store tests).

- [ ] **Step 8: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 115 tests.

- [ ] **Step 9: Commit**
```bash
git add lib/db/store/lock.ts lib/db/store/lock.test.ts lib/db/store/structure.ts lib/db/store/structure.test.ts lib/index-repo.ts
git commit -m "feat: structure store with batched, failure-isolated writes; shared index lock"
```

---

### Task 10: The indexing pipeline

**Files:**
- Create: `lib/index/pipeline.ts`, `lib/index/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above. The pipeline imports:
  - `discoverFiles`, `isTestPath`, `readGitHead` (Task 5)
  - `parseTypeScriptFile`, `TYPESCRIPT_EXTENSIONS` (Task 6)
  - `createResolver` (Task 7)
  - `buildFolders`, `buildLevelEdges` (Task 8)
  - the store and lock functions (Task 9)
  - `normalizeSlashes` (Task 5)
- Produces:
  - `type IndexStage = "discover" | "parse" | "write" | "resolve" | "aggregate"`
  - `type IndexOptions = { onProgress?: (stage: IndexStage, done: number, total: number) => void; batchSize?: number; maxFileBytes?: number }`
  - `type IndexResult` (fields shown below)
  - `repoKey(repoRoot: string): string`
  - `indexRepository(repoRoot: string, options?: IndexOptions): IndexResult`

- [ ] **Step 1: Write the failing test** — `lib/index/pipeline.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "../db/client";
import { files, folders, levelEdges, symbols } from "../db/schema";
import { acquireIndexLock, IndexLockedError, releaseIndexLock } from "../db/store/lock";
import { indexRepository } from "./pipeline";

const FIXTURE = path.resolve("test/fixtures/mini-repo");

function copyFixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neb-pipeline-"));
    fs.cpSync(FIXTURE, dir, { recursive: true });
    return dir;
}

function levelRows(repoId: number, levelPath: string) {
    return getDb()
        .select({ s: levelEdges.sourceNode, t: levelEdges.targetNode, c: levelEdges.count })
        .from(levelEdges)
        .where(and(eq(levelEdges.repoId, repoId), eq(levelEdges.levelPath, levelPath)))
        .orderBy(levelEdges.sourceNode, levelEdges.targetNode)
        .all();
}

describe("indexRepository — first run on the fixture", () => {
    it("stores 8 files, 11 edges, 6 folders and 10 level edges, matching the hand-derived ground truth", () => {
        const root = copyFixture();
        const result = indexRepository(root);

        expect(result).toMatchObject({ files: 8, changed: 8, unchanged: 0, deleted: [], edges: 11, folders: 6, levelEdges: 10, errors: [], skipped: [], usedGit: false, indexedHead: null });

        expect(levelRows(result.repoId, "")).toEqual([{ s: "scripts", t: "src", c: 2 }]);
        expect(levelRows(result.repoId, "src")).toEqual([
            { s: "src/app", t: "src/core", c: 1 },
            { s: "src/app", t: "src/util", c: 1 },
            { s: "src/index.ts", t: "src/app", c: 1 },
            { s: "src/index.ts", t: "src/core", c: 1 },
            { s: "src/util", t: "src/core", c: 1 },
        ]);

        const db = getDb();
        const rootFolder = db.select({ name: folders.name, fileCount: folders.fileCount })
            .from(folders).where(and(eq(folders.repoId, result.repoId), eq(folders.path, ""))).get();
        expect(rootFolder).toEqual({ name: path.basename(root), fileCount: 8 });

        const logTs = db.select({ id: files.id, lineCount: files.lineCount, isTest: files.isTest })
            .from(files).where(and(eq(files.repoId, result.repoId), eq(files.path, "src/core/log.ts"))).get()!;
        expect(logTs).toMatchObject({ lineCount: 9, isTest: false });
        expect(db.select({ q: symbols.qualifiedName, k: symbols.kind, s: symbols.startLine, e: symbols.endLine, x: symbols.exported })
            .from(symbols).where(eq(symbols.fileId, logTs.id)).orderBy(symbols.id).all()).toEqual([
            { q: "log", k: "function", s: 2, e: 2, x: true },
            { q: "Logger", k: "class", s: 4, e: 7, x: true },
            { q: "Logger.info", k: "method", s: 5, e: 5, x: true },
            { q: "Logger.warn", k: "method", s: 6, e: 6, x: false },
            { q: "banner", k: "const", s: 9, e: 9, x: true },
        ]);

        const testFile = db.select({ isTest: files.isTest })
            .from(files).where(and(eq(files.repoId, result.repoId), eq(files.path, "src/util/strings.test.ts"))).get();
        expect(testFile).toEqual({ isTest: true });
    });
});

describe("indexRepository — incremental runs", () => {
    it("re-indexing an unchanged repo parses nothing and keeps the graph", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(indexRepository(root)).toMatchObject({ changed: 0, unchanged: 8, edges: 11, levelEdges: 10 });
    });

    it("an edited file is re-parsed alone, and its new import appears at the right level", () => {
        const root = copyFixture();
        indexRepository(root);
        fs.appendFileSync(path.join(root, "src/util/strings.ts"), "\nimport { render } from \"../app/view\";\nexport const r = render;\n");

        const after = indexRepository(root);

        // new edge src/util/strings.ts → src/app/view.tsx; LCA(src/util, src/app) = src
        expect(after).toMatchObject({ changed: 1, unchanged: 7, edges: 12, levelEdges: 11 });
        expect(levelRows(after.repoId, "src")).toContainEqual({ s: "src/util", t: "src/app", c: 1 });
    });

    it("a deleted file disappears together with its edges", () => {
        const root = copyFixture();
        indexRepository(root);
        fs.rmSync(path.join(root, "src/util/strings.test.ts"));

        expect(indexRepository(root)).toMatchObject({ files: 7, deleted: ["src/util/strings.test.ts"], edges: 10, folders: 6, levelEdges: 9 });
    });
});

describe("indexRepository — edges of the world", () => {
    it("an empty directory yields an empty index with just a root folder, not a crash", () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "neb-empty-"));
        expect(indexRepository(empty)).toMatchObject({ files: 0, edges: 0, folders: 1, levelEdges: 0, errors: [] });
    });

    it("refuses to run while another run holds the lock, and releases its own lock afterwards", () => {
        const db = getDb();
        const root = copyFixture();
        acquireIndexLock(db);
        try{
            expect(() => indexRepository(root)).toThrow(IndexLockedError);
        } finally{
            releaseIndexLock(db);
        }
        expect(() => indexRepository(root)).not.toThrow();
        expect(() => indexRepository(root)).not.toThrow(); // the previous run released its lock
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/index/pipeline.test.ts`
Expected: FAIL — `Failed to resolve import "./pipeline"`.

- [ ] **Step 3: Implement** — `lib/index/pipeline.ts`:
```ts
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db/client";
import { acquireIndexLock, releaseIndexLock } from "../db/store/lock";
import {
    deleteFilesNotIn, loadStoredFiles, markIndexed, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileRecord,
} from "../db/store/structure";
import { buildFolders, buildLevelEdges } from "./aggregate";
import { discoverFiles, isTestPath, readGitHead } from "./discover";
import { TYPESCRIPT_EXTENSIONS, parseTypeScriptFile } from "./languages/typescript";
import { normalizeSlashes } from "./paths";
import { createResolver } from "./resolve";

export type IndexStage = "discover" | "parse" | "write" | "resolve" | "aggregate";

export type IndexOptions = {
    onProgress?: (stage: IndexStage, done: number, total: number) => void;
    /** Files parsed and committed per transaction. */
    batchSize?: number;
    maxFileBytes?: number;
};

export type IndexResult = {
    repoId: number;
    /** Files in the index after this run. */
    files: number;
    changed: number;
    unchanged: number;
    deleted: string[];
    edges: number;
    folders: number;
    levelEdges: number;
    errors: { path: string; error: string }[];
    skipped: { path: string; reason: string }[];
    timingsMs: Record<IndexStage, number>;
    totalMs: number;
    usedGit: boolean;
    indexedHead: string | null;
};

/** One spelling of a repo root everywhere (repositories.rootPath): absolute, forward slashes. */
export function repoKey(repoRoot: string): string {
    return normalizeSlashes(path.resolve(repoRoot));
}

/**
 * The structure stage (PIVOT_SPEC.md §5.2): discover → parse changed files → write →
 * resolve every import → aggregate. When it returns, the Map has everything it needs.
 * Synchronous on purpose: better-sqlite3 and the TS parser are both synchronous, and
 * the Next server will run this on a worker thread (V1.3).
 */
export function indexRepository(repoRoot: string, options: IndexOptions = {}): IndexResult {
    const db = getDb();
    const root = path.resolve(repoRoot);
    const started = performance.now();
    const timingsMs: Record<IndexStage, number> = { discover: 0, parse: 0, write: 0, resolve: 0, aggregate: 0 };
    const batchSize = options.batchSize ?? 500;

    acquireIndexLock(db);

    try{
        const repoId = upsertRepository(db, repoKey(root));

        // ---- discover ---------------------------------------------------------
        let t = performance.now();
        const discovered = discoverFiles(root, { extensions: TYPESCRIPT_EXTENSIONS, maxBytes: options.maxFileBytes });
        const stored = loadStoredFiles(db, repoId);
        timingsMs.discover = performance.now() - t;

        // ---- parse + write, one batch of files at a time (bounded memory) ------
        const errors: { path: string; error: string }[] = [];
        let changed = 0;
        let unchanged = 0;

        for (let i = 0; i < discovered.files.length; i += batchSize){
            const slice = discovered.files.slice(i, i + batchSize);
            const records: FileRecord[] = [];

            t = performance.now();
            for (const file of slice){
                let text: string;
                try{
                    text = fs.readFileSync(path.join(root, file.path), "utf8");
                } catch (err){
                    errors.push({ path: file.path, error: message(err) });
                    continue;
                }

                const contentHash = createHash("sha256").update(text).digest("hex");

                // ADR-022: the hash means "the indexer last processed exactly these bytes"
                if (stored.get(file.path)?.contentHash === contentHash){
                    unchanged++;
                    continue;
                }

                try{
                    const parsed = parseTypeScriptFile(file.path, text);
                    records.push({
                        path: file.path,
                        kind: /\.(tsx|jsx)$/.test(file.path) ? "component" : "module",
                        contentHash,
                        language: "typescript",
                        sizeBytes: file.sizeBytes,
                        lineCount: parsed.lineCount,
                        isTest: isTestPath(file.path),
                        importSpecifiers: parsed.imports,
                        chunks: parsed.chunks,
                        symbols: parsed.symbols,
                    });
                } catch (err){
                    errors.push({ path: file.path, error: message(err) });
                }
            }
            timingsMs.parse += performance.now() - t;

            t = performance.now();
            const writeErrors = writeFileRecords(db, repoId, records);
            errors.push(...writeErrors);
            changed += records.length - writeErrors.length;
            timingsMs.write += performance.now() - t;

            options.onProgress?.("parse", Math.min(i + batchSize, discovered.files.length), discovered.files.length);
        }

        // ---- resolve: the database is the source of truth from here on ---------
        // (a file that failed this run keeps its previous row and specifiers)
        t = performance.now();
        const deleted = deleteFilesNotIn(db, repoId, new Set(discovered.files.map((f) => f.path)));
        const current = loadStoredFiles(db, repoId);
        const fileSet = new Set(current.keys());
        const resolve = createResolver(root, fileSet);
        const edges: { source: string; target: string; specifier: string }[] = [];

        for (const [source, file] of current){
            const targets = new Set<string>();
            for (const specifier of file.importSpecifiers){
                const target = resolve(source, specifier);
                if (target === null || targets.has(target)) continue;   // one edge per file pair
                targets.add(target);
                edges.push({ source, target, specifier });
            }
        }

        const edgeCount = replaceImports(db, repoId, edges);
        timingsMs.resolve = performance.now() - t;

        // ---- aggregate ------------------------------------------------------------
        t = performance.now();
        const folderRows = buildFolders([...fileSet], path.basename(root));
        const levelRows = buildLevelEdges(edges);
        replaceAggregates(db, repoId, folderRows, levelRows);
        timingsMs.aggregate = performance.now() - t;

        const indexedHead = readGitHead(root);
        markIndexed(db, repoId, indexedHead);

        return {
            repoId,
            files: fileSet.size,
            changed,
            unchanged,
            deleted,
            edges: edgeCount,
            folders: folderRows.length,
            levelEdges: levelRows.length,
            errors,
            skipped: discovered.skipped,
            timingsMs,
            totalMs: performance.now() - started,
            usedGit: discovered.usedGit,
            indexedHead,
        };
    } finally{
        releaseIndexLock(db);
    }
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run lib/index/pipeline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 121 tests.

- [ ] **Step 6: Commit**
```bash
git add lib/index/pipeline.ts lib/index/pipeline.test.ts
git commit -m "feat: incremental structure pipeline (discover, parse, write, resolve, aggregate)"
```

---

### Task 11: CLI, active-repo config, VS Code benchmark, docs

**Files:**
- Create: `lib/config.ts`, `lib/config.test.ts`, `scripts/index.ts`, `docs/BENCHMARKS.md`
- Modify: `package.json` (add the `index` script), `docs/IMPLEMENTATION_ROADMAP.md` (mark V1.1 done)

**Interfaces:**
- Consumes: `nebulosityPath` (Task 2), `indexRepository`, `IndexLockedError`.
- Produces: `type NebulosityConfig = { activeRepo: string | null }`, `readConfig(): NebulosityConfig`, `writeConfig(config: NebulosityConfig): void`, and the `npm run index -- <repo>` command. The V1.3 UI and the V1.4 MCP server read `activeRepo`.

- [ ] **Step 1: Write the failing test** — `lib/config.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readConfig, writeConfig } from "./config";

const original = process.env.NEBULOSITY_HOME;

afterEach(() => {
    if (original === undefined) delete process.env.NEBULOSITY_HOME;
    else process.env.NEBULOSITY_HOME = original;
});

describe("config", () => {
    it("reads null when no config file exists yet", () => {
        process.env.NEBULOSITY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "neb-config-"));
        expect(readConfig()).toEqual({ activeRepo: null });
    });

    it("round-trips the active repo under NEBULOSITY_HOME/.nebulosity/config.json", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "neb-config-"));
        process.env.NEBULOSITY_HOME = home;
        writeConfig({ activeRepo: "C:/Users/me/vscode" });
        expect(readConfig()).toEqual({ activeRepo: "C:/Users/me/vscode" });
        expect(fs.existsSync(path.join(home, ".nebulosity", "config.json"))).toBe(true);
    });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config"`.

- [ ] **Step 3: Implement** — `lib/config.ts`:
```ts
import fs from "fs";
import path from "path";
import { nebulosityPath } from "./home";

/** Small user-level settings that outlive any one run. */
export type NebulosityConfig = { activeRepo: string | null };

const configFile = (): string => nebulosityPath(".nebulosity", "config.json");

export function readConfig(): NebulosityConfig {
    try{
        const raw = JSON.parse(fs.readFileSync(configFile(), "utf8")) as { activeRepo?: unknown };
        return { activeRepo: typeof raw.activeRepo === "string" ? raw.activeRepo : null };
    } catch{
        return { activeRepo: null };   // missing or unreadable: nothing chosen yet
    }
}

export function writeConfig(config: NebulosityConfig): void {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n");
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run lib/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the CLI** — `scripts/index.ts`:
```ts
/**
 * npm run index -- <path-to-repo>
 *
 * Runs the structure stage on a repository, prints what it found and how long each
 * step took (the numbers recorded in docs/BENCHMARKS.md), and makes that repo the
 * active one for the Map and the MCP server.
 */
import path from "path";
import { indexRepository, repoKey } from "../lib/index/pipeline";
import { IndexLockedError } from "../lib/db/store/lock";
import { writeConfig } from "../lib/config";

const target = process.argv[2];

if (!target){
    console.error("usage: npm run index -- <path-to-repo>");
    process.exit(1);
}

const root = path.resolve(target);
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

console.log(`[index] ${root}`);

try{
    const result = indexRepository(root, {
        onProgress: (stage, done, total) => process.stdout.write(`\r[index] ${stage} ${done}/${total}   `),
    });
    process.stdout.write("\n");

    console.log(`[index] files ${result.files} (changed ${result.changed}, unchanged ${result.unchanged}, deleted ${result.deleted.length})`
        + ` · edges ${result.edges} · folders ${result.folders} · level edges ${result.levelEdges}`);
    console.log(`[index] discover ${seconds(result.timingsMs.discover)} · parse ${seconds(result.timingsMs.parse)}`
        + ` · write ${seconds(result.timingsMs.write)} · resolve ${seconds(result.timingsMs.resolve)}`
        + ` · aggregate ${seconds(result.timingsMs.aggregate)} · total ${seconds(result.totalMs)}`);

    if (result.skipped.length > 0){
        console.log(`[index] skipped ${result.skipped.length} (first: ${result.skipped[0].path}: ${result.skipped[0].reason})`);
    }
    if (result.errors.length > 0){
        console.log(`[index] ${result.errors.length} file errors (first: ${result.errors[0].path}: ${result.errors[0].error})`);
    }

    writeConfig({ activeRepo: repoKey(root) });
    console.log(`[index] active repo → ${repoKey(root)}`);
} catch (err){
    if (err instanceof IndexLockedError){
        console.error(`[index] ${err.message} If no other run is going, the lock clears itself after 30 minutes.`);
        process.exit(2);
    }
    throw err;
}
```

In `package.json` `"scripts"`, add after `"test"`:
```json
    "test": "vitest run",
    "index": "tsx scripts/index.ts"
```

- [ ] **Step 6: Smoke-test the CLI on the fixture**

Run: `npm run index -- test/fixtures/mini-repo`
Expected output includes: `files 8 (changed 8, unchanged 0, deleted 0) · edges 11 · folders 6 · level edges 10`.
Run it again. Expected: `changed 0, unchanged 8`.

This writes to the real `.nebulosity/nebulosity.db` (a separate repo row; it doesn't touch the Nebulosity repo's own rows) and sets `activeRepo` to the fixture. The VS Code run in the next step overwrites `activeRepo`.

- [ ] **Step 7: Benchmark on VS Code (success criterion S1)**

Run: `git -C ../vscode rev-parse --short HEAD`
Expected: `cc3fec88` (the commit the spec pins).

Run: `npm run index -- ../vscode`
Expected:
- about 14,600 files (`git ls-files` counted 14,615 TS/TSX, plus any JS)
- an edge count in the tens of thousands or more
- a `total` of **≤ 60.0 s**

If the total is over 60 s, **stop and report the per-stage timings to the owner** before optimizing anything. Don't guess at the bottleneck.

Run it a second time. Expected: `changed 0`, and a total that's mostly the discover + read/hash time.

- [ ] **Step 8: Record the numbers** — create `docs/BENCHMARKS.md`, filling each `‹…›` with the value the commands above printed:
```md
# BENCHMARKS.md — Measured Performance

Every number here was measured, not estimated. Each entry records the machine, the
target and the exact command, so it can be re-run.

## 2026 10 1‹day› Index Benchmark #1 — V1.1 structure stage on VS Code

- **Target:** `microsoft/vscode` @ `cc3fec88` (shallow clone at `../vscode`)
- **Machine:** the owner's Windows 11 laptop
- **Command:** `npm run index -- ../vscode` (single-threaded, batches of 500 files)

| Run | Files | Changed | Edges | Folders | Level edges | discover | parse | write | resolve | aggregate | **total** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cold | ‹files› | ‹changed› | ‹edges› | ‹folders› | ‹level edges› | ‹s› | ‹s› | ‹s› | ‹s› | ‹s› | **‹s›** |
| warm (no changes) | ‹files› | 0 | ‹edges› | ‹folders› | ‹level edges› | ‹s› | ‹s› | ‹s› | ‹s› | ‹s› | **‹s›** |

**S1 (≤ 60 s): ‹PASS or FAIL›.** Compare with the pre-pivot baseline from 2026-10-10
(`PIVOT_SPEC.md` §1): read 2.4 s + parse/chunk 22.3 s + import scan 4.6 s.
```

- [ ] **Step 9: Mark V1.1 done in the roadmap** — in `docs/IMPLEMENTATION_ROADMAP.md`'s pivot table, change the V1.1 row's first cell from `**V1.1 Engine foundation**` to `**V1.1 Engine foundation** — DONE ‹date› (see BENCHMARKS.md)`.

- [ ] **Step 10: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS — 123 tests.

- [ ] **Step 11: Commit**
```bash
git add lib/config.ts lib/config.test.ts scripts/index.ts package.json docs/BENCHMARKS.md docs/IMPLEMENTATION_ROADMAP.md
git commit -m "feat: npm run index CLI and active-repo config; record VS Code benchmark (S1)"
```

- [ ] **Step 12: Update the local project brief** (`CLAUDE.md` is gitignored, so there's nothing to commit). In its "Current state (2026-10-11)" block, add a line: `V1.1 done: npm run index -- ../vscode builds the structure index in ‹total› (docs/BENCHMARKS.md); next is the V1.2 plan (summaries, embeddings, FTS, hybrid search).`

---

## What comes next (not part of this plan)

The V1.2 plan (Understanding: tiered summaries, summary embeddings, FTS, hybrid RRF search, `/api/status`) is written with superpowers:writing-plans at the start of that slice, against the schema and the benchmark numbers this plan produces. V1.3–V1.5 follow the same way.

Carried forward deliberately:
- **Importance ranking.** Spec §5.2 step 5 asks for in-degree. Nothing in V1.1 consumes it, so V1.2 computes it from `imports` (a `GROUP BY target_file_id`) when it orders the summary queue.
- **Single-file update speed.** S6 (≤ 2 s from saving one file) is measured in V1.3. `indexRepository` re-resolves every file's imports on each run, which is simple and correct. If that's what breaks the budget on VS Code, re-resolve only the importers of created and deleted files (spec §5.6).
