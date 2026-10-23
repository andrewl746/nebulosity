# V1.8 In your editor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** **approved by the owner, 2026-10-23**, in the planning session, while the plan was being written: "u can go ahead and implement the plan once its done. im gonna go afk for a while. switch to xhigh effort when implementing". The build runs in the same session, under the owner's delegation while they are away. Calls made for them are listed in the ledger's `overnight-decisions.md`. The plan's stops that need the owner's hands (Task 1 Steps 4–5 over Remote SSH and in Cursor, Task 12) wait for them.

**Goal:** A VS Code extension, `vscode-extension/`, that shows the running Map in an editor panel beside the code, starts the Map if none is running, keeps the Map and the editor in step both ways, and keeps Claude Code's live activity visible in the panel, published to the Marketplace and Open VSX by the owner at ship.

**Architecture:** The extension is another HTTP client of the Map, like the MCP server. Its panel is a webview holding a full-size iframe of `http://localhost:<port>/?embed=vscode` (through `vscode.env.asExternalUri`), so the Map's own requests carry the Map's own Host and Origin and ADR-039's guards pass unchanged. A `postMessage` bridge (API_CONTRACTS §20) carries the editor ↔ Map sync, relayed by the webview's script. It touches only the one panel, never the live channel. The server side gains one read route (`GET /api/imports`, §19), an optional `server` field on `GET /api/repos` (§15), `nebulosity map --print-port`, and a `frame-ancestors` header on the Map's pages.

**Tech Stack:** TypeScript 5, Node 24, Next.js 16.4.3 and React 19 (the Map, unchanged in the browser), Vitest 4. The extension uses the VS Code extension API (`@types/vscode`, the floor set by Task 1) and esbuild for the bundle, with `@vscode/test-electron` and mocha for the integration test and `@vscode/vsce` and `ovsx` for packaging. All are devDependencies of `vscode-extension/` only, exact versions pinned at install and recorded in the ledger. The extension has no runtime dependency.

**Spec:** `.superpowers/sdd/2026-10-23-vscode-extension/design.md`, approved by the owner 2026-10-23 "as written, including the designer's calls". Also ADR-062 (`docs/ENGINEERING_DECISIONS.md`); `docs/API_CONTRACTS.md` §15 (`server`), §19 (`GET /api/imports`), §20 (the editor bridge); ADR-038, ADR-039 (and amendments), ADR-049, ADR-058; `proxy.ts`, `lib/live/local.ts`, `app/map/useLive.ts`, `app/map/history.ts`, `scripts/cli.ts`.

**Ledger:** `.superpowers/sdd/2026-10-23-vscode-extension/progress.md` (gitignored; the owner keeps ledgers). Every commit, ruling and stop goes there.

---

## What the code and the machine have today (checked 2026-10-23, planning)

