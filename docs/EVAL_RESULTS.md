# 2026 10 14 Eval #2 — Claude Code with and without Nebulosity, on VS Code and AFFiNE

**Status: the method is fixed (2026-10-14). Claude Code 2.1.300; the engine frozen at `90f9f63` (2026-10-15, before the pilot).** Everything in this section down to "Results" was written before the first run: the arms, the setup, the questions and their truths, the scoring and the ship gate. The gate does not change after the first run.

This is the re-measured eval that ADR-051's amendment waits for. Nothing ships (the demo deploy, the public repo, the video) until Eval #2 shows clearly better results and efficiency than Eval #1 did. It asks whether Claude Code answers questions about two big repos better and more cheaply with Nebulosity's MCP server than without it. It asks Eval #1's questions again, plus questions grep can't answer cheaply. Losses will be reported beside wins. The decisions are ADR-057, which amends ADR-050 and ADR-051. The plan is `docs/plans/2026-10-14-v1-6-works-on-your-repo.md` (D1, D2, R1–R6 and Task 14).

Where things are:
- The definition (repos, pins, arms, repeats, scripts and the pilot): `eval2/eval.json`.
- The questions and format lines: `eval2/questions.json`. The task sessions: `eval2/sessions.json`.
- The truths: `eval2/truth/<id>.json`, built from `eval2/truth-specs.json`, with every hand decision in `eval2/truth/adjudicated.json`. Grading-time verdicts on the models' own chain and cycle steps go in `eval2/truth/steps.json`, which only the scorer reads, so the truths stay as approved. The rubrics: `eval2/rubric/<id>.json`.
- The dev set, which is never scored and whose targets appear nowhere here: `eval2/dev/`.
- The truth builder, its resolver and its two extractors, the runner, the scorer and the gate: `scripts/eval/`.
- Kept transcripts will go in `eval2/runs/` (scrubbed, leak-scanned, gzipped). Raw ones and each run's scratch folder go in `.nebulosity/eval2/raw/`, which git ignores.

## The arms

- **A, baseline:** Claude Code alone, with its read-only built-in tools, its subagents, and Node.js scripts in a scratch folder (below).
- **N, Nebulosity:** the same, plus Nebulosity's MCP server.
  - It is registered the way `nebulosity setup` registers it, plus `NEBULOSITY_LIVE=off`, so no live event reaches the owner's Map.
  - It has six tools (ADR-056): `overview`, `describe`, `search`, `imports`, `architecture` and `show_on_map`.
  - The five that answer questions carry `_meta["anthropic/alwaysLoad"]: true`, so they load without ToolSearch. `show_on_map` stays deferred.
  - The registration carries no `alwaysLoad` (R4).
  - It answers about the index of the repo the run is in.

A and N differ only in the MCP config file. The prompts, the scratch folder's rules and everything else are the same, and no prompt names Nebulosity. Eval #1's third arm (the tools loaded up front) is retired, because the tools now load themselves.

## Setup

| What | Value |
|---|---|
| Claude Code | 2.1.300, pinned at the pilot (Task 21, 2026-10-15) in `eval2/eval.json`'s `claudeVersion`; `claude --version` said 2.1.300, so the pin didn't move. The dev set ran on 2.1.300 too. The runner refuses to start on any other version, and refuses any run whose init message reports another. |
| Model | `claude-sonnet-5-5` |
| Effort | `medium` |
| Limits | A single run: 80 turns, $4 (Claude Code's estimate) and 30 minutes. A task session: one budget of $10 for its four messages, and 60 minutes. |
| Repos | VS Code at `cc3fec8846d0e678357e476fa611774da26d7e24` (`../vscode`). AFFiNE at `0b69a6da21e8fd35beb85667bb8496d9b3852238` (`../affine`, the head of its canary branch on 2026-10-14, a shallow clone). The runner stops if either HEAD is anything else. |
| Nebulosity's engine | Frozen at `EVAL2_ENGINE` = `90f9f636d62abaed5389a6bc02333de847cbfa6a` (`90f9f63`), the commit the pilot started from (Task 21, 2026-10-15). Nothing in `lib/engine`, `lib/tools`, `lib/index`, `lib/db`, `lib/home.ts`, `lib/config.ts` or `mcp/` changes from then until the results are committed. |
| Nebulosity's index | The owner's database: VS Code with the V1.2 summaries, AFFiNE with Task 20's. At the freeze the index versions were VS Code 152 and AFFiNE 131 (138 and 3 when this was written; the pre-freeze re-index left 143 and 8, and Task 20's summary writes, which bump the version, took them to 152 and 131 with no file changed). Every run records the version it saw, and the server opens the database read-only. |
| Working folder | The repo the question asks about. |

### The command

The prompt goes on stdin. A task session writes its four prompts as stream-json user messages, each one after the previous answer's result. Everything is the same in both arms except the file after `--mcp-config`.

```
claude -p --output-format stream-json --verbose
  --model claude-sonnet-5-5 --effort medium
  --max-turns 80 --max-budget-usd 4
  --setting-sources project,local
  --strict-mcp-config --mcp-config <A: eval2/mcp/empty.json, N: .nebulosity/eval2/mcp-nebulosity.json>
  --permission-mode dontAsk --permission-prompts none
  --allowedTools Read,Grep,Glob,Agent,Bash(git grep:*),Bash(git ls-files:*),Bash(git log:*),Bash(git show:*),
                 Bash(rg:*),Bash(grep:*),Bash(ls:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*),
                 Bash(sort:*),Bash(uniq:*),Bash(find:*),mcp__nebulosity,Bash(node:*),Edit(//<scratch>/**)
  --disallowedTools NotebookEdit,WebFetch,WebSearch,Skill,PowerShell,Monitor
  --add-dir <scratch>
  --no-session-persistence
```

- A task session runs the same command with `--max-budget-usd 10`, followed by `--input-format stream-json --replay-user-messages`.
- `<scratch>` is the run's own scratch folder. The Edit rule writes its absolute path the way Claude Code's permission rules want it: `//c/Users/…/eval-scratch/<hex>/**`.
- The runner writes N's config file:

