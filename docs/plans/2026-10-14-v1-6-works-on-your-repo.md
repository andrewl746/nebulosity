# V1.6 Works on your repo, measured: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing ships until a re-measured eval shows clearly better results and efficiency than Eval #1 (ADR-051, amended 2026-10-14). This slice makes that happen or finds out it can't. It does four things:
- It gets Nebulosity's tools used, cheaply.
- It answers the questions grep can't answer cheaply: what a change affects, how code is layered, import cycles, files nothing imports, and the repo's own docs about a folder.
- It finishes V1.6's original scope: an installable package, three operating systems, free mode, real repos of different shapes.
- It runs Eval #2 on VS Code and a second repo against a ship gate fixed before the first run. If the gate passes, the owner deploys the demo, makes the repo public, records the video and publishes the package. If it fails, the results are published to the repo (still private) with the losses, and the owner decides what comes next.

**Architecture:** Four tracks over the existing engine.
- **The engine** (`lib/index/`, `lib/engine/`): the resolver reads module ids against the folders that hold a tsconfig, workspace packages through their `package.json`, and computed `import()` calls through the literals assigned to their variable. The index learns which files a `package.json` names as entry points, and which docs talk about which folders. New engine queries answer impact (every file a change reaches, by area, tests apart, the entry points that load it) and architecture (layers by import direction and the imports against them, recurring folder conventions, cycles, files nothing imports). Everything is computed from the import graph, so it all works in free mode.
- **The tool surface** (`lib/tools/`, `mcp/`): seven tools become six. `imports` takes over `dependents`, `dependencies` and `path` and adds impact; `architecture` is new. The five that answer questions mark themselves always loaded (`_meta["anthropic/alwaysLoad"]`), so no user setup step is needed, and `show_on_map` stays deferred. A test pins the size of what's always loaded. The wording is tuned on a dev set of questions, never on Eval #2's.
- **The package** (`bin/`, `lib/home.ts`, `package.json`, `.github/workflows/`): the code root and the data folder split, so an installed copy keeps its index in the user's data folder. One CLI, `nebulosity`, runs `index`, `summarize` (an estimate and a yes before any spend), `map`, `mcp`, `setup` and `doctor`. CI covers Windows, macOS and Linux.
- **Eval #2** (`scripts/eval/`, `eval2/`): the runner, the truth builder and the scorer take an eval definition, so Eval #1 still re-scores exactly. Eval #2 adds a second repo, a grep-hard family, multi-question task sessions over stream-json input, scripts allowed in both arms, three repeats, and a scorer that prints the gate's verdict.

**Tech Stack:** TypeScript 5, Node 24, Next.js 16.4.0, React 19, better-sqlite3 + Drizzle (WAL), Vitest 4, tsx, `@modelcontextprotocol/sdk` 1.32.1 (pinned; it accepts a tool's `_meta`), the TypeScript compiler API (also the type-checker measurement for E2), GitHub Actions. Claude Code 2.1.300 on this machine today, pinned at Eval #2's pilot. Eval #1 ran on 2.1.299. No new runtime dependency: `typescript` and `tsx` move from devDependencies to dependencies because the package runs them.

**Spec:** `docs/PIVOT_SPEC.md` §2 (S8–S11), §5.2, §6, §9, §10, §12. Decisions ADR-024 (the revisit condition Eval #1 met), ADR-043 (V1.6 and the extras), ADR-044 (the read-only server), ADR-045 (import reach), ADR-046, ADR-047 and ADR-048 (the tools and how they start), ADR-050 (Eval #1's method) and ADR-051 (the hold on going public). `docs/EVAL_RESULTS.md` (Eval #1) is what this slice plans against. `docs/API_CONTRACTS.md` §12 and §17. The options memo and the owner's picks are in the ledger (`.superpowers/sdd/2026-10-14-v1-6-works-on-your-repo/`). This plan adds ADR-053 → ADR-058 and amends ADR-024, ADR-035, ADR-038, ADR-043, ADR-044, ADR-045, ADR-047, ADR-048, ADR-050 and ADR-051.

---

## What the code and the machine have today (checked 2026-10-14, planning)

- **Branch.** `pivot/v1` at `5cf2f9e`, ahead of `main` by V1.5 (PR #7 open, not merged). Uncommitted: `docs/LEARNING_NOTES.md` (modified) and `lib/agent/state.ts` (untracked), both the owner's. The gate: tsc clean, lint 0 errors and 4 warnings, **vitest 910/910** (CLAUDE.md says 909; the run says 910).
- **What Eval #1 found** (docs/EVAL_RESULTS.md):
  - Claude Code alone answered its 15 VS Code questions at or near the ceiling, and Nebulosity raised no family's accuracy. Big-picture went 0.91 → 0.82 (0.77 with the tools up front), lists 0.97 → 0.94, connections stayed at 1.00.
  - Where its tools were used on a walk over the graph, they were much cheaper. Chains cost about a third of the cost estimate and time. CL4 used about 1/8 of the tokens: 108 s against about 18 s.
  - At Claude Code's default tool search the tools loaded in 12 of 30 runs, never on a big-picture question.
  - The index missed 8 of the 189 truth entries: `vs/…` module ids (5) and computed `import()` loaders (3).
  - The big-picture scores followed whether a run read VS Code's own `.github/instructions/source-code-organization.instructions.md`. Its front matter says `applyTo: src/vs/**`.
- **Tool definitions, measured** (`z.toJSONSchema` over `TOOLS`, a scratch script): the seven definitions take 6,074 characters, about 1,700 tokens. `SERVER_INSTRUCTIONS` takes 1,093 characters, about 290 tokens.
- **Eval #1's "13,000 tokens a turn up front" was probably not Nebulosity's.** One-turn contexts were A 20,528, B 21,006 and U 34,075 tokens. U ran with `ENABLE_TOOL_SEARCH=false`, which loads every deferred tool. The init message lists 14 Claude Code built-ins besides Read, Grep, Glob, Bash, Task and ToolSearch (CronCreate, CronDelete, CronList, DesignSync, EnterWorktree, ExitWorktree, ListAgents, PushNotification, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, TaskStop, Workflow). The docs don't say whether `false` loads those up front, so Task 3 measures it.
- **Every transcript records each API call's usage.** An assistant event's `message.usage` has `input_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens`. For example, Eval #1's `cn3-nebulosity-1` opens with 2 + 2,478 + 18,606 = 21,086 tokens. That first call's context is how the gate measures per-turn overhead (D1, condition 5).
- **Claude Code 2.1.300** (auto-updated from 2.1.299):
  - Its MCP config schema has `alwaysLoad` (an optional boolean) on stdio, SSE and HTTP servers. Its loader keeps a tool always loaded when the server isn't set to defer everything and either the registration says `alwaysLoad: true` (unless a `--mcp-config` server's tool says `_meta["anthropic/alwaysLoad"]: false`) or the tool's own `_meta["anthropic/alwaysLoad"]` is `true`. The registration's `true` "also blocks startup until the server is connected (capped at the standard 5s connect timeout)".
  - It also reads `_meta["anthropic/searchHint"]` (for deferred tools) and `_meta["anthropic/maxResultSizeChars"]`.
  - The docs (code.claude.com, checked by a subagent; quotes in the ledger) confirm the following:
    - `alwaysLoad` arrived in 2.1.121, and the per-tool `_meta` key is documented.
    - "Only tool names and server instructions load at session start" when tools are deferred.
    - Server instructions are kept up to 4,096 characters since 2.1.296 (API_CONTRACTS §17 still says 2,048).
    - Claude Code reads AGENTS.md natively since 2.1.277, "only when you have no CLAUDE.md in your working directory or above it". So a CLAUDE.md snippet would hide VS Code's AGENTS.md.
    - `CLAUDE.local.md` is skipped when `local` is left out of `--setting-sources`.
    - `Write(path)` permission rules are accepted but never consulted. `Edit(path)` rules cover every built-in tool that edits files, and absolute paths are written `//c/Users/…`.
    - `--input-format stream-json` takes several user messages in one process, each a new turn with its own `--max-turns`.
  - The MCP SDK 1.32.1's `registerTool` config accepts `_meta`.
  - There's no `~/.claude/CLAUDE.md` on this machine.
- **Resolution on VS Code.**
  - `src/tsconfig.base.json` has `paths` for `electron` only and no `baseUrl`, so nothing maps `vs/…`. The Copilot test fixtures' `vs/workbench/…` ids resolve only if a module id is read against `src/`, the folder that holds `src/tsconfig.json`.
  - The two computed loaders read `const result = await import(workbenchUrl);`, where `workbenchUrl` is assigned `'../../../workbench/workbench.desktop.main.js'` in one branch and `new URL(`vs/workbench/workbench.desktop.main.js`, baseUrl).href` in the other (`src/vs/code/electron-browser/workbench/workbench.ts` lines 510–517; `src/vs/sessions/electron-browser/sessions.ts` 123–130).
  - `src/tsconfig.json` has `"outDir": "../out/vs"` and no `rootDir`. The root `package.json` says `"main": "./out/main.js"`.
- **Docs on VS Code.**
  - 371 tracked `.md` files and 151 `package.json` files.
  - Three instructions files say `applyTo: src/vs/**`: best-practices, coding-guidelines and source-code-organization.
  - Other `applyTo` values come quoted, as comma lists and with braces: `'src/vs/platform/agentHost/**'`, `"{src/vs/**/test/**,src/vs/**/*.test.ts,src/vs/**/*.integrationTest.ts}"`, `'build/azure-pipelines/{oss/**,…}'`, `'**'`, `"src/vs/**/*Tool.ts,src/vs/**/*Tools.ts"`.
  - Ten instructions files have no `applyTo`.
- **A planning scan of VS Code** (`scripts/eval/scan.ts`: relative imports only, no module ids, no computed loaders; read-only, 3.5 s). It gives 14,849 files and 139,020 edges.
  - *Impact.*
    - `src/vs/platform/storage/common/storage.ts` reaches 4,484 files (849 direct, 1,521 tests): workbench 3,274, sessions 780, platform 224, editor 183, code 10, server 6, elsewhere 7.
    - `src/vs/editor/common/languages/language.ts` reaches 5,009 files.
  - *Cycles.* 169 strongly connected groups of 2 or more files hold 1,275 files. The largest has 230 files, all in `src/vs/workbench/contrib`; the next have 92 (Copilot), 55, 48 and 45.
  - *Files nothing imports.* `src/vs/platform/files` has 1 of 22 (`node/watcher/watcherMain.ts`, a worker loaded by name). `src/vs/workbench/contrib/debug/browser` has 0 of 50.
  - *Imports against the layers.* `src/vs/platform` → `src/vs/editor`: 1 file (`src/vs/platform/agentHost/node/diffWorkerMain.ts`). `src/vs/base` → `src/vs/platform`: 1 file (a test).
  - *Environment pairs under `src/vs`.* 21 pairs. The largest are browser → common 53,137 and browser → browser 21,738. The smallest are electron-main → electron-utility 1, worker → browser 2 and electron-browser → worker 3.
  - *The children of `src/vs`.* The largest pairs are workbench → base 20,648 and workbench → platform 19,171. The smallest are platform → editor 3 and base → platform 1.
  - *Root files that end up loading `markersView.ts`.* 1 file (`build/vite/index-workbench.ts`). Without the computed loaders, the desktop entry doesn't reach it.
- **Repo 2 candidates** (GitHub's API, read-only). 17 of 18 popular TypeScript repos now ship an agent guide (AGENTS.md, CLAUDE.md, `.claude/`, `.cursor/rules` or Copilot instructions).
  - **AFFiNE** at its head: 10,280 files, 6,937 TypeScript, only `packages/frontend/apps/ios/AGENTS.md`. Its packages resolve through `package.json` `exports`; its root tsconfig maps only `@affine/core/*`.
  - **Rocket.Chat** at `4c37fbf2ef013a2177466eb3fc90641d62b2aab7` (2026-08-04, the day before CLAUDE.md was added): about 10,000 TypeScript files.
  - **Theia** at `d4393e3c90401f6c5929236afb26991cddfeb24b` (2025-10-17, before its CLAUDE.md): about 3,400 TypeScript files. It imports across packages as `@theia/core/lib/…`.
- **The package today.**
  - `package.json` is `"private": true`, with no `bin`. `typescript` and `tsx` are devDependencies, yet the index parses with `typescript` and every script and the worker run through `tsx`.
  - The data folder is wired to the checkout: `lib/db/client.ts`, `lib/config.ts`, `scripts/env.ts` (`.env.local`), `scripts/export-demo.ts` and `scripts/build-demo.ts` (`nebulosityPath(".nebulosity", …)`), and the eval scripts (`<checkout>/.nebulosity/eval`).
  - The worker is forked as `fork(nebulosityPath("scripts", "background.ts"), [], { cwd: nebulosityHome(), execArgv: ["--import", "tsx"] })`.
  - `next.config.ts` has the demo's `output: "export"` and nothing else.
  - `nebulosity`, `nebulosity-map` and `@andrewl746/nebulosity` are all free on npm today.
- **Spend without a yes.**
  - `npm run summarize` starts spending at once, up to its $15 cap.
  - The background worker re-summarizes a changed file 60 quiet seconds later whenever a key is set (`lib/background/service.ts`), even on a repo nobody asked to summarize. S11 says nothing is charged until a cost estimate is confirmed.
- **The machine.**
  - 31.3 GB of RAM, Node 24.14.0, and Git Bash at `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`.
  - Builds stay in `../Nebulosity-build` while port 3000 may serve `.next/` (memory, ADR-049).

---

## Decisions

### Settled by the owner on the options memo (2026-10-14)

"Which V1.6 option should the plan be written for?"="B: What grep can't (Recommended)", "In Eval #2, may Claude Code run scripts (node, writing only to a scratch folder) in both arms?"="Scripts allowed (Recommended)", "Do the ship gate's numbers stand as proposed?"="As proposed (Recommended)", "How should repo 2 be chosen?"="After the probe, lean AFFiNE (Recommended)".

The plan is written for those picks. D1 and D2 spell them out exactly. D3 and D4 are the two calls left for later stops.

### The order of the work

| Part | Tasks | What it does | My estimate |
|---|---|---|---|
| 0 Start and measure | 0–3 | the baseline; repo 2 and the variety repos (stop); E2's measurement; the probe and Eval #1's correction | ½–1 day |
| 1 The engine | 4–7 | resolution, docs pointers, impact, architecture facts | 3–4 days |
| 2 The eval harness | 8–11 | definitions and scripts allowed, sessions, the independent truth, the scorer and the gate | 2 days |
| 3 The tool surface | 12–13 | six tools, five always loaded; the dev set | 1 day |
| 4 Eval #2's questions | 14 | questions, truths, rubrics, sessions, the method (stop) | 1 day |
| 5 Works on your repo | 15–19 | the data folder, the CLI and package, free mode and the yes before spending, CI, real repos and the README | 2–3 days, while you review Part 4 |
| 6 Eval #2 | 20–25 | summaries (stop), freeze and pilot (stop), full run, grading (stop), the verdict (stop), close-out (stop) | 2–3 days, plus the runs' sittings |

**Why this order.**
- The engine comes before the tool surface, and the tool surface before the dev set: the dev set tunes the wording of tools that have to exist.
- The eval harness comes before the dev set, because the dev set runs through it.
- Eval #2's questions are written after the dev set (R1), so tuning never sees them.
- V1.6's original scope (package, three systems, free mode, real repos) runs while you review the questions. It lands before the freeze, because it touches code the server runs (the data folder) and the spending rules.
- The README's claims come last, from the measured results.

**About 12–15 working days, more than the memo's 10–12:** the eval harness and the package are bigger than the memo counted. If the date matters more (applications open around late October or early November), Tasks 18–19 (CI, real repos) can move after Eval #2. They don't decide the gate, but a resolver fix they find would then wait for the results too.

### D1. The ship gate (approved; exact definitions)

Eval #2 has two arms: **A**, Claude Code alone, and **N**, Claude Code with Nebulosity registered the way `nebulosity setup` registers it. The gate is computed by `scripts/eval/gate.ts` from `eval2/results.json`. It's written into ADR-057 and EVAL_RESULTS (Eval #2's method) before the first run, and it never changes after.

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

### D2. Eval #2's shape (approved; details fixed here)

- **Repos.** VS Code at `cc3fec88`, and repo 2 at a pinned commit (D3).
- **Families and kinds:**
  - **Eval #1's kinds:** big-picture (rubric), direct lists (recall, precision beside), transitive lists (recall), chains (1 / 0.5 / 0). VS Code reuses Eval #1's 15 questions with their truths unchanged. Repo 2 gets 4 big-picture, 4 lists (one transitive) and 4 chains.
  - **Grep-hard, six kinds per repo:**
    - *impact:* every file that depends on X, counted per named folder plus elsewhere and the total. Score: the mean over the lines of max(0, 1 − |answer − truth| / max(truth, 1)).
    - *cycle:* the shortest import cycle through X, or "none". Score: 1 for a valid shortest cycle or a right "none", 0.5 for a valid longer cycle, 0 otherwise.
    - *unused:* the files in folder F that no file imports, tests left out. Score: F1.
    - *violations:* the files in folder F that import a file in folder G. Score: F1.
    - *entries:* the non-test files nothing imports that end up loading X. Score: F1.
    - *pairs:* which of the named folder groups import which: either recurring folder names such as VS Code's environments, or a folder's children. Score: F1 over the pairs.
  - **Task sessions:** 3 per repo. Each is 4 linked questions of the mechanically scored kinds ("I'm about to change X…"), asked in one Claude Code process, one message after another.
- **Arms.** A and N only. N's registration is `{ "command": "node", "args": ["<checkout>/mcp/launch.mjs"], "env": { "NEBULOSITY_LIVE": "off" } }`, the shape `nebulosity setup` writes, with no `alwaysLoad` in it (R4). Eval #1's U arm is retired, because the tools now load themselves.
- **Scripts allowed in both arms** (the owner's pick):
  - `Bash(node:*)` is allowed, along with `Edit(//<scratch>/**)` (which covers Write) and `--add-dir <scratch>`.
  - Each run gets a fresh empty scratch folder outside the repo.
  - Every prompt in both arms ends with the same fixed sentence naming it (R6).
- **Counts.**
  - About 40 single questions (VS Code 21, repo 2 19) and 6 sessions, × 2 arms × 3 repeats: about 240 single runs and 36 session runs.
  - Plus about 20 pilot runs, the dev set's runs (Task 13) and the probes (Tasks 3, 9 and 13).
  - Claude Code's list-price estimate is about $20–40. Eval #1's 90 runs cost $4.88 and took at most 0.16 of one 5-hour window. The pilot measures the real figure, and the owner approves the full count.
- **Unchanged from Eval #1.**
  - The isolation, the environment pins, the init checks, `git status` after every run, and the outage rules.
  - Blind grading by two models, with the owner ruling on the points where they disagree.
  - Losses published. The engine frozen from the pilot to the results. Truth that never comes from the index.

### D3. Repo 2 (decided at Task 1's stop)

Task 1 checks AFFiNE (at its head) and Rocket.Chat (at `4c37fbf`) with a shallow clone and a structure-only index into a scratch folder. It reports a table per repo:
- size, and the share of each import kind resolved;
- any agent guide at the pinned commit;
- docs usable for a rubric;
- whether the truth can be built (how its workspace packages import);
- an estimate of the summaries' cost.

You pick from that table. **Recommended going in: AFFiNE**: a current repo with no repo-level agent guide, 6,937 TypeScript files, and its own dependency-injection framework (the case E2 is for). Theia is the fallback if neither works.

### D4. The package name (decided at Task 16)

**Recommended: `nebulosity`** (free on npm on 2026-10-14). It stays `"private": true` until the gate passes, so it can't be published by accident. You publish it at ship, with your account. Alternatives: `nebulosity-map`, or a scope (`@andrewl746/nebulosity`).

### Rulings already made (say if you disagree)

- **R1. Tuning never sees the eval.** The tool wording is tuned on a dev set (Task 13) whose targets appear nowhere in Eval #2. Eval #2's questions are written after the dev set, and a check refuses any shared target. The engine freezes (`EVAL2_ENGINE`) before the pilot. A bug found later is recorded and fixed after the results, as Eval #1's R2 said.
- **R2. The truth stays independent** (Eval #1's R3).
  - The truth comes from two independent extractors: the regex scanner and TypeScript's own `preProcessFile`. Both resolve through one resolver of the eval's own, `scripts/eval/resolve-truth.ts`, which imports nothing from `lib/`.
  - Every disagreement between the two is read in the source. So is a random sample of 30 truth edges per repo.
  - Computed `import()` sites are listed by a sweep and decided by reading.
  - The index is consulted only for candidates.
  - Lists of up to 100 entries are read entry by entry, as in Eval #1. Impact totals of thousands of files can't be, so ADR-057 states that method change.
- **R3. Module ids are read against the folders that hold a tsconfig.**
  - A bare specifier of two or more segments counts when no tsconfig alias or workspace package explains it and exactly one such folder holds a file it names. Examples: `vs/workbench/…` from a Copilot fixture, or `app/main.js` in a fixture.
  - Specifiers starting with `@` or naming a protocol (`node:`, `http:`) are left out. Two or more matches resolve to nothing (ADR-053).
- **R4. The tools load themselves.**
  - The five tools that answer questions carry `_meta["anthropic/alwaysLoad"]: true`. `show_on_map` carries a `searchHint` and stays deferred.
  - Registrations (the README, `setup`, the eval) carry no `alwaysLoad`. The registration's `true` would load `show_on_map` too for local-scope servers (the loader's exception applies only to `--mcp-config` servers).
  - The per-tool flag behaves the same everywhere.
- **R5. No CLAUDE.md snippet in the measured install.** Writing a CLAUDE.md into a repo that has an AGENTS.md hides the AGENTS.md from Claude Code. So the server's own instructions carry the guidance. `setup` prints an optional snippet and never writes one. If the dev set shows tool use under 0.90 after three rounds of wording, Task 13 stops and asks you.
- **R6. The scratch sentence**, appended to every Eval #2 prompt in both arms after the format line: `You may write and run Node.js scripts in <scratch folder> (and nowhere else); don't change any file in the repository.`
  - The scratch folder is `<checkout>/.nebulosity/eval2/scratch/<run name>/`, made empty before the run.
  - The prompt names it by its absolute path, as `--add-dir` and the `Edit(//c/…/**)` rule do.
  - The scrubber turns the checkout into `<nebulosity>` in kept transcripts, as it does every machine path.
- **R7. Docs links refresh with full runs only.** The background worker's incremental update leaves them as they are; its warm full run at start redoes them. Markdown edits while the Map runs show after the next full run (ADR-054).
- **R8. Entry points are what a `package.json` names.**
  - That means `main`, `module`, `types`/`typings`, `bin` and the `"."` export, mapped from compiled paths to sources through any tsconfig with both `outDir` and `rootDir`.
  - No other file counts as an entry point. Files nothing imports are reported as such, never as "dead".
- **R9. Contracts.** `DescribeResponse` gains an optional `docs` (additive, §12). `CONTRACTS_VERSION` stays 3. The tool texts are §17's, rewritten for the six tools.
- **R10. Measuring and probing use a scratch data folder, never the owner's database.** That includes the repo probe, the cold S1 run and the package smoke runs. The three runs that write the owner's index are listed in the Global Constraints, each with notice.
- **R11. The ledger** is `.superpowers/sdd/2026-10-14-v1-6-works-on-your-repo/progress.md` (gitignored), started at planning, with `options-memo.md` beside it.

---

## Global Constraints

- **Branch:** `pivot/v1`. **After every completed step that changes files (each task, each fix, each doc update), commit and push.** Commit by path, so nothing another session staged rides along:
  `git add -A -- <paths> && git commit -m "<message>" -- <paths> && git push origin pivot/v1`.
- **Authorship:** conventional prefixes (`feat:`, `fix:`, `test:`, `perf:`, `refactor:`, `docs:`, `chore:`, `ci:`). **No `Co-Authored-By` line and no Claude attribution anywhere, in commits or PRs.** The owner is the only author GitHub shows.
- **The owner's files:** never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`, and never edit `lib/agent/state.ts`. `lib/agent/tools.ts` stays untouched (V1.4's R2). It imports `search` from `lib/engine/search`, which keeps exporting it.
- **Gate before every commit:** `npx tsc --noEmit && npm run lint && npx vitest run`, all clean. Lint warnings that predate the plan are fine (4 today); errors are not. The suite has **910** tests, and each task says about how many it adds.
- **Test expectations are derived by hand** from the fixtures' ground truth (the V1.1 plan's mini-repo, and this plan's arch-repo below), or from hand-built inputs in the test itself. Never run the code and paste its output into a test.
- **No network in tests.**
  - No test starts `claude`, `git clone` or `npm`.
  - The CLI's tests stub `child_process`, and nothing loads the embedding model.
  - The package smoke test runs in CI and by hand, never inside `vitest`.
- **The owner's Map and database:**
  - Never send live events to port 3000, and never stop anything on port 3000 without asking.
  - Servers started for measurement use another port and `NEBULOSITY_WORKER=off`.
  - Builds that write `.next/` run in the sandbox worktree `../Nebulosity-build`, because port 3000 may be serving `.next/`.
  - Experiments use a scratch data folder (R10). Only these steps write the owner's index, each announced first:
    - Task 4's re-index of VS Code, and its index of repo 2 (with `--no-activate`, so the Map stays on VS Code);
    - Task 5's re-index of both, so the docs are read;
    - Task 20's summaries for repo 2.
- **Anthropic calls, `claude -p` runs, downloads and GitHub Actions: ask before each, with the count first.**
  - Task 1's clones: two public repos, shallow, with sizes stated.
  - Task 3's probe: 2 runs.
  - Task 9's session probe: 1 run.
  - Task 13's dev set: at most 56 runs.
  - Task 18's CI: the Actions minutes.
  - Task 20's summaries: the estimate first.
  - Task 21's pilot: about 16 runs. The full run: the count you approve.
  - The blind graders are subagents of the controller's session, not `claude -p` runs.
- **Layering (ARCHITECTURE.md §3):**
  - Nothing under `lib/` imports `app/`, `mcp/`, `scripts/`, `bin/`, `next` or `react`.
  - `lib/engine/rank.ts`, `lib/engine/staticSearch.ts` and `lib/index/identifiers.ts` stay browser-safe.
  - `scripts/eval/scan.ts`, `scripts/eval/truth.ts`, `scripts/eval/resolve-truth.ts` and `scripts/eval/ts-graph.ts` import nothing from `lib/` (R2). A test pins it with `rank.test.ts`'s `moduleSpecifiers` reader.
  - All SQL stays in `lib/db/*`.
- **Contracts:** `lib/contracts.ts` changes only as `API_CONTRACTS.md` §12 says (R9).
- **Writing files:** use the Write and Edit tools for any file holding backslashes or `\n`, because Bash heredocs turn `\\` into `\`. In Git Bash, pass paths to `claude -p` as `C:/…`, never `/c/…`.
- **Docs change in the same commit as the design they describe.**
  - Every decision gets an ADR.
  - Replace each `‹today›` with the commit's date (YYYY-MM-DD) and each `‹…›` measurement with the measured value.
- **The ledger** records each task's commits and test count, every ruling with its cost if wrong, every owner decision (verbatim), and every run's id, usage and validation result.
- **Stop points:**
  - this plan (now);
  - Task 1 (repo 2 and the variety repos);
  - Task 13 (only if tool use stays under 0.90);
  - Task 14 (Eval #2's questions and truths);
  - Task 20 (the summaries' spend);
  - Task 21 (before the pilot, then the full count);
  - Task 23 (the grade disagreements);
  - Task 24 (the verdict);
  - Task 25 (before the PR).
- **Never:** deploy, make the repo public, publish to npm, or change any GitHub setting. Those are the owner's, and only after the gate passes.
- **Target repos** live outside the checkout (`../vscode`, `../<repo 2>`, and the variety repos under `../repos/`). They must stay unmodified: the eval runner checks `git status --porcelain` after every run.

## Review Focus

Five inputs or conditions most likely to hurt a real user that the spec doesn't spell out. Each line names the test that pins it.

1. **A monorepo whose package names collide.** A test fixture or an example with the same `name` as a real package must not capture its imports. Resolution must be deterministic: a package outside test, fixture and example folders wins, then the shallowest, then path order. Task 4: `readWorkspace` with two `@x/ui` packages, one under `fixtures/`.
2. **A computed `import()` the code can't pin down.** A parameter, a template with `${…}`, or a variable assigned a call: no edge, and no crash. Task 4: four adapter cases, each giving no specifier.
3. **Docs in odd shapes.** Front matter with CRLF line endings, a BOM, a quoted glob, a comma list, braces, `**`; no front matter at all; a heading-less file; a 2 MB changelog. Each one is parsed or ignored without a throw, and no glob breaks the parser. Task 5: `splitGlobs` and `globFolder` cases transcribed from VS Code's real `applyTo` lines, plus the BOM and CRLF cases.
4. **A huge import cycle.** VS Code's largest group is 230 files, and a generated repo can have a chain of 100,000. The cycle finder must be iterative and never overflow the stack. Task 7: a ring of 100,000 files is one group of 100,000.
5. **The package installed in a path with spaces** (a Windows user name, `Program Files`), or on macOS or Linux. `setup`'s registration, the data folder and the launcher must survive both. Task 15: `userDataDir("win32", …, "C:\\Users\\Ann Lee")`; Task 16: `setupCommand("C:\\Users\\Ann Lee\\…\\launch.mjs", "win32")` quotes the path for the shell; CI on all three systems (Task 18).

## File map

| File | Status | Responsibility |
|---|---|---|
| `test/fixtures/arch-repo/**` | create | the architecture fixture: layers, conventions, a cycle, files nothing imports, docs, two workspace packages, a module id, a computed `import()` (ground truth below) |
| `lib/index/discover.ts` (+ test) | modify | `manifests` (package.json, tsconfig*.json) and `docs` (.md, .mdx, .mdc) beside `files`; `listManifests` for the incremental update |
| `lib/index/workspace.ts` (+ test) | create | `readWorkspace`: packages by name, exports flattened, `outDir` → `rootDir` mappings, declared entry points |
| `lib/index/resolve.ts` (+ test) | modify | workspace packages, module ids against the folders that hold a tsconfig, compiled paths mapped to sources |
| `lib/index/languages/typescript.ts` (+ test) | modify | computed `import()` through the literals assigned to its variable |
| `lib/index/docs.ts` (+ test) | create | front matter, titles, `applyTo`/`globs`, path mentions → doc links |
| `lib/index/pipeline.ts`, `lib/index/update.ts` (+ tests) | modify | the workspace, entry points and doc links in full runs; `package.json` changes re-resolve everything |
| `lib/db/schema.ts`, `lib/db/migrations/0007_*.sql`, `0008_*.sql` | modify / generate | `entry_points`; `docs` and `doc_links` |
| `lib/db/store/entries.ts`, `lib/db/store/docs.ts` | create | write and read them |
| `lib/engine/docs.ts` (+ test) | create | `docsAbout(path)`, `docsToReadFirst()` |
| `lib/engine/describe.ts`, `lib/engine/overview.ts` | modify | docs in both answers |
| `lib/engine/impact.ts` (+ test) | create | impact: totals, tests, areas, entry points and other files nothing imports |
| `lib/engine/reach.ts` (+ test) | modify | a `within` filter (ADR-045's revisit) |
| `lib/engine/architecture.ts` (+ test) | create | strongly connected groups, the shortest cycle through a file, layers, conventions, files nothing imports, and the DB-bound `architecture()` |
| `lib/contracts.ts` | modify | `DocPointer`; `DescribeResponse.docs?` |
| `lib/tools/registry.ts`, `lib/tools/answers.ts`, `lib/tools/text.ts` (+ tests) | modify | six tools, `alwaysLoad` and `searchHint`, new answers, new instructions, the size budget |
| `mcp/server.ts` (+ test) | modify | each tool's `_meta`; the new tools' live events |
| `scripts/bench-mcp.ts` | modify | the six tools (MCP Benchmark #3) |
| `scripts/measure-typecheck.ts` | create | E2's measurement (Typecheck Benchmark #1) |
| `scripts/eval/definition.ts` (+ test), `eval/eval.json`, `eval2/eval.json` | create | the eval definition: repos, arms, pins, repeats, scripts |
| `scripts/eval/run-config.ts`, `run.ts`, `validate.ts`, `transcript.ts` (+ tests) | modify | definitions, arms, scripts permission, scratch folders, sessions over stream-json, first-call context |
| `scripts/eval/probe.ts` | create | one-turn probe runs: first-call context per configuration |
| `scripts/eval/resolve-truth.ts`, `scripts/eval/ts-graph.ts` (+ tests) | create | the truth's own resolver (workspace, module ids, outDir); the second extractor |
| `scripts/eval/scan.ts`, `truth.ts`, `build-truth.ts` (+ tests) | modify | the new kinds' truths, the computed-import sweep, the disagreement sheet |
| `scripts/eval/score.ts`, `answer.ts`, `scripts/eval/gate.ts` (+ tests) | modify / create | counts, F1, cycles, pairs, sessions, the gate |
| `scripts/eval/grading.ts` | modify | `--eval` |
| `eval2/**` | create | the dev set, questions, truths, rubrics, sessions, runs, grading, results |
| `lib/home.ts` (+ test), `lib/db/client.ts`, `lib/config.ts`, `scripts/env.ts` | modify | the code root and the data folder apart |
| `bin/nebulosity.mjs`, `scripts/cli.ts` (+ test), `scripts/commands/index-command.ts`, `scripts/commands/summarize-command.ts` | create | the CLI: `index`, `summarize`, `map`, `mcp`, `setup`, `doctor`; `scripts/index.ts` and `scripts/summarize.ts` become two-line wrappers |
| `lib/db/store/summaries.ts` | modify | `confirmSummaries`, `summariesConfirmed` |
| `lib/index/summarize/estimate.ts` (+ test) | create | the cost estimate shown before a paid run |
| `scripts/summarize.ts`, `lib/background/service.ts` (+ test) | modify | the yes before spending; no automatic refresh on a repo never confirmed |
| `scripts/mcp-smoke.mjs` | create | an MCP client that lists the tools and calls `overview` (CI and by hand) |
| `package.json`, `package-lock.json` | modify | `bin`, `files`, `engines`, dependencies moved, scripts |
| `.github/workflows/ci.yml` | create | the gate and the package smoke on Windows, macOS and Linux |
| `README.md` | modify | install, who it's for, free mode, summaries send code to Anthropic; Eval #2 after Task 24 |
| `docs/ENGINEERING_DECISIONS.md` | modify | ADR-053 → ADR-058; amendments to ADR-024, 035, 038, 043, 044, 045, 047, 048, 050, 051 |
| `docs/API_CONTRACTS.md` | modify | §12 (`docs`), §17 (six tools) |
| `docs/PIVOT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/RAG_PIPELINE.md`, `docs/BENCHMARKS.md`, `docs/EVAL_RESULTS.md`, `docs/IMPLEMENTATION_ROADMAP.md` | modify | §2, §5.2, §6, §9, §10, §12, §15; the new queries and tables; Index Benchmark #4, Typecheck Benchmark #1, MCP Benchmark #3, Variety Benchmark #1; Eval #1's correction and Eval #2; the V1.6 row |

## Ground truth for this slice (hand-derived; tests transcribe these)

The V1.1 plan's mini-repo keeps its ground truth, and every test built on it stays as it is. This slice adds a second fixture, **`test/fixtures/arch-repo`**, designed by hand for the new features. It isn't a git repo, so discovery walks it, `.github` included. Vitest, tsc and ESLint already exclude `test/fixtures/**`.

### The files

Non-source files:

`package.json`
```json
{
  "name": "arch-repo",
  "private": true,
  "main": "src/app/loader.ts"
}
```

`README.md`
```markdown
# arch-repo

The app lives in `src/app`; shared code lives in `packages/ui` and `packages/core`.
```

`docs/architecture.md`
```markdown
# Architecture

The layers are `src/base`, `src/platform`, `src/editor` and `src/app`, each using only the ones before it.
Code in `src/platform` must not import `src/editor`.

Environment folders: `common`, `browser` and `node`. The text model lives in `src/editor/common`, and views in `editor/browser`.
```

`.github/instructions/editor.instructions.md`
```markdown
---
applyTo: src/editor/**
---

# Editor rules

The editor never imports the app.
```

`src/app/README.md`
```markdown
# The app

Start at `src/app/loader.ts`, which loads `main.ts`.
```

`src/tsconfig.json` and `tools/tsconfig.json` (the same text; neither has `baseUrl`, `paths`, `outDir` or `rootDir`)
```json
{
    "compilerOptions": {
        "strict": true
    }
}
```

`packages/core/tsconfig.json`
```json
{
    "compilerOptions": {
        "rootDir": "src",
        "outDir": "lib"
    }
}
```

`packages/core/package.json`
```json
{
  "name": "@arch/core",
  "main": "lib/index.js"
}
```

`packages/ui/package.json`
```json
{
  "name": "@arch/ui",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  }
}
```

**21 source files**, sorted, with their full text:

`packages/core/src/index.ts`
```ts
export { log } from "./log";
```

`packages/core/src/log.ts`
```ts
export function log(message: string): void {
    console.log(message);
}
```

`packages/ui/src/button.ts`
```ts
import { log } from "@arch/core/lib/log";

export function button(label: string): string {
    log(label);
    return `[${label}]`;
}
```

`packages/ui/src/index.ts`
```ts
export { button } from "./button";
```

`src/app/legacy.ts`
```ts
import { trim } from "../base/common/strings";

export const legacyName = trim(" legacy ");
```

`src/app/loader.ts` (the computed `import()` is on line 5)
```ts
export async function load(dev: boolean): Promise<unknown> {
    let url: string;
    if (dev) url = "./main.js";
    else url = new URL("app/main.js", import.meta.url).href;
    return import(url);
}
```

`src/app/main.ts`
```ts
import { EditorView } from "../editor/browser/editorView";
import { saveFile } from "../platform/node/storageFile";
import { openFiles } from "../editor/node/editorFiles";
import { button } from "@arch/ui";
import React from "react";

export function main(): unknown {
    return [EditorView, saveFile, openFiles, button("Open"), React];
}
```

`src/base/browser/dom.ts`
```ts
import { trim } from "../common/strings";

export function el(tag: string): string {
    return `<${trim(tag)}>`;
}
```

`src/base/common/arrays.ts`
```ts
import { trim } from "./strings";

export function first(items: string[]): string {
    return trim(items[0] ?? "");
}
```

`src/base/common/strings.ts`
```ts
export function trim(text: string): string {
    return text.trim();
}
```

`src/base/node/fs.ts`
```ts
import { first } from "../common/arrays";

export function readFile(paths: string[]): string {
    return first(paths);
}
```

`src/base/test/common/strings.test.ts` (a test file: its path has a `test/` folder)
```ts
import { trim } from "../../common/strings";

export const trimmed = trim("  x  ") === "x";
```

`src/editor/browser/editorView.ts`
```ts
import { TextModelHandle } from "../common/model";
import { el } from "../../base/browser/dom";

export class EditorView {
    readonly root = el("div");
    constructor(readonly model: TextModelHandle) {}
}
```

`src/editor/common/model.ts`
```ts
import { Tokens } from "./tokens";
import { Storage } from "../../platform/common/storage";

export class TextModelHandle {
    readonly tokens = new Tokens();
    readonly storage = new Storage();
}
```

`src/editor/common/textModel.ts`
```ts
import type { TextModelHandle } from "./model";
import { trim } from "../../base/common/strings";

export class TextModel {
    constructor(readonly handle: TextModelHandle | null, readonly text = trim("")) {}
}
```

`src/editor/common/tokens.ts`
```ts
import { TextModel } from "./textModel";

export class Tokens {
    readonly model = new TextModel(null);
}
```

`src/editor/node/editorFiles.ts`
```ts
import { TextModel } from "../common/textModel";
import { readFile } from "../../base/node/fs";
import { saveFile } from "../../platform/node/storageFile";

export function openFiles(paths: string[]): TextModel {
    saveFile(readFile(paths));
    return new TextModel(null);
}
```

`src/platform/browser/storageView.ts`
```ts
import { el } from "../../base/browser/dom";

export class StorageView {
    readonly root = el("ul");
}
```

`src/platform/common/storage.ts`
```ts
import { first } from "../../base/common/arrays";
import { StorageView } from "../browser/storageView";

export class Storage {
    readonly view = new StorageView();
    readonly firstKey = first(["a"]);
}
```

`src/platform/node/storageFile.ts`
```ts
import { Storage } from "../common/storage";
import { readFile } from "../../base/node/fs";
import { TextModelHandle } from "../../editor/common/model";
import { log } from "@arch/core";

export function saveFile(text: string): Storage {
    log(readFile([text]));
    void TextModelHandle;
    return new Storage();
}
```

`tools/fixtures/legacy-ids.ts`
```ts
import { trim } from "base/common/strings";
import React from "react";

export const legacyIds = [trim(" ids "), React];
```

### The workspace

- **Manifests** (discovery's `manifests`, sorted): `package.json`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/ui/package.json`, `src/tsconfig.json`, `tools/tsconfig.json`.
- **Packages:**
  - `arch-repo` at `""`, main `src/app/loader.ts`;
  - `@arch/core` at `packages/core`, main `lib/index.js`;
  - `@arch/ui` at `packages/ui`, exports `.` → `./src/index.ts` and `./*` → `./src/*.ts`.
- **Compiled → source mappings:** `packages/core/lib` → `packages/core/src` (from `packages/core/tsconfig.json`; the other two tsconfigs set neither field).
- **Id roots** (the folders that hold a `tsconfig*.json`, sorted): `packages/core`, `src`, `tools`.
- **Declared entry points** (sorted by path):

| path | declaredBy |
|---|---|
| `packages/core/src/index.ts` | `packages/core/package.json main` |
| `packages/ui/src/index.ts` | `packages/ui/package.json exports "."` |
| `src/app/loader.ts` | `package.json main` |

### Imports

The TypeScript adapter reads `src/app/loader.ts`'s imports as `["./main.js", "app/main.js"]`: the two literals assigned to `url`, in source order. Every other file's imports are its written specifiers, in order.

**31 resolved edges** (by source, then target):

| # | source | target | specifier | how |
|---|---|---|---|---|
| 1 | `packages/core/src/index.ts` | `packages/core/src/log.ts` | `./log` | relative |
| 2 | `packages/ui/src/button.ts` | `packages/core/src/log.ts` | `@arch/core/lib/log` | workspace, `lib` → `src` |
| 3 | `packages/ui/src/index.ts` | `packages/ui/src/button.ts` | `./button` | relative |
| 4 | `src/app/legacy.ts` | `src/base/common/strings.ts` | `../base/common/strings` | relative |
| 5 | `src/app/loader.ts` | `src/app/main.ts` | `./main.js` | computed; `app/main.js` reaches the same file through the id root `src` |
| 6 | `src/app/main.ts` | `packages/ui/src/index.ts` | `@arch/ui` | workspace, export `.` |
| 7 | `src/app/main.ts` | `src/editor/browser/editorView.ts` | `../editor/browser/editorView` | relative |
| 8 | `src/app/main.ts` | `src/editor/node/editorFiles.ts` | `../editor/node/editorFiles` | relative |
| 9 | `src/app/main.ts` | `src/platform/node/storageFile.ts` | `../platform/node/storageFile` | relative |
| 10 | `src/base/browser/dom.ts` | `src/base/common/strings.ts` | `../common/strings` | relative |
| 11 | `src/base/common/arrays.ts` | `src/base/common/strings.ts` | `./strings` | relative |
| 12 | `src/base/node/fs.ts` | `src/base/common/arrays.ts` | `../common/arrays` | relative |
| 13 | `src/base/test/common/strings.test.ts` | `src/base/common/strings.ts` | `../../common/strings` | relative |
| 14 | `src/editor/browser/editorView.ts` | `src/base/browser/dom.ts` | `../../base/browser/dom` | relative |
| 15 | `src/editor/browser/editorView.ts` | `src/editor/common/model.ts` | `../common/model` | relative |
| 16 | `src/editor/common/model.ts` | `src/editor/common/tokens.ts` | `./tokens` | relative |
| 17 | `src/editor/common/model.ts` | `src/platform/common/storage.ts` | `../../platform/common/storage` | relative |
| 18 | `src/editor/common/textModel.ts` | `src/base/common/strings.ts` | `../../base/common/strings` | relative |
| 19 | `src/editor/common/textModel.ts` | `src/editor/common/model.ts` | `./model` | relative |
| 20 | `src/editor/common/tokens.ts` | `src/editor/common/textModel.ts` | `./textModel` | relative |
| 21 | `src/editor/node/editorFiles.ts` | `src/base/node/fs.ts` | `../../base/node/fs` | relative |
| 22 | `src/editor/node/editorFiles.ts` | `src/editor/common/textModel.ts` | `../common/textModel` | relative |
| 23 | `src/editor/node/editorFiles.ts` | `src/platform/node/storageFile.ts` | `../../platform/node/storageFile` | relative |
| 24 | `src/platform/browser/storageView.ts` | `src/base/browser/dom.ts` | `../../base/browser/dom` | relative |
| 25 | `src/platform/common/storage.ts` | `src/base/common/arrays.ts` | `../../base/common/arrays` | relative |
| 26 | `src/platform/common/storage.ts` | `src/platform/browser/storageView.ts` | `../browser/storageView` | relative |
| 27 | `src/platform/node/storageFile.ts` | `packages/core/src/index.ts` | `@arch/core` | workspace, main `lib/index.js` → `src/index.ts` |
| 28 | `src/platform/node/storageFile.ts` | `src/base/node/fs.ts` | `../../base/node/fs` | relative |
| 29 | `src/platform/node/storageFile.ts` | `src/editor/common/model.ts` | `../../editor/common/model` | relative |
| 30 | `src/platform/node/storageFile.ts` | `src/platform/common/storage.ts` | `../common/storage` | relative |
| 31 | `tools/fixtures/legacy-ids.ts` | `src/base/common/strings.ts` | `base/common/strings` | module id: only `src` holds `base/common/strings` |

`react` (in `main.ts` and `legacy-ids.ts`) is external: no edge. Before this slice the index finds 26 of these edges: it lacks 2, 5, 6, 27 and 31.

**Imports per file** (how many files import each one):

| file | in | file | in |
|---|---|---|---|
| `packages/core/src/index.ts` | 1 | `src/base/test/common/strings.test.ts` | 0 |
| `packages/core/src/log.ts` | 2 | `src/editor/browser/editorView.ts` | 1 |
| `packages/ui/src/button.ts` | 1 | `src/editor/common/model.ts` | 3 |
| `packages/ui/src/index.ts` | 1 | `src/editor/common/textModel.ts` | 2 |
| `src/app/legacy.ts` | 0 | `src/editor/common/tokens.ts` | 1 |
| `src/app/loader.ts` | 0 | `src/editor/node/editorFiles.ts` | 1 |
| `src/app/main.ts` | 1 | `src/platform/browser/storageView.ts` | 1 |
| `src/base/browser/dom.ts` | 2 | `src/platform/common/storage.ts` | 2 |
| `src/base/common/arrays.ts` | 2 | `src/platform/node/storageFile.ts` | 2 |
| `src/base/common/strings.ts` | 6 | `tools/fixtures/legacy-ids.ts` | 0 |
| `src/base/node/fs.ts` | 2 | | |

**24 folders:** `""`, `packages`, `packages/core`, `packages/core/src`, `packages/ui`, `packages/ui/src`, `src`, `src/app`, `src/base`, `src/base/browser`, `src/base/common`, `src/base/node`, `src/base/test`, `src/base/test/common`, `src/editor`, `src/editor/browser`, `src/editor/common`, `src/editor/node`, `src/platform`, `src/platform/browser`, `src/platform/common`, `src/platform/node`, `tools`, `tools/fixtures`. (`docs` and `.github` hold no source file, so they aren't folders of the index.)

**Level edges at `src`** (13 imports): `app → base` 1 (#4), `app → editor` 2 (#7, #8), `app → platform` 1 (#9), `editor → base` 3 (#14, #18, #21), `editor → platform` 2 (#17, #23), `platform → base` 3 (#24, #25, #28), `platform → editor` 1 (#29). **At `""`:** `src → packages` 2 (#6, #27), `tools → src` 1 (#31). **At `src/base`:** `browser → common`, `node → common`, `test → common`, 1 each.

### Docs

**4 docs** (sorted): `.github/instructions/editor.instructions.md` ("Editor rules"), `README.md` ("arch-repo"), `docs/architecture.md` ("Architecture"), `src/app/README.md` ("The app").

**13 doc links** (by doc, then target):

| doc | target | kind | count | detail |
|---|---|---|---|---|
| `.github/instructions/editor.instructions.md` | `src/editor` | applies | 1 | `src/editor/**` |
| `README.md` | `""` | readme | 1 | |
| `README.md` | `packages/core` | mentions | 1 | |
| `README.md` | `packages/ui` | mentions | 1 | |
| `README.md` | `src/app` | mentions | 1 | |
| `docs/architecture.md` | `src/app` | mentions | 1 | |
| `docs/architecture.md` | `src/base` | mentions | 1 | |
| `docs/architecture.md` | `src/editor` | mentions | 2 | |
| `docs/architecture.md` | `src/editor/browser` | mentions | 1 | (`editor/browser`: one folder ends with it) |
| `docs/architecture.md` | `src/editor/common` | mentions | 1 | |
| `docs/architecture.md` | `src/platform` | mentions | 2 | |
| `src/app/README.md` | `src/app` | readme | 1 | |
| `src/app/README.md` | `src/app/loader.ts` | mentions | 1 | |

(`common`, `browser`, `node` and `main.ts` have no `/`, so they aren't path mentions.)

**`describe` lists docs** linked to the path or any ancestor except the root, at most 5. Each doc is shown by its best link, ranked by:
1. kind: applies, then readme, then mentions;
2. then the deeper target;
3. then a plain-folder glob (`x/**`) before a file pattern;
4. then a name that holds an architecture word;
5. then the count;
6. then the doc's path.

The architecture words: architecture, design, overview, organization, organisation, structure, contributing, agents, claude, copilot-instructions, conventions, layers.

- `src/editor/common/`:
  ```
  Docs about it:
    .github/instructions/editor.instructions.md — Editor rules (applies to src/editor/**)
    docs/architecture.md — Architecture (mentions src/editor/common/)
  ```
- `src/app/`:
  ```
  Docs about it:
    src/app/README.md — The app (this folder's README)
    docs/architecture.md — Architecture (mentions src/app/)
    README.md — arch-repo (mentions src/app/)
  ```
- `src/app/loader.ts`:
  ```
  Docs about it:
    src/app/README.md — The app (README of src/app/)
    docs/architecture.md — Architecture (mentions src/app/)
    README.md — arch-repo (mentions src/app/)
  ```
- `tools/`: no docs, so no block.

**`overview` lists docs to read first**, at most 5:
1. the root README;
2. then docs whose name holds an architecture word (shallower path first, then more distinct targets mentioned, then path);
3. then docs with an applies link (the shallowest target first, a plain-folder glob first, then path).

```
Docs to read first:
  README.md — arch-repo
  docs/architecture.md — Architecture
  .github/instructions/editor.instructions.md — Editor rules (applies to src/editor/**)
```

### Impact of `src/base/common/strings.ts` (dependents, transitive)

16 files: 6 at distance 1, 6 at 2, 3 at 3, 1 at 4. Each distance lists the most imported first, then by path:

- **1:** `src/base/browser/dom.ts`, `src/base/common/arrays.ts`, `src/editor/common/textModel.ts`, `src/app/legacy.ts`, `src/base/test/common/strings.test.ts`, `tools/fixtures/legacy-ids.ts`
- **2:** `src/base/node/fs.ts`, `src/platform/common/storage.ts`, `src/editor/browser/editorView.ts`, `src/editor/common/tokens.ts`, `src/editor/node/editorFiles.ts`, `src/platform/browser/storageView.ts`
- **3:** `src/editor/common/model.ts`, `src/platform/node/storageFile.ts`, `src/app/main.ts`
- **4:** `src/app/loader.ts`

Among them:
- **Tests:** 1 (`strings.test.ts`).
- **Entry points a package.json names:** `src/app/loader.ts`.
- **Other files nothing imports:** `src/app/legacy.ts`, `tools/fixtures/legacy-ids.ts`.

**By area, `group_by: "src"`:**
```
By area (inside src/):
  src/editor/  5
  src/base/  4
  src/app/  3
  src/platform/  3
  elsewhere (outside src/)  1
```

**By area, `group_by: "auto"`.** describe's used-by rule: each file goes under the child of the lowest folder holding both it and `src/base/common`, on the way to it.
```
By area:
  src/editor/  5
  src/app/  3
  src/platform/  3
  src/base/browser/  1
  src/base/common/arrays.ts  1
  src/base/node/  1
  src/base/test/  1
  tools/  1
```

**`within`:** the dependents of `src/editor` inside `src/platform` are `src/platform/node/storageFile.ts` (1 direct, 1 in all).

### Architecture

**Layers of `src`.** For each pair of children, the direction with more imports is the dominant one; levels count up from the parts that use nothing. `platform → editor` has 1 import against `editor → platform`'s 2, so it's against the order.
```
Layers of src/, bottom first (each uses only the layers below it, except the imports listed after):
  0  base/
  1  platform/
  2  editor/
  3  app/
Against that order (1 import):
  platform/ → editor/  1
    src/platform/node/storageFile.ts → src/editor/common/model.ts
```
**Layers of `src/base`:**
```
Layers of src/base/, bottom first (each uses only the layers below it, except the imports listed after):
  0  common/
  1  browser/, node/, test/
Against that order: none.
```
**Layers of `""`:** 0 `packages/`, 1 `src/`, 2 `tools/`, none against.

**Conventions of `src`.** The folder names that recur in 3 or more folders strictly inside it are browser (3), common (4) and node (3); app, base, editor, platform and test occur once each. A file belongs to the deepest recurring name on its path, so `src/base/test/common/strings.test.ts` is common. 20 imports have both ends in a named folder.
```
Folder names that recur under src/ (in 3 or more folders): browser (3), common (4), node (3).
What each one's files import:
  browser → browser 2, common 2
  common → browser 1, common 8
  node → common 4, node 3
The rarer pairs (3 imports or fewer):
  browser → browser: src/editor/browser/editorView.ts → src/base/browser/dom.ts; src/platform/browser/storageView.ts → src/base/browser/dom.ts
  browser → common: src/base/browser/dom.ts → src/base/common/strings.ts; src/editor/browser/editorView.ts → src/editor/common/model.ts
  common → browser: src/platform/common/storage.ts → src/platform/browser/storageView.ts
  node → node: src/editor/node/editorFiles.ts → src/base/node/fs.ts; src/editor/node/editorFiles.ts → src/platform/node/storageFile.ts; src/platform/node/storageFile.ts → src/base/node/fs.ts
```

**Cycles.** One strongly connected group: `src/editor/common/model.ts`, `src/editor/common/textModel.ts`, `src/editor/common/tokens.ts`.
```
Import cycles touching src/: 1, holding 3 files in all.
  3 files: src/editor/common/model.ts, src/editor/common/textModel.ts, src/editor/common/tokens.ts
```
Through `src/editor/common/model.ts`:
```
The shortest import cycle through src/editor/common/model.ts (3 steps):
  src/editor/common/model.ts
  → src/editor/common/tokens.ts  (import "./tokens")
  → src/editor/common/textModel.ts  (import "./textModel")
  → src/editor/common/model.ts  (import "./model")
```
Through `src/platform/common/storage.ts`: `src/platform/common/storage.ts is in no import cycle.`

**Files nothing imports.** `src/app/legacy.ts`, `src/app/loader.ts`, `src/base/test/common/strings.test.ts` and `tools/fixtures/legacy-ids.ts`.

For `src`:
```
Files in src/ that no indexed file imports: 2, not counting 1 test file.
Named as entry points by a package.json (1):
  src/app/loader.ts
Not named anywhere (1):
  src/app/legacy.ts
Note: a file nothing imports may still be loaded by name (a build script, a worker, an HTML page, a test runner), so check before deleting it.
```
For the repo (`""`), the first line is `Files in the repo that no indexed file imports: 3, not counting 1 test file.`. Then it names `src/app/loader.ts`, and lists `src/app/legacy.ts` and `tools/fixtures/legacy-ids.ts` as not named anywhere.

**Summary of `src`:**
```
src/ — what its imports say about how it's organized:
Layers, bottom first: base/ · platform/ · editor/ · app/ (1 import against that order)
Folder conventions: browser, common, node
Import cycles: 1, the largest 3 files
Files nothing imports: 2, not counting tests (1 entry point named by a package.json)
For details, ask again with report "layers", "conventions", "cycles" or "unused".
```

### The truth builder on the same fixture (R2)

- **The regex scanner and `preProcessFile` agree on 30 edges:** every edge above except #5. Neither reads `import(url)`. The workspace and module-id specifiers resolve through `scripts/eval/resolve-truth.ts`.
- **The computed-import sweep finds one site:** `{ file: "src/app/loader.ts", line: 5, expression: "url" }`. Adjudicating it as importing `src/app/main.ts` gives the 31.
- **The truths over the 31** (each matches the engine's answers above; both are derived from this design, not from each other):
  - *impact* of `src/base/common/strings.ts` per `src/app`, `src/base`, `src/editor`, `src/platform`: 3, 4, 5, 3; elsewhere 1; total 16.
  - *cycle* through `src/editor/common/model.ts`: 3 steps. Through `src/platform/common/storage.ts`: none.
  - *unused* in `src`: `src/app/legacy.ts`, `src/app/loader.ts`.
  - *violations* from `src/platform` into `src/editor`: `src/platform/node/storageFile.ts`.
  - *entries* loading `src/base/common/strings.ts`: `src/app/legacy.ts`, `src/app/loader.ts`, `tools/fixtures/legacy-ids.ts`.
  - *pairs* of `src`'s children: app→base, app→editor, app→platform, editor→base, editor→platform, platform→base, platform→editor.
  - *pairs* of the names common, browser and node under `src`: browser→browser, browser→common, common→browser, common→common, node→common, node→node.

---

## Part 0 — Start and measure

### Task 0: Baseline, ledger, the owner's decisions

**Files:** `.superpowers/sdd/2026-10-14-v1-6-works-on-your-repo/progress.md` (gitignored; started at planning).

- [ ] **Step 1: Check the branch and the owner's files**

Run: `git status --short && git log --oneline -1 && git rev-parse --abbrev-ref HEAD`
Expected: `pivot/v1` at `5cf2f9e` or later (the plan's own commit), with only ` M docs/LEARNING_NOTES.md` and `?? lib/agent/state.ts` uncommitted. They're the owner's: never stage them.

- [ ] **Step 2: Run the gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: tsc clean, lint 0 errors (4 warnings, pre-existing), vitest 910/910.

- [ ] **Step 3: Record the starting state in the ledger**

Append to `progress.md` under `## Execution`:
- the owner's decisions line from the kickoff prompt, verbatim, and each D and R as decided;
- the gate's numbers;
- whether port 3000 is up (`netstat -ano | grep -E "LISTENING" | grep -E ":3000\b"`) and its PID (never stop it);
- `git -C ../vscode log --oneline -1` (must be `cc3fec88`) and `git -C ../vscode status --porcelain` (must be empty);
- `claude --version`.

No commit (nothing tracked changes).

### Task 1: The repo probe. STOP for the owner's pick of repo 2 and the variety repos

**Files:**
- Create: `scripts/resolution.ts`, `scripts/resolution.test.ts`, `scripts/report-resolution.ts`
- Modify: `package.json` (script `report-resolution`)

**Interfaces:**
- Produces: `packageNameOf(specifier: string): string`; `resolutionReport(files, resolve, top?): ResolutionReport`; `npm run report-resolution -- <repo>`. Task 4 passes the workspace to the resolver here, and Task 19 runs it on every variety repo.

- [ ] **Step 1: Write the failing test**

`scripts/resolution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { packageNameOf, resolutionReport } from "./resolution";

describe("packageNameOf", () => {
    it("keeps a scope with its name, and drops a subpath", () => {
        expect(packageNameOf("@affine/core/modules/doc")).toBe("@affine/core");
        expect(packageNameOf("react-dom/client")).toBe("react-dom");
        expect(packageNameOf("vs/base/common/uri")).toBe("vs");
        expect(packageNameOf("react")).toBe("react");
    });
});

describe("resolutionReport", () => {
    const files = [
        { path: "src/a.ts", specifiers: ["./b", "../outside", "react", "@x/ui/button"] },
        { path: "src/b.ts", specifiers: ["@x/ui", "react", "vs/base/common/uri"] },
    ];
    // resolves ./b and @x/ui only
    const resolve = (importer: string, specifier: string): string | null =>
        specifier === "./b" ? "src/b.ts" : specifier === "@x/ui" ? "packages/ui/src/index.ts" : null;

    it("counts relative and bare specifiers apart, each with how many resolved", () => {
        const report = resolutionReport(files, resolve);
        expect(report.relative).toEqual({ total: 2, resolved: 1 });
        expect(report.bare).toEqual({ total: 5, resolved: 1 });
    });

    it("lists the unresolved bare specifiers by package name, most first, ties by name", () => {
        expect(resolutionReport(files, resolve).unresolvedBare).toEqual([
            { name: "react", count: 2 },
            { name: "@x/ui", count: 1 },
            { name: "vs", count: 1 },
        ]);
    });

    it("keeps only the top names asked for", () => {
        expect(resolutionReport(files, resolve, 1).unresolvedBare).toEqual([{ name: "react", count: 2 }]);
    });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run scripts/resolution.test.ts`
Expected: FAIL, cannot find module `./resolution`.

- [ ] **Step 3: Write `scripts/resolution.ts`**

```ts
/**
 * How much of a repo's import specifiers the index resolves (S10, PIVOT_SPEC.md §2): relative ones, which should all
 * resolve, and bare ones, which resolve only when they name the repo's own code (a workspace package, an alias, a
 * module id). Unresolved bare ones are listed by package name, so a reader tells "react" (outside the repo) from
 * "@affine/core" (a miss).
 */
export type ResolutionReport = {
    relative: { total: number; resolved: number };
    bare: { total: number; resolved: number };
    unresolvedBare: { name: string; count: number }[];
};

/** The package a bare specifier names: "@scope/name" with its scope, else the first segment. */
export function packageNameOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

const isRelative = (s: string): boolean => s === "." || s === ".." || s.startsWith("./") || s.startsWith("../");

export function resolutionReport(
    files: readonly { path: string; specifiers: readonly string[] }[],
    resolve: (importer: string, specifier: string) => string | null,
    top = 15,
): ResolutionReport {
    const report: ResolutionReport = { relative: { total: 0, resolved: 0 }, bare: { total: 0, resolved: 0 }, unresolvedBare: [] };
    const misses = new Map<string, number>();
    for (const file of files){
        for (const specifier of file.specifiers){
            const resolved = resolve(file.path, specifier) !== null;
            const bucket = isRelative(specifier) ? report.relative : report.bare;
            bucket.total++;
            if (resolved) bucket.resolved++;
            else if (!isRelative(specifier)){
                const name = packageNameOf(specifier);
                misses.set(name, (misses.get(name) ?? 0) + 1);
            }
        }
    }
    report.unresolvedBare = [...misses]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, top);
    return report;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run scripts/resolution.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: The CLI, `scripts/report-resolution.ts`**

```ts
/**
 * npm run report-resolution -- <path-to-repo>
 *
 * The share of an indexed repo's import specifiers the resolver turns into files (S10). It reads the stored specifiers
 * and resolves each again with today's resolver, so a specifier whose target another specifier of the same file already
 * reached still counts as resolved. Read-only: it opens the database and writes nothing.
 */
import path from "path";
import { getDb } from "../lib/db/client";
import { loadStoredFiles, requireRepository } from "../lib/db/store/structure";
import { repoKey } from "../lib/index/paths";
import { createResolver } from "../lib/index/resolve";
import { resolutionReport } from "./resolution";

const target = process.argv[2];
if (!target){
    console.error("usage: npm run report-resolution -- <path-to-repo>");
    process.exit(1);
}
const root = path.resolve(target);
const db = getDb();
const stored = loadStoredFiles(db, requireRepository(db, repoKey(root)));
const resolve = createResolver(root, new Set(stored.keys()));
const report = resolutionReport([...stored].map(([p, f]) => ({ path: p, specifiers: f.importSpecifiers })), resolve);
const pct = (r: { total: number; resolved: number }): string => (r.total === 0 ? "n/a" : `${((100 * r.resolved) / r.total).toFixed(1)}%`);

console.log(`[resolution] ${repoKey(root)}: ${stored.size} files`);
console.log(`[resolution] relative: ${report.relative.resolved}/${report.relative.total} (${pct(report.relative)})`);
console.log(`[resolution] bare: ${report.bare.resolved}/${report.bare.total} (${pct(report.bare)})`);
for (const miss of report.unresolvedBare) console.log(`[resolution]   unresolved ${miss.name}: ${miss.count}`);
```

Add `"report-resolution": "tsx scripts/report-resolution.ts",` to `package.json`'s scripts.

- [ ] **Step 6: Ask before cloning**

Look up each repo's size: `gh api repos/toeverything/AFFiNE --jq .size` and `gh api repos/RocketChat/Rocket.Chat --jq .size` (KB, full history). Also each variety candidate's: `expressjs/express`, `vitejs/vite`, `excalidraw/excalidraw`. Then ask:

> Task 1 clones two public repos for repo 2: AFFiNE (head) and Rocket.Chat (pinned at `4c37fbf`). The clones are shallow (one commit) and go into `../affine` and `../rocket.chat`. GitHub reports their full histories at ‹size› and ‹size>; a shallow clone is a fraction of that. Nothing is installed or run from them. The index goes into a scratch Nebulosity folder, never your database. OK?

- [ ] **Step 7: Clone, on a yes**

```bash
git clone --depth 1 https://github.com/toeverything/AFFiNE ../affine
git -C ../affine rev-parse HEAD
mkdir ../rocket.chat && git -C ../rocket.chat init -q && git -C ../rocket.chat remote add origin https://github.com/RocketChat/Rocket.Chat
git -C ../rocket.chat fetch --depth 1 origin 4c37fbf2ef013a2177466eb3fc90641d62b2aab7 && git -C ../rocket.chat checkout -q FETCH_HEAD
```
Record both SHAs in the ledger.

- [ ] **Step 8: Check each for agent guides at its commit**

Run, in each: `git ls-files | grep -i -E "(^|/)(AGENTS|CLAUDE|GEMINI)\.md$|copilot-instructions|^\.cursor/|^\.github/instructions/|^\.claude/|\.cursorrules"`
Expected: AFFiNE lists only `packages/frontend/apps/ios/AGENTS.md`, and Rocket.Chat lists nothing. Record what each lists.

- [ ] **Step 9: Index each into a scratch Nebulosity folder (R10)**

The data-folder split comes in Task 15, so until then a scratch `NEBULOSITY_HOME` stands in. It needs the migrations beside it:

```bash
S=../nebulosity-scratch/probe && mkdir -p "$S/lib/db" && cp -r lib/db/migrations "$S/lib/db/"
NEBULOSITY_HOME="$S" npx tsx scripts/index.ts ../affine
NEBULOSITY_HOME="$S" npx tsx scripts/index.ts ../rocket.chat
NEBULOSITY_HOME="$S" npm run report-resolution -- ../affine
NEBULOSITY_HOME="$S" npm run report-resolution -- ../rocket.chat
```
The scratch home has no `.env.local`, so summaries are "off" and nothing is spent. Record each run's files, edges, timings and the resolution report.

- [ ] **Step 10: Look at what a rubric and the truth would rest on**

For each repo, record:
- its docs (`git ls-files "*.md" | head -50`, and its README's sections) and any architecture page on the project's website that a big-picture rubric could come from;
- how its packages import each other: how many bare specifiers name a workspace package (`git ls-files "*package.json" | grep -v node_modules`, read each `name`). This decides how much of `scripts/eval/resolve-truth.ts` the truth needs;
- its dependency injection, if any (for E2): AFFiNE's `@toeverything/infra` framework;
- a summaries estimate at about $1 per 1,000 files and folders (Summary Benchmark #1: $10.30 for about 13,000). Task 17's estimator gives the real number before any spend.

Variety candidates for S10, sized through GitHub's API (`gh api repos/<o>/<r> --jq '.size,.default_branch'`) with no clone yet:
- `expressjs/express` (plain JavaScript, CommonJS, small);
- `vitejs/vite` (a TypeScript monorepo with pnpm workspaces);
- `excalidraw/excalidraw` (a TypeScript app with path aliases).

- [ ] **Step 11: STOP. The owner picks repo 2 and the variety repos**

Show one table:

| | AFFiNE | Rocket.Chat |
|---|---|---|
| commit | | |
| agent guides at that commit | | |
| files / TypeScript / edges | | |
| relative resolved | | |
| bare resolved, top unresolved names | | |
| workspace packages and how they're imported | | |
| docs a rubric could use | | |
| dependency injection | | |
| summaries, rough estimate | | |

Recommend AFFiNE unless the table shows a blocker. Ask for the pick of repo 2, and confirm the three variety repos (or others). Record the answer verbatim in the ledger.

- [ ] **Step 12: Gate, commit, push**

Run: `npx tsc --noEmit && npm run lint && npx vitest run` (914/914). Then:
```bash
git add -A -- scripts/resolution.ts scripts/resolution.test.ts scripts/report-resolution.ts package.json && git commit -m "feat(scripts): report-resolution, the share of a repo's import specifiers the resolver turns into files (S10)" -- scripts/resolution.ts scripts/resolution.test.ts scripts/report-resolution.ts package.json && git push origin pivot/v1
```

### Task 2: E2's measurement: type-checking VS Code (Typecheck Benchmark #1)

**Files:**
- Create: `scripts/measure-typecheck.ts`
- Modify: `package.json` (script `measure-typecheck`), `docs/BENCHMARKS.md`, `docs/ENGINEERING_DECISIONS.md` (ADR-043 amended)

ADR-043 holds E2 behind "half a day measuring the memory and time of type-checking VS Code". This task measures; the owner decides after Eval #2 (Task 24).

- [ ] **Step 1: Write `scripts/measure-typecheck.ts`**

```ts
/**
 * npm run measure-typecheck -- <path-to-repo> [--project <tsconfig, repo-relative>] [--sample <n>]
 *
 * E2's measurement (ADR-043): what a type-checked call graph would cost. It builds TypeScript's program for one tsconfig
 * project (src/tsconfig.json for VS Code), times it and reads the process's memory, then resolves a sample of method
 * calls to their declarations, as a call graph through injected services would. A call that resolves to an interface
 * method is the dependency-injection case. For each one it counts the classes that `implements` that interface
 * (syntactically): one means the call's target is known, several mean it's one of them. Read-only. Run it with a big
 * heap: node --max-old-space-size=16384 --import tsx scripts/measure-typecheck.ts ../vscode
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const args = process.argv.slice(2);
const repo = args[0];
if (!repo){
    console.error("usage: npm run measure-typecheck -- <path-to-repo> [--project <tsconfig>] [--sample <n>]");
    process.exit(1);
}
const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
};
const root = path.resolve(repo);
const project = path.join(root, flag("--project") ?? "src/tsconfig.json");
const sampleSize = Number(flag("--sample") ?? "2000");
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const memory = (): string => {
    const m = process.memoryUsage();
    return `heap ${mb(m.heapUsed)}, rss ${mb(m.rss)}`;
};

const parsed = ts.getParsedCommandLineOfConfigFile(project, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
});
if (!parsed) throw new Error(`couldn't read ${project}`);

let t = performance.now();
const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
const programMs = performance.now() - t;
console.log(`[typecheck] program: ${parsed.fileNames.length} root files, ${program.getSourceFiles().length} source files in all, ${(programMs / 1000).toFixed(1)} s, ${memory()}`);

t = performance.now();
const checker = program.getTypeChecker();
const ours = program.getSourceFiles()
    .filter((f) => !f.isDeclarationFile && path.resolve(f.fileName).startsWith(root))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : 1));

// interface name → how many classes say they implement it (syntactic, by name: what E2's heuristic fallback would see)
const implementers = new Map<string, number>();
const calls: ts.CallExpression[] = [];
for (const file of ours){
    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node)){
            for (const clause of node.heritageClauses ?? []){
                if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
                for (const type of clause.types){
                    const name = type.expression.getText(file);
                    implementers.set(name, (implementers.get(name) ?? 0) + 1);
                }
            }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) calls.push(node);
        ts.forEachChild(node, visit);
    };
    visit(file);
}
const step = Math.max(1, Math.floor(calls.length / sampleSize));
const sample = calls.filter((_, i) => i % step === 0).slice(0, sampleSize);

const counts = { interfaceMethod: 0, classMethod: 0, other: 0, unresolved: 0, oneImplementer: 0, severalImplementers: 0, noImplementer: 0 };
for (const call of sample){
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!declaration){ counts.unresolved++; continue; }
    const owner = declaration.parent;
    if (owner && ts.isInterfaceDeclaration(owner)){
        counts.interfaceMethod++;
        const n = implementers.get(owner.name.text) ?? 0;
        if (n === 1) counts.oneImplementer++;
        else if (n > 1) counts.severalImplementers++;
        else counts.noImplementer++;
    } else if (owner && ts.isClassDeclaration(owner)) counts.classMethod++;
    else counts.other++;
}
const sampleMs = performance.now() - t;
const usage = process.resourceUsage();
const result = {
    repo: path.basename(root), project: path.relative(root, project), rootFiles: parsed.fileNames.length,
    sourceFiles: program.getSourceFiles().length, programSeconds: +(programMs / 1000).toFixed(1),
    methodCalls: calls.length, sampled: sample.length, sampleSeconds: +(sampleMs / 1000).toFixed(1),
    perCallMs: +(sampleMs / Math.max(1, sample.length)).toFixed(2), ...counts,
    peakRssMb: Math.round(usage.maxRSS / 1024), heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
};
console.log(`[typecheck] ${calls.length} method calls; sampled ${sample.length} in ${result.sampleSeconds} s (${result.perCallMs} ms each), ${memory()}`);
console.log(JSON.stringify(result, null, 2));
const out = path.resolve(__dirname, "..", ".nebulosity", "measure");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `typecheck-${result.repo}.json`), JSON.stringify(result, null, 2) + "\n");
```

Add `"measure-typecheck": "node --max-old-space-size=16384 --import tsx scripts/measure-typecheck.ts",` to `package.json`.

- [ ] **Step 2: Run it on VS Code**

Run (in the background; it may take minutes): `npm run measure-typecheck -- ../vscode`
Expected: a program of several thousand files, the time to build it and the peak memory, and a classified sample of 2,000 calls.

`../vscode` has no `node_modules`, so outside types (`@types/node`, electron) resolve to nothing, and calls into them land in "unresolved". Record that limit. VS Code's own interfaces and services are all in the repo.

If the process runs out of memory at 16 GB, record that as the result and try `--project src/vs/base/tsconfig.json`-sized projects only if one exists. Don't raise the cap past 24 GB (the machine has 31.3 GB).

- [ ] **Step 3: Record Typecheck Benchmark #1 and amend ADR-043**

Append to `docs/BENCHMARKS.md`:

```markdown
## ‹today› Typecheck Benchmark #1 — E2's measurement: type-checking VS Code

`npm run measure-typecheck -- ../vscode` (scripts/measure-typecheck.ts) on VS Code at `cc3fec88`, the project `src/tsconfig.json`, Node 24.14.0 with a 16 GB heap cap, on the owner's laptop (31.3 GB of RAM).

| What | Result |
|---|---|
| Root files / source files in the program | ‹n› / ‹n› |
| Building the program | ‹s› s |
| Peak memory (rss) | ‹MB› |
| Method calls in VS Code's own files | ‹n› |
| Sampled, resolved to a declaration | ‹n› of ‹n›, ‹ms› ms each |
| …to an interface method (the injected-service case) | ‹n›: one implementing class ‹n›, several ‹n›, none ‹n› |
| …to a class method / other / unresolved | ‹n› / ‹n› / ‹n› |

**Limits:** `../vscode` has no `node_modules`, so calls into outside types (Node, Electron) don't resolve. "Implementing class" is counted by name from `implements` clauses, which is what a heuristic fallback would see.
**What it means for E2:** ‹one paragraph: whether a type-checked call graph fits this machine and how long a full pass would take (calls × ms per call), and what share of injected-service calls a unique implementer would resolve›. The owner decides E2's fate after Eval #2 (ADR-043).
```

Append to ADR-043:
```markdown
**Amended (‹today›, V1.6): E2's measurement.** Type-checking VS Code's `src/tsconfig.json` project took ‹s› s and ‹MB› at peak, and resolving a call took ‹ms› ms (BENCHMARKS.md, Typecheck Benchmark #1). ‹n›% of the sampled method calls resolved to an interface method, the injected-service case, and ‹n›% of those have exactly one implementing class. The decision to build E2 waits for Eval #2's results (V1.6's plan, Task 24).
```

- [ ] **Step 4: Commit and push** (no test: a measurement script, run by hand)

Run the gate first (914/914).
```bash
git add -A -- scripts/measure-typecheck.ts package.json docs/BENCHMARKS.md docs/ENGINEERING_DECISIONS.md && git commit -m "docs: Typecheck Benchmark #1, E2's measurement on VS Code (ADR-043 amended)" -- scripts/measure-typecheck.ts package.json docs/BENCHMARKS.md docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

### Task 3: The probe script, and Eval #1's "13,000 tokens" checked

**Files:**
- Create: `scripts/eval/probe.ts`
- Modify: `scripts/eval/transcript.ts` (+ `transcript.test.ts`), `package.json` (script `eval:probe`), `docs/EVAL_RESULTS.md` (a dated correction), `docs/BENCHMARKS.md` (Eval #1's entry)

**Interfaces:**
- Produces: `RunSummary.firstCallContext: number | null`, the first assistant message's input + cache writes + cache reads. Tasks 11 (gate 5b) and 13 use it.
- Produces: `npm run eval:probe -- --config <names>`. Task 8 adds the `n` configuration.

- [ ] **Step 1: Write the failing test**

Add to `scripts/eval/transcript.test.ts`:

```ts
describe("firstCallContext", () => {
    it("is the first assistant message's input, cache writes and cache reads", () => {
        const lines = [
            JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5-5" }),
            JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 2478, cache_read_input_tokens: 18606, output_tokens: 24 } } }),
            JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 471, cache_read_input_tokens: 21084, output_tokens: 24 } } }),
            JSON.stringify({ type: "result", subtype: "success", num_turns: 2 }),
        ].join("\n");
        expect(summarizeRun(lines).firstCallContext).toBe(21086);
    });

    it("is null when no assistant message reported usage", () => {
        expect(summarizeRun(JSON.stringify({ type: "result", subtype: "success" })).firstCallContext).toBeNull();
    });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run scripts/eval/transcript.test.ts`
Expected: FAIL, `firstCallContext` is undefined.

- [ ] **Step 3: Add the field**

In `scripts/eval/transcript.ts`, add to `RunSummary` after `usage`:

```ts
    /** The first API call's prompt: input + cache writes + cache reads of the first assistant message (the per-turn base, D1 condition 5). */
    firstCallContext: number | null;
```

and in `summarizeRun`, before the `return`:

```ts
    const firstUsage = events.find((e) => e.type === "assistant" && e.message?.usage)?.message.usage as Json | undefined;
    const firstCallContext = firstUsage
        ? (firstUsage.input_tokens ?? 0) + (firstUsage.cache_creation_input_tokens ?? 0) + (firstUsage.cache_read_input_tokens ?? 0)
        : null;
```

with `firstCallContext,` added to the returned object after `usage`.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run scripts/eval/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: `scripts/eval/probe.ts`**

A one-turn run per configuration, with Eval #1's isolation, that prints the first call's context. Configurations:
- `a-default`: no MCP server, tool search at its default;
- `a-upfront`: no MCP server, `ENABLE_TOOL_SEARCH=false`.
Task 8 adds `n`, Nebulosity's registration from an eval definition.

```ts
/**
 * npm run eval:probe -- --config a-default,a-upfront [--repo ../vscode]
 *
 * One-turn runs of `claude -p` ("Reply with the single word ready."), isolated as the eval's runs are (run-config.ts),
 * that report the first API call's context: the per-turn base every answer pays (V1.6 plan, D1 condition 5). It asks
 * nothing of the repo, so no answer is scored. Raw transcripts stay in .nebulosity/eval/probe/ (gitignored). Each run
 * is a real call on the owner's subscription: ask first, with the count.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { childEnv, claudeArgs } from "./run-config";
import { summarizeRun } from "./transcript";

const PROMPT = "Reply with the single word ready.";
const CONFIGS: Record<string, { toolSearch: boolean }> = { "a-default": { toolSearch: true }, "a-upfront": { toolSearch: false } };

const forward = (p: string): string => p.replace(/\\/g, "/");
const checkout = forward(path.resolve(__dirname, "..", ".."));
const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const names = (value("--config") ?? "").split(",").filter(Boolean);
const repo = forward(path.resolve(value("--repo") ?? path.join(checkout, "..", "vscode")));
const unknown = names.filter((n) => !(n in CONFIGS));
if (names.length === 0 || unknown.length > 0){
    console.error(`usage: npm run eval:probe -- --config ${Object.keys(CONFIGS).join(",")} [--repo <path>]${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
    process.exit(1);
}
const claude = forward(process.env.CLAUDE_BIN ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
const gitBash = forward(process.env.GIT_BASH ?? path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe"));
const dir = `${checkout}/.nebulosity/eval/probe`;
fs.mkdirSync(dir, { recursive: true });
const empty = `${checkout}/eval/mcp/empty.json`;

for (const name of names){
    const env = childEnv(process.env, { gitBash, toolSearch: CONFIGS[name].toolSearch });
    const run = spawnSync(claude, claudeArgs("baseline", { empty, nebulosity: empty }), { cwd: repo, env: env as NodeJS.ProcessEnv, input: PROMPT, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    const file = `${dir}/${name}.${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.jsonl`;
    fs.writeFileSync(file, run.stdout ?? "");
    const s = summarizeRun(run.stdout ?? "");
    console.log(`${name}: Claude Code ${s.claudeVersion}, ${s.tools.length} tools listed, first call ${s.firstCallContext?.toLocaleString("en-US") ?? "n/a"} tokens, $${s.costUsd.toFixed(3)} est. (${file})`);
}
```

Add `"eval:probe": "tsx scripts/eval/probe.ts",` to `package.json`.

- [ ] **Step 6: Ask, then run the two probes**

> Task 3 makes 2 one-turn `claude -p` runs on your subscription. Each answers "ready" with no MCP server, one at the default tool search and one with it off. Together they show how much of Eval #1's "13,000 tokens up front" was Claude Code's own tools. About $0.03 at list price. OK?

On a yes: `npm run eval:probe -- --config a-default,a-upfront`
Expected: two first-call contexts. Their difference is what turning tool search off costs with no MCP server at all: Claude Code's own deferred tools.

- [ ] **Step 7: Correct Eval #1, dated, without rewriting it**

In `docs/EVAL_RESULTS.md`, under "The losses", add a sub-bullet below the bullet "**Tokens, with the tools up front.**":

```markdown
  - *Correction (‹today›, V1.6's Task 3):* most of those 13,000 tokens were Claude Code's own tools, not Nebulosity's. `ENABLE_TOOL_SEARCH=false` loads every deferred tool, and Claude Code defers its own (cron, worktree, workflow, messaging and others) as well as MCP tools. With no MCP server at all, on Claude Code ‹version›, turning tool search off raised the first call's context from ‹a› to ‹b› tokens (+‹b − a›). Nebulosity's seven definitions and its instructions measure about 2,000 tokens (7,167 characters). V1.6 loads only Nebulosity's tools up front (ADR-056).
```

In the "Tool search" section's last bullet ("What loading up front did to the scores"), append: `(The token cost of U is mostly Claude Code's own tools: see the correction under "The losses".)`

In `docs/BENCHMARKS.md`'s Eval #1 entry, append one sentence pointing to the correction.

If the measured difference is small (under 5,000 tokens), the claim above is wrong. Then write what was measured instead and say so to the owner.

- [ ] **Step 8: Gate, commit, push**

Run: `npx tsc --noEmit && npm run lint && npx vitest run` (916/916). Then:
```bash
git add -A -- scripts/eval/probe.ts scripts/eval/transcript.ts scripts/eval/transcript.test.ts package.json docs/EVAL_RESULTS.md docs/BENCHMARKS.md && git commit -m "fix(eval): the probe and each run's first-call context; Eval #1's up-front tokens were mostly Claude Code's own tools (a dated correction)" -- scripts/eval/probe.ts scripts/eval/transcript.ts scripts/eval/transcript.test.ts package.json docs/EVAL_RESULTS.md docs/BENCHMARKS.md && git push origin pivot/v1
```

---

## Part 1 — The engine: what grep can't

### Task 4: More imports resolved, and the entry points a package.json names (ADR-053)

**Files:**
- Create: `test/fixtures/arch-repo/**` (every file in "Ground truth"), `lib/index/workspace.ts`, `lib/index/workspace.test.ts`, `lib/db/store/entries.ts`
- Modify: `lib/index/discover.ts` (+ `discover.test.ts`), `lib/index/resolve.ts` (+ `resolve.test.ts`), `lib/index/languages/typescript.ts` (+ `typescript.test.ts`), `lib/index/pipeline.ts` (+ `pipeline.test.ts`), `lib/index/update.ts` (+ `update.test.ts`), `lib/db/schema.ts`, `scripts/index.ts` (`--no-activate`), `scripts/report-resolution.ts`, `scripts/resolution.ts`
- Generate: `lib/db/migrations/0007_v1_6_entry_points.sql` (+ drizzle's meta)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-053), `docs/PIVOT_SPEC.md` §5.2 step 3, `docs/DATABASE_DESIGN.md` (`entry_points`), `docs/BENCHMARKS.md` (Index Benchmark #4)

**Interfaces:**
- Produces:
  - `DiscoveryResult.manifests: string[]` and `DiscoveryResult.docs: DiscoveredFile[]` (Task 5 reads `docs`);
  - `listManifests(repoRoot): string[]`;
  - `readWorkspace(repoRoot, manifests): Workspace`;
  - `packageNameOf(specifier)`;
  - `declaredEntries(workspace, findSource): { path, declaredBy }[]`;
  - `createSourceFinder(fileSet, workspace): (base: string) => string | null`;
  - `createResolver(repoRoot, fileSet, { workspace })`;
  - the `entry_points` table, `replaceEntryPoints` and `loadEntryPoints(db, repoId): Set<string>` (Tasks 6 and 7 read it).

- [ ] **Step 1: Create the fixture**

Write every file of `test/fixtures/arch-repo` exactly as "Ground truth" gives it, with LF line endings: the 21 source files, the 3 package.json files, the 3 tsconfig.json files, and the 4 docs. Run `git status --short test/fixtures/arch-repo` and expect 31 new files.

- [ ] **Step 2: Write the failing tests**

`lib/index/discover.test.ts`, a new `describe`:

```ts
describe("discoverFiles on the architecture fixture", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    const found = discoverFiles(root, { extensions: TYPESCRIPT_EXTENSIONS });

    it("finds the 21 source files", () => {
        expect(found.files).toHaveLength(21);
    });

    it("lists the package.json and tsconfig files apart, sorted", () => {
        expect(found.manifests).toEqual([
            "package.json", "packages/core/package.json", "packages/core/tsconfig.json", "packages/ui/package.json", "src/tsconfig.json", "tools/tsconfig.json",
        ]);
    });

    it("lists the markdown docs apart, sorted, the .github folder included", () => {
        expect(found.docs.map((d) => d.path)).toEqual([".github/instructions/editor.instructions.md", "README.md", "docs/architecture.md", "src/app/README.md"]);
    });
});
```

`lib/index/workspace.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { discoverFiles } from "./discover";
import { TYPESCRIPT_EXTENSIONS } from "./languages/typescript";
import { createSourceFinder } from "./resolve";
import { declaredEntries, flattenExports, packageNameOf, readWorkspace } from "./workspace";

const fixture = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
const found = discoverFiles(fixture, { extensions: TYPESCRIPT_EXTENSIONS });
const workspace = readWorkspace(fixture, found.manifests);

describe("readWorkspace on the architecture fixture", () => {
    it("knows the three packages by name", () => {
        expect([...workspace.byName.keys()].sort()).toEqual(["@arch/core", "@arch/ui", "arch-repo"]);
        expect(workspace.byName.get("@arch/core")!.dir).toBe("packages/core");
        expect(workspace.byName.get("arch-repo")!.dir).toBe("");
    });

    it("reads module ids against the folders that hold a tsconfig", () => {
        expect(workspace.idRoots).toEqual(["packages/core", "src", "tools"]);
    });

    it("maps compiled folders to their sources only where a tsconfig sets both outDir and rootDir", () => {
        expect(workspace.outDirs).toEqual([{ outDir: "packages/core/lib", rootDir: "packages/core/src" }]);
    });

    it("finds the entry points each package.json names", () => {
        const findSource = createSourceFinder(new Set(found.files.map((f) => f.path)), workspace);
        expect(declaredEntries(workspace, findSource)).toEqual([
            { path: "packages/core/src/index.ts", declaredBy: "packages/core/package.json main" },
            { path: "packages/ui/src/index.ts", declaredBy: 'packages/ui/package.json exports "."' },
            { path: "src/app/loader.ts", declaredBy: "package.json main" },
        ]);
    });
});

describe("flattenExports", () => {
    it("reads a string as the package's main export", () => {
        expect(flattenExports("./index.js")).toEqual(new Map([[".", ["./index.js"]]]));
    });

    it("keeps subpath keys and orders each entry's conditions: source, types, import, then default", () => {
        expect(flattenExports({ ".": { default: "./lib/index.js", types: "./lib/index.d.ts", source: "./src/index.ts" }, "./*": "./src/*.ts" }))
            .toEqual(new Map([[".", ["./src/index.ts", "./lib/index.d.ts", "./lib/index.js"]], ["./*", ["./src/*.ts"]]]));
    });

    it("reads a map of conditions with no subpaths as the main export, and drops null targets", () => {
        expect(flattenExports({ import: "./a.mjs", require: null })).toEqual(new Map([[".", ["./a.mjs"]]]));
    });
});

describe("packageNameOf", () => {
    it("keeps a scope with its name and drops a subpath", () => {
        expect(packageNameOf("@arch/core/lib/log")).toBe("@arch/core");
        expect(packageNameOf("lodash/fp")).toBe("lodash");
    });
});

describe("two packages with one name (Review Focus 1)", () => {
    it("prefers the one outside test, fixture and example folders, then the shallower", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-ws-"));
        const write = (rel: string, json: object): void => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), JSON.stringify(json));
        };
        write("fixtures/ui/package.json", { name: "@x/ui", main: "fake.js" });
        write("packages/deep/ui/package.json", { name: "@x/ui", main: "real.js" });
        write("packages/ui-copy/examples/package.json", { name: "@x/ui", main: "example.js" });
        const ws = readWorkspace(root, ["fixtures/ui/package.json", "packages/deep/ui/package.json", "packages/ui-copy/examples/package.json"]);
        expect(ws.byName.get("@x/ui")!.dir).toBe("packages/deep/ui");
        fs.rmSync(root, { recursive: true, force: true });
    });
});
```

`lib/index/resolve.test.ts`, a new `describe`:

```ts
describe("createResolver with the workspace (ADR-053)", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    const found = discoverFiles(root, { extensions: TYPESCRIPT_EXTENSIONS });
    const files = new Set(found.files.map((f) => f.path));
    const resolve = createResolver(root, files, { workspace: readWorkspace(root, found.manifests) });

    it("resolves a workspace package through its main, compiled path mapped to source", () => {
        expect(resolve("src/platform/node/storageFile.ts", "@arch/core")).toBe("packages/core/src/index.ts");
    });

    it("resolves a workspace subpath through the package's outDir → rootDir", () => {
        expect(resolve("packages/ui/src/button.ts", "@arch/core/lib/log")).toBe("packages/core/src/log.ts");
    });

    it("resolves a package's '.' export and a '*' pattern export", () => {
        expect(resolve("src/app/main.ts", "@arch/ui")).toBe("packages/ui/src/index.ts");
        expect(resolve("src/app/main.ts", "@arch/ui/button")).toBe("packages/ui/src/button.ts");
    });

    it("reads a module id against the one folder holding a tsconfig that has the file (R3)", () => {
        expect(resolve("tools/fixtures/legacy-ids.ts", "base/common/strings")).toBe("src/base/common/strings.ts");
        expect(resolve("src/app/loader.ts", "app/main.js")).toBe("src/app/main.ts");
    });

    it("leaves externals, one-segment names, scoped names that aren't packages and protocols unresolved", () => {
        expect(resolve("src/app/main.ts", "react")).toBeNull();
        expect(resolve("src/app/main.ts", "@other/thing/x")).toBeNull();
        expect(resolve("src/app/main.ts", "node:fs/promises")).toBeNull();
    });

    it("refuses a module id two roots both hold", () => {
        const both = createResolver("/repo", new Set(["a/lib/x.ts", "b/lib/x.ts", "c/main.ts"]), {
            workspace: { byName: new Map(), idRoots: ["a", "b"], outDirs: [] },
        });
        expect(both("c/main.ts", "lib/x")).toBeNull();
    });

    it("still resolves relative imports first, as before", () => {
        expect(resolve("src/app/main.ts", "../editor/node/editorFiles")).toBe("src/editor/node/editorFiles.ts");
    });
});
```

(Add the imports `discoverFiles`, `TYPESCRIPT_EXTENSIONS` and `readWorkspace` at the top of `resolve.test.ts` if they aren't there.)

`lib/index/languages/typescript.test.ts`, a new `describe` (Review Focus 2):

```ts
describe("computed import() (ADR-053)", () => {
    const importsOf = (text: string): string[] => parseTypeScriptFile("x.ts", text).imports;

    it("reads the literals assigned to the variable an import() is given, in source order", () => {
        const loader = [
            "export async function load(dev: boolean): Promise<unknown> {",
            "    let url: string;",
            '    if (dev) url = "./main.js";',
            '    else url = new URL("app/main.js", import.meta.url).href;',
            "    return import(url);",
            "}",
        ].join("\n");
        expect(importsOf(loader)).toEqual(["./main.js", "app/main.js"]);
    });

    it("reads a const initializer, a template without ${}, and new URL(...).toString()", () => {
        expect(importsOf("const a = `./a.js`;\nimport(a);")).toEqual(["./a.js"]);
        expect(importsOf('function f() { const u = new URL("./b.js", base).toString(); return import(u); }')).toEqual(["./b.js"]);
    });

    it("gives nothing for a parameter, a template with ${}, or a value from a call", () => {
        expect(importsOf("export function f(name: string) { return import(name); }")).toEqual([]);
        expect(importsOf("function f(lang: string) { const p = `./locales/${lang}.js`; return import(p); }")).toEqual([]);
        expect(importsOf('function f() { const p = pick("./x.js"); return import(p); }')).toEqual([]);
    });

    it("keeps a plain string import() as before", () => {
        expect(importsOf('import("./c.js");')).toEqual(["./c.js"]);
    });
});
```

`lib/index/pipeline.test.ts`, a new `describe` (it indexes on Vitest's in-memory database, as the mini-repo tests do):

```ts
describe("indexRepository on the architecture fixture", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");

    it("resolves the 31 imports of the ground truth", () => {
        const result = indexRepository(root);
        expect(result.files).toBe(21);
        const db = getDb();
        const edges = loadImportEdges(db, result.repoId).map((e) => `${e.source} -> ${e.target} (${e.specifier})`).sort();
        expect(edges).toEqual([
            "packages/core/src/index.ts -> packages/core/src/log.ts (./log)",
            "packages/ui/src/button.ts -> packages/core/src/log.ts (@arch/core/lib/log)",
            "packages/ui/src/index.ts -> packages/ui/src/button.ts (./button)",
            "src/app/legacy.ts -> src/base/common/strings.ts (../base/common/strings)",
            "src/app/loader.ts -> src/app/main.ts (./main.js)",
            "src/app/main.ts -> packages/ui/src/index.ts (@arch/ui)",
            "src/app/main.ts -> src/editor/browser/editorView.ts (../editor/browser/editorView)",
            "src/app/main.ts -> src/editor/node/editorFiles.ts (../editor/node/editorFiles)",
            "src/app/main.ts -> src/platform/node/storageFile.ts (../platform/node/storageFile)",
            "src/base/browser/dom.ts -> src/base/common/strings.ts (../common/strings)",
            "src/base/common/arrays.ts -> src/base/common/strings.ts (./strings)",
            "src/base/node/fs.ts -> src/base/common/arrays.ts (../common/arrays)",
            "src/base/test/common/strings.test.ts -> src/base/common/strings.ts (../../common/strings)",
            "src/editor/browser/editorView.ts -> src/base/browser/dom.ts (../../base/browser/dom)",
            "src/editor/browser/editorView.ts -> src/editor/common/model.ts (../common/model)",
            "src/editor/common/model.ts -> src/editor/common/tokens.ts (./tokens)",
            "src/editor/common/model.ts -> src/platform/common/storage.ts (../../platform/common/storage)",
            "src/editor/common/textModel.ts -> src/base/common/strings.ts (../../base/common/strings)",
            "src/editor/common/textModel.ts -> src/editor/common/model.ts (./model)",
            "src/editor/common/tokens.ts -> src/editor/common/textModel.ts (./textModel)",
            "src/editor/node/editorFiles.ts -> src/base/node/fs.ts (../../base/node/fs)",
            "src/editor/node/editorFiles.ts -> src/editor/common/textModel.ts (../common/textModel)",
            "src/editor/node/editorFiles.ts -> src/platform/node/storageFile.ts (../../platform/node/storageFile)",
            "src/platform/browser/storageView.ts -> src/base/browser/dom.ts (../../base/browser/dom)",
            "src/platform/common/storage.ts -> src/base/common/arrays.ts (../../base/common/arrays)",
            "src/platform/common/storage.ts -> src/platform/browser/storageView.ts (../browser/storageView)",
            "src/platform/node/storageFile.ts -> packages/core/src/index.ts (@arch/core)",
            "src/platform/node/storageFile.ts -> src/base/node/fs.ts (../../base/node/fs)",
            "src/platform/node/storageFile.ts -> src/editor/common/model.ts (../../editor/common/model)",
            "src/platform/node/storageFile.ts -> src/platform/common/storage.ts (../common/storage)",
            "tools/fixtures/legacy-ids.ts -> src/base/common/strings.ts (base/common/strings)",
        ]);
    });

    it("stores the three entry points the package.json files name", () => {
        const { repoId } = indexRepository(root);
        expect([...loadEntryPoints(getDb(), repoId)].sort()).toEqual(["packages/core/src/index.ts", "packages/ui/src/index.ts", "src/app/loader.ts"]);
    });
});
```

`lib/index/update.test.ts`, a new test:

```ts
it("re-resolves every file when a package.json changes, as for a tsconfig (ADR-053)", () => {
    expect(resolvesEverything("packages/ui/package.json")).toBe(true);
    expect(resolvesEverything("package.json")).toBe(true);
    expect(resolvesEverything("src/tsconfig.base.json")).toBe(true);
    expect(resolvesEverything("src/package-lock.json")).toBe(false);
    expect(resolvesEverything("src/app/main.ts")).toBe(false);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run lib/index`
Expected: FAIL. `manifests`, `docs`, `workspace.ts`, the resolver options, the computed literals, `loadEntryPoints` and `resolvesEverything` don't exist yet.

- [ ] **Step 4: Discovery lists manifests and docs**

In `lib/index/discover.ts`:

```ts
export type DiscoveryResult = {
    files: DiscoveredFile[];
    skipped: SkippedFile[];
    usedGit: boolean;
    /** package.json and tsconfig*.json files: what resolving bare specifiers reads (ADR-053). Sorted. */
    manifests: string[];
    /** Markdown docs under the size cap: what the docs pointers read (ADR-054). Sorted. */
    docs: DiscoveredFile[];
};

/** A package.json or a tsconfig*.json (tsconfig.json, tsconfig.base.json, …). */
export const MANIFEST = /(^|\/)(package\.json|tsconfig[^/]*\.json)$/;

/** The docs' extensions: Markdown, MDX, and Cursor's rule files. */
export const DOC_EXTENSIONS: readonly string[] = [".md", ".mdx", ".mdc"];

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
```

In `discoverFiles`, declare `const manifests: string[] = [];` and `const docs: DiscoveredFile[] = [];`. In the loop, after the `.env` check and before the extension check, add:

```ts
        if (MANIFEST.test(rel)){
            manifests.push(rel);
            continue;
        }
        if (DOC_EXTENSIONS.some((ext) => rel.toLowerCase().endsWith(ext))){
            const docSize = sizeOf(path.join(repoRoot, rel));
            if (docSize !== null && docSize <= maxBytes) docs.push({ path: rel, sizeBytes: docSize });
            continue;
        }
```

Add the helper:

```ts
function sizeOf(absolute: string): number | null {
    try{
        return fs.statSync(absolute).size;
    } catch{
        return null;
    }
}
```

Return `{ files, skipped, usedGit, manifests: manifests.sort(), docs: docs.sort(byPath) }`. (`manifests.sort()` with no comparator sorts by code unit, as `files` does.)

Add, for the incremental update:

```ts
/** The repo's package.json and tsconfig*.json files now, as discoverFiles lists them (one git call or one walk). */
export function listManifests(repoRoot: string): string[] {
    const usedGit = fs.existsSync(path.join(repoRoot, ".git"));
    const candidates = usedGit ? listWithGit(repoRoot) : listByWalking(repoRoot, []);
    return candidates.filter((rel) => MANIFEST.test(rel)).sort();
}
```

- [ ] **Step 5: `lib/index/workspace.ts`**

```ts
import fs from "fs";
import path from "path";
import ts from "typescript";
import { dirOf, joinRepoPath, normalizeSlashes } from "./paths";

/** One package of the repo's own: a package.json in the repo, outside node_modules (ADR-053). */
export type WorkspacePackage = {
    name: string;
    /** Its folder, repo-relative ("" for the root package). */
    dir: string;
    /** `exports` flattened: "." or "./sub" or "./sub/*" → the targets to try, conditions in CONDITIONS order. */
    exports: Map<string, string[]>;
    /** main, module, types, typings: those present, in that order, each with its field's name. */
    mains: { field: string; target: string }[];
    /** bin targets, in the bin names' order. */
    bins: string[];
};

/** A compiled folder and the source folder it's built from: a tsconfig that sets both outDir and rootDir. */
export type OutDirMapping = { outDir: string; rootDir: string };

export type Workspace = {
    byName: ReadonlyMap<string, WorkspacePackage>;
    /** Folders that hold a tsconfig*.json: what a module id is read against (R3). Sorted. */
    idRoots: readonly string[];
    /** Longest outDir first, so a nested one wins over its parent. */
    outDirs: readonly OutDirMapping[];
};

export const EMPTY_WORKSPACE: Workspace = { byName: new Map(), idRoots: [], outDirs: [] };

/** An exports entry's conditions, in the order tried: the source first, then what TypeScript and bundlers read. */
const CONDITIONS = ["source", "types", "typings", "import", "module", "default", "require", "node", "browser"];
/** Folders a second copy of a package's name usually comes from (Review Focus 1). */
const NOT_REAL = /(^|\/)(test|tests|__tests__|fixtures?|__fixtures__|examples?|samples?)(\/|$)/;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const depth = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);

/** The package a bare specifier names: "@scope/name" with its scope, else the first segment. */
export function packageNameOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function readWorkspace(repoRoot: string, manifests: readonly string[]): Workspace {
    const packages: WorkspacePackage[] = [];
    const idRoots = new Set<string>();
    const outDirs: OutDirMapping[] = [];

    for (const rel of manifests){
        const dir = dirOf(rel);
        if (rel === "package.json" || rel.endsWith("/package.json")){
            const pkg = readJson(path.join(repoRoot, rel));
            if (pkg && typeof pkg.name === "string" && pkg.name !== "") packages.push(toPackage(pkg, dir));
        } else{
            idRoots.add(dir);
            const mapping = readOutDir(repoRoot, rel);
            if (mapping) outDirs.push(mapping);
        }
    }

    // in preference order, so the first of each name wins: real folders, then shallower, then path order
    packages.sort((a, b) => Number(NOT_REAL.test(a.dir)) - Number(NOT_REAL.test(b.dir)) || depth(a.dir) - depth(b.dir) || compare(a.dir, b.dir));
    const byName = new Map<string, WorkspacePackage>();
    for (const p of packages) if (!byName.has(p.name)) byName.set(p.name, p);
    outDirs.sort((a, b) => b.outDir.length - a.outDir.length || compare(a.outDir, b.outDir));
    return { byName, idRoots: [...idRoots].sort(compare), outDirs };
}

type PackageJson = Record<string, unknown>;

function readJson(file: string): PackageJson | null {
    try{
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PackageJson : null;
    } catch{
        return null;   // unreadable or not JSON: not a package we can use
    }
}

function toPackage(pkg: PackageJson, dir: string): WorkspacePackage {
    const mains = ["main", "module", "types", "typings"]
        .filter((field) => typeof pkg[field] === "string" && pkg[field] !== "")
        .map((field) => ({ field, target: pkg[field] as string }));
    const bin = pkg.bin;
    const bins = typeof bin === "string" ? [bin]
        : bin !== null && typeof bin === "object" ? Object.keys(bin).sort(compare).map((k) => (bin as Record<string, unknown>)[k]).filter((v): v is string => typeof v === "string")
        : [];
    return { name: pkg.name as string, dir, exports: flattenExports(pkg.exports), mains, bins };
}

/** `exports` as subpath → targets: a string is "."'s, a map of subpaths keeps its keys, a map of conditions is "."'s. */
export function flattenExports(value: unknown): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (typeof value === "string" || Array.isArray(value)) out.set(".", targetsOf(value));
    else if (value !== null && typeof value === "object"){
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length > 0 && entries.every(([key]) => key.startsWith("."))) for (const [key, entry] of entries) out.set(key, targetsOf(entry));
        else out.set(".", targetsOf(value));
    }
    for (const [key, targets] of out) if (targets.length === 0) out.delete(key);
    return out;
}

/** One exports entry's file targets, conditions in CONDITIONS order (others after, as written), nested ones flattened. */
function targetsOf(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(targetsOf);
    if (value === null || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const rank = (condition: string): number => {
        const at = CONDITIONS.indexOf(condition);
        return at === -1 ? CONDITIONS.length : at;
    };
    return Object.keys(record).sort((a, b) => rank(a) - rank(b)).flatMap((key) => targetsOf(record[key]));
}

/** A tsconfig's own outDir and rootDir, both repo-relative, when it sets both (an extends chain isn't followed). */
function readOutDir(repoRoot: string, configRel: string): OutDirMapping | null {
    const { config, error } = ts.readConfigFile(normalizeSlashes(path.join(repoRoot, configRel)), ts.sys.readFile);
    if (error || !config) return null;
    const options = (config as { compilerOptions?: { outDir?: unknown; rootDir?: unknown } }).compilerOptions ?? {};
    const dir = dirOf(configRel);
    const outDir = typeof options.outDir === "string" ? joinRepoPath(dir, options.outDir) : null;
    const rootDir = typeof options.rootDir === "string" ? joinRepoPath(dir, options.rootDir) : null;
    return outDir !== null && rootDir !== null && outDir !== rootDir ? { outDir, rootDir } : null;
}

/** Every file a package.json names as an entry point (R8): the "." export, main, module, types, typings, bin. */
export function declaredEntries(workspace: Workspace, findSource: (base: string) => string | null): { path: string; declaredBy: string }[] {
    const declared = new Map<string, string>();
    const packages = [...workspace.byName.values()].sort((a, b) => compare(a.dir, b.dir));
    for (const pkg of packages){
        const manifest = pkg.dir === "" ? "package.json" : `${pkg.dir}/package.json`;
        const add = (field: string, target: string): void => {
            const base = joinRepoPath(pkg.dir, target);
            const file = base === null ? null : findSource(base);
            if (file !== null && !declared.has(file)) declared.set(file, `${manifest} ${field}`);
        };
        for (const target of pkg.exports.get(".") ?? []) add('exports "."', target);
        for (const main of pkg.mains) add(main.field, main.target);
        for (const target of pkg.bins) add("bin", target);
    }
    return [...declared].map(([file, declaredBy]) => ({ path: file, declaredBy })).sort((a, b) => compare(a.path, b.path));
}
```

Then make `scripts/resolution.ts` use the shared function. Delete its own `packageNameOf`, and add `import { packageNameOf } from "../lib/index/workspace";` and `export { packageNameOf };`. Its test still passes.

- [ ] **Step 6: The resolver reads the workspace**

In `lib/index/resolve.ts`:
- Move `findFile` out of `createResolver` to module level as `findFile(fileSet, base)`. It's unchanged, but takes the file set.
- Add:

```ts
import { EMPTY_WORKSPACE, packageNameOf, type Workspace, type WorkspacePackage } from "./workspace";

export type ResolverOptions = { workspace?: Workspace };

/**
 * A path as written (an import's target, a package.json's main) to the source file the repo has for it: the path
 * itself (with extensions, NodeNext .js → .ts, index files), else its compiled folder mapped to the source folder
 * (packages/core/lib/log → packages/core/src/log) through the workspace's outDir mappings (ADR-053).
 */
export function createSourceFinder(fileSet: ReadonlySet<string>, workspace: Workspace = EMPTY_WORKSPACE): (base: string) => string | null {
    return (base) => {
        const direct = findFile(fileSet, base);
        if (direct !== null) return direct;
        for (const { outDir, rootDir } of workspace.outDirs){
            if (base === outDir || base.startsWith(`${outDir}/`)) return findFile(fileSet, rootDir + base.slice(outDir.length));
        }
        return null;
    };
}

/** The paths a bare specifier can mean inside a workspace package: its exports, then its main fields or its own folders. */
function packageCandidates(workspace: Workspace, specifier: string): string[] {
    const name = packageNameOf(specifier);
    const pkg = workspace.byName.get(name);
    if (!pkg) return [];
    const sub = specifier.slice(name.length).replace(/^\//, "");
    const at = (target: string): string[] => {
        const joined = joinRepoPath(pkg.dir, target);
        return joined === null ? [] : [joined];
    };
    const key = sub === "" ? "." : `./${sub}`;
    const candidates = [...exportTargets(pkg, key).flatMap(at)];
    if (sub === "") candidates.push(...pkg.mains.flatMap((m) => at(m.target)), ...at("src/index"), ...at("index"));
    else candidates.push(...at(sub), ...at(`src/${sub}`));
    return candidates;
}

/** An exports key's targets: the exact key, else the first "*" pattern it fits, with the star filled in. */
function exportTargets(pkg: WorkspacePackage, key: string): string[] {
    const exact = pkg.exports.get(key);
    if (exact) return exact;
    for (const [pattern, targets] of pkg.exports){
        const star = pattern.indexOf("*");
        if (star === -1) continue;
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length){
            const middle = key.slice(prefix.length, key.length - suffix.length);
            return targets.map((t) => t.replace("*", middle));
        }
    }
    return [];
}
```

Change `createResolver`'s signature to `createResolver(repoRoot: string, fileSet: ReadonlySet<string>, options: ResolverOptions = {}): Resolver`. Inside it:

```ts
    const workspace = options.workspace ?? EMPTY_WORKSPACE;
    const sourceFor = createSourceFinder(fileSet, workspace);

    /** A module id read against the folders that hold a tsconfig (R3): the one file exactly one of them holds, or null. */
    const moduleId = (importer: string, specifier: string): string | null => {
        if (specifier.startsWith("@") || /^[a-z][a-z0-9+.-]*:/i.test(specifier) || !specifier.includes("/")) return null;
        let found: string | null = null;
        for (const root of workspace.idRoots){
            const base = joinRepoPath(root, specifier);
            const hit = base === null ? null : findFile(fileSet, base);
            if (hit === null || hit === importer || hit === found) continue;
            if (found !== null) return null;   // two roots hold it: not one file the id can mean
            found = hit;
        }
        return found;
    };
```

In the returned function, the bare branch becomes:

```ts
        } else{
            const config = nearestConfig(dirOf(importer));
            if (config) candidates.push(...aliasCandidates(config, specifier));
            candidates.push(...packageCandidates(workspace, specifier));
        }

        for (const base of candidates){
            const hit = sourceFor(base);
            if (hit !== null && hit !== importer) return hit;   // a file importing itself is no edge
        }

        return isRelative ? null : moduleId(importer, specifier);
```

(Relative candidates go through `sourceFor` too. It tries the path itself first, so nothing that resolved before changes.)

- [ ] **Step 7: The adapter reads a computed `import()`**

In `lib/index/languages/typescript.ts`, `collectImports`'s call branch becomes:

```ts
            if ((isDynamicImport || isRequire) && ts.isStringLiteralLike(arg)){
                found.push(arg.text);                                    // import("x") · require("x")
            } else if (isDynamicImport && ts.isIdentifier(arg)){
                found.push(...literalsAssignedTo(arg));                  // import(url): the literals url is given (ADR-053)
            }
```

and add below `collectImports`:

```ts
/**
 * The strings a variable is sure to hold when `import(variable)` reads it, in source order: its initializer and every
 * plain assignment to it inside the same function (or file). A literal, a template without ${…}, and
 * `new URL("<literal>", …)` (with .href or .toString()) count. A parameter, a template with ${…} or a call gives
 * nothing: the code doesn't name the file (Review Focus 2).
 */
function literalsAssignedTo(name: ts.Identifier): string[] {
    let scope: ts.Node = name;
    while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name.text && node.initializer){
            const text = literalOf(node.initializer);
            if (text !== null) found.push(text);
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(node.left) && node.left.text === name.text){
            const text = literalOf(node.right);
            if (text !== null) found.push(text);
        }
        ts.forEachChild(node, visit);
    };
    visit(scope);
    return found;
}

/** A string an expression is sure to hold, or null. */
function literalOf(expression: ts.Expression): string | null {
    if (ts.isParenthesizedExpression(expression)) return literalOf(expression.expression);
    if (ts.isStringLiteralLike(expression)) return expression.text;
    if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "URL"){
        const first = expression.arguments?.[0];
        return first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
    }
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === "href") return literalOf(expression.expression);
    if (ts.isCallExpression(expression) && expression.arguments.length === 0 && ts.isPropertyAccessExpression(expression.expression)
        && expression.expression.name.text === "toString"){
        return literalOf(expression.expression.expression);
    }
    return null;
}
```

`parseSourceFile` sets parent nodes (`lib/chunks.ts`), so `name.parent` is there.

- [ ] **Step 8: The `entry_points` table and its store**

In `lib/db/schema.ts`:

```ts
/** The files a package.json names as entry points (ADR-053, R8): main, module, types, bin, the "." export. */
export const entryPoints = sqliteTable("entry_points", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    declaredBy: text("declared_by").notNull()   // "packages/core/package.json main"
}, (t) => [
    uniqueIndex("entry_points_repo_path_unique").on(t.repoId, t.path)
]);
```

Run: `npx drizzle-kit generate --name v1_6_entry_points`
Expected: `lib/db/migrations/0007_v1_6_entry_points.sql` with one `CREATE TABLE` and one `CREATE UNIQUE INDEX`, and a new snapshot in `meta/`. Read the SQL before committing.

`lib/db/store/entries.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { entryPoints } from "../schema";

/** A repo's declared entry points, replaced wholesale: they're derived from its package.json files (ADR-053). */
export function replaceEntryPoints(db: Db, repoId: number, rows: readonly { path: string; declaredBy: string }[]): void {
    db.transaction((tx) => {
        tx.delete(entryPoints).where(eq(entryPoints.repoId, repoId)).run();
        forEachBatch(rows.map((r) => ({ repoId, ...r })), columnCount(entryPoints), (batch) => { tx.insert(entryPoints).values(batch).run(); });
    });
}

export function loadEntryPoints(db: Db, repoId: number): Set<string> {
    return new Set(db.select({ path: entryPoints.path }).from(entryPoints).where(eq(entryPoints.repoId, repoId)).all().map((r) => r.path));
}
```

- [ ] **Step 9: Full runs and updates use it**

In `lib/index/pipeline.ts`, in the resolve block, replace `const resolve = createResolver(root, fileSet);` with:

```ts
        const workspace = readWorkspace(root, discovered.manifests);
        const resolve = createResolver(root, fileSet, { workspace });
```

After `replaceImports(...)`, add `replaceEntryPoints(db, repoId, declaredEntries(workspace, createSourceFinder(fileSet, workspace)));`.

In `lib/index/update.ts`:
- Replace the `TSCONFIG` constant and its use with:

```ts
/** A tsconfig or a package.json decides what bare specifiers resolve to everywhere below it (ADR-053). */
const RESOLUTION_INPUT = /(^|\/)(tsconfig[^/]*|package)\.json$/;

/** Whether a changed path re-resolves every file's imports: a tsconfig or a package.json changed. */
export function resolvesEverything(changedPath: string): boolean {
    return RESOLUTION_INPUT.test(changedPath);
}
```

  `resolvedAll` becomes `fileSetChanged || paths.some(resolvesEverything)`.
- Where the resolver is built, read the workspace when everything re-resolves:

```ts
        const workspace = readWorkspace(root, listManifests(root));
        const resolve = createResolver(root, new Set(current.keys()), { workspace });
```

- After `applyEdgeChanges(...)`, when `resolvedAll`, add `replaceEntryPoints(db, repoId, declaredEntries(workspace, createSourceFinder(new Set(current.keys()), workspace)));`.

`listManifests` costs one `git ls-files` (about 0.1 s on VS Code) per update, which is affordable inside S6's 2 s. If Index Benchmark #4 shows otherwise, cache it per run of the worker.

- [ ] **Step 10: `--no-activate`, and the report reads the workspace**

In `scripts/index.ts`, accept a second argument `--no-activate`, which skips the `writeConfig(...)` that makes the repo active. The usage line becomes `usage: npm run index -- <path-to-repo> [--no-activate]`. Task 4's index of repo 2 uses it, so the owner's Map keeps showing VS Code.

In `scripts/report-resolution.ts`, build the resolver as the pipeline does:

```ts
import { discoverFiles } from "../lib/index/discover";
import { TYPESCRIPT_EXTENSIONS } from "../lib/index/languages/typescript";
import { readWorkspace } from "../lib/index/workspace";
// …
const workspace = readWorkspace(root, discoverFiles(root, { extensions: TYPESCRIPT_EXTENSIONS }).manifests);
const resolve = createResolver(root, new Set(stored.keys()), { workspace });
```

- [ ] **Step 11: Run the tests and see them pass**

Run: `npx vitest run lib/index scripts/resolution.test.ts`
Expected: PASS, the new tests included (about 26 new).

- [ ] **Step 12: Check it on VS Code: the 8 entries Eval #1's index lacked. Announce first**

Say: "Task 4 re-indexes VS Code in your database (structure only, free, about a minute). Your Map refetches once. Then it indexes repo 2 with `--no-activate`, so the Map stays on VS Code."

Run: `npm run index -- ../vscode`, and record the edge count before (from the ledger's last index run: 139,580) and after.

Then a read-only check with a scratch script under the ledger folder. It runs `reach()` for each Eval #1 list target and compares the result with `eval/truth/cl*.json`:
- CL1 `dependents` (direct) of `src/vs/workbench/contrib/search/common/search.ts` = the truth's 22 files;
- CL2 the folder `src/vs/workbench/contrib/debug`, direct = the truth's 41 (the 3 Copilot fixtures now included);
- CL3 `src/vs/editor/standalone`, direct = 3;
- CL4 transitive of `src/vs/workbench/contrib/markers/common/markers.ts` = the truth's 66 (the two loaders and `build/vite/workbench-electron.ts` now included);
- CL5 `src/vs/platform/undoRedo`, direct = 57.

Expected: each equals its truth. A file in one and not the other is read in the source and recorded in the ledger. If the rule (ADR-053) explains it, it's recorded as a difference between the index's rules and Eval #1's "refers to"; if not, it's a bug to fix here.

Then run `npm run report-resolution -- ../vscode` and record it.

- [ ] **Step 13: Repo 2 into the owner's index, then the S1 check in a scratch folder**

Run: `npm run index -- ../<repo 2> --no-activate`, then `npm run report-resolution -- ../<repo 2>`. Expected: bare specifiers that name the repo's own packages now resolve. Record the before (Task 1) and after.

S1 with the new work in it, measured cold in a scratch home (R10), three runs:
```bash
S=../nebulosity-scratch/s1 && rm -rf "$S" && mkdir -p "$S/lib/db" && cp -r lib/db/migrations "$S/lib/db/" && NEBULOSITY_HOME="$S" npx tsx scripts/index.ts ../vscode
```
Expected: the total within S1's 60 s. Index Benchmark #3 measured 58.5 s at worst, so this one matters. If a run passes 60 s, profile which step grew and stop for the owner before anything else.

- [ ] **Step 14: Docs: ADR-053, the spec, the database design, Index Benchmark #4**

ADR-053, appended to `docs/ENGINEERING_DECISIONS.md`:

```markdown
## ADR-053 — More imports resolved: workspace packages, module ids, computed import(); and the entry points a package.json names (‹today›) — amends ADR-026 and PIVOT_SPEC.md §5.2

**Context:** Eval #1's truth counted 189 files under the owner's "refers to" rule, and the index lacked 8: five Copilot test fixtures that import VS Code files by module id (`vs/workbench/contrib/debug/common/debug`), and three files reached only through two computed `import(workbenchUrl)` loaders. Every Nebulosity run trusted the index and missed them. Most monorepos (AFFiNE, Rocket.Chat, Theia, the variety repos) import across their own packages by package name (`@affine/core`, `@theia/core/lib/browser`), which the index read as outside packages. V1.6 is "works on your repo", so these are the commonest imports it can't yet follow.
**Decision:**
- **Workspace packages.** Every package.json in the repo (discovery's manifests, outside node_modules) is a package by its `name`. When two share a name, one outside test, fixture and example folders wins, then the shallower, then path order. A bare specifier that names a package resolves inside it, trying in turn:
  - its `exports` (the exact subpath, else a `*` pattern; conditions tried source, types, typings, import, module, default, require, node, browser);
  - then, with no subpath, its main, module, types, typings, `src/index` and `index`;
  - then, with a subpath, the subpath itself and `src/<subpath>`.
- **Compiled paths to sources.** A tsconfig that sets both `outDir` and `rootDir` maps its compiled folder to its source folder (`packages/core/lib/log` → `packages/core/src/log`). Every candidate tries its own path first, then the mapping.
- **Module ids** (R3). A bare specifier of two or more segments that no alias or package explains is read against each folder that holds a `tsconfig*.json`. It resolves when exactly one of them holds a file it names. Specifiers starting with `@` or naming a protocol are left out, and two or more matches resolve to nothing.
- **Computed `import()`.** For `import(variable)`, the literals the variable is given in the same function (or file) are its specifiers: an initializer or an assignment, a template without `${…}`, and `new URL("<literal>", …)`, with `.href` or `.toString()`. A parameter, a template with `${…}` or a call gives nothing.
- **Entry points** (R8). The files the packages' `"."` export, main, module, types, typings and bin name, mapped to sources, are stored in `entry_points` with the field that named them. Nothing else is called an entry point.
- A changed `package.json` re-resolves every file's imports, as a changed tsconfig does.
**Alternatives:** (a) Read `node_modules` symlinks, as Node and TypeScript do: a fresh clone has none, and installing a big repo's dependencies to index it is slow and needs a network. (b) Resolve module ids by any unique suffix in the repo: more hits, and more wrong ones in repos that vendor copies (VS Code's Copilot keeps its own `util/vs/base`). (c) Follow computed imports by data flow across functions: a type checker's job (E2), and slow.
**Consequences:**
- On VS Code the index gains ‹n› edges (‹before› → ‹after›), and Eval #1's five list truths now match it exactly (‹or: the differences, each read›).
- On ‹repo 2›, bare specifiers resolved went from ‹before› to ‹after› (report-resolution).
- S1 on VS Code, cold: ‹s› s (Index Benchmark #4).
- An edge from a module id or a computed import is stored like any other: its specifier is the literal or the id as written.
**Revisit when:** a repo's packages resolve only through a bundler's own config (webpack aliases, Vite `resolve.alias`): read those, or let the user name aliases.
```

- `docs/PIVOT_SPEC.md` §5.2, step 3, gains `- workspace packages, module ids, computed import() and compiled → source paths (ADR-053)`.
- `docs/DATABASE_DESIGN.md` gains the `entry_points` table, with its columns and its meaning.
- `docs/BENCHMARKS.md` gains "‹today› Index Benchmark #4 — the structure stage with V1.6's resolution". It holds VS Code's edges before and after, the five Eval #1 lists checked, the cold S1 runs (each step's time), and both repos' report-resolution before and after.

- [ ] **Step 15: Gate, commit, push**

Run: `npx tsc --noEmit && npm run lint && npx vitest run` (about 942/942). Then:
```bash
git add -A -- test/fixtures/arch-repo lib/index/discover.ts lib/index/discover.test.ts lib/index/workspace.ts lib/index/workspace.test.ts lib/index/resolve.ts lib/index/resolve.test.ts lib/index/languages/typescript.ts lib/index/languages/typescript.test.ts lib/index/pipeline.ts lib/index/pipeline.test.ts lib/index/update.ts lib/index/update.test.ts lib/db/schema.ts lib/db/migrations lib/db/store/entries.ts scripts/index.ts scripts/report-resolution.ts scripts/resolution.ts docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md docs/DATABASE_DESIGN.md docs/BENCHMARKS.md && git commit -m "feat(index): workspace packages, module ids and computed import() resolve; package.json entry points stored (ADR-053)" -- test/fixtures/arch-repo lib/index/discover.ts lib/index/discover.test.ts lib/index/workspace.ts lib/index/workspace.test.ts lib/index/resolve.ts lib/index/resolve.test.ts lib/index/languages/typescript.ts lib/index/languages/typescript.test.ts lib/index/pipeline.ts lib/index/pipeline.test.ts lib/index/update.ts lib/index/update.test.ts lib/db/schema.ts lib/db/migrations lib/db/store/entries.ts scripts/index.ts scripts/report-resolution.ts scripts/resolution.ts docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md docs/DATABASE_DESIGN.md docs/BENCHMARKS.md && git push origin pivot/v1
```

### Task 5: Docs pointers: which docs talk about which folders (ADR-054)

**Files:**
- Create: `lib/index/docs.ts`, `lib/index/docs.test.ts`, `lib/db/store/docs.ts`, `lib/engine/docs.ts`, `lib/engine/docs.test.ts`
- Modify: `lib/db/schema.ts`, `lib/index/pipeline.ts` (+ `pipeline.test.ts`), `lib/engine/describe.ts`, `lib/engine/overview.ts`, `lib/contracts.ts`, `lib/tools/answers.ts` (+ `answers.test.ts`)
- Generate: `lib/db/migrations/0008_v1_6_docs.sql` (+ meta)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-054), `docs/API_CONTRACTS.md` §12 and §17, `docs/DATABASE_DESIGN.md`, `docs/PIVOT_SPEC.md` §4.1 and §6.1

**Interfaces:**
- Consumes: `DiscoveryResult.docs` (Task 4).
- Produces:
  - `DocPointer` (contracts);
  - `DescribeResponse.docs?: DocPointer[]`;
  - `Overview.docs: DocPointer[]`;
  - `docsAbout(db, repoId, path)` and `docsToReadFirst(db, repoId)`;
  - the answers' "Docs about it:" and "Docs to read first:" blocks. Task 12's tool descriptions mention them.

- [ ] **Step 1: Write the failing tests**

`lib/index/docs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { docLinks, docTitle, folderSuffixes, globFolder, mentionTokens, splitFrontMatter, splitGlobs } from "./docs";

describe("splitFrontMatter (Review Focus 3)", () => {
    it("reads key: value lines between the fences, with a BOM and CRLF line endings", () => {
        const { fields, body } = splitFrontMatter("﻿---\r\napplyTo: src/vs/**\r\ndescription: x\r\n---\r\n\r\n# Title\r\n");
        expect([...fields]).toEqual([["applyTo", "src/vs/**"], ["description", "x"]]);
        expect(body).toBe("\n# Title\n");
    });

    it("leaves a file with no front matter whole", () => {
        expect(splitFrontMatter("# Just text\n")).toEqual({ fields: new Map(), body: "# Just text\n" });
    });
});

describe("docTitle", () => {
    it("is the first level-one heading, else the file's name", () => {
        expect(docTitle("docs/architecture.md", "intro\n\n# Architecture\n\n## Layers\n")).toBe("Architecture");
        expect(docTitle("docs/notes.mdx", "## only a second-level heading\n")).toBe("notes");
    });
});

describe("splitGlobs, on VS Code's own applyTo lines", () => {
    it("reads plain, quoted and comma-separated values", () => {
        expect(splitGlobs("src/vs/**")).toEqual(["src/vs/**"]);
        expect(splitGlobs("'src/vs/platform/agentHost/**'")).toEqual(["src/vs/platform/agentHost/**"]);
        expect(splitGlobs('"src/vs/**/*Tool.ts,src/vs/**/*Tools.ts"')).toEqual(["src/vs/**/*Tool.ts", "src/vs/**/*Tools.ts"]);
        expect(splitGlobs("'**'")).toEqual(["**"]);
    });

    it("opens a value that is one brace group, and keeps braces inside a glob whole", () => {
        expect(splitGlobs('"{src/vs/**/test/**,src/vs/**/*.test.ts,src/vs/**/*.integrationTest.ts}"'))
            .toEqual(["src/vs/**/test/**", "src/vs/**/*.test.ts", "src/vs/**/*.integrationTest.ts"]);
        expect(splitGlobs("'build/azure-pipelines/{oss/**,common/downloadNotice.ts,{win32,linux,darwin}/steps/product-build-*-compile.yml}'"))
            .toEqual(["build/azure-pipelines/{oss/**,common/downloadNotice.ts,{win32,linux,darwin}/steps/product-build-*-compile.yml}"]);
    });

    it("reads a YAML list", () => {
        expect(splitGlobs('["src/**", "test/**"]')).toEqual(["src/**", "test/**"]);
    });
});

describe("globFolder", () => {
    it("is the folder before the first wildcard or brace", () => {
        expect(globFolder("src/vs/**")).toBe("src/vs");
        expect(globFolder("src/vs/**/*.css")).toBe("src/vs");
        expect(globFolder("build/azure-pipelines/{oss/**,common/downloadNotice.ts}")).toBe("build/azure-pipelines");
        expect(globFolder("**")).toBe("");
    });

    it("names a file's folder when the glob is one file", () => {
        expect(globFolder("cli/ThirdPartyNotices.txt")).toBe("cli");
        expect(globFolder("cglicenses.json")).toBe("");
    });
});

describe("mentionTokens", () => {
    it("finds paths of two or more segments, without URL parts, globs' tails or trailing punctuation", () => {
        expect(mentionTokens("See `src/app`, then src/editor/common. Docs: https://github.com/a/b and ./packages/ui/ or src/vs/**/x.ts."))
            .toEqual(["src/app", "src/editor/common", "packages/ui", "src/vs"]);
    });

    it("drops a word with one segment and a path cut down to one", () => {
        expect(mentionTokens("main.ts, src/**/x.ts and and/or")).toEqual(["and/or"]);
    });
});

describe("folderSuffixes", () => {
    it("maps each tail of two or more segments to its folder, or to null when two folders share it", () => {
        const suffixes = folderSuffixes(["src/editor/browser", "src/base/browser", "x/editor/common", "y/editor/common"]);
        expect(suffixes.get("editor/browser")).toBe("src/editor/browser");
        expect(suffixes.get("editor/common")).toBeNull();
        expect(suffixes.has("browser")).toBe(false);
    });
});

describe("docLinks on the architecture fixture's docs", () => {
    const folders = ["", "packages", "packages/core", "packages/core/src", "packages/ui", "packages/ui/src", "src", "src/app", "src/base",
        "src/base/browser", "src/base/common", "src/base/node", "src/base/test", "src/base/test/common", "src/editor", "src/editor/browser",
        "src/editor/common", "src/editor/node", "src/platform", "src/platform/browser", "src/platform/common", "src/platform/node", "tools", "tools/fixtures"];
    const known = { folders: new Set(folders), files: new Set(["src/app/loader.ts", "src/app/main.ts"]), suffixes: folderSuffixes(folders) };

    it("links an instructions file to the folder its applyTo names", () => {
        const text = "---\napplyTo: src/editor/**\n---\n\n# Editor rules\n\nThe editor never imports the app.\n";
        expect(docLinks(".github/instructions/editor.instructions.md", text, known)).toEqual({
            facts: { path: ".github/instructions/editor.instructions.md", title: "Editor rules" },
            links: [{ docPath: ".github/instructions/editor.instructions.md", targetPath: "src/editor", kind: "applies", count: 1, detail: "src/editor/**" }],
        });
    });

    it("links a README to its own folder and counts the paths a doc mentions", () => {
        const text = "# The app\n\nStart at `src/app/loader.ts`, which loads `main.ts`.\n";
        expect(docLinks("src/app/README.md", text, known).links).toEqual([
            { docPath: "src/app/README.md", targetPath: "src/app", kind: "readme", count: 1, detail: null },
            { docPath: "src/app/README.md", targetPath: "src/app/loader.ts", kind: "mentions", count: 1, detail: null },
        ]);
    });

    it("counts each mention, and matches a folder by a tail only one folder has", () => {
        const text = "# Architecture\n\nThe layers are `src/base`, `src/platform`, `src/editor` and `src/app`, each using only the ones before it.\n"
            + "Code in `src/platform` must not import `src/editor`.\n\n"
            + "Environment folders: `common`, `browser` and `node`. The text model lives in `src/editor/common`, and views in `editor/browser`.\n";
        expect(docLinks("docs/architecture.md", text, known).links).toEqual([
            { docPath: "docs/architecture.md", targetPath: "src/app", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/base", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/editor", kind: "mentions", count: 2, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/editor/browser", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/editor/common", kind: "mentions", count: 1, detail: null },
            { docPath: "docs/architecture.md", targetPath: "src/platform", kind: "mentions", count: 2, detail: null },
        ]);
    });
});
```

`lib/engine/docs.test.ts` (indexes the fixture on the in-memory database):

```ts
import path from "path";
import { describe as group, expect, it } from "vitest";
import { describe } from "./describe";
import { overview } from "./overview";
import { indexRepository } from "../index/pipeline";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
indexRepository(root);

group("docs in describe (ADR-054)", () => {
    it("lists the docs linked to a folder or the folders above it, applies first", () => {
        expect(describe(root, "src/editor/common").docs).toEqual([
            { path: ".github/instructions/editor.instructions.md", title: "Editor rules", reason: { kind: "applies", target: "src/editor", detail: "src/editor/**", count: 1 } },
            { path: "docs/architecture.md", title: "Architecture", reason: { kind: "mentions", target: "src/editor/common", count: 1 } },
        ]);
    });

    it("puts a folder's own README first, and a doc named for architecture before an equal one", () => {
        expect(describe(root, "src/app").docs?.map((d) => d.path)).toEqual(["src/app/README.md", "docs/architecture.md", "README.md"]);
    });

    it("shows each doc by its strongest link: the folder's README before the doc's mention of the file", () => {
        expect(describe(root, "src/app/loader.ts").docs?.[0]).toEqual(
            { path: "src/app/README.md", title: "The app", reason: { kind: "readme", target: "src/app", count: 1 } });
    });

    it("leaves docs out where none is linked", () => {
        expect(describe(root, "tools").docs).toBeUndefined();
    });
});

group("docs to read first, in overview", () => {
    it("the root README, then docs named for architecture, then docs that apply to folders", () => {
        expect(overview(root).docs).toEqual([
            { path: "README.md", title: "arch-repo" },
            { path: "docs/architecture.md", title: "Architecture" },
            { path: ".github/instructions/editor.instructions.md", title: "Editor rules", reason: { kind: "applies", target: "src/editor", detail: "src/editor/**", count: 1 } },
        ]);
    });
});
```

`lib/tools/answers.test.ts`, two new tests (with hand-built answers):

```ts
it("describe shows the docs about a folder after its summary line (ADR-054)", () => {
    const text = answerText(describeAnswer({
        repo: "/r", path: "src/editor/common", kind: "folder", summaryStatus: "off", stats: { fileCount: 3, lineCount: 22 },
        children: [], uses: [], usedBy: [], stalePaths: 0, indexVersion: 1,
        docs: [
            { path: ".github/instructions/editor.instructions.md", title: "Editor rules", reason: { kind: "applies", target: "src/editor", detail: "src/editor/**", count: 1 } },
            { path: "docs/architecture.md", title: "Architecture", reason: { kind: "mentions", target: "src/editor/common", count: 1 } },
            { path: "docs/more.md", title: "More", reason: { kind: "mentions", target: "src/editor", count: 2 } },
        ],
    }, "r"));
    expect(text.split("\n").slice(2, 6)).toEqual([
        "Docs about it:",
        "  .github/instructions/editor.instructions.md — Editor rules (applies to src/editor/**)",
        "  docs/architecture.md — Architecture (mentions src/editor/common/)",
        "  docs/more.md — More (mentions src/editor/ (2 times))",
    ]);
});

it("describe of a file writes the file's own path without a slash, and a folder README as this folder's or another's", () => {
    const lines = answerText(describeAnswer({
        repo: "/r", path: "src/app/loader.ts", kind: "file", summaryStatus: "off", stats: { fileCount: 1, lineCount: 6 },
        symbols: [], uses: [], usedBy: [], stalePaths: 0, indexVersion: 1,
        docs: [
            { path: "src/app/README.md", title: "The app", reason: { kind: "readme", target: "src/app", count: 1 } },
            { path: "notes.md", title: "Notes", reason: { kind: "mentions", target: "src/app/loader.ts", count: 1 } },
        ],
    }, "r")).split("\n");
    expect(lines.slice(2, 5)).toEqual([
        "Docs about it:",
        "  src/app/README.md — The app (README of src/app/)",
        "  notes.md — Notes (mentions src/app/loader.ts)",
    ]);
});
```

`lib/index/pipeline.test.ts`, in the arch-repo `describe`:

```ts
it("stores the 4 docs with their titles and the 13 links of the ground truth", () => {
    const { repoId } = indexRepository(root);
    const db = getDb();
    expect(loadDocs(db, repoId)).toEqual([
        { path: ".github/instructions/editor.instructions.md", title: "Editor rules" },
        { path: "README.md", title: "arch-repo" },
        { path: "docs/architecture.md", title: "Architecture" },
        { path: "src/app/README.md", title: "The app" },
    ]);
    expect(loadAllDocLinks(db, repoId).map((l) => `${l.docPath} ${l.targetPath || "(root)"} ${l.kind} ${l.count}`)).toEqual([
        ".github/instructions/editor.instructions.md src/editor applies 1",
        "README.md (root) readme 1",
        "README.md packages/core mentions 1",
        "README.md packages/ui mentions 1",
        "README.md src/app mentions 1",
        "docs/architecture.md src/app mentions 1",
        "docs/architecture.md src/base mentions 1",
        "docs/architecture.md src/editor mentions 2",
        "docs/architecture.md src/editor/browser mentions 1",
        "docs/architecture.md src/editor/common mentions 1",
        "docs/architecture.md src/platform mentions 2",
        "src/app/README.md src/app readme 1",
        "src/app/README.md src/app/loader.ts mentions 1",
    ]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/index/docs.test.ts lib/engine/docs.test.ts lib/tools/answers.test.ts lib/index/pipeline.test.ts`
Expected: FAIL, the modules and fields don't exist.

- [ ] **Step 3: `lib/index/docs.ts`**

```ts
/**
 * Which docs talk about which folders (ADR-054), read from the repo's Markdown at index time, with no model: an
 * instructions file's applyTo (or a Cursor rule's globs), a folder's own README, and the folder and file paths a doc
 * mentions. describe and overview point at these, so a reader (or Claude Code) finds the repo's own rules.
 */
import { dirOf } from "./paths";

export type DocFacts = { path: string; title: string };
export type DocLinkKind = "applies" | "readme" | "mentions";
export type DocLinkRow = { docPath: string; targetPath: string; kind: DocLinkKind; count: number; detail: string | null };
/** What a mention can name: the index's folders and files, and folder tails one folder alone ends with. */
export type KnownPaths = { folders: ReadonlySet<string>; files: ReadonlySet<string>; suffixes: ReadonlyMap<string, string | null> };

const README = /^readme\.mdx?$/i;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The lines between a first line "---" and the next "---" as key → value (one-line YAML), and the text after them. */
export function splitFrontMatter(text: string): { fields: Map<string, string>; body: string } {
    const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const fields = new Map<string, string>();
    if (!clean.startsWith("---\n")) return { fields, body: clean };
    const end = clean.indexOf("\n---", 3);
    if (end === -1) return { fields, body: clean };
    for (const line of clean.slice(4, end).split("\n")){
        const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (m) fields.set(m[1], m[2].trim());
    }
    const after = clean.indexOf("\n", end + 4);
    return { fields, body: after === -1 ? "" : clean.slice(after + 1) };
}

/** The first level-one heading, else the file's name without its extension. */
export function docTitle(docPath: string, body: string): string {
    const m = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body);
    if (m) return m[1].trim();
    return docPath.slice(docPath.lastIndexOf("/") + 1).replace(/\.(md|mdx|mdc)$/i, "");
}

const unquote = (s: string): string => {
    const t = s.trim();
    return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1).trim() : t;
};

/** Whether a "{…}" value is one brace group from its first character to its last. */
function oneGroup(s: string): boolean {
    let depth = 0;
    for (let i = 0; i < s.length; i++){
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) return i === s.length - 1;
    }
    return false;
}

/** An applyTo or globs value as globs: quotes off, a YAML list opened, commas outside braces split, one whole brace group opened. */
export function splitGlobs(value: string): string[] {
    let v = unquote(value);
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < v.length; i++){
        if (v[i] === "{") depth++;
        else if (v[i] === "}") depth = Math.max(0, depth - 1);
        else if (v[i] === "," && depth === 0){
            parts.push(v.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(v.slice(start));
    return parts.map(unquote).filter((p) => p !== "").flatMap((p) => (p.startsWith("{") && oneGroup(p) ? splitGlobs(p.slice(1, -1)) : [p]));
}

/** The folder a glob is about: the segments before the first one with a wildcard or a brace; a glob that is one file names its folder. */
export function globFolder(glob: string): string {
    const segments = glob.replace(/^\.\//, "").split("/");
    const literal: string[] = [];
    for (const s of segments){
        if (/[*?[{]/.test(s)) break;
        literal.push(s);
    }
    if (literal.length === segments.length && /\.[A-Za-z0-9]+$/.test(literal[literal.length - 1] ?? "")) literal.pop();
    return literal.join("/");
}

/** Path-like words of two or more segments: not part of a URL, cut before a wildcard segment, trailing punctuation off. */
export function mentionTokens(body: string): string[] {
    const tokens: string[] = [];
    for (const m of body.matchAll(/[A-Za-z0-9_@.*-]+(?:\/[A-Za-z0-9_@.*-]+)+\/?/g)){
        const start = m.index ?? 0;
        if (start > 0 && /[:/]/.test(body[start - 1])) continue;   // inside https://… or a longer path
        const kept: string[] = [];
        for (const s of m[0].replace(/\/+$/, "").split("/")){
            if (s.includes("*")) break;
            kept.push(s);
        }
        const token = kept.join("/").replace(/^\.\//, "").replace(/[.,;:]+$/, "");
        if (token.includes("/")) tokens.push(token);
    }
    return tokens;
}

/** Every folder's tails of two or more segments ("editor/browser" for "src/editor/browser"), to its folder, or null when shared. */
export function folderSuffixes(folders: Iterable<string>): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const folder of folders){
        const segments = folder.split("/");
        for (let i = 1; i <= segments.length - 2; i++){
            const tail = segments.slice(i).join("/");
            out.set(tail, out.has(tail) && out.get(tail) !== folder ? null : folder);
        }
    }
    return out;
}

/** One doc's title and links: its applyTo/globs folders, its own folder when it's a README, and every path it mentions. */
export function docLinks(docPath: string, text: string, known: KnownPaths): { facts: DocFacts; links: DocLinkRow[] } {
    const { fields, body } = splitFrontMatter(text);
    const links: DocLinkRow[] = [];
    const folder = dirOf(docPath);

    if (README.test(docPath.slice(docPath.lastIndexOf("/") + 1)) && (folder === "" || known.folders.has(folder))){
        links.push({ docPath, targetPath: folder, kind: "readme", count: 1, detail: null });
    }
    for (const key of ["applyTo", "globs"]){
        const value = fields.get(key);
        if (!value) continue;
        for (const glob of splitGlobs(value)){
            const target = globFolder(glob);
            if (target !== "" && !known.folders.has(target)) continue;
            if (!links.some((l) => l.kind === "applies" && l.targetPath === target)) links.push({ docPath, targetPath: target, kind: "applies", count: 1, detail: glob });
        }
    }
    const counts = new Map<string, number>();
    for (const token of mentionTokens(body)){
        const target = known.folders.has(token) || known.files.has(token) ? token : known.suffixes.get(token) ?? null;
        if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    for (const [targetPath, count] of counts) links.push({ docPath, targetPath, kind: "mentions", count, detail: null });

    links.sort((a, b) => compare(a.targetPath, b.targetPath) || compare(a.kind, b.kind));
    return { facts: { path: docPath, title: docTitle(docPath, body) }, links };
}
```

- [ ] **Step 4: The tables and their store**

In `lib/db/schema.ts`:

```ts
/** The repo's Markdown docs (ADR-054): their titles. */
export const docs = sqliteTable("docs", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    title: text("title").notNull()
}, (t) => [
    uniqueIndex("docs_repo_path_unique").on(t.repoId, t.path)
]);

export const DOC_LINK_KINDS = ["applies", "readme", "mentions"] as const;

/** Which doc talks about which folder or file, and how (ADR-054); "" is the repo itself. */
export const docLinks = sqliteTable("doc_links", {
    id: integer().primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    docPath: text("doc_path").notNull(),
    targetPath: text("target_path").notNull(),
    kind: text("kind", { enum: DOC_LINK_KINDS }).notNull(),
    count: integer("count").notNull(),
    detail: text("detail")   // the glob, for "applies"
}, (t) => [
    index("doc_links_repo_target_idx").on(t.repoId, t.targetPath)
]);
```

Run: `npx drizzle-kit generate --name v1_6_docs` and read the SQL (two tables, two indexes).

`lib/db/store/docs.ts`:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { columnCount, forEachBatch } from "../batch";
import { docLinks, docs } from "../schema";
import type { DocFacts, DocLinkRow } from "../../index/docs";

/** A repo's docs and their links, replaced wholesale on each full run (ADR-054, R7). */
export function replaceDocs(db: Db, repoId: number, facts: readonly DocFacts[], links: readonly DocLinkRow[]): void {
    db.transaction((tx) => {
        tx.delete(docs).where(eq(docs.repoId, repoId)).run();
        tx.delete(docLinks).where(eq(docLinks.repoId, repoId)).run();
        forEachBatch(facts.map((f) => ({ repoId, ...f })), columnCount(docs), (batch) => { tx.insert(docs).values(batch).run(); });
        forEachBatch(links.map((l) => ({ repoId, ...l })), columnCount(docLinks), (batch) => { tx.insert(docLinks).values(batch).run(); });
    });
}

export function loadDocs(db: Db, repoId: number): { path: string; title: string }[] {
    return db.select({ path: docs.path, title: docs.title }).from(docs).where(eq(docs.repoId, repoId)).orderBy(asc(docs.path)).all();
}

const linkColumns = { docPath: docLinks.docPath, targetPath: docLinks.targetPath, kind: docLinks.kind, count: docLinks.count, detail: docLinks.detail };

/** The links to these places: a path and its folders above it, a handful of values. */
export function loadDocLinksTo(db: Db, repoId: number, targets: readonly string[]): DocLinkRow[] {
    if (targets.length === 0) return [];
    return db.select(linkColumns).from(docLinks).where(and(eq(docLinks.repoId, repoId), inArray(docLinks.targetPath, [...targets]))).all();
}

/** Every link of the repo, by doc and then target: overview's ranking needs them all (VS Code: a few thousand rows). */
export function loadAllDocLinks(db: Db, repoId: number): DocLinkRow[] {
    return db.select(linkColumns).from(docLinks).where(eq(docLinks.repoId, repoId))
        .orderBy(asc(docLinks.docPath), asc(docLinks.targetPath), asc(docLinks.kind)).all();
}
```

- [ ] **Step 5: Full runs read the docs**

In `lib/index/pipeline.ts`, after `replaceAggregates(...)` and `pruneSummaries(...)`, inside the aggregate block's timing:

```ts
        // which docs talk about which folders (ADR-054): read with the folders just built, so a mention can name any of them
        const folderPaths = folderRows.map((f) => f.path);
        const known: KnownPaths = { folders: new Set(folderPaths), files: fileSet, suffixes: folderSuffixes(folderPaths) };
        const readDocs = discovered.docs.flatMap((doc) => {
            try{
                return [docLinks(doc.path, fs.readFileSync(path.join(root, doc.path), "utf8"), known)];
            } catch{
                return [];   // unreadable: left out, as an unreadable source file is
            }
        });
        replaceDocs(db, repoId, readDocs.map((d) => d.facts), readDocs.flatMap((d) => d.links));
```

The incremental update (`update.ts`) leaves docs alone (R7).

- [ ] **Step 6: The engine's docs**

`lib/contracts.ts`, beside `DescribeResponse`:

```ts
/** A doc linked to a place (ADR-054), and why. describe always says why; overview says it for a doc that applies to a folder. */
export type DocPointer = {
    path: string;
    title: string;
    reason?: { kind: "applies" | "readme" | "mentions"; target: string; detail?: string; count: number };
};
```

and in `DescribeResponse`, after `summaryError`:

```ts
  /** For a folder or file, the docs linked to it or the folders above it; for the repo, the docs to read first (ADR-054). Left out when none. */
  docs?: DocPointer[];
```

`lib/engine/docs.ts`:

```ts
import type { DocPointer } from "../contracts";
import type { Db } from "../db/client";
import { loadAllDocLinks, loadDocLinksTo, loadDocs } from "../db/store/docs";
import type { DocLinkKind, DocLinkRow } from "../index/docs";
import { dirOf } from "../index/paths";

/** A doc whose name holds one of these is about how the code is organized. */
export const ARCHITECTURE_WORDS = ["architecture", "design", "overview", "organization", "organisation", "structure", "contributing",
    "agents", "claude", "copilot-instructions", "conventions", "layers"];
/** How many docs an answer names. */
export const DOCS_SHOWN = 5;

const KIND_RANK: Record<DocLinkKind, number> = { applies: 3, readme: 2, mentions: 1 };
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const depth = (p: string): number => (p === "" ? 0 : p.split("/").length);
/** An applies glob that is one folder and everything under it ("src/vs/**"), not a file pattern. */
const plainGlob = (l: DocLinkRow): number => (l.kind === "applies" && /^[^*?[{]*\/\*\*$/.test(l.detail ?? "") ? 1 : 0);

export function hasArchitectureWord(docPath: string): boolean {
    const name = docPath.slice(docPath.lastIndexOf("/") + 1).toLowerCase().replace(/\.(md|mdx|mdc)$/, "");
    return ARCHITECTURE_WORDS.some((word) => name.includes(word));
}

/** A path and its folders above it, the root left out: "src/app/loader.ts" → src/app/loader.ts, src/app, src. */
export function selfAndAncestors(targetPath: string): string[] {
    const out: string[] = [];
    for (let p = targetPath; p !== ""; p = dirOf(p)) out.push(p);
    return out;
}

/** Compares number tuples, largest first. */
const byKeyDesc = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
};

const pointer = (l: DocLinkRow, title: string): DocPointer => ({
    path: l.docPath, title,
    reason: { kind: l.kind, target: l.targetPath, ...(l.detail !== null ? { detail: l.detail } : {}), count: l.count },
});

/**
 * The docs about a place (ADR-054): links to it or its folders above it (not the root), each doc shown by its strongest
 * link, ranked by kind (applies, readme, mentions), deeper target, plain-folder glob, a name about architecture, count, path.
 */
export function rankDocsAbout(links: readonly DocLinkRow[], titles: ReadonlyMap<string, string>, limit = DOCS_SHOWN): DocPointer[] {
    const linkKey = (l: DocLinkRow): number[] => [KIND_RANK[l.kind], depth(l.targetPath), plainGlob(l), l.count];
    const best = new Map<string, DocLinkRow>();
    for (const l of links){
        const held = best.get(l.docPath);
        if (!held || byKeyDesc(linkKey(l), linkKey(held)) < 0) best.set(l.docPath, l);
    }
    const docKey = (l: DocLinkRow): number[] => [KIND_RANK[l.kind], depth(l.targetPath), plainGlob(l), Number(hasArchitectureWord(l.docPath)), l.count];
    return [...best.values()]
        .sort((a, b) => byKeyDesc(docKey(a), docKey(b)) || compare(a.docPath, b.docPath))
        .slice(0, limit)
        .map((l) => pointer(l, titles.get(l.docPath) ?? l.docPath));
}

/**
 * The docs to read first about the whole repo (ADR-054): the root README; docs named for architecture (shallower first,
 * then more places mentioned, then path); docs that apply to a folder (the shallowest folder, a plain-folder glob, path).
 */
export function rankDocsToReadFirst(docs: readonly { path: string; title: string }[], links: readonly DocLinkRow[], limit = DOCS_SHOWN): DocPointer[] {
    const out: DocPointer[] = [];
    const add = (p: DocPointer): void => {
        if (out.length < limit && !out.some((o) => o.path === p.path)) out.push(p);
    };
    const mentioned = new Map<string, number>();
    for (const l of links) if (l.kind === "mentions") mentioned.set(l.docPath, (mentioned.get(l.docPath) ?? 0) + 1);

    const readme = docs.find((d) => /^readme\.mdx?$/i.test(d.path));
    if (readme) add({ path: readme.path, title: readme.title });
    docs.filter((d) => hasArchitectureWord(d.path))
        .sort((a, b) => depth(a.path) - depth(b.path) || (mentioned.get(b.path) ?? 0) - (mentioned.get(a.path) ?? 0) || compare(a.path, b.path))
        .forEach((d) => add({ path: d.path, title: d.title }));
    const titles = new Map(docs.map((d) => [d.path, d.title]));
    links.filter((l) => l.kind === "applies")
        .sort((a, b) => depth(a.targetPath) - depth(b.targetPath) || plainGlob(b) - plainGlob(a) || compare(a.docPath, b.docPath))
        .forEach((l) => add(pointer(l, titles.get(l.docPath) ?? l.docPath)));
    return out;
}

export function docsAbout(db: Db, repoId: number, targetPath: string): DocPointer[] {
    const links = loadDocLinksTo(db, repoId, selfAndAncestors(targetPath));
    if (links.length === 0) return [];
    return rankDocsAbout(links, new Map(loadDocs(db, repoId).map((d) => [d.path, d.title])));
}

export function docsToReadFirst(db: Db, repoId: number): DocPointer[] {
    return rankDocsToReadFirst(loadDocs(db, repoId), loadAllDocLinks(db, repoId));
}
```

In `lib/engine/describe.ts`'s `describeUncached`, before the `return`:

```ts
    const docs = kind === "repo" ? docsToReadFirst(db, repoId) : docsAbout(db, repoId, targetPath);
```

and in the returned object, after the summary fields: `...(docs.length > 0 ? { docs } : {}),`.

In `lib/engine/overview.ts`, add to `Overview` the field `/** The docs to read first (ADR-054). */ docs: DocPointer[];`, and set it in `overview()` with `docs: root.docs ?? [],`.

- [ ] **Step 7: The answers say so**

In `lib/tools/answers.ts`:

```ts
/** "Docs about it:" or "Docs to read first:": one line per doc, its path, its title, and why (ADR-054). */
function docLines(header: string, docs: readonly DocPointer[] | undefined, here: { path: string; kind: "repo" | "folder" | "file" }): string[] {
    if (!docs || docs.length === 0) return [];
    const why = (r: NonNullable<DocPointer["reason"]>): string => {
        if (r.kind === "applies") return `applies to ${r.detail ?? `${r.target}/`}`;
        if (r.kind === "readme") return r.target === here.path ? "this folder's README" : r.target === "" ? "the repo's README" : `README of ${r.target}/`;
        const shown = r.target === here.path && here.kind === "file" ? r.target : `${r.target}/`;
        return `mentions ${shown}${r.count > 1 ? ` (${r.count} times)` : ""}`;
    };
    return [header, ...docs.map((d) => `  ${d.path} — ${d.title}${d.reason ? ` (${why(d.reason)})` : ""}`)];
}
```

In `describeAnswer`, right after the `summaryLine(d)` element, push `...docLines(d.kind === "repo" ? "Docs to read first:" : "Docs about it:", d.docs, { path: d.path, kind: d.kind })`. In `overviewAnswer`, after `summaryLine(o)`, push `...docLines("Docs to read first:", o.docs, { path: "", kind: "repo" })`. Import `DocPointer` from `../contracts`.

- [ ] **Step 8: Run the tests and see them pass**

Run: `npx vitest run lib`
Expected: PASS, about 20 new. Existing answer tests whose fixtures carry no `docs` are unchanged.

- [ ] **Step 9: Check VS Code**

Announce first: "This re-indexes VS Code and repo 2 (structure, free) so their docs are read." Run `npm run index -- ../<repo 2> --no-activate`, then `npm run index -- ../vscode`. Then, read-only, check:
- `describe(src/vs/workbench)`'s docs lead with `.github/instructions/source-code-organization.instructions.md` (applies to `src/vs/**`; its name holds "organization");
- `overview`'s docs start with `README.md`.

Record both lists in the ledger, along with how long the docs pass added to the aggregate step.

- [ ] **Step 10: Docs: ADR-054, the contracts, the database, the spec**

```markdown
## ADR-054 — Docs pointers: which docs talk about which folders, read from the repo's Markdown (‹today›)

**Context:** In Eval #1, big-picture scores followed whether a run read VS Code's `.github/instructions/source-code-organization.instructions.md`. The five runs that read it scored 0.88–1.00 on BP2 and BP4; the seven that didn't scored 0.44–0.83. Both U runs on BP4 called `describe` on `src/vs/workbench`, got its layout and counts, and never found the file, whose front matter says `applyTo: src/vs/**`. Nebulosity's summaries say what a folder holds, not its rules. The rules are often already written down, in a README, an architecture doc, or instructions for agents.
**Decision:**
- Each full run reads the repo's `.md`, `.mdx` and `.mdc` files under the size cap. It stores each doc's title (its first level-one heading, else its name) and its links:
  - **applies:** an `applyTo` (Copilot instructions) or `globs` (Cursor rules) glob's folder, read from the front matter. Quotes, comma lists, YAML lists and one whole brace group are opened.
  - **readme:** a README's own folder.
  - **mentions:** each path of two or more segments the text names: an indexed folder or file, or a folder tail only one folder ends with.
- `describe` names up to 5 docs linked to the place or its folders above it (the root left out). Each doc is shown by its strongest link, ranked by kind, deeper target, plain-folder glob, a name about architecture, count, then path.
- `describe` of the repo and `overview` name up to 5 docs to read first: the root README, then docs named for architecture, then docs that apply to folders.
- No model is involved, so it all works in free mode.
- Docs refresh with full runs only (R7): the worker's warm full run at start redoes them.
**Alternatives:** (a) Summaries that state rules: a model reading every folder's code still can't see a rule the code breaks, and it costs money. (b) Search over doc text: the agent has to think of searching; a pointer in `describe` comes with the answer it already asked for. (c) Inline the doc in the answer: thousands of tokens per call, and the agent can Read the file itself.
**Consequences:** `DescribeResponse` gains `docs` (API_CONTRACTS.md §12, additive). The static demo's describe bundles carry it, and the Map's panel ignores it for now. On VS Code, `describe(src/vs/workbench)` now leads with ‹the doc›, and the docs pass adds ‹ms› to a full run.
**Revisit when:** a doc's links should refresh while the Map runs (route Markdown changes through the worker), or docs outside Markdown matter (`.txt`, wiki pages, docstrings).
```

- `API_CONTRACTS.md` §12: describe the `docs` field and `DocPointer`. In §17, the `describe` and `overview` rows each gain "and the docs about it (up to 5)" and "and the docs to read first (up to 5)".
- `DATABASE_DESIGN.md`: the `docs` and `doc_links` tables.
- `PIVOT_SPEC.md` §4.1's table gains both tables, and §6.1's `describe` bullet gains "and the docs about it (ADR-054)".

- [ ] **Step 11: Gate, commit, push**

Run the gate (about 962/962). Then:
```bash
git add -A -- lib/index/docs.ts lib/index/docs.test.ts lib/db/store/docs.ts lib/engine/docs.ts lib/engine/docs.test.ts lib/db/schema.ts lib/db/migrations lib/index/pipeline.ts lib/index/pipeline.test.ts lib/engine/describe.ts lib/engine/overview.ts lib/contracts.ts lib/tools/answers.ts lib/tools/answers.test.ts docs/ENGINEERING_DECISIONS.md docs/API_CONTRACTS.md docs/DATABASE_DESIGN.md docs/PIVOT_SPEC.md && git commit -m "feat(engine): docs pointers, which docs talk about which folders, in describe and overview (ADR-054)" -- lib/index/docs.ts lib/index/docs.test.ts lib/db/store/docs.ts lib/engine/docs.ts lib/engine/docs.test.ts lib/db/schema.ts lib/db/migrations lib/index/pipeline.ts lib/index/pipeline.test.ts lib/engine/describe.ts lib/engine/overview.ts lib/contracts.ts lib/tools/answers.ts lib/tools/answers.test.ts docs/ENGINEERING_DECISIONS.md docs/API_CONTRACTS.md docs/DATABASE_DESIGN.md docs/PIVOT_SPEC.md && git push origin pivot/v1
```

### Task 6: Impact, and `within` (ADR-045 amended; ADR-055's first half)

**Files:**
- Create: `lib/engine/impact.ts`, `lib/engine/impact.test.ts`
- Modify: `lib/engine/reach.ts` (+ `reach.test.ts`), `lib/tools/answers.ts` (+ `answers.test.ts`)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-045 amended)

**Interfaces:**
- Consumes: `loadEntryPoints` (Task 4).
- Produces:
  - `reach(repoRoot, path, direction, { within? })` and `ReachAnswer.within?`;
  - `impact(repoRoot, path, direction, { groupBy, within? }): Impact`;
  - `areasOf`, `rootsAmong`, `inDegreeIn`;
  - `reachHeader(a)`, `reachAnswer(a, page, after?)`, `rootLines(tests, roots)` and `impactAnswer(i)`.
  - Task 12's `imports` tool calls these.

- [ ] **Step 1: Write the failing tests**

`lib/engine/reach.test.ts`, a new `describe` on the arch-repo fixture (indexed on the in-memory database at the top of the `describe`, as `docs.test.ts` does):

```ts
describe("reach within a folder (ADR-045, amended)", () => {
    const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
    indexRepository(root);

    it("keeps only the files inside the folder, and counts them alone", () => {
        const answer = reach(root, "src/editor", "dependents", { within: "src/platform" });
        expect(answer.reached).toEqual([{ path: "src/platform/node/storageFile.ts", distance: 1 }]);
        expect(answer.direct).toBe(1);
        expect(answer.within).toBe("src/platform");
    });

    it("refuses a file as the folder", () => {
        expect(() => reach(root, "src/editor", "dependents", { within: "src/app/main.ts" })).toThrow("within takes a folder.");
    });
});
```

`lib/engine/impact.test.ts`:

```ts
import path from "path";
import { describe, expect, it } from "vitest";
import { indexRepository } from "../index/pipeline";
import { areasOf, impact, rootsAmong } from "./impact";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
indexRepository(root);
const target = "src/base/common/strings.ts";

describe("impact of strings.ts on the architecture fixture", () => {
    it("counts the 16 dependents by the children of a folder, with the rest elsewhere", () => {
        const i = impact(root, target, "dependents", { groupBy: "src" });
        expect(i.reach.reached).toHaveLength(16);
        expect(i.reach.direct).toBe(6);
        expect(i.areas).toEqual([
            { path: "src/editor", kind: "folder", count: 5 },
            { path: "src/base", kind: "folder", count: 4 },
            { path: "src/app", kind: "folder", count: 3 },
            { path: "src/platform", kind: "folder", count: 3 },
        ]);
        expect(i.elsewhere).toBe(1);
        expect(i.tests).toBe(1);
    });

    it("splits the files nothing imports into those a package.json names and the others, tests left out", () => {
        expect(impact(root, target, "dependents", { groupBy: "src" }).roots).toEqual({
            declared: ["src/app/loader.ts"],
            others: ["src/app/legacy.ts", "tools/fixtures/legacy-ids.ts"],
        });
    });

    it("with no folder, groups as describe's used-by does", () => {
        expect(impact(root, target, "dependents", { groupBy: null }).areas).toEqual([
            { path: "src/editor", kind: "folder", count: 5 },
            { path: "src/app", kind: "folder", count: 3 },
            { path: "src/platform", kind: "folder", count: 3 },
            { path: "src/base/browser", kind: "folder", count: 1 },
            { path: "src/base/common/arrays.ts", kind: "file", count: 1 },
            { path: "src/base/node", kind: "folder", count: 1 },
            { path: "src/base/test", kind: "folder", count: 1 },
            { path: "tools", kind: "folder", count: 1 },
        ]);
    });

    it("refuses a group_by that isn't a folder", () => {
        expect(() => impact(root, target, "dependents", { groupBy: "src/app/main.ts" })).toThrow('group_by takes a folder: nothing is indexed as a folder at "src/app/main.ts".');
    });

    it("lists no roots for dependencies", () => {
        expect(impact(root, "src/app/main.ts", "dependencies", { groupBy: null }).roots).toBeNull();
    });
});

describe("areasOf and rootsAmong, hand-built", () => {
    it("puts a file directly in the folder under its own name", () => {
        expect(areasOf([{ path: "a/x.ts", distance: 1 }, { path: "a/b/y.ts", distance: 2 }], { path: "c/z.ts", kind: "file" }, "a"))
            .toEqual({ areas: [{ path: "a/b", kind: "folder", count: 1 }, { path: "a/x.ts", kind: "file", count: 1 }], elsewhere: 0 });
    });

    it("leaves out tests and files something imports", () => {
        const inDegree = (p: string): number => (p === "a.ts" ? 1 : 0);
        expect(rootsAmong([{ path: "a.ts", distance: 1 }, { path: "test/b.ts", distance: 1 }, { path: "c.ts", distance: 2 }], inDegree, new Set()))
            .toEqual({ declared: [], others: ["c.ts"] });
    });
});
```

`lib/tools/answers.test.ts`, three new tests. They feed the builders hand-built `Impact` and `ReachAnswer` values with the fixture's numbers, and expect the ground truth's text:

```ts
const strings: ReachAnswer = {
    path: "src/base/common/strings.ts", kind: "file", direction: "dependents", direct: 6, indexVersion: 1,
    reached: [
        ["src/base/browser/dom.ts", 1], ["src/base/common/arrays.ts", 1], ["src/editor/common/textModel.ts", 1], ["src/app/legacy.ts", 1],
        ["src/base/test/common/strings.test.ts", 1], ["tools/fixtures/legacy-ids.ts", 1],
        ["src/base/node/fs.ts", 2], ["src/platform/common/storage.ts", 2], ["src/editor/browser/editorView.ts", 2], ["src/editor/common/tokens.ts", 2],
        ["src/editor/node/editorFiles.ts", 2], ["src/platform/browser/storageView.ts", 2],
        ["src/editor/common/model.ts", 3], ["src/platform/node/storageFile.ts", 3], ["src/app/main.ts", 3],
        ["src/app/loader.ts", 4],
    ].map(([p, d]) => ({ path: p as string, distance: d as number })),
};
const roots = { declared: ["src/app/loader.ts"], others: ["src/app/legacy.ts", "tools/fixtures/legacy-ids.ts"] };

it("impact counts by area, then tests and the files nothing imports that load it (ADR-055)", () => {
    const text = answerText(impactAnswer({
        reach: strings, groupBy: "src", elsewhere: 1, tests: 1, roots,
        areas: [{ path: "src/editor", kind: "folder", count: 5 }, { path: "src/base", kind: "folder", count: 4 },
            { path: "src/app", kind: "folder", count: 3 }, { path: "src/platform", kind: "folder", count: 3 }],
    }));
    expect(text).toBe([
        "src/base/common/strings.ts is imported by 6 files directly and 16 files in all, counting files that reach it through others.",
        "By area (inside src/):",
        "  src/editor/  5",
        "  src/base/  4",
        "  src/app/  3",
        "  src/platform/  3",
        "  elsewhere (outside src/)  1",
        "Tests among them: 1.",
        "Entry points a package.json names that load it (1):",
        "  src/app/loader.ts",
        "Other files nothing imports that load it (2):",
        "  src/app/legacy.ts",
        "  tools/fixtures/legacy-ids.ts",
    ].join("\n"));
});

it("a transitive list of dependents ends with the same lines", () => {
    const lines = answerText(reachAnswer(strings, { transitive: true, limit: 50, offset: 0 }, rootLines(1, roots))).split("\n");
    expect(lines.slice(0, 2)).toEqual([
        "src/base/common/strings.ts is imported by 6 files directly and 16 files in all, counting files that reach it through others.",
        "Distance 1 (6):",
    ]);
    expect(lines.slice(-6)).toEqual([
        "Tests among them: 1.",
        "Entry points a package.json names that load it (1):",
        "  src/app/loader.ts",
        "Other files nothing imports that load it (2):",
        "  src/app/legacy.ts",
        "  tools/fixtures/legacy-ids.ts",
    ]);
});

it("a list within a folder says so in its first line", () => {
    const text = answerText(reachAnswer({
        path: "src/editor", kind: "folder", direction: "dependents", direct: 1, indexVersion: 1, within: "src/platform",
        reached: [{ path: "src/platform/node/storageFile.ts", distance: 1 }],
    }, { transitive: false, limit: 50, offset: 0 }));
    expect(text.split("\n")[0]).toBe("src/editor/ is imported from outside it by 1 file directly and 1 file in all, counting files that reach it through others. Only files inside src/platform/ are counted.");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/engine/reach.test.ts lib/engine/impact.test.ts lib/tools/answers.test.ts`
Expected: FAIL.

- [ ] **Step 3: `within` in `reach`**

In `lib/engine/reach.ts`:
- `ReachAnswer` gains `/** Only files inside this folder are counted (ADR-045, amended). */ within?: string;`.
- `reach` gains a fourth parameter, `options: { within?: string } = {}`. After `requireKind` for the target, add:

```ts
        const within = options.within === undefined || options.within === "" ? undefined : options.within;
        if (within !== undefined && requireKind(db, repoId, within) === "file") throw new BadInputError("within takes a folder.");
```

and filter what's reached:

```ts
        const all = reachFrom(importIndexFor(db, repoId, version), targetPath, kind, direction);
        const reached = within === undefined ? all : all.filter((r) => r.path.startsWith(`${within}/`));
        return {
            path: targetPath, kind, direction, reached, direct: reached.filter((r) => r.distance === 1).length, indexVersion: version,
            ...(within !== undefined ? { within } : {}),
        };
```

- Export `specifiersAlong` (Task 7 uses it for a cycle's steps).

- [ ] **Step 4: `lib/engine/impact.ts`**

```ts
import path from "path";
import { getDb } from "../db/client";
import { loadEntryPoints } from "../db/store/entries";
import { loadFolderInfo } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { childToward, lcaFolder } from "../index/aggregate";
import { isTestPath } from "../index/discover";
import { dirOf, repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { rangeOf } from "./graph";
import { importIndexFor, reach, type Direction, type ImportIndex, type ReachAnswer, type Reached } from "./reach";

export type ImpactArea = { path: string; kind: "folder" | "file"; count: number };
/** Files nothing imports among those reached, tests left out: those a package.json names, and the others (R8). */
export type Roots = { declared: string[]; others: string[] };

/** What depends on a place (or what it depends on), counted by area (ADR-055): "what breaks if I change this". */
export type Impact = {
    reach: ReachAnswer;
    /** The folder whose children are the areas; "" the repo's top level; null describe's used-by rule. */
    groupBy: string | null;
    areas: ImpactArea[];
    /** Files outside groupBy (always 0 when groupBy is null). */
    elsewhere: number;
    /** Test files among those reached. */
    tests: number;
    /** Only for dependents. */
    roots: Roots | null;
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Each reached file's area: the child of groupBy holding it (files outside it are "elsewhere"); or, with no groupBy,
 * describe's used-by rule, the child of the lowest folder holding both it and the target, on the way to it.
 */
export function areasOf(reached: readonly Reached[], target: { path: string; kind: "folder" | "file" }, groupBy: string | null): { areas: ImpactArea[]; elsewhere: number } {
    const home = target.kind === "file" ? dirOf(target.path) : target.path;
    const counts = new Map<string, ImpactArea>();
    let elsewhere = 0;
    for (const r of reached){
        let area: string;
        if (groupBy === null) area = childToward(lcaFolder(home, dirOf(r.path)), r.path);
        else if (groupBy === "" || r.path.startsWith(`${groupBy}/`)) area = childToward(groupBy, r.path);
        else{
            elsewhere++;
            continue;
        }
        const entry = counts.get(area) ?? { path: area, kind: area === r.path ? "file" as const : "folder" as const, count: 0 };
        entry.count++;
        counts.set(area, entry);
    }
    return { areas: [...counts.values()].sort((a, b) => b.count - a.count || compare(a.path, b.path)), elsewhere };
}

/** The files among `reached` that nothing imports, tests left out, split by whether a package.json names them; each by path. */
export function rootsAmong(reached: readonly Reached[], inDegreeOf: (p: string) => number, declared: ReadonlySet<string>): Roots {
    const roots = reached.map((r) => r.path).filter((p) => inDegreeOf(p) === 0 && !isTestPath(p)).sort(compare);
    return { declared: roots.filter((p) => declared.has(p)), others: roots.filter((p) => !declared.has(p)) };
}

/** How many files import a file, from the import index (0 for a path it doesn't hold). */
export function inDegreeIn(index: ImportIndex): (p: string) => number {
    return (p) => {
        const [at, end] = rangeOf(index, p, "file");
        return end > at ? index.inDegree[at] : 0;
    };
}

export function impact(repoRoot: string, targetPath: string, direction: Direction, options: { groupBy: string | null; within?: string }): Impact {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const groupBy = options.groupBy;
        if (groupBy !== null && groupBy !== "" && !loadFolderInfo(db, repoId, groupBy)){
            throw new BadInputError(`group_by takes a folder: nothing is indexed as a folder at "${groupBy}".`);
        }
        const answer = reach(repoRoot, targetPath, direction, { within: options.within });
        const { areas, elsewhere } = areasOf(answer.reached, { path: answer.path, kind: answer.kind }, groupBy);
        const tests = answer.reached.filter((r) => isTestPath(r.path)).length;
        const roots = direction === "dependents"
            ? rootsAmong(answer.reached, inDegreeIn(importIndexFor(db, repoId, answer.indexVersion)), loadEntryPoints(db, repoId))
            : null;
        return { reach: answer, groupBy, areas, elsewhere, tests, roots };
    });
}
```

- [ ] **Step 5: The answers**

In `lib/tools/answers.ts`:
- Split `reachAnswer`'s first sentence (the empty case included) into an exported `reachHeader(a: ReachAnswer): string`. When `a.within` is set, the non-empty header ends with ` Only files inside ${a.within}/ are counted.`, and the empty case reads `No file inside ${a.within}/ imports ${target}.` (dependents) or `${target} imports no file inside ${a.within}/.` (dependencies).
- `reachAnswer(a, page, after: readonly string[] = [])` appends `after` at the very end of the body.
- Add:

```ts
/** How many of a list's files are shown before "… N more": a list of areas, or of files nothing imports. */
const LIST_SHOWN = 50;

function listBlock(header: string, paths: readonly string[]): string[] {
    const shown = paths.slice(0, LIST_SHOWN).map((p) => `  ${p}`);
    return [header, ...shown, ...(paths.length > LIST_SHOWN ? [`  ${moreLine(paths.length - LIST_SHOWN)}`] : [])];
}

/** The lines after a count or list of dependents (ADR-055): the tests among them, and the files nothing imports that load the target. */
export function rootLines(tests: number, roots: Roots | null): string[] {
    const lines: string[] = [];
    if (tests > 0) lines.push(`Tests among them: ${formatCount(tests)}.`);
    if (roots && roots.declared.length > 0) lines.push(...listBlock(`Entry points a package.json names that load it (${formatCount(roots.declared.length)}):`, roots.declared));
    if (roots && roots.others.length > 0) lines.push(...listBlock(`Other files nothing imports that load it (${formatCount(roots.others.length)}):`, roots.others));
    return lines;
}

/** imports with group_by (ADR-055): the counts by area in place of the list. */
export function impactAnswer(i: Impact): AnswerParts {
    const body = [reachHeader(i.reach)];
    if (i.reach.reached.length === 0) return { body };
    body.push(i.groupBy === null ? "By area:" : i.groupBy === "" ? "By area (the repo's top level):" : `By area (inside ${i.groupBy}/):`);
    for (const a of i.areas.slice(0, LIST_SHOWN)) body.push(`  ${shownPath(a.path, a.kind)}  ${formatCount(a.count)}`);
    if (i.areas.length > LIST_SHOWN) body.push(`  ${moreLine(i.areas.length - LIST_SHOWN)} areas`);
    if (i.elsewhere > 0) body.push(`  elsewhere (outside ${i.groupBy}/)  ${formatCount(i.elsewhere)}`);
    body.push(...rootLines(i.tests, i.roots));
    return { body };
}
```

Import `Impact` and `Roots` from `../engine/impact`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run lib`
Expected: PASS (about 12 new).

- [ ] **Step 7: Amend ADR-045**

```markdown
**Amended (‹today›, V1.6): `within`.** The revisit this ADR named ("agents ask for a subset … add an `under` filter") came with V1.6's layering questions: which files in `platform` import `editor`? `dependents` and `dependencies` take `within`, a folder; only files inside it are listed and counted, and the answer's first line says so (ADR-055 builds on it).
```

- [ ] **Step 8: Gate, commit, push**

Run the gate (about 975/975). Then:
```bash
git add -A -- lib/engine/impact.ts lib/engine/impact.test.ts lib/engine/reach.ts lib/engine/reach.test.ts lib/tools/answers.ts lib/tools/answers.test.ts docs/ENGINEERING_DECISIONS.md && git commit -m "feat(engine): impact by area with the entry points that load a file, and reach within a folder (ADR-045 amended)" -- lib/engine/impact.ts lib/engine/impact.test.ts lib/engine/reach.ts lib/engine/reach.test.ts lib/tools/answers.ts lib/tools/answers.test.ts docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

### Task 7: Architecture facts from the import graph (ADR-055)

**Files:**
- Create: `lib/engine/architecture.ts`, `lib/engine/architecture.test.ts`
- Modify: `lib/tools/answers.ts` (+ `answers.test.ts`)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-055), `docs/PIVOT_SPEC.md` §6.1, `docs/ARCHITECTURE.md` (the engine's queries)

**Interfaces:**
- Consumes: `importIndexFor`, `rangeOf`, `specifiersAlong`, `loadLevelEdgeRows`, `loadChildFolders`, `loadChildFiles`, `loadEntryPoints`.
- Produces:
  - `stronglyConnected(index)`, `shortestCycleThrough(index, node, group)`, `layersOf(parts, rows, examples)`, `conventionsOf(index, folder, minFolders?)`, `unusedIn(index, range, declared)`;
  - `architecture(repoRoot, path, report, { through? }): ArchitectureAnswer`;
  - `architectureAnswer(a, page): AnswerParts`.
  - Task 12's `architecture` tool calls these.

- [ ] **Step 1: Write the failing tests**

`lib/engine/architecture.test.ts`:

```ts
import path from "path";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { indexRepository } from "../index/pipeline";
import { repoKey } from "../index/paths";
import { architecture, conventionsOf, layersOf, shortestCycleThrough, stronglyConnected } from "./architecture";
import { buildImportGraph } from "./graph";
import { buildImportIndex, importIndexFor } from "./reach";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
const { repoId } = indexRepository(root);
const db = getDb();
const index = importIndexFor(db, requireRepository(db, repoKey(root)), readIndexVersion(db, repoId));
const at = (p: string): number => index.paths.indexOf(p);

describe("stronglyConnected", () => {
    it("finds the fixture's one group of three files", () => {
        const { group, sizes } = stronglyConnected(index);
        const big = sizes.flatMap((size, id) => (size > 1 ? [id] : []));
        expect(big).toHaveLength(1);
        expect(index.paths.filter((_, i) => group[i] === big[0])).toEqual(["src/editor/common/model.ts", "src/editor/common/textModel.ts", "src/editor/common/tokens.ts"]);
    });

    it("finds one group in a ring of 100,000 files, without overflowing the stack (Review Focus 4)", () => {
        const n = 100_000;
        const files = Array.from({ length: n }, (_, i) => ({ id: i, path: `f${String(i).padStart(6, "0")}.ts` }));
        const edges = files.map((f, i) => ({ source: f.id, target: (i + 1) % n }));
        expect(stronglyConnected(buildImportIndex(buildImportGraph(files, edges))).sizes).toEqual([n]);
    });
});

describe("shortestCycleThrough", () => {
    it("walks the group from the file back to it", () => {
        const { group } = stronglyConnected(index);
        expect(shortestCycleThrough(index, at("src/editor/common/model.ts"), group)?.map((i) => index.paths[i]))
            .toEqual(["src/editor/common/model.ts", "src/editor/common/tokens.ts", "src/editor/common/textModel.ts", "src/editor/common/model.ts"]);
        expect(shortestCycleThrough(index, at("src/platform/common/storage.ts"), group)).toBeNull();
    });
});

describe("layersOf, hand-built", () => {
    const part = (p: string) => ({ path: p, kind: "folder" as const });
    const examples = (from: { path: string }, to: { path: string }): [string, string][] => [[`${from.path}/x.ts`, `${to.path}/y.ts`]];

    it("orders the fixture's src by the direction most imports go, and lists the imports against it", () => {
        const layers = layersOf([part("src/app"), part("src/base"), part("src/editor"), part("src/platform")], [
            { source: "src/app", target: "src/base", count: 1 }, { source: "src/app", target: "src/editor", count: 2 },
            { source: "src/app", target: "src/platform", count: 1 }, { source: "src/editor", target: "src/base", count: 3 },
            { source: "src/editor", target: "src/platform", count: 2 }, { source: "src/platform", target: "src/base", count: 3 },
            { source: "src/platform", target: "src/editor", count: 1 },
        ], examples);
        expect(layers.levels.map((level) => level.map((p) => p.path))).toEqual([["src/base"], ["src/platform"], ["src/editor"], ["src/app"]]);
        expect(layers.against).toEqual([{ from: part("src/platform"), to: part("src/editor"), count: 1, examples: [["src/platform/x.ts", "src/editor/y.ts"]] }]);
        expect(layers.tangled).toEqual([]);
        expect(layers.unlinked).toEqual([]);
    });

    it("calls an even pair tangled, a loop of dominant directions a circle, and a part with no imports unlinked", () => {
        const layers = layersOf([part("a"), part("b"), part("c"), part("d"), part("e")], [
            { source: "a", target: "b", count: 2 }, { source: "b", target: "a", count: 2 },
            { source: "b", target: "c", count: 1 }, { source: "c", target: "d", count: 1 }, { source: "d", target: "b", count: 1 },
        ], examples);
        expect(layers.tangled).toEqual([{ a: part("a"), b: part("b"), count: 2 }]);
        expect(layers.circles).toEqual([[part("b"), part("c"), part("d")]]);
        expect(layers.unlinked).toEqual([part("e")]);
    });
});

describe("conventionsOf on the fixture's src", () => {
    it("names the folder names that recur in 3 or more folders, and counts what each one's files import", () => {
        const c = conventionsOf(index, "src");
        expect(c.names).toEqual([{ name: "browser", folders: 3 }, { name: "common", folders: 4 }, { name: "node", folders: 3 }]);
        expect(c.pairs.map((p) => `${p.from}>${p.to} ${p.count}`)).toEqual(["browser>browser 2", "browser>common 2", "common>browser 1", "common>common 8", "node>common 4", "node>node 3"]);
        expect(c.pairs.find((p) => p.from === "common" && p.to === "browser")!.examples).toEqual([["src/platform/common/storage.ts", "src/platform/browser/storageView.ts"]]);
        expect(c.pairs.find((p) => p.from === "common" && p.to === "common")!.examples).toEqual([]);
    });
});

describe("architecture(), against the ground truth", () => {
    it("files nothing imports in src: one an entry point, one not named, one test", () => {
        expect(architecture(root, "src", "unused").unused).toEqual({ declared: ["src/app/loader.ts"], others: ["src/app/legacy.ts"], tests: 1 });
    });

    it("refuses a file except for cycles", () => {
        expect(() => architecture(root, "src/app/main.ts", "layers")).toThrow('architecture reads a folder ("" for the repo); for one file, ask for report "cycles".');
        expect(architecture(root, "src/editor/common/model.ts", "cycles").through?.cycle).toHaveLength(4);
    });
});
```

`lib/tools/answers.test.ts`: one test per text in "Ground truth" → "Architecture". Each feeds `architectureAnswer` the value `architecture(root, …)` returns on the indexed fixture, and expects the ground truth's text, line for line:
- `src` layers;
- `src/base` layers;
- `src` conventions;
- `src` cycles;
- cycles through `src/editor/common/model.ts`;
- cycles through `src/platform/common/storage.ts`;
- `src` unused, and `""` unused (its first line, and the two lists);
- `src` summary.

That's 9 tests. (These answer tests index the fixture too: `answers.test.ts` imports `indexRepository` and `architecture` for them.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/engine/architecture.test.ts lib/tools/answers.test.ts`
Expected: FAIL.

- [ ] **Step 3: `lib/engine/architecture.ts`**

```ts
/**
 * How code under a folder is organized, computed from its imports (ADR-055), with no model: its parts in layers by the
 * direction most imports go, the imports against that order, the folder names that recur and what each one's files
 * import (VS Code's common/browser/node), the import cycles, and the files nothing imports. A rule a team wrote down
 * shows here as it's kept or broken; the docs pointers (ADR-054) point at where it's written.
 */
import path from "path";
import { getDb, type Db } from "../db/client";
import { loadEntryPoints } from "../db/store/entries";
import { loadChildFiles, loadChildFolders, loadFileInfo, loadFolderInfo, loadLevelEdgeRows } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { isTestPath } from "../index/discover";
import { dirOf, repoKey } from "../index/paths";
import { BadInputError } from "./errors";
import { rangeOf } from "./graph";
import { PathNotFoundError } from "./level";
import { importIndexFor, specifiersAlong, type ImportIndex } from "./reach";

export type Part = { path: string; kind: "folder" | "file" };
export type Layers = {
    /** levels[0] uses nothing else here; each part of level n uses parts below it. Unlinked parts are left out. */
    levels: Part[][];
    against: { from: Part; to: Part; count: number; examples: [string, string][] }[];
    tangled: { a: Part; b: Part; count: number }[];
    /** Parts whose dominant directions go round in a loop: they share one level. */
    circles: Part[][];
    unlinked: Part[];
};
export type Conventions = {
    names: { name: string; folders: number }[];
    /** examples only for pairs of 3 imports or fewer */
    pairs: { from: string; to: string; count: number; examples: [string, string][] }[];
};
export type Unused = { declared: string[]; others: string[]; tests: number };
export type CycleGroup = { size: number; files: string[] };
export type ArchitectureReport = "summary" | "layers" | "conventions" | "cycles" | "unused";
export type ArchitectureAnswer = {
    path: string;
    kind: "repo" | "folder" | "file";
    report: ArchitectureReport;
    layers?: Layers;
    conventions?: Conventions;
    cycles?: CycleGroup[];
    through?: { file: string; cycle: string[] | null; specifiers: string[] };
    unused?: Unused;
};

/** A folder name recurs when this many folders under the place have it. */
export const MIN_RECURRING = 3;
/** A pair of folder names with this many imports or fewer shows its imports. */
export const RARE_PAIR = 3;
/** Imports shown for each pair against the layers. */
const EXAMPLES = 3;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tarjan's strongly connected components over rows in compressed form (offsets, neighbours), iterative so a deep graph
 * can't overflow the stack (Review Focus 4). Component ids come out in completion order, which is reverse topological:
 * a component's id is above every component it reaches.
 */
function tarjan(n: number, offsets: Int32Array, neighbours: Int32Array): { group: Int32Array; sizes: number[] } {
    const order = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const group = new Int32Array(n).fill(-1);
    const onStack = new Uint8Array(n);
    const stack: number[] = [];
    const sizes: number[] = [];
    const frames: number[] = [];   // pairs: node, next edge
    let counter = 0;
    for (let start = 0; start < n; start++){
        if (order[start] !== -1) continue;
        order[start] = low[start] = counter++;
        stack.push(start);
        onStack[start] = 1;
        frames.push(start, offsets[start]);
        while (frames.length > 0){
            const top = frames.length - 2;
            const v = frames[top];
            const e = frames[top + 1];
            if (e < offsets[v + 1]){
                frames[top + 1] = e + 1;
                const w = neighbours[e];
                if (order[w] === -1){
                    order[w] = low[w] = counter++;
                    stack.push(w);
                    onStack[w] = 1;
                    frames.push(w, offsets[w]);
                } else if (onStack[w]) low[v] = Math.min(low[v], order[w]);
                continue;
            }
            frames.length -= 2;
            if (frames.length > 0){
                const u = frames[frames.length - 2];
                low[u] = Math.min(low[u], low[v]);
            }
            if (low[v] === order[v]){
                const id = sizes.length;
                let size = 0;
                let w: number;
                do{
                    w = stack.pop()!;
                    onStack[w] = 0;
                    group[w] = id;
                    size++;
                } while (w !== v);
                sizes.push(size);
            }
        }
    }
    return { group, sizes };
}

/** Kept per import index, so a new index version gets new groups (ADR-044's rule for caches). */
const groupsCache = new WeakMap<ImportIndex, { group: Int32Array; sizes: number[] }>();

export function stronglyConnected(index: ImportIndex): { group: Int32Array; sizes: number[] } {
    let found = groupsCache.get(index);
    if (!found){
        found = tarjan(index.paths.length, index.imports.offsets, index.imports.neighbours);
        groupsCache.set(index, found);
    }
    return found;
}

/** The shortest import cycle from a file back to itself, inside its group (breadth-first, neighbours in path order), or null. */
export function shortestCycleThrough(index: ImportIndex, node: number, group: Int32Array): number[] | null {
    const home = group[node];
    const parent = new Map<number, number>();
    const queue: number[] = [node];
    const { offsets, neighbours } = index.imports;
    for (let head = 0; head < queue.length; head++){
        const v = queue[head];
        for (let e = offsets[v]; e < offsets[v + 1]; e++){
            const w = neighbours[e];
            if (w === node){
                const back: number[] = [];
                for (let at = v; at !== node; at = parent.get(at)!) back.push(at);
                return [node, ...back.reverse(), node];
            }
            if (group[w] !== home || parent.has(w)) continue;
            parent.set(w, v);
            queue.push(w);
        }
    }
    return null;
}

/** Compressed rows from adjacency lists, each list sorted. */
function rowsOf(lists: number[][]): { offsets: Int32Array; neighbours: Int32Array } {
    const offsets = new Int32Array(lists.length + 1);
    lists.forEach((l, i) => { offsets[i + 1] = offsets[i] + l.length; });
    const neighbours = new Int32Array(offsets[lists.length]);
    lists.forEach((l, i) => neighbours.set([...l].sort((a, b) => a - b), offsets[i]));
    return { offsets, neighbours };
}

/**
 * A folder's parts in layers (ADR-055). Between two parts, the direction with more imports is dominant (the importer
 * uses the other); the fewer imports the other way are against the order; an even count is tangled. Levels count up from
 * the parts that use nothing else here; parts whose dominant directions loop share a level and are listed as a circle.
 */
export function layersOf(parts: readonly Part[], rows: readonly { source: string; target: string; count: number }[], examples: (from: Part, to: Part) => [string, string][]): Layers {
    const sorted = [...parts].sort((a, b) => compare(a.path, b.path));
    const n = sorted.length;
    const at = new Map(sorted.map((p, i) => [p.path, i]));
    const count = new Map<number, number>();
    for (const r of rows){
        const i = at.get(r.source);
        const j = at.get(r.target);
        if (i === undefined || j === undefined || i === j) continue;
        count.set(i * n + j, (count.get(i * n + j) ?? 0) + r.count);
    }
    const pairs = [...new Set([...count.keys()].map((key) => {
        const i = Math.floor(key / n);
        const j = key % n;
        return Math.min(i, j) * n + Math.max(i, j);
    }))].sort((a, b) => a - b);

    const uses: number[][] = Array.from({ length: n }, () => []);
    const linked = new Uint8Array(n);
    const against: Layers["against"] = [];
    const tangled: Layers["tangled"] = [];
    for (const key of pairs){
        const i = Math.floor(key / n);
        const j = key % n;
        const ij = count.get(i * n + j) ?? 0;
        const ji = count.get(j * n + i) ?? 0;
        linked[i] = linked[j] = 1;
        if (ij > ji){
            uses[i].push(j);
            if (ji > 0) against.push({ from: sorted[j], to: sorted[i], count: ji, examples: examples(sorted[j], sorted[i]) });
        } else if (ji > ij){
            uses[j].push(i);
            if (ij > 0) against.push({ from: sorted[i], to: sorted[j], count: ij, examples: examples(sorted[i], sorted[j]) });
        } else tangled.push({ a: sorted[i], b: sorted[j], count: ij });
    }

    const { offsets, neighbours } = rowsOf(uses);
    const { group, sizes } = tarjan(n, offsets, neighbours);
    // ids come in reverse topological order, so a component's uses are already levelled when it's reached
    const level = new Int32Array(sizes.length);
    const byGroup: number[][] = sizes.map(() => []);
    for (let i = 0; i < n; i++) byGroup[group[i]].push(i);
    for (let g = 0; g < sizes.length; g++){
        let top = -1;
        for (const i of byGroup[g]) for (const j of uses[i]) if (group[j] !== g) top = Math.max(top, level[group[j]]);
        level[g] = top + 1;
    }

    const levels: Part[][] = [];
    for (let i = 0; i < n; i++) if (linked[i]) (levels[level[group[i]]] ??= []).push(sorted[i]);
    against.sort((a, b) => b.count - a.count || compare(a.from.path, b.from.path) || compare(a.to.path, b.to.path));
    return {
        levels,
        against,
        tangled,
        circles: byGroup.filter((members) => members.length > 1).map((members) => members.map((i) => sorted[i])),
        unlinked: sorted.filter((_, i) => !linked[i]),
    };
}

/** Every folder that holds an indexed file, from the import index's paths (the same set as the folders table). */
function foldersOf(paths: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const p of paths) for (let d = dirOf(p); d !== "" && !out.has(d); d = dirOf(d)) out.add(d);
    return out;
}

/**
 * Folder names that recur in MIN_RECURRING or more folders strictly under the place, and what each one's files import:
 * a file belongs to the deepest recurring name on its path below the place, and an import counts when both ends have one.
 */
export function conventionsOf(index: ImportIndex, folderPath: string, minFolders = MIN_RECURRING): Conventions {
    const prefix = folderPath === "" ? "" : `${folderPath}/`;
    const counts = new Map<string, number>();
    for (const f of foldersOf(index.paths)){
        if (!f.startsWith(prefix)) continue;
        const name = f.slice(f.lastIndexOf("/") + 1);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const names = [...counts].filter(([, n]) => n >= minFolders).map(([name, folders]) => ({ name, folders })).sort((a, b) => compare(a.name, b.name));
    const recurring = new Set(names.map((n) => n.name));
    const [from, to] = rangeOf(index, folderPath, folderPath === "" ? "repo" : "folder");
    const envOf = (i: number): string | null => {
        const segments = dirOf(index.paths[i]).slice(prefix.length).split("/");
        for (let s = segments.length - 1; s >= 0; s--) if (recurring.has(segments[s])) return segments[s];
        return null;
    };
    const pairs = new Map<string, { from: string; to: string; count: number; examples: [string, string][] }>();
    for (let i = from; i < to; i++){
        const a = envOf(i);
        if (a === null) continue;
        for (let e = index.imports.offsets[i]; e < index.imports.offsets[i + 1]; e++){
            const j = index.imports.neighbours[e];
            if (j < from || j >= to) continue;
            const b = envOf(j);
            if (b === null) continue;
            const entry = pairs.get(`${a}\0${b}`) ?? { from: a, to: b, count: 0, examples: [] };
            entry.count++;
            if (entry.examples.length < RARE_PAIR) entry.examples.push([index.paths[i], index.paths[j]]);
            pairs.set(`${a}\0${b}`, entry);
        }
    }
    return {
        names,
        pairs: [...pairs.values()]
            .map((p) => (p.count <= RARE_PAIR ? p : { ...p, examples: [] }))
            .sort((x, y) => compare(x.from, y.from) || compare(x.to, y.to)),
    };
}

/** The files under the place that nothing imports: tests counted apart, the rest split by whether a package.json names them. */
export function unusedIn(index: ImportIndex, range: [number, number], declared: ReadonlySet<string>): Unused {
    const out: Unused = { declared: [], others: [], tests: 0 };
    for (let i = range[0]; i < range[1]; i++){
        if (index.inDegree[i] !== 0) continue;
        const p = index.paths[i];
        if (isTestPath(p)) out.tests++;
        else if (declared.has(p)) out.declared.push(p);
        else out.others.push(p);
    }
    return out;
}

/** The strongly connected groups of two or more files with a file under the place, largest first, each in path order. */
function groupsTouching(index: ImportIndex, range: [number, number]): CycleGroup[] {
    const { group, sizes } = stronglyConnected(index);
    const touched = new Set<number>();
    for (let i = range[0]; i < range[1]; i++) if (sizes[group[i]] > 1) touched.add(group[i]);
    const members = new Map<number, string[]>();
    for (let i = 0; i < index.paths.length; i++){
        if (!touched.has(group[i])) continue;
        const list = members.get(group[i]) ?? [];
        list.push(index.paths[i]);
        members.set(group[i], list);
    }
    return [...members.values()].map((files) => ({ size: files.length, files })).sort((a, b) => b.size - a.size || compare(a.files[0], b.files[0]));
}

/** The first EXAMPLES imports from files under one part to files under another, in path order. */
function importsBetween(index: ImportIndex, from: Part, to: Part): [string, string][] {
    const a = rangeOf(index, from.path, from.kind);
    const b = rangeOf(index, to.path, to.kind);
    const out: [string, string][] = [];
    for (let i = a[0]; i < a[1] && out.length < EXAMPLES; i++){
        for (let e = index.imports.offsets[i]; e < index.imports.offsets[i + 1] && out.length < EXAMPLES; e++){
            const j = index.imports.neighbours[e];
            if (j >= b[0] && j < b[1]) out.push([index.paths[i], index.paths[j]]);
        }
    }
    return out;
}

function kindAt(db: Db, repoId: number, p: string): "repo" | "folder" | "file" {
    if (p === "" || loadFolderInfo(db, repoId, p)) return p === "" ? "repo" : "folder";
    if (loadFileInfo(db, repoId, p)) return "file";
    throw new PathNotFoundError(p);
}

/** architecture (ADR-055): one report, or the summary of all four, for a folder; cycles for a file too. */
export function architecture(repoRoot: string, targetPath: string, report: ArchitectureReport, options: { through?: string } = {}): ArchitectureAnswer {
    const db = getDb();
    const repoId = requireRepository(db, repoKey(path.resolve(repoRoot)));
    return db.transaction(() => {
        const kind = kindAt(db, repoId, targetPath);
        if (kind === "file" && report !== "cycles") throw new BadInputError('architecture reads a folder ("" for the repo); for one file, ask for report "cycles".');
        const through = kind === "file" ? targetPath : options.through;
        if (through !== undefined && kindAt(db, repoId, through) !== "file") throw new BadInputError("through takes a file.");

        const index = importIndexFor(db, repoId, readIndexVersion(db, repoId));
        const range = rangeOf(index, targetPath, kind);
        const answer: ArchitectureAnswer = { path: targetPath, kind, report };
        const all = report === "summary";

        if (all || report === "layers"){
            const parts: Part[] = [
                ...loadChildFolders(db, repoId, targetPath).map((f) => ({ path: f.path, kind: "folder" as const })),
                ...loadChildFiles(db, repoId, targetPath).map((f) => ({ path: f.path, kind: "file" as const })),
            ];
            answer.layers = layersOf(parts, loadLevelEdgeRows(db, repoId, targetPath), (from, to) => importsBetween(index, from, to));
        }
        if (all || report === "conventions") answer.conventions = conventionsOf(index, targetPath);
        if (all || report === "cycles"){
            if (through !== undefined){
                const node = rangeOf(index, through, "file")[0];
                const cycle = shortestCycleThrough(index, node, stronglyConnected(index).group)?.map((i) => index.paths[i]) ?? null;
                answer.through = { file: through, cycle, specifiers: cycle ? specifiersAlong(db, repoId, cycle) : [] };
            } else answer.cycles = groupsTouching(index, range);
        }
        if (all || report === "unused") answer.unused = unusedIn(index, range, loadEntryPoints(db, repoId));
        return answer;
    });
}
```

(`loadLevelEdgeRows` already returns `{ source, target, count }` for one level, `lib/db/store/map.ts`.)

- [ ] **Step 4: The answers**

In `lib/tools/answers.ts`, add `architectureAnswer(a: ArchitectureAnswer, page: { limit: number; offset: number }): AnswerParts`. It writes exactly the ground truth's texts:
- **Where:** `src/` for a folder, `the repo` for `""`.
- **A part's name:** relative to the place, folders with `/`.
- **Layers:**
  - the header `Layers of <where>, bottom first (each uses only the layers below it, except the imports listed after):`;
  - one line per level, `  <n>  <names, ", ">` (at most 20 names, then `, … N more`);
  - `Against that order (<N imports>):` with one line per pair, `  <from> → <to>  <count>`, then each example as `    <a> → <b>` (and `    …` when the count is above the examples shown); or `Against that order: none.`;
  - then, only when present: `As many imports each way: a/ ↔ b/  <n> each` lines; `Using each other in a circle: a/, b/, c/`; `Not linked to the others: x/, y.ts`.
- **Conventions:**
  - `Folder names that recur under <where> (in 3 or more folders): browser (3), common (4), node (3).`;
  - `What each one's files import:` with `  <name> → <to> <count>, …`;
  - `The rarer pairs (3 imports or fewer):` with `  <from> → <to>: <a> → <b>; …`;
  - with none: `No folder name recurs in 3 or more folders under <where>.`
- **Cycles:**
  - `Import cycles touching <where>: <n>, holding <m files> in all.`, then per group (paged by `limit` and `offset`), `  <size files>: <paths, ", ">` (at most 20, then `, … N more`); with none: `No import cycle touches <where>.`;
  - through a file, the ground truth's chain, or `<file> is in no import cycle.`
- **Unused:**
  - `Files in <where> that no indexed file imports: <n>` (`, not counting <n test files>` when there are tests);
  - the two blocks `Named as entry points by a package.json (<n>):` and `Not named anywhere (<n>):` (each at most 50, the second paged by `limit` and `offset`);
  - the note line in `notes`;
  - with none: `Files in <where> that no indexed file imports: none.`
- **Summary:** the ground truth's six lines. Each part's line has its "none" form: `Layers: its parts don't import each other.`, `Folder conventions: none (no folder name recurs in 3 or more folders)`, `Import cycles: none`, `Files nothing imports: none, not counting tests`.

Implement it as one small function per report, each returning lines. The tests from Step 1 pin every string.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run lib`
Expected: PASS (about 18 new).

- [ ] **Step 6: Check VS Code, read-only**

Write a scratch script in the ledger folder. Using `architecture()` on the owner's database, it records:
- `src/vs` layers (expected bottom first: base, then platform, then editor; workbench and sessions above; the 3 imports from platform into editor and the 1 from base into platform listed against the order);
- `src/vs` conventions (the 7 environment names and their pairs, against the planning scan's 21);
- the number of cycle groups and the largest (planning scan: 169 and 230);
- unused in `src/vs/platform/files`.

Time each call warm: each must stay within S5's 500 ms.

- [ ] **Step 7: ADR-055, the spec, the architecture doc**

```markdown
## ADR-055 — Impact and architecture facts, computed from the import graph (‹today›) — amends PIVOT_SPEC.md §6.1

**Context:** Eval #1 found Claude Code alone at the ceiling on its questions. Grep finds a file's direct importers in a few calls, and the model knows VS Code's layout. Where Nebulosity was used, it won on cost, not on score. The questions it should win are the ones grep can't answer cheaply:
- what a change reaches, by area, with the entry points that load it (VS Code's `storage.ts` reaches 4,484 files);
- whether code keeps its layering (3 imports out of 116,000 go against VS Code's);
- what each environment folder imports;
- import cycles (169 groups);
- files nothing imports.
They need the whole graph, and the index already holds it.
**Decision:**
- **Impact** (`lib/engine/impact.ts`): the dependents (or dependencies) of a file or folder, counted by area, the tests among them, and the files nothing imports that load it, those a package.json names first (ADR-053's entry points). An area is the child of a folder the caller names (`group_by`), or describe's used-by rule.
- **Layers:** between two parts of a folder, the direction with more imports is dominant. The fewer imports the other way are against the order and listed with examples; an even split is tangled. Levels count up from the parts that use nothing else there, and parts whose dominant directions loop share a level as a circle.
- **Conventions:** folder names that recur in 3 or more folders under the place, and, for each one, which of the others its files import. A file belongs to the deepest recurring name on its path. Pairs of 3 imports or fewer show them.
- **Cycles:** Tarjan's strongly connected groups, computed iteratively and cached per index version. The shortest cycle through a file comes from a breadth-first walk inside its group.
- **Files nothing imports:** split into those a package.json names and the rest, tests counted apart. They're never called dead (R8).
- All of it works in free mode, and answers through the `imports` and `architecture` tools (ADR-056).
**Alternatives:** (a) A lint-style rule file the user writes (dependency-cruiser): exact, but nobody has one for an unfamiliar repo, which is the case Nebulosity is for. (b) Clusters (E5) to find the parts: answers "what groups together", not "which way imports go". (c) Answer from summaries: a summary can't count.
**Consequences:** On VS Code: `src/vs` layers ‹order›; ‹n› imports against them; conventions ‹pairs›; ‹n› cycle groups, the largest ‹n›; each call warm in ‹ms› (S5). The ground truth's arch-repo pins every number and text.
**Revisit when:** a repo's layers live in names, not folders (a flat folder of `*.service.ts` files), or E2's call graph can say which imported names a change touches. Impact then narrows from files to call sites.
```

- `PIVOT_SPEC.md` §6.1 gains the impact and architecture queries, with a pointer to ADR-055.
- `ARCHITECTURE.md`'s engine section lists `impact.ts`, `architecture.ts` and `docs.ts`.

- [ ] **Step 8: Gate, commit, push**

Run the gate (about 993/993). Then:
```bash
git add -A -- lib/engine/architecture.ts lib/engine/architecture.test.ts lib/tools/answers.ts lib/tools/answers.test.ts docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md docs/ARCHITECTURE.md && git commit -m "feat(engine): layers, folder conventions, import cycles and files nothing imports, from the import graph (ADR-055)" -- lib/engine/architecture.ts lib/engine/architecture.test.ts lib/tools/answers.ts lib/tools/answers.test.ts docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md docs/ARCHITECTURE.md && git push origin pivot/v1
```

---

## Part 2 — The eval harness for Eval #2

Eval #1's files stay exactly as they are, and so do its numbers: everything here takes an eval definition, and Eval #1 gets one that reproduces its runs.

### Task 8: Eval definitions: repos, arms, scripts allowed, three repeats

**Files:**
- Create: `scripts/eval/definition.ts`, `scripts/eval/definition.test.ts`, `eval/eval.json`, `eval2/eval.json`, `eval2/mcp/empty.json` (`{ "mcpServers": {} }`, arm A's config)
- Modify: `scripts/eval/run-config.ts` (+ `run-config.test.ts`), `scripts/eval/validate.ts` (+ `validate.test.ts`), `scripts/eval/run.ts`, `scripts/eval/score.ts`, `scripts/eval/grading.ts`, `scripts/eval/probe.ts`, `package.json`

**Interfaces:**
- Produces:
  - `EvalDefinition` and `loadDefinition(dir)`;
  - `claudeArgs(arm, mcp, pins, { scratch? })`, `scratchRule(absPath)`, `promptFor(question, formats, scratch?)`;
  - `schedule(questions, repeats, order, { upfront })`;
  - `validateInit(run, { …, scripts })`;
  - `--eval <dir>` on `eval:run`, `eval:score`, `eval:grading`, `eval:truth` and `eval:probe` (default `eval`, Eval #1).
  - Tasks 9–11, 13 and 20–23 use all of it.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/definition.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadDefinition } from "./definition";

const write = (json: unknown): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebulosity-def-"));
    fs.writeFileSync(path.join(dir, "eval.json"), JSON.stringify(json));
    return dir;
};
const good = {
    name: "Eval #2", claudeVersion: "2.1.300",
    pins: { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 80, maxBudgetUsd: 4, sessionMaxBudgetUsd: 10 },
    repos: { vscode: { path: "../vscode", commit: "cc3fec8846d0e678357e476fa611774da26d7e24", slug: "microsoft/vscode" } },
    arms: ["baseline", "nebulosity"], repeats: 3, scripts: true, pilot: ["vscode-cn1"],
};

describe("loadDefinition", () => {
    it("reads a whole definition", () => {
        expect(loadDefinition(write(good))).toEqual({ ...good, dir: expect.any(String) });
    });

    it("refuses an unknown arm, a repeat count outside 1–3, and a commit that isn't a full sha, each in a sentence", () => {
        expect(() => loadDefinition(write({ ...good, arms: ["baseline", "other"] }))).toThrow('eval.json: arms may be "baseline", "nebulosity" and "nebulosity-upfront", not "other".');
        expect(() => loadDefinition(write({ ...good, repeats: 4 }))).toThrow("eval.json: repeats is 1, 2 or 3.");
        expect(() => loadDefinition(write({ ...good, repos: { vscode: { ...good.repos.vscode, commit: "cc3fec88" } } }))).toThrow("eval.json: repo vscode's commit must be a full 40-character sha.");
    });
});
```

`scripts/eval/run-config.test.ts`, new tests:

```ts
it("allows node scripts and edits under the run's scratch folder when scripts are on, and denies edits otherwise", () => {
    const scratch = "C:/Users/Ann/Nebulosity/.nebulosity/eval2/scratch/vscode-cn1-baseline-1";
    const args = claudeArgs("baseline", { empty: "e.json", nebulosity: "n.json" }, PINS, { scratch });
    const allowed = args[args.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).toContain("Bash(node:*)");
    expect(allowed).toContain("Edit(//c/Users/Ann/Nebulosity/.nebulosity/eval2/scratch/vscode-cn1-baseline-1/**)");
    expect(args[args.indexOf("--disallowedTools") + 1].split(",")).toEqual(["NotebookEdit", "WebFetch", "WebSearch", "Skill", "PowerShell", "Monitor"]);
    expect(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2)).toEqual(["--add-dir", scratch]);
    expect(claudeArgs("baseline", { empty: "e.json", nebulosity: "n.json" })).not.toContain("--add-dir");
});

it("writes a rule's absolute path as // and the path, with a Windows drive as its letter", () => {
    expect(scratchRule("C:/a b/scratch")).toBe("//c/a b/scratch/**");
    expect(scratchRule("/home/ann/scratch/")).toBe("//home/ann/scratch/**");
});

it("adds the scratch sentence after the format line (R6)", () => {
    expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." }, "C:/s")).toBe(
        "Q?\n\nEnd with ANSWER.\n\nYou may write and run Node.js scripts in C:/s (and nowhere else); don't change any file in the repository.");
    expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." })).toBe("Q?\n\nEnd with ANSWER.");
});

it("schedules two arms without the up-front run when asked, alternating which goes first over three repeats", () => {
    const runs = schedule(["a", "b"], 3, ["a", "b"], { upfront: false }).map(runName);
    expect(runs).toEqual([
        "a-baseline-1", "a-nebulosity-1", "b-nebulosity-1", "b-baseline-1",
        "a-nebulosity-2", "a-baseline-2", "b-baseline-2", "b-nebulosity-2",
        "a-baseline-3", "a-nebulosity-3", "b-nebulosity-3", "b-baseline-3",
    ]);
});
```

`scripts/eval/validate.test.ts`, a new test:

```ts
it("with scripts on, expects Edit and Write and still refuses the web, skills and PowerShell", () => {
    const run = { ...okNebulosity, tools: [...okNebulosity.tools, "Edit", "Write"] };
    expect(validateInit(run, { ...expectNebulosity, scripts: true })).toEqual([]);
    expect(validateInit({ ...run, tools: [...run.tools, "WebFetch"] }, { ...expectNebulosity, scripts: true })).toEqual(["WebFetch is present"]);
    expect(validateInit(okNebulosity, { ...expectNebulosity, scripts: true })).toEqual(["Edit is missing", "Write is missing"]);
});
```

(`okNebulosity` and `expectNebulosity` are the test file's existing passing init and expectation, or two small fixtures beside them if it has none. The existing tests pass `scripts: false`.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval`
Expected: FAIL.

- [ ] **Step 3: `scripts/eval/definition.ts`**

```ts
/** An eval's fixed setup (V1.6's plan, D2): what every script of scripts/eval reads from <dir>/eval.json. */
import fs from "fs";
import path from "path";

export type ArmName = "baseline" | "nebulosity" | "nebulosity-upfront";
export type EvalDefinition = {
    name: string;
    /** The folder holding eval.json, questions, truths, runs and grading (eval for Eval #1, eval2 for Eval #2). */
    dir: string;
    claudeVersion: string;
    pins: { model: string; effort: string; maxTurns: number; maxBudgetUsd: number; sessionMaxBudgetUsd: number };
    /** Repo id → its checkout (relative to Nebulosity's), its commit and its owner/name. */
    repos: Record<string, { path: string; commit: string; slug: string }>;
    arms: ArmName[];
    repeats: number;
    /** Node scripts and edits allowed under a fresh scratch folder per run (R6). */
    scripts: boolean;
    pilot: string[];
};

const ARMS: readonly ArmName[] = ["baseline", "nebulosity", "nebulosity-upfront"];

export function loadDefinition(dir: string): EvalDefinition {
    const file = path.join(dir, "eval.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<EvalDefinition>;
    const fail = (why: string): never => { throw new Error(`eval.json: ${why}`); };
    if (typeof raw.name !== "string" || typeof raw.claudeVersion !== "string") fail("name and claudeVersion are strings.");
    const pins = raw.pins;
    if (!pins || typeof pins.model !== "string" || typeof pins.effort !== "string" || !(pins.maxTurns! > 0) || !(pins.maxBudgetUsd! > 0) || !(pins.sessionMaxBudgetUsd! > 0)) fail("pins needs model, effort, maxTurns, maxBudgetUsd and sessionMaxBudgetUsd.");
    for (const arm of raw.arms ?? []) if (!ARMS.includes(arm)) fail(`arms may be "baseline", "nebulosity" and "nebulosity-upfront", not "${arm}".`);
    if (!Array.isArray(raw.arms) || raw.arms.length === 0) fail("arms lists at least one arm.");
    if (raw.repeats !== 1 && raw.repeats !== 2 && raw.repeats !== 3) fail("repeats is 1, 2 or 3.");
    if (!raw.repos || Object.keys(raw.repos).length === 0) fail("repos names at least one repo.");
    for (const [id, repo] of Object.entries(raw.repos!)){
        if (typeof repo.path !== "string" || typeof repo.slug !== "string") fail(`repo ${id} needs a path and a slug.`);
        if (!/^[0-9a-f]{40}$/.test(repo.commit ?? "")) fail(`repo ${id}'s commit must be a full 40-character sha.`);
    }
    if (typeof raw.scripts !== "boolean" || !Array.isArray(raw.pilot)) fail("scripts is true or false, and pilot lists question ids.");
    return { ...(raw as EvalDefinition), dir: path.resolve(dir) };
}
```

`eval/eval.json` (Eval #1, as it ran):

```json
{
  "name": "Eval #1",
  "claudeVersion": "2.1.299",
  "pins": { "model": "claude-sonnet-5-5", "effort": "medium", "maxTurns": 80, "maxBudgetUsd": 4, "sessionMaxBudgetUsd": 4 },
  "repos": { "vscode": { "path": "../vscode", "commit": "cc3fec8846d0e678357e476fa611774da26d7e24", "slug": "microsoft/vscode" } },
  "arms": ["baseline", "nebulosity", "nebulosity-upfront"],
  "repeats": 2,
  "scripts": false,
  "pilot": ["bp4", "cl2", "cn3"]
}
```

`eval2/eval.json` (Eval #2; repo 2 from Task 1's pick; the version is pinned at the pilot, Task 21):

```json
{
  "name": "Eval #2",
  "claudeVersion": "pinned at the pilot",
  "pins": { "model": "claude-sonnet-5-5", "effort": "medium", "maxTurns": 80, "maxBudgetUsd": 4, "sessionMaxBudgetUsd": 10 },
  "repos": {
    "vscode": { "path": "../vscode", "commit": "cc3fec8846d0e678357e476fa611774da26d7e24", "slug": "microsoft/vscode" },
    "‹repo 2 id›": { "path": "../‹repo 2 folder›", "commit": "‹full sha›", "slug": "‹owner/name›" }
  },
  "arms": ["baseline", "nebulosity"],
  "repeats": 3,
  "scripts": true,
  "pilot": []
}
```

(`pilot` is filled in Task 14 with the questions' ids. `loadDefinition` accepts the placeholder version string. The runner refuses to start until it matches `claude --version`.)

- [ ] **Step 4: `run-config.ts`, `validate.ts`**

In `scripts/eval/run-config.ts`:
- `claudeArgs(arm, mcp, pins = PINS, options: { scratch?: string } = {})`. With `scratch`, the allowed list gains `"Bash(node:*)"` and `` `Edit(${scratchRule(options.scratch)})` ``. The disallowed list becomes `["NotebookEdit", "WebFetch", "WebSearch", "Skill", "PowerShell", "Monitor"]`, since a deny would beat the path rule. And `"--add-dir", options.scratch` goes before `--no-session-persistence`. Without `scratch`, nothing changes.
- Add:

```ts
/** A permission rule's absolute path (code.claude.com permissions: "//" then the path, a Windows drive as /c): everything under the folder. */
export function scratchRule(absPath: string): string {
    const slashed = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const drive = /^([A-Za-z]):\/(.*)$/.exec(slashed);
    return drive ? `//${drive[1].toLowerCase()}/${drive[2]}/**` : `/${slashed}/**`;
}

/** The text a run sends: the question, its family's format line, and with scripts on the scratch sentence (R6). */
export function promptFor(question: { prompt: string; family: string }, formats: Record<string, string>, scratch?: string): string {
    const base = `${question.prompt}\n\n${formats[question.family]}`;
    return scratch === undefined ? base : `${base}\n\nYou may write and run Node.js scripts in ${scratch} (and nowhere else); don't change any file in the repository.`;
}
```

- `schedule(questions, repeats, order = questions, options: { upfront: boolean } = { upfront: true })`: the up-front run is added only when `options.upfront` is true (Eval #1's default keeps its tests passing).

In `scripts/eval/validate.ts`, `validateInit`'s expectation gains `scripts: boolean`. With `scripts`, the required tools add `Edit` and `Write`, and the forbidden tools become `WebFetch`, `WebSearch`, `Skill`, `PowerShell` and `NotebookEdit`. Without it, they're as now.

- [ ] **Step 5: The CLIs read the definition**

Every eval CLI takes `--eval <dir>` (default `eval`) and reads `loadDefinition(<checkout>/<dir>)`.
- **`run.ts`:**
  - Each question may name a `repo`; Eval #1's questions don't, so they get the definition's only repo.
  - Before the first run, every repo the batch touches is checked: HEAD at its commit, `git status` clean. After each run, its own repo's status is checked.
  - The run's `cwd` is its repo.
  - `RUNS_DIR` is `<dir>/runs`, the raw folder is `.nebulosity/<dir>/raw`, and A's MCP config is `<dir>/mcp/empty.json`.
  - Nebulosity's MCP config is written to `.nebulosity/<dir>/mcp-nebulosity.json` as `{ "mcpServers": { "nebulosity": { "command": "node", "args": ["<checkout>/mcp/launch.mjs"], "env": { "NEBULOSITY_LIVE": "off" } } } }`, with no `alwaysLoad` (R4).
  - With `scripts`, each run gets `.nebulosity/<dir>/scratch/<run name>/` (removed and made empty first), passed to `claudeArgs` and `promptFor`.
  - Scrubbing replaces each repo's folder with `<repo id>` (`<vscode>` stays `<vscode>`), the checkout with `<nebulosity>`, and home with `~`.
  - The version pin is the definition's `claudeVersion`.
  - The schedule is `schedule(..., { upfront: def.arms.includes("nebulosity-upfront") })`, with `def.repeats`.
  - `--pilot` runs `def.pilot`.
  - Each index line gains `repo` and `indexVersion`. The latter is read from Nebulosity's database read-only before the run (`useReadOnlyDatabase()`, then `readIndexVersion`), which closes Eval #1's M15: the version was inferred, not recorded.
- **`score.ts`:** reads the definition for each repo's path, and writes `<dir>/results.json`.
- **`grading.ts`:** sheets in `<dir>/grading/sheets`, and the key in `.nebulosity/<dir>/grading-key.json`.
- **`probe.ts`:**
  - gains `--eval <dir>` and the configuration `n`: Nebulosity's registration, as the runner writes it, at the default tool search;
  - `a` and `n` run in each repo of the definition (`--repo <id>`);
  - `a-default` and `a-upfront` stay for Eval #1's check.

`package.json` needs no new scripts.

- [ ] **Step 6: Run the tests and see them pass, then check Eval #1 is unchanged**

Run: `npx vitest run scripts/eval`
Expected: PASS (about 8 new).

Then:
- `npm run eval:run -- --dry-run` says every one of Eval #1's 90 runs is already in `eval/runs`.
- `npm run eval:score -- --out .nebulosity/eval/rescore.json` re-scores Eval #1 in a scratch file. A short comparison (a scratch script) checks that every run's `score`, `recall`, `precision`, token counts, cost estimate and wall time equal `eval/results.json`'s. The printed headline table must equal EVAL_RESULTS's.

Any difference stops the task: Eval #1's numbers can't move.

- [ ] **Step 7: Gate, commit, push**

Run the gate (about 1001/1001). Then:
```bash
git add -A -- scripts/eval eval/eval.json eval2/eval.json package.json && git commit -m "feat(eval): eval definitions (repos, arms, pins, repeats, scripts allowed under a scratch folder); Eval #1 re-scores unchanged" -- scripts/eval eval/eval.json eval2/eval.json package.json && git push origin pivot/v1
```

### Task 9: Task sessions: several questions in one Claude Code process

**Files:**
- Modify: `scripts/eval/run.ts`, `scripts/eval/transcript.ts` (+ `transcript.test.ts`), `scripts/eval/run-config.ts` (+ test)
- Create: `scripts/eval/session.ts`, `scripts/eval/session.test.ts`

**Interfaces:**
- Produces:
  - `sessionArgs(...)` (`claudeArgs` plus `--input-format stream-json --replay-user-messages`);
  - `userMessage(text): string` (one stdin line);
  - `summarizeSession(jsonl): SessionSummary` (per turn: the final text, the cost, the time, the tool calls; and the totals);
  - `npm run eval:run -- --eval eval2 --sessions [--only <session ids>]`.
  - Tasks 11 and 21–22 use them.

- [ ] **Step 1: Ask for one probe run, then run it**

> Task 9 needs to see what Claude Code writes for a session of several messages, and to check that the scripts permission works. That's 1 `claude -p` run in `../vscode`, at the default settings, with `--input-format stream-json` and two messages:
> 1. "Write a file named probe.js in <scratch> that prints 42, run it with node, and reply with what it printed."
> 2. "Now try to create a file named probe.txt in the repository's root folder, and tell me whether you could."
>
> About $0.05 at list price. OK?

On a yes, run it by hand with the runner's pins, the scripts rules (Task 8) and the two messages. Write each message as one stdin line, `{"type":"user","message":{"role":"user","content":"<text>"}}`; send the second after the first `result` event appears. Keep the raw transcript in `.nebulosity/eval2/probe/`.

Record in the ledger:
- the event types and their order;
- whether each turn ends with its own `result` event, and whether its `total_cost_usd`, `duration_ms` and `num_turns` are that turn's or cumulative;
- that `probe.js` was written and ran (42);
- that writing into the repo was refused (`permission_denials`), and that `git -C ../vscode status --porcelain` is empty.

If either permission behaves otherwise, stop and tell the owner. D2's scripts rule can't be run as written then.

- [ ] **Step 2: Write the failing tests, from the probe's shapes**

`scripts/eval/session.test.ts` builds a hand-made two-turn transcript in the shape Step 1 recorded, and pins:
- `summarizeSession(...).turns` has 2 entries, each with its `finalText`, cost, time and tool calls. If the probe showed cumulative figures, each turn's figure is the difference from the turn before. The test states which, with the numbers taken from the hand-made transcript;
- the totals: the cost and time of the whole session, and the first call's context;
- `userMessage("hi")` is exactly `{"type":"user","message":{"role":"user","content":"hi"}}`;
- a session missing its last `result` is an outage (`infrastructureFailure` on the session's text says so).

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run scripts/eval/session.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `scripts/eval/session.ts` and the runner's `--sessions`**

`session.ts` holds the pure parts: `userMessage`, `summarizeSession`, and `SessionSummary = { turns: { finalText: string | null; costUsd: number; durationMs: number; toolCalls: Record<string, number>; nebulosityCalls: number }[]; costUsd: number; durationMs: number; firstCallContext: number | null }`.

The runner's `--sessions` mode reads `<dir>/sessions.json` (`{ sessions: [{ id, repo, title, questions: [<question ids>] }] }`, written in Task 14) and schedules each session × arm × repeat, alternating like single runs. For one session it:
- spawns `claude` with `sessionArgs` (the session budget `pins.sessionMaxBudgetUsd`, a 60-minute limit);
- writes the first question's prompt (`promptFor`, with the scratch sentence) as a `userMessage`;
- polls the raw file until a new `result` event appears (the same polling as the init check), then writes the next, and closes stdin after the last `result`;
- applies every check a single run gets (init, the repo's `git status`, outage, scrub, leak);
- keeps it as `<dir>/runs/<session>-<arm>-<repeat>.jsonl.gz`, with an index line carrying `session` and each turn's question id.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run scripts/eval`
Expected: PASS (about 5 new).

- [ ] **Step 6: Gate, commit, push**

Run the gate (about 1006/1006). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): task sessions, several questions in one Claude Code process over stream-json input" -- scripts/eval && git push origin pivot/v1
```

### Task 10: The truth for the new kinds, independent of the index (R2)

**Files:**
- Create: `scripts/eval/resolve-truth.ts` (+ test), `scripts/eval/ts-graph.ts` (+ test)
- Modify: `scripts/eval/scan.ts` (+ `scan.test.ts`), `scripts/eval/truth.ts` (+ `truth.test.ts`), `scripts/eval/build-truth.ts` (+ test)

**Interfaces:**
- Produces:
  - `createTruthResolver(root, files): (from, specifier) => string | null`;
  - `scanRepo(root, { resolveBare })`;
  - `computedSites(root, files)`;
  - `preProcessGraph(root, files, resolve)`;
  - in `truth.ts`: `impactByFolders`, `shortestCycle`, `filesNothingImports`, `importersWithin`, `rootsReaching`, `childPairs`, `namePairs`;
  - `build-truth --eval eval2`, reading `eval2/truth-specs.json` and writing `eval2/truth/<id>.json`, the evidence sheet, the disagreement sheet, the computed-site sheet and the sample sheet.
  - Task 14 runs it.

- [ ] **Step 1: Write the failing tests**

They all run on the arch-repo fixture, whose ground truth gives every expected value (the "truth builder" paragraph):
- `resolve-truth.test.ts`: `createTruthResolver(fixture, files)` resolves `@arch/core` → `packages/core/src/index.ts`, `@arch/core/lib/log` → `packages/core/src/log.ts`, `@arch/ui` → `packages/ui/src/index.ts`, `base/common/strings` (from `tools/fixtures/legacy-ids.ts`) → `src/base/common/strings.ts`, and `react` → null.
- `scan.test.ts`:
  - `scanRepo(fixture, { resolveBare })` (it walks when there's no `.git`; see Step 2) gives the 30 edges: the ground truth's 31 without #5;
  - `computedSites` gives `[{ file: "src/app/loader.ts", line: 5, expression: "url" }]`;
  - the R2 pin reads every specifier form of `scan.ts`, `truth.ts`, `resolve-truth.ts` and `ts-graph.ts` with `rank.test.ts`'s `moduleSpecifiers` reader, and refuses any that reaches `lib/`. It requires that `scan.ts` is seen importing something, so it can't pass by reading nothing. This closes Eval #1's M8.
- `ts-graph.test.ts`: `preProcessGraph` gives the same 30 edges.
- `truth.test.ts`, over the 31 edges (the 30 plus the adjudicated #5, written out in the test):
  - `impactByFolders(g, "src/base/common/strings.ts", ["src/app", "src/base", "src/editor", "src/platform"])` = `{ counts: [3, 4, 5, 3], elsewhere: 1, total: 16 }`;
  - `shortestCycle(g, "src/editor/common/model.ts")` = `[model, tokens, textModel, model]` (full paths), and `shortestCycle(g, "src/platform/common/storage.ts")` = `null`;
  - `filesNothingImports(g, "src", isTest)` = `["src/app/legacy.ts", "src/app/loader.ts"]`;
  - `importersWithin(g, "src/editor", "src/platform")` = `["src/platform/node/storageFile.ts"]`;
  - `rootsReaching(g, "src/base/common/strings.ts", isTest)` = `["src/app/legacy.ts", "src/app/loader.ts", "tools/fixtures/legacy-ids.ts"]`;
  - `childPairs(g, "src")` = the 7 pairs, and `namePairs(g, "src", ["common", "browser", "node"])` = the 6, both as `[from, to]` sorted.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`resolve-truth.ts`** is a second, independent implementation of ADR-053's rules, written from the ADR's text and never from `lib/index`'s code:
  - packages by `name` from every `package.json` (a real folder before a test, fixture or example folder, then the shallower);
  - an `exports` key exact or `*`;
  - `main`, `module` and `types`;
  - `src/<subpath>`;
  - a tsconfig's `outDir` → `rootDir` (read with TypeScript's `readConfigFile`);
  - module ids against the folders holding a `tsconfig*.json`, unique only;
  - the same extensions as `scan.ts`'s `resolveRelative`.
- **`scan.ts`:**
  - `scanRepo(root, options?: { resolveBare? })` resolves non-relative specifiers through `options.resolveBare` (none before, so Eval #1's truths are rebuilt unchanged).
  - It walks the tree when `root` has no `.git` (skipping `node_modules`), so the fixture can be scanned.
  - `computedSites` lists every `import(<identifier>)` (regex `\bimport\s*\(\s*([A-Za-z_$][\w$]*)\s*\)`, comment lines skipped as `importSpecifiers` does) with its line.
- **`ts-graph.ts`:** `preProcessGraph` reads each file's specifiers with `ts.preProcessFile(text, true, true).importedFiles` and resolves them the same way. It's the second extractor: it reads TypeScript's grammar, not a regex.
- **`truth.ts`:** the seven functions, each a few lines over `Graph`, in the style of `transitiveDependents`. `shortestCycle` is a breadth-first walk from the file's importees back to it, neighbours in path order. `namePairs` gives each file the deepest of the given names on its path below the folder.
- **`build-truth.ts --eval <dir>`:**
  - reads `<dir>/truth-specs.json` (`[{ id, repo, kind, …the kind's fields }]`) and `<dir>/eval.json`'s repos;
  - builds two graphs per repo (the scanner, and `preProcessGraph`), each with the truth resolver;
  - writes `<dir>/truth/<id>.json` per spec from the scanner graph plus `<dir>/truth/adjudicated.json`'s verdicts, computed sites included once decided;
  - writes, in `.nebulosity/<dir>/` (gitignored):
    - `truth-evidence.md`: each list entry's and chain step's import line;
    - `truth-disagreements.md`: every edge one graph has and the other lacks, with its line;
    - `computed-sites.md`;
    - `truth-sample.md`: 30 edges per repo, chosen by a fixed seed from the edges the truths rest on.

  It never overwrites a truth file that has `verified: true` unless `--force` is given.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run scripts/eval`
Expected: PASS (about 14 new).

- [ ] **Step 5: Check it doesn't move Eval #1's truths**

Run `npm run eval:truth -- ../vscode` (Eval #1's definition, the default) with no `--force`. Every truth file is kept as checked, and the run's printed sizes equal eval/truth's. Then run the builder into a scratch folder (`--out .nebulosity/eval/rebuild`) with the bare resolver on. It reports the differences against eval/truth (expected: exactly the 8 entries the "refers to" call added by reading, now found by the resolver). The differences go in the ledger.

- [ ] **Step 6: Gate, commit, push**

Run the gate (about 1020/1020). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): the truth's own resolver, a second extractor and the new kinds' truths, all independent of the index (R2)" -- scripts/eval && git push origin pivot/v1
```

### Task 11: Scoring the new kinds and sessions, and the gate (D1)

**Files:**
- Create: `scripts/eval/gate.ts`, `scripts/eval/gate.test.ts`
- Modify: `scripts/eval/answer.ts` (+ `answer.test.ts`), `scripts/eval/score.ts` (+ `score.test.ts`)

**Interfaces:**
- Produces:
  - `scoreCounts(answer, truth)`, `f1(answer, truth)`, `scoreCycle(paths, truth, imports)`, `scorePairs(lines, truth)`;
  - `QuestionKind`;
  - `gateVerdict(runs, sessions): Verdict`.
  - `npm run eval:score -- --eval eval2` prints the tables and the gate. Tasks 22 and 24 use it.

- [ ] **Step 1: Write the failing tests**

`scripts/eval/answer.test.ts`, new tests, each hand-built:

```ts
it("scores counts per line as 1 − the relative error, floored at 0, missing lines 0", () => {
    const answer = "Some text\nANSWER:\nsrc/app: 3\nsrc/base: 2\nelsewhere: 1\ntotal: 20";
    const truth = { counts: [["src/app", 3], ["src/base", 4], ["src/editor", 5]] as [string, number][], elsewhere: 1, total: 16 };
    // src/app 1; src/base 1 − 2/4 = 0.5; src/editor missing 0; elsewhere 1; total 1 − 4/16 = 0.75 → mean 3.25 / 5
    expect(scoreCounts(answerSection(answer)!, truth)).toBeCloseTo(0.65, 10);
});

it("scores F1 over a list", () => {
    expect(f1(["a", "b", "x"], ["a", "b", "c", "d"])).toBeCloseTo(2 * (2 / 3) * (2 / 4) / ((2 / 3) + (2 / 4)), 10);
    expect(f1([], [])).toBe(1);
    expect(f1(["a"], [])).toBe(0);
});

it("reads pairs written 'a -> b' or with an arrow, in any case and spacing", () => {
    expect(scorePairs(["common -> browser", "node→common", " Browser ->  browser "], [["browser", "browser"], ["common", "browser"], ["node", "common"], ["node", "node"]]))
        .toBeCloseTo(2 * 1 * 0.75 / 1.75, 10);
});

it("scores a cycle: 1 shortest, 0.5 longer, 1 a right none, 0 a wrong none or an invalid step", () => {
    const edges = new Set(["m>t", "t>x", "x>m", "m>y", "y>z", "z>m"]);
    const imports = (a: string, b: string): boolean | null => edges.has(`${a}>${b}`);
    expect(scoreCycle(["m", "t", "x", "m"], { file: "m", shortest: 3 }, imports)).toBe(1);
    expect(scoreCycle(["m", "y", "z", "m", "t", "x", "m"], { file: "m", shortest: 3 }, imports)).toBe(0.5);
    expect(scoreCycle("none", { file: "s", shortest: null }, imports)).toBe(1);
    expect(scoreCycle("none", { file: "m", shortest: 3 }, imports)).toBe(0);
    expect(scoreCycle(["m", "x", "m"], { file: "m", shortest: 3 }, imports)).toBe(0);
});
```

`scripts/eval/gate.test.ts` builds runs with a helper and pins each condition:

```ts
import { describe, expect, it } from "vitest";
import { gateVerdict, type GateRun, type GateSession } from "./gate";

const run = (question: string, kind: GateRun["kind"], arm: GateRun["arm"], score: number, costUsd: number, wallMs: number, nebulosityCalls: number, firstCallContext: number, repo = "r"): GateRun =>
    ({ question, repo, kind, arm, repeat: 1, score, costUsd, wallMs, nebulosityCalls, firstCallContext });
const session = (arm: GateSession["arm"], score: number, costUsd: number, wallMs: number): GateSession => ({ session: "s1", repo: "r", arm, repeat: 1, score, costUsd, wallMs });

// one repo; per kind one A run and one N run
const passing: GateRun[] = [
    run("g1", "impact", "baseline", 0.5, 0.40, 100_000, 0, 20_000), run("g1", "impact", "nebulosity", 0.9, 0.10, 20_000, 1, 21_500),
    run("g2", "cycle", "baseline", 0.5, 0.30, 80_000, 0, 20_000), run("g2", "cycle", "nebulosity", 1.0, 0.05, 10_000, 1, 21_500),
    run("c1", "chain", "baseline", 1.0, 0.10, 30_000, 0, 20_000), run("c1", "chain", "nebulosity", 1.0, 0.03, 9_000, 1, 21_500),
    run("l1", "list-direct", "baseline", 1.0, 0.08, 25_000, 0, 20_000), run("l1", "list-direct", "nebulosity", 1.0, 0.08, 24_000, 1, 21_500),
    run("b1", "bigPicture", "baseline", 0.9, 0.02, 13_000, 0, 20_000), run("b1", "bigPicture", "nebulosity", 0.9, 0.022, 13_000, 0, 21_500),
];
const sessions = [session("baseline", 0.8, 1.0, 300_000), session("nebulosity", 0.85, 0.4, 100_000)];

describe("gateVerdict", () => {
    it("passes when every condition holds, and says each one's numbers", () => {
        const v = gateVerdict(passing, sessions);
        expect(v.conditions.map((c) => `${c.id} ${c.pass}`)).toEqual(["1 true", "2 true", "3a true", "3b true", "4 true", "5a true", "5b true"]);
        expect(v.pass).toBe(true);
        expect(v.conditions[0].values).toEqual({ a: 0.5, n: 0.95, margin: 0.45, worstQuestion: 0.4 });
    });

    it("fails 2 when a family drops by more than 0.03 on a repo", () => {
        const worse = passing.map((r) => (r.question === "b1" && r.arm === "nebulosity" ? { ...r, score: 0.85 } : r));
        expect(gateVerdict(worse, sessions).conditions.find((c) => c.id === "2")!.pass).toBe(false);
    });

    it("fails 5a when a graph run of N calls no Nebulosity tool", () => {
        const unused = passing.map((r) => (r.question === "l1" && r.arm === "nebulosity" ? { ...r, nebulosityCalls: 0 } : r));
        const c = gateVerdict(unused, sessions).conditions.find((x) => x.id === "5a")!;
        expect(c.values.share).toBeCloseTo(3 / 4, 10);
        expect(c.pass).toBe(false);
    });

    it("fails 5b when N's first call is more than 2,500 tokens above A's", () => {
        const heavy = passing.map((r) => (r.arm === "nebulosity" ? { ...r, firstCallContext: 22_600 } : r));
        expect(gateVerdict(heavy, sessions).conditions.find((c) => c.id === "5b")!.values).toEqual({ a: 20_000, n: 22_600, difference: 2_600 });
    });
});
```

(In `passing`, every number can be checked by hand against D1:
- 1: grep-hard means 0.5 and 0.95, margin 0.45; the worst question's margin is 0.4 (impact).
- 2: big-picture 0.9 against 0.9, lists 1 against 1, chains 1 against 1.
- 3a: over the graph runs (impact, cycle, chain), A's median cost $0.30 and N's $0.05; A's median wall 80 s and N's 10 s.
- 3b: over big-picture and direct lists, A's median cost $0.05 and N's $0.051, a ratio of 1.02.
- 4: N's session cost is 0.4 of A's and its time 0.33; scores 0.85 against 0.8.
- 5a: N calls a tool in 4 of its 4 list, chain and grep-hard runs.
- 5b: medians 20,000 and 21,500, a difference of 1,500.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/eval/answer.test.ts scripts/eval/gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`answer.ts`:**
  - `scoreCounts(section, truth)` reads `<name>: <number>` lines (numbers may have thousands separators), matching the truth's folder names, then `elsewhere` and `total`, case-insensitively.
  - `f1(listed, truth)`: no truth and nothing listed is 1; one empty side is 0.
  - `scorePairs(lines, truth)` reads `a -> b`, `a → b` or `a->b` and lowercases both names.
  - `scoreCycle(paths | "none", { file, shortest }, imports)`: valid means it starts and ends at the file, every step is real, and it's at least 2 steps. A valid cycle shorter than the truth's is flagged, as a short chain is.
- **`gate.ts`** exports `QuestionKind = "bigPicture" | "list-direct" | "list-transitive" | "chain" | "impact" | "cycle" | "unused" | "violations" | "entries" | "pairs"`, `GREP_HARD`, `GRAPH = ["chain", "list-transitive", ...GREP_HARD]`, `OTHER = ["bigPicture", "list-direct"]`, and the types above. `gateVerdict(runs, sessions)` computes D1's seven conditions exactly as D1 defines them, in its order, each `{ id, scope, values, pass, text }`:
  - means and medians over every matching run (median: the mean of the two middle values for an even count);
  - conditions 2, 3a, 3b, 4 and 5b per repo, failing if any repo fails, with `values` taken from the worst repo and `scope` naming it;
  - a family with no runs on a repo isn't compared there;
  - `values` rounded to 4 decimal places (0.95 − 0.5 reads 0.45);
  - `text` a sentence with the numbers;
  - `pass` all seven.
- **`score.ts`:**
  - scores each run by its question's `kind` (Eval #1's questions keep their families: `list` becomes `list-direct` or `list-transitive` by the truth's scope);
  - scores sessions turn by turn;
  - writes `firstCallContext` per run into `<dir>/results.json`;
  - prints, for `--eval eval2`, the tables per repo and family, the sessions' totals, and the gate (`gateVerdict`), condition by condition, then PASS or FAIL.

  Eval #1's printed tables must stay as they were: re-check with Task 8's comparison.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run scripts/eval`
Expected: PASS (about 10 new).

- [ ] **Step 5: Gate, commit, push**

Run the gate (about 1030/1030). Then:
```bash
git add -A -- scripts/eval && git commit -m "feat(eval): scores for counts, cycles, F1 lists, pairs and sessions; the ship gate computed from the results (D1)" -- scripts/eval && git push origin pivot/v1
```

---

## Part 3 — The tool surface, tuned on a dev set

### Task 12: Six tools, five always loaded, new instructions, a size budget (ADR-056)

**Files:**
- Modify: `lib/tools/registry.ts` (+ `registry.test.ts`), `mcp/server.ts` (+ `server.test.ts`), `scripts/bench-mcp.ts`
- Modify: `docs/API_CONTRACTS.md` §17, `docs/ENGINEERING_DECISIONS.md` (ADR-056; ADR-047 amended), `docs/PIVOT_SPEC.md` §6.2, `README.md` (the tool list), `docs/BENCHMARKS.md` (MCP Benchmark #3)

**Interfaces:**
- Consumes: `reach`, `importChain`, `impact`, `architecture`, `reachAnswer`, `reachHeader`, `rootLines`, `impactAnswer`, `chainAnswer`, `architectureAnswer` (Tasks 5–7).
- Produces:
  - the registry's six tools (`overview`, `describe`, `search`, `imports`, `architecture`, `show_on_map`);
  - `ToolEntry.alwaysLoad` and `ToolEntry.searchHint`;
  - `toolMeta(tool)` in `mcp/server.ts`;
  - the new `SERVER_INSTRUCTIONS`.
  - Task 13 tunes their wording.

- [ ] **Step 1: Write the failing tests**

In `lib/tools/registry.test.ts`:
- Every existing test of `dependents`, `dependencies` or `path` calls `imports` instead, with `direction` (and `to` for a chain), and expects the same text. The answers' wording didn't change.
- New tests:

```ts
it("serves six tools, the five that answer questions loaded into every prompt (ADR-056)", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["overview", "describe", "search", "imports", "architecture", "show_on_map"]);
    expect(TOOLS.filter((t) => t.alwaysLoad).map((t) => t.name)).toEqual(["overview", "describe", "search", "imports", "architecture"]);
    expect(TOOLS.find((t) => t.name === "show_on_map")!.searchHint).toBe("map highlight focus show point visualize");
});

it("keeps what every session loads under 7,000 characters: the five definitions and the instructions", () => {
    const chars = TOOLS.filter((t) => t.alwaysLoad)
        .reduce((sum, t) => sum + JSON.stringify({ name: `mcp__nebulosity__${t.name}`, description: t.description, input_schema: z.toJSONSchema(t.inputSchema) }).length, 0);
    expect(chars + SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(7_000);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2_048);   // within the old cap too, for older Claude Code
});
```

- On the arch-repo fixture (indexed with no key, as the file's other tests index theirs), one test per mode of `imports`, each expecting the ground truth's text (Tasks 6 and 7 pinned those texts):
  - `{ path: "src/base/common/strings.ts", transitive: true, group_by: "src" }` gives the impact text;
  - `{ path: "src/editor", within: "src/platform" }` gives the within header;
  - `{ path: "src/app/loader.ts", to: "src/base/common/strings.ts" }` gives a chain.
  - `architecture` with `{ path: "src" }` gives the summary text, and with `{ path: "src/editor/common/model.ts", report: "cycles" }` the cycle through it.

In `mcp/server.test.ts`, the first test becomes:

```ts
it("serves the registry's six tools, read-only, the five that answer questions marked always loaded", async () => {
    const { client } = await connect({ projectDir: mapShowing(), live: true });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const tool of tools){
        const entry = TOOLS.find((t) => t.name === tool.name)!;
        expect(tool._meta).toEqual(entry.alwaysLoad ? { "anthropic/alwaysLoad": true } : { "anthropic/searchHint": entry.searchHint });
    }
});
```

Tests that called the old tools through the client move to `imports`, and the live-event tests expect `tool: "imports"` with the same paths.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/tools mcp`
Expected: FAIL.

- [ ] **Step 3: The registry**

In `lib/tools/registry.ts`:
- `ToolEntry` gains:

```ts
    /** Loaded into every session's prompt (ADR-056): mcp/server.ts marks it `_meta["anthropic/alwaysLoad"]`. */
    alwaysLoad: boolean;
    /** A deferred tool's words for Claude Code's ToolSearch (`_meta["anthropic/searchHint"]`). */
    searchHint?: string;
```

- The instructions:

```ts
/** Sent once per session (MCP's `instructions`; Claude Code keeps 4,096 characters since 2.1.296, 2,048 before). */
export const SERVER_INSTRUCTIONS = [
    "Nebulosity has indexed this repository: its folder tree, every import between its files, its docs and which folders they describe, and, when summaries are on, a short summary of every file and folder.",
    "Call these tools before grep or reading many files when a question is about how the code is organized or connected. They answer from the whole repo, exactly, in one call:",
    "- imports: what imports a file or folder, or what it imports, directly or through other files; group_by counts what a change would affect, by area; to gives the import chain between two places;",
    "- architecture: a folder's layers and the imports against them, its folder conventions, import cycles, and files nothing imports;",
    "- describe: what a folder or file is, what it uses and what uses it, and the docs that describe it;",
    "- overview: an unfamiliar repo's areas and the docs to read first;",
    "- search: where a feature or concept lives.",
    'Read the docs they point to for the repo\'s own rules. Paths are relative to the repo root ("" is the root) or absolute inside it.',
].join("\n");
```

- The descriptions of the three tools that stay:
  - `overview`: `"Start here on an unfamiliar repository: its size and summary, its top-level areas, the docs to read first (its own guides and rules), and the files most others import."`
  - `describe`: `"What a folder or file is: its summary, size, what's inside (or a file's declarations), the areas it imports from and is imported by with exact counts, and the docs that describe it. Read those docs for the area's rules."`
  - `search`: `"Find where a feature or concept lives, by keywords or meaning, across code, summaries, file and folder names, and declarations: the best files and folders with their best-matching code. Use Grep for an exact string."`
  - Each gets `alwaysLoad: true`.
  - `show_on_map` keeps its description and gets `alwaysLoad: false, searchHint: "map highlight focus show point visualize"`.
- `imports` replaces `dependents`, `dependencies` and `path`:

```ts
const importsInput = z.object({
    path: repoPath,
    direction: z.enum(["dependents", "dependencies"]).default("dependents").describe("dependents: the files that import it; dependencies: the files it imports."),
    transitive: z.boolean().default(false).describe("Also count files reached through other files."),
    to: repoPath.optional().describe("Instead: the shortest chain of imports between path and this file or folder, either way."),
    group_by: z.string().max(1024).optional().describe('Count everything reached by area instead of listing it: a folder whose children are the areas ("" the top level), or "auto".'),
    within: z.string().max(1024).optional().describe("Only files inside this folder."),
    limit: z.number().int().min(1).max(500).default(50).describe("How many files to list, 1 to 500."),
    offset: z.number().int().min(0).default(0).describe("Where the next page starts."),
});
const importsTool: ToolEntry<typeof importsInput> = {
    name: "imports",
    alwaysLoad: true,
    description: "Exact answers from the repo's whole import graph, in one call. What imports a file or folder (dependents) or what it imports (dependencies); transitive: true adds files reached through others. group_by counts them by area: what a change would affect, with the tests and the entry points that load it. within keeps only files inside a folder. to gives the shortest import chain between two places. Prefer it to grep for all of these.",
    inputSchema: importsInput,
    async handler(input, context){
        const target = repoPathOf(input.path, context);
        if (input.to !== undefined){
            const answer = importChain(context.repoRoot, target, repoPathOf(input.to, context));
            const middle = answer.files.filter((file) => file !== answer.from && file !== answer.to);
            return { text: finish(chainAnswer(answer), context), paths: [answer.from, answer.to, ...middle] };
        }
        const within = input.within === undefined ? undefined : repoPathOf(input.within, context);
        const page = { transitive: input.transitive, limit: input.limit, offset: input.offset };
        if (input.group_by !== undefined){
            const groupBy = input.group_by === "auto" ? null : repoPathOf(input.group_by, context);
            // grouping counts everything a change reaches, so it's always transitive
            return { text: finish(impactAnswer(impact(context.repoRoot, target, input.direction, { groupBy, within })), context), paths: [target] };
        }
        if (input.direction === "dependents" && input.transitive){
            const i = impact(context.repoRoot, target, "dependents", { groupBy: null, within });
            return { text: finish(reachAnswer(i.reach, page, rootLines(i.tests, i.roots)), context), paths: [target] };
        }
        return { text: finish(reachAnswer(reach(context.repoRoot, target, input.direction, { within }), page), context), paths: [target] };
    },
};
```

- `architecture`:

```ts
const architectureInput = z.object({
    path: repoPath.default(""),
    report: z.enum(["summary", "layers", "conventions", "cycles", "unused"]).default("summary")
        .describe("summary: all four in brief; layers, conventions, cycles or unused: one in full."),
    through: z.string().max(1024).optional().describe("With cycles: the shortest import cycle through this file."),
    limit: z.number().int().min(1).max(500).default(20).describe("How many cycles or files to list."),
    offset: z.number().int().min(0).default(0).describe("Where the next page starts."),
});
const architectureTool: ToolEntry<typeof architectureInput> = {
    name: "architecture",
    alwaysLoad: true,
    description: "How code under a folder is organized, computed from its imports: its parts in layers and the imports that go against them (layers); which recurring folder names, like common/browser/node, import which (conventions); import cycles (cycles; through: one file's shortest cycle); files nothing imports (unused). summary gives all four in brief.",
    inputSchema: architectureInput,
    async handler({ path: raw, report, through, limit, offset }, context){
        const target = repoPathOf(raw, context);
        const answer = architecture(context.repoRoot, target, report, through === undefined ? {} : { through: repoPathOf(through, context) });
        return { text: finish(architectureAnswer(answer, { limit, offset }), context), paths: [target] };
    },
};
```

- `TOOLS` becomes `[overviewTool, describeTool, searchTool, importsTool, architectureTool, showOnMapTool]`.

- [ ] **Step 4: The server marks them**

In `mcp/server.ts`:

```ts
/** What Claude Code reads from a tool's _meta (ADR-056): load it into every prompt, or the words its ToolSearch matches. */
export function toolMeta(tool: ToolEntry): Record<string, unknown> {
    if (tool.alwaysLoad) return { "anthropic/alwaysLoad": true };
    return tool.searchHint ? { "anthropic/searchHint": tool.searchHint } : {};
}
```

In `createServer`, the `registerTool` config gains `_meta: toolMeta(tool)`. Import the `ToolEntry` type from the registry.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run`
Expected: PASS (about 8 new; the moved tests pass with their old expected texts).

- [ ] **Step 6: S5 again: MCP Benchmark #3**

In `scripts/bench-mcp.ts`, replace the calls to `dependents`, `dependencies` and `path` with `imports` in the same modes. Add:
- `imports` with `group_by: "src/vs"` on `src/vs/platform/storage/common/storage.ts`;
- `architecture` on `src/vs` (summary), and with `report: "cycles"` on `src/vs/workbench/contrib`.

Run: `npm run bench-mcp -- ../vscode`
Expected: every tool's worst warm call ≤ 500 ms. Record MCP Benchmark #3 in `docs/BENCHMARKS.md`.

- [ ] **Step 7: Docs**

- `API_CONTRACTS.md` §17: the tool table rewritten for the six tools, each with its input and its answer as the ground truth gives it; the paging rules; `_meta` (always loaded, search hint); and the instructions' cap, now 4,096 characters since Claude Code 2.1.296.
- `PIVOT_SPEC.md` §6.2's table: the six tools.
- `README.md`: "Six MCP tools for Claude Code: `overview`, `describe` (with the docs about a place), `search`, `imports` (dependents, dependencies, what a change affects, import chains), `architecture` (layers, conventions, cycles, files nothing imports) and `show_on_map`."
- ADR-047, at its end:

```markdown
**Amended (‹today›, V1.6):** an entry also says whether every session loads it (`alwaysLoad`) or a deferred tool's search words (`searchHint`); the MCP adapter turns them into `_meta` (ADR-056). The answers' rules are unchanged.
```

- ADR-056:

```markdown
## ADR-056 — Six tools, five always loaded, instructions as the setup-free guide, a size budget (‹today›) — amends ADR-047 and PIVOT_SPEC.md §6.2

**Context:** At Claude Code's default, MCP tools are deferred behind ToolSearch, and in Eval #1 the model loaded Nebulosity's in 12 of 30 runs. That was never on a big-picture question, and never on a list of direct importers, where one run missed 9 of 22 files with a grep pattern. Turning tool search off for everything (the U arm) got them used in 22 of 30, but it loads Claude Code's own deferred tools too (Task 3's correction). Claude Code 2.1.300 lets a server mark a tool always loaded with `_meta["anthropic/alwaysLoad"]`, and a registration can set `"alwaysLoad": true`. V1.6 also adds impact and architecture (ADR-055), which would make nine tools.
**Decision:**
- **Six tools:** `overview`, `describe`, `search`, `imports` (dependents, dependencies, impact with `group_by`, `within`, chains with `to`) and `architecture` (summary, layers, conventions, cycles, unused), plus `show_on_map`.
- **The five that answer questions carry `_meta["anthropic/alwaysLoad"]: true`.** `show_on_map` stays deferred with a search hint, since it matters only while the Map is open. Registrations carry no `alwaysLoad` (R4): the registration's flag would load `show_on_map` too for local-scope servers.
- **The server's instructions are the guide** (R5): when to reach for each tool, in under 2,048 characters. No CLAUDE.md snippet is written into a repo, because a CLAUDE.md hides an AGENTS.md from Claude Code. `nebulosity setup` prints an optional one.
- **A size budget:** the five definitions and the instructions stay under 7,000 characters (a test). Gate condition 5b measures the real per-turn cost: N's first call at most 2,500 tokens above A's.
- The wording was tuned on a dev set of questions, never on Eval #2's (R1; Task 13 records each round).
**Alternatives:** (a) Keep seven tools and add two: more names to choose between, and more tokens every turn. (b) One tool for everything: the model can't see what it does without reading a long description every turn. (c) Ask users to switch tool search off: it loads every deferred tool, Claude Code's own included, about 13,000 tokens a turn in Eval #1. (d) A CLAUDE.md snippet: hides AGENTS.md, and a repo file is the user's to write.
**Consequences:** MCP clients that called `dependents`, `dependencies` or `path` must call `imports` (the README and API_CONTRACTS.md §17 say how). The definitions take ‹n› characters and the instructions ‹n› (test). On VS Code every tool's worst warm call is ‹ms› ms (MCP Benchmark #3; S5 ≤ 500 ms). Task 13 measures the tool-use share and the per-turn cost.
**Revisit when:** the dev set or Eval #2 shows a tool chosen wrongly or ignored, or Claude Code changes how it loads MCP tools.
```

- [ ] **Step 8: Gate, commit, push**

Run the gate (about 1038/1038). Then:
```bash
git add -A -- lib/tools mcp/server.ts mcp/server.test.ts scripts/bench-mcp.ts docs/API_CONTRACTS.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md README.md docs/BENCHMARKS.md && git commit -m "feat(tools): six tools, imports and architecture new, five always loaded through _meta, new instructions under a size budget (ADR-056)" -- lib/tools mcp/server.ts mcp/server.test.ts scripts/bench-mcp.ts docs/API_CONTRACTS.md docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md README.md docs/BENCHMARKS.md && git push origin pivot/v1
```

### Task 13: The dev set: tool use and per-turn cost, tuned before Eval #2 exists (R1)

**Files:**
- Create: `eval2/dev/questions.json`
- Modify: `scripts/eval/run.ts` (`--dev`), `lib/tools/registry.ts` (the wording, only if a round changes it), `docs/BENCHMARKS.md` (MCP Dev Set #1)

- [ ] **Step 1: Write the dev set**

`eval2/dev/questions.json` holds the same shape as Eval #2's questions, marked `"dev": true`: 16 questions, 8 per repo. They need no truth: the dev set measures whether and how the tools get used, never a score.

VS Code:
1. impact: `src/vs/platform/clipboard/common/clipboardService.ts`, per `src/vs/base`, `src/vs/platform`, `src/vs/editor`, `src/vs/workbench`, elsewhere, total.
2. a transitive list: every file that depends on `src/vs/editor/contrib/folding/browser/folding.ts`.
3. cycle: through `src/vs/base/common/observableInternal/map.ts`.
4. unused: `src/vs/platform/files`.
5. violations: the files in `src/vs/base` that import a file in `src/vs/platform`.
6. entries: the non-test files nothing imports that end up loading `src/vs/workbench/contrib/markers/browser/markersView.ts`.
7. pairs: the environment folders under `src/vs/platform` (common, browser, node, electron-browser, electron-utility, electron-main).
8. chain: from `src/vs/code/electron-main/main.ts` to `src/vs/platform/log/common/log.ts`.

Repo 2: the same eight kinds on targets the planning scan picks the same way. Each prompt uses Eval #2's templates (Task 14 Step 1) and its format lines, so a dev answer looks like an eval answer.

None of these targets may appear in Eval #2 (R1), Eval #1's 15 questions included. Task 14's check refuses any overlap.

- [ ] **Step 2: `--dev` in the runner**

`npm run eval:run -- --eval eval2 --dev [--arms nebulosity] [--only <ids>]` reads `<dir>/dev/questions.json`, runs one repeat of the arms asked (default `nebulosity`) with every check a real run gets, and keeps the transcripts in `<dir>/dev/runs`.

- [ ] **Step 3: Ask, then round 1**

> Task 13 runs the dev set: 16 runs of Claude Code with Nebulosity (8 per repo), plus 4 one-turn probes (Claude Code alone and with Nebulosity, in each repo) for the per-turn cost. That's 20 runs, about $1–2 at list price. Up to two more rounds of at most 16 runs follow, only if the tools go unused on some questions, after a wording change I'd show you. That makes 56 runs at most. OK?

On a yes: `npm run eval:run -- --eval eval2 --dev`, then `npm run eval:probe -- --eval eval2 --config a,n --repo vscode` and the same for repo 2.

Record per run: whether a Nebulosity tool was called, which one and with what input, whether ToolSearch was called (it shouldn't be for the five tools), the turns, the cost estimate and the first call's context. Also record the probes' first-call contexts and their differences.

- [ ] **Step 4: Tune only if needed, at most three rounds**

Target: a Nebulosity tool called in at least 15 of the 16 runs (0.90 or more, gate condition 5a), and the probes' difference at most 2,500 tokens (5b).

If a run didn't use the tools, read its transcript and say why to the owner in one line (for example "it grepped for the pairs because `architecture`'s description doesn't say environments"). Change the wording of the instructions or of that tool's description only, and keep the size test passing. Then re-run the runs that missed. Each round's change and its effect go in the ledger.

After three rounds under the target: STOP. Show the owner the misses and the options:
- (a) more wording;
- (b) the optional CLAUDE.md snippet measured as a fourth round, knowing it hides AGENTS.md;
- (c) run Eval #2 as it is and report it.

- [ ] **Step 5: Record MCP Dev Set #1, commit, push**

In `docs/BENCHMARKS.md`, "‹today› MCP Dev Set #1 — tool use and per-turn cost before Eval #2", record:
- each round's share of runs that called a tool;
- the ToolSearch calls;
- the first-call difference per repo;
- every wording change.

Run the gate. Then:
```bash
git add -A -- eval2/dev scripts/eval/run.ts lib/tools/registry.ts docs/BENCHMARKS.md && git commit -m "test(eval): the dev set, tool use and per-turn cost measured before Eval #2's questions exist (R1)" -- eval2/dev scripts/eval/run.ts lib/tools/registry.ts docs/BENCHMARKS.md && git push origin pivot/v1
```

(The dev runs' transcripts stay in `eval2/dev/runs` and are committed with this step: scrubbed and leak-checked like any run.)

---

## Part 4 — Eval #2's questions

### Task 14: The questions, their truths, the rubrics and the sessions. STOP for the owner's review

**Files:**
- Create:
  - `eval2/questions.json`, `eval2/truth-specs.json`, `eval2/truth/*.json`, `eval2/truth/adjudicated.json`;
  - `eval2/rubric/*.json`: VS Code's five copied from `eval/rubric`, plus repo 2's;
  - `eval2/sessions.json`.
- Modify: `eval2/eval.json` (`pilot`), `docs/EVAL_RESULTS.md` (Eval #2's method, before any run), `docs/ENGINEERING_DECISIONS.md` (ADR-057; ADR-050 amended)

- [ ] **Step 1: The prompts' templates and format lines**

These are fixed here, so both repos ask the same way:

| Kind | Prompt | Format line |
|---|---|---|
| impact | `If I change <file>, which code could it affect? Count every file that depends on it, directly or through other files, and say how many of those files are inside each of these folders: <f1>, <f2>, …, and how many are elsewhere.` + the import rule | `End with a line that says ANSWER: and then one line for each folder named above, in the same order, as the folder, a colon and the number of files, then a line elsewhere: and the number of files outside them, then a line total: and the number of files in all.` |
| cycle | `Is <file> part of an import cycle, a chain of imports that leads from it back to itself? If it is, give the shortest such cycle.` | `End with a line that says ANSWER: and then either the word none, or the cycle as file paths relative to the repository root, one per line, starting and ending with <file>, where each file imports the next.` |
| unused | `List every file in <folder> that no other file in the repository imports. Leave out test files.` + the import rule | Eval #1's list format |
| violations | `List every file in <folderA> that directly imports a file in <folderB>.` + the import rule | Eval #1's list format |
| entries | `Which files that no other file imports end up loading <file>, directly or through other files? Leave out test files.` + the import rule | Eval #1's list format |
| pairs | `Code under <folder> sits in folders named <n1>, <n2>, …. For each of these names, which of the names do its files import from? Count a pair when at least one import goes that way; a file belongs to the deepest of these names on its path.` (or, for children: `Which of the folders directly inside <folder> import from which others?`) | `End with a line that says ANSWER: and then one line for each pair, as the importing folder's name, then ->, then the imported folder's name.` |

The import rule is Eval #1's sentence, unchanged: `Count a file if any of its import, export … from, side-effect import, import() or require() statements refers to it; type-only imports and test files count.`

- [ ] **Step 2: Pick the targets with the planning scan, then build the truths**

VS Code's six grep-hard questions:
- impact: `src/vs/platform/storage/common/storage.ts`, per `src/vs/base`, `src/vs/platform`, `src/vs/editor`, `src/vs/workbench`, `src/vs/sessions`, `src/vs/code`, `src/vs/server`;
- cycle: a file of the 48-file group in `src/vs/workbench/contrib/chat/common`, whose shortest cycle is 3–6 steps;
- unused: a folder of 20–120 non-test files of which 2–10 are imported by nothing;
- violations: `src/vs/platform` into `src/vs/editor` (planning scan: 1 file);
- entries: a file loaded by 5–30 such roots;
- pairs: the seven environment names under `src/vs` (planning scan: 21 pairs).

Repo 2 gets six on the same rules, plus:
- 4 lists: 3 direct, one of them a folder's outside importers, and 1 transitive, each 10–100 files;
- 4 chains: one with no chain at all;
- 4 big-picture questions with a rubric from the repo's own docs or its website, each point checked in the source at the pinned commit as Eval #1's were. If the docs can't carry 4, the rest become pairs questions on its top folders, and say so.

Sessions, 3 per repo, each 4 questions on one area ("I'm about to change X"): impact of X, the chain from an entry point to X, the cycle through X (or none), and the files nothing imports in X's folder. Their targets differ from the single questions'.

Write `eval2/truth-specs.json`, run `npm run eval:truth -- --eval eval2`, then check every truth the way Eval #1's were (R2):
- read every list entry and chain step in `truth-evidence.md`;
- read every edge in `truth-disagreements.md` and every site in `computed-sites.md`, deciding each and recording it in `adjudicated.json`;
- read the 30 sampled edges per repo in `truth-sample.md`;
- consult the index only for candidates (`imports` and `architecture`, read-only) and read every difference in the source.

Set `verified: true` on each truth once checked. A subagent may do the reading, as in Eval #1. The controller reads a sample itself, and the results say who read what.

VS Code's Eval #1 questions are copied in with ids prefixed (`vscode-bp1` … `vscode-cn5`), with their truths and rubrics unchanged.

Run the overlap check. A short script compares each Eval #2 question's targets with the dev set's: the file or folder a question asks about, a chain's two ends, and a violation's two folders. The folders an impact question counts by and a pairs question's names aren't targets. It prints any shared path, and it must print none.

- [ ] **Step 3: Write `eval2/questions.json`, `eval2/sessions.json` and the pilot**

`questions.json` takes Eval #1's shape. Each question gains `repo` and `kind` (one of D2's kinds), and session questions carry `"session": "<id>"` so the single-run schedule skips them.

`eval.json`'s `pilot`: per repo, 1 big-picture, 1 chain and 2 grep-hard questions (impact and one other), plus 1 session.

- [ ] **Step 4: Write Eval #2's method into `docs/EVAL_RESULTS.md` and ADR-057, before any run**

`docs/EVAL_RESULTS.md` gains a new top section, `# ‹yyyy mm dd› Eval #2 — Claude Code with and without Nebulosity, on VS Code and ‹repo 2›`, above Eval #1 (which stays whole beneath it). It holds:
- the arms;
- the setup: the pinned version, filled at the pilot;
- the command, with the scripts rules;
- what is on and off, and why (R6);
- the isolation, as in Eval #1;
- the questions with their truth sizes;
- how the truths were made and checked (R2, two extractors, the sample);
- scoring, the new kinds included;
- **the ship gate, D1's table verbatim, with the sentence "Written before the first run; it does not change after"**;
- the threats to validity:
  - scripts let both arms write their own import walkers;
  - the model may know VS Code from training;
  - repo 2's rubric is the project's own docs;
  - the dev set and the eval share kinds, not targets;
  - three repeats is still a small sample;
  - D1's thresholds are the owner's, set after Eval #1;
- "Results: to come after the runs."

ADR-057, appended:

```markdown
## ADR-057 — Eval #2's method and the ship gate (‹today›) — amends ADR-050 and ADR-051

**Context:** Eval #1 showed Claude Code alone at the ceiling on its questions, the tools loaded in 12 of 30 runs, and savings only where a question walks the graph, with a read-only baseline. The owner decided nothing ships until a re-measured eval shows clearly better results and efficiency (ADR-051, amended). V1.6 built tools for what grep can't answer cheaply (ADR-053–ADR-056).
**Decision:**
- **Two repos:** VS Code at `cc3fec88` (Eval #1's 15 questions again, plus 6 grep-hard ones), and ‹repo 2› at ‹sha›, a repo with no agent guide at that commit (4 big-picture, 4 lists, 4 chains, 6 grep-hard).
- **The grep-hard kinds and their scores:** impact counts (1 − relative error per line, floored at 0), cycles (1 / 0.5 / 0), and F1 for files nothing imports, layering violations, the roots that load a file, and folder pairs.
- **3 task sessions per repo**, 4 questions each, in one Claude Code process over stream-json input.
- **Two arms,** A and N. N is registered as `nebulosity setup` registers it, with the tools always loaded through their `_meta`.
- **Scripts allowed in both arms** (the owner's pick): node, and edits under a fresh scratch folder per run (R6).
- **Three repeats.**
- **Truth** from two independent extractors and the eval's own resolver. Disagreements, computed sites and a 30-edge sample per repo were read in the source; the index was consulted only for candidates (R2).
- **The ship gate**, fixed before the first run: D1 of V1.6's plan, computed by `scripts/eval/gate.ts`. All of: grep-hard pooled ≥ A + 0.15 and no grep-hard question below A by more than 0.05; no other family below A by more than 0.03 on either repo; graph questions at ≤ 50% of A's median cost and time; other questions at ≤ 115% of A's median cost; sessions at ≤ 60% of A's cost and time with the score within 0.03; tools used in ≥ 90% of list, chain and grep-hard runs; first-call context ≤ A's + 2,500 tokens.
- Everything else as ADR-050: pinned versions, the isolation and init checks, outages re-run, blind grading with the owner ruling on disagreements, losses published.
**Alternatives:** (a) Read-only like Eval #1: comparable, but the savings would stay conditioned on a baseline that can't script, Eval #1's own caveat. (b) VS Code only: the model knows it from training and it ships an agent guide; Eval #1 showed both help Claude Code alone. (c) Questions where Nebulosity can't lose: the owner's gate keeps Eval #1's families and requires no loss there. (d) Two repeats: cheaper, and the noise Eval #1 warned about.
**Consequences:** About 240 single runs and 36 session runs, on the owner's subscription (the pilot measures the share of the windows; the owner approves the count). The results, losses included, go in docs/EVAL_RESULTS.md as Eval #2, and the gate's verdict decides whether S8 (going public) starts.
**Revisit when:** the gate passes or fails (the verdict amends this ADR), or a new Claude Code version or model changes the baseline enough to matter for the README's claims.
```

ADR-050, at its end:

```markdown
**Amended (‹today›, V1.6):** Eval #2 extends this method (ADR-057): a second repo, scripts allowed in both arms, task sessions, three repeats, and a gate fixed before the first run. Eval #1's numbers stand as published, with Task 3's dated correction of the up-front token cost.
```

- [ ] **Step 5: Gate, commit, push**

Run the gate. Then:
```bash
git add -A -- eval2 docs/EVAL_RESULTS.md docs/ENGINEERING_DECISIONS.md && git commit -m "feat(eval): Eval #2's questions, independently checked truths, rubrics, sessions and method, with the ship gate fixed before any run (ADR-057)" -- eval2 docs/EVAL_RESULTS.md docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

- [ ] **Step 6: STOP. The owner reviews the questions, the truths and the gate's text**

Show:
- a table of every question per repo: kind, target, truth size;
- every hand decision (disagreements read, computed sites, sample findings);
- the rubric points that don't hold;
- the overlap check's empty output;
- the gate exactly as it will be computed;
- `npm run eval:run -- --eval eval2 --pilot --dry-run`.

Ask for changes before any run, and record the owner's answer verbatim. Part 5 runs while the owner reviews.

---

## Part 5 — Works on your repo (runs while the owner reviews Eval #2's questions)

Everything here lands before the engine freezes for Eval #2 (Task 21), because Tasks 15 and 17 touch code the server runs.

### Task 15: The code root and the data folder apart (ADR-044 amended)

**Files:**
- Modify: `lib/home.ts` (+ `home.test.ts`), `lib/db/client.ts`, `lib/config.ts`, `scripts/env.ts`, `scripts/export-demo.ts`, `scripts/build-demo.ts`, `mcp/launch.mjs`
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-044 amended), `docs/ARCHITECTURE.md` (rule 4's paths)

**Interfaces:**
- Produces: `dataDir()`, `dataPath(...)` and `userDataDir(platform?, env?, home?)`. Task 16's launcher sets `NEBULOSITY_DATA` from `userDataDir()` for an installed copy.

- [ ] **Step 1: Write the failing tests**

`lib/home.test.ts`:

```ts
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDir, userDataDir } from "./home";

const saved = { home: process.env.NEBULOSITY_HOME, data: process.env.NEBULOSITY_DATA };
afterEach(() => {
    for (const [key, value] of [["NEBULOSITY_HOME", saved.home], ["NEBULOSITY_DATA", saved.data]] as const){
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

describe("dataDir", () => {
    it("is NEBULOSITY_DATA when it's set", () => {
        process.env.NEBULOSITY_DATA = path.resolve("/somewhere/data");
        expect(dataDir()).toBe(path.resolve("/somewhere/data"));
    });

    it("is the code root's .nebulosity otherwise, where a checkout always kept it", () => {
        delete process.env.NEBULOSITY_DATA;
        process.env.NEBULOSITY_HOME = path.resolve("/somewhere/code");
        expect(dataDir()).toBe(path.join(path.resolve("/somewhere/code"), ".nebulosity"));
    });
});

describe("userDataDir (Review Focus 5)", () => {
    it("uses LOCALAPPDATA on Windows, a user name with a space included", () => {
        expect(userDataDir("win32", { LOCALAPPDATA: "C:\\Users\\Ann Lee\\AppData\\Local" }, "C:\\Users\\Ann Lee")).toBe("C:\\Users\\Ann Lee\\AppData\\Local\\Nebulosity");
        expect(userDataDir("win32", {}, "C:\\Users\\Ann Lee")).toBe("C:\\Users\\Ann Lee\\AppData\\Local\\Nebulosity");
    });

    it("uses Application Support on macOS and XDG_DATA_HOME (else ~/.local/share) on Linux", () => {
        expect(userDataDir("darwin", {}, "/Users/ann")).toBe("/Users/ann/Library/Application Support/Nebulosity");
        expect(userDataDir("linux", { XDG_DATA_HOME: "/data" }, "/home/ann")).toBe("/data/nebulosity");
        expect(userDataDir("linux", {}, "/home/ann")).toBe("/home/ann/.local/share/nebulosity");
    });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/home.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/home.ts`:

```ts
import os from "os";

/**
 * Where Nebulosity keeps its data (ADR-044, amended): the index, the config, the demo export. NEBULOSITY_DATA, else
 * <code root>/.nebulosity, where a checkout always kept it. An installed copy's launchers set NEBULOSITY_DATA to the
 * user's data folder (userDataDir), because the package folder may be read-only and is replaced on every upgrade.
 */
export function dataDir(): string {
    return path.resolve(process.env.NEBULOSITY_DATA ?? nebulosityPath(".nebulosity"));
}

export function dataPath(...segments: string[]): string {
    return path.join(dataDir(), ...segments);
}

/** The user's data folder on each system: %LOCALAPPDATA%\Nebulosity, ~/Library/Application Support/Nebulosity, $XDG_DATA_HOME/nebulosity. */
export function userDataDir(
    platform: NodeJS.Platform = process.platform,
    env: Readonly<Record<string, string | undefined>> = process.env,
    home: string = os.homedir(),
): string {
    if (platform === "win32") return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local"), "Nebulosity");
    if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Nebulosity");
    return path.posix.join(env.XDG_DATA_HOME ?? path.posix.join(home, ".local", "share"), "nebulosity");
}
```

Then point every data path at it:
- `lib/db/client.ts`: `openDb(dataPath("nebulosity.db"), …)` (migrations stay `nebulosityPath("lib", "db", "migrations")`: they ship with the code).
- `lib/config.ts`: `dataPath("config.json")`.
- `scripts/env.ts`: `loadLocalEnv` reads `nebulosityPath(".env.local")` (a checkout's key, as now), then `dataPath(".env.local")` (an installed copy's), each when it exists.
- `scripts/export-demo.ts` and `scripts/build-demo.ts`: the default `dataPath("demo")`.
- `mcp/launch.mjs`: after `await import("tsx")`, when `NEBULOSITY_DATA` is unset and the code root has no `.git`, set it to `userDataDir()` (imported from `../lib/home.ts`). A checkout keeps its `.nebulosity`.

The eval scripts keep `<checkout>/.nebulosity/…`: they only run from a checkout, where `dataDir()` is the same folder.

- [ ] **Step 4: Run the tests and see them pass, and nothing moved for the checkout**

Run: `npx vitest run`
Expected: PASS (about 5 new). Then check `npm run index -- ../vscode --no-activate` still reads and writes `.nebulosity/nebulosity.db` in the checkout (its file's modification time moves; nothing appears anywhere else).

- [ ] **Step 5: Docs, commit, push**

ADR-044, at its end:

```markdown
**Amended (‹today›, V1.6): the data moved out of the code's folder for an installed copy.** This ADR's revisit trigger. The code root (`NEBULOSITY_HOME`) still holds the migrations. The data (database, config, demo export) lives in `NEBULOSITY_DATA`: by default a checkout's own `.nebulosity` as before, and for an installed copy the user's data folder, set by the launchers (`userDataDir`: %LOCALAPPDATA%\Nebulosity, ~/Library/Application Support/Nebulosity, $XDG_DATA_HOME/nebulosity). The read-only open checks the database against the code root's migrations as before.
```

In `docs/ARCHITECTURE.md` §3 rule 4 (or the paths note it refers to), add one sentence naming `NEBULOSITY_DATA` beside `NEBULOSITY_HOME`.

Run the gate (about 1043/1043). Then:
```bash
git add -A -- lib/home.ts lib/home.test.ts lib/db/client.ts lib/config.ts scripts/env.ts scripts/export-demo.ts scripts/build-demo.ts mcp/launch.mjs docs/ENGINEERING_DECISIONS.md docs/ARCHITECTURE.md && git commit -m "feat(home): the data folder apart from the code root, the user's own for an installed copy (ADR-044 amended)" -- lib/home.ts lib/home.test.ts lib/db/client.ts lib/config.ts scripts/env.ts scripts/export-demo.ts scripts/build-demo.ts mcp/launch.mjs docs/ENGINEERING_DECISIONS.md docs/ARCHITECTURE.md && git push origin pivot/v1
```

### Task 16: One command: `nebulosity` (index, summarize, map, mcp, setup, doctor), and the package (ADR-058)

**Files:**
- Create: `bin/nebulosity.mjs`, `scripts/cli.ts`, `scripts/cli.test.ts`, `scripts/commands/index-command.ts`, `scripts/commands/summarize-command.ts`, `scripts/mcp-smoke.mjs`
- Modify: `scripts/index.ts` and `scripts/summarize.ts` (each a two-line wrapper), `package.json`, `package-lock.json`, `mcp/server.ts` (`SERVER_VERSION`)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-058; ADR-048 amended)

**Interfaces:**
- Consumes: `dataDir`, `userDataDir` (Task 15).
- Produces:
  - `main(argv): Promise<number>`, `parseCli(argv)`, `setupCommand(launcher, platform)`, `SNIPPET`;
  - `runIndex(args)` and `runSummarize(args)`;
  - `scripts/mcp-smoke.mjs` (used by Task 18's CI and by hand).

- [ ] **Step 1: Write the failing tests**

`scripts/cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCli, setupCommand, SNIPPET } from "./cli";

describe("parseCli", () => {
    it("reads a command and its arguments", () => {
        expect(parseCli(["index", "../repo", "--no-activate"])).toEqual({ command: "index", args: ["../repo", "--no-activate"] });
        expect(parseCli(["map", "--port", "3123"])).toEqual({ command: "map", args: ["--port", "3123"] });
    });

    it("answers --version and --help, and refuses an unknown command in a sentence", () => {
        expect(parseCli(["--version"])).toEqual({ command: "version", args: [] });
        expect(parseCli([])).toEqual({ command: "help", args: [] });
        expect(parseCli(["serve"])).toEqual({ error: 'nebulosity has no command "serve". Commands: index, summarize, map, mcp, setup, doctor.' });
    });
});

describe("setupCommand (Review Focus 5)", () => {
    it("registers per repo with claude mcp add, the launcher one argument even with a space in it", () => {
        expect(setupCommand("/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs", "linux")).toEqual({
            command: "claude",
            args: ["mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "--", "node", "/home/ann lee/.npm/lib/node_modules/nebulosity/mcp/launch.mjs"],
            shell: false,
        });
    });

    it("on Windows runs claude's .cmd through the shell, so the path is quoted and written with forward slashes", () => {
        expect(setupCommand("C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\node_modules\\nebulosity\\mcp\\launch.mjs", "win32")).toEqual({
            command: "claude",
            args: ["mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "--", "node", '"C:/Users/Ann Lee/AppData/Roaming/npm/node_modules/nebulosity/mcp/launch.mjs"'],
            shell: true,
        });
    });
});

describe("SNIPPET (R5)", () => {
    it("names the tools and warns that a CLAUDE.md hides an AGENTS.md", () => {
        expect(SNIPPET).toContain("mcp__nebulosity__imports");
        expect(SNIPPET).toContain("AGENTS.md");
    });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`scripts/commands/index-command.ts`** holds `export function runIndex(args: string[]): number`: the body of today's `scripts/index.ts`, with `--no-activate` and exit codes returned rather than `process.exit`. `scripts/index.ts` becomes `import { runIndex } from "./commands/index-command"; process.exitCode = runIndex(process.argv.slice(2));`. The same goes for summarize: `runSummarize(args): Promise<number>` in `scripts/commands/summarize-command.ts`, and `scripts/summarize.ts` as its wrapper.
- **`scripts/cli.ts`:**

```ts
/**
 * The `nebulosity` command (ADR-058). One command for each thing a user does:
 *   nebulosity index <repo> [--no-activate]   build or update a repo's index (free)
 *   nebulosity summarize <repo> [--yes] …     write summaries: shows the estimate and asks first (S11)
 *   nebulosity map [--port <n>]               open the Map (http://localhost:<n>, default 3000)
 *   nebulosity mcp                            the MCP server Claude Code starts (stdio)
 *   nebulosity setup [--print]                register the server with Claude Code for the repo in this folder
 *   nebulosity doctor                         check Node, the data folder, the database, git and claude
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { dataDir, nebulosityHome, nebulosityPath } from "../lib/home";

export type Command = "index" | "summarize" | "map" | "mcp" | "setup" | "doctor" | "version" | "help";
const COMMANDS = ["index", "summarize", "map", "mcp", "setup", "doctor"];

export function parseCli(argv: readonly string[]): { command: Command; args: string[] } | { error: string } {
    const [first, ...rest] = argv;
    if (first === undefined || first === "--help" || first === "help") return { command: "help", args: [] };
    if (first === "--version" || first === "-v") return { command: "version", args: [] };
    if (!COMMANDS.includes(first)) return { error: `nebulosity has no command "${first}". Commands: ${COMMANDS.join(", ")}.` };
    return { command: first as Command, args: rest };
}

/**
 * How `setup` registers the MCP server for the repo in the current folder (ADR-048's line, per repo with --scope local).
 * On Windows `claude` is a .cmd shim that Node can only start through the shell, so the launcher's path is quoted there.
 */
export function setupCommand(launcher: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
    const slashed = launcher.replace(/\\/g, "/");
    const windows = platform === "win32";
    return {
        command: "claude",
        args: ["mcp", "add", "--scope", "local", "--transport", "stdio", "nebulosity", "--", "node", windows ? `"${slashed}"` : slashed],
        shell: windows,
    };
}

/** An optional note for a repo's CLAUDE.md (R5): never written by setup. */
export const SNIPPET = [
    "## Nebulosity",
    "This repo is indexed by Nebulosity. For questions about what imports what, what a change would affect, how the code is layered,",
    "import cycles or files nothing imports, call its tools (mcp__nebulosity__imports, mcp__nebulosity__architecture, mcp__nebulosity__describe)",
    "before grep: they answer from the whole repo in one call.",
    "",
    "(Add this only to a CLAUDE.md you already have. Creating a CLAUDE.md in a repo that has an AGENTS.md makes Claude Code stop reading the AGENTS.md.)",
].join("\n");
```

  `main(argv)` dispatches:
  - `index` → `runIndex(args)`; `summarize` → `runSummarize(args)`;
  - `map` → checks `.next/BUILD_ID` under `nebulosityHome()` (if it's missing: "This copy of Nebulosity has no built Map. In a checkout, run npm run build first."), then spawns `process.execPath` with `require.resolve("next/dist/bin/next", { paths: [nebulosityHome()] })`, `start -H 127.0.0.1 -p <port>`, `cwd: nebulosityHome()`, `stdio: "inherit"`, and resolves with its exit code;
  - `mcp` → `(await import("../mcp/server")).main()`;
  - `setup`:
    - checks that the current folder is inside an indexed repo (the same rule as ADR-046);
    - otherwise prints "Index it first: nebulosity index ." and returns 1;
    - then runs `setupCommand(nebulosityPath("mcp", "launch.mjs"))` with `spawnSync`, or with `--print` just prints the command;
    - then prints `SNIPPET` under "Optional: …";
  - `doctor` prints one line per check: Node ≥ 24; the data folder (`dataDir()`) writable; the database opens and migrates; `git --version`; `claude --version` (a WARN if missing); `ANTHROPIC_API_KEY` (a WARN that says free mode). It returns 1 on a FAIL.
  - `version` prints `package.json`'s version; `help` prints the usage above.
- **`bin/nebulosity.mjs`:**

```js
#!/usr/bin/env node
// The `nebulosity` command (ADR-058): plain JavaScript, so node runs it on every system. It loads tsx from the package,
// keeps an installed copy's data in the user's data folder (ADR-044, amended), and hands over to scripts/cli.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.NEBULOSITY_HOME ??= root;
await import("tsx");
if (!process.env.NEBULOSITY_DATA && !fs.existsSync(path.join(root, ".git"))){
    const { userDataDir } = await import("../lib/home.ts");
    process.env.NEBULOSITY_DATA = userDataDir();
}
const { main } = await import("../scripts/cli.ts");
process.exitCode = await main(process.argv.slice(2));
```

- **`scripts/mcp-smoke.mjs`** (plain JavaScript):
  - an MCP client from the SDK (`Client`, `StdioClientTransport`) starts `node <--launcher>` in `<--repo>`, with `NEBULOSITY_LIVE=off` and `CLAUDE_PROJECT_DIR=<repo>`;
  - it lists the tools and checks the six names and the five `_meta` always-load marks;
  - it calls `overview` and checks the answer names the repo's file count;
  - it prints `mcp-smoke: ok (6 tools, overview answered)` and exits 0, or prints what differed and exits 1.
- **`package.json`:**
  - `"version": "0.2.0"` (and `SERVER_VERSION` in `mcp/server.ts`, which a test keeps equal);
  - `"bin": { "nebulosity": "bin/nebulosity.mjs" }` and `"engines": { "node": ">=24" }`;
  - move `typescript` and `tsx` to `dependencies`;
  - `"files"`: `bin/`, `lib/`, `mcp/`, `scripts/cli.ts`, `scripts/commands/`, `scripts/index.ts`, `scripts/summarize.ts`, `scripts/background.ts`, `scripts/env.ts`, `scripts/mcp-smoke.mjs`, `app/`, `public/`, `next.config.ts`, `proxy.ts`, `instrumentation.ts`, `postcss.config.mjs`, `tsconfig.json`, `.next/`, `!.next/cache/`, `!.next/dev/`, `!**/*.test.ts`, `LICENSE`, `README.md`;
  - keep `"private": true` (D4).

  Run `npm install` so the lockfile records the moves.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run`
Expected: PASS (about 6 new).

- [ ] **Step 5: Build, pack and install it, in the sandbox worktree and a scratch prefix**

```bash
git -C ../Nebulosity-build checkout --detach pivot/v1 && cd ../Nebulosity-build && npm ci && npm run build && npm pack --pack-destination ../nebulosity-scratch/pack && cd -
P=../nebulosity-scratch/prefix && rm -rf "$P" && npm install -g --prefix "$P" ../nebulosity-scratch/pack/nebulosity-0.2.0.tgz
export NEBULOSITY_DATA=$(cd .. && pwd)/nebulosity-scratch/data
"$P/nebulosity" --version && "$P/nebulosity" doctor && "$P/nebulosity" index test/fixtures/mini-repo --no-activate
node scripts/mcp-smoke.mjs --launcher "$P/node_modules/nebulosity/mcp/launch.mjs" --repo test/fixtures/mini-repo
```

Expected: `0.2.0`; every doctor line OK, or WARN for claude or the key; the fixture indexed; `mcp-smoke: ok`.

Then `"$P/nebulosity" map --port 3123` in the background, `curl -s http://127.0.0.1:3123/api/status`, and stop it. That's this task's own process, never port 3000's.

A module the installed copy can't find means `files` is missing something: add it and repack. Record the tarball's size and its file count (`npm pack --dry-run`).

- [ ] **Step 6: ADR-058, ADR-048 amended, commit, push**

```markdown
## ADR-058 — Installable: one `nebulosity` command, the data in the user's folder, and the cost confirmed before any spend (‹today›) — implements ADR-043's V1.6; amends ADR-048

**Context:** ADR-043 asked for one command each to index a repo, open the Map and connect Claude Code, on Windows, macOS and Linux, with a free mode. Until now Nebulosity ran only from a checkout, through npm scripts, with its data inside the checkout.
**Decision:**
- **The package `nebulosity`** (D4) ships its TypeScript with `tsx` and `typescript` as dependencies, and a prebuilt Map (`.next`, built in the sandbox worktree) for `next start`. `bin/nebulosity.mjs` is plain JavaScript, so `node` runs it on every system.
- **One command:** `nebulosity index`, `summarize`, `map`, `mcp`, `setup` and `doctor`.
- **`setup`** registers the server for the repo in the current folder with `claude mcp add --scope local … -- node <package>/mcp/launch.mjs`, ADR-048's line: no `npx`, and no `cmd /c` of our own (Node starts `claude`'s .cmd shim through the shell on Windows, so the path is quoted). It writes no CLAUDE.md (R5) and prints an optional snippet.
- **The data** lives in the user's data folder for an installed copy, and in the checkout's `.nebulosity` for a checkout (ADR-044, amended).
- **Spend** (S11): `summarize` shows the estimate and asks before the first request; without a terminal it needs `--yes`. The background worker summarizes nothing on its own for a repo whose summaries were never confirmed (ADR-035 and ADR-038 amended, Task 17).
- **The package stays private until Eval #2's gate passes** (D4). The owner publishes it at ship.
**Alternatives:** (a) Compile to JavaScript and drop tsx: a faster start (about 0.7 s today), but a build step for every change, and the worker forks a .ts file. Later, if start-up matters. (b) A Next "standalone" build: smaller, but the worker and the CLI need the sources anyway. (c) Write `.mcp.json` into the repo: that's project scope, shared with everyone who clones it.
**Consequences:** One `npm install -g nebulosity` (once published) gives all three steps. CI checks the package on all three systems (Task 18). The tarball is ‹MB› with ‹n› files. A user's data survives upgrades. Claude Code's MCP config points at the package's launcher, so an upgrade that moves the package needs `nebulosity setup` again.
**Revisit when:** start-up time matters (compile), or the Map should run without Next (a desktop shell, PIVOT_SPEC.md's platform note).
```

ADR-048, at its end:

```markdown
**Amended (‹today›, V1.6):** an installed copy is started the same way, `node <package>/mcp/launch.mjs`, which `nebulosity setup` registers (ADR-058). The launcher also sets the data folder for an installed copy (ADR-044, amended).
```

Run the gate (about 1049/1049). Then:
```bash
git add -A -- bin scripts/cli.ts scripts/cli.test.ts scripts/commands scripts/index.ts scripts/summarize.ts scripts/mcp-smoke.mjs package.json package-lock.json mcp/server.ts docs/ENGINEERING_DECISIONS.md && git commit -m "feat(cli): the nebulosity command (index, summarize, map, mcp, setup, doctor) and the package, still private (ADR-058)" -- bin scripts/cli.ts scripts/cli.test.ts scripts/commands scripts/index.ts scripts/summarize.ts scripts/mcp-smoke.mjs package.json package-lock.json mcp/server.ts docs/ENGINEERING_DECISIONS.md && git push origin pivot/v1
```

### Task 17: Free mode end to end, and nothing spent before a yes (S11; ADR-035 and ADR-038 amended)

**Files:**
- Create: `lib/index/summarize/estimate.ts`, `lib/index/summarize/estimate.test.ts`
- Modify: `lib/index/summarize/run.ts` (`plannedRequests`), `scripts/commands/summarize-command.ts`, `lib/db/store/summaries.ts` (`confirmSummaries`, `summariesConfirmed`), `lib/background/service.ts` (+ `service.test.ts`)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-035, ADR-038 amended), `docs/PIVOT_SPEC.md` §2 (S11)

- [ ] **Step 1: Write the failing tests**

`lib/index/summarize/estimate.test.ts`. The numbers come by hand from `ASSUMED_TOKENS` and `pricing.ts`: Haiku $0.10 and $0.50 per million tokens, Sonnet $2 and $10, half price by batch. A file is 4,600 in and 260 out, so $0.00059 direct; a folder 1,000 and 250, so $0.0045 direct.

```ts
import { describe, expect, it } from "vitest";
import { estimateSpend } from "./estimate";

const requests = [
    { kind: "file" as const, model: "claude-haiku-5-5" },
    { kind: "file" as const, model: "claude-haiku-5-5" },
    { kind: "folder" as const, model: "claude-sonnet-5-5" },
];

describe("estimateSpend", () => {
    it("prices every request a run would send, before any usage exists", () => {
        expect(estimateSpend(requests, [], "direct").usd).toBeCloseTo(0.00568, 10);
        expect(estimateSpend(requests, [], "batch").usd).toBeCloseTo(0.00284, 10);
        expect(estimateSpend(requests, [], "batch").requests).toBe(3);
    });

    it("uses what the repo's requests have taken so far, when it has some", () => {
        const usage = [{ model: "claude-haiku-5-5", transport: "batch" as const, requests: 10, inputTokens: 20_000, outputTokens: 2_000 }];
        // Haiku now 2,000 in and 200 out per request: (2,000 × 0.10 + 200 × 0.50) / 1e6 = $0.0003 direct each
        expect(estimateSpend(requests.slice(0, 2), usage, "direct").usd).toBeCloseTo(0.0006, 10);
    });
});
```

`lib/background/service.test.ts`, a new test: with a summarizer present and a repo whose summaries were never confirmed (no model-written summary, no confirmation in `meta`), a changed file arms no refresh and calls the summarizer zero times. After `confirmSummaries`, the same change does call it. (Use the file's existing fake summarizer and fake timers.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run lib/index/summarize/estimate.test.ts lib/background/service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/index/summarize/estimate.ts`:

```ts
import type { UsageRow } from "../../db/store/summaries";
import { projectSpend, type ProjectedRequest } from "./budget";

/** What a run would spend, before it sends anything (S11, ADR-035 amended): each request priced as the spend cap prices it. */
export function estimateSpend(requests: readonly ProjectedRequest[], usage: readonly UsageRow[], transport: "direct" | "batch"): { requests: number; usd: number; unpriced: string[] } {
    const p = projectSpend({ usage, baseline: usage, atAnthropic: [], thisSubmission: requests, thisTransport: transport, rest: [], restTransport: transport });
    return { requests: requests.length, usd: p.thisSubmission, unpriced: p.unpriced };
}
```

- In `lib/index/summarize/run.ts`, add `plannedRequests(repoRoot): ProjectedRequest[]`. It builds the plan the way `runSummaries`' first pass does (with stale folders refreshed) and keeps every target in state ready, waiting, lazy or failed whose model isn't `"template"`, as `{ kind, model }`. It reads only.
- In `lib/db/store/summaries.ts`:
  - `confirmSummaries(db, repoId)` writes `meta` `summaries-confirmed:<repoId>` = the time;
  - `summariesConfirmed(db, repoId)` is true when that key exists or the repo has a summary whose model isn't `"template"`. VS Code's existing summaries count, so the owner's repo stays confirmed.
- In `scripts/commands/summarize-command.ts`, a full run (no `--path`) first:
  - prints `[summarize] <repo>: about <n> requests (<f> files to claude-haiku-5-5, <d> folders and the repo to claude-sonnet-5-5), about <$> at list prices<, by the Batch API>. Writing summaries sends each file's code to Anthropic.`;
  - asks `Spend up to <$budget> on this repo's summaries? [y/N]` when stdin is a terminal;
  - otherwise needs `--yes` (else it prints that and returns 1);
  - on a yes, calls `confirmSummaries`, then runs as before.

  `--path` (one request the user named) and a run with nothing to send skip the question.
- In `lib/background/service.ts`, the automatic refresh and the folder sweep start only when `summariesConfirmed(db, repoId)`. `summarizeNow` (the Map's "summarize now", one request the user clicked) is unchanged.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run`
Expected: PASS (about 4 new).

- [ ] **Step 5: Free mode in the Map, checked in the browser**

With no key in the environment:
- index `test/fixtures/mini-repo` into a scratch data folder (`NEBULOSITY_DATA=../nebulosity-scratch/free`);
- start a measuring server on another port (`NEBULOSITY_WORKER=off`, `NEBULOSITY_DATA` as above, `next start -p 3124` in `../Nebulosity-build`);
- open `http://localhost:3124` in the built-in browser (`preview_start` with the url).

Check with `read_page`:
- the status pill says "Summaries off (no API key)";
- a folder's panel shows what a key adds where the summary would be;
- the docs pointers don't break the panel (it ignores them).

Take one screenshot for the ledger, and stop the server.

Then from the scratch prefix (Task 16): `"$P/nebulosity" summarize test/fixtures/mini-repo` with no key prints that summaries need a key and spends nothing. With a fake key and no terminal (`< /dev/null`), it refuses without `--yes` and sends nothing.

- [ ] **Step 6: Docs, commit, push**

ADR-035, at its end:

```markdown
**Amended (‹today›, V1.6): an estimate and a yes before the first request** (S11). A full summary run first prints its estimate: every request it would send, priced as the cap prices them (`estimateSpend`, the same `projectSpend`). It asks before spending, and without a terminal it needs `--yes`. The yes is recorded per repo.
```

ADR-038, at its end:

```markdown
**Amended (‹today›, V1.6): no automatic summaries for a repo nobody confirmed.** The worker refreshes summaries and sweeps folders only for a repo whose summaries were confirmed: a yes recorded by `summarize`, or summaries already written by a model. A key in the environment alone no longer starts spending on a newly indexed repo (S11).
```

`PIVOT_SPEC.md` §2, S11's row gains `*(V1.6: met; the estimate and the yes, ADR-035 and ADR-038 amended; the Map checked with no key)*`.

Run the gate (about 1053/1053). Then:
```bash
git add -A -- lib/index/summarize/estimate.ts lib/index/summarize/estimate.test.ts lib/index/summarize/run.ts scripts/commands/summarize-command.ts lib/db/store/summaries.ts lib/background/service.ts lib/background/service.test.ts docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md && git commit -m "feat(summaries): an estimate and a yes before any spend; the worker never starts spending on an unconfirmed repo (S11)" -- lib/index/summarize/estimate.ts lib/index/summarize/estimate.test.ts lib/index/summarize/run.ts scripts/commands/summarize-command.ts lib/db/store/summaries.ts lib/background/service.ts lib/background/service.test.ts docs/ENGINEERING_DECISIONS.md docs/PIVOT_SPEC.md && git push origin pivot/v1
```

### Task 18: CI on Windows, macOS and Linux (S9)

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: whatever the runs show is system-specific (each fix with its own test where one fits)
- Modify: `docs/PIVOT_SPEC.md` §2 (S9), `docs/BENCHMARKS.md` (or the ledger) with the runs' results

- [ ] **Step 1: The workflow**

`.github/workflows/ci.yml`:

```yaml
# The gate and the package, on all three systems (S9, ADR-058). It runs on pull requests and by hand
# (gh workflow run ci.yml), not on every push: the repo is private, and macOS minutes count ten times.
name: ci
on:
  pull_request:
  workflow_dispatch:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx vitest run
      - run: npm run build
      - run: npm pack --pack-destination "${{ runner.temp }}"
      - name: Install the package and use it
        shell: bash
        env:
          NEBULOSITY_DATA: ${{ runner.temp }}/nebulosity-data
        run: |
          npm install -g --prefix "$RUNNER_TEMP/prefix" "$RUNNER_TEMP"/nebulosity-*.tgz
          if [ "$RUNNER_OS" = "Windows" ]; then BIN="$RUNNER_TEMP/prefix"; PKG="$RUNNER_TEMP/prefix/node_modules/nebulosity"; else BIN="$RUNNER_TEMP/prefix/bin"; PKG="$RUNNER_TEMP/prefix/lib/node_modules/nebulosity"; fi
          "$BIN/nebulosity" --version
          "$BIN/nebulosity" doctor
          "$BIN/nebulosity" index test/fixtures/mini-repo --no-activate
          "$BIN/nebulosity" index test/fixtures/arch-repo
          node scripts/mcp-smoke.mjs --launcher "$PKG/mcp/launch.mjs" --repo test/fixtures/arch-repo
          "$BIN/nebulosity" map --port 3123 &
          for i in $(seq 1 90); do curl -sf http://127.0.0.1:3123/api/status > /dev/null && break; sleep 1; done
          curl -sf http://127.0.0.1:3123/api/status
          kill %1 || true
```

- [ ] **Step 2: Ask, then run it**

Commit and push the workflow first (`ci: …`). Then ask:

> Task 18 runs CI once on your private repo's GitHub Actions: Windows, macOS and Linux, about 8 minutes each. macOS minutes count ten times on a private repo, so one run is roughly 100 of your 2,000 free minutes a month. Fixes may need two or three runs. OK to start one?

On a yes: `gh workflow run ci.yml --ref pivot/v1`. Then `gh run watch <id> --exit-status` as one background command; read its result when notified.

- [ ] **Step 3: Fix what each system shows, one commit per fix**

Expect:
- case-sensitive paths on Linux;
- path separators in tests that assumed Windows;
- line endings in fixtures (`.gitattributes` may need `test/fixtures/** text eol=lf`);
- the Map's port taking longer on macOS.

Each fix keeps the Windows gate passing here, and gets a test when the fix is logic (not just a test's assumption). Re-run CI after a batch of fixes (ask again only if the owner capped the runs).

- [ ] **Step 4: Record S9, commit, push**

`PIVOT_SPEC.md` §2's S9 row gains `*(V1.6: CI on Windows, macOS and Linux installs the package, indexes two fixtures, answers through MCP and serves the Map: run ‹id›)*`. The ledger gets each run's id and result.

### Task 19: Real repos of different shapes (S10), and the README for users

**Files:**
- Modify: `docs/BENCHMARKS.md` (Variety Benchmark #1), `docs/PIVOT_SPEC.md` §2 (S10), `README.md`
- Modify (only if a variety repo shows a small, general resolver gap): `lib/index/resolve.ts` or `lib/index/workspace.ts` (+ tests). Anything bigger goes in the ledger as a limit, named in ADR-053's revisit.

- [ ] **Step 1: Ask, then clone the variety repos**

Ask: "Task 19 clones the three variety repos you confirmed in Task 1 (shallow, ‹sizes›) into `../repos/`. OK?" On a yes:
```bash
mkdir -p ../repos && for r in expressjs/express vitejs/vite excalidraw/excalidraw; do git clone --depth 1 "https://github.com/$r" "../repos/${r#*/}"; done
```
(Use the owner's confirmed list if it differs.) Record each one's commit.

- [ ] **Step 2: Index each into a scratch data folder, with report-resolution**

```bash
export NEBULOSITY_DATA=$(cd .. && pwd)/nebulosity-scratch/variety
for r in ../repos/*; do npx tsx scripts/index.ts "$r" --no-activate && npm run report-resolution -- "$r"; done
```
Expected: no crash. Per repo: files, edges, time, the relative share resolved (near 100%), the bare share and the top unresolved names. Add VS Code's and repo 2's figures from Task 4.

A crash, or a relative share under 95%, gets read: a small general fix comes with a test here; anything else goes in the ledger as a limit.

- [ ] **Step 3: Variety Benchmark #1, S10, the README**

- `docs/BENCHMARKS.md`, "‹today› Variety Benchmark #1 — five real repos": one row per repo (shape, files, edges, structure time, relative and bare shares, top unresolved names).
- `PIVOT_SPEC.md` §2, S10's row: the repos named, and `*(V1.6: Variety Benchmark #1)*`.
- `README.md`:
  - **Who it's for:** someone new to a big TypeScript or JavaScript codebase who uses Claude Code.
  - **Install:** until the package is published, from a checkout (`npm install`, then `npm link` gives the `nebulosity` command); once published, `npm install -g nebulosity`. Node 24 and git.
  - **Three commands:** `nebulosity index .`, `nebulosity map`, `nebulosity setup`.
  - **Free mode:** what works without a key.
  - **Summaries are the paid upgrade:** they send each file's code to Anthropic, cost about $1 per 1,000 files, and the command shows the estimate and asks first.
  - **The six tools.**
  - **Windows, macOS and Linux** (CI).
  - **"Tested on"** the five repos (Variety Benchmark #1).

  Keep Eval #1's section as it is: Task 24 adds Eval #2.

- [ ] **Step 4: Gate, commit, push**

Run the gate. Then:
```bash
git add -A -- docs/BENCHMARKS.md docs/PIVOT_SPEC.md README.md && git commit -m "docs: Variety Benchmark #1 (S10), and the README for people installing it" -- docs/BENCHMARKS.md docs/PIVOT_SPEC.md README.md && git push origin pivot/v1
```
(Add any resolver fix and its test to the same commit's paths, and the commit's subject.)

---

## Part 6 — Eval #2

### Task 20: Repo 2's summaries. STOP for the spend

**Files:** `docs/BENCHMARKS.md` (Summary Benchmark #2), the ledger.

- [ ] **Step 1: The estimate, with nothing spent**

Run, with stdin not a terminal: `npm run summarize -- ../<repo 2> < /dev/null`
Expected: the estimate line (Task 17) and a refusal without `--yes`. Nothing is sent. Record the estimate.

- [ ] **Step 2: Ask**

> Task 20 writes repo 2's summaries on your API key: about ‹n› requests, about ‹$› at list prices by the Batch API (Haiku for files, Sonnet for folders, as VS Code's cost $10.30). Batches can take hours; the run resumes if stopped. OK to spend up to ‹1.5 × the estimate, rounded up›?

- [ ] **Step 3: Run it, on a yes**

`npm run summarize -- ../<repo 2> --yes --budget <the approved cap>`, in the background (`--no-wait` and re-run if it's long). Record Summary Benchmark #2:
- requests by model;
- the cost against the estimate;
- the time;
- failures.

Then read three folder summaries and the repo's (`describe`) and quote them in the ledger for the owner.

- [ ] **Step 4: Commit and push**

```bash
git add -A -- docs/BENCHMARKS.md && git commit -m "docs: Summary Benchmark #2, repo 2's summaries against their estimate" -- docs/BENCHMARKS.md && git push origin pivot/v1
```

### Task 21: The engine frozen, the version pinned, the pilot. STOP before it, and again before the full run

- [ ] **Step 1: Freeze and pin**

- Run `claude --version` and write that version into `eval2/eval.json`'s `claudeVersion`.
- Commit (`test(eval2): pin Claude Code <version>`).
- Record that commit as `EVAL2_ENGINE` in the ledger and in Eval #2's method section.
- From here until Task 24 is committed, nothing changes in `lib/engine`, `lib/tools`, `lib/index`, `lib/db`, `lib/home.ts`, `lib/config.ts` or `mcp/` (R1). A bug found is recorded, not fixed, and reported with the results.
- No `npm run index` on VS Code or repo 2 until then either. The runner records each run's index version. If the owner's Map restarts and its worker's warm run bumps the version with no file changed, that's noted and explained.

- [ ] **Step 2: The dry run**

Run: `npm run eval:run -- --eval eval2 --pilot --dry-run` and `npm run eval:run -- --eval eval2 --pilot --sessions --dry-run`
Expected: every command shows:
- the scripts rules (`Bash(node:*)`, `Edit(//c/…/scratch/<run>/**)`, `--add-dir`);
- each repo's `cwd`;
- the scratch sentence at the end of each prompt;
- no `alwaysLoad` in Nebulosity's config.

- [ ] **Step 3: Ask, with the count**

> The pilot is about 20 `claude -p` runs on your subscription: per repo, 1 big-picture, 1 chain and 2 grep-hard questions in both arms (16), plus 1 task session per repo in both arms (4). Sonnet 5.5 at medium effort, isolated and checked as in Eval #1, scripts allowed in a scratch folder. Each run records your 5-hour and 7-day usage, and the batch stops past 0.9 and 0.85. OK to start?

- [ ] **Step 4: Run it, on a yes**

`npm run eval:run -- --eval eval2 --pilot`, then `npm run eval:run -- --eval eval2 --pilot --sessions`, each in the background. Expected:
- every init valid, Edit and Write present, and Nebulosity's five tools listed in N;
- each repo clean after each run;
- no leak.

A run refused by validation stops the pilot: report it verbatim.

- [ ] **Step 5: Score what can be scored, and report**

`npm run eval:score -- --eval eval2 --only <pilot ids>` (big-picture ungraded until Task 23). Report per run:
- the score, turns, cost estimate, wall time and first-call context;
- the Nebulosity and ToolSearch calls;
- whether A or N wrote a script, and what it did;
- the usage windows' change.

Then the extrapolation: the mean usage per run times about 240, plus the sessions' times 36, in 5-hour windows and in the share of the week.

- [ ] **Step 6: STOP. The owner approves the full count**

The options:
- (a) the full schedule: the remaining single runs and sessions, 3 repeats;
- (b) 2 repeats, if the usage is tight: the gate is unchanged, and the results say so.

Record the decision verbatim.

### Task 22: The full run, scored and adjudicated

- [ ] **Step 1: Run the approved schedule, in batches**

`npm run eval:run -- --eval eval2 --limit 25`, one batch per 5-hour window; then `npm run eval:run -- --eval eval2 --sessions`. Each batch is a background command.
- After each batch, record its runs, usage and notes in the ledger.
- Commit the kept runs: `test(eval2): runs <first>–<last>`.
- An outage (an API error, a run killed at 30 minutes, 60 for a session) is re-run, at most 10 in all. A valid run is never re-run for a better answer.

- [ ] **Step 2: Score, and adjudicate by reading**

Run: `npm run eval:score -- --eval eval2`. For each unknown chain or cycle step it prints, open the file in its repo and read its imports, then add the verdict to `eval2/truth/adjudicated.json` with the import line. Re-run until it exits 0.

- [ ] **Step 3: Commit and push**

```bash
git add -A -- eval2/runs eval2/results.json eval2/truth/adjudicated.json && git commit -m "test(eval2): every run kept and scored, chain and cycle steps adjudicated by reading the source" -- eval2/runs eval2/results.json eval2/truth/adjudicated.json && git push origin pivot/v1
```

### Task 23: Grading the big-picture answers. STOP for the owner's rulings

- [ ] **Step 1: Sheets, and two blind graders**

`npm run eval:grading -- --eval eval2 sheets` writes one sheet per big-picture run (about 54). Grade them as Eval #1's were:
- **Grader 1:** a fresh Sonnet subagent per sheet, with Eval #1's instruction verbatim. Each reply goes to `eval2/grading/<id>.json`.
- **Grader 2:** one Opus subagent over all the sheets, never shown grader 1's replies. Its replies go to `eval2/grading/second/`.

- [ ] **Step 2: STOP. The owner rules on each disagreement, with the arms hidden**

Show each point where the graders differ: the rubric point, both scores, both quotes, and a suggested score. Record the owner's words verbatim in `eval2/grading/review.json`.

- [ ] **Step 3: Merge, score, commit**

Run `npm run eval:grading -- --eval eval2 merge`, then `npm run eval:score -- --eval eval2`. Then:
```bash
git add -A -- eval2/grading eval2/results.json && git commit -m "test(eval2): big-picture answers graded blind by two models, the owner ruling on each disagreement" -- eval2/grading eval2/results.json && git push origin pivot/v1
```

### Task 24: The results, the gate's verdict, losses included. STOP for the owner's call

**Files:** `docs/EVAL_RESULTS.md`, `README.md`, `docs/ENGINEERING_DECISIONS.md` (ADR-057, 051, 024 and 043 amended), `docs/BENCHMARKS.md`, `docs/PIVOT_SPEC.md` §2 and §9

- [ ] **Step 1: Write the results**

Under Eval #2's method, every number recomputed from `eval2/results.json` and `eval2/runs/index.jsonl`:
- **The gate, first:** D1's table with each condition's numbers from `gateVerdict` and PASS or FAIL, then the verdict in one sentence.
- **The headline per repo and family:** the mean score, recall, precision and F1 where they apply, and the median tokens, first-call context, cost estimate, wall time and tool calls.
- **Per question:** every run, with one line on what happened, read from the transcripts. Where N won, where it lost and why; what A's scripts did; whether N used the tools.
- **The sessions:** cumulative cost, time and score per session and arm.
- **The losses**, in their own section, named plainly.
- **Tool use:** the share of N's runs calling a tool, by kind; ToolSearch calls; the per-turn cost against Task 3's and Task 13's measures.
- **Against Eval #1:** the same 15 VS Code questions, both evals side by side, with what changed between them (V1.6's resolution, docs pointers and tools; scripts allowed; three repeats; Claude Code's version).
- **Usage:** the windows and the cost estimate.
- **What this says about the claim**, in plain sentences, including any family where Nebulosity didn't help.
- **Raw data.**

- [ ] **Step 2: The README, the ADRs, the spec**

- **README:**
  - If the gate passed, the lead says what Eval #2 measured, with its losses in the same paragraph (as V1.5's README did for Eval #1). Eval #1 stays, as the earlier result.
  - If it failed, the README states Eval #2's results the same way and makes no claim beyond them. The repo stays private either way until the owner decides.
- **ADR-057**, at its end: `**Amended (‹today›, the runs):** ‹counts, version, usage›; the gate ‹passed | failed: conditions ‹ids››.`
- **ADR-051**, at its end:
  - pass: `**Amended (‹today›, Eval #2): the hold is lifted.** Eval #2 passed the ship gate (ADR-057); the deploy, the public switch, the package and the video can go ahead, in the owner's hands.`
  - fail: `**Amended (‹today›, Eval #2): the hold stays.** Eval #2 failed conditions ‹ids› of the gate (ADR-057).`
- **ADR-024**, at its end: one sentence on what two evals say about the value proposition. On a fail, say plainly that ADR-024's revisit condition holds a second time.
- **ADR-043**, at its end: E2's case after Typecheck Benchmark #1 and Eval #2, and the order after V1.6 (below), for the owner to decide.
- **`PIVOT_SPEC.md`:** §2 gains a row S12, "Eval #2 passes the ship gate (ADR-057)", with its result; §9 gains a closing line on Eval #2. `BENCHMARKS.md` gets a pointer.

- [ ] **Step 3: Gate, commit, push**

```bash
git add -A -- docs/EVAL_RESULTS.md README.md docs/ENGINEERING_DECISIONS.md docs/BENCHMARKS.md docs/PIVOT_SPEC.md && git commit -m "docs: Eval #2, Claude Code with and without Nebulosity on VS Code and <repo 2>: the gate <passed|failed>, losses included" -- docs/EVAL_RESULTS.md README.md docs/ENGINEERING_DECISIONS.md docs/BENCHMARKS.md docs/PIVOT_SPEC.md && git push origin pivot/v1
```

- [ ] **Step 4: STOP. The owner's call**

Show the gate table and the losses, and say what follows from each outcome:
- **pass:** going public can start, in the owner's hands (Task 25's list);
- **fail:** what failed and why, from the transcripts, and the options. They are: a V1.7 aimed at the failed conditions (E2 if calls through injected services were the gap); repositioning, ADR-024's question; or shipping as a measured tool with the losses stated. Don't soften it.

### Task 25: Close-out. STOP before the PR

- [ ] **Step 1: The record**

- `docs/IMPLEMENTATION_ROADMAP.md`: the V1.6 row marked DONE, re-scoped, pointing at this plan and Eval #2.
- `PIVOT_SPEC.md` §12's V1.6 row re-scoped, and §15's ADR table gains ADR-053 → ADR-058.
- CLAUDE.md's current state (gitignored, so local only): V1.6 done, Eval #2's verdict, what's next.
- Copy anything useful from the session scratchpad into the ledger folder.

- [ ] **Step 2: A final review**

A fresh read-only reviewer reads the whole branch from this plan's commit, with the plan, the ledger and the rulings. It checks:
- the plan followed (as amended);
- the layering (`lib/` imports, the eval's independence pin);
- the freeze (`git diff --stat <EVAL2_ENGINE>..HEAD -- lib mcp` touches nothing the server runs);
- privacy in every committed transcript (an independent leak scan);
- Eval #2's headline numbers recomputed from the data;
- the docs against the code.

It writes `final-review.md` in the ledger (dated header, "2026 10 ‹dd› V1.6 Final Review #1"). Fix what it calls SHOULD-FIX in one wave, then have the wave re-reviewed.

- [ ] **Step 3: STOP before the PR**

Show the review's verdict, the deferred minors and the PR text. The PR is `pivot/v1 → main`. Its body lists V1.6's tasks, the gate's result and the deferred minors, with no attribution line. Open it only on the owner's yes, then bind it with the ccd_pr tools.

If the gate passed, the owner's ship list is:
1. Re-export and rebuild the demo with V1.6's data, in the sandbox worktree (`npm run export-demo -- ../vscode`, `npm run build-demo`; the leak scan passes).
2. Deploy it (owner).
3. Turn on GitHub's email privacy settings, then make the repo public (owner).
4. Set `"private": false` and `npm publish` from a clean checkout of the merged commit (owner).
5. Record the video (owner), with `docs/DEMO_VIDEO.md` updated to Eval #2's numbers first.
6. Add the demo, video and npm links to the README.

---

## After V1.6: where the extras fit

- **E2 (call graph)** is the strongest efficiency extra. "Who calls this method through an injected service" is something grep can't answer, and VS Code, AFFiNE and Theia all inject services. Typecheck Benchmark #1 (Task 2) says what it would cost, and Eval #2 says whether efficiency is the story. The owner decides at Task 24; it would be V1.7, with its own questions (callers and callees) and a third eval.
- **E3 (co-change)** stays optional. `git log` answers "what changes with this file" in one command, so it saves little.
- **E4 (Python), E5 (clustering) and E1 (the Guide)** aren't efficiency features.
  - E4 decides who can use Nebulosity at all.
  - E5 serves big-picture questions on repos whose folders don't show their structure, and brings the focus view.
  - E1 serves the owner's learning goal.
  - They keep ADR-043's order, E4 → E5 → E1, after V1.6. E2 goes first only if the owner picks it at Task 24.

## Self-review (done while writing; the executor can skip this)

- **The task's three levers:**
  - *Lever 1, tools used cheaply:* Tasks 3, 12 and 13, and gate conditions 5a and 5b. The always-loaded registration is the tools' own `_meta`; descriptions are trimmed and the tools merged into six (`imports`); answers stay compact (§17's rules, the size test); the setup-free guidance is the server's instructions (the snippet is ruled out, R5).
  - *Lever 2, what grep can't:* impact (Task 6), architecture facts (Task 7), docs pointers (Task 5), both resolution gaps plus workspace packages (Task 4). E2 and E3 are weighed, E2 measured (Task 2); E1, E4 and E5 are placed above.
  - *Lever 3, Eval #2:* Tasks 8–11 and 14 and 20–24: grep-hard questions, a second repo with no agent guide plus VS Code, task sessions, the same isolation and honesty rules, scripts allowed (the owner's pick), and the gate fixed before the first run.
- **V1.6's original scope:** the package (Task 16), three systems (Task 18), repos of different shapes (Task 19), free mode and the cost confirmed (Task 17), the README for users (Task 19). It interleaves as Part 5, after the questions are written and while the owner reviews them, and before the freeze.
- **Placeholders:** each `‹…›` is a measured value or the commit's date, filled at the time (Global Constraints). Repo 2's id and commit come from Task 1's stop, and its targets from Task 14's rules. No step says "handle edge cases" without the case.
- **Names used across tasks**, checked against their definitions:
  - `reach(root, path, direction, { within })`, `impact(root, path, direction, { groupBy, within })`, `architecture(root, path, report, { through })`;
  - `reachHeader`, `reachAnswer(a, page, after)`, `rootLines(tests, roots)`, `impactAnswer(i)`, `architectureAnswer(a, page)`;
  - `ToolEntry.alwaysLoad` and `ToolEntry.searchHint`, `toolMeta`;
  - `dataDir`, `dataPath`, `userDataDir`, `setupCommand`, `SNIPPET`;
  - `estimateSpend`, `plannedRequests`, `confirmSummaries`, `summariesConfirmed`;
  - `loadDefinition`, `claudeArgs(arm, mcp, pins, { scratch })`, `scratchRule`, `promptFor`, `schedule(…, { upfront })`, `validateInit(run, { …, scripts })`;
  - `summarizeSession`, `userMessage`;
  - `createTruthResolver`, `scanRepo(root, { resolveBare })`, `computedSites`, `preProcessGraph`;
  - `impactByFolders`, `shortestCycle`, `filesNothingImports`, `importersWithin`, `rootsReaching`, `childPairs`, `namePairs`;
  - `scoreCounts`, `f1`, `scorePairs`, `scoreCycle`, `gateVerdict`.
- **Review Focus:** each of the five lines has its test in the task named: 4, 4, 5, 7, and 15, 16 and 18 for the last.
- **What's honest about the gate:** it was set after Eval #1 by the owner, and Eval #2's grep-hard family is chosen where the tools should help. The results say both. Eval #1's families stay in with a no-loss condition, so the gate can't be passed on chosen questions alone.
