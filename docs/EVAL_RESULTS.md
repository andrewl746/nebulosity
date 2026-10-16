# 2026 10 16 Eval #3 — Claude Code with and without Nebulosity, on VS Code, AFFiNE and Theia

**Status: run, scored and published (2026-10-16): 378 runs (366 single, 12 task sessions) on Claude Code 2.1.301, with the engine frozen at `2f913ad` (2026-10-16, before the pilot). The ship gate failed: conditions 1, 2, 3 and 5. The results, losses included, are under "Results" at the end of this section.** Everything in this section down to "Results", apart from this status line and the "In short" block below it, was written before the first run: the arms, the setup, the questions and their truths, the scoring, time to relevant context and the ship gate. The gate does not change after the first run.

**In short:** the ship gate failed. Conditions 1, 2, 3 and 5 failed; V, 4 and 6 passed.
- *The comparison was clean:* Claude Code alone had a refused command in 9 of its 189 runs and Claude Code with Nebulosity in 8 of 189, under V's 5% (Eval #2: 81 and 18 of 135).
- *What V1.7 aimed at didn't happen.*
  - On the new questions, with Nebulosity Claude Code reached the files an answer needs no sooner than alone: median ratios 0.98, 1.01 and 1.04 on VS Code, AFFiNE and Theia, where the gate asked for 0.25.
  - On the questions about calls through injected services and the tasks, it took 0.88–0.98 of the time and 0.98–1.01 of the cost, where the gate asked for 0.5.
  - Its mean error on the new questions was 1.36 times Claude Code alone's, not half (scores 0.983 against 0.988).
  - It called a Nebulosity tool in 80 of 138 runs (0.58), and `calls` in 24 of its 66 call and task runs.
- *Why, from the transcripts:* nearly every run in both arms began with a `git grep` for the method's name, which on these questions names most of the answer at once. On AFFiNE the calls index missed most callers of the drawn methods, so the runs that called `calls` grepped anyway.
- *What it measurably did was the import walk.* On Eval #2's graph questions, now without refusals in either arm, it took 0.63 (VS Code) and 0.38 (AFFiNE) of the time per question, at 0.92 and 0.56 of the cost, scoring 1.00 against 0.98. On Theia's held-out graph questions it took 0.58 of the time at 0.95 of the cost (0.978 against 1.000). It reached those questions' files in 0.41 and 0.33 of the time.
- *No loss elsewhere* held within the gate's margins (big-picture +0.066, +0.003 and −0.021; the sessions level), and the per-turn cost was 2,368–2,372 tokens.

Eval #3 asks whether Claude Code reaches the files a question needs faster, answers better, and spends less with Nebulosity's MCP server than without it, on three big repos. Two of the repos are Eval #2's. The third, Theia, is held out from all tuning and indexed in free mode. It adds what Eval #2 lacked:
- questions about calls through injected services, which grep can't answer cheaply: who calls a method, what breaks if its signature changes, who has to adopt a change, where a service is injected, and planning a signature change;
- a measure of how fast each arm reaches the relevant context;
- a rules sentence against the refused commands that confounded Eval #2's comparison.

Losses will be reported beside wins. The decisions are ADR-060, which amends ADR-057. The plan is `docs/plans/2026-10-15-v1-7-calls-and-context.md` (D1, D2, the rulings R-A to R-AL, and Tasks 14–18). Eval #2 stays whole below this section.

