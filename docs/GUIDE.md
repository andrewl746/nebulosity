# The Nebulosity guide

The commands, settings and tools the [README](../README.md) only mentions. How Nebulosity compares with Claude Code on its own is in [EVALUATION.md](EVALUATION.md).

## Install

You need Node 24 or later and git, plus Claude Code 2.1.300 or later for the MCP server.

```bash
npm install -g nebulosity
```

To work on Nebulosity itself, install it from a checkout instead.

```bash
git clone https://github.com/andrewl746/Nebulosity
cd Nebulosity
npm install
npm run build    # builds the Map
npm link         # puts the nebulosity command on your PATH
```

`nebulosity doctor` checks Node, git, Claude Code, the data folder and the [summary models](#summary-models), and says what's missing.

## The commands

Run them in your repo's root folder.

```bash
nebulosity index .    # read the repo's folders, files and imports (free)
nebulosity map        # open the Map at http://localhost:3000 (it keeps running)
nebulosity setup      # in a second terminal in the same folder, connect Claude Code to this repo
```

- **`index`** takes about a minute on VS Code's 15,000 files and a few seconds on most repos. Running it again only re-reads files that changed, and while the Map runs it keeps the index current as you save.
- **`map`** uses port 3000 and keeps running until you stop it. `--port <n>` picks another port and saves it, so Claude Code's activity and `show_on_map` reach that Map. A port that's already in use is refused, and nothing is saved. `--print-port` prints the saved port and starts nothing.
- **`setup`** registers the MCP server with Claude Code for this repo only (`claude mcp add --scope local`). Do it once per repo. Running it again replaces the registration and drops anything you added to it by hand. `--print` shows the commands instead of running them, and `--json` prints the registration for [other MCP clients](#other-mcp-clients-or-by-hand).
- **The index lives** in your user data folder, which is `%LOCALAPPDATA%\Nebulosity` on Windows, `~/Library/Application Support/Nebulosity` on macOS and `~/.local/share/nebulosity` on Linux (or `.nebulosity/` inside a checkout). Nothing is written into your repo.

## Free mode

Everything except summaries works without an API key, in every language, and without a key nothing is sent to Anthropic. That covers the index, the Map, search over code, declarations and file and folder names, and all seven tools. Where a summary would go, Nebulosity says summaries are off.

## Summaries

With an Anthropic API key, `nebulosity summarize .` writes a short summary of every file and folder. Each is a plain tagline, then a few short paragraphs, longer for bigger and more central files and folders. The Map's panels, `overview` and `describe` then read like a guide, and search can match by meaning, not only by words.

- **Your code goes to Anthropic,** since each file's code is sent to write its summary.
- **It costs about $1 per 1,000 files,** $10.30 for VS Code and $6.02 for AFFiNE.
- **It asks first.** It prints an estimate and spends nothing until you say yes (`--yes` for scripts).
- **Each repo is capped at $15 in total,** counting everything it has ever spent on summaries, unless you raise it with `--budget`. Repeat `--budget` on re-runs, since a run without it records $15 again. The Map's automatic refreshes stop at the budget your last run recorded.
- **The key** goes in your environment as `ANTHROPIC_API_KEY`, or in a `.env.local` file in the data folder (the checkout's folder in a checkout). Restart the Map after adding it.

A big first run goes through Anthropic's Batch API at half price, so it can take a while. `--no-wait` returns at once, and running the command again picks up where it left off.

Summaries an older version of Nebulosity wrote stay as they are, and count as up to date until their code changes, or until something inside them is rewritten. Opening one on the Map rewrites it in the new style. That includes the folder on screen, which the panel beside the Map describes when nothing is selected, so the repo is rewritten when the Map opens and each folder as you enter it. Rewriting something puts the folder above it out of date, so the folders you browsed through are redone once more, one request each, by the Map's automatic refreshes within about 10 minutes, or sooner as you go back up through them. `nebulosity summarize .` rewrites them all after its estimate, and on a repo that has already spent most of its $15 that run needs `--budget`, as in `--budget 25`. `--no-restyle` leaves them as they are and catches up only what changed. `--path <path>` summarizes just that file or folder, and only when its summary is missing, out of date or written by an older version, so `--no-restyle` changes nothing there.

## Summary models

By default Haiku 5.5 (`claude-haiku-5-5`) summarizes files, and Sonnet 5.5 (`claude-sonnet-5-5`) summarizes folders and the repo. To use others, for example once Anthropic retires these, set `summaryModels` in `config.json` in the data folder (`.nebulosity/config.json` in a checkout). Set any of `file`, `folder` and `repo`, and a kind you leave out keeps its default. Leave the file's other keys alone, since the Map keeps `activeRepo` and `port` there.

```json
{
  "summaryModels": {
    "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 }
  }
}
```

- **Prices are required** for any model but the two defaults, in US dollars per million input and output tokens, so the estimate and the cap still work.
- **The model has to support** structured output and the effort setting.
- **Changing a model re-summarizes** everything that model writes, plus the folders above it. `nebulosity summarize` shows the estimate first. On a repo that has already spent much of its $15, raise the budget, as in `--budget 25`. The Map never rewrites a summary on its own just because another model wrote it, and the same goes for one an older version of Nebulosity wrote. Opening it on the Map does.
- **`nebulosity doctor` checks the setting.** One it can't use, such as a JSON typo, turns summaries off until it's fixed, and doctor names the file and the problem. Nebulosity never writes over a broken file. It moves it aside to `config.json.invalid-<time>` first and says so.
- **When a model is retired,** the run stops with one message naming the model and this file, and every summary already written is kept.

## The seven tools

- **`overview`** is where to start. It gives the repo's size and summary, its top-level areas, the docs to read first and the files most others import.
- **`describe`** says what a folder or file is, with its summary, what's inside, what it imports, what imports it and the docs that describe it.
- **`search`** finds where a feature or concept lives, across code, summaries, file and folder names, and declarations.
- **`imports`** answers from the whole import graph in one call. It finds what imports a file or folder, what it imports, what a change would affect, and the shortest import chain between two places.
- **`architecture`** shows how a folder's code is organized, worked out from its imports. It finds layers and the imports that go against them, folder conventions, import cycles and files nothing imports.
- **`calls`** finds who calls a method of a class or interface through declared types, plus its implementations, what a signature change touches and where a type is injected. It covers TypeScript and JavaScript only.
- **`show_on_map`** points at files or folders on the Map while Claude Code explains them.

The server answers about the indexed repo that holds the folder Claude Code runs in, and it keeps up with your edits while `nebulosity map` runs. The six tools that answer questions load at the start of every session and take about 2,400 tokens, and `show_on_map` loads when Claude Code needs it. To keep tool calls off the Map, run `nebulosity setup --print`, add `-e NEBULOSITY_LIVE=off` right after the name `nebulosity` in the add line it prints, and run that line. A later `nebulosity setup` drops the setting again.

## Other MCP clients, or by hand

`nebulosity setup --json` prints the registration as a plain `mcpServers` block and runs nothing, so `nebulosity setup --json > nebulosity.json` saves it (from bash, zsh or cmd, since Windows PowerShell 5.1's `>` writes UTF-16). From an installed copy on Windows it looks like this.

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

- **In Claude Code without `nebulosity setup`,** run `claude mcp add-json nebulosity '<the "nebulosity" object>' --scope local` in your repo's root. Run it from bash or zsh (Git Bash on Windows), because PowerShell 5.1 and cmd mangle the quotes.
- **Cursor, Claude Desktop and other clients** that read an `mcpServers` block take it as it is, either as the whole file or merged into the one they have. Cursor reads `.cursor/mcp.json` in a project or `~/.cursor/mcp.json` ([Cursor's docs](https://cursor.com/docs/context/mcp)). Claude Desktop reads `claude_desktop_config.json` and needs a restart after you save it ([the MCP guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)).
- **If the client can't start `node`,** put node's full path in `"command"` (`which node` prints it, or `where node` on Windows). Add `"type": "stdio"` if your client asks for a type.
- **Settings go in `env`,** for example `"NEBULOSITY_LIVE": "off"`.
- **Outside Claude Code** the server answers about the indexed repo holding the folder the client starts it in, or else about the Map's repo, and each answer's first line says which. Run `nebulosity index` in your repo first.

## In VS Code

The extension shows the Map in a panel beside your code. It follows the file you're in, opens a file you double-click on the Map (a click only selects it, so the editor keeps its file), and can light up the files that import the one you're looking at. It needs the package above and works without an API key.

1. Install the `nebulosity` package and index your repo.
2. Install `andrewl746.nebulosity-vscode` from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=andrewl746.nebulosity-vscode) or [Open VSX](https://open-vsx.org/extension/andrewl746/nebulosity-vscode), or run `code --install-extension andrewl746.nebulosity-vscode`.
3. Open your repo in VS Code and run **Nebulosity: Show Map** from the Command Palette.

To build the extension from a checkout instead, run this.

```bash
cd vscode-extension
npm ci
npm run build
npx vsce package    # writes nebulosity-vscode-1.1.0.vsix
code --install-extension nebulosity-vscode-1.1.0.vsix
```

Its commands, settings and limits are in [vscode-extension/README.md](../vscode-extension/README.md).

## Platforms and versions

Nebulosity runs on Windows, macOS and Linux. CI installs the package on all three, indexes test repos, asks the MCP server questions, opens the Map, runs `nebulosity setup` against a real Claude Code and tests the extension in VS Code. Locally it was tested on Windows 11 with Node 24.14, Claude Code 2.1.310 and VS Code 1.143.1 and 1.105.0 (the extension's oldest supported version). In CI it ran on Node 24.21 and 24.22, Claude Code 2.1.300 and the stable VS Code of the day. If a later version breaks something, those are the ones that worked.

## Tested on

Five real repos of different shapes, each indexed from a fresh clone.

| Repo | Shape | Files indexed | Links between files | Relative imports resolved |
|---|---|---|---|---|
| [express](https://github.com/expressjs/express) | plain JavaScript, one package | 141 | 153 | 100% |
| [vite](https://github.com/vitejs/vite) | pnpm monorepo, packages built by a bundler | 1,599 | 2,059 | 99.1% |
| [excalidraw](https://github.com/excalidraw/excalidraw) | yarn workspaces, a React app with path aliases | 710 | 3,678 | 100% |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | a large yarn monorepo, 124 package.json files | 6,987 | 26,261 | 99.99% |
| [VS Code](https://github.com/microsoft/vscode) | one very large repo, no workspaces | 14,849 | 140,583 | 99.5% |

The index reads code, so imports of style sheets, images, fonts and JSON aren't counted, and npm packages stay outside the graph on purpose. A monorepo's imports of its own packages by name are linked, except for a package whose entry file only exists after a build, like vite's own `vite`.

## Languages

Besides TypeScript and JavaScript, Nebulosity reads Python, Go, Java, C# and Rust, each through a tree-sitter grammar that ships with it, so there's nothing to install and no build of your repo. Each was measured on one real repo, indexed cold, with 30 of its links drawn at random and checked in the source by someone other than its builder.

| Language | Repo | Its files indexed | Whole repo's index, worst of 3 | References to the repo's own code resolved | Sampled links right |
|---|---|---|---|---|---|
| Python | [django](https://github.com/django/django) | 2,937 | 9.2 s | 99.98% of absolute imports, 99.97% of relative ones | 30 of 30 |
| Go | [prometheus](https://github.com/prometheus/prometheus) | 747 | 10.4 s | 100% of imports, 99.96% of same-package names, 99.7% of qualified uses | 30 of 30 |
| Java | [spring-boot](https://github.com/spring-projects/spring-boot) | 8,705 | 21.8 s | 100% of imports, 99.7% of type names | 30 of 30 |
| C# | [jellyfin](https://github.com/jellyfin/jellyfin) | 2,251 | 7.9 s | 99.2% of type names, 100% of qualified and static ones | 29 of 30 (the one strict miss is fixed since) |
| Rust | [rust-analyzer](https://github.com/rust-lang/rust-analyzer) | 1,498 | 7.8 s | 100% by its rules, so the sampled links and a check across crates are the real test | 30 of 30 |

- **Each language links files by its own rules,** read from the code and its manifests (Python's package roots and `pyproject.toml`, Go's `go.mod`, Java's packages, C#'s namespaces and projects, Rust's `Cargo.toml` and `mod` tree). Each skips its own dependency and build folders, such as a virtual environment, `vendor/`, `target/`, `build/`, `bin/` and `obj/`.
- **Some things aren't followed.** `calls` is TypeScript and JavaScript only. C# extension-method calls, members inherited from a supertype in Java and C#, Python paths added to `sys.path` at run time and Rust's `use super::*` globs carry no links.
- **No eval has covered these languages,** so nothing here claims Nebulosity is faster on them. Their summaries use the same prompt and haven't been reviewed yet.

## Speed

Measured on a laptop on VS Code, which has 20,342 files (14,849 indexed before the five new languages and 15,040 since). How each number was taken is in [BENCHMARKS.md](BENCHMARKS.md).

| What | Measured |
|---|---|
| Indexing the structure | 56.7 s at worst of three and 50.2 s median (Index Benchmark #7), and 75–77 s on the same laptop on 2026-10-25 (Index Benchmark #8) |
| Summarizing every file and folder | $10.30 |
| A click or zoom on the Map | 78 ms at worst, 97 ms on the static demo |
| A warm MCP tool call | 177 ms at worst, and 902 ms for the first `calls` answer in a fresh process (MCP Benchmark #5) |
| A saved file showing up | 1,501 ms at worst once warm, 1 s of it the watcher's wait (Update Benchmark #3) |
