# RAG_PIPELINE.md — Understanding and Search

> **2026-10-11 — rewritten in slice V1.2** for the pivot (`PIVOT_SPEC.md` §5.3–5.4, §6.1; ADR-027, ADR-028, ADR-031, ADR-033, ADR-034, ADR-035). Chunk-level embeddings are gone. Search fuses code keywords, summary keywords and summary meaning. §2–3 (chunking) carry over unchanged from the Phase 2 design.

**Status:** Implemented (V1.2)
**Depends on:** `DATABASE_DESIGN.md` §7–8, `ENGINEERING_DECISIONS.md` ADR-004/005/017/027/028/031/033/034/035

---

## 1. The pipeline

```
repo files
   │  structure stage: npm run index                         lib/index/pipeline.ts
   ├─► chunks + symbols + imports ─► code_fts (triggers)     lib/db/store/structure.ts
   ▼
summaries: npm run summarize                                 lib/index/summarize/
   │  files: Haiku 5.5 · folders and the repo: Sonnet 5.5 · test files and test-only folders: a template
   ├─► summary_fts (triggers)
   ▼
summary vectors (MiniLM, local)                              lib/index/embed.ts
   ▼
search(query) = RRF(code_fts, summary_fts, cosine, folder names)           lib/engine/search.ts
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
- **Files** go to `claude-haiku-5-5`. The prompt is the file's generated imports/exports listing (the file-summary chunk), its line count, who imports it, and its source cut to about 6k tokens (20,000 characters, at a line break). "Who imports it" is one line from the import graph, for example `Imported by: 10 files: src/vs/workbench (3), src/vs/base/browser (2), build.js (1), and 4 files elsewhere, plus 1 test file`: the total, then the 3 biggest groups with their importer counts, then a count of the files in the rest, then `, plus 1 test file` if there are any. Importers are grouped by area with the rule of `PIVOT_SPEC.md` §4.2 (the same `lcaFolder` and `childToward` that build the Map's level edges): an importer's group is the child of the lowest common folder of the two files, toward the importer, or the importer itself when it sits directly in that folder, so a sibling in the file's own folder is a group of its own and a top-level file is named by its path. Groups are ordered by count, then by path in code-point order, and counts are written with thousands separators like the total (`src/vs/workbench (1,840)`). Test files are left out of the total, the groups and the examples because on VS Code a central file's biggest importer folders are test folders, which would skew how its use looks; when tests are the only importers the line is `Imported by: only 3 test files`. A file nothing imports gets `Imported by: no other indexed file`. The model uses it to say how widely, and where, the file is used.
- **Folders** go to `claude-sonnet-5-5`, written bottom-up from their children's taglines and summaries. The 50 largest children are listed (by lines of code), plus "…and N smaller items".
- **The repo** goes to `claude-sonnet-5-5`, from its top-level folders and files.
- **Test files, and folders that hold only test files,** skip the model and get a template (`Tests for strings`, `Tests for folding`; status `skipped`). A top-level test folder takes the repo's name (`Tests for vscode`), since it tests the whole repo (V1.5). A folder qualifies when its subtree holds at least one file and no non-test file; the repo never does. The template is settled at once, so the parent folder goes out in the first folder wave.

**Settings.** Effort `low` and adaptive thinking (the models' default). Structured outputs force `{ tagline, summary }`. `max_tokens` is 4,096, and 8,192 (`RETRY_MAX_OUTPUT_TOKENS`) for the one retry of a cut-off answer.

**Whole summaries only (ADR-034).** A cut-off summary is never stored. Summary Review #3 found one that ended "…applyEdits. The" inside well-formed JSON with a normal stop, so a parsed reply isn't proof of a whole answer. `parseSummary` first turns a trailing run of two or more periods into one (`…in one place..` → `…in one place.`). Then a reply counts as whole only when:
- its stop reason is `end_turn` (`max_tokens`, `pause_turn` and any other stop reason may stop anywhere);
- its summary isn't empty;
- its trimmed summary ends a sentence: `.`, `!` or `?`, then any closing quotes, backticks or brackets (`/[.!?]["'`)\]]*$/`).

A refusal keeps its own error. Every other incomplete reply fails with `the summary was cut off (stop reason: …)`, and only that failure is retried: once, on the regular API, at 8,192 output tokens, whichever transport sent it. In a batch, the cut-off items are re-requested inside `batchResults` before the runner sees the results, so the runner only ever gets whole summaries or failures. If the retry is cut off too, or fails, the outcome is failed, nothing is stored, and the next run resends it. A batch's results don't carry its prompts, so the summarizer keeps each batch's requests in memory from submission to collection (on the order of 100 MB of prompts for VS Code's file pass: its `.ts` files, each capped at 20,000 characters, total 110 MB). Only the process that submitted a batch retries its cut-off items in-process: when another process collects the batches (after a restart, or in `--no-wait` runs), those items fail, are never stored, and are resent on the next run. A retried answer counts as one request in `summary_usage` while both attempts' tokens are summed, so the per-request mean errs high, which is safe for the spend cap (ADR-035). Retries of a collected batch run inside one poll, without a lock heartbeat, so a mass cut-off could outlast the 5-minute "running means alive" window (ADR-032); this is a known limit, accepted because cut-offs are rare.

