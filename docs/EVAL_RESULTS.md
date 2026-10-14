# 2026 10 14 Eval #1 — Claude Code with and without Nebulosity on VS Code

**Status: the method is fixed and the ground truth is hand-verified. No run has happened yet.** The results section is empty until the runs are done. Two calls on the questions wait for the owner (see "Open questions for the owner").

This is the evaluation `PIVOT_SPEC.md` §9 asks for. It asks one thing: does Claude Code answer questions about a big repo better with Nebulosity's MCP server than without it? "Better" means more correct, and at what cost in tokens, tool calls and time. Losses are reported beside wins. The reasons behind each choice are in ADR-050. The plan is `docs/plans/2026-10-13-v1-5-ship.md` (D2, D3 and D4).

Where things are:
- Questions, formats: `eval/questions.json`. Ground truth: `eval/truth/<id>.json`. Rubrics: `eval/rubric/<id>.json`.
- The truth builder, the scanner it uses, the runner and the scorer: `scripts/eval/`.
- Kept transcripts (scrubbed, scanned, gzipped): `eval/runs/`. Raw ones stay in `.nebulosity/eval/raw/`, which git ignores.

## The two arms

- **A, baseline:** Claude Code with its read-only built-in tools and its subagents.
- **B, Nebulosity:** the same, plus Nebulosity's MCP server (seven tools: overview, describe, search, dependents, dependencies, path, show_on_map), started with the command the README registers (`node <checkout>/mcp/launch.mjs`), with live events off. It answers about the index of `../vscode`.

The arms differ only in the MCP config file. Prompts are identical and never mention Nebulosity.

## Setup

