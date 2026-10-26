# Nebulosity: the full guide

Everything the [README](../README.md) leaves out: every command, flag and setting, the seven tools, other MCP clients, the VS Code extension's details, and what it was tested on. How it compares with Claude Code on its own, caveats included, is in [EVALUATION.md](EVALUATION.md).

## Install

You need Node 24 or later and git, and Claude Code 2.1.300 or later for the MCP server.

```bash
npm install -g nebulosity
```

To work on Nebulosity itself, install it from a checkout instead:

```bash
git clone https://github.com/andrewl746/Nebulosity
cd Nebulosity
npm install
npm run build    # builds the Map
npm link         # puts the nebulosity command on your PATH
```

`nebulosity doctor` checks Node, git, Claude Code, Nebulosity's data folder and the [summary models](#summary-models), and says what's missing.

## The commands

Run them in your repo's root folder:

```bash
nebulosity index .    # read the repo: its folders, files and every import between them (free)
nebulosity map        # open the Map at http://localhost:3000 (it keeps running)
nebulosity setup      # in a second terminal, same folder: connect Claude Code to this repo
```

- **`index`** takes about a minute for VS Code's 15,000 files and a few seconds for most repos. Run it again whenever you like; it only re-reads files that changed. While the Map runs, it keeps the index up to date as you save files.
- **`map`** uses port 3000 and keeps running until you stop it. `nebulosity map --port <n>` picks another and saves it, so Claude Code's activity and `show_on_map` reach that Map. A port that's already in use, by another app or a Map that's already running, is refused and nothing is saved. `nebulosity map --print-port` prints the saved port and starts nothing (the VS Code extension asks it where the Map is).
- **`setup`** registers Nebulosity's MCP server with Claude Code for this repo only (`claude mcp add --scope local`). Do it once per repo. Afterwards `claude mcp list` shows `nebulosity` as connected.
  - `nebulosity setup --print` shows the commands instead of running them: the add line, and before it a remove line when the repo already has a registration.
  - `nebulosity setup --json` prints the registration as a JSON block for other MCP clients and runs nothing: see [Other MCP clients, or by hand](#other-mcp-clients-or-by-hand).
  - Running `nebulosity setup` again replaces the registration. That drops anything you added to it by hand, such as an `-e` setting.
- **Where the index lives:** in your user data folder (`%LOCALAPPDATA%\Nebulosity` on Windows, `~/Library/Application Support/Nebulosity` on macOS, `~/.local/share/nebulosity` on Linux), or in `.nebulosity/` inside a checkout. Nothing is written into your repo.

## Free mode

Everything except summaries works without a key, in every language, and without one nothing is sent to Anthropic:
- the index, and the Map with its folders, files, import lines, panels and source viewer;
- search over code, declarations, file names and folder names;
- all seven tools in Claude Code.

Where a summary would go, Nebulosity says summaries are off and what a key would add.

## Summaries

With an Anthropic API key, `nebulosity summarize .` writes a short summary of every file and folder. Summaries make the Map's panels, `overview` and `describe` read like a guide, and let search match by meaning, not only by words.
- **Your code goes to Anthropic:** each file's code is sent to write its summary.
- **It costs about $1 per 1,000 files, or a little less:** $10.30 for VS Code, $6.02 for AFFiNE.
- **It asks first:** the command prints its estimate and spends nothing until you say yes (`--yes` for scripts). A repo's spend is capped at $15 unless you raise it with `--budget`. The cap counts everything the repo has ever spent on summaries, not one run, and the Map's automatic refreshes stop at the budget your last run recorded too. Each run that goes ahead records its budget, one with nothing to send included, and a re-run without `--budget` records $15 again, so repeat `--budget` on re-runs.
- **The key** goes in your environment as `ANTHROPIC_API_KEY`, or in a `.env.local` file in the data folder above (in a checkout, in the checkout's folder).

A big first run goes through Anthropic's Batch API at half price, so it can take a while; `--no-wait` returns at once, and running the command again picks up where it left off.

## Summary models

By default Haiku 5.5 (`claude-haiku-5-5`) summarizes files, and Sonnet 5.5 (`claude-sonnet-5-5`) summarizes folders and the repo. When Anthropic retires those, or you'd rather use others, set `summaryModels` in `config.json` in the data folder above (`.nebulosity/config.json` in a checkout). Any of `file`, `folder` and `repo`; a kind you leave out keeps its default:

```json
{
  "summaryModels": {
    "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 }
  }
}
```

- **Prices** are the model's list prices in US dollars per million input and output tokens, for the estimate and the spend cap. Nebulosity knows the two defaults' prices; for any other model both are required, and `nebulosity summarize` refuses to estimate or send anything without them. Prices you give win over the ones it knows.
- **The model has to accept the same requests:** structured output (a JSON schema for the answer) and the effort setting. A model you set goes on the plain Messages API, without the server-side fallback the default Sonnet gets.
- **Changing a model re-summarizes** everything that model writes, since the model is part of what makes a summary current, and then every folder above what it rewrote, since a folder's summary is written from its contents' (a new file model redoes every folder and the repo). `nebulosity summarize` shows the estimate, all of that included, and asks first, as always.
  - **The $15 cap is per repo and cumulative**, so on a repo that has already spent more than about half of it (VS Code's first pass was $10.30), re-summarizing stops at the cap before it sends anything. Run it again with a higher budget, such as `--budget 25`.
  - **The Map never redoes another model's summaries on its own.** While it runs, it redoes by itself only summaries written by the model now in use for their kind, once what they describe changes. After a file model change that includes the folders above the files the new model rewrote, since the folder model that wrote them hasn't changed. It sends those only within the budget your last run recorded. Everything else shows as out of date until you run `nebulosity summarize`, or open it on the Map.
- **It's read at each run,** so the Map picks up a change without a restart. Leave the file's other keys as they are: the Map keeps `activeRepo` and `port` there. `nebulosity doctor` shows the models in use, which are set, and what's wrong with a setting it can't use.
- **The file has to be one JSON object.** A byte-order mark or UTF-16, as Windows PowerShell and Notepad save it, is fine. A mistake such as a trailing comma makes it a setting that can't be used (below): `nebulosity doctor` fails, naming the file and where the JSON breaks. Nebulosity never writes over such a file: the next time it saves its own settings (`nebulosity index`, a repo picked on the Map), it first moves yours to `config.json.invalid-<time>` beside it and says so, and doctor lists it until you delete it.
- **A setting that can't be used stops summaries until it's fixed,** even without a key. `nebulosity summarize` refuses it and writes no test templates, and with a key the summaries' status isn't updated after `nebulosity index` or a save. The index, search, the Map and the tools work as usual, and without a key they say summaries are off, as in free mode.
- **When a model is retired** (or your key can't use it), the first answer that says so stops the run with one message naming the model and this file. Every summary already written is kept. Choose another model, and the next run picks up where it stopped.
- **If the default Sonnet's fallback is ever refused.** Folder and repo requests at the defaults carry Anthropic's `server-side-fallback-2026-07-01` beta. If every folder request starts failing over that beta, set `claude-sonnet-5-5` itself for `folder` and `repo`: a model you name goes on the plain Messages API, without the beta, at the price Nebulosity already knows.

## The seven tools

- **`overview`**: start here. The repo's size and summary, its top-level areas, the docs to read first, and the files most others import.
- **`describe`**: what a folder or file is: its summary, what's inside, what it imports from and what imports it, with exact counts, and the docs that describe it.
- **`search`**: where a feature or concept lives, across code, summaries, file and folder names, and declarations.
- **`imports`**: exact answers from the whole import graph in one call: what imports a file or folder, what it imports, what a change would affect, and the shortest import chain between two places.
- **`architecture`**: how a folder's code is organized, computed from its imports: its layers and the imports that go against them, recurring folder conventions, import cycles, and files nothing imports.
- **`calls`**: who calls a method of a class or interface through declared types (injected services, fields, parameters, base classes): its callers, its implementations, what a change to its signature touches, and where a type is injected. TypeScript and JavaScript only; asked about another language's file, it says so.
- **`show_on_map`**: points at files or folders on the Map while Claude Code explains them.

Good to know:
- The server answers about the indexed repo that holds the folder Claude Code runs in. It only reads the index, so keep `nebulosity map` running to have changes picked up as you edit.
- The six tools that answer questions load at the start of every session, with no setting to change; their definitions and instructions take about 2,400 tokens. `show_on_map` loads when Claude Code needs it.
- To keep tool calls off the Map, run `nebulosity setup --print`, add `-e NEBULOSITY_LIVE=off` right after the name `nebulosity` in the add line it prints, and run what it prints. A later plain `nebulosity setup` drops that setting again.

## Other MCP clients, or by hand

`nebulosity setup --json` prints the registration `nebulosity setup` makes, as a plain `mcpServers` block, and nothing else. It runs nothing and writes nothing, so `nebulosity setup --json > nebulosity.json` saves it (from bash, zsh or cmd: Windows PowerShell 5.1's `>` writes UTF-16). From an installed copy on Windows it looks like this (the paths have forward slashes there too):

```json
{
  "mcpServers": {
    "nebulosity": {
      "command": "node",
      "args": [
        "C:/Users/you/AppData/Roaming/npm/node_modules/nebulosity/mcp/launch.mjs"
      ],
      "env": {
        "NEBULOSITY_DATA": "C:/Users/you/AppData/Local/Nebulosity"
      }
    }
  }
}
```

- **In Claude Code, without `nebulosity setup`:** in your repo's root, run `claude mcp add-json nebulosity '<the "nebulosity" object>' --scope local`, where the object is everything from the `{` after `"nebulosity":` to its closing `}`. Run it from bash or zsh (on Windows, Git Bash): Windows PowerShell 5.1 drops the double quotes inside an argument it passes to a program, and cmd doesn't treat single quotes as quotes.
- **Clients that read an `mcpServers` block,** such as Cursor and Claude Desktop, take the block as it is: as the whole file, or add its `"nebulosity"` entry to the `mcpServers` already there.
  - Cursor: `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every project ([Cursor's docs](https://cursor.com/docs/context/mcp)).
  - Claude Desktop: `claude_desktop_config.json`, which Settings > Developer > Edit Config opens if your version has it. Quit and restart Claude Desktop after saving it ([the MCP guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)).
  - Any other client: your client's MCP settings.
  - The block has no `"type"`, since a server with a `command` is a stdio server. Add `"type": "stdio"` if your client asks for one.
  - If the client can't start `node` (an app opened from the desktop may not get your shell's PATH), put node's full path in `"command"`: `which node` prints it, or `where node` on Windows.
- **Settings** go in `env`: for example `"NEBULOSITY_LIVE": "off"` keeps tool calls off the Map.
- **Which repo it answers about:** Claude Code tells the server which folder its session is in; other clients don't. So outside Claude Code the server answers about the indexed repo holding the folder the client starts it in, else about the Map's repo (the one last indexed with `nebulosity index`, without `--no-activate`, or picked on the Map), and then each answer's first line says so. Run `nebulosity index` in your repo first.

## In VS Code

The Nebulosity extension shows the Map in a panel beside your code, with Claude Code's activity on it. The Map follows the file you're in, a file you click on the Map opens in the editor, and "What depends on this file?" lists a file's importers and lights them on the Map. It's a window onto `nebulosity map`, so it needs the package above, and like the package it works without an API key.

1. Install the `nebulosity` package and index your repo (above).
2. Install the extension, `andrewl746.nebulosity-vscode`, from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=andrewl746.nebulosity-vscode) or [Open VSX](https://open-vsx.org/extension/andrewl746/nebulosity-vscode), or with `code --install-extension andrewl746.nebulosity-vscode`. To build it from a checkout instead and install the file:

   ```bash
   cd vscode-extension
   npm ci
   npm run build
   npx vsce package    # writes nebulosity-vscode-1.0.0.vsix
   code --install-extension nebulosity-vscode-1.0.0.vsix
   ```

3. Open your repo in VS Code and run **Nebulosity: Show Map** from the Command Palette, or click the map button in the editor's title bar.

In the panel the Map has its own Back button, since a webview has no browser Back. In a narrow panel a click selects a box and shows Open and Details beside it, so the Map stays in sight; double-click still opens a folder.

The extension uses a Map that's already running, or starts one, and stops the one it started when its window closes. A folder that isn't indexed yet gets an "Index this repo (free)" button. Its settings: `nebulosity.command` (the `nebulosity` command to run, if it isn't on your PATH), `nebulosity.port` (else the port `nebulosity map` last used, else 3000) and `nebulosity.followEditor`. It's checked on desktop VS Code on Windows, macOS and Linux. Remote windows (WSL, Remote SSH, Dev Containers) aren't checked yet, and browser-hosted VS Code (vscode.dev, Codespaces in the browser) isn't supported. More: [vscode-extension/README.md](../vscode-extension/README.md).

## Windows, macOS and Linux

Nebulosity runs on all three. CI installs the package on each of them, indexes test repos with it, asks its MCP server questions and opens the Map. It also runs `nebulosity setup` against a real Claude Code, registers the block `nebulosity setup --json` prints with `claude mcp add-json`, checks that the installed Map's background worker picks up a saved file, and checks that `summarize` refuses to spend without a key or a yes.

The Map works at any window size, down to a narrow VS Code panel. From a checkout, `npm run check-layout -- http://127.0.0.1:<port>` checks a running Map in headless Chrome at 20 window sizes, from 1440 × 900 to 200 × 260 (the Map must be showing the VS Code demo repo, whose folders its states visit).

## Tested with

Claude Code 2.1.300 or later is needed. It was tested with:
- locally, on Windows 11: Node 24.14, Claude Code 2.1.310, and VS Code 1.143.1 and 1.105.0, the extension's oldest supported version;
- in CI, on Windows, macOS and Linux: Node 24.21 and 24.22 (the newest 24 each runner had), Claude Code 2.1.300, and the extension's tests in VS Code's stable release of the day.

If a later version breaks something, these are the ones that worked.

## Tested on

Five real repos of different shapes, each indexed from a fresh clone ([Variety Benchmark #1](BENCHMARKS.md)):

| Repo | Shape | Files indexed | Links between files | Relative imports resolved |
|---|---|---|---|---|
| [express](https://github.com/expressjs/express) | plain JavaScript, one package | 141 | 153 | 100% |
| [vite](https://github.com/vitejs/vite) | pnpm monorepo, packages built by a bundler | 1,599 | 2,059 | 99.1% |
| [excalidraw](https://github.com/excalidraw/excalidraw) | yarn workspaces, a React app with path aliases | 710 | 3,678 | 100% |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | a large yarn monorepo, 124 package.json files | 6,987 | 26,261 | 99.99% |
| [VS Code](https://github.com/microsoft/vscode) | one very large repo, no workspaces | 14,849 | 140,583 | 99.5% |

Imports of style sheets, images, fonts and JSON aren't counted: the index reads code. Imports of npm packages stay outside the graph on purpose. A monorepo's imports of its own packages by name are linked, with one known gap: a package whose entry file exists only after a build, like vite's own `vite`.

## Languages

Besides TypeScript and JavaScript, Nebulosity reads Python, Go, Java, C# and Rust, each through a tree-sitter grammar that ships with it (nothing to install, no build of your repo). Each was measured on one real repo, indexed cold, with 30 of its links drawn at random and read in the source by someone other than its builder ([Language Benchmark #1](BENCHMARKS.md)):

| Language | Repo | Its files indexed | The whole repo's index, worst of 3 | References to the repo's own code resolved | Sampled links right |
|---|---|---|---|---|---|
| Python | [django](https://github.com/django/django) | 2,937 | 9.2 s | 99.98% of absolute imports, 99.97% of relative ones | 30 of 30 |
| Go | [prometheus](https://github.com/prometheus/prometheus) | 747 | 10.4 s | 100% of imports, 99.96% of same-package names, 99.7% of qualified uses | 30 of 30 |
| Java | [spring-boot](https://github.com/spring-projects/spring-boot) | 8,705 | 21.8 s | 100% of imports, 99.7% of type names | 30 of 30 |
| C# | [jellyfin](https://github.com/jellyfin/jellyfin) | 2,251 | 7.9 s | 99.2% of type names, 100% of qualified and static ones | 29 of 30 (30 by the rules' own reading; the strict miss, a generic twin, is fixed since) |
| Rust | [rust-analyzer](https://github.com/rust-lang/rust-analyzer) | 1,498 | 7.8 s | 100%, which the rules make certain, so the 30 links read in the source and a check of every link across crates are the real test | 30 of 30 |

- **Each language links files by its own rules,** read from the code and its manifests: Python's package roots (`__init__.py`, `src/` layouts, `pyproject.toml`), Go's `go.mod` and packages, Java's packages and type names, C#'s namespaces, usings and projects, Rust's `Cargo.toml` and `mod` tree. A link means the same everywhere: A → B when A's code names something B declares. Each leaves out its own dependency and build folders by the manifest beside them (a virtual environment, `vendor/` by a `go.mod`, `target/` by a `Cargo.toml` or `pom.xml`, `build/` by a Gradle file, `bin/` and `obj/` by a `.csproj`). In Python, an import of a standard-library name (`import logging`) reaches a repo file only when one of the importer's own roots holds it, so a repo's `tests/logging.py` is found from beside it, never from the package's code.
- **What isn't read:** `calls` is TypeScript and JavaScript only. C# extension-method calls aren't linked, since binding one needs the receiver's and arguments' types. Member types inherited from a supertype aren't followed (Java, C#), Python paths added to `sys.path` at run time aren't read, and Rust's `use super::*` globs carry no links to their siblings. Test files, entry points (`[project.scripts]` and `__main__`, Go's `func main`, Java's `public static void main`, C#'s `static Main` and top-level statements, Cargo's targets) and the Map's source colors work in every language.
- **TypeScript and JavaScript are unchanged:** their stored files, links, declarations and code chunks in VS Code's and AFFiNE's indexes are byte for byte what they were before, in every field the comparison (`npm run dump-index`) reads; it leaves out the call facts and a few columns of files and chunks, whose code E4 didn't change ([Index Benchmark #8](BENCHMARKS.md)). One behavior is new for every language, TypeScript's included: a file whose parse throws (a stack overflow on very deep nesting, say) is no longer dropped. It is indexed for its imports only, by the same scan that reads a file over the size cap, and `nebulosity index` and the Map's status say which files that was. No file of VS Code or AFFiNE throws, so their indexes don't move. The new languages add 191 files to VS Code (85 of them its Rust `cli/`) and 355 to AFFiNE (353 Rust).
- **Free mode** covers all of it. Summaries of the new languages use the same prompt, and haven't been reviewed yet.
- **Not measured:** no eval has compared Claude Code with and without Nebulosity on these languages, so nothing here claims it's faster on them.

## Speed

Measured on VS Code (20,342 files, 14,849 of them indexed before E4, 15,040 since): the structure index in under a minute on 2026-10-15 (S1: 56.7 s at worst of three and 50.2 s median with the call facts, Index Benchmark #7; on 2026-10-25 the same laptop took 75–77 s, for the code before the five new languages as for the code after, Index Benchmark #8), every summary for $10.30 (S2), Map interactions within 100 ms (S3: 78 ms at worst on the production build, 97 ms on the static demo), every warm MCP call under 500 ms (S5: 177 ms at worst, MCP Benchmark #5, and the first `calls` answer in a fresh process 902 ms at worst), and a saved file reflected in 1,501 ms at worst once warm, Update Benchmark #3, 1 s of it the watcher's debounce (S6 allows 2 s). The numbers and how they were taken: [BENCHMARKS.md](BENCHMARKS.md).
