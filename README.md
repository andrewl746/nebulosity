# Nebulosity

**Nebulosity does the import walk a dependency question needs in one call: measured on VS Code, for a fraction of the tokens, cost and time Claude Code spent walking it by hand.**

Nebulosity indexes a big TypeScript or JavaScript repository once and keeps the index fresh as files change: its folder tree, every import between its files, and, with an Anthropic API key, a short summary of every file and folder. It serves that index two ways: to AI agents like Claude Code through an MCP server, and to people through a zoomable Map. Measured on VS Code against Claude Code alone, with Claude Code limited to read-only commands, it made the questions that need a walk over the import graph cheaper and faster: at the same score on the five questions about the import chain between two files, and at about the same score on the one list of every file that depends on a given file, directly or through other files. On lists of direct importers, grep did as well in one to eight calls (a median of three). It raised the score on none of the three kinds of question tested, and lowered it on big-picture questions (0.82 against 0.91) and, through one run, on the complete lists (0.94 against 0.97).

[How it compares with Claude Code alone](docs/EVAL_RESULTS.md)

![The Map on VS Code's src/vs/platform folder](docs/screenshots/map-vscode.png)

## Why

Some questions about a big repo are walks over its import graph. What depends on this file, directly or through other files? How does this entry point end up loading that file? In the eval on VS Code, with read-only tools, Claude Code answered them by following imports with grep, one step at a time: 5–12 tool calls a run for an import chain. Nebulosity reads every import once, keeps the graph current while the Map runs, and answers such a question in one call. It plugs into Claude Code instead of replacing it: Claude Code still reads the code and writes the answer. The same index draws the repo for people, one folder at a time.

## What it does

- **The Map**: one folder at a time, at most 50 boxes, lines for imports between them; big folders split into pages of related boxes; a panel with each box's summary, contents, what it uses and what uses it; a read-only source viewer; search with Ctrl K.
- **Six MCP tools for Claude Code**: `overview`, `describe` (with the docs about a place), `search`, `imports` (dependents, dependencies, what a change affects, import chains), `architecture` (layers, conventions, cycles, files nothing imports) and `show_on_map`.
- **Fresh**: while the Map runs, a background worker reflects a saved file in about 1.2 seconds and, with a key, refreshes its summary after a quiet minute.

## How it compares with Claude Code alone

Claude Code answered 15 questions about VS Code, twice each, on its own and with Nebulosity's MCP server at Claude Code's default settings. Big-picture questions ask how the code is organized ("What are the main layers of VS Code's core code under `src/vs`, what is each one for, and which layers may depend on which?"), complete-list questions ask for every file that imports something, and connection questions ask for the shortest chain of imports from one file to another.

| Questions (5 of each) | Setup | Score | Median tokens | Median cost estimate | Median time | Median tool calls |
|---|---|---|---|---|---|---|
| Big-picture | Claude Code alone | 0.91 | 32,397 | $0.021 | 13.2 s | 1 |
| Big-picture | with Nebulosity | 0.82 | 22,222 | $0.022 | 13.0 s | 0 |
| Complete-list | Claude Code alone | 0.97 | 92,645 | $0.082 | 24.6 s | 3.5 |
| Complete-list | with Nebulosity | 0.94 | 81,696 | $0.067 | 24.5 s | 2.5 |
| Connection | Claude Code alone | 1.00 | 143,958 | $0.065 | 23.2 s | 7 |
| Connection | with Nebulosity | 1.00 | 65,150 | $0.020 | 8.4 s | 2 |

The score is the share of rubric points for big-picture, recall for lists and the chain score for connections. The cost is Claude Code's own estimate at list prices. With Nebulosity, Claude Code never called its tools on a big-picture question or on the four lists of direct importers, so on those questions no tool answer caused its differences from Claude Code alone.

**Where it lost.**
- **Big-picture: 0.82 against 0.91** (0.77 with the tools loaded up front). The default setup's gap sits in two of the five questions. There, the scores followed whether a run read VS Code's own `.github/instructions/source-code-organization.instructions.md`: a correlation in twelve runs, not a measured cause.
- **Complete-list: 0.94 against 0.97.** One run is the whole gap: it didn't load the tools, and its one grep pattern missed 9 of 22 files.
- **The index's own limits.** It has no edge for a computed `import()`, so the one-call answer to `markers.ts`'s dependents through other files (below) missed 3 of 66 files in every Nebulosity run. It doesn't link non-relative `vs/…` module ids either, which cost the runs with the tools up front 2 of 57 files on another list.
- **Accuracy overall.** With Nebulosity at the default setting, Claude Code did no better on 13 of the 15 questions (level on 10, lower on 3). On the other 2, the gain is within the spread of Claude Code's own two runs.

**Where it helped.**
- **Connection questions**, at the same score: every run of both setups scored 1.00. With Nebulosity, Claude Code answered each with one Nebulosity call (`path`, or `dependencies` on the question whose answer is "none"), for less than half the tokens, about a third of the cost estimate and about a third of the time.
- **The one list that needed a walk** (every file that depends on `markers.ts`, directly or through other files): one `dependents` call scored 0.95 in both runs, against Claude Code alone's 0.86 and 1.00, within the spread of Claude Code's own two runs. On average, Claude Code with Nebulosity used 7.9 times fewer tokens, a cost estimate 7.5 times lower and 6.0 times less time.
- These savings are partly a product of the eval's read-only rules: six runs of Claude Code alone tried to write a script to walk the imports and were refused. Where Claude Code may run scripts, it may answer these more cheaply.

The setup: 15 questions on VS Code at commit `cc3fec88`, 2 runs per question and setup, Sonnet 5.5 at medium effort in Claude Code 2.1.299 with read-only tools. The lists' and chains' ground truth comes from an independent scanner and was checked in the source by Claude models, not taken from Nebulosity's index; the big-picture answers were graded blind by Claude models against a rubric from VS Code's wiki. Details, every transcript and every grade: [docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md).

## Try it on your repo

**Who it's for:** you're new to a big TypeScript or JavaScript codebase, and you use Claude Code. Nebulosity gives Claude Code the repo's whole import graph and a map of its parts, and gives you the Map to look at while it explains.

### Install

You need Node 24 or later and git. Claude Code is what the MCP server plugs into.

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
- **`setup`** registers Nebulosity's MCP server with Claude Code for this repo only (`claude mcp add --scope local`). Do it once per repo. Afterwards `claude mcp list` shows `nebulosity` as connected. `nebulosity setup --print` shows the command instead of running it.
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
- Claude Code loads MCP tools when it decides it needs them. In Eval #1 it used Nebulosity's on the questions that walk the import graph, and not on big-picture ones. Starting Claude Code with `ENABLE_TOOL_SEARCH=false` loads them up front, at about 13,000 tokens of context per turn.
- To keep tool calls off the Map, run `nebulosity setup --print`, add `-e NEBULOSITY_LIVE=off` right after the name `nebulosity` in the line it prints, and run that line.

### Windows, macOS and Linux

Nebulosity runs on all three. CI installs the package on each of them, indexes test repos with it, asks its MCP server questions and opens the Map.

### Tested on

Five real repos of different shapes, each indexed from a fresh clone ([Variety Benchmark #1](docs/BENCHMARKS.md)):

| Repo | Shape | Files indexed | Links between files | Relative imports resolved |
|---|---|---|---|---|
| [express](https://github.com/expressjs/express) | plain JavaScript, one package | 141 | 153 | 100% |
| [vite](https://github.com/vitejs/vite) | pnpm monorepo, packages built by a bundler | 1,599 | 2,059 | 99.1% |
| [excalidraw](https://github.com/excalidraw/excalidraw) | yarn workspaces, a React app with path aliases | 710 | 3,678 | 100% |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | a large yarn monorepo, 124 packages | 6,987 | 26,261 | 99.99% |
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

Measured on VS Code (20,342 files, 14,844 of them indexed): the structure index in under a minute (S1: 58.5 s at worst), every summary for $10.30 (S2), Map interactions within 100 ms (S3: 78 ms at worst on the production build, 97 ms on the static demo), every warm MCP call under 500 ms (S5: 261 ms at worst), and a saved file reflected in about 1.2 s (S6: 1,235 ms at worst, 1 s of it the watcher's debounce). The numbers and how they were taken: [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Decisions worth reading

- [ADR-027](docs/ENGINEERING_DECISIONS.md) and [ADR-052](docs/ENGINEERING_DECISIONS.md): search that fuses five ranked lists with Reciprocal Rank Fusion.
- [ADR-029](docs/ENGINEERING_DECISIONS.md): the Map's 50-box levels and pre-aggregated import counts.
- [ADR-035](docs/ENGINEERING_DECISIONS.md): a spend cap on summary runs.
- [ADR-038](docs/ENGINEERING_DECISIONS.md): a background worker that owns every write while the Map is open.
- [ADR-044](docs/ENGINEERING_DECISIONS.md): an MCP server that reads the database read-only beside a writer.
- [ADR-045](docs/ENGINEERING_DECISIONS.md): the compressed import index behind `imports`.
- [ADR-049](docs/ENGINEERING_DECISIONS.md) and [ADR-050](docs/ENGINEERING_DECISIONS.md): the static demo, and how the eval was kept honest.

## Status

V1.5 is done: the engine, the Map, the MCP server, the static demo build and the eval. V1.6 makes it work on your repo: one `nebulosity` command, Windows, macOS and Linux, a free mode with no API key, and five real repos of different shapes tested. It reads TypeScript and JavaScript only. Then Python support, clustering, and an in-Map guide. The plan: [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md).

## Why I built this

Two reasons, honestly.

First, I wanted to learn how AI agents and retrieval actually work, not by wrapping one API in a chat window but by building every layer a tool like this needs: parsing with TypeScript's own compiler, an import graph that stays current, summaries written through the Batch API, local embeddings, search that fuses ranked lists, and an MCP server an agent calls. Then I measured it against the agent on its own.

Second, I kept running into the problem it goes after. Opening a large unfamiliar repo is overwhelming, and the questions you start with (what are the parts, which files matter, what depends on this) have answers that live in no single file.

Built by Andrew Li as a flagship learning project. The docs are written to teach as well as specify, so if you're curious how any of it works, [LEARNING_NOTES.md](docs/LEARNING_NOTES.md) is the guided tour.

## License

MIT ([LICENSE](LICENSE)). The demo's data is derived from [VS Code](https://github.com/microsoft/vscode) at commit `cc3fec88` (MIT, © Microsoft Corporation).
