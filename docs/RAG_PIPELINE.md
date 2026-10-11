# RAG_PIPELINE.md — Understanding and Search

> **2026-10-11 — rewritten in slice V1.2** for the pivot (`PIVOT_SPEC.md` §5.3–5.4, §6.1; ADR-027, ADR-028, ADR-031, ADR-033). Chunk-level embeddings are gone. Search fuses code keywords, summary keywords and summary meaning. §2–3 (chunking) carry over unchanged from the Phase 2 design.

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
- **Resuming.** Batch ids are stored on the rows, so an interrupted run resumes. Answers are matched by `custom_id` (the row id), never by position. `--no-wait` never sleeps: it collects the batches that have already ended, submits what that makes ready, and exits, so repeated runs (by hand, or from cron) work up the tree.
- **Failures.** A failure doesn't block its folder ("no summary yet" stands in), and the next run retries it.
- **The circuit breaker.** When at least 10 requests fail and they are more than half of a wave or batch, the cause is shared (a rejected key, an outage, files edited since indexing). The run then stops before planning another wave, so no folder is summarized over those placeholders and paid for again; the stage note starts with `stopped:`.
- **Submitting.** A batch that can't be submitted stops the run. Its rows stay pending, and batches submitted before it are collected by the next run. A batch Anthropic accepted but the run couldn't record has its id printed and put in the error.
- **Structure first.** A run refuses to start while the structure stage is running or failed.
- **Locking.** A `summarizing` lock prevents two paying runs.

**Lazy folders.** When a file's summary changes, its folder's input changes and the folder goes `stale`. Full runs (`npm run summarize`) redo stale folders. Incremental runs leave them `lazy` until someone opens them (`summarizeNow`, the Map's "jump the queue"); V1.3 adds a periodic sweep.

**Cost.** Every answer's tokens go to `summary_usage`, per model and transport, including an answer whose row was redone or deleted meanwhile: it was still paid for. A Sonnet request that a server-side fallback finished counts each attempt under its own model, from `usage.iterations`, because the declined attempt is billed too. That's how S2 (≤ $15 for VS Code's full pass) is measured. The owner reviews Haiku against Sonnet on 20 VS Code files before the first full run (`SUMMARY_REVIEW.md`).

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
| The network drops while waiting on a batch | Polls fail | A failed poll is asked again on the next pass. After 5 in a row, or a rejected key, the run stops; the stage stays `running`, and the next run collects the batch |
| File edited after indexing | Summary would describe bytes the index never saw | That target fails with "changed after it was indexed" and is retried after `npm run index` |
| Summarizing while `npm run index` runs | Files fail as "changed after it was indexed" | The run refuses to start until the structure stage is `ready` |
| A batch can't be submitted | Nothing goes out | The run stops with its rows still pending; batches already submitted are collected next run. A batch that was accepted but couldn't be recorded has its id printed and in the error |
| Most of a wave or batch fails (a rejected key, an outage, a repo edited since indexing) | Folders would be summarized over "(no summary yet)" and paid for again | The circuit breaker (10+ failures, more than half) stops the run; the note starts with `stopped:`, and the failures are retried next run |
| Model refusal | A summary fails | Sonnet's regular-API requests fall back server-side; batch refusals are retried next run, in a small wave that goes direct |
| Embedding model can't load | No meaning search | Keyword lists still answer, and the `note` says so |
| Vocabulary mismatch | A concept finds nothing by keyword | The meaning list, and summaries written in plain words |
