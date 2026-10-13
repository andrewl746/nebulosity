# VISUAL_REFRESH.md — Refining the Map's dark theme for readability (slice V1.3.1)

**Status:** Approved by the owner, 2026-10-12. **Implemented 2026-10-12, awaiting the owner's visual sign-off** (measured in BENCHMARKS.md, Map Benchmark #2; screenshots in `docs/screenshots/v1-3-1/`). This is the target the V1.3.1 build matches. Decision records: ADR-041, and ADR-042 for the owner-review additions.
**Replaces:** the V1.3 look: starfield, purple haze, glowing edges, tiny monospace boxes. An earlier same-day draft of this doc proposed a light theme; it was dropped before implementation.
**Scope:** presentation and interaction on the existing Map. The engine, the APIs (apart from the describe speed fix in §8), data, the 50-box cap and the level model are unchanged. *(Amended in the build: the owner's review added pages of related boxes with portals, which changed the level model and the contract to v3, and a source endpoint. See the amendments below.)*

**Amendments since approval** (each is marked where it lands):
- **Colors (§2):** `--danger` for errors; the palette retuned twice by the owner's picks (cool slate, then violet slate with lavender names and code); VS Code's Dark+ colors for code.
- **Type (§7):** IBM Plex Sans and Plex Mono replace Geist.
- **Lines (§4):** routed through the channels and gutters between boxes, never across one, instead of curves. They're 1 px slate, or 2 px purple for the selection; V1.3's widths by √count are gone. A legend explains arrows, purple and orange.
- **Popovers (§4):** the status menu and repo picker sit on `--surface` and close on an outside click or Escape.
- **Activity (§6):** each tool call reads as a phrase ("Reading build/gulpfile.js"), and the top bar's `owner / repo` comes from the origin remote.
- **Added from the owner's first look (§6):** the help, the status as a bordered menu button, the source viewer, Back and the address bar, the feel (cursors, scrollbars), and big folders drawn a page at a time.
- **Pages (§6, ADR-042):** first by size with a "+N more" box, then grouped by import with portals to the other pages, so every box is drawn on some page. `GET /api/level` gained `page` and `focus`, and the contract went to v3.
- **Keys (§6):** Backspace, the arrows and ? leave the Map alone while a dialog is open.
- **Busy levels (§4):** past 60 lines, only the hovered or selected box's lines are drawn, with "Show all lines" to bring the rest back.
- **From the three-task test (§9):** line sentences on hover, a plain-word legend sentence for direction, 26 px arrowheads, 15 px relationship headings, a page pill on the canvas with solid side arrows, the repo name going home, hover summaries on boxes.
- **Overlays (§4):** the legend, the page pill and the zoom controls are solid `--overlay` cards (the logo's violet) with no outline: lines are never filled, so they can't be mistaken for lines (a light `--text-2` outline was, by the owner), and no box is that colour. Their buttons are `--control` cyan. React Flow's attribution label is hidden. The legend is collapsed to a "Legend" button by default, opens as a narrow card of short rows, and remembers in the browser whether it was left open.
- **The speed fix (§8):** the 5 s `src` panel didn't reproduce (30–141 ms, BENCHMARKS.md Map Benchmark #2); answers are now cached per index version, and the panel says "Refreshing…" while an on-demand summary is on its way.
- **The three-task test (§9), run 2026-10-13,** and what it changed: the line sentences, the arrows' wording and size, the page bar, the solid page arrows, the repo name going home, hover summaries, and search without the repo's name.
- **Night violet + cyan (§2), 2026-10-13:** the owner found the violet-slate surfaces grey and monotone once the overlays took the logo's colours, and picked option C of four whole-screen renders: the logo's night violet for every surface, its violet for the overlays, and its cyan as the one color for things you click.
- **Still owed:** the owner's sign-off.

## 1. Principle

Optimize for **understanding a repo in 1–2 seconds per box**, not for looking futuristic.
- Make the important information prominent and the decorative information disappear.
- Every color means exactly one thing.
- The interface should feel predictable and intentional, like Linear, Vercel or GitHub, not like a generated dashboard.

This slice is shaped by what the owner saw on the real V1.3 screen: competing background effects, 9–10 px box text with a description in every box, purple used everywhere, and a details panel that was one dense monospace paragraph showing literal backticks and taking about 5 s to open for `src`.

## 2. Color tokens

Define these as CSS custom properties in `app/globals.css`. Components use tokens, never raw hex.

*(Revised 2026-10-12 by the owner's picks after the first build, which read as too monotone. A blue "cool slate" pick came first, but it read as too blue for Nebulosity, so the pick became **violet slate**: purple-tinted surfaces and lavender names, with the selection still vivid purple.)*

*(Revised again 2026-10-13: **night violet + cyan**, every color taken from the logo, `app/icon.svg`. The surfaces moved from violet-grey to the logo tile's night violet, which the owner found less grey and monotone. The logo's violet is the overlays' fill, and its cyan glow is the color of everything you click. Contrast, measured: `--text` 15.4–17.0:1 on the surfaces, `--text-2` 8.3–9.1:1, `--control` 12.2–13.4:1 on the surfaces and 7.6:1 on `--overlay`, `--overlay-text-2` 6.2:1 on `--overlay`, `--neutral-edge` 3.7:1 on the canvas.)*

| Token | Hex | One meaning |
|---|---|---|
| `--canvas` | `#0E0A1C` | page and Map background, a single flat night violet (the logo tile's dark end) |
| `--surface` | `#1B1333` | boxes, inputs, cards |
| `--panel` | `#140E28` | the details panel, drawers, dialogs |
| `--hairline` | `#261B45` | dividers |
| `--border` | `#3A2A66` | box and input borders |
| `--text` | `#F1EEF8` | primary text: names, headings |
| `--text-body` | `#D3C7EE` | paragraphs: summaries, help |
| `--text-2` | `#B9A9DE` | secondary text, counts, labels |
| `--title` | `#C7B3FF` | **lavender: a description's title** (a summary's tagline, help headings) |
| `--code` | `#D8CAFF` | **lavender: code identifiers in text** |
| `--code-bg` | `#2A1B52` | the chip behind them |
| `--folder` | `#A98BEA` | **lavender: the folder icon**, so folders and files part at a glance |
| `--neutral-edge` | `#7262A6` | ordinary connections, bright enough to follow on the canvas |
| `--select` | `#B58AFF` | **purple: the selected box, its direct links and its dependency path.** Nothing else |
| `--select-fill` | `#2E1A5C` | the selected box's fill |
| `--agent` | `#F08A4B` | **orange: what Claude Code is touching right now.** Nothing else |
| `--ok` | `#4CC38A` | **green: indexing status only** (the "indexed" dot) |
| `--danger` | `#F07A7A` | error text and a failed stage. *(Added in the V1.3.1 build: the table had no color for errors, and people need to see them.)* |
| `--control` | `#67E8F9` | **cyan (the logo's glow): something you click** — links, text buttons, the page arrows, the overlays' buttons. Content you select (boxes, chips, rows) keeps its own look |
| `--overlay` | `#4C1D95` | the logo's violet: the fill of the overlays on the Map (legend, page pill, zoom controls) |
| `--overlay-line` | `#5B2AA8` | dividers inside an overlay |
| `--overlay-text-2` | `#D8B4FE` | secondary text on an overlay |

Lavender (soft, on text and icons) is the brand: it marks names and code, what you read to know what something is. Vivid purple, as a box's 2 px border and fill and as its lines, is the selection. They share a hue on purpose, but never a job: lavender never marks state.

**Syntax colors, inside code only** (the source viewer and search's code lines). The owner asked for code colored as in VS Code, so these are VS Code's **Dark+** palette: `--syn-text #D4D4D4`, `--syn-keyword #569CD6` (const, function, class), `--syn-control #C586C0` (import, return, if), `--syn-string #CE9178`, `--syn-number #B5CEA8`, `--syn-comment #6A9955`, `--syn-type #4EC9B0`, `--syn-function #DCDCAA`, `--syn-variable #9CDCFE`, `--syn-constant #4FC1FF`, `--syn-regexp #D16969`. Inside code they mean token kinds; nothing on the Map uses them.

Purple is never used just because something is interactive. Links and text buttons are `--control` cyan with an underline; bordered buttons use `--text` or a `--control` border, never purple. *(Cyan for links since 2026-10-13; before, they used `--text`.)*

**Contrast:** `--text` and `--text-2` on `--canvas` and `--surface` meet WCAG AA. Information people need to read is never smaller than 12 px.

## 3. Background

- A flat `--canvas`. No starfield, no purple haze or ambient glow, no gradient.
- The grid is optional; if kept, it's barely visible (around 4% opacity).
- No glow on anything, anywhere.

## 4. Map

| Element | Rule |
|---|---|
| Box | `--surface` fill, 1 px `--border`, 8 px radius, a small Tabler outline icon (`ti-folder` or `ti-file`) |
| Box text | name 14–15 px / 500 in `--text`, count 12 px in `--text-2`. **No description inside boxes**; summaries live in the panel |
| Selected box | `--select-fill`, 2 px `--select` border |
| Claude's focus | 2 px `--agent` border, with a brief pulse when it changes (respects `prefers-reduced-motion`) |
| Unrelated boxes when something is selected | **about 60% opacity** — visible and clickable, but quieter |
| Edges | **directional arrows on every edge**: 1 px `--neutral-edge` normally, 2 px solid `--select` for the selection's direct links. Where it adds meaning, label the relationship ("imports") |
| Hover | highlights that box's direct connections without selecting it |
| Spacing | more room between boxes, and the level fits the viewport with comfortable padding |

*(Amended in the V1.3.1 build, after the owner's first look.)* Lines are **routed**:
- Each line leaves its box's bottom, runs along the empty channel under that row, and goes up or down a lane in the gutter between boxes. It then runs along the channel above its target and drops into the target's top, with corners rounded at 8 px.
- No line crosses a box. React Flow's default curve went straight from box to box and cut through whatever lay between.
- Lines sharing a lane overlap like a bus. The selection's route stays purple and on top.
- **Busy levels draw lines on demand** *(owner, after the page portals)*. A level with more than 60 lines (50 of VS Code's 3,793; `src/vs/platform` has 441) draws no lines at rest: hovering a box draws its lines, and selecting it keeps them in purple, portals included, so a portal lights up only when the box picked links to that page. "Show all lines", beside the page note, brings back every line until it's turned off, and the legend says lines show on hover.
- Popovers (the status menu, the repo picker) sit on `--surface` and close on an outside click or Escape.

**Interaction:**
- **Single click** selects a box and shows its details.
- **Double click** on a folder goes into it.
- **The breadcrumb** (`vscode / src / vs`) goes back up.
- **Controls:** zoom, fit to view, and reset focus (clears the selection and the fade).

## 5. Details panel

It's actionable and structured, not a static card. From top to bottom:
1. **Kind label** ("Folder" / "File") in 12 px `--text-2`.
2. **Name**, 18 px / 500.
3. **Stats line:** "10,276 files · 3.4M lines". Label which count excludes tests wherever two counts could disagree.
4. **A short summary** of about two lines (the tagline plus the first sentence), with **"Read full summary"** to expand the rest.
5. **Key relationships:** "Depends on" and "Used by" as clickable chips. Clicking one focuses that box on the Map.
6. **Contents:** a list of child folders and files with their counts, plus "View all". Clicking a child folder goes into it; clicking a file selects it.

**Markdown in summaries:** backtick identifiers render as inline code (monospace on a `--surface` chip), never as literal backticks. Body text is 14–15 px sans with a 1.5 line height, not monospace.

## 6. Top bar and activity

- **Top bar, left to right:** a small Nebulosity mark and name, the repo as `owner / repo` (prominent), the view title "Dependency map", then a wide search field ("Search files and concepts", `Ctrl K`). A green status dot sits on the right.
- **Activity bar:** a slim bar along the bottom that's always visible. It shows Claude Code's **last 3 actions** ("Reading build/gulpfile.js"), each with an `--agent` dot. It stays slim so the Map remains the focus, and it's never hidden: live activity is the demo's differentiator.
  - *(Added in the V1.3.1 build.)* Each tool call reads as a phrase (`app/map/activity.ts`). A leading `mcp__nebulosity__` is dropped, "+N" counts further paths, and `""` reads "the repo":

    | Tool | Phrase |
    |---|---|
    | `describe` | Reading build/gulpfile.js |
    | `overview` | Reading the repo overview |
    | `search` | Searching · a.ts +2 |
    | `dependents` | Finding what uses x.ts |
    | `dependencies` | Finding what src/vs/editor uses |
    | `path` | Tracing a.ts → b.ts |
    | `show_on_map` | Showing src/vs +1 on the map |
    | anything else | its name · its first path |

  - The boxes holding what those 3 actions touched keep the `--agent` ring while the action is under 30 s old (the old dock's idle window). show_on_map's highlights keep it until they're cleared.
  - The repo's `owner / repo` comes from its origin remote (`RepoSummary.remote`, API_CONTRACTS.md §15). Without one, it's the folder name.

*(Added in the V1.3.1 build, from the owner's first look.)*
- **Help:** a "?" button beside the status, the `?` key, and the first visit in a browser open "How to use the Map". It covers getting around, reading the Map, what each color means, the panel, Claude Code's activity and the keyboard.
- **The status** is a bordered button with a chevron, so it reads as the menu it opens.
- **Source:** a file's panel offers "View source", a read-only drawer over the canvas with line numbers. A declaration in the panel opens it at that declaration's lines, highlighted (API_CONTRACTS.md §16).
- **Pages and Back:** a big folder is drawn a page at a time, 44 boxes that import each other, with big solid arrows at the canvas's sides, a page pill in the canvas's top-right corner ("‹ Page 2 of 5 · 44 of 182 boxes ›"), or the arrow keys. Lines to boxes on other pages end at **portals**, dashed doorway boxes in `--text-2` with an arrow toward their page ("Page 2", "44 boxes · 6 links"; past 6 linked pages, one "+N pages" box with a stack icon). Double-clicking a portal turns to its page, and its panel lists the boxes on this page linked to it. The address bar holds the folder and page, so the browser's Back returns to the previous one (ADR-042).
- **Keys stay put under a dialog:** while the source viewer or the help is open, Backspace, the arrows and ? leave the Map alone, and Escape closes just the dialog.
- **Feel:** everything clickable shows the hand and answers the hover, the search field shows the text cursor, and scrollbars are thin and in the theme's colors.

## 7. System rules (anti-noise)

- **One radius:** 8 px for boxes, cards and inputs; 6 px for chips.
- **A small type scale:** 18 / 15 / 14 / 13 / 12 px, in two weights (400 and 500). Sans everywhere; monospace only for code identifiers and paths inside text. *(The owner picked the faces on 2026-10-12: **IBM Plex Sans** and **IBM Plex Mono**, replacing Geist, which read as plain.)*
- **One spacing scale:** 4 / 8 / 12 / 16 / 24 px.
- No shadows, glows or gradients. Motion only for the agent pulse and view transitions.

## 8. Speed fix bundled into this slice

Opening the panel for a large folder (`src`) took about 5 s in V1.3. Profile `describe` and make the panel open within the existing interaction budget: cache per index version, compute uses and used-by from the in-memory adjacency, and paginate contents. If the fix needs an API change, update `API_CONTRACTS.md` in the same change set.

## 9. Acceptance

- Every token in §2 is defined once and used everywhere: no raw hex in components.
- Checked in the desktop app's browser pane on VS Code:
  - at the root level and at a level with a selection, boxes are readable at 100% zoom;
  - unrelated boxes fade to about 60%, and arrows show direction;
  - hover previews connections; double click drills down, and the breadcrumb goes back;
  - panel chips focus their targets; summaries render inline code correctly;
  - Claude's activity shows orange and the last 3 actions.
- S3 (≤ 100 ms interactions, production build) is re-measured and still holds. Opening the `src` panel takes **≤ 300 ms** warm.
- Screenshots of root, a selection and a drilled-in level go into the slice's PR.
- **The three-task test:** someone unfamiliar with VS Code finds the folder for a feature, says what depends on it, and explains what the highlighted lines mean. Note where they hesitate and fix what's in scope.

  **Run 2026-10-13** by the owner over a video call, with a tester who has no programming experience (the owner drove, she directed and thought aloud), on the production build:
  1. **Find the terminal's folder.** She opened `.vscode` first and clicked `microsoft / vscode`, which did nothing. She didn't think search was allowed; when she tried "vscode terminal", it led to an extension's terminal folder, not `src`'s.
  2. **What depends on it.** She opened a file and was unsure what she was looking at. The arrowheads were too small to read, it took her a while to find "Depends on" in the panel, and she couldn't tell which arrows meant "depends on" and which meant "used by".
  3. **What the highlighted lines mean.** She read an arrow backwards ("base depends on editor").
  4. **Pages** (an extra task). The page arrows and the page number in the top bar were hard to find; the owner also lost the right arrow over the boxes once the panel had opened.

  **Fixed in scope:**
  - A hovered line reads as a sentence ("editor uses base · 12 imports", "github uses boxes on Page 2").
  - The legend says "A → B: A uses B. The arrow points at what's being used." (A first try added rows for "arrows out: what it depends on" and "arrows in: what uses it"; the owner found them abstract.)
  - Arrowheads went from 18 to 26 px.
  - The panel's headings are 15 px, with "What this box uses: its arrows point to these" under Depends on and "What uses this box: their arrows point here" under Used by.
  - A page pill in the canvas's top-right corner ("‹ Page 1 of 3 · 44 of 112 boxes ›") replaces the top bar's note, and the side arrows are solid light buttons. (A first try put a 15 px bar at the bottom of the canvas; the owner found it loud and, in the boxes' colour, camouflaged.)
  - The repo's name goes to the top level (its ▾ switches repos).
  - Hovering a box shows its one-line summary.
  - Search drops the repo's own name when other words remain.

  **Not changed:** knowing to start in `src` takes programming knowledge; the hover summaries are the in-scope help. Folder names already count in search since the owner's own try at task 1 the same day (ADR-027, amended).
- The owner signs off visually before merging.