```json
{ "mcpServers": { "nebulosity": { "command": "node", "args": ["<checkout>/mcp/launch.mjs"], "env": { "NEBULOSITY_LIVE": "off" } } } }
```

`eval2/mcp/empty.json` is `{ "mcpServers": {} }`.

### Scripts, and the scratch folder

Both arms may run Node.js scripts (the owner's pick on the options memo, 2026-10-14). Eval #1's baseline could only read, so its savings came with that caveat.
- **The rules:**
  - `Bash(node:*)` is allowed.
  - So are edits under the run's scratch folder: `Edit(//<scratch>/**)`, with `--add-dir <scratch>`. The rule covers the Write tool too, since Claude Code never consults a `Write(…)` rule.
  - Edit and Write leave the deny list, because a deny would beat the path rule.
  - Under `dontAsk`, any other edit and any other Bash command is refused.
- **The folder:** a fresh, empty folder per run, at `<system temp folder>/eval-scratch/<16 random hex digits>/`.
  - It sits outside the Nebulosity checkout and outside both repos.
  - Its name carries no arm and no run name, so the prompt, `--add-dir` and the Edit rule are the same text in both arms. The hex is recorded in the run's index line.
  - After the run, its contents are copied beside the raw transcript (`.nebulosity/eval2/raw/<run>.scratch/`) and the temp folder is removed. The copy never follows a link and stops at 50 MB; anything left out, and a copy that fails, is listed in the archive's `ARCHIVE-NOTE.txt` and printed. The folder is removed even then, and nothing in this step can replace a run's own stop.
  - The scrubber turns its path into `<scratch>` in kept transcripts.
- **The sentence** is the same in both arms and comes after the format line, with the folder's absolute path (forward slashes) in place of `<scratch>`: `You may write Node.js scripts in <scratch> with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.`

### What is on, what is off, and why

- **On in both arms:**
  - Read, Grep, Glob and the Agent tool (Explore and the other built-in subagents).
  - Bash for the read-only commands Eval #1 allowed.
  - The scripts above.
  - `mcp__nebulosity` is allowed everywhere; its tools exist only where the server runs.
- **Off in both arms:**
  - NotebookEdit.
  - WebFetch and WebSearch: the rubrics' sources are on the web (VS Code's wiki page, AFFiNE's and BlockSuite's docs).
  - Skill and Monitor.
  - PowerShell (`CLAUDE_CODE_USE_POWERSHELL_TOOL=0`), so every arm uses one shell.
  - Edit and Write work only under the scratch folder.
