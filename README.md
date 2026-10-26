# Nebulosity

**See how a big codebase fits together, and give Claude Code the same map.**

Nebulosity reads every import in a repository and keeps the result up to date as you work. From that it gives you two things:

- **The Map:** a zoomable picture of the repo, in your browser or in VS Code. It shows one folder at a time, with a line for every import between its parts and a panel saying what each file uses and what uses it.
- **Seven tools for Claude Code,** which answer dependency questions in one call. What would a change to this file affect? How does this entry point come to load that file? Where are the import cycles?

![The Map on VS Code's src/vs/platform folder](docs/screenshots/map-vscode.png)

## What it measurably does

I measured it against Claude Code on its own, on three large TypeScript repos: VS Code, AFFiNE, and Theia, which was kept out of all tuning.

- **On questions that take several steps through the imports** (what a change affects, import chains, which entry points load a file, import cycles), Claude Code with Nebulosity:
  - was **2.3–4.4× as fast** on VS Code and AFFiNE, and **1.5–3.2× as fast** on Theia;
  - scored the same or higher;
  - cost 1.4–2.6× less on VS Code and AFFiNE, and 1.0–1.3× less on Theia.
- **Everywhere else it was about even.**
  - Listing a method's callers took a third to 40% less time where the `calls` tool found them (VS Code, Theia), and about 10% less where it missed most of them (AFFiNE).
  - One-step lookups, planning a change and "how is this repo designed?" questions came out about the same, and some cost more.
- **The fine print:**
  - I grouped the questions by kind after the runs.
  - The pass mark I set before them, aimed at questions about method calls, wasn't met.
  - The five languages added later (Python, Go, Java, C#, Rust) weren't part of these tests; only how well it reads them was measured.

  Every number and every loss: [docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md).

## Quick start

You need Node 24 or later and git, and Claude Code 2.1.300 or later for the tools.

> **Not published yet:** until it's on npm, [install from a checkout](docs/GUIDE.md#install) instead of the first command.

```bash
npm install -g nebulosity
```

Then run these in your repo's root folder:

```bash
nebulosity index .    # read the repo's files and imports (free; a minute or two for VS Code)
nebulosity map        # open the Map at http://localhost:3000
nebulosity setup      # connect Claude Code to this repo
```

Now ask Claude Code about your repo. For example:

- "If I change `src/base/event.ts`, what could break?"
- "How does `main.ts` end up loading `terminal.ts`?"
- "Which entry points load this file?"
- "Are there import cycles in `src/platform`?"

It calls Nebulosity's tools when they help, and it can point at files on the Map while it explains. If something's off, `nebulosity doctor` checks your setup.

## What's included

- **The Map:**
  - folders and files as boxes, at most 50 at a time, with lines for the imports between them;
  - a details panel, a source viewer and search (Ctrl K);
  - it stays current as you save files.
- **Seven MCP tools:** `overview`, `describe`, `search`, `imports`, `architecture`, `calls` and `show_on_map` ([what each one does](docs/GUIDE.md#the-seven-tools)).
- **A VS Code extension** that shows the Map beside your code and follows the file you're in ([below](#in-vs-code)).
- **Seven languages:** TypeScript and JavaScript, read with TypeScript's own compiler, plus Python, Go, Java, C# and Rust ([how each is read](docs/GUIDE.md#languages)).
- **Free:** all of the above works without an API key, and Nebulosity itself sends nothing off your machine. Summaries are an optional extra ([below](#summaries-optional)).

## In VS Code

The extension shows the Map in a panel beside your code. It follows the file you're in, opens a file you click on the Map, and can light up every file that depends on the one you're in.

1. Install the `nebulosity` package and index your repo (above).
2. Install the **Nebulosity** extension. Until it's on the Marketplace and Open VSX, [build it from a checkout](docs/GUIDE.md#in-vs-code).
3. Run **Nebulosity: Show Map** from the Command Palette.

More: [vscode-extension/README.md](vscode-extension/README.md).

## Summaries (optional)

With an Anthropic API key (`ANTHROPIC_API_KEY`), `nebulosity summarize .` writes a short summary of every file and folder. The Map's panels and Claude Code's answers then read like a guide, and search can match by meaning.

- **Your code goes to Anthropic:** that's how the summaries get written.
- **It costs about $1 per 1,000 files** ($10.30 for VS Code).
- **It asks first:** it shows the estimate and spends nothing until you say yes.
- **A cap:** each repo is capped at $15 in total unless you raise it with `--budget`.

### Summary models

By default, Claude Haiku 5.5 summarizes files and Claude Sonnet 5.5 summarizes folders. When those models are retired, or if you'd rather use others, name new ones in `config.json` in Nebulosity's data folder. Give their prices too, so the estimate still works:

```json
{ "summaryModels": { "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 } } }
```

The full rules are in [docs/GUIDE.md](docs/GUIDE.md#summary-models): where the data folder is, what changing a model re-summarizes, and what happens if the file has a typo.

## How it works

```
your repo ──► nebulosity index ──► SQLite: files, imports, folders, summaries, search
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  ▼                     ▼                     ▼
             MCP server        the Map (Next.js) and    the static demo
      (Claude Code, any MCP     the VS Code extension
             client)
```

One engine in `lib/` answers every question, and the MCP server, the Map and the demo are thin layers over it. While the Map runs, it keeps the index up to date.
- Speed, accuracy and cost: [docs/BENCHMARKS.md](docs/BENCHMARKS.md).
- Why it's built this way: [docs/ENGINEERING_DECISIONS.md](docs/ENGINEERING_DECISIONS.md).
- Every command and setting: [docs/GUIDE.md](docs/GUIDE.md).

## Status

**Complete.** This is the last release. It isn't maintained, so issues and pull requests may go unanswered.

- **Tested** on Windows, macOS and Linux, with Node 24 and Claude Code 2.1.300–2.1.310 ([details](docs/GUIDE.md#tested-with)).
- **If Anthropic retires the summary models,** set new ones ([Summary models](#summary-models)).
- **If Claude Code's `mcp add` command changes,** `nebulosity setup --json` prints a plain config that any MCP client can use ([details](docs/GUIDE.md#other-mcp-clients-or-by-hand)).

## Why I built this

I wanted to learn how AI agents and retrieval really work by building every layer myself: parsing, an import graph that stays current, summaries, embeddings, search and an MCP server. Then I wanted to measure honestly whether it helps.

I also kept running into the problem it goes after. In a large, unfamiliar repo, the first questions you have (what are the parts, what depends on this) have answers that live in no single file.

The docs are written to teach as well as specify, and [LEARNING_NOTES.md](docs/LEARNING_NOTES.md) is the guided tour.

## License

MIT ([LICENSE](LICENSE)). The demo's data comes from [VS Code](https://github.com/microsoft/vscode) at commit `cc3fec88` (MIT, © Microsoft Corporation).
