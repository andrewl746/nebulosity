# RAG_PIPELINE.md — Retrieval-Augmented Generation Design

> **2026-10-11 — pivot:** search becomes hybrid (code FTS + summary FTS + summary embeddings, merged with RRF), and chunk-level embeddings are dropped (ADR-027). See `PIVOT_SPEC.md` §5–6; this doc is rewritten in slice V1.2. §2's chunking principles still hold.

**Status:** Approved design
**Implements:** Phases 2–4 of `IMPLEMENTATION_ROADMAP.md`
**Depends on:** `DATABASE_DESIGN.md` (storage formats), `ENGINEERING_DECISIONS.md` ADR-004/005/006

---

## 1. The pipeline

```
Code file (raw text)
      │
      ▼
AST parser (TypeScript Compiler API)          lib/chunks.ts
      │   finds real declaration boundaries
      ▼
Chunks (one per function/class/component)     lib/chunks.ts
      │   + metadata: path, name, kind, lines
      ▼
Embeddings (384-dim vectors, local model)     lib/embed.ts
      │
      ▼
Vector store (SQLite `vectors` table,         lib/db/ (ADR-013)
  Float32Array BLOBs)
      │
      ▼
Similarity search (brute-force cosine,        lib/retrieve.ts
  in-memory after one load)
      │   query vector vs. every chunk vector
      ▼
Relevant context (top-k chunks, formatted)    lib/retrieve.ts
      │
      ▼
LLM (via the agent's search_code tool)        lib/agent/tools.ts
```

Every arrow is a plain function call. Every box is one module with one job.

---

## 2. Why chunking matters (the core insight of RAG)

You cannot hand an entire repository to an LLM: context windows are finite, cost scales with tokens, and burying the answer in 50 irrelevant files degrades quality. You also should not chop code every N characters — cutting a function in half destroys the meaning of both halves.

**Rule: chunk boundaries follow logical code constructs.** One chunk = one top-level declaration:

- function declarations and exported arrow functions
- classes
- React components (detected as: function whose name starts uppercase and returns JSX, or is in a `.tsx` file and exported default)
- interfaces and type aliases
- exported top-level `const` objects
- **plus one "file summary" chunk per file**: the import list + top-of-file comments + the list of declaration names. This chunk answers "what is this file for?" queries that no single function answers.

Declarations longer than the size cap (below) are split with a 3-line overlap between pieces, and each piece keeps the parent declaration's metadata with a `partIndex`.

**As implemented (2026-09-04):** the cap is 200 lines and the window slides by `200 − 3 = 197`, so **every** consecutive pair of parts overlaps by exactly 3 lines and the loop runs until the final line has been emitted. Deriving a part count up front instead (`ceil(lines / 200)`) assumes non-overlapping windows and silently drops the tail. `partIndex` is **0-based**. The file-summary chunk is never split: its text is a generated listing while its line range deliberately spans the whole file, so the two measures aren't comparable. Splitting is by line, not yet at statement boundaries — the AST is available to do better, and that refinement is open.

**Chunk span (ADR-018).** A chunk covers its declaration *plus its attached leading comment block* — `startLine`, `endLine` and `text` always describe the same region. Comments separated from the declaration by a blank line are treated as detached and excluded. This is what puts doc comments into the embedding text (§4) while keeping line ranges accurate enough to open in an editor.

## 3. Chunk schema

Defined in `lib/contracts.ts` (single source of truth). Reproduced here:

