# V1.8 In your editor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** **built 2026-10-24; awaiting the owner's look (Task 12).** Approved by the owner, 2026-10-23, in the planning session, while the plan was being written: "u can go ahead and implement the plan once its done. im gonna go afk for a while. switch to xhigh effort when implementing". The build ran in the same session, under the owner's delegation while they were away. Calls made for them are listed in the ledger's `overnight-decisions.md`. The plan's stops that need the owner's hands wait for them: Remote SSH (Task 1 Step 4; the spike ran WSL and Cursor itself), Task 11 Step 3's check of the built extension in WSL, which needs Node there, and Task 12. Where the build or a ruling changed what a task says, the task carries a dated amendment note, or a short correction in place; the ledger has each ruling in full.

**Goal:** A VS Code extension, `vscode-extension/`, that shows the running Map in an editor panel beside the code, starts the Map if none is running, keeps the Map and the editor in step both ways, and keeps Claude Code's live activity visible in the panel, published to the Marketplace and Open VSX by the owner at ship.

**Architecture:** The extension is another HTTP client of the Map, like the MCP server. Its panel is a webview holding a full-size iframe of `http://localhost:<port>/?embed=vscode` (through `vscode.env.asExternalUri`), so the Map's own requests carry the Map's own Host and Origin and ADR-039's guards pass unchanged. A `postMessage` bridge (API_CONTRACTS §20) carries the editor ↔ Map sync, relayed by the webview's script. It touches only the one panel, never the live channel. The server side gains one read route (`GET /api/imports`, §19), an optional `server` field on `GET /api/repos` (§15), `nebulosity map --print-port`, and a `frame-ancestors` header on the Map's pages.

**Tech Stack:** TypeScript 5, Node 24, Next.js 16.4.3 and React 19 (the Map, unchanged in the browser), Vitest 4. The extension uses the VS Code extension API (`@types/vscode`, the floor set by Task 1) and esbuild for the bundle, with `@vscode/test-electron` and mocha for the integration test and `@vscode/vsce` and `ovsx` for packaging. All are devDependencies of `vscode-extension/` only, exact versions pinned at install and recorded in the ledger. The extension has no runtime dependency.

**Spec:** `.superpowers/sdd/2026-10-23-vscode-extension/design.md`, approved by the owner 2026-10-23 "as written, including the designer's calls". Also ADR-062 (`docs/ENGINEERING_DECISIONS.md`); `docs/API_CONTRACTS.md` §15 (`server`), §19 (`GET /api/imports`), §20 (the editor bridge); ADR-038, ADR-039 (and amendments), ADR-049, ADR-058; `proxy.ts`, `lib/live/local.ts`, `app/map/useLive.ts`, `app/map/history.ts`, `scripts/cli.ts`.

**Ledger:** `.superpowers/sdd/2026-10-23-vscode-extension/progress.md` (gitignored; the owner keeps ledgers). Every commit, ruling and stop goes there.

---

## What the code and the machine have today (checked 2026-10-23, planning)

