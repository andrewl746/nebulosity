# Nebulosity

An observatory for unfamiliar codebases.

Point Nebulosity at a repository and it draws the project as an interactive star map. Every file is a node floating in a nebula, every import is a connection between them, and an AI guide sits in a terminal on the left ready to explain what you're looking at. Ask it how something works and it searches the actual code, cites the files it read, and lights up the relevant nodes on the canvas while it talks.

That last part is the whole idea. Onboarding onto a new codebase usually means days of jumping between files trying to build a mental map. Nebulosity draws the map for you, then gives you a guide who can point at it.

## Why I built this

Two reasons, honestly.

First, I wanted to learn how modern AI agents actually work. Not by calling one API and wrapping it in a chat window, but by building the full pipeline myself: AST parsing, code chunking, local embeddings, vector retrieval, and a LangGraph agent with real tools. Every layer of the RAG stack in this project is hand built so I understand what each piece does and why it exists.

Second, I kept running into the problem this tool solves. Opening a large unfamiliar repo is overwhelming, and the questions you have (where does this data come from, which files matter, what should I read first) are exactly the questions a dependency graph plus a grounded AI can answer.

## What works right now

The visualization layer is live:

- A recursive scanner walks the repo and extracts import relationships
- A transform turns raw scan data into a positioned graph (deterministic radial layout, no overlaps)
- Custom React Flow nodes render each file as a terminal chip with semantic indicators (cyan for UI components, purple for logic modules)
- A zero cost canvas starfield and nebula backdrop, painted once and never repainted during pan or zoom
- The frosted glass terminal shell, status bar, and minimap

The backend data layer and the systems layer are fully designed but not yet built. The plan is an embedded SQLite database (Drizzle ORM) with a normalized schema for repositories, files, and import edges, written transactionally so a crash mid scan can never half save a graph, plus a standalone C++17 scanner with a physical thread pool that streams results back to Node over pipe IPC, with automatic fallback to the TypeScript scanner so the app never depends on a compiled binary existing. I'm hand writing both of these myself rather than generating them, since a thread pool and a relational schema you didn't write are not a thread pool and a relational schema you understand.

The AI layer is fully designed and being built in phases. The complete architecture (ten design documents plus a code review with precomputed test vectors) lives in [docs/](docs/), starting with [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How it works

```
repository files
      |
scanner            reads files, extracts imports
      |
graph builder      resolves imports to real files, computes layout
      |
   -- server / client boundary --
      |
React Flow         renders the interactive map
      |
LangGraph agent    (in progress) answers questions with retrieval,
                   drives the graph while it explains
```

The design splits everything into three strict layers. Core logic in `lib/` never imports from the UI framework, route handlers stay thin, and the two sides only communicate through typed contracts in `lib/contracts.ts`. That discipline exists for a reason: the long term target is a desktop app, and this shape means only the thin adapter layer needs rewriting.

A few decisions I'd defend in an interview (the full records are in [ENGINEERING_DECISIONS.md](docs/ENGINEERING_DECISIONS.md)):

- **Regex scanning for the MVP, AST parsing scheduled.** The regex version shipped a working graph in a day with zero dependencies. Its failure modes are documented, tested, and quarantined behind one function so the upgrade is a single module swap.
- **The C++ scanner is an accelerator, never a dependency.** Scanning a repo is I/O bound, so a rewrite for speed alone would be hard to defend. Instead both engines honor the same output contract, the bridge falls back to TypeScript automatically, and the deliverable is a benchmark of both. The interview story is the measurement, not the rewrite.
- **I started with JSON files and re architected to SQLite on purpose.** Flat files were the right first call at single repo scale. Transactions, schema enforced dedupe, and indexed graph queries became worth it once the agent's tools and multi repo support entered the design. Both decisions, and the trigger that flipped them, are written down as ADRs.
- **Local embeddings, brute force cosine search.** At the scale of one repository this is milliseconds per query with no infrastructure. The math for when this stops working, and the upgrade path for that day, is written down.
- **UI actions are agent tools.** When the agent wants to highlight a file it calls a tool, the same as searching code. Structured, validated, and streamed in order with the narration. No parsing commands out of prose.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and you'll see the map of this repository itself.

The AI features will need an `ANTHROPIC_API_KEY` in `.env.local` once the agent phases land. The graph works without one.

## Use it from Claude Code

Nebulosity's MCP server gives Claude Code the index: an overview of the repo, what any folder or file is, search, complete dependency lists, import chains, and pointing at things on the Map.

1. Index the repo (in this folder): `npm run index -- <path-to-repo>`.
2. Register the server once. Use forward slashes in the path, also on Windows, and quotes if it has spaces:

   ```bash
   claude mcp add --scope user --transport stdio nebulosity -- node /path/to/Nebulosity/mcp/launch.mjs
   ```

   No `npx`, so Windows needs no `cmd /c` wrapper. `--scope local` registers it for the current project only.
3. Check: `claude mcp list` shows `nebulosity` as connected.

The server answers about the indexed repo that holds the folder Claude Code runs in, or else the repo the Map shows. It only reads the index, so keep the Map running (`npm run dev`) to have changes picked up as files change. To keep tool calls off the Map, add `-e NEBULOSITY_LIVE=off` before `--transport`.

## Project status

Currently working through a phased roadmap ([IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md)): test harness and graph API first, then repository indexing, embeddings, retrieval, the LangGraph agent, and finally wiring the agent to the terminal. Each phase has acceptance criteria that have to pass before the next one starts.

Built by Andrew Li as a flagship learning project. The docs are written to teach as well as specify, so if you're curious how any of it works, [LEARNING_NOTES.md](docs/LEARNING_NOTES.md) is the guided tour.
