# Nebulosity

**A map of how a big codebase fits together, for you and for Claude Code.**

Open a large repository you've never seen, and the first questions are always the same. What are the main parts? Which files matter? What breaks if I touch this one? The answers are spread across thousands of imports, so no single file tells you.

Nebulosity reads all of those imports once and keeps them up to date while you work. You get a Map you can zoom around, one folder at a time, with lines showing what imports what. Claude Code gets seven tools that answer dependency questions in a single call, instead of grepping its way through the repo.

![The Map on VS Code's src/vs/platform folder](docs/screenshots/map-vscode.png)

## Does it actually help?

I tested it against Claude Code on its own, on three large TypeScript repos: VS Code, AFFiNE and Theia. I kept Theia out of all tuning, so it's the fairest test of the three.

Some questions take several hops through the imports: "what would changing this file affect?", "how does this entry point end up loading that file?", "where are the import cycles?". On those, Claude Code with Nebulosity was 2.3–4.4× faster on VS Code and AFFiNE, and 1.5–3.2× faster on Theia. It scored the same or better. It usually cost less too: 1.4–2.6× cheaper on VS Code and AFFiNE, and about the same to 1.3× cheaper on Theia.

On simpler lookups that don't need the import graph, it performs about the same as Claude Code alone, which is what you'd expect. The full method, every run and the fine print (including that I grouped the questions by type after running them) are in [docs/EVAL_RESULTS.md](docs/EVAL_RESULTS.md).

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

## What you get

The **Map** shows your repo one folder at a time, with at most 50 boxes on screen, so it stays readable. Click a box to see what it imports and what imports it, open its source, or search with Ctrl K. It updates as you save files.

The **seven tools** Claude Code gets are `overview`, `describe`, `search`, `imports`, `architecture`, `calls` and `show_on_map`. [The guide](docs/GUIDE.md#the-seven-tools) explains what each one does.

The **VS Code extension** puts the Map in a panel next to your code ([more below](#in-vs-code)).

It reads **seven languages**: TypeScript and JavaScript, using TypeScript's own compiler, plus Python, Go, Java, C# and Rust ([how each one is read](docs/GUIDE.md#languages)).

And it's **free**. Everything above works without an API key, and Nebulosity itself never sends anything off your machine. AI-written summaries are an optional extra ([below](#summaries-optional)).

## In VS Code

The extension shows the Map beside your code. It follows whatever file you have open, opens a file when you click it on the Map, and can light up the files that import the one you're looking at.

1. Install the `nebulosity` package and index your repo (see above).
2. Install the **Nebulosity** extension. Until it's on the Marketplace and Open VSX, you can [build it from a checkout](docs/GUIDE.md#in-vs-code).
3. Run **Nebulosity: Show Map** from the Command Palette.

There's more in [vscode-extension/README.md](vscode-extension/README.md).

## Summaries (optional)

If you have an Anthropic API key (`ANTHROPIC_API_KEY`), `nebulosity summarize .` writes a short summary of every file and folder. The Map's panels and Claude Code's answers then read more like a guide, and search can match by meaning, not just by words.

This does send your code to Anthropic, since that's how the summaries get written. It costs about $1 per 1,000 files ($10.30 for all of VS Code). It always shows you an estimate and waits for a yes before spending anything. Each repo is also capped at $15 in total, unless you raise the limit with `--budget`.

### Summary models

By default, Claude Haiku 5.5 summarizes files and Claude Sonnet 5.5 summarizes folders. When those models get retired, or if you'd rather use different ones, name new ones in `config.json` in Nebulosity's data folder. Include their prices so the cost estimate still works:

```json
{ "summaryModels": { "file": { "model": "claude-haiku-6", "inputPerMTok": 0.1, "outputPerMTok": 0.5 } } }
```

[The guide](docs/GUIDE.md#summary-models) has the rest: where the data folder lives, what gets re-summarized when you switch models, and what happens if the file has a typo.

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

Everything runs on one engine in `lib/`. The MCP server, the Map and the static demo are thin layers on top of it. While the Map is open, it keeps the index current in the background.

If you want to dig deeper:

- [docs/GUIDE.md](docs/GUIDE.md) covers every command and setting.
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) has the speed, accuracy and cost measurements.
- [docs/ENGINEERING_DECISIONS.md](docs/ENGINEERING_DECISIONS.md) explains why it's built the way it is.

## Status

Nebulosity is **finished**. This is the last release, and I'm not maintaining it, so issues and pull requests may not get a reply.

It's been tested on Windows, macOS and Linux, with Node 24 and Claude Code 2.1.300–2.1.310 ([details](docs/GUIDE.md#tested-with)).

Two things outside its control could change over time, and both have a way around them. If Anthropic retires the summary models, you can [set new ones](#summary-models). If Claude Code's `mcp add` command changes, `nebulosity setup --json` prints a plain config that any MCP client can use ([details](docs/GUIDE.md#other-mcp-clients-or-by-hand)).

## Why I built this

I wanted to understand how AI agents and retrieval actually work, so I built every layer myself: a parser, an import graph that stays current, summaries, embeddings, search, and an MCP server for Claude Code to call. Then I wanted to find out honestly whether any of it helps. That's why there's an eval, with its losses written down.

I also kept running into the problem myself. Every time I opened a big unfamiliar repo, my first questions had answers that weren't in any one file.

The docs are written to teach as well as explain. If you're curious how it all works, [LEARNING_NOTES.md](docs/LEARNING_NOTES.md) is the best place to start.

## License

MIT ([LICENSE](LICENSE)). The demo's data comes from [VS Code](https://github.com/microsoft/vscode) at commit `cc3fec88` (MIT, © Microsoft Corporation).
