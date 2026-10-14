# 2026 10 14 Eval #1 — Claude Code with and without Nebulosity on VS Code

**Status: run, scored and published (2026-10-14): 90 runs in three arms. The results, losses included, are under "Results" at the end.** The method that comes before them was fixed before the first run. Claude models read the ground truth in the source and re-checked it; the owner settled the three calls but did not read every entry (see "How the ground truth was made and checked" and "The owner's decisions"). Models graded the big-picture answers, and the owner ruled on the points where two graders disagreed (see "Scoring").

**In short:** Claude Code alone already answered these 15 questions at or near the ceiling, and Nebulosity's MCP server raised no family's accuracy.
- *Big-picture:* lower with Nebulosity. At Claude Code's default tool search it scored 0.82 against 0.91, and with the tools up front 0.77.
- *Complete-list:* level or slightly lower (0.94 and 0.97 against 0.97).
- *Connection:* 1.00 in every run of every arm.

Where its tools were used on a question that needs a walk over the import graph (the connection questions and CL4's transitive list), they gave the same score on the connection questions and about the same on CL4 (within the spread of A's own two runs), for a fraction of the cost and time. At the default tool search the tools were used in 12 of 30 runs, never on a big-picture question.

This is the evaluation `PIVOT_SPEC.md` §9 asks for. It asks one thing: does Claude Code answer questions about a big repo better with Nebulosity's MCP server than without it? "Better" means more correct, and at what cost in tokens, tool calls and time. Losses are reported beside wins. The reasons behind each choice are in ADR-050. The plan is `docs/plans/2026-10-13-v1-5-ship.md` (D2, D3 and D4).

Where things are:
- Questions, formats: `eval/questions.json`. Ground truth: `eval/truth/<id>.json`. Rubrics: `eval/rubric/<id>.json`.
- The truth builder, the scanner it uses, the runner and the scorer: `scripts/eval/`.
- Kept transcripts (scrubbed, leak-scanned, gzipped): `eval/runs/`, with one summary line per run in `eval/runs/index.jsonl`. Raw ones stay in `.nebulosity/eval/raw/`, which git ignores.

## The arms

- **A, baseline:** Claude Code with its read-only built-in tools and its subagents.
- **B, Nebulosity:** the same, plus Nebulosity's MCP server (seven tools: overview, describe, search, dependents, dependencies, path, show_on_map), started with the command the README registers (`node <checkout>/mcp/launch.mjs`), with live events off. It answers about the index of `../vscode`.

- **U, `nebulosity-upfront`:** B with `ENABLE_TOOL_SEARCH=false`, so its seven tools are loaded up front instead of deferred behind ToolSearch. It shows what V1.6's fix (`alwaysLoad` in the README's registration) buys.

The headline comparison is A against B at the default, which is what a user who follows the README gets today. U is reported beside it. A and B differ only in the MCP config file; U differs from B only in `ENABLE_TOOL_SEARCH`. Prompts are identical and never mention Nebulosity.

## Setup

