# V1.7 Calls and context, measured: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the measured results significantly better, honestly, so they hold up on a resume and in an interview (the V1.7 brief). This slice does three things:
- It answers "who calls this method, even through an injected service, and what has to change if its signature changes" from a calls index, through a seventh tool, `calls`.
- It measures what matters for an agent: how fast Claude Code gets the context a question needs (time to relevant context), with a shell set-up that stops refused commands from skewing the comparison.
- It runs Eval #3 on VS Code, AFFiNE and a held-out Theia, against a gate fixed before the first run. The gate stays as approved, and V1.7 aims to pass it. Whatever the outcome, the hold of ADR-051 lifts after Eval #3's verdict, by the owner's call after design (design §5.8, R-AK). The gate decides what the README may claim: on a pass, the measured wins; on a fail, the results as measured, with each failed condition and why, losses beside wins.

**Architecture:** Three tracks.
- **The engine** (`lib/index/`, `lib/db/`, `lib/engine/`, `lib/tools/`, `mcp/`): the TypeScript adapter's one parse gains a fourth product, the call facts (import bindings and re-exports, class and interface declarations, typed call sites and injection sites). Migration 0009 stores them in three tables, replaced per file. `lib/engine/calls.ts` resolves them at query time through the stored import edges, cached per index version, and answers callers, implementations, what a signature change touches, and injection sites. The `calls` tool is always loaded, and the six always-loaded definitions plus the instructions stay under a tighter character budget.
- **S6** (`lib/index/update.ts`, `lib/background/service.ts`): the background worker keeps the workspace manifests it read until a resolution input or the file set changes.
- **Eval #3's harness** (`scripts/eval/`, `eval3/`): a definition with the rules sentence and a gate selector; time to relevant context and its statistics; the call truth from TypeScript's own type checker, independent of the index; the new kinds and their scores; Eval #3's gate; grader redaction; V1.6's three harness minors. Eval #1 and Eval #2 re-score exactly as before.

**Tech Stack:** TypeScript 5, Node 24.14.0, Next.js 16.4.0, React 19, better-sqlite3 + Drizzle (WAL), Vitest 4, tsx, `@modelcontextprotocol/sdk` 1.32.1 (pinned), the TypeScript compiler API (the adapter's parse; the type checker only in `scripts/eval/ts-calls.ts`). Claude Code (2.1.301 at the plan's approval; it updates itself), pinned at Eval #3's pilot. No new dependency.

**Spec:** `.superpowers/sdd/2026-10-15-v1-7-calls-and-context/design.md`, approved 2026-10-15 (the owner's decisions verbatim in §2, the design in §5, the rulings in §6). Its evidence beside it: `report-e2-feasibility.md`, `report-ttrc-and-cost-floor.md`, `report-code-survey.md` and `evidence/`. Also: `docs/PIVOT_SPEC.md` §2, §6, §9, §10, §12; ADR-024, 043, 045, 051 and 053–058 with their 2026-10-15 amendments; `docs/EVAL_RESULTS.md` (Eval #2); `docs/API_CONTRACTS.md` §17; `docs/ARCHITECTURE.md` §3. This plan adds ADR-059 and ADR-060 and amends ADR-024, 043, 051, 053, 056 and 057, all written as proposed in the plan's own commit.

---

## What the code and the machine have today (checked 2026-10-15, planning)

- **Branch.** `pivot/v1` at `49f8bbd`, pushed. PR #8 (`pivot/v1 → main`) was merged into `main` on 2026-10-15, as checked at the plan's approval. Nothing in this plan touches `main`. Uncommitted: `docs/LEARNING_NOTES.md` (modified) and `lib/agent/state.ts` (untracked), both the owner's. **The gate:** tsc clean, lint 0 errors and 4 warnings (all pre-existing), **vitest 1,340/1,340** in 125 files (12.4 s).
- **The machine.** Nothing listens on port 3000. `claude --version` was 2.1.300 at planning and 2.1.301 at the plan's approval: it updates itself, so Task 15 checks it before the dev set and Task 19 pins it for good. `../vscode` is at `cc3fec88` and `../affine` at `0b69a6d`, both clean. `../theia` doesn't exist.
- **The adapter** (`lib/index/languages/typescript.ts`). `ADAPTER_VERSION = 4`. `parseTypeScriptFile` parses once (`parseSourceFile`, parent nodes set) and returns `ParsedFile = { chunks, symbols, imports, lineCount }`. The imports-only path (1–5 MB, parsed in full) and the token scan (5–20 MB) return empty chunks and symbols, and two tests compare their whole result with `toEqual` (`typescript.test.ts` L183 and L245). Nothing reads import bindings, heritage clauses, constructor parameter properties, decorators, interface members or calls.
- **The store** (`lib/db/store/structure.ts`). `writeOne` upserts the file row, deletes its chunks and symbols by `fileId`, and inserts the new ones with `forEachBatch`. `FileRecord` literals are built by hand in `structure.test.ts`'s `record()` helper and in `pipeline.test.ts` L294. Migrations go up to `0008_v1_6_docs.sql`, made with `npx drizzle-kit generate --name <name>`. Row types the store needs live in `lib/db/schema.ts`, so `lib/db` never imports `lib/index` (ARCHITECTURE.md §3, rule 4).
- **The engine.** `importGraphFor` (`lib/engine/graph.ts`) loads the import graph once per repo and index version; `importIndexFor` (`reach.ts`) keeps the compressed rows in a `WeakMap` keyed on that graph object, so a new version gets a new index (ADR-044's rule for caches). `areasOf` (`impact.ts`) counts files by area, with describe's used-by rule when no folder is given.
- **The tools** (`lib/tools/registry.ts`). Six tools; `overview`, `describe`, `search`, `imports` and `architecture` carry `alwaysLoad`; `show_on_map` is deferred. **Measured** (a scratch script, as `registry.test.ts` measures): the five definitions take 4,733 characters and the instructions 1,169, **5,902 together** against the test's 7,000.
- **What a character costs a turn.** In Eval #2, N's first call read 1,720 tokens more than A's for 4,733 characters of definitions and wrote 371–372 more for 1,036 characters of instructions (report-ttrc-and-cost-floor.md, Task 2): **about 2.75 characters a token**. So 7,000 characters is about 2,545 tokens, above gate condition 6's 2,500. Eval #2 measured +2,094 tokens at 5,769 characters; item 3 added 133. A first draft of the `calls` definition measured 1,361 characters (7,236 in all); the texts Task 4 pins measure **6,614** in all, about +307 tokens over Eval #2's, so about +2,400 (R-Q).
- **The eval harness.**
  - `scripts/eval/definition.ts`: name, claudeVersion, pins, repos, arms, repeats, scripts, an optional `shell` (`"compound"`, off in both evals), pilot, pilotSessions.
  - `run-config.ts`: `promptFor(question, formats, scratch?)` appends Eval #2's scripts sentence; `claudeArgs` and `sessionArgs` take `{ scratch, shell }`; `scratchFolder` gives forward slashes.
  - `run.ts`: each repo's root is forward-slashed (`C:/Users/…/vscode`); the index line is `{ name, startedAt, endedAt, ...RunSummary, resultNotes, repo, indexVersion, scratch }`.
  - `transcript.ts`: `RunSummary` has no refusal count. `score.ts` writes each run's `summary` into `results.json`, so a new `RunSummary` field would change Eval #2's re-score bytes.
  - `score.ts`: `gated` for several repos or any `kind`; the heading is "Ship gate (D1)", Eval #2's gate (the V1.6 plan's D1); `results.json`'s `commit` is `file.commit`, which `eval2/questions.json` lacks (V1.6 final review B-12); `missingForGate` counts repeats 1..`repeats`, but the gate takes every loaded run (B-9).
  - `gate.ts`: Eval #2's gate, the V1.6 plan's D1: seven conditions with fixed kind lists.
  - `build-truth.ts`: eight kinds; the independence pin (`scan.test.ts` L213) covers `scan.ts`, `truth.ts`, `resolve-truth.ts` and `ts-graph.ts`, not `build-truth.ts` or `definition.ts` (B-8).
  - `grading.ts`: sheets carry the answer unredacted and print how many mention "nebulosity" or "mcp__".
- **The evidence.** `evidence/e2/out/checker.json`: TypeScript's checker over VS Code's `src/tsconfig.json` (10,237 roots, 10,038 files under `src/` analysed), 7,347 calls named one of the five planning methods, each with its owners (an interface, or a class with `implementsTarget`); 21.5 s to build, 4,998 MB at peak, 0 errors. `evidence/e2/out/affine-sites.json`: the syntactic L3 sets for AFFiNE's three planning methods. `evidence/ttrc/`: the reference scripts for time to relevant context (`ttrc.js`, `confound.js`: mulberry32, a percentile bootstrap with linear interpolation).
- **The fixture this plan adds was checked in a scratch copy:** tsc reports 0 errors under its own tsconfig (with `@di/infra` resolved the way `resolve-truth.ts` resolves a workspace package), and the type checker's call sets equal the ground truth below, the one inferred call (`src/workbench/history/inferred.ts`) being the only call the index must not see.
- **Shapes in the real repos, read-only:** AFFiNE passes services as typed destructured parameters (`packages/frontend/core/src/commands/affine-help.tsx` L9–17: `{ …, workspaceDialogService }: { …; workspaceDialogService: WorkspaceDialogService }`), gets them with `useServices({ GlobalSessionStateService })` (keys uncapitalized on the left), and registers them with `framework.service(AIReasoningService, [GlobalStateService])`. VS Code's test doubles are `class TestFileService extends mock<IFileService>()` and inline `new class extends mock<IFileService>() { … }`; `IFileService` is both `export const IFileService = createDecorator<IFileService>('fileService')` and `export interface IFileService`. Theia injects with `@inject(CommandRegistry) protected readonly commands: CommandRegistry` (design §3).

---

## Decisions

### Settled by the owner in design (2026-10-15, verbatim, design §2)

"Items 3 and 4"="Plan carries them (Recommended)" (moot: both landed, `9a81681`, `7d994e1`, `49f8bbd`), "How should Eval #3's questions be sourced?"="Real issues, PRs, docs (Recommended)", "Which shell set-up should Claude Code get in Eval #3, the same alone and with Nebulosity?"="Rules sentence + checks (Recommended)", "What should V1.7 build for E2, the call graph through injected services?"="Calls index + calls tool (Recommended)", "Which repos should Eval #3 use?"="Add Theia, held out (Recommended)", "What size and budget for Eval #3?"="Full, 3 repeats (Recommended)", "How high should the time-to-context bar be (condition 1, on each repo)?"="4x, as drafted (Recommended)", "Accuracy condition (condition 2): what should Eval #3 require?"="Half the errors (Recommended)", "Given what the floor did on Eval #2's data, which "seen" rule should the gate use?"="Named anywhere (Recommended)", "With those set, write the V1.7 plan from this design?"="yes, write the plan as planned. but give me the prompt for the plan so i can write it in a new session".

### The plan's approval (2026-10-15, verbatim)

The owner, after the pre-flight scan's fixes: "ik the session got compacted midway so i wanna make sure everything is correct and aligned and consistent. do one runthrough of it, and if it looks good then i approve and u give me the prompt so i can start in a new session".

The runthrough (a fresh end-to-end reader, plus mechanical checks) found no blocking issue and nothing that changes a decision. Its fixes are in this text, R-AL among them. The ledger lists them (`progress.md`, "## Planning").

### Terms

An **arm** is one of the two set-ups compared: **A**, Claude Code alone (`baseline` in run names), and **N**, Claude Code with Nebulosity's MCP server (`nebulosity`). Everything else is the same. Prose says "alone" and "with Nebulosity"; tables say A and N.

### The order of the work

| Part | Tasks | What it does | Rough time |
|---|---|---|---|
| 0 Start | 0 | the baseline, the ledger, the owner's approval | minutes |
| 1 The engine | 1–7 | the fixture and the call facts, the store, the engine, the `calls` tool, Calls Benchmark #1 (stop if under target), S1 and the first answer, S6 | about a day |
| 2 The harness | 8–13 | the definition and the rules sentence, time to relevant context and the stats, the call truth, the new kinds, Eval #3's gate, grader redaction | under a day |
| 3 Probe, shell check, dev set | 14–16 | the guard probe (ask), the shell check (ask; stop if it fails), the dev set's tool use (stop if under 0.90 after three rounds) | a few hours, plus the runs |
| 4 Theia | 17 | the clone (stop), the index, its resolution share | an hour, plus your yes |
| 5 Eval #3's questions | 18 | candidates, the seeded draw, prompts, truths, rubrics, the method (stop) | a few hours, plus your review |
| 6 Eval #3 | 19–23 | freeze and pilot (stop), full run, grading (stop), verdict (stop), close-out (stop) | 1–2 days, set by the runs' usage windows |

**Why this order.** The engine comes first because the dev set tunes a tool that must exist, and its measured targets decide whether it is done. The harness comes before the dev set because the dev set runs through it. Theia is cloned after the dev set, which never touches it (it is held out). The questions are written after the dev set (R1 of V1.6, kept), so tuning never sees them. The engine freezes before the pilot (R-N).

**About 3–5 days of build-session time**, design §5.7: Eval #3's results around 2026-10-19 to 10-21, about a week before applications open. **Cut, in this order, if time runs short:** (1) S6 (Task 7); (2) the new big-picture questions (Eval #2's stay as the no-loss check); (3) the sessions; (4) Theia's task questions; (5) the call rules beyond L2 plus `new` and the provider calls (report recall instead). **Never cut:** the engine's measured targets, the shell check, validity condition V, or the gate as approved.

### D1. The ship gate for Eval #3 (approved 2026-10-15; fixed before any run; it doesn't change after the first run)

"New questions" means the DI, task and Theia graph questions. A ratio is per question (N's median ÷ A's median), then the median over the questions in the set. Intervals resample questions (seeded). **All must hold.**

| # | Condition | Measured over |
|---|---|---|
| V | **Valid:** at most 5% of each arm's runs have a refused command (`permission_denials` > 0). Otherwise the gate fails, and the results say the comparison is confounded. | every run, each arm |
| 1 | **4× faster to the relevant context:** the median per-question TTRC ratio, from process start under the plain "named anywhere" rule, is ≤ 0.25, and the upper end of its 95% interval is ≤ 0.50 | each repo's new file-set questions, each repo separately |
| 2 | **Half the errors:** N's mean error ≤ 0.5 × A's mean error (error = 1 − score); and on each repo, N's mean ≥ A's − 0.02 | all new questions, repos pooled; the floor per repo |
| 3 | **Faster and cheaper end to end:** median per-question ratio of `duration_ms` ≤ 0.5, and of cost ≤ 0.5 | each repo's DI and task questions |
| 4 | **No loss elsewhere:** big-picture (Eval #2's and new, pooled) N ≥ A − 0.03 with cost ratio ≤ 1.15; Eval #2's graph questions N ≥ A − 0.03 with cost ratio ≤ 1.0; the session N ≥ A − 0.03 | each repo where it has them |
| 5 | **Tools used:** ≥ 0.90 of N's runs call a Nebulosity tool | N's runs on new and graph questions |
| 6 | **Cheap per turn:** N's median first-call context ≤ A's + 2,500 tokens | each repo |

- **Score** is the kind's score, and an error is 1 − score.
- **Cost** is Claude Code's `total_cost_usd` and **time** is `duration_ms`. TTRC is defined in D2.
- A run that hits its turn or budget limit scores 0 and counts. Outages are re-run (Eval #1's rule).
- **Computed only on complete data:** every repo, and every scheduled run kept in both arms. A condition with nothing to compare fails, and the gate passes only when every condition passes.

**How `scripts/eval/gate3.ts` computes it** (fixed here, written into ADR-060 and Eval #3's method before the first run):
- *Runs.* Single runs and session runs of arms A and N, repeats 1..`repeats` only (B-9). A refused command is a run whose transcript holds a denied tool result (R-V).
- *V* counts each arm's single and session runs together.
- *1.* For each repo, the new questions whose kind is a file set (callers, breaks, adopt, injects, task, list-direct, list-transitive, chain, cycle, unused, violations, entries) and whose needed set is non-empty. Per question: the median of A's TTRCs and of N's, a run that never reached counting as infinitely late; the ratio N ÷ A, with A never reaching → 0, N never reaching → ∞, both never reaching → 1. The statistic is the median of those ratios; the interval is a 95% percentile bootstrap over the repo's questions, taken in order of their ids (10,000 resamples, mulberry32 seed 1, quantiles by linear interpolation).
- *2.* Means over runs (questions × repeats). Pooled: every new question of every repo. The floor: each repo's new questions.
- *3.* Per question, the ratio of N's median `duration_ms` to A's, and of N's median cost to A's; then the median over each repo's DI and task questions.
- *4.* Per repo: big-picture runs (Eval #2's and new) by mean score, and the median over those questions of the per-question cost ratio; Eval #2's graph questions likewise with ≤ 1.0; the session by mean session score. A repo without a set skips it (Theia has no Eval #2 question and no session).
- *5.* N's single runs on new questions and on Eval #2's graph questions, all repos pooled: the share with at least one Nebulosity tool call.
- *6.* Per repo, the medians of the single runs' first-call context.
- *Numbers.* Comparisons use unrounded values with a tolerance of 1e-9; printed values are rounded to 4 decimal places; a ratio over an A value of 0 is 0 when N's is 0 too, else infinite.

### D2. Eval #3's shape (approved; details fixed here)

- **Repos.** VS Code at `cc3fec8846d0e678357e476fa611774da26d7e24`, AFFiNE at `0b69a6da21e8fd35beb85667bb8496d9b3852238`, and Theia (`eclipse-theia/theia`) at the head of `master` when Task 17 clones it, held out (no dev question touches it) and indexed in free mode (R-K).
- **Arms.** A and N, registered as in Eval #2 (`{ "command": "node", "args": ["<checkout>/mcp/launch.mjs"], "env": { "NEBULOSITY_LIVE": "off" } }`). Scripts on in both arms. Three repeats. `claude-sonnet-5-5` at medium effort (R-E).
- **The questions and runs** (design §5.4):

| Repo | DI (calls) | Tasks | Graph | Big-picture | Session | Runs (2 arms × 3) |
|---|---|---|---|---|---|---|
| VS Code | 6 | 3 | 9 (Eval #2's) | 5 (Eval #2's) + 2 new | 1 (Eval #2's) | 150 + 6 |
| AFFiNE | 5 | 3 | 9 (Eval #2's) | 4 (Eval #2's) + 2 new | 1 (Eval #2's) | 138 + 6 |
| Theia (held out, free mode) | 4 | 2 | 6 new | 2 new | none | 84 |
| **Total** | 15 | 8 | 24 | 15 | 2 | **384** |

- **Eval #2's questions reused unchanged** (R-I): the first question of each kind per repo in `eval2/questions.json`'s order. VS Code: `vscode-cl1`, `vscode-cl4`, `vscode-cn1`, `vscode-impact`, `vscode-cycle`, `vscode-unused`, `vscode-violations`, `vscode-entries`, `vscode-pairs`, `vscode-bp1`–`vscode-bp5`, session `vscode-s1`. AFFiNE: `affine-cl1`, `affine-cl4`, `affine-cn1`, `affine-impact`, `affine-cycle`, `affine-unused`, `affine-violations`, `affine-entries`, `affine-pairs`, `affine-bp1`–`affine-bp4`, session `affine-s1`. Their truths, verdicts and rubrics are copied unchanged.
- **The new kinds and their scores:** `callers`, `breaks`, `adopt` and `injects`, F1 over files with recall and precision beside it; `task`, two parts (CHANGE and TESTS, R-U), each F1, the task's score their mean. The mix (R-X): VS Code 2 callers, 2 breaks, 1 adopt, 1 injects; AFFiNE 1, 2, 1, 1; Theia 1 callers, 2 breaks, 1 injects. Theia's six graph questions are file-set kinds (R-W).
- **The rules sentence** (R-L, pinned), ending every prompt of both arms after the format line, in place of Eval #2's scripts sentence; `<repo root>` and `<scratch>` are absolute paths in drive-letter form with forward slashes:

  > You're at the repository root, `<repo root>`: run grep, git grep, git ls-files, ls, cat, head and the like from here, without cd. To compute anything, write a Node.js script into `<scratch>` with the Write tool (the folder exists) and run it with node, or use node -e. Shell writes (redirects, heredocs, tee, sed -i, mkdir), loops, sed, awk, xargs and paths through .. are refused here. Don't change any file in the repository.

  (The backticks above only mark the placeholders; the sentence carries the bare paths.) No allow rule is added; item 4's `"compound"` preset stays off.
- **The call rule sentences** (pinned; `<T>`, `<m>` and the declaring file are named in backticks in each prompt):
  - *callers* and *adopt:* `Count a file if it calls <m> on a value whose type is <T>, a type that extends <T>, or a class that implements <T> (directly or through a base class); test files count.`
  - *breaks* (and a task's CHANGE): `Count a file if it calls <m> on a value whose type is <T>, a type that extends <T>, or a class that implements <T> (directly or through a base class), or if it declares <T>, a type that extends <T>, a class that implements <T> or a class that extends mock<<T>>(), where that declaration defines <m>; test files count.`
  - *injects:* `Count a file if it receives <T> through a constructor parameter typed <T>, a field decorated @inject(<T>), or a call that asks a service container or hook for it (get(<T>), getOptional(<T>), useService(<T>), useServiceOptional(<T>) or useServices({ <T> })); test files count.`
  - *a task's TESTS:* `A test file should run if it is among the files to change or directly imports one of them, counting imports by this rule: <the import rule>. A test file has a folder named test, tests or __tests__ on its path, or .test. or .spec. in its name.`
  - On VS Code every call prompt adds `Count only files under src/.` (R-R).
- **The new kinds' prompts** are built by `scripts/eval/prompts.ts` (Task 15), from fixed stems, with `<T>`, `<m>` and the declaring file in backticks:
  - *callers:* ``List every file that calls `T.m` (`T` is declared in `<file>`).``
  - *breaks:* ``If the signature of `T.m` changes (`T` is declared in `<file>`), which files have to change? List them.``
  - *adopt:* ``<the change, in its source's words> List every file with a call to `T.m` that would have to adopt it (`T` is declared in `<file>`).``
  - *injects:* ``List every file that has `T` injected (`T` is declared in `<file>`).``
  - *task:* ``I'm changing the signature of `T.m` (`T` is declared in `<file>`): <the change, in its source's words> Plan it: which files will I have to change, and which tests should I run?``
  - Each stem is followed by its call rule (a task's by the breaks rule, then the tests rule), then the scope sentence when the question has one: `Count only files under <folder>/.` (a task's adds `, in both lists`). Every VS Code call question has one: `src/` or a folder inside it (R-R, R-AI).
  - The tests rule's import clause is pinned (R-AH): `counting imports by this rule: any import, export … from, side-effect import, import() or require() statement that refers to the file counts, type-only imports included.`
- **Format lines** (in `eval3/questions.json`'s `formats`): `callers`, `breaks`, `adopt` and `injects` take Eval #1's list line; `task` takes: `End with a line that says ANSWER CHANGE: and then every file to change, one path per line relative to the repository root; then a line that says ANSWER TESTS: and then every test file to run, one per line, with nothing after the list.` The other kinds keep Eval #2's lines.
- **Time to relevant context** (design §5.3, fixed now):
  - *Scope:* single runs whose truth is a set of files: callers, breaks, adopt, injects, tasks (the union of their parts), lists, chains, cycles, files nothing imports, violations and entries. Count answers (impact, pairs) and big-picture answers are left out; they report time and score. A question whose answer is "none", or a chain or cycle with no file strictly between its ends, is left out.
  - *Needed files,* fixed before the first run from the truth (`eval3/truth/needed.json`, Task 9's `eval:needed`). For chains and cycles: the files strictly between the ends of every shortest valid path in the truth's graph, as a shortest-path DAG; one full path's files reach it.
  - *Seen:* a needed file is seen at a main-conversation `user` event carrying tool results, when it is named by the result's text, or by the call it answers (Read's `file_path`, Grep's and Glob's `path`, any path in a Bash command that wasn't refused).
  - *The plain rule is gated:* any result naming a needed file counts, however much else it names.
  - *Reported beside it, never gated:* the mostly-relevant version (a result, with its call, counts only if at least half of the distinct tracked repo files it names are needed; a Read of one file names that file), and tokens to relevant context.
  - *Matching:* whole path tokens after `\` becomes `/`, ignoring case, with the repo-root prefix and a leading `./` removed and a trailing `:line` allowed; relative paths are resolved against Claude Code's working folder, as the executed `cd` commands have left it; a paged result counts only for what it prints.
  - *Reached:* the first event after which every needed file has been seen. *TTRC:* that event's `timestamp` minus the run's `startedAt` (from process start: the gate's). Also reported: from the query start, the last event's timestamp minus `duration_ms` (R-F).
  - *Tokens to relevant context:* input + cache-write + cache-read of every main-conversation API call before that event, counted once per message id.
  - *Never reached:* infinitely late in medians; the run's final coverage and the reached share are reported.
  - *Eval #2's references* (references, not bars): plain rule from process start, matched per question, VS Code 0.33 and AFFiNE 0.29 with all runs, pooled 0.29 [0.21–0.33] with all runs, pooled 0.31 [0.23–0.58] on refusal-free runs; pooled 0.27; the floor version pooled 0.17 from process start, with N's entries runs never reaching under it.
- **The checks before the first run:** the guard probe (Task 14); the shell check (Task 15: at most 1 refused command per 10 runs in each arm, and no run that gives up after a refusal); the pilot's refusals against V (Task 19, its two sessions included).
- **Spending, asked for each time with the count:** the guard probe (1 run), the shell check (38 runs: 19 dev questions in both arms), a re-run after a rewording (its count), the dev set's further tool-use rounds (at most 16 N runs), Theia's clone (its size), the pilot (28 runs: 24 single and 4 session), the full count (the remaining 356 runs: 348 single and 8 session). Estimate $35–55 at list price (Eval #2 was $22.26 for 270).

### D3. The `calls` tool (pinned; API_CONTRACTS §17)

- **Name and loading:** `calls`, the seventh tool, always loaded (`_meta["anthropic/alwaysLoad"]: true`); `show_on_map` stays deferred.
- **Description:** `Who calls a method of a class or interface, through declared types: injected services, fields, parameters, locals and base classes. With a method: its callers, its implementations and what changing it touches; with a type: where it is injected. Prefer it to grep.`
- **Input:** `symbol` (required; `"IFooService", or a method: "IFooService.save".`), `path` (`Its file, if two types share the name.`), `group_by` (`Count by area: a folder ("" the top level) or "auto".`), `within` (`Only files inside this folder.`), `limit` 1–500, default 50 (`Files to list, 1 to 500.`, R-J), `offset` ≥ 0 (`Where the next page starts.`). The exact zod schema is Task 4's.
- **Instructions bullet,** after the `imports` bullet: `- calls: who calls a method, even through injected services, and what changing it touches;`
- **The answer** is Task 4's exact text, shown on the fixture in the ground truth below: a header naming the type, where it is declared and the totals; what the receivers were typed as; the areas; the files with their lines, paged; on the first page, what a change to the member's signature touches and the implementations; and the note on what declared types can't see. Ambiguous names list their candidates and ask for `path`.

### Rulings (from design §6, carried; each with its cost if wrong)

- **R-A. Planning targets stay out of Eval #3.** IFileService.readFile, IStorageService.store, IConfigurationService.getValue, ICommandService.executeCommand and IEditorService.openEditor on VS Code; WorkspaceDialogService.open, GraphQLService.gql and GlobalDialogService.open on AFFiNE. They may be dev-set or Calls Benchmark targets. *Cost if wrong:* none.
- **R-B. Calls resolve at query time, cached per index version.** Index-time resolution only if the first answer takes more than 1.5 s (Task 6's fallback). *Cost if wrong:* every eval run pays the first call's build, inside N's TTRC (conservative).
- **R-C. No Map UI for calls in V1.7.** *Cost if wrong:* the Map can't show calls until E5 or later; `show_on_map` can still highlight the files.
- **R-D. "Who to ask" is dropped from the tasks.** *Cost if wrong:* one task part fewer.
- **R-E. Model and version:** `claude-sonnet-5-5` at medium effort; Claude Code pinned at the pilot (2.1.300 at design, 2.1.301 at the plan's approval; Eval #2 ran on 2.1.300). *Cost if wrong:* comparability with Eval #2.
- **R-F. TTRC's start** is `startedAt`, conservative toward N; the query start is reported beside it; single runs keep stdin prompts. *Cost if wrong:* N's ratio carries about 0.57 s of its server's start.
- **R-G. Count answers are left out of TTRC;** impact and pairs report time and score.
- **R-H. No work on N's cost floor;** the server instructions stay short. *Cost if wrong:* at most about 5% of N's floor.
- **R-I. Eval #2's no-loss questions** are the first of each kind per repo, all big-picture questions and each repo's first session (D2), never picked by results.
- **R-J. `calls` pages at 50 by default,** as ADR-045, unless the dev set shows N not paging.
- **R-K. Theia runs in free mode,** with no summaries; its big-picture questions test free mode's no-loss.
- **R-L. The rules sentence** is D2's, reworded at most once after the shell check, the change recorded verbatim.
- **R-M. Grader redaction** happens before the blind sheets (scope: R-AD).
- **R-N. The engine freezes at the pilot** (`EVAL3_ENGINE`); a bug found later is recorded and fixed after the results.

### Rulings made in this plan (say if you disagree)

- **R-O. Nested classes and class expressions with a heritage clause are recorded** as type declarations, with `nested: true` and their name if any, so an inline test double (`new class extends mock<IFoo>() { … }`) counts among the implementations. Only top-level ones resolve by name. *Cost if wrong:* a few more rows.
- **R-P. Files of 1–5 MB, parsed in full for their imports, get call facts too;** only the token-scanned files (5–20 MB) get none. VS Code's three 1.0–1.6 MB agent-host tests are inside the checker's program, so leaving them out could cost recall. *Cost if wrong:* those three files' rows; nothing else.
- **R-Q. The size budget is 6,650 characters** for the six always-loaded definitions and the instructions (was 7,000): at 2.75 characters a token, 7,000 is about 2,545 tokens, over condition 6's 2,500. Task 4 pins the texts: the shared path description shortened, `architecture`'s `report` and `through` descriptions dropped (its description says both), `imports`' `to` and `group_by` descriptions shortened, `describe`'s and `search`'s descriptions tightened; measured 6,614 on the planning draft. *Cost if wrong:* slightly shorter wording on the five existing tools.
- **R-R. VS Code's call questions count files under `src/` only,** the files of the checker's program (`src/tsconfig.json`). *Cost if wrong:* a caller outside `src/` isn't asked about (none is expected for internal services).
- **R-S. "Injected" is D2's rule:** a constructor parameter typed T, a field decorated `@inject(T)`, or a container or hook asked for T, exactly T, not its subtypes. *Cost if wrong:* an injects truth differs from a reader's sense of "injected"; both arms read the same rule.
- **R-T. "What breaks" is the callers plus the declarations that define m:** T itself, a subtype, an implementation or a test double (D2's sentence). *Cost if wrong:* T's own file is one more file in each truth.
- **R-U. A task has two parts:** CHANGE, the breaks set of the task's T.m, and TESTS, the test files among CHANGE or directly importing a file of CHANGE (the import rule). Each is F1; the task's score is their mean; a missing ANSWER block scores that part 0. *Cost if wrong:* tasks measure only these two parts.
- **R-V. Eval #3's new results fields are written only when the definition sets `"gate": "eval3"`:** TTRC per run, refusals per run, and each repo's commit (B-12). Refusals are counted from the transcript's denied tool results by a new function, never added to `RunSummary`, so Eval #2 re-scores byte for byte. *Cost if wrong:* Eval #2's `results.json` keeps its missing commit (already disclosed).
- **R-W. Theia's six graph questions are file-set kinds:** list-direct, list-transitive, chain, cycle, files nothing imports, entries. *Cost if wrong:* no impact, pairs or violations question on Theia.
- **R-X. The DI mix** is D2's; a repo whose sourcing finds no adopt candidate gets a callers question instead, recorded. *Cost if wrong:* one kind fewer on that repo.
- **R-Y. The pilot:** per repo one breaks question, one task, one new big-picture question and one chain (Eval #2's first chain on VS Code and AFFiNE, Theia's chain), plus Eval #2's first session on VS Code and on AFFiNE: 12 questions and 2 sessions, 28 runs. The sessions are in because in Eval #2 every session run by Claude Code alone had a refused command (18 of 18), and V counts sessions. *Cost if wrong:* 4 more runs before the full count.
- **R-Z. The dev set:** 19 questions (VS Code 10, AFFiNE 9), so the shell check covers every kind (design §5.3):
  - the five new kinds on the planning methods (R-A);
  - Eval #2's dev targets for the graph kinds;
  - one big-picture question per repo.

  None is on Theia, and none shares a target with Eval #3's questions, the reused ones included. VS Code's call questions are each scoped to one folder, about 20–60 caller files by the design's checker evidence. In Eval #2, refusals hit big-picture runs (7 of 27 alone, 5 of 27 with Nebulosity) and every kind of graph question, so no kind is left out. *Cost if wrong:* 38 runs instead of about 24, about $2 more.
- **R-AA. Tool-use tuning re-runs only N's misses,** at most two more rounds (16 runs at most), with the earlier round's transcripts moved aside first (the runner skips a run whose transcript is kept). Every wording change stays within R-Q's budget. The dev set's first-call difference must stay at or under 2,400 tokens per repo (a 100-token margin), else the texts are trimmed before the freeze, in Task 16's order. R-Q's texts put it at about +2,400, so a trim is likely. *Cost if wrong:* one more wording round.
- **R-AB. Calls Benchmark #1 compares file sets the way the checker files calls.** "Interface calls": the files whose calls the index puts on T, or on a sub-interface of T that doesn't declare m (the checker resolves those to T's member). "Interface + implementation": those, plus the calls the index puts on an implementation. A call on a sub-interface that redeclares m is reported apart. *Cost if wrong:* that rare case isn't compared.
- **R-AC. The owner's index is written three times, each announced:** Task 5 re-indexes VS Code and AFFiNE (adapter version 5 parses every file once; content hashes and summaries stay); Task 17 indexes Theia with `--no-activate`.
  - More writes come only with a Task 5 round that changes the adapter (its version goes up, so the re-index parses again), Task 6's fallback, or a re-index at Task 19 after an engine change. Each is announced, and Task 19's is asked for.
  - Between Task 2's push and Task 5's re-index, the owner's registered MCP server sees a migration its database lacks, so it answers every call with the index-older-than-the-checkout error. The owner is told at Task 2.
  - *Cost if wrong:* the Map refetches once per write.
- **R-AD. Redaction scope:** "Nebulosity", `mcp__nebulosity__<tool>`, and a tool's name when it is written as a tool become neutral words. A tool's name counts as written as a tool when it is in backticks before "tool", "call", "answer" or "result", or bare before "tool". Ordinary words such as "the search results" or "the overview answers" stay. The neutral words: "a search" for a tool, "the" for "Nebulosity's", "the index" for Nebulosity. "The index" and "the import graph" stay: they are ordinary words, and the sheets' count of them is disclosed. *Cost if wrong:* a grader can still tell some N answers apart, as Eval #2 disclosed (3 of its 54 sheets named the tool).
- **R-AE. The ledger** is `.superpowers/sdd/2026-10-15-v1-7-calls-and-context/progress.md` (gitignored), with the design and evidence beside it.
- **R-AF. One type per repo in the draw:** the draw goes kind by kind (breaks, task, callers, adopt, injects, then the graph kinds), and a type drawn once leaves that repo's later pools. *Cost if wrong:* a pool can run short sooner; R-X's fallback covers adopt, and any other shortfall is recorded.
- **R-AG. A calls answer may name its type's own file:** where the truth doesn't hold the declaring file, naming it lists nothing, as an entries answer's target doesn't (Eval #2's sweep B). *Cost if wrong:* an answer that wrongly lists the declaring file as a caller isn't marked down for it.
- **R-AH. The tests rule's import clause** is Eval #1's import rule, reworded to fit the sentence (D2's text). *Cost if wrong:* wording only.
- **R-AI. A call candidate may be scoped** (`within`) only to a folder its source names; VS Code's are at least `src/`. Its size for the 10–80 filter is counted within that folder. *Cost if wrong:* fewer candidates pass the filter.
- **R-AJ. Eval #2's verdicts carry over:** `eval2/truth/adjudicated.json` and `steps.json` become Eval #3's for VS Code and AFFiNE, since they are facts about the same commits. *Cost if wrong:* none.
- **R-AK. ADR-051's amendment follows the owner's call after design** (design §5.8, verbatim there): after Eval #3 the hold lifts whatever the outcome, and the gate decides what the README may claim. Three older lines say the hold waits on a passed gate, and all were written before that call: design §8, §9, and CLAUDE.md's "stays until a gate passes". CLAUDE.md is gitignored and the owner's: its line on the hold is brought up to date with the rest of its current state at Task 23 (local only, never staged), unless the owner changes it first. *Cost if wrong:* one ADR sentence.
- **R-AL. Calls Benchmark #1's bar is judged on the five VS Code methods pooled:** file-level sums over the methods, for interface calls and for interface + implementation calls, since design §5.1 states one bar, not one per method. Each method's recall and precision are reported beside the pooled numbers, and a method under 0.98 or 0.99 has its misses read and classed. AFFiNE's three methods are reported against their adjudicated L3 sets. *Cost if wrong:* one method can sit under the bar while the pool passes; the per-method numbers show it.

---

## Global Constraints

- **Branch:** `pivot/v1`. **After every completed step that changes files (each task, each fix, each doc update), commit and push.** Commit by path, so nothing another session staged rides along:
  `git add -A -- <paths> && git commit -m "<message>" -- <paths> && git push origin pivot/v1`.
- **Authorship:** conventional prefixes (`feat:`, `fix:`, `test:`, `perf:`, `refactor:`, `docs:`, `chore:`, `ci:`). **No `Co-Authored-By` line and no Claude attribution anywhere, in commits or PRs.**
- **The owner's files:** never stage `docs/LEARNING_NOTES.md`, `lib/agent/state.ts` or `CLAUDE.md`; never edit `lib/agent/state.ts`; leave `lib/agent/tools.ts` as it is.
- **Gate before every commit:** `npx tsc --noEmit && npm run lint && npx vitest run`, all clean. The 4 lint warnings that predate the plan are fine; errors are not. The suite starts at **1,340**; each task says about how many it adds, and the ledger records the real count.
- **Test expectations are derived by hand** from the fixtures' ground truth (the V1.1 plan's mini-repo, the V1.6 plan's arch-repo, this plan's di-repo below) or from hand-built inputs in the test. Never run the code and paste its output into a test.
- **No network in tests:** no test starts `claude`, `git clone` or `npm`, and nothing loads the embedding model. The type checker runs in one test file only, on the di-repo fixture (Task 10).
- **The owner's Map and database:**
  - Never send live events to port 3000, and never stop anything there without asking. Check it before Tasks 5, 6, 7 and 17 (`netstat -ano | grep LISTENING | grep -E ":3000\b"`).
  - Measurements use a scratch data folder (`NEBULOSITY_DATA`) and servers on another port with `NEBULOSITY_WORKER=off`.
  - Builds that write `.next/` run in the sandbox worktree `../Nebulosity-build`.
  - Only R-AC's writes touch the owner's index, each announced first (a Task 19 re-index, if one is needed, asked for).
- **Anthropic calls, `claude -p` runs, downloads: ask before each, with the count or size first** (D2's spending line). The blind graders are subagents of the controller's session, not `claude -p` runs.
- **Layering (ARCHITECTURE.md §3):**
  - Nothing under `lib/` imports `app/`, `mcp/`, `scripts/`, `bin/`, `next` or `react`.
  - All SQL stays in `lib/db/*`; the call facts' types live in `lib/db/schema.ts`.
  - `scripts/eval/scan.ts`, `truth.ts`, `resolve-truth.ts`, `ts-graph.ts`, `ts-calls.ts`, `build-truth.ts`, `definition.ts`, `context.ts`, `stats.ts`, `needed.ts`, `prompts.ts` and `draw.ts` import nothing from `lib/`, directly or through the other files of `scripts/eval` they import (R2, B-8). `scan.test.ts`'s independence pin lists all twelve and follows their relative imports (Tasks 9, 10, 15 and 18 extend it). Task 10 moves `SHELL_PRESETS` into `definition.ts`, so `definition.ts` no longer imports `run-config.ts`, which imports `lib/demo/privacy`.
- **Contracts:** `lib/contracts.ts` doesn't change (the calls answer's types live in the engine, as `ArchitectureAnswer` does); `CONTRACTS_VERSION` stays 3.
- **Writing files:** use the Write and Edit tools for any file holding backslashes or `\n`. Docs are CRLF in the working copy (`core.autocrlf=true`): keep them CRLF. In Git Bash, pass paths to `claude -p` as `C:/…`.
- **Scripts:** never run `python -` or pipe a heredoc into an interpreter; write scratch scripts with the Write tool into the session's scratchpad and run them with node or `npx tsx`.
- **Docs change in the same commit as the design they describe.** Replace each `‹today›` with the commit's date and each `‹…›` measurement with the measured value. A doc this plan wrote as "Proposed (V1.7 plan, 2026-10-15)" is updated by the task that measures or builds it.
- **The ledger** records each task's commits and test count, every ruling with its cost if wrong, every owner decision verbatim, and every run's id, usage and validation result.
- **Stop points:**
  - this plan (now);
  - Task 5 (Calls Benchmark under target after three rounds);
  - Task 6 (S1 over 60 s);
  - Task 15 (the shell check, if it fails);
  - Task 16 (tool use under 0.90 after three rounds);
  - Task 17 (Theia's clone);
  - Task 18 (Eval #3's questions);
  - Task 19 (before the pilot, then the full count);
  - Task 21 (the grade disagreements);
  - Task 22 (the verdict);
  - Task 23 (before the PR).
- **Asks, each a stop until the owner says yes:**
  - Task 14 (the guard probe, 1 run);
  - Task 15 (the dev set, 38 runs; and a re-run after a rewording);
  - Task 16 (each further round, and R-J's re-run);
  - Task 17 (the clone);
  - Task 19 (a re-index after an engine change; the pilot, 28 runs; then the full count).
- **Never:** deploy, make the repo public, publish to npm, or change a GitHub setting. Those are the owner's, after Eval #3's verdict (R-AK).
- **Target repos** (`../vscode`, `../affine`, `../theia`) stay unmodified; the runner checks `git status --porcelain` after every run, and `ts-calls.ts` only reads.

## Review Focus

Five inputs most likely to hurt a real user that the design doesn't spell out. Each names the test that pins it.

1. **Heritage and re-export loops.** Broken or generated code can say `class A extends B` and `class B extends A`, or two barrels can `export *` from each other. Resolution must stop, with no hang and no stack overflow. Task 3: an inline fact set with an extends cycle and an `export *` cycle answers in one call, and the cycle's members are listed once.
2. **One name, several declarations in a file.** `export const IFileService = createDecorator<…>(…)` beside `export interface IFileService`, an interface declared twice (declaration merging), or a class and an interface of the same name. They must be one type, members merged, and `accessor.get(IFileService)` must resolve to the interface. Task 1: two `interface IFoo` blocks give one declaration with both blocks' members and heritage; Task 3: the fixture's `files.ts` resolves through both meanings.
3. **A method called from hundreds of files** (`getValue` is called in 723 files in VS Code). Its answer pages, its totals stay whole, and every page stays under 40,000 characters, the "if its signature changes" list included. Task 4: a hand-built answer with 2,000 files and 500 extra declaring files stays under `MAX_ANSWER_CHARS` on every page, with the cut lines right. Its paths are long enough that the size cap, not the limit, cuts each page.
4. **Windows paths in transcripts.** Grep prints `src\vs\a.ts:12:…` relative to a folder a `cd` moved to; Read takes `<vscode>\src\vs\a.ts`; case differs. Task 9: hand-built transcripts with backslashes, a moved working folder, a refused `cd` that doesn't move it, mixed case and a `:line` suffix all match, and a longer path that merely ends with a needed one doesn't.
5. **A session or a run whose refusals sit in several results.** A task session's refusals are spread over four messages; a refusal must count whichever message it falls in, and a denied Write as well as a denied Bash. Task 8: `refusedCalls` on a hand-built two-message session with one denied Bash and one denied Write counts 2, and on a run with none counts 0.

## File map

| File | Status | Responsibility |
|---|---|---|
| `test/fixtures/di-repo/**` | create | the calls fixture: VS Code-, AFFiNE- and Inversify-style injection, a sub-interface, a base class holding the field, barrels and re-exports, two types named alike, test doubles, `new C()` through `store.add` and `_register`, and one call on an inferred type (ground truth below) |
| `lib/db/schema.ts` | modify | the call facts' types (`CallFacts`, `TypeDeclFact`, `BindingFact`, `TypedCallFact`, `CallRule`); tables `type_decls`, `call_bindings`, `typed_calls` |
| `lib/db/migrations/0009_v1_7_calls.sql` (+ meta) | generate | the three tables and their indexes |
| `lib/index/languages/typescript-calls.ts` (+ test) | create | `collectCallFacts(sourceFile)`: bindings, re-exports, declarations, typed calls and injection sites, by the rules of ADR-059 |
| `lib/index/languages/typescript.ts` (+ test) | modify | `ADAPTER_VERSION` 5; `ParsedFile.calls`; the imports-only path reads call facts, the token scan none |
| `lib/db/store/structure.ts` (+ test) | modify | `FileRecord.calls`; `writeOne` replaces a file's call facts with its chunks and symbols |
| `lib/db/store/calls.ts` | create | the reads: declarations, bindings, the calls of one member, the injection sites of one name |
| `lib/index/pipeline.ts` (+ test), `lib/index/update.ts` (+ test) | modify | `toFileRecord` carries the facts; the update takes and returns the workspace (S6) |
| `lib/engine/calls.ts` (+ test) | create | the call index per index version (resolution through bindings, re-exports, heritage), `calls()`: callers, implementations, what breaks, injection sites |
| `lib/tools/answers.ts`, `lib/tools/registry.ts` (+ tests) | modify | `callsAnswer`; the `calls` entry; the instructions bullet; R-Q's trimmed texts and the 6,650 budget |
| `mcp/stdio.test.ts`, `mcp/server.test.ts`, `scripts/mcp-smoke.mjs`, `scripts/bench-mcp.ts`, `scripts/cli.ts`, `app/map/activity.ts` (+ test) | modify | seven tools; `calls`' live event words; `--fresh-calls` |
| `scripts/bench-calls.ts` | create | Calls Benchmark #1: file-level recall and precision against the checker's call sets |
| `lib/background/service.ts` (+ test) | modify | the workspace kept per worker run (S6) |
| `scripts/eval/definition.ts`, `run-config.ts`, `run.ts`, `transcript.ts` (+ tests) | modify | `sentence` and `gate` in eval.json; the rules sentence; `refusedCalls`; refusals in the index line; `SHELL_PRESETS` moves into `definition.ts` (Task 10) |
| `scripts/eval/context.ts`, `stats.ts`, `needed.ts`, `context-report.ts` (+ tests) | create | time to relevant context, the medians, ratios and bootstrap, the needed sets (the call kinds' and tasks' join in Task 10), the report |
| `scripts/eval/ts-calls.ts` (+ test), `scripts/eval/calls-candidates.ts` | create | the call truth from TypeScript's checker; the index's side of the disagreement sheet |
| `scripts/eval/build-truth.ts`, `scan.test.ts` (+ tests) | modify | the call kinds' and the tasks' truths, `calls-adjudicated.json`; the independence pin over twelve files (with Tasks 9, 15 and 18) |
| `scripts/eval/answer.ts`, `score.ts`, `gate3.ts` (+ tests) | modify / create | the new kinds' scores, the task's two blocks, Eval #3's gate behind the selector, TTRC and refusals in results |
| `scripts/eval/redact.ts` (+ test), `scripts/eval/grading.ts` | create / modify | redaction before the blind sheets |
| `scripts/eval/overlap.ts` (+ test) | modify | calls targets (`T.m`, `T`) compared too |
| `scripts/eval/prompts.ts` (+ test) | create | the call and task prompts from D2's stems and rule sentences |
| `scripts/eval/gate.ts` | modify | `QuestionKind` gains the five new kinds (Task 11); Eval #2's gate (the V1.6 plan's D1) stays as it is |
| `.gitignore` | modify | `eval3/runs/*.tmp` and `eval3/dev/runs/*.tmp` (Task 8) |
| `test/helpers/fixture.ts` | modify | `DI_FIXTURE` beside `ARCH_FIXTURE` (Task 2) |
| `scripts/eval/draw.ts` (+ test), `scripts/eval/questions3.test.ts` | create | the seeded draw of Eval #3's questions; the pin on `eval3/questions.json` |
| `eval3/**` | create | `eval.json` and `mcp/empty.json` (Task 8); `dev/questions.json` and `dev/runs/` (Tasks 15–16); `candidates.json`, `questions.json`, `sessions.json`, `truth-specs.json`, `truth/` (the truths, `adjudicated.json`, `steps.json`, `calls-adjudicated.json`, `needed.json`) and `rubric/` (Task 18); `runs/` (Tasks 19–20); `grading/` (Task 21); `results.json` |
| `package.json` | modify | `bench-calls`, `eval:needed`, `eval:context`, `eval:draw` |
| `docs/ENGINEERING_DECISIONS.md` | modify | ADR-059, ADR-060 (proposed with this plan); amendments to ADR-024, 043, 051, 053, 056, 057 |
| `docs/PIVOT_SPEC.md`, `docs/API_CONTRACTS.md`, `docs/IMPLEMENTATION_ROADMAP.md` | modify | §2 S13–S14, §6, §9, §10, §12, §15; §17's `calls`; the V1.7 row |
| `docs/BENCHMARKS.md`, `docs/EVAL_RESULTS.md`, `docs/DATABASE_DESIGN.md`, `docs/ARCHITECTURE.md`, `README.md` | modify | Calls #1, Index #7, MCP #5, Update #3, MCP Dev Set #2, Variety #2; Eval #3; the new tables; the seventh tool |

---

## Ground truth for this slice (hand-derived; tests transcribe these)

The mini-repo and arch-repo keep their ground truth, and every test built on them stays as it is. This slice adds **`test/fixtures/di-repo`**, designed by hand for calls. It isn't a git repo, so discovery walks it. Vitest, tsc and ESLint already exclude `test/fixtures/**`. A scratch copy compiled with 0 errors under its own tsconfig, and TypeScript's checker found exactly the call sets below (with `@di/infra` resolved as `resolve-truth.ts` resolves a workspace package).

### The files

Non-source files:

`package.json`
```json
{
  "name": "di-repo",
  "private": true,
  "workspaces": ["packages/*"]
}
```

`tsconfig.json`
```json
{
    "compilerOptions": {
        "strict": true,
        "experimentalDecorators": true,
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "Bundler",
        "noEmit": true
    }
}
```

`packages/infra/package.json`
```json
{
  "name": "@di/infra",
  "main": "src/index.ts"
}
```

**31 source files**, sorted, with their full text. Line numbers matter: the answers cite them. The three in `src/workbench/tasks/` were added by Calls Benchmark #1's two rounds (Task 5), each with its ground truth below.

`packages/infra/src/framework.ts`
```ts
export class Service {}

export class Framework {
    service(id: unknown, deps: unknown[] = []): this {
        void id;
        void deps;
        return this;
    }
}
```

`packages/infra/src/hooks.ts`
```ts
type Ctor<T> = new (...args: any[]) => T;
type Uncapitalized<S extends string> = S extends `${infer F}${infer R}` ? `${Lowercase<F>}${R}` : S;

export function useService<T>(id: Ctor<T>): T {
    return new id();
}

export function useServiceOptional<T>(id: Ctor<T>): T | null {
    return useService(id);
}

export function useServices<T extends Record<string, Ctor<unknown>>>(ids: T): { [K in keyof T as Uncapitalized<K & string>]: InstanceType<T[K]> } {
    return ids as never;
}
```

`packages/infra/src/index.ts`
```ts
export * from "./framework";
export { useService, useServiceOptional, useServices } from "./hooks";
```

`src/app/commands/commandContribution.ts`
```ts
import { inject } from "../../platform/instantiation/instantiation";
import { CommandRegistry } from "./commandRegistry";

export class CommandContribution {
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;

    constructor(@inject(CommandRegistry) private readonly registry: CommandRegistry) {}

    start(): void {
        this.commands.register("a");
        this.registry.register("b");
    }
}
```

`src/app/commands/commandRegistry.ts`
```ts
export class CommandRegistry {
    register(id: string): void {
        void id;
    }
}
```

`src/app/components/settingsButton.tsx`
```tsx
import { useService, useServiceOptional, useServices } from "@di/infra";
import { DialogService } from "../dialogs";

export function SettingsButton(): null {
    const dialogs = useService(DialogService);
    dialogs.open("settings");
    useServiceOptional(DialogService)?.open("about");
    const { dialogService } = useServices({ DialogService });
    dialogService.open("help");
    return null;
}
```

`src/app/dialogs/dialogService.ts`
```ts
import { Service } from "@di/infra";

export class DialogService extends Service {
    open(id: string): void {
        void id;
    }
}
```

`src/app/dialogs/index.ts`
```ts
import type { Framework } from "@di/infra";
import { DialogService } from "./dialogService";
import { Logger } from "../../platform/log/logger";

export function configureDialogs(framework: Framework): void {
    framework.service(DialogService, [Logger]);
}

export { DialogService };
```

`src/base/lifecycle.ts`
```ts
export class DisposableStore {
    add<T>(thing: T): T {
        return thing;
    }
}

export class Disposable {
    protected _register<T>(thing: T): T {
        return thing;
    }
}
```

`src/base/test/mock.ts` (a test file: its path has a `test/` folder)
```ts
export function mock<T>(): new () => T {
    return function () {} as unknown as new () => T;
}
```

`src/platform/files/browser/memoryFileService.ts`
```ts
import type { IFileService } from "../common/files";

export class MemoryFileService implements IFileService {
    readFile(path: string): string {
        return path;
    }

    writeFile(path: string, text: string): void {
        void path;
        void text;
    }
}
```

`src/platform/files/common/fileService.ts`
```ts
import { IFileService } from "./files";
import { registerSingleton } from "../../instantiation/instantiation";

export class FileService implements IFileService {
    readFile(path: string): string {
        return path;
    }

    writeFile(path: string, text: string): void {
        void this.readFile(path);
        void text;
    }
}

registerSingleton(IFileService, FileService);
```

`src/platform/files/common/files.ts`
```ts
import { createDecorator } from "../../instantiation/instantiation";

export const IFileService = createDecorator<IFileService>("fileService");

export interface IFileService {
    readFile(path: string): string;
    writeFile(path: string, text: string): void;
}

export const IWatchingFileService = createDecorator<IWatchingFileService>("watchingFileService");

export interface IWatchingFileService extends IFileService {
    watch(path: string): void;
}
```

`src/platform/files/index.ts` (a barrel)
```ts
export * from "./common/files";
export { FileService as DefaultFileService } from "./common/fileService";
export * as watching from "./node/watchingFileService";
```

`src/platform/files/node/watchingFileService.ts`
```ts
import { IWatchingFileService } from "../common/files";
import { FileService } from "../common/fileService";

export class WatchingFileService extends FileService implements IWatchingFileService {
    watch(path: string): void {
        void this.readFile(path);
    }
}
```

`src/platform/instantiation/instantiation.ts`
```ts
export interface ServiceIdentifier<T> {
    (...args: any[]): void;
    type: T;
}

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
    return function () {
        void serviceId;
    } as unknown as ServiceIdentifier<T>;
}

export interface ServicesAccessor {
    get<T>(id: ServiceIdentifier<T>): T;
    getOptional<T>(id: ServiceIdentifier<T>): T | undefined;
}

export function registerSingleton<T>(id: ServiceIdentifier<T>, ctor: new (...args: any[]) => T): void {
    void id;
    void ctor;
}

export function inject(id: unknown): (target: object, key?: string | symbol, index?: number) => void {
    return () => {
        void id;
    };
}
```

`src/platform/log/logger.ts`
```ts
export class Logger {
    log(message: string): void {
        void message;
    }
}
```

`src/workbench/commands/openCommand.ts`
```ts
import type { ServicesAccessor } from "../../platform/instantiation/instantiation";
import * as files from "../../platform/files/common/files";

export function openFile(accessor: ServicesAccessor, path: string): string {
    accessor.get(files.IFileService).writeFile(path, "");
    const service = accessor.get(files.IFileService);
    const optional = accessor.getOptional(files.IFileService);
    return service.readFile(path) + (optional ? optional.readFile(path) : "");
}

export function readAs(thing: unknown, path: string): string {
    return (thing as files.IFileService).readFile(path);
}
```

`src/workbench/editor/baseEditor.ts`
```ts
import { IFileService } from "../../platform/files";

export abstract class BaseEditor {
    constructor(@IFileService protected readonly files: IFileService) {}
}
```

`src/workbench/editor/editorPane.ts`
```ts
import { IFileService, IWatchingFileService } from "../../platform/files/common/files";
import { Disposable } from "../../base/lifecycle";

export class EditorPane extends Disposable {
    constructor(
        @IFileService private readonly fileService: IFileService,
        @IWatchingFileService private readonly watcher: IWatchingFileService,
    ) {
        super();
    }

    load(path: string): string {
        const files = this.fileService;
        this.watcher.watch(path);
        return files.readFile(path) + this.watcher.readFile(path);
    }
}
```

`src/workbench/editor/textEditor.ts`
```ts
import { BaseEditor } from "./baseEditor";

export class TextEditor extends BaseEditor {
    open(path: string): string {
        return this.files.readFile(path);
    }
}
```

`src/workbench/files/watchView.ts`
```ts
import { watching } from "../../platform/files";

export function watchAll(service: watching.WatchingFileService, paths: string[]): void {
    for (const path of paths) service.watch(path);
}
```

`src/workbench/history/history.ts`
```ts
import type { IFileService } from "../../platform/files/common/files";

export function loadAll<T extends IFileService>(service: T, paths: string[]): string[] {
    return paths.map((p) => service.readFile(p));
}

export function loadOne({ files, path }: { files: IFileService; path: string }): string {
    return files.readFile(path);
}
```

`src/workbench/history/inferred.ts` (the call the rules can't see: `inferred`'s type comes only from `makeService`'s inferred return type)
```ts
import { FileService } from "../../platform/files/common/fileService";

function makeService() {
    return new FileService();
}

export function loadInferred(path: string): string {
    const inferred = makeService();
    return inferred.readFile(path);
}
```

`src/workbench/log/logView.ts`
```ts
import { Logger } from "./logger";
import { Logger as PlatformLogger } from "../../platform/log/logger";

export function show(local: Logger, platform: PlatformLogger): void {
    local.log("a", 1);
    platform.log("b");
}
```

`src/workbench/log/logger.ts`
```ts
export class Logger {
    log(message: string, level: number): void {
        void message;
        void level;
    }
}
```

`src/workbench/search/searchModel.ts`
```ts
import { Disposable } from "../../base/lifecycle";
import { DefaultFileService } from "../../platform/files";

export class SearchModel extends Disposable {
    private readonly reader = this._register(new DefaultFileService());

    search(path: string): string {
        return this.reader.readFile(path);
    }
}
```

`src/workbench/tasks/runners.ts` (Calls Benchmark #1's first round, Task 5: `super`, and `this` or `new` on a nested or nameless class)
```ts
import { TaskRunner } from "./taskRunner";

export class LoggingRunner extends TaskRunner {
    override run(name: string): string {
        return super.run(`log:${name}`);
    }
}

export function makeRunners(): TaskRunner[] {
    class TwiceRunner extends TaskRunner {
        twice(name: string): string {
            return this.run(name) + this.run(name);
        }
    }
    const quiet = new class extends TaskRunner {}();
    quiet.run("quiet");
    return [new TwiceRunner(), quiet];
}
```

`src/workbench/tasks/taskHost.ts` (its second round: a member of a declared type, a same-file function's declared return type and tuple, and `const that = this`)
```ts
import { TaskRunner } from "./taskRunner";

export interface ITaskHost {
    runner: TaskRunner;
}

function makeRunner(): TaskRunner {
    return new TaskRunner();
}

async function makePair(): Promise<[string, TaskRunner]> {
    return ["pair", makeRunner()];
}

export async function runAll(host: ITaskHost): Promise<string> {
    const { runner } = host;
    const [, paired] = await makePair();
    return host.runner.run("a") + runner.run("b") + makeRunner().run("c") + paired.run("d");
}

export class TaskPanel {
    private readonly runner = new TaskRunner();

    refresh(): () => string {
        const that = this;
        return function () {
            return that.runner.run("e");
        };
    }
}
```

`src/workbench/tasks/taskRunner.ts`
```ts
export class TaskRunner {
    run(name: string): string {
        return name;
    }
}
```

`src/workbench/test/fileService.test.ts` (a test file)
```ts
import { IFileService } from "../../platform/files/common/files";
import { FileService } from "../../platform/files/common/fileService";
import { DisposableStore } from "../../base/lifecycle";
import { mock } from "../../base/test/mock";

class TestFileService extends mock<IFileService>() {
    override readFile(path: string): string {
        return `test:${path}`;
    }
}

export function check(store: DisposableStore): string {
    const real = store.add(new FileService());
    return real.readFile("a") + new TestFileService().readFile("b");
}
```

### The index's view of it

- **Files:** 31, two of them tests (`src/base/test/mock.ts`, `src/workbench/test/fileService.test.ts`).
- **Workspace:** the root declares `packages/*`, so `@di/infra` is a workspace package whose `main` is `packages/infra/src/index.ts` (also its one entry point). The root `tsconfig.json` makes `""` an id root; nothing imports by module id.
- **38 resolved edges.** By source: `packages/infra/src/index.ts` 2 (`./framework`, `./hooks`); `src/app/commands/commandContribution.ts` 2; `src/app/components/settingsButton.tsx` 2 (`@di/infra` → `packages/infra/src/index.ts`, `../dialogs` → `src/app/dialogs/index.ts`); `src/app/dialogs/dialogService.ts` 1 (`@di/infra`); `src/app/dialogs/index.ts` 3; `src/platform/files/browser/memoryFileService.ts` 1; `src/platform/files/common/fileService.ts` 2; `src/platform/files/common/files.ts` 1; `src/platform/files/index.ts` 3; `src/platform/files/node/watchingFileService.ts` 2; `src/workbench/commands/openCommand.ts` 2; `src/workbench/editor/baseEditor.ts` 1 (`../../platform/files` → `src/platform/files/index.ts`); `src/workbench/editor/editorPane.ts` 2; `src/workbench/editor/textEditor.ts` 1; `src/workbench/files/watchView.ts` 1; `src/workbench/history/history.ts` 1; `src/workbench/history/inferred.ts` 1; `src/workbench/log/logView.ts` 2; `src/workbench/search/searchModel.ts` 2; `src/workbench/tasks/runners.ts` 1 (`./taskRunner`); `src/workbench/tasks/taskHost.ts` 1 (`./taskRunner`); `src/workbench/test/fileService.test.ts` 4. The other nine files import nothing.

### Call facts of three files (the adapter's output; ADR-059's rules)

A TypeRef is a type as written: `IFoo`, or `ns.IFoo` through a namespace. Lines are 1-based: a declaration's is its name's line (a nameless class: its `class` keyword's), a call's is its member name's, an injection site's is the line of the TypeRef's node.

`src/workbench/editor/editorPane.ts`:
- **types:** `{ name: "EditorPane", kind: "class", line: 4, exported: true, nested: false, extendsRefs: ["Disposable"], implementsRefs: [], testDoubleOf: null, members: ["fileService", "load", "watcher"], fields: { fileService: "IFileService", watcher: "IWatchingFileService" } }`.
- **bindings** (the imports the facts name, then every re-export and export; none here): `{ kind: "import", local: "IFileService", imported: "IFileService", specifier: "../../platform/files/common/files" }`, `{ kind: "import", local: "IWatchingFileService", imported: "IWatchingFileService", specifier: "../../platform/files/common/files" }`, `{ kind: "import", local: "Disposable", imported: "Disposable", specifier: "../../base/lifecycle" }`.
- **calls,** in source order:
  - line 6: `{ member: null, receiver: "type", ref: "IFileService", inClass: "EditorPane", how: "ctor-param" }`;
  - line 7: `{ member: null, receiver: "type", ref: "IWatchingFileService", inClass: "EditorPane", how: "ctor-param" }`;
  - line 14: `{ member: "watch", receiver: "field", ref: "watcher", inClass: "EditorPane", how: "field" }`;
  - line 15: `{ member: "readFile", receiver: "field", ref: "fileService", inClass: "EditorPane", how: "alias" }`;
  - line 15: `{ member: "readFile", receiver: "field", ref: "watcher", inClass: "EditorPane", how: "field" }`.

`src/workbench/commands/openCommand.ts`: **types** none; **bindings** `{ import, local "ServicesAccessor", imported "ServicesAccessor", specifier "../../platform/instantiation/instantiation" }`, `{ import, local "files", imported "*", specifier "../../platform/files/common/files" }`; **calls**, in source order:
- line 5: `{ member: "get", receiver: "type", ref: "ServicesAccessor", inClass: null, how: "param" }`;
- line 5: `{ member: null, receiver: "type", ref: "files.IFileService", inClass: null, how: "provider" }`;
- line 5: `{ member: "writeFile", receiver: "type", ref: "files.IFileService", inClass: null, how: "provider" }`;
- line 6: `{ member: "get", receiver: "type", ref: "ServicesAccessor", inClass: null, how: "param" }`;
- line 6: `{ member: null, receiver: "type", ref: "files.IFileService", inClass: null, how: "provider" }`;
- line 7: `{ member: "getOptional", receiver: "type", ref: "ServicesAccessor", inClass: null, how: "param" }`;
- line 7: `{ member: null, receiver: "type", ref: "files.IFileService", inClass: null, how: "provider" }`;
- line 8: `{ member: "readFile", receiver: "type", ref: "files.IFileService", inClass: null, how: "provider" }` twice (`service.` and `optional.`);
- line 12: `{ member: "readFile", receiver: "type", ref: "files.IFileService", inClass: null, how: "cast" }`.

`src/workbench/test/fileService.test.ts`: **types** `{ name: "TestFileService", kind: "class", line: 6, exported: false, nested: false, extendsRefs: [], implementsRefs: [], testDoubleOf: "IFileService", members: ["readFile"], fields: {} }`; **bindings** `IFileService` (from `../../platform/files/common/files`), `FileService` (`../../platform/files/common/fileService`), `DisposableStore` (`../../base/lifecycle`); `mock` isn't named by a fact, so it isn't stored; **calls:** line 13 `{ member: "add", receiver: "type", ref: "DisposableStore", inClass: null, how: "param" }`; line 14 `{ member: "readFile", receiver: "type", ref: "FileService", inClass: null, how: "new" }` and `{ member: "readFile", receiver: "type", ref: "TestFileService", inClass: null, how: "new" }`.

### Call facts of Calls Benchmark #1's cases (Task 5; ADR-059 amended, `ADAPTER_VERSION` 7)

`src/workbench/tasks/runners.ts`:
- **types:** `{ name: "LoggingRunner", kind: "class", line: 3, exported: true, nested: false, extendsRefs: ["TaskRunner"], implementsRefs: [], testDoubleOf: null, members: ["run"], fields: {} }`; `{ name: "TwiceRunner", kind: "class", line: 10, exported: false, nested: true, extendsRefs: ["TaskRunner"], implementsRefs: [], testDoubleOf: null, members: ["twice"], fields: {} }`; `{ name: null, kind: "class", line: 15, exported: false, nested: true, extendsRefs: ["TaskRunner"], implementsRefs: [], testDoubleOf: null, members: [], fields: {} }`.
- **bindings:** `{ kind: "import", local: "TaskRunner", imported: "TaskRunner", specifier: "./taskRunner" }`.
- **calls,** in source order:
  - line 5: `{ member: "run", receiver: "type", ref: "TaskRunner", inClass: "LoggingRunner", how: "super" }` (`super` is the extends clause's class);
  - line 12: `{ member: "run", receiver: "this", ref: null, inClass: "@10", how: "this" }` twice (`TwiceRunner` is nested, so a fact names it by its line, R-O's key);
  - line 16: `{ member: "run", receiver: "type", ref: "@15", inClass: null, how: "new" }` (`quiet` holds `new class extends TaskRunner {}()`, the nameless class at line 15).

`src/workbench/tasks/taskHost.ts`:
- **types:** `{ name: "ITaskHost", kind: "interface", line: 3, exported: true, nested: false, extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: ["runner"], fields: { runner: "TaskRunner" } }` (an interface's property types are fields, as a class's are); `{ name: "TaskPanel", kind: "class", line: 21, exported: true, nested: false, extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: ["refresh", "runner"], fields: { runner: "TaskRunner" } }`.
- **bindings:** `{ kind: "import", local: "TaskRunner", imported: "TaskRunner", specifier: "./taskRunner" }`.
- **calls,** in source order:
  - line 18: `{ member: "run", receiver: "field", ref: "runner", inClass: "ITaskHost", how: "member" }` (`host.runner`);
  - line 18: `{ member: "run", receiver: "field", ref: "runner", inClass: "ITaskHost", how: "destructure" }` (`runner`, from `const { runner } = host`);
  - line 18: `{ member: "run", receiver: "type", ref: "TaskRunner", inClass: null, how: "return" }` (`makeRunner()`, declared `: TaskRunner`);
  - line 18: `{ member: "run", receiver: "type", ref: "TaskRunner", inClass: null, how: "destructure" }` (`paired`, from `const [, paired] = await makePair()`, declared `Promise<[string, TaskRunner]>`);
  - line 27: `{ member: "run", receiver: "field", ref: "runner", inClass: "TaskPanel", how: "alias" }` (`that.runner`, where `const that = this`).

`src/workbench/tasks/taskRunner.ts`: **types** `{ name: "TaskRunner", kind: "class", line: 1, exported: true, nested: false, extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: ["run"], fields: {} }`; no bindings, no calls.

### The engine's answers

The receivers resolve this way (Task 3 checks each):
- `TextEditor`'s `this.files` → `files` isn't declared in `TextEditor` → its base `BaseEditor` (`./baseEditor`) declares `files: IFileService` → `IFileService` through the barrel `src/platform/files/index.ts` (`export * from "./common/files"`) → `src/platform/files/common/files.ts#IFileService`.
- `SearchModel`'s `reader` → `DefaultFileService` → the barrel's `export { FileService as DefaultFileService } from "./common/fileService"` → `src/platform/files/common/fileService.ts#FileService`.
- `files.IFileService` in `openCommand.ts` → the namespace import of `files.ts` → `IFileService` there (the const and the interface share the name; the type is the interface).
- `watching.WatchingFileService` in `watchView.ts` → `watching` from the barrel → `export * as watching from "./node/watchingFileService"` → `WatchingFileService` there.
- `DialogService` in `settingsButton.tsx` → `../dialogs` = `src/app/dialogs/index.ts` → its `export { DialogService }` → its import from `./dialogService` → `src/app/dialogs/dialogService.ts#DialogService`.
- `Framework` in `src/app/dialogs/index.ts` → `@di/infra` → `packages/infra/src/index.ts` → `export * from "./framework"` → `packages/infra/src/framework.ts#Framework`.

**`IFileService.readFile`** (interface `IFileService`, `src/platform/files/common/files.ts` line 5):
- *Sub-interfaces:* `IWatchingFileService` (same file, line 12); it doesn't declare `readFile`.
- *Implementations,* by path: `MemoryFileService` (`src/platform/files/browser/memoryFileService.ts:3`, implements IFileService, declares readFile); `FileService` (`src/platform/files/common/fileService.ts:4`, implements IFileService, declares readFile); `WatchingFileService` (`src/platform/files/node/watchingFileService.ts:4`, through IWatchingFileService (it also extends FileService; a sub-interface ranks first), doesn't declare readFile); `TestFileService` (`src/workbench/test/fileService.test.ts:6`, test double, declares readFile).
- *Callers:* **8 files, 13 calls,** 1 file a test:

| File | Lines | Receivers |
|---|---|---|
| `src/workbench/commands/openCommand.ts` | 8, 8, 12 | IFileService |
| `src/workbench/editor/editorPane.ts` | 15, 15 | IFileService (the alias), IWatchingFileService (a sub-interface) |
| `src/workbench/history/history.ts` | 4, 8 | IFileService (a type parameter's constraint; a typed destructuring) |
| `src/workbench/test/fileService.test.ts` | 14, 14 | FileService, TestFileService (implementations) |
| `src/platform/files/common/fileService.ts` | 10 | FileService (`this.readFile`) |
| `src/platform/files/node/watchingFileService.ts` | 6 | WatchingFileService (`this.readFile`) |
| `src/workbench/editor/textEditor.ts` | 5 | IFileService (through the base class's field) |
| `src/workbench/search/searchModel.ts` | 8 | FileService (`_register(new DefaultFileService())`) |

  By category: on IFileService itself 4 files (openCommand, editorPane, history, textEditor), on a sub-interface 1 (editorPane), on an implementation 4 (fileService.test, fileService, watchingFileService, searchModel). `src/workbench/history/inferred.ts` line 9 calls `readFile` on an inferred `FileService`: **not seen.**
- *What a change to readFile's signature touches:* the 8, plus the files declaring a `readFile` on IFileService, a subtype or an implementation that aren't among them: `src/platform/files/browser/memoryFileService.ts` and `src/platform/files/common/files.ts`: **10 files.**
- *By area* (no `group_by`: describe's used-by rule from `src/platform/files/common`): `src/workbench/` 6, `src/platform/files/common/fileService.ts` 1, `src/platform/files/node/` 1.

**`IFileService`** (the type alone): **injected in 3 files, 5 places:** `src/workbench/commands/openCommand.ts` lines 5, 6, 7 (accessor or hook); `src/workbench/editor/baseEditor.ts` line 4 (constructor); `src/workbench/editor/editorPane.ts` line 6 (constructor). Line 7 of `editorPane.ts` injects `IWatchingFileService`, not IFileService. The same four implementations. By area: `src/workbench/` 3.

**`IWatchingFileService.watch`:** 2 files: `src/workbench/editor/editorPane.ts` 14 (on IWatchingFileService), `src/workbench/files/watchView.ts` 4 (on WatchingFileService, an implementation through the namespace re-export). Implementations: `WatchingFileService` (implements IWatchingFileService, declares watch).

**`DialogService.open`** (class, `src/app/dialogs/dialogService.ts` line 3): 1 file, 3 calls: `src/app/components/settingsButton.tsx` 6, 7, 9 (`useService`, `useServiceOptional(…)?.`, `useServices` destructured). No subclass, no implementation. A signature change touches 2 files: that one and `src/app/dialogs/dialogService.ts`. **`DialogService`** alone: injected in 1 file, 3 places: `settingsButton.tsx` 5, 7, 8. `framework.service(DialogService, [Logger])` (`src/app/dialogs/index.ts` 6) is a call on `Framework.service`, not an injection.

**`CommandRegistry.register`:** 1 file, 2 calls: `src/app/commands/commandContribution.ts` 10, 11 (an `@inject` field; a constructor parameter property). **`CommandRegistry`** alone: injected in that file at lines 5 (`@inject` field) and 7 (constructor).

**`Framework.service`:** 1 file: `src/app/dialogs/index.ts` 6.

**`Logger.log`:** two classes are named `Logger` (`src/platform/log/logger.ts:1`, `src/workbench/log/logger.ts:1`), so the answer lists both and asks for `path`. With `path: "src/platform/log/logger.ts"`: `src/workbench/log/logView.ts` 6 (through the renamed import `PlatformLogger`). With `path: "src/workbench/log/logger.ts"`: `src/workbench/log/logView.ts` 5.

**`TaskRunner.run`** (class `TaskRunner`, `src/workbench/tasks/taskRunner.ts` line 1; Task 5's cases):
- *Subclasses:* `LoggingRunner` (`src/workbench/tasks/runners.ts:3`, declares run), `TwiceRunner` (nested, `runners.ts` line 10) and the nameless class at `runners.ts` line 15. No implementations.
- *Callers:* **2 files, 9 calls,** no tests:
  - `src/workbench/tasks/taskHost.ts` 18, 18, 18, 18, 27, all on TaskRunner (ITaskHost's `runner` property, read directly and destructured; the declared return; the declared tuple; TaskPanel's `runner` field through `that`);
  - `src/workbench/tasks/runners.ts` 5, 12, 12, 16: on TaskRunner through `super`, on the subclass TwiceRunner twice, on the nameless subclass; receivers `(anonymous class)`, `TaskRunner`, `TwiceRunner`.

  By category: on TaskRunner itself 2 files, on a subclass 1, on an implementation 0.
- *What a change to run's signature touches:* the 2, plus `src/workbench/tasks/taskRunner.ts` (it declares run and isn't a caller): **3 files.** LoggingRunner declares run too, but its file is among the callers.
- *By area* (no `group_by`, from `src/workbench/tasks`): `src/workbench/tasks/runners.ts` 1, `src/workbench/tasks/taskHost.ts` 1.

### The `calls` answers on the fixture (exact text; Task 4 transcribes)

`calls { symbol: "IFileService.readFile" }`:
```
IFileService.readFile (interface IFileService, src/platform/files/common/files.ts:5): called in 8 files, 13 calls in all.
On IFileService itself in 4 files, on a sub-interface in 1, on an implementation in 4. Tests among the files: 1.
By area:
  src/workbench/  6
  src/platform/files/common/fileService.ts  1
  src/platform/files/node/  1
Files, most calls first (lines):
  src/workbench/commands/openCommand.ts  8, 8, 12
  src/workbench/editor/editorPane.ts  15, 15  (on IFileService, IWatchingFileService)
  src/workbench/history/history.ts  4, 8
  src/workbench/test/fileService.test.ts  14, 14  (on FileService, TestFileService)
  src/platform/files/common/fileService.ts  10  (on FileService)
  src/platform/files/node/watchingFileService.ts  6  (on WatchingFileService)
  src/workbench/editor/textEditor.ts  5
  src/workbench/search/searchModel.ts  8  (on FileService)
If readFile's signature changes, 10 files change: these 8, and 2 that declare it:
  src/platform/files/browser/memoryFileService.ts
  src/platform/files/common/files.ts
Implementations of IFileService (4; 3 declare readFile):
  MemoryFileService  src/platform/files/browser/memoryFileService.ts:3  implements IFileService, declares readFile
  FileService  src/platform/files/common/fileService.ts:4  implements IFileService, declares readFile
  WatchingFileService  src/platform/files/node/watchingFileService.ts:4  through IWatchingFileService
  TestFileService  src/workbench/test/fileService.test.ts:6  test double, declares readFile
Note: found through declared types: fields, constructor parameters, parameters, locals, X.get(T), useService(T), new C(), base classes and aliases. A call on a value whose type is only inferred isn't seen.
```

`calls { symbol: "IFileService" }`:
```
IFileService (interface, src/platform/files/common/files.ts:5): injected in 3 files, 5 places in all.
By area:
  src/workbench/  3
Files, most places first (lines):
  src/workbench/commands/openCommand.ts  5, 6, 7  (accessor or hook)
  src/workbench/editor/baseEditor.ts  4  (constructor)
  src/workbench/editor/editorPane.ts  6  (constructor)
Implementations of IFileService (4):
  MemoryFileService  src/platform/files/browser/memoryFileService.ts:3  implements IFileService
  FileService  src/platform/files/common/fileService.ts:4  implements IFileService
  WatchingFileService  src/platform/files/node/watchingFileService.ts:4  through IWatchingFileService
  TestFileService  src/workbench/test/fileService.test.ts:6  test double
Note: found through declared types: fields, constructor parameters, parameters, locals, X.get(T), useService(T), new C(), base classes and aliases. A call on a value whose type is only inferred isn't seen.
```

`calls { symbol: "Logger.log" }`:
```
2 types are named Logger; pass path, the file that declares the one you mean:
  class Logger  src/platform/log/logger.ts:1
  class Logger  src/workbench/log/logger.ts:1
```

### The checker's truth on the same fixture (Task 10; R2)

`scripts/eval/ts-calls.ts`, building a program over the 31 files with `@di/infra` resolved by `resolve-truth.ts`, gives:
- **callers of `IFileService.readFile`:** the index's 8 files **plus `src/workbench/history/inferred.ts`** (line 9): 9 files.
- **breaks of `IFileService.readFile`:** those 9 plus `src/platform/files/browser/memoryFileService.ts` and `src/platform/files/common/files.ts`: 11 files.
- **injects of `IFileService`:** `src/workbench/commands/openCommand.ts`, `src/workbench/editor/baseEditor.ts`, `src/workbench/editor/editorPane.ts`.
- **callers of `IWatchingFileService.readFile`** (declared on `IFileService`, so only the receiver's type reaches it; added in Task 10's fix round): `src/platform/files/node/watchingFileService.ts` (`this.readFile`, a class that implements `IWatchingFileService` and inherits `readFile` from `FileService`) and `src/workbench/editor/editorPane.ts` (`this.watcher.readFile`, an `IWatchingFileService`). `FileService`'s own `this.readFile` and every `IFileService`-typed receiver are not callers: 2 files.
- **callers of `IWatchingFileService.watch`:** `src/workbench/editor/editorPane.ts`, `src/workbench/files/watchView.ts`.
- **callers of `DialogService.open`:** `src/app/components/settingsButton.tsx`. **Injects of `DialogService`:** the same file.
- **callers of `CommandRegistry.register`** and **injects of `CommandRegistry`:** `src/app/commands/commandContribution.ts`.
- **callers of `Framework.service`:** `src/app/dialogs/index.ts`.
- **callers of `TaskRunner.run`** (Task 5's cases): `src/workbench/tasks/runners.ts`, `src/workbench/tasks/taskHost.ts`. The checker resolves all nine calls to `TaskRunner.run` (checked on a scratch program over the three `tasks/` files: 0 errors).
- **A task on `IFileService.readFile`:** CHANGE = the 11 breaks files; TESTS = the test files among them or directly importing one of them = `src/workbench/test/fileService.test.ts` (it is in CHANGE, and it imports `files.ts` and `fileService.ts`). `src/base/test/mock.ts` imports nothing, so it isn't one.

---

## Part 0 — Start

### Task 0: Baseline, ledger, the owner's approval

**Files:** `.superpowers/sdd/2026-10-15-v1-7-calls-and-context/progress.md` (gitignored; "## Planning" written with this plan).

- [ ] **Step 1: Check the branch and the owner's files**

Run: `git status --short && git log --oneline -3 && git rev-parse --abbrev-ref HEAD`
Expected: `pivot/v1` at this plan's approval commit or later, with only ` M docs/LEARNING_NOTES.md` and `?? lib/agent/state.ts` uncommitted. They're the owner's: never stage them. If another session committed since, read its commits before going on.

- [ ] **Step 2: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: tsc clean, lint 0 errors (4 warnings, pre-existing), vitest 1,340/1,340.

- [ ] **Step 3: Record the starting state in the ledger**

Append to `progress.md` under `## Execution`:
- the owner's approval of this plan, verbatim (it is also in this plan's header once given), and the decisions line from the kickoff prompt;
- the gate's numbers;
- whether port 3000 is up (`netstat -ano | grep LISTENING | grep -E ":3000\b"`) and its PID (never stop it);
- `git -C ../vscode log --oneline -1` (`cc3fec88`), `git -C ../affine log --oneline -1` (`0b69a6d`), and both `git status --porcelain` (empty);
- `claude --version`;
- whether a runaway process holds a core (`tasklist //FI "IMAGENAME eq python.exe"` in Git Bash, which would read `/FI` as a path, and the busiest `node.exe`): S1 needs a quiet machine (Task 6).

No commit (nothing tracked changes).

---

## Part 1 — The engine: calls through declared types, then S6

### Task 1: The di-repo fixture and the adapter's call facts (ADAPTER_VERSION 5)

**Files:**
- Create: `test/fixtures/di-repo/**` (the ground truth's 31 files, verbatim), `lib/index/languages/typescript-calls.ts`, `lib/index/languages/typescript-calls.test.ts`
- Modify: `lib/db/schema.ts` (the fact types only; the tables come in Task 2), `lib/index/languages/typescript.ts`, `lib/index/languages/typescript.test.ts`

**Interfaces:**
- Produces: `CallFacts`, `TypeDeclFact`, `BindingFact`, `TypedCallFact`, `CallRule`, `CALL_RULES` (schema.ts); `collectCallFacts(sourceFile): CallFacts` and `emptyCallFacts(): CallFacts` (typescript-calls.ts); `ParsedFile.calls`; `ADAPTER_VERSION = 5`. Task 2 stores them, Task 3 resolves them.

- [ ] **Step 1: Create the fixture**

Write every file of "Ground truth → The files" into `test/fixtures/di-repo/` with the Write tool, byte for byte (LF endings, a final newline). Check: `ls -R test/fixtures/di-repo | grep -c "\.ts"` counts 28 code files with the `.tsx` (`find test/fixtures/di-repo -name "*.ts*" | wc -l` prints 28).

- [ ] **Step 2: The fact types in `lib/db/schema.ts`**

Append after `LevelEdgeRow` (the tables follow in Task 2; the store will need these types, and `lib/db` never imports `lib/index`):

```ts
/** How a call's receiver got its type, or (member null) what kind of injection site a fact is (ADR-059). */
export const CALL_RULES = [
    "param", "local", "destructure", "constraint", "cast", "provider", "new", "alias", "field", "this", "ctor-param", "inject-field",
] as const;
export type CallRule = (typeof CALL_RULES)[number];

/**
 * A class or interface as the TypeScript adapter reads it (ADR-059). A TypeRef is a type as written: "IFoo", or "ns.IFoo"
 * through a namespace import; type arguments are dropped.
 */
export type TypeDeclFact = {
    /** null for a class expression with no name. */
    name: string | null;
    kind: "class" | "interface";
    /** 1-based: its name's line, or its `class` keyword's when it has no name. */
    line: number;
    exported: boolean;
    /** Inside a function, a namespace or an expression (R-O): an implementation all the same, but no import can name it. */
    nested: boolean;
    extendsRefs: string[];
    implementsRefs: string[];
    /** `class X extends mock<IFoo>()`: a test double of IFoo. */
    testDoubleOf: string | null;
    /** Its methods, accessors and properties (a class's constructor parameter properties too), sorted, each once. */
    members: string[];
    /** A class's field → the type it is declared with, or sure to hold (`= new C()`, `= this._register(new C())`). */
    fields: Record<string, string>;
};

/** An import, a re-export or a local export, as call resolution follows them (ADR-059). */
export type BindingFact = {
    kind: "import" | "reexport" | "export";
    /** The name in this file: an import's local name; a re-export's or an export's exported name ("*" for `export * from`). */
    local: string;
    /** The name in the other module: "default", "*" (a namespace) or a name; for a local export, the local name it exports. */
    imported: string;
    /** null for a local export. */
    specifier: string | null;
};

/** A call on a value whose type a rule can read; with `member` null, a place a type is injected (ADR-059). */
export type TypedCallFact = {
    /** 1-based: a call's member name's line; an injection site's TypeRef node's line. */
    line: number;
    member: string | null;
    receiver: "type" | "field" | "this";
    /** "type": the TypeRef; "field": the field's name; "this": null. */
    ref: string | null;
    /** The top-level class the call sits in ("field" and "this" resolve through it), or null. */
    inClass: string | null;
    how: CallRule;
};

/** The adapter's fourth product of its one parse (ADR-059). */
export type CallFacts = { types: TypeDeclFact[]; bindings: BindingFact[]; calls: TypedCallFact[] };
```

- [ ] **Step 3: Write the failing tests**

`lib/index/languages/typescript-calls.test.ts` (every expectation derived by hand from its source; lines count from 1):

```ts
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseSourceFile } from "../../chunks";
import { collectCallFacts } from "./typescript-calls";

const facts = (source: string, file = "src/x.ts") => collectCallFacts(parseSourceFile(file, source));
const fixture = (rel: string) => facts(fs.readFileSync(path.join("test/fixtures/di-repo", rel), "utf8"), rel);
const lines = (...l: string[]): string => `${l.join("\n")}\n`;

describe("collectCallFacts: declarations", () => {
    it("reads a class's heritage, members and field types, constructor parameter properties included", () => {
        expect(fixture("src/workbench/editor/editorPane.ts").types).toEqual([{
            name: "EditorPane", kind: "class", line: 4, exported: true, nested: false, extendsRefs: ["Disposable"], implementsRefs: [],
            testDoubleOf: null, members: ["fileService", "load", "watcher"], fields: { fileService: "IFileService", watcher: "IWatchingFileService" },
        }]);
    });

    it("reads a test double from extends mock<IFoo>()", () => {
        expect(fixture("src/workbench/test/fileService.test.ts").types).toEqual([{
            name: "TestFileService", kind: "class", line: 6, exported: false, nested: false, extendsRefs: [], implementsRefs: [],
            testDoubleOf: "IFileService", members: ["readFile"], fields: {},
        }]);
    });

    it("merges an interface declared twice in one file (Review Focus 2)", () => {
        const source = lines(
            "export interface IFoo extends IBase { a(): void; }",
            "export interface IFoo extends ns.IOther { b: string; }",
        );
        expect(facts(source).types).toEqual([{
            name: "IFoo", kind: "interface", line: 1, exported: true, nested: false, extendsRefs: ["IBase", "ns.IOther"], implementsRefs: [],
            testDoubleOf: null, members: ["a", "b"], fields: {},
        }]);
    });

    it("records a nameless or nested class with a heritage clause as nested (R-O), and skips one without", () => {
        const source = lines(
            "export function make() {",
            "    const double = new class extends mock<IFoo>() { run(): void {} }();",
            "    class Local implements IBar { go(): void {} }",
            "    class Plain { x(): void {} }",
            "    return [double, Local, Plain];",
            "}",
        );
        expect(facts(source).types).toEqual([
            { name: null, kind: "class", line: 2, exported: false, nested: true, extendsRefs: [], implementsRefs: [], testDoubleOf: "IFoo", members: ["run"], fields: {} },
            { name: "Local", kind: "class", line: 3, exported: false, nested: true, extendsRefs: [], implementsRefs: ["IBar"], testDoubleOf: null, members: ["go"], fields: {} },
        ]);
    });

    it("reads a field's type from new C() and from x.add(new C()) or this._register(new C())", () => {
        const source = lines(
            "export class A extends Base {",
            "    private readonly a = new Alpha();",
            "    private readonly b = this._register(new Beta());",
            "    private readonly c = store.add(new Gamma());",
            "    private readonly d = compute();",
            "    get e(): IEps { return this.a as never; }",
            "}",
        );
        expect(facts(source).types[0].fields).toEqual({ a: "Alpha", b: "Beta", c: "Gamma", e: "IEps" });
    });
});

describe("collectCallFacts: calls and injection sites", () => {
    it("reads the fields, the alias and the constructor's injection sites of a class (editorPane.ts)", () => {
        expect(fixture("src/workbench/editor/editorPane.ts").calls).toEqual([
            { line: 6, member: null, receiver: "type", ref: "IFileService", inClass: "EditorPane", how: "ctor-param" },
            { line: 7, member: null, receiver: "type", ref: "IWatchingFileService", inClass: "EditorPane", how: "ctor-param" },
            { line: 14, member: "watch", receiver: "field", ref: "watcher", inClass: "EditorPane", how: "field" },
            { line: 15, member: "readFile", receiver: "field", ref: "fileService", inClass: "EditorPane", how: "alias" },
            { line: 15, member: "readFile", receiver: "field", ref: "watcher", inClass: "EditorPane", how: "field" },
        ]);
    });

    it("reads providers, a namespace ref and a cast, in source order (openCommand.ts)", () => {
        const call = (line: number, member: string | null, ref: string, how: string) => ({ line, member, receiver: "type", ref, inClass: null, how });
        expect(fixture("src/workbench/commands/openCommand.ts").calls).toEqual([
            call(5, "get", "ServicesAccessor", "param"),
            call(5, null, "files.IFileService", "provider"),
            call(5, "writeFile", "files.IFileService", "provider"),
            call(6, "get", "ServicesAccessor", "param"),
            call(6, null, "files.IFileService", "provider"),
            call(7, "getOptional", "ServicesAccessor", "param"),
            call(7, null, "files.IFileService", "provider"),
            call(8, "readFile", "files.IFileService", "provider"),
            call(8, "readFile", "files.IFileService", "provider"),
            call(12, "readFile", "files.IFileService", "cast"),
        ]);
    });

    it("reads a type parameter's constraint and a typed destructuring (history.ts)", () => {
        expect(fixture("src/workbench/history/history.ts").calls).toEqual([
            { line: 4, member: "readFile", receiver: "type", ref: "IFileService", inClass: null, how: "constraint" },
            { line: 8, member: "readFile", receiver: "type", ref: "IFileService", inClass: null, how: "destructure" },
        ]);
    });

    it("sees nothing on an inferred receiver (inferred.ts)", () => {
        expect(fixture("src/workbench/history/inferred.ts").calls).toEqual([]);
    });

    it("reads AFFiNE's hooks: useService, useServiceOptional(…)?., useServices destructured (settingsButton.tsx)", () => {
        const at = (line: number, member: string | null) => ({ line, member, receiver: "type", ref: "DialogService", inClass: null, how: "provider" });
        expect(fixture("src/app/components/settingsButton.tsx").calls).toEqual([
            at(5, null), at(6, "open"), at(7, null), at(7, "open"), at(8, null), at(9, "open"),
        ]);
    });

    it("reads Inversify's @inject field and an @inject constructor parameter property (commandContribution.ts)", () => {
        expect(fixture("src/app/commands/commandContribution.ts").calls).toEqual([
            { line: 5, member: null, receiver: "type", ref: "CommandRegistry", inClass: "CommandContribution", how: "inject-field" },
            { line: 7, member: null, receiver: "type", ref: "CommandRegistry", inClass: "CommandContribution", how: "ctor-param" },
            { line: 10, member: "register", receiver: "field", ref: "commands", inClass: "CommandContribution", how: "field" },
            { line: 11, member: "register", receiver: "field", ref: "registry", inClass: "CommandContribution", how: "field" },
        ]);
    });

    it("reads new C() through store.add, and a this-call (fileService.test.ts, searchModel.ts)", () => {
        expect(fixture("src/workbench/test/fileService.test.ts").calls).toEqual([
            { line: 13, member: "add", receiver: "type", ref: "DisposableStore", inClass: null, how: "param" },
            { line: 14, member: "readFile", receiver: "type", ref: "FileService", inClass: null, how: "new" },
            { line: 14, member: "readFile", receiver: "type", ref: "TestFileService", inClass: null, how: "new" },
        ]);
        expect(fixture("src/workbench/search/searchModel.ts").calls).toEqual([
            { line: 5, member: "_register", receiver: "this", ref: null, inClass: "SearchModel", how: "this" },
            { line: 8, member: "readFile", receiver: "field", ref: "reader", inClass: "SearchModel", how: "field" },
        ]);
    });

    it("leaves out a provider asked for a local value (map.get(key)) and a this-call inside a plain function, and keeps a cast", () => {
        const source = lines(
            "export class A {",
            "    run(key: string, map: Map<string, IFoo>): void {",
            "        map.get(key);",
            "        const f = function (this: unknown) { (this as never as IBar).go(); };",
            "        const g = function () { this.helper(); };",
            "        f(); g();",
            "    }",
            "}",
        );
        // line 3: a typed call on a parameter, but no provider fact (key is a value, not a type); line 4: the cast's call;
        // line 5: `this` in a plain function isn't A's instance, so helper() is no this-call; line 6: plain calls
        expect(facts(source).calls).toEqual([
            { line: 3, member: "get", receiver: "type", ref: "Map", inClass: "A", how: "param" },
            { line: 4, member: "go", receiver: "type", ref: "IBar", inClass: "A", how: "cast" },
        ]);
    });
});

describe("collectCallFacts: bindings", () => {
    it("keeps the imports the facts name, and every re-export and export (openCommand.ts, the barrel)", () => {
        expect(fixture("src/workbench/commands/openCommand.ts").bindings).toEqual([
            { kind: "import", local: "ServicesAccessor", imported: "ServicesAccessor", specifier: "../../platform/instantiation/instantiation" },
            { kind: "import", local: "files", imported: "*", specifier: "../../platform/files/common/files" },
        ]);
        expect(fixture("src/platform/files/index.ts").bindings).toEqual([
            { kind: "reexport", local: "*", imported: "*", specifier: "./common/files" },
            { kind: "reexport", local: "DefaultFileService", imported: "FileService", specifier: "./common/fileService" },
            { kind: "reexport", local: "watching", imported: "*", specifier: "./node/watchingFileService" },
        ]);
    });

    it("keeps an import a local export names, and a renamed import", () => {
        expect(fixture("src/app/dialogs/index.ts").bindings).toEqual([
            { kind: "import", local: "Framework", imported: "Framework", specifier: "@di/infra" },
            { kind: "import", local: "DialogService", imported: "DialogService", specifier: "./dialogService" },
            { kind: "export", local: "DialogService", imported: "DialogService", specifier: null },
        ]);
        expect(fixture("src/workbench/log/logView.ts").bindings).toEqual([
            { kind: "import", local: "Logger", imported: "Logger", specifier: "./logger" },
            { kind: "import", local: "PlatformLogger", imported: "Logger", specifier: "../../platform/log/logger" },
        ]);
    });

    it("reads a default import and the default exports", () => {
        const source = lines(
            "import Base from \"./base\";",
            "export default class Child extends Base {}",
        );
        expect(facts(source).bindings).toEqual([
            { kind: "import", local: "Base", imported: "default", specifier: "./base" },
            { kind: "export", local: "default", imported: "Child", specifier: null },
        ]);
    });
});
```

In `lib/index/languages/typescript.test.ts`, the two whole-result tests gain `calls` (hand-derived from their shared source: `export class Big { run(): void {} }` is line 10; `export { c } from "./c"` and `export * from "./d"` are its re-exports; no import is named by a fact):
- `parseTypeScriptImportsOnly` (L183): `calls: { types: [{ name: "Big", kind: "class", line: 10, exported: true, nested: false, extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: ["run"], fields: {} }], bindings: [{ kind: "reexport", local: "c", imported: "c", specifier: "./c" }, { kind: "reexport", local: "*", imported: "*", specifier: "./d" }], calls: [] }` (R-P);
- `scanTypeScriptImports` (L245): `calls: { types: [], bindings: [], calls: [] }`.

And one new test: `parseTypeScriptFile("src/a.ts", "export class A {}\n").calls.types` has one entry named `A`, and `ADAPTER_VERSION` is 5.

- [ ] **Step 4: Run them and see them fail**

Run: `npx vitest run lib/index/languages`
Expected: FAIL, cannot find module `./typescript-calls`.

- [ ] **Step 5: Write `lib/index/languages/typescript-calls.ts`**

```ts
import ts from "typescript";
import type { BindingFact, CallFacts, CallRule, TypeDeclFact, TypedCallFact } from "../../db/schema";

/**
 * Calls through declared types (ADR-059): the call facts of one parsed file. Pure syntax, one file at a time: a receiver's
 * type is read from what the code declares (a parameter, a local, a field, a provider's id, new C(), a cast), never
 * inferred; resolving a type name to the file that declares it happens later, in the engine, through the stored imports.
 */

export function emptyCallFacts(): CallFacts {
    return { types: [], bindings: [], calls: [] };
}

/** Wrappers whose first type argument is the type a call goes to: Partial<IFoo> is still an IFoo. */
const WRAPPERS = new Set(["Pick", "Partial", "Readonly", "Required", "NonNullable", "Omit", "Mutable", "DeepPartial", "Mocked", "MockProxy"]);
/** accessor.get(IFoo), container.getOptional(Foo): a service asked for by its id. */
const PROVIDER_METHODS = new Set(["get", "getOptional"]);
/** AFFiNE's hooks; useServices({ Foo }) is read apart. */
const HOOKS = new Set(["useService", "useServiceOptional"]);
/** store.add(new C()), this._register(new C()), disposables.add(new C()): the value is the new C. */
const PASS_THROUGH = new Set(["add", "_register"]);
/** How far a local's initializer is followed (const a = b; const b = this.f), and a type parameter's constraint. */
const MAX_DEPTH = 4;

type Receiver = { receiver: TypedCallFact["receiver"]; ref: string | null; inClass: string | null; how: CallRule };
type Anchored = { pos: number; fact: TypedCallFact };

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function collectCallFacts(sourceFile: ts.SourceFile): CallFacts {
    const lineOf = (node: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const types = collectTypes(sourceFile, lineOf);
    const found: Anchored[] = [];
    const site = (node: ts.Node, ref: string, how: CallRule): void => {
        found.push({ pos: node.getStart(sourceFile), fact: { line: lineOf(node), member: null, receiver: "type", ref, inClass: enclosingClassName(node), how } });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isConstructorDeclaration(node)){
            // a constructor parameter typed T receives a T (R-S), decorated or not; untyped, an @inject(T) names it
            for (const p of node.parameters){
                const ref = p.type ? typeRefOf(p.type, p) : injectArgument(p);
                const at = p.type ?? injectNode(p);
                if (ref !== null && at !== null) site(at, ref, "ctor-param");
            }
        } else if (ts.isPropertyDeclaration(node) && injectNode(node) !== null){
            const ref = node.type ? typeRefOf(node.type, node) : injectArgument(node);
            if (ref !== null) site(node.type ?? injectNode(node)!, ref, "inject-field");
        } else if (ts.isCallExpression(node)){
            const provided = providedRef(node);
            if (provided !== null) site(node.arguments[0], provided, "provider");
            for (const [value, ref] of servicesKeysOf(node)) site(value, ref, "provider");
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && (ts.isIdentifier(callee.name) || ts.isPrivateIdentifier(callee.name))){
                const r = receiverOf(callee.expression, 0);
                if (r !== null){
                    const inClass = r.receiver === "type" ? enclosingClassName(node) : r.inClass;
                    found.push({ pos: callee.name.getStart(sourceFile), fact: { line: lineOf(callee.name), member: callee.name.text, ...r, inClass } });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    // source order of each fact's anchor (a call's member name, a site's TypeRef node); sort is stable
    const calls = found.sort((a, b) => a.pos - b.pos).map((a) => a.fact);
    return { types, bindings: collectBindings(sourceFile, types, calls), calls };
}

// ---- declarations

function collectTypes(sourceFile: ts.SourceFile, lineOf: (node: ts.Node) => number): TypeDeclFact[] {
    const out: TypeDeclFact[] = [];
    const interfaces = new Map<string, TypeDeclFact>();   // a second `interface X` in the file merges into the first
    const visit = (node: ts.Node, topLevel: boolean): void => {
        if (ts.isInterfaceDeclaration(node) && topLevel){
            let fact = interfaces.get(node.name.text);
            if (!fact){
                fact = { name: node.name.text, kind: "interface", line: lineOf(node.name), exported: false, nested: false,
                    extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: [], fields: {} };
                interfaces.set(node.name.text, fact);
                out.push(fact);
            }
            fact.exported ||= hasModifier(node, ts.SyntaxKind.ExportKeyword);
            for (const clause of node.heritageClauses ?? []) for (const t of clause.types){
                const ref = refOfExpression(t.expression);
                if (ref !== null) fact.extendsRefs.push(ref);
            }
            for (const m of node.members){
                const name = memberName(m.name);
                if (name !== null) fact.members.push(name);
            }
        } else if (ts.isClassLike(node) && (topLevel ? ts.isClassDeclaration(node) : node.heritageClauses !== undefined)){
            out.push(classFact(node, topLevel, lineOf));
        }
        // the file's statements are top level; anything inside one isn't (R-O)
        ts.forEachChild(node, (child) => visit(child, false));
    };
    for (const statement of sourceFile.statements) visit(statement, true);
    for (const fact of out) fact.members = [...new Set(fact.members)].sort(compare);
    return out;
}

function classFact(node: ts.ClassLikeDeclaration, topLevel: boolean, lineOf: (node: ts.Node) => number): TypeDeclFact {
    const fact: TypeDeclFact = {
        name: node.name?.text ?? null, kind: "class", line: lineOf(node.name ?? node),
        exported: topLevel && hasModifier(node, ts.SyntaxKind.ExportKeyword), nested: !topLevel,
        extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: [], fields: {},
    };
    for (const clause of node.heritageClauses ?? []){
        for (const t of clause.types){
            const base = t.expression;
            if (clause.token === ts.SyntaxKind.ExtendsKeyword && ts.isCallExpression(base)){
                // class X extends mock<IFoo>() { … }: a test double of IFoo
                if (ts.isIdentifier(base.expression) && base.expression.text === "mock" && base.typeArguments?.length === 1){
                    fact.testDoubleOf = typeRefOf(base.typeArguments[0], node);
                }
                continue;
            }
            const ref = refOfExpression(base);
            if (ref !== null) (clause.token === ts.SyntaxKind.ExtendsKeyword ? fact.extendsRefs : fact.implementsRefs).push(ref);
        }
    }
    for (const member of node.members){
        if (ts.isConstructorDeclaration(member)){
            for (const p of member.parameters){
                if (!ts.isIdentifier(p.name) || !isParameterProperty(p)) continue;
                fact.members.push(p.name.text);
                const ref = p.type ? typeRefOf(p.type, p) : null;
                if (ref !== null) fact.fields[p.name.text] = ref;
            }
            continue;
        }
        const name = memberName(member.name);
        if (name === null) continue;
        fact.members.push(name);
        const ref = ts.isPropertyDeclaration(member) ? (member.type ? typeRefOf(member.type, member) : member.initializer ? valueTypeRef(member.initializer) : null)
            : ts.isGetAccessorDeclaration(member) && member.type ? typeRefOf(member.type, member)
            : null;
        if (ref !== null) fact.fields[name] = ref;
    }
    return fact;
}

// ---- receivers

function receiverOf(expression: ts.Expression, depth: number): Receiver | null {
    const e = unwrap(expression);
    if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)){
        const ref = typeRefOf(e.type, e);
        return ref === null ? null : { receiver: "type", ref, inClass: null, how: "cast" };
    }
    if (e.kind === ts.SyntaxKind.ThisKeyword){
        const inClass = thisClass(e);
        return inClass === null ? null : { receiver: "this", ref: null, inClass, how: "this" };
    }
    if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword){
        const inClass = thisClass(e);
        const name = memberName(e.name);
        return inClass === null || name === null ? null : { receiver: "field", ref: name, inClass, how: "field" };
    }
    const value = valueTypeRef(e);
    if (value !== null) return { receiver: "type", ref: value, inClass: null, how: ts.isCallExpression(e) && providedRef(e) !== null ? "provider" : "new" };
    if (ts.isIdentifier(e)) return identifierReceiver(e, depth);
    return null;
}

function identifierReceiver(id: ts.Identifier, depth: number): Receiver | null {
    const declaration = findDeclaration(id);
    if (declaration === null) return null;
    if (ts.isParameter(declaration) || (ts.isVariableDeclaration(declaration) && declaration.type)){
        if (!declaration.type) return null;
        const ref = typeRefOf(declaration.type, declaration);
        if (ref === null) return null;
        const how: CallRule = isTypeParameterRef(declaration.type, declaration) ? "constraint" : ts.isParameter(declaration) ? "param" : "local";
        return { receiver: "type", ref, inClass: null, how };
    }
    if (ts.isVariableDeclaration(declaration)){
        if (!declaration.initializer || depth >= MAX_DEPTH) return null;
        const inner = receiverOf(declaration.initializer, depth + 1);
        // const files = this.fileService: an alias of a field
        return inner !== null && inner.receiver === "field" ? { ...inner, how: "alias" } : inner;
    }
    if (ts.isBindingElement(declaration)) return bindingReceiver(declaration);
    return null;
}

/** ({ files }: { files: IFoo }) => …, or const { fooService } = useServices({ FooService }): a destructured name a rule can type. */
function bindingReceiver(element: ts.BindingElement): Receiver | null {
    const key = element.propertyName ? memberName(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : null;
    if (key === null || !ts.isObjectBindingPattern(element.parent)) return null;
    const holder = element.parent.parent;
    if ((ts.isParameter(holder) || ts.isVariableDeclaration(holder)) && holder.type && ts.isTypeLiteralNode(holder.type)){
        for (const m of holder.type.members){
            if (ts.isPropertySignature(m) && memberName(m.name) === key && m.type){
                const ref = typeRefOf(m.type, m);
                return ref === null ? null : { receiver: "type", ref, inClass: null, how: "destructure" };
            }
        }
        return null;
    }
    if (ts.isVariableDeclaration(holder) && holder.initializer){
        const init = unwrap(holder.initializer);
        if (ts.isCallExpression(init)){
            for (const [value, ref] of servicesKeysOf(init)){
                const name = ts.isShorthandPropertyAssignment(value.parent) || ts.isPropertyAssignment(value.parent) ? memberName(value.parent.name) : null;
                if (name !== null && uncapitalize(name) === key) return { receiver: "type", ref, inClass: null, how: "provider" };
            }
        }
    }
    return null;
}

/** The type a value is sure to have, read from its syntax: new C(), x.add(new C()), this._register(new C()), a provider's id. */
function valueTypeRef(expression: ts.Expression): string | null {
    const e = unwrap(expression);
    if (ts.isNewExpression(e)) return refOfExpression(e.expression);
    if (!ts.isCallExpression(e)) return null;
    const provided = providedRef(e);
    if (provided !== null) return provided;
    const callee = e.expression;
    const first = e.arguments[0];
    if (ts.isPropertyAccessExpression(callee) && PASS_THROUGH.has(callee.name.text) && first !== undefined){
        const inner = unwrap(first);
        if (ts.isNewExpression(inner)) return refOfExpression(inner.expression);
    }
    return null;
}

/** accessor.get(IFoo), x.getOptional(IFoo), useService(Foo), useServiceOptional(Foo): the id asked for, when it is a module-level name. */
function providedRef(call: ts.CallExpression): string | null {
    const callee = call.expression;
    const asks = (ts.isPropertyAccessExpression(callee) && PROVIDER_METHODS.has(callee.name.text)) || (ts.isIdentifier(callee) && HOOKS.has(callee.text));
    const first = call.arguments[0];
    return asks && first !== undefined ? moduleLevelRef(first) : null;
}

/** useServices({ FooService, bar: BarService }): each key's value node and its ref. */
function servicesKeysOf(call: ts.CallExpression): [ts.Expression, string][] {
    const arg = call.arguments[0];
    if (!ts.isIdentifier(call.expression) || call.expression.text !== "useServices" || arg === undefined || !ts.isObjectLiteralExpression(arg)) return [];
    const out: [ts.Expression, string][] = [];
    for (const p of arg.properties){
        const value = ts.isShorthandPropertyAssignment(p) ? p.name : ts.isPropertyAssignment(p) ? p.initializer : null;
        const ref = value === null ? null : moduleLevelRef(value);
        if (value !== null && ref !== null) out.push([value, ref]);
    }
    return out;
}

/** @inject(X) on a field or a parameter: the decorator's call. */
function injectNode(node: ts.HasDecorators): ts.Expression | null {
    for (const d of ts.getDecorators(node) ?? []){
        const e = d.expression;
        if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "inject" && e.arguments[0] !== undefined) return e.arguments[0];
    }
    return null;
}

function injectArgument(node: ts.HasDecorators): string | null {
    const arg = injectNode(node);
    return arg === null ? null : moduleLevelRef(arg);
}

// ---- type references

/** A type annotation as a TypeRef, through parentheses, unions, intersections and wrappers; a type parameter reads as its constraint. */
function typeRefOf(type: ts.TypeNode, scope: ts.Node, depth = 0): string | null {
    if (depth > MAX_DEPTH) return null;
    if (ts.isParenthesizedTypeNode(type)) return typeRefOf(type.type, scope, depth + 1);
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)){
        for (const part of type.types){
            const ref = typeRefOf(part, scope, depth + 1);
            if (ref !== null) return ref;
        }
        return null;
    }
    if (!ts.isTypeReferenceNode(type)) return null;
    const name = type.typeName;
    if (ts.isQualifiedName(name)) return ts.isIdentifier(name.left) ? `${name.left.text}.${name.right.text}` : null;
    if (WRAPPERS.has(name.text) && type.typeArguments?.length) return typeRefOf(type.typeArguments[0], scope, depth + 1);
    const parameter = typeParameterNamed(name.text, scope);
    if (parameter === undefined) return name.text;
    return parameter?.constraint ? typeRefOf(parameter.constraint, parameter, depth + 1) : null;
}

function isTypeParameterRef(type: ts.TypeNode, scope: ts.Node): boolean {
    return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && typeParameterNamed(type.typeName.text, scope) !== undefined;
}

/** The type parameter a name means where it is written, or undefined when none in scope has that name. */
function typeParameterNamed(name: string, scope: ts.Node): ts.TypeParameterDeclaration | undefined {
    for (let n: ts.Node | undefined = scope; n !== undefined; n = n.parent){
        const params = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
        const found = params?.find((p) => p.name.text === name);
        if (found) return found;
    }
    return undefined;
}

/** "IFoo" or "ns.IFoo" for an identifier or a namespace's member; anything else null. */
function refOfExpression(e: ts.Expression): string | null {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ts.isIdentifier(e.name)) return `${e.expression.text}.${e.name.text}`;
    return null;
}

/** A ref whose root name is an import or a top-level declaration (not a parameter or a local): map.get(key) isn't a provider. */
function moduleLevelRef(e: ts.Expression): string | null {
    const ref = refOfExpression(unwrap(e));
    if (ref === null) return null;
    const inner = unwrap(e);
    const root = ts.isIdentifier(inner) ? inner : (inner as ts.PropertyAccessExpression).expression as ts.Identifier;
    const declaration = findDeclaration(root);
    if (declaration === null) return ref;   // an import, or a global
    return ts.isVariableDeclaration(declaration) && ts.isVariableStatement(declaration.parent.parent) && ts.isSourceFile(declaration.parent.parent.parent) ? ref : null;
}

// ---- scopes

/** The nearest declaration of a name in the syntactic scopes around it: a parameter, a variable, a destructured binding. */
function findDeclaration(id: ts.Identifier): ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement | null {
    const name = id.text;
    const inPattern = (binding: ts.BindingName): ts.BindingElement | null => {
        if (ts.isIdentifier(binding)) return null;
        for (const el of binding.elements){
            if (ts.isOmittedExpression(el)) continue;
            if (ts.isIdentifier(el.name) && el.name.text === name) return el;
            const deeper = inPattern(el.name);
            if (deeper) return deeper;
        }
        return null;
    };
    const inDeclarations = (list: ts.VariableDeclarationList): ts.VariableDeclaration | ts.BindingElement | null => {
        for (const d of list.declarations){
            if (ts.isIdentifier(d.name)){
                if (d.name.text === name) return d;
            } else {
                const el = inPattern(d.name);
                if (el) return el;
            }
        }
        return null;
    };
    for (let node: ts.Node | undefined = id.parent; node !== undefined; node = node.parent){
        if (ts.isFunctionLike(node)){
            for (const p of node.parameters){
                if (ts.isIdentifier(p.name) ? p.name.text === name : inPattern(p.name) !== null) return ts.isIdentifier(p.name) ? p : inPattern(p.name);
            }
        }
        if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)){
            for (const statement of node.statements){
                if (!ts.isVariableStatement(statement)) continue;
                const found = inDeclarations(statement.declarationList);
                if (found) return found;
            }
        }
        if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)){
            const found = inDeclarations(node.initializer);
            if (found) return found;
        }
        if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name) && node.variableDeclaration.name.text === name){
            return node.variableDeclaration;
        }
    }
    return null;
}

/** The top-level class a `this` belongs to: not past a function (it has its own this), nor an object literal's method. */
function thisClass(node: ts.Node): string | null {
    for (let n = node.parent; n !== undefined; n = n.parent){
        if (ts.isClassLike(n)) return ts.isClassDeclaration(n) && n.name !== undefined && ts.isSourceFile(n.parent) ? n.name.text : null;
        if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) return null;
        if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && ts.isObjectLiteralExpression(n.parent)) return null;
    }
    return null;
}

/** The top-level class a node sits in, whatever functions lie between, or null. */
function enclosingClassName(node: ts.Node): string | null {
    for (let n = node.parent; n !== undefined; n = n.parent){
        if (ts.isClassLike(n)) return ts.isClassDeclaration(n) && n.name !== undefined && ts.isSourceFile(n.parent) ? n.name.text : null;
    }
    return null;
}

// ---- bindings

function collectBindings(sourceFile: ts.SourceFile, types: readonly TypeDeclFact[], calls: readonly TypedCallFact[]): BindingFact[] {
    const all: BindingFact[] = [];
    for (const s of sourceFile.statements){
        if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.importClause){
            const specifier = s.moduleSpecifier.text;
            const clause = s.importClause;
            if (clause.name) all.push({ kind: "import", local: clause.name.text, imported: "default", specifier });
            const named = clause.namedBindings;
            if (named && ts.isNamespaceImport(named)) all.push({ kind: "import", local: named.name.text, imported: "*", specifier });
            else if (named) for (const el of named.elements) all.push({ kind: "import", local: el.name.text, imported: (el.propertyName ?? el.name).text, specifier });
        } else if (ts.isExportDeclaration(s)){
            const specifier = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : null;
            const clause = s.exportClause;
            if (specifier !== null && clause === undefined) all.push({ kind: "reexport", local: "*", imported: "*", specifier });
            else if (specifier !== null && clause !== undefined && ts.isNamespaceExport(clause)) all.push({ kind: "reexport", local: clause.name.text, imported: "*", specifier });
            else if (clause !== undefined && ts.isNamedExports(clause)){
                for (const el of clause.elements){
                    const exported = el.name.text;
                    const local = (el.propertyName ?? el.name).text;
                    all.push(specifier === null ? { kind: "export", local: exported, imported: local, specifier: null } : { kind: "reexport", local: exported, imported: local, specifier });
                }
            }
        } else if (ts.isExportAssignment(s) && !s.isExportEquals && ts.isIdentifier(s.expression)){
            all.push({ kind: "export", local: "default", imported: s.expression.text, specifier: null });
        } else if ((ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name && hasModifier(s, ts.SyntaxKind.ExportKeyword) && hasModifier(s, ts.SyntaxKind.DefaultKeyword)){
            all.push({ kind: "export", local: "default", imported: s.name.text, specifier: null });
        }
    }
    // the imports a fact names (a TypeRef's first segment, a local export's name); every re-export and export
    const named = new Set<string>();
    const note = (ref: string | null): void => {
        if (ref !== null) named.add(ref.split(".")[0]);
    };
    for (const t of types){
        t.extendsRefs.forEach(note);
        t.implementsRefs.forEach(note);
        note(t.testDoubleOf);
        Object.values(t.fields).forEach(note);
    }
    for (const c of calls) if (c.receiver === "type") note(c.ref);
    for (const b of all) if (b.kind === "export") named.add(b.imported);
    return all.filter((b) => b.kind !== "import" || named.has(b.local));
}

// ---- small helpers

function unwrap(e: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    return e;
}

function memberName(name: ts.PropertyName | ts.MemberName | undefined): string | null {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return null;
}

function isParameterProperty(p: ts.ParameterDeclaration): boolean {
    const kinds = [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword, ts.SyntaxKind.OverrideKeyword];
    return (ts.getModifiers(p) ?? []).some((m) => kinds.includes(m.kind));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((m) => m.kind === kind);
}

const uncapitalize = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
```

Notes for the implementer:
- `ts.getDecorators` and `ts.getModifiers` are TypeScript 5's accessors; `ts.HasDecorators` covers parameters and property declarations.
- `findDeclaration` returns the `BindingElement` for a destructured parameter, so `identifierReceiver` reaches `bindingReceiver` for `loadOne({ files, path }: { … })`.
- A receiver typed by a type parameter without a constraint gives nothing (`typeRefOf` returns null).

- [ ] **Step 6: Wire it into the adapter (`lib/index/languages/typescript.ts`)**

- `ADAPTER_VERSION = 5`, its comment gaining: `5: call facts, a fourth product of the parse (ADR-059).`
- `ParsedFile` gains `/** Call facts (ADR-059): declarations, bindings, typed calls and injection sites. */ calls: CallFacts;` (import the type from `../../db/schema`).
- `parseTypeScriptFile`: the comment becomes "One parse, four products"; add `calls: collectCallFacts(sourceFile)`.
- `parseTypeScriptImportsOnly`: parse once into `sourceFile`, then `{ chunks: [], symbols: [], imports: collectImports(sourceFile), calls: collectCallFacts(sourceFile), lineCount }` (R-P); its doc comment says the call facts are kept.
- `scanTypeScriptImports`: `calls: emptyCallFacts()` (no syntax tree to read them from).

- [ ] **Step 7: Run the tests and see them pass**

Run: `npx vitest run lib/index/languages`
Expected: PASS (about 17 new).

- [ ] **Step 8: Gate, commit, push**

Run the gate (about 1,357/1,357). Then:
```bash
git add -A -- test/fixtures/di-repo lib/db/schema.ts lib/index/languages && git commit -m "feat(index): call facts, a fourth product of the TypeScript parse (bindings, declarations, typed calls, injection sites; ADAPTER_VERSION 5), and the di-repo fixture" -- test/fixtures/di-repo lib/db/schema.ts lib/index/languages && git push origin pivot/v1
```

### Task 2: The store: migration 0009, three tables, replaced per file

**Files:**
- Modify: `lib/db/schema.ts` (tables), `lib/db/store/structure.ts` (+ `structure.test.ts`), `lib/index/pipeline.ts` (+ `pipeline.test.ts`), `lib/index/update.test.ts`
- Create: `lib/db/store/calls.ts`
- Generate: `lib/db/migrations/0009_v1_7_calls.sql` (+ drizzle's meta)

**Interfaces:**
- Consumes: `CallFacts` (Task 1), `ParsedFile.calls`.
- Produces: `FileRecord.calls`; `replaceCallFacts(tx, fileId, facts)`; `loadTypeDecls(db, repoId): StoredTypeDecl[]`, `loadCallBindings(db, repoId): StoredBinding[]`, `loadCallsOf(db, repoId, member): StoredCall[]`, `loadInjectionSites(db, repoId, name): StoredCall[]`, with `StoredTypeDecl = TypeDeclFact & { path: string; isTest: boolean }`, `StoredBinding = BindingFact & { path: string }`, `StoredCall = TypedCallFact & { path: string; isTest: boolean }`. Task 3 reads them.

- [ ] **Step 1: Write the failing tests**

`lib/db/store/structure.test.ts`: the `record()` helper gains `calls: { types: [], bindings: [], calls: [] }`, and a new test:

```ts
it("writes a file's call facts and a rewrite replaces them (ADR-059)", () => {
    const db = getDb();
    const repoId = upsertRepository(db, "/store/calls");
    const facts = {
        types: [{ name: "A", kind: "class" as const, line: 1, exported: true, nested: false, extendsRefs: ["B"], implementsRefs: [], testDoubleOf: null, members: ["run"], fields: { f: "IF" } }],
        bindings: [{ kind: "import" as const, local: "B", imported: "B", specifier: "./b" }],
        calls: [{ line: 2, member: "go", receiver: "field" as const, ref: "f", inClass: "A", how: "field" as const }],
    };
    writeFileRecords(db, repoId, [record("a.ts", { calls: facts })]);
    expect(loadTypeDecls(db, repoId)).toEqual([{ ...facts.types[0], path: "a.ts", isTest: false }]);
    expect(loadCallBindings(db, repoId)).toEqual([{ ...facts.bindings[0], path: "a.ts" }]);
    expect(loadCallsOf(db, repoId, "go")).toEqual([{ ...facts.calls[0], path: "a.ts", isTest: false }]);

    writeFileRecords(db, repoId, [record("a.ts", { contentHash: "new", calls: { types: [], bindings: [], calls: [] } })]);
    expect(loadTypeDecls(db, repoId)).toEqual([]);
    expect(loadCallBindings(db, repoId)).toEqual([]);
    expect(loadCallsOf(db, repoId, "go")).toEqual([]);
});

it("finds injection sites by a type's name, bare or through a namespace", () => {
    const db = getDb();
    const repoId = upsertRepository(db, "/store/sites");
    const site = (line: number, ref: string) => ({ line, member: null, receiver: "type" as const, ref, inClass: null, how: "provider" as const });
    writeFileRecords(db, repoId, [record("s.ts", { calls: { types: [], bindings: [], calls: [site(1, "IFoo"), site(2, "ns.IFoo"), site(3, "IFooBar"), site(4, "x.IFoo2")] } })]);
    expect(loadInjectionSites(db, repoId, "IFoo").map((s) => s.line)).toEqual([1, 2]);
});
```

`lib/index/pipeline.test.ts`: the literal at L294 gains `calls: { types: [], bindings: [], calls: [] }`, and a new describe:

```ts
describe("indexRepository on the calls fixture (ADR-059)", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "di-repo");

    it("indexes 28 files, two of them tests, with 36 edges, and stores editorPane.ts's call facts", () => {
        const result = indexRepository(root);
        expect(result.files).toBe(28);
        expect(result.edges).toBe(36);
        const db = getDb();
        const ofFile = <T extends { path: string }>(rows: T[]): T[] => rows.filter((r) => r.path === "src/workbench/editor/editorPane.ts");
        expect(ofFile(loadTypeDecls(db, result.repoId)).map((t) => t.name)).toEqual(["EditorPane"]);
        expect(ofFile(loadCallBindings(db, result.repoId)).map((b) => b.local)).toEqual(["IFileService", "IWatchingFileService", "Disposable"]);
        expect(ofFile(loadCallsOf(db, result.repoId, "readFile")).map((c) => c.line)).toEqual([15, 15]);
        expect(ofFile(loadInjectionSites(db, result.repoId, "IFileService")).map((c) => c.line)).toEqual([6]);
    });
});
```

`lib/index/update.test.ts`, one new test on a temp copy of di-repo (`copyFixture(DI_FIXTURE)`, with `DI_FIXTURE` added to `test/helpers/fixture.ts` beside `ARCH_FIXTURE`). `history.ts` has 9 lines and ends with a newline, so the appended text starts with a blank line 10 and puts `late` on line 11:
```ts
it("replaces a changed file's call facts on an update (ADR-059)", () => {
    const root = copyFixture(DI_FIXTURE);
    const { repoId } = indexRepository(root);
    const file = "src/workbench/history/history.ts";
    fs.appendFileSync(path.join(root, file), "\nexport function late(f: IFileService): string { return f.readFile(\"z\"); }\n");
    applyFileChanges(root, [file]);
    const lines = loadCallsOf(getDb(), repoId, "readFile").filter((c) => c.path === file).map((c) => c.line);
    expect(lines).toEqual([4, 8, 11]);
});
```
(Each test in `update.test.ts` copies its fixture and indexes it itself, as this one does; the file's imports gain `DI_FIXTURE` and `loadCallsOf`.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/db lib/index`
Expected: FAIL (no `calls` on `FileRecord`; no `lib/db/store/calls`).

- [ ] **Step 3: The tables (`lib/db/schema.ts`)**

At the end of the file, after Task 1's fact types (`typed_calls` uses `CALL_RULES`, which must be declared above it):

```ts
/** Classes and interfaces, per file (ADR-059). Lists and maps are JSON text, read back by lib/db/store/calls.ts. */
export const typeDecls = sqliteTable("type_decls", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    name: text("name"),
    kind: text("kind", { enum: ["class", "interface"] }).notNull(),
    line: integer("line").notNull(),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    nested: integer("nested", { mode: "boolean" }).notNull().default(false),
    extendsRefs: text("extends_refs").notNull().default("[]"),
    implementsRefs: text("implements_refs").notNull().default("[]"),
    testDoubleOf: text("test_double_of"),
    members: text("members").notNull().default("[]"),
    fields: text("fields").notNull().default("{}"),
}, (t) => [
    index("type_decls_file_idx").on(t.fileId),
    index("type_decls_name_idx").on(t.name),
]);

/** Imports the call facts name, and every re-export and local export, per file (ADR-059). */
export const callBindings = sqliteTable("call_bindings", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["import", "reexport", "export"] }).notNull(),
    local: text("local").notNull(),
    imported: text("imported").notNull(),
    specifier: text("specifier"),
}, (t) => [
    index("call_bindings_file_idx").on(t.fileId),
]);

/** Typed calls and injection sites (member null), per file (ADR-059); looked up by member. */
export const typedCalls = sqliteTable("typed_calls", {
    id: integer().primaryKey({ autoIncrement: true }),
    fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    member: text("member"),
    receiver: text("receiver", { enum: ["type", "field", "this"] }).notNull(),
    ref: text("ref"),
    inClass: text("in_class"),
    how: text("how", { enum: CALL_RULES }).notNull(),
}, (t) => [
    index("typed_calls_file_idx").on(t.fileId),
    index("typed_calls_member_idx").on(t.member),
]);
```

Run: `npx drizzle-kit generate --name v1_7_calls`
Expected: `lib/db/migrations/0009_v1_7_calls.sql` with three `CREATE TABLE` and five `CREATE INDEX`, and `meta/0009_snapshot.json` plus a journal entry (idx 9). Read the SQL before going on.

- [ ] **Step 4: The store (`lib/db/store/calls.ts`) and the write**

```ts
import { and, eq, isNull, like, or } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { callBindings, files, typeDecls, typedCalls, type BindingFact, type CallFacts, type TypeDeclFact, type TypedCallFact } from "../schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type StoredTypeDecl = TypeDeclFact & { path: string; isTest: boolean };
export type StoredBinding = BindingFact & { path: string };
export type StoredCall = TypedCallFact & { path: string; isTest: boolean };

/** A file's call facts, replaced inside writeOne's transaction with its chunks and symbols (ADR-059). */
export function replaceCallFacts(tx: Tx, fileId: number, facts: CallFacts): void {
    tx.delete(typeDecls).where(eq(typeDecls.fileId, fileId)).run();
    tx.delete(callBindings).where(eq(callBindings.fileId, fileId)).run();
    tx.delete(typedCalls).where(eq(typedCalls.fileId, fileId)).run();
    const typeRows = facts.types.map((t) => ({
        fileId, name: t.name, kind: t.kind, line: t.line, exported: t.exported, nested: t.nested,
        extendsRefs: JSON.stringify(t.extendsRefs), implementsRefs: JSON.stringify(t.implementsRefs), testDoubleOf: t.testDoubleOf,
        members: JSON.stringify(t.members), fields: JSON.stringify(t.fields),
    }));
    forEachBatch(typeRows, columnCount(typeDecls), (batch) => { tx.insert(typeDecls).values(batch).run(); });
    forEachBatch(facts.bindings.map((b) => ({ fileId, ...b })), columnCount(callBindings), (batch) => { tx.insert(callBindings).values(batch).run(); });
    forEachBatch(facts.calls.map((c) => ({ fileId, ...c })), columnCount(typedCalls), (batch) => { tx.insert(typedCalls).values(batch).run(); });
}

/** Every class and interface of a repo, with its file (the engine's call index, once per index version). */
export function loadTypeDecls(db: Db, repoId: number): StoredTypeDecl[] {
    return db.select({ path: files.path, isTest: files.isTest, d: typeDecls }).from(typeDecls)
        .innerJoin(files, eq(files.id, typeDecls.fileId)).where(eq(files.repoId, repoId)).orderBy(files.path, typeDecls.id).all()
        .map(({ path, isTest, d }) => ({
            name: d.name, kind: d.kind, line: d.line, exported: d.exported, nested: d.nested,
            extendsRefs: JSON.parse(d.extendsRefs) as string[], implementsRefs: JSON.parse(d.implementsRefs) as string[], testDoubleOf: d.testDoubleOf,
            members: JSON.parse(d.members) as string[], fields: JSON.parse(d.fields) as Record<string, string>, path, isTest,
        }));
}

export function loadCallBindings(db: Db, repoId: number): StoredBinding[] {
    return db.select({ path: files.path, kind: callBindings.kind, local: callBindings.local, imported: callBindings.imported, specifier: callBindings.specifier })
        .from(callBindings).innerJoin(files, eq(files.id, callBindings.fileId)).where(eq(files.repoId, repoId)).orderBy(files.path, callBindings.id).all();
}

const callColumns = {
    path: files.path, isTest: files.isTest, line: typedCalls.line, member: typedCalls.member, receiver: typedCalls.receiver,
    ref: typedCalls.ref, inClass: typedCalls.inClass, how: typedCalls.how,
};

/** The calls of one member name across a repo (typed_calls_member_idx). */
export function loadCallsOf(db: Db, repoId: number, member: string): StoredCall[] {
    return db.select(callColumns).from(typedCalls).innerJoin(files, eq(files.id, typedCalls.fileId))
        .where(and(eq(files.repoId, repoId), eq(typedCalls.member, member))).orderBy(files.path, typedCalls.line, typedCalls.id).all();
}

/** The injection sites whose TypeRef is the name, bare or as a namespace's member ("IFoo", "ns.IFoo"). */
export function loadInjectionSites(db: Db, repoId: number, name: string): StoredCall[] {
    return db.select(callColumns).from(typedCalls).innerJoin(files, eq(files.id, typedCalls.fileId))
        .where(and(eq(files.repoId, repoId), isNull(typedCalls.member), or(eq(typedCalls.ref, name), like(typedCalls.ref, `%.${name}`))))
        .orderBy(files.path, typedCalls.line, typedCalls.id).all()
        // LIKE's "_" matches any character: keep only a true ".name" ending
        .filter((c) => c.ref === name || c.ref!.endsWith(`.${name}`));
}
```

`lib/db/store/structure.ts`: `FileRecord` gains `/** Call facts (ADR-059). */ calls: CallFacts;`; `writeOne` ends with `replaceCallFacts(tx, fileId, r.calls);` (the delete of chunks and symbols stays as it is). `lib/index/pipeline.ts`'s `toFileRecord` adds `calls: parsed.calls`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run lib/db lib/index`
Expected: PASS (4 new). The pipeline tests that force a re-parse by writing `ADAPTER_VERSION - 1` still pass: version 4 is older.

- [ ] **Step 6: Gate, commit, push**

`docs/DATABASE_DESIGN.md` gains `## 11. V1.7 additions (calls, ADR-059)`: the three tables, one line each (what a row is, its key, and that a file's rows are replaced with its chunks and symbols).

Run the gate (about 1,361/1,361). Then:
```bash
git add -A -- lib/db test/helpers/fixture.ts lib/index/pipeline.ts lib/index/pipeline.test.ts lib/index/update.test.ts docs/DATABASE_DESIGN.md && git commit -m "feat(db): migration 0009, the call facts stored per file (type_decls, call_bindings, typed_calls) and replaced with the file's chunks and symbols" -- lib/db test/helpers/fixture.ts lib/index/pipeline.ts lib/index/pipeline.test.ts lib/index/update.test.ts docs/DATABASE_DESIGN.md && git push origin pivot/v1
```

Then tell the owner: until their database is migrated (Task 5's re-index does it, and so does the Map's next start), Nebulosity's MCP server in their Claude Code sessions answers every call with the error that the index is older than the checkout.

### Task 3: The engine: the call index and `calls()` (ADR-059)

**Files:**
- Create: `lib/engine/calls.ts`, `lib/engine/calls.test.ts`
- Modify: `docs/ARCHITECTURE.md` (§2's diagram and §5's `engine/` line gain `calls`)

**Interfaces:**
- Consumes: `loadTypeDecls`, `loadCallBindings`, `loadCallsOf`, `loadInjectionSites` (Task 2); `importGraphFor` (graph.ts), `areasOf` (impact.ts), `kindAt` (reach.ts), `loadImportEdges`, `loadFolderInfo`.
- Produces: `buildCallIndex(decls, bindings, edges): CallIndex`; `hierarchyOf(index, key)`; `callIndexFor(db, repoId, version)`; `calls(repoRoot, { symbol, path? }, { groupBy, within? }): CallsAnswer` with the types below. Task 4 formats `CallsAnswer`; Task 5 reads `CallerFile.sites`.

- [ ] **Step 1: Write the failing tests**

`lib/engine/calls.test.ts` (the fixture is indexed in place, as `impact.test.ts` indexes arch-repo; every value is the ground truth's):

```ts
import path from "path";
import { describe, expect, it } from "vitest";
import { indexRepository } from "../index/pipeline";
import { buildCallIndex, calls, hierarchyOf } from "./calls";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "di-repo");
indexRepository(root);
const F = "src/platform/files";

describe("calls: who calls a member", () => {
    it("IFileService.readFile: 8 files, 13 calls, on the type, a sub-interface and the implementations", () => {
        const a = calls(root, { symbol: "IFileService.readFile" });
        if (a.kind !== "member") throw new Error(a.kind);
        expect(a.type).toEqual({ name: "IFileService", kind: "interface", path: `${F}/common/files.ts`, line: 5 });
        expect(a.files.map((f) => [f.path, f.lines, f.receivers])).toEqual([
            ["src/workbench/commands/openCommand.ts", [8, 8, 12], []],
            ["src/workbench/editor/editorPane.ts", [15, 15], ["IFileService", "IWatchingFileService"]],
            ["src/workbench/history/history.ts", [4, 8], []],
            ["src/workbench/test/fileService.test.ts", [14, 14], ["FileService", "TestFileService"]],
            [`${F}/common/fileService.ts`, [10], ["FileService"]],
            [`${F}/node/watchingFileService.ts`, [6], ["WatchingFileService"]],
            ["src/workbench/editor/textEditor.ts", [5], []],
            ["src/workbench/search/searchModel.ts", [8], ["FileService"]],
        ]);
        expect([a.calls, a.tests]).toEqual([13, 1]);
        expect(a.categories).toEqual({ type: 4, subtype: 1, implementation: 4 });
        expect(a.declaring).toEqual([`${F}/browser/memoryFileService.ts`, `${F}/common/files.ts`]);
        expect(a.implementations.map((i) => [i.name, i.path, i.line, i.via, i.through, i.declares])).toEqual([
            ["MemoryFileService", `${F}/browser/memoryFileService.ts`, 3, "implements", null, true],
            ["FileService", `${F}/common/fileService.ts`, 4, "implements", null, true],
            ["WatchingFileService", `${F}/node/watchingFileService.ts`, 4, "sub-interface", "IWatchingFileService", false],
            ["TestFileService", "src/workbench/test/fileService.test.ts", 6, "test double", null, true],
        ]);
        expect(a.areas).toEqual([
            { path: "src/workbench", kind: "folder", count: 6 },
            { path: `${F}/common/fileService.ts`, kind: "file", count: 1 },
            { path: `${F}/node`, kind: "folder", count: 1 },
        ]);
    });

    it("doesn't see the call on an inferred receiver (inferred.ts)", () => {
        const a = calls(root, { symbol: "IFileService.readFile" });
        expect(a.kind === "member" && a.files.some((f) => f.path.endsWith("inferred.ts"))).toBe(false);
    });

    it("follows a namespace re-export to an implementation (IWatchingFileService.watch)", () => {
        const a = calls(root, { symbol: "IWatchingFileService.watch" });
        if (a.kind !== "member") throw new Error(a.kind);
        expect(a.files.map((f) => [f.path, f.lines, f.receivers])).toEqual([
            ["src/workbench/editor/editorPane.ts", [14], []],
            ["src/workbench/files/watchView.ts", [4], ["WatchingFileService"]],
        ]);
    });

    it("reads AFFiNE's hooks, Inversify's @inject and a workspace package (DialogService, CommandRegistry, Framework)", () => {
        const dialog = calls(root, { symbol: "DialogService.open" });
        if (dialog.kind !== "member") throw new Error(dialog.kind);
        expect(dialog.files.map((f) => [f.path, f.lines])).toEqual([["src/app/components/settingsButton.tsx", [6, 7, 9]]]);
        expect(dialog.declaring).toEqual(["src/app/dialogs/dialogService.ts"]);
        expect(dialog.subtypeWord).toBe("subclass");
        const registry = calls(root, { symbol: "CommandRegistry.register" });
        expect(registry.kind === "member" && registry.files.map((f) => [f.path, f.lines])).toEqual([["src/app/commands/commandContribution.ts", [10, 11]]]);
        const framework = calls(root, { symbol: "Framework.service" });
        expect(framework.kind === "member" && framework.files.map((f) => [f.path, f.lines])).toEqual([["src/app/dialogs/index.ts", [6]]]);
    });

    it("keeps only files inside within, and groups by a folder's children", () => {
        const inside = calls(root, { symbol: "IFileService.readFile" }, { groupBy: null, within: "src/workbench" });
        if (inside.kind !== "member") throw new Error(inside.kind);
        expect(inside.files.map((f) => f.path)).toEqual([
            "src/workbench/commands/openCommand.ts", "src/workbench/editor/editorPane.ts", "src/workbench/history/history.ts",
            "src/workbench/test/fileService.test.ts", "src/workbench/editor/textEditor.ts", "src/workbench/search/searchModel.ts",
        ]);
        expect([inside.calls, inside.declaring, inside.implementations.map((i) => i.name)]).toEqual([11, [], ["TestFileService"]]);
        const grouped = calls(root, { symbol: "IFileService.readFile" }, { groupBy: "src/workbench" });
        if (grouped.kind !== "member") throw new Error(grouped.kind);
        expect([grouped.areas, grouped.elsewhere]).toEqual([[
            { path: "src/workbench/editor", kind: "folder", count: 2 },
            { path: "src/workbench/commands", kind: "folder", count: 1 },
            { path: "src/workbench/history", kind: "folder", count: 1 },
            { path: "src/workbench/search", kind: "folder", count: 1 },
            { path: "src/workbench/test", kind: "folder", count: 1 },
        ], 2]);
    });
});

describe("calls: where a type is injected", () => {
    it("IFileService: 3 files, 5 places; not where IWatchingFileService is injected", () => {
        const a = calls(root, { symbol: "IFileService" });
        if (a.kind !== "type") throw new Error(a.kind);
        expect(a.files.map((f) => [f.path, f.lines, f.hows])).toEqual([
            ["src/workbench/commands/openCommand.ts", [5, 6, 7], ["accessor or hook"]],
            ["src/workbench/editor/baseEditor.ts", [4], ["constructor"]],
            ["src/workbench/editor/editorPane.ts", [6], ["constructor"]],
        ]);
        expect([a.places, a.tests, a.implementations.length]).toEqual([5, 0, 4]);
    });

    it("DialogService through hooks, CommandRegistry through @inject; framework.service is a registration, not an injection", () => {
        const dialog = calls(root, { symbol: "DialogService" });
        expect(dialog.kind === "type" && dialog.files.map((f) => [f.path, f.lines])).toEqual([["src/app/components/settingsButton.tsx", [5, 7, 8]]]);
        const registry = calls(root, { symbol: "CommandRegistry" });
        expect(registry.kind === "type" && registry.files.map((f) => [f.path, f.lines, f.hows])).toEqual([
            ["src/app/commands/commandContribution.ts", [5, 7], ["@inject field", "constructor"]],
        ]);
    });
});

describe("calls: names and errors", () => {
    it("lists both Loggers and asks for path; with path, each finds its own caller", () => {
        expect(calls(root, { symbol: "Logger.log" })).toEqual({ kind: "ambiguous", name: "Logger", candidates: [
            { kind: "class", path: "src/platform/log/logger.ts", line: 1 },
            { kind: "class", path: "src/workbench/log/logger.ts", line: 1 },
        ] });
        const platform = calls(root, { symbol: "Logger.log", path: "src/platform/log/logger.ts" });
        expect(platform.kind === "member" && platform.files.map((f) => [f.path, f.lines])).toEqual([["src/workbench/log/logView.ts", [6]]]);
        const workbench = calls(root, { symbol: "Logger.log", path: "src/workbench/log/logger.ts" });
        expect(workbench.kind === "member" && workbench.files.map((f) => [f.path, f.lines])).toEqual([["src/workbench/log/logView.ts", [5]]]);
    });

    it("refuses an unknown type, a missing member, a path that declares none, a bad symbol, and a file as within", () => {
        expect(() => calls(root, { symbol: "Nope.x" })).toThrow("No class or interface named Nope is indexed.");
        expect(() => calls(root, { symbol: "IFileService.save" })).toThrow("IFileService has no member save. Its members: readFile, writeFile.");
        expect(() => calls(root, { symbol: "Logger", path: "src/app/dialogs/index.ts" })).toThrow("src/app/dialogs/index.ts declares no class or interface named Logger.");
        expect(() => calls(root, { symbol: "a.b.c" })).toThrow('symbol takes a class or interface ("IFooService") or one of its members ("IFooService.save").');
        expect(() => calls(root, { symbol: "IFileService" }, { groupBy: null, within: "src/workbench/editor/textEditor.ts" })).toThrow("within takes a folder.");
    });
});

describe("buildCallIndex: loops end (Review Focus 1), one name is one type (Review Focus 2)", () => {
    const decl = (pathName: string, name: string, extendsRefs: string[] = [], members: string[] = []) => ({
        path: pathName, isTest: false, name, kind: "class" as const, line: 1, exported: true, nested: false,
        extendsRefs, implementsRefs: [], testDoubleOf: null, members, fields: {},
    });

    it("an extends cycle and an export * cycle answer, each type once", () => {
        const index = buildCallIndex(
            [decl("a.ts", "A", ["B"]), decl("b.ts", "B", ["A"])],
            [
                { path: "a.ts", kind: "import", local: "B", imported: "B", specifier: "./b" },
                { path: "b.ts", kind: "import", local: "A", imported: "A", specifier: "./a" },
                { path: "x.ts", kind: "reexport", local: "*", imported: "*", specifier: "./y" },
                { path: "y.ts", kind: "reexport", local: "*", imported: "*", specifier: "./x" },
                { path: "c.ts", kind: "import", local: "Z", imported: "Z", specifier: "./x" },
            ],
            [
                { source: "a.ts", target: "b.ts", specifier: "./b" }, { source: "b.ts", target: "a.ts", specifier: "./a" },
                { source: "x.ts", target: "y.ts", specifier: "./y" }, { source: "y.ts", target: "x.ts", specifier: "./x" },
                { source: "c.ts", target: "x.ts", specifier: "./x" },
            ],
        );
        expect(index.resolve("c.ts", "Z")).toBeNull();
        const { subtypes } = hierarchyOf(index, "a.ts#A");
        expect([...subtypes]).toEqual(["b.ts#B"]);
    });

    it("merges two declarations of one name in a file", () => {
        const index = buildCallIndex([decl("f.ts", "IFoo", ["IA"], ["a"]), decl("f.ts", "IFoo", ["IB"], ["b"])], [], []);
        expect([...index.types.get("f.ts#IFoo")!.members].sort()).toEqual(["a", "b"]);
        expect(index.types.get("f.ts#IFoo")!.extendsRefs).toEqual(["IA", "IB"]);
        expect(index.byName.get("IFoo")).toEqual(["f.ts#IFoo"]);
    });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/engine/calls.test.ts`
Expected: FAIL, cannot find module `./calls`.

- [ ] **Step 3: Write `lib/engine/calls.ts`**

```ts
import path from "path";
import { getDb, type Db } from "../db/client";
import { loadCallBindings, loadCallsOf, loadInjectionSites, loadTypeDecls, type StoredBinding, type StoredCall, type StoredTypeDecl } from "../db/store/calls";
import { loadFolderInfo } from "../db/store/map";
import { loadImportEdges, requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import type { CallRule } from "../db/schema";
import { repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { importGraphFor, type ImportGraph } from "./graph";
import { areasOf, type ImpactArea } from "./impact";
import { kindAt } from "./reach";

/**
 * Calls through declared types (ADR-059), resolved at query time (R-B). The adapter stored each file's facts; here a
 * TypeRef written in a file is followed to the file that declares the type: a type declared there wins, else the import
 * binding of that name, the stored import edge with the binding's specifier, and that module's exports, through
 * re-exports and `export *` with a visited set. Heritage then gives each type's subtypes and implementations. The index is
 * built once per index version and kept beside the import graph of that version, as the import index is (ADR-045).
 */

/** A type: its file and name ("src/a.ts#IFoo"), or for a nested or nameless class its file and line ("src/a.ts@12", R-O). */
export type TypeKey = string;

export type TypeInfo = {
    key: TypeKey; file: string; name: string | null; kind: "class" | "interface"; line: number; nested: boolean; isTest: boolean;
    extendsRefs: string[]; implementsRefs: string[]; testDoubleOf: string | null; members: Set<string>; fields: Map<string, string>;
};

export type CallIndex = {
    types: Map<TypeKey, TypeInfo>;
    /** A declared name → its top-level types, in path order. */
    byName: Map<string, TypeKey[]>;
    /** A type → the types that extend it directly (sub-interfaces; subclasses). */
    extendedBy: Map<TypeKey, TypeKey[]>;
    /** A type → the classes that implement it directly, and its test doubles. */
    implementedBy: Map<TypeKey, { key: TypeKey; double: boolean }[]>;
    /** A TypeRef as written in a file → the type it names, or null. Memoized. */
    resolve(file: string, ref: string): TypeKey | null;
};

export type Implementation = { key: TypeKey; via: "implements" | "sub-interface" | "base class" | "test double"; through: string | null };

type Edge = { source: string; target: string; specifier: string };
type Found = { type: TypeKey } | { namespace: string } | null;

/** How many bindings one resolution may follow before it gives up: barrels chain, but not this far. */
const MAX_HOPS = 32;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (info: TypeInfo | undefined): string => info?.name ?? "(anonymous class)";

export function buildCallIndex(decls: readonly StoredTypeDecl[], bindings: readonly StoredBinding[], edges: readonly Edge[]): CallIndex {
    const types = new Map<TypeKey, TypeInfo>();
    const byName = new Map<string, TypeKey[]>();
    const localTypes = new Map<string, Map<string, TypeKey>>();
    for (const d of decls){
        const key = d.nested || d.name === null ? `${d.path}@${d.line}` : `${d.path}#${d.name}`;
        const seen = types.get(key);
        if (seen){
            // one name, several declarations in a file (Review Focus 2): one type, its parts merged
            if (d.kind === "class") seen.kind = "class";
            seen.line = Math.min(seen.line, d.line);
            seen.extendsRefs.push(...d.extendsRefs);
            seen.implementsRefs.push(...d.implementsRefs);
            seen.testDoubleOf ??= d.testDoubleOf;
            for (const m of d.members) seen.members.add(m);
            for (const [field, ref] of Object.entries(d.fields)) if (!seen.fields.has(field)) seen.fields.set(field, ref);
            continue;
        }
        types.set(key, {
            key, file: d.path, name: d.name, kind: d.kind, line: d.line, nested: d.nested, isTest: d.isTest,
            extendsRefs: [...d.extendsRefs], implementsRefs: [...d.implementsRefs], testDoubleOf: d.testDoubleOf,
            members: new Set(d.members), fields: new Map(Object.entries(d.fields)),
        });
        if (!d.nested && d.name !== null){
            byName.set(d.name, [...(byName.get(d.name) ?? []), key]);
            const local = localTypes.get(d.path) ?? new Map<string, TypeKey>();
            local.set(d.name, key);
            localTypes.set(d.path, local);
        }
    }
    const bindingsOf = new Map<string, StoredBinding[]>();
    for (const b of bindings) bindingsOf.set(b.path, [...(bindingsOf.get(b.path) ?? []), b]);
    const targets = new Map<string, string>();
    for (const e of edges) targets.set(`${e.source}\0${e.specifier}`, e.target);
    const edgeOf = (file: string, specifier: string | null): string | null => (specifier === null ? null : targets.get(`${file}\0${specifier}`) ?? null);

    // a name in a file: a type declared there, or what its import binding brings in
    const resolveLocal = (file: string, name: string, hops: number): Found => {
        const local = localTypes.get(file)?.get(name);
        if (local !== undefined) return { type: local };
        const b = (bindingsOf.get(file) ?? []).find((x) => x.kind === "import" && x.local === name);
        const into = b ? edgeOf(file, b.specifier) : null;
        if (!b || into === null) return null;
        return b.imported === "*" ? { namespace: into } : resolveExport(into, b.imported, hops + 1, new Set());
    };
    // a name a module exports: its own type, a local export, a re-export, or what an `export *` passes on
    const resolveExport = (file: string, name: string, hops: number, visited: Set<string>): Found => {
        const at = `${file}\0${name}`;
        if (hops > MAX_HOPS || visited.has(at)) return null;   // re-export loops (Review Focus 1)
        visited.add(at);
        if (name !== "default"){
            const local = localTypes.get(file)?.get(name);
            if (local !== undefined) return { type: local };
        }
        const own = bindingsOf.get(file) ?? [];
        const exported = own.find((x) => x.kind === "export" && x.local === name);
        if (exported) return resolveLocal(file, exported.imported, hops + 1);
        const renamed = own.find((x) => x.kind === "reexport" && x.local === name);
        if (renamed){
            const into = edgeOf(file, renamed.specifier);
            if (into === null) return null;
            return renamed.imported === "*" ? { namespace: into } : resolveExport(into, renamed.imported, hops + 1, visited);
        }
        if (name === "default") return null;   // an `export *` never passes a default on
        for (const star of own.filter((x) => x.kind === "reexport" && x.local === "*")){
            const into = edgeOf(file, star.specifier);
            const found = into === null ? null : resolveExport(into, name, hops + 1, visited);
            if (found !== null) return found;
        }
        return null;
    };
    const memo = new Map<string, TypeKey | null>();
    const resolve = (file: string, ref: string): TypeKey | null => {
        const k = `${file}\0${ref}`;
        if (memo.has(k)) return memo.get(k)!;
        const dot = ref.indexOf(".");
        let found: Found;
        if (dot < 0) found = resolveLocal(file, ref, 0);
        else {
            const space = resolveLocal(file, ref.slice(0, dot), 0);
            found = space !== null && "namespace" in space ? resolveExport(space.namespace, ref.slice(dot + 1), 1, new Set()) : null;
        }
        const key = found !== null && "type" in found ? found.type : null;
        memo.set(k, key);
        return key;
    };

    const extendedBy = new Map<TypeKey, TypeKey[]>();
    const implementedBy = new Map<TypeKey, { key: TypeKey; double: boolean }[]>();
    const add = <T>(map: Map<TypeKey, T[]>, key: TypeKey, value: T): void => { map.set(key, [...(map.get(key) ?? []), value]); };
    for (const t of types.values()){
        for (const ref of t.extendsRefs){
            const s = resolve(t.file, ref);
            if (s !== null && s !== t.key) add(extendedBy, s, t.key);
        }
        for (const ref of t.implementsRefs){
            const s = resolve(t.file, ref);
            if (s !== null) add(implementedBy, s, { key: t.key, double: false });
        }
        const double = t.testDoubleOf === null ? null : resolve(t.file, t.testDoubleOf);
        if (double !== null) add(implementedBy, double, { key: t.key, double: true });
    }
    return { types, byName, extendedBy, implementedBy, resolve };
}

/** A type's subtypes (sub-interfaces, or a class's subclasses) and its implementations, each once, by rank: implements, sub-interface, base class, test double. */
export function hierarchyOf(index: CallIndex, target: TypeKey): { subtypes: Set<TypeKey>; implementations: Map<TypeKey, Implementation> } {
    const subtypes = new Set<TypeKey>();
    for (const queue = [target]; queue.length > 0;){
        for (const s of index.extendedBy.get(queue.shift()!) ?? []){
            if (s === target || subtypes.has(s)) continue;
            subtypes.add(s);
            queue.push(s);
        }
    }
    const rank = { "implements": 0, "sub-interface": 1, "base class": 2, "test double": 3 } as const;
    const implementations = new Map<TypeKey, Implementation>();
    const offer = (impl: Implementation): void => {
        const had = implementations.get(impl.key);
        if (!had || rank[impl.via] < rank[had.via]) implementations.set(impl.key, impl);
    };
    const interfaces = [target, ...[...subtypes].filter((s) => index.types.get(s)?.kind === "interface")];
    for (const i of interfaces){
        for (const { key, double } of index.implementedBy.get(i) ?? []){
            offer(double ? { key, via: "test double", through: null }
                : i === target ? { key, via: "implements", through: null }
                : { key, via: "sub-interface", through: nameOf(index.types.get(i)) });
        }
    }
    // the subclasses of an implementation implement the type too, through their base class
    for (const base of [...implementations.keys()]){
        for (const below = [base]; below.length > 0;){
            for (const sub of index.extendedBy.get(below.shift()!) ?? []){
                const had = implementations.get(sub);
                if (had && rank[had.via] <= rank["base class"]) continue;
                offer({ key: sub, via: "base class", through: nameOf(index.types.get(base)) });
                below.push(sub);
            }
        }
    }
    for (const s of subtypes) implementations.delete(s);   // a class's own subclasses are its subtypes
    return { subtypes, implementations };
}

/** Every member of a type and of what it extends. */
function allMembers(index: CallIndex, key: TypeKey): Set<string> {
    const out = new Set<string>();
    const seen = new Set<TypeKey>();
    for (const queue = [key]; queue.length > 0;){
        const at = queue.shift()!;
        const t = index.types.get(at);
        if (seen.has(at) || !t) continue;
        seen.add(at);
        for (const m of t.members) out.add(m);
        for (const ref of t.extendsRefs){
            const s = index.resolve(t.file, ref);
            if (s !== null) queue.push(s);
        }
    }
    return out;
}

/** A class's field, declared in it or in a base class (another file's included), as the type it holds. */
function fieldType(index: CallIndex, classKey: TypeKey, field: string, depth: number): TypeKey | null {
    const t = index.types.get(classKey);
    if (!t || depth > 10) return null;
    const ref = t.fields.get(field);
    if (ref !== undefined) return index.resolve(t.file, ref);
    if (t.members.has(field)) return null;   // declared there, with no type a rule can read
    for (const base of t.extendsRefs){
        const b = index.resolve(t.file, base);
        const found = b === null ? null : fieldType(index, b, field, depth + 1);
        if (found !== null) return found;
    }
    return null;
}

function receiverType(index: CallIndex, c: StoredCall): TypeKey | null {
    if (c.receiver === "type") return c.ref === null ? null : index.resolve(c.path, c.ref);
    const own = c.inClass === null ? null : `${c.path}#${c.inClass}`;
    if (own === null || !index.types.has(own)) return null;
    return c.receiver === "this" ? own : c.ref === null ? null : fieldType(index, own, c.ref, 0);
}

const indexes = new WeakMap<ImportGraph, CallIndex>();

/** The call index of one index version, kept with that version's import graph (a new version loads a new one, ADR-044). */
export function callIndexFor(db: Db, repoId: number, version: number): CallIndex {
    const graph = importGraphFor(db, repoId, version);
    let index = indexes.get(graph);
    if (!index){
        index = buildCallIndex(loadTypeDecls(db, repoId), loadCallBindings(db, repoId), loadImportEdges(db, repoId));
        indexes.set(graph, index);
    }
    return index;
}

export type TypeSummary = { name: string; kind: "class" | "interface"; path: string; line: number };
export type ImplementationLine = { name: string | null; path: string; line: number; via: Implementation["via"]; through: string | null; declares: boolean };
export type CallSite = { line: number; category: "type" | "subtype" | "implementation"; receiver: string; receiverDeclares: boolean };
export type CallerFile = { path: string; lines: number[]; receivers: string[]; isTest: boolean; sites: CallSite[] };
export type Areas = { groupBy: string | null; areas: ImpactArea[]; elsewhere: number };
export type MemberAnswer = Areas & {
    kind: "member"; type: TypeSummary; member: string; files: CallerFile[]; calls: number; tests: number;
    categories: { type: number; subtype: number; implementation: number }; subtypeWord: "sub-interface" | "subclass";
    /** Files declaring the member on the type, a subtype or an implementation, that don't also call it: what a signature change adds. */
    declaring: string[]; implementations: ImplementationLine[]; within?: string;
};
export type TypeAnswer = Areas & {
    kind: "type"; type: TypeSummary; files: { path: string; lines: number[]; hows: string[]; isTest: boolean }[]; places: number; tests: number;
    implementations: ImplementationLine[]; within?: string;
};
export type AmbiguousAnswer = { kind: "ambiguous"; name: string; candidates: { kind: "class" | "interface"; path: string; line: number }[] };
export type CallsAnswer = MemberAnswer | TypeAnswer | AmbiguousAnswer;

const SYMBOL = /^([A-Za-z_$][\w$]*)(?:\.(#?[A-Za-z_$][\w$]*))?$/;
const HOW_WORDS: Partial<Record<CallRule, string>> = { "ctor-param": "constructor", "inject-field": "@inject field", provider: "accessor or hook" };

/** Who calls a type's member, or where a type is injected, with its implementations (ADR-059). */
export function calls(repoRoot: string, query: { symbol: string; path?: string }, options: { groupBy: string | null; within?: string } = { groupBy: null }): CallsAnswer {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const parsed = SYMBOL.exec(query.symbol.trim());
        if (parsed === null) throw new BadInputError('symbol takes a class or interface ("IFooService") or one of its members ("IFooService.save").');
        const [, name, member] = parsed;
        const within = options.within === undefined || options.within === "" ? undefined : options.within;
        if (within !== undefined){
            const kind = kindAt(db, repoId, within);
            if (kind === null) throw new BadInputError(`within "${within}" isn't a folder in the index.`);
            if (kind === "file") throw new BadInputError("within takes a folder.");
        }
        if (options.groupBy !== null && options.groupBy !== "" && !loadFolderInfo(db, repoId, options.groupBy)){
            throw new BadInputError(`group_by takes a folder: nothing is indexed as a folder at "${options.groupBy}".`);
        }
        const index = callIndexFor(db, repoId, readIndexVersion(db, repoId));
        const candidates = (index.byName.get(name) ?? []).filter((k) => query.path === undefined || index.types.get(k)!.file === query.path);
        if (candidates.length === 0){
            throw new BadInputError(query.path === undefined
                ? `No class or interface named ${name} is indexed. calls finds a type by its declared name; a type alias, an enum or a type from outside the repo has none.`
                : `${query.path} declares no class or interface named ${name}.`);
        }
        if (candidates.length > 1){
            const found = candidates.map((k) => index.types.get(k)!).map((t) => ({ kind: t.kind, path: t.file, line: t.line }));
            return { kind: "ambiguous", name, candidates: found.sort((a, b) => compare(a.path, b.path)) };
        }
        const target = candidates[0];
        const t = index.types.get(target)!;
        const type: TypeSummary = { name, kind: t.kind, path: t.file, line: t.line };
        const inside = (p: string): boolean => within === undefined || p.startsWith(`${within}/`);
        const { subtypes, implementations } = hierarchyOf(index, target);
        const implementationLines = (declares: (info: TypeInfo) => boolean): ImplementationLine[] => [...implementations.values()]
            .map((impl) => ({ impl, info: index.types.get(impl.key)! }))
            .filter(({ info }) => inside(info.file))
            .map(({ impl, info }) => ({ name: info.name, path: info.file, line: info.line, via: impl.via, through: impl.through, declares: declares(info) }))
            .sort((a, b) => compare(a.path, b.path) || a.line - b.line);
        const areasFor = (paths: readonly string[]): Areas => ({ groupBy: options.groupBy, ...areasOf(paths.map((p) => ({ path: p, distance: 1 })), { path: t.file, kind: "file" }, options.groupBy) });
        const scope = within === undefined ? {} : { within };

        if (member === undefined){
            const byFile = new Map<string, { lines: number[]; hows: Set<string>; isTest: boolean }>();
            for (const site of loadInjectionSites(db, repoId, name)){
                if (!inside(site.path) || site.ref === null || index.resolve(site.path, site.ref) !== target) continue;
                const f = byFile.get(site.path) ?? { lines: [], hows: new Set<string>(), isTest: site.isTest };
                f.lines.push(site.line);
                f.hows.add(HOW_WORDS[site.how] ?? site.how);
                byFile.set(site.path, f);
            }
            const files = [...byFile].map(([p, f]) => ({ path: p, lines: [...f.lines].sort((a, b) => a - b), hows: [...f.hows].sort(compare), isTest: f.isTest }))
                .sort((a, b) => b.lines.length - a.lines.length || compare(a.path, b.path));
            return {
                kind: "type", type, files, places: files.reduce((s, f) => s + f.lines.length, 0), tests: files.filter((f) => f.isTest).length,
                implementations: implementationLines(() => false), ...areasFor(files.map((f) => f.path)), ...scope,
            };
        }

        const known = allMembers(index, target);
        if (!known.has(member)){
            const list = [...known].sort(compare);
            throw new BadInputError(`${name} has no member ${member}. Its members: ${list.slice(0, 30).join(", ")}${list.length > 30 ? ", …" : ""}.`);
        }
        const byFile = new Map<string, { sites: CallSite[]; isTest: boolean }>();
        for (const c of loadCallsOf(db, repoId, member)){
            if (!inside(c.path)) continue;
            const r = receiverType(index, c);
            const category = r === null ? null : r === target ? "type" : subtypes.has(r) ? "subtype" : implementations.has(r) ? "implementation" : null;
            if (r === null || category === null) continue;
            const info = index.types.get(r)!;
            const f = byFile.get(c.path) ?? { sites: [], isTest: c.isTest };
            f.sites.push({ line: c.line, category, receiver: nameOf(info), receiverDeclares: info.members.has(member) });
            byFile.set(c.path, f);
        }
        const files: CallerFile[] = [...byFile].map(([p, f]) => {
            const onlyOnType = f.sites.every((s) => s.category === "type");
            return {
                path: p, lines: f.sites.map((s) => s.line).sort((a, b) => a - b), isTest: f.isTest, sites: f.sites,
                receivers: onlyOnType ? [] : [...new Set(f.sites.map((s) => s.receiver))].sort(compare),
            };
        }).sort((a, b) => b.lines.length - a.lines.length || compare(a.path, b.path));
        const count = (category: CallSite["category"]): number => files.filter((f) => f.sites.some((s) => s.category === category)).length;
        const callers = new Set(files.map((f) => f.path));
        const declaring = new Set<string>();
        for (const key of [target, ...subtypes, ...implementations.keys()]){
            const info = index.types.get(key)!;
            if (info.members.has(member) && inside(info.file) && !callers.has(info.file)) declaring.add(info.file);
        }
        return {
            kind: "member", type, member, files, calls: files.reduce((s, f) => s + f.lines.length, 0), tests: files.filter((f) => f.isTest).length,
            categories: { type: count("type"), subtype: count("subtype"), implementation: count("implementation") },
            subtypeWord: t.kind === "interface" ? "sub-interface" : "subclass",
            declaring: [...declaring].sort(compare), implementations: implementationLines((info) => info.members.has(member)),
            ...areasFor(files.map((f) => f.path)), ...scope,
        };
    });
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run lib/engine/calls.test.ts`
Expected: PASS (11 tests). A failure here is a resolution rule, not a test: read the fixture file the test names before touching anything.

- [ ] **Step 5: Gate, commit, push**

`docs/ARCHITECTURE.md`, in the same commit:
- §2's diagram line `engine/      level · describe · graph (areas) · search · status · repos` becomes `engine/      level · describe · graph · search · status · repos · calls`, the same width, so the box holds;
- §5's `engine/` comment gains `calls`.

Run the gate (about 1,372/1,372). Then:
```bash
git add -A -- lib/engine/calls.ts lib/engine/calls.test.ts docs/ARCHITECTURE.md && git commit -m "feat(engine): calls through declared types, resolved at query time and cached per index version: callers, implementations, what a signature change touches, injection sites (ADR-059)" -- lib/engine/calls.ts lib/engine/calls.test.ts docs/ARCHITECTURE.md && git push origin pivot/v1
```

### Task 4: The `calls` tool, seven tools, a tighter budget (ADR-056 amended)

**Files:**
- Modify: `lib/tools/answers.ts` (+ `answers.test.ts`), `lib/tools/registry.ts` (+ `registry.test.ts`), `mcp/stdio.test.ts`, `mcp/server.test.ts` (test titles), `scripts/mcp-smoke.mjs`, `scripts/bench-mcp.ts`, `scripts/cli.ts` (+ `cli.test.ts`), `app/map/activity.ts` (+ `activity.test.ts`)
- Modify (docs): `docs/API_CONTRACTS.md` §17 (the proposed `calls` text becomes the built one), `docs/ENGINEERING_DECISIONS.md` (ADR-056's proposed amendment, with the measured sizes), `docs/PIVOT_SPEC.md` §6.2, `README.md` (four places, Step 7)

**Interfaces:**
- Consumes: `calls`, `CallsAnswer` (Task 3).
- Produces: `callsAnswer(a: CallsAnswer, page: { limit: number; offset: number }): AnswerParts`; the `calls` registry entry; `TOOLS` with seven entries; `npm run bench-mcp -- ../vscode --fresh-calls`. Tasks 5, 6, 15 and 16 use them.

- [ ] **Step 1: Write the failing tests**

`lib/tools/registry.test.ts`:
- the names test: `["overview", "describe", "search", "imports", "architecture", "calls", "show_on_map"]`; the always-loaded ones: the first six;
- the budget test: `expect(chars + SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(6_650)` (R-Q), with a comment: `// 2.75 characters a token in Eval #2: 6,650 is about 2,420 tokens, under gate condition 6's 2,500 (ADR-056, amended)`;
- a new test on the fixture, calling the tool as the MCP SDK does (the file's `call` helper), with a `diFixture()` helper built like `archFixture()` on `DI_FIXTURE`: `calls { symbol: "IFileService.readFile" }`, `calls { symbol: "IFileService" }` and `calls { symbol: "Logger.log" }` each give the ground truth's exact text (transcribe the three blocks), and their `paths` are, in order: `["src/platform/files/common/files.ts", …the 8 files in the listed order]`, `["src/platform/files/common/files.ts", …the 3 files]`, and `[]`;
- paging, derived by hand from the same answer: with `limit: 3` the files block is the first three files, then `… 5 more (next page: offset 3)`, then the signature block and the implementations; with `offset: 3, limit: 3` it is `Showing 4–6 of 8.`, then `src/workbench/test/fileService.test.ts  14, 14  (on FileService, TestFileService)`, `src/platform/files/common/fileService.ts  10  (on FileService)`, `src/platform/files/node/watchingFileService.ts  6  (on WatchingFileService)`, then `… 2 more (next page: offset 6)`, with neither the signature block nor the implementations (they belong to the first page);
- an error: `calls { symbol: "IFileService.save" }` rejects with `BadInputError` "IFileService has no member save. Its members: readFile, writeFile.".

`lib/tools/answers.test.ts`, Review Focus 3. A hand-built `MemberAnswer` with 2,000 files whose paths are long (`src/${"deep/".repeat(15)}f${i}.ts`, about 90 characters, each one call, lines `[1]`, receivers `[]`), and 500 declaring files:
- `callsAnswer(a, { limit: 500, offset: 0 })` stays under `MAX_ANSWER_CHARS`;
- it lists k < 500 files, since the size cap cuts the page (count the file lines in the text), and its cut line is ``… ${(2000 - k).toLocaleString("en-US")} more (next page: offset ${k})``, unindented as in the paging test above;
- its declaring block lists 30 paths, then `  … 470 more`;
- `callsAnswer(a, { limit: 500, offset: 1500 })` also stays under the cap, and its files block starts `Showing 1,501–`.

The expectations come from these rules, not from a run.

`app/map/activity.test.ts`: `activityLabel(event("calls", ["src/a.ts", "b.ts"]))` is `"Following the calls into src/a.ts +1"`, and with no paths `"Following calls"`.

`scripts/cli.test.ts`: `SNIPPET` contains `mcp__nebulosity__calls`.

`mcp/stdio.test.ts`: the listed names gain `calls` before `show_on_map`; the batch of calls gains `["calls", { symbol: "Logger" }]` (the mini-repo's `src/core/log.ts` declares `Logger`; the answer isn't an error); the events wait for 8 and their sorted tools gain `"calls"`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/tools app/map scripts/cli.test.ts mcp`
Expected: FAIL.

- [ ] **Step 3: `callsAnswer` (`lib/tools/answers.ts`)**

```ts
// ---- calls (ADR-059)

const CALLS_NOTE = "found through declared types: fields, constructor parameters, parameters, locals, X.get(T), useService(T), new C(), base classes and aliases. A call on a value whose type is only inferred isn't seen.";
/** How many implementations and extra declaring files an answer names before "… N more". */
const CALLS_LISTED = 30;

function cappedList(header: string, items: readonly string[]): string[] {
    const shown = items.slice(0, CALLS_LISTED).map((i) => `  ${i}`);
    return [header, ...shown, ...(items.length > CALLS_LISTED ? [`  ${moreLine(items.length - CALLS_LISTED)}`] : [])];
}

function callsAreaLines(a: { groupBy: string | null; areas: readonly { path: string; kind: "folder" | "file"; count: number }[]; elsewhere: number }): string[] {
    const lines = [a.groupBy === null ? "By area:" : a.groupBy === "" ? "By area (the repo's top level):" : `By area (inside ${a.groupBy}/):`];
    for (const area of a.areas.slice(0, LIST_SHOWN)) lines.push(`  ${shownPath(area.path, area.kind)}  ${formatCount(area.count)}`);
    if (a.areas.length > LIST_SHOWN) lines.push(`  ${moreLine(a.areas.length - LIST_SHOWN)} areas`);
    if (a.elsewhere > 0) lines.push(`  elsewhere (outside ${a.groupBy}/)  ${formatCount(a.elsewhere)}`);
    return lines;
}

function implementationLines(impls: readonly ImplementationLine[], type: string, member: string | null): string[] {
    if (impls.length === 0) return [];
    const declaring = impls.filter((i) => i.declares).length;
    const label = (i: ImplementationLine): string => {
        const how = i.via === "implements" ? `implements ${type}` : i.via === "sub-interface" ? `through ${i.through}` : i.via === "base class" ? `through its base class ${i.through}` : "test double";
        return member !== null && i.declares ? `${how}, declares ${member}` : how;
    };
    const header = member === null ? `Implementations of ${type} (${formatCount(impls.length)}):` : `Implementations of ${type} (${formatCount(impls.length)}; ${formatCount(declaring)} declare ${member}):`;
    return cappedList(header, impls.map((i) => `${i.name ?? "(anonymous class)"}  ${i.path}:${i.line}  ${label(i)}`));
}

/** The files block, paged within what the answer's other lines leave of MAX_ANSWER_CHARS. */
function pagedFiles(header: string, rows: readonly string[], page: { limit: number; offset: number }, used: number): string[] {
    if (rows.length === 0) return [];
    if (page.offset >= rows.length) return [header, `Nothing at offset ${page.offset}: the list has ${formatCount(rows.length)}.`];
    const rest = rows.slice(page.offset).map((r) => `  ${r}`);
    const shown = fitting(rest, page.limit, MAX_ANSWER_CHARS - REACH_HEADROOM - used);
    const lines = [header];
    if (page.offset > 0) lines.push(`Showing ${formatCount(page.offset + 1)}–${formatCount(page.offset + shown)} of ${formatCount(rows.length)}.`);
    lines.push(...rest.slice(0, shown));
    const hidden = rows.length - page.offset - shown;
    if (hidden > 0) lines.push(moreLine(hidden, page.offset + shown));
    return lines;
}

const size = (lines: readonly string[]): number => lines.reduce((sum, line) => sum + line.length + 1, 0);
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** calls (ADR-059): a member's callers, or a type's injection sites; on the first page, what a signature change touches and the implementations. */
export function callsAnswer(a: CallsAnswer, page: { limit: number; offset: number }): AnswerParts {
    if (a.kind === "ambiguous"){
        return { body: [
            `${formatCount(a.candidates.length)} types are named ${a.name}; pass path, the file that declares the one you mean:`,
            ...a.candidates.map((c) => `  ${c.kind} ${a.name}  ${c.path}:${c.line}`),
        ] };
    }
    const where = `${a.type.path}:${a.type.line}`;
    const scope = a.within === undefined ? "" : ` Only files inside ${a.within}/ are counted.`;
    const first = page.offset === 0;
    if (a.kind === "type"){
        const tests = a.tests > 0 ? ` Tests among the files: ${formatCount(a.tests)}.` : "";
        const head = a.files.length === 0
            ? [`${a.type.name} (${a.type.kind}, ${where}): injected nowhere the declared types show.${scope}`]
            : [`${a.type.name} (${a.type.kind}, ${where}): injected in ${plural(a.files.length, "file")}, ${plural(a.places, "place")} in all.${tests}${scope}`, ...callsAreaLines(a)];
        const tail = first ? implementationLines(a.implementations, a.type.name, null) : [];
        const rows = a.files.map((f) => `${f.path}  ${f.lines.join(", ")}  (${f.hows.join(", ")})`);
        return { body: [...head, ...pagedFiles("Files, most places first (lines):", rows, page, size(head) + size(tail)), ...tail], notes: [CALLS_NOTE] };
    }
    const { type, member } = a;
    // the first category names its files ("in 4 files"); the others are bare counts ("in 1")
    const byCategory = [
        { what: `on ${type.name} itself`, n: a.categories.type },
        { what: `on a ${a.subtypeWord}`, n: a.categories.subtype },
        { what: "on an implementation", n: a.categories.implementation },
    ].filter((p) => p.n > 0).map((p, i) => `${p.what} in ${i === 0 ? plural(p.n, "file") : formatCount(p.n)}`);
    const tests = a.tests > 0 ? ` Tests among the files: ${formatCount(a.tests)}.` : "";
    const head = a.files.length === 0
        ? [`${type.name}.${member} (${type.kind} ${type.name}, ${where}): no call found through declared types.${scope}`]
        : [
            `${type.name}.${member} (${type.kind} ${type.name}, ${where}): called in ${plural(a.files.length, "file")}, ${plural(a.calls, "call")} in all.${scope}`,
            `${capitalize(byCategory.join(", "))}.${tests}`,
            ...callsAreaLines(a),
        ];
    const total = a.files.length + a.declaring.length;
    const changes = !first || total === 0 ? []
        : a.declaring.length === 0 ? [`If ${member}'s signature changes, these ${plural(a.files.length, "file")} change; no other file declares it.`]
        : a.files.length === 0 ? cappedList(`If ${member}'s signature changes, ${plural(total, "file")} change, each declaring it:`, a.declaring)
        : cappedList(`If ${member}'s signature changes, ${plural(total, "file")} change: these ${formatCount(a.files.length)}, and ${formatCount(a.declaring.length)} that declare it:`, a.declaring);
    const tail = [...changes, ...(first ? implementationLines(a.implementations, type.name, member) : [])];
    const rows = a.files.map((f) => `${f.path}  ${f.lines.join(", ")}${f.receivers.length > 0 ? `  (on ${f.receivers.join(", ")})` : ""}`);
    return { body: [...head, ...pagedFiles("Files, most calls first (lines):", rows, page, size(head) + size(tail)), ...tail], notes: [CALLS_NOTE] };
}
```

Import `CallsAnswer` and `ImplementationLine` from `../engine/calls` at the top of `answers.ts`. (`plural` writes "8 files" and "13 calls"; `formatCount` the bare numbers; `LIST_SHOWN`, `REACH_HEADROOM`, `fitting` and `moreLine` are the file's own.)

- [ ] **Step 4: The registry (`lib/tools/registry.ts`), R-Q's texts pinned**

- `repoPath`'s description becomes `Relative to the repo root ("" is the root), or absolute inside it.`
- `describe`'s description becomes `What a folder or file is: its summary, size, contents or declarations, the areas it imports and is imported by, with exact counts, and the docs about it. Read those docs for its rules.`
- `search`'s description becomes `Find where a feature or concept lives, by keywords or meaning: the best files and folders, with their best-matching code. Use Grep for an exact string.`
- `imports`' `to` becomes `repoPath.optional().describe("Instead: the shortest import chain between path and this place, either way.")`, and its `group_by` `.describe('Count by area instead: a folder ("" the top level) or "auto".')`.
- `architecture`'s `report` and `through` lose their `.describe(...)` (the tool's description says both).
- `SERVER_INSTRUCTIONS` gains, after the `imports` bullet: `"- calls: who calls a method, even through injected services, and what changing it touches;"`.
- The entry, before `showOnMapTool`:

```ts
const callsInput = z.object({
    symbol: z.string().trim().min(1).max(200).describe('"IFooService", or a method: "IFooService.save".'),
    path: z.string().optional().describe("Its file, if two types share the name."),
    group_by: z.string().optional().describe('Count by area: a folder ("" the top level) or "auto".'),
    within: z.string().optional().describe("Only files inside this folder."),
    limit: z.number().int().min(1).max(500).default(50).describe("Files to list, 1 to 500."),
    offset: z.number().int().min(0).default(0).describe("Where the next page starts."),
});
const callsTool: ToolEntry<typeof callsInput> = {
    name: "calls",
    alwaysLoad: true,
    description: "Who calls a method of a class or interface, through declared types: injected services, fields, parameters, locals and base classes. With a method: its callers, its implementations and what changing it touches; with a type: where it is injected. Prefer it to grep.",
    inputSchema: callsInput,
    async handler(input, context){
        const declaredIn = input.path === undefined ? undefined : repoPathOf(input.path, context);
        const within = input.within === undefined ? undefined : repoPathOf(input.within, context);
        const groupBy = input.group_by === undefined || input.group_by === "auto" ? null : repoPathOf(input.group_by, context);
        const answer = calls(context.repoRoot, { symbol: input.symbol, ...(declaredIn !== undefined ? { path: declaredIn } : {}) }, { groupBy, ...(within !== undefined ? { within } : {}) });
        const page = { limit: input.limit, offset: input.offset };
        // the live event: the declaring file, then the files this page lists; the Map's /api/live takes at most 50 paths
        const listed = answer.kind === "ambiguous" ? [] : [answer.type.path, ...answer.files.slice(page.offset, page.offset + page.limit).map((f) => f.path)];
        return { text: finish(callsAnswer(answer, page), context), paths: listed.slice(0, 50) };
    },
};
```
and `TOOLS = [overviewTool, describeTool, searchTool, importsTool, architectureTool, callsTool, showOnMapTool]`. `lib/live/event.ts` refuses more than 50 paths, and `/api/live` then answers 400. So the event carries the declaring file and the page's first 49 files. A page cut by the size cap lists fewer files than `limit`, and its event may pulse a few files the page doesn't show.

- [ ] **Step 5: The wiring**

- `app/map/activity.ts`: `case "calls": return any ? \`Following the calls into ${list(paths)}\` : "Following calls";`.
- `scripts/cli.ts`'s `SNIPPET`: its three entries after `"## Nebulosity"` become
```ts
    "This repo is indexed by Nebulosity. For questions about what imports what, who calls a method (even through injected services),",
    "what a change would affect, how the code is layered, import cycles or files nothing imports, call its tools (mcp__nebulosity__imports,",
    "mcp__nebulosity__calls, mcp__nebulosity__architecture, mcp__nebulosity__describe) before grep: they answer from the whole repo in one call.",
```
- `scripts/mcp-smoke.mjs`: `TOOLS` and `ALWAYS_LOADED` gain `"calls"` after `"architecture"`; the header comment says seven names and six marks.
- The tests in `lib/tools/registry.test.ts` and `mcp/server.test.ts` whose titles say six tools and five always loaded say seven and six.
- `scripts/bench-mcp.ts`: a row `{ label: "calls", tool: "calls", inputs: [...] }` whose inputs cycle through the five planning methods (`IFileService.readFile`, `IStorageService.store`, `IConfigurationService.getValue`, `ICommandService.executeCommand`, `IEditorService.openEditor`) and their five types (R-A allows them here). Each input carries its declaring file as `path`, from Task 5 Step 2's list: in `../vscode`, `IConfigurationService` and `ICommandService` are also declared under `extensions/copilot/`, and without `path` the answer is the short list of candidates. The first input is `IConfigurationService.getValue` (the largest). And a mode `--fresh-calls`: five times, start a fresh server (the same transport set-up), call `calls { symbol: "IConfigurationService.getValue", path: "src/vs/platform/configuration/common/configuration.ts" }` first, check that the answer isn't the list of candidates, and record that call's time; print each and the worst, judged against 1.5 s (S14).

- [ ] **Step 6: Run the tests and see them pass, then measure the budget**

Run: `npx vitest run lib/tools app/map scripts/cli.test.ts mcp`
Expected: PASS (about 6 new). Then print the budget the way the test measures it (a scratch script over `TOOLS` and `SERVER_INSTRUCTIONS`, as in "What the code has today") and record it: about 6,614 characters (≤ 6,650), and each definition's share.

- [ ] **Step 7: The docs**

- `docs/API_CONTRACTS.md` §17: the `calls` row and paragraph written as proposed with this plan lose "proposed"; the "Always loaded" paragraph says six tools and 6,650 characters; "Live events" gains `calls` (the declaring file, then up to 49 of the page's files: the Map takes at most 50 paths).
- `docs/ENGINEERING_DECISIONS.md`: ADR-056's proposed amendment loses "proposed" and gains the measured characters per tool.
- `docs/PIVOT_SPEC.md` §6.2: the `calls` row loses "proposed".
- `README.md`, four places:
  - line 18: `**Seven MCP tools for Claude Code**`, with `` `calls` (who calls a method, even through injected services, and what changing it touches) `` before `` and `show_on_map` ``;
  - line 123: `all seven tools in Claude Code.`;
  - line 137: `### The seven tools Claude Code gets`, with a bullet after `architecture`'s: `` - **`calls`**: who calls a method of a class or interface through declared types (injected services, fields, parameters, base classes): its callers, its implementations, what a change to its signature touches, and where a type is injected. ``;
  - "Good to know": `The six tools that answer questions load at the start of every session, …; their definitions and instructions take about 2,400 tokens.` (R-Q's estimate; MCP Dev Set #2 measures it, and Task 16 corrects the number if it differs).

- [ ] **Step 8: Gate, commit, push**

Run the gate (about 1,378/1,378). Then:
```bash
git add -A -- lib/tools app/map/activity.ts app/map/activity.test.ts mcp/stdio.test.ts mcp/server.test.ts scripts/mcp-smoke.mjs scripts/bench-mcp.ts scripts/cli.ts scripts/cli.test.ts docs/API_CONTRACTS.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md README.md && git commit -m "feat(tools): calls, the seventh tool and the sixth always loaded; the shared texts trimmed to keep what every session loads under 6,650 characters (ADR-056 amended)" -- lib/tools app/map/activity.ts app/map/activity.test.ts mcp/stdio.test.ts mcp/server.test.ts scripts/mcp-smoke.mjs scripts/bench-mcp.ts scripts/cli.ts scripts/cli.test.ts docs/API_CONTRACTS.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md README.md && git push origin pivot/v1
```

### Task 5: Calls Benchmark #1. STOP if the bar isn't met after three rounds

**Files:**
- Create: `scripts/bench-calls.ts`
- Modify: `package.json` (`"bench-calls": "tsx scripts/bench-calls.ts"`), `docs/BENCHMARKS.md`, `docs/ENGINEERING_DECISIONS.md` (ADR-059's measured line), `docs/PIVOT_SPEC.md` (S14's result)
- Modify only if a round needs it: `lib/index/languages/typescript-calls.ts` (+ test), `lib/engine/calls.ts` (+ test), `test/fixtures/di-repo/**` and the ground truth (a new case, derived by hand)

**Interfaces:**
- Consumes: `calls()` and `CallerFile.sites` (Task 3); `evidence/e2/out/checker.json` and `affine-sites.json`.
- Produces: Calls Benchmark #1 (S14's first half). Tasks 6, 10 and 18 rely on the index this task leaves.

- [ ] **Step 1: Announce, then re-index VS Code and AFFiNE in the owner's database (R-AC)**

Check port 3000 (a running Map's worker would re-index on its own; if it is up, say so). Tell the owner: "Task 5 re-indexes VS Code and AFFiNE in your database: adapter version 5 parses every file once (about 70 s for VS Code; your summaries stay, since content hashes don't change); the Map refetches once." Then:
```bash
npm run index -- ../vscode
npm run index -- ../affine --no-activate
```
Record each run's files, edges, the stage times, and the rows of the three new tables (a read-only count). VS Code's files and edges must equal Index Benchmark #6's (14,849 and 140,583) and AFFiNE's Eval #2's (6,987 and 26,261): the call facts change no import.

- [ ] **Step 2: Write `scripts/bench-calls.ts`**

```ts
/**
 * npm run bench-calls -- --repo ../vscode --checker <checker.json>
 * npm run bench-calls -- --repo ../affine --sites <affine-sites.json> [--verdicts <file>]
 *
 * Calls Benchmark (S14, ADR-059): the index's calls against an independent answer, file by file, read-only.
 *   VS Code: TypeScript's checker over src/tsconfig.json (V1.7's design check, evidence/e2/out/checker.json), for the five
 *   planning methods (R-A allows them here). Both sides are kept to the program's own files (the tsconfig's fileNames, read
 *   without building a program). "Interface calls": files whose call the checker resolves to the interface's member; the
 *   index's files with a call on the interface, or on a sub-interface that doesn't declare the member (the checker files
 *   those under the interface, R-AB). "Interface + implementation": those, and the calls on a class that implements it.
 *   A call on a sub-interface that redeclares the member is counted apart.
 *   AFFiNE: the design check's syntactic L3 sets for its three planning methods; each file only one side has is read in
 *   the source and decided in --verdicts ({ method, file, decision: "in" | "out", line, why }[]), and the score is against
 *   the L3 set with those verdicts applied.
 * Prints recall and precision per method and in all, and every file one side lacks; writes .nebulosity/measure/calls-<repo>.json.
 */
```

Its body, in order:
1. `useReadOnlyDatabase()` (with `// eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook` above it, as `scripts/bench-search.ts` has), then for each method `calls(repo, { symbol: "<Type>.<member>", path: "<declaring file>" }, { groupBy: null, ...(vscode ? { within: "src" } : {}) })`.
2. The index's sets from `answer.files[].sites` (R-AB): `iface` = files with a site whose `category` is `"type"`, or `"subtype"` with `receiverDeclares` false; `both` = `iface` plus files with an `"implementation"` site; `redeclared` = files whose only sites are subtypes that declare the member.
3. VS Code's checker sets from `checker.json`'s rows of that method: `iface` = files with an owner `{ kind: "interface", name: <Type>, file: <declaring file> }`; `both` = those plus files with an owner `{ kind: "class", implementsTarget: true }`. The program's files: `ts.getParsedCommandLineOfConfigFile("src/tsconfig.json", …).fileNames` minus `.d.ts`, made repo-relative; both sides are intersected with them.
4. AFFiNE's sets from `affine-sites.json`: the files of the sites whose `m` is the member and whose `owner` is `<declaring file>#<Type>` (the L3 sets: WorkspaceDialogService.open 45 files, GlobalDialogService.open 25, GraphQLService.gql 18), then `--verdicts` applied; compared with the index's `both`.
5. For each: recall = |index ∩ reference| / |reference|, precision = |index ∩ reference| / |index|; and the sums over the methods. A recall or precision of an empty set is reported as "n/a", never as 1.

The five VS Code methods and their declaring files: `IFileService.readFile` (`src/vs/platform/files/common/files.ts`), `IStorageService.store` (`src/vs/platform/storage/common/storage.ts`), `IConfigurationService.getValue` (`src/vs/platform/configuration/common/configuration.ts`), `ICommandService.executeCommand` (`src/vs/platform/commands/common/commands.ts`), `IEditorService.openEditor` (`src/vs/workbench/services/editor/common/editorService.ts`). AFFiNE's: `WorkspaceDialogService.open` (`packages/frontend/core/src/modules/dialogs/services/workspace-dialog.ts`), `GlobalDialogService.open` (`packages/frontend/core/src/modules/dialogs/services/dialog.ts`), `GraphQLService.gql` (`packages/frontend/core/src/modules/cloud/services/graphql.ts`).

- [ ] **Step 3: Run it**

```bash
npm run bench-calls -- --repo ../vscode --checker .superpowers/sdd/2026-10-15-v1-7-calls-and-context/evidence/e2/out/checker.json
npm run bench-calls -- --repo ../affine --sites .superpowers/sdd/2026-10-15-v1-7-calls-and-context/evidence/e2/out/affine-sites.json
```

**The bar (S14, judged on VS Code against the checker, R-AL):** recall ≥ 0.98 and precision ≥ 0.99, file level, for interface calls and for interface + implementation calls, on the five methods pooled. Each method's numbers are reported beside the pooled ones, and a method under the bar has its misses read and classed in Step 4. Read AFFiNE's disagreements in the source, write each verdict with its deciding line into `.superpowers/sdd/2026-10-15-v1-7-calls-and-context/calls-benchmark-affine-verdicts.json` (the ledger), and re-run with `--verdicts`.

- [ ] **Step 4: A round, only if under the bar (at most three)**

For each missed or extra file, open it at the line and name the rule it needs (as the design check did: a base class elsewhere, an alias, a destructuring from a typed object, a getter with no annotation…). Fix the most common miss class in `typescript-calls.ts` or `calls.ts`, with a new fixture case and its ground truth derived by hand (the fixture's other answers must stay as they are: re-derive any count it changes), and re-run. A round that changes the adapter also bumps `ADAPTER_VERSION` (6, then 7; its comment and Task 1's test say so), since the index skips a file whose content and adapter version are unchanged; then it re-indexes both repos, announced again (R-AC). A round that changes only `lib/engine/calls.ts` needs no re-index. Each round's change and its numbers go in the ledger.

After three rounds under the bar: **STOP.** Show the owner the table, the miss classes left with an example of each, and the options: (a) another round on a named class; (b) accept the numbers and record S14 as failed, which the never-cut list doesn't allow without the owner's word.

- [ ] **Step 5: Record Calls Benchmark #1, commit, push**

In `docs/BENCHMARKS.md`, `## ‹today› Calls Benchmark #1 — calls through declared types against TypeScript's checker (S14)`: the method (the checker's evidence run, the program's files, R-AB's sets), the table per method (checker files, index files, recall, precision; both sets), the sums, every miss and extra by class with one example each, AFFiNE's table with its verdicts' count, each round's change, and the rows stored per table. ADR-059 gains its measured line; PIVOT_SPEC §2's S14 gains its result for recall and precision (the speed half comes in Task 6).

Run the gate. Then:
```bash
git add -A -- scripts/bench-calls.ts package.json docs/BENCHMARKS.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md && git commit -m "feat(bench): Calls Benchmark #1, the calls index against TypeScript's checker on VS Code's five planning methods and AFFiNE's three (S14)" -- scripts/bench-calls.ts package.json docs/BENCHMARKS.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md && git push origin pivot/v1
```
(Add the adapter, engine, fixture and test paths to both lists if a round changed them, and the plan's ground truth if a fixture case was added.)

### Task 6: S1 and the first answer (Index Benchmark #7, MCP Benchmark #5)

**Files:** `docs/BENCHMARKS.md`, `docs/PIVOT_SPEC.md` (S14's speed half), `docs/ENGINEERING_DECISIONS.md` (ADR-059's measured line). Only on the fallback: the files of Step 4.

- [ ] **Step 1: A quiet machine**

Check port 3000 (Global Constraints) and that no runaway process holds a core (`tasklist //FI "IMAGENAME eq python.exe"` in Git Bash, and the CPU of `node.exe` processes); if one does and it isn't the owner's, tell the owner before measuring. Note what else is open.

- [ ] **Step 2: S1, Index Benchmark #7**

Three runs back to back, each into a fresh scratch data folder, as Index Benchmark #6 did:
```bash
NEBULOSITY_DATA="$(mktemp -d)" npx tsx scripts/index.ts ../vscode
```
(three times, a new folder each). Record each run's stage times, files, edges and the call facts' rows. **S1 (≤ 60 s): worst of three.** If it is over 60 s, **STOP**: show the stage times against Index Benchmark #6's and the owner picks (a) write the call facts after S1's clock, as code search is (`fillCodeSearch`'s slot), or (b) accept.

- [ ] **Step 3: MCP Benchmark #5**

```bash
npm run bench-mcp -- ../vscode
npm run bench-mcp -- ../vscode --fresh-calls
```
Both give every `calls` input its declaring file as `path` (Task 4 Step 5), so the timed answer is the full one, not the list of candidates; check one answer's first line to be sure. Record the table (every tool's first and warm calls, `calls` among them) and the five fresh first answers. **S5: every warm call ≤ 500 ms. S14's speed half: the worst fresh first `calls` answer ≤ 1.5 s.** Live events are off in the benchmark, as always.

- [ ] **Step 4: Only if the first answer is over 1.5 s: resolve at index time (R-B's fallback)**

- A migration `0010_v1_7_call_targets` adds `typed_calls.target` (text, nullable: the resolved receiver's TypeKey).
- A post-structure step in `indexRepository`, inside the lock and before `bumpIndexVersion`, builds `buildCallIndex` from the just-written facts and writes every call's `target` in batches; `applyFileChanges` does the same for the changed files' calls, and for every call when `resolvedAll` (a new file or a resolution input can change any resolution).
- `calls()` reads `target` instead of calling `receiverType` (the type index is still built for the hierarchy, and is cheaper without the calls).
- Its tests: the pipeline test on di-repo checks the stored targets of `editorPane.ts`'s three calls; an update test checks a renamed base class re-targets `textEditor.ts`'s call.
- Announce, then re-index `../vscode` and `../affine` in the owner's database, two more writes than R-AC's three. The read-only server refuses a database behind the checkout's migrations, and only an index run fills the new `target` column; a repo left out would answer every call empty.
- Then re-measure S1 (Step 2), MCP Benchmark #5 (Step 3), and Update Benchmark #3 in Task 7. ADR-059 records the fallback as taken.

- [ ] **Step 5: Record, commit, push**

`docs/BENCHMARKS.md` gains `## ‹today› Index Benchmark #7 — S1 with the call facts` and `## ‹today› MCP Benchmark #5 — S5 with seven tools, and the first calls answer in a fresh process (S14)`. PIVOT_SPEC S14 gains its speed result; ADR-059 its measured line. On the fallback, Step 4's code, migration and tests join both path lists below.

Run the gate. Then:
```bash
git add -A -- docs/BENCHMARKS.md docs/PIVOT_SPEC.md docs/ENGINEERING_DECISIONS.md && git commit -m "docs: Index Benchmark #7 (S1 with the call facts) and MCP Benchmark #5 (S5, and the first calls answer in a fresh process, S14)" -- docs/BENCHMARKS.md docs/PIVOT_SPEC.md docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

### Task 7: S6: the workspace kept per worker run (ADR-053 amended; the first cut)

**Files:**
- Modify: `lib/index/update.ts` (+ `update.test.ts`), `lib/background/service.ts` (+ `service.test.ts`), `docs/BENCHMARKS.md`, `docs/ENGINEERING_DECISIONS.md` (ADR-053's proposed amendment, measured)

**Interfaces:**
- Produces: `applyFileChanges(root, paths, { …, workspace?: Workspace })` and `FileChangeResult.workspace: Workspace` (the one it resolved with).

- [ ] **Step 1: Write the failing tests**

`lib/index/update.test.ts`, on a temp copy of arch-repo:
- "reuses the workspace it is given when nothing re-resolves": index the copy; `const first = applyFileChanges(root, ["src/platform/node/storageFile.ts"])` after editing that file; then edit it again and call `applyFileChanges(root, ["src/platform/node/storageFile.ts"], { workspace: first.workspace })`: the result's `workspace` is the same object (`toBe(first.workspace)`), and edge #27 (`src/platform/node/storageFile.ts` → `packages/core/src/index.ts`) is still stored;
- "reads the workspace again when a package.json changes": with the same `workspace` passed, a call whose paths include `packages/core/package.json` returns a different object (`not.toBe`);
- "reads it again when the file set changes": a new file `src/base/common/extra.ts` gives a different object.

`lib/background/service.test.ts`: `vi.mock` `../index/workspace` keeping the original module but wrapping `readWorkspace` in `vi.fn(original.readWorkspace)`; start the service on a temp arch-repo copy with a fake watcher; fire two changes of `src/app/legacy.ts` one after the other (`await service.idle()` between); `readWorkspace` was called by the startup full run and then once for the first update, not for the second (count the calls after the startup check).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/index/update.test.ts lib/background/service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `update.ts`: the options gain `workspace?: Workspace`; the read becomes:
```ts
        // ADR-053, amended (V1.7): the worker keeps the workspace it read and passes it back. It is read again only when
        // what it is made of can have changed: a resolution input, or the file set (a folder with a package.json deleted).
        const workspace = options.workspace !== undefined && !resolvedAll ? options.workspace : readWorkspace(root, listManifests(root));
```
  and the result gains `workspace`.
- `service.ts`: `let workspace: Workspace | undefined;` in the closure; `runUpdate` passes `{ workspace }` and keeps `result.workspace`; `workspace = undefined` in `stopWatching()` and after every `indexRepository(...)` the worker runs (the startup check, a big batch, `indexNow`), since a full run may have seen a new manifest.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run lib/index lib/background`
Expected: PASS (about 4 new). Then run the gate and commit the code, so Step 5 benchmarks a commit:
```bash
git add -A -- lib/index/update.ts lib/index/update.test.ts lib/background/service.ts lib/background/service.test.ts && git commit -m "perf(worker): keep the workspace manifests per worker run and read them again only when a resolution input or the file set changes (ADR-053 amended)" -- lib/index/update.ts lib/index/update.test.ts lib/background/service.ts lib/background/service.test.ts && git push origin pivot/v1
```

- [ ] **Step 5: Update Benchmark #3**

Check port 3000 first. Then, as Update Benchmark #2: in `../Nebulosity-build` (checked out at Step 4's commit), `npx next dev -p 3130` with `NEBULOSITY_DATA` a scratch folder holding a fresh index of VS Code and a `config.json` with `port: 3130`, no API key; then `npm run bench-update -- ../vscode src/vs/base/common/strings.ts` as the first batch after the server starts, `src/vs/editor/common/model/textModel.ts` second, `strings.ts` again third (five runs each). Port 3000 untouched; VS Code clean afterwards. **S6 (≤ 2 s): warm, and the first batch after start.** Record `applyFileChanges`' own times from the worker's log against Update Benchmark #2's 0.55–0.72 s.

- [ ] **Step 6: Docs, gate, commit, push**

BENCHMARKS gains `## ‹today› Update Benchmark #3 — S6 with the workspace kept per worker run`; ADR-053's proposed amendment loses "proposed" and gains the numbers.

Run the gate. Then:
```bash
git add -A -- docs/BENCHMARKS.md docs/ENGINEERING_DECISIONS.md && git commit -m "docs: Update Benchmark #3, S6 with the workspace kept per worker run (ADR-053 amended)" -- docs/BENCHMARKS.md docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

---

## Part 2 — Eval #3's harness

Eval #1's and Eval #2's files stay as they are, and so do their numbers: Eval #2 re-scores byte for byte and prints exactly what it printed; Eval #1 re-scores EQUAL on its headline (V1.6's `task-8-compare.mjs` and `task-8-headline.mjs`, in the V1.6 ledger). Every harness task ends with that check.

### Task 8: The definition, the rules sentence, refusals in the index line

**Files:**
- Create: `eval3/eval.json`, `eval3/mcp/empty.json` (`{ "mcpServers": {} }`)
- Modify: `scripts/eval/definition.ts` (+ test), `scripts/eval/run-config.ts` (+ test), `scripts/eval/transcript.ts` (+ test), `scripts/eval/run.ts`, `.gitignore` (`eval3/runs/*.tmp`, `eval3/dev/runs/*.tmp`)

**Interfaces:**
- Produces: `EvalDefinition.sentence?: "scripts" | "rules"`, `EvalDefinition.gate?: "eval3"`, `repos[id].project?: string`; `rulesSentence(repoRoot, scratch): string`; `promptFor(question, formats, scratch?, rules?: { repoRoot: string })`; `refusedCalls(jsonl): number`; index lines with `refusals`. Tasks 12, 14–16 and 19–20 use them.

- [ ] **Step 1: Capture Eval #2's printed output, before anything changes**

`$S` below is the build session's scratchpad folder, written as an absolute path with forward slashes. (In Git Bash, `$TMP` is Windows' temp folder, not the scratchpad.) Run:
```bash
npm run eval:score -- --eval eval2 --out "$S/rescore2.json" > "$S/score2-before.txt"
cmp "$S/rescore2.json" eval2/results.json
mv "$S/rescore2.json" "$S/rescore2-before.json"
```
`cmp` prints nothing: a fresh re-score equals the committed results byte for byte, as V1.6 found (items 3–4's report). Every later harness task re-scores to the same `--out` path, so the printed `Wrote …` line matches too, and compares against these files.

- [ ] **Step 2: Write the failing tests**

`scripts/eval/definition.test.ts`, new tests:
```ts
it("reads Eval #3's sentence, gate and a repo's project, and refuses other values in a sentence", () => {
    const def = loadDefinition(write({ ...good, sentence: "rules", gate: "eval3", repos: { vscode: { ...good.repos.vscode, project: "src/tsconfig.json" } } }));
    expect([def.sentence, def.gate, def.repos.vscode.project]).toEqual(["rules", "eval3", "src/tsconfig.json"]);
    expect(() => loadDefinition(write({ ...good, sentence: "loud" }))).toThrow('eval.json: sentence, when given, is "scripts" or "rules".');
    expect(() => loadDefinition(write({ ...good, gate: "d2" }))).toThrow('eval.json: gate, when given, is "eval3".');
    expect(() => loadDefinition(write({ ...good, repos: { vscode: { ...good.repos.vscode, project: 3 } } }))).toThrow("eval.json: repo vscode's project, when given, is a tsconfig's path inside it.");
});

it("leaves Eval #1's and Eval #2's definitions without a sentence or a gate, and gives Eval #3 both", () => {
    expect([loadDefinition("eval").sentence, loadDefinition("eval2").sentence, loadDefinition("eval2").gate]).toEqual([undefined, undefined, undefined]);
    expect([loadDefinition("eval3").sentence, loadDefinition("eval3").gate]).toEqual(["rules", "eval3"]);
});
```

`scripts/eval/run-config.test.ts`, new tests:
```ts
const RULES = "You're at the repository root, C:/Users/Ann/vscode: run grep, git grep, git ls-files, ls, cat, head and the like from here, without cd. To compute anything, write a Node.js script into C:/Users/Ann/AppData/Local/Temp/eval-scratch/0123456789abcdef with the Write tool (the folder exists) and run it with node, or use node -e. Shell writes (redirects, heredocs, tee, sed -i, mkdir), loops, sed, awk, xargs and paths through .. are refused here. Don't change any file in the repository.";

it("writes Eval #3's rules sentence, D2's, with both paths in drive-letter form", () => {
    expect(rulesSentence("C:/Users/Ann/vscode", "C:/Users/Ann/AppData/Local/Temp/eval-scratch/0123456789abcdef")).toBe(RULES);
});

it("ends a prompt with the rules sentence in place of the scripts sentence, when asked", () => {
    const scratch = "C:/Users/Ann/AppData/Local/Temp/eval-scratch/0123456789abcdef";
    expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." }, scratch, { repoRoot: "C:/Users/Ann/vscode" }))
        .toBe(`Q?\n\nEnd with ANSWER.\n\n${RULES}`);
    expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." }, scratch)).toBe(
        `Q?\n\nEnd with ANSWER.\n\nYou may write Node.js scripts in ${scratch} with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.`);
});
```

`scripts/eval/transcript.test.ts`, Review Focus 5:
```ts
it("counts refused tool calls wherever they fall: a session's two messages, a Bash and a Write", () => {
    const denied = (id: string, tool: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: `Permission to use ${tool} has been denied.` }] } });
    const session = [
        { type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "cd x && ls" } }] } },
        denied("b1", "Bash"),
        { type: "result", subtype: "success", permission_denials: [{ tool_name: "Bash" }] },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: {} }] } },
        denied("w1", "Write"),
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "z", is_error: true, content: "No such file" }] } },
        { type: "result", subtype: "success", permission_denials: [{ tool_name: "Write" }] },
    ].map((e) => JSON.stringify(e)).join("\n");
    expect(refusedCalls(session)).toBe(2);
    expect(refusedCalls(JSONL)).toBe(0);
});
```
(`JSONL` is the file's existing transcript: its one error result says "denied", not "Permission to use … has been denied", so it isn't a refusal.)

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run scripts/eval`
Expected: FAIL.

- [ ] **Step 4: Implement**

- `definition.ts`: the type gains `sentence?: "scripts" | "rules"` (`/** The sentence that ends every prompt with scripts on: Eval #2's ("scripts", the default) or Eval #3's rules sentence (ADR-060). */`), `gate?: "eval3"` (`/** The ship gate this eval is judged by: absent, Eval #2's (the V1.6 plan's D1, gate.ts) for an eval with several repos or kinds; "eval3", ADR-060's. */`) and, on each repo, `project?: string` (`/** The tsconfig the call truth's program is built from (VS Code's src/tsconfig.json); absent, every .ts file with the truth's own resolver. */`). `loadDefinition` refuses other values with the sentences of the test.
- `run-config.ts`: `rulesSentence` (the test's text, built from the two paths) and the fourth parameter of `promptFor`:
```ts
/** Eval #3's rules sentence (D2 of V1.7's plan, R-L), the same in both arms: the repo root and the scratch folder, forward-slashed. */
export function rulesSentence(repoRoot: string, scratch: string): string {
    return `You're at the repository root, ${repoRoot}: run grep, git grep, git ls-files, ls, cat, head and the like from here, without cd. To compute anything, write a Node.js script into ${scratch} with the Write tool (the folder exists) and run it with node, or use node -e. Shell writes (redirects, heredocs, tee, sed -i, mkdir), loops, sed, awk, xargs and paths through .. are refused here. Don't change any file in the repository.`;
}
```
  `promptFor(question, formats, scratch?, rules?)` returns, with a scratch folder, `${base}\n\n${rules === undefined ? <Eval #2's sentence, unchanged> : rulesSentence(rules.repoRoot, scratch)}`.
- `transcript.ts`:
```ts
const DENIED = /Permission to use [\w ]+ has been denied/i;

/** The tool calls Claude Code refused (ADR-060's V): every denied tool result, in the main conversation or a subagent's, in every message of a session. */
export function refusedCalls(jsonl: string): number {
    let refused = 0;
    for (const e of streamEvents(jsonl)){
        if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
        for (const c of e.message.content as Json[]){
            if (c.type !== "tool_result" || c.is_error !== true) continue;
            const text = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x: Json | string) => (typeof x === "string" ? x : x.text ?? "")).join("\n") : "";
            if (DENIED.test(text)) refused++;
        }
    }
    return refused;
}
```
  `RunSummary` doesn't change (R-V).
- `run.ts`: `const rules = DEF.sentence === "rules" ? { repoRoot: repo.root } : undefined;` and `promptFor(q, ctx.questions.formats, scratch, rules)` in `runOneIn`, and the same in the dry run's two prompt lines (with `repoRoot(id)`); the index line gains `refusals: refusedCalls(raw)`; the header comment names `sentence` and `refusals`.
- `eval3/eval.json` (Theia joins it in Task 17; `pilot` and `pilotSessions` are filled in Task 18; `claudeVersion` starts as the installed version, `claude --version` when this task runs, is checked again before the dev set runs, Task 15, and is pinned for good at the pilot, Task 19):
```json
{
  "name": "Eval #3",
  "claudeVersion": "2.1.301",
  "pins": { "model": "claude-sonnet-5-5", "effort": "medium", "maxTurns": 80, "maxBudgetUsd": 4, "sessionMaxBudgetUsd": 10 },
  "repos": {
    "vscode": { "path": "../vscode", "commit": "cc3fec8846d0e678357e476fa611774da26d7e24", "slug": "microsoft/vscode", "project": "src/tsconfig.json" },
    "affine": { "path": "../affine", "commit": "0b69a6da21e8fd35beb85667bb8496d9b3852238", "slug": "toeverything/AFFiNE" }
  },
  "arms": ["baseline", "nebulosity"],
  "repeats": 3,
  "scripts": true,
  "sentence": "rules",
  "gate": "eval3",
  "pilot": [],
  "pilotSessions": []
}
```

- [ ] **Step 5: Run the tests, then check Eval #1 and Eval #2 are unchanged**

Run: `npx vitest run scripts/eval` → PASS (about 5 new). Then:
- **Eval #2, byte for byte:** `npm run eval:score -- --eval eval2 --out "$S/rescore2.json" > "$S/score2.txt"`, then `cmp "$S/score2.txt" "$S/score2-before.txt"` and `cmp "$S/rescore2.json" eval2/results.json`: both print nothing.
- **Eval #1, its headline:** `npm run eval:score -- --out "$S/rescore1.json" > "$S/score1.txt"`, then, with V1.6's scripts in `.superpowers/sdd/2026-10-14-v1-6-works-on-your-repo/`:
  - `node <that folder>/task-8-headline.mjs "$S/score1.txt" docs/EVAL_RESULTS.md` prints `EQUAL`;
  - `node <that folder>/task-8-compare.mjs eval/results.json "$S/rescore1.json" "$S/score1.txt" docs/EVAL_RESULTS.md` prints its known state, `DIFFERENT (101)` with every scored field equal (items 3–4's report explains the 101). Any other count is a change to read.
- **Eval #2's arguments:** `run-config.test.ts` pins them byte for byte, in the suite. (A dry run of Eval #2 prints nothing, since every one of its runs is kept.)
- **The refusal count:** on Eval #2's kept runs, `refusedCalls` totals 131 in 99 runs, the same as the result events' `permission_denials`. Planning measured both, and they were equal in each of the 270 runs. Check it with a scratch script.

- [ ] **Step 6: Gate, commit, push**

Run the gate (about 1,387/1,387). Then:
```bash
git add -A -- scripts/eval eval3/eval.json eval3/mcp/empty.json .gitignore && git commit -m "feat(eval): Eval #3's definition, its rules sentence in place of the scripts sentence, and each run's refused calls in its index line (ADR-060); Eval #1 and Eval #2 unchanged" -- scripts/eval eval3/eval.json eval3/mcp/empty.json .gitignore && git push origin pivot/v1
```

### Task 9: Time to relevant context, its statistics, and the needed files

**Files:**
- Create: `scripts/eval/context.ts` (+ test), `scripts/eval/stats.ts` (+ test), `scripts/eval/needed.ts` (+ test), `scripts/eval/context-report.ts`
- Modify: `scripts/eval/scan.test.ts` (the independence pin gains the three; Task 10 makes it follow their imports), `package.json` (`"eval:needed": "tsx scripts/eval/needed.ts"`, `"eval:context": "tsx scripts/eval/context-report.ts"`)

**Interfaces:**
- Produces: `relevantContext(input: ContextInput): ContextResult`; `pathTokens`, `cdTarget`, `pathReached`; `median`, `ratioOfMedians`, `ratioOfPlainMedians`, `mulberry32`, `quantile`, `bootstrapMedianInterval`; `chainDag`, `cycleDag`, `neededFor`; `<dir>/truth/needed.json`. Tasks 12, 18 and 22 use them.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/stats.test.ts` (hand-derived):
```ts
import { describe, expect, it } from "vitest";
import { bootstrapMedianInterval, median, mulberry32, quantile, ratioOfMedians, ratioOfPlainMedians } from "./stats";

describe("stats", () => {
    it("takes medians, the mean of the middle two for an even count, infinity included", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([1, Infinity])).toBe(Infinity);
        expect(median([5, Infinity, Infinity])).toBe(Infinity);
    });

    it("rates a question N ÷ A, a run that never reached counting as infinitely late (D2)", () => {
        expect(ratioOfMedians([10, 20, 30], [5, 5, 5])).toBe(0.25);
        expect(ratioOfMedians([null, null, 10], [1, 1, 1])).toBe(0);           // A's median never reached
        expect(ratioOfMedians([1, 1, 1], [null, null, 1])).toBe(Infinity);     // N's never reached
        expect(ratioOfMedians([null, null, null], [null, null, 1])).toBe(1);   // neither
        expect(ratioOfPlainMedians([0.10, 0.30, 0.20], [0.05, 0.05, 0.10])).toBe(0.25);
    });

    it("interpolates quantiles between order statistics, and keeps an infinite one", () => {
        expect(quantile([0, 10], 0.25)).toBe(2.5);
        expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
        expect(quantile([1, Infinity], 0.975)).toBe(Infinity);
        expect(quantile([Infinity, Infinity], 0.5)).toBe(Infinity);
    });

    it("draws the same numbers for the same seed, each in [0, 1)", () => {
        const a = mulberry32(1), b = mulberry32(1), c = mulberry32(2);
        const xs = Array.from({ length: 5 }, () => a());
        expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
        expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
        expect(c()).not.toBe(xs[0]);
    });

    it("bootstraps the median's 95% interval over questions", () => {
        expect(bootstrapMedianInterval([0.3, 0.3, 0.3])).toEqual([0.3, 0.3]);
        // two values: a resample's median is 0, 0.5 or 1, each of 0 and 1 about a quarter of 10,000 draws, so the 2.5% and
        // 97.5% points sit inside those quarters
        expect(bootstrapMedianInterval([0, 1])).toEqual([0, 1]);
    });
});
```

`scripts/eval/context.test.ts`, on hand-built transcripts (each event a JSON line; `at(s)` is `2026-10-20T10:00:<s>Z`):
```ts
import { describe, expect, it } from "vitest";
import { cdTarget, pathTokens, relevantContext } from "./context";

const at = (s: number): string => `2026-10-20T10:00:${String(s).padStart(2, "0")}.000Z`;
const call = (id: string, name: string, input: Record<string, unknown>, s: number, msg = `m${id}`) =>
    ({ type: "assistant", timestamp: at(s), message: { id: msg, usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100 }, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, text: string, s: number, isError = false) =>
    ({ type: "user", timestamp: at(s), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] } });
const end = (s: number, durationMs: number) => [{ type: "assistant", timestamp: at(s), message: { id: "last", usage: {}, content: [{ type: "text", text: "ANSWER:" }] } }, { type: "result", duration_ms: durationMs }];
const jsonl = (events: unknown[]): string => events.map((e) => JSON.stringify(e)).join("\n");
const TRACKED = new Set(["src/vs/a.ts", "src/vs/b.ts", "src/vs/c.ts", "src/vs/x/longer/src/vs/a.ts", "readme.md"]);

describe("pathTokens and cdTarget", () => {
    it("reads Windows paths, the scrubbed root, ./ and :line, case folded", () => {
        expect(pathTokens("<vscode>\\src\\VS\\a.ts:12:import x\n./src/vs/b.ts.", "vscode")).toEqual(["src/vs/a.ts", "12", "import", "x", "src/vs/b.ts"]);
    });

    it("follows a cd from the root, a relative cd, and one that leaves the repo", () => {
        expect(cdTarget("cd <vscode>/src && grep -rn x .", "", "vscode")).toBe("src");
        expect(cdTarget("cd vs; ls", "src", "vscode")).toBe("src/vs");
        expect(cdTarget("cd <scratch> && node s.js", "src", "vscode")).toBeNull();
        expect(cdTarget("ls src", "src", "vscode")).toBeUndefined();
    });
});

describe("relevantContext", () => {
    const needed = { kind: "files" as const, files: ["src/vs/a.ts", "src/vs/b.ts"] };

    it("reaches when a Grep result printed from a moved folder names the last file, and counts the tokens before it once per message", () => {
        const events = [
            call("t1", "Bash", { command: "cd <vscode>/src && grep -rln foo vs" }, 2),
            result("t1", "vs\\a.ts", 3),
            call("t2", "Grep", { pattern: "foo", path: "<vscode>\\src" }, 4),
            call("t2b", "Glob", { pattern: "*" }, 4, "mt2"),    // t2's message again (usage repeats on each content block): counted once
            result("t2", "vs\\B.ts:7:foo()", 5),
            ...end(9, 6_000),
        ];
        expect(relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed, tracked: TRACKED })).toEqual({
            reached: true, ttrcMs: 5_000, ttrcQueryMs: 2_000, tokens: 222, coverage: 1,
            mostlyRelevant: { reached: true, ttrcMs: 5_000, ttrcQueryMs: 2_000 },
        });
    });

    it("doesn't take a refused command's paths, nor its cd, and doesn't match a longer path ending in a needed one", () => {
        const events = [
            call("t1", "Bash", { command: "cd <vscode>/src/vs && cat a.ts b.ts" }, 2),
            result("t1", "Permission to use Bash has been denied.", 3, true),
            call("t2", "Read", { file_path: "<vscode>\\src\\vs\\x\\longer\\src\\vs\\a.ts" }, 4),
            result("t2", "export const a = 1;", 5),
            call("t3", "Bash", { command: "ls" }, 6),
            result("t3", "a.ts\nb.ts", 7),    // relative to the working folder: still the root, since the refused cd never ran
            ...end(9, 6_000),
        ];
        const r = relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed, tracked: TRACKED });
        expect([r.reached, r.ttrcMs, r.coverage]).toEqual([false, null, 0]);
    });

    it("the mostly-relevant version needs half of a result's tracked files needed; a Read names its own file", () => {
        const events = [
            call("t1", "Glob", { pattern: "**/*" }, 2),
            result("t1", "src/vs/a.ts\nsrc/vs/b.ts\nsrc/vs/c.ts\nreadme.md\nsrc/vs/x/longer/src/vs/a.ts", 3),   // 2 of 5 needed
            call("t2", "Read", { file_path: "<vscode>/src/vs/a.ts" }, 4),
            result("t2", "import { b } from './b';", 5),
            call("t3", "Read", { file_path: "<vscode>/src/vs/b.ts" }, 6),
            result("t3", "export const b = 2;", 7),
            ...end(9, 6_000),
        ];
        const r = relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed, tracked: TRACKED });
        expect([r.ttrcMs, r.mostlyRelevant.ttrcMs]).toEqual([3_000, 7_000]);
    });

    it("reaches a chain once one shortest path's middle files are all seen", () => {
        const dag = { kind: "paths" as const, nodes: ["s", "m1", "m2", "n1", "t"], edges: [["s", "m1"], ["m1", "m2"], ["m2", "t"], ["s", "n1"], ["n1", "m2"]] as [string, string][], from: ["s"], to: ["t"] };
        // shortest paths s→m1→m2→t and s→n1→m2→t: seeing n1 and m2 completes the second
        const events = [call("t1", "Grep", { pattern: "x" }, 2), result("t1", "m2", 3), call("t2", "Grep", { pattern: "y" }, 4), result("t2", "n1", 5), ...end(9, 6_000)];
        const r = relevantContext({ jsonl: jsonl(events), startedAt: at(0), repoId: "vscode", needed: dag, tracked: new Set(["s", "m1", "m2", "n1", "t"]) });
        expect([r.ttrcMs, r.coverage]).toEqual([5_000, 1]);
    });
});
```
(In the first test two distinct message ids of 111 tokens each come before the reaching event at 5 s, since t2b repeats t2's message; the last message comes after. The query starts at 9 s − 6 s = 3 s, so TTRC from it is 2 s. In the third, the Glob result names five tracked files of which two are needed, under half, so the mostly-relevant version waits for the two Reads.)

`scripts/eval/needed.test.ts`, on hand-built graphs: `chainDag({ files: ["a","b","c","d","e"], edges: [["a","b"],["b","d"],["a","c"],["c","d"],["d","e"]] }, "a", "e")` is `{ kind: "paths", nodes: ["a","b","c","d","e"], edges: [["a","b"],["b","d"],["a","c"],["c","d"],["d","e"]], from: ["a"], to: ["e"] }`; a direct edge `a → e` makes it `null` (nothing between the ends); `cycleDag` of `x` on `x→y, y→z, z→x, y→x` with shortest 2 is `{ kind: "paths", nodes: ["x","y","x#"], edges: [["x","y"],["y","x#"]], from: ["x"], to: ["x#"] }`; `neededFor` gives a list truth's files, `null` for an impact truth and for a chain whose answer is none (Task 10 adds the call kinds and tasks).

`scripts/eval/scan.test.ts`: the independence pin's list becomes `scan.ts`, `truth.ts`, `resolve-truth.ts`, `ts-graph.ts`, `context.ts`, `stats.ts`, `needed.ts` (Tasks 10, 15 and 18 add five more); `stats.ts` imports nothing, so the "seen importing" check skips it as it skips `truth.ts`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval/stats.test.ts scripts/eval/context.test.ts scripts/eval/needed.test.ts`
Expected: FAIL.

- [ ] **Step 3: `scripts/eval/stats.ts`**

```ts
/** The statistics of Eval #3's gate (ADR-060): medians, per-question ratios, a seeded percentile bootstrap. Imports nothing. */

/** The median, the mean of the middle two for an even count; Infinity counts as a value (a run that never reached). */
export function median(xs: readonly number[]): number {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A question's TTRC ratio, N's median ÷ A's, null meaning never reached: A never → 0, N never → ∞, both → 1. */
export function ratioOfMedians(a: readonly (number | null)[], n: readonly (number | null)[]): number {
    const [ma, mn] = [median(a.map((x) => x ?? Infinity)), median(n.map((x) => x ?? Infinity))];
    if (ma === Infinity && mn === Infinity) return 1;
    if (ma === Infinity) return 0;
    if (mn === Infinity) return Infinity;
    return ma === 0 ? (mn === 0 ? 0 : Infinity) : mn / ma;
}

/** A question's ratio of medians for values that are always there (time, cost). */
export function ratioOfPlainMedians(a: readonly number[], n: readonly number[]): number {
    const [ma, mn] = [median(a), median(n)];
    return ma === 0 ? (mn === 0 ? 0 : Infinity) : mn / ma;
}

/** A seeded generator (the TTRC design check's), uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The p-quantile of sorted values, interpolated between order statistics (numpy's default); an infinite neighbour stays infinite. */
export function quantile(sorted: readonly number[], p: number): number {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    if (lo === hi || sorted[lo] === sorted[hi]) return sorted[lo];
    return sorted[hi] === Infinity ? Infinity : sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** The 95% percentile bootstrap interval of the median over questions: resample them with replacement (D1, condition 1). */
export function bootstrapMedianInterval(values: readonly number[], options: { resamples: number; seed: number } = { resamples: 10_000, seed: 1 }): [number, number] {
    const random = mulberry32(options.seed);
    const medians: number[] = [];
    for (let b = 0; b < options.resamples; b++){
        const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]);
        medians.push(median(sample));
    }
    medians.sort((x, y) => x - y);
    return [quantile(medians, 0.025), quantile(medians, 0.975)];
}
```

- [ ] **Step 4: `scripts/eval/context.ts`**

```ts
/**
 * Time to relevant context (ADR-060, D2 of V1.7's plan): when a run had first seen every file its answer needs. Pure:
 * a kept (scrubbed) transcript in, times and token counts out. A needed file is seen at a main-conversation `user` event
 * carrying tool results, when it is named, as a whole path token, by a result's text or by the call it answers (Read's
 * file_path, Grep's and Glob's path, a Bash command that wasn't refused). Relative paths are read from Claude Code's
 * working folder, as the executed cd commands left it. Imports nothing from lib/.
 */
import path from "path";
import { streamEvents, type Json } from "./transcript";

export type Needed =
    | { kind: "files"; files: string[] }
    /** A chain or cycle (needed.ts): the shortest-path DAG; seen once every file strictly between the ends of one path is. */
    | { kind: "paths"; nodes: string[]; edges: [string, string][]; from: string[]; to: string[] };

export type ContextInput = {
    jsonl: string;
    startedAt: string;
    /** How scrubbed transcripts write the repo's root: "vscode" for "<vscode>". */
    repoId: string;
    needed: Needed;
    /** The repo's tracked files, lower-cased: what the mostly-relevant version counts. */
    tracked: ReadonlySet<string>;
};

export type ContextResult = {
    reached: boolean;
    /** From the run's startedAt, the gate's measure (R-F); null when never reached. */
    ttrcMs: number | null;
    /** From the query start: the last event's timestamp minus the result's duration_ms. */
    ttrcQueryMs: number | null;
    /** Input + cache writes + cache reads of the main conversation's calls before the reaching event, once per message id. */
    tokens: number | null;
    /** The share of the needed files seen by the end (for a chain or cycle, the best path's share). */
    coverage: number;
    mostlyRelevant: { reached: boolean; ttrcMs: number | null; ttrcQueryMs: number | null };
};

const DENIED = /Permission to use [\w ]+ has been denied/i;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A text's path tokens: runs of path characters, the scrubbed root taken off, `\` as `/`, case folded, a leading ./ and trailing dots dropped. */
export function pathTokens(text: string, repoId: string): string[] {
    const cleaned = text.replace(new RegExp(`<${escape(repoId)}>[\\\\/]+`, "gi"), "");
    const out: string[] = [];
    for (const raw of cleaned.match(/[A-Za-z0-9_\-@$.+~\\/]+/g) ?? []){
        let t = raw.replace(/\\+/g, "/").replace(/\/{2,}/g, "/");
        while (t.startsWith("./")) t = t.slice(2);
        t = t.replace(/\.+$/, "");
        if (t !== "") out.push(t.toLowerCase());
    }
    return out;
}

/** Where a Bash command leaves Claude Code's working folder: its last top-level cd, from the repo root (""); null outside the repo; undefined without a cd. */
export function cdTarget(command: string, cwd: string | null, repoId: string): string | null | undefined {
    const re = /(?:^|&&|;|\|\||\n)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g;
    let last: string | undefined;
    for (let m = re.exec(command); m !== null; m = re.exec(command)) last = m[1].replace(/^["']|["']$/g, "");
    if (last === undefined) return undefined;
    const t = last.replace(/\\+/g, "/");
    const rooted = new RegExp(`^<${escape(repoId)}>(?:/|$)`, "i").exec(t);
    if (rooted) return path.posix.normalize(t.slice(rooted[0].length) || ".").replace(/^\.$/, "").replace(/\/$/, "").toLowerCase();
    if (/^([A-Za-z]:\/|\/|~|<)/.test(t) || cwd === null) return null;
    const joined = path.posix.normalize(path.posix.join(cwd || ".", t));
    return joined === "." ? "" : joined.startsWith("..") ? null : joined.toLowerCase();
}

/** The best path's seen middle files and its length in middle files (all shortest paths are equally long). */
function bestPath(n: Extract<Needed, { kind: "paths" }>, have: ReadonlySet<string>): { seen: number; length: number } {
    const next = new Map<string, string[]>();
    for (const [a, b] of n.edges) next.set(a, [...(next.get(a) ?? []), b]);
    const targets = new Set(n.to);
    const memo = new Map<string, { seen: number; steps: number } | null>();
    const walk = (node: string): { seen: number; steps: number } | null => {
        if (targets.has(node)) return { seen: 0, steps: 0 };
        if (memo.has(node)) return memo.get(node)!;
        let best: { seen: number; steps: number } | null = null;
        for (const w of next.get(node) ?? []){
            const r = walk(w);
            if (r === null) continue;
            const here = { seen: r.seen + (!targets.has(w) && have.has(w.toLowerCase()) ? 1 : 0), steps: r.steps + 1 };
            if (best === null || here.seen > best.seen) best = here;
        }
        memo.set(node, best);
        return best;
    };
    let seen = 0;
    let steps = 0;
    for (const s of n.from){
        const r = walk(s);
        if (r !== null && (r.seen > seen || steps === 0)){
            seen = r.seen;
            steps = r.steps;
        }
    }
    return { seen, length: Math.max(0, steps - 1) };
}

export function pathReached(n: Extract<Needed, { kind: "paths" }>, have: ReadonlySet<string>): boolean {
    const { seen, length } = bestPath(n, have);
    return length > 0 && seen === length;
}

const resultText = (c: Json): string => (typeof c.content === "string" ? c.content
    : Array.isArray(c.content) ? c.content.map((x: Json | string) => (typeof x === "string" ? x : x.text ?? "")).join("\n") : "");

export function relevantContext(input: ContextInput): ContextResult {
    // a chain's or cycle's ends are given by the question; only the files strictly between them are needed (D2)
    const ends = input.needed.kind === "paths" ? new Set([...input.needed.from, ...input.needed.to]) : new Set<string>();
    const neededSet = new Set((input.needed.kind === "files" ? input.needed.files : input.needed.nodes.filter((n) => !ends.has(n))).map((f) => f.toLowerCase()));
    const reachedWith = (have: ReadonlySet<string>): boolean =>
        input.needed.kind === "files" ? input.needed.files.every((f) => have.has(f.toLowerCase())) : pathReached(input.needed, have);
    const seen = new Set<string>();
    const seenMostly = new Set<string>();
    const uses = new Map<string, Json>();
    const messages = new Set<string>();
    let tokens = 0;
    let cwd: string | null = "";
    let reached: { at: number; tokens: number } | null = null;
    let mostly: number | null = null;
    let lastAt = NaN;
    let durationMs: number | null = null;

    for (const e of streamEvents(input.jsonl)){
        if (typeof e.timestamp === "string") lastAt = Date.parse(e.timestamp);
        if (e.type === "result" && typeof e.duration_ms === "number") durationMs = e.duration_ms;
        if (e.parent_tool_use_id) continue;   // a subagent's own traffic; its final text comes back as the Agent call's result
        if (e.type === "assistant"){
            const id = e.message?.id;
            if (typeof id === "string" && !messages.has(id)){
                messages.add(id);
                const u = e.message.usage ?? {};
                tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
            }
            for (const c of (e.message?.content ?? []) as Json[]) if (c.type === "tool_use") uses.set(c.id, c);
            continue;
        }
        if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
        const results = (e.message.content as Json[]).filter((c) => c.type === "tool_result");
        if (results.length === 0) continue;
        for (const r of results){
            const use = uses.get(r.tool_use_id);
            const text = resultText(r);
            const refused = r.is_error === true && DENIED.test(text);
            const inputs: string[] = [];
            const before = cwd;
            if (use?.name === "Read" && typeof use.input?.file_path === "string") inputs.push(use.input.file_path);
            if ((use?.name === "Grep" || use?.name === "Glob") && typeof use.input?.path === "string") inputs.push(use.input.path);
            if (use?.name === "Bash" && !refused && typeof use.input?.command === "string"){
                inputs.push(use.input.command);
                const moved = cdTarget(use.input.command, cwd, input.repoId);
                if (moved !== undefined) cwd = moved;
            }
            const folders = [...new Set([before, cwd].filter((f): f is string => f !== null && f !== ""))];
            const names = (texts: string[]): Set<string> => {
                const found = new Set<string>();
                for (const t of pathTokens(texts.join("\n"), input.repoId)){
                    for (const candidate of [t, ...folders.map((f) => path.posix.normalize(`${f}/${t}`))]){
                        if (neededSet.has(candidate) || input.tracked.has(candidate)) found.add(candidate);
                    }
                }
                return found;
            };
            const named = names([...inputs, text]);
            for (const f of named) if (neededSet.has(f)) seen.add(f);
            // the mostly-relevant version: a Read names its own file; any other result counts when half its tracked files are needed
            const counted = use?.name === "Read" ? names(inputs) : named;
            const tracked = [...counted].filter((f) => input.tracked.has(f));
            const useful = tracked.filter((f) => neededSet.has(f));
            if (tracked.length > 0 && useful.length * 2 >= tracked.length) for (const f of useful) seenMostly.add(f);
        }
        const now = Date.parse(e.timestamp);
        if (reached === null && reachedWith(seen)) reached = { at: now, tokens };
        if (mostly === null && reachedWith(seenMostly)) mostly = now;
    }

    const start = Date.parse(input.startedAt);
    const queryStart = durationMs === null || Number.isNaN(lastAt) ? null : lastAt - durationMs;
    const coverage = input.needed.kind === "files"
        ? input.needed.files.filter((f) => seen.has(f.toLowerCase())).length / input.needed.files.length
        : (({ seen: s, length }) => (length === 0 ? 0 : s / length))(bestPath(input.needed, seen));
    return {
        reached: reached !== null,
        ttrcMs: reached === null ? null : reached.at - start,
        ttrcQueryMs: reached === null || queryStart === null ? null : reached.at - queryStart,
        tokens: reached === null ? null : reached.tokens,
        coverage,
        mostlyRelevant: {
            reached: mostly !== null,
            ttrcMs: mostly === null ? null : mostly - start,
            ttrcQueryMs: mostly === null || queryStart === null ? null : mostly - queryStart,
        },
    };
}
```

- [ ] **Step 5: `scripts/eval/needed.ts`**

`chainDag(g, from, to)`, `cycleDag(g, file, shortest)` and `neededFor(truth, g)` as the tests pin them, over `truth.ts`'s `Graph` and `adjacency`:
- `chainDag`: the sources are the files of `from` (a file, or every file under a folder), the targets those of `to`; breadth-first distances forward from all sources and backward from all targets; `length` the shortest source-to-target distance; `null` when there is none or it is under 2 (nothing between the ends). A node is on a shortest path when its two distances add up to `length`; an edge `a → b` is on one when `dist_from(a) + 1 + dist_to(b) = length`. `from` and `to` are the on-path nodes at distance 0 from the sources and from the targets. Nodes and edges keep the graph's order.
- `cycleDag`: the same from `file` back to it, with the cycle's end written `<file>#`, so the DAG has a distinct end: edges `file → b` with `1 + dist_to(b) = shortest`, `a → file#` with `dist_from(a) + 1 = shortest`, and the middle edges as above; `null` when `shortest` is under 2.
- `neededFor(truth, g)`: `files` for list, unused, violations and entries truths, their files; `chainDag` for a connected chain (checked: its `length` equals the truth's `shortest`, else it throws, naming the question); `cycleDag` for a cycle with a shortest length; `null` for big-picture, impact, pairs, a chain with no chain, a cycle with none, and any empty set. Task 10 adds the call kinds (their `files`) and tasks (CHANGE and TESTS together), once their truth types exist.
- The CLI (`npm run eval:needed -- --eval <dir> [--out <file>]`): reads the definition and `<dir>/questions.json` (single questions only), builds each repo's truth graph once (`buildRepoGraphs(root, repoId, verdicts, { resolveBare: true }).graph`, Eval #1 with `scanRepo` as the scorer does), and writes `{ [question id]: Needed }` for the questions with a needed set to `<dir>/truth/needed.json` (or `--out`), printing how many per kind and which were left out and why.

- [ ] **Step 6: `scripts/eval/context-report.ts` (`npm run eval:context -- --eval <dir> [--needed <file>] [--runs <dir>]`)**

Read-only. For every kept single run with a needed set: `relevantContext` with the run's `startedAt` (its index line), its repo's id, and its repo's tracked files (`git -C <repo> ls-files`, lower-cased, once per repo). Print, per kind and per repo and pooled: each arm's reached share and median TTRC from `startedAt` and from the query start, N ÷ A; the matched per-question ratios' median and bootstrap interval (`ratioOfMedians`, `bootstrapMedianInterval`, questions in order of their ids) per repo and pooled; the same for the mostly-relevant version; and the median tokens to context per arm. With `--refusal-free`, A's runs with a refused call are left out (the design check's Follow-up 1).

- [ ] **Step 7: Run the tests, then check against Eval #2's references**

Run: `npx vitest run scripts/eval` → PASS (about 15 new), then Task 8 Step 5's re-score checks. Then:
```bash
npm run eval:needed -- --eval eval2 --out .nebulosity/eval2/needed.json
npm run eval:context -- --eval eval2 --needed .nebulosity/eval2/needed.json
npm run eval:context -- --eval eval2 --needed .nebulosity/eval2/needed.json --refusal-free
```
Compare with D2's references (from process start, matched per question: VS Code 0.33, AFFiNE 0.29 with all runs; pooled 0.31 [0.23–0.58] refusal-free; pooled per run 0.27; the floor version 0.17). The rules differ in one place: chains and cycles here use the truth graph's every shortest path, where the design check used the known valid answers. Record both sets of numbers and each difference's cause in the ledger. A pooled matched ratio more than 0.05 away from 0.29 is a bug until shown otherwise: read the runs that moved.

- [ ] **Step 8: Gate, commit, push**

Run the gate (about 1,402/1,402). Then:
```bash
git add -A -- scripts/eval package.json && git commit -m "feat(eval): time to relevant context, its medians, per-question ratios and seeded bootstrap, and the needed files fixed from the truths (ADR-060); checked against Eval #2's references" -- scripts/eval package.json && git push origin pivot/v1
```

### Task 10: The call truth, independent of the index (R2)

**Files:**
- Create: `scripts/eval/ts-calls.ts` (+ `ts-calls.test.ts`), `scripts/eval/calls-candidates.ts`
- Modify:
  - `scripts/eval/build-truth.ts` (+ test);
  - `scripts/eval/needed.ts` (+ test), for the call kinds and tasks;
  - `scripts/eval/definition.ts` and `scripts/eval/run-config.ts`: `SHELL_PRESETS` and `ShellPreset` move into `definition.ts`, so it no longer imports `run-config.ts`, which imports `lib/demo/privacy`;
  - `scripts/eval/scan.test.ts`: the pin gains `ts-calls.ts`, `build-truth.ts` and `definition.ts` (B-8), and follows each pinned file's relative imports.

**Interfaces:**
- Produces: `programFor(root, { project? }): { program, files, ms, peakMb }`; `callTruth(program, root, kind, target): CallTruth`; the truth kinds `callers`, `breaks`, `adopt`, `injects`, `task` (`CallTruthFile`, `TaskTruthFile`); `buildTruth(g, spec, calls?: { program: ts.Program; root: string })` and `taskTests(change, g, within?)`; `<dir>/truth/calls-adjudicated.json`; `.nebulosity/<dir>/calls-evidence.md` and `calls-disagreements.md`. Tasks 11, 18 use them.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/ts-calls.test.ts` (one program over the fixture, default lib; a 60-second timeout):
```ts
import path from "path";
import { describe, expect, it } from "vitest";
import { buildRepoGraphs, taskTests } from "./build-truth";
import { callTruth, programFor } from "./ts-calls";

const root = path.resolve("test/fixtures/di-repo");
const { program } = programFor(root);
const files = (kind: "callers" | "breaks" | "injects", type: string, file: string, member?: string) =>
    callTruth(program, root, kind, { type, file, ...(member ? { member } : {}) }).files;
const F = "src/platform/files";

describe("callTruth on the calls fixture (the ground truth's checker side)", () => {
    it("callers of IFileService.readFile: the index's eight and the inferred call", () => {
        expect(files("callers", "IFileService", `${F}/common/files.ts`, "readFile")).toEqual([
            `${F}/common/fileService.ts`, `${F}/node/watchingFileService.ts`, "src/workbench/commands/openCommand.ts", "src/workbench/editor/editorPane.ts",
            "src/workbench/editor/textEditor.ts", "src/workbench/history/history.ts", "src/workbench/history/inferred.ts",
            "src/workbench/search/searchModel.ts", "src/workbench/test/fileService.test.ts",
        ]);
    });

    it("breaks of IFileService.readFile adds the files that declare it: 11", () => {
        const breaks = files("breaks", "IFileService", `${F}/common/files.ts`, "readFile");
        expect(breaks).toHaveLength(11);
        expect(breaks).toEqual(expect.arrayContaining([`${F}/browser/memoryFileService.ts`, `${F}/common/files.ts`]));
    });

    it("injects of IFileService, DialogService and CommandRegistry", () => {
        expect(files("injects", "IFileService", `${F}/common/files.ts`)).toEqual([
            "src/workbench/commands/openCommand.ts", "src/workbench/editor/baseEditor.ts", "src/workbench/editor/editorPane.ts",
        ]);
        expect(files("injects", "DialogService", "src/app/dialogs/dialogService.ts")).toEqual(["src/app/components/settingsButton.tsx"]);
        expect(files("injects", "CommandRegistry", "src/app/commands/commandRegistry.ts")).toEqual(["src/app/commands/commandContribution.ts"]);
    });

    it("callers through a namespace re-export, hooks, @inject and a workspace package", () => {
        expect(files("callers", "IWatchingFileService", `${F}/common/files.ts`, "watch")).toEqual(["src/workbench/editor/editorPane.ts", "src/workbench/files/watchView.ts"]);
        expect(files("callers", "DialogService", "src/app/dialogs/dialogService.ts", "open")).toEqual(["src/app/components/settingsButton.tsx"]);
        expect(files("callers", "CommandRegistry", "src/app/commands/commandRegistry.ts", "register")).toEqual(["src/app/commands/commandContribution.ts"]);
        expect(files("callers", "Framework", "packages/infra/src/framework.ts", "service")).toEqual(["src/app/dialogs/index.ts"]);
    });

    it("plans the task on IFileService.readFile: the 11 files to change, and the one test to run", () => {
        const change = callTruth(program, root, "breaks", { type: "IFileService", file: `${F}/common/files.ts`, member: "readFile" }).files;
        const { graph } = buildRepoGraphs(root, "di", [], { resolveBare: true });
        expect([change.length, taskTests(change, graph)]).toEqual([11, ["src/workbench/test/fileService.test.ts"]]);
    });
}, 60_000);
```

`scripts/eval/build-truth.test.ts`: `parseTruthSpecs` takes `{ id, repo, kind: "breaks", type, file, member, within? }`, `{ kind: "injects", type, file }` and `{ kind: "task", type, file, member }`, and refuses a call kind without `type` or `file`, or a member kind without `member`, each in a sentence. No test in this file runs the checker: it runs in `ts-calls.test.ts` only. A task's TESTS come from a pure function, tested on a hand-built graph:
```ts
it("takes a task's tests: the test files among the files to change, and those that directly import one of them", () => {
    const g = {
        files: ["lib/x.spec.ts", "src/a.ts", "src/b.ts", "src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"],
        edges: [["src/test/a.test.ts", "src/a.ts"], ["src/test/c.test.ts", "src/test/b.test.ts"], ["lib/x.spec.ts", "src/b.ts"]] as [string, string][],
    };
    const change = ["src/a.ts", "src/b.ts", "src/test/b.test.ts"];
    // b.test is among the files to change (a test double's file); a.test imports a; c.test imports b.test; x.spec imports b
    expect(taskTests(change, g)).toEqual(["lib/x.spec.ts", "src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"]);
    expect(taskTests(change, g, "src")).toEqual(["src/test/a.test.ts", "src/test/b.test.ts", "src/test/c.test.ts"]);
});

it("refuses a call truth without the checker's program", () => {
    expect(() => buildTruth({ files: [], edges: [] }, { id: "q", repo: "vscode", kind: "callers", type: "IFoo", file: "src/foo.ts", member: "save" }))
        .toThrow("q: a callers truth needs the repo's checker program");
});
```
`ts-calls.test.ts` checks the fixture's task (below).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval/ts-calls.test.ts scripts/eval/build-truth.test.ts`
Expected: FAIL.

- [ ] **Step 3: `scripts/eval/ts-calls.ts`**

```ts
/**
 * The call truth (ADR-060, R2): TypeScript's own type checker over a repo's program, never Nebulosity's index. VS Code's
 * program is src/tsconfig.json's (R-R); a repo without node_modules (AFFiNE, Theia, the fixture) gets every .ts and .tsx
 * file it tracks, with module resolution by resolve-truth.ts (workspace packages, exports, compiled → source) and npm
 * packages left unresolved. The rules are D2's sentences; a type is the same type when its exported symbol is. Imports
 * nothing from lib/.
 */
import path from "path";
import ts from "typescript";
import { createTruthResolver } from "./resolve-truth";
import { listFiles, resolveSpecifier } from "./scan";

export type CallTruthKind = "callers" | "breaks" | "injects";
export type CallTarget = { type: string; file: string; member?: string; within?: string };
export type CallTruth = { files: string[]; sites: { file: string; line: number; why: string }[] };

const TS_FILE = /\.(ts|tsx|mts|cts)$/;
const forward = (p: string): string => p.replace(/\\/g, "/");
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function programFor(root: string, options: { project?: string } = {}): { program: ts.Program; files: string[]; ms: number; peakMb: number } {
    const started = performance.now();
    let program: ts.Program;
    if (options.project !== undefined){
        const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, options.project), {}, {
            ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
        });
        if (!parsed) throw new Error(`couldn't read ${options.project}`);
        program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
    } else {
        const files = listFiles(root).filter((f) => TS_FILE.test(f));
        const known = new Set(files);
        const resolveBare = createTruthResolver(root, files);
        const compilerOptions: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit.Preserve, experimentalDecorators: true, strict: true, noEmit: true, skipLibCheck: true, types: [],
        };
        const host = ts.createCompilerHost(compilerOptions);
        host.resolveModuleNameLiterals = (literals, containingFile) => literals.map((literal) => {
            const from = forward(path.relative(root, containingFile));
            const found = resolveSpecifier(from, literal.text, known, resolveBare);
            if (found === null || !TS_FILE.test(found)) return { resolvedModule: undefined };
            const extension = found.endsWith(".d.ts") ? ts.Extension.Dts : found.endsWith(".tsx") ? ts.Extension.Tsx : found.endsWith(".mts") ? ts.Extension.Mts : found.endsWith(".cts") ? ts.Extension.Cts : ts.Extension.Ts;
            return { resolvedModule: { resolvedFileName: path.join(root, found), extension, isExternalLibraryImport: false } };
        });
        program = ts.createProgram({ rootNames: files.map((f) => path.join(root, f)), options: compilerOptions, host });
    }
    const ours = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && !path.relative(root, sf.fileName).startsWith(".."));
    return { program, files: ours.map((sf) => forward(path.relative(root, sf.fileName))).sort(compare), ms: performance.now() - started, peakMb: Math.round(process.resourceUsage().maxRSS / 1024) };
}

export function callTruth(program: ts.Program, root: string, kind: CallTruthKind, target: CallTarget): CallTruth {
    const checker = program.getTypeChecker();
    const rel = (f: string): string => forward(path.relative(root, f));
    const ours = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && !rel(sf.fileName).startsWith(".."));
    const canonical = (s: ts.Symbol | undefined): ts.Symbol | undefined => {
        if (!s) return undefined;
        const unaliased = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
        return checker.getExportSymbolOfSymbol(unaliased);
    };
    const home = ours.find((sf) => rel(sf.fileName) === target.file);
    const declaration = home?.statements.find((s): s is ts.ClassDeclaration | ts.InterfaceDeclaration =>
        (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name?.text === target.type);
    if (!declaration?.name) throw new Error(`${target.file} declares no class or interface named ${target.type}`);
    const T = canonical(checker.getSymbolAtLocation(declaration.name))!;

    // T itself, or a class or interface whose heritage reaches it: extends, implements, or a base whose instance type is T (a test double)
    const memo = new Map<ts.Symbol, boolean>();
    const related = (s: ts.Symbol | undefined, depth = 0): boolean => {
        const c = canonical(s);
        if (!c || depth > 16) return false;
        if (c === T) return true;
        if (memo.has(c)) return memo.get(c)!;
        memo.set(c, false);
        let found = false;
        for (const d of c.declarations ?? []){
            if (!ts.isClassLike(d) && !ts.isInterfaceDeclaration(d)) continue;
            for (const clause of d.heritageClauses ?? []) for (const t of clause.types){
                const base = ts.isCallExpression(t.expression)
                    ? checker.getTypeAtLocation(t.expression).getConstructSignatures()[0]?.getReturnType().getSymbol()
                    : checker.getSymbolAtLocation(t.expression);
                if (related(base, depth + 1)) found = true;
            }
        }
        memo.set(c, found);
        return found;
    };
    const ownerOf = (d: ts.Declaration): ts.Symbol | undefined => {
        const p = d.parent;
        if (ts.isClassLike(p)) return p.name ? checker.getSymbolAtLocation(p.name) : checker.getSymbolAtLocation(p) ?? (p as unknown as { symbol?: ts.Symbol }).symbol;
        if (ts.isInterfaceDeclaration(p)) return checker.getSymbolAtLocation(p.name);
        return undefined;
    };
    const inside = (file: string): boolean => target.within === undefined || file.startsWith(`${target.within}/`);
    const sites: CallTruth["sites"] = [];
    const add = (sf: ts.SourceFile, node: ts.Node, why: string): void => {
        const file = rel(sf.fileName);
        if (inside(file)) sites.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, why });
    };
    const typeIsT = (node: ts.TypeNode): boolean => {
        const t = checker.getTypeFromTypeNode(node);
        return (t.isUnion() ? t.types : [t]).some((p) => canonical(p.getSymbol() ?? p.aliasSymbol) === T);
    };

    for (const sf of ours){
        const visit = (n: ts.Node): void => {
            if ((kind === "callers" || kind === "breaks") && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === target.member){
                const symbol = checker.getSymbolAtLocation(n.expression.name);
                if ((symbol?.declarations ?? []).some((d) => related(ownerOf(d)))) add(sf, n.expression.name, "call");
            }
            if (kind === "breaks" && (ts.isClassLike(n) || ts.isInterfaceDeclaration(n))){
                const own = n.name ? checker.getSymbolAtLocation(n.name) : (n as unknown as { symbol?: ts.Symbol }).symbol;
                const declares = (n.members as ts.NodeArray<ts.ClassElement | ts.TypeElement>).some((m) => m.name !== undefined && ts.isIdentifier(m.name) && m.name.text === target.member);
                if (declares && related(own)) add(sf, n.name ?? n, "declares");
            }
            if (kind === "injects"){
                if (ts.isParameter(n) && ts.isConstructorDeclaration(n.parent) && n.type && typeIsT(n.type)) add(sf, n.type, "constructor");
                if (ts.isPropertyDeclaration(n) && (ts.getDecorators(n) ?? []).some((d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)
                    && d.expression.expression.text === "inject" && d.expression.arguments[0] !== undefined && canonical(checker.getSymbolAtLocation(d.expression.arguments[0])) === T)) add(sf, n.type ?? n, "@inject field");
                if (ts.isCallExpression(n)){
                    const callee = n.expression;
                    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
                    const provider = (ts.isPropertyAccessExpression(callee) && (name === "get" || name === "getOptional")) || (ts.isIdentifier(callee) && (name === "useService" || name === "useServiceOptional"));
                    if (provider && n.arguments[0] !== undefined && canonical(checker.getSymbolAtLocation(n.arguments[0])) === T) add(sf, n.arguments[0], "provider");
                    if (name === "useServices" && n.arguments[0] !== undefined && ts.isObjectLiteralExpression(n.arguments[0])){
                        for (const p of n.arguments[0].properties){
                            const value = ts.isShorthandPropertyAssignment(p) ? checker.getShorthandAssignmentValueSymbol(p) : ts.isPropertyAssignment(p) ? checker.getSymbolAtLocation(p.initializer) : undefined;
                            if (canonical(value) === T) add(sf, p, "provider");
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }
    return { files: [...new Set(sites.map((s) => s.file))].sort(compare), sites: sites.sort((a, b) => compare(a.file, b.file) || a.line - b.line) };
}
```

(In the fixture `IFileService` is both a const and an interface: one merged symbol, so `accessor.get(files.IFileService)` is a provider asked for T. A class expression has no name; its symbol is the node's own, reached through `checker.getSymbolAtLocation(p)` or the node's `symbol`.)

- [ ] **Step 4: The truth builder's new kinds (`build-truth.ts`)**

- Specs: `CallSpec = SpecBase & { kind: "callers" | "breaks" | "adopt" | "injects"; type: string; file: string; member?: string; within?: string }` and `TaskSpec = SpecBase & { kind: "task"; type: string; file: string; member: string; within?: string }`; `KIND_FIELDS` gains `callers`, `breaks`, `adopt`: `["type", "file", "member"]`, `injects`: `["type", "file"]`, `task`: `["type", "file", "member"]`; `within`, when given, is a string.
- Truth files: `CallTruthFile = { id, kind: "callers" | "breaks" | "adopt" | "injects", type, file, member: string | null, within: string | null, files: string[] } & Checked` and `TaskTruthFile = { id, kind: "task", type, file, member, within: string | null, change: string[]; tests: string[] } & Checked`, both in `TruthFile`.
- `buildTruth(g, spec, calls?: { program: ts.Program; root: string })`: a call or task spec without `calls` throws `<id>: a <kind> truth needs the repo's checker program`; the eight import kinds ignore it.
- Per repo, the program is built once, and only when the repo has a call or task spec: `programFor(root, { project: definition.repos[id].project })`; its time and peak memory are printed (design §5.3 asks to measure them). VS Code needs a big heap: run the builder with `NODE_OPTIONS=--max-old-space-size=12288`.
- `callers` and `adopt` take `callTruth(…, "callers", …)`; `breaks` takes `"breaks"`; `injects` takes `"injects"`; a task's CHANGE is its breaks truth, and its TESTS are `taskTests(change, g, spec.within)`: the test files (`isTestFile`) in CHANGE, or with an edge of the truth's import graph into a CHANGE file, inside `within` when given, sorted.
- `needed.ts`'s `neededFor` gains the call kinds (their `files`) and tasks (CHANGE and TESTS together), with `needed.test.ts` cases for a callers truth and a task.
- `SHELL_PRESETS` and `ShellPreset` move from `run-config.ts` into `definition.ts`, and `run-config.ts` imports them from there. Nothing else changes: `definition.test.ts`'s and `run-config.test.ts`'s tests pass as they are.
- `scan.test.ts`'s pin then follows each pinned file's relative imports inside `scripts/eval` (a walk over `moduleSpecifiers`, `./x` read as `x.ts` beside the file), and checks every file it reaches, so a pinned file can't reach `lib/` through another one.
- `<dir>/truth/calls-adjudicated.json` (`[{ id, file, decision: "in" | "out", line, why }]`, `[]` when missing) is applied after the checker: "in" adds a file, "out" removes one (a task's CHANGE, then its TESTS recomputed). A verdict for a file the checker already agrees with stops the build, naming it, as `checkVerdicts` does for edges.
- `.nebulosity/<dir>/calls-evidence.md`: each truth's files with the deciding line(s) and why (`call`, `declares`, `constructor`, `@inject field`, `provider`), for the hand check.
- The switches over `TruthFile["kind"]` (`restingEdges`, `evidenceFor`, `compareTruths`, `sizeOf`, `truthFor`) take the new kinds: they rest on no import edge except a task's TESTS (its edges into CHANGE); sizes read `N files` (a task: `N files to change, M tests`).

- [ ] **Step 5: `scripts/eval/calls-candidates.ts` (the index's side; imports `lib/`, read-only)**

`npx tsx scripts/eval/calls-candidates.ts --eval <dir>`: opens the database read-only (`useReadOnlyDatabase()`, with the `react-hooks/rules-of-hooks` disable line above it, as Task 5's script has), and for each call or task spec asks `calls(root, { symbol: <T.m, or T for injects>, path: <the spec's file> }, { groupBy: null, within: <the spec's within> })`. With `path`, a name two types share can't come back as the list of candidates; an ambiguous or error answer stops the script, naming the spec. It compares the index's set for the kind (callers and adopt: every category's files; breaks: those and `declaring`; injects: the type answer's files; a task: breaks) with the truth's set from `<dir>/truth/<id>.json`, and writes `.nebulosity/<dir>/calls-disagreements.md`: per question, every file only one side has, with the index's lines and the checker's. The index is consulted only here, for candidates; every line of the sheet is read in the source and decided in `calls-adjudicated.json`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run scripts/eval` → PASS (about 10 new), then Task 8 Step 5's re-score checks. Check: `npm run eval:truth` (Eval #1) prints its truths as kept, unchanged; `npm run eval:truth -- --eval eval2 --out .nebulosity/eval2/rebuild` reports no difference against `eval2/truth`.

- [ ] **Step 7: Gate, commit, push**

Run the gate (about 1,412/1,412). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): the call truth from TypeScript's own checker (callers, breaks, adopt, injects, tasks), adjudicated by reading, independent of the index; the independence pin covers the truth builder and the definition (B-8)" -- scripts/eval && git push origin pivot/v1
```

### Task 11: Scoring the new kinds, and the overlap check's calls targets

**Files:**
- Modify: `scripts/eval/gate.ts` (the `QuestionKind` type only; Eval #2's gate stays), `scripts/eval/answer.ts` (+ test), `scripts/eval/score.ts` (+ test), `scripts/eval/overlap.ts` (+ test)

**Interfaces:**
- Consumes: `CallTruthFile`, `TaskTruthFile` (Task 10).
- Produces: `QuestionKind` gains `callers`, `breaks`, `adopt`, `injects`, `task`; `CALL_KINDS`; `taskSections(text): { change: string | null; tests: string | null }`; `PartScore` and `AnswerScore.parts?: { change: PartScore; tests: PartScore }`; the new kinds' rows and labels in the tables. Tasks 12 and 18 use them.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/answer.test.ts`:
```ts
describe("taskSections", () => {
    it("splits a task answer at its last ANSWER CHANGE: and ANSWER TESTS: lines, in either order, markdown around the labels ignored", () => {
        expect(taskSections("The plan.\n**ANSWER CHANGE:**\nsrc/a.ts\nsrc/b.ts\nANSWER TESTS:\nsrc/a.test.ts")).toEqual({ change: "src/a.ts\nsrc/b.ts", tests: "src/a.test.ts" });
        expect(taskSections("ANSWER TESTS: src/x.test.ts\n## Answer change:\nsrc/c.ts")).toEqual({ change: "src/c.ts", tests: "src/x.test.ts" });
    });

    it("gives null for a missing block, and an ANSWER: line alone is neither", () => {
        expect(taskSections("ANSWER CHANGE:\nsrc/a.ts")).toEqual({ change: "src/a.ts", tests: null });
        expect(taskSections("ANSWER:\nsrc/a.ts")).toEqual({ change: null, tests: null });
    });
});
```

`scripts/eval/score.test.ts` (its own `A`…`X`, `ctx` and `answer()`):
```ts
describe("scoreAnswer: Eval #3's call kinds and tasks", () => {
    const callersQ: QuestionData = {
        id: "vc1", family: "grepHard", kind: "callers",
        truth: { id: "vc1", kind: "callers", type: "IFoo", file: X, member: "save", within: null, files: [A, B], verified: true, notes: [] },
    };
    const taskQ: QuestionData = {
        id: "vt1", family: "grepHard", kind: "task",
        truth: { id: "vt1", kind: "task", type: "IFoo", file: X, member: "save", within: null, change: [A, B, X], tests: [C], verified: true, notes: [] },
    };

    it("scores a callers answer by F1 over files, with recall and precision beside it; a non-file counts as a wrong file", () => {
        const s = scoreAnswer(answer(A, C, "src/vs/gone.ts"), callersQ, ctx);
        // a, c and a non-file (3) against a and b: precision 1/3, recall 1/2, F1 = 2·(1/3)·(1/2) / (1/3 + 1/2) = 0.4
        expect(s.score).toBeCloseTo(0.4, 10);
        expect([s.recall, s.precision, s.hits, s.missed, s.flags]).toEqual([0.5, 1 / 3, 1, [B], ["names non-files"]]);
    });

    it("doesn't mark a callers answer down for naming its type's own file, as an entries answer may name its target", () => {
        expect(scoreAnswer(answer(`IFoo is declared in ${X}; its callers:`, A, B), callersQ, ctx).score).toBe(1);
    });

    it("scores a task as the mean of its two blocks' F1, each block reported", () => {
        const s = scoreAnswer(`Plan.\nANSWER CHANGE:\n${A}\n${B}\n${X}\nANSWER TESTS:\n${C}\n${D}`, taskQ, ctx);
        // CHANGE 3 of 3: F1 1; TESTS c and d against c: precision 1/2, recall 1, F1 2/3; the task 5/6
        expect(s.score).toBeCloseTo(5 / 6, 10);
        expect(s.parts).toEqual({
            change: { score: 1, recall: 1, precision: 1, missed: [], extra: [] },
            tests: { score: expect.closeTo(2 / 3, 10), recall: 1, precision: 0.5, missed: [], extra: [D] },
        });
        expect(s.flags).toEqual([]);
    });

    it("scores a missing block 0 and flags it; with neither block the task scores 0", () => {
        const s = scoreAnswer(`ANSWER CHANGE:\n${A}\n${B}\n${X}`, taskQ, ctx);
        expect([s.score, s.flags]).toEqual([0.5, ["no ANSWER TESTS: line"]]);
        expect(scoreAnswer("I'd change a few files.", taskQ, ctx).score).toBe(0);
    });

    it("puts the new kinds in the grep-hard family, each with its own row label", () => {
        for (const kind of ["callers", "breaks", "adopt", "injects", "task"] as const) expect(familyOfKind(kind)).toBe("grepHard");
    });
});
```

`scripts/eval/overlap.test.ts`:
```ts
it("compares a calls question's targets: the file that declares its type, and the method or type it names", () => {
    const dev = [askedOfSpec({ id: "d1", repo: "vscode", kind: "callers", type: "IFoo", file: "src/foo.ts", member: "save" })];
    const q = askedOfSpec({ id: "q1", repo: "vscode", kind: "breaks", type: "IFoo", file: "src/foo.ts", member: "load" });
    expect(q.targets).toEqual(["src/foo.ts", "IFoo.load"]);
    expect(overlaps([q], dev)).toEqual(["vscode: src/foo.ts is a target of q1 and of the dev set's d1"]);
    expect(askedOfSpec({ id: "q2", repo: "vscode", kind: "injects", type: "IBar", file: "src/bar.ts" }).targets).toEqual(["src/bar.ts", "IBar"]);
});
```
(Asking about another method of a type the dev set asked about is an overlap: the declaring file is shared.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval/answer.test.ts scripts/eval/score.test.ts scripts/eval/overlap.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`gate.ts`: `QuestionKind` gains `| "callers" | "breaks" | "adopt" | "injects" | "task"`. `GREP_HARD`, `GRAPH`, `OTHER`, `LISTS`, `USED` and every condition stay as they are.

`answer.ts`:
```ts
/** A task answer's label line (ANSWER CHANGE: or ANSWER TESTS:), with the markdown answerSection ignores. */
const label = (word: string): RegExp => new RegExp(`^[\\s>*_#\`-]*answer[*_\`]*\\s+${word}[*_\`]*\\s*:[*_\`]*\\s*(.*)$`, "i");

/**
 * A task answer's two blocks (V1.7 plan, R-U): the text after the last ANSWER CHANGE: line and after the last ANSWER
 * TESTS: line, each running up to the other's line when that comes later. A block whose line is missing is null.
 */
export function taskSections(text: string): { change: string | null; tests: string | null } {
    const lines = text.split(/\r?\n/);
    const last = (re: RegExp): number => {
        for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return i;
        return -1;
    };
    const [changeRe, testsRe] = [label("change"), label("tests")];
    const [c, t] = [last(changeRe), last(testsRe)];
    const block = (at: number, other: number, re: RegExp): string | null =>
        at < 0 ? null : [re.exec(lines[at])![1], ...lines.slice(at + 1, other > at ? other : lines.length)].join("\n").trim();
    return { change: block(c, t, changeRe), tests: block(t, c, testsRe) };
}
```

`score.ts`:
- `export const CALL_KINDS: readonly TruthFile["kind"][] = ["callers", "breaks", "adopt", "injects"];` beside `NEW_KINDS`.
- `export type PartScore = { score: number; recall: number; precision: number; missed: string[]; extra: string[] };` and `AnswerScore` gains `/** A task's two blocks (R-U); absent for every other kind. */ parts?: { change: PartScore; tests: PartScore };`.
- In `scoreAnswer`, right after the big-picture branch and before the `NO_ANSWER_LINE` flag: `if (q.truth?.kind === "task") return scoreTask(out, finalText, q.truth, ctx);`. The call kinds join Eval #2's: `if (truth !== undefined && (NEW_KINDS.includes(truth.kind) || CALL_KINDS.includes(truth.kind)))`.
- In `scoreNewKind`'s set branch, the type's own file lists nothing unless the truth holds it, as an entries answer's target (Eval #2's sweep B):
```ts
    const named = truth.kind === "entries" ? truth.target : CALL_KINDS.includes(truth.kind) ? (truth as CallTruthFile).file : null;
    const target = named !== null && !wanted.includes(named) ? named : null;
```
- The task:
```ts
/** A task's score (R-U): each block is F1 over files, the task's score their mean; a missing block scores 0 and is flagged. */
function scoreTask(out: AnswerScore, finalText: string | null, truth: TaskTruthFile, ctx: ScoreContext): AnswerScore {
    const blocks = finalText === null ? { change: null, tests: null } : taskSections(finalText);
    const flags: string[] = [];
    const files: string[] = [];
    const part = (block: string | null, wanted: readonly string[], name: string): PartScore => {
        if (block === null){
            flags.push(`no ANSWER ${name}: line`);
            return { score: 0, recall: 0, precision: 0, missed: [...wanted], extra: [] };
        }
        const named = extractPaths(block, ctx.repoRoot, ctx.known);
        for (const f of named.files) if (!files.includes(f)) files.push(f);
        const listed = [...named.files, ...listedNonFiles(named.notFiles, [])];
        const s = scoreList(listed, wanted);
        return { score: f1(listed, wanted), recall: s.recall, precision: s.precision, missed: s.missed, extra: s.extra };
    };
    const change = part(blocks.change, truth.change, "CHANGE");
    const tests = part(blocks.tests, truth.tests, "TESTS");
    return { ...out, flags, files, score: (change.score + tests.score) / 2, parts: { change, tests } };
}
```
- `KIND_ORDER` gains `"callers", "breaks", "adopt", "injects", "task"` after `"pairs"`; `KIND_LABEL` gains `callers: "Callers", breaks: "What breaks", adopt: "Adopt", injects: "Injected", task: "Task"`. The header comment names Eval #3's kinds and their scores.

`overlap.ts`, in `targetsOfFields`:
```ts
        case "callers": case "breaks": case "adopt": case "injects": case "task": {
            const named = typeof fields.type !== "string" ? [] : [typeof fields.member === "string" ? `${fields.type}.${fields.member}` : fields.type];
            return unique([...s("file"), ...named]);
        }
```
and the header comment: a calls question's targets are its type's file and the method or type it names, so another method of a type the dev set asked about overlaps through the file.

- [ ] **Step 4: Run the tests, then check Eval #1 and Eval #2 are unchanged**

Run: `npx vitest run scripts/eval` → PASS (about 8 new). Then Task 8 Step 5's re-score checks (Eval #2 byte for byte, Eval #1's headline), and `npm run eval:overlap -- --eval eval2` prints nothing.

- [ ] **Step 5: Gate, commit, push**

Run the gate (about 1,420/1,420). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): Eval #3's kinds scored: callers, breaks, adopt and injects by F1, a task by its two blocks' mean; the overlap check compares calls targets" -- scripts/eval && git push origin pivot/v1
```

### Task 12: Eval #3's gate, time to context and refusals in the results, and V1.6's B-9 and B-12

**Files:**
- Create: `scripts/eval/gate3.ts` (+ `gate3.test.ts`)
- Modify: `scripts/eval/score.ts` (+ test)

**Interfaces:**
- Consumes: `median`, `ratioOfMedians`, `ratioOfPlainMedians`, `bootstrapMedianInterval` (Task 9's `stats.ts`); `relevantContext`, `Needed`, `ContextResult` (Task 9); `refusedCalls` (Task 8); `QuestionKind`, `GateRun`, `GateSession`, `GateArm` (gate.ts).
- Produces: `QuestionSet`, `Gate3Run`, `Gate3Session`, `FILE_SET_KINDS`, `DI_AND_TASK`, `gate3Verdict(runs, sessions): Gate3Verdict`; in score.ts `loadRuns(dir, { raw })`, `withEval3Fields`, `toGate3Run`, `toGate3Session`, `ttrcRows`, `inRepeats`, and `renderGate` taking either verdict. Tasks 19–22 read their output.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/gate3.test.ts` (every expectation derived by hand in the comments):
```ts
import { describe, expect, it } from "vitest";
import type { GateArm, QuestionKind } from "./gate";
import { gate3Verdict, type Gate3Run, type Gate3Session, type QuestionSet } from "./gate3";

const run = (question: string, kind: QuestionKind, set: QuestionSet, arm: GateArm, repeat: number, over: Partial<Gate3Run> = {}): Gate3Run => ({
    question, repo: "r1", kind, set, arm, repeat, score: 1, costUsd: 1, wallMs: 1000,
    nebulosityCalls: arm === "nebulosity" ? 1 : 0, firstCallContext: arm === "nebulosity" ? 22_000 : 20_000, refusals: 0, ...over,
});
const three = (question: string, kind: QuestionKind, set: QuestionSet, arm: GateArm, per: (i: number) => Partial<Gate3Run>): Gate3Run[] =>
    [1, 2, 3].map((i) => run(question, kind, set, arm, i, per(i)));
const sessions = (score: number): Gate3Session[] => (["baseline", "nebulosity"] as const).flatMap((arm) =>
    [1, 2, 3].map((repeat) => ({ session: "s1", repo: "r1", arm, repeat, score, costUsd: 1, wallMs: 1000, refusals: 0 })));

// q1 callers and q2 task are new; q3 big-picture; q4 one of Eval #2's chains
const good = (): Gate3Run[] => [
    ...three("q1", "callers", "new", "baseline", (i) => ({ ttrcMs: [100, 200, 300][i - 1], score: 0.8 })),
    ...three("q1", "callers", "new", "nebulosity", (i) => ({ ttrcMs: [20, 40, 60][i - 1], costUsd: 0.4, wallMs: 400 })),
    ...three("q2", "task", "new", "baseline", () => ({ ttrcMs: 1000, score: 0.6, costUsd: 2, wallMs: 2000 })),
    ...three("q2", "task", "new", "nebulosity", () => ({ ttrcMs: 100, score: 0.9, costUsd: 0.5, wallMs: 600 })),
    ...three("q3", "bigPicture", "bigPicture", "baseline", () => ({ score: 0.9, costUsd: 0.5 })),
    ...three("q3", "bigPicture", "bigPicture", "nebulosity", () => ({ score: 0.9, costUsd: 0.55 })),
    ...three("q4", "chain", "eval2", "baseline", () => ({})),
    ...three("q4", "chain", "eval2", "nebulosity", () => ({ costUsd: 0.5 })),
];
const byId = (v: ReturnType<typeof gate3Verdict>) => Object.fromEntries(v.conditions.map((c) => [c.id, c]));

describe("gate3Verdict (ADR-060)", () => {
    it("passes when every condition holds, with each condition's numbers", () => {
        const v = gate3Verdict(good(), sessions(0.9));
        const c = byId(v);
        expect(v.conditions.map((x) => [x.id, x.pass])).toEqual([["V", true], ["1", true], ["2", true], ["3", true], ["4", true], ["5", true], ["6", true]]);
        expect(v.pass).toBe(true);
        // V: 12 single runs and 3 sessions per arm, none refused
        expect(c.V.values).toEqual({ refusedA: 0, runsA: 15, shareA: 0, refusedN: 0, runsN: 15, shareN: 0 });
        // 1: q1 40 / 200 = 0.2, q2 100 / 1000 = 0.1; the median 0.15; a resample's median is 0.1, 0.15 or 0.2, so the interval is [0.1, 0.2]
        expect(c["1"].values).toEqual({ questions: 2, median: 0.15, low: 0.1, high: 0.2 });
        // 2: A's errors 0.2 x 3 and 0.4 x 3 (mean 0.3), N's 0 x 3 and 0.1 x 3 (0.05): 0.05 / 0.3 = 0.1667; the floor N 0.95 - A 0.7 = 0.25
        expect(c["2"].values).toEqual({ errorA: 0.3, errorN: 0.05, errorRatio: 0.1667, worstFloor: 0.25 });
        // 3: time 400 / 1000 = 0.4 and 600 / 2000 = 0.3, median 0.35; cost 0.4 / 1 = 0.4 and 0.5 / 2 = 0.25, median 0.325
        expect(c["3"].values).toEqual({ questions: 2, wallRatio: 0.35, costRatio: 0.325 });
        // 5: N's 9 runs on q1, q2 and q4 all called a tool; 6: 22,000 - 20,000
        expect(c["5"].values).toEqual({ share: 1, runs: 9, used: 9 });
        expect(c["6"].values).toEqual({ a: 20_000, n: 22_000, difference: 2_000 });
    });

    it("fails V on one refused run in fifteen, and says the comparison is confounded", () => {
        const runs = good().map((r) => (r.question === "q1" && r.arm === "baseline" && r.repeat === 1 ? { ...r, refusals: 2 } : r));
        const v = gate3Verdict(runs, sessions(0.9));
        expect([byId(v).V.pass, byId(v).V.values.shareA, v.pass]).toEqual([false, 0.0667, false]);
        expect(byId(v).V.text).toMatch(/the comparison is confounded/);
    });

    it("counts a question A never reached as 0 and one N rarely reached as infinitely slow", () => {
        const neverA = good().map((r) => (r.question === "q1" && r.arm === "baseline" ? { ...r, ttrcMs: null } : r));
        // q1 0 (A never), q2 0.1: median 0.05, interval [0, 0.1]
        expect(byId(gate3Verdict(neverA, sessions(0.9)))["1"].values).toEqual({ questions: 2, median: 0.05, low: 0, high: 0.1 });
        const rarelyN = good().map((r) => (r.question === "q2" && r.arm === "nebulosity" && r.repeat < 3 ? { ...r, ttrcMs: null } : r));
        // N's q2 median is infinite, so q2's ratio is; the median of 0.2 and infinity is infinite
        const c1 = byId(gate3Verdict(rarelyN, sessions(0.9)))["1"];
        expect([c1.pass, c1.values.median]).toEqual([false, Infinity]);
        expect(c1.text).toMatch(/median ratio infinite/);
    });

    it("fails 2 when N's errors are more than half of A's, the floor still holding", () => {
        const runs = good().map((r) => (r.question === "q2" && r.arm === "nebulosity" ? { ...r, score: 0.5 } : r));
        // N's errors 0 x 3 and 0.5 x 3: 0.25, against A's 0.3: 0.8333; the floor 0.75 - 0.7 = 0.05
        const c2 = byId(gate3Verdict(runs, sessions(0.9)))["2"];
        expect([c2.pass, c2.values]).toEqual([false, { errorA: 0.3, errorN: 0.25, errorRatio: 0.8333, worstFloor: 0.05 }]);
    });

    it("fails 1 and 3 on a repo with no new questions, and skips that repo's missing sets in 4", () => {
        const r2 = [...three("p1", "bigPicture", "bigPicture", "baseline", () => ({ repo: "r2" })), ...three("p1", "bigPicture", "bigPicture", "nebulosity", () => ({ repo: "r2" }))];
        const c = byId(gate3Verdict([...good(), ...r2], sessions(0.9)));
        expect([c["1"].pass, c["1"].scope, c["3"].pass, c["4"].pass]).toEqual([false, "r2", false, true]);
    });
});
```

`scripts/eval/score.test.ts`:
```ts
describe("Eval #3's fields on a run", () => {
    const at = (s: number): string => `2026-10-20T10:00:${String(s).padStart(2, "0")}.000Z`;
    const raw = [
        { type: "assistant", timestamp: at(2), message: { id: "m1", usage: {}, content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "save" } }] } },
        { type: "user", timestamp: at(5), message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: `${A}:3:x.save()\n${B}:9:y.save()` }] } },
        { type: "result", subtype: "success", duration_ms: 6_000, permission_denials: [] },
    ].map((e) => JSON.stringify(e)).join("\n");
    const base = { name: "r", question: "vc1" } as RunResult;

    it("adds the question's set, the refused calls and the time to relevant context", () => {
        const r = withEval3Fields(base, { set: "new", raw, startedAt: at(0), repoId: "vscode", needed: { kind: "files", files: [A, B] }, tracked: new Set([A, B, C]) });
        expect([r.set, r.refusals, r.context?.ttrcMs, r.context?.coverage]).toEqual(["new", 0, 5_000, 1]);
        expect(withEval3Fields(base, { set: "bigPicture", raw, startedAt: at(0), repoId: "vscode", needed: undefined, tracked: new Set() }).context).toBeNull();
        expect(() => withEval3Fields(base, { set: "new", raw, startedAt: null, repoId: "vscode", needed: { kind: "files", files: [A] }, tracked: new Set() }))
            .toThrow("r has no startedAt in the index, so its time to relevant context can't be measured");
    });

    it("takes the gate's runs from repeats 1..repeats only (B-9)", () => {
        expect(inRepeats([{ repeat: 1 }, { repeat: 3 }, { repeat: 4 }, { repeat: 0 }], 3)).toEqual([{ repeat: 1 }, { repeat: 3 }]);
    });

    it("tabulates time to relevant context per repo: reached shares, medians, the matched ratio and its interval, tokens", () => {
        const ctxOf = (ttrcMs: number | null, tokens: number | null) => ({ reached: ttrcMs !== null, ttrcMs, ttrcQueryMs: ttrcMs, tokens, coverage: ttrcMs === null ? 0.5 : 1, mostlyRelevant: { reached: ttrcMs !== null, ttrcMs, ttrcQueryMs: ttrcMs } });
        const rows = ttrcRows([
            { question: "q1", repo: "r1", arm: "baseline", context: ctxOf(100, 1_000) },
            { question: "q1", repo: "r1", arm: "nebulosity", context: ctxOf(20, 300) },
            { question: "q2", repo: "r1", arm: "baseline", context: ctxOf(null, null) },
            { question: "q2", repo: "r1", arm: "nebulosity", context: ctxOf(50, 200) },
        ] as RunResult[]);
        // ratios q1 20 / 100 = 0.2, q2 0 (A never): median 0.1, interval [0, 0.2]; A reached 1 of 2, N 2 of 2;
        // the medians over runs: A's of 100 and never is never, N's 35; tokens over the reached runs: A 1,000, N 250
        expect(rows).toEqual([{ repo: "r1", questions: 2, reachedA: 0.5, reachedN: 1, medianA: Infinity, medianN: 35, ratio: 0.1, low: 0, high: 0.2, mostlyRatio: 0.1, tokensA: 1_000, tokensN: 250 }]);
    });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval/gate3.test.ts scripts/eval/score.test.ts`
Expected: FAIL.

- [ ] **Step 3: `scripts/eval/gate3.ts`**

```ts
/**
 * Eval #3's ship gate (ADR-060; D1 of V1.7's plan, approved 2026-10-15 and fixed before any run): V and conditions 1-6
 * over the scored runs of arms A (Claude Code alone) and N (with Nebulosity). Every one must hold. Questions fall in three
 * sets: "new" (the DI, task and Theia graph questions), "eval2" (Eval #2's graph questions, reused unchanged) and
 * "bigPicture" (Eval #2's and the new ones). A ratio is per question (N's median over A's), then the median over the set's
 * questions; intervals resample questions. Means run over runs. A per-repo condition fails when any repo fails, and
 * reports the worst repo. A condition with nothing to compare fails. Values are compared unrounded (1e-9) and rounded to
 * 4 decimal places. Eval #2's gate (gate.ts, the V1.6 plan's D1) is untouched: Eval #2 keeps it.
 */
import { median as medianOf, bootstrapMedianInterval, ratioOfMedians, ratioOfPlainMedians } from "./stats";
import type { GateArm, GateRun, GateSession, QuestionKind } from "./gate";

export type QuestionSet = "new" | "eval2" | "bigPicture";
/** A single run as the gate takes it: Eval #2's gate's fields (GateRun), its question's set, its refused calls, and its TTRC from process start (null: never reached; absent: its question has no needed set). */
export type Gate3Run = GateRun & { set: QuestionSet; refusals: number; ttrcMs?: number | null };
export type Gate3Session = GateSession & { refusals: number };
export type Gate3Id = "V" | "1" | "2" | "3" | "4" | "5" | "6";
export type Gate3Condition = { id: Gate3Id; scope: string; values: Record<string, number>; pass: boolean; text: string };
export type Gate3Verdict = { pass: boolean; conditions: Gate3Condition[] };

/** The kinds whose truth is a set of files, the scope of TTRC (D2). */
export const FILE_SET_KINDS: readonly QuestionKind[] = ["callers", "breaks", "adopt", "injects", "task", "list-direct", "list-transitive", "chain", "cycle", "unused", "violations", "entries"];
/** Condition 3's kinds. */
export const DI_AND_TASK: readonly QuestionKind[] = ["callers", "breaks", "adopt", "injects", "task"];

const EPS = 1e-9;
const r4 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 + 0 : x);
const roundAll = (values: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, r4(v)]));
const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const ratio = (n: number, a: number): number => (a === 0 ? (n === 0 ? 0 : Infinity) : n / a);
const n4 = (x: number): string => (Number.isFinite(x) ? x.toFixed(4) : "infinite");
const A = <T extends { arm: GateArm }>(xs: readonly T[]): T[] => xs.filter((x) => x.arm === "baseline");
const N = <T extends { arm: GateArm }>(xs: readonly T[]): T[] => xs.filter((x) => x.arm === "nebulosity");
const repos = (xs: readonly { repo: string }[]): string[] => [...new Set(xs.map((x) => x.repo))].sort();

/** The questions of a set of runs that have runs of both arms, each with its A and N runs, in question order. */
function paired(runs: readonly Gate3Run[]): { question: string; a: Gate3Run[]; n: Gate3Run[] }[] {
    const ids = [...new Set(runs.map((r) => r.question))].sort();   // by id, so the seeded bootstrap draws the same way however the runs were loaded
    return ids.map((question) => ({ question, a: A(runs).filter((r) => r.question === question), n: N(runs).filter((r) => r.question === question) }))
        .filter((q) => q.a.length > 0 && q.n.length > 0);
}

type Unit = { scope: string; slack: number; values: Record<string, number>; text: string };

function perUnit(id: Gate3Id, units: Unit[], rule: string, nothing: string): Gate3Condition {
    if (units.length === 0) return { id, scope: "no runs to compare", values: {}, pass: false, text: `${rule}: ${nothing}.` };
    const worst = units.reduce((w, u) => (u.slack < w.slack ? u : w));
    const pass = units.every((u) => u.slack >= -EPS);
    return { id, scope: worst.scope, values: roundAll(worst.values), pass, text: `${rule}: ${worst.text}${pass ? "" : ` (fails on ${worst.scope})`}.` };
}

function conditionV(runs: readonly Gate3Run[], sessions: readonly Gate3Session[]): Gate3Condition {
    const rule = "Valid: at most 5% of each arm's runs have a refused command";
    const count = (arm: GateArm) => {
        const all = [...runs.filter((r) => r.arm === arm), ...sessions.filter((s) => s.arm === arm)];
        const refused = all.filter((r) => r.refusals > 0).length;
        return { refused, runs: all.length, share: all.length === 0 ? Infinity : refused / all.length };
    };
    const [a, n] = [count("baseline"), count("nebulosity")];
    const pass = a.share <= 0.05 + EPS && n.share <= 0.05 + EPS;
    return {
        id: "V", scope: "every run, each arm", pass,
        values: roundAll({ refusedA: a.refused, runsA: a.runs, shareA: a.share, refusedN: n.refused, runsN: n.runs, shareN: n.share }),
        text: `${rule}: A ${a.refused} of ${a.runs} (${n4(a.share)}), N ${n.refused} of ${n.runs} (${n4(n.share)}) (each needs at most 0.05)${pass ? "" : "; the comparison is confounded"}.`,
    };
}

function condition1(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "4x faster to the relevant context: the median per-question TTRC ratio at most 0.25 and its 95% interval's upper end at most 0.50, for each repo's new file-set questions";
    const units = repos(runs).map((repo): Unit => {
        const own = runs.filter((r) => r.repo === repo && r.set === "new" && FILE_SET_KINDS.includes(r.kind) && r.ttrcMs !== undefined);
        const ratios = paired(own).map((q) => ratioOfMedians(q.a.map((r) => r.ttrcMs ?? null), q.n.map((r) => r.ttrcMs ?? null)));
        if (ratios.length === 0) return { scope: repo, slack: -Infinity, values: {}, text: `no new file-set questions with a needed set on ${repo}` };
        const m = medianOf(ratios);
        const [low, high] = bootstrapMedianInterval(ratios);
        return {
            scope: repo, slack: Math.min(0.25 - m, 0.5 - high), values: { questions: ratios.length, median: m, low, high },
            text: `${ratios.length} questions, median ratio ${n4(m)}, 95% interval ${n4(low)} to ${n4(high)} on ${repo} (needs at most 0.25, and at most 0.50 for the upper end)`,
        };
    });
    return perUnit("1", units, rule, "no runs");
}

function condition2(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Half the errors: N's mean error at most half of A's over every repo's new questions, and N's mean at least A's - 0.02 on each repo";
    const own = runs.filter((r) => r.set === "new");
    if (A(own).length === 0 || N(own).length === 0) return { id: "2", scope: "new questions, all repos pooled", values: {}, pass: false, text: `${rule}: no new questions of both arms.` };
    const [errorA, errorN] = [mean(A(own).map((r) => 1 - r.score)), mean(N(own).map((r) => 1 - r.score))];
    const floors = repos(runs).map((repo) => {
        const mine = own.filter((r) => r.repo === repo);
        const difference = A(mine).length === 0 || N(mine).length === 0 ? -Infinity : mean(N(mine).map((r) => r.score)) - mean(A(mine).map((r) => r.score));
        return { repo, difference };
    });
    const worst = floors.reduce((w, f) => (f.difference < w.difference ? f : w));
    const errorRatio = ratio(errorN, errorA);
    const pass = errorN <= 0.5 * errorA + EPS && worst.difference >= -0.02 - EPS;
    return {
        id: "2", scope: "new questions, all repos pooled; the floor per repo", pass,
        values: roundAll({ errorA, errorN, errorRatio, worstFloor: worst.difference }),
        text: `${rule}: mean error A ${n4(errorA)}, N ${n4(errorN)} (${n4(errorRatio)} of A's, needs at most 0.50); the lowest repo is ${worst.repo} at ${n4(worst.difference)} from A (needs at least -0.02).`,
    };
}

function condition3(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Faster and cheaper end to end: the median per-question ratio of time and of cost each at most 0.50, for each repo's DI and task questions";
    const units = repos(runs).map((repo): Unit => {
        const qs = paired(runs.filter((r) => r.repo === repo && r.set === "new" && DI_AND_TASK.includes(r.kind)));
        if (qs.length === 0) return { scope: repo, slack: -Infinity, values: {}, text: `no DI or task questions on ${repo}` };
        const wallRatio = medianOf(qs.map((q) => ratioOfPlainMedians(q.a.map((r) => r.wallMs), q.n.map((r) => r.wallMs))));
        const costRatio = medianOf(qs.map((q) => ratioOfPlainMedians(q.a.map((r) => r.costUsd), q.n.map((r) => r.costUsd))));
        return {
            scope: repo, slack: Math.min(0.5 - wallRatio, 0.5 - costRatio), values: { questions: qs.length, wallRatio, costRatio },
            text: `${qs.length} questions, median time ratio ${n4(wallRatio)}, median cost ratio ${n4(costRatio)} on ${repo} (each needs at most 0.50)`,
        };
    });
    return perUnit("3", units, rule, "no runs");
}

function condition4(runs: readonly Gate3Run[], sessions: readonly Gate3Session[]): Gate3Condition {
    const rule = "No loss elsewhere: big-picture N at least A - 0.03 with a cost ratio at most 1.15; Eval #2's graph questions N at least A - 0.03 with a cost ratio at most 1.0; the session N at least A - 0.03; each repo where it has them";
    const units: Unit[] = [];
    for (const repo of repos([...runs, ...sessions])){
        for (const [set, name, bar] of [["bigPicture", "big-picture", 1.15], ["eval2", "Eval #2's graph questions", 1.0]] as const){
            const own = runs.filter((r) => r.repo === repo && r.set === set);
            const qs = paired(own);
            if (qs.length === 0) continue;
            const difference = mean(N(own).map((r) => r.score)) - mean(A(own).map((r) => r.score));
            const costRatio = medianOf(qs.map((q) => ratioOfPlainMedians(q.a.map((r) => r.costUsd), q.n.map((r) => r.costUsd))));
            units.push({
                scope: `${repo}, ${name}`, slack: Math.min(difference + 0.03, bar - costRatio), values: { difference, costRatio },
                text: `score difference ${n4(difference)}, median cost ratio ${n4(costRatio)} on ${repo}, ${name} (needs at least -0.03, and at most ${bar.toFixed(2)})`,
            });
        }
        const own = sessions.filter((s) => s.repo === repo);
        if (A(own).length > 0 && N(own).length > 0){
            const difference = mean(N(own).map((s) => s.score)) - mean(A(own).map((s) => s.score));
            units.push({ scope: `${repo}, the session`, slack: difference + 0.03, values: { difference }, text: `session score difference ${n4(difference)} on ${repo} (needs at least -0.03)` });
        }
    }
    return perUnit("4", units, rule, "no big-picture, Eval #2 or session runs of both arms");
}

function condition5(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Tools used: at least 0.90 of N's runs on new and graph questions call a Nebulosity tool (all repos)";
    const own = N(runs.filter((r) => r.set === "new" || r.set === "eval2"));
    if (own.length === 0) return { id: "5", scope: "all repos", values: {}, pass: false, text: `${rule}: no such N runs.` };
    const used = own.filter((r) => r.nebulosityCalls > 0).length;
    const share = used / own.length;
    return { id: "5", scope: "all repos", values: roundAll({ share, runs: own.length, used }), pass: share >= 0.9 - EPS, text: `${rule}: ${used} of ${own.length} (${n4(share)}).` };
}

function condition6(runs: readonly Gate3Run[]): Gate3Condition {
    const rule = "Cheap per turn: N's median first-call context at most 2,500 tokens above A's, for each repo";
    const units: Unit[] = [];
    for (const repo of repos(runs)){
        const own = runs.filter((r) => r.repo === repo && r.firstCallContext !== null);
        if (A(own).length === 0 || N(own).length === 0) continue;
        const [a, n] = [medianOf(A(own).map((r) => r.firstCallContext as number)), medianOf(N(own).map((r) => r.firstCallContext as number))];
        units.push({ scope: repo, slack: 2500 - (n - a), values: { a, n, difference: n - a }, text: `median first call A ${Math.round(a).toLocaleString("en-US")}, N ${Math.round(n).toLocaleString("en-US")}, ${n - a >= 0 ? "+" : ""}${Math.round(n - a).toLocaleString("en-US")} tokens on ${repo} (needs at most +2,500)` });
    }
    return perUnit("6", units, rule, "no runs with a first call of both arms");
}

/** V and conditions 1-6, in that order; `pass` is all seven. */
export function gate3Verdict(runs: readonly Gate3Run[], sessions: readonly Gate3Session[]): Gate3Verdict {
    const conditions = [conditionV(runs, sessions), condition1(runs), condition2(runs), condition3(runs), condition4(runs, sessions), condition5(runs), condition6(runs)];
    return { pass: conditions.every((c) => c.pass), conditions };
}
```

- [ ] **Step 4: The scorer (`score.ts`)**

- `loadRuns(dir, options: { raw?: boolean } = {})`: with `raw`, each `LoadedRun` keeps `raw: string` (the gunzipped transcript); without it, nothing changes.
- `RunResult` gains `set?: QuestionSet; refusals?: number; context?: ContextResult | null` and `SessionResult` gains `refusals?: number`, all written only for an eval with `"gate": "eval3"` (R-V).
- The helpers the tests pin:
```ts
/** The runs the gate takes: repeats 1..`repeats` only (V1.6 final review B-9). */
export const inRepeats = <T extends { repeat: number }>(xs: readonly T[], repeats: number): T[] => xs.filter((x) => x.repeat >= 1 && x.repeat <= repeats);

/** Eval #3's fields on a scored run (R-V): its question's set, its refused calls, and its time to relevant context when its question has a needed set. */
export function withEval3Fields(r: RunResult, input: { set: QuestionSet; raw: string; startedAt: string | null; repoId: string; needed: Needed | undefined; tracked: ReadonlySet<string> }): RunResult {
    if (input.needed !== undefined && input.startedAt === null) throw new Error(`${r.name} has no startedAt in the index, so its time to relevant context can't be measured`);
    const context = input.needed === undefined ? null
        : relevantContext({ jsonl: input.raw, startedAt: input.startedAt as string, repoId: input.repoId, needed: input.needed, tracked: input.tracked });
    return { ...r, set: input.set, refusals: refusedCalls(input.raw), context };
}

export function toGate3Run(r: RunResult): Gate3Run | null {
    const g = toGateRun(r);
    if (g === null || r.set === undefined || r.refusals === undefined) return null;
    return { ...g, set: r.set, refusals: r.refusals, ...(r.context ? { ttrcMs: r.context.ttrcMs } : {}) };
}

export function toGate3Session(s: SessionResult): Gate3Session | null {
    const g = toGateSession(s);
    return g === null || s.refusals === undefined ? null : { ...g, refusals: s.refusals };
}

export type TtrcRow = { repo: string; questions: number; reachedA: number; reachedN: number; medianA: number; medianN: number; ratio: number; low: number; high: number; mostlyRatio: number; tokensA: number | null; tokensN: number | null };

/** Per repo, over the runs with a needed set: each arm's reached share and median TTRC (never = infinite), the matched per-question ratio's median and interval, the mostly-relevant version's median ratio, and the median tokens to context over the reached runs. */
export function ttrcRows(results: readonly RunResult[]): TtrcRow[] {
    const own = results.filter((r) => r.context !== undefined && r.context !== null && r.repo !== undefined);
    return [...new Set(own.map((r) => r.repo as string))].sort().map((repo) => {
        const mine = own.filter((r) => r.repo === repo);
        const arm = (a: string) => mine.filter((r) => r.arm === a);
        const [a, n] = [arm("baseline"), arm("nebulosity")];
        const questions = [...new Set(mine.map((r) => r.question))].sort().filter((q) => a.some((r) => r.question === q) && n.some((r) => r.question === q));
        const ratios = (pick: (r: RunResult) => number | null) => questions.map((q) => ratioOfMedians(a.filter((r) => r.question === q).map(pick), n.filter((r) => r.question === q).map(pick)));
        const plain = ratios((r) => r.context!.ttrcMs);
        const [low, high] = bootstrapMedianInterval(plain);
        const tokens = (xs: RunResult[]) => median(xs.flatMap((r) => (r.context!.tokens === null ? [] : [r.context!.tokens])));
        const share = (xs: RunResult[]) => xs.filter((r) => r.context!.reached).length / xs.length;
        const ttrc = (xs: RunResult[]) => medianOfRuns(xs.map((r) => r.context!.ttrcMs ?? Infinity));
        return {
            repo, questions: questions.length, reachedA: share(a), reachedN: share(n), medianA: ttrc(a), medianN: ttrc(n),
            ratio: medianOfRuns(plain), low, high, mostlyRatio: medianOfRuns(ratios((r) => r.context!.mostlyRelevant.ttrcMs)), tokensA: tokens(a), tokensN: tokens(n),
        };
    });
}
```
  (`medianOfRuns` is `stats.ts`'s `median`, imported under that name because score.ts already has its own `median`, which returns null for no values; `tokens` uses score.ts's.)
- `renderGate` takes `{ pass: boolean; conditions: { id: string; pass: boolean; scope: string; text: string }[] }`, so it prints either verdict; Eval #2's text is unchanged.
- `renderTtrcTable(rows)`: columns Repo, Questions, Reached A, Reached N, Median TTRC A, Median TTRC N, Ratio (median), 95% interval, Mostly-relevant ratio, Tokens to context A, Tokens to context N; an infinite median prints "never".
- `renderRefusalTable(results, sessions)`: per arm and kind (sessions as "session"): runs, runs with a refused call, refused calls.
- In `main()`:
  - `const eval3 = definition.gate === "eval3";` and `loadRuns(runsDir, { raw: eval3 })`.
  - Eval #3 only: read `<dir>/truth/needed.json` (stop with "eval3/truth/needed.json doesn't exist: run npm run eval:needed -- --eval eval3 first." when missing); list each touched repo's tracked files once (`git -C <repo> ls-files`, lower-cased); a question's set is `"bigPicture"` for big-picture, `"eval2"` when its `questions.json` entry has `"origin": "eval2"`, else `"new"`; each single run goes through `withEval3Fields` after `withGateFields`, and each session gets `refusals: refusedCalls(raw)`.
  - The gate takes `inRepeats(…, definition.repeats)` of the runs and the sessions, for Eval #2's gate and for Eval #3's (B-9; Eval #2's runs are all repeats 1–3, so its output doesn't move).
  - Eval #3 only, after "Per repo and kind": `## Time to relevant context` (`renderTtrcTable(ttrcRows(results))`) and `## Refusals`. The gate's heading is `## Ship gate (ADR-060)`, and its body `renderGate(gate3Verdict(…toGate3Run…, …toGate3Session…))`.
  - Eval #3's `results.json` adds `commits` (each repo's id and pinned commit, B-12) and `verdict` (when computed). JSON has no infinity, so an infinite number in Eval #3's file is written as the string `"infinite"` and a missing one (NaN) as `"n/a"`, with a `JSON.stringify` replacer. Eval #2's keys and bytes stay as they are (R-V).
  - The header comment describes Eval #3's gate, fields and tables.

- [ ] **Step 5: Run the tests, then check Eval #1 and Eval #2 are unchanged**

Run: `npx vitest run scripts/eval` → PASS (about 8 new). Then Task 8 Step 5's re-score checks (Eval #2 byte for byte, Eval #1's headline).

- [ ] **Step 6: Gate, commit, push**

Run the gate (about 1,428/1,428). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): Eval #3's gate (V and conditions 1-6, ADR-060) behind the definition's selector; time to relevant context and refused calls per run in its results; the gate takes repeats 1..n (B-9) and results name each repo's commit (B-12)" -- scripts/eval && git push origin pivot/v1
```

### Task 13: Grader redaction before the blind sheets (R-M, R-AD)

**Files:**
- Create: `scripts/eval/redact.ts` (+ `redact.test.ts`)
- Modify: `scripts/eval/grading.ts` (+ test)

**Interfaces:**
- Produces: `redact(text): { text: string; redactions: Redaction[] }`; `sheetAnswer(finalText, redactAnswers)`; Eval #3's sheets redacted, the redactions in `.nebulosity/<eval>/redactions.json` (published as `<eval>/grading/redactions.json` at merge). Task 21 uses them.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/redact.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact (R-AD)", () => {
    it("turns Nebulosity and its tools into neutral words, with a capital where a sentence starts", () => {
        expect(redact("Nebulosity's import graph shows 461 imports that go against the layers.").text).toBe("The import graph shows 461 imports that go against the layers.");
        expect(redact("They come from the import graph that the Nebulosity code-index tool built for this repo.").text).toBe("They come from the import graph that the index built for this repo.");
        expect(redact("I called mcp__nebulosity__architecture, then `mcp__nebulosity__calls`.").text).toBe("I called a search, then a search.");
        expect(redact("The `architecture` tool reports the layers; the describe answer adds the docs.").text).toBe("A search reports the layers; the describe answer adds the docs.");
        expect(redact("Then the architecture tool listed the layers.").text).toBe("Then a search listed the layers.");
    });

    it("leaves an answer by Claude Code alone as it is, a folder named like a tool included, and lists what it replaced", () => {
        const plain = "I ran git grep for `IFooService` and a script over the import graph; see the `search` folder.";
        expect(redact(plain)).toEqual({ text: plain, redactions: [] });
        const ordinary = "The search results list three files, and the overview answers it; the describe call and the imports results agree.";
        expect(redact(ordinary)).toEqual({ text: ordinary, redactions: [] });
        expect(redact("Nebulosity's index, and Nebulosity again.")).toEqual({
            text: "The index, and the index again.",
            redactions: [{ from: "Nebulosity's", to: "the", count: 1 }, { from: "Nebulosity", to: "the index", count: 1 }],
        });
    });
});
```
(The first three sentences are Eval #2's own phrasings, from its three sheets that named the tool.)

`scripts/eval/grading.test.ts`:
```ts
it("redacts an Eval #3 sheet's answer and keeps Eval #1's and Eval #2's as they were", () => {
    expect(sheetAnswer("Nebulosity's map says so.", true)).toEqual({ answer: "The map says so.", redactions: [{ from: "Nebulosity's", to: "the", count: 1 }] });
    expect(sheetAnswer("Nebulosity's map says so.", false)).toEqual({ answer: "Nebulosity's map says so.", redactions: [] });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval/redact.test.ts scripts/eval/grading.test.ts`
Expected: FAIL.

- [ ] **Step 3: `scripts/eval/redact.ts`**

```ts
/**
 * Grader redaction for Eval #3 (ADR-060, R-M, R-AD): before the blind sheets, the words that name Nebulosity or its
 * tools become neutral ones, so a grader can't tell the arms apart by them. "The index" and "the import graph" stay:
 * they are ordinary words, and the sheets' count of them is disclosed. The rules run in order; each replacement is
 * listed, so the record says what changed. Pure.
 */
const TOOLS = "overview|describe|search|imports|architecture|calls|show_on_map";
const RULES: readonly { re: RegExp; to: string }[] = [
    { re: /`?mcp__nebulosity__\w+`?/gi, to: "a search" },
    { re: /\bNebulosity['’]s\b/gi, to: "the" },
    { re: /\b(?:(?:the|a) )?Nebulosity(?: code-index| MCP)?(?: tools?| server| index)?\b/gi, to: "the index" },
    // a tool's name written as a tool: in backticks before tool, call, answer or result, or bare before "tool"; ordinary words
    // ("the search results", "the overview answers it") stay
    { re: new RegExp(`(?<![\\w\`])(?:(?:the|a|an) )?\`(?:${TOOLS})\` (?:tools?|calls?|answers?|results?)\\b`, "gi"), to: "a search" },
    { re: new RegExp(`\\b(?:(?:the|a|an) )?(?:${TOOLS}) tools?\\b`, "gi"), to: "a search" },
];

export type Redaction = { from: string; to: string; count: number };

/** Whether a replacement starts a sentence: at the start, after . ! ? or :, or at a line's start after markdown marks. */
const startsSentence = (before: string): boolean => /(?:^|[.!?:]\s+|\n[\s>*#-]*)$/.test(before);

export function redact(text: string): { text: string; redactions: Redaction[] } {
    const redactions: Redaction[] = [];
    let out = text;
    for (const { re, to } of RULES){
        out = out.replace(re, (match: string, offset: number, whole: string) => {
            const seen = redactions.find((r) => r.from === match && r.to === to);
            if (seen) seen.count++;
            else redactions.push({ from: match, to, count: 1 });
            return startsSentence(whole.slice(0, offset)) ? to[0].toUpperCase() + to.slice(1) : to;
        });
    }
    return { text: out, redactions };
}
```

- [ ] **Step 4: The sheets (`grading.ts`)**

- `export function sheetAnswer(finalText: string, redactAnswers: boolean): { answer: string; redactions: Redaction[] }`: `redact(finalText)` when asked, the text as it is otherwise.
- `main()` loads the definition (it already does) and passes `definition.gate === "eval3"` to `sheets()` as `redactAnswers`.
- `sheets()`: each new sheet's answer is `sheetAnswer(...)`; with redactions, they go into `.nebulosity/<eval>/redactions.json` (sheet id → its list, written after each sheet, as the key is). The disclosure prints, for an Eval #3 sheet set: `answers still mentioning nebulosity or mcp__ after redaction: <n> of <m>` (expected 0; any is read and the rules extended before grading), `answers naming the index or the import graph: <n> of <m> (ordinary words, kept; R-AD)`, counted on the answers before redaction, so rule 3's own "the index" doesn't add to it, and `answers with redactions: <n> of <m>`. Eval #1's and Eval #2's line stays as it is.
- `merge()`: copies `.nebulosity/<eval>/redactions.json` to `<eval>/grading/redactions.json` when it exists, with the key: grading is done, so the record is published.
- The header comment says the sheets of an eval with `"gate": "eval3"` are redacted, and where the list goes.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run scripts/eval` → PASS (about 3 new), then Task 8 Step 5's re-score checks. Check: `npm run eval:grading -- --eval eval2 sheets` makes no new sheet and prints Eval #2's disclosure line as before (every run already has its sheet).

- [ ] **Step 6: Gate, commit, push**

Run the gate (about 1,431/1,431). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): Eval #3's blind sheets redact Nebulosity and its tools' names into neutral words, the redactions recorded and published at merge (R-M, R-AD)" -- scripts/eval && git push origin pivot/v1
```

---

## Part 3 — The guard probe, the dev set and the shell check, tool use

Nothing in this part touches Theia or Eval #3's questions (R1 of V1.6, kept): the dev set exists so tuning never sees them. Every run is asked for first, with its count.

### Task 14: The guard probe (1 run). Ask first

**Files:**
- Create (ledger, gitignored): `.superpowers/sdd/2026-10-15-v1-7-calls-and-context/guard-probe.ts`
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-060's text: the probe's result)

- [ ] **Step 1: Write the probe from V1.6's live check**

Copy the set-up of `.superpowers/sdd/2026-10-14-v1-6-works-on-your-repo/items-3-4-live-check.ts` (read it first):
- the runner's own `claudeArgs("baseline", { empty: <eval3/mcp/empty.json>, nebulosity: <the runner's Nebulosity config, unused by this arm> }, <eval3's pins>, { scratch })` with a fresh scratch folder (`scratchFolder`, removed afterwards) and no `shell`;
- `childEnv` (it strips `ANTHROPIC_API_KEY` and the session's `CLAUDE*` variables and sets `CLAUDE_CODE_GIT_BASH_PATH`);
- the working folder `../vscode`, `--strict-mcp-config` and `--setting-sources project,local`, as the runner passes them.

The prompt asks for one command, exactly:

> Run this exact command with the Bash tool, keeping the cd and the semicolon as written, and tell me what it printed: `cd /c/…/vscode; git ls-files | wc -l`

In the prompt itself, `…` is this machine's path to `../vscode` in Git Bash's `/c/…` form, as Eval #2's refused commands spelled it. This plan and every committed file write it as `/c/…/vscode`: no machine path goes into the repo.

The script checks the init with `validateInit` and checks `../vscode` before and after (HEAD, `git status --porcelain -uall`, `git clean -nd`). It saves the raw transcript in the ledger folder.

- [ ] **Step 2: Ask**

> Task 14 runs 1 `claude -p` run: Claude Code alone, Sonnet 5.5 at medium effort, isolated like the eval's runs. It asks for `cd /c/…/vscode; git ls-files | wc -l` exactly, the `;` form Eval #2's cd-then-git refusals used, to see whether Claude Code's guard refuses it. About $0.02–0.10 at list price. OK?

- [ ] **Step 3: Run it, on a yes, and record what happened**

Record, in the ledger:
- the init (model, version, `apiKeySource`, `permissionMode`, `mcp_servers`);
- the command as the transcript's `tool_use` recorded it (with or without its cd);
- the tool result: its output, or the denial's text;
- `permission_denials`, the turns and the cost estimate;
- `../vscode` unchanged.

Either way nothing else changes: the rules sentence already says "without cd" (R-L), and its wording changes at most once, after the shell check.

- [ ] **Step 4: Docs, commit, push**

ADR-060's proposed text gains one line under "Checked before the first run": `The guard probe (‹today›): cd /c/…/vscode; git ls-files | wc -l was ‹refused, with "…" | run, printing ‹n››.`. The path stays written as `/c/…`, never this machine's. Run the gate. Then:
```bash
git add -A -- docs/ENGINEERING_DECISIONS.md && git commit -m "docs: the guard probe's result, one live run of cd /c/…; git (ADR-060)" -- docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

### Task 15: The dev set and the shell check (38 runs). Ask first; STOP if the check fails

**Files:**
- Create: `scripts/eval/prompts.ts` (+ `prompts.test.ts`), `eval3/dev/questions.json`
- Modify: `scripts/eval/scan.test.ts` (the independence pin gains `prompts.ts`)

**Interfaces:**
- Produces: `CallKind`, `PromptTarget`, `callRule(kind, type, member?)`, `callPrompt(kind, target, change?)`, `TESTS_RULE`. Task 18 builds every call and task prompt with them, and `questions3.test.ts` checks every prompt against them.

- [ ] **Step 1: Write the failing test**

`scripts/eval/prompts.test.ts` (the example is fictional, as API_CONTRACTS asks):
```ts
import { describe, expect, it } from "vitest";
import { callPrompt } from "./prompts";

const target = { type: "IFooService", file: "src/vs/platform/foo/common/foo.ts", member: "save", within: "src" };

describe("callPrompt (D2's templates and rule sentences)", () => {
    it("writes a callers prompt: the stem, the call rule, the scope", () => {
        expect(callPrompt("callers", target)).toBe(
            "List every file that calls `IFooService.save` (`IFooService` is declared in `src/vs/platform/foo/common/foo.ts`). "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class); test files count. "
            + "Count only files under src/.");
    });

    it("writes a task prompt: the change in its source's words, the breaks rule, the tests rule, the scope over both lists", () => {
        expect(callPrompt("task", { ...target, within: "src/vs/workbench" }, "it gains an options argument (owner/repo#123).")).toBe(
            "I'm changing the signature of `IFooService.save` (`IFooService` is declared in `src/vs/platform/foo/common/foo.ts`): it gains an options argument (owner/repo#123). Plan it: which files will I have to change, and which tests should I run? "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class), or if it declares `IFooService`, a type that extends `IFooService`, a class that implements `IFooService` or a class that extends `mock<IFooService>()`, where that declaration defines `save`; test files count. "
            + "A test file should run if it is among the files to change or directly imports one of them, counting imports by this rule: any import, export … from, side-effect import, import() or require() statement that refers to the file counts, type-only imports included. A test file has a folder named test, tests or __tests__ on its path, or .test. or .spec. in its name. "
            + "Count only files under src/vs/workbench/, in both lists.");
    });

    it("writes an injects prompt, with no scope when the question has none", () => {
        expect(callPrompt("injects", { type: "BarService", file: "packages/core/src/bar.ts" })).toBe(
            "List every file that has `BarService` injected (`BarService` is declared in `packages/core/src/bar.ts`). "
            + "Count a file if it receives `BarService` through a constructor parameter typed `BarService`, a field decorated `@inject(BarService)`, or a call that asks a service container or hook for it (`get(BarService)`, `getOptional(BarService)`, `useService(BarService)`, `useServiceOptional(BarService)` or `useServices({ BarService })`); test files count.");
    });

    it("writes breaks and adopt prompts", () => {
        expect(callPrompt("breaks", { type: "IFooService", file: "src/foo.ts", member: "save" })).toBe(
            "If the signature of `IFooService.save` changes (`IFooService` is declared in `src/foo.ts`), which files have to change? List them. "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class), or if it declares `IFooService`, a type that extends `IFooService`, a class that implements `IFooService` or a class that extends `mock<IFooService>()`, where that declaration defines `save`; test files count.");
        expect(callPrompt("adopt", { type: "IFooService", file: "src/foo.ts", member: "save" }, "Saves should now pass a reason (owner/repo#7).")).toBe(
            "Saves should now pass a reason (owner/repo#7). List every file with a call to `IFooService.save` that would have to adopt it (`IFooService` is declared in `src/foo.ts`). "
            + "Count a file if it calls `save` on a value whose type is `IFooService`, a type that extends `IFooService`, or a class that implements `IFooService` (directly or through a base class); test files count.");
    });

    it("refuses an adopt question without its change, and a member kind without its member", () => {
        expect(() => callPrompt("adopt", target)).toThrow("an adopt question needs the change, in its source's words");
        expect(() => callPrompt("breaks", { type: "IFooService", file: "src/foo.ts" })).toThrow("a breaks question needs a member");
    });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run scripts/eval/prompts.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: `scripts/eval/prompts.ts`**

```ts
/**
 * Eval #3's prompts for the call kinds and the tasks (D2 of V1.7's plan, pinned): a stem naming the type, the method and
 * the declaring file in backticks; the kind's call rule; a task's tests rule; and the scope sentence (every VS Code call
 * question counts only files under src/ or a folder inside it, R-R). The runner appends the format line and the rules
 * sentence. Pure; imports nothing.
 */
export type CallKind = "callers" | "breaks" | "adopt" | "injects" | "task";
export type PromptTarget = { type: string; file: string; member?: string; within?: string };

export const TESTS_RULE = "A test file should run if it is among the files to change or directly imports one of them, counting imports by this rule: any import, export … from, side-effect import, import() or require() statement that refers to the file counts, type-only imports included. A test file has a folder named test, tests or __tests__ on its path, or .test. or .spec. in its name.";

/** D2's call rule for a kind, with the type and the method in backticks. */
export function callRule(kind: CallKind, type: string, member?: string): string {
    const t = `\`${type}\``;
    if (kind === "injects"){
        return `Count a file if it receives ${t} through a constructor parameter typed ${t}, a field decorated \`@inject(${type})\`, or a call that asks a service container or hook for it (\`get(${type})\`, \`getOptional(${type})\`, \`useService(${type})\`, \`useServiceOptional(${type})\` or \`useServices({ ${type} })\`); test files count.`;
    }
    const calls = `Count a file if it calls \`${member}\` on a value whose type is ${t}, a type that extends ${t}, or a class that implements ${t} (directly or through a base class)`;
    if (kind === "callers" || kind === "adopt") return `${calls}; test files count.`;
    return `${calls}, or if it declares ${t}, a type that extends ${t}, a class that implements ${t} or a class that extends \`mock<${type}>()\`, where that declaration defines \`${member}\`; test files count.`;
}

/** A call or task question's whole prompt, before the format line. `change` is an adopt's or a task's change, in its source's words. */
export function callPrompt(kind: CallKind, target: PromptTarget, change?: string): string {
    const { type, file, member, within } = target;
    if (kind !== "injects" && member === undefined) throw new Error(`a ${kind} question needs a member`);
    if (kind === "adopt" && change === undefined) throw new Error("an adopt question needs the change, in its source's words");
    const where = `(\`${type}\` is declared in \`${file}\`)`;
    const method = `\`${type}.${member}\``;
    const stem = kind === "callers" ? `List every file that calls ${method} ${where}.`
        : kind === "breaks" ? `If the signature of ${method} changes ${where}, which files have to change? List them.`
        : kind === "adopt" ? `${change} List every file with a call to ${method} that would have to adopt it ${where}.`
        : kind === "injects" ? `List every file that has \`${type}\` injected ${where}.`
        : `I'm changing the signature of ${method} ${where}${change === undefined ? "." : `: ${change}`} Plan it: which files will I have to change, and which tests should I run?`;
    const rules = kind === "task" ? `${callRule(kind, type, member)} ${TESTS_RULE}` : callRule(kind, type, member);
    const scope = within === undefined ? "" : ` Count only files under ${within}/${kind === "task" ? ", in both lists" : ""}.`;
    return `${stem} ${rules}${scope}`;
}
```
`scan.test.ts`'s independence pin gains `prompts.ts` (it imports nothing, so the "seen importing" check skips it).

- [ ] **Step 4: Run it and see it pass; gate**

Run: `npx vitest run scripts/eval` → PASS (5 new). Run the gate (about 1,436/1,436).

- [ ] **Step 5: Write the dev set, and check it shares no target with Eval #3**

`eval3/dev/questions.json`, marked `"dev": true`, in Eval #2's dev set's shape (`name`, `formats`, `questions`). Its `formats` are Eval #2's six lines (list, chain, bigPicture, impact, cycle, pairs), `callers`, `breaks`, `adopt` and `injects` with Eval #1's list line, and `task` with D2's task line: the same `formats` `eval3/questions.json` will carry. There are nineteen questions, so the shell check covers every kind (R-Z, design §5.3). No truth: the dev set measures refusals and tool use, never a score.

| Id | Kind | Target |
|---|---|---|
| `vscode-dev-callers` | callers | `ICommandService.executeCommand`, declared in `src/vs/platform/commands/common/commands.ts`; within `src/vs/workbench/browser` |
| `vscode-dev-breaks` | breaks | `IConfigurationService.getValue`, `src/vs/platform/configuration/common/configuration.ts`; within `src/vs/workbench/contrib/debug` |
| `vscode-dev-adopt` | adopt | `IFileService.readFile`, `src/vs/platform/files/common/files.ts`; within `src/vs/workbench/services`; change: `microsoft/vscode#117869 asks to adopt IFileService#readFile({ atomic: true }).` |
| `vscode-dev-injects` | injects | `ICommandService`, `src/vs/platform/commands/common/commands.ts`; within `src/vs/editor/contrib` |
| `vscode-dev-task` | task | `IEditorService.openEditor`, `src/vs/workbench/services/editor/common/editorService.ts`; within `src/vs/sessions/contrib` |
| `vscode-dev-chain`, `vscode-dev-transitive`, `vscode-dev-impact`, `vscode-dev-pairs` | chain, list-transitive, impact, pairs | Eval #2's dev questions of those ids, copied whole (prompt, family, kind) |
| `vscode-dev-bp` | bigPicture | How does VS Code start up: which processes does it launch, what does each one do, and how do they talk to each other? |
| `affine-dev-callers` | callers | `GraphQLService.gql`, `packages/frontend/core/src/modules/cloud/services/graphql.ts` |
| `affine-dev-breaks` | breaks | `WorkspaceDialogService.open`, `packages/frontend/core/src/modules/dialogs/services/workspace-dialog.ts` |
| `affine-dev-task` | task | `GlobalDialogService.open`, `packages/frontend/core/src/modules/dialogs/services/dialog.ts` |
| `affine-dev-entries`, `affine-dev-cycle`, `affine-dev-unused`, `affine-dev-violations` | entries, cycle, unused, violations | Eval #2's dev questions of those ids, copied whole (the cycle's `file` too) |
| `affine-dev-direct` | list-direct | Eval #1's direct-list stem and import rule, on `packages/frontend/admin/src/use-query.ts` (Eval #2's dev transitive target, asked directly) |
| `affine-dev-bp` | bigPicture | How does AFFiNE handle signing in and accounts: where do the sign-in flows live, and how does the app know who is signed in? |

- **The targets.** The call targets are the planning methods (R-A). The graph targets are Eval #2's dev targets, which Eval #2's own overlap check kept apart from its questions, the reused ones included. The VS Code call folders keep each answer to about 20–60 files: the design's checker evidence counts 22, 24, 29 and 21 caller files there for `executeCommand`, `getValue`, `readFile` and `openEditor`.
- **The prompts.** Each call and task question's `prompt` is `callPrompt(kind, target, change)`, built by a scratch script and pasted; `questions3.test.ts` (Task 18) checks every one. The entries carry `kind`, `family` (the runner's key to its format line: the kind for the five new kinds, `list` for the direct list, and Eval #2's family for the questions copied from its dev set), `repo` and `prompt`. Call and task entries also carry `target` (`{ type, file, member?, within? }`), and `change` and `source` (a URL) where they apply.
- **The overlap check, now.** A scratch script runs overlap.ts's `overlaps()` on the dev questions against the Eval #2 questions Eval #3 reuses (D2's list, read from `eval2/questions.json` with `askedOfQuestion` and their truths). It must print nothing. This is why the storage service is not a dev target: Eval #2's `vscode-impact` asks about `src/vs/platform/storage/common/storage.ts`.

- [ ] **Step 6: The dry run**

First run `claude --version`. If it isn't `eval3/eval.json`'s `claudeVersion`, re-pin it there, run the gate, commit (`test(eval3): re-pin Claude Code <version> before the dev set`) and record it: a real batch refuses a version that differs from the pin (`scripts/eval/run.ts`). Then run: `npm run eval:run -- --eval eval3 --dev --arms baseline,nebulosity --dry-run`
Expected:
- 38 commands;
- every prompt ends with the format line, then D2's rules sentence with this run's repo root and scratch folder, both in drive-letter form with forward slashes;
- no prompt ends with Eval #2's scripts sentence;
- A's and N's commands differ only in the MCP config file.

- [ ] **Step 7: Ask**

> Task 15 runs the dev set in both arms: 38 `claude -p` runs (19 questions × Claude Code alone and with Nebulosity), Sonnet 5.5 at medium effort, isolated, scripts allowed, every prompt ending with Eval #3's rules sentence. They check refusals (the shell check) and tool use with Nebulosity (round 1). About $3–6 at list price, plus a share of your 5-hour window. OK?

- [ ] **Step 8: Run it, on a yes**

`npm run eval:run -- --eval eval3 --dev --arms baseline,nebulosity`, in the background. Expected: every init valid, Nebulosity's six always-loaded tools listed in N's, each repo clean after each run, no leak. A run refused by validation stops the batch: report it verbatim.

- [ ] **Step 9: The shell check**

For each arm, count the refused commands: the `refusals` field of the dev runs' index lines (`refusedCalls`). Read every refusal in its transcript and name its cause in the ledger (write, cd-then-git, sed or loop, `..`, another).
- **Pass:** at most 1 refused command in each arm's 19 runs (1 per 10 runs, D2, rounded down), and no run that gives up after a refusal. "Gives up" means a run whose answer, after a refused command, has no ANSWER line, or says it couldn't do what the refused command was for.
- **Otherwise:** reword the rules sentence once (R-L), aimed at the causes read. Record the old and new sentence verbatim in the ledger, and change `rulesSentence` and its test in the same commit. Then ask, with the count: `> The shell check failed: ‹what was refused›. I'd re-run the ‹n› dev questions of the kinds that had a refusal, in both arms (‹2n› runs, about $‹x›), with this wording: ‹the new sentence›. OK?`. On a yes, move their round-1 transcripts into `eval3/dev/runs/round-1/` (the runner skips a run whose transcript is kept; the index lines stay), re-run them, and **STOP** for the owner whatever the re-run shows. Show every refusal with its cause, the new wording, and the re-run's counts.

- [ ] **Step 10: Commit, push**

The dev runs are scrubbed and leak-checked like any run. Run the gate, then commit them:
```bash
git add -A -- scripts/eval eval3/dev && git commit -m "test(eval3): the dev set and the shell check: ‹n› refused commands in 19 runs alone, ‹n› with Nebulosity (D2's bar: at most 1 each)" -- scripts/eval eval3/dev && git push origin pivot/v1
```

### Task 16: Tool use on the dev set (at most 16 more runs with Nebulosity). Ask before each round; STOP if under 0.90 after three rounds

**Files:**
- Modify: `lib/tools/registry.ts` (+ test; the wording, only if a round changes it, and `calls`' default `limit`, only under R-J's condition), `docs/BENCHMARKS.md` (MCP Dev Set #2), `docs/API_CONTRACTS.md` (§17, if a description changes), `README.md` and `docs/ENGINEERING_DECISIONS.md` (the measured tokens and characters, if a trim or the measurement moves them)

- [ ] **Step 1: Read round 1 (Task 15's 19 runs with Nebulosity)**

Per run record: whether a Nebulosity tool was called, which and with what input; whether ToolSearch was called (it shouldn't be: six tools are always loaded); the turns, the cost estimate and the first call's context; and, for each `calls` answer with more pages, whether the run asked for them.

**Targets:**
- a Nebulosity tool called in at least 16 of the 17 runs on non-big-picture questions (0.90 or more, as gate condition 5 counts new and graph questions only);
- the first-call difference at most 2,400 tokens on each repo: N's median first-call context minus A's, over that repo's dev runs (R-AA's margin under condition 6's 2,500).

- [ ] **Step 2: Tune only if needed, at most two more rounds (16 runs with Nebulosity at most, in all)**

If a run didn't use the tools, read its transcript and give the owner the reason in one line, for example "it grepped for the injections because `calls`' description doesn't say injected". Then:
- Change the wording of the instructions or of one tool's description only. The size test must keep passing (6,650).
- Ask before the round, with its count: `> Round ‹2|3› re-runs the ‹n› dev questions whose runs with Nebulosity missed the tools, after this wording change: ‹the change›. ‹n› runs, about $‹x›. OK?`
- On a yes: move those questions' earlier transcripts with Nebulosity into `eval3/dev/runs/round-<n>/` (the runner skips a run whose transcript is kept; the index lines stay), then `npm run eval:run -- --eval eval3 --dev --arms nebulosity --only <ids>`.

Each round's change and its effect go in the ledger. If the first-call difference is over 2,400 tokens on a repo, trim before the freeze. R-Q's texts put it at about +2,400, so this is likely. Trim in this order, re-measuring after each step with `registry.test.ts`'s count (about 2.75 characters a token) and on the dev runs:
1. drop the descriptions of `calls`' `within` and `offset`, as `architecture`'s `report` and `through` lost theirs (about 33 tokens);
2. shorten the instructions, one sentence at a time, starting with the one on docs;
3. cut `search`'s description to one sentence.

**R-J's condition:** if a run left a `calls` answer's later pages unread and so missed files, raise `calls`' default `limit` from 50 to 200. Record it as R-J's outcome and update §17's schema and description. Then ask, with the count, and re-run that question the same way. Otherwise the default stays at 50.

**After three rounds still under 0.90: STOP.** Show the misses with their reasons, and the options:
- (a) more wording;
- (b) run Eval #3 as it is and report the share.

- [ ] **Step 3: Record MCP Dev Set #2, commit, push**

In `docs/BENCHMARKS.md`, "‹today› MCP Dev Set #2 — the shell check and tool use before Eval #3", record:
- the shell check: refused commands per arm, each with its cause, and the sentence's wording (with its one rewording, if there was one);
- each round's share of runs that called a tool, and the ToolSearch calls;
- the first-call difference per repo;
- every wording change, and R-J's outcome.

README's "about 2,400 tokens" (Task 4) and ADR-056's characters per tool are corrected if a trim or the measurement moved them.

Run the gate. Then:
```bash
git add -A -- eval3/dev lib/tools docs/BENCHMARKS.md docs/API_CONTRACTS.md README.md docs/ENGINEERING_DECISIONS.md && git commit -m "test(eval3): MCP Dev Set #2, tool use ‹n›/17 with Nebulosity and the first-call difference per repo, measured before Eval #3's questions exist" -- eval3/dev lib/tools docs/BENCHMARKS.md docs/API_CONTRACTS.md README.md docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

---

## Part 4 — Theia

### Task 17: Theia's clone (STOP: ask with its size), its index, its resolution share

**Files:**
- Modify: `eval3/eval.json` (Theia's repo), `docs/BENCHMARKS.md` (Variety Benchmark #2)

- [ ] **Step 1: Find the size and the head (read-only)**

```bash
gh api repos/eclipse-theia/theia --jq '{size_kb: .size, default_branch: .default_branch}'
gh api repos/eclipse-theia/theia/commits/master --jq .sha
```

- [ ] **Step 2: STOP. Ask**

> Task 17 clones Theia, held out from everything so far: `git clone --depth 1 https://github.com/eclipse-theia/theia ../theia`, a download (GitHub reports ‹size› for the full history; a shallow clone takes less). Then I index it into your database, structure only, with `--no-activate`, so your Map stays on VS Code (R-AC's third write), in free mode with no summaries (R-K). OK?

- [ ] **Step 3: On a yes: clone, pin, check**

Clone. Record `git -C ../theia rev-parse HEAD` (40 hex) and check the tree is clean (`git status --porcelain -uall` prints nothing). Add the repo to `eval3/eval.json`:
```json
"theia": { "path": "../theia", "commit": "‹40-hex sha›", "slug": "eclipse-theia/theia" }
```

- [ ] **Step 4: Index it, and report its resolution share**

Check port 3000 first. Then:
```bash
npx tsx scripts/index.ts ../theia --no-activate
npm run report-resolution -- ../theia
```
Record:
- the files, the edges and the structure time;
- relative and bare imports resolved, not code by extension, and the top unresolved bare names, as Variety Benchmark #1's table has them;
- every unresolved name that is the repo's own code, which is one of ADR-053's limits (Theia imports its packages' compiled paths, `@theia/core/lib/…`, which must map to `src/`);
- the call facts' row counts. No `calls` answer is read on Theia before Task 18's draw: nobody sees how either arm does on a candidate before it (design §5.4).

- [ ] **Step 5: Docs, commit, push**

In `docs/BENCHMARKS.md`, "‹today› Variety Benchmark #2 — Theia, held out", give the row and the notes. Run the gate. Then:
```bash
git add -A -- eval3/eval.json docs/BENCHMARKS.md && git commit -m "test(eval3): Theia at ‹sha› (held out, free mode), indexed; Variety Benchmark #2: its resolution share" -- eval3/eval.json docs/BENCHMARKS.md && git push origin pivot/v1
```

---

## Part 5 — Eval #3's questions

### Task 18: The questions, their truths, the rubrics, the method. STOP for the owner's review

**Files:**
- Create:
  - `scripts/eval/draw.ts` (+ `draw.test.ts`), `scripts/eval/questions3.test.ts`;
  - `eval3/candidates.json`, `eval3/questions.json`, `eval3/sessions.json`, `eval3/truth-specs.json`;
  - `eval3/truth/*.json`, including `adjudicated.json`, `steps.json`, `calls-adjudicated.json` and `needed.json`;
  - `eval3/rubric/*.json`.
- Modify: `eval3/eval.json` (`pilot`), `scripts/eval/scan.test.ts` (the pin gains `draw.ts`), `package.json` (`"eval:draw": "tsx scripts/eval/draw.ts"`), `docs/EVAL_RESULTS.md` (Eval #3's method, before any run), `docs/ENGINEERING_DECISIONS.md` (ADR-060 accepted)

**Interfaces:**
- Consumes: `callPrompt` (Task 15), `programFor` and `callTruth` (Task 10), `mulberry32` (Task 9), `askedOfQuestion` and `overlaps` (overlap.ts), `buildRepoGraphs` and truth.ts's graph functions.
- Produces: `draw(candidates, n, seed)`; Eval #3's question files. Tasks 19–22 run and score them.

- [ ] **Step 1: Copy Eval #2's no-loss questions, unchanged (R-I)**

Write a scratch script that copies, from `eval2/`:
- **The questions** of D2's list: VS Code's nine graph questions, `vscode-bp1`–`vscode-bp5` and session `vscode-s1`'s four questions; AFFiNE's nine, `affine-bp1`–`affine-bp4` and session `affine-s1`'s four. Every field is kept, `truth` and `rubric` point at the copies, and `"origin": "eval2"` is added.
- **Their truths and rubrics**, byte for byte, to `eval3/truth/` and `eval3/rubric/`.
- **`eval2/truth/adjudicated.json` and `eval2/truth/steps.json`** to `eval3/truth/`. These verdicts are facts about VS Code's and AFFiNE's imports at the same commits.
- **The two sessions** to `eval3/sessions.json`.

`eval3/questions.json` takes Eval #2's shape (`name`, `repos`, `formats`, `questions`). Its `formats` are the dev set's.

- [ ] **Step 2: `scripts/eval/draw.ts`, test first**

`scripts/eval/draw.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { draw } from "./draw";

const pool = ["c", "a", "e", "b", "d"].map((id) => ({ id }));

describe("draw (the seeded draw of Eval #3's questions)", () => {
    it("draws n distinct candidates, the same ones for the same seed whatever the input order", () => {
        const one = draw(pool, 3, 1);
        expect(one).toHaveLength(3);
        expect(new Set(one.map((c) => c.id)).size).toBe(3);
        expect(one.every((c) => pool.some((p) => p.id === c.id))).toBe(true);
        expect(draw([...pool].reverse(), 3, 1)).toEqual(one);
    });

    it("takes every candidate when there are no more than n", () => {
        expect(draw(pool, 9, 1).map((c) => c.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
        expect(draw([], 2, 1)).toEqual([]);
    });
});
```
`scripts/eval/draw.ts`:
```ts
/**
 * npm run eval:draw -- --eval <dir>
 *
 * The seeded draw of Eval #3's questions (design §5.4, step 3). Each call or task candidate in <dir>/candidates.json gets its
 * truth's size from TypeScript's checker (ts-calls.ts, one program per repo), and passes when its size is 10-80 files, it
 * isn't a planning method (R-A), and it shares no target with the dev set or with the questions of the sessions Eval #3
 * reuses (overlap.ts). A graph candidate brings its size and its pass from Step 3's ranges, and is checked for overlap
 * too. Then, per repo and kind, in the order breaks, task, callers, adopt, injects and the graph kinds, n of
 * the passing candidates are drawn: sorted by id, shuffled with mulberry32(1), the first n. A type drawn once leaves the
 * repo's later pools (R-AF). It writes the sizes, the verdicts and the draw back into candidates.json. Nobody sees how
 * either arm does on a candidate before this runs. Imports nothing from lib/.
 */
import { mulberry32 } from "./stats";

export function draw<T extends { id: string }>(candidates: readonly T[], n: number, seed: number): T[] {
    const pool = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const random = mulberry32(seed);
    for (let i = pool.length - 1; i > 0; i--){
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}
```
The command (`main()`, run only as a script):
- Reads the definition, `<dir>/candidates.json` (`{ candidates: [{ id, repo, kind, target?, change?, source, quote, truthSize?, passes?, why?, drawn? }] }`) and `<dir>/dev/questions.json`, and the questions of the two sessions Eval #3 reuses (`vscode-s1` and `affine-s1` in `eval2/questions.json`): Step 8's `eval:overlap` refuses a single question that shares a target with a session question, so the draw does too.
- Builds each repo's checker program once, only for a repo with call or task candidates (`programFor(root, { project })`).
- Sizes each candidate: `callTruth` for callers and adopt (`"callers"`), breaks and tasks (`"breaks"`), and injects. A task's size is its CHANGE.
- Applies the three tests to the call and task candidates. A graph candidate keeps the pass its enumeration gave it (Step 3's ranges), and only the overlap test is applied to it. The planning methods are a constant, `PLANNING`, holding R-A's eight `Type.member` pairs.
- Draws D2's mix per repo (VS Code 2 callers, 2 breaks, 1 adopt, 1 injects, 3 tasks; AFFiNE 1, 2, 1, 1, 3; Theia 1, 2, 0, 1, 2, and its six graph kinds one each).
- R-X: a repo with no passing adopt candidate draws one more callers question instead, and says so.
- Prints a table per repo and kind: candidates, passing, drawn.

`scan.test.ts`'s independence pin gains `draw.ts`. It imports `stats.ts`, `ts-calls.ts`, `overlap.ts` and `definition.ts`, none of which reach `lib/`, directly or through their own imports (the pin follows them, Task 10).

Run: `npx vitest run scripts/eval/draw.test.ts` → FAIL first (no module), then PASS once written.

- [ ] **Step 3: Collect the candidates (read-only)**

**Call and task candidates.** For each repo, search its issues and pull requests for service or method changes, and read its docs. The searches:
```bash
gh search issues --repo microsoft/vscode "adopt" --limit 100 --json number,title,url
gh search prs --repo microsoft/vscode "deprecate" --limit 100 --json number,title,url
```
The search terms are adopt, deprecate, rename, signature, parameter and remove, for both `issues` and `prs`, on `microsoft/vscode`, `toeverything/AFFiNE` and `eclipse-theia/theia`.

A candidate is a class or interface `T` and, except for injects, a method `m`, both named by its source, and both declared at the pinned commit (`git grep` in the checkout). Record each in `eval3/candidates.json`:
- `id` (`<repo>-<kind>-<n>`), `repo`, `kind`, `target` (`{ type, file, member?, within? }`; VS Code's `within` is `src` or a folder its source names);
- `source` (the URL) and `quote` (its words, at most two sentences);
- for adopt and task candidates, `change`: the change in the source's words, one or two sentences, ending with the reference, `(owner/repo#n)`.

Collect at least 3 times the needed count per repo and kind. The same `Type.member` may be a candidate of several kinds.

**Theia's six graph candidates** come from the truth's own graph (`buildRepoGraphs(root, "theia", [], { resolveBare: true }).graph`, with a ledger script), by V1.6's rules (Task 14 Step 2 of its plan):
- list-direct: a file with 10–100 direct importers;
- list-transitive: a file with 10–100 files that depend on it;
- chain: an entry file (nothing imports it) and a file it reaches, the shortest chain 3–6 steps;
- cycle: a file whose shortest cycle is 3–6 steps;
- unused: a folder of 20–120 non-test files, 2–10 of them imported by nothing;
- entries: a file that 5–30 non-test roots load.

Every qualifying target is a candidate, with its `truthSize` and `passes: true` (its range is its filter).

- [ ] **Step 4: Size, filter and draw**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm run eval:draw -- --eval eval3`. Record the table and the drawn ids in the ledger. From here on the drawn set is fixed: a drawn candidate leaves only if its truth turns out wrong on reading (Step 7), and the next one in the same shuffled order replaces it, which is recorded.

- [ ] **Step 5: The new big-picture questions**

Two per repo, from the repo's own docs at the pinned commit (README files and docs folders in the checkout, or the project's documentation site), on topics that neither Eval #2's big-picture questions nor the dev set's two (VS Code's start-up processes, AFFiNE's sign-in) ask about:
- **An author:** a fresh Opus subagent writes each question and a rubric of 6–8 points, every point taken from the docs.
- **A re-checker:** an independent fresh Opus subagent checks every point in the source at the pinned commit, setting `holds` to true or false and writing a note.

The rubric's `source` names the doc. Theia's two test free mode (R-K).

- [ ] **Step 6: The prompts**

- **The change words:** a fresh subagent writes each adopt and task question's `change` from its drawn source, in the source's words. It sees the source and D2's templates, and never Eval #2's questions, the dev set or R-A's methods. The controller checks each against the quote.
- **Call and task prompts** are `callPrompt(kind, target, change)` (Task 15). VS Code's always carry `within`.
- **Theia's graph prompts** use V1.6's templates verbatim (its plan's Task 14 Step 1) and Eval #1's list and chain stems, with the import rule where those carry it.
- **Big-picture prompts** are the author's, with Eval #1's format line.

Ids:
- VS Code: `vscode-callers1`, `vscode-callers2`, `vscode-breaks1`, `vscode-breaks2`, `vscode-adopt1`, `vscode-injects1`, `vscode-task1`–`vscode-task3`, `vscode-bp6`, `vscode-bp7`;
- AFFiNE: `affine-callers1`, `affine-breaks1`, `affine-breaks2`, `affine-adopt1`, `affine-injects1`, `affine-task1`–`affine-task3`, `affine-bp5`, `affine-bp6`;
- Theia: `theia-callers1`, `theia-breaks1`, `theia-breaks2`, `theia-injects1`, `theia-task1`, `theia-task2`, `theia-cl1` (direct), `theia-cl2` (transitive), `theia-cn1`, `theia-cycle`, `theia-unused`, `theia-entries`, `theia-bp1`, `theia-bp2`.

Each question entry carries `repo`, `kind`, `family` (the kind for the new kinds, Eval #2's family otherwise), `prompt` and `truth` or `rubric`. Call and task entries also carry `target`, `change` and `source`.

- [ ] **Step 7: The truths, checked by reading (R2)**

Write `eval3/truth-specs.json` for the new questions only: call specs `{ id, repo, kind, type, file, member, within }` and Theia's graph specs in Eval #2's shapes. The copies keep their truths. Then:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npm run eval:truth -- --eval eval3
npx tsx scripts/eval/calls-candidates.ts --eval eval3
```
- **Call truths:**
  - read `.nebulosity/eval3/calls-evidence.md` (each file's deciding lines);
  - read every line of `calls-disagreements.md` in the source;
  - record each decision in `eval3/truth/calls-adjudicated.json`, as `{ id, file, decision: "in" | "out", line, why }`;
  - rebuild until no disagreement is left undecided.
  - The index is consulted only here, after the draw, for candidates.
- **Theia's import truths** are checked as V1.6 checked Eval #2's: `truth-evidence.md`, `truth-disagreements.md`, `computed-sites.md`, and the 30 sampled edges in `truth-sample.md`, with every decision in `eval3/truth/adjudicated.json` (`"repo": "theia"`).
- Set `verified: true` on each new truth once checked. A subagent may do the reading, as in Eval #2; the controller reads a sample itself, and the method says who read what.
- Then `npm run eval:needed -- --eval eval3` writes `eval3/truth/needed.json`. Check that every new file-set question has a needed set, or that the reason it has none is listed (an answer of "none", a chain with no file between its ends).

- [ ] **Step 8: The files, the pilot, the checks**

- `eval3/questions.json` holds the copies and the new questions; `eval3/eval.json`'s `pilot` is R-Y's twelve: `vscode-breaks1`, `vscode-task1`, `vscode-bp6`, `vscode-cn1`, `affine-breaks1`, `affine-task1`, `affine-bp5`, `affine-cn1`, `theia-breaks1`, `theia-task1`, `theia-bp1`, `theia-cn1`; `pilotSessions` is `["vscode-s1", "affine-s1"]` (R-Y).
- `npm run eval:overlap -- --eval eval3` prints nothing.
- `scripts/eval/questions3.test.ts`:
```ts
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { callPrompt } from "./prompts";

// eval3/questions.json is data the runner and the scorer both read; this pins it against D2 of V1.7's plan, by hand.
const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string): any => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));   // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON read field by field
const bytes = (p: string): Buffer => fs.readFileSync(path.join(ROOT, p));
const file = read("eval3/questions.json");
const eval2 = new Map(read("eval2/questions.json").questions.map((q: { id: string }) => [q.id, q]));
const CALL_AND_TASK_KINDS = ["callers", "breaks", "adopt", "injects", "task"];
const LIST_LINE = "End with a line that says ANSWER: and then every such file's path relative to the repository root, one per line, with nothing after the list.";
const TASK_LINE = "End with a line that says ANSWER CHANGE: and then every file to change, one path per line relative to the repository root; then a line that says ANSWER TESTS: and then every test file to run, one per line, with nothing after the list.";

// D2's table: per repo, how many questions of each kind (sessions' questions apart). R-X: a repo whose draw found no adopt
// candidate asks one more callers question; its line changes here with the ledger's record of it.
const MIX: Record<string, Record<string, number>> = {
    vscode: { callers: 2, breaks: 2, adopt: 1, injects: 1, task: 3, "list-direct": 1, "list-transitive": 1, chain: 1, impact: 1, cycle: 1, unused: 1, violations: 1, entries: 1, pairs: 1, bigPicture: 7 },
    affine: { callers: 1, breaks: 2, adopt: 1, injects: 1, task: 3, "list-direct": 1, "list-transitive": 1, chain: 1, impact: 1, cycle: 1, unused: 1, violations: 1, entries: 1, pairs: 1, bigPicture: 6 },
    theia: { callers: 1, breaks: 2, injects: 1, task: 2, "list-direct": 1, "list-transitive": 1, chain: 1, cycle: 1, unused: 1, entries: 1, bigPicture: 2 },
};

describe("eval3/questions.json", () => {
    it("asks D2's mix on each repo", () => {
        for (const [repo, mix] of Object.entries(MIX)){
            const kinds: Record<string, number> = {};
            for (const q of file.questions.filter((x: { repo: string; session?: string }) => x.repo === repo && x.session === undefined)) kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
            expect(kinds, repo).toEqual(mix);
        }
    });

    it("copies Eval #2's questions unchanged, with their truths and rubrics byte for byte", () => {
        for (const q of file.questions.filter((x: { origin?: string }) => x.origin === "eval2")){
            const old = eval2.get(q.id) as Record<string, unknown>;
            expect({ ...q, origin: undefined, truth: undefined, rubric: undefined }, q.id).toEqual({ ...old, truth: undefined, rubric: undefined });
            for (const key of ["truth", "rubric"] as const) if (q[key] !== undefined) expect(bytes(q[key]).equals(bytes(old[key] as string)), q.id).toBe(true);
        }
    });

    it("builds every call and task prompt from its target with D2's templates, and gives it its format line", () => {
        expect([file.formats.callers, file.formats.breaks, file.formats.adopt, file.formats.injects, file.formats.task]).toEqual([LIST_LINE, LIST_LINE, LIST_LINE, LIST_LINE, TASK_LINE]);
        for (const q of file.questions.filter((x: { kind: string }) => CALL_AND_TASK_KINDS.includes(x.kind))){
            expect(q.prompt, q.id).toBe(callPrompt(q.kind, q.target, q.change));
            expect(q.family, q.id).toBe(q.kind);
            if (q.repo === "vscode") expect(q.target.within === "src" || q.target.within.startsWith("src/"), q.id).toBe(true);
            const truth = read(q.truth);
            expect([truth.kind, truth.type, truth.file, truth.member ?? undefined, truth.within ?? undefined], q.id).toEqual([q.kind, q.target.type, q.target.file, q.target.member, q.target.within]);
        }
    });

    it("builds the dev set's call and task prompts the same way, every dev question marked (Task 15)", () => {
        const dev = read("eval3/dev/questions.json");
        for (const q of dev.questions){
            expect(q.dev, q.id).toBe(true);
            if (CALL_AND_TASK_KINDS.includes(q.kind)) expect(q.prompt, q.id).toBe(callPrompt(q.kind, q.target, q.change));
        }
    });

    it("never names the tool, and every new question has a verified truth or a checked rubric", () => {
        for (const q of file.questions){
            expect(q.prompt, q.id).not.toMatch(/nebulosity/i);
            if (q.truth !== undefined) expect(read(q.truth).verified, q.id).toBe(true);
            else for (const p of read(q.rubric).points) expect(p.holds, `${q.id} ${p.id}`).not.toBeNull();
        }
    });
});
```
  Run it: PASS.

- [ ] **Step 9: Write Eval #3's method into `docs/EVAL_RESULTS.md`, and accept ADR-060, before any run**

`docs/EVAL_RESULTS.md` gains a new top section, `# ‹yyyy mm dd› Eval #3 — Claude Code with and without Nebulosity, on VS Code, AFFiNE and Theia`, above Eval #2, which stays whole beneath it. It holds:
- the arms;
- the set-up, pinned at the pilot;
- the command, with the scripts rules and the rules sentence verbatim (and its rewording, if Task 15 made one);
- the isolation, as before;
- the questions: a table per repo with kind, target, source and truth size, and Eval #2's reused ones named;
- how the questions were sourced and drawn: the searches, the filters, the seed, and the candidates' counts;
- how the truths were made and checked: the checker, its program per repo, the adjudication, and who read what;
- scoring, the new kinds included;
- time to relevant context: D2's method verbatim, with Eval #2's references;
- **the ship gate: D1's table verbatim, then "Written before the first run; it does not change after"**;
- the threats to validity:
  - the rules sentence is advisory;
  - condition 1 rests on the multi-step kinds, since one broad grep can "see" a single method's callers;
  - the model may know VS Code from training;
  - Theia is unknown to the tuning, and its truths and AFFiNE's rest on the checker with the truth's own module resolution;
  - the dev set and the eval share kinds, not targets;
  - three repeats is a small sample;
  - the owner set the bars after Eval #2;
- "Results: to come after the runs."

ADR-060's heading changes from proposed to `(accepted ‹today›, before the first run)`, with the questions' counts and sources added under "Decision". The rest of its text stays as the plan wrote it.

- [ ] **Step 10: Gate, commit, push**

Run the gate (about 1,443/1,443: `draw.test.ts` 2 and `questions3.test.ts` 5 new). Then:
```bash
git add -A -- scripts/eval eval3 package.json docs/EVAL_RESULTS.md docs/ENGINEERING_DECISIONS.md && git commit -m "feat(eval): Eval #3's questions, drawn from real issues, PRs and docs with a fixed seed, their truths from TypeScript's checker checked by reading, the rubrics, and the method with the gate fixed before any run (ADR-060)" -- scripts/eval eval3 package.json docs/EVAL_RESULTS.md docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

- [ ] **Step 11: STOP. The owner reviews the questions, the truths and the gate's text**

Show:
- a table of every question per repo: kind, target, source, truth size;
- the draw: per repo and kind, the candidates, the passing ones, the drawn ones, and any replacement;
- every hand decision (calls disagreements, Theia's import disagreements, computed sites, sample findings);
- the rubric points that don't hold;
- the overlap check's empty output;
- the gate exactly as `gate3.ts` computes it;
- `npm run eval:run -- --eval eval3 --pilot --dry-run` and `npm run eval:run -- --eval eval3 --pilot --sessions --dry-run`.

Ask for changes before any run, and record the owner's answer verbatim.

---

## Part 6 — Eval #3

### Task 19: The engine frozen, the version pinned, the pilot. STOP before it, and again before the full count

- [ ] **Step 1: Freeze and pin**

- Check the owner's index is current for all three repos, at the current `ADAPTER_VERSION` (5, or higher after a Task 5 round): VS Code and AFFiNE re-indexed in Task 5, Theia in Task 17. If an engine change after Task 5 changed the adapter or the call facts, re-index first. Ask, since it writes the owner's index once more (R-AC).
- Run `claude --version` and write the version into `eval3/eval.json`'s `claudeVersion`, recording any change since the shell check (Task 15). Run the gate, then commit (`test(eval3): pin Claude Code <version>`).
- Record that commit as `EVAL3_ENGINE` in the ledger and in Eval #3's method section.
- From here until Task 22 is committed, nothing changes in `lib/engine`, `lib/tools`, `lib/index`, `lib/db`, `lib/home.ts`, `lib/config.ts` or `mcp/` (R-N). A bug found is recorded, not fixed, and reported with the results.
- No `npm run index` on the three repos until then either. The runner records each run's index version. If the owner's Map restarts and its worker's warm run bumps a version with no file changed, that's noted and explained.

- [ ] **Step 2: The dry run**

Run: `npm run eval:run -- --eval eval3 --pilot --dry-run` and `npm run eval:run -- --eval eval3 --pilot --sessions --dry-run`
Expected: every command shows:
- the scripts rules (`Bash(node:*)`, `Edit(//c/…/eval-scratch/<16 random hex digits>/**)`, `--add-dir`);
- each repo's `cwd`, Theia's included;
- D2's rules sentence at the end of each prompt, with that run's root and scratch folder;
- no `alwaysLoad` in Nebulosity's config: the tools' own `_meta` carries it.

- [ ] **Step 3: STOP. Ask, with the count**

> The pilot is 28 `claude -p` runs on your subscription: per repo, one breaks question, one task, one new big-picture question and one chain, in both arms (24), plus Eval #2's first task session on VS Code and on AFFiNE, in both arms (4; R-Y). Sonnet 5.5 at medium effort, isolated and checked as before, scripts allowed in a scratch folder, Eval #3's rules sentence on every prompt. Each run records your 5-hour and 7-day usage, and the batch stops past 0.9 and 0.85. OK to start?

- [ ] **Step 4: Run it, on a yes**

`npm run eval:run -- --eval eval3 --pilot`, then `npm run eval:run -- --eval eval3 --pilot --sessions`, each in the background. Expected:
- every init valid, and Nebulosity's six always-loaded tools listed in N's;
- each repo clean after each run;
- no leak.

A run refused by validation stops the pilot: report it verbatim.

- [ ] **Step 5: Score what can be scored, and report**

Run: `npm run eval:score -- --eval eval3 --out "$S/pilot.json"`. Under `--only` the scorer writes no results file, and each run's time to relevant context and refused calls live there; the gate isn't computed on incomplete data. Big-picture runs stay ungraded until Task 21. Report per run:
- the score, turns, cost estimate, wall time and first-call context;
- the time to relevant context (both versions) and the tokens to it;
- the refused commands;
- the Nebulosity and ToolSearch calls;
- whether either arm wrote a script, and what it did;
- the usage windows' change.

**The pilot counts refusals again** (design §5.3): any arm with more than 5% of its pilot runs refused, that is 1 or more of its 14 (12 single and 2 session runs), is reported first. It is read, and named as a risk to condition V, before the full count is asked for.

Then the extrapolation: the mean usage per run, times the 348 single runs and 8 session runs left, in 5-hour windows and in the share of the week.

- [ ] **Step 6: STOP. The owner approves the full count**

The options:
- (a) the full schedule: the remaining 348 single runs and 8 session runs, 3 repeats;
- (b) if the usage is tight, fewer runs, cut in design §5.7's order where it applies to runs: the new big-picture questions first, then the sessions, then Theia's task questions. The cut questions leave the schedule, the gate is otherwise unchanged, and the results say what was cut. A cut question leaves four places in one commit before the full run: `eval3/questions.json` (and `sessions.json`), `questions3.test.ts`'s MIX, Eval #3's method section, and the ledger. The gate's completeness check then expects only what stays.

Record the decision verbatim.

### Task 20: The full run, scored and adjudicated

- [ ] **Step 1: Run the approved schedule, in batches**

`npm run eval:run -- --eval eval3 --limit 60`, one batch at a time, each in the background; then `npm run eval:run -- --eval eval3 --sessions`. The runner resumes by skipping kept runs, and stops on its usage limits.
- After each batch, record its runs, refused commands, usage and notes in the ledger.
- Run the gate, then commit the kept runs: `test(eval3): runs <first>–<last>`.
- If the runner refuses a batch because `claude --version` no longer matches the pin, **STOP**: Claude Code updated mid-run. Report it; the owner decides whether to hold the update off and go on, or to re-pin and say so in the results.
- An outage (an API error, a run killed at 30 minutes, 60 for a session) is re-run, at most 10 in all. A valid run is never re-run for a better answer, and a run with refused commands is a valid run: it counts in V.

- [ ] **Step 2: Score, and adjudicate by reading**

Run: `npm run eval:score -- --eval eval3`. For each unknown chain or cycle step it prints, open the file in its repo and read its imports, then add the verdict to `eval3/truth/steps.json` with the import line. Re-run until it exits 0.

- [ ] **Step 3: Gate, commit, push**

Run the gate. Then:
```bash
git add -A -- eval3/runs eval3/results.json eval3/truth/steps.json && git commit -m "test(eval3): every run kept and scored, chain and cycle steps adjudicated by reading the source" -- eval3/runs eval3/results.json eval3/truth/steps.json && git push origin pivot/v1
```

### Task 21: Grading the big-picture answers. STOP for the owner's rulings

- [ ] **Step 1: Redacted sheets, and two blind graders**

`npm run eval:grading -- --eval eval3 sheets` writes one redacted sheet per big-picture run (90). Check its disclosure lines:
- no sheet may still mention "nebulosity" or "mcp__". If one does, extend the rules (Task 13, with a test), then delete `.nebulosity/eval3/grading-key.json`, `.nebulosity/eval3/redactions.json` and `eval3/grading/sheets/` and make the sheets again, all before any grading (`sheets` keeps every run already in the key);
- record how many sheets name "the index" or "the import graph".

Grade them as Eval #2's were:
- **Grader 1:** a fresh Sonnet subagent per sheet, with Eval #1's instruction verbatim. Each reply goes to `eval3/grading/<id>.json`.
- **Grader 2:** one Opus subagent over all the sheets, never shown grader 1's replies. Its replies go to `eval3/grading/second/`.

- [ ] **Step 2: STOP. The owner rules on each disagreement, with the arms hidden**

Show each point where the graders differ: the rubric point, both scores, both quotes, and a suggested score. Record the owner's words verbatim in `eval3/grading/review.json`.

- [ ] **Step 3: Merge, score, commit**

Run `npm run eval:grading -- --eval eval3 merge`, then `npm run eval:score -- --eval eval3`, then the gate. Then:
```bash
git add -A -- eval3/grading eval3/results.json scripts/eval && git commit -m "test(eval3): big-picture answers graded blind by two models from redacted sheets, the owner ruling on each disagreement" -- eval3/grading eval3/results.json scripts/eval && git push origin pivot/v1
```

### Task 22: The results, the gate's verdict, losses included. STOP for the owner's call

**Files:** `docs/EVAL_RESULTS.md`, `README.md`, `docs/ENGINEERING_DECISIONS.md` (ADR-060, 051, 024 and 043 amended), `docs/BENCHMARKS.md`, `docs/PIVOT_SPEC.md` §2 and §9

- [ ] **Step 1: Write the results**

Under Eval #3's method, recompute every number from `eval3/results.json` and `eval3/runs/index.jsonl`:
- **The gate, first:** D1's table with each condition's numbers from `gate3Verdict`, PASS or FAIL, then the verdict in one sentence. V comes first: if it failed, say plainly that the comparison is confounded.
- **Time to relevant context** per repo: the gated plain rule (the median ratio, its interval, each arm's reached share), the mostly-relevant version, the tokens to context, and from the query start beside it.
- **The headline per repo and kind:** the mean score, recall, precision and F1 where they apply; the median tokens, first-call context, cost estimate, wall time and tool calls.
- **Per question:** every run, with one line on what happened, read from the transcripts. Where N won, where it lost and why; what A's greps and scripts did; whether N used `calls` and paged.
- **The sessions:** cumulative cost, time and score per session and arm.
- **Refusals** per arm and kind, each read and given its cause.
- **The losses**, in their own section, named plainly.
- **Tool use:** the share of N's runs calling a tool, by kind; which tools; ToolSearch calls; the per-turn cost against MCP Dev Set #2.
- **Against Eval #2:** the reused questions side by side, with what changed between the evals (the rules sentence, `calls`, R-Q's trimmed texts, Claude Code's version).
- **Usage:** the windows and the cost estimate.
- **What this says about the claim**, in plain sentences, including every condition that failed and why.
- **Raw data.**

- [ ] **Step 2: The README, the ADRs, the spec**

- **README.** Whatever the outcome, the hold lifts after this verdict (the owner's call of 2026-10-15, design §5.8, ADR-051 as amended by this plan), and the gate decides what the README may claim:
  - pass: the lead says what Eval #3 measured, with its losses in the same paragraph;
  - fail: the README states Eval #3's results as measured, names the failed conditions, and claims nothing beyond the numbers.
  - Eval #1 and Eval #2 stay, as the earlier results.
- **ADR-060**, at its end: `**Amended (‹today›, the runs):** ‹counts, version, usage›; the gate ‹passed | failed: conditions ‹ids››.`
- **ADR-051**, at its end: `**Amended (‹today›, Eval #3): the hold is lifted.** Eval #3 ‹passed its gate | failed conditions ‹ids›› (ADR-060). By the owner's call of 2026-10-15 (V1.7 design §5.8), the hold lifts after Eval #3 whatever its outcome, and the gate decides what the README claims. Deploying, the public switch, the package and the video are the owner's.`
- **ADR-024**, at its end: one sentence on what three evals say about the value proposition.
- **ADR-043**, at its end: the order after V1.7 (below), for the owner to decide.
- **`PIVOT_SPEC.md`:** §2's rows S13 and S14 get their results, and §9 gains a closing line on Eval #3. `BENCHMARKS.md` gets a pointer.

- [ ] **Step 3: Gate, commit, push**

Run the gate. Then:
```bash
git add -A -- docs/EVAL_RESULTS.md README.md docs/ENGINEERING_DECISIONS.md docs/BENCHMARKS.md docs/PIVOT_SPEC.md && git commit -m "docs: Eval #3, Claude Code with and without Nebulosity on VS Code, AFFiNE and Theia: the gate ‹passed|failed›, losses included" -- docs/EVAL_RESULTS.md README.md docs/ENGINEERING_DECISIONS.md docs/BENCHMARKS.md docs/PIVOT_SPEC.md && git push origin pivot/v1
```

- [ ] **Step 4: STOP. The owner's call**

Show the gate table and the losses. Then say what follows:
- **pass:** going public can start, in the owner's hands (Task 23's ship list);
- **fail:** what failed and why, from the transcripts. By the owner's call (design §5.8), the ship list goes ahead anyway, with the results stated as measured. Say plainly which claims the README can't make. Don't soften it.

### Task 23: Close-out. STOP before the PR

- [ ] **Step 1: The record**

- `docs/IMPLEMENTATION_ROADMAP.md`: the V1.7 row marked DONE, pointing at this plan and Eval #3.
- `PIVOT_SPEC.md`: §12's V1.7 row; §15's ADR table gains ADR-059 and ADR-060.
- `CLAUDE.md`'s current state (gitignored, so local only, never staged): V1.7 done, Eval #3's verdict, what's next, and its line on the hold (R-AK).
- Every text this plan wrote as proposed now says what happened:
  - ADR-059's heading (accepted, with Calls Benchmark #1's and MCP Benchmark #5's lines);
  - the amendments to ADR-024, 043, 051, 053, 056 and 057;
  - PIVOT_SPEC's §2 lead-in and S13 and S14 rows, §6.1, §6.2's note, §9, §10 and §12;
  - API_CONTRACTS §17 and the roadmap's row.

  `git grep -n "proposed, V1.7 plan"` then prints nothing.
- Copy anything useful from the session scratchpad into the ledger folder.

Run the gate. Then:
```bash
git add -A -- docs/IMPLEMENTATION_ROADMAP.md docs/PIVOT_SPEC.md docs/ENGINEERING_DECISIONS.md docs/API_CONTRACTS.md && git commit -m "docs: V1.7 closed: the roadmap and spec rows, and every text the plan wrote as proposed now says what happened" -- docs/IMPLEMENTATION_ROADMAP.md docs/PIVOT_SPEC.md docs/ENGINEERING_DECISIONS.md docs/API_CONTRACTS.md && git push origin pivot/v1
```

- [ ] **Step 2: A final review**

A fresh read-only reviewer reads the whole branch from this plan's commit, with the plan, the ledger and the rulings. It checks:
- the plan followed (as amended);
- the layering (`lib/` imports, the eval's independence pin over its twelve files);
- the freeze (`git diff --stat <EVAL3_ENGINE>..HEAD -- lib mcp` touches nothing the server runs);
- privacy in every committed transcript (an independent leak scan);
- Eval #3's gate and headline numbers recomputed from the data, independently of `gate3.ts`;
- the docs against the code.

It writes `final-review.md` in the ledger (dated header, "2026 10 ‹dd› V1.7 Final Review #1"). Fix what it calls SHOULD-FIX in one wave, then have the wave re-reviewed. The wave is gated, committed by path and pushed like any task.

- [ ] **Step 3: STOP before the PR**

Show the review's verdict, the deferred minors and the PR text. The PR is `pivot/v1 → main`. Its body lists V1.7's tasks, the gate's result and the deferred minors, with no attribution line. Open it only on the owner's yes, then bind it with the ccd_pr tools.

The owner's ship list (design §5.8), after the verdict, whatever it is:
1. `4538032`'s cut-off machine path in one kept transcript: rewrite that one file in history, or accept it.
2. The demo: re-export and rebuild it with V1.7's data in the sandbox worktree, dropping `describe`'s unused `docs` field from the demo bundles (V1.6 final review A-167). The leak scan must pass.
3. Deploy the demo.
4. Turn on GitHub's email privacy settings, then make the repo public.
5. Set `"private": false` and run `npm publish` from a clean checkout of the merged commit.
6. Record the video, with `docs/DEMO_VIDEO.md` updated to Eval #3's numbers first.
7. Add the demo, video and npm links to the README.

---

## After V1.7: what comes next

- **The order after V1.7 is the owner's call at Task 22** (ADR-043, as amended by this plan). The default stays ADR-043's: **E4 (Python first) → E5 → E1**, with E3 an optional panel add-on.
  - E4 decides who can use Nebulosity at all.
  - E5 brings clustering and the focus view, and is where a Map view of calls would go (R-C).
  - E1, the Guide, serves the owner's learning goal.
- **E2 is built here** as declared types, not the type checker (ADR-059). What it leaves for later:
  - calls through inferred types (the note every answer carries);
  - JavaScript without declared types;
  - index-time resolution, if MCP Benchmark #5 or real repos call for R-B's fallback;
  - a Map view.
- **S6** gets its first cut here (Task 7). ADR-053's manifest cache for the full run stays recommended if Update Benchmark #3 is still thin.
- **Going public** follows Task 22's verdict, in the owner's hands (design §5.8 and Task 23's list).

## Self-review (done while writing; the executor can skip this)

**Spec coverage, design section by section:**
- **§5.1, the engine:**
  - the facts: Task 1;
  - migration 0009 and the store: Task 2;
  - query-time resolution, the queries, the cache: Task 3;
  - the `calls` tool, its wiring and the budget: Task 4;
  - the measured targets: Tasks 5 and 6, with R-B's fallback in Task 6;
  - the fixture: Task 1, with its ground truth above.
- **§5.2, S6:** Task 7.
- **§5.3, the harness:**
  - the definition and the gate selector: Tasks 8 and 12;
  - the shell set-up and the rules sentence: Task 8;
  - the checks before the first run: Tasks 14, 15 and 19;
  - refusals in the index line: Task 8, and in the results: Task 12;
  - time to relevant context: Task 9, in the results: Task 12;
  - the call truth and its adjudication: Task 10;
  - the new kinds and their scores: Task 11;
  - grading and redaction: Tasks 13 and 21;
  - the minors: B-8 (Tasks 9, 10, 15, 18), B-9 and B-12 (Task 12).
- **§5.4, the questions and their shape:** Task 18 (sourcing, filters, seeded draw, the writing subagent, Theia's graph questions, the new big-picture questions); Task 15 (the dev set); Task 17 (Theia).
- **§5.5, the gate:** D1, computed by Task 12's `gate3.ts`, and written into the method by Task 18 before any run.
- **§5.6, runs, stops and spending:**
  - every ask: Tasks 14, 15, 16, 17, 19;
  - every stop: the Global Constraints' list, each in its task.
- **§5.7, the timeline and cut order:** "The order of the work", and Task 19's option (b).
- **§5.8, the ship list:** Tasks 22 and 23; ADR-051's proposed amendment (R-AK).
- **§6, the design's rulings:** R-A → R-N, each carried, and placed in its task.
- **§7, the details to pin:**
  - the `calls` tool: D3 and Task 4, and API_CONTRACTS §17;
  - migration 0009 and the store: Task 2;
  - the fact types in schema.ts: Task 1;
  - the fixture and its ground truth;
  - the task format, the ANSWER blocks and the tests rule: D2, Tasks 11 and 15;
  - the call rule sentences and the shell sentence: D2 and Task 15's `prompts.ts`;
  - `eval3/`'s layout: the file map and Tasks 8, 15 and 18;
  - the gate selector and `gate3.ts`: Tasks 8 and 12, with Eval #2's output checked byte for byte;
  - the adjudication file: Task 10;
  - the budget's numbers: R-Q, measured;
  - the test counts: from 1,340, each task's.
- **§8, the docs:** this plan's own commit; the benchmarks in Tasks 5, 6, 7, 16 and 17; Eval #3 in Tasks 18 and 22.

**Placeholders.** Each `‹…›` is a measured value, the commit's date, or an outcome written at the time (Global Constraints). Theia's commit comes from Task 17; the questions' targets come from Task 18's draw, by rules fixed here.

**Names used across tasks**, checked against their definitions:
- `CallFacts`, `TypeDeclFact`, `BindingFact`, `TypedCallFact`, `CallRule`, `collectCallFacts`, `emptyCallFacts`, `ParsedFile.calls`;
- `replaceCallFacts`, `loadTypeDecls`, `loadCallBindings`, `loadCallsOf`, `loadInjectionSites`, `FileRecord.calls`;
- `buildCallIndex`, `hierarchyOf`, `callIndexFor`, `calls`, `CallsAnswer`, `CallerFile.sites`, `callsAnswer`;
- `applyFileChanges(…, { workspace })`, `FileChangeResult.workspace`;
- `EvalDefinition.sentence`, `.gate`, `repos[id].project`, `rulesSentence`, `promptFor(…, rules)`, `refusedCalls`;
- `relevantContext`, `pathTokens`, `cdTarget`, `Needed`, `ContextResult`, `median`, `ratioOfMedians`, `ratioOfPlainMedians`, `mulberry32`, `quantile`, `bootstrapMedianInterval`, `chainDag`, `cycleDag`, `neededFor`;
- `programFor`, `callTruth`, `CallTruthFile`, `TaskTruthFile`, `buildTruth(g, spec, calls?)`, `taskTests`;
- `taskSections`, `PartScore`, `CALL_KINDS`;
- `gate3Verdict`, `Gate3Run`, `Gate3Session`, `QuestionSet`, `FILE_SET_KINDS`, `DI_AND_TASK`, `withEval3Fields`, `toGate3Run`, `toGate3Session`, `ttrcRows`, `inRepeats`;
- `redact`, `sheetAnswer`, `callRule`, `callPrompt`, `TESTS_RULE`, `draw`.

**Review Focus:** each of the five lines has its test in the task named: 3, 1 (and 3), 4, 9 and 8.

**What's honest about the gate:**
- It was fixed before any run, by the owner, after Eval #2's failure, and condition 1 asks the new kinds to beat Eval #2's 3–3.5×.
- V voids a comparison that refusals skew, instead of letting them quietly favour N.
- Eval #2's questions stay in as no-loss checks, so the gate can't be passed on the new kinds alone.
- Theia is held out from all tuning.
- The results will say all of this, and the losses go beside the wins.