**Prompt v2 (ADR-034).** `PROMPT_VERSION` is 2. All three system prompts ask for a noun phrase of 3 to 6 plain words as the tagline, with an example that isn't from VS Code, and for names in the summary in backticks. The file prompt also explains the `Imported by` line, and tells the model not to mention truncation or code it wasn't shown (the source is still cut at about 6k tokens).

**Taglines.** 3–6 words are asked for and up to 8 are kept whole, because a hard cut at 6 sliced 7–8 of Review #1's 20 Haiku taglines mid-phrase. In code (`cleanTagline`): backticks are removed (the UI shows plain text); a tagline of 8 words or fewer is kept as it is; a longer one is cut to its first 8 words, then loses the connector words it now ends on (`a an the and or of for to in on with via by from at as`, in any case and ignoring punctuation stuck to the word, so `and,` counts; never the first word); trailing `.`, `,`, `;` and `:` are stripped. A reply with no tagline left is an error, like one with no summary.

**inputHash = hash(model, PROMPT_VERSION, input).** Identical input is never summarized twice, and bumping `PROMPT_VERSION` redoes everything on purpose. For a file, the input is its path and content hash, so planning never reads source files. The `Imported by` line comes from the graph and is **not** in the hash (ADR-034): a new importer would otherwise re-summarize a central file on every `git pull`. The cost is that a file's usage sentence reflects the graph as it was when the file was last summarized.

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

**Cost.** Every answer's tokens go to `summary_usage`, per model and transport, including an answer whose row was redone or deleted meanwhile: it was still paid for. A Sonnet request that a server-side fallback finished counts each attempt under its own model, from `usage.iterations`, because the declined attempt is billed too. A retried cut-off answer counts both attempts, summed per model. One gap: the runner records a batch's outcomes at batch prices, so a retried batch item's regular-API tokens are counted at half their price; retries are rare, so the gap is small. That's how S2 (≤ $15 for VS Code's full pass) is measured. The owner reviews Haiku against Sonnet on 20 VS Code files before the first full run (`SUMMARY_REVIEW.md`), then folder summaries: `npm run preview-folders -- <repo>` (`lib/index/summarize/preview.ts`, Summary Review #3) summarizes 10 fixed sample folders through the regular API, with files first and then folders bottom-up. It uses exactly the run's prompts, because it feeds in-memory rows to `planSummaries`, and it writes nothing to the index or `summary_usage`.

**The spend cap (ADR-035).** Before every submission (each batch, and each regular-API wave), and before building any of its prompts, a run projects **spent + at Anthropic + this submission + the rest**:
- **spent** is every `summary_usage` row of the repo, each at its own transport's price, so the cap bounds the repo's recorded summary spend across runs (ADR-035 lists what never reaches `summary_usage`);
- **at Anthropic** is the requests in flight, at batch prices, including the batches this wave has already submitted;
- **this submission** is priced at its own transport;
- **the rest** is every target still `ready` or `waiting` after it, at batch prices (direct ones under `--direct`).

A request is expected to take its model's mean tokens on this repo (Σ tokens ÷ Σ requests, both transports). Until a model has answered anything, a file is assumed to take 4,600 tokens in and 260 out (Review #1's Haiku means), and a folder or the repo 1,000 and 250. A model with no price on file counts as $0 and is named.

Under the budget the run prints `budget: spent $… + at Anthropic ≈ $… + this wave ≈ $… + the rest ≈ $… = $… of $…` and sends. Over it, the run **stops sending but keeps collecting what's already at Anthropic**, which is paid for.
- The rows it didn't send stay pending (not failed, not claimed), and a wave stopped before its first submission isn't counted.
- While it collects, the stage note reads `over budget, so nothing new goes out; collecting the N batches already at Anthropic`. After each collection the run checks again, with the real usage in place of the estimates, and sends if the projection now fits.
- It finishes over budget once nothing more can happen: nothing in flight, or nothing more ended under `--no-wait`. The stage is then `failed`, or `running` while batches are still at Anthropic, and the note starts with `stopped:`, as after the circuit breaker.

The budget is `--budget <usd>`, default $15 (S2). The background worker caps each refresh and sweep at $1 of its own spend instead (`budgetScope: "run"`, ADR-035 amended). The projection runs a little low, by an estimated under $1 on VS Code. The rest is priced by batch, but waves under 100 requests go through the regular API at full price: at the top of the tree, and also mid-run, when file batches land at different times. That can only delay a stop, never cause an overspend: each regular-API wave is priced at direct rates in its own check, before it goes.

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

### The four lists

