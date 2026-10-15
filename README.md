# Nebulosity

**Nebulosity does the import walk a dependency question needs in one call. Measured on VS Code and AFFiNE, Claude Code with it answered those questions in under half the time of Claude Code alone, at the same or a higher score, and for less. It didn't make big-picture answers better, and it failed the ship gate it was measured against.**

Nebulosity indexes a big TypeScript or JavaScript repository once and keeps the index fresh as files change: its folder tree, every import between its files, and, with an Anthropic API key, a short summary of every file and folder. It serves that index two ways: to AI agents like Claude Code through an MCP server, and to people through a zoomable Map. In Eval #2, 270 runs on VS Code and AFFiNE against Claude Code alone, which could write its own Node.js scripts, it made the questions that walk the import graph faster and cheaper. Over both repos the medians were 8.4 s against 28.1 s and $0.031 against $0.066, scoring 1.00 against 0.94. The gate compares each repo, and on VS Code the cost was 0.57 of Claude Code alone's, where it asked for 0.5. Part of the cost gap comes from the eval's own rules: shell commands outside an allowlist were refused instead of asked about, and Claude Code alone had one refused in 42 of its 69 runs on these questions. On the runs without a refusal, the ratios were 0.39 for time and 0.74 for cost, scoring 1.00 against 0.96. Sessions of four related questions took 0.29 of the time and 0.39 of the cost, though every one of Claude Code alone's sessions had a refused command. It didn't help on big-picture questions: 0.84 against 0.93 on VS Code and 0.68 against 0.70 on AFFiNE. On the hardest dependency questions it raised the score by 0.09, where the ship gate set before the eval asked for 0.15, and the gate failed on four of its seven conditions.

[How it compares with Claude Code alone](docs/EVAL_RESULTS.md)