```ts
type CodeChunk = {
  id: string;            // `${filePath}#${name}#${partIndex}` — stable across runs
                         // repeated names get a `~n` marker: "lib/x.ts#foo~2#0" (ADR-019)
  filePath: string;      // project-relative, forward slashes: "lib/graph.ts"
  kind: "function" | "class" | "component" | "interface" | "type"
      | "const" | "enum" | "namespace" | "file-summary";   // enum/namespace added 2026-09-04, ADR-020
  name: string;          // "toFlowGraph", "GraphCanvas", or "(file)" for summaries
  startLine: number;     // 1-based, inclusive — spans the attached doc comment too (ADR-018)
  endLine: number;       // 1-based, inclusive
  exported: boolean;
  partIndex: number;     // 0-based; 0 when the declaration was not split
  text: string;          // the exact source text of the chunk
  fileHash: string;      // sha256 of the whole file — used for invalidation
};
```

**Why `id` is derived, not random:** re-indexing an unchanged file must produce identical ids, so vectors for unchanged chunks can be reused instead of re-embedded.

---

## 4. Embeddings

### What an embedding is (for the learner)

An embedding model reads text and outputs a fixed-length list of numbers — a point in 384-dimensional space — positioned so that *semantically similar* texts land near each other. "Where do we parse imports?" lands near the `extractImports` function even though they share almost no words. That near-ness is what makes retrieval semantic instead of keyword-based.

### Model choice

- **Model:** `Xenova/all-MiniLM-L6-v2` running locally via the `@huggingface/transformers` npm package (Transformers.js). 384 dimensions.
- **Why local:** zero cost, no API key, works offline, keeps the "local tool" promise. First run downloads ~25 MB of model weights to a cache; subsequent runs are warm. (Alternatives and the switch trigger are in ADR-005.)
- **Normalization:** every vector is normalized to unit length at embed time and the store records `normalized: true`. Consequence: cosine similarity = plain dot product — cheaper and simpler.

### What text gets embedded (important subtlety)

MiniLM effectively reads ~256 tokens; longer input is truncated. So we do **not** embed `chunk.text` raw. We embed a constructed **embedding text**:

```
<filePath> · <kind> <name>
<leading doc comment, if any>
<declaration signature line>
<body, truncated to fit>
```

Front-loading the path, name, and comment means the most identifying information survives truncation. `chunk.text` (the full source) is what gets *shown* to the LLM after retrieval; the embedding text is only for the vector.

---

## 5. Retrieval algorithm

`lib/retrieve.ts`, exact steps:

1. Embed the query string with the same model → `q` (normalized).
2. Load all vectors from the `vectors` table (they stay cached in module memory after first load; invalidate the cache when `repositories.lastIndexAt` changes).
3. Score every chunk: `score = dot(q, v)` — a single O(n·384) pass. At ≤ ~5,000 chunks this is single-digit milliseconds; see ADR-006 for the ceiling.
4. Sort descending, take **k = 8**, drop results with `score < 0.25` (below that, matches are noise).
5. Return `RetrievedChunk[] = (CodeChunk & { score })[]`.

### Context formatting (what the LLM actually sees)

The `search_code` tool formats results as:

```
[1] lib/scan.ts:10-17 · function extractImports (score 0.71)
<full chunk text>

[2] lib/graph.ts:104-122 · function resolveImport (score 0.63)
<full chunk text>
...
```

File paths + line numbers are mandatory — they are what lets the agent cite sources and drive `highlight_nodes` honestly.

### Quality levers (tune in this order if retrieval feels bad)

1. **k** (default 8): raise for broad questions, but each chunk costs tokens.
2. **Score threshold** (default 0.25): raise if irrelevant junk appears.
3. **Embedding text construction:** usually the highest-impact fix — if a chunk kind retrieves badly, enrich what gets embedded for it.
4. **Graph-aware boost (stretch, Phase 6+):** multiply scores by 1.1 for chunks in files adjacent (in the dependency graph) to the file currently focused in the UI. This fuses the two halves of Nebulosity — the graph informs retrieval.

---

## 6. Incremental re-indexing

Full pipeline per file, with the skip check first:

```
for each source file:
  hash = sha256(file contents)
  if files.contentHash == hash:  skip (reuse existing chunks + vectors)
  else, in one transaction:
    delete old chunks for the file (cascade clears vectors)
    chunk → embed → insert
    update files.contentHash
finally: delete file rows no longer on disk (cascade clears their chunks/vectors)
```

This makes re-indexing after a small edit take seconds, not minutes, and it is idempotent: running index twice in a row is a no-op the second time.

---

## 7. Failure modes and honest limitations

| Failure | Symptom | Mitigation |
|---|---|---|
| Query vocabulary mismatch | "auth" finds nothing because code says "session" | Semantic embeddings mostly handle this; agent can retry `search_code` with reworded queries (it is told to in the system prompt) |
| Truncation of huge functions | Retrieval finds the function but the LLM sees only part | Split-with-overlap chunking; agent can follow up with `read_file` for full context |
| Stale index | Answers cite code that changed | `GET /api/health` reports files-changed-since-index; UI shows a "reindex" hint (Phase 6) |
| Empty index | User asks questions before indexing | `search_code` returns a structured "index empty — run indexing" error; agent relays it instead of guessing |
| Model download blocked (offline first run) | Embedding fails | Clear error surfaced through SSE `error` event; graph features still work (Flow A never touches RAG) |