| What | Value |
|---|---|
| Claude Code | 2.1.299, run as `claude -p --output-format stream-json --verbose`. The runner refuses to start if `claude --version` says anything else, and refuses any run whose init message reports another version. |
| Model | `claude-sonnet-5-5` (the full id; the `sonnet` alias has moved between versions) |
| Effort | `medium`, Claude Code's own default for Sonnet 5.5 |
| Repo | VS Code at `cc3fec8846d0e678357e476fa611774da26d7e24`, a shallow clone at `../vscode`. The runner stops if its HEAD is anything else. |
| Nebulosity's engine | `8d7d4856e0dae81c2a75119a1933bd0031265d6a` (`EVAL_ENGINE`). The server's code (`lib/engine`, `lib/tools`, `lib/index`, `lib/db`, `mcp/`) is frozen at that commit until the eval is done. The static demo's tasks add code in the same folders (a query for its exporter, a browser search) that the server doesn't import. A diff against `EVAL_ENGINE` and a check of who imports what were made before the pilot. Four files differ: the demo's `staticSearch.ts` and its test, tests added to `rank.test.ts`, and a 5-line `loadIndexedHead` for the exporter. The server imports none of them. |
| Nebulosity's index | The owner's database for `../vscode`, with the V1.2 summaries (Summary Benchmark #1 in `docs/BENCHMARKS.md`). The one repo-level summary refresh that the test-folder fix needs (plan Task 2) was made before the pilot. Every run saw index version 135: the database was last written before the first run, and the server opens it read-only. |
| Working folder | `../vscode`. Claude Code tells the MCP server which project it is in, so B answers about that repo. |

### The command

The prompt goes on stdin. Everything else is the same in every arm, except the file after `--mcp-config` (A's differs from B's and U's) and, for U, `ENABLE_TOOL_SEARCH`.

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

- **On in every arm:** Read, Grep, Glob, the Agent tool, and Bash for read-only commands. D3 named `git grep`, `git ls-files`, `rg`, `ls`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq` and `find`; the runner also allows `git log`, `git show` and `grep`. The Agent tool brings Explore and the other built-in subagents, which are how Claude Code explores a big repo by default. The runner expects `claude-haiku-5-5` for Claude Code's Explore subagent and notes any other model that answers; the pilot shows which models answer. (No run of the 90 used a subagent, and Sonnet 5.5 was the only model that answered.) `mcp__nebulosity` is allowed everywhere, but the tools exist only where the server runs.
- **Off in every arm:** Edit, Write and NotebookEdit (nothing may change `../vscode`); WebFetch and WebSearch (the web holds the very wiki page the rubric comes from); Skill; PowerShell (`CLAUDE_CODE_USE_POWERSHELL_TOOL=0`, so every arm uses the same Bash shell); Monitor.
- **Listed but not allowed.** Every run's init also listed Claude Code's other built-in tools (cron, worktree, workflow, messaging and notification tools, and more). None is in `--allowedTools`, `validateInit` does not check for them, and none was called. The allow rule names `Agent`, but the init calls the subagent tool `Task`. No run tried a subagent, so whether that rule matched was not exercised.
- **Permissions:** `dontAsk` refuses anything outside the allowed set, and `--permission-prompts none` tells the model not to retry. Whether Claude Code 2.1.299 reads a rule like `Bash(git grep:*)` as intended shows in the pilot's `permission_denials`. (It did. Over the 90 runs, 12 had one Bash command refused, each outside the set: 9 wrote a script or a file under `/tmp`, 1 piped into `node`, 1 began with `cd` and 1 piped into `cut`.)
- **Tool search:** B uses Claude Code's default, under which every MCP tool is deferred and loaded on demand through ToolSearch. That is what a user who follows the README gets. The third arm, `nebulosity-upfront`, runs `ENABLE_TOOL_SEARCH=false` (tools loaded up front) on every question to measure what deferral costs. The pilot showed why it is on every question: at the default B loaded Nebulosity's tools in 1 of 3 runs, up front in 3 of 3. If deferral clearly hurts, the fix is a product change (V1.6: `alwaysLoad` in the README's registration), reported as such, not a different eval setting. Each transcript records its ToolSearch calls.
- **Limits per run:** 80 turns and $4 (Claude Code's own estimate), and a 30-minute wall-clock limit. A run that hits the turn or budget limit scores 0 and is reported. A run killed at 30 minutes is an outage (below).

### Isolation from the owner's own Claude Code setup

The runs use the owner's subscription, not an API key. Nothing of the owner's setup may leak into a run.
- `--setting-sources project,local` drops the owner's user settings: plugins and their hooks, a different default model and effort, synced skills.
- `--strict-mcp-config` takes MCP servers from `--mcp-config` alone. That ignores `../vscode/.mcp.json` (two VS Code tooling servers), the owner's own registration of Nebulosity (live events on) and claude.ai connectors.
- VS Code's `AGENTS.md` stays, as it would for any user in that repo.
- Variables set in every child:

| Variable | Value | Why |
|---|---|---|
| `CLAUDE_CODE_GIT_BASH_PATH` | the Git Bash that runs | every arm uses one shell, and children find it |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | `0` | no PowerShell tool |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | `1` | no memory shared between runs |
| `ENABLE_CLAUDEAI_MCP_SERVERS` | `false` | no connectors |
| `DISABLE_AUTOUPDATER` | `1` | the version can't change mid-eval |
| `NEBULOSITY_LIVE` | `off` | no live events to the owner's Map |
| `ENABLE_TOOL_SEARCH` | `false`, only in the `nebulosity-upfront` arm's runs | tools loaded up front |

- Variables removed from every child: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` (a key in `-p` always wins over the subscription and would bill the API), `CLAUDE_CODE_EFFORT_LEVEL` (it overrides `--effort`), the Bedrock, Vertex and Foundry switches, `ENABLE_TOOL_SEARCH`, `CLAUDE_CONFIG_DIR`, and **every name that starts with `CLAUDE`, `ANTHROPIC_` or `MCP_`**, in any case. The last rule is for a runner started inside a Claude Code session, whose own variables would otherwise reach every child. The pins above are set after the removal. The runner prints the removed names (never their values) and stops if one would still reach a child.
- If dropping the user settings ever fails to keep the owner's plugins out, the fallback is a dedicated `CLAUDE_CONFIG_DIR` that the owner logs into once (`--config-dir`).

### Checked on every run, not assumed

- **The init message**, judged the moment it appears. A run that differs is killed with its whole process tree, so a wrong setup costs seconds and not up to $4. It must show: the pinned model; permission mode `dontAsk`; no API key in use; no MCP server in A and `nebulosity` connected in B; none of the owner's plugins; Bash, Read, Grep and Glob present; WebFetch, WebSearch, Skill, PowerShell, Edit and Write absent.
- **The finished run:** the init again; the models that answered (anything but Sonnet 5.5 and Haiku is noted); `git status` in `../vscode` (a change stops the batch, and nothing is restored automatically); the scrubbed transcript and its index line scanned for the machine's paths and the owner's email, with Claude Code's project name for the folder scrubbed too.
- **An outage is not an answer:** an API error such as a rate limit (including one Claude Code reports as a success), a transcript with no result, or a run killed at 30 minutes. It is not scored, its raw transcript stays, and it is run again later. These re-runs are the "at most 6" below.
- **Usage:** each run reports the 5-hour and 7-day windows in its `rate_limit_event`. The runner stops cleanly when the 7-day window reaches 0.85 or the 5-hour window reaches 0.9, and stops if two runs in a row report neither.
- **Order:** which arm goes first alternates by question and by repeat. It comes from the question's place in the full list of fifteen, so the pilot gives each question the order the full run will (BP4 with B first, CL2 and CN3 with A first).

## The runs planned

- **The pilot, 9 runs:** BP4, CL2 and CN3 in all three arms (9). They are also the first test of the isolation checks on real transcripts. Then each run's usage and the extrapolation are reported, and **the owner approves the full count.**
- **The full run, 81 more:** three arms (A, B, `nebulosity-upfront`) on all 15 questions, twice: 90 runs, of which the pilot's 9 are first runs. The owner decided this on 2026-10-14: "How many runs for the full eval?"="54 more (Recommended)" and "Should the full run also run the 'tools up front' arm on every question?"="Add up-front arm (Recommended)". Per question and repeat the order is A and B (which goes first alternates), then the up-front run.
- **Total:** 90 runs, plus at most 6 re-runs, only for infrastructure failures, never for a bad answer.
- **If 90 won't fit** in the owner's usage: one run per question in all three arms (45, `--repeat 1`).
- **Expected usage:** Claude Code's estimate for V1.4's smoke run (8 turns, no exploring) was $0.05. An exploring run on VS Code should land between $0.30 and $1.50 at list prices, so roughly $20–90 for the 90 (three arms; the up-front arm costs about what B does). On a subscription that is a share of the 5-hour and 7-day windows, not a bill, and the pilot measures the share. D4 estimated about 20 runs per sitting. (Measured: Claude Code's estimate for all 90 was $4.88, and they took at most about 0.16 of one 5-hour window. See "Usage" under "Results".)

## The questions

Prompts are identical in the three arms. Each ends with a fixed answer format:
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

**Big-picture (R4).** Grader 1: a fresh Sonnet subagent per answer (30 in all), given only the rubric points that hold and the answer (no arm, no run id). It marks each point 1, 0.5 or 0 and quotes the sentence that earns it. A point the answer gets wrong scores 0. The answer's score is the mean over the points that hold. For BP4's rule points, an answer that states the rule earns the point, even if it adds that the code breaks it. To find the grades worth a person's look, a second blind grader (one Opus subagent, same sheets and instruction, never shown grader 1's replies or the key) graded all 30 answers. The two agreed exactly on 174 of 198 points. The owner ruled on each of the 24 disagreements with the arms hidden ("Take your suggested scores for all 24."): 17 changed grader 1's grade, 7 kept it. Every other grade is grader 1's, and the owner did not read those. The graders saw the answers unredacted, but none of the 30 names Nebulosity or an `mcp__` tool (checked in the 30 saved transcripts and the 30 sheets), so the answer text did not reveal the arm. The files: `eval/grading/<id>.json` (grader 1's replies, untouched), `eval/grading/second/` (the second grader's replies), `eval/grading/review.json` (the 24 rulings), `eval/grading/grades.json` (grader 1's grades with the rulings applied by `npm run eval:grading -- merge`) and `eval/grading/key.json` (sheet id to run).

**What is reported per run:**
- the score;
- tokens, summed over every model the run used, subagents included, with uncached input, cache writes, cache reads and output apart (the main conversation's tokens are shown apart too, because the baseline may explore through subagents);
- Claude Code's cost estimate (`total_cost_usd`, at list prices, not the owner's bill);
- turns; tool calls by tool, top-level and inside subagents apart; wall time;
- the 5-hour and 7-day utilization from the run's `rate_limit_event`;
- the flags above, and any note on how it ended.

**The tables** show each question and arm with both repeats, and each family and arm with the mean score (recall and precision for lists) and the median tokens, cost estimate, wall time and tool calls.

## Threats to validity

- **VS Code ships its own overview for agents.** `AGENTS.md` points to `.github/copilot-instructions.md`, a 158-line architecture overview, and every arm can read it. It may help A as much as B. (In the results, the big-picture scores followed whether a run read its sibling `.github/instructions/source-code-organization.instructions.md`: see "The losses".)
- **The wiki page is public.** The rubric comes from it, and the model may know it from training. Every arm shares that, and it may narrow any gap on the big-picture family.
- **Nebulosity's summaries were written by Claude models** (Haiku for files, Sonnet for folders and the repo), the same family that answers in every arm.
- **The ground truth was read by models, and no person has read every entry.** A Claude model (Opus) read every edge and rubric point in the source, and a second (Sonnet) re-checked a sample of the entries, every chain step and every rubric point. A misreading shared by the models is possible. The owner settled the three calls the reading left open (see "The owner's decisions").
- **The rubric is graded by models**: grader 1 (Sonnet) and a second grader (Opus) against one wiki page; the owner ruled only on the 24 points where they disagreed. A grade both graders got wrong the same way was not shown to the owner.
- **Two runs per question is a small sample.** Repeats of one arm differ. The tables show every run, and the results make no claim a sample this small can't carry.
- **No shared prompt cache between arms** (their tool lists differ), so a pair's first arm may meet a colder cache or an earlier hour. The arms alternate for that reason.
- **The search tuning set overlaps the eval's topics.** Search Benchmark #2 (32 queries set by hand, `docs/BENCHMARKS.md`) includes `registerSingleton` and `createDecorator`, and BP3's rubric asks answers to name those. It also includes `extension host`, a BP1 topic, and `integrated terminal`, which shares CN1's topic (terminal code). The expected answers of those two include `src/vs/workbench/api/` (where CN3's first file lives) and `src/vs/workbench/contrib/terminal/` (where CN1's last file lives). No query names a file or folder that a list or chain question scores.
- **The runner had never run Claude Code before the pilot.** Its tests use hand-built transcripts, and its reading of a transcript was checked against the one real smoke-run transcript from V1.4. The pilot first proved the isolation checks on real transcripts, and all 90 runs' init messages passed them.
- **BP4's rule points measure repeating the wiki, not following the code.** BP4.5–BP4.8 are documented rules the code breaks, and BP4.3 is one it mostly keeps. All five count as "states the rule".
- **The truth and the index could share a blind spot.** The scanner and the index both read written-out specifiers. The two other nets (the parse of every evidence line, and the quoted-string sweep) found nothing the owner's rule left out. Under that rule a file loaded by a computed `import()` counts only when reading the code around it names the file (CL4's two loaders do). A file loaded by a worker's URL, by a forked process's entry path (named in an environment variable) or by a computed address that the code around it doesn't pin to one file is outside the definition on purpose.
- **Models may list files that aren't in the truth**, such as the Copilot test fixture `codeMapper/notebookEditorWidget.ts` (CL2, which imports a file that doesn't exist), a namesake file (CL1, CL3) or a build entry-point list. Lists score by recall, so that costs precision only. The Copilot fixtures that do count (five of them) are the files a model is least likely to find, and a model that misses them loses recall on CL2 and CL5.
- **Deferred tools may weaken B.** Under Claude Code's default, B's tools load on demand. The `nebulosity-upfront` arm measures what that costs. (B loaded them in 12 of 30 runs, U used them in 22 of 30, and U scored no higher than B on big-picture: see "Tool search" under "Results".)

## The owner's decisions (2026-10-14)

The owner answered the three open calls in one line: "Task 17: CL4 66, BP3.1 drop, wording refers to." Each is recorded in the truth or rubric it changes.

1. **CL4 counts the two computed loaders: 66 files.** `src/vs/code/electron-browser/workbench/workbench.ts` (lines 510–517) and `src/vs/sessions/electron-browser/sessions.ts` (lines 123–130) load the desktop and sessions main files with `await import(workbenchUrl)`, and `build/vite/workbench-electron.ts` imports the first. 63 + 3 = 66, with 10 direct importers as before. *For scoring:* a model that misses the three loses recall on CL4; one that lists them gains. The decision is recorded in `eval/truth/cl4.json`.
2. **BP3.1 is dropped.** The point stays in `eval/rubric/bp3.json` with `holds: false`, and BP3 is scored over its 5 other points. *For scoring:* an answer is neither rewarded nor marked down for what it says about where most services are defined.
3. **"Refers to" is the rule.** The list prompts' definition sentence stays as written, and the truths gain the files that "refers to" counts (the rule and its three ways are under "The questions"): CL2 38 → 41 and CL5 55 → 57, the five Copilot test fixtures. *For scoring:* a model that follows the prompt and lists those fixtures is credited, and one that stays with files the TypeScript compiler resolves loses recall on CL2 and CL5. Every added path comes out of the scorer's path reader as a file of the repo (checked with a script for an answer that lists it).

## Results

**The runs.** All 90 ran on 2026-10-14 between 17:01 and 17:47 UTC: the pilot's 9, then 36 and 45 in two batches, with the machine kept quiet while they ran. Every run was kept on its first attempt: 0 of the 6 allowed re-runs were used, no run was an outage, and none was refused by the checks. Every init message showed Claude Code 2.1.299, `claude-sonnet-5-5`, permission mode `dontAsk` and no API key. Sonnet 5.5 was the only model that answered: no run called the Agent tool or used a subagent. `git status` in `../vscode` was clean after every run. Nebulosity's index was at index version 135 for every run: its database was last written before the first run, and the server opens it read-only (ADR-044). Lists and chains were scored by `npm run eval:score` with no chain step left to adjudicate. Big-picture answers were graded as "Scoring" says. Every number below is recomputed from `eval/results.json` and `eval/runs/index.jsonl`. "A" is the baseline, "B" Nebulosity at Claude Code's default tool search, and "U" Nebulosity with its tools loaded up front.

### The headline

Each row covers 10 runs: 5 questions, twice each. The score is the mean share of rubric points for big-picture, the mean recall for lists, and the mean chain score for connections. Precision is shown for lists only. Tokens are summed over every model a run used. The medians are over the 10 runs, with halves rounded up. Cost is Claude Code's own estimate at list prices. Tool calls include ToolSearch.

| Family | Arm | Score | Precision | Median input (uncached) | Median cache writes | Median cache reads | Median output | Median tokens, all | Median cost est. | Median wall | Median tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Big-picture | A | 0.91 | – | 3 | 1,921 | 30,793 | 1,119 | 32,397 | $0.021 | 13.2 s | 1 |
| Big-picture | B | 0.82 | – | 2 | 2,398 | 21,004 | 1,214 | 22,222 | $0.022 | 13.0 s | 0 |
| Big-picture | U | 0.77 | – | 2 | 2,154 | 34,074 | 1,150 | 35,271 | $0.023 | 12.7 s | 0 |
| Complete-list | A | 0.97 | 1.00 | 7 | 12,237 | 77,696 | 2,692 | 92,645 | $0.082 | 24.6 s | 3.5 |
| Complete-list | B | 0.94 | 1.00 | 6 | 9,455 | 70,777 | 2,572 | 81,696 | $0.067 | 24.5 s | 2.5 |
| Complete-list | U | 0.97 | 1.00 | 8 | 6,694 | 139,752 | 2,406 | 147,720 | $0.062 | 18.9 s | 4 |
| Connection | A | 1.00 | – | 11 | 6,572 | 134,509 | 2,413 | 143,958 | $0.065 | 23.2 s | 7 |
| Connection | B | 1.00 | – | 6 | 2,603 | 62,705 | 405 | 65,150 | $0.020 | 8.4 s | 2 |
| Connection | U | 1.00 | – | 4 | 1,494 | 67,166 | 313 | 69,073 | $0.016 | 7.1 s | 1 |

**A against B, the headline.**
- *Big-picture:* B scored lower, 0.819 against A's 0.909.
- *Complete-list:* B was slightly lower, 0.935 against 0.972. One run, CL1's second repeat, accounts for that gap: without it B's mean is 0.974.
- *Connection:* both arms scored 1.00 in every run. B used less than half of A's tokens (65,150 against 143,958), about a third of its cost estimate ($0.020 against $0.065) and about a third of its time (8.4 s against 23.2 s).

U, beside them, scored lowest on big-picture (0.774) and level with A on lists (0.969). A's list precision rounds to 1.00 but is 0.997: in CL2's first repeat it listed `notebook.contribution.ts`, which imports notebook's own `contrib/debug` folder.

**The owner's rule against D2's original one (a secondary check).** The headline uses the owner's rule, "refers to" (see "The owner's decisions"). Under D2's original "resolves to", each list's truth loses the 8 files that "refers to" added:
- CL2's three Copilot fixtures: `prompts/node/test/fixtures/extHost.api.impl.ts`, `simulation/fixtures/vscode/extHost.api.impl.ts` and `simulation/fixtures/doc/issue-6406/debugModel.ts`;
- CL5's two Copilot fixtures: `fix/issue-7544/notebookMulticursor.ts` and `tests/in-suite-issue-3701/notebookFolding.test.ts`;
- CL4's two computed loaders, `src/vs/code/electron-browser/workbench/workbench.ts` and `src/vs/sessions/electron-browser/sessions.ts`, plus `build/vite/workbench-electron.ts`.

The truths become CL1 22, CL2 38, CL3 3, CL4 63 and CL5 55. Each run's listed files (in `eval/results.json`) were scored again against them. The same recomputation under "refers to" gives the scorer's numbers exactly.

| Arm | Lists, "refers to" (the headline): recall / precision | Lists, "resolves to": recall / precision |
|---|---|---|
| A | 0.972 / 0.997 | 0.990 / 0.986 |
| B | 0.935 / 1.000 | 0.959 / 0.993 |
| U | 0.969 / 1.000 | 1.000 / 1.000 |

Under "resolves to", every U list run is complete and exact. B's only miss is CL1's second repeat. A misses only six debug test files, in CL4's first repeat. A's and B's precision falls because they listed the fixtures (CL5) and A the loaders (CL4's second repeat), which the narrower rule doesn't count. So the owner's rule explains all of U's list gap and little of B's.

