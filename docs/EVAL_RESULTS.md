# 2026 10 14 Eval #1 — Claude Code with and without Nebulosity on VS Code

**Status: the method is drafted and checked, and the owner has made the three calls on the questions (2026-10-14). No run has happened yet.** Claude models read the ground truth in the source and re-checked it; the owner settled the three calls but did not read every entry (see "How the ground truth was made and checked" and "The owner's decisions"). The results section is empty until the runs are done.

This is the evaluation `PIVOT_SPEC.md` §9 asks for. It asks one thing: does Claude Code answer questions about a big repo better with Nebulosity's MCP server than without it? "Better" means more correct, and at what cost in tokens, tool calls and time. Losses are reported beside wins. The reasons behind each choice are in ADR-050. The plan is `docs/plans/2026-10-13-v1-5-ship.md` (D2, D3 and D4).

Where things are:
- Questions, formats: `eval/questions.json`. Ground truth: `eval/truth/<id>.json`. Rubrics: `eval/rubric/<id>.json`.
- The truth builder, the scanner it uses, the runner and the scorer: `scripts/eval/`.
- Kept transcripts (scrubbed, leak-scanned, gzipped): `eval/runs/`, with one summary line per run in `eval/runs/index.jsonl`. Raw ones stay in `.nebulosity/eval/raw/`, which git ignores.

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

- **On in both arms:** Read, Grep, Glob, the Agent tool, and Bash for read-only commands. D3 named `git grep`, `git ls-files`, `rg`, `ls`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq` and `find`; the runner also allows `git log`, `git show` and `grep`. The Agent tool brings Explore and the other built-in subagents, which are how Claude Code explores a big repo by default. The runner expects `claude-haiku-5-5` for Claude Code's Explore subagent and notes any other model that answers; the pilot shows which models answer. `mcp__nebulosity` is allowed everywhere, but the tools exist only where the server runs.
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

- **The pilot, 9 runs:** BP4, CL2 and CN3 in both arms (6), plus those three in B with tool search off (3). They are also the first test of the isolation checks on real transcripts. Then each run's usage and the extrapolation are reported, and **the owner approves the full count.**
- **The full run, 54 more:** the other 12 questions in both arms (24), then a second run of all 15 in both arms (30). The pilot's 6 two-arm runs count as first runs.
- **Total:** 63 runs, plus at most 6 re-runs, only for infrastructure failures, never for a bad answer.
- **If 63 won't fit** in the owner's usage: one run per question (30), plus the pilot's 3 tool-search runs.
- **Expected usage:** Claude Code's estimate for V1.4's smoke run (8 turns, no exploring) was $0.05. An exploring run on VS Code should land between $0.30 and $1.50 at list prices, so roughly $20–90 for the 63. On a subscription that is a share of the 5-hour and 7-day windows, not a bill, and the pilot measures the share. D4 estimated about 20 runs per sitting.

## The questions

Prompts are identical in both arms. Each ends with a fixed answer format:
- lists: `End with a line that says ANSWER: and then every such file's path relative to the repository root, one per line, with nothing after the list.`
- chains: `End with a line that says ANSWER: and then either the word none, or the chain as file paths relative to the repository root, one per line, from the first file to the last, where each file imports the next.`
- big-picture: `Answer in at most 400 words.`

Every list prompt also says what "imports" means: `Count a file if any of its import, export … from, side-effect import, import() or require() statements refers to it; type-only imports and test files count.` (The table leaves that sentence out of each list prompt.)