| What | Value |
|---|---|
| Claude Code | 2.1.296, run as `claude -p --output-format stream-json --verbose`. The runner refuses to start if `claude --version` says anything else. |
| Model | `claude-sonnet-5-5` (the full id; the `sonnet` alias has moved between versions) |
| Effort | `medium`, Claude Code's own default for Sonnet 5.5 |
| Repo | VS Code at `cc3fec8846d0e678357e476fa611774da26d7e24`, a shallow clone at `../vscode`. The runner stops if its HEAD is anything else. |
| Nebulosity's engine | `8d7d4856e0dae81c2a75119a1933bd0031265d6a` (`EVAL_ENGINE`). The server's code (`lib/engine`, `lib/tools`, `lib/index`, `lib/db`, `mcp/`) is frozen at that commit until the eval is done. The static demo's tasks add code in the same folders (a query for its exporter, a browser search) that the server doesn't import. A diff against `EVAL_ENGINE` and a check of who imports what are made before the pilot. |
| Nebulosity's index | The owner's database for `../vscode`, with the V1.2 summaries (Summary Benchmark #1 in `docs/BENCHMARKS.md`). The one repo-level summary refresh that the test-folder fix needs (plan Task 2) is made before the pilot, and the index version is recorded when the pilot starts. |
| Working folder | `../vscode`. Claude Code tells the MCP server which project it is in, so B answers about that repo. |

### The command

The prompt goes on stdin. Everything else is the same in both arms, except the file after `--mcp-config`.

```
claude -p --output-format stream-json --verbose
  --model claude-sonnet-5-5 --effort medium
  --max-turns 80 --max-budget-usd 4
  --setting-sources project,local
  --strict-mcp-config --mcp-config <A: eval/mcp/empty.json, B: .nebulosity/eval/mcp-nebulosity.json>
  --permission-mode dontAsk --permission-prompts none
  --allowedTools Read,Grep,Glob,Agent,Bash(git grep:*),Bash(git ls-files:*),Bash(git log:*),Bash(git show:*),
                 Bash(rg:*),Bash(grep:*),Bash(ls:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*),
                 Bash(sort:*),Bash(uniq:*),Bash(find:*),mcp__nebulosity
  --disallowedTools Edit,Write,NotebookEdit,WebFetch,WebSearch,Skill,PowerShell,Monitor
  --no-session-persistence
```

(The runner joins each tool list with commas, on one line.) B's config file is written by the runner:

```json
{ "mcpServers": { "nebulosity": { "command": "node", "args": ["<checkout>/mcp/launch.mjs"], "env": { "NEBULOSITY_LIVE": "off" } } } }
```

`eval/mcp/empty.json` is `{ "mcpServers": {} }`.

### What is on, what is off, and why

- **On in both arms:** Read, Grep, Glob, the Agent tool, and Bash for read-only commands. D3 named `git grep`, `git ls-files`, `rg`, `ls`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq` and `find`; the runner also allows `git log`, `git show` and `grep`. The Agent tool brings Explore and the other built-in subagents, which are how Claude Code explores a big repo by default. Explore runs on Haiku; the runner expects `claude-haiku-5-5` there and notes any other model that answers. `mcp__nebulosity` is allowed everywhere, but the tools exist only where the server runs.
- **Off in both:** Edit, Write and NotebookEdit (nothing may change `../vscode`); WebFetch and WebSearch (the web holds the very wiki page the rubric comes from); Skill; PowerShell (`CLAUDE_CODE_USE_POWERSHELL_TOOL=0`, so both arms use the same Bash shell); Monitor.
- **Permissions:** `dontAsk` refuses anything outside the allowed set, and `--permission-prompts none` tells the model not to retry. Whether Claude Code 2.1.296 reads a rule like `Bash(git grep:*)` as intended shows in the pilot's `permission_denials`.
- **Tool search:** the full run uses Claude Code's default, under which every MCP tool is deferred and loaded on demand through ToolSearch. That is what a user who follows the README gets. The pilot adds three B runs with `ENABLE_TOOL_SEARCH=false` (tools loaded up front, named `nebulosity-upfront`) to measure what deferral costs. If deferral clearly hurts, the fix is a product change (V1.6: `alwaysLoad` in the README's registration), reported as such, not a different eval setting. Each transcript records its ToolSearch calls.
- **Limits per run:** 80 turns and $4 (Claude Code's own estimate), and a 30-minute wall-clock limit. A run that hits the turn or budget limit scores 0 and is reported. A run killed at 30 minutes is an outage (below).

### Isolation from the owner's own Claude Code setup

The runs use the owner's subscription, not an API key. Nothing of the owner's setup may leak into a run.
- `--setting-sources project,local` drops the owner's user settings: plugins and their hooks, a different default model and effort, synced skills.
- `--strict-mcp-config` takes MCP servers from `--mcp-config` alone. That ignores `../vscode/.mcp.json` (two VS Code tooling servers), the owner's own registration of Nebulosity (live events on) and claude.ai connectors.
- VS Code's `AGENTS.md` stays, as it would for any user in that repo.
- Variables set in every child:

| Variable | Value | Why |
|---|---|---|
| `CLAUDE_CODE_GIT_BASH_PATH` | the Git Bash that runs | both arms use one shell, and children find it |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | `0` | no PowerShell tool |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | `1` | no memory shared between runs |
| `ENABLE_CLAUDEAI_MCP_SERVERS` | `false` | no connectors |
| `DISABLE_AUTOUPDATER` | `1` | the version can't change mid-eval |
| `NEBULOSITY_LIVE` | `off` | no live events to the owner's Map |
| `ENABLE_TOOL_SEARCH` | `false`, only in the pilot's three up-front runs | tools loaded up front |

- Variables removed from every child: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` (a key in `-p` always wins over the subscription and would bill the API), `CLAUDE_CODE_EFFORT_LEVEL` (it overrides `--effort`), the Bedrock, Vertex and Foundry switches, `ENABLE_TOOL_SEARCH`, `CLAUDE_CONFIG_DIR`, and **every name that starts with `CLAUDE`, `ANTHROPIC_` or `MCP_`**, in any case. The last rule is for a runner started inside a Claude Code session, whose own variables would otherwise reach every child. The pins above are set after the removal. The runner prints the removed names (never their values) and stops if one would still reach a child.
- If dropping the user settings ever fails to keep the owner's plugins out, the fallback is a dedicated `CLAUDE_CONFIG_DIR` that the owner logs into once (`--config-dir`).

### Checked on every run, not assumed

- **The init message**, judged the moment it appears. A run that differs is killed with its whole process tree, so a wrong setup costs seconds and not up to $4. It must show: the pinned model; permission mode `dontAsk`; no API key in use; no MCP server in A and `nebulosity` connected in B; none of the owner's plugins; Bash, Read, Grep and Glob present; WebFetch, WebSearch, Skill, PowerShell, Edit and Write absent.
- **The finished run:** the init again; the models that answered (anything but Sonnet 5.5 and Haiku is noted); `git status` in `../vscode` (a change stops the batch, and nothing is restored automatically); the scrubbed transcript and its index line scanned for the machine's paths and the owner's email, with Claude Code's project name for the folder scrubbed too.
- **An outage is not an answer:** an API error such as a rate limit (including one Claude Code reports as a success), a transcript with no result, or a run killed at 30 minutes. It is not scored, its raw transcript stays, and it is run again later. These re-runs are the "at most 6" below.
- **Usage:** each run reports the 5-hour and 7-day windows in its `rate_limit_event`. The runner stops cleanly when the 7-day window reaches 0.85 or the 5-hour window reaches 0.9, and stops if two runs in a row report neither.
- **Order:** which arm goes first alternates by question and by repeat. It comes from the question's place in the full list of fifteen, so the pilot gives each question the order the full run will (BP4 with B first, CL2 and CN3 with A first).

## The runs planned

- **The pilot, 9 runs:** BP4, CL2 and CN3 in both arms (6), plus those three in B with tool search off (3). They also prove the isolation checks on real transcripts. Then each run's usage and the extrapolation are reported, and **the owner approves the full count.**
- **The full run, 54 more:** the other 12 questions in both arms (24), then a second run of all 15 in both arms (30). The pilot's 6 two-arm runs count as first runs.
- **Total:** 63 runs, plus at most 6 re-runs, only for infrastructure failures, never for a bad answer.
- **If 63 won't fit** in the owner's usage: one run per question (30), plus the pilot's 3 tool-search runs.
- **Expected usage:** Claude Code's estimate for V1.4's smoke run (8 turns, no exploring) was $0.05. An exploring run on VS Code should land between $0.30 and $1.50 at list prices, so roughly $20–90 for the 63. On a subscription that is a share of the 5-hour and 7-day windows, not a bill, and the pilot measures the share. About 20 runs fit in a sitting.

## The questions

Prompts are identical in both arms. Each ends with a fixed answer format:
- lists: `End with a line that says ANSWER: and then every such file's path relative to the repository root, one per line, with nothing after the list.`
- chains: `End with a line that says ANSWER: and then either the word none, or the chain as file paths relative to the repository root, one per line, from the first file to the last, where each file imports the next.`
- big-picture: `Answer in at most 400 words.`

Every list prompt also says what "imports" means: `Count a file if any of its import, export … from, side-effect import, import() or require() statements refers to it; type-only imports and test files count.` (The table leaves that sentence out of each list prompt.)

### Big-picture (5), scored by a rubric from VS Code's wiki page "Source Code Organization" (edited 2025-10-11)

| Id | Question | Rubric points that hold |
|---|---|---|
| BP1 | What are the main layers of VS Code's core code under `src/vs`, what is each one for, and which layers may depend on which? | 8 of 8 |
| BP2 | Inside each layer of `src/vs`, code is split into folders by the environment it runs in. What are those environments, and what may code in each one import? | 6 of 6 |
| BP3 | How does VS Code define a service, make an implementation available, and get it into the classes that use it? Name the functions and conventions involved. | 5 of 6 (BP3.1 dropped; open question 2) |
| BP4 | How is `src/vs/workbench` organized, and what rules govern the feature code in `src/vs/workbench/contrib`? | 8 of 8 |
| BP5 | How do the desktop and web builds of the workbench share code, and what decides whether a feature's code gets loaded at all? | 6 of 6 |

### Complete-list (5), scored by recall (precision reported too)

| Id | Question | Truth |
|---|---|---|
| CL1 | List every file that directly imports `src/vs/workbench/contrib/search/common/search.ts`. | 22 files |
| CL2 | List every file outside `src/vs/workbench/contrib/debug` that directly imports a file inside it. | 38 files |
| CL3 | List every file outside `src/vs/editor/standalone` that directly imports a file inside it. | 3 files |
| CL4 | List every file that depends on `src/vs/workbench/contrib/markers/common/markers.ts`, directly or through other files. | 63 files, 10 of them direct (open question 1) |
| CL5 | List every file outside `src/vs/platform/undoRedo` that directly imports a file inside it. | 55 files |

### Connection (5), scored per answer

| Id | Question | Truth |
|---|---|---|
| CN1 | How does `src/vs/workbench/workbench.desktop.main.ts` end up loading `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts`? Give the shortest chain of imports. | 4 steps |
| CN2 | Give the shortest chain of imports from `src/vs/workbench/workbench.web.main.ts` to `src/vs/workbench/contrib/debug/browser/debugSession.ts`. | 5 steps |
| CN3 | Does `src/vs/workbench/api/common/extHost.api.impl.ts` depend on `src/vs/editor/common/model/textModel.ts`, directly or through other files? If it does, give the shortest chain of imports. | 4 steps, through notebook code |
| CN4 | Does `src/vs/base/common/strings.ts` depend on any file in `src/vs/workbench`, directly or through other files? If it does, give the chain. | none |
| CN5 | Give the shortest chain of imports from `src/vs/workbench/contrib/scm/browser/scmViewPane.ts` to `src/vs/platform/undoRedo/common/undoRedo.ts`. | 3 steps |

A "step" is one import, so a chain of 4 steps names 5 files.

## How the ground truth was made and checked

The truth never comes from Nebulosity's index, or the eval would be circular.

- **An independent scanner.** `scripts/eval/scan.ts` reads import specifiers with a regex and resolves relative paths itself. It imports nothing from `lib/`, and a test pins that. On VS Code it reads 14,849 code files and 139,020 import edges in about 3 seconds. The truth builder (`npm run eval:truth -- ../vscode`) computes each list with the scanner's edges, and each chain by breadth-first search. It also writes an evidence sheet that lists the import line behind every edge.
- **Every edge read by hand.** The evidence sheet holds 238 edges (each list entry, each step of each example chain). Each was printed with the lines around it and read in the source. All 238 are top-level import declarations: 197 `import … from`, 40 side-effect imports and 1 `import type`. None sits in a comment, a string or a template literal. The TypeScript parser was used as a reading aid, to say what starts on each line.
- **Misses looked for two ways.** First `git grep` for each target's path, each folder's environment subfolders and CL1's namesake. Then a wider sweep: every quoted string in every tracked code file, comments and template literals included, which also catches an `import` split across lines and a `vs/…` module id. Each hit that was not already an entry was read.
- **Nebulosity's index consulted only for candidates.** Read-only, through `reach` and `importChain`. It agrees with the hand-checked truth on all 181 list entries, on all 63 distances in CL4 and on all five chains. That is 0 bugs found in the index.
- **Chains.** Every step of every example chain was read. A widened graph (the scanner's edges plus 1,618 edges that exist only as quoted strings) gives the same shortest lengths, so no missed written-out specifier can make a chain shorter. For CN4, `strings.ts` reaches 68 files: 67 in `src/vs/base/common`, plus `src/vs/nls.ts`, which imports nothing. Every one's imports were read, and none is in `src/vs/workbench`.
- **The result:** 0 false hits dropped, 0 misses added, 0 chains changed. The sizes are exactly the planning scan's. `eval/truth/adjudicated.json` is empty. 30 candidates were read and ruled out; each is recorded in its truth's `notes`:
  - paths that only look alike (CL1: five files under `src/vs/workbench/services` import a namesake `search/common/search.ts`; CL3: `editor/common/standalone` is not `editor/standalone`);
  - Copilot test fixtures (old VS Code source kept as text; `extensions/copilot/tsconfig.json` excludes their folders);
  - build entry-point lists and a file glob, lint scopes in `eslint.config.js`, and one 1.4 MB string of recorded data.
- **Rubric points.** Each of the 34 was checked against `cc3fec88`: the files and folders exist, the functions have the stated signatures, the entry files import each other. 33 hold. BP3.1 does not (open question 2). Five points in BP4 (BP4.3, BP4.5, BP4.6, BP4.7, BP4.8) are documented rules the code breaks. For example, nothing outside `contrib` should depend on it, yet `src/vs/sessions` has 391 files that import `contrib`, `workbench/api` 113 and `workbench/test` 67; 36 of 101 contributions have more than one `.contribution.ts`. They stay in the rubric as "states the rule", and each point's `note` says how the code breaks it.

## Scoring

Lists and chains are scored by `npm run eval:score`. Big-picture answers are graded (Task 19).

**Reading an answer.** The scorer takes the text after the last line that starts with `ANSWER:`. Markdown around the label (`**ANSWER**:`, backticks) is ignored. It reads the repo's files out of that text, tolerating bullets, numbering, backticks, bold or italic marks, table cells, a trailing `:line` or `#Lline`, and absolute paths inside the repo. Paths match without regard to case (the eval runs on Windows). A path-like name that isn't a file of the repo is not a hit, and is listed beside the score.

**Lists.** Recall is the share of the truth's files that the answer lists. That is the score. Precision (the share of the listed files that are in the truth) is reported beside it. A run with no `ANSWER:` line is flagged.

**Connections.** 1 for a valid chain of the shortest length or a correct "none"; 0.5 for a valid chain that is longer; 0 for an invalid chain or a wrong verdict. A chain is valid when it starts at the first file, ends at the last (or at a file inside the last folder), and every step is a real import.
- A step is real if an adjudicated verdict says so (`eval/truth/adjudicated.json`, written after reading the source), else if the scanner has the edge. **An adjudicated verdict overrides the scanner, either way:** reading the source beats a regex.
- A step that neither knows is unknown. The chain's score waits, the scorer exits 1 and prints each `a → b` to adjudicate, and the step is read in the source and recorded.
- The scorer also lists the steps of valid chains that only the scanner vouches for and the truth's own chain lacks, so they are read too.
- A right "none" scores 1 even if the prose around it names files, because no chain exists. A "none" that names files is flagged for the owner. A chain shorter than the truth's is flagged: it means the truth is wrong.

**Big-picture (R4).** A blind grader per answer: a fresh subagent given only the rubric and the answer (no arm, no run id) marks each point 1, 0.5 or 0 and quotes the sentence that earns it. The owner reviews every grade before anything is published. A point the answer gets wrong scores 0. The answer's score is the mean over the points that hold. For BP4's rule points, an answer that states the rule earns the point, even if it adds that the code breaks it.

**What is reported per run:**
- the score;
- tokens, summed over every model the run used, subagents included, with uncached input, cache writes, cache reads and output apart (the main conversation's tokens are shown apart too, because the baseline explores through subagents);
- Claude Code's cost estimate (`total_cost_usd`, at list prices, not the owner's bill);
- turns; tool calls by tool, top-level and inside subagents apart; wall time;
- the 5-hour and 7-day utilization from the run's `rate_limit_event`;
- the flags above, and any note on how it ended.

**The tables** show each question and arm with both repeats, and each family and arm with the mean score (recall and precision for lists) and the median tokens, cost estimate, wall time and tool calls.

## Threats to validity

- **VS Code ships its own overview for agents.** `AGENTS.md` points to `.github/copilot-instructions.md`, a 158-line architecture overview, and both arms can read it. It may help A as much as B.
- **The wiki page is public.** The rubric comes from it, and the model may know it from training. Both arms share that, and it narrows any gap on the big-picture family.
- **Nebulosity's summaries were written by Claude models** (Haiku for files, Sonnet for folders and the repo), the same family that answers in both arms.
- **The rubric is graded by a model**, with the owner's review of every grade, against one wiki page.
- **Two runs per question is a small sample.** Repeats of one arm differ. The tables show every run, and the results make no claim a sample this small can't carry.
- **No shared prompt cache between arms** (their tool lists differ), so a pair's first arm may meet a colder cache or an earlier hour. The arms alternate for that reason.
- **The search tuning set includes words BP3 asks for.** Search Benchmark #2 (32 queries set by hand, `docs/BENCHMARKS.md`) includes `registerSingleton` and `createDecorator`. BP3's rubric asks answers to name those. None of the 32 names a file or folder that a list or chain question scores.
- **The runner has never run Claude Code yet.** Its tests use hand-built transcripts, and its reading of a transcript was checked against the one real smoke-run transcript from V1.4. The isolation checks are proven on real transcripts by the pilot, and a failed check stops the batch.
- **BP4's rule points measure repeating the wiki, not following the code.** BP4.3 and BP4.5–BP4.8 are documented rules the code breaks, and they count as "states the rule".
- **The truth and the index could share a blind spot.** The scanner and the index both read written-out specifiers. The two other nets (the parse of every evidence line, and the quoted-string sweep) found nothing, but files loaded by a computed specifier (open question 1), by a worker's URL or by a forked process's entry path are outside the definition on purpose.
- **Models may list files that aren't in the truth**, such as the Copilot test fixtures (CL2, CL5) or `build/vite/workbench-electron.ts` (CL4). Lists score by recall, so that costs precision only.
- **Deferred tools may weaken B.** Under Claude Code's default, B's tools load on demand. The pilot's up-front runs measure what that costs.

## Open questions for the owner

Neither is decided. Both should be settled before the first run, since each changes what a question scores.

1. **CL4: do the two computed loaders count (63 or 66 files)?** `src/vs/code/electron-browser/workbench/workbench.ts` (lines 510–517) and `src/vs/sessions/electron-browser/sessions.ts` (lines 123–130) load the desktop and sessions main files with `await import(workbenchUrl)`. The address is built at run time, so no written-out specifier names a file. The truth leaves them out, as the scanner, Nebulosity's index and VS Code's own import lint (which checks written-out specifiers only) all do. Counting them would also add `build/vite/workbench-electron.ts`, which imports the first one, and make CL4 66 files. The cost of each answer: with 63, a model that lists the three loses precision only; with 66, a model that misses them loses recall. The decision is recorded in `eval/truth/cl4.json`.
2. **BP3.1: dropped, or held under a narrower reading?** The wiki says most services are defined in `platform`. At `cc3fec88` the non-test code under `src/vs` has 699 service identifiers: `platform` defines 256 (36.6%), the workbench 364 (52.1%). On the plain reading of "most" the point doesn't hold, so it is dropped and BP3 is scored over 5 points. Read as "most of the services that aren't a contribution's own", `platform` has 256 of 480 (53%) and the point holds, and BP3 is scored over 6. The point's `holds` field in `eval/rubric/bp3.json` is the switch.

## Results

To come after the runs (Task 20).