### Per question

Every run's score, and what the transcripts show. A question's six runs differ only in arm and repeat.

**Big-picture** (share of rubric points):

| Question | A r1 | A r2 | B r1 | B r2 | U r1 | U r2 | What happened |
|---|---|---|---|---|---|---|---|
| BP1 layers | 0.88 | 0.94 | 0.88 | 0.94 | 0.88 | 0.88 | Level. No Nebulosity call. Four runs used no tool at all, and A r2 and U r2 grepped `.github/copilot-instructions.md`. Every run half-earned BP1.8 (the extension host). |
| BP2 environments | 1.00 | 1.00 | 0.75 | 0.83 | 0.83 | 0.75 | Both A runs read the environments table in VS Code's own `.github/instructions/source-code-organization.instructions.md` and earned every point. B and U made no tool call and answered from memory. Each missed or half-stated `electron-utility` (BP2.5), what `electron-main` may use (BP2.6), or both. |
| BP3 services | 0.90 | 1.00 | 1.00 | 0.90 | 0.80 | 1.00 | No tool call in any run: all six answered from memory. The spread is within each arm (BP3.4, BP3.6). |
| BP4 workbench | 0.94 | 0.94 | 0.88 | 0.44 | 0.44 | 0.50 | Three runs saw the same instructions file's "Contribution Rules" (A r1, A r2, B r1) and scored 0.88–0.94. The three that didn't (B r2, U r1, U r2) scored 0.44–0.50: they missed most of BP4.6–BP4.8 (one entry file, one common API file, never reach into another's internals). Both U runs called `describe` on `src/vs/workbench` first. Its answer gives the folder's layout and counts but none of those rules, and neither run found the file afterwards. |
| BP5 builds | 0.67 | 0.83 | 0.83 | 0.75 | 0.83 | 0.83 | No tool call in any run. The one big-picture question where B and U came out above A, by 0.04 and 0.08. Every run half-earned BP5.6 (a new file is loaded by importing it from a `.contribution.ts`), and A r1 missed BP5.4 (a desktop-only service needs a web counterpart). |

**Complete-list** (recall; the hits are in `eval/results.json`):

| Question | A r1 | A r2 | B r1 | B r2 | U r1 | U r2 | What happened |
|---|---|---|---|---|---|---|---|
| CL1 (22) | 1.00 | 1.00 | 1.00 | 0.59 | 1.00 | 1.00 | A made 3–4 Greps for the specifier's forms and filtered out the namesake `services/search/common/search.ts`. B r1 grepped the same way. **B r2 didn't load the tools.** Its one Grep pattern, `(search/common/search\|\./search)`, can't match the `../common/search.js` form, so it missed 9 files in `contrib/search/browser` and `contrib/search/test`. U called `dependents`, which returned all 22, and its greps agreed. |
| CL2 (41) | 0.93 | 0.93 | 0.93 | 0.93 | 0.93 | 0.93 | Every run missed the same three Copilot fixtures, whose `vs/…` module ids name debug files. A and B grepped without calling Nebulosity, saw the fixtures and left them out as copies whose ids don't resolve to real files. U took 38 files from `dependents`, which doesn't link `vs/…` ids, and its check grep covered only `src`. A r1 also listed one wrong file. |
| CL3 (3) | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | Every run found all three. U called `dependents`, then made 2–8 more calls to check the suspects (a namesake `editor/common/standalone`, the perf-data blob). |
| CL4 (66, transitive) | 0.86 | 1.00 | 0.95 | 0.95 | 0.95 | 0.95 | A tried to run a script that walks the imports, was refused (read-only rules), and walked the closure level by level with grep (14 and 16 calls). A r1 left out the two computed loaders as "string-only mentions", so the file that imports one was out too, and it stopped before six debug test files. A r2 found all 66. B (after ToolSearch) and U made one `dependents` call with `transitive` and checked nothing. Nebulosity's index has no edge for a computed `import()`, so the three loaders are missing in all four runs. |
| CL5 (57) | 1.00 | 1.00 | 1.00 | 1.00 | 0.96 | 0.96 | A and B grepped for `undoRedo/` across the repo (one to three calls). They counted the two Copilot fixtures (A r1: "the specifier names the file"). U took 55 files from `dependents`. A repo-wide grep showed both U runs the fixtures, and both left them out. |

**Connection** (1 for a shortest chain or a right "none"):

| Question | Every run | What happened |
|---|---|---|
| CN1 (4 steps) | 1.00 ×6 | A made 9 tool calls in each run (mostly Grep), walking from the entry file. B called ToolSearch, then `path`. U called `path`. |
| CN2 (5 steps) | 1.00 ×6 | A made 5–6 calls, backward from `debugSession.ts` through `debugService.ts`. B and U called `path`. |
| CN3 (4 steps) | 1.00 ×6 | A's costliest connection question ($0.150 mean, 46 s): it tried to run a script to search the imports, was refused, and traced the intermediates by hand (7–8 calls). B and U called `path` and got the same 4-step chain through notebook code. |
| CN4 (none) | 1.00 ×6 | Every run said "none". A made 5–7 calls over `strings.ts`'s closure. B called `dependencies` with `transitive` (68 files, none in the workbench). U called `path` to the folder `src/vs/workbench` and got "doesn't reach". |
| CN5 (3 steps) | 1.00 ×6 | A made 6 and 12 calls, its script refused in both. Its chains differ from the truth's but are as short, and every step was read in the source. B and U called `path`. |

**What each question cost** (means of the two repeats; tokens over every model):

| Question | Tokens A / B / U | Cost est. A / B / U | Wall A / B / U | Tool calls A / B / U |
|---|---|---|---|---|
| BP1 | 32k / 22k / 53k | $0.020 / $0.019 / $0.022 | 12 / 13 / 12 s | 1 / 0 / 0.5 |
| BP2 | 76k / 22k / 35k | $0.029 / $0.018 / $0.019 | 14 / 12 / 12 s | 3 / 0 / 0 |
| BP3 | 22k / 22k / 35k | $0.017 / $0.018 / $0.019 | 11 / 11 / 12 s | 0 / 0 / 0 |
| BP4 | 83k / 85k / 148k | $0.082 / $0.085 / $0.117 | 19 / 19 / 18 s | 3 / 3.5 / 6 |
| BP5 | 22k / 22k / 35k | $0.017 / $0.021 / $0.020 | 12 / 15 / 14 s | 0 / 0 / 0 |
| CL1 | 86k / 104k / 207k | $0.090 / $0.067 / $0.091 | 21 / 30 / 22 s | 3.5 / 3 / 7 |
| CL2 | 120k / 178k / 149k | $0.090 / $0.122 / $0.062 | 35 / 44 / 24 s | 5.5 / 6.5 / 3.5 |
| CL3 | 73k / 102k / 148k | $0.061 / $0.078 / $0.055 | 20 / 23 / 17 s | 2.5 / 3 / 6 |
| CL4 | 550k / 69k / 73k | $0.354 / $0.047 / $0.045 | 108 / 18 / 15 s | 15 / 2 / 1 |
| CL5 | 49k / 79k / 135k | $0.058 / $0.068 / $0.068 | 19 / 24 / 21 s | 1 / 2.5 / 4.5 |
| CN1 | 132k / 65k / 69k | $0.065 / $0.019 / $0.018 | 28 / 11 / 8 s | 9 / 2 / 1 |
| CN2 | 99k / 65k / 69k | $0.034 / $0.018 / $0.016 | 14 / 8 / 7 s | 5.5 / 2 / 1 |
| CN3 | 203k / 65k / 69k | $0.150 / $0.019 / $0.017 | 46 / 9 / 7 s | 7.5 / 2 / 1 |
| CN4 | 134k / 66k / 69k | $0.045 / $0.023 / $0.014 | 19 / 9 / 6 s | 6 / 2 / 1 |
| CN5 | 186k / 65k / 69k | $0.091 / $0.017 / $0.015 | 28 / 8 / 7 s | 9 / 2 / 1 |

B made no Nebulosity call on the direct-import lists (CL1–CL3, CL5) or on any big-picture question, so on those rows no tool answer caused its differences from A. B's setup still differs from A's: its one-turn answers carried about 480 more context tokens per turn (cache reads plus writes, a mean of 21,006 over B's 8 one-turn runs against 20,528 over A's 5; whole one-turn runs averaged 22,205 tokens against 21,607). That is consistent with the list of deferred Nebulosity tool names that B's setup adds to the prompt, which is likely where the difference comes from.

### The losses

- **Big-picture: both Nebulosity arms scored below Claude Code alone.** B scored 0.819 and U 0.774, against A's 0.909: 0.090 and 0.135 lower. B's gap sits in two questions, BP2 and BP4: it is level with A on BP1 and BP3 and above it on BP5. U's sits mostly in the same two. U is also a little below A on BP1 (0.875 against 0.906, −0.031) and BP3 (0.90 against 0.95, −0.050), both within the spread of A's own two repeats there, and above it on BP5 (+0.083). On BP2, A scored 1.00 and B and U 0.79 each. On BP4, A scored 0.94, B 0.66 and U 0.47.
  - *What the scores followed:* whether a run read VS Code's own `.github/instructions/source-code-organization.instructions.md`, which states the environment table BP2 asks about and the contribution rules BP4.6–BP4.8 ask about. The five runs whose tools showed them that file scored 0.88–1.00 (BP2: A ×2; BP4: A ×2 and B r1). The seven runs on those two questions that never saw it scored 0.44–0.83. That is what the transcripts show, a correlation in twelve runs, not a measured cause.
  - *What B and U did:* default B never loaded Nebulosity's tools on a big-picture question. U called `describe` on `src/vs/workbench` in both BP4 runs, and still scored lowest there. In those two `describe` answers the index's summary gave the folder's layout and counts but none of the rules: an observation from two calls (see "What this says about the claim").
  - *The other three:* on BP1, BP3 and BP5, where no run read the file, the arms' means over the three are close (A 0.869, B 0.883, U 0.869). Within them U is a little below A on BP1 and BP3 and above it on BP5.
  - *What can't be told:* with two runs per question, whether the Nebulosity arms read less because of the tools or by chance.
- **CL1, B's second repeat: 0.59 (13 of 22).** It didn't load the tools. Its one Grep pattern couldn't match the `../common/search.js` form that the feature's own `browser/` files use. Its follow-up checks looked outside `src/vs` for the full path and in `contrib/search/common` for `./search`, and it reported "Neither search found anything". So it missed 9 files. One `dependents` call returns all 22, and both U runs got 1.00. This one run is B's whole list gap.
- **Nebulosity's index falls short of the owner's "refers to" truth in two ways.** These are limits of the index's import resolution against the eval's definition, not bugs under "resolves to" (R2: recorded here, fixed after the eval as V1.6 items):
  - *Non-relative `vs/…` module ids.* The index doesn't link the Copilot test fixtures' `vs/workbench/…` and `vs/platform/…` ids to `src/`. In CL5 that cost U 2 of 57 files in both runs (0.96): U trusted `dependents`' 55 and left out the fixtures that A and B counted. In CL2 every run of every arm missed the three fixtures, but for two reasons. A and B saw them and chose to leave them out. U never saw them, because the graph lacks them and its check grep covered only `src`.
  - *Computed `import()`.* CL4's two loaders load the desktop and sessions main files through `await import(workbenchUrl)`, so the index has no edge for them, nor for `build/vite/workbench-electron.ts`, which imports one of them. All four B and U runs scored 0.95 (63 of 66) from one `dependents` call with no check. A's second repeat found all 66.
- **Tokens, with the tools up front.** Loading the seven tools' definitions up front adds about 13,000 tokens to the context of every turn. The context of a one-turn answer (cache reads plus writes, the mean over each arm's one-turn runs) was 20,528 tokens in A, 21,006 in B and 34,075 in U. That made U the arm with the most tokens on big-picture (median 35,271 against A's 32,397) and on lists (147,720 against 92,645), though not the costliest by estimate, since cache reads are cheap.
  - On the four direct-import lists, U called `dependents` and then checked it with grep. It used more tokens than A on all four, and its cost estimate was about level or higher on CL1 and CL5.
  - U's BP4 was the costliest big-picture question of any arm ($0.117, the mean of its two runs).

### Where Nebulosity helped

- **Connection questions, at the same score.** Every run of every arm scored 1.00.
  - B called ToolSearch and then answered with one call (`path` 8 times, `dependencies` twice on CN4). Its medians: 65,150 tokens against A's 143,958 (45%), a $0.020 cost estimate against $0.065 (31%), 8.4 s against 23.2 s (36%), and 2 tool calls against 7.
  - U's medians: 69,073 tokens, $0.016, 7.1 s and 1 call.
  - A walked the graph by hand, in 5–12 calls a run.
- **CL4, transitive dependents.** B and U each made one `dependents` call and listed 63 of 66 files (0.95). A scored 0.86 and 1.00.
  - B's means were 69,421 tokens, $0.047 and 18 s, against A's 550,329 tokens, $0.354 and 108 s (14 and 16 calls).
  - That is 7.9 times fewer tokens, a cost estimate 7.5 times lower and 6.0 times less time. For U: 7.5, 7.9 and 7.1 times.
  - CL4's two A runs were the two costliest runs of the 90 ($0.33 and $0.37).
- **Precision.** Every B and U list run listed no file outside the truth (precision 1.00).

These savings are partly a product of the eval's read-only rules. Six A runs (CL4, CN3 and CN5, twice each) tried to write a script to walk the imports, and `dontAsk` refused it, so A traced the graph with grep. A user who lets Claude Code run scripts may see A answer these more cheaply than here.

### Tool search

How often the Nebulosity arms used the tools:

| Family | B (default): runs that loaded a tool | B: calls | U (up front): runs that called a tool | U: calls |
|---|---|---|---|---|
| Big-picture | 0 of 10 | – | 2 of 10 (BP4 ×2) | `describe` ×2 |
| Complete-list | 2 of 10 (CL4 ×2) | `dependents` ×2 | 10 of 10 | `dependents` ×10 |
| Connection | 10 of 10 | `path` ×8, `dependencies` ×2 | 10 of 10 | `path` ×10 |
| All | 12 of 30 (40%) | 12 | 22 of 30 (73%) | 22 |

- **How B loaded the tools.** Every ToolSearch in B was an exact `select:mcp__nebulosity__<tool>` with `max_results` 1, followed at once by that tool's call. No run loaded a tool and left it unused, and every run that used one made exactly one Nebulosity call. `search`, `overview` and `show_on_map` were never called.
- **When B loaded them.** It did so where the prompt named a chain or "directly or through other files". For a "directly imports" list or a big-picture question, it grepped or answered from memory, as A did.
- **The pilot already showed this.** In its three questions, default B loaded a tool in 1 of 3 runs (CN3: ToolSearch, then `path`), and up front all three used one (`describe`, `dependents`, `path`). The full run gave the same pattern: 12 of 30 at the default, 22 of 30 up front.
- **What loading up front did to the scores.** It raised the tools' use but not the scores: U's big-picture score was the lowest of the three. On lists, U removed CL1's miss and added CL5's. V1.6's `alwaysLoad` fix would make the tools available in every run, and this eval says that alone doesn't make the answers better than Claude Code's own.

### Usage

- **The windows.** The 5-hour window went from 0.07 at the first run to 0.23 at the last, and the 7-day window from 0.72 to 0.74. Both are two-decimal readings from the runs' `rate_limit_event`s, all within one 5-hour window. The session that ran the eval (its reviewers and doc work) used the same windows meanwhile, so the eval's share is at most about 0.16 of a 5-hour window and 0.02 of a week, at the readings' two-decimal resolution. Neither stop (0.9 and 0.85) came close.
- **The cost estimate.** Claude Code's list-price estimate for the 90 runs is $4.88: A $2.40, B $1.28, U $1.20. The pilot's 9 runs were $0.89 of it. The median run was $0.04, and the costliest was CL4's second A run at $0.37. This is an estimate, not a bill: the runs used the subscription. The estimate before the runs ($20–90) was 4 to 18 times too high.
- **Time and tokens.** The runs' wall times add up to 28.7 minutes: A 13.5, B 8.4 and U 6.7. Their tokens add up to 8.53 million (A 3.74, B 2.07 and U 2.73 million), nearly all cache reads.

### What this says about the claim

ADR-043 says Nebulosity's edge should show on big repos, in complete dependency answers and in summaries of whole areas. On VS Code, with these 15 questions:

- **Claude Code alone already answers them at or near the ceiling.**
  - A scored 1.00 on 9 of the 15 questions, 0.90–0.95 on 5 and 0.75 on BP5.
  - Three things work in A's favor. Sonnet 5.5 knows VS Code's layout: 20 of the 30 big-picture runs answered without a single tool call. VS Code ships its own architecture notes for agents. And grep finds a file's direct importers in one to four calls.
- **Nebulosity raised no family's accuracy; it lowered big-picture's (0.91 to 0.82) and, through one run, the complete lists' (0.97 to 0.94).**
  - At the default (B): big-picture went from 0.909 to 0.819, lists from 0.972 to 0.935, and connections stayed at 1.00.
  - With the tools up front (U): 0.774, 0.969 and 1.00.
  - Per question, B was above A on 2: BP5 (+0.04) and CL4 (+0.02). Both gains are smaller than the gap between A's own two repeats on those questions. B was below A on 3 (BP2, BP4, CL1) and level on 10.
  - U, against A: above on 2, BP5 (+0.08) and CL4 (+0.02), both again within the gap between A's own repeats; below on 5 (BP1, BP2, BP3, BP4, CL5); level on 8.
- **This eval doesn't support "summaries of whole areas".**
  - Default B never loaded a tool on a big-picture question. U called `describe` twice, both times on BP4, and scored lowest there.
  - The big-picture scores followed whether a run read VS Code's own instructions file.
  - In U's two `describe` calls, both on `src/vs/workbench` for BP4, the index's summary said what the folder holds and gave none of the rules that file and the wiki state. That is an observation from two calls, not a test of the summaries.
- **"Complete dependency answers" held in cost, not in score.**
  - Where a question needed a walk over the graph (the five connection questions and CL4), the tools answered in one call. The score was the same on connections and about the same on CL4 (within the spread of A's own two runs), for about a third of A's cost estimate and time on connections, and about an eighth of its tokens on CL4.
  - On the four direct-import lists, the tools added nothing. A's greps scored 1.00 on three of them, and on CL2 every arm missed the same three fixtures.
  - The index's own limits (`vs/…` module ids, computed `import()`) cost recall where the owner's rule counts those statements.
- **At the default, the tools were used in 40% of runs** (12 of 30), all of them questions about chains or transitive dependents. Loading the tools up front raised that to 22 of 30 but didn't lift any family above A.
- **ADR-024's test.** ADR-024 says the value proposition needs rethinking if Nebulosity's tools don't improve Claude Code's answers on VS Code.
  - On correctness, this eval shows they didn't on 13 of the 15 questions in either Nebulosity arm. At the default (B) they were level with A on 10 and lower on 3. With the tools up front (U) they were level on 8 and lower on 5. On the other 2 in each arm (BP5 and CL4), the gain is within the spread of A's own repeats.
  - What the tools did improve is the cost and time of dependency answers.
  - Whether that is enough is the owner's decision. This eval doesn't make it.
- **What this eval doesn't show.**
  - It covers one repo, which the model knows well; one model at one effort; and two runs per question.
  - Claude Code was limited to read-only commands. A's scripts were refused, which made its dependency answers cost more.
  - The 15 questions were written to cover three families, not to favor either arm.
  - A repo the model doesn't know, or one without its own architecture notes, could come out differently. This eval didn't test that.

### Raw data

- `eval/runs/`: the 90 scrubbed transcripts (`<question>-<arm>-<repeat>.jsonl.gz`, where `nebulosity-upfront` is U) and `index.jsonl`, one summary line per run.
- `eval/results.json`: every run's score, the files its answer named, its misses and extras, tokens, cost estimate, wall time and tool calls. `npm run eval:score` writes it from `eval/runs/`, the truths, the rubrics and `eval/grading/grades.json`, and prints the per-run, per-question and per-family tables.
- `eval/grading/`: grader 1's replies, the second grader's (`second/`), the owner's 24 rulings (`review.json`), the merged grades (`grades.json`), the blind sheets (`sheets/`) and the key from sheet to run (`key.json`).
- `eval/questions.json`, `eval/truth/` and `eval/rubric/`: the questions, the truths and the rubrics the scores rest on.