- **Branch.** `pivot/v1` at `78e9e00`, pushed. `main` is at `8645751` (PR #9). `pivot/v1` is ahead by `bea486d` (next 16.4.3) and docs commits. Uncommitted: `docs/LEARNING_NOTES.md` (modified) and `lib/agent/state.ts` (untracked), both the owner's, never staged.
- **The gate.** Vitest **1,494/1,494** in 137 files (18.2 s, run at planning). tsc and lint as of `7e1d5af`: clean, 0 errors.
- **The machine.** Port 3000 is **listening** (PID 32540, an earlier session's Map, served from the checkout's pre-V1.8 `.next`). Ask before stopping it, and never build in the checkout while it may be `next start` (memory: builds in the sandbox worktree). The old sandbox `../Nebulosity-build` serves a demo on 3200 and can't be reinstalled under it, so V1.8 builds in its own sandbox worktree, `../Nebulosity-v18` (ledger, Task 0). `../vscode` is at `cc3fec88`, indexed. There is no global `nebulosity` on PATH. VS Code 1.140.0, Cursor and WSL (Ubuntu, no Node) are installed; until the owner restarts VS Code into its pending update, `code` can't open a window (ledger, Spike, "Surprise").
- **The owner's data folder.** The checkout's `.nebulosity/` holds the index the owner's Map and Claude Code use, and its `config.json` is `{ activeRepo: "C:/Users/Andrew/Programming/vscode", port: 3000 }`. The owner's MCP server posts live events to that `port` (§14), and `POST /api/repos` rewrites `activeRepo` (`setActiveRepo`, a plain non-atomic `writeFileSync`). So no task may write that file (Global Constraints, "The machine").
- **The engine.** `reach(repoRoot, targetPath, direction, { within? })` (`lib/engine/reach.ts`) returns `ReachAnswer = { path, kind, direction, reached: { path, distance }[], direct, indexVersion }`. `reached` is every file reached, ordered by distance, then in-degree (most imported first), then path. It throws `BadInputError` for the repo root (`""`) and `PathNotFoundError` for an unindexed path. Its compressed index is cached per index version (`importIndexFor`). §19 also says answers "are cached by index version like `describe`", whose answer cache is `lib/engine/describe.ts:15-51`, so Task 2 adds one. Routes map engine errors with `errorJson` (`app/api/_lib/respond.ts`). Paths are checked with `parseRepoPath` (`lib/index/paths.ts`). Routes have no tests of their own: their logic lives in `lib/` and is tested there.
- **`GET /api/repos`** returns `listRepos()` (`lib/engine/repos.ts`). Roots are stored as `repoKey(path.resolve(root))`, which is **forward slashes with the drive letter as `path.resolve` spells it** (`C:/Users/Andrew/Programming/vscode`). VS Code's `Uri.fsPath` gives `c:\Users\…` (lower-case drive, backslashes). The extension must match the two (Review Focus 1).
- **The Map's history** (`app/map/history.ts`): `mapUrl(path, page)`, `placeFromSearch(search)`, and `historyStep(address, place)`, which returns `"none" | "replace" | "push"`. `MapView.tsx` applies it in one effect on `place`. `focus(target)` either selects a box already drawn or sets `focusing`, whose effect fetches the level with `focus` and sets the place. A failed jump sets `focusError` (shown for a few seconds). `select(target)` is the canvas's box click (`MapCanvas` `onNodeClick` → `onSelect(node.id)`). The detail panel's declaration rows call `onViewLines(start, end)`, which opens the source viewer. `onLive` runs `highlight_nodes` → `setHighlights`, `clear_highlights`, `focus_node` → `focus`. Timings: `markStart` / `measureAfterPaint` (`app/map/perf.ts`, double `requestAnimationFrame`).
- **No frame headers.** `next.config.ts` sets no `headers()`, so any page can frame the Map (design §9).
- **The CLI** (`scripts/cli.ts`): `nebulosity map [--port <n>]` saves the port in the data folder's `config.json` (`readConfig().port`, `DEFAULT_PORT = 3000`) before it starts (`cli.ts:189-190`), then runs `next start -H 127.0.0.1 -p <port>` on the `.next` of `NEBULOSITY_HOME` (`cli.ts:184, 193-194`). `bin/boot.mjs` sets `NEBULOSITY_HOME` to the launcher's own folder unless it's set, and keeps a checkout's or worktree's data in its own `.nebulosity` unless `NEBULOSITY_DATA` is set. Nothing prints the saved port. `nebulosity index <root>` makes the repo active unless `--no-activate`, and stores `repoKey(path.resolve(root))`, so `c:\x` and `C:\x` are stored as two roots.
- **The version.** `package.json` and `package-lock.json` (lines 3 and 9) say `0.2.0`; `mcp/server.ts:19` `SERVER_VERSION = "0.2.0"` must equal it (`mcp/server.test.ts:168`), and `scripts/cli.test.ts:132` expects `"0.2.0"`.
- **Configs.** The root `tsconfig.json` includes `**/*.ts` and excludes `node_modules` and `test/fixtures`. `vitest.config.ts` excludes `test/fixtures/**` on top of vitest's defaults, and vitest's default include also matches compiled `*.test.js`. `eslint.config.mjs` ignores `.next`, `out`, `build`, fixtures, `.superpowers`, `.nebulosity` (the root's `out/` only). The package's `files` is an allow-list, so `vscode-extension/` is left out of it already.
- **CI** (`.github/workflows/ci.yml`): Linux, macOS and Windows, run only on a push to `ci/**` (or by hand once on `main`). Each runs the gate, `npm run build:package`, packs and installs into a scratch prefix, indexes the fixtures, and starts the installed Map on 3123/3124. On Windows `$BIN/nebulosity` is npm's extensionless sh shim (beside `nebulosity.cmd`), which `spawn` without a shell can't run. `$COPY` already names the arch-repo copy ("Index a temp copy of arch-repo").
- **The fixture.** `test/fixtures/mini-repo`: 8 source files. Its import edges and the answers below are hand-derived in "Ground truth".

---

## Decisions

### Settled by the owner in design (2026-10-23)

The design was approved as written, including every "(my call)". This plan does not reopen any of them: the iframe and `asExternalUri`, `retainContextWhenHidden`, the extension starts the Map, no auto-install, the stop rule, the repo match and "last focused window wins", the bridge and its following rules, the "Follow editor" toggle in the title bar, `GET /api/imports` and its QuickPick with "Show all, including indirect", `onCommand` activation, the `server` field and package 0.3.0, Open VSX, the spike-first order and its fallback rule, and the two benchmark bars "to be confirmed in the plan".

### The plan's own calls (P1–P18), for the owner to veto while reading

Each one fills a gap the design leaves open or names as "left to the builder". If one is wrong, here is what it costs. P13–P18 were added by Plan Review #1.

| # | Call | Why | If wrong |
|---|---|---|---|
| P1 | **One more Map → editor message, `{ type: "nebulosity.drawn"; path: string; page: number; selected: string \| null }`**, embedded and after the handshake only, posted in three cases: (a) a new level placed on the canvas (MapView's `onDrawn`, `MapCanvas.tsx:169`), after the double frame; (b) a changed selection on the level already drawn, after the double frame; (c) once right after each `ready`, while a level is on screen. §20 is amended in Task 3's commit. | Without it nothing outside the iframe can tell the Map drew: the integration test couldn't catch a future `X-Frame-Options` (design §9), the benchmarks couldn't be measured, and the panel couldn't drop "Starting the Map…" at the right moment. Case (c) is there because the first level is often drawn before the hello lands (P9), and the place doesn't change on first load. | A message nobody uses: remove it and the benchmarks lose their clock. |
| P2 | **The saved port comes from `nebulosity map --print-port`** (prints `readConfig().port`, exits 0, needs no build). Order: the `nebulosity.port` setting, else `--print-port`, else 3000. `--print-port` is skipped when the setting is set, and its answer is kept for the window. | It follows the data-folder rule (`NEBULOSITY_DATA`, the user data dir) in one place, and the extension never reads `config.json` (the design's open item). | About 0.5 s at first use (tsx boot), once per window. |
| P3 | **The extension may `import type` from `lib/contracts.ts` and nothing else from `lib/`.** A layering test enforces it. ADR-062 and ARCHITECTURE, which say "no `lib/` import" today, are amended in Task 6's commit, the one that adds the import. | CLAUDE.md: contracts.ts is the one source of shared shapes, and a type import is erased from the bundle, so no runtime coupling. | Hand-copied types that drift from §15/§19/§20 unseen. |
| P4 | **The toggle is per window.** `nebulosity.followEditor` sets where each window starts; the title-bar toggle changes only that window and never writes settings. | A toolbar click that silently edits `settings.json` would surprise people. | People who want it off everywhere set the setting once. |
| P5 | **Unknown paths stay quiet on the Map** (`follow` and `show` never show the jump-failed note). "Show this file on the Map" first asks `GET /api/imports?path=<file>&limit=1` (before it posts `show`, and after Show Map: Task 8's ruling), and a `404 NOT_FOUND` becomes a VS Code message: "`<file>` isn't in Nebulosity's index (new, ignored, or not a source file)." | §20 says such paths are ignored. The deliberate command still deserves an answer. | One cheap request per command. |
| P6 | **`nebulosity.clear` is sent when the "What depends" QuickPick closes**, however it closes. | The highlights belong to the pick, and §20 defines `clear` without saying when it's sent. | Highlights would vanish while someone still wanted them, until they ran the command again. |
| P7 | **After the extension switches the active repo** (panel open, window focus), it reloads the iframe and follows the active editor after the new handshake. | The Map's level cache, place and selection belong to the old repo, and a fresh load is the one state that's sure to be right. | A one-second blink on a window switch between two repos. |
| P8 | **The address bar keeps `embed=vscode`** (`mapUrl(..., embedded)` appends it), so a reload inside the panel (a crash, a server restart, Next's own reload) stays embedded. | Otherwise the first `historyStep` rewrite drops the flag, and a reload loses the bridge. | None visible: the browser Map never has the flag. |
| P9 | **The relay re-sends `hello` every 250 ms until `ready`, for up to 60 s, starting again on every iframe `load`.** Messages from the extension wait (in order, at most 20) until `ready`. *(Amended by Task 7's review, 2026-10-23: the loop and its 60 s also start when the relay itself starts, before any `load`, so a `load` that fires before `relay.js` runs can't leave the panel unsynced. Hellos that reach the frame while it's still `about:blank` only log a console warning, as the spike saw.)* | The iframe's `load` fires before React has mounted the Map's listener, so a single hello is lost. | Without it, a panel that sometimes never syncs. |
| P10 | **Only a file box click and a declaration row open the editor.** Search picks, panel links, `focus_node` and `follow` never do. | This is the design's wording (§4.4). It keeps "the Map fighting the user" out, and stops echoes at the source. | People who expect a search pick to open the file click its box once more. |
| P11 | **Tests:** the root `vitest` also collects `vscode-extension/src/**/*.test.ts`. Those cover the pure modules, which never import `vscode`, and a test enforces that. The root `tsc` and `eslint` skip `vscode-extension/`, which has its own `tsc --noEmit`. The integration test is mocha under `@vscode/test-electron`, in `vscode-extension/test/`, which the root vitest excludes along with `vscode-extension/out/`, `dist/`, `.vscode-test/` and `node_modules/` (vitest's default include matches compiled `*.test.js`). The integration tests are bundled by `esbuild.mjs` into `out/test/` (so their output path never moves with tsc's common root once a test imports a type that reaches `lib/contracts.ts`) and type-checked by `tsc -p test --noEmit`. The extension's code is not linted: design §6 allows it, and its strict `tsc --noEmit` is the check. | One gate for the logic. Nothing in the root depends on the extension's node_modules. | A second `npm ci` in CI either way. |
| P12 | **The floor for `engines.vscode`** is the lower of two minor versions: the VS Code the spike runs, and the VS Code version Cursor reports in its About box. Task 1 recorded it in the ledger as `ENGINES_VSCODE_FLOOR`. The integration test runs on VS Code stable, and the version it downloads is printed and recorded. | Cursor tracks an older VS Code, and a floor above it would block the Open VSX install. | Too high blocks forks. Too low lets an API we use be missing (caught by the floor's own run in Task 9). |
| P13 | **The webview's `frame-src`** is design §4.1's pair, `http://localhost:<p> http://127.0.0.1:<p>`, with `<p>` the frame URL's port (the forwarded one in a remote), plus the frame URL's own origin when it is neither. `script-src` is the nonce alone, with no `cspSource`. Outside the `map` state there is no `frame-src`. | In a remote, `asExternalUri` may forward to another port than the Map's, so `<port>` has to be the frame's. The nonce already allows the external `relay.js`. | A frame blocked by the panel's own CSP: integration test 1 catches it locally, Task 11's remote check in a remote. |
| P14 | **Running, the version and "another app" all come from one `GET /api/repos`** (1 s timeout), for the probe and for the start poll, not `GET /api/status` (design §4.2 steps 2–3). *(Amended by Task 7's review, 2026-10-23: the probe comes before the install check, design §4.2's order. With no `nebulosity` command found, the port is the setting or 3000, and whatever answers there is used; "Nebulosity isn't installed" shows only when the port is free and a Map would have to be started: `serverCheck.ts`' `afterProbe`.)* | Design §6's own reason: `/api/repos` answers with nothing indexed, where `/api/status` gives `404 INDEX_EMPTY`, and its `server` field is the version check. One request then answers all three. | A second request per probe. |
| P15 | **The repo step's edge cases.** Nested indexed repos: the longest root holding the folder wins. Two roots that differ only in drive-letter case on Windows: the one equal to `list.active`, else the first listed. The root the extension passes to `nebulosity index` has its drive letter upper-cased on Windows (git's spelling), so it never adds `c:/x` beside `C:/x`. A workspace folder above every indexed repo matches none and is offered "Index this repo (free)" for itself (design §4.3 as written; the panel names the root first). With no folder open, the repo step is skipped: the panel shows the Map's active repo, and follow and open use its root (`list.active`). | The design's rule doesn't decide these, and each one either breaks a match or adds a duplicate repo. | A parent folder indexed whole by someone who clicks without reading the root. |
| P16 | **The follow gate tracks what the Map shows,** not only the last follow. An allowed follow, an `open` from the Map, a `show`, and every `drawn`'s `selected` set it. `shouldFollow` is false for that path, and for a path opened from the Map within 2 s. Every `ready` resets the gate, and then the extension follows the active editor, unless a `show` was posted since the last `ready`. *(Amended by Task 8 and its review, 2026-10-23/24. A `show` holds off the follow after `ready` for the rest of the page it was posted to, not only until the next `ready`: a second `ready` of the same page would otherwise move the Map off the file asked for. A posted follow, or a new page the extension renders, lets it go (`syncRules.ts`' `ShowHold`). The gate keeps two things: what the Map last said it shows (each `drawn`'s `selected`), and, for `ASKED_MS` (2 s) after each follow or show, the path asked (`posted(path)`). Within those 2 s `shouldFollow` compares against the ask, so a late `drawn` for an earlier follow can neither cancel a newer one nor stand in for it. A pick on the Map drops the ask, and so does `reset()`.)* | Keyed to the last follow alone, a switch back to a file after a pick on the Map, or a reopened panel, never moved the Map (G2). And the follow after `ready` would override a queued "Show this file". | Now and then a duplicate follow, which is harmless: `focus` on a box already selected changes nothing. |
| P17 | **An `open` from the Map is checked before anything opens.** The path must be repo-relative, as `parseRepoPath` allows (no `..` segment, no drive letter or leading `/`, no NUL, at most 1,024 characters), and the file must exist in the workspace (`workspace.fs.stat`). A missing file shows "`<path>` isn't in this workspace's repo (the Map shows another one; run Show Map to switch back)" and opens nothing. | The Map's own repo menu (`RepoMenu`, in the panel's top bar) or another window can switch the repo under the panel (Review Focus 4), and nothing else stops a page on the port naming `../…`. | One `stat` per pick. |
| P18 | **"The Map stopped" comes from two signals.** In the `map` state, any refused request from the extension, the repo step on window focus included. And an iframe `load` with no `ready` within 60 s, which the relay reports as `{ type: "relay.frameError" }`. The panel polls nothing. | A cross-origin iframe that fails to load fires `load` (on Chromium's error page), never `error`, and a loaded Map doesn't reload when its server dies. | A Map that dies while its window keeps focus shows as stopped only at the next command or focus. |

### The benchmark bars (design §8 step 6, confirmed here)

Measured by the integration harness in bench mode on `../vscode` (Task 10), from the extension host's side, with the panel visible (a hidden webview gets no animation frames, so `drawn` never comes).

| Bar | Measured | Pass |
|---|---|---|
| **E1: Show Map** | `nebulosity.showMap` executed (panel closed, the Map server already running and warm) → the first `nebulosity.drawn` | worst of 5 ≤ **2,000 ms** |
| **E2: follow** | `window.showTextDocument(file)` resolved → a `nebulosity.drawn` whose `selected` is that file, the 150 ms debounce included | p95 of 20 switches ≤ **500 ms** warm: 10 switches inside the drawn folder and 10 to other folders, run twice, the second pass measured |

Informative, no bar: a cold start (no server, the extension starts it), and the same 20 switches cold.

Plan Review #1 (2026-10-23, a fresh reviewer standing in for the owner's read) was applied in commit 08f19c7; see the ledger's plan-review.md.

---

## Global Constraints

- **ADR-039's guards stay exactly as they are**: `proxy.ts`'s Host check on every `/api` route, `isLocalRequest` on every route that changes something. No proxying the Map through the webview in V1.8 (design §8 step 1).
- **Layering:** the extension talks to the Map only over HTTP and the bridge. Its one import from `lib/` is `import type` from `lib/contracts.ts` (P3). Nothing in `lib/` or `app/` imports from `vscode-extension/`.
- **`lib/contracts.ts` is authoritative.** New shapes go in API_CONTRACTS first (§19 and §20 are written; P1's `drawn` is added in Task 3's commit), then `contracts.ts`. **`CONTRACTS_VERSION` stays 3.**
- **No new runtime dependency** for the Map or the package. The extension has none at runtime either (`dependencies: {}`).
- **The browser Map is unchanged.** Without `?embed=vscode` no bridge code listens or posts, and nothing looks or acts differently. The Map's look is complete: no restyling, in the panel either.
- **Free mode everywhere.** The extension never runs `summarize`, never reads or asks for an API key, never spends.
- **Copy, verbatim from the design:** "Starting the Map…", "Show log", "Nebulosity isn't installed" with `npm install -g nebulosity`, "The Map stopped" with a Start button, "Index this repo (free)", "Update Nebulosity: `npm install -g nebulosity`". Command titles as in design §4.6: "Nebulosity: Show Map", "Nebulosity: Show this file on the Map", "Nebulosity: What depends on this file?", "Nebulosity: Follow editor", "Nebulosity: Index this repo", "Nebulosity: Stop Map".
- **Settings:** `nebulosity.command` (string, default empty), `nebulosity.port` (number or null, default null), `nebulosity.followEditor` (boolean, default true).
- **Numbers from the design:** status probe timeout 1 s; start poll every 500 ms up to 60 s; follow debounce 150 ms; `highlight` at most 50 paths; `/api/imports` `limit` 1–500 (50), `offset` ≥ 0 (0), `path` ≤ 1,024 characters; bridge version 1; package version 0.3.0.
- **The machine:** never stop or build under port 3000 without asking.
  - **Read-only servers.** A server that only answers reads (Tasks 2, 3 and 5's curl and browser checks) runs from the V1.8 sandbox `../Nebulosity-v18` (ledger, Task 0) as `npx next start -H 127.0.0.1 -p <port>`, with `NEBULOSITY_HOME=<checkout>` and `NEBULOSITY_WORKER=off`, on 3100–3199. Nothing may `POST /api/repos` to it, and it is never started through `nebulosity map`.
  - **Every run where the extension may start the Map or switch repos** (Tasks 7–10, and Task 11's checks) uses a scratch data folder and never the checkout's. Set `NEBULOSITY_DATA=<scratch>`, with `NEBULOSITY_HOME` unset, so `bin/nebulosity.mjs` serves the sandbox's own V1.8 `.next`. `<scratch>` sits under `%TEMP%`, outside any git repo (else `git rev-parse` names the enclosing repo), and is named in the ledger. Fill it once with a fresh, free `NEBULOSITY_DATA=<scratch> node <sandbox>/bin/nebulosity.mjs index ../vscode` (about a minute; it writes only into `<scratch>`). Don't copy the checkout's live database: the owner's Map may be writing its WAL. Before the first such run, copy the checkout's `.nebulosity/config.json` to the ledger as `config-before.json`. After every such run, check that the file is byte-identical to it (`cmp`). A difference is a stop: restore the file and tell the owner.
  - **The hand-check VS Code.** Until the owner restarts VS Code into its pending update, `code` can't open a window. Hand checks then launch the VS Code that `@vscode/test-electron` downloads, with the same arguments. Get its path with `node -e "require('@vscode/test-electron').downloadAndUnzipVSCode('stable').then(console.log)"` in `vscode-extension/`. If that is blocked too, use the spike's identical-binaries copy with its own `win32MutexName` (ledger, Spike, "Surprise"). Always pass `--user-data-dir <scratch>/vscode-user` and `--extensions-dir <scratch>/vscode-ext`: that's a separate instance, so it takes the launching shell's environment, and it never touches the owner's profile.
  - **Live events.** Never send a live event to a server the owner's Map may be connected to (3000), and never through `npm run live` or an MCP server with live on (`NEBULOSITY_LIVE=off` for any MCP use). A `POST /api/live` to this plan's own scratch server (3101–3199: Task 7 Step 5, Task 9's test 10) reaches no Map on 3000, so it is allowed.
  - Write files holding backslash escapes with Write/Edit, never a Bash heredoc. Never `python -`.
- **Git:** `pivot/v1` only, no branch switch. Commit and push after every step. Conventional prefixes. **No `Co-Authored-By` or any Claude attribution.** Stage only the step's files. Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`.
- **Publishing is the owner's, at ship** (after E4 and `npm publish`). This slice builds a `.vsix` and publishes nothing.

## Review Focus

The five inputs most likely to hurt someone using this, which the design implies but its own steps don't exercise, most likely first. Each has its test in the task named.

1. **Windows path spellings.** VS Code gives `c:\Users\Andrew\Programming\vscode\src\a.ts`, while the index stores `C:/Users/Andrew/Programming/vscode`. The repo must match, the relative path must be `src/a.ts`, and on Linux `/home/a/Repo` and `/home/a/repo` must stay different. Two stored roots that differ only in drive case must resolve to one (P15). (Task 6, `repoMatch.test.ts`; on Windows CI, Task 9's test 1, whose repo step must switch to a copy indexed with `--no-activate`, `d:\…` against `D:/…`.)
2. **The handshake racing React.** A hello sent at iframe `load` arrives before the Map listens. A slow first load (cold `next start`), a Map restart, an in-panel reload or a closed and reopened panel must still end in `ready`, then a `drawn`, then the follow of the active editor. (Task 7, `relay.test.ts`; Task 4, `embed.test.ts`'s on-ready case; Task 6, `followGate.test.ts`'s reset case; Task 9's test 8, "a reopened panel follows the active editor"; P8, P9, P16.)
3. **Starting `nebulosity` on Windows.** It's a `.cmd` shim, so it needs a shell, quoted arguments (a command, data folder or checkout path with spaces) and a process-tree kill on Stop and on window close. A checkout's `bin/nebulosity.mjs` runs with `node` from PATH, never the extension host's own `process.execPath` (Electron). The "Index this repo" terminal quotes for the user's shell, not for cmd.exe. (Task 6, `command.test.ts`; Task 7 Step 5's index run at a path with a space; Task 9's tests 11–12 and CI's "the Map outlived VS Code" step, with `nebulosity` found on PATH, on all three systems.)
4. **The Map showing another repo than the workspace's.** The Map's own repo menu sits in the panel's top bar, and another window can switch the active repo too. Then a file-box click names a path from the other repo, which must open nothing and say why, never throw "file not found". (Task 8's `open` check, P17; Task 6, `repoMatch.test.ts`'s `checkRepoPath` cases; Task 9's test 4, "an open for a file not in this workspace opens nothing"; Task 8 Step 2's in-panel repo switch.)
5. **Something else on the port, or an older or newer Nebulosity.** Another dev server on 3000 answers `/api/repos` with HTML or a 404. A V1.7 Map answers a `RepoList` without `server`, and a later one may speak bridge 2. Each needs its own message, never a blank panel, and never an iframe of the other app. (Task 6, `serverCheck.test.ts`; Task 7, `panelHtml.test.ts`'s state cases.)

Back after following (history's `followStep`) was item 4 until Plan Review #1. The panel has no browser chrome and the Map no Back control, so it is demoted: its tests stay in Task 4, and Task 8 Step 2 records what the mouse back button and Alt+Left do in the panel.

---

## File map

**Server and Map (the root package):**
- Create `lib/engine/imports-page.ts`: parses `/api/imports`' query, keeps §19's answer cache, and pages a `ReachAnswer` into an `ImportsResponse`. Test `lib/engine/imports-page.test.ts`.
- Create `app/api/imports/route.ts`: the thin `GET`.
- Create `app/api/_lib/server.ts`: `serverInfo()`. Modify `app/api/repos/route.ts` (`GET` adds `server`).
- Modify `lib/contracts.ts`: `ImportsResponse`, `ServerInfo`, `RepoList.server?`, `BRIDGE_VERSION`, `BridgeToMap`, `BridgeFromMap`.
- Modify `scripts/cli.ts`: `map --print-port`. Test `scripts/cli.test.ts`.
- Modify `next.config.ts`: `FRAME_ANCESTORS` and `headers()` (the app build only). Test `next-config.test.ts` (root, beside `proxy.test.ts`).
- Create `app/map/embed.ts`: the Map's side of the bridge, pure. Test `app/map/embed.test.ts`.
- Create `app/map/useEditorBridge.ts`: the hook.
- Modify `app/map/history.ts` (`embedded` and `followStep`), with `app/map/history.test.ts`. Modify `app/map/MapView.tsx` and `app/map/DetailPanel.tsx` (wiring).
- Modify `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs` (P11), and `.github/workflows/ci.yml` (Task 9).
- Modify (Task 11, the version): `package.json`, `package-lock.json`, `mcp/server.ts` (`SERVER_VERSION`), `scripts/cli.test.ts` (the expected version).

**The extension (`vscode-extension/`, its own package):**
- `package.json` (manifest: commands, menus, settings, `extensionKind: ["workspace"]`, `activationEvents` on commands, `repository`, `icon`), `package-lock.json`, `tsconfig.json`, `esbuild.mjs` (the extension, the relay and the integration tests), `.vscodeignore`, `.gitignore`, `README.md` (the listing), `LICENSE` (MIT, a copy), `media/icon.png`.
- `src/` pure (no `vscode` import; tested by the root vitest): `ports.ts`, `command.ts`, `serverCheck.ts`, `repoMatch.ts`, `followGate.ts`, `panelHtml.ts`, `dependents.ts`, `webview/relay.ts`, with `*.test.ts` beside each, and `layering.test.ts`. As built, also `fromWebview.ts` (Task 7), `syncRules.ts` and `messageLog.ts` (Task 8).
- `src/` host (imports `vscode`): `extension.ts` (activate and deactivate, the test API), `http.ts`, `mapServer.ts`, `panel.ts`, `sync.ts`.
- `test/` integration: `tsconfig.json` (type-check only), `runTest.ts`, `suite/index.ts`, `suite/extension.test.ts`, and `bench/bench.test.ts` and `launch.ts` (Task 10). Built into `out/test/` (gitignored, excluded from the root vitest and from the `.vsix`).

**Docs:** `docs/API_CONTRACTS.md` §15, §19, §20; `docs/ENGINEERING_DECISIONS.md` (ADR-062 amended: P3 in Task 6's commit, the rest in Task 11's); `docs/ARCHITECTURE.md` (the extension as a client, with its one type import, in Task 6's commit); `docs/BENCHMARKS.md` (Editor Benchmark #1); `README.md` (an "In VS Code" section); `docs/IMPLEMENTATION_ROADMAP.md` (the V1.8 row); `CLAUDE.md` (the state).

---

## Ground truth for this slice (hand-derived from `test/fixtures/mini-repo`; tests transcribe these)

**Import edges** (from the files as they are; `react` is a package, so no edge; `banner`'s string is not an import):

| File | Imports |
|---|---|
| `scripts/build.js` | `src/index.ts` (require), `src/app/main.ts` (import()) |
| `src/app/main.ts` | `src/core/log.ts`, `src/app/view.tsx`, `src/util/strings.ts` (`.js` → `.ts`) |
| `src/app/view.tsx` | `src/app/main.ts` |
| `src/core/index.ts` | `src/core/log.ts` |
| `src/index.ts` | `src/app/main.ts`, `src/core/log.ts` (`@core/log`) |
| `src/util/strings.test.ts` | `src/util/strings.ts` |
| `src/util/strings.ts` | `src/core/index.ts` (`../core`) |

**In-degree** (files importing it): `src/app/main.ts` 3, `src/core/log.ts` 3, `src/util/strings.ts` 2, `src/app/view.tsx` 1, `src/core/index.ts` 1, `src/index.ts` 1, `scripts/build.js` 0, `src/util/strings.test.ts` 0.

**`reach()` order** is distance, then in-degree (high first), then path.

| Query | `files` in order (path, distance) | `direct` | `total` (transitive) |
|---|---|---|---|
| dependents of `src/core/log.ts` | `src/app/main.ts` 1, `src/core/index.ts` 1, `src/index.ts` 1, `src/util/strings.ts` 2, `src/app/view.tsx` 2, `scripts/build.js` 2, `src/util/strings.test.ts` 3 | 3 | 7 |
| dependencies of `src/app/main.ts` | `src/core/log.ts` 1, `src/util/strings.ts` 1, `src/app/view.tsx` 1, `src/core/index.ts` 2 | 3 | 4 |
| dependents of folder `src/util` | `src/app/main.ts` 1, `src/app/view.tsx` 2, `src/index.ts` 2, `scripts/build.js` 2 | 1 | 4 |
| dependents of `scripts/build.js` | none | 0 | 0 |
| dependents of `src/index.ts` | `scripts/build.js` 1 (nothing imports `build.js`, so the transitive list is the direct one) | 1 | 1 |

**Pages** (dependents of `src/core/log.ts`):
- `transitive=false` (the default): `files` = the 3 at distance 1, `total` 3, `direct` 3.
- `transitive=true&limit=2&offset=2`: `files` = `src/index.ts` 1, `src/util/strings.ts` 2; `total` 7, `direct` 3, `offset` 2.
- `transitive=false&limit=2&offset=2`: `files` = `src/index.ts` 1; `total` 3.
- `offset=10`: `files` = [], `total` 3. A page past the end is empty, not an error.

**The QuickPick for `src/core/log.ts`** (direct): its title is "3 files import log.ts". The items, in order, have labels `main.ts`, `index.ts`, `index.ts`, with descriptions `src/app`, `src/core` and `src`. A file's description is its folder (the path up to the last `/`), and a file at the repo root shows `""`. This list has no root file, so `dependents.test.ts` tests the root rule on its own literal, a path with no `/`. "Show all, including indirect" re-asks with `transitive=true` and lists 7 items: labels `main.ts`, `index.ts`, `index.ts`, `strings.ts`, `view.tsx`, `build.js`, `strings.test.ts`, with descriptions `src/app`, `src/core`, `src`, `src/util`, `src/app`, `scripts`, `src/util`. The title then reads "7 files import log.ts, 4 of them indirectly" (7 − 3). For `scripts/build.js` the title is "No file imports build.js". For `src/index.ts` with `transitive=true` (1 file, none indirect) it is "1 file imports index.ts", with no "0 of them indirectly".

---

## Part 0 — Start

### Task 0: Baseline and the ledger

**Files:** `.superpowers/sdd/2026-10-23-vscode-extension/progress.md` (ledger, not committed).

- [ ] **Step 1:** Check the branch and the tree. Run `git status --short` and `git log --oneline -1`. Expected: `pivot/v1`, only `docs/LEARNING_NOTES.md` and `lib/agent/state.ts` dirty, HEAD at or after this plan's approval commit.
- [ ] **Step 2:** Run the gate. Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: tsc clean, lint 0 errors, vitest 1,494/1,494 (or the count at approval). Record it in the ledger under "## Execution".
- [ ] **Step 3:** Check port 3000 (`netstat -ano | grep LISTENING | grep ":3000 "`) and the process's command line, and record what serves it. Update the sandbox: `git -C ../Nebulosity-v18 checkout --detach -f <HEAD>`, then `npm ci` and `npm run build` there.

---

## Part 1 — The spike (half a day, throwaway). STOP if local VS Code fails

### Task 1: The spike, recorded before any other task

The spike decides four values the rest of the plan reads: the ancestor list for `frame-ancestors`, `asExternalUri` against `portMapping`, the handshake origin's prefix, and the `engines.vscode` floor (P12).

**Files:** `.superpowers/sdd/2026-10-23-vscode-extension/spike/` only, which is gitignored and never committed. Name no file `*.test.ts` there: vitest collects ledger tests.

- [ ] **Step 1: A bare extension.** `spike/package.json` (one command `spike.open`), `spike/extension.js` and `spike/relay.js`. The command opens a `WebviewPanel` (`enableScripts`, `retainContextWhenHidden`) whose iframe is `asExternalUri(http://localhost:3100)` + `/?embed=vscode`. The CSP is the one in design §4.1, with `frame-src` set to the external URI's origin. The relay posts `{ type: "spike.hello" }` to the iframe every 250 ms and writes every message it gets back to `spike/results.json` through the extension host.
- [ ] **Step 2: A probe page in the Map.** In the sandbox only, never committed: a temporary script in `app/layout.tsx` that, when `?embed=vscode` is present, answers `spike.hello` with `{ origin: event.origin, sourceIsParent: event.source === window.parent, ancestors: [...location.ancestorOrigins], postOk }`. Here `postOk` is the status of `POST /api/repos { root: <the active root> }` from inside the iframe, sent once per page load and never once per hello (with `NEBULOSITY_HOME=<checkout>`, each POST rewrites the owner's `config.json`). Build the sandbox and start it on 3100 (`NEBULOSITY_HOME=<checkout>`, `NEBULOSITY_WORKER=off`, `npx next start -H 127.0.0.1 -p 3100`).
- [ ] **Step 3: Run locally on Windows.** Run `code --extensionDevelopmentPath=<spike> ../vscode`, then run `spike.open`. Expected in `results.json`: the Map drew (the probe answered), the live stream connected (the probe adds `EventSource` `readyState` 1 after 2 s), `postOk` 200, `origin` starting with `vscode-webview://`, `sourceIsParent` true. Record `ancestors` verbatim, and the VS Code version from Help → About.
- [ ] **Step 4: Remote (should-have).** Package the spike (`npx @vscode/vsce package --allow-missing-repository --skip-license` in `spike/`, which has no LICENSE). Over WSL if `wsl -l` lists a distro, otherwise ask the owner to run it once over Remote SSH. Record whether the iframe loads with `asExternalUri` and, if not, whether `portMapping` (`{ webviewPort: 3100, extensionHostPort: 3100 }`) loads it. Record `postOk` and `ancestors`.
- [ ] **Step 5: Cursor (should-have).** **Ask the owner** to install the `.vsix` in Cursor and run `spike.open` once. Record the same fields and Cursor's VS Code version (Help → About).
- [ ] **Step 6: Record the results and decide.** Write "## Spike" in the ledger with the raw `results.json` of each run, and set:
  - `FRAME_ANCESTORS`: `'self'` plus each scheme seen in `ancestors` across the passing runs (expected `vscode-webview:` and `vscode-file:`). A fork whose schemes couldn't be pinned waits (design §8 step 1).
  - `REMOTE_URL_METHOD`: `asExternalUri` if it passed, else `portMapping` if it passed, else `dropped` (remote goes to a follow-up slice).
  - `ORIGIN_PREFIX`, the handshake prefix: `vscode-webview://`, or whatever the runs show.
  - `ENGINES_VSCODE_FLOOR` (P12).
  Later tasks read these four by name from the ledger's "## Spike", never from this plan.
  - **The fallback rule (design §8 step 1, owner-approved):** local desktop VS Code is the must-have. If remote or Cursor fails, it is dropped to a follow-up slice, said on the listing, with no change to ADR-039's guards. **If local VS Code fails (the Map doesn't draw, `postOk` isn't 200, or the origin can't be pinned): STOP, write it up in the ledger, and bring the design back to the owner.**
- [ ] **Step 7:** Stop the 3100 server and revert the probe in the sandbox (`git -C ../Nebulosity-v18 checkout -- app/layout.tsx`). Nothing to commit. Say so in the ledger.

---

## Part 2 — The server side

### Task 2: `GET /api/imports` (API_CONTRACTS §19)

**Files:**
- Modify: `lib/contracts.ts` (add `ImportsResponse` exactly as §19)
- Create: `lib/engine/imports-page.ts`, `app/api/imports/route.ts`
- Test: `lib/engine/imports-page.test.ts`

**Interfaces:**
- Consumes: `reach(repoRoot, targetPath, direction)` and `Direction` from `lib/engine/reach.ts`; `parseRepoPath`; `activeRepo`, `noActiveRepo`, `jsonError`, `errorJson` from `app/api/_lib/respond.ts`.
- Produces: `type ImportsQuery = { path: string; direction: Direction; transitive: boolean; limit: number; offset: number }`; `parseImportsQuery(params: URLSearchParams): ImportsQuery | { error: string }`; `cachedReach(repoRoot: string, targetPath: string, direction: Direction): ReachAnswer` (§19's "cached by index version like `describe`": `describe`'s `answerCache` pattern, `lib/engine/describe.ts:15-51`, answers per repo for one index version at a time, keyed by path and direction, at most 2,000, cleared past it; a throw is never cached; the answer is shared, so read-only); `importsPage(answer: ReachAnswer, query: ImportsQuery): ImportsResponse`; the route `GET /api/imports`, which Tasks 7 and 8 read.

- [ ] **Step 1: Write the failing tests** in `lib/engine/imports-page.test.ts`. These index `copyFixture()` with `indexRepository` (as `reach.test.ts` does) and transcribe "Ground truth" exactly:
  - `"pages the dependents of src/core/log.ts"`: `importsPage(reach(root, "src/core/log.ts", "dependents"), q({ path: "src/core/log.ts" }))` has `toEqual({ path: "src/core/log.ts", kind: "file", direction: "dependents", transitive: false, files: [{ path: "src/app/main.ts", distance: 1 }, { path: "src/core/index.ts", distance: 1 }, { path: "src/index.ts", distance: 1 }], direct: 3, total: 3, offset: 0, indexVersion: <answer.indexVersion> })`.
  - `"transitive pages: limit 2, offset 2"` → `files` `[src/index.ts 1, src/util/strings.ts 2]`, `total` 7, `direct` 3, `offset` 2. The same with `transitive: false` → `[src/index.ts 1]`, `total` 3. With `offset: 10` → `files: []`, `total` 3.
  - `"dependencies of src/app/main.ts, transitive"` → the four files in the table's order, `direct` 3, `total` 4.
  - `"a folder: dependents of src/util, transitive"` → `kind: "folder"` and the four files in the table's order, `direct` 1.
  - `"nothing imports scripts/build.js"` → `files: []`, `direct: 0`, `total: 0`.
  - `"a repeat is the cached answer"`: two `cachedReach(root, "src/core/log.ts", "dependents")` calls return the same object (`toBe`), and `cachedReach(root, "src/core/log.ts", "dependencies")` returns another one, whose `reached` is `[]` (`log.ts` imports nothing).
  - `"parseImportsQuery: the defaults"`: `parseImportsQuery(new URLSearchParams("path=src/core/log.ts"))` has `toEqual({ path: "src/core/log.ts", direction: "dependents", transitive: false, limit: 50, offset: 0 })`. `path=./src/core/log.ts` normalizes to `src/core/log.ts`. `transitive=true` gives true, and any other value gives false.
  - `"parseImportsQuery refuses"` (each has `"error" in result`): no `path`; `path=` (empty, the repo); `path=../x`; a 1,025-character path; `direction=sideways`; `limit=0`; `limit=501`; `limit=abc`; `limit=2.5`; `offset=-1`; `offset=x`. `limit=500` and `limit=1` are accepted.
- [ ] **Step 2:** Run `npx vitest run lib/engine/imports-page.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `parseImportsQuery`, `cachedReach` and `importsPage`** in `lib/engine/imports-page.ts`. `importsPage` takes `reached` (sliced to `direct` when not transitive), then the page `[offset, offset + limit)`. `total` is the length before paging. Then `app/api/imports/route.ts`, shaped like `describe/route.ts`: `export const runtime = "nodejs"`; the active repo or `noActiveRepo()`; a parse error → `jsonError(400, "BAD_REQUEST", error)`; then `cachedReach` inside `try`, with `errorJson(err)` for the engine's errors (`BadInputError` → 400 for `""`, `PathNotFoundError` → 404). An empty `path` is refused in the parser, since §19 lists it under 400.
- [ ] **Step 4:** Run `npx vitest run lib/engine/imports-page.test.ts`, then `npx tsc --noEmit`. Expected: PASS, tsc clean.
- [ ] **Step 5: Check the route by hand.** In the sandbox, checked out at this commit, run `npm run build`, then start the Map on 3101 as a read-only server (Global Constraints: `npx next start -H 127.0.0.1 -p 3101` in the sandbox, with `NEBULOSITY_HOME=<checkout>` and `NEBULOSITY_WORKER=off`). Then `curl -s "http://127.0.0.1:3101/api/imports?path=src/vs/base/common/event.ts&limit=3"` should return JSON with `total` > 0 and 3 `files`, and the same with `-H "Host: evil.example"` should return 403. Stop it.
- [ ] **Step 6: Commit and push.** Run `git add lib/contracts.ts lib/engine/imports-page.ts lib/engine/imports-page.test.ts app/api/imports/route.ts && git commit -m "feat(api): GET /api/imports, a page of a file's or folder's importers or imports (API_CONTRACTS §19)" && git push`

### Task 3: The server's version, the saved port, and `frame-ancestors`

**Files:**
- Modify: `lib/contracts.ts` (`ServerInfo`, `RepoList.server?`, `BRIDGE_VERSION = 1`, `BridgeToMap`, `BridgeFromMap` with P1's `drawn`)
- Create: `app/api/_lib/server.ts`; Modify: `app/api/repos/route.ts`
- Modify: `scripts/cli.ts`, test `scripts/cli.test.ts`
- Modify: `next.config.ts`, test `next-config.test.ts`
- Modify: `docs/API_CONTRACTS.md` §20 (P1's `drawn`, under the existing "designed, not built")

**Interfaces:**
- Produces: `type ServerInfo = { version: string; bridge: number }`; `BRIDGE_VERSION`; `serverInfo(): ServerInfo` (the version read once from `nebulosityPath("package.json")`); `GET /api/repos` → `RepoList & { server: ServerInfo }` (POST unchanged); `parseMapArgs(args: readonly string[]): { kind: "start"; port: number } | { kind: "print-port" } | null` (exported, replacing `mapPort`); `export const FRAME_ANCESTORS: string`.
- The bridge types are exactly §20 plus `| { type: "nebulosity.drawn"; path: string; page: number; selected: string | null }` in `BridgeFromMap`.

- [ ] **Step 1: Write the failing tests.**
  - `scripts/cli.test.ts`, `describe("parseMapArgs")`: `[]` → `{ kind: "start", port: 3000 }`; `["--port", "3125"]` → `{ kind: "start", port: 3125 }`; `["--print-port"]` → `{ kind: "print-port" }`; `["--port", "0"]`, `["--port", "65536"]`, `["--print-port", "x"]` and `["--port"]` → `null`.
  - `scripts/cli.test.ts`, `"map --print-port prints the saved port"`: with `NEBULOSITY_DATA` set to a temp dir holding `config.json` `{ "activeRepo": null, "port": 3125 }`, `main(["map", "--print-port"])` resolves 0 and logs exactly `3125`. With no `config.json` it logs `3000`. Follow the file's existing pattern for capturing `console.log` and for the data folder.
  - `next-config.test.ts`: `"the Map's pages may be framed only by itself and VS Code"`. `FRAME_ANCESTORS` equals the ledger's `FRAME_ANCESTORS` (the "## Spike" section), for example `"frame-ancestors 'self' vscode-webview: vscode-file:"`. `await nextConfig.headers()` toEqual `[{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: FRAME_ANCESTORS }] }]`. Under `NEBULOSITY_DEMO=1` (re-import with `vi.resetModules()` and the env set), `headers` is undefined, since `output: "export"` can't have headers.
- [ ] **Step 2:** Run `npx vitest run scripts/cli.test.ts next-config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `parseMapArgs`: `runMap` uses it, and `print-port` logs `readConfig().port` and returns 0 before the `.next/BUILD_ID` check. `USAGE` gains `nebulosity map --print-port   print the port the Map was last started on`.
  - `serverInfo()`; the repos `GET` returns `{ ...listRepos(), server: serverInfo() }`.
  - `next.config.ts`: `FRAME_ANCESTORS`, and `headers()` only in the non-demo branch.
  - The types in `contracts.ts`; the `drawn` line and one sentence in §20 ("posted when a new level is drawn, when the selection changes on the level drawn, and once after each `ready` while a level is on screen; the extension's test and benchmarks read it (V1.8 plan P1)").
- [ ] **Step 4:** Run `npx vitest run scripts/cli.test.ts next-config.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Check by hand on the sandbox.** Rebuild and start on 3101 as in Task 2. `curl -sI http://127.0.0.1:3101/` must show `content-security-policy: frame-ancestors …`. `curl -s http://127.0.0.1:3101/api/repos` must show `"server":{"version":"0.2.0","bridge":1}`. Stop it.
- [ ] **Step 6: Commit and push.** `git add lib/contracts.ts app/api/_lib/server.ts app/api/repos/route.ts scripts/cli.ts scripts/cli.test.ts next.config.ts next-config.test.ts docs/API_CONTRACTS.md`, then `git commit -m "feat(server): the server's version on GET /api/repos, nebulosity map --print-port, frame-ancestors on the Map's pages (ADR-062)"` and `git push`.

---

## Part 3 — The Map's side of the bridge

### Task 4: `embed.ts` and history that follows (pure)

**Files:**
- Create: `app/map/embed.ts`, test `app/map/embed.test.ts`
- Modify: `app/map/history.ts`, test `app/map/history.test.ts`

**Interfaces:**
- Consumes: `BridgeToMap`, `BridgeFromMap`, `BRIDGE_VERSION` (Task 3).
- Produces:
  - `isEmbedded(search: string): boolean`: true only for `embed=vscode`.
  - `parseToMap(data: unknown): BridgeToMap | null`: checks every field's type. Paths are strings of at most 1,024 characters. `highlight` keeps the first 50 paths and drops non-strings. Anything else gives null. *(As built, by the rulings on Task 4's and Task 5's reviews: the bridge checks a message's source and origin before it parses it, and `highlight`'s loop stops at 50 kept or 1,000 read, whichever comes first, since a sparse array's length can claim 2^32 − 1; §20 says so.)*
  - `type BridgeWindow = { parent: { postMessage(message: unknown, targetOrigin: string): void }; addEventListener(type: "message", fn: (e: MessageEvent) => void): void; removeEventListener(type: "message", fn: (e: MessageEvent) => void): void }`.
  - `createBridge(win: BridgeWindow, onMessage: (message: BridgeToMap) => void, onReady?: () => BridgeFromMap | null): EditorBridge`, where `EditorBridge = { post(message: BridgeFromMap): void; connected(): boolean; dispose(): void }`. Right after each `ready` it posts, the bridge calls `onReady` and posts what it returns (P1's case (c): the `drawn` of the level on screen), or nothing for null.
  - In `history.ts`: `mapUrl(folderPath, page, embedded = false)` (appends `embed=vscode` last when embedded); `historyStep(address, place, embedded = false)`; `followStep(step: "none" | "replace" | "push", mode: "push" | "replace"): "none" | "replace" | "push"` (a `"push"` under mode `"replace"` becomes `"replace"`; everything else is unchanged).

- [ ] **Step 1: Write the failing tests.**
  - `embed.test.ts`. A fake window: `parent` is an object with a `postMessage` spy, and `addEventListener` keeps the listener so the test can fire `{ source, origin, data }`.
    - `"isEmbedded"`: `"?embed=vscode"` and `"?path=src&embed=vscode"` → true; `""`, `"?embed=browser"` and `"?embed="` → false.
    - `"accepts a hello only from the parent and a vscode-webview origin, and answers ready"`. A hello `{ type: "nebulosity.hello", version: 1 }` from `parent` with origin `vscode-webview://abc` → `parent.postMessage` called once with `({ type: "nebulosity.ready", version: 1 }, "vscode-webview://abc")`, and `connected()` true. The same hello from another source, or from origin `http://localhost:3000`, or from `https://vscode-webview.evil.com`, or with `version: 2` → no post, `connected()` false.
    - `"posts nothing before the handshake"`: `post({ type: "nebulosity.open", path: "a.ts" })` before hello → no `postMessage` call.
    - `"after the hello, the on-ready drawn is posted once to the kept origin"`: with `onReady` returning `{ type: "nebulosity.drawn", path: "", page: 0, selected: null }`, a hello from the parent at `vscode-webview://abc` → `parent.postMessage` called exactly twice, first with the `ready`, then with that `drawn`, both with `"vscode-webview://abc"`. With `onReady` returning null → called once, with the `ready`. A second hello → the `ready` and the `drawn` again.
    - `"after the handshake, only that source and origin are heard"`. `follow` from the parent at the kept origin → `onMessage` called with it. The same from origin `vscode-webview://other` → not called. A malformed `{ type: "nebulosity.follow", path: 3 }` → not called.
    - `"a second hello from the parent re-handshakes"` (the webview reloaded): answered with `ready` again.
    - `"highlight keeps at most 50 paths"`: 60 paths in, 50 out.
    - `"dispose removes the listener"`.
  - `history.test.ts`, added cases:
    - `mapUrl("src/vs", 1, true)` → `"/?path=src/vs&page=2&embed=vscode"`; `mapUrl("", 0, true)` → `"/?embed=vscode"`.
    - `historyStep("/?embed=vscode", { path: "", page: 0 }, true)` → `"none"`; `historyStep("/?embed=vscode", { path: "", page: 0 })` → `"replace"`.
    - `"followStep: a follow never pushes"`: `followStep("push", "replace")` → `"replace"`; `followStep("none", "replace")` → `"none"`; `followStep("replace", "replace")` → `"replace"`; `followStep("push", "push")` → `"push"`.
    - `placeFromSearch("?path=src&embed=vscode")` → `{ path: "src", page: 0 }`.
- [ ] **Step 2:** Run `npx vitest run app/map/embed.test.ts app/map/history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. The origin check is `origin.startsWith(<the ledger's ORIGIN_PREFIX>)` (expected `vscode-webview://`) and `event.source === win.parent`. The kept origin is the `targetOrigin` of every post.
- [ ] **Step 4:** Run the same command. Expected: PASS, and the rest of `history.test.ts` unchanged.
- [ ] **Step 5: Commit and push.** `git add app/map/embed.ts app/map/embed.test.ts app/map/history.ts app/map/history.test.ts`, then `git commit -m "feat(map): the editor bridge's handshake and guards, and history that follows without pushing (API_CONTRACTS §20)"` and `git push`.

### Task 5: Wire the bridge into the Map

**Files:**
- Create: `app/map/useEditorBridge.ts`
- Modify: `app/map/MapView.tsx`, `app/map/DetailPanel.tsx`

**Interfaces:**
- Consumes: `isEmbedded`, `createBridge`, `followStep`, `mapUrl(..., embedded)`, `historyStep(..., embedded)` (Task 4).
- Produces:
  - `EMBEDDED: boolean`, read once from `window.location.search` at module load (false on the server and in the demo);
  - `useEditorBridge(onMessage: (m: BridgeToMap) => void, onReady: () => BridgeFromMap | null): { post(m: BridgeFromMap): void } | null`, null when not embedded, always calling the newest `onMessage` and `onReady` as `useLive` does;
  - `focus(target: string, options?: { history?: "push" | "replace"; quiet?: boolean })` in `MapView`;
  - `MapView`'s `focusing` state becomes `{ target: string; history: "push" | "replace"; quiet: boolean } | null` (was `string | null`), so the focus effect knows how the jump was asked for;
  - `DetailPanel`'s optional prop `onOpenInEditor?: (path: string, line?: number) => void`.

The rules this task wires, each from the design or P-calls:
- `follow` → `focus(path, { history: "replace", quiet: true })`. `show` → `focus(path, { quiet: true })`. `highlight` → `setHighlights(paths)`. `clear` → `setHighlights([])`. Every other caller of `focus` (search, the panel's links, `focus_node`) passes no options: `{ history: "push", quiet: false }`, as today.
- **The replace mode is consumed by the very next place change and by nothing later.** Keep it in a ref. The focus effect's success handler sets it from `focusing.history`, just before its `setPlace`. The place effect applies `followStep(step, ref)` and resets the ref to `"push"`. When `focus` only selects a box already drawn, the ref is never set.
- `quiet` failures set no `focusError`: the focus effect's failure handler reads `focusing.quiet`.
- The place effect passes `EMBEDDED` to `historyStep` and `mapUrl`, and so does the level effect's `replaceState` (P8).
- A **box click** on a node whose `kind` is `"file"` (in `select`, which gets only the path: look it up in `level.nodes`) posts `{ type: "nebulosity.open", path }` when embedded. Folders and portals behave as today. When embedded, a **declaration row** calls `onOpenInEditor(path, startLine)` instead of opening the viewer, and the "View source" button stays (design §4.4).
- **`drawn` (P1), embedded only, nothing before the handshake,** carries the place and `selected` read from MapView's `placeRef` and `selectedRef` when it is posted. It goes out in three cases:
  - (a) from MapView's `onDrawn`, which the canvas calls once a new level is placed (`MapCanvas.tsx:169`), after the same double frame `measureAfterPaint` uses;
  - (b) after the double frame that follows a change of `selected`, only while the level on screen is the one `onDrawn` last reported (keep its place in a ref). A selection that comes with a new level waits for (a), so `drawn` never runs ahead of the paint;
  - (c) through `useEditorBridge`'s `onReady`, right after each `ready`, when a level is on screen (null otherwise).
  A duplicate `drawn` is harmless: the extension and the tests read the newest.
- Claude's live events, pulses, `focus_node` and the activity bar are untouched.

- [ ] **Step 1: Implement** `useEditorBridge.ts` and the wiring above. No new visual element.
- [ ] **Step 2:** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: clean, lint 0 errors, every test passing.
- [ ] **Step 3: The browser Map is unchanged.** Rebuild the sandbox and start it on 3101. In the built-in browser, open `http://localhost:3101/?path=src/vs/base`. Check: no console errors; clicking a file box opens the detail panel as before; a declaration row opens the source viewer; Back works; the address bar never shows `embed`; and a `postMessage` of a well-formed `nebulosity.hello` to the page from the console gets no answer and changes nothing. Stop the server. Record this in the ledger.
- [ ] **Step 4: Commit and push.** `git add app/map/useEditorBridge.ts app/map/MapView.tsx app/map/DetailPanel.tsx`, then `git commit -m "feat(map): embedded in VS Code, the Map follows the editor, opens picked files there and reports what it drew (ADR-062)"` and `git push`.

---

## Part 4 — The extension

### Task 6: The package and its pure modules

**Files:**
- Create: `vscode-extension/package.json`, `tsconfig.json`, `esbuild.mjs`, `.vscodeignore`, `.gitignore` (`dist/`, `out/`, `node_modules/`, `.vscode-test/`, `*.vsix`)
- Create, each with a `.test.ts` beside it: `vscode-extension/src/ports.ts`, `command.ts`, `serverCheck.ts`, `repoMatch.ts`, `followGate.ts`, `dependents.ts`; and `src/layering.test.ts`
- Modify: `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs` (P11)
- Modify: `docs/ENGINEERING_DECISIONS.md` (ADR-062 amended for P3), `docs/ARCHITECTURE.md` (the extension as a client, with its one type import)

**Interfaces (Produces, all pure, no `vscode` import):**
- `ports.ts`: `DEFAULT_PORT = 3000`; `parsePrintedPort(stdout: string): number | null` (one integer 1–65535 on its own line, whitespace and a trailing `\r\n` trimmed); `choosePort(setting: number | null | undefined, printed: number | null): number`.
- `command.ts`: `type Launch = { command: string; args: string[]; shell: boolean }`.
  - `findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean): string | null`. On Windows it reads `Path` or `PATH` with `;` as separator and tries each `PATHEXT` entry (default `.COM;.EXE;.BAT;.CMD`), never the bare name (npm's extensionless sh shim sits beside the `.cmd`); elsewhere `PATH` with `:`, the bare name.
  - `nebulosityLaunch(setting: string, onPath: string | null, platform: NodeJS.Platform, exists: (p: string) => boolean): Launch | null`. A setting ending in `.mjs` or `.js` gives `{ command: "node", args: [setting], shell: platform === "win32" }`. A setting naming an executable gives it, with `shell` true for `.cmd` or `.bat` on Windows. On Windows a setting with no extension (the sh shim) is tried as `<setting>.cmd`, then `<setting>.exe`, and refused (null) when neither `exists`. An empty setting falls back to `onPath` with the same rule. Neither gives null.
  - `withArgs(launch: Launch, args: string[]): Launch`. When `shell` is true, every argument (and the command) holding a space or `&()^"` is double-quoted. It is only for `child_process.spawn` with `shell: true` (cmd.exe); a VS Code `ShellExecution` gets the unquoted `Launch` (Task 7).
- `serverCheck.ts`: `type ServerCheck = { kind: "current"; list: RepoList } | { kind: "old" } | { kind: "mismatch"; bridge: number } | { kind: "foreign" }`, and `classifyRepos(status: number, body: unknown): ServerCheck`. A 200 whose body is a `RepoList` (`active` string or null, `repos` an array of objects with string `root` and `name`) is `current` when `server.bridge === 1`, `mismatch` for another bridge number, and `old` with no `server`. Anything else, an unparseable body included, is `foreign`.
- `repoMatch.ts`:
  - `samePath(a: string, b: string, platform): boolean`: slashes normalized and trailing `/` dropped, case-insensitive on `win32` (and only there);
  - `repoFor(list: RepoList, folderFsPath: string, platform): RepoSummary | null`: the indexed repo whose root equals the folder or contains it, the longest root winning (nested repos). Among roots that are the same path by `samePath` (on Windows, a drive-letter case apart), the one equal to `list.active` wins, else the first listed (P15). A folder above every root gives null;
  - `relativeIn(root: string, fileFsPath: string, platform): string | null`: the forward-slash repo-relative path, or null outside the root (a root that is a prefix of another name, like `/a/repo` and `/a/repo2/x.ts`, is outside);
  - `uriPathOf(root: string): string`: `C:/x` → `/C:/x`, `/home/x` → `/home/x`;
  - `upperCaseDrive(fsPath: string, platform): string`: on `win32`, a leading drive letter upper-cased (git's spelling), so the root the extension indexes matches the one `git rev-parse` gives; elsewhere unchanged (P15);
  - `checkRepoPath(raw: string): string | null` (P17): `parseRepoPath`'s rule, re-implemented because the extension imports no runtime code from `lib/` (P3). Backslashes become `/`, empty and `.` segments go. Null for a NUL, a leading `/`, a drive letter, a `..` segment, more than 1,024 characters, or nothing left (the root isn't a file).
- `followGate.ts`: `FOLLOW_DEBOUNCE_MS = 150`, `ECHO_MS = 2_000`, and `class FollowGate { constructor(now: () => number); opened(path: string): void; mapShows(path: string | null): void; shouldFollow(path: string): boolean; reset(): void }` (P16). The gate keeps the path the Map was last known to show. `opened(path)` sets it, and makes `path` an echo for `ECHO_MS`. `mapShows(path)` sets it (from each `drawn`'s `selected`, and from each `show` posted). `shouldFollow(path)` is false for the echo path within `ECHO_MS`, and false for the path the Map shows; otherwise it sets the path as shown and gives true. `reset()` forgets the shown path and keeps the echo window. *(Amended by Task 8's review, 2026-10-24: the gate also has `ASKED_MS = 2_000` and `posted(path)`, which an allowed follow and every `show` call, and `opened(path, shows = path)` names what the Map shows after the pick, the target for a What depends pick. See P16.)*
- `dependents.ts`: `pickTitle(r: ImportsResponse): string` and `pickItems(r: ImportsResponse): { label: string; description: string; path: string }[]`, exactly as "Ground truth" (the QuickPick). A label is the file name; a description is the folder, the path up to the last `/`, or `""` for a file at the root.

- [ ] **Step 1: The package.** Create `package.json`:
  - name `nebulosity-vscode`, `displayName` "Nebulosity", `publisher` the owner's (the field set to `andrewl746` until the Marketplace publisher exists, noted in the ledger), version `0.3.0`, `license` MIT, `repository` `{ "type": "git", "url": "https://github.com/andrewl746/Nebulosity" }` (without it `vsce package` stops at a prompt), `icon` `media/icon.png`, `engines.vscode` set to the ledger's `ENGINES_VSCODE_FLOOR` (P12), `extensionKind: ["workspace"]`, `main: "./dist/extension.js"`;
  - `activationEvents` empty (VS Code derives `onCommand` from `contributes.commands`);
  - `contributes.commands`: the six of Global Constraints. The toggle is two commands, `nebulosity.followOn` (icon `$(pin)`, title "Nebulosity: Follow editor") and `nebulosity.followOff` (icon `$(pinned)`, same title), shown by the context key `nebulosity.following`;
  - `contributes.menus`: `editor/title` with `nebulosity.showMap` (navigation, `when: resourceScheme == file`) and the toggle pair, `nebulosity.followOn` with `when: activeWebviewPanelId == 'nebulosity.map' && !nebulosity.following` and `nebulosity.followOff` with `when: activeWebviewPanelId == 'nebulosity.map' && nebulosity.following`. Then `editor/context` and `explorer/context` with `nebulosity.showFile` and `nebulosity.whatDepends` (`when: resourceScheme == file`). And `commandPalette` with both toggle commands at `when: "false"`, so the palette doesn't list two identical "Nebulosity: Follow editor" entries (design §4.6 puts the toggle in the title bar only);
  - `contributes.configuration`: the three settings of Global Constraints;
  - scripts:
    - `build` (`node esbuild.mjs`: the extension and the relay);
    - `build:test` (`node esbuild.mjs --tests`: the integration tests, P11; its entry points arrive in Task 9);
    - `check` (`tsc --noEmit`; Task 9 adds `&& tsc -p test --noEmit`);
    - `test:integration` (`npm run build && npm run build:test && node ./out/test/runTest.js`);
    - `package` (`vsce package`).
  Install the devDependencies with exact pins: `@types/vscode` at the ledger's `ENGINES_VSCODE_FLOOR`, `esbuild`, `typescript`, `@types/node`, `@vscode/test-electron`, `mocha`, `@types/mocha`, `@vscode/vsce` and `ovsx`.
  `esbuild.mjs` builds `src/extension.ts` to `dist/extension.js` (cjs, node, `external: ["vscode"]`) and `src/webview/relay.ts` to `dist/relay.js` (iife, browser). With `--tests` it builds `test/runTest.ts`, `test/suite/index.ts`, `test/suite/*.test.ts` and `test/bench/*.test.ts` to the same paths under `out/test/` (cjs, node, `external: ["vscode", "mocha", "@vscode/test-electron"]`).
  `.vscodeignore` leaves out everything but `dist/`, `media/`, `README.md`, `LICENSE` and `package.json`.
  Root configs (P11):
  - `tsconfig.json` and `eslint.config.mjs` exclude `vscode-extension/**`;
  - `vitest.config.ts` excludes `vscode-extension/test/**`, `vscode-extension/out/**`, `vscode-extension/dist/**`, `vscode-extension/.vscode-test/**` and `vscode-extension/node_modules/**`.
- [ ] **Step 2: Write the failing tests.** Values below are exact.
  - `ports.test.ts`: `parsePrintedPort("3125\n")` → 3125; `"3125\r\n"` (Windows) → 3125; `"  3000  "` → 3000; `""`, `"abc"`, `"0"`, `"70000"` and `"3000\nmore"` → null. `choosePort(4000, 3125)` → 4000; `choosePort(null, 3125)` → 3125; `choosePort(undefined, null)` → 3000.
  - `command.test.ts` (Review Focus 3):
    - `findOnPath("nebulosity", { Path: "C:\\a;C:\\npm", PATHEXT: ".EXE;.CMD" }, "win32", p => p === "C:\\npm\\nebulosity.CMD")` → `"C:\\npm\\nebulosity.CMD"`;
    - on linux, `PATH: "/usr/bin:/home/u/.npm/bin"` with `/home/u/.npm/bin/nebulosity` existing → that path;
    - on Windows the bare name is never taken: `findOnPath("nebulosity", { Path: "C:\\npm", PATHEXT: ".EXE;.CMD" }, "win32", p => p === "C:\\npm\\nebulosity")` → null;
    - nothing found → null;
    - with `none = () => false`: `nebulosityLaunch("", "C:\\npm\\nebulosity.CMD", "win32", none)` → `{ command: "C:\\npm\\nebulosity.CMD", args: [], shell: true }`;
    - `nebulosityLaunch("C:/Users/A B/Nebulosity/bin/nebulosity.mjs", null, "win32", none)` → `{ command: "node", args: ["C:/Users/A B/Nebulosity/bin/nebulosity.mjs"], shell: true }`;
    - `nebulosityLaunch("", "/usr/local/bin/nebulosity", "darwin", none)` → `{ command: "/usr/local/bin/nebulosity", args: [], shell: false }`;
    - `nebulosityLaunch("", null, "linux", none)` → null;
    - the extensionless shim named in the setting on Windows: `nebulosityLaunch("C:\\npm\\nebulosity", null, "win32", p => p === "C:\\npm\\nebulosity.cmd")` → `{ command: "C:\\npm\\nebulosity.cmd", args: [], shell: true }`, and with `none` → null;
    - `withArgs({ command: "node", args: ["C:/Users/A B/x.mjs"], shell: true }, ["map", "--port", "3125"]).args` → `['"C:/Users/A B/x.mjs"', "map", "--port", "3125"]`;
    - a command path with a space: `withArgs({ command: "C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\nebulosity.CMD", args: [], shell: true }, ["map"]).command` → `'"C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\nebulosity.CMD"'`;
    - the same with `shell: false` leaves the space unquoted.
  - `serverCheck.test.ts` (Review Focus 5):
    - `classifyRepos(200, { active: null, repos: [], server: { version: "0.3.0", bridge: 1 } })` → `kind: "current"`;
    - no `server` → `"old"`;
    - `bridge: 2` → `{ kind: "mismatch", bridge: 2 }`;
    - `classifyRepos(200, "<html>")`, `classifyRepos(404, { error: { code: "NOT_FOUND" } })`, `classifyRepos(200, { repos: "x" })` and `classifyRepos(500, null)` → `"foreign"`.
  - `repoMatch.test.ts` (Review Focus 1), with `list.repos` roots `"C:/Users/Andrew/Programming/vscode"` and `"C:/Users/Andrew/Programming/vscode-docs"`:
    - `repoFor(list, "c:\\Users\\Andrew\\Programming\\vscode", "win32")?.root` → `"C:/Users/Andrew/Programming/vscode"`;
    - `"c:\\Users\\Andrew\\Programming\\vscode\\src"` → the same (a subfolder);
    - `"c:\\Users\\Andrew\\Programming\\vscode-docs"` → `"C:/Users/Andrew/Programming/vscode-docs"` (not a prefix match);
    - `"D:\\other"` → null;
    - a folder above every root: `"c:\\Users\\Andrew\\Programming"` → null (P15: offered "Index this repo" for itself);
    - nested repos, with roots `"/a/repo"` and `"/a/repo/packages/web"` on linux: `"/a/repo/packages/web/src"` → `"/a/repo/packages/web"` (the longest), and `"/a/repo/docs"` → `"/a/repo"`;
    - two roots a drive-letter case apart, `"C:/Users/Andrew/x"` then `"c:/Users/Andrew/x"`: with `active: "c:/Users/Andrew/x"`, `repoFor(list, "C:\\Users\\Andrew\\x", "win32")?.root` → `"c:/Users/Andrew/x"`; with `active: null` → `"C:/Users/Andrew/x"` (the first listed);
    - `relativeIn("C:/Users/Andrew/Programming/vscode", "c:\\Users\\Andrew\\Programming\\vscode\\src\\vs\\a.ts", "win32")` → `"src/vs/a.ts"`;
    - `relativeIn("/home/a/Repo", "/home/a/repo/x.ts", "linux")` → null;
    - `relativeIn("/a/repo", "/a/repo2/x.ts", "linux")` → null;
    - `relativeIn("/a/repo", "/a/repo", "linux")` → null (the root is not a file);
    - `uriPathOf("C:/x/y")` → `"/C:/x/y"`, and `uriPathOf("/home/x")` → `"/home/x"`;
    - `upperCaseDrive("c:\\Users\\Ann Lee\\mini repo", "win32")` → `"C:\\Users\\Ann Lee\\mini repo"`; `upperCaseDrive("/home/c:x", "linux")` → unchanged;
    - `checkRepoPath` (P17, Review Focus 4): `"src/app/main.ts"` → the same; `"./src//a.ts"` → `"src/a.ts"`; `"src\\a.ts"` → `"src/a.ts"`; `"../outside.ts"`, `"src/../../x"`, `"/etc/passwd"`, `"C:/x"`, `"a\u0000b"`, `""`, `"."` and a 1,025-character path → null; a 1,024-character path → itself.
  - `followGate.test.ts`, with a fake clock (P16):
    - `"a file opened from the Map doesn't echo"`: `opened("a.ts")` at t=0, then `mapShows("b.ts")` (the Map moved on); `shouldFollow("a.ts")` at t=100 → false, and at t=2,100 → true;
    - `"the path the Map already shows isn't followed"`: `mapShows("c.ts")`; `shouldFollow("c.ts")` → false; `shouldFollow("d.ts")` → true, then `shouldFollow("d.ts")` → false;
    - `"a switch back after a pick on the Map follows"`: `shouldFollow("log.ts")` at t=0 → true; `opened("main.ts")` at t=10; `shouldFollow("main.ts")` at t=200 → false; `shouldFollow("log.ts")` at t=400 → true;
    - `shouldFollow("b.ts")`, `shouldFollow("c.ts")`, `shouldFollow("b.ts")` → true, true, true;
    - `"reset forgets what the Map shows, not the echo"`: `shouldFollow("a.ts")` → true; `reset()`; `shouldFollow("a.ts")` → true. And `opened("e.ts")` at t=0, `reset()`, then `shouldFollow("e.ts")` at t=100 → false.
  - `dependents.test.ts`: transcribe the QuickPick ground truth from `ImportsResponse` literals built from the "Ground truth" tables:
    - direct gives the 3 items (labels `main.ts`, `index.ts`, `index.ts`; descriptions `src/app`, `src/core`, `src`) and "3 files import log.ts";
    - transitive gives the 7 items in the ground truth's order and "7 files import log.ts, 4 of them indirectly";
    - the dependents of `src/index.ts` with `transitive: true` (`files` `[scripts/build.js 1]`, `direct` 1, `total` 1) give the title "1 file imports index.ts";
    - an empty answer for `scripts/build.js` gives "No file imports build.js";
    - the root rule, on its own literal: a file `build.js` (no `/`) has the label `build.js` and the description `""`.
  - `layering.test.ts` (P3, P11): every `vscode-extension/src/**/*.ts` file has no import from `"@/…"`, and none from a path into `lib/` other than an `import type` whose target ends in `lib/contracts`. The pure files (every file except `extension.ts`, `http.ts`, `mapServer.ts`, `panel.ts` and `sync.ts`) have no import of `"vscode"`.
- [ ] **Step 3:** Run `npx vitest run vscode-extension`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** the six modules.
- [ ] **Step 5:** Run `npx vitest run vscode-extension && (cd vscode-extension && npm run check) && npx tsc --noEmit && npm run lint`. Expected: all pass, and root tsc and lint unchanged.
- [ ] **Step 6: The docs for P3, in this commit** (the one that adds the type import). ADR-062 gains a dated amendment: "The extension may `import type` from `lib/contracts.ts`, and nothing else from `lib/` (V1.8 plan P3): a type import is erased from the bundle, and `vscode-extension/src/layering.test.ts` enforces it." Its "HTTP only (no `lib/` import)" bullet points to it. ARCHITECTURE gains the extension as a client of the HTTP contract and the editor bridge, with that one type import.
- [ ] **Step 7: Commit and push.** `git add vscode-extension/package.json vscode-extension/package-lock.json vscode-extension/tsconfig.json vscode-extension/esbuild.mjs vscode-extension/.vscodeignore vscode-extension/.gitignore vscode-extension/src vitest.config.ts tsconfig.json eslint.config.mjs docs/ENGINEERING_DECISIONS.md docs/ARCHITECTURE.md`, then `git commit -m "feat(vscode): the extension's package and its pure parts: the port, the command, the server check, repo matching, the follow gate"` and `git push`.

### Task 7: Find or start the Map, the panel, the repo, the relay

**Files:**
- Create: `vscode-extension/src/panelHtml.ts` (pure, with test), `src/webview/relay.ts` (pure, with test), `src/http.ts`, `src/mapServer.ts`, `src/panel.ts`, `src/extension.ts`
- Create: `vscode-extension/media/icon.png` (from `app/icon.svg`, 128×128)

**Interfaces:**
- Consumes: Task 6's modules; `GET /api/repos` and `POST /api/repos` (P14: the extension never calls `/api/status`); `nebulosity map --port` and `--print-port` (Task 3); `nebulosity index <root>`.
- Produces:
  - `type PanelState = { kind: "starting" } | { kind: "map"; frameUrl: string } | { kind: "notInstalled" } | { kind: "foreign"; port: number } | { kind: "old" } | { kind: "mismatch"; bridge: number } | { kind: "notIndexed"; root: string } | { kind: "stopped" } | { kind: "failed"; message: string }`;
  - `panelHtml(state: PanelState, opts: { nonce: string; relayUri: string }): string` (P13: no `cspSource`);
  - `mapFrameUrl(external: string): string` (one `/`, then `?embed=vscode`); `frameOrigin(frameUrl: string): string`;
  - `startRelay(env: RelayEnv): void`, with `RelayEnv = { frame: { contentWindow: { postMessage(m: unknown, origin: string): void } | null; addEventListener(t: "load", f: () => void): void } | null; document: { addEventListener(t: "click", f: (e: { target: unknown }) => void): void }; window: { addEventListener(t: "message", f: (e: { source: unknown; origin: string; data: unknown }) => void): void }; vscode: { postMessage(m: unknown): void }; mapOrigin: string | null; setInterval: typeof setInterval; clearInterval: typeof clearInterval }` (`frame` and `mapOrigin` are null outside the `map` state), plus `HELLO_INTERVAL_MS = 250` and `HELLO_TIMEOUT_MS = 60_000`;
  - `type RelayCommand = "start" | "showLog" | "indexRepo"`, and `commandOf(target: unknown): RelayCommand | null`: the `data-command` of `target.closest("[data-command]")`, kept only when it is one of the three;
  - `class MapServer { constructor(output: vscode.OutputChannel); ensure(): Promise<{ port: number; check: ServerCheck } | { notInstalled: true }>; stop(): Promise<void>; readonly startedByUs: boolean }`;
  - `class MapPanel { static show(context, server: MapServer): Promise<MapPanel>; setState(s: PanelState): void; post(m: BridgeToMap): void; onMessage(fn: (m: BridgeFromMap) => void): vscode.Disposable; reload(): void; reveal(): void; dispose(): void }`, viewType `nebulosity.map`;
  - `deactivate(): Promise<void> | undefined` in `extension.ts`, returning `stop()`'s promise, so VS Code waits for the tree kill;
  - the command handlers for `nebulosity.showMap`, `nebulosity.indexRepo` and `nebulosity.stopMap`.
  - *(Amended by Task 7 and its review, 2026-10-23, deviations accepted by the controller's rulings:*
    - *`RelayEnv` gains `host`, the window the extension's messages must come from. The relay takes `{ to: "map", message }` only when `e.source === host`. On the real page `host` is `window.frameElement.ownerDocument.defaultView`, falling back to `window.parent`: in VS Code 1.143.1, `window.parent` as the page sees it isn't the window that posts (measured), so the planned `window.parent` check dropped every host message.*
    - *A pure `src/fromWebview.ts`, `readFromWebview(data)`, reads back what the relay posts with every field checked, so the extension never trusts the webview's messages unchecked.*
    - *`MapServer` has `ensure(onStart?)`, so "Starting the Map…" shows when this window starts one, plus `launch()`, `log()` and `output`, which the index command and Show log need.*
    - *`serverCheck.ts` gains `afterProbe(probe, installed, ownChildOnPort)`, the decision after the probe (P14's amendment).)*

- [ ] **Step 1: Write the failing tests.**
  - `panelHtml.test.ts`:
    - for `{ kind: "map", frameUrl: "http://localhost:3125/?embed=vscode" }` with nonce `n1`, the HTML's CSP meta is exactly `default-src 'none'; frame-src http://localhost:3125 http://127.0.0.1:3125; script-src 'nonce-n1'; style-src 'nonce-n1'` (P13);
    - a frame URL on another host, `http://127.0.0.2:5000/?embed=vscode`, gives `frame-src http://localhost:5000 http://127.0.0.1:5000 http://127.0.0.2:5000`;
    - it has one `<iframe` with that `src`, and one `<script nonce="n1" src="<relayUri>">` carrying `data-map-origin="http://localhost:3125"`;
    - every state has exactly one script, `<script nonce="n1" src="<relayUri>">`, and no inline handler (no attribute matching `/\son[a-z]+=/i`); only `map` has a `frame-src` and an `<iframe` (the others' CSP is `default-src 'none'; script-src 'nonce-n1'; style-src 'nonce-n1'`);
    - the copy:
      - `starting` contains "Starting the Map…";
      - `notInstalled` contains "Nebulosity isn't installed", `npm install -g nebulosity` and a link `href="https://github.com/andrewl746/Nebulosity#readme"` (design §4.2 step 4);
      - `old` contains "Update Nebulosity: <code>npm install -g nebulosity</code>";
      - `mismatch` with bridge 2 contains "This Map is newer than this extension: update the Nebulosity extension." and not "Update Nebulosity:" (a server on another bridge means the extension is the older side);
      - `stopped` contains "The Map stopped" and `<button data-command="start">Start</button>`;
      - `notIndexed` with root `C:/x` contains `C:/x` and a `<button data-command="indexRepo">` reading "Index this repo (free)";
      - `foreign` with 3000 contains "Port 3000 is in use by another app" and "nebulosity.port";
      - `failed` contains its message and a `<button data-command="showLog">` reading "Show log";
    - every interpolated value is HTML-escaped (a root `C:/a<b` comes out as `C:/a&lt;b`);
    - `mapFrameUrl("http://localhost:3125/")` → `"http://localhost:3125/?embed=vscode"`, `mapFrameUrl("http://localhost:41234")` → `"http://localhost:41234/?embed=vscode"`, and `frameOrigin` of the latter → `"http://localhost:41234"`.
  - `relay.test.ts`, with fake timers and fake frame, document and window (Review Focus 2):
    - after `load`, a hello `{ type: "nebulosity.hello", version: 1 }` goes to `contentWindow` with origin `mapOrigin` at 0, 250 and 500 ms. Once a `ready` from `contentWindow` at `mapOrigin` arrives, no more hellos go out, and the `ready` is relayed to `vscode.postMessage`;
    - a message from another source or origin is not relayed;
    - two `follow` messages sent to the relay (through its `window` `message` from the extension side, data `{ to: "map", message }`) before `ready` are delivered in order right after `ready`, and only the 20 newest are kept;
    - a second `load` (a reload) starts the hello loop again and holds new messages until the next `ready`;
    - with no `ready`, hellos stop at 60,000 ms, and `{ type: "relay.frameError" }` goes to `vscode.postMessage` once (P18: a failed cross-origin load fires `load`, never `error`);
    - a click whose target's `closest("[data-command]")` reads `start` posts `{ command: "start" }`; one reading `other`, or a target with no `closest`, posts nothing (`commandOf`);
    - with `frame: null` (a state without the Map), no hello goes out and clicks are still relayed.
    - *Amended by Task 7 and its review, 2026-10-23:*
      - *The hellos also start when the relay starts (P9's amendment): "says hello from the start too", with no `load` at all; "stops them 60 s after the start when no load ever fires"; "counts the 60 s again from a load, not from the start".*
      - *The extension's messages come only from `host`: another frame's message, or one from a `null` source, is neither held nor sent.*
      - *The fake timers throw "Illegal invocation" unless they are called unbound, as Chromium's do. The first build called `env.setInterval(…)`, which Node accepts and the real webview refused, so no hello ever went out.*
- [ ] **Step 2:** Run `npx vitest run vscode-extension`. Expected: FAIL.
- [ ] **Step 3: Implement**, following design §4.1–§4.3 and P2, P7, P13–P15, P18:
  - `http.ts`: `getJson(url, timeoutMs)` and `postJson(url, body, timeoutMs)` with Node's `fetch` and `AbortSignal.timeout`, to `http://127.0.0.1:<port>` (no Origin). A refused connection is its own error kind, which callers tell apart from a timeout.
  - `MapServer.ensure()`:
    - The launch is `nebulosityLaunch(setting, findOnPath("nebulosity", process.env, process.platform, fs.existsSync), process.platform, fs.existsSync)`. Null gives `{ notInstalled: true }`. When `nebulosity.command` is set but refused, the Output channel says that setting can't be run.
    - The port is `nebulosity.port` when set, with no `--print-port`. Otherwise it is `parsePrintedPort` of `--print-port`'s stdout (spawned as below, 5 s timeout), asked once per window and kept (P2), else 3000.
    - Then `GET /api/repos` with a 1 s timeout through `classifyRepos` (P14), where a refused connection means "not running".
    - If not running, it spawns `withArgs(launch, ["map", "--port", String(port)])`, `detached: process.platform !== "win32"`, `windowsHide: true`, stdout and stderr appended to the "Nebulosity" Output channel. When `shell` is true it spawns the joined line as one string, as `scripts/cli.ts`'s `runClaude` does (Node 24 warns about arguments passed with a shell). It then polls `GET /api/repos` every 500 ms up to 60 s.
    - `stop()` kills the tree, only when `startedByUs`: `taskkill /PID <pid> /T /F` on Windows, `process.kill(-pid)` elsewhere. `deactivate` returns `stop()`'s promise.
    - If the process exits early, the state is `failed`, with the Output channel's last line as the message.
    - *(Amended by Task 7's review, 2026-10-23: the probe comes before "not installed", design §4.2's order. A null launch no longer gives `{ notInstalled: true }` at once: the port is then the setting or 3000 (there's no command to ask `--print-port`), and it's probed first; whoever answers is used. Only a refused port with no launch gives `{ notInstalled: true }`. A port that's held but not answering yet, or this window's own Map, is waited on: `afterProbe`.)*
  - `MapPanel`: `createWebviewPanel("nebulosity.map", "Nebulosity Map", { viewColumn: ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] })`. *(Amended by Task 9's review, ruling 4, 2026-10-24: with nothing open, the editor area is one empty column, and VS Code puts a new panel into it whatever column is asked for, so the next file opened covers the Map. Then `vscode.setEditorLayout` makes a second column first and the panel opens in column 2, leaving column 1 for the code: syncRules' `panelColumn`.)* The frame URL is `mapFrameUrl(String(await env.asExternalUri(Uri.parse("http://localhost:" + port))))`, or `portMapping` if the ledger's `REMOTE_URL_METHOD` says so (it says `asExternalUri`: over WSL, `portMapping` didn't move the iframe). Every state's HTML loads the nonce'd `relay.js`. Its buttons carry `data-command` (`start`, `showLog`, `indexRepo`), and the relay posts `{ command }` on a click, with no inline handlers (the CSP blocks them). `start` calls `ensure()` again, `showLog` shows the Output channel, and `indexRepo` runs `nebulosity.indexRepo`.
  - **The repo step** (design §4.3, P15).
    - The folder is the active editor's workspace folder, else the first. With no folder open, the step is skipped and `list.active` is the root.
    - Then `repoFor(list, folder.uri.fsPath, process.platform)`. If it differs from `list.active`, it sends `POST /api/repos { root }` (the stored spelling), then `reload()` when the panel already shows the Map.
    - On Show Map the step runs before the panel is set to `map`, so the first frame loads the right repo. `reload()` is for a panel already showing the Map: a window focus, or an index run.
    - With no repo, the state is `notIndexed`, showing the root to index. That root is the git root (`git rev-parse --show-toplevel` in the folder, falling back to the folder itself), through `upperCaseDrive`.
  - **`nebulosity.indexRepo`** runs `nebulosity index <root>` as a `vscode.Task` in a visible terminal. It is built from the unquoted `Launch`, never from `withArgs`: `new ShellExecution(launch.command, [...launch.args, "index", root].map((value) => ({ value, quoting: ShellQuoting.Strong })))`. VS Code quotes for the user's own terminal shell (PowerShell by default on Windows), where `withArgs`' cmd.exe quotes would reach node as literal characters. Step 5's check 5 runs it on a path with a space. On `tasks.onDidEndTaskProcess` with exit 0, it runs the repo step again and reloads.
  - The window focus rule: on `window.onDidChangeWindowState({ focused: true })` with the panel open, run the repo step (P7).
  - `nebulosity.stopMap`: when `startedByUs`, `stop()` and the state `stopped`; otherwise an information message, "This Map wasn't started by this window; stop it where it was started." *(Corrected by Task 7's review, 2026-10-23: the first copy, "This Map wasn't started by VS Code; stop it where it runs.", was false in a second window, whose Map VS Code did start, in the first window.)*
  - **"The Map stopped"** (P18): the panel polls nothing. In the `map` state, any refused request from the extension sets `stopped`, the repo step on window focus included (the two-window case of design §4.2 step 5). So does the relay's `{ type: "relay.frameError" }`, an iframe `load` with no `ready` within `HELLO_TIMEOUT_MS`. In `starting`, a refused request is the poll's normal answer.
- [ ] **Step 4:** Run `npx vitest run vscode-extension && (cd vscode-extension && npm run check && npm run build)`. Expected: PASS, and `dist/extension.js` and `dist/relay.js` exist.
- [ ] **Step 5: Check by hand**, under Global Constraints' "The machine" (C1), and record each result in the ledger.
  - **Set up.**
    - The sandbox is checked out at this commit and built (`npm run build` there), so `bin/nebulosity.mjs map` serves V1.8's `.next`.
    - `<scratch>` holds the free index of `../vscode`, and the checkout's `config.json` is copied to the ledger as `config-before.json`.
    - Every launch below runs from a shell with `NEBULOSITY_DATA=<scratch>` and `NEBULOSITY_WORKER=off`, and with `NEBULOSITY_HOME` unset.
    - The VS Code is the hand-check one (Global Constraints), launched as `<VS Code> --extensionDevelopmentPath=<checkout>/vscode-extension --user-data-dir <scratch>/vscode-user --extensions-dir <scratch>/vscode-ext <folder>`.
    - The settings go in `<scratch>/vscode-user/User/settings.json`, never into a workspace: `nebulosity.command` `<sandbox>/bin/nebulosity.mjs`, `nebulosity.port` as each check says.
  1. **A running Map.** Start `node <sandbox>/bin/nebulosity.mjs map --port 3101` (its saved port goes to `<scratch>`). Then, with the port 3101 and the folder `../vscode`, run Show Map. Expected: the Map draws in a panel beside the editor, and the status pill and Claude's activity bar show.
  2. **A live event in the panel (G4).** `curl -s -X POST http://127.0.0.1:3101/api/live -H "Content-Type: application/json" -d '{"tool":"imports","paths":["src/vs/base/common/event.ts"],"action":{"type":"highlight_nodes","nodeIds":["src/vs/base/common/event.ts"]}}'` gives a 204. Record the pulse on the box holding that file, and the activity bar's new row. This scratch server isn't the owner's 3000.
  3. **The not-running path.** Stop 3101 and set the port to 3102, then run Show Map. Expected: "Starting the Map…", then the Map. Stop Map: "The Map stopped", and `netstat -ano | grep LISTENING | grep ":3102 "` prints nothing. Click Start: "Starting the Map…", then the Map.
  4. **Show log.** Point `nebulosity.command` at a `<scratch>/exit1.mjs` that only calls `process.exit(1)`, and use port 3103. Run Show Map. Expected: the `failed` state; Show log opens the "Nebulosity" Output channel. Restore the setting.
  5. **Index this repo, at a path with a space (Review Focus 3).** Copy `test/fixtures/mini-repo` to `<scratch>/mini repo`, which isn't indexed and sits outside any git repo, and open the dev host on it (port 3102). Show Map gives "Index this repo (free)" naming `<scratch>/mini repo` with an upper-case drive letter. Click it: a terminal runs `nebulosity index`, exits 0, and the panel reloads to the mini-repo's Map.
  6. **Two windows (design §4.2 step 5, P18).** With `../vscode` on port 3102, started by this window, open a second dev-host window (File → New Window) on `../vscode/src`, which matches the same repo, and run Show Map there: the same Map, not started by that window. Close the first window, which stops the Map. Focus the second: "The Map stopped". Click Start: the Map.
  7. **Nothing touched.** `cmp <checkout>/.nebulosity/config.json <ledger>/config-before.json` prints nothing, and `netstat` shows nothing left on 3101–3103.
- [ ] **Step 6: Commit and push.** `git add vscode-extension/src vscode-extension/media`, then `git commit -m "feat(vscode): Show Map: find or start the Map, match the workspace's repo, the panel and its relay"` and `git push`.

### Task 8: Two-way sync and the file commands

**Files:**
- Create: `vscode-extension/src/sync.ts`; Modify: `src/extension.ts`
- *(As built, 2026-10-23: also the pure, tested `src/syncRules.ts` (the `/api/imports` reads, the copy, the columns, `ShowHold`) and `src/messageLog.ts` (`waitFor` for the test API), two getters on `MapPanel` (`page`, `viewColumn`), and `errorText` moved into `src/http.ts`.)*

**Interfaces:**
- Consumes: `MapPanel.post`, `onMessage`, `dispose` (Task 7); `FollowGate`, `relativeIn`, `uriPathOf`, `checkRepoPath`, `pickTitle`, `pickItems` (Task 6); `GET /api/imports` (Task 2).
- Produces:
  - `NebulosityApi` returned from `activate`, for the tests only (as built, only in `ExtensionMode.Test`; otherwise `activate` returns `undefined`, so no other extension gets an API and a long session keeps no messages): `{ sent: BridgeToMap[]; received: BridgeFromMap[]; simulateFromMap(m: BridgeFromMap): Promise<void>; waitFor(pred: (m: BridgeFromMap) => boolean, timeoutMs: number): Promise<BridgeFromMap>; waitForSent(pred: (m: BridgeToMap) => boolean, timeoutMs: number): Promise<BridgeToMap>; closePanel(): void; port(): number | null }`.
    - `waitFor` and `waitForSent` resolve with the first matching message received (or sent) **after the call**, never one already in `received` or `sent`. So every test and bench calls them before the action they wait on: `const next = api.waitFor(…); await action; await next`.
    - `closePanel()` disposes the panel. It is the only way the tests and the bench close it: the panel is revealed with `preserveFocus`, so `workbench.action.closeActiveEditor` would close the text editor instead.
  - the handlers for `nebulosity.showFile`, `nebulosity.whatDepends`, `nebulosity.followOn` and `nebulosity.followOff`.

The rules (design §4.4–§4.5, P4–P6, P10, P16, P17):
- **Editor → Map:** on `window.onDidChangeActiveTextEditor`, wait `FOLLOW_DEBOUNCE_MS`. If following, the panel is open, `relativeIn(repo root, editor.document.uri.fsPath)` is not null and `gate.shouldFollow(path)`, post `follow`. *(Amended by Task 8's review, I1, 2026-10-24: only a `file:` document counts, here and in the two file commands. A `git:`, untitled or output document has an `fsPath` too, which would name a repo file that isn't the one shown (`syncRules.ts`' `isFileUri`, `repoPathOfUri`).)*
- **The gate follows the Map** (P16): every `drawn` calls `gate.mapShows(drawn.selected)`, and every `show` posted calls `gate.posted(path)`, like an allowed follow (corrected by Task 8's review, 2026-10-24: a show is an ask, so a late `drawn` from before it can't stand in for it; P16's amendment).
- **After each `ready`:** call `gate.reset()`. Then post `follow` for the active editor (if it is in the repo and the gate allows it), unless a `show` was posted since the previous `ready`. A `show` waiting in the relay's queue is delivered before the `ready` reaches the extension, and a follow after it would move the Map off the file the user asked for. *(Amended by Task 8, 2026-10-23: unless a `show` was posted to this page. The hold lasts for the page, not until the next `ready`, because a second `ready` for the same page (Task 7's warm Map can answer a boot hello and then fire `load`) would otherwise follow and move the Map off the file. A posted follow, or a new page the extension renders, lets it go: P7's reload still follows.)*
- **Map → editor:** on `open { path, line? }`, check the path with `checkRepoPath` and drop it if null (P17). Then `workspace.fs.stat` the file at `folder.uri.with({ path: uriPathOf(root) + "/" + path })` (with no folder open, `Uri.file` of the root and the path, P15). If it's missing, show "`<path>` isn't in this workspace's repo (the Map shows another one; run Show Map to switch back)", without awaiting the message, and open nothing. Otherwise call `gate.opened(path)`, then `window.showTextDocument(<that uri>, { viewColumn, preview: true, preserveFocus: true, selection: line ? new Range(line - 1, 0, line - 1, 0) : undefined })`. The `viewColumn` is the column of the most recent text editor, kept from `onDidChangeActiveTextEditor`, unless it is the panel's own column (`panel.viewColumn`); then it is the column beside the panel (design §4.4). *(Amended by Task 9's review, ruling 4, 2026-10-24: a real column, on the code's side, the one left of the panel, or column 2 for a panel in column 1 (syncRules' `openColumn`), never `ViewColumn.Beside`, which counts from the active column and gives the panel's own when the active one is left of it.)*
- **Show this file** (the resource from the context menu, else the active editor): first `GET /api/imports?path=<rel>&limit=1`, where a 404 `NOT_FOUND` shows P5's message (not awaited). Then reveal the panel (opening it through Show Map if closed) and post `show`.
- **What depends** (P6): `GET /api/imports?path=<rel>` (direct), then a QuickPick titled `pickTitle` with `pickItems` and one more item, "Show all, including indirect", that re-asks with `transitive=true&limit=500`. Post `show` for the file and `highlight` with the listed paths (the first 50). Picking an item opens it like `open`. Hiding the pick posts `clear`.
- *(Amended by Task 8 and its review, 2026-10-23/24, by the controller's rulings:*
  - *Both file commands run Show Map first, then `GET /api/imports`, then post. The port and the repo are known only once Show Map has run, and it switches the Map back to this workspace's repo if the panel's menu or another window moved it, so the 404 check asks the right repo. With the panel closed, an unindexed file opens the panel, then shows P5's message.*
  - *The What depends pick stays open after an item is picked, so several can be opened while the Map keeps them lit. An opened importer counts as an echo for 2 s, and the Map still shows the target: `opened(item, target)`.*
  - *"Show all" clears the typed filter before the new items, which the hand check found hid every row.)*
- **Follow toggle:** `setContext("nebulosity.following", value)`. It starts from `nebulosity.followEditor` and is never written back (P4).

- [ ] **Step 1: Implement** `sync.ts` and the wiring, then build. Run `cd vscode-extension && npm run check && npm run build && cd .. && npx vitest run vscode-extension`. Expected: PASS.
- [ ] **Step 2: Check by hand** in the dev host from Task 7 Step 5, on `../vscode`, under the same scratch setup (C1), with the extension's own Map on 3102:
  - switch between three files in two folders: the Map moves and selects each;
  - click a file box on the Map: the file opens beside the panel, and the Map doesn't jump; then switch back to the previous tab: the Map follows it (P16);
  - click a declaration row: the file opens at that line;
  - run What depends on `src/vs/base/common/event.ts`: the pick lists its importers, the Map highlights them, and closing the pick clears them;
  - turn the toggle off: switching files no longer moves the Map;
  - the Map showing another repo (Review Focus 4): switch the repo from the Map's own top-bar menu to the mini-repo copy of Task 7 Step 5, open `src/core` and click `log.ts` (a path `../vscode` doesn't have): the message, and nothing opens. Run Show Map: the Map switches back to `../vscode`;
  - press the mouse back button, then Alt+Left, with focus in the panel, and record what happens, for the owner (the panel has no Back control, so this is a record only).
  Record each result in the ledger, and end with Task 7 Step 5's check 7 (`cmp` and `netstat`).
- [ ] **Step 3: Commit and push.** `git add vscode-extension/src`, then `git commit -m "feat(vscode): the Map follows the editor, picks on the Map open the editor, Show this file and What depends on this file"` and `git push`.

---

## Part 5 — Proof

### Task 9: The integration test, and CI on three systems

**Files:**
- Create: `vscode-extension/test/tsconfig.json` (type-check only, `noEmit`), `test/runTest.ts`, `test/suite/index.ts`, `test/suite/extension.test.ts`
- Modify: `vscode-extension/package.json` (`check` becomes `tsc --noEmit && tsc -p test --noEmit`), `.github/workflows/ci.yml`

**Interfaces:** consumes `NebulosityApi` (Task 8), and `samePath` (Task 6) for test 1. The tests are bundled by `esbuild.mjs --tests` into `out/test/` (P11).

- [ ] **Step 1: Write the test** `test/suite/extension.test.ts` (mocha `suite`/`test`).
  - **`runTest.ts`** takes from env:
    - `NEB_TEST_WORKSPACE`: a temp copy of the mini-repo, indexed with `--no-activate`, so test 1's repo step must switch to it;
    - `NEB_TEST_COMMAND`: optional, a checkout's `bin/nebulosity.mjs`. Unset in CI, where `nebulosity` is found on PATH, the way a user's is;
    - `NEB_TEST_PORT`: 3125;
    - `NEB_TEST_VSCODE`: optional, a version;
    - `NEB_BENCH`: Task 10.
  - It writes the settings (`nebulosity.port`, and `nebulosity.command` when given) into `<a fresh temp user data dir>/User/settings.json`, never into the workspace. Then it runs `runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", <that dir>], version: process.env.NEB_TEST_VSCODE ?? "stable" })` and prints the VS Code version it ran. *(As built, by the controller's ruling on Task 9: `launchArgs` also carries four Chromium flags against throttling (`--disable-features=CalculateNativeWinOcclusion`, `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`), since a window behind others stops drawing and sends no `drawn`. runTest refuses to run without `NEBULOSITY_DATA` or on port 3000, and forces `NEBULOSITY_WORKER=off`.)*
  - **The tests**, in order, in one suite, with `NEBULOSITY_WORKER=off` in the environment. Every `waitFor` or `waitForSent` is started before the action it waits on (Task 8).
  1. `"Show Map starts the Map and draws it"`: `const drawn = api.waitFor(m => m.type === "nebulosity.drawn", 90_000)`, then `executeCommand("nebulosity.showMap")`. `await drawn` gives `path: ""` and `page: 0`: the frame loaded (which also catches an `X-Frame-Options` regression), and P1's on-ready case fired. `api.received` holds `{ type: "nebulosity.ready", version: 1 }`. And `GET http://127.0.0.1:3125/api/repos`' `active` names the copy (`samePath(active, workspace, process.platform)`): the repo step switched it, on Windows CI matching `d:\…` against `D:/…` (Review Focus 1).
  2. `"the Map follows the editor"`: `showTextDocument(<workspace>/src/core/log.ts)`, then a `drawn` with `selected` `"src/core/log.ts"` within 10 s has `path: "src/core"`. `api.sent` ends with `{ type: "nebulosity.follow", path: "src/core/log.ts" }`.
  3. `"a pick on the Map opens the file and doesn't echo, and a switch back follows"`: `simulateFromMap({ type: "nebulosity.open", path: "src/app/main.ts", line: 6 })`. Then the active editor is `src/app/main.ts`, with its selection on line index 5. Within 1 s, no `follow` for `src/app/main.ts` was sent. Then `showTextDocument(<workspace>/src/core/log.ts)`, and `api.waitForSent` gets `{ type: "nebulosity.follow", path: "src/core/log.ts" }` within 5 s (P16). The simulated pick never moved the Map, so this waits on the follow, not on a `drawn`.
  4. `"an open for a file not in this workspace opens nothing"` (Review Focus 4, P17): `simulateFromMap({ type: "nebulosity.open", path: "src/nope.ts" })` and `simulateFromMap({ type: "nebulosity.open", path: "../outside.ts" })` both resolve without throwing, and the active editor is still `src/core/log.ts`.
  5. `"What depends asks /api/imports"`: with `src/core/log.ts` active (from test 3), start `api.waitForSent(m => m.type === "nebulosity.highlight", 10_000)`. Then start `executeCommand("nebulosity.whatDepends")` without awaiting it: it may not resolve until the pick hides. The highlight's `paths` are `["src/app/main.ts", "src/core/index.ts", "src/index.ts"]`. Then start `api.waitForSent(m => m.type === "nebulosity.clear", 5_000)`, run `executeCommand("workbench.action.closeQuickOpen")`, await the clear, then await the command.
  6. `"Show this file on an unindexed file says so"`: create `src/new.ts` in the copy (the worker is off, so the index never learns of it). Start `api.waitForSent(m => m.type === "nebulosity.show", 2_000)`, then `executeCommand("nebulosity.showFile", uri)`. The wait times out: no `show` was sent (the 404 path; the message isn't awaited, so the command resolves).
  7. `"Show this file on an indexed file shows it"`: `executeCommand("nebulosity.showFile", <workspace>/src/util/strings.ts)` → a `drawn` with `selected` `"src/util/strings.ts"` and `path: "src/util"` within 10 s, and `api.sent` holds `{ type: "nebulosity.show", path: "src/util/strings.ts" }`.
  8. `"a reopened panel follows the active editor"` (Review Focus 2, P16): with `src/core/log.ts` still active, `api.closePanel()`, then `executeCommand("nebulosity.showMap")` → a `drawn` with `selected` `"src/core/log.ts"` within 30 s.
  9. `"Show this file with the panel closed isn't overridden by the follow"` (P16): with `src/core/log.ts` active, `api.closePanel()`, then `executeCommand("nebulosity.showFile", <workspace>/src/app/main.ts)` → a `drawn` with `selected` `"src/app/main.ts"` within 30 s. No `follow` appears in `api.sent` after that `show`, then or 1 s later.
  10. `"Claude's show_on_map moves the panel's Map, and the next editor switch moves it back"` (G4, design §4.4). `POST http://127.0.0.1:3125/api/live` (this test's own server, never 3000) with `{ "tool": "show_on_map", "paths": ["src/core/index.ts"], "action": { "type": "focus_node", "nodeId": "src/core/index.ts" } }` gives 204. Then a `drawn` with `selected` `"src/core/index.ts"` comes within 10 s. Then `showTextDocument(<workspace>/src/util/strings.ts)` → a `drawn` with `selected` `"src/util/strings.ts"` within 10 s.
  11. `"Stop Map stops the Map it started"`: `executeCommand("nebulosity.stopMap")`, then within 10 s `fetch("http://127.0.0.1:3125/api/repos")` rejects.
  12. `"Show Map starts it again"`: `executeCommand("nebulosity.showMap")` → a `drawn` within 90 s. This Map is left running: VS Code's exit must stop it (`deactivate`), which the step after the run checks.
  - *Amended by Task 9's review, fix round 1 (2026-10-24). There are now 13 tests.*
    - *A new test 2, "with nothing open, a file picked on the Map opens beside the panel, which stays in view" (ruling 4). The panel is in column 2. Then `open src/index.ts` from the Map opens in another column, and the panel's tab is still its column's active tab.*
    - *Files open where a user's would: `showTextDocument(uri)` in the active column, with no column chosen by the test.*
    - *Test 4's `..` arms lead to a real file: `../<copy's folder name>/src/app/main.ts` and `src/../src/app/main.ts`. So only `checkRepoPath` keeps them from opening (I3).*
    - *Test 6 first checks that `/api/imports?path=src/new.ts&limit=1` answers 404, then that `api.sent` gained no `show` by the time the command resolved, as well as the timed wait (I2).*
    - *A run that finds no test file, or registers no test, fails (I1).*
- [ ] **Step 2: Run it locally** against the sandbox's built package, under Global Constraints' "The machine" (C1).
  - **Set up.** A fresh copy of the mini-repo under `<scratch>` for each run, indexed with `NEBULOSITY_DATA=<scratch> node <sandbox>/bin/nebulosity.mjs index <copy> --no-activate`. Then, in `vscode-extension/`, with `NEB_TEST_WORKSPACE=<copy>`, `NEB_TEST_COMMAND=<sandbox>/bin/nebulosity.mjs`, `NEB_TEST_PORT=3125`, `NEBULOSITY_DATA=<scratch>` and `NEBULOSITY_HOME` unset, run `npm run test:integration`.
  - **Expected:** 12 passing (13 after Task 9's fix round 1). Ten seconds after it ends, `netstat -ano | grep LISTENING | grep ":3125 "` prints nothing.
  - **Once more** with `NEB_TEST_VSCODE` set to the version of the ledger's `ENGINES_VSCODE_FLOOR` (its caret dropped, `^1.105.0` → `1.105.0`). Expected: 12 passing, and nothing on 3125 afterwards.
  - **Record** the versions in the ledger, then the `cmp` of Task 7 Step 5's check 7.
- [ ] **Step 3: CI.** Add steps at the end of the job, after the summarize step, so the repo step's switch can't move the active repo under the worker step, which watches the arch-repo copy. All are gated `if: ${{ !cancelled() && steps.index.outcome == 'success' }}` and get `timeout-minutes: 15`:
  - `npm ci`, `npm run check` and `npm run build` in `vscode-extension`;
  - a temp copy of mini-repo: `cp -R test/fixtures/mini-repo "$SCRATCH/ext-repo"`, then `"$BIN/nebulosity" index "$SCRATCH/ext-repo" --no-activate`, then `echo "EXT_COPY=$SCRATCH/ext-repo" >> "$GITHUB_ENV"` (`$COPY` is the arch-repo copy's);
  - `npm run test:integration`, wrapped in `xvfb-run -a` on Linux. The env is `NEB_TEST_WORKSPACE="$EXT_COPY"`, `NEB_TEST_PORT=3125`, `NEBULOSITY_DATA="$SCRATCH/nebulosity-data"` and `NEBULOSITY_WORKER=off`, with `NEB_TEST_COMMAND` unset and `$BIN` put first on PATH: `export PATH="$(cygpath -u "$BIN"):$PATH"` on Windows (a `D:/…` entry would split at its colon), `export PATH="$BIN:$PATH"` elsewhere. This runs `findOnPath`, `PATHEXT`, the `.cmd` shim and `shell: true`, the path a user's install takes. If macOS or Linux fails only because VS Code replaced PATH with a login shell's, record it in the ledger and set `NEB_TEST_COMMAND="$BIN/nebulosity"` on those two systems only. Windows always uses PATH;
  - right after it, on all three systems: `sleep 10`, then `if curl -s -o /dev/null http://127.0.0.1:3125/api/repos; then echo "the Map outlived VS Code"; exit 1; fi`. This is the window-close stop (Review Focus 3), checked before the cleanup can hide it;
  - an always-run cleanup that kills anything on port 3125 (the stop steps' pattern).
  Add `vscode-extension/package-lock.json` to the setup-node cache paths (`cache-dependency-path`, both lockfiles).
- [ ] **Step 4: Run CI.** `git push origin HEAD:refs/heads/ci/v1-8` (`--force` if it exists), then `gh run watch <id> --exit-status`. Expected: the three systems green, with 12 passing on each and no "the Map outlived VS Code". That covers the Windows run (the `.cmd` shim found on PATH, the tree kill on Stop and on exit). If one system fails, fix it and re-run. A failure only Cursor or a remote would see can't show here (local only; Task 11 Step 3). *(As run, 2026-10-24, with CI capped at 3 runs for this task by the controller's ruling: run 40063846434, 12 passing on each system, then run 40066070810 after the fix round, 13 passing on each, all three green both times, `nebulosity` found on PATH, and no "the Map outlived VS Code".)*
- [ ] **Step 5: Commit and push.** `git add vscode-extension/test vscode-extension/package.json .github/workflows/ci.yml`, then `git commit -m "test(vscode): the extension against a real Map on the mini-repo, in CI on Linux, macOS and Windows"` and `git push`. Record the run id in the ledger. *(Task 9's fix round, `76c949c`, also changed `src/panel.ts`, `src/sync.ts`, `src/syncRules.ts` and this plan, for ruling 4: the panel's column, in Task 7's and Task 8's amendment notes.)*

### Task 10: Editor Benchmark #1 (E1, E2)

**Files:**
- Create: `vscode-extension/test/bench/bench.test.ts` (run only when `NEB_BENCH=1`; `runTest.ts` picks the bench suite then)
- Modify: `docs/BENCHMARKS.md`
- Modify: `vscode-extension/test/runTest.ts` and `vscode-extension/test/suite/index.ts`, for the pick: runTest names the folder in `NEB_TESTS_DIR`, and the runner loads that folder's test files. Create `vscode-extension/test/launch.ts`: VS Code's launch arguments and the user settings, which turn the built-in git extension off for the bench. *(Amended by Task 10, 2026-10-24, and its review.)*

- [ ] **Step 1: Write the bench suite.** It reuses `NebulosityApi`, and every timed wait is started before its action (`waitFor` sees only messages received after the call, so a file already followed in the first pass can't pass at once). In this order:
  - **Cold, informative:** no server on 3126, then Show Map → the first `drawn`. The extension starts the Map, and that server stays up for the rest of the run.
  - **E1** (5 runs): `api.closePanel()`, then time `executeCommand("nebulosity.showMap")` → the first `drawn` (P1's on-ready case). The server is already running and warm.
  - **E2:** pick 20 files of `../vscode`, read from `GET /api/imports`'s dependents of `src/vs/base/common/event.ts` (transitive, the first 10 inside `src/vs/base/common/` and the first 10 elsewhere, all repo-relative). Time `showTextDocument` resolved → `drawn` with `selected` that file. Run the 20 twice and report the second pass: p50, p95, max. *(Amended by Task 10, 2026-10-24: "inside" reads as directly in `src/vs/base/common`, the folder the Map draws, and "elsewhere" as any other folder. Each pass starts with an untimed switch to `event.ts`, so the ten switches inside its folder start on it.)*
  - It prints one JSON line per bar.
- [ ] **Step 2: Run it**, under Global Constraints' "The machine" (C1). This run never touches 3000, so it needs no ask (ledger, pre-flight ruling T10).
  - The env: `NEB_BENCH=1`, `NEB_TEST_WORKSPACE=../vscode`, `NEB_TEST_COMMAND=<sandbox>/bin/nebulosity.mjs`, `NEB_TEST_PORT=3126`, `NEBULOSITY_DATA=<scratch>` (holding Task 7 Step 5's free index of `../vscode`), `NEBULOSITY_WORKER=off`, and `NEBULOSITY_HOME` unset. The sandbox is checked out at HEAD and built. *(Amended by Task 10, 2026-10-24: the index is a fresh free one in a new scratch folder, and `NEB_TEST_VSCODE=1.143.1` keeps test-electron from downloading anything. `runTest.ts` refuses a git repo as the integration tests' workspace, since their test 6 writes a file. `NEB_TEST_WORKSPACE` has to be absolute: runTest resolves it against `vscode-extension/`, where `../vscode` names no folder. Task 10's review found that VS Code's built-in git extension wrote `branch.main.vscode-merge-base` into `../vscode/.git/config` in the first run; the working tree, index and HEAD were unchanged. Since then the bench's user settings turn git off, with `"git.enabled": false` and `"git.autoRepositoryDetection": false` (`test/launch.ts`). A `--disable-extension` flag can't do it: with `--disable-extensions`, VS Code ignores it for built-ins. The bench fails at its start unless git's own API says `enabled: false`.)*
  - The workspace is `../vscode` itself, opened read-only. `runTest.ts` writes the settings only into its temp user data dir, so the harness writes nothing into `../vscode` (VS Code's own git extension did once, in the draft run before run 1: the note above).
  - Keep the VS Code window in front for the whole run (a hidden webview gets no frames).
  - Afterwards: nothing listens on 3126, and the `cmp` of Task 7 Step 5's check 7 prints nothing.
- [ ] **Step 3: Record it.** Add "## 2026 10 2x Editor Benchmark #1 — the Map in VS Code: Show Map and follow (V1.8, E1–E2)" to `docs/BENCHMARKS.md`: the machine, the VS Code version, the repo at `cc3fec88`, each bar with its numbers and PASS or FAIL, and the cold numbers labelled "no bar". **If a bar fails:** profile once (the Map's `__nebulosityPerf` through the probe isn't available, so time the `level` fetch with `curl` on the same path). Fix it if the cause is in this slice's code. Otherwise record it as measured and stop for the owner.
- [ ] **Step 4: Commit and push.** `git add vscode-extension/test/bench docs/BENCHMARKS.md` (and, as amended, `vscode-extension/test/runTest.ts`, `vscode-extension/test/suite/index.ts`, `vscode-extension/test/launch.ts` and this plan), then `git commit -m "bench: Editor Benchmark #1, Show Map and follow in VS Code on VS Code's repo (V1.8)"` and `git push`.

### Task 11: Docs, version, the `.vsix`, the final review

**Files:** `docs/API_CONTRACTS.md`, `docs/ENGINEERING_DECISIONS.md`, `docs/ARCHITECTURE.md`, `README.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `CLAUDE.md`, `package.json` and `package-lock.json` (the version), `mcp/server.ts` (`SERVER_VERSION`), `scripts/cli.test.ts` (the expected version), `vscode-extension/README.md`, `vscode-extension/LICENSE`.

- [ ] **Step 1: Docs.**
  - API_CONTRACTS §15, §19 and §20: change "designed, not built" to "slice V1.8". §20 gets the ledger's `ORIGIN_PREFIX` and the `drawn` message (if not already there).
  - ADR-062 amended (dated): the spike's results (what passed, and what was dropped under the fallback rule), the `frame-ancestors` list, P1–P18 in one line each (P3's amendment is already there from Task 6), the remote modes checked in Step 3, and the bars' results.
  - ARCHITECTURE: anything beyond Task 6's entry that the build changed.
  - README: an "In VS Code" section (install the package, install the extension from the `.vsix` until it's published, run Show Map).
  - The roadmap's V1.8 row: done.
  - CLAUDE.md's current state: a "V1.8 done" bullet in the file's style.
- [ ] **Step 2: Version and package.**
  - Run `npm version 0.3.0 --no-git-tag-version` at the root (design §6). It changes `package.json` and `package-lock.json` (its lines 3 and 9).
  - Set `SERVER_VERSION = "0.3.0"` in `mcp/server.ts` (`mcp/server.test.ts:168` keeps it equal to `package.json`'s), and change `scripts/cli.test.ts:132`'s expected version to `"0.3.0"`.
  - Write the listing (`vscode-extension/README.md`). Its first line says it needs the `nebulosity` package and links the install. Then the commands and settings, then "Not yet: browser-hosted VS Code" plus anything the spike dropped. It names a remote mode only once Step 3 has checked it.
  - Copy `LICENSE`. Run `cd vscode-extension && npx vsce package`, which doesn't prompt: `repository` is set (Task 6). Expected: `nebulosity-vscode-0.3.0.vsix`, not committed (`.gitignore`). Run `npm run build` there first: the package has no `vscode:prepublish`, so `vsce package` packs whatever `dist/` holds.
  - Record its size and file list (`npx vsce ls`) in the ledger: only `dist/`, `media/`, `README.md`, `LICENSE` and `package.json`.
- [ ] **Step 3: The built extension in a remote** (G6; design §9). This step runs if the ledger's `REMOTE_URL_METHOD` isn't `dropped`. The spike ran only a throwaway extension, and over WSL a stand-in for the Map.
  - **In WSL here.** Install the `.vsix` with "Install in WSL", and install the V1.8 package there (`npm pack` in the sandbox at HEAD, then `npm install -g <tgz>` in WSL). Index a copy of the mini-repo in WSL's home. Then repeat Task 8 Step 2's first five checks there, with What depends on `src/core/log.ts`, and record each.
  - **The owner's call.** WSL has no Node, and installing Node 24 there changes the owner's distro. So without the owner's OK this check waits for Task 12, as does Remote SSH (left to the owner by the spike).
  - **The listing** names only the remote modes checked this way.
  - Mind the spike's WSL caveat: a Windows app on the same port takes the frame (ledger, Spike, "Concerns" 1).
  - *(Ruled by the controller, 2026-10-24: this step waits for the owner, as its own text allows. So the listing names no remote mode and says remote modes aren't checked yet, and Task 12 carries the WSL and Remote SSH checks.)*
- [ ] **Step 4: The gate.** Run `npx tsc --noEmit && npm run lint && npx vitest run`, plus `cd vscode-extension && npm run check`. Expected: all clean, and `cli.test.ts` and `mcp/server.test.ts` passing on 0.3.0. The vitest count is the baseline plus this slice's tests. Record it.
- [ ] **Step 5: The final review** ("2026 10 2x V1.8 Final Review #1"). Run superpowers:requesting-code-review over the slice's diff, with the five Review Focus items' tests included, and ADR-039's guards and the browser Map's unchanged behaviour as named checks. Fix Critical and Important findings in one wave, re-review, and list the deferred minors in the ledger. *(Ruled by the controller, 2026-10-24: the controller runs this review after Step 6's commit, as subagent-driven development has it, not the docs implementer. Step 6 comes first.)*
- [ ] **Step 6: Commit and push.** Stage the files above and nothing else, then `git commit -m "docs: V1.8 In your editor built: contracts, ADR-062 amended, architecture, README, roadmap; package 0.3.0"` and `git push`. *(As ruled, 2026-10-24: the commit also takes this plan, brought in line with the rulings, and the deferred doc minors' files, `docs/BENCHMARKS.md` and `scripts/cli.ts`.)*

### Task 12: The owner's look. STOP

- [ ] **Step 1:** Hand the owner the `.vsix` path and these steps (design §8 step 7):
  0. **Get a V1.8 Map** (with the owner's OK). Otherwise the extension, finding no `nebulosity` on PATH, falls back to 3000. The pre-V1.8 Map from the checkout answers there with no `server`, and the panel says "Update Nebulosity", for a package that isn't published. So first stop the Map on 3000, then pick one:
     - **(a) Install the V1.8 package:** `npm pack` in the sandbox at HEAD, then `npm install -g <tgz>`. Its data goes to `%LOCALAPPDATA%\Nebulosity`, so the first Show Map offers "Index this repo (free)" for `../vscode`: about a minute, free.
     - **(b) Point at the sandbox:** set `nebulosity.command` to `<sandbox>/bin/nebulosity.mjs`, with `NEBULOSITY_DATA` pointing at Task 7 Step 5's `<scratch>` index (C1).
     Either way, keep the port 3000. The owner's registered MCP server posts live events to the checkout's `config.json` port, which is 3000, so the panel's Map gets Claude's activity.
     VS Code first restarts into its pending update (ledger, Spike: `code` can't open a window until then).
  1. Install it: `code --install-extension vscode-extension/nebulosity-vscode-0.3.0.vsix`.
  2. Open VS Code on `../vscode` and run "Nebulosity: Show Map".
  3. Start Claude Code in VS Code's terminal and ask it a dependency question.
  4. Watch the pulses, `show_on_map`, and the Map following the editor.
  5. Click a box: it opens beside the panel.
  6. With focus in the Map, try Ctrl+P and Ctrl+W, and say whether they reach VS Code. Keys typed in a nested cross-origin iframe may not. This is a check only, not a feature.
  7. If Task 11 Step 3 waited for the owner: the remote check (WSL with Node 24, and Remote SSH if they use it).
- [ ] **Step 2:** Record the owner's words verbatim in the ledger. Fix what they ask for (each fix its own commit and push). The ship list waits on their "looks good" (ADR-062). Opening the PR `pivot/v1 → main` is their call: ask.

---

## After V1.8

E4 (its own design session): tree-sitter adapters in waves, Python, then Go, Java, C# and Rust. Then the ship list: deploy the demo, make the repo public, `npm publish` 0.3.0, then, before `vsce publish` and `ovsx publish` (the owner's publisher and namespace), install the final `.vsix` in Cursor once and run Task 8 Step 2's checks there (design §9: "tested by hand once before publish"; the spike ran only a throwaway). Then the publishes, the video and the listing's short GIF of Claude pulsing the Map (design §6), and the README links. Remote modes or Cursor, if Task 1 dropped them or Task 11 Step 3 couldn't check them, get a follow-up slice.

## Self-review (done while writing; the executor can skip this)

- **Spec coverage.** G1 → Tasks 7 and 9.1. G2 → Tasks 5, 8, 9.2, 9.3 and 9.8. G3 → Tasks 5, 8, 9.3 and 9.4. G4 → unchanged code, plus Task 7 Step 5's live post, Task 9.10 (`show_on_map`, then the editor moves it back) and Task 12. G5 → Tasks 8, 9.5, 9.6, 9.7 and 9.9. G6 → Task 1 (remote), Task 9 (three systems) and Task 11 Step 3 (the built extension in a remote). G7 → Task 11's `.vsix`, and Cursor before publish in "After V1.8" (publishing is the owner's, at ship). §4.2's stop rule → Tasks 7 (P18, two windows by hand), 9.11, 9.12 and CI's "the Map outlived VS Code". §4.2's first-run screens → Task 7's `panelHtml.test`, `relay.test` and Step 5's button clicks. §4.3's not-indexed flow → Task 7 Step 5's index run at a path with a space. §4.3's two windows → Task 7 (P7). §6's version check → Tasks 3, 6 and 7, and 0.3.0 in Task 11 with its tests. §9's clickjacking → Task 3. The design §8 order → Parts 1–5, the spike first, with its fallback rule in Task 1 Step 6.
- **Types.** `ImportsResponse` (Task 2) is used by Tasks 6 and 8; `cachedReach` (Task 2) by its route. `BridgeToMap`/`BridgeFromMap` with `drawn` (Task 3) are used by Tasks 4, 5, 7, 8 and 9. `createBridge`'s `onReady` (Task 4) is used by Task 5's `useEditorBridge`. `followStep` (Task 4) is used by Task 5. `FollowGate` (with `mapShows` and `reset`), `relativeIn`, `uriPathOf` and `checkRepoPath` (Task 6) are used by Task 8; `upperCaseDrive` and `repoFor` by Task 7; `samePath` by Task 9.1. `nebulosityLaunch`'s fourth argument (`exists`) is passed in Task 7. `PanelState`, `panelHtml` (no `cspSource`), `startRelay` (a nullable `frame`, `document`) and `commandOf` (Task 7). `MapPanel.dispose` (Task 7) is used by Task 8's `closePanel`. `NebulosityApi` (Task 8, with `waitForSent` and `closePanel`) is used by Tasks 9 and 10.
- **Ground truth** was derived by hand from the fixture's files and checked against `reach.test.ts`' existing counts: log.ts dependents direct 3 and 7 reached; `src/app` dependencies direct 2. Plan Review #1 re-derived it, which corrected `src/index.ts`'s QuickPick description to `src` and added `src/index.ts`'s dependents (1 file, none indirect) for the title rule.
- **Review Focus:** each line names its test and task.
