# The pre-ship pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave Nebulosity able to run without its owner. Summary models can change without a release, the MCP server has a plain JSON config, two ways E4 links the wrong file are fixed, the README says the project is complete, and the bars are re-checked.

**Architecture:** Four independent changes, each on its own branch off `pivot/e4`, built in parallel in their own worktrees and each reviewed. Then they're merged into `pivot/e4` together with the README's status rewrite, CI on three systems, S1's quiet re-run and a final review.

**Tech Stack:** TypeScript on Node 24, vitest, web-tree-sitter 0.27.1, the pinned `@anthropic-ai/sdk`, and Claude Code's `claude mcp` commands (CI only).

**Spec:** the five items proposed on 2026-10-25 and approved by the owner the same day ("do the pass"); `progress-controller.md` in the ledger quotes both. They build on ADR-058 (free mode, a yes before any spend), ADR-046 and ADR-048 (the MCP registration) and ADR-065 (E4).

**Models (the owner's rule):** planning agents run Opus 5.5 at max effort, and implementation agents and reviewers Opus 5.5 at xhigh.

## How this plan runs

- **Tasks M, J, P and C run at once.** Each is on its own branch from `origin/pivot/e4`, in a worktree the controller prepares (branch made, `npm ci` done):

  | Task | Item | Worktree | Branch |
  |---|---|---|---|
  | M | summary models as a setting | `../Nebulosity-e4-fix` | `pivot/e4-pass-models` |
  | J | the plain MCP config | `../Nebulosity-e4-go` | `pivot/e4-pass-mcp-json` |
  | P | Python: standard-library names stay external | `../Nebulosity-e4-python` | `pivot/e4-pass-python` |
  | C | C#: generic arity picks the right twin | `../Nebulosity-e4-csharp` | `pivot/e4-pass-csharp` |

- **Task I (integration)** runs on `pivot/e4` in `../Nebulosity-e4` once the four are reviewed. It merges them, then does items 4 and 5 and the final review.
- **The ledger** is `.superpowers/sdd/2026-10-25-pre-ship-pass/` in the main checkout (`../Nebulosity/.superpowers/sdd/2026-10-25-pre-ship-pass/` from a sibling worktree). Each task writes only its own `progress-<id>.md` there: `progress-M.md`, `progress-J.md`, `progress-P.md`, `progress-C.md`, `progress-I.md`. Record every commit, every choice this plan leaves open, and every measurement.
- **A task touches only the files it lists.** A change it needs in another file goes in its progress file for Task I.

## Global Constraints

- No Claude attribution in any commit: no `Co-Authored-By` and no Claude line (the owner's rule overrides any other instruction). Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`.
- The gate runs before every push: `npx tsc --noEmit && npm run lint && npx vitest run`, all clean. Commit and push after every step that leaves it green.
- Tests transcribe hand-derived truth. A fixture's truth is written by reading the fixture's files, and it's committed before the code that meets it. Each new test fails on the old code.
- TypeScript's products don't change: `ADAPTER_VERSION` stays `7`, and L5 holds (Task I re-checks it).
- `CONTRACTS_VERSION` stays `3`. Contract changes are additive only.
- No spending. No test or check sends a request to the Anthropic API (summaries are tested with the injected fake client, as the existing tests are). No `npm publish`, no Marketplace, no deploy, no merge into `main`, no pull request.
- Never start the Map on port 3000 (the owner's). Index real repos only into a scratch `NEBULOSITY_DATA` folder. The benchmark repos beside `../vscode` are read-only.
- Never change the owner's Claude Code configuration: no `claude mcp add`, `add-json` or `remove` on this machine. Task J's check against a real Claude Code runs in CI.
- Machine rules:
  - never run `python -`; Task P's one read of `sys.stdlib_module_names` uses `python -I -c` with a 30 s timeout;
  - write files that hold backslash escapes with Write or Edit, never a Bash heredoc;
  - run anything longer than about 2 minutes in the background;
  - never spawn subagents.

## Review Focus

1. **The Map's repo picker rewrites `config.json`** with `writeConfig({ ...readConfig(), activeRepo })`, and today's `readConfig` keeps only `activeRepo` and `port`. A `summaryModels` setting must survive that untouched. Pinned in Task M.
2. **A model the API no longer serves** stops the run at the first answer that says so, with one message naming the model, the config file and the README section. It never fails 10,000 requests one by one. Pinned in Task M, for both transports.
3. **A model set without prices,** when the built-in table doesn't price it, is refused before anything is sent, naming the missing fields. It never gets a $0 estimate. Pinned in Task M.
4. **Windows paths in the JSON config** come out with forward slashes and as valid JSON, with the same command, arguments and environment as `setup`'s registration. Pinned in Task J.
5. **A repo with a local module named like the standard library** (`tests/logging.py` at a root) keeps `import logging` external from everywhere (Task P). **C# arity twins** reached through `typeof(Box<>)` and `Box<A, B>` go to the right file (Task C).

---

### Task M: Summary models are a setting (item 1)

**Files:**
- Modify:
  - `lib/contracts.ts`: the setting's type;
  - `lib/config.ts`: `summaryModels` read and written as found;
  - `lib/index/summarize/prompts.ts`: `SUMMARY_MODELS` stays as the defaults;
  - `lib/index/summarize/pricing.ts`: prices come from the setting first;
  - `lib/index/summarize/claude.ts`: the fallback beta goes only with the defaults, and a model that's gone stops the run;
  - every reader of `SUMMARY_MODELS`, `pricePerMTok` and `costUsd` (`git grep` them), the background service's summarize path and `nebulosity doctor` included.
- Create: `lib/index/summarize/models.ts`, the resolver.
- Test: the matching `*.test.ts` files, and `lib/index/summarize/models.test.ts`.
- Docs:
  - `docs/API_CONTRACTS.md`: a new §21, "The settings file (`config.json`)", with `activeRepo`, `port` and `summaryModels`;
  - `docs/ENGINEERING_DECISIONS.md`: ADR-066, plus one pointer line under ADR-028;
  - `docs/PIVOT_SPEC.md` §5.3 and `docs/RAG_PIPELINE.md`: the models are defaults, which the setting overrides;
  - `README.md`: a "Summary models" subsection under "Summaries: the paid upgrade".

**Interfaces:**
- Consumes:
  - `readConfig()` and `writeConfig()` (`lib/config.ts`);
  - `dataPath()` (`lib/home.ts`);
  - `SUMMARY_MODELS` (the defaults);
  - the `Summarizer` and the fake clients the summarize tests already use.
- Produces:
  - In `lib/contracts.ts`: `SummaryModelSetting = { model: string; inputPerMTok?: number; outputPerMTok?: number }` and `SummaryModelsSetting = Partial<Record<"file" | "folder" | "repo", SummaryModelSetting>>`.
  - In `lib/config.ts`: `NebulosityConfig` gains `summaryModels?: unknown`. `readConfig()` returns the file's value as found when it's a JSON object, so a `writeConfig({ ...readConfig(), … })` round-trips it unchanged. `readConfig()` never throws over it: the Map has to start with a broken setting.
  - In `lib/index/summarize/models.ts`: `resolveSummaryModels(setting: unknown, configPath: string)`. It returns `{ ok: true; models: { file: string; folder: string; repo: string }; prices: Record<string, { input: number; output: number }>; custom: { file: boolean; folder: boolean; repo: boolean } }` or `{ ok: false; error: string }`.
  - `pricePerMTok(model, prices?)` and `costUsd(model, usage, transport, prices?)` check the given prices before the built-in table.

**Decisions:**
- **Where the setting lives.** It goes in the data folder's `config.json` (the file `readConfig` reads, which `NEBULOSITY_DATA` moves), under `summaryModels`, keyed by kind. A kind left out keeps its default. For example:
  ```json
  { "summaryModels": { "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 } } }
  ```
- **Prices.**
  - They're required for a model the built-in table doesn't price (the table's prefix match, as today). For a model it does price, they're optional, and given prices win.
  - Missing prices, a model that isn't a non-empty string of at most 200 characters, a price that isn't a finite number ≥ 0, or a kind other than file/folder/repo: each is an error naming the field (for example `summaryModels.file.inputPerMTok`) and the config file's path.
  - `nebulosity summarize` checks this before it estimates or sends anything.
- **Changing a model.** The model is part of `inputHash` (PIVOT_SPEC §5.3, unchanged), so changing it re-summarizes everything that model writes, after the estimate and the yes, as today (ADR-058). The background worker still refreshes only files that were edited.
- **The Sonnet fallback beta** (`SONNET_FALLBACK`) goes only with a kind left at its default. A model set in `summaryModels` goes on the plain Messages API, so a newer model never gets a beta it doesn't know.
- **A model that's gone.** That's a 404 `not_found_error` whose message names the model. It can come from a direct request (the SDK's `NotFoundError`), from a batch whose creation is refused, or from a batch result that errored with that error.
  - On the first one, the run sends nothing more, keeps every summary already stored, and prints one message with this content (the wording is the implementer's):
    > `<model>` isn't available any more (the API said: …). Choose another model under "summaryModels" in `<config path>`; see the README's "Summary models".
  - The Map's "Summarize now" answers with the same text as its error.
  - A 404 for anything else, such as a batch's results past retention, keeps today's handling.
- **When the setting is read.** The worker and the Map read it through `readConfig()` at each job, so a changed setting applies to the next job without a restart.
- **`nebulosity doctor`** prints the summary models in use and says which are set. A broken setting is one more line of what's wrong.
- **What the README says.** A model set there has to accept the same requests: structured output (a JSON schema) and the effort setting.
- **ADR-066** records all of the above, with the status "accepted 2026-10-25, made for the owner (open to their veto)".

- [ ] **Step 1: Write the failing tests**
  - `config.test.ts`: a `config.json` holding `summaryModels` (and an unknown extra key) goes through `writeConfig({ ...readConfig(), activeRepo: "/x" })`. The file's `summaryModels` then deep-equals what was written, and `readConfig()` doesn't throw when `summaryModels` is a string.
  - `models.test.ts`:
    - no setting gives the three defaults and `custom` all false;
    - a file setting with prices gives that model and those prices, with folder and repo at their defaults;
    - `{ file: { model: "claude-zeta-1" } }` gives an error containing `summaryModels.file.inputPerMTok` and the config path;
    - `{ folder: { model: "claude-sonnet-5-5-20261001" } }` (the table's family) takes the table's prices;
    - `{ file: { model: "" } }`, `{ blob: { model: "x" } }` and `"text"` each give an error.
  - `pricing.test.ts`: `costUsd` with given prices, hand-computed. 1,000,000 input and 200,000 output tokens at 0.10 and 0.50 make $0.20 direct and $0.10 batch.
  - `claude.test.ts`, with the fake client:
    - a default folder request goes through `beta.messages.create` with the fallback;
    - a folder request for a set model (`custom.folder` true) goes through `messages.create` without `betas` or `fallbacks`.
  - The run test: the fake client throws a 404 `not_found_error` "model: claude-haiku-5-5" on the first file. No second request is sent, the run's message names the model, the config path and "Summary models", and the stored rows are unchanged. Do the same for a batch result that errored that way.
  - `summarize-command.test.ts`: an unknown model without prices is refused before the estimate, and nothing is sent.
- [ ] **Step 2:** Run them and watch each fail for the expected reason.
- [ ] **Step 3:** Implement. Make every reader take the resolved models and prices.
- [ ] **Step 4:** Run the gate (all clean, existing tests unchanged), then commit and push.
- [ ] **Step 5:** Update the docs listed above, then commit and push.

### Task J: The plain MCP config (item 2)

**Files:**
- Modify:
  - `scripts/cli.ts`: setup's arguments, a shared registration builder, the JSON printer;
  - setup's test file (`git grep -l setupCommand -- '*.test.ts'`);
  - `.github/workflows/ci.yml`: one step after the existing setup step;
  - `README.md`: the setup section;
  - `docs/ENGINEERING_DECISIONS.md`: one amendment line under ADR-048.

**Interfaces:**
- Consumes: `Registration`, `addCommand` and `setupCommand` (`scripts/cli.ts`); setup's launcher path and data-folder logic, as `runSetup` uses them.
- Produces:
  - `setupRegistration(launcher: string, platform?: NodeJS.Platform, dataFolder?: string): Registration`, which both routes use;
  - `mcpJson(registration: Registration): string`;
  - `nebulosity setup --json`.

**Decisions:**
- **`nebulosity setup --json`** prints the block and nothing else on stdout, then exits 0. It runs no command and writes no file, so `nebulosity setup --json > somewhere.json` works.
- **The block,** 2-space indent with a trailing newline:
  ```json
  {
    "mcpServers": {
      "nebulosity": {
        "command": "node",
        "args": ["C:/Users/you/AppData/Roaming/npm/node_modules/nebulosity/mcp/launch.mjs"]
      }
    }
  }
  ```
  `"env"` is there only when the registration has an environment (a custom `NEBULOSITY_DATA`). There's no `"type"` key: stdio is what every client assumes when `command` is given. Paths use forward slashes, as the registration does.
- **Flags.** `--json` with `--print`, or any other argument, is the usage error (exit 1).
- **The README subsection,** "Other MCP clients, or by hand":
  - `nebulosity setup --json` prints the block.
  - In Claude Code, `claude mcp add-json nebulosity '<the "nebulosity" object>' --scope local` registers it without `nebulosity setup`.
  - Clients that read an `mcpServers` block (Cursor, Claude Desktop) take the block as it is. Name only the config-file locations those clients' own docs give, and if you can't confirm one, say "your client's MCP settings".
  - Outside Claude Code, the server answers about the repo last indexed or picked on the Map (ADR-046), so run `nebulosity index` there first.
- **ADR-048 amended (2026-10-25):** `setup --json` prints the same registration as a JSON block, for other clients and for a later Claude Code whose `mcp add` changes.
- **The CI step,** on each system, after the existing setup step, in the same temporary repo copy. It runs `nebulosity setup --json` and takes `.mcpServers.nebulosity` out of it (with `node -e`). Then it runs `claude mcp add-json nebulosity-json '<that object>' --scope local`; `claude mcp list` must show `nebulosity-json` as connected; then `claude mcp remove nebulosity-json --scope local`. CI is the only place it runs (see the Global Constraints).

- [ ] **Step 1: Write the failing tests.**
  - `mcpJson` for a POSIX launcher and for a Windows launcher (backslashes in, forward slashes out), each with and without a custom data folder. The output parses as JSON with exactly the keys above, `env` only with the data folder.
  - `setup --json` prints only the block, and the command runner is never called (spy on it as the existing setup tests do).
  - `setup --json --print` is the usage error, exit 1.
- [ ] **Step 2:** Run them and watch each fail.
- [ ] **Step 3:** Implement. `setupCommand` builds its line from `setupRegistration`, and its own tests pass unchanged.
- [ ] **Step 4:** Run the gate, then commit and push.
- [ ] **Step 5:** Add the CI step, the README subsection and the ADR line, then commit and push. Task I's CI run checks the step.

### Task P: Python: standard-library names stay external (item 3, first half)

**Files:**
- Modify: `lib/index/languages/python/**` (`resolve.ts`; `index.ts`, where the adapter `version` goes 1 → 2; the tests); `test/fixtures/python-repo/**` (a shadowing case); `test/helpers/python-repo-truth.ts`.
- Create: `lib/index/languages/python/stdlib.ts`.
- Docs: none in this task. The ADR-065 amendment, the README's Python line and the BENCHMARKS numbers are Task I's, from `progress-P.md`.

**Decisions:**
- **The rule.** An absolute import (`import a.b`, `from a.b import c`) whose first segment is a top-level standard-library module name never resolves to a repo file. It's external, like any third-party package. Relative imports (`from . import x`, `from .logging import y`) are unchanged, and so is every other absolute import.
- **The list,** a sorted `ReadonlySet<string>` exported from `stdlib.ts`:
  - `sys.stdlib_module_names` of the installed CPython (3.14.3 here), read once with `python -I -c "import sys; print('\n'.join(sorted(sys.stdlib_module_names)))"` and a 30 s timeout. Record the version in a comment and in the ledger. That list leaves out the `test` package, so a repo's own `test/` package still resolves.
  - Plus the top-level modules removed since 3.10, each group cited to its "What's New" page in a comment:
    - 3.10: `formatter`, `parser`, `symbol`;
    - 3.11: `binhex`;
    - 3.12: `asynchat`, `asyncore`, `distutils`, `imp`, `smtpd`;
    - 3.13: `aifc`, `audioop`, `cgi`, `cgitb`, `chunk`, `crypt`, `imghdr`, `lib2to3`, `mailcap`, `msilib`, `nis`, `nntplib`, `ossaudiodev`, `pipes`, `sndhdr`, `spwd`, `sunau`, `telnetlib`, `uu`, `xdrlib`.
  - Check each removal against its What's New page before committing it.
- **The version.** The adapter version becomes 2, since Python's products change for a repo with such a module.
- **The first half of M6** (cross-root shadowing between two roots' own modules) stays out of scope. Say so in `progress-P.md`.

- [ ] **Step 1: Measure the base.** Before any change, index `../django` into a scratch `NEBULOSITY_DATA` with this worktree's code. Keep `npm run report-resolution` (L2/L3) and `npm run dump-index -- ../django --out <scratch> --languages python` for the edge diff.
- [ ] **Step 2: The fixture and its truth first.**
  - Add a module named like a standard-library module at one of the fixture's roots (for example `tests/logging.py`).
  - In the package, add one importer with `import logging` and one with `from logging import getLogger`. Both are external, with no edge.
  - Add a package module `logging.py` with a sibling that does `from . import logging`. That's an edge, as before.
  - Leave an ordinary absolute import of the fixture's own package, which still resolves.
  - Write the truth by hand from those files, then commit and push.
- [ ] **Step 3:** Run the Python tests and the conformance kit, and watch the new truth fail.
- [ ] **Step 4:** Implement `stdlib.ts` and the rule, and bump the version.
- [ ] **Step 5:** Run the gate, then commit and push.
- [ ] **Step 6: Measure again** on `../django`: L1–L3, and the edge diff against Step 1's dump. Read every removed or added edge in Django's source and explain it in `progress-P.md`. The expected diff is empty or tiny: Django has no such module.

### Task C: C#: generic arity picks the right twin (item 3, second half)

**Files:**
- Modify: `lib/index/languages/csharp/**` (`parse.ts`; `resolve.ts`; `index.ts`, where the adapter `version` goes 2 → 3; the tests); `test/fixtures/csharp-repo/**` (an arity twin pair); `test/helpers/csharp-repo-truth.ts`.
- Docs: none in this task. The ADR-065 amendment, the README's C# line and the BENCHMARKS numbers are Task I's, from `progress-C.md`.

**Decisions:**
- **The rule.** A type reference with n generic arguments resolves to the files declaring that name with arity n, when there are any. When none exist, it resolves as today, to every file declaring the name. For example:
  - `Box<int>` has n = 1, and so does `typeof(Box<>)`;
  - `Box<int, string>` and `typeof(Box<,>)` have n = 2;
  - `Box` has n = 0.

  The same rule holds for qualified names and `using static`. Partial types (one name and one arity, in several files) still link to every part.
- **The representation is the implementer's choice.**
  - Either the arity goes in `declares` and in the specifiers (`` type:Box`1 ``, the CLR's backtick convention), or it travels beside the name at resolution time.
  - Either way, `displaySpecifier` keeps showing the name as the source writes it, without generic arguments, as today (`Box`).
  - Record the choice and its reason in `progress-C.md`.
- **The version.** The adapter version becomes 3.

- [ ] **Step 1: Measure the base.** Before any change, index `../jellyfin` into a scratch `NEBULOSITY_DATA`. Keep `npm run report-resolution` (L2/L3) and `npm run dump-index -- ../jellyfin --out <scratch> --languages csharp`.
- [ ] **Step 2: The fixture and its truth first.**
  - Add `Box.cs` (`class Box`) and `BoxOfT.cs` (`class Box<T> : Box`) in one namespace.
  - Add references in other files:
    - `new Box()` links to `Box.cs` only;
    - a field `Box<int>` links to `BoxOfT.cs` only;
    - `typeof(Box<>)` links to `BoxOfT.cs`;
    - a `Pair<A, B>` with no twin links as before.
  - `BoxOfT.cs` links to `Box.cs` through its base type.
  - Write the truth by hand from the files, then commit and push.
- [ ] **Step 3:** Run the C# tests and the conformance kit, and watch the new truth fail.
- [ ] **Step 4:** Implement the rule, and bump the version.
- [ ] **Step 5:** Run the gate, then commit and push.
- [ ] **Step 6: Measure again** on `../jellyfin`: L1–L3, and the edge diff against Step 1's dump.
  - Read every changed edge in jellyfin's source and explain it in `progress-C.md`.
  - Expected: the six twin names' references (BasePlugin, StartupLogger, WebSocketMessage, InboundWebSocketMessage, OutboundWebSocketMessage, IRemoteSearchProvider) move to their matching files. E4's sampled edge #24 (the Omdb plugin) goes to `BasePluginOfT.cs`.

### Task I: Integration, the README's status, CI and S1 (items 4 and 5)

**Files:** the merges; `README.md`; `docs/ENGINEERING_DECISIONS.md` (the ADR-065 amendments, ADR-067); `docs/BENCHMARKS.md`; `docs/PIVOT_SPEC.md` (§10's banner); `docs/IMPLEMENTATION_ROADMAP.md` (the extras' rows); the ledger.

- [ ] **Step 1: Merge** each reviewed branch into `pivot/e4` with `git merge --no-ff`, in the order P, C, M, J. Run the gate after each merge, and resolve doc conflicts by keeping both sides' text.
- [ ] **Step 2: The docs roundup.**
  - ADR-065 amended with Python's standard-library rule (version 2) and C#'s arity rule (version 3), each with its measured diff.
  - BENCHMARKS' django and jellyfin rows amended with the new numbers.
  - The README's Python and C# lines.
- [ ] **Step 3: Item 4.** Rewrite the README's status paragraph:
  - Nebulosity is complete, and this release is the last;
  - what it does (the seven tools, the Map, the VS Code extension; TypeScript and JavaScript plus Python, Go, Java, C# and Rust; free mode, with summaries as the paid upgrade);
  - the versions it was tested on: Node 24.14, Claude Code 2.1.310 (it needs 2.1.300 or later), VS Code 1.105.0 and 1.143.1, Windows 11 here, and macOS and Linux in CI;
  - it isn't maintained after this release: nobody watches issues or pull requests.

  ADR-067 records the owner's call of 2026-10-25: the project is complete at ship, and E5, E1, E3 and the rest of E2 won't be built. It amends ADR-043 and ADR-062. PIVOT_SPEC §10 gets a banner line, and the roadmap's rows for those extras read "not built (ADR-067)".
- [ ] **Step 4: Item 5, CI.**
  - Push `pivot/e4`'s tip to `ci/e4-pass` (`git push origin <sha>:refs/heads/ci/e4-pass`), then watch it with `gh run watch <id> --exit-status`.
  - All three systems must be green, Task J's step included.
  - A failure gets one fix, then one more run.
- [ ] **Step 5: Item 5, S1 on a quiet machine.**
  - Run it only while no agent is running and nothing else heavy is going on.
  - The A/B is per process, alternating the base `../Nebulosity-e4-base` (`75b4774`) and `pivot/e4`, three runs each. Each run gets a fresh `NEBULOSITY_DATA`: `npx tsx scripts/index.ts ../vscode --no-activate`.
  - Record it in BENCHMARKS as Index Benchmark #9, with the machine note, and state the pass or fail as measured.
- [ ] **Step 6: The final review.**
  - One reviewer (Opus 5.5, xhigh) reviews `1e47842..HEAD` against this plan.
  - One fix wave, then one scoped re-review.
  - Write the hand-over in `progress-I.md`, and update CLAUDE.md's state (it's local).