![The Map on VS Code's src/vs/platform folder](docs/screenshots/map-vscode.png)

## Why

Some questions about a big repo are walks over its import graph. What depends on this file, directly or through other files? How does this entry point end up loading that file? In Eval #2, Claude Code on its own answered them by writing its own import-walking scripts or following imports with grep, a median 6 turns a question, against 2 with Nebulosity. Nebulosity reads every import once, keeps the graph current while the Map runs, and answers such a question in one call. It plugs into Claude Code instead of replacing it: Claude Code still reads the code and writes the answer. The same index draws the repo for people, one folder at a time.

## What it does

- **The Map**: one folder at a time, at most 50 boxes, lines for imports between them; big folders split into pages of related boxes; a panel with each box's summary, contents, what it uses and what uses it; a read-only source viewer; search with Ctrl K.
- **Six MCP tools for Claude Code**: `overview`, `describe` (with the docs about a place), `search`, `imports` (dependents, dependencies, what a change affects, import chains), `architecture` (layers, conventions, cycles, files nothing imports) and `show_on_map`.
- **Fresh**: while the Map runs, a background worker reflects a saved file in 1.975 s at worst once warm (Update Benchmark #2) and, with a key, refreshes its summary after a quiet minute.

## How it compares with Claude Code alone

**Eval #2 (2026-10-15).** Claude Code answered 39 questions about two big repos, VS Code and AFFiNE, three times each. It answered once on its own and once with Nebulosity's MCP server, registered the way `nebulosity setup` registers it. It also worked through 6 task sessions of four related questions each, in one conversation: "I'm about to change this file: what could it affect?", then an import chain, a cycle and the files nothing imports. On its own, Claude Code could read, search and write its own Node.js scripts.
- *Big-picture questions* ask how the code is organized.
- *Graph questions* need a walk over the import graph: the shortest chain of imports between two files, every file that depends on one directly or through other files, what a change would affect, import cycles, files nothing imports, imports that break a layering rule, the entry points that load a file, and which folders import which.

| Questions | Repo (runs per setup) | Score: alone / with Nebulosity | Median time | Median cost estimate |
|---|---|---|---|---|
| Big-picture | VS Code (15) | 0.93 / **0.84** | 13.9 / 11.5 s | $0.033 / $0.031 |
| Big-picture | AFFiNE (12) | 0.70 / 0.68 | 20.5 / 20.9 s | $0.054 / $0.065 |
| Lists of direct importers | VS Code (12) | 0.96 / 0.98 | 28.0 / 22.7 s | $0.073 / $0.073 |
| Lists of direct importers | AFFiNE (9) | 1.00 / 1.00 | 22.4 / 12.0 s | $0.059 / $0.043 |
| Graph questions | VS Code (36) | 0.94 / 1.00 | 20.9 / **8.7 s** | $0.048 / **$0.027** |
| Graph questions | AFFiNE (33) | 0.93 / 1.00 | 31.5 / **7.5 s** | $0.079 / **$0.034** |
| Task sessions (4 questions) | VS Code (9) | 0.98 / 1.00 | 76.7 / **26.1 s** | $0.168 / **$0.079** |
| Task sessions (4 questions) | AFFiNE (9) | 0.91 / 1.00 | 106.3 / **25.1 s** | $0.319 / **$0.156** |

The score is the share of rubric points for big-picture questions, recall for lists, and each graph question's own score: a valid shortest chain, the error in a count, or F1 for a list of files. The cost is Claude Code's own estimate at list prices.

**Where it helped.**
- **Getting the context a graph question needs.** With Nebulosity, Claude Code answered in a median 2 turns and one Nebulosity call. On its own it took 4.5 turns on VS Code and 8 on AFFiNE. With Nebulosity it was 2.4 and 4.2 times as fast, at 0.57 and 0.43 of the cost estimate, and scored 1.00 against 0.94 and 0.93.
- **Task sessions:** 2.9 and 4.2 times as fast, at 0.47 and 0.49 of the cost, scoring 1.00 in every session against 0.98 and 0.91.
- **The longest walks:** listing every file that depends on a file, directly or through other files, was 5.9 times as fast on VS Code (scoring 1.00 against 0.92) and 8.7 times on AFFiNE (1.00 against 1.00), at 0.19 and 0.12 of the cost.
- **Part of the cost saving is the eval's.**
  - The eval ran Claude Code non-interactively, so a shell command outside its allowlist was refused, not asked about. Claude Code alone hit that in 42 of its 69 graph runs and in all 18 sessions, usually when it tried to run a script. It then often walked the imports with grep instead.
  - On the graph runs without a refusal, Nebulosity was 2.7 times as fast on VS Code and 2.6 on AFFiNE, but at 0.63 and 0.72 of the cost, not 0.57 and 0.43. On those runs Nebulosity scored 1.00 against 0.995 on VS Code, and 1.00 against 0.86 on AFFiNE.
  - The time advantage holds. Part of the cost advantage is the refusals.

**Where it lost.**
- **Big-picture on VS Code: 0.84 against 0.93**, as in Eval #1 (0.82 against 0.91). The answers leaned on Nebulosity's computed layers and import counts instead of VS Code's own written rules, even where a tool's answer pointed to that file. On AFFiNE it scored 0.68 against 0.70, at 1.20 times the cost.
- **Accuracy on the graph questions rose less than the gate asked.** Claude Code alone wrote its own import walkers and scored 0.91 on the hardest of them. Nebulosity's 1.00 is +0.09, where the gate asked for +0.15.
- **Not faster everywhere.**
  - On one VS Code question, which folders import which, Nebulosity's runs took 1.7 times as long and cost 1.9 times as much, scoring 0.99 against 1.00. Its folder-conventions report skips rare folder names, so each run had to work out the rest. One run's script did it faster and more cheaply than every run of Claude Code alone. The other two had their scripts refused and grepped by hand.
  - On two other VS Code questions, they cost 1.1–1.4 times as much, scoring 1.00 against 0.87 and 1.00 against 1.00.
  - On VS Code's graph questions as a whole, the cost was 0.57 of Claude Code alone's (scoring 1.00 against 0.94), where the gate asked for 0.5.
- **Its tools weren't always used.** In 10 of the 90 runs that should have used a tool, all on VS Code, Claude Code with Nebulosity wrote its own script instead.

**The ship gate failed.** Its seven conditions were fixed before the first run. Four failed: the accuracy gain on graph questions, no loss on VS Code's big-picture questions, the cost on VS Code's graph questions, and the tools used in 90% of the runs that need them. Three passed: no extra cost on other questions, the task sessions, and the added prompt, about 2,100 tokens a turn.

The setup: VS Code at commit `cc3fec88` and AFFiNE at `0b69a6da`, 3 runs per question and setup, Sonnet 5.5 at medium effort in Claude Code 2.1.300, 270 runs in all. The truths come from two independent import extractors and were checked in the source by Claude models, not taken from Nebulosity's index. The big-picture answers were graded blind by Claude models against rubrics from each repo's own docs. Details, every transcript and every grade: [docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md).

**Eval #1 (2026-10-14), the earlier result.** 15 questions about VS Code, twice each, in Claude Code 2.1.299 with read-only tools (no scripts), with Nebulosity's tools deferred behind Claude Code's tool search:

| Questions (5 of each) | Setup | Score | Median tokens | Median cost estimate | Median time | Median tool calls |
|---|---|---|---|---|---|---|
| Big-picture | Claude Code alone | 0.91 | 32,397 | $0.021 | 13.2 s | 1 |
| Big-picture | with Nebulosity | 0.82 | 22,222 | $0.022 | 13.0 s | 0 |
| Complete-list | Claude Code alone | 0.97 | 92,645 | $0.082 | 24.6 s | 3.5 |
| Complete-list | with Nebulosity | 0.94 | 81,696 | $0.067 | 24.5 s | 2.5 |
| Connection | Claude Code alone | 1.00 | 143,958 | $0.065 | 23.2 s | 7 |
| Connection | with Nebulosity | 1.00 | 65,150 | $0.020 | 8.4 s | 2 |

Big-picture questions ask how the code is organized, complete-list questions ask for every file that imports something, and connection questions ask for the shortest chain of imports from one file to another. The tools were used in 12 of 30 runs and raised no family's score. They answered the connection questions at about a third of the cost and time, at the same score. V1.6 then loaded the tools at the start of every session, resolved more kinds of import, and added the docs pointers and the `imports` and `architecture` tools that Eval #2 measured.

## Try it on your repo

**Who it's for:** you're new to a big TypeScript or JavaScript codebase, and you use Claude Code. Nebulosity gives Claude Code the repo's whole import graph and a map of its parts, and gives you the Map to look at while it explains.

### Install

You need Node 24 or later and git, and Claude Code 2.1.300 or later for the MCP server.

Once Nebulosity is published to npm:

```bash
npm install -g nebulosity
```

Until then, install it from a checkout:

```bash
git clone https://github.com/andrewl746/Nebulosity
cd Nebulosity
npm install
npm run build    # builds the Map
npm link         # puts the nebulosity command on your PATH
```

`nebulosity doctor` checks Node, git, Claude Code and Nebulosity's data folder, and says what's missing.

### Three commands

Run them in your repo's root folder:

```bash
nebulosity index .    # read the repo: its folders, files and every import between them (free)
nebulosity map        # open the Map at http://localhost:3000
nebulosity setup      # connect Claude Code to this repo
```

- **`index`** takes about a minute for VS Code's 15,000 files and a few seconds for most repos. Run it again whenever you like; it only re-reads files that changed. While the Map runs, it keeps the index up to date as you save files.
- **`map`** uses port 3000. `nebulosity map --port <n>` picks another and saves it, so Claude Code's activity and `show_on_map` reach that Map.
- **`setup`** registers Nebulosity's MCP server with Claude Code for this repo only (`claude mcp add --scope local`). Do it once per repo. Afterwards `claude mcp list` shows `nebulosity` as connected.
  - `nebulosity setup --print` shows the commands instead of running them: the add line, and before it a remove line when the repo already has a registration.
  - Running `nebulosity setup` again replaces the registration. That drops anything you added to it by hand, such as an `-e` setting.
- **Where the index lives:** in your user data folder (`%LOCALAPPDATA%\Nebulosity` on Windows, `~/Library/Application Support/Nebulosity` on macOS, `~/.local/share/nebulosity` on Linux), or in `.nebulosity/` inside a checkout. Nothing is written into your repo.

### Without an API key (free mode)

Everything except summaries works without a key, and without one nothing is sent to Anthropic:
- the index, and the Map with its folders, files, import lines, panels and source viewer;
- search over code, declarations, file names and folder names;
- all six tools in Claude Code.

Where a summary would go, Nebulosity says summaries are off and what a key would add.

### Summaries: the paid upgrade

With an Anthropic API key, `nebulosity summarize .` writes a short summary of every file and folder. Summaries make the Map's panels, `overview` and `describe` read like a guide, and let search match by meaning, not only by words.
- **Your code goes to Anthropic:** each file's code is sent to write its summary.
- **It costs about $1 per 1,000 files, or a little less:** $10.30 for VS Code, $6.02 for AFFiNE.
- **It asks first:** the command prints its estimate and spends nothing until you say yes (`--yes` for scripts). A repo's spend is capped at $15 unless you raise it with `--budget`.
- **The key** goes in your environment as `ANTHROPIC_API_KEY`, or in a `.env.local` file in the data folder above (in a checkout, in the checkout's folder).

A big first run goes through Anthropic's Batch API at half price, so it can take a while; `--no-wait` returns at once, and running the command again picks up where it left off.

### The six tools Claude Code gets

- **`overview`**: start here. The repo's size and summary, its top-level areas, the docs to read first, and the files most others import.
- **`describe`**: what a folder or file is: its summary, what's inside, what it imports from and what imports it, with exact counts, and the docs that describe it.
- **`search`**: where a feature or concept lives, across code, summaries, file and folder names, and declarations.
- **`imports`**: exact answers from the whole import graph in one call: what imports a file or folder, what it imports, what a change would affect, and the shortest import chain between two places.
- **`architecture`**: how a folder's code is organized, computed from its imports: its layers and the imports that go against them, recurring folder conventions, import cycles, and files nothing imports.
- **`show_on_map`**: points at files or folders on the Map while Claude Code explains them.

Good to know:
- The server answers about the indexed repo that holds the folder Claude Code runs in. It only reads the index, so keep `nebulosity map` running to have changes picked up as you edit.
- The five tools that answer questions load at the start of every session, with no setting to change; their definitions and instructions take about 2,000 tokens. `show_on_map` loads when Claude Code needs it.
- To keep tool calls off the Map, run `nebulosity setup --print`, add `-e NEBULOSITY_LIVE=off` right after the name `nebulosity` in the add line it prints, and run what it prints. A later plain `nebulosity setup` drops that setting again.

### Windows, macOS and Linux

Nebulosity runs on all three. CI installs the package on each of them, indexes test repos with it, asks its MCP server questions and opens the Map. `nebulosity setup` has been run against a real Claude Code on Windows; on macOS and Linux that check, and the Map's background worker in an installed copy, wait for the next CI run.

### Tested on

Five real repos of different shapes, each indexed from a fresh clone ([Variety Benchmark #1](docs/BENCHMARKS.md)):

| Repo | Shape | Files indexed | Links between files | Relative imports resolved |
|---|---|---|---|---|
| [express](https://github.com/expressjs/express) | plain JavaScript, one package | 141 | 153 | 100% |
| [vite](https://github.com/vitejs/vite) | pnpm monorepo, packages built by a bundler | 1,599 | 2,059 | 99.1% |
| [excalidraw](https://github.com/excalidraw/excalidraw) | yarn workspaces, a React app with path aliases | 710 | 3,678 | 100% |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | a large yarn monorepo, 124 package.json files | 6,987 | 26,261 | 99.99% |
| [VS Code](https://github.com/microsoft/vscode) | one very large repo, no workspaces | 14,849 | 140,583 | 99.5% |

Imports of style sheets, images, fonts and JSON aren't counted: the index reads code. Imports of npm packages stay outside the graph on purpose. A monorepo's imports of its own packages by name are linked, with one known gap: a package whose entry file exists only after a build, like vite's own `vite`.

## How it works

```
your repo
   │  nebulosity index: discover → parse (TypeScript's compiler) → resolve imports → aggregate folders
   │  nebulosity summarize (optional): summaries of files and folders, then local embeddings of them
   ▼
SQLite in WAL mode: files, imports, folders, summaries, full-text search, vectors
   │
   ▼
engine (lib/): level · describe · search · imports · architecture
   │
   ├── stdio ───────► MCP server, read-only on the database ──► Claude Code, any MCP client
   ├── HTTP + SSE ──► the Map (Next.js), whose background worker owns every write
   └── files ───────► static export ──► the demo: no server, no API calls
```

Core logic in `lib/` never imports the UI framework. The MCP server, the Map's API routes and the static exporter are thin adapters over the same engine.

Measured on VS Code (20,342 files, 14,849 of them indexed): the structure index in about a minute (S1 asks for 60 s: 55.7 s at worst of three in Index Benchmark #5, but 66.9 s in Update Benchmark #2's cold index, both on a machine with one of its 16 processors busy; a quiet-machine re-measure is owed), every summary for $10.30 (S2), Map interactions within 100 ms (S3: 78 ms at worst on the production build, 97 ms on the static demo), every warm MCP call under 500 ms (S5: 388 ms at worst, MCP Benchmark #4), and a saved file reflected in 1,975 ms at worst once warm, Update Benchmark #2, 1 s of it the watcher's debounce (S6 allows 2 s). The numbers and how they were taken: [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Decisions worth reading

- [ADR-027](docs/ENGINEERING_DECISIONS.md) and [ADR-052](docs/ENGINEERING_DECISIONS.md): search that fuses five ranked lists with Reciprocal Rank Fusion.
- [ADR-029](docs/ENGINEERING_DECISIONS.md): the Map's 50-box levels and pre-aggregated import counts.
- [ADR-035](docs/ENGINEERING_DECISIONS.md): a spend cap on summary runs.
- [ADR-038](docs/ENGINEERING_DECISIONS.md): a background worker that owns every write while the Map is open.
- [ADR-044](docs/ENGINEERING_DECISIONS.md): an MCP server that reads the database read-only beside a writer.
- [ADR-045](docs/ENGINEERING_DECISIONS.md): the compressed import index behind `imports`.
- [ADR-049](docs/ENGINEERING_DECISIONS.md) and [ADR-050](docs/ENGINEERING_DECISIONS.md): the static demo, and how the eval was kept honest.
- [ADR-057](docs/ENGINEERING_DECISIONS.md): Eval #2 and its ship gate, fixed before the first run.

## Status

V1.6 is built: one `nebulosity` command, Windows, macOS and Linux, a free mode with no API key, and five real repos of different shapes tested. It reads TypeScript and JavaScript only. Its eval, Eval #2, failed the ship gate set before it ran ([docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md)). What comes next is the owner's decision: work aimed at the failed conditions, a different pitch, or shipping with the losses stated. After that: Python support, clustering, and an in-Map guide. The plan: [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md).

## Why I built this

Two reasons, honestly.

First, I wanted to learn how AI agents and retrieval actually work, not by wrapping one API in a chat window but by building every layer a tool like this needs: parsing with TypeScript's own compiler, an import graph that stays current, summaries written through the Batch API, local embeddings, search that fuses ranked lists, and an MCP server an agent calls. Then I measured it against the agent on its own.

Second, I kept running into the problem it goes after. Opening a large unfamiliar repo is overwhelming, and the questions you start with (what are the parts, which files matter, what depends on this) have answers that live in no single file.

Built by Andrew Li as a flagship learning project. The docs are written to teach as well as specify, so if you're curious how any of it works, [LEARNING_NOTES.md](docs/LEARNING_NOTES.md) is the guided tour.

## License

MIT ([LICENSE](LICENSE)). The demo's data is derived from [VS Code](https://github.com/microsoft/vscode) at commit `cc3fec88` (MIT, © Microsoft Corporation).