- **Branch.** `pivot/v1` at `78e9e00`, pushed. `main` is at `8645751` (PR #9). `pivot/v1` is ahead by `bea486d` (next 16.4.3) and docs commits. Uncommitted: `docs/LEARNING_NOTES.md` (modified) and `lib/agent/state.ts` (untracked), both the owner's, never staged.
- **The gate.** Vitest **1,494/1,494** in 137 files (18.2 s, run at planning). tsc and lint as of `7e1d5af`: clean, 0 errors.
- **The machine.** Port 3000 is **listening** (PID 32540, an earlier session's Map). Ask before stopping it, and never build in the checkout while it may be `next start` (memory: builds in the sandbox worktree). The sandbox worktree `../Nebulosity-build` exists, detached at `bea486d`. `../vscode` is at `cc3fec88`, indexed.
- **The engine.** `reach(repoRoot, targetPath, direction, { within? })` (`lib/engine/reach.ts`) returns `ReachAnswer = { path, kind, direction, reached: { path, distance }[], direct, indexVersion }`. `reached` is every file reached, ordered by distance, then in-degree (most imported first), then path. It throws `BadInputError` for the repo root (`""`) and `PathNotFoundError` for an unindexed path. Its compressed index is cached per index version (`importIndexFor`). This is the cache §19 refers to, so the route adds none. Routes map engine errors with `errorJson` (`app/api/_lib/respond.ts`). Paths are checked with `parseRepoPath` (`lib/index/paths.ts`). Routes have no tests of their own: their logic lives in `lib/` and is tested there.
- **`GET /api/repos`** returns `listRepos()` (`lib/engine/repos.ts`). Roots are stored as `repoKey(path.resolve(root))`, which is **forward slashes with the drive letter as `path.resolve` spells it** (`C:/Users/Andrew/Programming/vscode`). VS Code's `Uri.fsPath` gives `c:\Users\…` (lower-case drive, backslashes). The extension must match the two (Review Focus 1).
- **The Map's history** (`app/map/history.ts`): `mapUrl(path, page)`, `placeFromSearch(search)`, and `historyStep(address, place)`, which returns `"none" | "replace" | "push"`. `MapView.tsx` applies it in one effect on `place`. `focus(target)` either selects a box already drawn or sets `focusing`, whose effect fetches the level with `focus` and sets the place. A failed jump sets `focusError` (shown for a few seconds). `select(target)` is the canvas's box click (`MapCanvas` `onNodeClick` → `onSelect(node.id)`). The detail panel's declaration rows call `onViewLines(start, end)`, which opens the source viewer. `onLive` runs `highlight_nodes` → `setHighlights`, `clear_highlights`, `focus_node` → `focus`. Timings: `markStart` / `measureAfterPaint` (`app/map/perf.ts`, double `requestAnimationFrame`).
- **No frame headers.** `next.config.ts` sets no `headers()`, so any page can frame the Map (design §9).
- **The CLI** (`scripts/cli.ts`): `nebulosity map [--port <n>]` saves the port in the data folder's `config.json` (`readConfig().port`, `DEFAULT_PORT = 3000`) and runs `next start -H 127.0.0.1 -p <port>`. Nothing prints the saved port.
- **Configs.** The root `tsconfig.json` includes `**/*.ts` and excludes `node_modules` and `test/fixtures`. `vitest.config.ts` excludes `test/fixtures/**`. `eslint.config.mjs` ignores `.next`, `out`, `build`, fixtures, `.superpowers`, `.nebulosity`. The package's `files` is an allow-list, so `vscode-extension/` is left out of it already.
- **CI** (`.github/workflows/ci.yml`): Linux, macOS and Windows, run only on a push to `ci/**` (or by hand once on `main`). Each runs the gate, `npm run build:package`, packs and installs into a scratch prefix, indexes the fixtures, and starts the installed Map on 3123/3124.
- **The fixture.** `test/fixtures/mini-repo`: 8 source files. Its import edges and the answers below are hand-derived in "Ground truth".

---

## Decisions

### Settled by the owner in design (2026-10-23)

The design was approved as written, including every "(my call)". This plan does not reopen any of them: the iframe and `asExternalUri`, `retainContextWhenHidden`, the extension starts the Map, no auto-install, the stop rule, the repo match and "last focused window wins", the bridge and its following rules, the "Follow editor" toggle in the title bar, `GET /api/imports` and its QuickPick with "Show all, including indirect", `onCommand` activation, the `server` field and package 0.3.0, Open VSX, the spike-first order and its fallback rule, and the two benchmark bars "to be confirmed in the plan".

### The plan's own calls (P1–P12), for the owner to veto while reading

Each one fills a gap the design leaves open or names as "left to the builder". If one is wrong, here is what it costs.

| # | Call | Why | If wrong |
|---|---|---|---|
| P1 | **One more Map → editor message, `{ type: "nebulosity.drawn"; path: string; page: number; selected: string \| null }`**, posted after the paint that shows a new level or a changed selection (embedded and after the handshake only). §20 is amended in Task 3's commit. | Without it nothing outside the iframe can tell the Map drew: the integration test couldn't catch a future `X-Frame-Options` (design §9), the benchmarks couldn't be measured, and the panel couldn't drop "Starting the Map…" at the right moment. | A message nobody uses: remove it and the benchmarks lose their clock. |
| P2 | **The saved port comes from `nebulosity map --print-port`** (prints `readConfig().port`, exits 0, needs no build). Order: the `nebulosity.port` setting, else `--print-port`, else 3000. | It follows the data-folder rule (`NEBULOSITY_DATA`, the user data dir) in one place, and the extension never reads `config.json` (the design's open item). | About 0.5 s at first use (tsx boot), once per window. |
| P3 | **The extension may `import type` from `lib/contracts.ts` and nothing else from `lib/`.** A layering test enforces it. | CLAUDE.md: contracts.ts is the one source of shared shapes, and a type import is erased from the bundle, so no runtime coupling. | Hand-copied types that drift from §15/§19/§20 unseen. |
| P4 | **The toggle is per window.** `nebulosity.followEditor` sets where each window starts; the title-bar toggle changes only that window and never writes settings. | A toolbar click that silently edits `settings.json` would surprise people. | People who want it off everywhere set the setting once. |
| P5 | **Unknown paths stay quiet on the Map** (`follow` and `show` never show the jump-failed note). "Show this file on the Map" first asks `GET /api/imports?path=<file>&limit=1`, and a `404 NOT_FOUND` becomes a VS Code message: "`<file>` isn't in Nebulosity's index (new, ignored, or not a source file)." | §20 says such paths are ignored. The deliberate command still deserves an answer. | One cheap request per command. |
| P6 | **`nebulosity.clear` is sent when the "What depends" QuickPick closes**, however it closes. | The highlights belong to the pick, and §20 defines `clear` without saying when it's sent. | Highlights would vanish while someone still wanted them, until they ran the command again. |
| P7 | **After the extension switches the active repo** (panel open, window focus), it reloads the iframe and follows the active editor after the new handshake. | The Map's level cache, place and selection belong to the old repo, and a fresh load is the one state that's sure to be right. | A one-second blink on a window switch between two repos. |
| P8 | **The address bar keeps `embed=vscode`** (`mapUrl(..., embedded)` appends it), so a reload inside the panel (a crash, a server restart, Next's own reload) stays embedded. | Otherwise the first `historyStep` rewrite drops the flag, and a reload loses the bridge. | None visible: the browser Map never has the flag. |
| P9 | **The relay re-sends `hello` every 250 ms until `ready`, for up to 60 s, starting again on every iframe `load`.** Messages from the extension wait (in order, at most 20) until `ready`. | The iframe's `load` fires before React has mounted the Map's listener, so a single hello is lost. | Without it, a panel that sometimes never syncs. |
| P10 | **Only a file box click and a declaration row open the editor.** Search picks, panel links, `focus_node` and `follow` never do. | This is the design's wording (§4.4). It keeps "the Map fighting the user" out, and stops echoes at the source. | People who expect a search pick to open the file click its box once more. |
| P11 | **Tests:** the root `vitest` also collects `vscode-extension/src/**/*.test.ts`. Those cover the pure modules, which never import `vscode`, and a test enforces that. The root `tsc` and `eslint` skip `vscode-extension/`, which has its own `tsc --noEmit`. The integration test is mocha under `@vscode/test-electron`, in `vscode-extension/test/`, which the root vitest excludes along with `.vscode-test/` and `node_modules/`. | One gate for the logic. Nothing in the root depends on the extension's node_modules. | A second `npm ci` in CI either way. |
| P12 | **The floor for `engines.vscode`** is the lower of two minor versions: the VS Code the spike runs, and the VS Code version Cursor reports in its About box. Task 1 records both. The integration test runs on VS Code stable, and the version it downloads is printed and recorded. | Cursor tracks an older VS Code, and a floor above it would block the Open VSX install. | Too high blocks forks. Too low lets an API we use be missing (caught by the floor's own run in Task 9). |

### The benchmark bars (design §8 step 6, confirmed here)

Measured by the integration harness in bench mode on `../vscode` (Task 10), from the extension host's side, with the panel visible (a hidden webview gets no animation frames, so `drawn` never comes).

| Bar | Measured | Pass |
|---|---|---|
| **E1: Show Map** | `nebulosity.showMap` executed (panel closed, the Map server already running and warm) → the first `nebulosity.drawn` | worst of 5 ≤ **2,000 ms** |
| **E2: follow** | `window.showTextDocument(file)` resolved → a `nebulosity.drawn` whose `selected` is that file, the 150 ms debounce included | p95 of 20 switches ≤ **500 ms** warm: 10 switches inside the drawn folder and 10 to other folders, run twice, the second pass measured |

Informative, no bar: a cold start (no server, the extension starts it), and the same 20 switches cold.

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
- **The machine:** never stop or build under port 3000 without asking. Measuring servers run from `../Nebulosity-build` with `NEBULOSITY_HOME=<checkout>`, `NEBULOSITY_WORKER=off`, on 3100–3199. Never send a live event (`npm run live`, an MCP server with live on) while the owner may have a Map open; `NEBULOSITY_LIVE=off` for any MCP use. Write files holding backslash escapes with Write/Edit, never a Bash heredoc. Never `python -`.
- **Git:** `pivot/v1` only, no branch switch. Commit and push after every step. Conventional prefixes. **No `Co-Authored-By` or any Claude attribution.** Stage only the step's files. Never stage `docs/LEARNING_NOTES.md` or `lib/agent/state.ts`.
- **Publishing is the owner's, at ship** (after E4 and `npm publish`). This slice builds a `.vsix` and publishes nothing.

## Review Focus

The five inputs most likely to hurt someone using this, which the design implies but its own steps don't exercise, most likely first. Each has its test in the task named.

1. **Windows path spellings.** VS Code gives `c:\Users\Andrew\Programming\vscode\src\a.ts`, while the index stores `C:/Users/Andrew/Programming/vscode`. The repo must match, the relative path must be `src/a.ts`, and on Linux `/home/a/Repo` and `/home/a/repo` must stay different. (Task 6, `repoMatch.test.ts`.)
2. **The handshake racing React.** A hello sent at iframe `load` arrives before the Map listens. A slow first load (cold `next start`), a Map restart or an in-panel reload must still end in `ready`, and a follow sent meanwhile must still land. (Task 7, `relay.test.ts`; Task 4, `embed.test.ts`; P8, P9.)
3. **Starting `nebulosity` on Windows.** It's a `.cmd` shim, so it needs a shell, quoted arguments (a data folder or checkout path with spaces) and a process-tree kill on Stop and on window close. A checkout's `bin/nebulosity.mjs` runs with `node` from PATH, never the extension host's own `process.execPath` (Electron). (Task 6, `command.test.ts`; Task 7's stop, checked in Task 9 on Windows CI.)
4. **Back after following.** Switching tabs ten times, then clicking a folder, then pressing Back must return to where the Map was before the click: not through ten tab switches, and not to a stale place. A follow that lands on a box already drawn must not leave a "replace" waiting for the next real move. (Task 4, `history.test.ts` `followStep`; Task 5's wiring rule.)
5. **Something else on the port, or an older Nebulosity.** Another dev server on 3000 answers `/api/repos` with HTML or a 404. A V1.7 Map answers a `RepoList` without `server`. Each needs its own message, never a blank panel, and never an iframe of the other app. (Task 6, `serverCheck.test.ts`; Task 7's panel states.)

---

## File map

**Server and Map (the root package):**
- Create `lib/engine/imports-page.ts`: parses `/api/imports`' query and pages a `ReachAnswer` into an `ImportsResponse`. Test `lib/engine/imports-page.test.ts`.
- Create `app/api/imports/route.ts`: the thin `GET`.
- Create `app/api/_lib/server.ts`: `serverInfo()`. Modify `app/api/repos/route.ts` (`GET` adds `server`).
- Modify `lib/contracts.ts`: `ImportsResponse`, `ServerInfo`, `RepoList.server?`, `BRIDGE_VERSION`, `BridgeToMap`, `BridgeFromMap`.
- Modify `scripts/cli.ts`: `map --print-port`. Test `scripts/cli.test.ts`.
- Modify `next.config.ts`: `FRAME_ANCESTORS` and `headers()` (the app build only). Test `next-config.test.ts` (root, beside `proxy.test.ts`).
- Create `app/map/embed.ts`: the Map's side of the bridge, pure. Test `app/map/embed.test.ts`.
- Create `app/map/useEditorBridge.ts`: the hook.
- Modify `app/map/history.ts` (`embedded` and `followStep`), with `app/map/history.test.ts`. Modify `app/map/MapView.tsx` and `app/map/DetailPanel.tsx` (wiring).
- Modify `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs` (P11), and `.github/workflows/ci.yml` (Task 9).

**The extension (`vscode-extension/`, its own package):**
- `package.json` (manifest: commands, menus, settings, `extensionKind: ["workspace"]`, `activationEvents` on commands), `package-lock.json`, `tsconfig.json`, `esbuild.mjs`, `.vscodeignore`, `README.md` (the listing), `LICENSE` (MIT, a copy), `media/icon.png`.
- `src/` pure (no `vscode` import; tested by the root vitest): `ports.ts`, `command.ts`, `serverCheck.ts`, `repoMatch.ts`, `followGate.ts`, `panelHtml.ts`, `dependents.ts`, `webview/relay.ts`, with `*.test.ts` beside each, and `layering.test.ts`.
- `src/` host (imports `vscode`): `extension.ts` (activate and deactivate, the test API), `http.ts`, `mapServer.ts`, `panel.ts`, `sync.ts`.
- `test/` integration: `runTest.ts`, `suite/index.ts`, `suite/extension.test.ts`, and `bench/bench.test.ts` (Task 10).

**Docs:** `docs/API_CONTRACTS.md` §15, §19, §20; `docs/ENGINEERING_DECISIONS.md` (ADR-062 amended); `docs/ARCHITECTURE.md` (the extension as a client); `docs/BENCHMARKS.md` (Editor Benchmark #1); `README.md` (an "In VS Code" section); `docs/IMPLEMENTATION_ROADMAP.md` (the V1.8 row); `CLAUDE.md` (the state).

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

**Pages** (dependents of `src/core/log.ts`):
- `transitive=false` (the default): `files` = the 3 at distance 1, `total` 3, `direct` 3.
- `transitive=true&limit=2&offset=2`: `files` = `src/index.ts` 1, `src/util/strings.ts` 2; `total` 7, `direct` 3, `offset` 2.
- `transitive=false&limit=2&offset=2`: `files` = `src/index.ts` 1; `total` 3.
- `offset=10`: `files` = [], `total` 3. A page past the end is empty, not an error.

**The QuickPick for `src/core/log.ts`** (direct): its title is "3 files import log.ts". The items, in order, have labels `main.ts`, `index.ts`, `index.ts`, with descriptions `src/app`, `src/core` and `""` (the root's file shows no folder). "Show all, including indirect" re-asks with `transitive=true` and lists 7 items, the title then reading "7 files import log.ts, 4 of them indirectly". For `scripts/build.js` the title is "No file imports build.js".

---

## Part 0 — Start

### Task 0: Baseline and the ledger

**Files:** `.superpowers/sdd/2026-10-23-vscode-extension/progress.md` (ledger, not committed).

- [ ] **Step 1:** Check the branch and the tree. Run `git status --short` and `git log --oneline -1`. Expected: `pivot/v1`, only `docs/LEARNING_NOTES.md` and `lib/agent/state.ts` dirty, HEAD at or after this plan's approval commit.
- [ ] **Step 2:** Run the gate. Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: tsc clean, lint 0 errors, vitest 1,494/1,494 (or the count at approval). Record it in the ledger under "## Execution".
- [ ] **Step 3:** Check port 3000 (`netstat -ano | grep LISTENING | grep ":3000 "`) and the process's command line, and record what serves it. Update the sandbox: `git -C ../Nebulosity-build checkout --detach -f <HEAD>`, then `npm ci` and `npm run build` there.

---

## Part 1 — The spike (half a day, throwaway). STOP if local VS Code fails

### Task 1: The spike, recorded before any other task

The spike decides four values the rest of the plan reads: the ancestor list for `frame-ancestors`, `asExternalUri` against `portMapping`, the handshake origin's prefix, and the `engines.vscode` floor (P12).

**Files:** `.superpowers/sdd/2026-10-23-vscode-extension/spike/` only, which is gitignored and never committed. Name no file `*.test.ts` there: vitest collects ledger tests.

- [ ] **Step 1: A bare extension.** `spike/package.json` (one command `spike.open`), `spike/extension.js` and `spike/relay.js`. The command opens a `WebviewPanel` (`enableScripts`, `retainContextWhenHidden`) whose iframe is `asExternalUri(http://localhost:3100)` + `/?embed=vscode`. The CSP is the one in design §4.1, with `frame-src` set to the external URI's origin. The relay posts `{ type: "spike.hello" }` to the iframe every 250 ms and writes every message it gets back to `spike/results.json` through the extension host.
- [ ] **Step 2: A probe page in the Map.** In the sandbox only, never committed: a temporary script in `app/layout.tsx` that, when `?embed=vscode` is present, answers `spike.hello` with `{ origin: event.origin, sourceIsParent: event.source === window.parent, ancestors: [...location.ancestorOrigins], postOk }`. Here `postOk` is the status of `POST /api/repos { root: <the active root> }` from inside the iframe. Build the sandbox and start it on 3100 (`NEBULOSITY_HOME=<checkout>`, `NEBULOSITY_WORKER=off`, `npx next start -H 127.0.0.1 -p 3100`).
- [ ] **Step 3: Run locally on Windows.** Run `code --extensionDevelopmentPath=<spike> ../vscode`, then run `spike.open`. Expected in `results.json`: the Map drew (the probe answered), the live stream connected (the probe adds `EventSource` `readyState` 1 after 2 s), `postOk` 200, `origin` starting with `vscode-webview://`, `sourceIsParent` true. Record `ancestors` verbatim, and the VS Code version from Help → About.
- [ ] **Step 4: Remote (should-have).** Package the spike (`npx @vscode/vsce package --allow-missing-repository` in `spike/`). Over WSL if `wsl -l` lists a distro, otherwise ask the owner to run it once over Remote SSH. Record whether the iframe loads with `asExternalUri` and, if not, whether `portMapping` (`{ webviewPort: 3100, extensionHostPort: 3100 }`) loads it. Record `postOk` and `ancestors`.
- [ ] **Step 5: Cursor (should-have).** **Ask the owner** to install the `.vsix` in Cursor and run `spike.open` once. Record the same fields and Cursor's VS Code version (Help → About).
- [ ] **Step 6: Record the results and decide.** Write "## Spike" in the ledger with the raw `results.json` of each run, and set:
  - `FRAME_ANCESTORS`: `'self'` plus each scheme seen in `ancestors` across the passing runs (expected `vscode-webview:` and `vscode-file:`). A fork whose schemes couldn't be pinned waits (design §8 step 1).
  - the remote URL method: `asExternalUri` if it passed, else `portMapping` if it passed, else remote is dropped to a follow-up slice.
  - the handshake prefix: `vscode-webview://`, or whatever the runs show.
  - the `engines.vscode` floor (P12).
  - **The fallback rule (design §8 step 1, owner-approved):** local desktop VS Code is the must-have. If remote or Cursor fails, it is dropped to a follow-up slice, said on the listing, with no change to ADR-039's guards. **If local VS Code fails (the Map doesn't draw, `postOk` isn't 200, or the origin can't be pinned): STOP, write it up in the ledger, and bring the design back to the owner.**
- [ ] **Step 7:** Stop the 3100 server and revert the probe in the sandbox (`git -C ../Nebulosity-build checkout -- app/layout.tsx`). Nothing to commit. Say so in the ledger.

---

## Part 2 — The server side

### Task 2: `GET /api/imports` (API_CONTRACTS §19)

**Files:**
- Modify: `lib/contracts.ts` (add `ImportsResponse` exactly as §19)
- Create: `lib/engine/imports-page.ts`, `app/api/imports/route.ts`
- Test: `lib/engine/imports-page.test.ts`

**Interfaces:**
- Consumes: `reach(repoRoot, targetPath, direction)` and `Direction` from `lib/engine/reach.ts`; `parseRepoPath`; `activeRepo`, `noActiveRepo`, `jsonError`, `errorJson` from `app/api/_lib/respond.ts`.
- Produces: `type ImportsQuery = { path: string; direction: Direction; transitive: boolean; limit: number; offset: number }`; `parseImportsQuery(params: URLSearchParams): ImportsQuery | { error: string }`; `importsPage(answer: ReachAnswer, query: ImportsQuery): ImportsResponse`; the route `GET /api/imports`, which Tasks 7 and 8 read.

- [ ] **Step 1: Write the failing tests** in `lib/engine/imports-page.test.ts`. These index `copyFixture()` with `indexRepository` (as `reach.test.ts` does) and transcribe "Ground truth" exactly:
  - `"pages the dependents of src/core/log.ts"`: `importsPage(reach(root, "src/core/log.ts", "dependents"), q({ path: "src/core/log.ts" }))` has `toEqual({ path: "src/core/log.ts", kind: "file", direction: "dependents", transitive: false, files: [{ path: "src/app/main.ts", distance: 1 }, { path: "src/core/index.ts", distance: 1 }, { path: "src/index.ts", distance: 1 }], direct: 3, total: 3, offset: 0, indexVersion: <answer.indexVersion> })`.
  - `"transitive pages: limit 2, offset 2"` → `files` `[src/index.ts 1, src/util/strings.ts 2]`, `total` 7, `direct` 3, `offset` 2. The same with `transitive: false` → `[src/index.ts 1]`, `total` 3. With `offset: 10` → `files: []`, `total` 3.
  - `"dependencies of src/app/main.ts, transitive"` → the four files in the table's order, `direct` 3, `total` 4.
  - `"a folder: dependents of src/util, transitive"` → `kind: "folder"` and the four files in the table's order, `direct` 1.
  - `"nothing imports scripts/build.js"` → `files: []`, `direct: 0`, `total: 0`.
  - `"parseImportsQuery: the defaults"`: `parseImportsQuery(new URLSearchParams("path=src/core/log.ts"))` has `toEqual({ path: "src/core/log.ts", direction: "dependents", transitive: false, limit: 50, offset: 0 })`. `path=./src/core/log.ts` normalizes to `src/core/log.ts`. `transitive=true` gives true, and any other value gives false.
  - `"parseImportsQuery refuses"` (each has `"error" in result`): no `path`; `path=` (empty, the repo); `path=../x`; a 1,025-character path; `direction=sideways`; `limit=0`; `limit=501`; `limit=abc`; `limit=2.5`; `offset=-1`; `offset=x`. `limit=500` and `limit=1` are accepted.
- [ ] **Step 2:** Run `npx vitest run lib/engine/imports-page.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `parseImportsQuery` and `importsPage`** in `lib/engine/imports-page.ts`. `importsPage` takes `reached` (sliced to `direct` when not transitive), then the page `[offset, offset + limit)`. `total` is the length before paging. Then `app/api/imports/route.ts`, shaped like `describe/route.ts`: `export const runtime = "nodejs"`; the active repo or `noActiveRepo()`; a parse error → `jsonError(400, "BAD_REQUEST", error)`; then `reach` inside `try`, with `errorJson(err)` for the engine's errors (`BadInputError` → 400 for `""`, `PathNotFoundError` → 404). An empty `path` is refused in the parser, since §19 lists it under 400.
- [ ] **Step 4:** Run `npx vitest run lib/engine/imports-page.test.ts`, then `npx tsc --noEmit`. Expected: PASS, tsc clean.
- [ ] **Step 5: Check the route by hand.** In the sandbox, checked out at this commit, run `npm run build`, then start the Map on 3101 with `NEBULOSITY_HOME=<checkout>` and `NEBULOSITY_WORKER=off`. Then `curl -s "http://127.0.0.1:3101/api/imports?path=src/vs/base/common/event.ts&limit=3"` should return JSON with `total` > 0 and 3 `files`, and the same with `-H "Host: evil.example"` should return 403. Stop it.
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
  - `next-config.test.ts`: `"the Map's pages may be framed only by itself and VS Code"`. `FRAME_ANCESTORS` equals `"frame-ancestors " + <the list Task 1 recorded, space-joined>`, for example `"frame-ancestors 'self' vscode-webview: vscode-file:"`. `await nextConfig.headers()` toEqual `[{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: FRAME_ANCESTORS }] }]`. Under `NEBULOSITY_DEMO=1` (re-import with `vi.resetModules()` and the env set), `headers` is undefined, since `output: "export"` can't have headers.
- [ ] **Step 2:** Run `npx vitest run scripts/cli.test.ts next-config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `parseMapArgs`: `runMap` uses it, and `print-port` logs `readConfig().port` and returns 0 before the `.next/BUILD_ID` check. `USAGE` gains `nebulosity map --print-port   print the port the Map was last started on`.
  - `serverInfo()`; the repos `GET` returns `{ ...listRepos(), server: serverInfo() }`.
  - `next.config.ts`: `FRAME_ANCESTORS`, and `headers()` only in the non-demo branch.
  - The types in `contracts.ts`; the `drawn` line and one sentence in §20 ("posted after the paint that shows a new level or a changed selection; the extension's test and benchmarks read it (V1.8 plan P1)").
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
  - `parseToMap(data: unknown): BridgeToMap | null`: checks every field's type. Paths are strings of at most 1,024 characters. `highlight` keeps the first 50 paths and drops non-strings. Anything else gives null.
  - `type BridgeWindow = { parent: { postMessage(message: unknown, targetOrigin: string): void }; addEventListener(type: "message", fn: (e: MessageEvent) => void): void; removeEventListener(type: "message", fn: (e: MessageEvent) => void): void }`.
  - `createBridge(win: BridgeWindow, onMessage: (message: BridgeToMap) => void): EditorBridge`, where `EditorBridge = { post(message: BridgeFromMap): void; connected(): boolean; dispose(): void }`.
  - In `history.ts`: `mapUrl(folderPath, page, embedded = false)` (appends `embed=vscode` last when embedded); `historyStep(address, place, embedded = false)`; `followStep(step: "none" | "replace" | "push", mode: "push" | "replace"): "none" | "replace" | "push"` (a `"push"` under mode `"replace"` becomes `"replace"`; everything else is unchanged).

- [ ] **Step 1: Write the failing tests.**
  - `embed.test.ts`. A fake window: `parent` is an object with a `postMessage` spy, and `addEventListener` keeps the listener so the test can fire `{ source, origin, data }`.
    - `"isEmbedded"`: `"?embed=vscode"` and `"?path=src&embed=vscode"` → true; `""`, `"?embed=browser"` and `"?embed="` → false.
    - `"accepts a hello only from the parent and a vscode-webview origin, and answers ready"`. A hello `{ type: "nebulosity.hello", version: 1 }` from `parent` with origin `vscode-webview://abc` → `parent.postMessage` called once with `({ type: "nebulosity.ready", version: 1 }, "vscode-webview://abc")`, and `connected()` true. The same hello from another source, or from origin `http://localhost:3000`, or from `https://vscode-webview.evil.com`, or with `version: 2` → no post, `connected()` false.
    - `"posts nothing before the handshake"`: `post({ type: "nebulosity.open", path: "a.ts" })` before hello → no `postMessage` call.
    - `"after the handshake, only that source and origin are heard"`. `follow` from the parent at the kept origin → `onMessage` called with it. The same from origin `vscode-webview://other` → not called. A malformed `{ type: "nebulosity.follow", path: 3 }` → not called.
    - `"a second hello from the parent re-handshakes"` (the webview reloaded): answered with `ready` again.
    - `"highlight keeps at most 50 paths"`: 60 paths in, 50 out.
    - `"dispose removes the listener"`.
  - `history.test.ts`, added cases:
    - `mapUrl("src/vs", 1, true)` → `"/?path=src/vs&page=2&embed=vscode"`; `mapUrl("", 0, true)` → `"/?embed=vscode"`.
    - `historyStep("/?embed=vscode", { path: "", page: 0 }, true)` → `"none"`; `historyStep("/?embed=vscode", { path: "", page: 0 })` → `"replace"`.
    - `"followStep: a follow never pushes"` (Review Focus 4): `followStep("push", "replace")` → `"replace"`; `followStep("none", "replace")` → `"none"`; `followStep("replace", "replace")` → `"replace"`; `followStep("push", "push")` → `"push"`.
    - `placeFromSearch("?path=src&embed=vscode")` → `{ path: "src", page: 0 }`.
- [ ] **Step 2:** Run `npx vitest run app/map/embed.test.ts app/map/history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. The origin check is `origin.startsWith(<the prefix Task 1 recorded>)` (expected `vscode-webview://`) and `event.source === win.parent`. The kept origin is the `targetOrigin` of every post.
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
  - `useEditorBridge(onMessage: (m: BridgeToMap) => void): { post(m: BridgeFromMap): void } | null`, null when not embedded, always calling the newest `onMessage` as `useLive` does;
  - `focus(target: string, options?: { history?: "push" | "replace"; quiet?: boolean })` in `MapView`;
  - `DetailPanel`'s optional prop `onOpenInEditor?: (path: string, line?: number) => void`.

The rules this task wires, each from the design or P-calls:
- `follow` → `focus(path, { history: "replace", quiet: true })`. `show` → `focus(path, { quiet: true })`. `highlight` → `setHighlights(paths)`. `clear` → `setHighlights([])`.
- **The replace mode is consumed by the very next place change and by nothing later** (Review Focus 4). Keep it in a ref, set just before the focus effect's `setPlace`. The place effect applies `followStep(step, ref)` and resets the ref to `"push"`. When `focus` only selects a box already drawn, the ref is never set.
- `quiet` failures set no `focusError`.
- The place effect passes `EMBEDDED` to `historyStep` and `mapUrl`, and so does the level effect's `replaceState` (P8).
- A **box click** on a node whose `kind` is `"file"` (in `select`) posts `{ type: "nebulosity.open", path }` when embedded. Folders and portals behave as today. When embedded, a **declaration row** calls `onOpenInEditor(path, startLine)` instead of opening the viewer, and the "View source" button stays (design §4.4).
- After each `measureAfterPaint`-style double frame following a change of `place` or `selected`, post `drawn` with the place and `selected` (P1). Post nothing when not embedded.
- Claude's live events, pulses, `focus_node` and the activity bar are untouched.

- [ ] **Step 1: Implement** `useEditorBridge.ts` and the wiring above. No new visual element.
- [ ] **Step 2:** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: clean, lint 0 errors, every test passing.
- [ ] **Step 3: The browser Map is unchanged.** Rebuild the sandbox and start it on 3101. In the built-in browser, open `http://localhost:3101/?path=src/vs/base`. Check: no console errors; clicking a file box opens the detail panel as before; a declaration row opens the source viewer; Back works; the address bar never shows `embed`; and a `postMessage` of a well-formed `nebulosity.hello` to the page from the console gets no answer and changes nothing. Stop the server. Record this in the ledger.
- [ ] **Step 4: Commit and push.** `git add app/map/useEditorBridge.ts app/map/MapView.tsx app/map/DetailPanel.tsx`, then `git commit -m "feat(map): embedded in VS Code, the Map follows the editor, opens picked files there and reports what it drew (ADR-062)"` and `git push`.

---

## Part 4 — The extension

### Task 6: The package and its pure modules

**Files:**
- Create: `vscode-extension/package.json`, `tsconfig.json`, `esbuild.mjs`, `.vscodeignore`, `.gitignore` (`dist/`, `node_modules/`, `.vscode-test/`, `*.vsix`)
- Create, each with a `.test.ts` beside it: `vscode-extension/src/ports.ts`, `command.ts`, `serverCheck.ts`, `repoMatch.ts`, `followGate.ts`, `dependents.ts`; and `src/layering.test.ts`
- Modify: `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs` (P11)

**Interfaces (Produces, all pure, no `vscode` import):**
- `ports.ts`: `DEFAULT_PORT = 3000`; `parsePrintedPort(stdout: string): number | null` (one integer 1–65535 on its own line, whitespace trimmed); `choosePort(setting: number | null | undefined, printed: number | null): number`.
- `command.ts`: `type Launch = { command: string; args: string[]; shell: boolean }`.
  - `findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean): string | null`. On Windows it reads `Path` or `PATH` with `;` as separator and tries each `PATHEXT` entry (default `.COM;.EXE;.BAT;.CMD`); elsewhere `PATH` with `:`, the bare name.
  - `nebulosityLaunch(setting: string, onPath: string | null, platform: NodeJS.Platform): Launch | null`. A setting ending in `.mjs` or `.js` gives `{ command: "node", args: [setting], shell: platform === "win32" }`. A setting naming an executable gives it, with `shell` true for `.cmd` or `.bat` on Windows. An empty setting falls back to `onPath` with the same rule. Neither gives null.
  - `withArgs(launch: Launch, args: string[]): Launch`. When `shell` is true, every argument (and the command) holding a space or `&()^"` is double-quoted.
- `serverCheck.ts`: `type ServerCheck = { kind: "current"; list: RepoList } | { kind: "old" } | { kind: "mismatch"; bridge: number } | { kind: "foreign" }`, and `classifyRepos(status: number, body: unknown): ServerCheck`. A 200 whose body is a `RepoList` (`active` string or null, `repos` an array of objects with string `root` and `name`) is `current` when `server.bridge === 1`, `mismatch` for another bridge number, and `old` with no `server`. Anything else, an unparseable body included, is `foreign`.
- `repoMatch.ts`:
  - `samePath(a: string, b: string, platform): boolean`: slashes normalized and trailing `/` dropped, case-insensitive on `win32` (and only there);
  - `repoFor(list: RepoList, folderFsPath: string, platform): RepoSummary | null`: the indexed repo whose root equals the folder or contains it, the longest root winning;
  - `relativeIn(root: string, fileFsPath: string, platform): string | null`: the forward-slash repo-relative path, or null outside the root (a root that is a prefix of another name, like `/a/repo` and `/a/repo2/x.ts`, is outside);
  - `uriPathOf(root: string): string`: `C:/x` → `/C:/x`, `/home/x` → `/home/x`.
- `followGate.ts`: `FOLLOW_DEBOUNCE_MS = 150`, `ECHO_MS = 2_000`, and `class FollowGate { constructor(now: () => number); opened(path: string): void; shouldFollow(path: string): boolean }`. `shouldFollow` is false for the path the extension opened within `ECHO_MS`, and false for the same path as the last follow it allowed. Otherwise it records the path and gives true.
- `dependents.ts`: `pickTitle(r: ImportsResponse): string` and `pickItems(r: ImportsResponse): { label: string; description: string; path: string }[]`, exactly as "Ground truth" (the QuickPick).

- [ ] **Step 1: The package.** Create `package.json`:
  - name `nebulosity-vscode`, `displayName` "Nebulosity", `publisher` the owner's (the field set to `andrewl746` until the Marketplace publisher exists, noted in the ledger), version `0.3.0`, `license` MIT, `engines.vscode` set to P12's floor, `extensionKind: ["workspace"]`, `main: "./dist/extension.js"`;
  - `activationEvents` empty (VS Code derives `onCommand` from `contributes.commands`);
  - `contributes.commands`: the six of Global Constraints. The toggle is two commands, `nebulosity.followOn` (icon `$(pin)`, title "Nebulosity: Follow editor") and `nebulosity.followOff` (icon `$(pinned)`, same title), shown by the context key `nebulosity.following`;
  - `contributes.menus`: `editor/title` with `nebulosity.showMap` (navigation, `when: resourceScheme == file`) and the toggle pair (`when: activeWebviewPanelId == 'nebulosity.map'`), plus `editor/context` and `explorer/context` with `nebulosity.showFile` and `nebulosity.whatDepends` (`when: resourceScheme == file`);
  - `contributes.configuration`: the three settings of Global Constraints;
  - scripts `build` (`node esbuild.mjs`), `check` (`tsc --noEmit`), `test:integration` (`node ./out/test/runTest.js`, after `tsc -p test`), `package` (`vsce package`).
  Install the devDependencies with exact pins: `@types/vscode` at P12's floor, `esbuild`, `typescript`, `@types/node`, `@vscode/test-electron`, `mocha`, `@types/mocha`, `@vscode/vsce` and `ovsx`. `esbuild.mjs` builds `src/extension.ts` to `dist/extension.js` (cjs, node, `external: ["vscode"]`) and `src/webview/relay.ts` to `dist/relay.js` (iife, browser). Root configs (P11): `tsconfig.json` and `eslint.config.mjs` exclude `vscode-extension/**`; `vitest.config.ts` excludes `vscode-extension/test/**`, `vscode-extension/.vscode-test/**` and `vscode-extension/node_modules/**`.
- [ ] **Step 2: Write the failing tests.** Values below are exact.
  - `ports.test.ts`: `parsePrintedPort("3125\n")` → 3125; `"  3000  "` → 3000; `""`, `"abc"`, `"0"`, `"70000"` and `"3000\nmore"` → null. `choosePort(4000, 3125)` → 4000; `choosePort(null, 3125)` → 3125; `choosePort(undefined, null)` → 3000.
  - `command.test.ts` (Review Focus 3):
    - `findOnPath("nebulosity", { Path: "C:\\a;C:\\npm", PATHEXT: ".EXE;.CMD" }, "win32", p => p === "C:\\npm\\nebulosity.CMD")` → `"C:\\npm\\nebulosity.CMD"`;
    - on linux, `PATH: "/usr/bin:/home/u/.npm/bin"` with `/home/u/.npm/bin/nebulosity` existing → that path;
    - nothing found → null;
    - `nebulosityLaunch("", "C:\\npm\\nebulosity.CMD", "win32")` → `{ command: "C:\\npm\\nebulosity.CMD", args: [], shell: true }`;
    - `nebulosityLaunch("C:/Users/A B/Nebulosity/bin/nebulosity.mjs", null, "win32")` → `{ command: "node", args: ["C:/Users/A B/Nebulosity/bin/nebulosity.mjs"], shell: true }`;
    - `nebulosityLaunch("", "/usr/local/bin/nebulosity", "darwin")` → `{ command: "/usr/local/bin/nebulosity", args: [], shell: false }`;
    - `nebulosityLaunch("", null, "linux")` → null;
    - `withArgs({ command: "node", args: ["C:/Users/A B/x.mjs"], shell: true }, ["map", "--port", "3125"]).args` → `['"C:/Users/A B/x.mjs"', "map", "--port", "3125"]`;
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
    - `relativeIn("C:/Users/Andrew/Programming/vscode", "c:\\Users\\Andrew\\Programming\\vscode\\src\\vs\\a.ts", "win32")` → `"src/vs/a.ts"`;
    - `relativeIn("/home/a/Repo", "/home/a/repo/x.ts", "linux")` → null;
    - `relativeIn("/a/repo", "/a/repo2/x.ts", "linux")` → null;
    - `relativeIn("/a/repo", "/a/repo", "linux")` → null (the root is not a file);
    - `uriPathOf("C:/x/y")` → `"/C:/x/y"`, and `uriPathOf("/home/x")` → `"/home/x"`.
  - `followGate.test.ts`, with a fake clock:
    - `opened("a.ts")` at t=0, then `shouldFollow("a.ts")` at t=100 → false, and at t=2,100 → true;
    - `shouldFollow("b.ts")` twice in a row → true, then false;
    - `shouldFollow("b.ts")`, `shouldFollow("c.ts")`, `shouldFollow("b.ts")` → true, true, true.
  - `dependents.test.ts`: transcribe the QuickPick ground truth from `ImportsResponse` literals built from the "Ground truth" tables: direct gives the 3 items and "3 files import log.ts"; transitive gives 7 items and "7 files import log.ts, 4 of them indirectly". With `total: 1` the title is "1 file imports log.ts", and with an empty answer it is "No file imports build.js".
  - `layering.test.ts` (P3, P11): every `vscode-extension/src/**/*.ts` file has no import from `"@/…"`, and none from a path into `lib/` other than an `import type` whose target ends in `lib/contracts`. The pure files (every file except `extension.ts`, `http.ts`, `mapServer.ts`, `panel.ts` and `sync.ts`) have no import of `"vscode"`.
- [ ] **Step 3:** Run `npx vitest run vscode-extension`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** the six modules.
- [ ] **Step 5:** Run `npx vitest run vscode-extension && (cd vscode-extension && npm run check) && npx tsc --noEmit && npm run lint`. Expected: all pass, and root tsc and lint unchanged.
- [ ] **Step 6: Commit and push.** `git add vscode-extension/package.json vscode-extension/package-lock.json vscode-extension/tsconfig.json vscode-extension/esbuild.mjs vscode-extension/.vscodeignore vscode-extension/.gitignore vscode-extension/src vitest.config.ts tsconfig.json eslint.config.mjs`, then `git commit -m "feat(vscode): the extension's package and its pure parts: the port, the command, the server check, repo matching, the follow gate"` and `git push`.

### Task 7: Find or start the Map, the panel, the repo, the relay

**Files:**
- Create: `vscode-extension/src/panelHtml.ts` (pure, with test), `src/webview/relay.ts` (pure, with test), `src/http.ts`, `src/mapServer.ts`, `src/panel.ts`, `src/extension.ts`
- Create: `vscode-extension/media/icon.png` (from `app/icon.svg`, 128×128)

**Interfaces:**
- Consumes: Task 6's modules; `GET /api/repos`, `POST /api/repos`, `GET /api/status`; `nebulosity map --port` and `--print-port` (Task 3); `nebulosity index <root>`.
- Produces:
  - `type PanelState = { kind: "starting" } | { kind: "map"; frameUrl: string } | { kind: "notInstalled" } | { kind: "foreign"; port: number } | { kind: "old" } | { kind: "mismatch"; bridge: number } | { kind: "notIndexed"; root: string } | { kind: "stopped" } | { kind: "failed"; message: string }`;
  - `panelHtml(state: PanelState, opts: { nonce: string; cspSource: string; relayUri: string }): string`;
  - `mapFrameUrl(external: string): string` (one `/`, then `?embed=vscode`); `frameOrigin(frameUrl: string): string`;
  - `startRelay(env: RelayEnv): void`, with `RelayEnv = { frame: { contentWindow: { postMessage(m: unknown, origin: string): void } | null; addEventListener(t: "load", f: () => void): void }; window: { addEventListener(t: "message", f: (e: { source: unknown; origin: string; data: unknown }) => void): void }; vscode: { postMessage(m: unknown): void }; mapOrigin: string; setInterval: typeof setInterval; clearInterval: typeof clearInterval }`, plus `HELLO_INTERVAL_MS = 250` and `HELLO_TIMEOUT_MS = 60_000`;
  - `class MapServer { constructor(output: vscode.OutputChannel); ensure(): Promise<{ port: number; check: ServerCheck } | { notInstalled: true }>; stop(): Promise<void>; readonly startedByUs: boolean }`;
  - `class MapPanel { static show(context, server: MapServer): Promise<MapPanel>; setState(s: PanelState): void; post(m: BridgeToMap): void; onMessage(fn: (m: BridgeFromMap) => void): vscode.Disposable; reload(): void; reveal(): void }`, viewType `nebulosity.map`;
  - the command handlers for `nebulosity.showMap`, `nebulosity.indexRepo` and `nebulosity.stopMap`.

- [ ] **Step 1: Write the failing tests.**
  - `panelHtml.test.ts`:
    - for `{ kind: "map", frameUrl: "http://localhost:3125/?embed=vscode" }` with nonce `n1`, the HTML's CSP meta is exactly `default-src 'none'; frame-src http://localhost:3125; script-src 'nonce-n1' <cspSource>; style-src 'nonce-n1'`;
    - it has one `<iframe` with that `src`, and one `<script nonce="n1" src="<relayUri>">` carrying `data-map-origin="http://localhost:3125"`;
    - `starting` contains "Starting the Map…"; `notInstalled` contains "Nebulosity isn't installed" and `npm install -g nebulosity`; `old` contains "Update Nebulosity: <code>npm install -g nebulosity</code>"; `stopped` contains "The Map stopped" and a Start button posting `{ command: "start" }`; `notIndexed` contains "Index this repo (free)"; `foreign` with 3000 contains "Port 3000 is in use by another app" and "nebulosity.port"; `failed` contains "Show log";
    - no state but `map` has an iframe;
    - every interpolated value is HTML-escaped (a root `C:/a<b` comes out as `C:/a&lt;b`);
    - `mapFrameUrl("http://localhost:3125/")` → `"http://localhost:3125/?embed=vscode"`, `mapFrameUrl("http://localhost:41234")` → `"http://localhost:41234/?embed=vscode"`, and `frameOrigin` of the latter → `"http://localhost:41234"`.
  - `relay.test.ts`, with fake timers and fake frame and window (Review Focus 2):
    - after `load`, a hello `{ type: "nebulosity.hello", version: 1 }` goes to `contentWindow` with origin `mapOrigin` at 0, 250 and 500 ms. Once a `ready` from `contentWindow` at `mapOrigin` arrives, no more hellos go out, and the `ready` is relayed to `vscode.postMessage`;
    - a message from another source or origin is not relayed;
    - two `follow` messages sent to the relay (through its `window` `message` from the extension side, data `{ to: "map", message }`) before `ready` are delivered in order right after `ready`, and only the 20 newest are kept;
    - a second `load` (a reload) starts the hello loop again and holds new messages until the next `ready`;
    - with no `ready`, hellos stop at 60,000 ms.
- [ ] **Step 2:** Run `npx vitest run vscode-extension`. Expected: FAIL.
- [ ] **Step 3: Implement**, following design §4.1–§4.3 and P2, P7:
  - `http.ts`: `getJson(url, timeoutMs)` and `postJson(url, body, timeoutMs)` with Node's `fetch` and `AbortSignal.timeout`, to `http://127.0.0.1:<port>` (no Origin).
  - `MapServer.ensure()`: the port comes from `choosePort(setting, parsePrintedPort(<stdout of withArgs(launch, ["map", "--print-port"]), 5 s timeout>))`. Then `GET /api/repos` with a 1 s timeout through `classifyRepos`, where a refused connection means "not running". If not running, it spawns `withArgs(launch, ["map", "--port", String(port)])`, `detached: process.platform !== "win32"`, `windowsHide: true`, stdout and stderr appended to the "Nebulosity" Output channel. It then polls every 500 ms up to 60 s. `stop()` kills the tree: `taskkill /PID <pid> /T /F` on Windows, `process.kill(-pid)` elsewhere, and only when `startedByUs`. `deactivate` calls `stop()`. If the process exits early, the state is `failed`, with the Output channel's last line as the message.
  - `MapPanel`: `createWebviewPanel("nebulosity.map", "Nebulosity Map", { viewColumn: ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] })`. The frame URL is `mapFrameUrl(String(await env.asExternalUri(Uri.parse("http://localhost:" + port))))`, or `portMapping` if Task 1 chose it. A Start button message calls `ensure()` again.
  - The repo, on Show Map (design §4.3): the folder is the active editor's workspace folder, else the first. Then `repoFor(list, folder.uri.fsPath, process.platform)`: if it differs from `list.active`, `POST /api/repos { root }` (the stored spelling) and `reload()`. With no repo, the state is `notIndexed`, showing the git root (`git rev-parse --show-toplevel` in the folder, falling back to the folder itself). `nebulosity.indexRepo` runs `withArgs(launch, ["index", root])` as a `vscode.Task` with a `ShellExecution` (a visible terminal), and on `tasks.onDidEndTaskProcess` with exit 0, runs Show Map's repo step again and reloads.
  - The window focus rule: on `window.onDidChangeWindowState({ focused: true })` with the panel open, run the repo step (P7).
  - `nebulosity.stopMap`: when `startedByUs`, `stop()` and the state `stopped`; otherwise an information message, "This Map wasn't started by VS Code; stop it where it runs."
  - Another window's Map disappearing: the panel polls nothing. A failed request from the extension, or the iframe's own load failure reported by the relay as `{ type: "relay.frameError" }`, sets `stopped`.
- [ ] **Step 4:** Run `npx vitest run vscode-extension && (cd vscode-extension && npm run check && npm run build)`. Expected: PASS, and `dist/extension.js` and `dist/relay.js` exist.
- [ ] **Step 5: Check by hand.** On the sandbox Map on 3101 (`nebulosity.port` 3101 in a scratch workspace of `../vscode`'s `.vscode/settings.json`: **don't** write into `../vscode`; open a copy of the settings through `--user-data-dir <scratch>` instead). Run `code --extensionDevelopmentPath=vscode-extension --user-data-dir <scratch> ../vscode`, then Show Map. Expected: the Map draws in a panel beside the editor, the status pill shows, and Claude's activity bar is present. Record the result in the ledger. Then the not-running path: stop 3101, set the port to 3102 and `nebulosity.command` to `<sandbox>/bin/nebulosity.mjs`, and run Show Map. Expected: "Starting the Map…", then the Map. Stop Map stops it, and `netstat` shows nothing on 3102.
- [ ] **Step 6: Commit and push.** `git add vscode-extension/src vscode-extension/media`, then `git commit -m "feat(vscode): Show Map: find or start the Map, match the workspace's repo, the panel and its relay"` and `git push`.

### Task 8: Two-way sync and the file commands

**Files:**
- Create: `vscode-extension/src/sync.ts`; Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `MapPanel.post`, `onMessage` (Task 7); `FollowGate`, `relativeIn`, `uriPathOf`, `pickTitle`, `pickItems` (Task 6); `GET /api/imports` (Task 2).
- Produces:
  - `NebulosityApi` returned from `activate`, for the tests only: `{ sent: BridgeToMap[]; received: BridgeFromMap[]; simulateFromMap(m: BridgeFromMap): Promise<void>; waitFor(pred: (m: BridgeFromMap) => boolean, timeoutMs: number): Promise<BridgeFromMap>; port(): number | null }`;
  - the handlers for `nebulosity.showFile`, `nebulosity.whatDepends`, `nebulosity.followOn` and `nebulosity.followOff`.

The rules (design §4.4–§4.5, P4–P6, P10):
- **Editor → Map:** on `window.onDidChangeActiveTextEditor`, wait `FOLLOW_DEBOUNCE_MS`. If following, the panel is open, `relativeIn(repo root, editor.document.uri.fsPath)` is not null and `gate.shouldFollow(path)`, post `follow`. After each `ready`, post `follow` for the active editor, unless the gate says no.
- **Map → editor:** on `open { path, line? }`, call `gate.opened(path)`, then `window.showTextDocument(folder.uri.with({ path: uriPathOf(root) + "/" + path }), { viewColumn: <the column of the most recent text editor, else ViewColumn.One>, preview: true, preserveFocus: true, selection: line ? new Range(line - 1, 0, line - 1, 0) : undefined })`.
- **Show this file** (the resource from the context menu, else the active editor): first `GET /api/imports?path=<rel>&limit=1`, where a 404 `NOT_FOUND` shows P5's message. Then reveal the panel (opening it through Show Map if closed) and post `show`.
- **What depends** (P6): `GET /api/imports?path=<rel>` (direct), then a QuickPick titled `pickTitle` with `pickItems` and one more item, "Show all, including indirect", that re-asks with `transitive=true&limit=500`. Post `show` for the file and `highlight` with the listed paths (the first 50). Picking an item opens it like `open`. Hiding the pick posts `clear`.
- **Follow toggle:** `setContext("nebulosity.following", value)`. It starts from `nebulosity.followEditor` and is never written back (P4).

- [ ] **Step 1: Implement** `sync.ts` and the wiring, then build. Run `cd vscode-extension && npm run check && npm run build && cd .. && npx vitest run vscode-extension`. Expected: PASS.
- [ ] **Step 2: Check by hand** on the sandbox Map on 3101, in the dev host from Task 7:
  - switch between three files in two folders: the Map moves and selects each;
  - click a file box on the Map: the file opens beside the panel, and the Map doesn't jump;
  - click a declaration row: the file opens at that line;
  - run What depends on `src/vs/base/common/event.ts`: the pick lists its importers, the Map highlights them, and closing the pick clears them;
  - turn the toggle off: switching files no longer moves the Map.
  Record each result in the ledger.
- [ ] **Step 3: Commit and push.** `git add vscode-extension/src`, then `git commit -m "feat(vscode): the Map follows the editor, picks on the Map open the editor, Show this file and What depends on this file"` and `git push`.

---

## Part 5 — Proof

### Task 9: The integration test, and CI on three systems

**Files:**
- Create: `vscode-extension/test/tsconfig.json`, `test/runTest.ts`, `test/suite/index.ts`, `test/suite/extension.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:** consumes `NebulosityApi` (Task 8).

- [ ] **Step 1: Write the test** `test/suite/extension.test.ts` (mocha `suite`/`test`). `runTest.ts` takes from env: `NEB_TEST_WORKSPACE` (a temp copy of the mini-repo, already indexed and active), `NEB_TEST_COMMAND` (the installed `nebulosity`, or a checkout's `bin/nebulosity.mjs`) and `NEB_TEST_PORT` (3125). It writes `.vscode/settings.json` into the temp copy with `nebulosity.command` and `nebulosity.port`, then runs `runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [workspace, "--disable-extensions"], version: process.env.NEB_TEST_VSCODE ?? "stable" })` and prints the VS Code version it ran. Tests, in order, in one suite with `NEBULOSITY_WORKER=off` in the environment:
  1. `"Show Map starts the Map and draws it"`: `executeCommand("nebulosity.showMap")`, then `waitFor(m => m.type === "nebulosity.drawn", 90_000)` gives `{ path: "", page: 0 }` (the frame loaded, which also catches an `X-Frame-Options` regression). `api.received` holds `{ type: "nebulosity.ready", version: 1 }`.
  2. `"the Map follows the editor"`: `showTextDocument(<workspace>/src/core/log.ts)`, then `waitFor(m => m.type === "nebulosity.drawn" && m.selected === "src/core/log.ts", 10_000)` has `path: "src/core"`. `api.sent` ends with `{ type: "nebulosity.follow", path: "src/core/log.ts" }`.
  3. `"a pick on the Map opens the file and doesn't echo"`: `simulateFromMap({ type: "nebulosity.open", path: "src/app/main.ts", line: 6 })`, then the active editor is `src/app/main.ts` with its selection on line index 5. Within 1 s, no `follow` for `src/app/main.ts` was sent.
  4. `"What depends asks /api/imports"`: with `src/core/log.ts` active, after `executeCommand("nebulosity.whatDepends")` resolves its fetch, `api.sent` holds `{ type: "nebulosity.highlight", paths: ["src/app/main.ts", "src/core/index.ts", "src/index.ts"] }`. Then `executeCommand("workbench.action.closeQuickOpen")`, and `api.sent` ends with `{ type: "nebulosity.clear" }`.
  5. `"Show this file on an unindexed file says so"`: create `src/new.ts` in the copy, then `executeCommand("nebulosity.showFile", uri)`. No `show` is sent (the 404 path).
  6. `"Stop Map stops the Map it started"`: `executeCommand("nebulosity.stopMap")`, then within 10 s `fetch("http://127.0.0.1:3125/api/repos")` rejects.
- [ ] **Step 2: Run it locally** against the sandbox's built package. Build the extension (`npm run build`, `tsc -p test`), then, with `NEB_TEST_COMMAND=<sandbox>/bin/nebulosity.mjs`, `NEBULOSITY_DATA=<scratch>`, the mini-repo copy indexed there through `<sandbox>/bin/nebulosity.mjs index <copy>`, and `NEB_TEST_PORT=3125`, run `npm run test:integration`. Expected: 6 passing. Then run it once more with `NEB_TEST_VSCODE` set to P12's floor (for example `1.99.0`). Expected: 6 passing. Record the versions in the ledger.
- [ ] **Step 3: CI.** Add steps to `ci.yml` after the installed-Map steps. All are gated `if: ${{ !cancelled() && steps.index.outcome == 'success' }}` and get `timeout-minutes: 15`:
  - `npm ci`, `npm run check` and `npm run build` in `vscode-extension`;
  - a temp copy of mini-repo indexed with `"$BIN/nebulosity" index "$COPY"`;
  - `npm run test:integration` with `NEB_TEST_COMMAND="$BIN/nebulosity"`, `NEB_TEST_PORT=3125` and `NEBULOSITY_DATA` scratch, wrapped in `xvfb-run -a` on Linux;
  - an always-run cleanup that kills anything on port 3125 (the stop steps' pattern).
  Add `vscode-extension/package-lock.json` to the setup-node cache paths.
- [ ] **Step 4: Run CI.** `git push origin HEAD:refs/heads/ci/v1-8` (`--force` if it exists), then `gh run watch <id> --exit-status`. Expected: the three systems green, the Windows run included (`.cmd` shim, tree kill). If one system fails, fix it and re-run. A failure only Cursor or remote would see can't happen here (local only).
- [ ] **Step 5: Commit and push.** `git add vscode-extension/test .github/workflows/ci.yml`, then `git commit -m "test(vscode): the extension against a real Map on the mini-repo, in CI on Linux, macOS and Windows"` and `git push`. Record the run id in the ledger.

### Task 10: Editor Benchmark #1 (E1, E2)

**Files:**
- Create: `vscode-extension/test/bench/bench.test.ts` (run only when `NEB_BENCH=1`; `runTest.ts` picks the bench suite then)
- Modify: `docs/BENCHMARKS.md`

- [ ] **Step 1: Write the bench suite.** It reuses `NebulosityApi`:
  - **E1** (5 runs): close the panel (`workbench.action.closeActiveEditor` on it), then time `executeCommand("nebulosity.showMap")` → the first `drawn`.
  - **E2:** pick 20 files of `../vscode`, read from `GET /api/imports`'s dependents of `src/vs/base/common/event.ts` (transitive, the first 10 inside `src/vs/base/common/` and the first 10 elsewhere, all repo-relative). Time `showTextDocument` resolved → `drawn` with `selected` that file. Run the 20 twice and report the second pass: p50, p95, max.
  - **Cold, informative:** no server running, then Show Map → the first `drawn`.
  - It prints one JSON line per bar.
- [ ] **Step 2: Run it.** Ask the owner first if port 3000 is serving: this run uses 3126, from the sandbox, reading the checkout's index with `NEBULOSITY_HOME=<checkout>` and `NEBULOSITY_WORKER=off`, with nothing on 3000 touched. The workspace is `../vscode` itself, opened read-only, with the settings passed by `--user-data-dir <scratch>` and nothing written into `../vscode`. Keep the VS Code window in front for the whole run (a hidden webview gets no frames).
- [ ] **Step 3: Record it.** Add "## 2026 10 2x Editor Benchmark #1 — the Map in VS Code: Show Map and follow (V1.8, E1–E2)" to `docs/BENCHMARKS.md`: the machine, the VS Code version, the repo at `cc3fec88`, each bar with its numbers and PASS or FAIL, and the cold numbers labelled "no bar". **If a bar fails:** profile once (the Map's `__nebulosityPerf` through the probe isn't available, so time the `level` fetch with `curl` on the same path). Fix it if the cause is in this slice's code. Otherwise record it as measured and stop for the owner.
- [ ] **Step 4: Commit and push.** `git add vscode-extension/test/bench docs/BENCHMARKS.md`, then `git commit -m "bench: Editor Benchmark #1, Show Map and follow in VS Code on VS Code's repo (V1.8)"` and `git push`.

### Task 11: Docs, version, the `.vsix`, the final review

**Files:** `docs/API_CONTRACTS.md`, `docs/ENGINEERING_DECISIONS.md`, `docs/ARCHITECTURE.md`, `README.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `CLAUDE.md`, `package.json` (version), `vscode-extension/README.md`, `vscode-extension/LICENSE`.

- [ ] **Step 1: Docs.**
  - API_CONTRACTS §15, §19 and §20: change "designed, not built" to "slice V1.8". §20 gets the spike's origin prefix and the `drawn` message (if not already there).
  - ADR-062 amended (dated): the spike's results (what passed, and what was dropped under the fallback rule), the `frame-ancestors` list, P1–P12 in one line each, and the bars' results.
  - ARCHITECTURE: the extension as a client of the HTTP contract, with its one type import (P3).
  - README: an "In VS Code" section (install the package, install the extension from the `.vsix` until it's published, run Show Map).
  - The roadmap's V1.8 row: done.
  - CLAUDE.md's current state: a "V1.8 done" bullet in the file's style.
- [ ] **Step 2: Version and package.** Set root `package.json` `version` to `0.3.0` (design §6). Write the listing (`vscode-extension/README.md`): its first line says it needs the `nebulosity` package and links the install, then the commands and settings, and "Not yet: browser-hosted VS Code" plus anything the spike dropped. Copy `LICENSE`. Run `cd vscode-extension && npx vsce package`. Expected: `nebulosity-vscode-0.3.0.vsix`, not committed (`.gitignore`). Record its size and file list (`npx vsce ls`) in the ledger: only `dist/`, `media/`, `README.md`, `LICENSE` and `package.json`.
- [ ] **Step 3: The gate.** Run `npx tsc --noEmit && npm run lint && npx vitest run`, plus `cd vscode-extension && npm run check`. Expected: all clean. The vitest count is the baseline plus this slice's tests. Record it.
- [ ] **Step 4: The final review** ("2026 10 2x V1.8 Final Review #1"). Run superpowers:requesting-code-review over the slice's diff, the three Review Focus tests included, with ADR-039's guards and the browser Map's unchanged behaviour as named checks. Fix Critical and Important findings in one wave, re-review, and list the deferred minors in the ledger.
- [ ] **Step 5: Commit and push.** Stage the files above and nothing else, then `git commit -m "docs: V1.8 In your editor built: contracts, ADR-062 amended, architecture, README, roadmap; package 0.3.0"` and `git push`.

### Task 12: The owner's look. STOP

- [ ] **Step 1:** Hand the owner the `.vsix` path and these steps (design §8 step 7):
  1. Install it: `code --install-extension vscode-extension/nebulosity-vscode-0.3.0.vsix`.
  2. Open VS Code on `../vscode` and run "Nebulosity: Show Map".
  3. Start Claude Code in VS Code's terminal and ask it a dependency question.
  4. Watch the pulses, `show_on_map`, and the Map following the editor.
  5. Click a box: it opens beside the panel.
- [ ] **Step 2:** Record the owner's words verbatim in the ledger. Fix what they ask for (each fix its own commit and push). The ship list waits on their "looks good" (ADR-062). Opening the PR `pivot/v1 → main` is their call: ask.

---

## After V1.8

E4 (its own design session): tree-sitter adapters in waves, Python, then Go, Java, C# and Rust. Then the ship list: deploy the demo, make the repo public, `npm publish` 0.3.0, `vsce publish` and `ovsx publish` (the owner's publisher and namespace), the video, the README links. Remote modes or Cursor, if Task 1 dropped them, get a follow-up slice.

## Self-review (done while writing; the executor can skip this)

- **Spec coverage.** G1 → Tasks 7 and 9.1. G2 → Tasks 5, 8 and 9.2. G3 → Tasks 5, 8 and 9.3. G4 → unchanged code, plus Task 7's hand check and Task 12. G5 → Tasks 8, 9.4 and 9.5. G6 → Task 1 (remote) and Task 9 (three systems). G7 → Task 11's `.vsix` (publishing is the owner's, at ship). §4.2's stop rule → Tasks 7 and 9.6. §4.3's two windows → Task 7 (P7). §6's version check → Tasks 3, 6 and 7. §9's clickjacking → Task 3. The design §8 order → Parts 1–5, the spike first, with its fallback rule in Task 1 Step 6.
- **Types.** `ImportsResponse` (Task 2) is used by Tasks 6 and 8. `BridgeToMap`/`BridgeFromMap` with `drawn` (Task 3) are used by Tasks 4, 5, 7, 8 and 9. `followStep` (Task 4) is used by Task 5. `FollowGate`, `relativeIn` and `uriPathOf` (Task 6) are used by Task 8. `PanelState` and `startRelay` (Task 7). `NebulosityApi` (Task 8) is used by Tasks 9 and 10.
- **Ground truth** was derived by hand from the fixture's files and checked against `reach.test.ts`' existing counts: log.ts dependents direct 3 and 7 reached; `src/app` dependencies direct 2.
- **Review Focus:** each line names its test and task.