1. **Code keywords:** bm25 over `code_fts` (path 2, name 10, name_split 6, text 1). The top 200 chunks are grouped by file, and a file's best chunk stands for it.
2. **Summary keywords:** bm25 over `summary_fts` (path 1, tagline 4, summary 2), over files and folders. The repo summary is never a hit.
3. **Meaning:** cosine similarity between the query's MiniLM vector and every summary vector, held in memory as one flat matrix and reloaded only when the set of vectors changes. Matches below 0.25 are dropped.
4. **Folder names** *(V1.3.1, owner review)*: folders whose name matches a word of the query (`rankFolderNames`). Best first: the name is the word, or differs from it by an ending of up to 3 letters (`debug` for "debugger"); then the name starts with the word (`terminalContrib`); then it contains it (`externalTerminal`, words of 3+ letters); then the word starts with the name (`term` for "terminal", names of 4+ letters). Ties go to the folder with more files. Before this list, searching "terminal" ranked VS Code's terminal folder 57th: folders only competed through their summaries, against hundreds of files.

Each list contributes at most 50 files or folders.

### Building the keyword query

*(V1.3.1, the owner's three-task test.)* Every list first drops the repo's own name from the query when other meaningful words remain (`dropRepoName`): every file is in the repo, so the word says nothing, and in VS Code "vscode terminal" mostly matched extension code importing the `vscode` API. Only a whole word goes (`vscode-dts` stays), and the answer still carries the query as typed.

`toFtsQuery` keeps the query's words and drops stopwords and single letters. Each identifier also contributes its parts (`openEditor` adds `open` and `editor`). Every word is quoted, so nothing the user types is read as FTS5 syntax, and the words are ORed. `"Where are editor tabs rendered?"` becomes `"editor" OR "tabs" OR "rendered"`, and porter stemming lets `rendered` match `render`.

### Reciprocal Rank Fusion

`score(d) = Σ wᵢ / (60 + rankᵢ(d))` over every list that ranks `d`, with ranks starting at 1. Each list's weight `wᵢ` is 1, except the folder-name list's, which is 2: a folder named like the query is strong evidence it's what's meant, and at weight 1 it scored like a single code hit and fell past the cut-off (`src/vs/workbench/contrib/debug` for "debugger"). A worked example with the three weight-1 lists: code `[a, b, c]`, summary `[b]`, vector `[c, b]` give
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

A saved file reaches the index through the background worker's `applyFileChanges` within about a second of the last save (ADR-037). The worker then re-plans the summaries (the file's summary turns stale), and redoes that file's summary after 60 quiet seconds, at most 50 files per refresh (ADR-038).

---

## 8. Failure modes and honest limitations

| Failure | Symptom | Mitigation |
|---|---|---|
| No API key | No summaries | Stage `off` with the reason; templates, structure and code search still work |
| Batch takes hours | Summaries arrive late | Keyword search works meanwhile; `--no-wait` and resume; `summarizeNow` for what someone opens |
| The network drops while waiting on a batch | Polls fail | A failed poll is asked again on the next pass. After 5 passes in a row in which no batch could be checked, or a rejected key, the run stops; the stage stays `running`, and the next run collects the batch |
| A batch's results never download (a malformed result line, a 5xx on that one batch) | Every run gives up at the same batch, its rows claimed | The run gives up after 5 missed passes; the stage note names the batch and the `--release-batch` command, which resends its requests (paid again) |
| File edited after indexing | Summary would describe bytes the index never saw | That target fails with "changed after it was indexed" and is retried after `npm run index` |
| Summarizing while `npm run index` runs | Files fail as "changed after it was indexed" | The run refuses to start until the structure stage is `ready` |
| A batch can't be submitted | Nothing goes out | The run stops with its rows still pending; batches already submitted are collected next run. A batch that was accepted but couldn't be recorded has its id printed and in the error |
| Most of a wave or batch fails (a rejected key, an outage, a repo edited since indexing) | Folders would be summarized over "(no summary yet)" and paid for again | The circuit breaker (10+ failures, more than half) stops the run; the note starts with `stopped:`, and the failures are retried next run |
| A run would pass its budget | The spend would go past what the owner approved (S2: $15 for VS Code) | The spend cap (ADR-035): before each batch or regular-API wave the run projects spent + at Anthropic + this submission + the rest. Over the budget it stops sending but still collects what's already at Anthropic (paid for), checking again after each collection. Unsent rows stay pending; when nothing more can happen the stage is `failed` (or `running` while batches are at Anthropic), and the note starts with `stopped: the next wave would bring the projected spend to` (`batch` for a batch). Run again with a bigger `--budget` to go on |
| A summary comes back cut off (it hit the limit, the turn didn't end, or well-formed JSON stops mid-sentence, as in Summary Review #3) | A half sentence would be stored and shown | Never stored (ADR-034): only an `end_turn` reply whose summary ends a sentence counts as whole. A cut-off answer is retried once on the regular API at 8,192 output tokens, from either transport, and both attempts' tokens are counted (a batch item's retry at batch prices). Cut off again, it fails with `the summary was cut off (stop reason: …)` and is resent next run |
| Model refusal | A summary fails | Sonnet's regular-API requests fall back server-side; batch refusals are retried next run, in a small wave that goes direct |
| Embedding model can't load | No meaning search | Keyword lists still answer, and the `note` says so |
| Vocabulary mismatch | A concept finds nothing by keyword | The meaning list, and summaries written in plain words |
