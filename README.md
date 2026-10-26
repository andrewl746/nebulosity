# Nebulosity

**A live map of how a big codebase fits together, for Claude Code and for you.**

In a large codebase, some questions take many steps to answer. To find out what a change to one file could affect, you need every file that imports it, then every file that imports those, and so on. Claude Code normally works this out with one search after another. The VS Code repository has 14,849 files and over 140,000 imports, so a question like this can take a lot of searches.

Nebulosity indexes all of a repository's imports ahead of time and keeps the index up to date as you work. Claude Code can then answer the whole question with a single tool call. In my tests, Claude Code with Nebulosity answered questions like this **up to 4.4× faster**, and up to 3.2× faster on a codebase I never adjusted Nebulosity for. It got every one of them right.

You can also explore these imports yourself on the Map, which shows your codebase one folder at a time, with lines showing what imports what. The Map opens in your browser or in a VS Code panel.

![The Map on VS Code's src/vs/platform folder](docs/screenshots/map-vscode.png)

## Evaluation

I tested Nebulosity by giving Claude Code the same questions with and without it, on three large open-source TypeScript codebases: VS Code, AFFiNE and Theia. Across 378 runs, every answer was checked against a reference answer prepared without Nebulosity. I never adjusted Nebulosity for Theia, so Theia is the fairest test of the three.

Nebulosity helped most on questions that require following imports through several files, like "what would changing this file affect?", "how does this entry point end up loading that file?" and "is this file part of an import cycle?". On those, depending on the type of question, Claude Code with Nebulosity was **2.3–4.4× faster** on VS Code and AFFiNE, and **1.5–3.2× faster** on Theia. It was usually cheaper too: 1.4–2.6× cheaper on VS Code and AFFiNE, and up to 1.3× cheaper on Theia. There were 14 of these questions, each asked 3 times with Nebulosity and 3 times without. With Nebulosity, Claude Code got all 42 answers fully right. Without it, Claude Code got 29 fully right and the rest partly right.

For example, to trace how one file ends up loading another, Claude Code with Nebulosity used one tool call every time, with a median of 5–6 seconds on each codebase. Without Nebulosity, it used three to six tool calls and took a median of 16–24 seconds.

On simpler questions, such as listing the files that import a given file directly, Nebulosity made little difference, because a single search already answers them. The method, the caveats and the data behind every number are in [docs/EVALUATION.md](docs/EVALUATION.md), which also notes that I split the questions into multi-step and simpler ones after the runs.

## Quick start

You'll need Node 24 or later and git, plus Claude Code 2.1.300 or later if you want the tools.

> **Not on npm yet.** Until it is, [install from a checkout](docs/GUIDE.md#install) instead of running the first command.

```bash
npm install -g nebulosity
```

Then, from your repo's root folder:

```bash
nebulosity index .    # read the repo's files and imports (free; a minute or two for VS Code)
nebulosity map        # open the Map at http://localhost:3000
nebulosity setup      # connect Claude Code to this repo
```

That's it. Now ask Claude Code things like:

- "If I change `src/base/event.ts`, what could break?"
- "How does `main.ts` end up loading `terminal.ts`?"
- "Which entry points load this file?"
- "Are there import cycles in `src/platform`?"

It'll use Nebulosity's tools when they help, and it can point things out on the Map while it explains. If something seems off, `nebulosity doctor` will tell you what's missing.

## Features

The **Map** shows your repo one folder at a time, with at most 50 boxes on screen, so it stays readable. Click a box to see what it imports and what imports it, open its source, or search with Ctrl K. It updates as you save files.

The **seven tools** Claude Code gets are `overview`, `describe`, `search`, `imports`, `architecture`, `calls` and `show_on_map`. [The guide](docs/GUIDE.md#the-seven-tools) explains what each one does.

The **VS Code extension** puts the Map in a panel next to your code ([more below](#vs-code-extension)).

It reads **seven languages**: TypeScript and JavaScript, using TypeScript's own compiler, plus Python, Go, Java, C# and Rust ([how each one is read](docs/GUIDE.md#languages)).

And it's **free**. Everything above works without an API key, and Nebulosity itself never sends anything off your machine. AI-written summaries are an optional extra ([below](#ai-summaries-optional)).

## VS Code extension

The extension shows the Map beside your code. It follows whatever file you have open, opens a file when you click it on the Map, and can light up the files that import the one you're looking at.

![The Nebulosity extension in VS Code: editor.main.ts is open in the editor and selected on the Map beside it, with lines to the files it imports and its summary open](docs/screenshots/vscode-extension.png)

1. Install the `nebulosity` package and index your repo (see above).
2. Install the **Nebulosity** extension. Until it's on the Marketplace and Open VSX, you can [build it from a checkout](docs/GUIDE.md#in-vs-code).
3. Run **Nebulosity: Show Map** from the Command Palette.

There's more in [vscode-extension/README.md](vscode-extension/README.md).

## AI summaries (optional)

With an Anthropic API key ([how to add one](#adding-your-api-key)), `nebulosity summarize .` writes a short summary of every file and folder. You'll see them in the Map's details panel and in the answers Nebulosity gives Claude Code. They also let search find files by what they do, not just by the words in them.

This does send your code to Anthropic, since that's how the summaries get written. It costs about $1 per 1,000 files ($10.30 for all of VS Code). It always shows you an estimate and waits for a yes before spending anything. Each repo is also capped at $15 in total, unless you raise the limit with `--budget`.

### Adding your API key

1. Create a key in the [Claude Console](https://platform.claude.com/) ([how](https://platform.claude.com/docs/en/get-api-key)).
2. Give it to Nebulosity in one of two ways:
   - **For the current terminal:** `export ANTHROPIC_API_KEY="sk-ant-..."` on macOS and Linux, or `$env:ANTHROPIC_API_KEY = "sk-ant-..."` in Windows PowerShell.
   - **Once, for every terminal:** save the line `ANTHROPIC_API_KEY=sk-ant-...` in a file named `.env.local` in Nebulosity's data folder. That's `%LOCALAPPDATA%\Nebulosity` on Windows, `~/Library/Application Support/Nebulosity` on macOS, and `~/.local/share/nebulosity` on Linux. If the folder doesn't exist yet, create it.
3. Run `nebulosity doctor`. Once it finds the key, it says "ANTHROPIC_API_KEY set". Then run `nebulosity summarize .` from your repo. If the Map is already open, restart it so it picks up the key.

Keep the key private, and never commit it to a repository.

### Summary models

By default, Claude Haiku 5.5 summarizes files and Claude Sonnet 5.5 summarizes folders. When those models get retired, or if you'd rather use different ones, name new ones in `config.json` in Nebulosity's data folder. Include their prices so the cost estimate still works:

```json
{ "summaryModels": { "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 } } }
```

[The guide](docs/GUIDE.md#summary-models) has the rest: where the data folder lives, what gets re-summarized when you switch models, and what happens if the file has a typo.

## Architecture

```
your repo ──► nebulosity index ──► SQLite: files, imports, folders, summaries, search
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  ▼                     ▼                     ▼
             MCP server        the Map (Next.js) and    the static demo
      (Claude Code, any MCP     the VS Code extension
             client)
```

Everything runs on one engine in `lib/`. The MCP server, the Map and the static demo are thin layers on top of it. While the Map is open, it keeps the index current in the background. Nebulosity has over 2,600 automated tests, which run in CI on Windows, macOS and Linux.

If you want to dig deeper:

- [docs/GUIDE.md](docs/GUIDE.md) covers every command and setting.
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) has the speed, accuracy and cost measurements.

## Background

I wanted to understand how AI agents and retrieval actually work, so I built every layer a tool like this needs: an indexer for seven languages, an import graph that stays current as you edit, AI-written summaries, local embeddings, hybrid search, an MCP server for Claude Code to call, and the Map and the VS Code extension on top. Then I put it to the test: three evals and 738 runs of Claude Code with and without it, with every transcript in the repo.

I also kept running into the problem myself. Every time I opened a big unfamiliar repo, my first questions had answers that weren't in any one file.

## License

MIT ([LICENSE](LICENSE)). The demo's data comes from [VS Code](https://github.com/microsoft/vscode) at commit `cc3fec88` (MIT, © Microsoft Corporation).