**"Refers to" is the rule** (the owner's decision 3). A file counts for a list when one of its own import, `export … from`, side-effect import, `import()` or `require()` statements refers to the target in any of three ways:
- (a) its specifier resolves to the target (relative paths, `.d.ts` files, index files);
- (b) its specifier is a non-relative module id that names the target, such as `vs/workbench/contrib/debug/common/debug` read against `src/` (the Copilot test fixtures' old `vs/…` ids), whether or not any module resolution would turn it into a file;
- (c) it is a computed `import()` whose loaded address is, by reading the code around it, the target file.

Not counted: text that is not one of the file's own statements (an import line inside a string or template literal, such as the page that `scripts/code-sessions-web.js` generates; a build entry-point list; a lint scope; a comment), a path that only looks alike (a namesake folder or file), and a relative specifier that resolves to nothing. For CL4 the rule applies to every edge of the closure: a file that refers, in way (a), (b) or (c), to a file already in the closure joins it.

### Big-picture (5), scored by a rubric from VS Code's wiki page "Source Code Organization" (edited 2025-10-11)

| Id | Question | Rubric points that hold |
|---|---|---|
| BP1 | What are the main layers of VS Code's core code under `src/vs`, what is each one for, and which layers may depend on which? | 8 of 8 |
| BP2 | Inside each layer of `src/vs`, code is split into folders by the environment it runs in. What are those environments, and what may code in each one import? | 6 of 6 |
| BP3 | How does VS Code define a service, make an implementation available, and get it into the classes that use it? Name the functions and conventions involved. | 5 of 6 (BP3.1 dropped by the owner) |
| BP4 | How is `src/vs/workbench` organized, and what rules govern the feature code in `src/vs/workbench/contrib`? | 8 of 8 |
| BP5 | How do the desktop and web builds of the workbench share code, and what decides whether a feature's code gets loaded at all? | 6 of 6 |

### Complete-list (5), scored by recall (precision reported too)

| Id | Question | Truth |
|---|---|---|
| CL1 | List every file that directly imports `src/vs/workbench/contrib/search/common/search.ts`. | 22 files |
| CL2 | List every file outside `src/vs/workbench/contrib/debug` that directly imports a file inside it. | 41 files |
| CL3 | List every file outside `src/vs/editor/standalone` that directly imports a file inside it. | 3 files |
| CL4 | List every file that depends on `src/vs/workbench/contrib/markers/common/markers.ts`, directly or through other files. | 66 files, 10 of them direct |
| CL5 | List every file outside `src/vs/platform/undoRedo` that directly imports a file inside it. | 57 files |

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

**Who checked it.** Claude models did. The owner settled three calls (see "The owner's decisions") but did not read every entry.
- A Claude model (Opus, a subagent of the session that built the eval) read all 238 evidence lines, and every rubric point, in the source at `cc3fec88`.
- The session spot-checked a sample: three of CL1's entries, CN5's chain and one of CL4's computed loaders.
- A second model (Sonnet) then re-checked about 50 list entries, every chain step and every rubric point. It also built an independent graph from TypeScript's own tokenizer (14,847 files, 139,664 edges), which gave the same file sets for CL1–CL5 and the same chain lengths.
- Where this section says something was read, a model read it. No person has read every entry. The owner made the three calls that the models' reading left open.

- **An independent scanner.** `scripts/eval/scan.ts` reads import specifiers with a regex and resolves relative paths itself. It imports nothing from `lib/`, and a test pins that. On VS Code it reads 14,849 code files and 139,020 import edges in about 3 seconds. The truth builder (`npm run eval:truth -- ../vscode`) computes each list with the scanner's edges, and each chain by breadth-first search. It also writes an evidence sheet that lists the import line behind every edge.
- **Every edge read in the source.** The evidence sheet holds 238 import lines: 218 behind the 181 list entries (an entry can rest on more than one line), 16 chain steps, and 4 in CN4's start file. Each was printed with the lines around it and read in the source. All 238 are top-level import declarations: 197 `import … from`, 40 side-effect imports and 1 `import type`. None sits in a comment, a string or a template literal. The TypeScript parser was used as a reading aid, to say what starts on each line.
- **Misses looked for two ways.** First `git grep` for each target's path, each folder's environment subfolders and CL1's namesake. Then a wider sweep: every quoted string in every tracked code file, comments and template literals included, which also catches an `import` split across lines and a `vs/…` module id. Each hit that was not already an entry was read.
- **Nebulosity's index consulted only for candidates.** Read-only, through `reach` and `importChain`. It agrees with the checked truth on all 181 list entries, on all 63 distances in CL4 and on all five chains. That is 0 bugs found in the index.
- **Chains.** Every step of every example chain was read. A widened graph (the scanner's edges plus 1,618 edges that exist only as quoted strings) gives the same shortest lengths, so no missed written-out specifier can make a chain shorter. For CN4, `strings.ts` reaches 68 files: 67 in `src/vs/base/common`, plus `src/vs/nls.ts`, which imports nothing. Every one's imports were read, and none is in `src/vs/workbench`.
- **The result of the check:** 0 false hits dropped, 0 misses added, 0 chains changed; the sizes were exactly the planning scan's. `eval/truth/adjudicated.json` is empty. 30 candidates were read and left out, each recorded in its truth's `notes`. **Then the owner's rule ("refers to", 2026-10-14) was applied** and the 30 were decided again under it, with a sweep of the whole repo for statements it could add: **8 files added** (CL2 +3, CL4 +3, CL5 +2), 0 dropped, 0 chains changed. The sizes are now CL1 22, CL2 41, CL3 3, CL4 66 (10 direct), CL5 57. The 8, each with its statement and line in its truth's `notes`:
  - CL2: three Copilot test fixtures (`extensions/copilot/src/extension/prompts/node/test/fixtures/extHost.api.impl.ts`, `extensions/copilot/test/simulation/fixtures/vscode/extHost.api.impl.ts`, `extensions/copilot/test/simulation/fixtures/doc/issue-6406/debugModel.ts`), whose `vs/workbench/contrib/debug/common/…` module ids name files inside the debug folder (way (b));
  - CL5: two Copilot test fixtures (`extensions/copilot/test/simulation/fixtures/fix/issue-7544/notebookMulticursor.ts`, `extensions/copilot/test/simulation/fixtures/tests/in-suite-issue-3701/notebookFolding.test.ts`), whose `vs/platform/undoRedo/common/undoRedo` ids name `undoRedo.ts` (way (b));
  - CL4: the two computed loaders `src/vs/code/electron-browser/workbench/workbench.ts` and `src/vs/sessions/electron-browser/sessions.ts` (way (c): each loads a main file that is already in the closure) and `build/vite/workbench-electron.ts`, which imports the first (way (a)).

  The 22 candidates that stay out:
  - paths that only look alike (CL1: five files under `src/vs/workbench/services` import a namesake `search/common/search.ts`; CL3: `editor/common/standalone` is not `editor/standalone`);
  - one Copilot test fixture whose own statement is a relative path to a file that doesn't exist (CL2: `codeMapper/notebookEditorWidget.ts`);
  - build entry-point lists and a file glob, lint scopes in `eslint.config.js`, and one 1.4 MB string of recorded data;
  - strings that are not a file's own statements, such as a forked process's entry point named in an environment variable (CL2: `customEndpointTelemetryService.ts`), stack-trace fixture strings and a compared name (CL4), and the HTML page that `scripts/code-sessions-web.js` generates (CL4, a template literal).
- **Rubric points.** Opus checked each of the 34 against `cc3fec88`, and Sonnet re-checked all 34: the files and folders exist, the functions have the stated signatures, the entry files import each other. 33 hold. BP3.1 does not, and the owner dropped it (decision 2). Four points in BP4 (BP4.5–BP4.8) are documented rules the code breaks. For example, nothing outside `contrib` should depend on it, yet `src/vs/sessions` has 391 files that import `contrib`, `workbench/api` 113 and `workbench/test` 67; 36 of 101 contributions have more than one `.contribution.ts`. A fifth, BP4.3 (`services` holds core services, not ones only a contribution uses), is a rule the code mostly keeps: 3 of 95 service folders serve a single contribution. All five stay in the rubric as "states the rule", and each point's `note` says how the code breaks or keeps it.

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
- tokens, summed over every model the run used, subagents included, with uncached input, cache writes, cache reads and output apart (the main conversation's tokens are shown apart too, because the baseline may explore through subagents);
- Claude Code's cost estimate (`total_cost_usd`, at list prices, not the owner's bill);
- turns; tool calls by tool, top-level and inside subagents apart; wall time;
- the 5-hour and 7-day utilization from the run's `rate_limit_event`;
- the flags above, and any note on how it ended.

**The tables** show each question and arm with both repeats, and each family and arm with the mean score (recall and precision for lists) and the median tokens, cost estimate, wall time and tool calls.

## Threats to validity

- **VS Code ships its own overview for agents.** `AGENTS.md` points to `.github/copilot-instructions.md`, a 158-line architecture overview, and both arms can read it. It may help A as much as B.
- **The wiki page is public.** The rubric comes from it, and the model may know it from training. Both arms share that, and it may narrow any gap on the big-picture family.
- **Nebulosity's summaries were written by Claude models** (Haiku for files, Sonnet for folders and the repo), the same family that answers in both arms.
- **The ground truth was read by models, and no person has read every entry.** A Claude model (Opus) read every edge and rubric point in the source, and a second (Sonnet) re-checked a sample of the entries, every chain step and every rubric point. A misreading shared by the models is possible. The owner settled the three calls the reading left open (see "The owner's decisions").
- **The rubric is graded by a model**, with the owner's review of every grade, against one wiki page.
- **Two runs per question is a small sample.** Repeats of one arm differ. The tables show every run, and the results make no claim a sample this small can't carry.
- **No shared prompt cache between arms** (their tool lists differ), so a pair's first arm may meet a colder cache or an earlier hour. The arms alternate for that reason.
- **The search tuning set overlaps the eval's topics.** Search Benchmark #2 (32 queries set by hand, `docs/BENCHMARKS.md`) includes `registerSingleton` and `createDecorator`, and BP3's rubric asks answers to name those. It also includes `extension host`, a BP1 topic, and `integrated terminal`, which shares CN1's topic (terminal code). The expected answers of those two include `src/vs/workbench/api/` (where CN3's first file lives) and `src/vs/workbench/contrib/terminal/` (where CN1's last file lives). No query names a file or folder that a list or chain question scores.
- **The runner has never run Claude Code yet.** Its tests use hand-built transcripts, and its reading of a transcript was checked against the one real smoke-run transcript from V1.4. The isolation checks will first be proven on real transcripts by the pilot, and a failed check stops the batch.
- **BP4's rule points measure repeating the wiki, not following the code.** BP4.5–BP4.8 are documented rules the code breaks, and BP4.3 is one it mostly keeps. All five count as "states the rule".
- **The truth and the index could share a blind spot.** The scanner and the index both read written-out specifiers. The two other nets (the parse of every evidence line, and the quoted-string sweep) found nothing the owner's rule left out. Under that rule a file loaded by a computed `import()` counts only when reading the code around it names the file (CL4's two loaders do). A file loaded by a worker's URL, by a forked process's entry path (named in an environment variable) or by a computed address that the code around it doesn't pin to one file is outside the definition on purpose.
- **Models may list files that aren't in the truth**, such as the Copilot test fixture `codeMapper/notebookEditorWidget.ts` (CL2, which imports a file that doesn't exist), a namesake file (CL1, CL3) or a build entry-point list. Lists score by recall, so that costs precision only. The Copilot fixtures that do count (five of them) are the files a model is least likely to find, and a model that misses them loses recall on CL2 and CL5.
- **Deferred tools may weaken B.** Under Claude Code's default, B's tools load on demand. The pilot's up-front runs measure what that costs.

## The owner's decisions (2026-10-14)

The owner answered the three open calls in one line: "Task 17: CL4 66, BP3.1 drop, wording refers to." Each is recorded in the truth or rubric it changes.

1. **CL4 counts the two computed loaders: 66 files.** `src/vs/code/electron-browser/workbench/workbench.ts` (lines 510–517) and `src/vs/sessions/electron-browser/sessions.ts` (lines 123–130) load the desktop and sessions main files with `await import(workbenchUrl)`, and `build/vite/workbench-electron.ts` imports the first. 63 + 3 = 66, with 10 direct importers as before. *For scoring:* a model that misses the three loses recall on CL4; one that lists them gains. The decision is recorded in `eval/truth/cl4.json`.
2. **BP3.1 is dropped.** The point stays in `eval/rubric/bp3.json` with `holds: false`, and BP3 is scored over its 5 other points. *For scoring:* an answer is neither rewarded nor marked down for what it says about where most services are defined.
3. **"Refers to" is the rule.** The list prompts' definition sentence stays as written, and the truths gain the files that "refers to" counts (the rule and its three ways are under "The questions"): CL2 38 → 41 and CL5 55 → 57, the five Copilot test fixtures. *For scoring:* a model that follows the prompt and lists those fixtures is credited, and one that stays with files the TypeScript compiler resolves loses recall on CL2 and CL5. Every added path comes out of the scorer's path reader as a file of the repo (checked with a script for an answer that lists it).

## Results

To come after the runs (Task 20).