- **Tool search:** Claude Code's default. N's five question tools are always loaded through their own `_meta` (ADR-056), which is what a user who runs `nebulosity setup` gets. On the dev set, every one of the 16 runs used them, with no ToolSearch call (MCP Dev Set #1 in `docs/BENCHMARKS.md`).
  - Those 16 runs were the N arm only, and they ran with R6's old scripts sentence.
  - The new sentence invites a script written with Write and run with node, so it may change how often either arm scripts and how often N reaches for its tools. The pilot checks both.
- **Limits:** as in the setup table.
  - A run that hits its turn or budget limit scores 0 and counts. In a session, the message that hit it scores 0, and so does any message never answered.
  - In a session, after a message runs out of the session's budget (`error_max_budget_usd`), no more messages are sent and stdin closes: that budget is the whole process's, so the later messages go unanswered and score 0. After `error_max_turns`, a limit of that message alone, the next message is sent.
  - A run killed at its time limit is an outage.

### Isolation from the owner's own Claude Code setup

As in Eval #1, and on the owner's subscription, never an API key:
- `--setting-sources project,local` keeps out the owner's plugins, hooks, model and effort.
- `--strict-mcp-config` keeps out the repo's `.mcp.json`, the owner's own registration of Nebulosity and claude.ai connectors.

VS Code's `AGENTS.md` stays, as it would for any user there. AFFiNE has no repo-level agent guide at `0b69a6da`: only one package, `packages/frontend/apps/ios`, has an `AGENTS.md`.

Variables:
- **Set in every child:** `CLAUDE_CODE_GIT_BASH_PATH` (the Git Bash that runs), `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `DISABLE_AUTOUPDATER=1` and `NEBULOSITY_LIVE=off`.
- **Removed from every child:**
  - `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`;
  - `CLAUDE_CODE_EFFORT_LEVEL`;
  - the Bedrock, Vertex and Foundry switches;
  - `ENABLE_TOOL_SEARCH` and `CLAUDE_CONFIG_DIR`;
  - every name that starts with `CLAUDE`, `ANTHROPIC_` or `MCP_`, in any case.

  The pins are set after the removal. The runner prints the removed names (never their values), and stops if one would still reach a child.

### Checked on every run, not assumed

- **The init message**, judged the moment it appears (in a task session, every message's init). It must show:
  - the pinned model and Claude Code version;
  - permission mode `dontAsk` and no API key;
  - no MCP server in A, and `nebulosity` connected in N;
  - none of the owner's plugins;
  - the right tools present and absent.

  A run that differs is killed with its whole process tree.
- **After the run:** each repo of the definition must be at its commit with a clean `git status`, and the Nebulosity checkout's `git status --porcelain -uall` must match the one before the batch (the owner's work in progress stays). `-uall` gives every untracked file its own line, so a file added inside a folder that was already untracked shows. A change stops the batch, and nothing is restored automatically.
- **Nebulosity's index:** each repo's index version is printed before the batch. A batch stops if an N run asks about a repo with no index version.
- **Transcripts:** scrubbed of the machine's paths, the scratch folder and the owner's email, then scanned for them. A hit stops the batch.
- **An outage is not an answer.** These count as outages:
  - an API error, including one reported as a success;
  - no result;
  - a run killed at its time limit;
  - a session with fewer results than messages sent, or with an error in any one message's stretch of the transcript. A session whose last result hit its turn or budget limit is not an outage, even when the process then ended with messages unanswered: it is kept, its index line names the unanswered questions, and each of them scores 0, as the limited message does. That holds only when nothing after that result shows work on the next message; an assistant event there means the next message had started, and its missing result is a crash, an outage.

  An outage is not scored. It is re-run later (Eval #1's rule), and every attempt's raw transcript is kept.
- **Usage:** the runner stops cleanly when the 7-day window reaches 0.85 or the 5-hour window reaches 0.9. It stops if two runs in a row report neither.
- **Order:** which arm goes first alternates by question (or session) and by repeat. It comes from the question's place among the single questions of `eval2/questions.json` (or the session's in `eval2/sessions.json`), so the pilot gives each the order the full run will.
- **Session questions run only in their sessions.** The single-run schedule, `--pilot` and `--only` leave out every question marked `"session"`, and the runner refuses one named as a single run.

## The runs planned

- **The pilot, 20 runs** (`eval2/eval.json`): one repeat, in both arms, of 8 single questions (16 runs) and of one task session per repo (4 runs).
  - The singles, per repo a big-picture question, a chain and two grep-hard questions (impact and one other): VS Code `vscode-bp4`, `vscode-cn3`, `vscode-impact` and `vscode-pairs`; AFFiNE `affine-bp1`, `affine-cn1`, `affine-impact` and `affine-entries`. They run with `npm run eval:run -- --eval eval2 --pilot`.
  - The sessions, `vscode-s1` and `affine-s1` (`pilotSessions` in `eval2/eval.json`), run with `npm run eval:run -- --eval eval2 --sessions --pilot`: one repeat of each, in both arms.
  - These sessions are the runner's first against Claude Code itself (only Task 9's probe ran before). They also show whether `--max-turns` counts per message or per process, and what hitting `--max-budget-usd` does to a session.
  - Then each run's usage and the extrapolation are reported, and **the owner approves the full count.**
- **The full run:** 39 single questions (VS Code 21, AFFiNE 18) and 6 task sessions, in both arms, three times. That is 234 single runs (`npm run eval:run -- --eval eval2`) and 36 session runs (`npm run eval:run -- --eval eval2 --sessions`), the pilot's 20 among their first repeats. The sessions' 24 questions are asked only inside their sessions, never as single runs.
- **Expected usage:** Claude Code's list-price estimate is about $20–40 for the whole eval. Eval #1's 90 runs cost $4.88 and took at most 0.16 of one 5-hour window. The pilot measures the real share.

## The questions

Prompts are the same in both arms and never name Nebulosity. Each ends with its kind's format line, then the scripts sentence. The format lines are `eval2/questions.json`'s `formats`:
- lists, and the files nothing imports, violations and entries questions: Eval #1's list line;
- chains: Eval #1's chain line;
- big-picture: `Answer in at most 400 words.`;
- impact: `End with a line that says ANSWER: and then one line for each folder named above, in the same order, as the folder, a colon and the number of files, then a line elsewhere: and the number of files outside them, then a line total: and the number of files in all.`;
- cycle: `End with a line that says ANSWER: and then either the word none, or the cycle as file paths relative to the repository root, one per line, starting and ending with <file>, where each file imports the next.`, with the question's file in backticks in place of `<file>`;
- pairs: `End with a line that says ANSWER: and then one line for each pair, as the importing folder's name, then ->, then the imported folder's name.`

**The import rule** is Eval #1's sentence, unchanged: `Count a file if any of its import, export … from, side-effect import, import() or require() statements refers to it; type-only imports and test files count.`
- It ends every list, impact, files nothing imports, violations and entries prompt.
- It also ends every cycle and pairs prompt, introduced by `A file imports another when this rule counts it:`. Their truths count type-only imports as the rule says, and 5 of the 6 example cycles have an `import type` step, so the question has to state the rule.

"Refers to" is Eval #1's rule, with its three ways (see Eval #1's "The questions" below). A `declare module '…'` augmentation is not one of the rule's statements.

**The prompts' templates** were fixed in Task 14 so that both repos ask the same way. The table writes `<the import rule>` for the import rule's sentence. The kinds whose row doesn't show it end with the sentence on its own.

| Kind | Prompt |
|---|---|
| impact | If I change `<file>`, which code could it affect? Count every file that depends on it, directly or through other files, and say how many of those files are inside each of these folders: `<f1>`, `<f2>`, …, and how many are elsewhere. |
| cycle | Is `<file>` part of an import cycle, a chain of imports that leads from it back to itself? If it is, give the shortest such cycle. A file imports another when this rule counts it: `<the import rule>` |
| files nothing imports | List every file in `<folder>` that no other file in the repository imports. Leave out test files. |
| violations | List every file in `<folderA>` that directly imports a file in `<folderB>`. |
| entries | Which files that no other file imports end up loading `<file>`, directly or through other files? Leave out test files. |
| pairs | Code under `<folder>` sits in folders named `<n1>`, `<n2>`, …. For each of these names, which of the names do its files import from? Count a pair when at least one import goes that way; a file belongs to the deepest of these names on its path. A pair may be a name with itself, when files under one such folder import others under the same name. A file imports another when this rule counts it: `<the import rule>`. For a folder's children: Which of the folders directly inside `<folder>` import from which others? A file imports another when this rule counts it: `<the import rule>` |
| lists, chains | Eval #1's wordings. AFFiNE's four chains take Eval #1's four chain wordings in order. Every session chain is: Give the shortest chain of imports from `<entry>` to `<file>`. |
| a session's first question | I'm about to change `<file>`. followed by the impact template for the same file. |

**Test files.** A test file has a folder named `test`, `tests` or `__tests__` on its path, or `.test.` or `.spec.` in its name. Fixtures, stories and e2e helpers outside a test folder are not tests. "Leave out test files" uses this rule. Impact, the lists and violations count test files, as the import rule says.

**Files nothing imports** are files no statement of any file names, counted over every code file: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs`, `.d.ts` and build-config files included.
- It means imported by no file, not unreachable.
- A process's or a worker's main that is started by name counts, because no import statement names it. Examples: VS Code's `ptyHostMain.ts` and `notebookWebWorkerMain.ts`, and the process mains among VSCODE-ENTRIES' roots.

### VS Code: 21 single questions

Eval #1's 15 come first, with their ids prefixed and their prompts unchanged. Their truths and rubrics are Eval #1's, copied (see "How the truths were made and checked"). Six grep-hard questions follow.

| Id | Kind | Asks about | Truth |
|---|---|---|---|
| VSCODE-BP1–BP5 | big-picture | Eval #1's BP1–BP5 | 8, 6, 5 (of 6), 8 and 6 rubric points that hold |
| VSCODE-CL1, CL2, CL3, CL5 | direct list | Eval #1's | 22, 41, 3 and 57 files |
| VSCODE-CL4 | transitive list | Eval #1's | 66 files, 10 of them direct |
| VSCODE-CN1–CN5 | chain | Eval #1's | 4 steps, 5, 4, none and 3 |
| VSCODE-IMPACT | impact | `src/vs/platform/storage/common/storage.ts`, per `src/vs/base`, `src/vs/platform`, `src/vs/editor`, `src/vs/workbench`, `src/vs/sessions`, `src/vs/code` and `src/vs/server` | 4,503: 0 / 224 / 183 / 3,274 / 780 / 11 / 6, and 25 elsewhere |
| VSCODE-CYCLE | cycle | `src/vs/workbench/contrib/chat/common/languageModels.ts` | 4 steps |
| VSCODE-UNUSED | files nothing imports | `src/vs/sessions/browser` | 4 of its 87 non-test files |
| VSCODE-VIOLATIONS | violations | `src/vs/workbench/services` → `src/vs/workbench/contrib` | 5 files, all tests |
| VSCODE-ENTRIES | entries | `src/vs/platform/environment/node/argv.ts` | 9 files |
| VSCODE-PAIRS | pairs | the seven environment names under `src/vs`: `common`, `browser`, `node`, `electron-browser`, `electron-utility`, `electron-main` and `worker` | 21 pairs |

### AFFiNE: 18 single questions

| Id | Kind | Asks about | Truth |
|---|---|---|---|
| AFFINE-BP1 | big-picture | What are the main parts of the AFFiNE repository and what is each one for? Say which apps are built from it, what the server is for and what it needs to run. | 8 of 10 rubric points hold |
| AFFINE-BP2 | big-picture | How is BlockSuite, the editor framework under `blocksuite/`, structured: what are its main packages and kinds of components, and how does the AFFiNE app use it? | 8 of 8 |
| AFFINE-BP3 | big-picture | In BlockSuite, how is a block type defined, rendered and plugged into an editor? Name the functions, classes and conventions involved. | 8 of 11 |
| AFFINE-BP4 | big-picture | How does AFFiNE represent, store and sync a document's content: what form does the data take, how do local edits and other users' changes reach the editor, and where is the data kept on the device and synced to? | 8 of 9 |
| AFFINE-CL1 | direct list | `packages/frontend/electron-api/src/index.ts` | 26 files |
| AFFINE-CL2 | direct list | `packages/common/infra/src/op/index.ts` | 24 files |
| AFFINE-CL3 | direct list (a folder's outside importers) | `blocksuite/affine/widgets/slash-menu` | 34 files |
| AFFINE-CL4 | transitive list | `packages/frontend/core/src/mobile/modules/haptics/index.ts` | 56 files, 4 of them direct |
| AFFINE-CN1 | chain | `packages/frontend/apps/web/src/index.tsx` → `packages/common/nbstore/src/impls/idb/index.ts` | 4 steps |
| AFFINE-CN2 | chain | `blocksuite/playground/apps/starter/main.ts` → `blocksuite/framework/std/src/gfx/viewport.ts` | 5 steps |
| AFFINE-CN3 | chain | `packages/frontend/apps/electron/src/helper/index.ts` → `packages/common/nbstore/src/impls/sqlite/index.ts` | 4 steps |
| AFFINE-CN4 | chain | `packages/frontend/apps/electron/src/main/index.ts` → any file in `packages/frontend/apps/electron/src/helper` | none |
| AFFINE-IMPACT | impact | `packages/common/env/src/constant.ts`, per `packages/frontend/core`, `packages/frontend/apps`, `packages/common` and `tests` | 1,620: 1,398 / 104 / 38 / 76, and 4 elsewhere |
| AFFINE-CYCLE | cycle | `packages/common/infra/src/framework/core/components/service.ts`, in AFFiNE's own dependency-injection framework | 4 steps |
| AFFINE-UNUSED | files nothing imports | `packages/frontend/core/src/components/page-list` | 5 of its 70 non-test files |
| AFFINE-VIOLATIONS | violations | `packages/frontend/core` → `packages/frontend/apps` | 4 files |
| AFFINE-ENTRIES | entries | `packages/frontend/core/src/modules/organize/services/organize.ts` | 7 files |
| AFFINE-PAIRS | pairs (a folder's children) | the folders directly inside `packages/frontend` | 17 pairs |

### Task sessions: 6, with four questions each

Each session is about one area ("I'm about to change X"). Its four questions are asked in one Claude Code process, one message after another:
1. the impact of X;
2. the shortest chain from an entry point to X;
3. the shortest import cycle through X, or none;
4. the files nothing imports in X's folder.

The first question opens with "I'm about to change `<X>`." and goes on as the impact template does; the other three are the templates as they stand. Their targets differ from every single question's and from the dev set's (see "The overlap check").

| Session | X | Impact | Chain from | Cycle | Files nothing imports |
|---|---|---|---|---|---|
| vscode-s1 | `src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts` | 3,152, per `contrib/notebook` 225, `contrib/chat` 1,068, `workbench/api` 325, `src/vs/sessions` 703, and 831 elsewhere | `src/vs/workbench/api/node/extensionHostProcess.ts`: 4 steps | 3 steps | in `src/vs/workbench/contrib/notebook/common`: 1 of 29 |
| vscode-s2 | `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts` | 1,794, per `src/vs/editor` 46, `src/vs/workbench` 1,400, `src/vs/sessions` 336, and 12 elsewhere | `src/vs/sessions/sessions.web.main.internal.ts`: 6 steps, static imports only | 3 steps | in `src/vs/editor/contrib/inlineCompletions/browser`: 1 of 56 |
| vscode-s3 | `src/vs/platform/terminal/node/terminalEnvironment.ts` | 59, per `platform/terminal` 5, `platform/agentHost` 54, and 0 elsewhere | `src/vs/platform/agentHost/node/agentHostMain.ts`: 3 steps | none | in `src/vs/platform/terminal/node`: 1 of 13 |
| affine-s1 | `blocksuite/affine/blocks/database/src/database-block.ts` | 1,546, per `blocksuite/affine` 52, `blocksuite/integration-test` 20, `packages/frontend/core` 1,277, `packages/frontend/apps` 58, `tests` 112, and 27 elsewhere | `packages/frontend/apps/android/src/index.tsx`: 7 steps | 3 steps | in `blocksuite/affine/blocks/database/src`: 1 of 50 |
| affine-s2 | `packages/frontend/core/src/components/affine/ai-onboarding/apis.ts` | 681, per `core/src/blocksuite` 187, `core/src/components` 145, `core/src/desktop` 128, `core/src/mobile` 92, `packages/frontend/apps` 19, and 110 elsewhere | `packages/frontend/apps/electron-renderer/src/app/index.tsx`: 9 steps | none | in its own folder, `…/ai-onboarding`: 2 of 13 |
| affine-s3 | `blocksuite/affine/blocks/surface/src/surface-block.ts` | 2,192, per `blocksuite/affine/blocks` 230, `blocksuite/affine/gfx` 185, `blocksuite/affine/widgets` 73, `packages/frontend/core` 1,287, `tests` 201, and 216 elsewhere | `packages/frontend/apps/ios/src/index.tsx`: 6 steps | 4 steps | in `blocksuite/affine/blocks/surface/src`: 2 of 79 |

For vscode-s1 and vscode-s2, "X's folder" is X's area: the parent of the `model/` folder X sits in, which has no such file. `eval2/sessions.json` gives each session a title ("I'm about to change the notebook cell model"), which is a record only: the runner sends the four prompts.

### The overlap check (R1)

`npm run eval:overlap` compares the targets of every question with the dev set's, and the targets of every session question with every single question's. A question's targets are the file or folder it asks about, a chain's two ends and a violation's two folders. The folders an impact question counts by and a pairs question's names are not targets. On the final `eval2/questions.json` (63 questions with 76 targets, Eval #1's 15 copies and AFFiNE's big-picture prompts included, against the dev set's 16 questions and 20 targets), it printed nothing.

## How the truths were made and checked

The truth never comes from Nebulosity's index (R2).
- **Eval #1's truths are copied unchanged.** Its 15 VS Code truths and five rubrics are in `eval2/truth/vscode-<id>.json` and `eval2/rubric/vscode-<id>.json`. Only each file's `id` changed (`cl1` → `vscode-cl1`, and so on); the rubric points keep their ids (`BP1.1`, …). How they were made and checked is in Eval #1's section below.
- **Two independent extractors, and the eval's own resolver.**
  - The regex scanner (`scripts/eval/scan.ts`) and TypeScript's `preProcessFile` (`scripts/eval/ts-graph.ts`) read each repo's import statements.
  - Both resolve through `scripts/eval/resolve-truth.ts`, written from ADR-053's text: relative paths, declared workspace packages and their `exports`, module ids read against the folders that hold a tsconfig (R3), and compiled paths mapped to their sources.
  - None of the four files imports anything from `lib/`, and a test pins that.
  - VS Code: 14,849 code files. The scanner finds 139,696 edges and `preProcessFile` 139,681; the truth's graph has 139,687 after the verdicts.
  - AFFiNE: 6,987 code files, with 26,262 and 26,266 edges.
- **Every disagreement and every computed site was read in the source.**
  - VS Code had 15 edges only the scanner finds, and none only `preProcessFile` finds. AFFiNE had 4 only `preProcessFile` finds. A sweep listed 13 computed `import(<name>)` sites (11 and 2).
  - Each was read at the pinned commit and decided in `eval2/truth/adjudicated.json`, with the line that decides it: 32 verdicts, 6 "in" and 26 "out", none left open.
  - The six "in": two `export * as` re-exports and an `import()` with a comment before its specifier, which are statements `preProcessFile` misses; and three computed loaders whose address the code around them pins to one file (`workbench.ts` L517, `sessions.ts` L130, `cli.ts` L141), counted the way Eval #1's owner ruling counted CL4's loaders.
  - The "out": import lines inside strings and template literals, a JSDoc comment, four `declare module '…'` augmentations, and computed sites that load a parameter, a URL, a temporary file or an npm package.
  - Only the three loader verdicts change any truth: VSCODE-IMPACT, VSCODE-ENTRIES and the impact questions of sessions vscode-s1 and vscode-s2. Without the `cli.ts` verdict, `cliProcessMain.ts` would be a tenth root in VSCODE-ENTRIES.
- **Every list entry, chain step and cycle step was read**, as in Eval #1. The evidence sheet cites 420 import lines, and a fixed-seed sample adds 30 truth edges per repo. The independent reader (below) read each one at its line in the repo and confirmed all of them: each is a real statement that resolves to the named file.
- **Impact totals of thousands of files were checked by method and sample, not entry by entry** (R2's stated change). An independent walk on an independent graph reproduced every line of all eight impact truths, and 10 dependents per truth were traced step by step to the target, reading each import line.
- **A third graph.** The independent reader built one from TypeScript's own parser (its syntax tree, not `preProcessFile` and not a regex), with a resolver of its own written from each repo's `package.json` files and tsconfig folders. It shares no code with `scripts/eval` or `lib`. On it, all 44 new truths came out identical. The first run differed on three AFFiNE impact totals: three electron tests import `@affine/electron/helper/…`, and the reader's resolver was stricter than the truth's. The electron package's vitest config aliases that name to its `src/`, so the truth was right.
- **Nebulosity's index was consulted only for candidates**, read-only, after the truths were built. On the index, 41 of the 44 truths come out the same. The 3 that differ were read in the source, and the truth is right each time. The differences come from two gaps in the index, listed under "Decisions made since the plan".
- **The computed-site sweep's reach.** The sweep lists only `import(<name>)`. 35 other non-literal `import()` sites in VS Code and 1 in AFFiNE pass an expression instead, such as `keyboardLayoutService.ts` L463, and are not listed. Counting every one of them as "in", the widest reading, changes no truth.
- **Who read what.** Claude models did the reading; no person read every entry.
  - One Opus subagent picked the targets, built the truths, and read and decided every disagreement and computed site.
  - A second, fresh Opus subagent was the independent reader. It read every cited line and the 60 sampled edges, re-read all 32 verdicts (it agreed with each), built the third graph and marked each truth `verified: true`.
  - The session that ran the eval read a sample itself: two of VSCODE-VIOLATIONS' entries, a search for violations the truth might miss (none), and AFFINE-CYCLE's four steps.
- **AFFiNE's rubrics** come from AFFiNE's own docs at `0b69a6da`:
  - the README, `docs/contributing/tutorial.md`, `docs/BUILDING.md` and `docs/developing-server.md`;
  - the server's and nbstore's READMEs, and the ext-loader and lit-react readmes;
  - BlockSuite's docs site, which is in the repo (`blocksuite/docs-site`).

  The website added nothing: its contributing page has no architecture text, and a second page returned HTTP 402.
  - One Opus subagent checked every point in the source at the pinned commit, and the independent reader re-checked each one.
  - 32 points hold, 8 per question, and are graded.
  - 6 doc claims don't hold. They stay in the files as `holds: false` and are not graded: OctoBase as the backend or the database (twice), workspace plugins in a package that no longer exists, block roles that enforce nesting, a `BlockService` for every block type, and props that must not be `undefined`.
  - 12 holding points were rewritten from the docs' outdated names to what the code bears out, each saying how in its `note`.
  - The re-check found no point text wrong. It found four slips in the ungraded `check` notes (two counts, an incomplete list of importers, a missed stories file), corrected when the rubrics were copied in.

## Scoring

`npm run eval:score -- --eval eval2` scores everything but the big-picture answers, each repo against its own truth graph and verdicts (`scripts/eval/score.ts` and `answer.ts`).
- **Reading an answer:** as in Eval #1. The scorer reads the text after the last `ANSWER:` line, reads files tolerantly, and matches them without regard to case.
- **Direct and transitive lists:** recall, with precision beside it, as in Eval #1.
- **Chains:** as in Eval #1. 1 for a valid shortest chain or a right "none", 0.5 for a valid longer chain, 0 otherwise. A step is an import when the truth's own graph has it (the scanner's edges with `adjudicated.json`'s verdicts applied, the graph the truths were built from), and not one when a verdict took it out. A step that neither knows waits to be read in the source and decided in `eval2/truth/steps.json`: the scorer prints each such step with its repo and the verdict to fill in, and reads that file after `adjudicated.json`. The truth builder never reads it: a model's step is often one neither extractor finds, which the builder's own check refuses.
- **Impact:** the mean, over the truth's lines (each named folder, then elsewhere, then total), of max(0, 1 − |answer − truth| / max(truth, 1)). A line the answer lacks scores 0. A number may carry thousands separators or a "~".
- **Cycle:**
  - 1 for a valid cycle of the shortest length or a right "none", 0.5 for a valid longer cycle, 0 otherwise.
  - Valid means it starts and ends at the file and every step is an import.
  - A step nobody has read waits, as a chain's does.
  - A cycle shorter than the truth's, or a valid one where the truth says none, is flagged for a recheck of the truth.
- **Files nothing imports, violations and entries:** F1 of the listed files against the truth's. A listed path that isn't a file of the repo counts as a false positive and is flagged, when it reads as a file: its last name has an extension, and it isn't one of the question's own folders. A folder named in a lead-in ("Unused files in `src/vs/base/common`:") or a slash-word like "and/or" lists nothing, and neither does an entries question's target named in a lead-in, unless the truth holds it. A grading-time "out" in `steps.json` on an edge an approved truth rests on is printed as a recheck of that truth; the truth stays as approved until the owner rules.
- **Pairs:** F1 over the pairs (`a -> b`), with names compared in lowercase.
- **Big-picture:** as in Eval #1 (R4). A blind grader per answer sees only the points that hold and the answer. A second blind grader grades every answer, and the owner rules on each point where the two disagree.
- **Task sessions:** each message is scored as its question.
  - A message never answered (the session ended first) scores 0, and so does one that hit a limit.
  - A session's score is the mean of its messages' scores.
  - Its cost is Claude Code's total for the process, and its time is the sum of its messages' `duration_ms`.
- **Reported per run:**
  - the score;
  - tokens, summed over every model, with the main conversation's apart;
  - the cost estimate (`total_cost_usd`) and `duration_ms`;
  - turns, tool calls by tool, and Nebulosity calls;
  - the first call's context;
  - the 5-hour and 7-day utilization;
  - the flags.

  The tables show each question and arm, each repo and kind, and each repo's sessions.

## The ship gate (D1)

Eval #2 has two arms: **A**, Claude Code alone, and **N**, Claude Code with Nebulosity registered the way `nebulosity setup` registers it. `scripts/eval/gate.ts` computes the gate from `eval2/results.json`.

Every condition below must hold.

| # | Condition | Measured over | Eval #1 |
|---|---|---|---|
| 1 | **Better results where it should matter:** N's mean score ≥ A's mean + 0.15, and no grep-hard question where N's mean is below A's by more than 0.05 | the grep-hard questions of both repos, every run pooled | no such family |
| 2 | **No losses elsewhere:** N's mean ≥ A's mean − 0.03 | each repo × each of big-picture, lists (direct and transitive) and chains | big-picture −0.09, lists −0.04: fails |
| 3a | **Efficiency on graph questions:** N's median cost estimate ≤ 0.5 × A's, and N's median wall time ≤ 0.5 × A's | each repo's chain, transitive-list and grep-hard runs | chains 31% and 36% |
| 3b | **No overhead elsewhere:** N's median cost estimate ≤ 1.15 × A's | each repo's big-picture and direct-list runs | 105% and 82% |
| 4 | **Sessions:** N's total cost estimate ≤ 0.6 × A's, N's total wall time ≤ 0.6 × A's, and N's mean session score ≥ A's − 0.03 | each repo's task-session runs | no sessions |
| 5a | **Tools used:** the share of N's runs that call a Nebulosity tool ≥ 0.90 | N's list, chain and grep-hard runs, both repos | 12 of 20 (0.60): fails |
| 5b | **Cheaply:** N's median first-call context − A's ≤ 2,500 tokens | each repo, every single run | +478 at the default; +13,547 up front |

- **Score** is the question kind's score (D2). A mean is over every run of the set (questions × repeats), and medians are too. A session's score is the mean of its questions' scores.
- **Cost estimate** is Claude Code's `total_cost_usd`; wall time is `duration_ms`.
- **First-call context** is the first assistant message's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- A run that hits its turn or budget limit scores 0 and counts. Outages are re-run (Eval #1's rule).

**Written before the first run; it does not change after.**

How `scripts/eval/gate.ts` computes it:
- **Its inputs.** The scored single runs and task sessions of arms A and N. The scorer computes the gate only when the data is complete (every repo has runs, and every single question and every session has its three scheduled runs kept in both arms; a session's questions are expected only through its session runs) and no run waits for a grade or for a chain or cycle step to be read. Otherwise it prints "Not computed" and why.
- **The kinds.** Grep-hard is impact, cycle, files nothing imports, violations, entries and pairs. Graph questions are chains, transitive lists and the grep-hard kinds. "Other" is big-picture and direct lists. Condition 2's "lists" pools direct and transitive lists into one family per repo.
- **Condition by condition:**
  - 1 is computed over every grep-hard run of both repos, and per question (repo and id) for the 0.05 floor, reporting the worst question.
  - 2, 3a, 3b, 4 and 5b are computed per repo. Each fails when any repo fails, and reports the worst repo. A family with no runs of both arms on a repo is not compared there.
  - 4 uses each arm's totals over a repo's session runs (cost, and the sum of the messages' `duration_ms`) and the mean session score.
  - 5a counts N's direct-list, transitive-list, chain and grep-hard runs of both repos with at least one Nebulosity tool call.
  - 5b compares the medians over every single run that has a first call.
- **Numbers.**
  - A ratio over an A value of 0 is 0 if N's is 0 too, and infinite otherwise.
  - Comparisons use the unrounded values, with a tolerance of 1e-9. The printed values are rounded to 4 decimal places.
  - A condition with nothing to compare fails, so the gate never passes on no data.
  - The gate passes only when all seven conditions pass.

## Decisions made since the plan

- Repo 2 is AFFiNE at `0b69a6da`, the owner's pick at Task 1, from the probe's table.
- The scripts sentence is the owner's (2026-10-14, "Name the way that works (Recommended)"): `You may write Node.js scripts in <scratch> with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.` It replaces R6's, because 5 dev-set runs tried a script as a Bash heredoc and each was refused, and no run wrote one with Write. The dev set ran with R6's sentence, and stays as recorded.
- Each run's scratch folder is an opaque temp folder outside the checkout, archived beside the raw transcript and scrubbed. This replaces R6's location (`<checkout>/.nebulosity/eval2/scratch/<run name>/`), which pointed every run, in both arms, into the folder holding the eval's own answer key, and put the arm's name into the prompt.
- N's registration is the shape `nebulosity setup` writes, plus `NEBULOSITY_LIVE: "off"`.
- Condition 2's "lists" pools the direct and the transitive lists. A family of one transitive question per repo (three runs an arm) would turn on a single run against a 0.03 margin.
- Wall time is the result's `duration_ms`, for single runs and sessions alike, as D1 defines it. Eval #1's tables used the process's wall clock, about 1–2 s more per run, and so does the D1 table's Eval #1 column. `duration_ms` leaves the process's start-up out of the measure, N's MCP server start-up included, which leans slightly in N's favour on conditions 3a and 4 (see "Threats to validity").
- Every cycle and pairs prompt states the import rule, introduced by "A file imports another when this rule counts it:", and the named-folder pairs prompt says a name may pair with itself (Task 14's review, the controller's ruling). Their truths use those definitions: the example cycles of 5 of the 6 cycle questions with a cycle have an `import type` step (AFFINE-CYCLE's `service.ts` has no cycle through value imports at all), 2 of AFFINE-PAIRS' 17 pairs come only from `import type`, and 7 of VSCODE-PAIRS' 21 pairs pair a name with itself. No truth, target or id changed.
- The gate is computed only on complete data: every repo, and every scheduled run kept in both arms.
- The truth's test rule and its set of files nothing imports are the ones under "The questions". The set counts every code file, `.d.ts` and build config included.
- Impact truths of thousands of files were checked by method and sample, not entry by entry (R2's stated change).
- The computed-site sweep lists only `import(<name>)`. 36 other non-literal sites (35 in VS Code, 1 in AFFiNE) are not listed; counting them changes no truth.
- The VS Code violations question moved from the plan's `src/vs/platform` → `src/vs/editor` to `src/vs/workbench/services` → `src/vs/workbench/contrib` (R1: the dev set used `src/vs/platform`). The new pair breaks VS Code's own rule, "No dependency from outside `contrib/` into `contrib/`" (`.github/instructions/source-code-organization.instructions.md` L44).
- Two gaps in the index, found while checking the answer key, were fixed before the freeze at the owner's decision (2026-10-14, "Fix before the freeze"; ADR-053, amended).
  - Files over 1 MB were skipped. They are now indexed for their imports only, up to 20 MB. Before the fix, the index found 4,501 dependents on VSCODE-IMPACT against the truth's 4,503, and 56 against 59 on vscode-s3's impact, with the `agentHost` line at 51 against 54.
  - `typeof import('…')` wasn't followed; now it is. Before the fix, the index found 1,446 against 1,546 on affine-s1's impact, with the `tests` line at 12 against 112.
  - The index now agrees with 44 of the 44 truths (41 before), and still with Eval #1's ten list and chain truths (BENCHMARKS.md, Index Benchmark #5). Both fixes follow the import rule (type-only imports and test files count); neither was tuned to a number.
- The truths were read by an independent reader, who also built a third graph (44 of 44 truths agree), and the session that ran the eval read a sample.
- AFFiNE's rubrics come from its own docs. The rubric's author listed 11 of the 32 graded points as answerable from training or the README. Two of the four questions are on BlockSuite.
- Each session's first question opens with "I'm about to change `<X>`.", X being the session's area file (Task 14's ruling). The other three prompts are the templates unchanged.
- A session's questions are asked only inside the session: the single-run schedule leaves them out (234 single runs, not 378), and the gate expects them only through the session runs. The pilot's sessions run by flag, `--sessions --pilot`, which reads `pilotSessions` (Task 14's ruling).
- The scorer files a question by its `kind` (a question file's `family` is the runner's key to its format line), and its per-family table gives each grep-hard kind a row of its own. Eval #1's tables are unchanged by this: its re-score's output is byte-identical.

## Threats to validity

- **Scripts let both arms write their own import walkers.** The baseline can compute in Node.js what Nebulosity's tools compute, which narrows any gap. That is the point of allowing it: Eval #1's caveat was a baseline that couldn't script. The pilot shows whether a baseline run actually scripts under the new sentence.
- **The model may know VS Code from training.** VS Code also ships its own guide for agents (`AGENTS.md`, which points to a 158-line architecture overview), and in Eval #1 that helped Claude Code alone. AFFiNE is the repo without one. VS Code's 15 questions are Eval #1's again: comparable across the two evals, and already near the ceiling for Claude Code alone.
- **Repo 2's rubric is the project's own docs, as corrected by the code.**
  - The docs are partly outdated, and every arm can read them. A claim that no longer holds isn't graded, so repeating it costs nothing, unless the answer contradicts a holding point.
  - AFFiNE and BlockSuite are popular public projects, and BlockSuite's docs site is likely in training data. The rubric's author listed 11 of the 32 points as answerable from memory or the README (AFFINE-BP1.1–BP1.3, BP1.5, BP2.2, BP2.4, BP2.6, BP4.1, BP4.2, BP4.5 and BP4.8).
  - Two of the four questions (BP2, BP3) are on BlockSuite, and BP4's first half is BlockSuite's store. The app layer (its dependency-injection framework, its modules) isn't asked about, because the framework has no prose docs to grade against.
- **The dev set and the eval share kinds, not targets.** The tools' wording was checked on the dev set's 16 questions, one of each kind per repo, with the same templates. The overlap check refuses any shared target, but the wording may suit these kinds better than a user's own questions.
  - VSCODE-PAIRS is the closest case: it widens the dev set's pairs question (`src/vs/platform`, 6 environment names) to `src/vs` with 7 names. The overlap check passes it by its definition, because a pairs question's target is its folder and `src/vs` isn't `src/vs/platform`.
  - No tool wording was tuned on the dev set: Task 13 changed none.
  - The dev set's cycle and pairs prompts didn't state the import rule. Eval #2's do.
- **Three repeats is still a small sample.** Repeats of one arm differ, and the tables will show every run. Each grep-hard kind has one question per repo, so condition 1's floor of −0.05 per question turns on three runs an arm.
- **D1's thresholds are the owner's, set after Eval #1**, knowing where Eval #1 fell short. They were fixed with the plan, before Eval #2's questions existed, and they don't change after the first run.
- **The truths were read by models, and no person read every entry.** A misreading shared by the readers is possible. The third graph lowers the odds of a graph error, but not of a misread rule.
- **Two index fixes were found through the answer key.** Files over the size cap and `typeof import('…')` were found by comparing the index with Eval #2's truths, and fixed before the freeze (see "Decisions made since the plan"). Each follows the stated import rule, but the eval's own key is what found them, so they favour N on the three impact questions they touch: VSCODE-IMPACT, vscode-s3's and affine-s1's.
- **Type-only edges carry weight.** An answer that drops type-only imports loses these, but the rule, which every one of these prompts states, says they count:
  - all 4 of AFFINE-VIOLATIONS' files are `import type`;
  - the 112 `tests` dependents in affine-s1's impact reach the target only through one `typeof import('@blocksuite/affine/blocks/database')`;
  - the example cycles of 5 of the 6 cycle questions with a cycle have an `import type` step (VSCODE-CYCLE, the vscode-s2 and affine-s1 cycles, AFFINE-CYCLE and the affine-s3 cycle; only vscode-s1's is all value imports);
  - 2 of AFFINE-PAIRS' 17 pairs come only from `import type`.

  VSCODE-PAIRS also counts 7 pairs of a name with itself (`common -> common`, …) among its 21, which its prompt now says may count.
- **Wall time leaves out start-up.** Wall time is `duration_ms`, Claude Code's own measure of the work, as D1 defines it. It leaves out the process's start-up, N's MCP server start-up included (about 0.7 s in MCP Benchmark #1, V1.4), which leans slightly in N's favour on conditions 3a and 4. Eval #1's tables, and the D1 table's Eval #1 column, used the process's wall clock instead.
- **Files started by name count as files nothing imports.** An answer that leaves out a process's main "because it is an entry point" disagrees with the rule as written. The answers to vscode-s1's and vscode-s3's last questions are such files.
- **AFFiNE's impact sizes ride on barrel files.** Most of AFFINE-IMPACT's 1,620 come through `@toeverything/infra`'s index. A count reasoned from "who uses this symbol" undercounts badly, in either arm.
- **The session chains run long.** affine-s2's chain is 9 steps, affine-s1's 7 and vscode-s2's 6. These are the costliest for the baseline, which is the point of the kind.
- **The big-picture answers are graded by models**, as in Eval #1. The owner rules only where two blind graders disagree.
- **No shared prompt cache between the arms** (their tool lists differ), so a pair's first arm may meet a colder cache or an earlier hour. The arms alternate for that reason.

## Results

Results: to come after the runs.

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
  - *Correction (2026-10-14, V1.6's Task 3):* most of those 13,000 tokens were Claude Code's own tools, not Nebulosity's. `ENABLE_TOOL_SEARCH=false` loads every deferred tool, and Claude Code defers its own (cron, worktree, workflow, messaging and others) as well as MCP tools. With no MCP server at all, on Claude Code 2.1.300, turning tool search off raised the first call's context from 20,604 to 31,559 tokens (+10,955). Nebulosity's seven definitions and its instructions measure about 2,000 tokens (7,167 characters). V1.6 loads only Nebulosity's tools up front (ADR-056).
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
- **What loading up front did to the scores.** It raised the tools' use but not the scores: U's big-picture score was the lowest of the three. On lists, U removed CL1's miss and added CL5's. V1.6's `alwaysLoad` fix would make the tools available in every run, and this eval says that alone doesn't make the answers better than Claude Code's own. (The token cost of U is mostly Claude Code's own tools: see the correction under "The losses".)

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