Where things are:
- The definition (repos, pins, arms, repeats, scripts, the rules sentence, the gate and the pilot): `eval3/eval.json`.
- The questions and format lines: `eval3/questions.json`. The two task sessions: `eval3/sessions.json`.
- The candidates and the draw: `eval3/candidates.json`, with Theia's graph candidates in `eval3/candidates-theia-graph.json.gz`.
- The truths: `eval3/truth/<id>.json`. The new ones are built from `eval3/truth-specs.json`.
  - The hand decisions on imports are in `eval3/truth/adjudicated.json` (Eval #2's 32, copied, then Theia's 37), and those on calls in `eval3/truth/calls-adjudicated.json`.
  - Grading-time verdicts on the models' chain and cycle steps go in `eval3/truth/steps.json`.
  - The files each answer needs, for time to relevant context, are in `eval3/truth/needed.json`.
- The rubrics: `eval3/rubric/<id>.json`.
- The dev set, which is never scored and whose targets appear nowhere here: `eval3/dev/`.
- The truth builder, the checker's call truths, the draw, the runner, the scorer and the gate: `scripts/eval/`.
- Kept transcripts will go in `eval3/runs/`, scrubbed, leak-scanned and gzipped. Raw ones and each run's scratch folder go in `.nebulosity/eval3/raw/`, which git ignores.

## The arms

- **A, baseline:** Claude Code alone, with its read-only built-in tools, its subagents, and Node.js scripts in a scratch folder (below).
- **N, Nebulosity:** the same, plus Nebulosity's MCP server.
  - It is registered the way `nebulosity setup` registers it, plus `NEBULOSITY_LIVE=off`, so no live event reaches the owner's Map.
  - It has seven tools (ADR-056 as amended, ADR-059): `overview`, `describe`, `search`, `imports`, `architecture`, `calls` and `show_on_map`.
  - The six that answer questions carry `_meta["anthropic/alwaysLoad"]: true`, so they load without ToolSearch. `show_on_map` stays deferred.
  - The registration carries no `alwaysLoad`.
  - It answers about the index of the repo the run is in. Theia's index is in free mode (R-K): structure, imports and calls, with no summaries.

A and N differ only in the MCP config file. The prompts, the scratch folder's rules and everything else are the same, and no prompt names Nebulosity.

## Setup

| What | Value |
|---|---|
| Claude Code | 2.1.301 in `eval3/eval.json`'s `claudeVersion`, pinned at the pilot (Task 19): `claude --version` said 2.1.301, so the pin didn't move since the shell check (Task 15). The guard probe and the dev set ran on 2.1.301. The runner refuses to start on any other version, and refuses any run whose init message reports another. |
| Model | `claude-sonnet-5-5` (R-E) |
| Effort | `medium` |
| Limits | A single run: 80 turns, $4 (Claude Code's estimate) and 30 minutes. A task session: one budget of $10 for its four messages, and 60 minutes. |
| Repos | VS Code at `cc3fec8846d0e678357e476fa611774da26d7e24` (`../vscode`). AFFiNE at `0b69a6da21e8fd35beb85667bb8496d9b3852238` (`../affine`). Theia at `81ea5f939c40c905de91083d07e284bfd7437fac` (`../theia`): the head of `master` when it was cloned on 2026-10-15, a shallow clone of 4,530 tracked files, held out. The runner stops if any HEAD is anything else. |
| Nebulosity's engine | Frozen at `2f913ad` (`EVAL3_ENGINE`), the commit the pilot starts from (R-N). Nothing in `lib/engine`, `lib/tools`, `lib/index`, `lib/db`, `lib/home.ts`, `lib/config.ts` or `mcp/` changes from then until the results are committed. A bug found in that time is recorded, not fixed, and reported with the results. |
| Nebulosity's index | The owner's database, current at adapter version 7 for all three repos (VS Code and AFFiNE re-indexed in Task 5, Theia indexed in Task 17; nothing that changes stored facts has changed since, so no re-index): VS Code and AFFiNE with summaries, Theia in free mode (3,772 files and 19,979 import edges, Variety Benchmark #2). The pilot's dry run (2026-10-16) read the index versions VS Code 155, AFFiNE 134 and Theia 2. Every run records the version it saw, and the server opens the database read-only. |
| Working folder | The repo the question asks about. |

### The command

The prompt goes on stdin. A task session writes its four prompts as stream-json user messages, each one after the previous answer's result. Everything is the same in both arms except the file after `--mcp-config`.

```
claude -p --output-format stream-json --verbose
  --model claude-sonnet-5-5 --effort medium
  --max-turns 80 --max-budget-usd 4
  --setting-sources project,local
  --strict-mcp-config --mcp-config <A: eval3/mcp/empty.json, N: .nebulosity/eval3/mcp-nebulosity.json>
  --permission-mode dontAsk --permission-prompts none
  --allowedTools Read,Grep,Glob,Agent,Bash(git grep:*),Bash(git ls-files:*),Bash(git log:*),Bash(git show:*),
                 Bash(rg:*),Bash(grep:*),Bash(ls:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*),
                 Bash(sort:*),Bash(uniq:*),Bash(find:*),mcp__nebulosity,Bash(node:*),Edit(//<scratch>/**)
  --disallowedTools NotebookEdit,WebFetch,WebSearch,Skill,PowerShell,Monitor
  --add-dir <scratch>
  --no-session-persistence
```

- A task session runs the same command with `--max-budget-usd 10`, followed by `--input-format stream-json --replay-user-messages`.
- `<scratch>` is the run's own scratch folder, as in Eval #2: a fresh, empty, opaque folder per run, `<system temp folder>/eval-scratch/<16 random hex digits>/`, outside the checkout and every repo. The Edit rule writes its absolute path the way Claude Code's permission rules want it: `//c/…/eval-scratch/<hex>/**`.
- N's config file is Eval #2's: `{ "mcpServers": { "nebulosity": { "command": "node", "args": ["<checkout>/mcp/launch.mjs"], "env": { "NEBULOSITY_LIVE": "off" } } } }`. `eval3/mcp/empty.json` is `{ "mcpServers": {} }`.
- `eval3/eval.json` leaves `"shell"` unset, so the `"compound"` preset (`Bash(cd:*)`, `Bash(echo:*)`) stays off and no allow rule is added.

### The scripts rules and the rules sentence

**The scripts rules are Eval #2's.** `Bash(node:*)` is allowed, and so are edits under the run's scratch folder (`Edit(//<scratch>/**)`, with `--add-dir <scratch>`), which covers the Write tool too. Under `dontAsk`, any other edit and any other Bash command is refused. After the run the folder's contents are archived beside the raw transcript and the folder is removed, as in Eval #2.

**The rules sentence** (R-L) ends every prompt of both arms, after the format line, in place of Eval #2's scripts sentence. `<repo root>` and `<scratch>` are absolute paths in drive-letter form with forward slashes.
- As the plan pinned it (D2): `You're at the repository root, <repo root>: run grep, git grep, git ls-files, ls, cat, head and the like from here, without cd. To compute anything, write a Node.js script into <scratch> with the Write tool (the folder exists) and run it with node, or use node -e. Shell writes (redirects, heredocs, tee, sed -i, mkdir), loops, sed, awk, xargs and paths through .. are refused here. Don't change any file in the repository.`
- **The runs use the rewording**, the one R-L allows, made after the shell check's first round (2026-10-15): `You're at the repository root, <repo root>, and every command runs from there: never use cd, not even into a subfolder or the scratch folder, and name paths from the root instead (git grep -n foo -- src/a src/b). Allowed: grep, rg, git grep, git ls-files, git log, git show, ls, cat, head, tail, wc, sort, uniq, find and node, alone or piped into one another. Refused: cd, shell loops (for, while), echo, sed, awk, cut, xargs, redirects, heredocs, tee, mkdir and any path with .. in it. To check many files or compute anything, write a Node.js script into <scratch> with the Write tool (the folder exists) and run it with node and its full path, or use node -e. Don't change any file in the repository.`
- Why it was reworded: the first round refused 5 commands in 19 runs alone and 3 in 19 with Nebulosity, against a bar of 1 per 10 runs in each arm. The causes were shell loops (4), `cd` into a subfolder before `git grep` (2), a pipe into `sed` (1), and `cd` with `node -e` and a redirect (1). The allow list it names is the runner's, plus `node`.
- After the rewording, the six questions that had a refusal were run again in both arms. That gave 0 refused alone and 1 with Nebulosity (an `awk`, which the run dropped and answered). Counting the latest round of each question, the 19 dev questions stand at 0 refused alone and 1 with Nebulosity, so the shell check passes. No run gave up after a refusal. MCP Dev Set #2 in `docs/BENCHMARKS.md` has the rounds.
- **The guard probe** (Task 14, 2026-10-15) ran once. `cd /c/…/vscode; git ls-files | wc -l` was refused with "Permission to use Bash has been denied because Claude Code is running in don't ask mode." That is Claude Code's guard on cd-then-git, which caused 33 of Eval #2's 131 refusals. The sentence's "never use cd" is aimed at it.

### Isolation from the owner's own Claude Code setup

As in Eval #2, and on the owner's subscription, never an API key:
- `--setting-sources project,local` keeps out the owner's plugins, hooks, model and effort.
- `--strict-mcp-config` keeps out the repo's `.mcp.json`, the owner's own registration of Nebulosity and claude.ai connectors.
- The child's variables are set and removed as in Eval #2's "Isolation" (the Git Bash path, PowerShell off, auto memory off, claude.ai MCP servers off, the auto-updater off, `NEBULOSITY_LIVE=off`; no API key or auth token, and no `CLAUDE*`, `ANTHROPIC_*` or `MCP_*` name). The runner prints the removed names, never their values.
- Every run is checked as in Eval #2's "Checked on every run, not assumed": the init message, each repo clean after the run, the checkout's status, the index version, the transcripts scrubbed and scanned, outages re-run, the usage windows. The arms' order alternates by question and by repeat.
- The repos' own guides stay, as they would for any user there:
  - VS Code's `AGENTS.md`;
  - AFFiNE has none at its root;
  - Theia ships a `CLAUDE.md` (133 lines: commands and architecture notes) and an `AGENTS.md` (148 lines) at its root.

  Both arms see the same files.

## The runs planned

- **The pilot, 28 runs (R-Y)**, one repeat in both arms of 12 single questions (24 runs) and of 2 task sessions (4 runs):
  - per repo, one breaks question, one task, one new big-picture question and one chain: `vscode-breaks1`, `vscode-task1`, `vscode-bp6` and `vscode-cn1`; `affine-breaks1`, `affine-task1`, `affine-bp5` and `affine-cn1`; `theia-breaks1`, `theia-task1`, `theia-bp1` and `theia-cn1`;
  - the sessions `vscode-s1` and `affine-s1` (`pilotSessions`), because in Eval #2 every session run by Claude Code alone had a refused command (18 of 18), and condition V counts sessions.

  They run with `npm run eval:run -- --eval eval3 --pilot` and `npm run eval:run -- --eval eval3 --pilot --sessions`. The pilot counts refusals against V before the full count is asked for. Then each run's usage and the extrapolation are reported (Task 19).
- **The full run:** 61 single questions (VS Code 25, AFFiNE 22, Theia 14) and 2 task sessions, in both arms, three times:

  | Repo | Single runs | Session runs | Runs |
  |---|---|---|---|
  | VS Code | 25 × 2 × 3 = 150 | 1 × 2 × 3 = 6 | 156 |
  | AFFiNE | 22 × 2 × 3 = 132 | 6 | 138 |
  | Theia | 14 × 2 × 3 = 84 | none | 84 |
  | **Total** | 366 | 12 | **378** |

  The pilot's 28 are among their first repeats, so 350 remain after it: 342 single runs and 8 session runs. The sessions' 8 questions are asked only inside their sessions, never as single runs.
- **378 runs, not the plan's 384.** AFFiNE has no adopt question: under R-X, with no adopt candidate passing, it draws a second callers question instead. It has 2 tasks, not 3: R-AF's shortfall, since its only other passing task (`Store.updateBlock`) shares its type with the drawn `Store.resetHistory`. Two tasks on one type would share most of their truth. R-X leaves the count as it was, and the shortfall takes off 6 runs.
- **Expected usage:** about $35–55 at list price (D2). Eval #2's 270 runs cost $22.26.

## The questions

Prompts are the same in both arms and never name Nebulosity. Each ends with its kind's format line, then the rules sentence. The format lines are `eval3/questions.json`'s `formats`:
- Eval #2's kinds keep Eval #2's lines (see Eval #2's "The questions").
- `callers`, `breaks`, `adopt` and `injects` take Eval #1's list line.
- `task` takes: `End with a line that says ANSWER CHANGE: and then every file to change, one path per line relative to the repository root; then a line that says ANSWER TESTS: and then every test file to run, one per line, with nothing after the list.`

**The call and task prompts** are `callPrompt(kind, target, change)` in `scripts/eval/prompts.ts` (Task 15), from D2's fixed stems and rules. A test pins every prompt to it (`scripts/eval/questions3.test.ts`). D2, verbatim:

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

**Theia's graph prompts** use V1.6's templates verbatim, and Eval #1's list and chain stems with the import rule where those carry it. Each is word for word as Eval #2 asked it (see Eval #2's "The questions"); a check rebuilt nine of Eval #2's prompts from the same templates, exactly.
- direct list: List every file that directly imports `<file>`. + the import rule;
- transitive list: List every file that depends on `<file>`, directly or through other files. + the import rule;
- chain: How does `<from>` end up loading `<to>`? Give the shortest chain of imports. (Eval #1's first chain wording; it carries no import rule);
- cycle, files nothing imports and entries: Eval #2's templates, the cycle's with the import rule after "A file imports another when this rule counts it:".

**Big-picture prompts** are the author's (below), each followed by Eval #1's format line, `Answer in at most 400 words.`

**Test files** are as in Eval #2: a folder named `test`, `tests` or `__tests__` on the path, or `.test.` or `.spec.` in the name. The call kinds count test files, as their rules say.

### VS Code: 25 single questions and one session

Eleven new questions, then Eval #2's fourteen, unchanged. The truths and rubrics of Eval #2's are copied byte for byte (see "How the truths were made and checked").

| Id | Kind | Target | Source | Truth |
|---|---|---|---|---|
| VSCODE-CALLERS1 | callers | `IKeybindingService.appendKeybinding` in `src/vs/platform/keybinding/common/keybinding.ts`, within `src` | PR microsoft/vscode#283994 | 34 files |
| VSCODE-CALLERS2 | callers | `IWorkbenchLayoutService.setPartHidden` in `src/vs/workbench/services/layout/browser/layoutService.ts`, within `src/vs/sessions` | PR microsoft/vscode#314572 | 12 files |
| VSCODE-BREAKS1 | what breaks | `ICodeEditor.restoreViewState` in `src/vs/editor/browser/editorBrowser.ts`, within `src` | PR microsoft/vscode#146866 | 13 files |
| VSCODE-BREAKS2 | what breaks | `ISpliceable.splice` in `src/vs/base/common/sequence.ts`, within `src` | PR microsoft/vscode#166751 | 44 files |
| VSCODE-ADOPT1 | adopt | `IFileDialogService.showOpenDialog` in `src/vs/platform/dialogs/common/dialogs.ts`, within `src` | PR microsoft/vscode#312751 | 33 files |
| VSCODE-INJECTS1 | injects | `IWorkbenchAssignmentService` in `src/vs/workbench/services/assignment/common/assignmentService.ts`, within `src` | `.github/skills/experiments/SKILL.md` L11 at the pin | 27 files |
| VSCODE-TASK1 | task | `ILanguageModelsService.sendChatRequest` in `src/vs/workbench/contrib/chat/common/languageModels.ts`, within `src` | PR microsoft/vscode#298767 | 15 files to change, 99 tests |
| VSCODE-TASK2 | task | `ITerminalInstance.runCommand` in `src/vs/workbench/contrib/terminal/browser/terminal.ts`, within `src` | PR microsoft/vscode#309346 | 11 files to change, 48 tests |
| VSCODE-TASK3 | task | `IContextKeyService.createScoped` in `src/vs/platform/contextkey/common/contextkey.ts`, within `src/vs/workbench/contrib` | PR microsoft/vscode#115890 | 42 files to change, 50 tests |
| VSCODE-BP6 | big-picture | How is VS Code tested: what kinds of tests does the repository have, where does each kind live, and how is each kind run? | VS Code's docs at `cc3fec88`: `.github/instructions/writing-tests.instructions.md`, the unit, integration and smoke test skills in `.github/skills/`, and the READMEs in `test/`, `test/unit`, `test/smoke`, `test/automation` and `test/sanity` | 8 of 8 rubric points hold |
| VSCODE-BP7 | big-picture | How does VS Code keep event listeners and other resources from leaking: which types and patterns does its code use to tie a resource's lifetime to its owner, and how are leaks caught? | VS Code's docs at `cc3fec88`: `.github/instructions/disposable.instructions.md`, `.github/skills/memory-leak-audit/SKILL.md`, `.github/instructions/coding-guidelines.instructions.md` and `.github/instructions/writing-tests.instructions.md` | 8 of 8 |
| VSCODE-BP1–BP5 | big-picture | Eval #2's (Eval #1's BP1–BP5) | VS Code's wiki page "Source Code Organization" | 8, 6, 5 (of 6), 8 and 6 rubric points that hold |
| VSCODE-CL1 | direct list | Eval #2's: `src/vs/workbench/contrib/search/common/search.ts` | Eval #1 | 22 files |
| VSCODE-CL4 | transitive list | Eval #2's: `src/vs/workbench/contrib/markers/common/markers.ts` | Eval #1 | 66 files, 10 of them direct |
| VSCODE-CN1 | chain | Eval #2's: `src/vs/workbench/workbench.desktop.main.ts` → `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts` | Eval #1 | 4 steps |
| VSCODE-IMPACT | impact | Eval #2's: `src/vs/platform/storage/common/storage.ts`, per seven folders | Eval #2 | 4,503 |
| VSCODE-CYCLE | cycle | Eval #2's: `src/vs/workbench/contrib/chat/common/languageModels.ts` | Eval #2 | 4 steps |
| VSCODE-UNUSED | files nothing imports | Eval #2's: `src/vs/sessions/browser` | Eval #2 | 4 of its 87 non-test files |
| VSCODE-VIOLATIONS | violations | Eval #2's: `src/vs/workbench/services` → `src/vs/workbench/contrib` | Eval #2 | 5 files, all tests |
| VSCODE-ENTRIES | entries | Eval #2's: `src/vs/platform/environment/node/argv.ts` | Eval #2 | 9 files |
| VSCODE-PAIRS | pairs | Eval #2's: the seven environment names under `src/vs` | Eval #2 | 21 pairs |

### AFFiNE: 22 single questions and one session

| Id | Kind | Target | Source | Truth |
|---|---|---|---|---|
| AFFINE-CALLERS1 | callers | `ViewExtensionManager.get` in `blocksuite/affine/ext-loader/src/view-manager.ts` | `blocksuite/affine/ext-loader/README.md` at the pin | 20 files |
| AFFINE-CALLERS2 | callers (R-X, for adopt) | `DocFrontend.addPriority` in `packages/common/nbstore/src/frontend/doc.ts` | PR toeverything/AFFiNE#15595 | 12 files |
| AFFINE-BREAKS1 | what breaks | `Editor.setMode` in `packages/frontend/core/src/modules/editor/entities/editor.ts` | PR toeverything/AFFiNE#7873 | 11 files |
| AFFINE-BREAKS2 | what breaks | `UIEventDispatcher.add` in `blocksuite/framework/std/src/event/dispatcher.ts` | PR toeverything/AFFiNE#14830 | 25 files |
| AFFINE-INJECTS1 | injects | `AuthService` in `packages/frontend/core/src/modules/cloud/services/auth.ts` | PR toeverything/AFFiNE#15308 | 78 files |
| AFFINE-TASK1 | task | `DocsService.createDoc` in `packages/frontend/core/src/modules/doc/services/docs.ts` | PR toeverything/AFFiNE#8291 | 11 files to change, 2 tests |
| AFFINE-TASK2 | task | `Store.resetHistory` in `blocksuite/framework/store/src/model/store/store.ts` | PR toeverything/AFFiNE#12131 | 21 files to change, 60 tests |
| AFFINE-BP5 | big-picture | How does AFFiNE store a document's content in edgeless (whiteboard) mode: how does it relate to the same document in page mode, where do shapes and drawings live, and how are position, stacking order and grouping represented? | BlockSuite's docs in AFFiNE at `0b69a6da`: `blocksuite/docs-site/components/editors/edgeless-data-structure.md` and `edgeless-editor.md`, and the surface, note and frame block pages | 8 of 8 |
| AFFINE-BP6 | big-picture | How does the AFFiNE app manage what's on screen: what are the workbench and its views, how does a URL become the content a view shows, and how do the header, the right sidebar and back/forward navigation fit in? | AFFiNE's docs at `0b69a6da`: `packages/frontend/core/src/modules/workbench/README.md` | 8 of 8 |
| AFFINE-BP1–BP4 | big-picture | Eval #2's | AFFiNE's and BlockSuite's docs | 8 of 10, 8 of 8, 8 of 11 and 8 of 9 |
| AFFINE-CL1 | direct list | Eval #2's: `packages/frontend/electron-api/src/index.ts` | Eval #2 | 26 files |
| AFFINE-CL4 | transitive list | Eval #2's: `packages/frontend/core/src/mobile/modules/haptics/index.ts` | Eval #2 | 56 files, 4 of them direct |
| AFFINE-CN1 | chain | Eval #2's: `packages/frontend/apps/web/src/index.tsx` → `packages/common/nbstore/src/impls/idb/index.ts` | Eval #2 | 4 steps |
| AFFINE-IMPACT | impact | Eval #2's: `packages/common/env/src/constant.ts`, per four folders | Eval #2 | 1,620 |
| AFFINE-CYCLE | cycle | Eval #2's: `packages/common/infra/src/framework/core/components/service.ts` | Eval #2 | 4 steps |
| AFFINE-UNUSED | files nothing imports | Eval #2's: `packages/frontend/core/src/components/page-list` | Eval #2 | 5 of its 70 non-test files |
| AFFINE-VIOLATIONS | violations | Eval #2's: `packages/frontend/core` → `packages/frontend/apps` | Eval #2 | 4 files |
| AFFINE-ENTRIES | entries | Eval #2's: `packages/frontend/core/src/modules/organize/services/organize.ts` | Eval #2 | 7 files |
| AFFINE-PAIRS | pairs | Eval #2's: the folders directly inside `packages/frontend` | Eval #2 | 17 pairs |

### Theia: 14 single questions, held out

| Id | Kind | Target | Source | Truth |
|---|---|---|---|---|
| THEIA-CALLERS1 | callers | `MenuModelRegistry.registerSubmenu` in `packages/core/src/common/menu/menu-model-registry.ts` | issue eclipse-theia/theia#7299 | 14 files |
| THEIA-BREAKS1 | what breaks | `ContextMenuRenderer.render` in `packages/core/src/browser/context-menu-renderer.ts` | `doc/changelogs/CHANGELOG-2022.md` L349 at the pin | 42 files |
| THEIA-BREAKS2 | what breaks | `PreferenceService.set` in `packages/core/src/common/preferences/preference-service.ts` | issue eclipse-theia/theia#16046 | 36 files |
| THEIA-INJECTS1 | injects | `EnvVariablesServer` in `packages/core/src/common/env-variables/env-variables-protocol.ts` | `CHANGELOG.md` L88 at the pin | 42 files |
| THEIA-TASK1 | task | `BackendApplicationContribution.onStop` in `packages/core/src/node/backend-application.ts` | `CHANGELOG.md` L433 at the pin | 11 files to change, 4 tests |
| THEIA-TASK2 | task | `CommandRegistry.isEnabled` in `packages/core/src/common/command.ts` | issue eclipse-theia/theia#18030 | 14 files to change, 22 tests |
| THEIA-CL1 | direct list | `packages/ai-core/src/common/language-model.ts` | the truth's import graph | 31 files |
| THEIA-CL2 | transitive list | `packages/scm/src/browser/scm-avatar-service.ts` | the truth's import graph | 86 files, 3 of them direct |
| THEIA-CN1 | chain | `packages/scm/src/browser/decorations/scm-navigator-decorator.ts` → `packages/core/src/browser/shell/current-widget-command-adapter.ts` | the truth's import graph | 3 steps |
| THEIA-CYCLE | cycle | `packages/core/src/common/index.ts` | the truth's import graph | 3 steps |
| THEIA-UNUSED | files nothing imports | `packages/ai-chat/src` | the truth's import graph | 2 of its 64 non-test files |
| THEIA-ENTRIES | entries | `packages/ai-core/src/browser/agents-md-frontend-application-contribution.ts` | the truth's import graph | 21 files |
| THEIA-BP1 | big-picture | How does Theia run VS Code extensions and Theia plugins: where does a plugin's code run, how does it get the `vscode` or `theia` API, and how do calls travel between a plugin and the rest of Theia? | Theia's docs at `81ea5f93`: `doc/Plugin-API.md` | 8 of 8 |
| THEIA-BP2 | big-picture | How is a Theia application put together from extensions: what is a Theia extension, how does it add code to the frontend and the backend, and how does an application pick its extensions, get built and start? | Theia's docs at `81ea5f93`: `packages/core/README.md`, `dev-packages/cli/README.md` and `doc/code-organization.md` | 8 of 8 |

Theia has no Eval #2 question and no session (R-I, R-W). Its big-picture questions test free mode's no-loss (R-K).

### The two task sessions, Eval #2's, unchanged

| Session | X | Impact | Chain from | Cycle | Files nothing imports |
|---|---|---|---|---|---|
| vscode-s1 | `src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts` | 3,152, per `contrib/notebook` 225, `contrib/chat` 1,068, `workbench/api` 325, `src/vs/sessions` 703, and 831 elsewhere | `src/vs/workbench/api/node/extensionHostProcess.ts`: 4 steps | 3 steps | in `src/vs/workbench/contrib/notebook/common`: 1 of 29 |
| affine-s1 | `blocksuite/affine/blocks/database/src/database-block.ts` | 1,546, per `blocksuite/affine` 52, `blocksuite/integration-test` 20, `packages/frontend/core` 1,277, `packages/frontend/apps` 58, `tests` 112, and 27 elsewhere | `packages/frontend/apps/android/src/index.tsx`: 7 steps | 3 steps | in `blocksuite/affine/blocks/database/src`: 1 of 50 |

### The overlap check (R1)

`npm run eval:overlap -- --eval eval3` compares every question's targets with the dev set's 19 questions, and every session question's with every single question's. A question's targets are what Eval #2's were (the file or folder it asks about, a chain's two ends, a violation's two folders). A call question's are also its type's file and the `Type.member` or type it names, so another method of a type the dev set asked about overlaps through the file. On the final `eval3/questions.json` (69 entries: 61 single questions and the sessions' 8), it printed nothing. The draw had already refused any candidate sharing a target with the dev set or with the two reused sessions.

## How the questions were sourced and drawn

Nobody saw how either arm, or Nebulosity's index, does on a candidate before the draw ran (design §5.4).

- **The collectors.** Three fresh Opus subagents, one per repo, collected the call and task candidates. They never called a Nebulosity tool, opened its database or counted a candidate's callers.
  - **Searches:** `gh search issues` and `gh search prs` on `microsoft/vscode`, `toeverything/AFFiNE` and `eclipse-theia/theia` (`--limit 100`), for each of the terms adopt, deprecate, rename, signature, parameter and remove. They read the promising results, and they read the repos' docs at the pins (CHANGELOGs, READMEs, docs folders).
  - **A candidate** is a class or interface `T` and, except for injects, a method `m`. Its source names both, and both are declared at the pinned commit, which was checked with `git grep`. Each records the source's URL and a quote of at most two sentences. VS Code's carry `within`: `src`, or a folder under it that the source names (R-R, R-AI).
  - **Excluded:** R-A's eight planning methods, and the dev set's targets.
- **The counts.**
  - VS Code, 65 candidates: callers 25, breaks 12, adopt 6, injects 8, task 14. 32 come from pull requests, 23 from issues and 10 from docs at the pin.
  - AFFiNE, 68: callers 21, breaks 20, adopt 7, injects 12, task 8. 42 come from pull requests, 3 from issues and 23 from docs. Its task pool is short of the 3× asked for, because AFFiNE's pull requests rarely state a signature change on a named `T.m`.
  - Theia, 92: callers 30, breaks 20, injects 24, task 18, and no adopt. 7 come from pull requests, 21 from issues and 64 from docs, mostly CHANGELOG entries at the pin.
- **Theia's graph candidates** are every qualifying target in the truth's own graph, by V1.6's rules (46,929 candidates, committed gzipped):
  - direct list: a file with 10–100 direct importers (293);
  - transitive list: a file with 10–100 dependents (773);
  - chain: an entry file and a file it reaches in 3–6 steps (44,891);
  - cycle: a file whose shortest cycle is 3–6 steps (126);
  - files nothing imports: a folder of 20–120 non-test files, 2–10 of them imported by nothing (61);
  - entries: a file that 5–30 non-test roots load (785).
- **The draw** (`npm run eval:draw -- --eval eval3`, `scripts/eval/draw.ts`, run 2026-10-16, 4 m 10 s):
  - **Sizing:** each call and task candidate gets its truth's size from TypeScript's checker (a task's is its CHANGE).
  - **Passing:** it passes when its size is 10–80 files, it isn't a planning method, and it shares no target with the dev set or the two reused sessions. A graph candidate keeps the pass its range gave it, and is checked for overlap.
  - **Drawing:** per repo and kind, in the order breaks, task, callers, adopt, injects, then the graph kinds, the passing candidates are sorted by id and shuffled with mulberry32(1); the first n are drawn.
  - **One type per repo (R-AF):** a type drawn once leaves the repo's later pools, within a kind too.
  - **R-X:** a repo with no passing adopt candidate draws one more callers question instead.

| Repo | Kind | Candidates | Passing | Drawn |
|---|---|---|---|---|
| VS Code | breaks | 12 | 9 | 2 |
| VS Code | task | 14 | 7 | 3 |
| VS Code | callers | 25 | 17 | 2 |
| VS Code | adopt | 6 | 4 | 1 |
| VS Code | injects | 8 | 6 | 1 |
| AFFiNE | breaks | 20 | 10 | 2 |
| AFFiNE | task | 8 | 3 | 2 of the 3 wanted (R-AF) |
| AFFiNE | callers | 21 | 5 | 1 |
| AFFiNE | adopt | 7 | 0 | 0 (R-X) |
| AFFiNE | callers, for adopt | 21 | 4 | 1 |
| AFFiNE | injects | 12 | 8 | 1 |
| Theia | breaks | 20 | 5 | 2 |
| Theia | task | 18 | 3 | 2 |
| Theia | callers | 30 | 8 | 1 |
| Theia | injects | 24 | 14 | 1 |
| Theia | direct list / transitive list / chain / cycle / files nothing imports / entries | 293 / 773 / 44,891 / 126 / 61 / 785 | all | 1 each |

- **No drawn candidate was replaced:** every truth held on reading.
- **The change words.** A fresh Opus writer wrote each adopt and task question's `change` from its drawn source, in the source's words. It never saw Eval #2's questions, the dev set or R-A's methods. The controller checked each against the source passage it was based on. It accepted two omissions:
  - VSCODE-TASK3 drops the pull request's garbled checklist line;
  - THEIA-TASK2 drops "Adding one touches every command in the application", which would hint at the answer.

  AFFINE-TASK2's change describes a refactor more than a signature change (history moves from the doc to the store). Those are the source's words, so it is kept, and the truth doesn't depend on it.
- **The new big-picture questions**, two per repo (Step 5). Their topics are ones neither Eval #2's questions nor the dev set's two ask about.
  - **The author**, a fresh Opus subagent, wrote each question and its 8 points from the repo's own docs at the pin.
  - **The re-checker**, an independent fresh Opus subagent, checked every point in the source at the pin. All 48 hold.
  - 17 points carry an immaterial imprecision, noted in the point's `note` for the graders. For example, AFFINE-BP5.8: at this commit frames also record their members' ids.
  - THEIA-BP1.8 (headless plugins) is borderline, since the question names only VS Code extensions and Theia plugins. It stays: the re-checker sets `holds` and notes, not the points, and a point a good answer may leave out costs both arms alike.

## How the truths were made and checked

The truth never comes from Nebulosity's index (R2).

**Eval #2's truths are copied unchanged** (R-I): its 26 truths and 9 rubrics for the reused questions, and its `adjudicated.json` and `steps.json`, byte for byte. A test checks the bytes. These verdicts are facts about VS Code's and AFFiNE's imports at the same commits.

**The call and task truths come from TypeScript's own type checker** (`scripts/eval/ts-calls.ts`), one program per repo, built by `npm run eval:truth -- --eval eval3`.

| Repo | The checker's program | Files | Program and call truths | Peak memory |
|---|---|---|---|---|
| VS Code | `src/tsconfig.json`'s (R-R) | 10,053 | 69.0 s for 9 truths | 5,113 MB |
| AFFiNE | every tracked `.ts` and `.tsx` file, resolved by the truth's own resolver | 6,937 | 13.1 s for 7 truths | 6,156 MB |
| Theia | the same | 3,451 | 9.0 s for 6 truths | 6,933 MB |

- AFFiNE's and Theia's checkouts have no `node_modules`. Their programs resolve modules with `scripts/eval/resolve-truth.ts` (workspace packages, `exports`, compiled paths mapped to sources), and npm packages stay unresolved.
- The peak is the one process's, cumulative over the three repos, under a 12 GB heap cap.
- The rules are D2's sentences, and a type is the same type when its exported symbol is.
- A task's CHANGE is the breaks set of its `T.m`. Its TESTS are the test files among CHANGE, or that directly import a file of CHANGE by the import rule, in the truth's import graph (R-U).
- The checker's call truths are tested against the di-repo fixture's hand-derived ground truth (`scripts/eval/ts-calls.test.ts`).

**Every disagreement with the index was read in the source.**
- After the draw, `scripts/eval/calls-candidates.ts` listed every file only one side counts, the checker or Nebulosity's index. This is the only place the index was consulted, and only for candidates.
- There were 106 such lines: 105 files only the checker counts, and 1 only the index counts.
- Each was read at its line, against the question's call rule, and decided in `eval3/truth/calls-adjudicated.json`. The rule counts a value's type as TypeScript sees it, declared or inferred.
  - All 105 checker-only files are "in": the checker was right.
  - The index-only file is "out". It is THEIA-INJECTS1's `remote-user-storage-provider.ts`: L40 is `@inject(LocalEnvVariablesServer)`, a different symbol, only typed `EnvVariablesServer`. That was the index's error.
- Those 106 verdicts changed no truth: a rebuild with them gave every truth byte for byte as before. None is left undecided.
- A sweep for the checker's blind spot then added 34 more verdicts (below), so `calls-adjudicated.json` holds 140: 116 "in" and 24 "out". Eleven of the "in" verdicts add a file the checker missed, and they changed three truths.

| Truth | Index only / checker only | Truth | Index only / checker only | Truth | Index only / checker only |
|---|---|---|---|---|---|
| VSCODE-CALLERS1 | 0 / 1 | AFFINE-CALLERS1 | 0 / 18 | THEIA-CALLERS1 | 0 / 1 |
| VSCODE-CALLERS2 | 0 / 1 | AFFINE-CALLERS2 | 0 / 11 | THEIA-BREAKS1 | 0 / 0 |
| VSCODE-BREAKS1 | 0 / 6 | AFFINE-BREAKS1 | 0 / 8 | THEIA-BREAKS2 | 0 / 3 |
| VSCODE-BREAKS2 | 0 / 7 | AFFINE-BREAKS2 | 0 / 23 | THEIA-INJECTS1 | 1 / 0 |
| VSCODE-ADOPT1 | 0 / 1 | AFFINE-INJECTS1 | 0 / 1 | THEIA-TASK1 | 0 / 0 |
| VSCODE-INJECTS1 | 0 / 0 | AFFINE-TASK1 | 0 / 1 | THEIA-TASK2 | 0 / 0 |
| VSCODE-TASK1 | 0 / 0 | AFFINE-TASK2 | 0 / 19 | | |
| VSCODE-TASK2 | 0 / 3 | | | | |
| VSCODE-TASK3 | 0 / 1 | | | | |

**Theia's import truths** (its six graph questions) were checked as Eval #2's were.
- The regex scanner and `preProcessFile` read its imports through the eval's own resolver. Theia has 3,772 code files, with 20,008 scanner edges and 19,976 `preProcessFile` edges: 32 only the scanner finds, and none only `preProcessFile` finds.
- A sweep listed 5 computed `import(<name>)` sites.
- All 37 were read and decided "out". They are appended to `eval3/truth/adjudicated.json` with `"repo": "theia"`, after Eval #2's 32, which are unchanged.
  - Of the 32 edges, 23 are `require` or `import` text inside the template literals a generator writes out, and 9 are JSDoc `import('…')` types in `examples/api-tests/*.spec.js`. The JSDoc ones are ruled as Eval #2 ruled them.
  - The 5 sites load nothing in the repo: three load npm packages at run time, one loads an installed plugin chosen at run time, and one is inside a template literal.
- A fixed-seed sample of 30 of the 200 edges the Theia truths rest on were read at their lines: all are real imports, with `@theia/x/lib/…` mapped to `packages/x/src/…` correctly. The truth's graph has 19,976 edges after the verdicts.

**Who read what.** Claude models did the reading; no person read every entry.
- **The disagreements:**
  - a Sonnet reader read VS Code's and Theia's 25 call lines;
  - an Opus reader read AFFiNE's 81;
  - a Sonnet reader read Theia's import sheets: the 32 edges, the 5 sites and the 30 sampled edges.
- **The controller's sample:** it read three decided lines itself, and confirmed all three:
  - AFFINE-CALLERS1, `render-linked-doc.ts` L189–191: `std.get(ViewExtensionManagerIdentifier).get`, where the identifier is `createIdentifier<ViewExtensionManager>`;
  - AFFINE-BREAKS2, `page-clipboard.ts` L193: `this.std.event.add`, where the getter `event` returns `this.get(UIEventDispatcher)`;
  - VSCODE-BREAKS1, `diffEditorWidget.ts` L551.
- **The agreements:** the session that assembled the questions read a seeded sample of 22 files both the checker and the index count, one per call truth (mulberry32(1) over each truth's files that no verdict covers). All 22 hold. It also read Theia's chain and cycle steps (THEIA-CN1's 3 and THEIA-CYCLE's 3) at their lines: all six hold.
- **The full reading** (2026-10-16, after an independent review): every entry of the call truths' evidence sheet (`calls-evidence.md`) was read at its line by three Sonnet readers, one per repo, with a script printing every cited line: VS Code's 9 questions, AFFiNE's 7 and Theia's 6, tests included. So were all of Theia's graph evidence (`truth-evidence.md`): its lists, roots, steps and 186 import-edge lines. They found no problems. Four look-alikes in VS Code were checked and hold.
- **The sweep for the checker's blind spot** (2026-10-16, after the review). The checker types a receiver `any` when its type comes through React props or an npm package (no `node_modules`), and the program leaves out `// @ts-check` JS tests. An Opus reader listed every call to each question's member whose receiver the checker types `any` or `unknown`, every `.js` file with such a call, and the producers of AFFiNE's high-volume members, then read 34 candidates and decided each. Eleven were "in": THEIA-BREAKS1 +7 (six calls through React props, such as `this.props.contextMenuRenderer.render(…)` in a `React.Component<Props>` whose Props declare the type, and one `container.get(ContextMenuRenderer)` in `menus.spec.js`), THEIA-BREAKS2 +3 (three `.spec.js` files typed by a JSDoc import) and AFFINE-BREAKS1 +1 (`peek-view/view/utils.ts`, a `useState<Doc | null>`). Twenty-three were "out" (Node and Electron receivers, sinon stubs, Playwright, an rxjs subject, untyped vendored JS, a JSDoc path that resolves to nothing). The blind-spot labels: react-props-any 7 in and 5 out; ts-check-js 4 in and 4 out. THEIA-BREAKS1 went from 35 to 42, THEIA-BREAKS2 from 33 to 36 and AFFINE-BREAKS1 from 10 to 11, all inside 10–80; every other truth is byte for byte as before, and the needed sets of those three were rebuilt.
- **What wasn't read one by one:** the graph under Theia's truths (20,008 scanner edges), which rests on the two extractors agreeing, the 37 verdicts and the 30-edge sample; and any file that neither the checker nor the index counts, beyond what the sweep looked for.
- Each of the 28 new truths carries `verified: true`. Each of the 6 new rubrics has every point's `holds` set.

**The needed files** were fixed from the truths before the first run (`npm run eval:needed -- --eval eval3`, `eval3/truth/needed.json`).
- There are 42 needed sets: the 14 of Eval #2's file-set questions, and every one of the 28 new questions'.
- A task's needed set is the union of its CHANGE and TESTS.
- A chain or cycle's is the shortest-path DAG: THEIA-CN1's has 4 files and 3 edges, and THEIA-CYCLE's has 7 files and 8 edges.
- Left out, as counts: VSCODE-IMPACT, VSCODE-PAIRS, AFFINE-IMPACT and AFFINE-PAIRS. No new question's answer is "none", and every new chain and cycle has a file between its ends.

## Where the index misses these callers

The 105 checker-only files, read above, show why a declared-type index misses calls. The labels are the readers', grouped.

| Why the index misses the file | VS Code | AFFiNE | Theia |
|---|---|---|---|
| A local's type is inferred from a call's return: a method, a test helper, `createInstance`, `accessor.get(…)`, a generic wrapper such as `_register(…)` or `assertReturnsDefined(…)`, or a pooled reference's `.object` | 14 | 24 | 0 |
| A getter's return type is inferred, not declared (AFFiNE's `std.event` returns `this.get(UIEventDispatcher)`) | 2 | 37 | 0 |
| A field's type is inferred from its initializer or a constructor assignment | 2 | 8 | 0 |
| `std.get(<identifier>)`, where the identifier is a `createIdentifier<T>()` value, not the type | 0 | 7 | 0 |
| A global's member (`declare global`, `window.doc: Store`) | 0 | 4 | 0 |
| A re-export through a package specifier (`@theia/core/lib/common`) | 0 | 0 | 4 |
| Other: a property chain through a context interface, `a \|\| b`, a module imported under two specifiers (one import row per file pair) | 2 | 1 | 0 |
| **Files the index misses** | **20** | **81** | **4** |

On five of AFFiNE's seven call truths, the index holds 1–2 of the checker's 10–25 files: CALLERS1 2 of 20, CALLERS2 1 of 12, BREAKS1 2 of 11, BREAKS2 2 of 25 and TASK2 2 of 21. On VS Code, BREAKS1 has 7 of 13 and BREAKS2 37 of 44.

**The engine was not tuned on these misses** (the ledger's ruling, 2026-10-16). They were found on Eval #3's own questions after the draw, and tuning the index on them would fit the test set. Eval #3 measures the index as it stands, and the engine freezes at the pilot (R-N). A fix comes after the results, measured on a new set.

## Scoring

`npm run eval:score -- --eval eval3` scores everything but the big-picture answers, each repo against its own truth graph and verdicts.
- **Eval #2's kinds** score as in Eval #2's "Scoring":
  - lists by recall, with precision beside it (Theia's two lists included);
  - chains and cycles 1 / 0.5 / 0;
  - impact by the mean of 1 − the relative error;
  - files nothing imports, violations and entries by F1;
  - pairs by F1;
  - big-picture by two blind graders, the owner ruling where they disagree;
  - sessions message by message.
- **The call kinds** (`callers`, `breaks`, `adopt`, `injects`) are scored by F1 over the files after the last `ANSWER:` line, with recall and precision beside it.
  - A listed path that isn't a file of the repo counts as a false positive when it reads as a file, as for Eval #2's F1 kinds.
  - The type's own declaring file, when the answer names it and the truth doesn't hold it, is not counted.
- **A task** has two parts (R-U): the files after `ANSWER CHANGE:` against CHANGE, and the files after `ANSWER TESTS:` against TESTS. Each is F1, and the task scores their mean. A missing block scores its part 0 and is flagged.
- A run or session message that hits its turn or budget limit scores 0 and counts. Outages are re-run (Eval #1's rule).
- **Reported per run**, beyond Eval #2's fields:
  - its question's set: "new", "eval2" or "bigPicture";
  - its refused calls: the denied tool results in the transcript (R-V);
  - when the question has a needed set, its time to relevant context under both rules, from process start and from the query start, and the tokens to it.
- **Grading** is Eval #2's, with the answers redacted before the blind sheets: Nebulosity and its tools' names become neutral words.

## Time to relevant context

Fixed in the plan (D2, design §5.3) and computed by `scripts/eval/context.ts` from each run's transcript and `eval3/truth/needed.json`. D2's method, verbatim:

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

## The ship gate (D1)

Eval #3 has two arms: **A**, Claude Code alone, and **N**, Claude Code with Nebulosity registered the way `nebulosity setup` registers it. `scripts/eval/gate3.ts` computes the gate from `eval3/results.json`. D1, verbatim:

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

**Written before the first run; it does not change after.**

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

## Decisions made since the plan

- **The rules sentence was reworded once** after the shell check (R-L), as recorded above. Both texts are in ADR-060.
- **Nebulosity's wording was tuned on the dev set only.** There were three rounds of tool-use wording (Task 16), plus trims to keep the first-call difference near 2,400 tokens (R-AA): the descriptions of `calls`' `within` and `offset`, the docs sentence, `search`'s description, and the instructions' closing sentence on paths. N's tool use on the dev set's 17 non-big-picture questions went from 12 to 13. The owner chose to run Eval #3 as it is and report the share (2026-10-16). MCP Dev Set #2 in `docs/BENCHMARKS.md` has the rounds.
- **The first-call difference is judged on paired runs** (the same question in the same round), not on medians over a mix of rounds. After a rewording, not every run carries the same prompt.
- **AFFiNE asks 2 tasks and a second callers question** (R-X, R-AF), so Eval #3 has 378 runs.
- **R-AF applies within a kind too:** each pick's type leaves the pool before the next pick, so two breaks or two tasks on one repo can't share a type. A repo in the mix with no candidates prints a warning.
- **Theia's graph candidates are committed gzipped** (`eval3/candidates-theia-graph.json.gz`, 46,929 candidates), and the draw reads them from there. `eval3/candidates.json` keeps the call and task candidates, plus, per graph kind, the pool, the passing count and the drawn ids.
- **The engine is not changed for the index's misses** on these questions (see "Where the index misses these callers").
- **The big-picture prompts** are the author's "Prompt" lines, in the ledger's author notes. Eval #2's rubric files carry no question text, and these follow their shape.
- **THEIA-BP1.8 stays** in its rubric, as above.

## Threats to validity

- **The rules sentence is advisory.** It tells both arms what the permission rules refuse, but the rules do the refusing. A model may still try a refused command, and condition V counts every run that does.
- **Condition 1 rests on the multi-step kinds.** One broad grep can "see" all of a single method's callers. The plain rule counts any result naming a needed file, so a callers or injects question may be reached quickly in both arms. The tasks (whose needed set is CHANGE and TESTS together), Theia's lists, chains and cycles, and the larger breaks sets carry the 4× bar.
- **The model may know VS Code from training.** VS Code also ships its own guide for agents (`AGENTS.md`). Theia ships a `CLAUDE.md` and an `AGENTS.md` too, which both arms read alike.
- **Theia is unknown to the tuning**: no dev question touches it, and it runs in free mode. Its truths and AFFiNE's rest on the checker with the truth's own module resolution, since neither checkout has `node_modules`. A call made through an npm package's types is invisible to the truth. This was not wholly so for the repo's own types passed through React props or hooks, which the checker also lost without `node_modules`; a sweep after the draw found those and added 11 files to three truths (see "Who read what"). A residual risk remains for other paths that go through npm types.
- **Most of the task changes are already in the code.** At the pinned commits, six of the seven task changes are already made (vscode-task1, vscode-task2 and vscode-task3, affine-task1 and affine-task2, theia-task1); only theia-task2's is proposed. vscode-adopt1 is partly adopted: its PR fixes one site and says others already follow it. The prompts say "I'm changing…", so a run may answer that the change is done. The rule (breaks plus tests) decides the truth either way.
- **theia-injects1's truth follows the rule's letter.** A field `@inject(LocalEnvVariablesServer)` typed `EnvVariablesServer` is not counted, though its type is the one asked about.
- **The dev set and the eval share kinds, not targets.** The overlap check refuses any shared target, and the draw refused them too, but the tools' wording may suit these kinds better than a user's own questions.
- **Three repeats is a small sample.** Each repo has one to three questions per kind, so a per-repo condition can turn on a few runs.
- **The owner set the bars after Eval #2**, knowing where Eval #2 fell short. They were fixed with the plan on 2026-10-15, before Eval #3's questions existed, and they don't change after the first run.
- **The dev set's tool use was 13 of 17 (0.76)**, after three rounds of wording, so condition 5 (0.90) is at risk. Four dev questions used no Nebulosity tool in any of their runs (0 of 12, across three wordings): VS Code's task and injects, and AFFiNE's files nothing imports and violations. Each run read its question as a text search.
- **The calls index misses many of these callers.** On AFFiNE it holds 1–2 of the checker's 10–25 files on five of the seven call truths, and on VS Code 7 of 13 and 37 of 44 on the two breaks questions. An answer built on `calls` alone misses the rest. Conditions 2 and 3 will show that as a loss, and the engine was not tuned on it.
- **The truths were read by models; no person read them all.** Every disagreement with the index was read. Every entry of the call truths was then read at its line, and so were Theia's graph evidence (three Sonnet readers, no problems). Agreement between the checker and the index covers the files they both include. The files both could miss are covered by the sweep for the checker's blind spot only, and a residual risk remains (see the npm types line above).

## Results

**The runs.** All 378 ran on 2026-10-16 between 06:58 and 10:17 UTC: the pilot's 28 (24 single runs and 4 session runs), then the other 342 single runs in six batches, then the other 8 session runs. 378 runs were kept: 366 single runs and 12 task sessions. No run was an outage, none was re-run, and none was refused by the checks. Every init message showed Claude Code 2.1.301, `claude-sonnet-5-5`, permission mode `dontAsk` and no API key. Every N run had `nebulosity` connected with seven tools, and A had no MCP server. Sonnet 5.5 was the only model that answered: no run called a subagent. Every run ended in `success`, so none hit its turn or budget limit. The three repos were at their commits with a clean `git status` after every run. Nebulosity's index was at version 155 (VS Code), 134 (AFFiNE) and 2 (Theia) in every run, with the engine frozen at `2f913ad`.

The lists, chains, call and task answers were scored by `npm run eval:score -- --eval eval3`. Two chain steps the scorer asked about (in affine-cn1's first and third A runs: `packages/frontend/core/src/modules/workspace-engine/impls/local.ts` → `packages/common/nbstore/src/impls/idb/index.ts` through `@affine/nbstore`'s `./idb` export, and `workspace-engine/index.ts` → `workspace-engine/impls/local.ts`) were read in the source and added to `eval3/truth/steps.json` as imports. The 90 big-picture answers were graded as "Scoring" says (details under "What the runs showed about the method").

Every number below is recomputed from `eval3/results.json`, `eval3/runs/index.jsonl` and the kept transcripts. "A" is Claude Code alone and "N" is Claude Code with Nebulosity. Time is `duration_ms` throughout, as D1 defines it. Cost is Claude Code's own list-price estimate (`total_cost_usd`), not a bill: the runs used the owner's subscription.

### The gate (D1): FAIL

| # | Condition | VS Code | AFFiNE | Theia | Result |
|---|---|---|---|---|---|
| V | At most 5% of each arm's runs have a refused command (all repos) | A 2 of 78, N 0 of 78 | A 4 of 69, N 3 of 69 | A 3 of 42, N 5 of 42 | A 9 of 189 (**0.0476**), N 8 of 189 (0.0423): **PASS** |
| 1 | TTRC on each repo's new file-set questions: median per-question ratio ≤ 0.25, upper end of the 95% interval ≤ 0.50 | 9 questions: **0.9824** [0.8957–1.2667] | 7 questions: **1.0102** [0.8649–1.1389] | 12 questions: **1.0399** [0.3303–infinite] | **FAIL** (every repo) |
| 2 | Half the errors on the new questions, repos pooled; no repo more than 0.02 below A | A 0.9866, N 0.9873 (+0.0007) | A 1.0000, N 0.9990 (−0.0010) | A 0.9815, N 0.9714 (−0.0101) | Mean error A 0.0122, N 0.0166: **1.3559 of A's** (needs 0.50). The floor holds. **FAIL** |
| 3 | Each repo's DI and task questions: median per-question ratio of time ≤ 0.5 and of cost ≤ 0.5 | 9 questions: time **0.9773**, cost **0.9782** | 7 questions: time **0.9331**, cost **1.0067** | 6 questions: time **0.8790**, cost **0.9772** | **FAIL** (every repo) |
| 4 | No loss elsewhere: big-picture N ≥ A − 0.03 with cost ratio ≤ 1.15; Eval #2's graph questions N ≥ A − 0.03 with cost ratio ≤ 1.0; the session N ≥ A − 0.03 | Big-picture +0.0659, cost 1.0020. Graph +0.0215, cost 0.9194. Session +0.0007 | Big-picture +0.0035, cost 0.9485. Graph +0.0179, cost 0.5588. Session +0.0004 | Big-picture −0.0208, cost 0.9835 | PASS |
| 5 | ≥ 0.90 of N's runs on new and graph questions call a Nebulosity tool (all repos) | new 7 of 27, graph 20 of 27 | new 16 of 21, graph 20 of 27 | new 17 of 36 | 80 of 138, **0.5797**: **FAIL** |
| 6 | Each repo: N's median first-call context − A's ≤ 2,500 tokens | 21,661 → 24,029, +2,368 | 21,426 → 23,795.5, +2,369.5 | 50,546 → 52,918, +2,372 | PASS |

`gate3Verdict` reports only the deciding repo of each per-repo condition (Theia for 1, 4 and 6; AFFiNE for 3). The other repos' numbers in this table were recomputed from `eval3/results.json` with `gate3.ts`'s own statistics functions (`scripts/eval/stats.ts`), and match its printout wherever it prints them. Values are rounded to 4 places as the gate prints them.

**The verdict: the gate failed on conditions 1, 2, 3 and 5; V, 4 and 6 passed.** With Nebulosity, Claude Code reached the files the new questions need no sooner than Claude Code alone (median ratios 0.98, 1.01 and 1.04, where the gate asked for 0.25), made slightly more errors on them rather than half as many, took about as long and cost about as much on the call and task questions, and called a Nebulosity tool in 58% of the runs that should have.

**V passed, so the comparison isn't confounded by refused commands**, as Eval #2's was (there, 81 of A's 135 runs had one). It passed with no margin in the alone arm: 9 of 189 is the most 5% allows, and a tenth would have failed it.

### Time to relevant context

When a run had first seen every file its answer needs (D2). The gated rule is the plain one, from process start. "Reached" is the share of runs that saw every needed file; a run that never did counts as infinitely late in the medians. The ratio is per question, N's median over A's, then the median over the questions, with a 95% bootstrap interval over questions (10,000 resamples, mulberry32 seed 1). Tokens to context are the median, over the runs that reached it, of the main conversation's input, cache writes and cache reads before the reaching event.

**The new file-set questions (condition 1's set):**

| Repo | Questions | Reached A / N | Median TTRC A / N | Ratio [95% interval] | Mostly-relevant: reached A / N | Mostly-relevant ratio | Tokens to context A / N | From the query start: median A / N | Ratio [95% interval] |
|---|---|---|---|---|---|---|---|---|---|
| VS Code | 9 | 0.85 / 0.89 | 8.8 / 6.7 s | **0.98** [0.90–1.27] | 0.63 / 0.56 | 1.00 | 21,849 / 24,204 | 8.0 / 5.3 s | 0.88 [0.79–1.25] |
| AFFiNE | 7 | 1.00 / 0.95 | 12.8 / 11.0 s | **1.01** [0.86–1.14] | 0.62 / 0.57 | 1.00 | 76,196 / 49,279 | 12.1 / 9.8 s | 0.97 [0.85–1.03] |
| Theia | 12 | 0.89 / 0.75 | 15.4 / 12.6 s | **1.04** [0.33–never] | 0.78 / 0.56 | 1.00 | 102,351 / 52,951 | 14.8 / 11.4 s | 1.02 [0.23–never] |
| Pooled (not gated) | 28 | 0.90 / 0.85 | 13.8 / 11.0 s | 1.01 [0.94–1.11] | 0.69 / 0.56 | 1.00 | 78,580 / 52,934 | 13.1 / 9.8 s | 0.98 [0.86–1.03] |

The same, split by kind (pooled over repos, not gated):

| Kind | Questions | Reached A / N | Median TTRC A / N | Ratio [95% interval] |
|---|---|---|---|---|
| Callers | 5 | 1.00 / 1.00 | 5.7 / 6.1 s | 1.07 [0.64–1.46] |
| What breaks | 6 | 0.72 / 0.56 | 14.2 / 36.7 s | 1.01 [0.96–never] |
| Adopt | 1 | 1.00 / 1.00 | 5.2 / 5.3 s | 1.02 |
| Injects | 3 | 1.00 / 1.00 | 6.3 / 6.2 s | 0.96 [0.77–1.85] |
| Task (both parts) | 7 | 0.86 / 0.86 | 35.0 / 36.0 s | 1.06 [0.90–1.43] |
| DI and task, all | 22 | 0.88 / 0.83 | 12.8 / 12.7 s | 1.02 [0.98–1.27] |
| Theia's six graph questions | 6 | 1.00 / 0.89 | 15.2 / 5.2 s | 0.33 [0.22–never] |

**Eval #2's file-set questions, reused unchanged** (not gated; a reference):

| Repo | Questions | Reached A / N | Median TTRC A / N | Ratio [95% interval] | Mostly-relevant ratio | Tokens to context A / N | From the query start: ratio [95% interval] |
|---|---|---|---|---|---|---|---|
| VS Code | 7 | 0.86 / 1.00 | 14.5 / 3.6 s | 0.31 [0.21–0.94] | 0.94 | 44,399 / 24,030 | 0.21 [0.14–0.91] |
| AFFiNE | 7 | 1.00 / 1.00 | 13.5 / 3.5 s | 0.51 [0.17–1.11] | 0.51 | 66,689 / 23,804 | 0.38 [0.11–1.02] |
| Pooled | 14 | 0.93 / 1.00 | 14.0 / 3.6 s | 0.41 [0.19–0.84] | 0.64 | 44,453 / 24,022 | 0.30 [0.12–0.71] |

**A trap in the scorer's printout.** Its "Time to relevant context" table pools every run with a needed set on a repo, so its VS Code row (16 questions, ratio 0.926) and AFFiNE row (14 questions, 0.936) mix the new questions with Eval #2's. Those are not condition 1's statistic. Its Theia row (12 questions, 1.040) is, because Theia has only new questions. The tables above split the two sets.

**Per question** (median TTRC A / N, ratio):
- *VS Code, new:* CALLERS1 5.0 / 4.9 s, 0.98; CALLERS2 8.8 / 5.7 s, 0.64; BREAKS1 5.7 / 5.2 s, 0.91; BREAKS2 never / never, 1.00 (both arms missed the same two files); ADOPT1 5.2 / 5.3 s, 1.02; INJECTS1 5.1 / 4.9 s, 0.96; TASK1 32.2 / 40.8 s, 1.27; TASK2 43.9 / 39.3 s, 0.90; TASK3 14.4 / 20.6 s, 1.43.
- *AFFiNE, new:* CALLERS1 14.7 / 15.7 s, 1.07; CALLERS2 5.2 / 5.9 s, 1.14; BREAKS1 6.0 / 6.0 s, 1.01; BREAKS2 15.4 / 15.5 s, 1.01; INJECTS1 12.8 / 9.8 s, 0.77; TASK1 6.0 / 8.9 s, 1.49; TASK2 50.5 / 43.7 s, 0.86.
- *Theia:* CALLERS1 5.4 / 7.8 s, 1.46; BREAKS1 24.2 s / never, infinite; BREAKS2 16.3 s / never, infinite; INJECTS1 5.8 / 10.7 s, 1.85; TASK1 22.3 / 23.6 s, 1.06; TASK2 never / never, 1.00; CL1 12.9 s / never, infinite; CL2 22.2 / 4.2 s, 0.19; CN1 11.6 / 4.1 s, 0.35; CYCLE 12.6 / 3.9 s, 0.31; UNUSED 15.3 / 15.6 s, 1.02; ENTRIES 18.0 / 4.4 s, 0.24.
- *Eval #2's:* VS Code CL1 0.52, CL4 0 (no A run reached it: all three missed the same three entry files), CN1 0.21, CYCLE 0.31, UNUSED 0.94, VIOLATIONS 1.00, ENTRIES 0.21; AFFiNE CL1 0.51, CL4 0.17, CN1 0.18, CYCLE 0.67, UNUSED 2.27, VIOLATIONS 1.11, ENTRIES 0.13.

**Never reached:** 24 runs, by their final coverage. A 11: VS Code BREAKS2 r1–r3 (0.95, 0.80, 0.95), TASK1 r2 (0.91) and Eval #2's CL4 r1–r3 (0.95 each); Theia BREAKS1 r2 (0.98), BREAKS2 r3 (0.92), TASK2 r1 and r2 (0.71). N 13, all on new questions: VS Code BREAKS2 r1 and r3 (0.95), TASK1 r1 (0.90); AFFiNE BREAKS2 r2 (0.96); Theia BREAKS1 r1 and r3 (0.98), BREAKS2 r1–r3 (0.83, 0.92, 0.83), CL1 r1 and r2 (0.81), TASK2 r1 and r2 (0.71).

**What this shows.**
- *On the new questions, neither arm got there first.* The DI and task questions pool at 1.02. The plain rule counts a result as soon as it names a needed file, and nearly every run of both arms began with a `git grep` for the member's name, which names most callers at once. Where N called `calls`, it came back in the same turn as that grep, not earlier (on AFFiNE, in some runs in parallel with it).
- *The tasks' time goes into the tests.* A task's needed set is its CHANGE and TESTS together, and the tests are the files that import the files to change. Both arms found them with a Node script of their own, in about the same time. N called `imports` for them only on AFFINE-TASK2 (4–14 calls a run) and AFFINE-TASK1 r1.
- *Where N was faster, it walked imports.* On Theia's transitive list, chain, cycle and entries questions, N reached the files in 0.19–0.35 of A's time with one `imports` or `architecture` call. On Eval #2's questions, pooled 0.41. That is the existing tools' work, not `calls`'.
- *Where N never got there, it trusted an answer or a grep that was short.* Theia's BREAKS2 (r1 and r3 trusted `calls`, which misses six of the truth's files), CL1 (r1 and r2 ran one grep whose filter dropped six files) and BREAKS1 (a `.js` test typed through a container lookup, which both arms missed in some runs).
- *Condition 1 rested on the multi-step kinds, as the method's threats said it would.* The kinds it rested on (tasks, the larger breaks sets, Theia's graph questions) split: Theia's transitive list, chain, cycle and entries questions were reached about 3–5 times sooner, and the tasks and breaks sets weren't.
- *The mostly-relevant version* sits at 1.00 on each repo for the new questions, so the result doesn't depend on how much else a grep printed.
- *From the query start* the ratios are a little lower (0.88, 0.97 and 1.02), because N's MCP server adds start-up time before the query: the median gap between process start and query start was 1,235 ms for N and 684 ms for A, over the runs that reached their context.
- *Tokens to context* were lower for N on AFFiNE and Theia (49,279 against 76,196; 52,951 against 102,351) and higher on VS Code (24,204 against 21,849). A first call is already about 24,000 tokens for N (50,500 on Theia, whose own `CLAUDE.md` and `AGENTS.md` both arms load), so on questions reached in the first turn or two the medians mostly measure the prompt.

### The headline

The score is the mean over the kind's runs: F1 for the call kinds, the mean of a task's two F1 scores, the share of rubric points for big-picture, recall for lists, and each Eval #2 kind's own score. Recall and precision are the means over the runs that have them. The medians are over the same runs. "Tokens, all" counts every token of every model, output included.

| Repo | Kind | Runs per arm | Score A / N | Recall A / N | Precision A / N | Median tokens, all, A / N | Median first call A / N | Median cost A / N | Median time A / N | Median tool calls A / N |
|---|---|---|---|---|---|---|---|---|---|---|
| VS Code | Callers | 6 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 154,483 / 139,027 | 21,735 / 24,104 | $0.097 / $0.086 | 29.8 / 16.9 s | 4.5 / 4 |
| VS Code | What breaks | 6 | 0.944 / 0.965 | 0.94 / 0.96 | 0.95 / 0.97 | 223,695 / 342,852 | 21,794 / 24,161 | $0.160 / $0.199 | 47.1 / 51.7 s | 6.5 / 8.5 |
| VS Code | Adopt | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 121,798 / 123,922 | 21,818 / 24,191 | $0.114 / $0.093 | 25.1 / 25.0 s | 3 / 3 |
| VS Code | Injects | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 90,226 / 131,547 | 21,849 / 24,219 | $0.088 / $0.092 | 17.4 / 16.8 s | 2 / 3 |
| VS Code | Task | 9 | 0.997 / 0.985 | – | – | 198,613 / 256,730 | 22,057 / 24,424 | $0.178 / $0.196 | 55.7 / 57.8 s | 7 / 7 |
| VS Code | Big-picture | 21 | 0.792 / 0.858 | – | – | 69,178 / 77,668 | 21,582 / 23,953 | $0.040 / $0.043 | 14.9 / 13.9 s | 2 / 3 |
| VS Code | Direct list | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 96,087 / 105,692 | 21,641 / 24,015 | $0.052 / $0.081 | 20.1 / 17.4 s | 3 / 4 |
| VS Code | Transitive list | 3 | 0.955 / 1.000 | 0.95 / 1.00 | 1.00 / 1.00 | 73,150 / 53,335 | 21,650 / 24,020 | $0.065 / $0.052 | 25.6 / 14.1 s | 2 / 1 |
| VS Code | Chain | 3 | 1.000 / 1.000 | – | – | 93,080 / 49,062 | 21,657 / 24,024 | $0.048 / $0.023 | 23.9 / 5.7 s | 3 / 1 |
| VS Code | Impact | 3 | 0.905 / 1.000 | – | – | 98,949 / 50,091 | 21,788 / 24,158 | $0.070 / $0.027 | 35.9 / 6.2 s | 4 / 1 |
| VS Code | Cycle | 3 | 1.000 / 1.000 | – | – | 69,273 / 74,950 | 21,735 / 24,104 | $0.037 / $0.031 | 15.3 / 9.6 s | 2 / 2 |
| VS Code | Files nothing imports | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 92,473 / 101,801 | 21,648 / 24,016 | $0.041 / $0.043 | 20.2 / 16.8 s | 3 / 3 |
| VS Code | Violations | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 116,051 / 127,966 | 21,653 / 24,022 | $0.046 / $0.048 | 16.1 / 16.0 s | 4 / 4 |
| VS Code | Entries | 3 | 0.947 / 1.000 | 1.00 / 1.00 | 0.90 / 1.00 | 70,292 / 64,773 | 21,660 / 24,029 | $0.043 / $0.088 | 21.0 / 8.8 s | 2 / 2 |
| VS Code | Pairs | 3 | 1.000 / 1.000 | – | – | 72,404 / 102,527 | 21,757 / 24,130 | $0.051 / $0.047 | 21.8 / 18.1 s | 2 / 3 |
| AFFiNE | Callers | 6 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 225,343 / 178,026 | 21,473 / 23,843 | $0.118 / $0.101 | 29.9 / 23.0 s | 7 / 6 |
| AFFiNE | What breaks | 6 | 1.000 / 0.997 | 1.00 / 0.99 | 1.00 / 1.00 | 126,773 / 115,161 | 21,550 / 23,921 | $0.079 / $0.075 | 22.0 / 20.2 s | 5 / 6.5 |
| AFFiNE | Injects | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 165,535 / 156,250 | 21,522 / 23,894 | $0.138 / $0.119 | 35.7 / 38.7 s | 5 / 4 |
| AFFiNE | Task | 6 | 1.000 / 1.000 | – | – | 315,187 / 430,169 | 21,743 / 24,112 | $0.195 / $0.215 | 52.6 / 52.3 s | 9 / 12 |
| AFFiNE | Big-picture | 18 | 0.771 / 0.774 | – | – | 101,044 / 104,185 | 21,368 / 23,741 | $0.057 / $0.053 | 18.9 / 17.9 s | 4 / 3.5 |
| AFFiNE | Direct list | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 94,240 / 52,680 | 21,407 / 23,782 | $0.051 / $0.044 | 18.7 / 15.6 s | 3 / 2 |
| AFFiNE | Transitive list | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 96,922 / 51,623 | 21,426 / 23,793 | $0.076 / $0.042 | 29.6 / 11.2 s | 4 / 1 |
| AFFiNE | Chain | 3 | 1.000 / 1.000 | – | – | 124,152 / 48,488 | 21,422 / 23,789 | $0.067 / $0.021 | 23.2 / 5.1 s | 5 / 1 |
| AFFiNE | Impact | 3 | 0.994 / 1.000 | – | – | 147,971 / 78,663 | 21,521 / 23,888 | $0.086 / $0.045 | 33.9 / 8.8 s | 6 / 3 |
| AFFiNE | Cycle | 3 | 1.000 / 1.000 | – | – | 92,307 / 48,519 | 21,503 / 23,869 | $0.041 / $0.020 | 15.9 / 4.4 s | 3 / 1 |
| AFFiNE | Files nothing imports | 3 | 0.909 / 1.000 | 1.00 / 1.00 | 0.83 / 1.00 | 149,806 / 102,968 | 21,426 / 23,796 | $0.066 / $0.051 | 25.3 / 20.2 s | 5 / 3 |
| AFFiNE | Violations | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 151,506 / 103,344 | 21,418 / 23,788 | $0.064 / $0.043 | 24.5 / 19.8 s | 6 / 3 |
| AFFiNE | Entries | 3 | 0.978 / 1.000 | 1.00 / 1.00 | 0.96 / 1.00 | 313,705 / 51,789 | 21,440 / 23,807 | $0.137 / $0.034 | 49.6 / 5.6 s | 11 / 1 |
| AFFiNE | Pairs | 3 | 0.958 / 1.000 | – | – | 114,823 / 127,997 | 21,425 / 23,794 | $0.051 / $0.056 | 21.2 / 22.2 s | 4 / 5 |
| Theia | Callers | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 281,134 / 218,313 | 50,573 / 52,944 | $0.199 / $0.167 | 22.6 / 12.9 s | 4 / 4 |
| Theia | What breaks | 6 | 0.977 / 0.958 | 0.98 / 0.92 | 0.97 / 1.00 | 546,812 / 473,012 | 50,645 / 53,017 | $0.326 / $0.282 | 44.5 / 42.8 s | 9.5 / 9 |
| Theia | Injects | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 171,878 / 177,069 | 50,655 / 53,032 | $0.199 / $0.209 | 21.8 / 20.7 s | 2 / 3 |
| Theia | Task | 6 | 0.911 / 0.934 | – | – | 416,706 / 458,805 | 50,888 / 53,260 | $0.267 / $0.267 | 48.4 / 48.0 s | 7.5 / 7.5 |
| Theia | Big-picture | 6 | 0.833 / 0.813 | – | – | 102,956 / 107,850 | 50,457 / 52,827 | $0.147 / $0.150 | 13.4 / 13.8 s | 1 / 1 |
| Theia | Direct list | 3 | 1.000 / **0.871** | 1.00 / 0.87 | 0.95 / 1.00 | 156,305 / 110,623 | 50,498 / 52,869 | $0.164 / $0.163 | 22.3 / 19.8 s | 2 / 1 |
| Theia | Transitive list | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 320,269 / 111,987 | 50,506 / 52,873 | $0.228 / $0.177 | 36.7 / 18.7 s | 6 / 1 |
| Theia | Chain | 3 | 1.000 / 1.000 | – | – | 208,633 / 106,575 | 50,519 / 52,889 | $0.168 / $0.140 | 16.2 / 5.1 s | 3 / 1 |
| Theia | Cycle | 3 | 1.000 / 1.000 | – | – | 208,902 / 214,496 | 50,564 / 52,936 | $0.169 / $0.155 | 17.1 / 11.2 s | 3 / 3 |
| Theia | Files nothing imports | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 156,822 / 163,260 | 50,502 / 52,870 | $0.163 / $0.162 | 17.5 / 19.2 s | 2 / 2 |
| Theia | Entries | 3 | 1.000 / 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | 157,333 / 113,828 | 50,524 / 52,899 | $0.175 / $0.172 | 24.3 / 8.6 s | 3 / 1 |

By question set (the time and cost ratios are the median over the set's questions of each question's ratio of medians, as the gate takes them; "context read" is input, cache writes and cache reads over every model call):

| Set | Repo | Questions | Score A / N | Median time A / N | Time ratio | Median cost A / N | Cost ratio | Context read A / N | Turns A / N | N runs with a call |
|---|---|---|---|---|---|---|---|---|---|---|
| DI and task (new) | VS Code | 9 | 0.987 / 0.987 | 35.7 / 35.6 s | 0.98 | $0.132 / $0.132 | 0.98 | 188,113 / 207,752 | 7 / 7 | 7 of 27 |
| DI and task (new) | AFFiNE | 7 | 1.000 / 0.999 | 35.7 / 34.6 s | 0.93 | $0.138 / $0.119 | 1.01 | 184,740 / 169,129 | 6 / 9 | 16 of 21 |
| DI and task (new) | Theia | 6 | 0.963 / 0.964 | 37.9 / 38.8 s | 0.88 | $0.247 / $0.241 | 0.98 | 400,654 / 385,648 | 7 / 7 | 5 of 18 |
| DI and task (new) | Pooled | 22 | 0.984 / 0.985 | 35.8 / 36.9 s | 0.96 | $0.170 / $0.168 | 0.99 | 197,791 / 217,373 | 6.5 / 7 | 28 of 66 |
| Theia's graph questions (new) | Theia | 6 | 1.000 / 0.978 | 20.5 / 14.9 s | 0.58 | $0.169 / $0.164 | 0.95 | 180,776 / 112,874 | 4 / 2 | 12 of 18 |
| Eval #2's graph questions | VS Code | 9 | 0.979 / 1.000 | 21.1 / 14.1 s | 0.63 | $0.048 / $0.047 | 0.92 | 90,759 / 77,580 | 4 / 3 | 20 of 27 |
| Eval #2's graph questions | AFFiNE | 9 | 0.982 / 1.000 | 24.4 / 11.3 s | 0.38 | $0.066 / $0.043 | 0.56 | 119,360 / 73,282 | 5 / 3 | 20 of 27 |
| Eval #2's graph questions | Pooled | 18 | 0.980 / 1.000 | 22.8 / 13.3 s | 0.59 | $0.052 / $0.043 | 0.79 | 93,599 / 76,204 | 5 / 3 | 40 of 54 |
| Big-picture | VS Code | 7 | 0.792 / 0.858 | 14.9 / 13.9 s | 0.79 | $0.040 / $0.043 | 1.00 | 67,923 / 76,356 | 3 / 4 | 12 of 21 |
| Big-picture | AFFiNE | 6 | 0.771 / 0.774 | 18.9 / 17.9 s | 0.94 | $0.057 / $0.053 | 0.95 | 99,344 / 102,456 | 5 / 4.5 | 12 of 18 |
| Big-picture | Theia | 2 | 0.833 / 0.813 | 13.4 / 13.8 s | 1.04 | $0.147 / $0.150 | 0.98 | 101,761 / 106,576 | 2 / 2 | 0 of 6 |
| Every single question | Pooled | 61 | 0.937 / 0.948 | 22.5 / 17.5 s | 0.87 | $0.082 / $0.071 | 0.95 | 115,128 / 106,183 | 5 / 4 | 104 of 183 |

**What this shows.**
- *On the call and task questions, the two arms were level.* Pooled over the 22 questions, the scores were 0.984 and 0.985, the median time 35.8 and 36.9 s, and the median cost $0.170 and $0.168. N read more tokens on VS Code and fewer on AFFiNE and Theia.
- *On the callers questions N was faster on VS Code and Theia* (16.9 against 29.8 s, and 12.9 against 22.6 s), where `calls` listed all but one caller and N checked it with greps. It was still above half the time, and its cost was 0.84–0.89 of A's.
- *On the questions that walk the import graph N was faster*, and on AFFiNE cheaper. On Eval #2's graph questions it took 0.63 (VS Code) and 0.38 (AFFiNE) of A's time per question, at 0.92 and 0.56 of the cost, scoring 1.00 against 0.98. On Theia's six, which no tuning touched and whose index is in free mode, it took 0.58 of the time at 0.95 of the cost, scoring 0.978 against 1.000.
- *On big-picture questions the arms were close:* VS Code 0.858 against 0.792, AFFiNE 0.774 against 0.771, Theia 0.813 against 0.833.

### The losses

- **Condition 1: no faster to the relevant context on the new questions.** The median ratios were 0.98, 1.01 and 1.04, against the 0.25 asked; pooled, 1.01 [0.94–1.11]. This was V1.7's headline claim ("4× faster to the relevant context"), and it doesn't hold. On the 22 call and task questions N reached the needed files at 1.02 of A's time, and on Theia's graph questions at 0.33, which the tasks and breaks sets outweighed.
- **Condition 3: no faster or cheaper end to end on the call and task questions.** The median time ratios were 0.98, 0.93 and 0.88 and the cost ratios 0.98, 1.01 and 0.98, against 0.5. Of the 22 questions, one came under 0.5 on both: THEIA-BREAKS2 (0.33 and 0.48), and there N got there by trusting an incomplete `calls` answer and scored 0.92 against 0.96. The callers questions on VS Code and Theia came nearest (time 0.57–0.66, cost 0.77–0.84), at 1.00 in both arms.
- **Condition 2: more errors, not half as many.** N's mean error on the new questions was 0.0166 against A's 0.0122 (1.36 of A's). Both arms were close to the ceiling (A 0.988, N 0.983), so half of A's error was 0.0061, a mean of 0.994 for N. N's errors came mostly from three questions:
  - THEIA-CL1, the direct list: 0.87 against 1.00. Two N runs ran one `git grep` whose `grep -v "language-model-"` filter also dropped the six files in the target's own folder whose names start with `language-model-`, and answered from it without a tool call. The third wrote a script and scored 1.00. Every A run wrote a script or a `node -e` scan.
  - THEIA-BREAKS2: 0.92 against 0.96. N's r1 and r3 listed `calls`' 30 files and spot-checked with three or four greps. They missed six: three `ai-ide` files whose receivers the index misses through `@theia/core`'s re-exports, and three `.spec.js` tests typed through JSDoc, which the checker missed too until the sweep. Their answers said so: "This comes from the call-graph index, and I only spot-checked it with grep" (r1).
  - VSCODE-TASK1: 0.96 against 0.99. Every N run listed a test file that only stubs the method among the files to change, and two missed 11 of the 99 tests.

  The floor held on every repo (+0.0007, −0.0010 and −0.0101).
- **Condition 5: tools used in 80 of 138 runs (0.58), against 0.90.** `calls` was called in 24 of N's 66 call and task runs: 14 of 15 callers runs, 8 of 18 breaks runs, 2 of 21 task runs, and none of the 3 adopt and 9 injects runs. Of Eval #2's graph questions, N's runs on files nothing imports and violations called no tool on either repo (0 of 12; in Eval #2, AFFiNE's 6 all did), and neither did Theia's files nothing imports and direct list (0 of 6).
- **The calls index misses most callers on AFFiNE's targets** (see "Where the index misses these callers" above): on five of its seven call truths it holds 1–2 of the checker's 10–25 files. Every N run that called `calls` there got back one or two files, read the answer's note ("A call on a value whose type is only inferred isn't seen"), and grepped the rest, so it paid for both. No AFFiNE score dropped for it (one breaks run missed one file), and none got faster.
- **Theia, the held-out repo, came out lower with Nebulosity on three kinds:** the direct list (0.871 against 1.000, above), what breaks (0.958 against 0.977, above) and big-picture (0.813 against 0.833). Its tasks were higher (0.934 against 0.911).
- **Big-picture questions lower with Nebulosity, one by one:**
  - VSCODE-BP1: 0.83 against 0.94. Every N run called `architecture` (layers) and `describe` on `src/vs`, and every one left out the extension host (BP1.8), which every A run named at least in part. One N run read the organization doc and still left it out.
  - AFFINE-BP1: 0.90 against 0.98, after `overview`.
  - AFFINE-BP3: 0.60 against 0.69, with no tool call: half points on how block props hold Yjs values (BP3.2).
  - THEIA-BP2: 0.71 against 0.75, with no tool call: no N run said that `@theia/core` is the extension every application builds on (BP2.5).
- **Where N was slower or costlier than Claude Code alone**, by the per-question medians (the notable cases first, then the smaller ratios above 1.0):
  - VSCODE-TASK3: 1.14 times the time and 1.32 times the cost, at 1.00 each. N's r2 wrote three scripts and ran nine `node` commands (12 turns, $0.22).
  - The vscode-s1 session: $0.847 against $0.582 over its three runs, and 213.0 against 184.6 s. N's r1 cross-checked the index with its own script (28 tool calls, $0.578, 169 s); r2 and r3 were faster than every A run, and r3 cheaper too.
  - VSCODE-ENTRIES: $0.088 against $0.043 (scoring 1.00 against 0.95, in 8.8 against 21.0 s): two N runs added `architecture`'s files-nothing-imports report with a limit of 500.
  - VSCODE-CL1: $0.081 against $0.052, at 1.00 each.
  - Slower by the median time: AFFINE-INJECTS1 (38.7 against 35.7 s, with no `calls`), AFFINE-TASK1 (42.5 against 39.2 s) and THEIA-BREAKS1 (44.9 against 38.9 s).
  - Smaller ratios above 1.0: VSCODE-BREAKS1 time 1.05; cost 1.05 to 1.08 on VSCODE-BREAKS2, VSCODE-INJECTS1, VSCODE-TASK1, AFFINE-CALLERS1, AFFINE-TASK2, THEIA-INJECTS1 and THEIA-TASK1.
  - TTRC on THEIA-INJECTS1 (1.85), AFFINE-TASK1 (1.49), THEIA-CALLERS1 (1.46), VSCODE-TASK3 (1.43) and AFFINE-UNUSED (2.27).

### Per question

Every run's score, and what the transcripts show. A question's six runs differ only in arm and repeat. The cost and time columns are the means of the three runs. "Greps" counts `git grep`, `grep` and `rg` commands and the Grep tool.

**VS Code**

| Question | A: r1, r2, r3 | N: r1, r2, r3 | Mean cost A / N | Mean time A / N | What happened |
|---|---|---|---|---|---|
| CALLERS1 (callers) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.084 / $0.070 | 23.9 / 15.5 s | A: two or three greps for `appendKeybinding` under `src`. N: `calls` (33 of the 34 files, one page) and one grep, in 2 tool calls. |
| CALLERS2 (callers) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.132 / $0.110 | 33.1 / 21.6 s | A: 6–7 greps. N: `calls` with `within: "src/vs/sessions"` (11 of 12), then 5–6 greps to check the receivers. |
| BREAKS1 (what breaks) | 0.92, 0.92, 0.89 | 1.00, 0.92, 0.92 | $0.135 / $0.143 | 36.6 / 38.8 s | No N run called `calls`; both arms ran 5–7 greps. Every A run missed `diffEditorWidget.ts` (a call through `this._editors.original`, which the index misses too) and listed `monaco.d.ts`; N r2 and r3 did the same, N r1 got all 13. |
| BREAKS2 (what breaks) | 0.98, 0.98, 0.98 | 0.98, 0.99, 0.98 | $0.246 / $0.274 | 72.9 / 69.9 s | No N run called `calls`. Both arms ran 7–14 greps, some with a script, and five of six runs missed the same two files. A r3's refused command was a search of the whole disk for `typescript.js`, to type-check the repo itself. |
| ADOPT1 (adopt) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.106 / $0.093 | 27.0 / 25.0 s | Every run of both arms: three greps for `showOpenDialog`. No `calls`. |
| INJECTS1 (injects) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.088 / $0.097 | 19.4 / 17.6 s | Every run of both arms: two or three greps for `IWorkbenchAssignmentService`. No `calls`. |
| TASK1 (task) | 1.00, 0.97, 1.00 | 0.95, 0.98, 0.95 | $0.193 / $0.199 | 58.2 / 62.4 s | No tool in N. Both arms grepped the callers and wrote a script to find the tests that import them. Every N run listed `chatThinkingContentPart.test.ts` (it stubs the method) among the files to change; N r1 and r3 missed 11 of the 99 tests and A r2 missed 10. |
| TASK2 (task) | 1.00, 1.00, 1.00 | 1.00, 0.98, 1.00 | $0.205 / $0.201 | 59.3 / 71.1 s | No tool in N. Both arms: greps, then a test-import script. N r2 missed `terminalInstance.test.ts` among the files to change; N r3 took 113 s. A r3's first script heredoc was refused, and it wrote the script with Write instead. |
| TASK3 (task) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.116 / $0.159 | 37.6 / 46.1 s | A: two or three commands, one a `node -e` scan. N r1 called `calls` (limit 500; 74 files across `src`, the question asks for `contrib`) and wrote a script; N r2 wrote three scripts and ran nine `node` commands; N r3 matched A. |
| BP1 (big-picture) | 0.94, 0.94, 0.94 | 0.81, 0.88, 0.81 | $0.033 / $0.039 | 13.8 / 11.0 s | A grepped `.github` and the layout. N called `architecture` (layers) and `describe` on `src/vs`; r1 then read the organization doc. Every N run missed BP1.8 (the extension host). |
| BP2 (big-picture) | 1.00, 0.75, 1.00 | 1.00, 1.00, 1.00 | $0.036 / $0.033 | 15.1 / 10.1 s | N called `architecture` (conventions), whose answer now names the folder's docs, then grepped `source-code-organization.instructions.md`: 1.00 in every run (Eval #2: 0.75 in every run). A r2 answered from `.github/copilot-instructions.md` alone. |
| BP3 (big-picture) | 0.80, 0.90, 0.80 | 0.90, 0.90, 1.00 | $0.031 / $0.033 | 15.0 / 14.6 s | No tool in N. Both arms answered from one or two commands. |
| BP4 (big-picture) | 0.56, 0.56, 0.94 | 1.00, 0.94, 1.00 | $0.062 / $0.051 | 18.1 / 11.1 s | N: `describe` on `workbench` and `workbench/contrib`, `architecture`, then the docs file. A r1 and r2 answered from greps and missed half or all of BP4.1, 4.3–4.5, 4.7 and 4.8 (Eval #2's A: 0.92). |
| BP5 (big-picture) | 0.83, 0.83, 0.83 | 0.83, 0.92, 0.83 | $0.047 / $0.048 | 19.8 / 15.6 s | N: `describe` on `workbench`, then two greps. A: three or four commands. |
| BP6 (big-picture, new: how it's tested) | 0.75, 0.88, 0.69 | 0.75, 0.88, 0.75 | $0.041 / $0.040 | 13.6 / 15.2 s | No tool in N; one to three commands in both arms. |
| BP7 (big-picture, new: disposables) | 0.56, 0.56, 0.56 | 0.56, 0.63, 0.63 | $0.045 / $0.058 | 15.1 / 18.5 s | No tool in N. Both arms answered from two to five commands; no run scored above 0.63. |
| CL1 (direct list) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.049 / $0.073 | 18.7 / 19.9 s | A: a script. N r1 and r2: `imports` (limit 500), then greps, r1 a script too; N r3: a script. |
| CL4 (transitive list) | 0.95, 0.95, 0.95 | 1.00, 1.00, 1.00 | $0.065 / $0.055 | 27.8 / 15.0 s | A: one script, missing the same three entry files in every run. N: one `imports` call. |
| CN1 (chain) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.069 / $0.050 | 24.2 / 6.1 s | A: a breadth-first search script. N: one `imports` call in two turns. |
| IMPACT (impact) | 0.91, 0.91, 0.90 | 1.00, 1.00, 1.00 | $0.069 / $0.032 | 36.6 / 7.4 s | A: a script (0.90–0.91). N: one or two `imports` calls (1.00). |
| CYCLE (cycle) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.038 / $0.030 | 14.7 / 8.9 s | A: a script. N: `architecture` (cycles). |
| UNUSED (files nothing imports) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.042 / $0.044 | 20.4 / 17.8 s | Both arms: the same kind of script. No N run called a tool (Eval #2: 2 of 3). |
| VIOLATIONS (violations) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.045 / $0.048 | 17.3 / 17.1 s | Both arms: a script. No N run called a tool (as in Eval #2). |
| ENTRIES (entries) | 0.95, 0.95, 0.95 | 1.00, 1.00, 1.00 | $0.043 / $0.073 | 20.7 / 8.3 s | A: a script that listed `cliProcessMain.ts` too. N: `imports` (transitive), and in r1 and r3 `architecture`'s files-nothing-imports report with a limit of 500. |
| PAIRS (pairs) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.053 / $0.047 | 21.5 / 18.2 s | A: a script. N: `architecture` (conventions), then a script. |

**AFFiNE**

| Question | A: r1, r2, r3 | N: r1, r2, r3 | Mean cost A / N | Mean time A / N | What happened |
|---|---|---|---|---|---|
| CALLERS1 (callers) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.170 / $0.160 | 39.5 / 37.7 s | A: a Read and 8–11 greps. N: `calls` (2 of the 20 files: most of the rest go through `std.get(ViewExtensionManagerIdentifier)`, an identifier value), then 6–9 greps. |
| CALLERS2 (callers) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.068 / $0.068 | 20.8 / 18.8 s | A: four or five greps. N: `calls` (1 of 12), then three greps. |
| BREAKS1 (what breaks) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.063 / $0.065 | 19.4 / 18.3 s | A: three to five greps. N r2 and r3: `calls` (2 of 11), then greps; N r1: greps, after a refused command (a stray `echo; for f in 1; do :; done`). |
| BREAKS2 (what breaks) | 1.00, 1.00, 1.00 | 1.00, 0.98, 1.00 | $0.109 / $0.089 | 30.3 / 27.8 s | A: a Read and four or five greps. N: `calls` (1 of 25: the rest call `std.event.add`, whose getter's type is inferred), then 4–8 greps; N r2 missed `extension/service.ts`. |
| INJECTS1 (injects) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.136 / $0.122 | 34.7 / 40.5 s | Both arms: greps for `AuthService`, and in five of the six runs a script or `node -e`. No `calls`. |
| TASK1 (task) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.164 / $0.180 | 38.7 / 43.9 s | A: greps and a test-import script. N r1: greps, then `imports` for the tests; r2: greps and a script, after a refused `$(…)`; r3: `calls` (10 of 11), then greps. |
| TASK2 (task) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.222 / $0.224 | 67.4 / 69.0 s | A: 9–10 greps and a test-import script. N: 8–11 greps, then 4–14 `imports` calls for the tests, with no script. |
| BP1 (big-picture) | 1.00, 0.94, 1.00 | 0.81, 0.94, 0.94 | $0.052 / $0.053 | 18.6 / 18.3 s | N: `overview`, then greps; half points lost on BP1.5–1.7. |
| BP2 (big-picture) | 0.63, 0.56, 0.50 | 0.56, 0.63, 0.56 | $0.037 / $0.038 | 14.8 / 15.8 s | N: `describe` on `blocksuite`, then two greps. Both arms low, as in Eval #2. |
| BP3 (big-picture) | 0.56, 0.81, 0.69 | 0.56, 0.56, 0.69 | $0.048 / $0.047 | 17.2 / 21.8 s | No tool in N; two or three greps in both arms. |
| BP4 (big-picture) | 0.56, 0.56, 0.50 | 0.69, 0.63, 0.69 | $0.089 / $0.049 | 22.9 / 19.2 s | N: `search` for storage and sync, then grep. A: six or seven commands. |
| BP5 (big-picture, new: edgeless storage) | 0.88, 0.81, 0.88 | 0.94, 0.88, 0.88 | $0.063 / $0.055 | 19.9 / 18.5 s | No tool in N; three to six greps in both arms. |
| BP6 (big-picture, new: the workbench) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.071 / $0.072 | 20.4 / 18.4 s | N: `search`, then reads or greps. A: three or four commands. 1.00 in every run. |
| CL1 (direct list) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.051 / $0.046 | 18.3 / 16.0 s | A: two to four greps. N: `imports` and a grep. |
| CL4 (transitive list) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.073 / $0.042 | 28.6 / 11.2 s | A: a script (r3's first run of it piped through `tee`, refused). N: one `imports` call. |
| CN1 (chain) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.061 / $0.021 | 24.7 / 5.1 s | A: greps, r2 a script. N: one `imports` call. |
| IMPACT (impact) | 0.99, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.133 / $0.043 | 25.3 / 9.1 s | A: a script; r2's first script went to the background after 120 s (see "What the runs showed about the method"). N: two or three `imports` calls. |
| CYCLE (cycle) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.041 / $0.024 | 16.8 / 7.0 s | A: reads and greps, r2 a script. N: `architecture` (cycles). |
| UNUSED (files nothing imports) | 0.91, 0.91, 0.91 | 1.00, 1.00, 1.00 | $0.068 / $0.050 | 26.1 / 21.0 s | Both arms: a script. No N run called a tool (Eval #2: 3 of 3). Every A run listed `page-list/readme.md`. |
| VIOLATIONS (violations) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.066 / $0.044 | 24.2 / 21.4 s | A: greps and a script. N: three or four greps, no tool (Eval #2: 3 of 3). |
| ENTRIES (entries) | 0.93, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.126 / $0.034 | 57.1 / 5.7 s | A: scripts, edited and re-run in r2 and r3 (12–15 turns); r1 listed `auth.tsx` too. N: one `imports` call. |
| PAIRS (pairs) | 0.94, 0.94, 1.00 | 1.00, 1.00, 1.00 | $0.053 / $0.065 | 21.3 / 25.1 s | A: a script. N r1: 12 `imports` calls, one per folder; r2: one `imports` call and a script; r3: a script, after a refused stray loop. |

**Theia** (held out, free mode)

| Question | A: r1, r2, r3 | N: r1, r2, r3 | Mean cost A / N | Mean time A / N | What happened |
|---|---|---|---|---|---|
| CALLERS1 (callers) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.204 / $0.184 | 21.1 / 19.9 s | A: three to seven greps. N r1 and r2: a grep, then `calls` (13 of 14), then one or two greps; N r3: greps only. |
| BREAKS1 (what breaks) | 1.00, 0.99, 1.00 | 0.99, 1.00, 0.99 | $0.295 / $0.294 | 40.9 / 44.7 s | A: greps, r1 a script after a refused `$(…)`. N r1: a script after the same refusal, then 13 Grep calls; r3: `calls` (34 calling files), then greps. Three runs (A r2, N r1, N r3) missed `examples/api-tests/src/menus.spec.js`, a `.js` test that gets the type through `container.get`. |
| BREAKS2 (what breaks) | 0.96, 0.96, 0.96 | 0.91, 0.96, 0.91 | $0.394 / $0.227 | 53.6 / 30.2 s | A: 7–10 greps and scripts (37–67 s, $0.31–0.49); r1 and r2 also listed three `api-tests` the truth leaves out, r3 missed the three JSDoc-typed tests. N r1 and r3 trusted `calls` (16–19 s, $0.18–0.19) and missed six files (see "The losses"). N r2: no tool, missed the three JSDoc-typed tests. |
| INJECTS1 (injects) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.202 / $0.209 | 20.6 / 20.3 s | Every run of both arms: one to three greps for `EnvVariablesServer`. No `calls`. |
| TASK1 (task) | 1.00, 0.85, 0.95 | 0.90, 1.00, 1.00 | $0.229 / $0.244 | 38.9 / 43.7 s | No tool in N. A r2 and N r1 listed two `.slow-spec.ts` files as tests, which the rule's naming test doesn't count; A r2 and r3 missed two files to change. |
| TASK2 (task) | 0.83, 0.85, 0.98 | 0.85, 0.85, 1.00 | $0.308 / $0.297 | 63.7 / 54.8 s | No tool in N. In two runs of each arm the tests list missed ten `api-tests` `.spec.js` files (TESTS recall 0.55). N r2 and r3 each had one refused command. |
| CL1 (direct list) | 1.00, 1.00, 1.00 | 0.81, 0.81, 1.00 | $0.165 / $0.165 | 20.1 / 18.5 s | A: a script or a `node -e` scan; r1 listed five extra files (precision 0.86). N r1 and r2: one grep whose filter dropped six files (see "The losses"); N r3: a script. No tool call. |
| CL2 (transitive list) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.241 / $0.177 | 41.6 / 22.5 s | A: four or five greps and a script. N: one `imports` call. |
| CN1 (chain) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.166 / $0.140 | 16.1 / 5.3 s | A: a script. N: one `imports` call. |
| CYCLE (cycle) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.169 / $0.157 | 21.2 / 10.7 s | A: a script. N: `architecture` (cycles), then a grep or two. |
| UNUSED (files nothing imports) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.162 / $0.165 | 17.9 / 18.2 s | Both arms: the same script. No tool call. |
| ENTRIES (entries) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.175 / $0.172 | 25.0 / 11.3 s | A: a script. N: one `imports` call. |
| BP1 (big-picture, new: plugins) | 0.94, 0.88, 0.94 | 0.94, 0.94, 0.88 | $0.142 / $0.145 | 11.4 / 10.5 s | Both arms answered almost from memory: zero or one tool call. |
| BP2 (big-picture, new: applications) | 0.75, 0.75, 0.75 | 0.69, 0.75, 0.69 | $0.155 / $0.151 | 14.4 / 16.5 s | One grep or read in both arms. No N run named `@theia/core` as the base extension (BP2.5). |

### The sessions

Each session is four questions in one conversation (Eval #2's, unchanged): the impact of a change to X, a chain from an entry point to X, a cycle through X, and the files nothing imports in X's folder. The score is the mean of the four messages' scores. The cost and time are the session's totals; the "3 runs" columns add up the three repeats.

| Session | A: scores | N: scores | Mean score A / N | Cost, 3 runs, A / N | Time, 3 runs, A / N | Median session cost A / N | Median session time A / N |
|---|---|---|---|---|---|---|---|
| vscode-s1 (notebook cell model) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | 0.999 / 1.000 | $0.582 / **$0.847** | 184.6 / **213.0 s** | $0.201 / $0.180 | 61.0 / 26.0 s |
| affine-s1 (database block) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | 1.000 / 1.000 | $0.603 / $0.367 | 230.6 / 81.8 s | $0.189 / $0.100 | 74.6 / 24.3 s |

- *A* wrote and reused its own import-graph scripts in all six sessions (4–7 `node` commands each). affine-s1 r1's first message had one refused command (a `sed` with a redirect), and the session went on with a script.
- *N* called a tool in all 24 of its messages: 2–5 calls on the impact message (`imports` and `architecture`), then one call on each of the other three. vscode-s1 N r1 also wrote two scripts and ran ten `node` commands to cross-check the index's count, which made it the costliest session of the twelve ($0.578, 169 s). Without it, N's two other VS Code sessions cost $0.180 and $0.088 and took 18 and 26 s.
- In Eval #2, every alone session had a refused command and affine-s1 alone scored 0.83 (two first messages gave up). Here both sessions score 1.00 in both arms, so condition 4's session check passed by +0.0007 and +0.0004.

### Refusals

17 calls were refused, each in a different run: 9 runs of A (4.8%) and 8 of N (4.2%). Every refused call was a Bash command, every one was read, and every run went on to an answer: none gave up.

| Arm | Run | Kind | Score | The refused command, in short | Cause |
|---|---|---|---|---|---|
| A | affine-cl4-baseline-3 | transitive list (Eval #2) | 1.00 | `node <scratch>/g.js \| tee /dev/null \| wc -l; …` | `tee` (named in the sentence), as a no-op |
| A | affine-impact-baseline-3 | impact (Eval #2) | 1.00 | `git ls-files \| … \| sed 's/.*\.//' 2>/dev/null \| head -0` | `sed` and a redirect (named), in a tail that prints nothing |
| A | affine-s1-baseline-1, message 1 | session | 1.00 | `… \| sed 's/.*\.//' 2>/dev/null \| head -0; …` | `sed` and a redirect (named), in a tail that prints nothing |
| A | affine-task2-baseline-3 | task | 1.00 | `node <scratch>/imp.js \| sed 's/ ->.*//' 2>/dev/null \|\| …` | `sed` and a redirect (named) |
| A | theia-breaks1-baseline-1 | what breaks | 1.00 | `git grep -n … -- $(git grep -l "ContextMenuRenderer" …) \| grep -v …` | command substitution `$(…)`, which the sentence doesn't name |
| A | theia-breaks2-baseline-2 | what breaks | 0.96 | `git grep -nE … -- $(git grep -lw "PreferenceService" …) \| grep -v …` | `$(…)` |
| A | theia-task2-baseline-2 | task | 0.85 | `… \| awk 'length($0)>=260' 2>/dev/null \| head -0; …` | `awk` and a redirect (named), in a tail that prints nothing |
| A | vscode-breaks2-baseline-3 | what breaks | 0.98 | `ls node_modules 2>&1 \| head -3; find / -name typescript.js … 2>/dev/null` | redirects (named), in a search of the whole disk for TypeScript |
| A | vscode-task2-baseline-3 | task | 1.00 | `cat > <scratch>/t.js <<'EOF' …` | a heredoc and a redirect (named) |
| N | affine-breaks1-nebulosity-1 | what breaks | 1.00 | `git grep -ln "setMode" \| …; echo; for f in 1; do :; done` | `echo` and a loop (named), as a tail that does nothing |
| N | affine-pairs-nebulosity-3 | pairs (Eval #2) | 1.00 | `ls packages/frontend; …; for d in 1; do :; done` | a loop (named), as a tail that does nothing |
| N | affine-task1-nebulosity-2 | task | 1.00 | `git grep -n -E "…" -- $(git ls-files '…spec.ts' …)` | `$(…)` |
| N | theia-breaks1-nebulosity-1 | what breaks | 0.99 | `git grep -n -E … $(git grep -l "ContextMenuRenderer" …) \| grep -v …` | `$(…)` |
| N | theia-breaks1-nebulosity-3 | what breaks | 0.99 | `… \| grep -v -F -f /dev/null \| cut -d: -f1 2>/dev/null \| sort -u \| wc -l` | `cut` and a redirect (named) |
| N | theia-breaks2-nebulosity-3 | what breaks | 0.91 | `… \| grep -v -E "$(echo x)" \| wc -l; …` | `$(…)`, with `echo` inside it |
| N | theia-task2-nebulosity-2 | task | 0.85 | `git grep -lE "CommandRegistry" … \| xargs 2>/dev/null; git grep … > /dev/null; …` | `xargs` and redirects (named), as steps that print nothing |
| N | theia-task2-nebulosity-3 | task | 1.00 | `for f in ai-chat-ui/… ; do …` | a loop (named) |

By kind, A had refused commands in 1 transitive list, 1 impact, 3 breaks, 3 task runs and 1 session; N in 1 pairs, 4 breaks and 3 task runs. Big-picture, callers, adopt and injects runs had none in either arm. Theia had 8 of the 17 (A 3 of 42 runs, N 5 of 42).

**Causes.**
- *Command substitution, `$(…)`: 5* (A 2, N 3). The rules sentence names neither allowing nor refusing it; the pilot saw it twice and the sentence could not be reworded again (R-L allows one rewording).
- *A pipe into `sed`, `awk`, `cut` or `tee`: 6* (A 5, N 1), each named in the sentence as refused.
- *A shell loop: 3* (all N), named.
- *A heredoc: 1* (A), named.
- *Redirects or `xargs` alone: 2* (A 1, N 1), named.

**A pattern worth recording.** Seven of the 17 refused commands carry the refused construct in a part that does nothing: `; for f in 1; do :; done`, `| head -0` after a `sed` or an `awk`, `| tee /dev/null |`, `xargs 2>/dev/null; … > /dev/null`. Each is one of the constructs the rules sentence lists as refused. The transcripts keep the model's thinking redacted, so why it appended them isn't recorded. It happened in both arms (A 4, N 3), so it doesn't tilt the comparison, but a sentence that lists refused constructs may itself prompt them.

**Against Eval #2.** Over all their runs, Eval #2's alone arm had a refused command in 81 of 135 and its N arm in 18 of 135 (counted from Eval #2's transcripts with the same `refusedCalls`). Eval #3's were 9 of 189 and 8 of 189. On the questions Eval #3 reused, A's graph runs went from 13 of 27 (VS Code) and 24 of 27 (AFFiNE) with a refusal to 0 and 2, and its sessions from 6 of 6 to 1 of 6.

### Tool use

How often N called Nebulosity's tools, by kind (single runs; a session's row counts messages):

| Kind | VS Code | AFFiNE | Theia | All |
|---|---|---|---|---|
| Callers | 6 of 6 | 6 of 6 | 2 of 3 | 14 of 15 |
| What breaks | 0 of 6 | 5 of 6 | 3 of 6 | 8 of 18 |
| Adopt | 0 of 3 | – | – | 0 of 3 |
| Injects | 0 of 3 | 0 of 3 | 0 of 3 | 0 of 9 |
| Task | 1 of 9 | 5 of 6 | 0 of 6 | 6 of 21 |
| Theia's graph questions | – | – | 12 of 18 | 12 of 18 |
| Eval #2's graph questions | 20 of 27 | 20 of 27 | – | 40 of 54 |
| **Condition 5's set** (new and graph) | 27 of 54 | 36 of 48 | 17 of 36 | **80 of 138** |
| Big-picture | 12 of 21 | 12 of 18 | 0 of 6 | 24 of 45 |
| Session messages | 12 of 12 | 12 of 12 | – | 24 of 24 |

Within the graph sets: every chain, cycle, impact, transitive-list and entries run of N called a tool (42 of 42); direct lists 5 of 9 and pairs 5 of 6; files nothing imports 0 of 9 and violations 0 of 6.

- **Which tools.** Over all 189 N runs, sessions included: `imports` 112 calls in 50 runs; `architecture` 35 in 29; `calls` 24 in 24; `describe` 15 in 12; `search` 6 in 6; `overview` 4 in 4. `show_on_map` was never called, which is right with no Map open. One call returned an error (an `imports` call in affine-pairs-nebulosity-1), and the run went on.
- **`calls`.** It was N's first tool call in 19 of its 66 call and task runs; in 40 the first was a Bash command, nearly always a `git grep` for the member's name. It was called once per run, never with `offset`: no run paged. Eight calls asked for a limit of 200 or 500 and three used `within`. Its answers ran from 664 to 10,433 characters. On VS Code's two callers questions and Theia's callers question it listed all but one file. On AFFiNE's callers and breaks questions it listed one or two of 11–25 (and 10 of 11 on TASK1). On Theia's breaks questions it listed most but not all.
- **ToolSearch: 0 calls in all 378 runs.** The six question tools load through their own `_meta`, as on the dev set.
- **Scripts.** A wrote or ran a Node script in 96 of its 183 single runs and in all 6 sessions; N in 42 of 183 and 1 of its 6 sessions. By set: the new questions A 49 of 84, N 25 of 84; Eval #2's graph questions A 47 of 54, N 17 of 54; big-picture none in either arm.
- **The per-turn cost.** N's median first-call context was 2,368 tokens above A's on VS Code, 2,369.5 on AFFiNE and 2,372 on Theia. MCP Dev Set #2 estimated about +2,373 on VS Code and +2,362 to +2,375 on AFFiNE after its last trim (BENCHMARKS.md), so the eval agrees with it to within 7 tokens. Eval #2's six tools cost +2,094 and +2,092; `calls` and the instructions' rewording added about 275 tokens a turn.

### Against Eval #2

The same 27 single questions (VS Code's 9 graph questions and BP1–BP5, AFFiNE's 9 and BP1–BP4) and the same two sessions, with the same prompts apart from the closing sentence, truths and rubrics. Both evals ran three repeats per arm.

| Question | Eval #2: A | Eval #2: N | Eval #3: A | Eval #3: N | N runs with a call, Eval #2 / #3 | Median cost A / N, Eval #2 | Median cost A / N, Eval #3 | Median time A / N, Eval #2 | Median time A / N, Eval #3 |
|---|---|---|---|---|---|---|---|---|---|
| VSCODE-CL1 | 0.97 | 1.00 | 1.00 | 1.00 | 3 / 2 | $0.040 / $0.086 | $0.052 / $0.081 | 17.6 / 19.7 s | 20.1 / 17.4 s |
| VSCODE-CL4 | 0.92 | 1.00 | 0.95 | 1.00 | 3 / 3 | $0.261 / $0.049 | $0.065 / $0.052 | 81.6 / 13.8 s | 25.6 / 14.1 s |
| VSCODE-CN1 | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 3 | $0.037 / $0.022 | $0.048 / $0.023 | 19.6 / 5.5 s | 23.9 / 5.7 s |
| VSCODE-IMPACT | 0.91 | 1.00 | 0.90 | 1.00 | 3 / 3 | $0.105 / $0.028 | $0.070 / $0.027 | 51.4 / 9.6 s | 35.9 / 6.2 s |
| VSCODE-CYCLE | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 3 | $0.035 / $0.022 | $0.037 / $0.031 | 13.1 / 6.2 s | 15.3 / 9.6 s |
| VSCODE-UNUSED | 0.87 | 1.00 | 1.00 | 1.00 | 2 / 0 | $0.073 / $0.100 | $0.041 / $0.043 | 32.5 / 33.3 s | 20.2 / 16.8 s |
| VSCODE-VIOLATIONS | 1.00 | 1.00 | 1.00 | 1.00 | 0 / 0 | $0.047 / $0.052 | $0.046 / $0.048 | 18.1 / 19.3 s | 16.1 / 16.0 s |
| VSCODE-ENTRIES | 0.63 | 1.00 | 0.95 | 1.00 | 3 / 3 | $0.189 / $0.108 | $0.043 / $0.088 | 56.7 / 17.5 s | 21.0 / 8.8 s |
| VSCODE-PAIRS | 1.00 | 0.99 | 1.00 | 1.00 | 3 / 3 | $0.100 / $0.192 | $0.051 / $0.047 | 44.8 / 77.3 s | 21.8 / 18.1 s |
| VSCODE-BP1 | 0.90 | 0.85 | 0.94 | 0.83 | 3 / 3 | $0.032 / $0.031 | $0.031 / $0.041 | 13.9 / 11.0 s | 14.1 / 11.1 s |
| VSCODE-BP2 | 1.00 | 0.75 | 0.92 | 1.00 | 3 / 3 | $0.047 / $0.027 | $0.036 / $0.033 | 13.4 / 10.2 s | 14.9 / 9.4 s |
| VSCODE-BP3 | 0.93 | 0.87 | 0.83 | 0.93 | 0 / 0 | $0.029 / $0.024 | $0.031 / $0.034 | 13.8 / 10.5 s | 14.6 / 14.5 s |
| VSCODE-BP4 | 0.92 | 0.92 | 0.69 | 0.98 | 3 / 3 | $0.062 / $0.050 | $0.060 / $0.050 | 19.2 / 12.9 s | 19.2 / 10.9 s |
| VSCODE-BP5 | 0.89 | 0.83 | 0.83 | 0.86 | 3 / 3 | $0.029 / $0.046 | $0.048 / $0.046 | 13.0 / 15.1 s | 19.7 / 14.6 s |
| AFFINE-CL1 | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 3 | $0.052 / $0.043 | $0.051 / $0.044 | 22.4 / 12.0 s | 18.7 / 15.6 s |
| AFFINE-CL4 | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 3 | $0.353 / $0.041 | $0.076 / $0.042 | 99.9 / 11.5 s | 29.6 / 11.2 s |
| AFFINE-CN1 | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 3 | $0.071 / $0.020 | $0.067 / $0.021 | 28.1 / 5.1 s | 23.2 / 5.1 s |
| AFFINE-IMPACT | 0.66 | 1.00 | 0.99 | 1.00 | 3 / 3 | $0.124 / $0.044 | $0.086 / $0.045 | 44.4 / 9.9 s | 33.9 / 8.8 s |
| AFFINE-CYCLE | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 3 | $0.054 / $0.019 | $0.041 / $0.020 | 15.9 / 4.8 s | 15.9 / 4.4 s |
| AFFINE-UNUSED | 0.94 | 1.00 | 0.91 | 1.00 | 3 / 0 | $0.147 / $0.049 | $0.066 / $0.051 | 40.2 / 17.6 s | 25.3 / 20.2 s |
| AFFINE-VIOLATIONS | 1.00 | 1.00 | 1.00 | 1.00 | 3 / 0 | $0.057 / $0.039 | $0.064 / $0.043 | 22.4 / 13.7 s | 24.5 / 19.8 s |
| AFFINE-ENTRIES | 0.92 | 1.00 | 0.98 | 1.00 | 3 / 3 | $0.158 / $0.034 | $0.137 / $0.034 | 56.9 / 7.0 s | 49.6 / 5.6 s |
| AFFINE-PAIRS | 1.00 | 1.00 | 0.96 | 1.00 | 3 / 2 | $0.079 / $0.094 | $0.051 / $0.056 | 32.1 / 21.3 s | 21.2 / 22.2 s |
| AFFINE-BP1 | 0.94 | 0.88 | 0.98 | 0.90 | 3 / 3 | $0.051 / $0.071 | $0.053 / $0.055 | 20.4 / 22.0 s | 19.5 / 18.3 s |
| AFFINE-BP2 | 0.52 | 0.54 | 0.56 | 0.58 | 3 / 3 | $0.042 / $0.044 | $0.038 / $0.039 | 15.2 / 15.4 s | 15.0 / 15.7 s |
| AFFINE-BP3 | 0.71 | 0.69 | 0.69 | 0.60 | 0 / 0 | $0.054 / $0.060 | $0.047 / $0.042 | 18.7 / 20.3 s | 17.2 / 17.5 s |
| AFFINE-BP4 | 0.63 | 0.63 | 0.54 | 0.67 | 3 / 3 | $0.075 / $0.073 | $0.090 / $0.049 | 25.3 / 22.4 s | 22.5 / 20.2 s |

| Set (the reused questions) | Score A / N, Eval #2 | Score A / N, Eval #3 | Median cost A / N, Eval #2 | Median cost A / N, Eval #3 | Median time A / N, Eval #2 | Median time A / N, Eval #3 | Runs with a refused command A / N, Eval #2 | Eval #3 |
|---|---|---|---|---|---|---|---|---|
| VS Code graph (9) | 0.923 / 0.999 | 0.979 / 1.000 | $0.064 / $0.050 | $0.048 / $0.047 | 27.1 / 15.7 s | 21.1 / 14.1 s | 13 / 7 of 27 | 0 / 0 of 27 |
| AFFiNE graph (9) | 0.947 / 1.000 | 0.982 / 1.000 | $0.079 / $0.041 | $0.066 / $0.043 | 32.1 / 10.4 s | 24.4 / 11.3 s | 24 / 4 of 27 | 2 / 1 of 27 |
| VS Code big-picture (5) | 0.927 / 0.844 | 0.842 / 0.921 | $0.033 / $0.031 | $0.037 / $0.041 | 13.9 / 11.5 s | 15.8 / 11.6 s | 2 / 0 of 15 | 0 / 0 of 15 |
| AFFiNE big-picture (4) | 0.698 / 0.682 | 0.693 / 0.688 | $0.054 / $0.065 | $0.049 / $0.044 | 20.5 / 20.9 s | 17.5 / 17.9 s | 5 / 5 of 12 | 0 / 0 of 12 |
| vscode-s1 (3 sessions) | 0.999 / 1.000 | 0.999 / 1.000 | $0.617 / $0.350 (3 runs) | $0.582 / $0.847 (3 runs) | 249.7 / 85.7 s (3 runs) | 184.6 / 213.0 s (3 runs) | 3 / 0 of 3 | 0 / 0 of 3 |
| affine-s1 (3 sessions) | 0.833 / 1.000 | 1.000 / 1.000 | $1.382 / $0.270 (3 runs) | $0.603 / $0.367 (3 runs) | 447.0 / 71.4 s (3 runs) | 230.6 / 81.8 s (3 runs) | 3 / 0 of 3 | 1 / 0 of 3 |

**What changed between the evals:**
- *The rules sentence*, in place of Eval #2's scripts sentence, in both arms ("The scripts rules and the rules sentence"). Runs with a refused command fell from 60% to 4.8% in A and from 13% to 4.2% in N.
- *Nebulosity, frozen at `2f913ad` instead of `90f9f63`:* the `calls` tool and its index (ADR-059); `architecture` naming its folder's docs and the server's instructions saying to open the docs first (ADR-054 amended after Eval #2); the definitions trimmed to 6,548 characters (R-Q, R-AA); and the instructions reworded three times on the dev set (Task 16).
- *Claude Code 2.1.301* instead of 2.1.300; the same model and effort. The index versions moved from 152 and 131 to 155 and 134 with the re-indexes of R-AC; the files and imports stayed the same.

**What that did:**
- *Claude Code alone got faster and cheaper on the graph questions*, with its scripts no longer refused: VSCODE-CL4 went from $0.261 and 81.6 s to $0.065 and 25.6 s, AFFINE-CL4 from $0.353 and 99.9 s to $0.076 and 29.6 s, VSCODE-ENTRIES from 0.63 to 0.95 and AFFINE-IMPACT from 0.66 to 0.99. N's numbers barely moved. So N's lead on these nine questions per repo narrowed. Taken the gate's way (the median over the questions of each question's ratio of medians), N's time went from 0.48 of A's in Eval #2 to 0.63 here on VS Code, and from 0.30 to 0.38 on AFFiNE (0.37 to 0.59 pooled); its cost from 0.63 to 0.92 and from 0.36 to 0.56 (0.58 to 0.79 pooled). The time lead holds without the refusals; on VS Code, the cost lead is down to 0.92.
- *TTRC on these questions* came out at 0.31 (VS Code) and 0.51 (AFFiNE), 0.41 [0.19–0.84] pooled. Eval #2's references, from its own transcripts and its own graph questions, were 0.33, 0.29 and 0.29 pooled (0.31 on its refusal-free runs).
- *VS Code's big-picture result turned over*, from 0.927 / 0.844 to 0.842 / 0.921. N rose on BP2 (0.75 to 1.00: `architecture`'s answer now names the organization doc, and every N run opened it) and BP4. A fell on BP4 (0.92 to 0.69) and BP3 (0.93 to 0.83) with no change on its side but the closing sentence and Claude Code's version. BP1 stayed a loss for N (0.83 against 0.94). So part of the turnover is A's variance, not N's gain.
- *AFFiNE's files nothing imports and violations questions lost their tool calls*: 6 of 6 N runs called a tool in Eval #2, 0 of 6 here. Both kinds were among the dev set's four stable misses on AFFiNE before the eval. N still scored 1.00 on both.
- *The sessions* lost their refusals in A. affine-s1 alone rose from 0.833 to 1.000 and its cost fell by more than half, so N's lead there shrank from 0.20 to 0.61 of A's cost; vscode-s1 with Nebulosity cost more than alone (above).

### Usage

- **The windows.** The 5-hour window read 0.49 at the first run (06:58 UTC) and rose to 0.81 before it reset at about 09:00 UTC; it read 0.31 at the last run (10:17 UTC). The 7-day window went from 0.71 to 0.76. These are two-decimal readings from the runs' `rate_limit_event`s. The session that ran the eval used the same windows meanwhile (its subagents had moved the week from 0.64 to 0.71 during the night, before the pilot), so the eval's share is at most 0.05 of the week. Neither stop (0.9 and 0.85) was reached.
- **The cost estimate.** Claude Code's list-price estimate for the 378 runs is $42.78:
  - single runs: A $21.13, N $19.25;
  - sessions: A $1.19, N $1.21.

  The pilot's 28 runs were $4.60 of it. The plan expected $35–55. The median single run was $0.077. The costliest single run was THEIA-BREAKS2's second A run, at $0.488, and the costliest session vscode-s1's first N run, at $0.578. Theia's runs cost more in both arms because its first call is about 50,500 tokens: Theia's own `CLAUDE.md` and `AGENTS.md`, which both arms load.
- **Time and tokens.** The single runs' `duration_ms` add up to 84.7 minutes for A and 70.0 for N; the sessions' to 6.9 and 4.9. The single runs' tokens add up to 31.29 million for A and 28.46 million for N, nearly all cache reads. With the dev set ($9.38 for 59 runs), Eval #3 cost about $52 in all.

### What the runs showed about the method

- **The controller, not the owner, approved the full count and ruled on the grades.** The owner was away overnight and had delegated every stop ("just do everything and make the best decisions until i respond tmrw morning"). After the pilot showed that the gate would very likely fail (refusals in 2 of 14 runs per arm, and no `calls` call in the pilot), the controller ran the full schedule rather than cut it, since a cut would drop Theia's only big-picture questions. Every such decision is listed for the owner in the V1.7 ledger.
- **Grading.**
  - 678 big-picture points were graded twice, blind: grader 1 a fresh Sonnet subagent per sheet, grader 2 one Opus subagent over all 90, never shown grader 1's replies. They agreed exactly on 578 (85.3%; Eval #2 84%, Eval #1 88%).
  - All 100 disagreements were half a point. A third, arms-hidden adjudicator (an Opus model) read each disputed point with the full answer and suggested a score with a reason. The controller adopted every suggestion: 32 kept grader 1's score and 68 took grader 2's.
  - The rulings are in `eval3/grading/review.json`, marked as the controller's. The owner can overturn any of them and re-run `npm run eval:grading -- --eval eval3 merge` and the scorer.
- **The graders could still tell many N answers apart.** No answer named Nebulosity or a tool's MCP name, so the redaction changed nothing (`eval3/grading/redactions.json`). But 12 of the 90 answers mention "the index" or "the import graph", ordinary words R-AD keeps: 11 of N's 45 and 1 of A's 45. The one in A is a false positive (affine-bp5-baseline-1 writes "the `index` field", BlockSuite's z-order index), so the arm tell is 11 of N's 45 and none of A's. The grading was blind to the run, but not always to the arm.
- **One run's time is understated.** In affine-impact-baseline-2, A's first script hit Claude Code's 120 s command timeout and was moved to the background. A rewritten script answered, and the run's first `result` came at 198.9 s, 16 turns, $0.221. About nine minutes later the background script was stopped, and Claude Code woke the session with a notification. The model added a note ("That notification is about the first script … My answer doesn't come from it"), and a second `result` closed the run with `duration_ms` 2,830, 1 turn, and a cumulative cost of $0.231. The scorer reads the last result, so the run counts 2.8 s and 1 turn (its clock ran 754 s) and is scored on the note, which repeats the answer (0.996). No gate condition uses that run's time: condition 4 on Eval #2's graph questions uses its cost, which is cumulative and right, and the question's median time (33.9 s) is another run's.
- **Wall time is `duration_ms`.** It leaves out start-up, N's MCP server included, which leans slightly toward N on condition 3. TTRC counts from process start, which leans toward A (R-F); from the query start, N's ratios on the new questions are 0.02–0.10 lower.
- **The threats the method named, as they turned out.**
  - *"Condition 1 rests on the multi-step kinds."* It did, and they split (above).
  - *"The dev set's tool use was 13 of 17 (0.76), so condition 5 is at risk."* The eval's was 0.58. The dev set's four stable misses were VS Code's task and injects questions and AFFiNE's files nothing imports and violations questions. Here VS Code's tasks (1 of 9 runs with a tool), every injects question (0 of 9), and files nothing imports and violations on both repos (0 of 12) went without a tool too, and so did the adopt question and 10 of the 18 breaks runs.
  - *"The calls index misses many of these callers."* It did, and conditions 2 and 3 show it on Theia's BREAKS2. On AFFiNE the runs grepped past it, so it showed as no gain rather than a loss.
  - *"Most of the task changes are already in the code."* No run answered "nothing to change"; every run listed the files the rule defines.
- **No engine change was made after the freeze** (`EVAL3_ENGINE`, `2f913ad`). The index's misses on these targets are recorded above and are the first candidate for work after the results, measured on new targets (ADR-043, amended).

### What this says about the claim

The claim Eval #3 tests is V1.7's: with Nebulosity, Claude Code reaches the files a question needs four times as fast, makes half the errors, and is faster and cheaper end to end on questions about calls through injected services, with no loss elsewhere and no confound from refused commands (D1). **It doesn't.** The gate failed on four of its seven conditions.

In plain sentences:
- **The comparison was clean this time.** The rules sentence brought refused commands down to 4.8% of A's runs and 4.2% of N's, under V's 5%. Eval #3 is the first eval in which neither arm's results are shaped by refusals.
- **Condition 1 failed because both arms find callers the same way, and fast.** Nearly every run, in both arms, began with a `git grep` for the member's name. On these single-method questions that one grep names most of the files at once, so Claude Code alone reached the relevant context as soon as Claude Code with Nebulosity did. `calls` was called in only 24 of 66 call and task runs, and where it was, it arrived in the same turn as the grep.
- **Condition 2 failed because there was little to win, and N lost a little.** Careful grep is nearly exact on a single method's callers: Claude Code alone scored 0.988 on the new questions. Half its error was 0.006. N's few errors came from trusting short answers: an incomplete `calls` answer on Theia's BREAKS2 (the index misses calls through `@theia/core`'s re-exports), and a grep with a bad filter on Theia's direct list, where it called no tool.
- **Condition 3 failed because `calls` saved nothing where it was used, and wasn't used elsewhere.** On AFFiNE, the index missed most callers of the drawn methods (inferred getters, identifier values, inferred locals), so every N run grepped the rest and paid for both. On VS Code and Theia, where `calls` was nearly complete, it cut the callers questions to 0.57–0.66 of the time, not 0.5. VS Code's breaks, adopt, injects and task runs called it once in 21; Theia's breaks runs called it in 3 of 6, and two of those trusted it and lost files.
- **Condition 5 failed because the runs grep the member name first.** That was true on the dev set across three rounds of wording, and true here: 58% of N's runs on new and graph questions called a tool. When a question names a method and a type, Claude Code reaches for grep; when it names a file and asks about imports, it reaches for `imports`.
- **What Nebulosity measurably did, again, was the import walk.** On Eval #2's graph questions, now without refusals in either arm, Claude Code with Nebulosity answered in 0.63 (VS Code) and 0.38 (AFFiNE) of the time per question, at 0.92 and 0.56 of the cost, scoring 1.00 against 0.98. On Theia's held-out graph questions, in free mode, it took 0.58 of the time at 0.95 of the cost and scored 0.978 against 1.000 (one direct-list question with no tool call). On those questions it reached the relevant context in 0.33–0.41 of the time. On the same questions in Eval #2 the ratios were 0.48 and 0.30 for time and 0.63 and 0.36 for cost: part of Eval #2's lead was the refusals, as Eval #2 said, and on VS Code little of the cost lead is left.
- **No loss elsewhere held**, within the gate's margins: big-picture +0.066 (VS Code), +0.003 (AFFiNE) and −0.021 (Theia); the sessions level in score. VS Code's big-picture turnover is partly the alone arm scoring lower than in Eval #2.
- **ADR-024's test, a third time.** Three evals say the same thing: Nebulosity makes Claude Code faster, and sometimes cheaper, on questions that walk the import graph, at an equal or slightly higher score; it doesn't make Claude Code's answers clearly better; and the `calls` tool V1.7 built didn't change that for questions about calls.
- **What this eval doesn't show.**
  - It covers three repos, one model at one effort, three runs per question, and one to three questions per kind per repo.
  - The call questions name a single method. A question that needs many methods, or one whose callers grep can't name, might go differently; this eval didn't ask one.
  - It measured the MCP tools, not the Map, which is for people and has no Claude Code equivalent.

**What the README may claim** (ADR-051 as amended, R-AK). The gate failed, so the README states Eval #3's results as measured, names conditions 1, 2, 3 and 5, and claims nothing beyond the numbers. It can't claim that Nebulosity makes Claude Code reach the relevant context faster on call questions, makes fewer errors, or is faster or cheaper on questions about calls through injected services. By the owner's call of 2026-10-15, the hold on going public lifts after this verdict whatever it is; the deploy, the public switch, the package and the video are the owner's.

### Raw data

- `eval3/runs/`: the 378 scrubbed transcripts (`<question or session>-<arm>-<repeat>.jsonl.gz`) and `index.jsonl`, one summary line per run with its refused calls and index version.
- `eval3/results.json`: every run's and session's score, the files its answer named, its misses and extras (a task's per part), tokens, cost estimate, time, tool calls, refused calls and time to relevant context, each repo's commit, and the gate's verdict. `npm run eval:score -- --eval eval3` writes it and prints the per-run, per-question, per-family, per-repo and kind, session, TTRC, refusal and gate tables.
- `eval3/grading/`: grader 1's replies, the second grader's in `second/`, the 100 rulings in `review.json`, the merged grades in `grades.json`, the redactions in `redactions.json`, the blind sheets in `sheets/` and the key from sheet to run in `key.json`.
- `eval3/questions.json`, `eval3/sessions.json`, `eval3/truth/` (with `adjudicated.json`, `calls-adjudicated.json`, `steps.json` and `needed.json`) and `eval3/rubric/`: the questions, truths and rubrics the scores rest on.
- **What isn't in `results.json`.** The per-repo splits of the gate's per-repo conditions, the TTRC tables split by question set, the tool-use counts by tool, the script counts, the refusal causes, the start-up gap and Eval #2's refusal counts were computed from `results.json` and the kept transcripts by read-only scripts with `scripts/eval/stats.ts` and `scripts/eval/transcript.ts`, by the rules stated here, so anyone can count them again from `eval3/runs/` and `eval2/runs/`.

# 2026 10 14 Eval #2 — Claude Code with and without Nebulosity, on VS Code and AFFiNE

**Status: run, scored and published (2026-10-15): 270 runs (234 single, 36 task sessions) on Claude Code 2.1.300, with the engine frozen at `90f9f63` (2026-10-15, before the pilot). The ship gate failed: conditions 1, 2, 3a and 5a. The results, losses included, are under "Results" at the end of this section.** Everything in this section down to "Results", apart from this status line and the "In short" block below it, was written before the first run: the arms, the setup, the questions and their truths, the scoring and the ship gate. The gate does not change after the first run.

**In short:** the ship gate failed. Conditions 1, 2, 3a and 5a failed; 3b, 4 and 5b passed.
- *What Nebulosity measurably did:* on the questions that walk the import graph, Claude Code with it got its context in a median 2 turns and one Nebulosity call, against 6 turns alone. It answered in 0.30 of the time and 0.47 of the cost estimate of Claude Code alone (both repos pooled, medians), scoring 1.00 against 0.94. In four-question task sessions it took 0.29 of the time and 0.39 of the cost, scoring 1.00 against 0.94.
- *A confound in the cost:* the eval's permission rules refused shell commands outside an allowlist, and Claude Code alone had commands refused in 42 of its 69 graph runs and in all 18 of its sessions. On the graph runs without a refusal, the ratios are 0.39 for time and 0.74 for cost (0.63 matched per question), scoring 1.00 against 0.96. The time advantage holds; part of the cost advantage came from the refusals.
- *What it didn't do:*
  - The grep-hard gain was +0.088, where the gate asked for +0.15. Claude Code alone wrote its own import walkers and scored 0.91.
  - VS Code's big-picture answers were worse again, 0.84 against 0.93. On BP1 and BP2, −0.058 of the −0.083, the tools' answers took the place of the repo's own docs. The other −0.024 is BP3, where no Nebulosity tool was called, and BP5.
  - On VS Code, its median cost on graph questions was 0.57 of Claude Code alone's (scoring 1.00 against 0.94), where the gate asked for 0.5.
  - 10 of the 90 runs that should have called a tool wrote a script instead.

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

*Added after the eval (2026-10-15), for the next eval's method:* `eval.json` may carry `"shell": "compound"`, which appends `Bash(cd:*),Bash(echo:*)` to `--allowedTools` in both arms. Eval #2 ran without it (`eval2/eval.json` leaves it unset). What it covers, and why it covers few of the refusals below, is in ADR-057's amendment of that date.

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

**The runs.** All 270 ran on 2026-10-15 between 08:36 and 10:57 UTC: the pilot's 20 (16 single runs and 4 task sessions), then the other 218 single runs, then the other 32 sessions, one batch at a time with the machine otherwise kept quiet. One of its 16 logical processors was busy throughout, though: this build session's own runaway shell command (a `python -` probe started 2026-10-14 at 18:43 that never exited; seen before the runs but taken for another session's process, and found to be this session's own only afterwards) used it fully, in both arms alike, so it weighs on the absolute times more than on the ratios. 270 runs were kept: 234 single runs and 36 task sessions. No run was an outage, and none was refused by the checks except the first attempt of vscode-s2-nebulosity-1, stopped by the checkout check for the controller's own change (below). One session was run twice, for the controller's own mistake (see "What the runs showed about the method"). Every init message showed Claude Code 2.1.300, `claude-sonnet-5-5`, permission mode `dontAsk` and no API key, and every N run had `nebulosity` connected. Sonnet 5.5 was the only model that answered: no run used a subagent. Every run ended in `success`, so none hit its turn or budget limit. Both repos were at their commits with a clean `git status` after every run. Nebulosity's index was at version 152 (VS Code) and 131 (AFFiNE) in every run. The lists, chains and grep-hard answers were scored by `npm run eval:score -- --eval eval2`. Two chain steps the scorer asked about were read in the source and decided in `eval2/truth/steps.json`. Beyond those, the scorer's readout lists 9 chain steps to read (5 on VS Code, 4 on AFFiNE) for 7 of A's chain runs, and A's alternative session chains and cycles hold 11 more, which the readout doesn't list. V1.6's final review read all 20 at the pinned commits: every one holds, so no score moves. The big-picture answers were graded as "Scoring" says. Every number below is recomputed from `eval2/results.json`, `eval2/runs/index.jsonl` and the kept transcripts. "A" is Claude Code alone and "N" is Claude Code with Nebulosity. Time is `duration_ms` throughout, as D1 defines it. Cost is Claude Code's own list-price estimate (`total_cost_usd`), not a bill: the runs used the owner's subscription.

### The gate (D1): FAIL

| # | Condition | VS Code | AFFiNE | Result |
|---|---|---|---|---|
| 1 | Grep-hard, both repos pooled: N's mean ≥ A's + 0.15, and no grep-hard question more than 0.05 below A | Pooled: A 0.912, N 0.999, a margin of **+0.088** (needs +0.150). Worst question: VSCODE-PAIRS, −0.008 (the floor is −0.05). | (pooled) | **FAIL** |
| 2 | Each repo × big-picture, lists (direct and transitive) and chains: N's mean ≥ A's − 0.03 | Big-picture 0.927 → 0.844, **−0.083**. Lists 0.953 → 0.988 (+0.035). Chains 1.000 → 1.000. | Big-picture 0.698 → 0.682 (−0.016). Lists 1.000 → 1.000. Chains 0.917 → 1.000 (+0.083). | **FAIL** (VS Code, big-picture) |
| 3a | Each repo's chains, transitive list and grep-hard runs: N's median cost ≤ 0.5 × A's, and median time ≤ 0.5 × A's | Cost $0.048 → $0.027, **0.568**. Time 20.9 s → 8.7 s, 0.417. | Cost $0.079 → $0.034, 0.434. Time 31.5 s → 7.5 s, 0.238. | **FAIL** (VS Code, cost) |
| 3b | Each repo's big-picture and direct-list runs: N's median cost ≤ 1.15 × A's | $0.0468 → $0.0457, 0.976 | $0.0541 → $0.0533, 0.985 | PASS |
| 4 | Each repo's task sessions: N's total cost and total time ≤ 0.6 × A's, and N's mean score ≥ A's − 0.03 | Cost $1.678 → $0.779, 0.464. Time 692.5 s → 240.6 s, 0.347. Score 0.977 → 1.000. | Cost $3.116 → $1.212, 0.389. Time 1,041.1 s → 234.6 s, 0.225. Score 0.907 → 1.000. | PASS |
| 5a | N's list, chain and grep-hard runs, both repos: the share that calls a Nebulosity tool ≥ 0.90 | 38 of 48 | 42 of 42 | **FAIL**: 80 of 90, **0.889** |
| 5b | Each repo's single runs: N's median first-call context − A's ≤ 2,500 tokens | 21,433 → 23,527, +2,094 | 21,209 → 23,301, +2,092 | PASS |

`gateVerdict` reports only the worst repo of each condition. The other repo's numbers in this table were recomputed from `eval2/results.json` the same way. They match the scorer's printout wherever it prints them.

**The verdict: the gate failed on conditions 1, 2, 3a and 5a.** Nebulosity made Claude Code faster and cheaper on the questions that walk the import graph and in the task sessions, at an equal or higher score, though part of the cost difference comes from the alone arm's refused shell commands (see "A confound" below). But its grep-hard gain was +0.088, not +0.15. It lowered VS Code's big-picture score again. Its median cost on VS Code's graph questions was 0.57 of Claude Code alone's, not 0.5. And on VS Code, Claude Code wrote its own script instead of calling a tool in 10 of the runs that should have used one.

### How fast Claude gets the relevant context

This is what the owner asked to see first: how much faster Nebulosity gets Claude Code the context a question needs, and at what accuracy. Each row puts A and N side by side with the ratio N ÷ A. A ratio below 1 means N used less. The mean score sits beside every speed number. The medians are over the row's runs: three a question, so a grep-hard kind's row is three runs an arm.
- **Time:** the run's `duration_ms`. **Cost:** Claude Code's estimate.
- **Context read:** input + cache writes + cache reads, summed over every model call of the run. It is everything Claude read, so it grows with turns × the size of each turn's prompt.
- **Turns:** the run's `num_turns`.
- **Nebulosity calls:** N's calls to its tools.
- **File reads and searches:** Read, Grep, Glob, and Bash commands other than scripts.
- **Script steps:** writing or editing a script (Write and Edit under the scratch folder, or a Bash heredoc), and each `node` run.

Refused calls count where they were made. For a session, the row is the whole session (four messages), and its time is the sum of the messages'.

**VS Code**

| Questions | Runs per arm | Score A / N | Time A / N | N ÷ A | Cost A / N | N ÷ A | Context read A / N | N ÷ A | Turns A / N | Nebulosity calls (N) | File reads and searches A / N | Script steps A / N |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Big-picture | 15 | 0.93 / 0.84 | 13.9 / 11.5 s | 0.83 | $0.033 / $0.031 | 0.96 | 44,618 / 48,652 | 1.09 | 3 / 3 | 1 | 2 / 1 | 0 / 0 |
| Direct lists | 12 | 0.96 / 0.98 | 28.0 / 22.7 s | 0.81 | $0.073 / $0.073 | 1.00 | 96,943 / 101,801 | 1.05 | 4 / 4 | 0.5 | 1.5 / 2 | 2 / 1.5 |
| Transitive list | 3 | 0.92 / 1.00 | 81.6 / 13.8 s | **0.17** | $0.261 / $0.049 | **0.19** | 380,477 / 49,727 | **0.13** | 16 / 2 | 1 | 13 / 0 | 2 / 0 |
| Chains | 15 | 1.00 / 1.00 | 19.4 / 5.3 s | **0.28** | $0.033 / $0.020 | 0.59 | 66,809 / 47,529 | 0.71 | 3 / 2 | 1 | 0 / 0 | 2 / 0 |
| Impact | 3 | 0.91 / 1.00 | 51.4 / 9.6 s | **0.19** | $0.105 / $0.028 | **0.27** | 156,206 / 48,545 | 0.31 | 8 / 2 | 1 | 1 / 0 | 6 / 0 |
| Cycle | 3 | 1.00 / 1.00 | 13.1 / 6.2 s | 0.48 | $0.035 / $0.022 | 0.63 | 67,067 / 47,648 | 0.71 | 3 / 2 | 1 | 0 / 0 | 2 / 0 |
| Files nothing imports | 3 | 0.87 / 1.00 | 32.5 / 33.3 s | 1.02 | $0.073 / $0.100 | 1.36 | 119,936 / 165,683 | 1.38 | 6 / 7 | 1 | 3 / 5 | 2 / 0 |
| Violations | 3 | 1.00 / 1.00 | 18.1 / 19.3 s | 1.07 | $0.047 / $0.052 | 1.11 | 91,486 / 124,774 | 1.36 | 4 / 5 | 0 | 1 / 2 | 2 / 2 |
| Entries | 3 | 0.63 / 1.00 | 56.7 / 17.5 s | **0.31** | $0.189 / $0.108 | 0.57 | 208,744 / 144,127 | 0.69 | 9 / 5 | 2 | 7 / 2 | 2 / 0 |
| Pairs | 3 | 1.00 / 0.99 | 44.8 / 77.3 s | **1.73** | $0.100 / $0.192 | **1.92** | 150,113 / 336,703 | 2.24 | 8 / 16 | 1 | 1 / 13 | 6 / 1 |
| Grep-hard, pooled | 18 | 0.90 / 1.00 | 29.8 / 18.1 s | 0.61 | $0.067 / $0.053 | 0.79 | 117,128 / 111,658 | 0.95 | 5.5 / 4.5 | 1 | 1 / 1.5 | 2 / 0 |
| **Graph questions** (chains, transitive list, grep-hard: gate 3a's set) | 36 | 0.94 / 1.00 | 20.9 / 8.7 s | **0.42** | $0.048 / $0.027 | **0.57** | 92,119 / 48,542 | **0.53** | 4.5 / 2 | 1 | 1 / 0 | 2 / 0 |
| Every single question | 63 | 0.94 / 0.96 | 20.1 / 12.9 s | 0.64 | $0.047 / $0.040 | 0.85 | 91,486 / 62,890 | 0.69 | 4 / 3 | 1 | 1 / 0 | 2 / 0 |
| **Task sessions** (4 messages each) | 9 | 0.98 / 1.00 | 76.7 / 26.1 s | **0.34** | $0.168 / $0.079 | **0.47** | 376,843 / 240,347 | 0.64 | 16 / 10 | 6 | 3 / 0 | 11 / 0 |

**AFFiNE**

| Questions | Runs per arm | Score A / N | Time A / N | N ÷ A | Cost A / N | N ÷ A | Context read A / N | N ÷ A | Turns A / N | Nebulosity calls (N) | File reads and searches A / N | Script steps A / N |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Big-picture | 12 | 0.70 / 0.68 | 20.5 / 20.9 s | 1.02 | $0.054 / $0.065 | **1.20** | 93,811 / 116,017 | 1.24 | 6 / 8 | 1 | 5 / 6 | 0 / 0 |
| Direct lists | 9 | 1.00 / 1.00 | 22.4 / 12.0 s | 0.54 | $0.059 / $0.043 | 0.73 | 97,078 / 53,686 | 0.55 | 6 / 3 | 1 | 5 / 1 | 0 / 0 |
| Transitive list | 3 | 1.00 / 1.00 | 99.9 / 11.5 s | **0.12** | $0.353 / $0.041 | **0.12** | 550,836 / 48,728 | **0.09** | 19 / 2 | 1 | 16 / 0 | 2 / 0 |
| Chains | 12 | 0.92 / 1.00 | 25.8 / 5.0 s | **0.19** | $0.065 / $0.019 | **0.30** | 125,981 / 47,048 | 0.37 | 6 / 2 | 1 | 4.5 / 0 | 1 / 0 |
| Impact | 3 | 0.66 / 1.00 | 44.4 / 9.9 s | **0.22** | $0.124 / $0.044 | 0.36 | 185,663 / 76,365 | 0.41 | 8 / 4 | 3 | 4 / 0 | 2 / 0 |
| Cycle | 3 | 1.00 / 1.00 | 15.9 / 4.8 s | **0.30** | $0.054 / $0.019 | 0.36 | 114,035 / 47,123 | 0.41 | 5 / 2 | 1 | 3 / 0 | 0 / 0 |
| Files nothing imports | 3 | 0.94 / 1.00 | 40.2 / 17.6 s | 0.44 | $0.147 / $0.049 | 0.33 | 180,384 / 98,897 | 0.55 | 8 / 5 | 1 | 7 / 3 | 0 / 0 |
| Violations | 3 | 1.00 / 1.00 | 22.4 / 13.7 s | 0.61 | $0.057 / $0.039 | 0.68 | 114,960 / 74,610 | 0.65 | 6 / 5 | 1 | 5 / 3 | 0 / 0 |
| Entries | 3 | 0.92 / 1.00 | 56.9 / 7.0 s | **0.12** | $0.158 / $0.034 | **0.22** | 263,191 / 50,320 | **0.19** | 11 / 2 | 1 | 6 / 0 | 3 / 0 |
| Pairs | 3 | 1.00 / 1.00 | 32.1 / 21.3 s | 0.66 | $0.079 / $0.094 | **1.19** | 167,413 / 121,573 | 0.73 | 8 / 22 | 20 | 5 / 2 | 2 / 0 |
| Grep-hard, pooled | 18 | 0.92 / 1.00 | 33.9 / 10.2 s | **0.30** | $0.101 / $0.044 | 0.43 | 177,694 / 75,450 | 0.42 | 8 / 4 | 1 | 5 / 0.5 | 0 / 0 |
| **Graph questions** (gate 3a's set) | 33 | 0.93 / 1.00 | 31.5 / 7.5 s | **0.24** | $0.079 / $0.034 | **0.43** | 147,245 / 50,318 | **0.34** | 8 / 2 | 1 | 5 / 0 | 1 / 0 |
| Every single question | 54 | 0.89 / 0.93 | 23.5 / 11.2 s | 0.48 | $0.065 / $0.041 | 0.63 | 118,519 / 72,962 | 0.62 | 6 / 4 | 1 | 5 / 1 | 0 / 0 |
| **Task sessions** (4 messages each) | 9 | 0.91 / 1.00 | 106.3 / 25.1 s | **0.24** | $0.319 / $0.156 | **0.49** | 782,464 / 374,599 | 0.48 | 26 / 11 | 6 | 9 / 0 | 12 / 0 |

**Both repos pooled**

| Questions | Runs per arm | Score A / N | Time A / N | N ÷ A | Cost A / N | N ÷ A | Context read A / N | N ÷ A | Turns A / N |
|---|---|---|---|---|---|---|---|---|---|
| Big-picture | 27 | 0.83 / 0.77 | 15.0 / 14.8 s | 0.98 | $0.048 / $0.043 | 0.90 | 92,055 / 74,377 | 0.81 | 5 / 5 |
| Direct lists | 21 | 0.98 / 0.99 | 26.2 / 19.7 s | 0.75 | $0.064 / $0.061 | 0.96 | 97,078 / 92,455 | 0.95 | 4 / 4 |
| Graph questions | 69 | 0.94 / 1.00 | 28.1 / 8.4 s | **0.30** | $0.066 / $0.031 | **0.47** | 120,424 / 48,728 | **0.40** | 6 / 2 |
| Every single question | 117 | 0.92 / 0.95 | 22.3 / 12.0 s | 0.54 | $0.057 / $0.041 | 0.73 | 112,640 / 72,472 | 0.64 | 6 / 3 |
| Task sessions | 18 | 0.94 / 1.00 | 90.6 / 25.9 s | **0.29** | $0.224 / $0.088 | **0.39** | 528,266 / 256,068 | 0.48 | 19.5 / 10.5 |

**What this shows.** On the questions that need a walk over the import graph (chains, the transitive lists and the six grep-hard kinds), Claude Code with Nebulosity got its context in a median of 2 turns and one Nebulosity call. Claude Code alone took 4.5 turns on VS Code and 8 on AFFiNE, of grep, file reads and scripts of its own. With Nebulosity it answered:
- **VS Code:** 2.4 times as fast (8.7 s against 20.9 s), at 0.57 of the cost estimate and reading 0.53 of the tokens. On the runs where Claude Code alone had no command refused, 2.7 times as fast, at 0.63 of the cost, scoring 1.00 against 0.995.
- **AFFiNE:** 4.2 times as fast (7.5 s against 31.5 s), at 0.43 of the cost and 0.34 of the tokens. On refusal-free runs, 2.6 times as fast, at 0.72 of the cost, scoring 1.00 against 0.86.
- **Accuracy:** a mean score of 1.00 against 0.94 (VS Code) and 0.93 (AFFiNE).
- **Task sessions** (four related questions in one conversation): 2.9 and 4.2 times as fast (median 26 s against 77 s, and 25 s against 106 s), at 0.47 and 0.49 of the median cost, scoring 1.00 against 0.98 and 0.91. Every one of Claude Code alone's sessions had a refused command.
- **The biggest gains:**
  - the transitive lists: 5.9 times as fast on VS Code (scoring 1.00 against 0.92) and 8.7 times on AFFiNE (1.00 against 1.00), at 0.19 and 0.12 of the cost;
  - the entries questions: 3.2 and 8.1 times as fast (1.00 against 0.63 and 0.92), at 0.57 and 0.22 of the cost.

  10 of Claude Code alone's 12 runs on these four questions had a refused command.

**It was not faster everywhere.**
- *VSCODE-PAIRS:* N was slower and costlier, at 1.73 times the time and 1.92 times the cost, scoring 0.99 against 1.00.
  - The `architecture` conventions report covers only folder names that recur in 26 or more folders, so every N run had to compute the rest itself.
  - N r1's script ran: 18.7 s and $0.045, faster and cheaper than every A run.
  - N r2's and r3's script heredocs were refused, so they grepped by hand: 20 and 15 calls, 80 and 77 s, $0.27 and $0.19.
- *VS Code's files-nothing-imports and violations questions:* N took about as long as A and cost 1.1–1.4 times as much, scoring 1.00 against 0.87 and 1.00 against 1.00. On violations no N run called a tool at all.
- *Direct lists on VS Code:* the cost was the same (1.00) and N's time was 0.81 of A's, scoring 0.98 against 0.96.
- *Big-picture:* N was about as fast, and no better: lower on VS Code (0.84 against 0.93) and level on AFFiNE (0.68 against 0.70), where it cost 1.20 times as much.

So the speed gains are real where the question is a walk over the import graph, and part of the cost gains comes from the eval's refused commands (below). They are not a general speed-up, and they came with no gain on the questions about how a repo is organized.

**A confound: refused shell commands in the alone arm.**
- *Where it comes from.* The eval ran Claude Code with `--permission-mode dontAsk`, so a shell command outside the allowlist was refused, not asked about (see "What the runs showed about the method").
- *A refusal costs more than its own turn.* When a script was refused, Claude Code alone often walked the imports with grep instead, in 10–28 calls: VSCODE-CL4 A r2 and r3, VSCODE-CN3 r2, VSCODE-CN4 r2 and AFFINE-CN2 r3.
- *How many runs it touched.* Refusals touched 16 of A's 36 VS Code graph runs, 26 of its 33 AFFiNE ones and all 18 of its sessions. For N, the counts were 6, 4 and 0.

So the ratios above mix Nebulosity's effect with what the refusals cost the alone arm. Two ways to take the refusals out, both rough:

| Graph questions | All runs: time / cost, N ÷ A | Refusal-free runs only: time / cost (runs, A / N) | Score on those runs, A / N |
|---|---|---|---|
| VS Code | 0.42 / 0.57 | 0.37 / 0.63 (20 / 30) | 0.995 / 1.000 |
| AFFiNE | 0.24 / 0.43 | 0.38 / 0.72 (7 / 29) | 0.857 / 1.000 |
| Both repos, pooled | 0.30 / 0.47 | 0.39 / 0.74 (27 / 59) | 0.959 / 1.000 |
| Matched per question: the 15 graph questions with at least one refusal-free A run, the median of the questions' ratios | 0.30 / 0.59 | 0.39 / 0.63 | 0.927 / 1.000 (the questions' means) |

- *Pooled* refusal-free runs change the question mix. A's 27 such runs lean to VS Code's chains, which it scripted cheaply. They include no run of 8 graph questions: VSCODE-IMPACT and VSCODE-PAIRS, and AFFiNE's CL4, impact, files nothing imports, violations, entries and pairs.
- *Matched* compares each question's N runs with that question's refusal-free A runs. It rests on a single A run for 7 of the 15 questions.
- *Single questions swing.* Against their one refusal-free A run:
  - VSCODE-CL4: the cost ratio goes from 0.19 to 0.74, and the time ratio from 0.17 to 0.49;
  - VSCODE-ENTRIES: the cost ratio from 0.57 to 2.63, and the time ratio from 0.31 to 0.88;
  - VSCODE-UNUSED: the cost ratio from 1.36 to 2.35.
- *Sessions* have no refusal-free comparison: every A session had a refused command.

**What the confound means.**
- *Time:* the advantage holds without the refusals. On refusal-free runs N took about 0.4 of A's time, 2.6–2.7 times as fast on each repo.
- *Cost:* part of the advantage came from the refusals. On refusal-free runs N's cost on graph questions was 0.63–0.74 of A's, not 0.43–0.57, so the gate's 0.5 would not be met on either repo.
- *Accuracy:* the gain holds on refusal-free runs, 1.00 against 0.96 pooled.
- *For a user:* someone who approves Claude Code's shell commands as they come would likely see costs nearer the refusal-free figures.

### The headline

The score is the mean over the family's runs: the share of rubric points for big-picture, recall for lists, the chain score for chains, and each grep-hard kind's own score (impact by relative error, cycles by validity and length, F1 for files nothing imports, violations, entries and pairs). Recall and precision are shown where the score has them. The medians are over the same runs. "Tokens, all" counts every token of every model, output included.

| Repo | Family | Arm | Runs | Mean score | Recall | Precision | Median tokens, all | Median first call | Median cost | Median time | Median tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VS Code | Big-picture | A | 15 | 0.927 | – | – | 45,888 | 21,367 | $0.033 | 13.9 s | 2 |
| VS Code | Big-picture | N | 15 | 0.844 | – | – | 49,738 | 23,462 | $0.031 | 11.5 s | 2 |
| VS Code | Lists (direct and transitive) | A | 15 | 0.953 | 0.95 | 1.00 | 101,073 | 21,432 | $0.078 | 28.2 s | 3 |
| VS Code | Lists (direct and transitive) | N | 15 | 0.988 | 0.99 | 1.00 | 104,175 | 23,523 | $0.067 | 21.6 s | 3 |
| VS Code | Chains | A | 15 | 1.000 | – | – | 68,169 | 21,442 | $0.033 | 19.4 s | 2 |
| VS Code | Chains | N | 15 | 1.000 | – | – | 47,847 | 23,532 | $0.020 | 5.3 s | 1 |
| VS Code | Grep-hard | A | 18 | 0.902 | 1.00 | 0.91 | 119,590 | 21,486 | $0.067 | 29.8 s | 4.5 |
| VS Code | Grep-hard | N | 18 | 0.999 | 1.00 | 1.00 | 113,305 | 23,577 | $0.053 | 18.1 s | 3.5 |
| AFFiNE | Big-picture | A | 12 | 0.698 | – | – | 95,731 | 21,150 | $0.054 | 20.5 s | 5 |
| AFFiNE | Big-picture | N | 12 | 0.682 | – | – | 118,153 | 23,244 | $0.065 | 20.9 s | 7 |
| AFFiNE | Lists (direct and transitive) | A | 12 | 1.000 | 1.00 | 1.00 | 116,999 | 21,205 | $0.071 | 23.3 s | 5 |
| AFFiNE | Lists (direct and transitive) | N | 12 | 1.000 | 1.00 | 1.00 | 53,454 | 23,298 | $0.041 | 11.8 s | 2 |
| AFFiNE | Chains | A | 12 | 0.917 | – | – | 128,614 | 21,212 | $0.065 | 25.8 s | 5 |
| AFFiNE | Chains | N | 12 | 1.000 | – | – | 47,434 | 23,303 | $0.019 | 5.0 s | 1 |
| AFFiNE | Grep-hard | A | 18 | 0.921 | 0.97 | 0.95 | 182,147 | 21,221 | $0.101 | 33.9 s | 7 |
| AFFiNE | Grep-hard | N | 18 | 1.000 | 1.00 | 1.00 | 76,498 | 23,313 | $0.044 | 10.2 s | 3 |

The grep-hard kinds one by one. Recall and precision belong to the F1 kinds:

| Repo | Kind | A: scores | A: mean | N: scores | N: mean | Recall A / N | Precision A / N | Median cost A / N | Median time A / N |
|---|---|---|---|---|---|---|---|---|---|
| VS Code | Impact | 0.91, 0.91, 0.91 | 0.909 | 1.00, 1.00, 1.00 | 1.000 | – | – | $0.105 / $0.028 | 51.4 / 9.6 s |
| VS Code | Cycle | 1.00, 1.00, 1.00 | 1.000 | 1.00, 1.00, 1.00 | 1.000 | – | – | $0.035 / $0.022 | 13.1 / 6.2 s |
| VS Code | Files nothing imports | 1.00, 1.00, 0.62 | 0.872 | 1.00, 1.00, 1.00 | 1.000 | 1.00 / 1.00 | 0.81 / 1.00 | $0.073 / $0.100 | 32.5 / 33.3 s |
| VS Code | Violations | 1.00, 1.00, 1.00 | 1.000 | 1.00, 1.00, 1.00 | 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | $0.047 / $0.052 | 18.1 / 19.3 s |
| VS Code | Entries | 0.00, 0.95, 0.95 | 0.632 | 1.00, 1.00, 1.00 | 1.000 | 1.00 / 1.00 | 0.90 / 1.00 | $0.189 / $0.108 | 56.7 / 17.5 s |
| VS Code | Pairs | 1.00, 1.00, 1.00 | 1.000 | 1.00, 1.00, 0.98 | 0.992 | – | – | $0.100 / $0.192 | 44.8 / 77.3 s |
| AFFiNE | Impact | 0.99, 0.00, 0.99 | 0.663 | 1.00, 1.00, 1.00 | 1.000 | – | – | $0.124 / $0.044 | 44.4 / 9.9 s |
| AFFiNE | Cycle | 1.00, 1.00, 1.00 | 1.000 | 1.00, 1.00, 1.00 | 1.000 | – | – | $0.054 / $0.019 | 15.9 / 4.8 s |
| AFFiNE | Files nothing imports | 0.91, 1.00, 0.91 | 0.939 | 1.00, 1.00, 1.00 | 1.000 | 1.00 / 1.00 | 0.89 / 1.00 | $0.147 / $0.049 | 40.2 / 17.6 s |
| AFFiNE | Violations | 1.00, 1.00, 1.00 | 1.000 | 1.00, 1.00, 1.00 | 1.000 | 1.00 / 1.00 | 1.00 / 1.00 | $0.057 / $0.039 | 22.4 / 13.7 s |
| AFFiNE | Entries | 0.93, 0.83, 1.00 | 0.922 | 1.00, 1.00, 1.00 | 1.000 | 0.90 / 1.00 | 0.96 / 1.00 | $0.158 / $0.034 | 56.9 / 7.0 s |
| AFFiNE | Pairs | 1.00, 1.00, 1.00 | 1.000 | 1.00, 1.00, 1.00 | 1.000 | – | – | $0.079 / $0.094 | 32.1 / 21.3 s |

A run with no `ANSWER:` line has no recall or precision, so VSCODE-ENTRIES' A recall and precision are over its two answered runs.

### The losses

- **VS Code's big-picture questions: 0.844 against 0.927 (−0.083), where the gate allows −0.03.** Eval #1 lost here too (−0.090).
  - *Per question:* BP2 −0.25 (0.75 in every N run against 1.00 in every A run), BP3 −0.07, BP5 −0.06, BP1 −0.04, BP4 0.00.
  - *What the transcripts show:* on BP1 and BP2, N answered from Nebulosity's tool answers instead of the repo's own written rules.
    - On BP2, every N run's first call was `architecture` with the conventions report. Its answer gives measured import counts for the folder names that recur in 26 or more folders. It has no "Docs about it" line, and it leaves out `electron-utility`, which recurs in fewer folders. No N run opened `.github/instructions/source-code-organization.instructions.md`, which every A run read after grepping `.github`. All three N runs missed BP2.5 (`electron-utility`) and half of BP2.6 (what `electron-main` may use). They said where their rules came from: "The "may import" rules are my reading of that data plus VS Code's usual layering convention, which I didn't check against the repo's docs" (r1), and "I didn't read the repo's written layering rules, so the allowed-import rules are inferred from those counts" (r3).
    - On BP1, two N runs called `describe` on `src/vs`. Its answer lists that same file first under "Docs about it", and the server's instructions say to read the docs the tools point to. Neither run opened it: "I didn't open the repo's `source-code-organization` doc, which is the authoritative rulebook" (r2).
    - So N did not miss the docs for lack of a pointer. On BP1 it saw the pointer and kept the tool's answer. On BP2 the tool it chose carries no pointer.
  - *Where the pointer was followed, N was level.* On BP4 every N run called `describe` on `src/vs/workbench`, then opened or grepped the instructions file, and scored 0.92 like A. Eval #1's BP4 loss (−0.28) is gone.
  - *BP3 and BP5:* no N run called a tool on BP3; all six runs answered mostly from memory. On BP5, N called `describe` or `architecture`, then grepped the entry files. The gaps are half-points on BP3.6 (the registration runs at module scope) and BP5.6 (a new file is loaded by importing it from a `.contribution.ts`), which A earned in some runs and missed in others.
  - *AFFiNE's big-picture questions:* −0.016, within the gate. That is the repo without a repo-level agent guide, and Nebulosity's summaries, `overview` and `describe` didn't raise it either.
- **Condition 1: +0.088 on the grep-hard questions, against the +0.15 asked.** N scored 1.00 on 35 of its 36 grep-hard runs (VSCODE-PAIRS r3: 0.98), a mean of 0.999. A scored 0.912.
  - *A wrote its own import walkers.* It ran a Node script in 16 of its 18 VS Code grep-hard runs and 6 of its 18 AFFiNE ones, and scored 1.00 in every run of 6 of the 12 grep-hard questions (both cycles, both violations, both pairs).
  - *Even a perfect N could not have passed.* With A at 0.912, the most N could gain was +0.089 (1 − 0.9115 = 0.0885). To pass, A would have had to score 0.85 or less.
  - *Where A lost points:*
    - two answers that gave up after a refused command (VSCODE-ENTRIES r1 and AFFINE-IMPACT r2, 0 each: see "What the runs showed about the method"). They are 0.054 of A's gap. Had each scored its question's other runs' mean, A's mean would be 0.965 and the margin +0.034;
    - VSCODE-IMPACT, 0.91 in every run: three scripts that agreed with each other, at 4,484–4,485 against 4,503;
    - files that aren't code listed beside the right ones: VSCODE-UNUSED r3 (0.62) and AFFINE-UNUSED r1 and r3 (0.91);
    - an extra or missing entry point in four ENTRIES runs.
- **Condition 3a on VS Code: a cost ratio of 0.568, against 0.5.** The time ratio, 0.417, passed. AFFiNE passed both (0.434 and 0.238).
  - *Chains are 15 of VS Code's 36 graph runs.* There, A ran a breadth-first search script in two calls (Write, then `node`) in 13 of 15 runs, at a median $0.033 and 19.4 s. N answered with one `imports` call in two turns (one run made two calls), at $0.020 and 5.3 s.
  - *N has a cost floor.* Two turns over a prompt of about 23,500 tokens cost $0.018–0.020: N's cheapest run of the 117 was $0.018. Against a script that costs $0.03, N can't reach half. VSCODE-PAIRS (1.92 times A's cost) and VSCODE-UNUSED (1.36 times) pushed the median the other way.
  - *On AFFiNE, A scripted less:* it ran a script in 12 of its 42 list, chain and grep-hard runs, against 37 of 48 on VS Code. It walked the imports with grep, which made its runs longer and costlier.
- **Condition 5a: 80 of 90 (0.889), against 0.90.**
  - *The ten N runs without a tool call are all VS Code:* CL2 r2 and r3, CL3 r1–r3, CL5 r3, VIOLATIONS r1–r3 and UNUSED r3.
  - *Each began by writing its own Node scanner* (Write, then `node`; UNUSED r3 through a `cat` heredoc) and never called a tool. Their transcripts don't say why: the model's thinking isn't kept.
  - *They scored as A's scripts did:* 1.00 on CL3, VIOLATIONS and UNUSED. On CL2 (0.93) and CL5 (0.96) they missed the same Copilot fixtures A missed. `imports` returns those fixtures, and N's runs that called it on CL2 and CL5 scored 1.00.
  - *The prompt offers that route:* its scripts sentence is the same in both arms.
  - *On AFFiNE,* 42 of 42 N runs in the set called a tool.
- **Where N was slower or costlier than Claude Code alone**, by the medians above:
  - VSCODE-PAIRS: 1.73 times the time and 1.92 times the cost, at 0.99 against 1.00. Two N runs had their script heredocs refused and grepped by hand. N r1, whose script ran, was faster and cheaper than every A run;
  - VSCODE-UNUSED: 1.02 times the time and 1.36 times the cost, at 1.00 against 0.87;
  - VSCODE-VIOLATIONS: 1.07 and 1.11, at 1.00 each, with no tool call;
  - AFFiNE's big-picture questions: 1.20 times the cost, at 0.68 against 0.70;
  - AFFINE-PAIRS: 1.19 times the cost, though 0.66 times the time, at 1.00 each. Two N runs made one `imports` call per folder, 20 calls each;
  - VS Code's direct lists: no saving in cost (1.00), at 0.98 against 0.96.
  - On CL1, N's mean cost was $0.101 against A's $0.067, at 1.00 against 0.97: N called `imports` and then checked its answer with 2–10 greps.

### Per question

Every run's score, and what the transcripts show. A question's six runs differ only in arm and repeat. The cost and time columns are the means of the three runs.

**VS Code**

| Question | A: r1, r2, r3 | N: r1, r2, r3 | Mean cost A / N | Mean time A / N | What happened |
|---|---|---|---|---|---|
| BP1 layers | 0.88, 0.88, 0.94 | 0.81, 0.88, 0.88 | $0.033 / $0.031 | 14.3 / 11.2 s | A grepped `.github/copilot-instructions.md` and listed `src/vs`. N called `architecture` (layers), then `describe` on `src/vs` (r1, r2) or the conventions report (r3). Two N runs saw the instructions file named by `describe` and didn't open it. N r1 missed BP1.8 (the extension host). |
| BP2 environments | 1.00, 1.00, 1.00 | 0.75, 0.75, 0.75 | $0.047 / $0.027 | 13.5 / 10.4 s | Every A run grepped `.github` and read the environments table in `source-code-organization.instructions.md`. Every N run took `architecture`'s conventions report (names in 26 or more folders, no docs pointer, no `electron-utility`) and missed BP2.5 and half of BP2.6. |
| BP3 services | 0.90, 1.00, 0.90 | 0.90, 0.90, 0.80 | $0.027 / $0.024 | 13.0 / 10.7 s | No N run called a tool. A r2 and r3 grepped `platform/instantiation` once. The spread is BP3.6, in both arms. |
| BP4 workbench | 0.88, 0.94, 0.94 | 0.94, 0.94, 0.88 | $0.078 / $0.074 | 17.9 / 13.3 s | Level. Every run read the instructions file's contribution rules. N got there through `describe`'s docs pointer, after `describe` on `workbench` and `contrib` and `architecture`. |
| BP5 builds | 0.92, 0.83, 0.92 | 0.83, 0.83, 0.83 | $0.030 / $0.045 | 13.3 / 15.7 s | A listed `src/vs/workbench` and read the main entry files. N called `describe` or `architecture`, then grepped the entry files. Every N run half-earned BP5.6, which two A runs earned in full. |
| CL1 (22) | 1.00, 0.95, 0.95 | 1.00, 1.00, 1.00 | $0.067 / $0.101 | 20.4 / 23.1 s | A wrote a scanner. In r2 and r3 the scanner missed `mainThreadNotebook.ts`. Every N run called `imports` (all 22), then checked with 2–10 greps. |
| CL2 (41) | 0.93, 0.83, 0.93 | 1.00, 0.93, 0.93 | $0.069 / $0.079 | 30.1 / 27.9 s | A's scanners missed the three Copilot fixtures whose `vs/…` ids name debug files (r2 missed four more). N r1 called `imports`, which gave all 41 (V1.6's module ids). N r2 and r3 wrote scanners instead and missed the same three. |
| CL3 (3) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.064 / $0.045 | 27.6 / 19.8 s | Every run found all three. No N run called a tool: each wrote a scanner, as A r3 did. A r1 and r2 had their scripts refused and grepped instead. |
| CL4 (66, transitive) | 0.95, 0.86, 0.95 | 1.00, 1.00, 1.00 | $0.202 / $0.049 | 64.6 / 14.3 s | N: one `imports` call (transitive) each, all 66, the computed loaders included (V1.6's resolution; Eval #1's tool runs got 63). A r1's script left out the three loader files. A r2 and r3 had their script runs refused (a compound command) and walked with grep, 15 calls in 82–84 s. |
| CL5 (57) | 1.00, 0.96, 0.96 | 1.00, 1.00, 0.96 | $0.088 / $0.083 | 31.9 / 29.0 s | N r1 and r2 called `imports` and got all 57. N r3, A r2 and A r3 used scripts and missed the two Copilot fixtures. A r1's script run was refused; it grepped and counted them. |
| CN1 (4 steps) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.038 / $0.022 | 21.0 / 5.8 s | N: one `imports` call with `to`. A: a breadth-first search script, then a grep check, in 2–4 calls. |
| CN2 (5) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.030 / $0.020 | 17.0 / 5.3 s | N: one `imports` call. A: a search script in 2 calls. |
| CN3 (4) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.086 / $0.020 | 32.5 / 6.1 s | N: one `imports` call. A r1 and r3 used a script (2 calls). A r2's heredoc was refused, and it traced by hand in 10 calls ($0.19, 63 s). |
| CN4 (none) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.059 / $0.019 | 22.8 / 4.7 s | N: `imports` to the folder `src/vs/workbench`, "doesn't reach" (r3 made a second call). A r1 and r3 used a script. A r2's was refused, and it grepped `strings.ts`'s closure in 10 calls. |
| CN5 (3) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.042 / $0.019 | 18.8 / 4.7 s | N: one `imports` call. A: a search script (r2 fixed it after two refusals, in 9 calls). |
| IMPACT | 0.91, 0.91, 0.91 | 1.00, 1.00, 1.00 | $0.099 / $0.028 | 51.8 / 10.6 s | N: one `imports` call (transitive, `group_by`) gave every line exactly (4,503). A's three scripts agreed with each other: 4,484–4,485 in all, 10 against 11 in `src/vs/code`, and 7 against 25 elsewhere. |
| CYCLE | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.033 / $0.023 | 13.8 / 6.9 s | N: `architecture` cycles through the file (r1 checked the steps with grep). A: a script in 2 calls. |
| UNUSED | 1.00, 1.00, 0.62 | 1.00, 1.00, 1.00 | $0.160 / $0.105 | 47.8 / 31.3 s | N r1 and r2 called `architecture` (unused), then checked with Glob and Grep (r2 in 14 calls). N r3 wrote a script. A r3 listed four images and a `.md` beside the four files (precision 0.44). A r2 grepped by hand, 17 calls and $0.36. |
| VIOLATIONS | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.047 / $0.050 | 18.2 / 18.4 s | Every run of both arms wrote a scanner and found the five test files. No N run called a tool. |
| ENTRIES | 0.00, 0.95, 0.95 | 1.00, 1.00, 1.00 | $0.175 / $0.102 | 53.8 / 15.5 s | N: `imports` (transitive) plus `architecture` (unused), all nine roots. A r1's heredoc was refused. It grepped, then asked whether it might run node instead of answering (no `ANSWER:` line). A r2 and r3 listed `cliProcessMain.ts` as a tenth root, which the truth's `cli.ts` loader verdict leaves out. |
| PAIRS (21) | 1.00, 1.00, 1.00 | 1.00, 1.00, 0.98 | $0.096 / $0.167 | 42.2 / 58.6 s | A: a script in every run. N called `architecture` conventions, which leaves out `electron-utility` and `worker`. N r1 then wrote a script. N r2 and r3 had a heredoc refused and grepped by hand (20 and 15 calls, $0.27 and $0.19, about 80 s), and r3 missed one pair. |

**AFFiNE**

| Question | A: r1, r2, r3 | N: r1, r2, r3 | Mean cost A / N | Mean time A / N | What happened |
|---|---|---|---|---|---|
| BP1 parts | 0.94, 0.94, 0.94 | 0.88, 0.88, 0.88 | $0.051 / $0.063 | 20.3 / 20.6 s | A listed folders and read package files, the README, `docs/developing-server.md` and the self-host compose file. N called `overview`, then `describe` on the packages (1–6 calls; r1 made 13 tool calls). Each N run lost two half-points among BP1.3 (BlockSuite used as workspace packages), BP1.6 (the server is needed only for cloud features) and BP1.7 (what it runs on). Each A run lost one. |
| BP2 BlockSuite | 0.50, 0.44, 0.63 | 0.44, 0.69, 0.50 | $0.049 / $0.045 | 17.5 / 16.1 s | Low in both arms. No run said each block's text has its own inline editor (BP2.4), and four of six missed that the app wraps lit components in React (BP2.6). N called `describe` on `blocksuite` (r2 made four more Nebulosity calls). A listed folders. |
| BP3 blocks | 0.75, 0.75, 0.63 | 0.75, 0.69, 0.63 | $0.053 / $0.057 | 19.3 / 19.3 s | No N run called a tool. Both arms read one block's `store.ts`, `view.ts` and model. |
| BP4 docs and sync | 0.63, 0.69, 0.56 | 0.69, 0.63, 0.56 | $0.075 / $0.074 | 25.5 / 22.2 s | N started with `search` (r2 then called `describe` on nbstore and read its README). Both arms read nbstore's storage, sync and IndexedDB schema. No run mentioned the JSON snapshots (BP4.4), and only N r1 half-earned y-octo (BP4.8). |
| CL1 (26) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.054 / $0.043 | 21.7 / 11.5 s | N: `imports`, then grep checks. A: grep, after its `git grep` pipeline was refused. |
| CL2 (24) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.056 / $0.035 | 21.0 / 8.9 s | N: `imports` and one grep. A: grep, or a short script (r1), in 3–7 calls. |
| CL3 (34) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.084 / $0.060 | 23.7 / 16.7 s | N: `imports` on the folder and a grep check. A: grep, after a refused first command. |
| CL4 (56, transitive) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.279 / $0.041 | 82.6 / 13.7 s | N: one `imports` call (transitive). A walked the closure with grep: r1 for 16 calls before writing a 107-line script (18 calls in all, $0.39, 109 s), r2 in 23 calls ($0.35, 100 s). A r3 wrote a script ($0.09, 39 s). |
| CN1 (4 steps) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.074 / $0.020 | 28.0 / 5.3 s | N: one `imports` call with `to`. A traced it by hand, in 5–9 calls. |
| CN2 (5) | 0.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.117 / $0.019 | 42.9 / 4.7 s | A r1 claimed `affine/all/src/std/index.ts` imports `framework/std/src/gfx/index.ts`. That file is `export * from '@blocksuite/std'`, whose "." export is `src/index.ts`, so the chain is invalid (the verdict is in `steps.json`). A r3 took 28 calls ($0.24, 92 s). N: one call. |
| CN3 (4) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.080 / $0.019 | 24.7 / 4.4 s | N: one call. A: grep and reads in 3–6 calls (r2's and r3's scripts were refused). |
| CN4 (none) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.053 / $0.033 | 22.2 / 7.8 s | N: `imports` to the helper folder, then a grep check. A: grep, or a script. |
| IMPACT | 0.99, 0.00, 0.99 | 1.00, 1.00, 1.00 | $0.099 / $0.044 | 34.9 / 9.9 s | N: three `imports` calls with `group_by`, exact (1,620). A r1 and r3 wrote resolvers of 148–161 lines and got 101 against 104 in `packages/frontend/apps`. A r2's first command was refused. It then asked to be allowed to run node instead of answering (no `ANSWER:` line). |
| CYCLE | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.046 / $0.019 | 16.5 / 4.5 s | N: one `architecture` cycles call, about 5 s. A read through the dependency-injection framework's files with grep (r1's script was refused). |
| UNUSED | 0.91, 1.00, 0.91 | 1.00, 1.00, 1.00 | $0.148 / $0.051 | 38.7 / 17.5 s | N: `architecture` (unused), then checks (r3 wrote a script). A r1 and r3 listed the folder's `readme.md` beside the five files. |
| VIOLATIONS | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.059 / $0.039 | 22.5 / 12.8 s | N: one `imports` call with `within`. A: grep, in 5–10 calls. All four files are `import type`. |
| ENTRIES | 0.93, 0.83, 1.00 | 1.00, 1.00, 1.00 | $0.174 / $0.034 | 61.3 / 7.2 s | N: one `imports` call (transitive), 7 s. A r1 and r3 wrote resolvers of 64–115 lines (r1 listed one extra page). A r2 walked by hand in 15 calls and missed two roots. |
| PAIRS (17) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | $0.129 / $0.081 | 47.3 / 23.2 s | N r1: one `imports` call with `group_by`, then a script. N r2 and r3: one `imports` call per folder, 20 each. A: scripts (r2 grepped instead, 36 calls and $0.26). |

### The sessions

Each session is four questions in one conversation: the impact of a change to X, a chain from an entry point to X, a cycle through X, and the files nothing imports in X's folder. The score is the mean of the four messages' scores. The cost and time are the session's totals, and the "3 runs" columns add up the three repeats.

| Session | A: scores | N: scores | Mean score A / N | Cost, 3 runs, A / N | Time, 3 runs, A / N |
|---|---|---|---|---|---|
| vscode-s1 (notebook cell model) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | 0.999 / 1.000 | $0.617 / $0.350 | 249.7 / 85.7 s |
| vscode-s2 (inline completions model) | 0.96, 0.96, 0.96 | 1.00, 1.00, 1.00 | 0.962 / 1.000 | $0.577 / $0.227 | 265.6 / 83.9 s |
| vscode-s3 (terminal environment) | 0.95, 0.95, 1.00 | 1.00, 1.00, 1.00 | 0.969 / 1.000 | $0.484 / $0.201 | 177.3 / 71.0 s |
| affine-s1 (database block) | 0.75, 0.75, 1.00 | 1.00, 1.00, 1.00 | 0.833 / 1.000 | $1.382 / $0.270 | 447.0 / 71.4 s |
| affine-s2 (AI onboarding) | 1.00, 0.67, 1.00 | 1.00, 1.00, 1.00 | 0.889 / 1.000 | $0.898 / $0.470 | 288.6 / 71.5 s |
| affine-s3 (surface block) | 1.00, 1.00, 1.00 | 1.00, 1.00, 1.00 | 1.000 / 1.000 | $0.836 / $0.471 | 305.5 / 91.7 s |
| **VS Code, all 9** | | | 0.977 / 1.000 | $1.678 / $0.779 | 692.5 / 240.6 s |
| **AFFiNE, all 9** | | | 0.907 / 1.000 | $3.116 / $1.212 | 1,041.1 / 234.6 s |

Message by message (medians over the 9 sessions of each repo and arm):

| Repo | Message | Score A / N | Cost A / N | Time A / N | Nebulosity calls (N) | Script steps A / N |
|---|---|---|---|---|---|---|
| VS Code | 1. impact | 0.91 / 1.00 | $0.070 / $0.034 | 35.8 / 10.2 s | 3 | 4 / 0 |
| VS Code | 2. chain | 1.00 / 1.00 | $0.040 / $0.014 | 14.9 / 5.2 s | 1 | 2 / 0 |
| VS Code | 3. cycle | 1.00 / 1.00 | $0.022 / $0.014 | 12.9 / 4.9 s | 1 | 2 / 0 |
| VS Code | 4. files nothing imports | 1.00 / 1.00 | $0.029 / $0.013 | 14.0 / 5.5 s | 1 | 2 / 0 |
| AFFiNE | 1. impact | 0.78 / 1.00 | $0.149 / $0.102 | 53.2 / 10.4 s | 3 | 4 / 0 |
| AFFiNE | 2. chain | 0.89 / 1.00 | $0.045 / $0.019 | 17.1 / 5.0 s | 1 | 2 / 0 |
| AFFiNE | 3. cycle | 1.00 / 1.00 | $0.040 / $0.015 | 15.8 / 3.6 s | 1 | 2 / 0 |
| AFFiNE | 4. files nothing imports | 0.96 / 1.00 | $0.037 / $0.017 | 12.8 / 5.0 s | 1 | 2 / 0 |

(The score column is the mean, not the median.)

**What happened in them.**
- *A* wrote an import-graph script in 17 of its 18 sessions (8 of them after a refused first command) and reused it for the later messages. In affine-s1 r1, it made 44 calls in 163 s on the first message before giving up on it.
- *N* never wrote a script. It called a tool in 71 of its 72 messages, 1–10 calls each. The exception, affine-s3 r1's cycle message, was answered from the earlier calls.
- *A's lost points:*
  - affine-s1 r1 and r2, message 1: it gave up after a refused command and asked to be allowed to run node (0 each);
  - affine-s2 r2, message 2: a chain through `detail-page.tsx` line 7, a commented-out import (0; the verdict is in `steps.json`); message 4: one of the two files (0.67);
  - vscode-s2, message 1 in every run: 3 files elsewhere against 12 (0.85);
  - vscode-s3 r1 and r2, message 1: 75 files in `platform/agentHost` against 54 (0.81).

### Tool use

How often N called Nebulosity's tools, by kind:

| Kind | VS Code: N runs with a call | VS Code: calls | AFFiNE: N runs with a call | AFFiNE: calls |
|---|---|---|---|---|
| Big-picture | 12 of 15 | 23 | 9 of 12 | 23 |
| Direct lists | 6 of 12 | 6 | 9 of 9 | 9 |
| Transitive list | 3 of 3 | 3 | 3 of 3 | 3 |
| Chains | 15 of 15 | 16 | 12 of 12 | 13 |
| Impact | 3 of 3 | 3 | 3 of 3 | 9 |
| Cycle | 3 of 3 | 3 | 3 of 3 | 3 |
| Files nothing imports | 2 of 3 | 2 | 3 of 3 | 3 |
| Violations | 0 of 3 | 0 | 3 of 3 | 3 |
| Entries | 3 of 3 | 6 | 3 of 3 | 3 |
| Pairs | 3 of 3 | 3 | 3 of 3 | 41 |
| Gate 5a's set (all but big-picture) | 38 of 48 | | 42 of 42 | |
| Task sessions (messages with a call) | 36 of 36 | 48 | 35 of 36 | 65 |

- **Which tools.**
  - Over all 135 N runs, sessions included: `imports`, 191 calls in 86 runs; `architecture`, 66 in 46; `describe`, 25 in 13; `overview`, 3; `search`, 3.
  - `show_on_map` was never called, which is right with no Map open.
  - Nebulosity was called in 21 of the 27 big-picture runs. In Eval #1, the arm at the default tool search called it in none.
- **ToolSearch: 0 calls in all 270 runs.** The five question tools load through their own `_meta` (ADR-056), as on the dev set.
- **Scripts in N.** N ran a Node script in 13 of its 90 list, chain and grep-hard runs (11 VS Code, 2 AFFiNE), and in none of its sessions. A ran one in 49 of its 90 (37 VS Code, 12 AFFiNE) and in 17 of its 18 sessions.
- **The per-turn cost.**
  - N's median first-call context was 2,094 tokens above A's on VS Code (23,527 against 21,433) and 2,092 above on AFFiNE (23,301 against 21,209).
  - Task 13's one-turn probes measured +2,091 on both repos (MCP Dev Set #1, BENCHMARKS.md), and Task 3 measured Nebulosity's definitions and instructions at about 2,000 tokens. The eval's first calls agree with both to within 3 tokens.
  - Loading every deferred tool instead costs +10,955 (Task 3's probe), which V1.6 avoids by loading only Nebulosity's five.
  - Over a whole run, N read fewer tokens than A on every row of "How fast Claude gets the relevant context" except VS Code's big-picture questions, direct lists, files nothing imports, violations and pairs, and AFFiNE's big-picture questions.

### Against Eval #1

The same 15 VS Code questions, with the same prompts, truths and rubrics. Eval #1 ran them twice per arm and Eval #2 three times. "B" is Eval #1's Nebulosity arm at Claude Code's default tool search, which is what its README reported. U, with every tool loaded up front, is in Eval #1's own tables. Eval #1's time is recomputed here as `duration_ms`, so it differs slightly from its own tables, which used the process clock.

| Question | Eval #1: A | Eval #1: B | Eval #2: A | Eval #2: N | Eval #1: B's runs with a call | Eval #2: N's runs with a call |
|---|---|---|---|---|---|---|
| BP1 | 0.91 | 0.91 | 0.90 | 0.85 | 0 of 2 | 3 of 3 |
| BP2 | 1.00 | 0.79 | 1.00 | 0.75 | 0 of 2 | 3 of 3 |
| BP3 | 0.95 | 0.95 | 0.93 | 0.87 | 0 of 2 | 0 of 3 |
| BP4 | 0.94 | 0.66 | 0.92 | 0.92 | 0 of 2 | 3 of 3 |
| BP5 | 0.75 | 0.79 | 0.89 | 0.83 | 0 of 2 | 3 of 3 |
| CL1 | 1.00 | 0.80 | 0.97 | 1.00 | 0 of 2 | 3 of 3 |
| CL2 | 0.93 | 0.93 | 0.89 | 0.95 | 0 of 2 | 1 of 3 |
| CL3 | 1.00 | 1.00 | 1.00 | 1.00 | 0 of 2 | 0 of 3 |
| CL4 | 0.93 | 0.95 | 0.92 | 1.00 | 2 of 2 | 3 of 3 |
| CL5 | 1.00 | 1.00 | 0.98 | 0.99 | 0 of 2 | 2 of 3 |
| CN1–CN5 | 1.00 each | 1.00 each | 1.00 each | 1.00 each | 10 of 10 | 15 of 15 |

| Family | Eval #1: score A / B | Eval #2: score A / N | Eval #1: median cost A / B | Eval #2: median cost A / N | Eval #1: median time A / B | Eval #2: median time A / N |
|---|---|---|---|---|---|---|
| Big-picture | 0.909 / 0.819 (−0.090) | 0.927 / 0.844 (−0.083) | $0.021 / $0.022 | $0.033 / $0.031 | 12.0 / 11.1 s | 13.9 / 11.5 s |
| Lists | 0.972 / 0.935 (−0.037) | 0.953 / 0.988 (+0.035) | $0.082 / $0.067 | $0.078 / $0.067 | 23.5 / 22.7 s | 28.2 / 21.6 s |
| Chains | 1.000 / 1.000 | 1.000 / 1.000 | $0.065 / $0.020 (0.31) | $0.033 / $0.020 (0.59) | 22.0 / 6.5 s (0.30) | 19.4 / 5.3 s (0.28) |

**What changed between them:**
- *Nebulosity (V1.6).* Imports resolve through module ids, workspace packages and computed `import()` sites (ADR-053, with the two gaps fixed before the freeze). `describe` and `overview` name the docs about a place (ADR-054). There are six tools, five of them always loaded, with `imports` and `architecture` in place of `dependents`, `dependencies` and `path` (ADR-055, ADR-056).
- *The eval.* Scripts are allowed in both arms, there are three repeats, and Claude Code moved from 2.1.299 to 2.1.300.

**What that did:**
- *Lists turned from a loss into a small gain* (−0.04 to +0.04). With the tool, CL1 and CL4 came out complete: CL4's computed loaders and CL2's and CL5's module-id fixtures are now in the index.
- *Big-picture stayed a loss* (−0.09 to −0.08), with its cause moved:
  - BP4's gap closed, because `describe` now names the instructions file and N opened it.
  - BP2's gap stayed (−0.21 to −0.25). In Eval #1, B answered BP2 from memory without a tool. In Eval #2, N answered from `architecture`'s counts. Neither read the instructions file.
- *Chains stayed at 1.00 in both arms.* N's time stayed about 0.3 of A's. Its cost ratio rose from 0.31 to 0.59, because Claude Code alone now scripts its search: A's median cost fell from $0.065 to $0.033, while N's stayed at $0.020.

Eval #1 named this caveat ("A user who lets Claude Code run scripts may see A answer these more cheaply"). Eval #2 measured it.

### Usage

- **The windows.** The 5-hour window went from 0.18 at the first run to 0.71 at the last. The 7-day window went from 0.31 to 0.37. Both are two-decimal readings from the runs' `rate_limit_event`s, all within one 5-hour window (no reading fell between runs). The session that ran the eval, and its graders, used the same windows meanwhile. So the eval's share is at most 0.53 of a 5-hour window and 0.06 of a week. Neither stop (0.9 and 0.85) came close.
- **The cost estimate.** Claude Code's list-price estimate for the 270 runs is $22.26:
  - single runs: A $9.74, N $5.73;
  - sessions: A $4.79, N $1.99.

  The pilot's 20 runs were $2.45 of it. The plan expected $20–40. The median single run was $0.049. The costliest single run was AFFINE-CL4's first A run, at $0.389, and the costliest session was affine-s1's first A run, at $0.760.
- **Time and tokens.**
  - The single runs' `duration_ms` add up to 57.8 minutes for A and 28.5 for N; the sessions' to 28.9 and 7.9.
  - The single runs' tokens add up to 16.71 million for A and 10.06 million for N, nearly all cache reads.

### What the runs showed about the method

- **One session was run twice, for the controller's own mistake.**
  - While the session batch ran, the controller wrote the 54 blind grading sheets into the checkout (`eval2/grading/sheets/`). The runner's checkout check then stopped the batch after its first run, `vscode-s2-nebulosity-1`.
  - That attempt was complete and valid: four messages, each ending in `success`. It was refused only because the checkout had changed. Its raw transcript is kept at `.nebulosity/eval2/raw/vscode-s2-nebulosity-1.20261015T102335.jsonl`.
  - The runner re-ran the session as attempt 2, its rule for a run not kept, and the gate uses that run, as it does every kept run.
  - Attempt 1, scored the same way from its raw transcript (`npm run eval:score -- --eval eval2 --runs <a folder holding only it> --out <a scratch file>`): **1.00** (1.00 on each message), $0.153, 23.4 s, 5 Nebulosity calls. Attempt 2, kept: **1.00** (1.00 on each message), $0.070, 26.1 s, 5 Nebulosity calls.
  - With attempt 1 in its place, condition 4 on VS Code would read cost 0.514 and time 0.344, and pass either way.
- **The controller, not the owner, approved the full count.** The method says the owner approves it after the pilot. The owner was away and had delegated the stops overnight ("just do everything … dont stop until everything is done"), so the controller chose the full schedule, three repeats, because the pilot's extrapolation put the rest at about half of one 5-hour usage window (0.3–0.75) and about 0.11 of the week, well inside the runner's guards. The decision is recorded for the owner's review with the alternative (two repeats).
- **The turn and budget limits never ran against Claude Code.** The method expected the pilot to show whether `--max-turns` counts per message or per process, and what hitting `--max-budget-usd` does to a session. Every one of the 270 runs ended in `success`, so neither limit was reached, and both questions stay open: the runner's paths for a limit (`scripts/eval/session.ts`) have run only in tests.
- **Grading.**
  - 390 big-picture points were graded twice, blind. The graders agreed exactly on 326 (84%; Eval #1: 174 of 198, 88%).
  - Of the 64 disagreements, 51 were on AFFiNE (BP1 15, BP2 20, BP3 6, BP4 10) and 13 on VS Code (BP1 6, BP3 1, BP4 4, BP5 2).
  - The owner was away and had delegated the stops ("just do everything … if u MUST decide, jot it down"). For each disagreement, a third, arms-hidden adjudicator (an Opus model) read the full answer and suggested a score with a reason. The controller adopted every suggestion: 32 kept grader 1's score and 32 changed it (14 changes on A's answers, 18 on N's).
  - The rulings and their reasons are in `eval2/grading/review.json`, marked as the controller's. The owner can overturn any of them and re-run `npm run eval:grading -- --eval eval2 merge` and the scorer.
- **The graders could tell many N answers apart.**
  - 3 of the 54 big-picture answers name Nebulosity: VSCODE-BP1 N r1 and r2, and VSCODE-BP4 N r2. They were not redacted. Eval #1 had none.
  - Beyond those, 13 of the 27 N answers say their facts came from "the import graph" or "the index", against 2 of the 27 A answers (VSCODE-BP5 r1 and r3, which use "import graph" as a concept).
  - So the grading was blind to the run, but not always to the arm.
- **Refused shell commands.** Under `dontAsk`, Claude Code refuses a Bash command it can't match to the allowlist. The first reading, corrected below: one that starts with `cd` or `mkdir` (`cd <repo> && …`, `mkdir -p … && cat > s.js <<EOF`), or that chains or pipes into a command outside the list.
  - *How many:* 131 calls were refused in all. A had 72 in 63 of its 117 single runs and 40 in its sessions. N had 19 in 18 single runs and none in its sessions. 98 of the 131 began with `cd`, and 18 with `mkdir`.
  - *Why, read again after the eval (2026-10-15; ADR-057, amended):* the leading `cd` was rarely the cause, since 161 kept commands with a cd ran. 59 refused commands wrote a file (sed -i, a redirect or heredoc, mkdir, tee), and 33 ran git after a cd to a `/c/…` path. Claude Code's guard against a planted repository appears to refuse that under dontAsk whatever the allow rules say: that's read from its code, and no such command ran in the eval, but the live check didn't exercise the guard. The rest had a sed filter (11), a loop (10), a read through `..` (9), two cds (3), awk, xargs or python3 (4), a cd outside the working folders (1), or no cause found (1). Two cds were checked before cd-then-git; in the order listed, those two counts are 35 and 1.
  - *Which runs:* refusals touched 16 of A's 36 VS Code graph runs, 26 of its 33 AFFiNE graph runs and all 18 of its sessions. For N, the counts were 6, 4 and 0.
  - *Most runs recovered:* they used Grep or Glob instead, or wrote the script with Write and ran it with `node`, which the rules allow.
  - *Not every command outside the list was refused:* Claude Code's matcher is looser than the method's "any other Bash command is refused". Three kept N runs ran commands outside it without a refusal: vscode-unused-nebulosity-3 (`cat > <scratch>/s.js <<'EOF' … node …`), and vscode-cl2-nebulosity-2 and -3 (`node <scratch>/scan.js || cd <vscode>/…; grep …`). The rules were the same in both arms, and the checks after every run guard the outcome (no repo or checkout changed).
  - *What the refused turns themselves took:*
    - about 5% of A's single-run time and 2% of N's, measured from the previous event's timestamp to the refused call's;
    - without those turns, VS Code's condition 3a time ratio stays 0.42 and AFFiNE's moves from 0.24 to 0.29;
    - the sessions' time ratios move from 0.35 to 0.36 (VS Code) and stay 0.23 (AFFiNE).

    That measures only the refused turns' own time, not the calls a refusal leads to afterwards: after a refused script, Claude Code alone often walked the imports with grep in 10–28 calls.
  - *A comparison of refusal-free runs instead* is under "How fast Claude gets the relevant context" ("A confound"). It moves the graph questions' cost ratio from 0.47 to 0.63–0.74, while the time ratio stays about 0.4. The time results hold without the refusals; part of the cost results doesn't.
- **Four A answers gave up after a refusal.** VSCODE-ENTRIES r1, AFFINE-IMPACT r2, and the first message of affine-s1 r1 and r2 all failed the same way. The first was seen in the pilot.
  - *What happened:* the first compound command was refused, and the model concluded that Bash or node was blocked. It asked the user to allow it ("To finish, I need one of these: 1. Allow Bash for `node` runs in the scratch directory") instead of answering. Writing a script with Write and running `node <file>` was allowed, and the same sessions used it for their later messages.
  - *Their scores:* each scored 0. They are A's only zeros on grep-hard questions, and two of its three zero-scored session messages (the third is affine-s2 r2's chain through a commented-out import).
  - *What they change:* with each replaced by its question's other runs' mean, condition 1's margin would be +0.034 (still a fail), and A's session means would rise. No N answer gave up.
- **`architecture`'s conventions report lists only folder names found in 26 or more folders** (Task 7's ruling).
  - On VSCODE-PAIRS it left out `electron-utility` and `worker`, so every N run had to compute the rest itself.
    - r1's script ran: 18.7 s and $0.045, faster and cheaper than every A run.
    - r2's and r3's script heredocs were refused, so they grepped by hand. That made the question's medians 1.73 times A's time and 1.92 times its cost.
  - On VSCODE-BP2 it cost the `electron-utility` point.
  - This was known from the pilot and recorded under R1. Nothing changed after the freeze.
- **The two index gaps fixed before the freeze, at the owner's call** (2026-10-14, "Fix before the freeze"), were found through this eval's answer key.
  - *Which questions they touch:* VSCODE-IMPACT and the impact messages of vscode-s3 and affine-s1. N scored 1.00 on each.
  - *Before the fix*, the index's counts were 4,501 against 4,503; 56 against 59 (`agentHost` 51 against 54); and 1,446 against 1,546 (`tests` 12 against 112).
  - *What an answer with those counts would have scored:* about 1.00, 0.97 and 0.86 on those three. The two sessions would have scored about 0.99 and 0.97 instead of 1.00. Condition 4 would still pass, and no other condition uses those runs.
- **A partial machine path reached one committed transcript.** In `vscode-pairs-baseline-3`, a model's own script printed paths cut short at the front, which the runner's full-path scrubber and leak check missed. It was scrubbed in `2bb5dc1` after the data commit, and the scores are unchanged. The cut-off path stays in `4538032`'s history while the repo is private. That is for the owner to settle before any public switch. After the eval, the leak check gained a needle for a path cut off this way (V1.6's final review, ADR-051 amended), so the next eval stops on one.
- **Wall time is `duration_ms`.** It leaves out start-up, N's MCP server included (about 0.7 s), which leans slightly toward N on conditions 3a and 4.

### What this says about the claim

The claim Eval #2 tests is ADR-051's: Nebulosity shows clearly better results and efficiency than in Eval #1, as D1 defines them. **It doesn't.** The gate failed on four of its seven conditions.

What it does show, in plain sentences:
- **Nebulosity makes Claude Code faster at getting the context a dependency question needs, and cheaper, without losing accuracy.**
  - On the 69 graph runs of both repos, with Nebulosity Claude Code answered in a median 8.4 s against 28.1 s (0.30), at $0.031 against $0.066 (0.47), reading 0.40 of the tokens, in 2 turns against 6. It scored 1.00 against 0.94.
  - On the runs where Claude Code alone had no command refused, the ratios were 0.39 for time and 0.74 for cost (pooled), or 0.39 and 0.63 matched per question. The time advantage holds; part of the cost advantage was the eval's refused commands.
  - In the task sessions it answered in 0.29 of the time and 0.39 of the cost, scoring 1.00 against 0.94. Every alone-arm session had a refused command, so the sessions have no refusal-free comparison.
  - That held on both repos, the one the model knows well (VS Code) and the one it likely knows less (AFFiNE; an assumption, not measured).
- **The accuracy gain is small where it was supposed to be large.**
  - Claude Code alone, allowed to write Node.js scripts, built its own import walkers and scored 0.91 on the grep-hard questions. Nebulosity's 0.999 is +0.088, under the +0.15 the gate asked.
  - Part of that gap comes from four answers that gave up after a refused command, an artifact of this eval's permission rules, not of Claude Code alone.
- **Nebulosity didn't help on big-picture questions, on either repo.**
  - VS Code: 0.84 against 0.93, the same loss as in Eval #1. AFFiNE: 0.68 against 0.70.
  - On VS Code, the transcripts show the tools' answers taking the place of the repo's own written rules. Two runs saw the docs pointer and didn't follow it.
  - Its summaries, `overview` and `describe` raised no big-picture score.
- **On VS Code's direct lists, the tools added little:** +0.025 in score (0.985 against 0.960), the same cost and 0.81 of the time. In 6 of those 12 runs, Claude Code with Nebulosity wrote its own scanner instead.
- **It was slower or costlier on VSCODE-PAIRS, VSCODE-UNUSED and VSCODE-VIOLATIONS, and costlier on AFFiNE's big-picture questions and AFFINE-PAIRS** (see "The losses").
- **ADR-024's test, a second time.** ADR-024 says the value proposition needs rethinking if the tools don't improve Claude Code's answers on VS Code. On VS Code, in this eval:
  - big-picture answers were worse (−0.08);
  - lists were better by +0.035 and grep-hard answers by +0.097;
  - chains were level.

  The improvement is real on the graph questions but smaller than the gate asked, and the big-picture answers got worse. So ADR-024's revisit condition holds a second time.
- **What this eval doesn't show.**
  - It covers two repos, one model at one effort, and three runs per question.
  - The alone arm's scripts and the refused-command artifact both move its scores, in opposite directions.
  - It measured the MCP tools, not the Map, which is for people and has no Claude Code equivalent.

### After a FAIL: the options

ADR-051's hold stays until the owner decides. Nothing is deployed, published or made public. These are the options the plan names. They are laid out here, not chosen.

1. **A V1.7 aimed at the failed conditions**, then a new eval with its gate fixed before its first run.
   - *Condition 2 (VS Code big-picture).* Make `architecture` carry the "Docs about it" line that `describe` carries. Have the server's instructions say to read those docs before answering a question about how code is organized. Lower or drop the conventions threshold, which hid `electron-utility`. These came out of Eval #2's own questions, so the next eval needs questions they weren't tuned on.
   - *Condition 1 (+0.15 on grep-hard).* Against an alone arm that scripts to 0.91, no tool can reach +0.15 on these questions: the most possible was +0.089. Meeting it would take harder questions or a different bar. Either one is a new gate, set before the next run, not a change to this one.
   - *Condition 3a (VS Code cost 0.57).* N's cost floor is about $0.02 a run: two turns over a prompt of about 23,500 tokens. A's scripted search costs about $0.03, so N can get under half only with fewer turns or a smaller prompt. On the refusal-free runs the cost ratio is 0.63 on VS Code and 0.72 on AFFiNE, so 3a's cost bound would fail on both repos without the refusals.
   - *Condition 5a (80 of 90).* The ten runs wrote their own scanners. The tools' descriptions could say to prefer `imports` to a script. Whether the eval's scripts sentence should stay is a method question for the next gate.
   - *E2 (the call graph through injected services)* is the plan's V1.7 candidate "if calls through injected services were the gap". They weren't. No question asked about calls, and none of the four failed conditions came from a missing call edge. Typecheck Benchmark #1 adds its own cost: 5.1 GB of memory, and a unique implementer settles only about 6% of sampled calls.
2. **Repositioning: ADR-024's question.** What two evals measured is a speed and cost layer for dependency questions, not better answers in general. The pitch could be exactly that ("the import walk in one call"). It could also lean on the Map, which is for people and which no eval measured.
3. **Ship as a measured tool, with the losses stated.** The README already states what Eval #2 measured, wins and losses in one paragraph. Going public on those numbers means the owner amends ADR-051's bar ("clearly better results and efficiency"), which Eval #2 did not meet.

### Raw data

- `eval2/runs/`: the 270 scrubbed transcripts (`<question or session>-<arm>-<repeat>.jsonl.gz`) and `index.jsonl`, one summary line per run. A session's line holds each message's cost, time, turns and tool calls.
- `eval2/results.json`: every run's and session's score, the files its answer named, its misses and extras, tokens, cost estimate, time and tool calls. `npm run eval:score -- --eval eval2` writes it and prints the per-run, per-question, per-family, per-repo and kind, session and gate tables.
- `eval2/grading/`:
  - grader 1's replies, and the second grader's in `second/`;
  - the 64 rulings in `review.json`, and the merged grades in `grades.json`;
  - the blind sheets in `sheets/`, and the key from sheet to run in `key.json`.
- `eval2/questions.json`, `eval2/sessions.json`, `eval2/truth/` (with `adjudicated.json` and `steps.json`) and `eval2/rubric/`: the questions, truths and rubrics the scores rest on.
- **What isn't in `results.json`.** "How fast Claude gets the relevant context" splits tool calls into Nebulosity calls, file reads and searches, and script steps, and "What the runs showed about the method" counts refusals and the time of the turns they ended. Both were counted from the kept transcripts by read-only scripts in the working notes, by the rules stated there, so anyone can count them again from `eval2/runs/`.

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
